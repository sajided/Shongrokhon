-- Phase 2: make_payment only executes against a server-side risk score
-- (TC-P2-FLOW-01..07). The `pay` Edge Function scores first, then calls this
-- with the score id; a direct call without a valid score is rejected.
--
-- Decision branch, after the existing amount, PIN and funds checks:
--   ALLOW            -> pay
--   REVIEW           -> STEP_UP_REQUIRED until called again with p_confirm = true (FLOW-03)
--   FLAG             -> pay, then alert, flag both wallets and notify payer + merchant (FLOW-02)

-- Result shape gains risk_decision and flagged.
create or replace function private.payment_result(p_txn_id uuid, p_replayed boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', t.status,
    'code', null,
    'transaction_id', t.id,
    'amount', t.amount,
    'merchant_id', payee.merchant_id,
    'merchant_name', payee.merchant_name,
    'created_at', t.created_at,
    'balance_after', debit.balance_after,
    'replayed', p_replayed,
    'risk_decision', s.decision,
    'flagged', exists (select 1 from public.risk_alerts a where a.transaction_id = t.id)
  )
  from public.transactions t
  join public.wallets payee on payee.id = t.payee_wallet_id
  left join public.risk_scores s on s.id = t.risk_score_id
  left join public.ledger_entries debit
    on debit.transaction_id = t.id and debit.wallet_id = t.payer_wallet_id and debit.direction = 'DEBIT'
  where t.id = p_txn_id;
$$;

-- The old 5-argument signature would survive `create or replace` as an overload.
drop function if exists public.make_payment(text, numeric, text, uuid, text);

create or replace function public.make_payment(
  p_merchant_id text,
  p_amount numeric,
  p_pin text,
  p_idempotency_key uuid,
  p_note text default null,
  p_score_id uuid default null,
  p_confirm boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
  v_cfg public.app_config;
  v_user public.users;
  v_payer public.wallets;
  v_payee public.wallets;
  v_existing public.transactions;
  v_score public.risk_scores;
  v_attempts int;
  v_txn_id uuid;
begin
  if p_idempotency_key is null then
    return private.payment_failure('INVALID_REQUEST');
  end if;
  select * into v_cfg from public.app_config where id;

  select * into v_payee from public.wallets where kind = 'merchant' and merchant_id = trim(p_merchant_id);
  if not found then
    return private.payment_failure('MERCHANT_NOT_FOUND');
  end if;
  select * into v_payer from public.wallets where user_id = v_uid and kind = 'customer';
  if not found then
    return private.payment_failure('WALLET_NOT_FOUND');
  end if;
  if v_payee.user_id = v_uid then
    return private.payment_failure('SELF_PAYMENT');  -- TC-P1-PAY-11
  end if;

  -- Lock both wallets in id order so concurrent payments serialise without deadlocks (TC-P1-PAY-09).
  -- NO KEY UPDATE, not UPDATE: record_risk_score's foreign keys take KEY SHARE
  -- locks on the same wallets (payer first, then payee). FOR UPDATE conflicts
  -- with those and deadlocked bursts of parallel payments; balances only
  -- change non-key columns, so NO KEY UPDATE serialises payments just the same.
  perform 1 from public.wallets where id in (v_payer.id, v_payee.id) order by id for no key update;

  -- Idempotent replay (TC-P1-PAY-07).
  select * into v_existing from public.transactions
   where payer_wallet_id = v_payer.id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.amount <> p_amount or v_existing.payee_wallet_id <> v_payee.id then
      return private.payment_failure('IDEMPOTENCY_KEY_REUSED');
    end if;
    return private.payment_result(v_existing.id, true);
  end if;

  -- Amount rules (TC-P1-PAY-06).
  if p_amount is null or p_amount <= 0 then
    return private.payment_failure('INVALID_AMOUNT');
  end if;
  if p_amount <> round(p_amount, 2) then
    return private.payment_failure('AMOUNT_TOO_PRECISE');
  end if;
  if p_amount > v_cfg.per_txn_limit then
    return private.payment_failure('AMOUNT_ABOVE_LIMIT', jsonb_build_object('limit', v_cfg.per_txn_limit));
  end if;

  select * into v_payer from public.wallets where id = v_payer.id;
  select * into v_payee from public.wallets where id = v_payee.id;
  if v_payer.status <> 'active' or v_payee.status <> 'active' then
    return private.payment_failure('WALLET_INACTIVE');
  end if;

  -- Risk score (TC-P2-FLOW-07): must exist and match this exact request.
  if p_score_id is null then
    return private.payment_failure('SCORE_REQUIRED');
  end if;
  select * into v_score from public.risk_scores where id = p_score_id;
  if not found or v_score.user_id <> v_uid or v_score.payer_wallet_id <> v_payer.id
     or v_score.payee_wallet_id <> v_payee.id or v_score.amount <> p_amount
     or v_score.idempotency_key <> p_idempotency_key then
    return private.payment_failure('SCORE_INVALID');
  end if;
  if v_score.expires_at <= now() then
    return private.payment_failure('SCORE_EXPIRED');
  end if;

  -- PIN (TC-P1-PAY-04/05). Failures RETURN instead of raising so the counter update commits.
  select * into v_user from public.users where id = v_uid for update;
  if v_user.pin_hash is null then
    return private.payment_failure('PIN_NOT_SET');
  end if;
  if v_user.pin_locked_until is not null and v_user.pin_locked_until > now() then
    return private.payment_failure('PIN_LOCKED', jsonb_build_object('locked_until', v_user.pin_locked_until));
  end if;
  if p_pin is null or extensions.crypt(p_pin, v_user.pin_hash) <> v_user.pin_hash then
    v_attempts := v_user.pin_failed_attempts + 1;
    if v_attempts >= v_cfg.pin_max_attempts then
      update public.users
         set pin_failed_attempts = 0,
             pin_locked_until = now() + make_interval(mins => v_cfg.pin_lock_minutes)
       where id = v_uid
      returning pin_locked_until into v_user.pin_locked_until;
      return private.payment_failure('PIN_LOCKED', jsonb_build_object('locked_until', v_user.pin_locked_until));
    end if;
    update public.users set pin_failed_attempts = v_attempts, pin_locked_until = null where id = v_uid;
    return private.payment_failure('WRONG_PIN', jsonb_build_object('attempts_left', v_cfg.pin_max_attempts - v_attempts));
  end if;
  if v_user.pin_failed_attempts > 0 or v_user.pin_locked_until is not null then
    update public.users set pin_failed_attempts = 0, pin_locked_until = null where id = v_uid;
  end if;

  -- Funds (TC-P1-PAY-03).
  if v_payer.balance < p_amount then
    return private.payment_failure('INSUFFICIENT_FUNDS');
  end if;

  -- Step-up (TC-P2-FLOW-03): nothing moves until the user confirms with their PIN again.
  if v_score.decision = 'REVIEW' and not coalesce(p_confirm, false) then
    return jsonb_build_object('status', 'STEP_UP_REQUIRED', 'code', 'CONFIRM_PAYMENT', 'risk_decision', 'REVIEW',
                              'amount', p_amount, 'merchant_id', v_payee.merchant_id,
                              'merchant_name', v_payee.merchant_name);
  end if;

  v_txn_id := private.post_transfer(
    'PAYMENT', v_payer.id, v_payee.id, p_amount, p_idempotency_key, p_note,
    jsonb_build_object(
      'out_name', v_payee.merchant_name,
      'out_ref', v_payee.merchant_id,
      'in_name', 'Customer',
      'in_ref', private.mask_phone(v_user.phone)
    )
  );
  update public.transactions set risk_score_id = v_score.id where id = v_txn_id;

  if v_score.decision = 'FLAG' then
    perform private.raise_risk_alert(v_score.id, v_txn_id);  -- TC-P2-FLOW-02
  end if;
  return private.payment_result(v_txn_id, false);
end $$;

-- History rows gain `flagged` (receipt notice). The return type changes, so drop first.
drop function if exists public.get_my_transactions(int, timestamptz, uuid);

create or replace function public.get_my_transactions(
  p_limit int default 50,
  p_before timestamptz default null,
  p_id uuid default null
) returns table (
  id uuid,
  type public.txn_type,
  status public.txn_status,
  direction text,
  amount numeric,
  counterparty_name text,
  counterparty_ref text,
  note text,
  created_at timestamptz,
  flagged boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := private.require_session();
  v_wallets uuid[];
begin
  select array_agg(w.id) into v_wallets from public.wallets w where w.user_id = v_uid;

  return query
    with rows as (
      select t.*,
             (t.payer_wallet_id = any (v_wallets)) as is_out,
             private.decrypt_field(t.counterparty_enc)::jsonb as cp
        from public.transactions t
       where (t.payer_wallet_id = any (v_wallets) or t.payee_wallet_id = any (v_wallets))
         and (p_before is null or t.created_at < p_before)
         and (p_id is null or t.id = p_id)
       order by t.created_at desc, t.id desc
       limit least(greatest(coalesce(p_limit, 50), 1), 200)
    )
    select r.id, r.type, r.status,
           case when r.is_out then 'OUT' else 'IN' end,
           r.amount,
           case when r.is_out then r.cp ->> 'out_name' else r.cp ->> 'in_name' end,
           case when r.is_out then r.cp ->> 'out_ref' else r.cp ->> 'in_ref' end,
           private.decrypt_field(r.note_enc),
           r.created_at,
           exists (select 1 from public.risk_alerts a where a.transaction_id = r.id)
      from rows r
     order by r.created_at desc, r.id desc;
end $$;

revoke all on function
  public.make_payment(text, numeric, text, uuid, text, uuid, boolean),
  public.get_my_transactions(int, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function
  public.make_payment(text, numeric, text, uuid, text, uuid, boolean),
  public.get_my_transactions(int, timestamptz, uuid)
  to authenticated;
