-- Phase 4 money flows: cash-out at an agent, send money (P2P), bill pay.
--
-- Same rules as make_payment (CLAUDE.md "Backend rules"): SECURITY DEFINER,
-- require_session first, one balanced pair per movement via
-- private.post_transfer, business failures RETURN {status:'FAILED', code},
-- and money moves only against a matching, unexpired server-side score
-- (TC-P2-FLOW-07). The ML model is trained on QR merchant payments only, so
-- cash-outs and transfers are scored by SQL rules (risk_scores.source = 'RULES').
-- Bill pay is make_payment to a merchant with a biller_category.

--------------------------------------------------------------------------------
-- Schema
--------------------------------------------------------------------------------
alter table public.wallets
  add column if not exists agent_code text,
  add column if not exists agent_name text,
  add column if not exists biller_category text;
create unique index if not exists wallets_agent_code_key on public.wallets (agent_code);

do $$ begin
  alter table public.wallets add constraint wallets_agent_fields
    check ((kind = 'agent') = (agent_code is not null and agent_name is not null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.wallets add constraint wallets_biller_category
    check (biller_category is null
           or (kind = 'merchant' and biller_category in ('RENT', 'ELECTRICITY', 'GAS', 'WATER', 'INTERNET', 'MOBILE')));
exception when duplicate_object then null; end $$;

alter table public.app_config
  add column if not exists cashout_fee_rate numeric(6, 5) not null default 0.0185,
  add column if not exists transfer_fee numeric(14, 2) not null default 0,
  add column if not exists cashout_daily_limit numeric(14, 2) not null default 50000,
  add column if not exists transfer_daily_limit numeric(14, 2) not null default 50000;

-- Collects cash-out fees, so every fee is a balanced ledger pair.
insert into public.wallets (id, user_id, kind)
values ('00000000-0000-0000-0000-00000000a002', null, 'system')
on conflict (id) do nothing;

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------
-- PIN check shared by the Phase 4 flows (same rules as make_payment, TC-P1-PAY-04/05).
-- Returns null when the PIN is right, otherwise the failure to RETURN (so the
-- counter update commits). Locks the user row.
create or replace function private.check_pin(p_uid uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.app_config;
  v_user public.users;
  v_attempts int;
begin
  select * into v_cfg from public.app_config where id;
  select * into v_user from public.users where id = p_uid for update;
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
         set pin_failed_attempts = 0, pin_locked_until = now() + make_interval(mins => v_cfg.pin_lock_minutes)
       where id = p_uid
      returning pin_locked_until into v_user.pin_locked_until;
      return private.payment_failure('PIN_LOCKED', jsonb_build_object('locked_until', v_user.pin_locked_until));
    end if;
    update public.users set pin_failed_attempts = v_attempts, pin_locked_until = null where id = p_uid;
    return private.payment_failure('WRONG_PIN', jsonb_build_object('attempts_left', v_cfg.pin_max_attempts - v_attempts));
  end if;
  if v_user.pin_failed_attempts > 0 or v_user.pin_locked_until is not null then
    update public.users set pin_failed_attempts = 0, pin_locked_until = null where id = p_uid;
  end if;
  return null;
end $$;

-- 01711000001 / 8801711000001 / +880 1711-000001 -> +8801711000001 (users.phone format).
create or replace function private.normalize_phone(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case
    when d ~ '^01[3-9][0-9]{8}$' then '+88' || d
    when d ~ '^8801[3-9][0-9]{8}$' then '+' || d
    else null end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- The fee row of a cash-out gets its own idempotency key, derived from the cash-out's.
create or replace function private.fee_key(p_key uuid) returns uuid
language sql immutable set search_path = '' as $$
  select md5('fee:' || p_key::text)::uuid;
$$;

-- The wallet a flow pays into: an agent (CASHOUT) or another customer (TRANSFER).
create or replace function private.flow_target(p_kind text, p_target text) returns public.wallets
language sql stable security definer set search_path = '' as $$
  select w.* from public.wallets w
   where (p_kind = 'CASHOUT' and w.kind = 'agent' and w.agent_code = upper(trim(p_target)))
      or (p_kind = 'TRANSFER' and w.kind = 'customer'
          and w.user_id = (select u.id from public.users u where u.phone = private.normalize_phone(p_target)));
$$;

-- Rule features for cash-outs and transfers, point-in-time like private.risk_features.
create or replace function private.rules_features(p_kind text, p_payer uuid, p_payee uuid, p_amount numeric, p_at timestamptz)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'kind', p_kind,
    'amount', p_amount,
    'payer_same_kind_count_10m', (select count(*) from public.transactions t
       where t.payer_wallet_id = p_payer and t.type::text = p_kind and t.created_at >= p_at - interval '10 minutes'
         and t.created_at < p_at),
    'payer_cashout_count_30d', (select count(*) from public.transactions t
       where t.payer_wallet_id = p_payer and t.type = 'CASHOUT' and t.created_at >= p_at - interval '30 days'
         and t.created_at < p_at),
    'payee_new_for_payer', not exists (select 1 from public.transactions t
       where t.payer_wallet_id = p_payer and t.payee_wallet_id = p_payee and t.created_at < p_at),
    'payee_flagged', (select w.risk_flagged from public.wallets w where w.id = p_payee));
$$;

-- Rule policy for cash-outs and transfers: a flagged counterparty -> FLAG;
-- a large amount or a burst of the same kind -> REVIEW (PIN re-entry); else ALLOW.
create or replace function private.rules_risk(p_features jsonb) returns public.risk_decision
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg public.app_config;
begin
  select * into v_cfg from public.app_config where id;
  if (p_features ->> 'payee_flagged')::boolean then
    return 'FLAG';
  end if;
  if (p_features ->> 'amount')::numeric >= v_cfg.fallback_review_amount
     or (p_features ->> 'payer_same_kind_count_10m')::int >= v_cfg.fallback_burst_count then
    return 'REVIEW';
  end if;
  return 'ALLOW';
end $$;

-- Result of a cash-out or transfer, also used by get_payment_status.
create or replace function private.flow_result(p_txn_id uuid, p_replayed boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', t.status,
    'code', null,
    'kind', t.type,
    'transaction_id', t.id,
    'amount', t.amount,
    'fee', coalesce(fee.amount, 0),
    'counterparty_name', coalesce(payee.agent_name, nullif(trim(split_part(coalesce(u.full_name, ''), ' ', 1)), ''), 'Shongrokhon user'),
    'counterparty_ref', coalesce(payee.agent_code, private.mask_phone(u.phone)),
    'created_at', t.created_at,
    'balance_after', coalesce(fee_debit.balance_after, debit.balance_after),
    'replayed', p_replayed,
    'risk_decision', s.decision,
    'flagged', exists (select 1 from public.risk_alerts a where a.transaction_id = t.id)
  )
  from public.transactions t
  join public.wallets payee on payee.id = t.payee_wallet_id
  left join public.users u on u.id = payee.user_id and payee.kind = 'customer'
  left join public.risk_scores s on s.id = t.risk_score_id
  left join public.ledger_entries debit
    on debit.transaction_id = t.id and debit.wallet_id = t.payer_wallet_id and debit.direction = 'DEBIT'
  left join public.transactions fee
    on fee.payer_wallet_id = t.payer_wallet_id and fee.idempotency_key = private.fee_key(t.idempotency_key) and fee.type = 'FEE'
  left join public.ledger_entries fee_debit
    on fee_debit.transaction_id = fee.id and fee_debit.direction = 'DEBIT'
  where t.id = p_txn_id;
$$;

-- FLAG on an executed cash-out or transfer: one TXN alert, both wallets
-- flagged, a notice to the payer only (no tip-off to the counterparty).
create or replace function private.raise_flow_alert(p_score_id uuid, p_txn_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_score public.risk_scores;
  v_alert uuid;
  v_kind text := (select t.type::text from public.transactions t where t.id = p_txn_id);
begin
  select * into v_score from public.risk_scores where id = p_score_id;
  insert into public.risk_alerts (kind, risk_score_id, transaction_id, wallet_ids, summary)
  values ('TXN', p_score_id, p_txn_id, array[v_score.payer_wallet_id, v_score.payee_wallet_id],
          jsonb_build_object('flow', v_kind, 'source', v_score.source, 'model_version', v_score.model_version,
                             'amount', v_score.amount, 'features', v_score.features))
  on conflict (risk_score_id) do nothing
  returning id into v_alert;
  if v_alert is null then
    return (select id from public.risk_alerts where risk_score_id = p_score_id);
  end if;
  update public.wallets set risk_flagged = true, risk_flagged_at = coalesce(risk_flagged_at, now())
   where id in (v_score.payer_wallet_id, v_score.payee_wallet_id);
  insert into public.notifications (user_id, kind, title, body, data) values
    (v_score.user_id, 'FLOW_FLAGGED', 'Transaction under review',
     'Your ' || case when v_kind = 'CASHOUT' then 'cash-out' else 'transfer' end
       || ' went through and has been flagged for a routine review. You don''t need to do anything. '
       || 'If you didn''t make it, contact support.',
     jsonb_build_object('transaction_id', p_txn_id, 'amount', v_score.amount, 'flow', v_kind));
  return v_alert;
end $$;

--------------------------------------------------------------------------------
-- Service-role scoring for cash-outs and transfers (called by the `pay` Edge Function)
--------------------------------------------------------------------------------
-- Returns {skip:true} when the request will be rejected anyway, the existing
-- unexpired score for this key, or a new rule-based score {id, decision}.
create or replace function public.flow_score(
  p_user_id uuid, p_kind text, p_target text, p_amount numeric, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.app_config;
  v_payer public.wallets;
  v_payee public.wallets;
  v_features jsonb;
  v_row public.risk_scores;
begin
  select * into v_cfg from public.app_config where id;
  if p_kind not in ('CASHOUT', 'TRANSFER') then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  v_payee := private.flow_target(p_kind, p_target);
  select * into v_payer from public.wallets where user_id = p_user_id and kind = 'customer';
  if v_payee.id is null or v_payer.id is null or v_payee.id = v_payer.id or p_idempotency_key is null
     or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount > v_cfg.per_txn_limit then
    return jsonb_build_object('skip', true);
  end if;

  select * into v_row from public.risk_scores
   where payer_wallet_id = v_payer.id and idempotency_key = p_idempotency_key and expires_at > now();
  if found then
    return jsonb_build_object('id', v_row.id, 'decision', v_row.decision, 'source', v_row.source);
  end if;

  v_features := private.rules_features(p_kind, v_payer.id, v_payee.id, p_amount, now());
  insert into public.risk_scores as s (
    user_id, payer_wallet_id, payee_wallet_id, amount, idempotency_key, features,
    decision, source, model_version, network_risk, expires_at
  ) values (
    p_user_id, v_payer.id, v_payee.id, p_amount, p_idempotency_key, v_features,
    private.rules_risk(v_features), 'RULES', 'rules-v1', 0,
    now() + make_interval(secs => v_cfg.risk_score_ttl_seconds)
  )
  on conflict (payer_wallet_id, idempotency_key) do update
     set payee_wallet_id = excluded.payee_wallet_id, amount = excluded.amount, features = excluded.features,
         decision = excluded.decision, source = excluded.source, model_version = excluded.model_version,
         risk_score = null, anomaly_score = null, created_at = now(), expires_at = excluded.expires_at
   where s.expires_at <= now()
     and not exists (select 1 from public.transactions t where t.risk_score_id = s.id)
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.risk_scores where payer_wallet_id = v_payer.id and idempotency_key = p_idempotency_key;
  end if;
  return jsonb_build_object('id', v_row.id, 'decision', v_row.decision, 'source', v_row.source);
end $$;

--------------------------------------------------------------------------------
-- Cash-out and transfer (customer RPCs, called by `pay` as the caller)
--------------------------------------------------------------------------------
create or replace function private.make_flow(
  p_kind text, p_target text, p_amount numeric, p_pin text, p_idempotency_key uuid,
  p_note text, p_score_id uuid, p_confirm boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
  v_cfg public.app_config;
  v_payer public.wallets;
  v_payee public.wallets;
  v_existing public.transactions;
  v_score public.risk_scores;
  v_failure jsonb;
  v_fee numeric := 0;
  v_today_total numeric;
  v_limit numeric;
  v_phone text;
  v_txn_id uuid;
  v_fee_wallet constant uuid := '00000000-0000-0000-0000-00000000a002';
begin
  if p_idempotency_key is null then
    return private.payment_failure('INVALID_REQUEST');
  end if;
  select * into v_cfg from public.app_config where id;

  v_payee := private.flow_target(p_kind, p_target);
  if v_payee.id is null then
    return private.payment_failure(case when p_kind = 'CASHOUT' then 'AGENT_NOT_FOUND' else 'RECIPIENT_NOT_FOUND' end);
  end if;
  select * into v_payer from public.wallets where user_id = v_uid and kind = 'customer';
  if not found then
    return private.payment_failure('WALLET_NOT_FOUND');
  end if;
  if v_payee.id = v_payer.id or v_payee.user_id = v_uid then
    return private.payment_failure('SELF_TRANSFER');
  end if;

  -- Same lock discipline as make_payment: id order, NO KEY UPDATE.
  perform 1 from public.wallets where id in (v_payer.id, v_payee.id, v_fee_wallet) order by id for no key update;

  select * into v_existing from public.transactions
   where payer_wallet_id = v_payer.id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.amount <> p_amount or v_existing.payee_wallet_id <> v_payee.id or v_existing.type::text <> p_kind then
      return private.payment_failure('IDEMPOTENCY_KEY_REUSED');
    end if;
    return private.flow_result(v_existing.id, true);
  end if;

  if p_amount is null or p_amount <= 0 then
    return private.payment_failure('INVALID_AMOUNT');
  end if;
  if p_amount <> round(p_amount, 2) then
    return private.payment_failure('AMOUNT_TOO_PRECISE');
  end if;
  if p_amount > v_cfg.per_txn_limit then
    return private.payment_failure('AMOUNT_ABOVE_LIMIT', jsonb_build_object('limit', v_cfg.per_txn_limit));
  end if;
  v_limit := case when p_kind = 'CASHOUT' then v_cfg.cashout_daily_limit else v_cfg.transfer_daily_limit end;
  select coalesce(sum(t.amount), 0) into v_today_total from public.transactions t
   where t.payer_wallet_id = v_payer.id and t.type::text = p_kind and t.status = 'SUCCESS'
     and t.created_at >= date_trunc('day', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka';
  if v_today_total + p_amount > v_limit then
    return private.payment_failure('DAILY_LIMIT_EXCEEDED', jsonb_build_object('limit', v_limit));
  end if;

  select * into v_payer from public.wallets where id = v_payer.id;
  select * into v_payee from public.wallets where id = v_payee.id;
  if v_payer.status <> 'active' or v_payee.status <> 'active' then
    return private.payment_failure('WALLET_INACTIVE');
  end if;

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

  v_failure := private.check_pin(v_uid, p_pin);
  if v_failure is not null then
    return v_failure;
  end if;

  v_fee := case when p_kind = 'CASHOUT' then round(p_amount * v_cfg.cashout_fee_rate, 2) else v_cfg.transfer_fee end;
  if v_payer.balance < p_amount + v_fee then
    return private.payment_failure('INSUFFICIENT_FUNDS', jsonb_build_object('fee', v_fee));
  end if;

  if v_score.decision = 'REVIEW' and not coalesce(p_confirm, false) then
    return jsonb_build_object('status', 'STEP_UP_REQUIRED', 'code', 'CONFIRM_PAYMENT', 'risk_decision', 'REVIEW',
                              'kind', p_kind, 'amount', p_amount, 'fee', v_fee);
  end if;

  select u.phone into v_phone from public.users u where u.id = v_uid;
  if p_kind = 'CASHOUT' then
    v_txn_id := private.post_transfer('CASHOUT', v_payer.id, v_payee.id, p_amount, p_idempotency_key, p_note,
      jsonb_build_object('out_name', v_payee.agent_name, 'out_ref', v_payee.agent_code,
                         'in_name', 'Customer', 'in_ref', private.mask_phone(v_phone)));
  else
    v_txn_id := private.post_transfer('TRANSFER', v_payer.id, v_payee.id, p_amount, p_idempotency_key, p_note,
      jsonb_build_object(
        'out_name', (select coalesce(nullif(trim(split_part(coalesce(u.full_name, ''), ' ', 1)), ''), 'Shongrokhon user')
                       from public.users u where u.id = v_payee.user_id),
        'out_ref', (select private.mask_phone(u.phone) from public.users u where u.id = v_payee.user_id),
        'in_name', (select coalesce(nullif(trim(split_part(coalesce(u.full_name, ''), ' ', 1)), ''), 'Shongrokhon user')
                      from public.users u where u.id = v_uid),
        'in_ref', private.mask_phone(v_phone)));
    insert into public.notifications (user_id, kind, title, body, data)
    values (v_payee.user_id, 'TRANSFER_RECEIVED', 'Money received',
            'You received ৳' || to_char(p_amount, 'FM999,999,990.00') || ' from ' || private.mask_phone(v_phone) || '.',
            jsonb_build_object('transaction_id', v_txn_id, 'amount', p_amount, 'from', private.mask_phone(v_phone)));
  end if;
  update public.transactions set risk_score_id = v_score.id where id = v_txn_id;

  if v_fee > 0 then
    perform private.post_transfer('FEE', v_payer.id, v_fee_wallet, v_fee, private.fee_key(p_idempotency_key),
      case when p_kind = 'CASHOUT' then 'Cash-out fee' else 'Transfer fee' end,
      jsonb_build_object('out_name', case when p_kind = 'CASHOUT' then 'Cash-out fee' else 'Transfer fee' end,
                         'in_name', 'Fee'));
  end if;

  if v_score.decision = 'FLAG' then
    perform private.raise_flow_alert(v_score.id, v_txn_id);
  end if;
  return private.flow_result(v_txn_id, false);
end $$;

create or replace function public.make_cashout(
  p_agent_code text, p_amount numeric, p_pin text, p_idempotency_key uuid,
  p_score_id uuid default null, p_confirm boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_session();
  return private.make_flow('CASHOUT', p_agent_code, p_amount, p_pin, p_idempotency_key, null, p_score_id, p_confirm);
end $$;

create or replace function public.make_transfer(
  p_phone text, p_amount numeric, p_pin text, p_idempotency_key uuid, p_note text default null,
  p_score_id uuid default null, p_confirm boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_session();
  return private.make_flow('TRANSFER', p_phone, p_amount, p_pin, p_idempotency_key, p_note, p_score_id, p_confirm);
end $$;

-- Offline recovery (TC-P1-PAY-10) now covers every flow.
create or replace function public.get_payment_status(p_idempotency_key uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
  v_txn public.transactions;
begin
  select t.* into v_txn
    from public.transactions t
    join public.wallets w on w.id = t.payer_wallet_id
   where w.user_id = v_uid and w.kind = 'customer' and t.idempotency_key = p_idempotency_key;
  if v_txn.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_txn.type in ('CASHOUT', 'TRANSFER') then
    return private.flow_result(v_txn.id, true);
  end if;
  return private.payment_result(v_txn.id, true);
end $$;

--------------------------------------------------------------------------------
-- Lookups
--------------------------------------------------------------------------------
create or replace function public.lookup_agent(p_agent_code text)
returns table (agent_code text, agent_name text, is_active boolean, fee_rate numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_session();
  return query
    select w.agent_code, w.agent_name, w.status = 'active', (select c.cashout_fee_rate from public.app_config c where c.id)
      from public.wallets w
     where w.kind = 'agent' and w.agent_code = upper(trim(p_agent_code));
end $$;

-- Only a first name and a masked number: enough to confirm the recipient, no more.
create or replace function public.lookup_recipient(p_phone text)
returns table (display_name text, masked_phone text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  return query
    select coalesce(nullif(trim(split_part(coalesce(u.full_name, ''), ' ', 1)), ''), 'Shongrokhon user'),
           private.mask_phone(u.phone)
      from public.users u
      join public.wallets w on w.user_id = u.id and w.kind = 'customer'
     where u.phone = private.normalize_phone(p_phone) and u.id <> v_uid and w.status = 'active';
end $$;

create or replace function public.list_billers()
returns table (merchant_id text, merchant_name text, biller_category text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_session();
  return query
    select w.merchant_id, w.merchant_name, w.biller_category
      from public.wallets w
     where w.kind = 'merchant' and w.biller_category is not null and w.status = 'active'
     order by w.biller_category, w.merchant_name;
end $$;

--------------------------------------------------------------------------------
-- Grants
--------------------------------------------------------------------------------
revoke all on function
  private.check_pin(uuid, text),
  private.normalize_phone(text),
  private.fee_key(uuid),
  private.flow_target(text, text),
  private.rules_features(text, uuid, uuid, numeric, timestamptz),
  private.rules_risk(jsonb),
  private.flow_result(uuid, boolean),
  private.raise_flow_alert(uuid, uuid),
  private.make_flow(text, text, numeric, text, uuid, text, uuid, boolean)
  from public, anon, authenticated;

revoke all on function
  public.flow_score(uuid, text, text, numeric, uuid),
  public.make_cashout(text, numeric, text, uuid, uuid, boolean),
  public.make_transfer(text, numeric, text, uuid, text, uuid, boolean),
  public.get_payment_status(uuid),
  public.lookup_agent(text),
  public.lookup_recipient(text),
  public.list_billers()
  from public, anon, authenticated;

grant execute on function public.flow_score(uuid, text, text, numeric, uuid) to service_role;
grant execute on function
  public.make_cashout(text, numeric, text, uuid, uuid, boolean),
  public.make_transfer(text, numeric, text, uuid, text, uuid, boolean),
  public.get_payment_status(uuid),
  public.lookup_agent(text),
  public.lookup_recipient(text),
  public.list_billers()
  to authenticated;
