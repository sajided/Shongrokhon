-- Server-side payment flow, PIN handling, and OTP attempt tracking.
-- Clients reach money movement only through these SECURITY DEFINER functions.

--------------------------------------------------------------------------------
-- Session guard (TC-P1-AUTH-10): a JWT whose session was revoked is rejected
-- with HTTP 401 (PostgREST maps SQLSTATE PT401 to status 401).
--------------------------------------------------------------------------------
create or replace function private.require_session() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  if v_sid is null or not exists (select 1 from auth.sessions s where s.id = v_sid and s.user_id = v_uid) then
    raise exception 'SESSION_REVOKED' using errcode = 'PT401';
  end if;
  return v_uid;
end $$;

--------------------------------------------------------------------------------
-- Internal helpers
--------------------------------------------------------------------------------
create or replace function private.payment_failure(p_code text, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('status', 'FAILED', 'code', p_code) || coalesce(p_extra, '{}'::jsonb);
$$;

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
    'replayed', p_replayed
  )
  from public.transactions t
  join public.wallets payee on payee.id = t.payee_wallet_id
  left join public.ledger_entries debit
    on debit.transaction_id = t.id and debit.wallet_id = t.payer_wallet_id and debit.direction = 'DEBIT'
  where t.id = p_txn_id;
$$;

-- Moves money between two wallets that the caller has already locked and validated.
-- Writes one transaction row and a balanced DEBIT/CREDIT pair (TC-P1-PAY-02).
create or replace function private.post_transfer(
  p_type public.txn_type,
  p_payer_wallet_id uuid,
  p_payee_wallet_id uuid,
  p_amount numeric,
  p_idempotency_key uuid,
  p_note text,
  p_counterparty jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_txn_id uuid;
  v_payer_balance numeric;
  v_payee_balance numeric;
begin
  insert into public.transactions (type, status, payer_wallet_id, payee_wallet_id, amount, idempotency_key, note_enc, counterparty_enc)
  values (p_type, 'SUCCESS', p_payer_wallet_id, p_payee_wallet_id, p_amount, p_idempotency_key,
          private.encrypt_field(nullif(trim(p_note), '')), private.encrypt_field(p_counterparty::text))
  returning id into v_txn_id;

  update public.wallets set balance = balance - p_amount where id = p_payer_wallet_id
  returning balance into v_payer_balance;
  insert into public.ledger_entries (transaction_id, wallet_id, direction, amount, balance_after)
  values (v_txn_id, p_payer_wallet_id, 'DEBIT', p_amount, v_payer_balance);

  update public.wallets set balance = balance + p_amount where id = p_payee_wallet_id
  returning balance into v_payee_balance;
  insert into public.ledger_entries (transaction_id, wallet_id, direction, amount, balance_after)
  values (v_txn_id, p_payee_wallet_id, 'CREDIT', p_amount, v_payee_balance);

  return v_txn_id;
end $$;

create or replace function private.mask_phone(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case when p_phone is null then null else repeat('*', greatest(length(p_phone) - 4, 0)) || right(p_phone, 4) end;
$$;

--------------------------------------------------------------------------------
-- Profile, merchant lookup, PIN
--------------------------------------------------------------------------------
create or replace function public.get_my_profile() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  return (
    select jsonb_build_object(
      'user_id', u.id,
      'phone', u.phone,
      'full_name', u.full_name,
      'role', u.role,
      'has_pin', u.pin_hash is not null,
      'pin_locked_until', u.pin_locked_until,
      'wallet_id', w.id,
      'balance', w.balance,
      'currency', w.currency
    )
    from public.users u
    join public.wallets w on w.user_id = u.id and w.kind = 'customer'
    where u.id = v_uid
  );
end $$;

create or replace function public.lookup_merchant(p_merchant_id text)
returns table (merchant_id text, merchant_name text, is_active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_session();
  return query
    select w.merchant_id, w.merchant_name, w.status = 'active'
    from public.wallets w
    where w.kind = 'merchant' and w.merchant_id = trim(p_merchant_id);
end $$;

-- TC-P1-AUTH-07: PIN is stored as a bcrypt hash; it can only be set once here.
create or replace function public.set_pin(p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,5}$' then
    raise exception 'INVALID_PIN_FORMAT' using errcode = '22023';
  end if;
  update public.users
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)),
         pin_failed_attempts = 0,
         pin_locked_until = null
   where id = v_uid and pin_hash is null;
  if not found then
    raise exception 'PIN_ALREADY_SET' using errcode = '22023';
  end if;
end $$;

--------------------------------------------------------------------------------
-- Payment
--------------------------------------------------------------------------------
create or replace function public.make_payment(
  p_merchant_id text,
  p_amount numeric,
  p_pin text,
  p_idempotency_key uuid,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
  v_cfg public.app_config;
  v_user public.users;
  v_payer public.wallets;
  v_payee public.wallets;
  v_existing public.transactions;
  v_balance numeric;
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
  perform 1 from public.wallets where id in (v_payer.id, v_payee.id) order by id for update;

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

  v_txn_id := private.post_transfer(
    'PAYMENT', v_payer.id, v_payee.id, p_amount, p_idempotency_key, p_note,
    jsonb_build_object(
      'out_name', v_payee.merchant_name,
      'out_ref', v_payee.merchant_id,
      'in_name', 'Customer',
      'in_ref', private.mask_phone(v_user.phone)
    )
  );
  return private.payment_result(v_txn_id, false);
end $$;

-- TC-P1-PAY-10: lets the app learn the final outcome after a network drop.
create or replace function public.get_payment_status(p_idempotency_key uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
  v_txn_id uuid;
begin
  select t.id into v_txn_id
    from public.transactions t
    join public.wallets w on w.id = t.payer_wallet_id
   where w.user_id = v_uid and w.kind = 'customer' and t.idempotency_key = p_idempotency_key;
  if v_txn_id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  return private.payment_result(v_txn_id, true);
end $$;

-- TC-P1-PAY-12/13: history and receipt, decrypting fields for the owner only.
-- Dropped first so re-applying this file over migration 7 (which adds a column) works.
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
  created_at timestamptz
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
           r.created_at
      from rows r
     order by r.created_at desc, r.id desc;
end $$;

--------------------------------------------------------------------------------
-- Service-role only: wallet top-up (seed data, tests, future cash-in).
--------------------------------------------------------------------------------
create or replace function public.admin_credit_wallet(p_wallet_id uuid, p_amount numeric, p_note text default 'Top-up')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_system uuid := '00000000-0000-0000-0000-00000000a001';
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  perform 1 from public.wallets where id in (v_system, p_wallet_id) order by id for update;
  return private.post_transfer(
    'TOPUP', v_system, p_wallet_id, p_amount, gen_random_uuid(), p_note,
    jsonb_build_object('out_name', 'Customer top-up', 'in_name', 'Wallet top-up')
  );
end $$;

--------------------------------------------------------------------------------
-- Service-role only: OTP attempt tracking used by the `otp` Edge Function
-- (TC-P1-AUTH-03/04/05).
--------------------------------------------------------------------------------
create or replace function public.otp_before_send(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.otp_attempts;
begin
  insert into public.otp_attempts (phone) values (p_phone) on conflict (phone) do nothing;
  select * into v_row from public.otp_attempts where phone = p_phone for update;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('allowed', false, 'code', 'OTP_LOCKED', 'locked_until', v_row.locked_until);
  end if;
  update public.otp_attempts
     set last_sent_at = now(),
         failed_count = case when v_row.locked_until is not null then 0 else failed_count end,
         locked_until = null
   where phone = p_phone;
  return jsonb_build_object('allowed', true);
end $$;

create or replace function public.otp_before_verify(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.otp_attempts;
  v_cfg public.app_config;
begin
  select * into v_cfg from public.app_config where id;
  select * into v_row from public.otp_attempts where phone = p_phone;
  if not found or v_row.last_sent_at is null then
    return jsonb_build_object('state', 'NO_OTP');
  end if;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('state', 'LOCKED', 'locked_until', v_row.locked_until);
  end if;
  if v_row.last_sent_at + make_interval(secs => v_cfg.otp_expiry_seconds) < now() then
    return jsonb_build_object('state', 'EXPIRED');
  end if;
  return jsonb_build_object('state', 'OK');
end $$;

create or replace function public.otp_record_failure(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.app_config;
  v_row public.otp_attempts;
begin
  select * into v_cfg from public.app_config where id;
  update public.otp_attempts set failed_count = failed_count + 1 where phone = p_phone returning * into v_row;
  if v_row.failed_count >= v_cfg.otp_max_attempts then
    update public.otp_attempts
       set locked_until = now() + make_interval(mins => v_cfg.otp_lock_minutes)
     where phone = p_phone
    returning * into v_row;
  end if;
  return jsonb_build_object(
    'attempts_left', greatest(v_cfg.otp_max_attempts - v_row.failed_count, 0),
    'locked_until', v_row.locked_until
  );
end $$;

create or replace function public.otp_record_success(p_phone text) returns void
language sql security definer set search_path = '' as $$
  delete from public.otp_attempts where phone = p_phone;
$$;

--------------------------------------------------------------------------------
-- Grants
--------------------------------------------------------------------------------
revoke all on function
  public.get_my_profile(), public.lookup_merchant(text), public.set_pin(text),
  public.make_payment(text, numeric, text, uuid, text), public.get_payment_status(uuid),
  public.get_my_transactions(int, timestamptz, uuid),
  public.admin_credit_wallet(uuid, numeric, text),
  public.otp_before_send(text), public.otp_before_verify(text),
  public.otp_record_failure(text), public.otp_record_success(text)
  from public, anon, authenticated;

grant execute on function
  public.get_my_profile(), public.lookup_merchant(text), public.set_pin(text),
  public.make_payment(text, numeric, text, uuid, text), public.get_payment_status(uuid),
  public.get_my_transactions(int, timestamptz, uuid)
  to authenticated;

grant execute on function
  public.admin_credit_wallet(uuid, numeric, text),
  public.otp_before_send(text), public.otp_before_verify(text),
  public.otp_record_failure(text), public.otp_record_success(text)
  to service_role;
