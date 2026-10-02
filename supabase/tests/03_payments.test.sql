-- TC-P1-PAY-01..08, PAY-11, PAY-12, AUTH-07, DB-07.
begin;
\ir _helpers.psql
select no_plan();

select pg_temp.mk_user('8801700000301', 5000) as u \gset
select pg_temp.mk_user('8801700000302', 100) as low \gset
select pg_temp.mk_merchant('8801700000303', 'MTEST0001', 'Test Grocery') as m \gset
select '6f1c1a52-0000-4000-8000-000000000001' as key1 \gset

--------------------------------------------------------------------------------
-- TC-P1-PAY-01: standard low-risk payment
--------------------------------------------------------------------------------
select pg_temp.as_user(:'u') \gset
select pg_temp.pay('MTEST0001', 500, '12345', :'key1', 'secret note') as r1 \gset
reset role;
select is((:'r1'::jsonb) ->> 'status', 'SUCCESS', 'PAY-01: status SUCCESS');
select is(((:'r1'::jsonb) ->> 'balance_after')::numeric, 4500.00, 'PAY-01: result reports balance ৳4,500');
select is(pg_temp.balance_of(:'u'), 4500.00::numeric, 'PAY-01: payer balance ৳4,500');
select is(pg_temp.balance_of(:'m', 'merchant'), 500.00::numeric, 'PAY-01: merchant balance +৳500');
select is((select count(*) from public.transactions where idempotency_key = :'key1'), 1::bigint, 'PAY-01: one transaction row');
select is((:'r1'::jsonb) ->> 'merchant_name', 'Test Grocery', 'PAY-01: receipt data includes merchant');

--------------------------------------------------------------------------------
-- TC-P1-PAY-02: double-entry ledger balanced
--------------------------------------------------------------------------------
select is((select count(*) from public.ledger_entries where transaction_id = ((:'r1'::jsonb) ->> 'transaction_id')::uuid),
  2::bigint, 'PAY-02: two ledger entries');
select is(
  (select sum(case when direction = 'DEBIT' then amount else -amount end) from public.ledger_entries
    where transaction_id = ((:'r1'::jsonb) ->> 'transaction_id')::uuid),
  0.00::numeric, 'PAY-02: debits equal credits for the transaction');
select is(
  (select sum(case when direction = 'DEBIT' then amount else -amount end) from public.ledger_entries),
  0.00::numeric, 'PAY-02: whole ledger balances');

--------------------------------------------------------------------------------
-- TC-P1-PAY-07: idempotency
--------------------------------------------------------------------------------
select pg_temp.as_user(:'u') \gset
select pg_temp.pay('MTEST0001', 500, '12345', :'key1') as r1b \gset
select pg_temp.pay('MTEST0001', 700, '12345', :'key1') as r1c \gset
select public.get_payment_status(:'key1') as s1 \gset
select public.get_payment_status(gen_random_uuid()) as s2 \gset
reset role;
select is((:'r1b'::jsonb) ->> 'transaction_id', (:'r1'::jsonb) ->> 'transaction_id', 'PAY-07: replay returns the original transaction');
select is((:'r1b'::jsonb) ->> 'replayed', 'true', 'PAY-07: replay is marked');
select is(pg_temp.balance_of(:'u'), 4500.00::numeric, 'PAY-07: exactly one debit');
select is((:'r1c'::jsonb) ->> 'code', 'IDEMPOTENCY_KEY_REUSED', 'PAY-07: same key with a different amount is rejected');
select is((:'s1'::jsonb) ->> 'status', 'SUCCESS', 'PAY-10: status lookup by idempotency key');
select is((:'s2'::jsonb) ->> 'status', 'NOT_FOUND', 'PAY-10: unknown key reports NOT_FOUND (safe to retry)');

--------------------------------------------------------------------------------
-- TC-P1-PAY-03: insufficient balance
--------------------------------------------------------------------------------
select pg_temp.as_user(:'low') \gset
select pg_temp.pay('MTEST0001', 500, '12345', gen_random_uuid()) as r3 \gset
reset role;
select is((:'r3'::jsonb) ->> 'code', 'INSUFFICIENT_FUNDS', 'PAY-03: rejected for insufficient funds');
select is(pg_temp.balance_of(:'low'), 100.00::numeric, 'PAY-03: balance unchanged');
select is((select count(*) from public.transactions where payer_wallet_id = pg_temp.wallet_of(:'low')), 0::bigint,
  'PAY-03: no transaction written');

--------------------------------------------------------------------------------
-- TC-P1-PAY-04 / PAY-05: wrong PIN and lockout
--------------------------------------------------------------------------------
select pg_temp.as_user(:'u') \gset
select pg_temp.pay('MTEST0001', 10, '00000', gen_random_uuid()) as p1 \gset
reset role;
select is((:'p1'::jsonb) ->> 'code', 'WRONG_PIN', 'PAY-04: wrong PIN rejected');
select is(((:'p1'::jsonb) ->> 'attempts_left')::int, 2, 'PAY-04: attempts_left reported');
select is((select pin_failed_attempts from public.users where id = :'u'), 1, 'PAY-04: attempt counter incremented');
select is(pg_temp.balance_of(:'u'), 4500.00::numeric, 'PAY-04: no ledger change');

select pg_temp.as_user(:'u') \gset
select pg_temp.pay('MTEST0001', 10, '00000', gen_random_uuid()) as p2 \gset
select pg_temp.pay('MTEST0001', 10, '00000', gen_random_uuid()) as p3 \gset
select pg_temp.pay('MTEST0001', 10, '12345', gen_random_uuid()) as p4 \gset
reset role;
select is((:'p3'::jsonb) ->> 'code', 'PIN_LOCKED', 'PAY-05: third wrong PIN locks payments');
select isnt((select pin_locked_until from public.users where id = :'u'), null, 'PAY-05: lock expiry stored');
select is((:'p4'::jsonb) ->> 'code', 'PIN_LOCKED', 'PAY-05: correct PIN still refused while locked');
select is(pg_temp.balance_of(:'u'), 4500.00::numeric, 'PAY-05: no ledger change while locked');

update public.users set pin_locked_until = now() - interval '1 minute' where id = :'u';
select pg_temp.as_user(:'u') \gset
select pg_temp.pay('MTEST0001', 10, '12345', gen_random_uuid()) as p5 \gset
reset role;
select is((:'p5'::jsonb) ->> 'status', 'SUCCESS', 'PAY-05: payments resume after the lock period');
select is((select pin_failed_attempts from public.users where id = :'u'), 0, 'PAY-05: counter reset after success');

--------------------------------------------------------------------------------
-- TC-P1-PAY-06: amount validation
--------------------------------------------------------------------------------
select pg_temp.as_user(:'u') \gset
select pg_temp.pay('MTEST0001', 0, '12345', gen_random_uuid()) as a0 \gset
select pg_temp.pay('MTEST0001', -5, '12345', gen_random_uuid()) as a1 \gset
select pg_temp.pay('MTEST0001', 10.123, '12345', gen_random_uuid()) as a2 \gset
select pg_temp.pay('MTEST0001', 25000.01, '12345', gen_random_uuid()) as a3 \gset
reset role;
select is((:'a0'::jsonb) ->> 'code', 'INVALID_AMOUNT', 'PAY-06: zero rejected');
select is((:'a1'::jsonb) ->> 'code', 'INVALID_AMOUNT', 'PAY-06: negative rejected');
select is((:'a2'::jsonb) ->> 'code', 'AMOUNT_TOO_PRECISE', 'PAY-06: more than 2 decimals rejected');
select is((:'a3'::jsonb) ->> 'code', 'AMOUNT_ABOVE_LIMIT', 'PAY-06: above per-transaction limit rejected');

--------------------------------------------------------------------------------
-- TC-P1-PAY-11: self-payment; unknown merchant
--------------------------------------------------------------------------------
select public.admin_credit_wallet(pg_temp.wallet_of(:'m'), 100) \gset
select pg_temp.as_user(:'m') \gset
select pg_temp.pay('MTEST0001', 10, '12345', gen_random_uuid()) as self \gset
select pg_temp.pay('NOPE9999', 10, '12345', gen_random_uuid()) as nomerchant \gset
reset role;
select is((:'self'::jsonb) ->> 'code', 'SELF_PAYMENT', 'PAY-11: paying your own merchant QR is blocked');
select is((:'nomerchant'::jsonb) ->> 'code', 'MERCHANT_NOT_FOUND', 'Unknown merchant is rejected');

--------------------------------------------------------------------------------
-- TC-P1-PAY-08: atomicity — fail after the debit, before the credit
--------------------------------------------------------------------------------
create function pg_temp.fail_credit() returns trigger language plpgsql as $$
begin
  if new.direction = 'CREDIT' then raise exception 'injected failure'; end if;
  return new;
end $$;
create trigger zz_fail_credit before insert on public.ledger_entries
  for each row execute function pg_temp.fail_credit();

select pg_temp.as_user(:'u') \gset
select throws_ok($$select pg_temp.pay('MTEST0001', 100, '12345', '6f1c1a52-0000-4000-8000-000000000008')$$,
  'P0001', 'injected failure', 'PAY-08: injected DB error surfaces');
reset role;
drop trigger zz_fail_credit on public.ledger_entries;
select is(pg_temp.balance_of(:'u'), 4490.00::numeric, 'PAY-08: payer debit rolled back');
select is((select count(*) from public.transactions where idempotency_key = '6f1c1a52-0000-4000-8000-000000000008'),
  0::bigint, 'PAY-08: no transaction row left behind');
select is((select sum(case when direction = 'DEBIT' then amount else -amount end) from public.ledger_entries),
  0.00::numeric, 'PAY-08: ledger still balanced (no partial entries)');

--------------------------------------------------------------------------------
-- TC-P1-DB-07: sensitive fields encrypted at rest, readable by the owner
--------------------------------------------------------------------------------
select is(position('secret note' in encode(note_enc, 'escape')), 0, 'DB-07: note stored as ciphertext')
  from public.transactions where idempotency_key = :'key1';
select is(position('Test Grocery' in encode(counterparty_enc, 'escape')), 0, 'DB-07: counterparty stored as ciphertext')
  from public.transactions where idempotency_key = :'key1';
select pg_temp.as_user(:'u') \gset
select note as owner_note, counterparty_name as owner_cp from public.get_my_transactions(p_id => ((:'r1'::jsonb) ->> 'transaction_id')::uuid) \gset
reset role;
select is(:'owner_note'::text, 'secret note', 'DB-07: owner can read decrypted note');
select is(:'owner_cp'::text, 'Test Grocery', 'DB-07: owner sees merchant name');

--------------------------------------------------------------------------------
-- TC-P1-PAY-12: history is newest first
--------------------------------------------------------------------------------
update public.transactions set created_at = now() - interval '2 days'
 where type = 'TOPUP' and payee_wallet_id = pg_temp.wallet_of(:'u');
update public.transactions set created_at = now() - interval '1 day'
 where idempotency_key = :'key1';
select pg_temp.as_user(:'u') \gset
select array_agg(direction || ':' || amount::text) as hist from public.get_my_transactions() \gset
reset role;
select is(:'hist'::text, '{OUT:10.00,OUT:500.00,IN:5000.00}', 'PAY-12: history ordered newest first');

--------------------------------------------------------------------------------
-- TC-P1-AUTH-07: PIN setup rules and hashing
--------------------------------------------------------------------------------
select pg_temp.mk_user('8801700000304', 0, null) as np \gset
select pg_temp.as_user(:'np') \gset
select throws_ok($$select public.set_pin('12')$$, '22023', 'INVALID_PIN_FORMAT', 'AUTH-07: too-short PIN rejected');
select throws_ok($$select public.set_pin('12ab5')$$, '22023', 'INVALID_PIN_FORMAT', 'AUTH-07: non-digit PIN rejected');
select lives_ok($$select public.set_pin('2468')$$, 'AUTH-07: 4-digit PIN accepted');
select throws_ok($$select public.set_pin('1357')$$, '22023', 'PIN_ALREADY_SET', 'AUTH-07: PIN cannot be silently overwritten');
reset role;
select isnt((select pin_hash from public.users where id = :'np'), '2468', 'AUTH-07: PIN not stored in plain text');
select matches((select pin_hash from public.users where id = :'np'), '^\$2[aby]\$', 'AUTH-07: PIN stored as bcrypt hash');
select is((select extensions.crypt('2468', pin_hash) = pin_hash from public.users where id = :'np'), true,
  'AUTH-07: hash verifies the original PIN');

select * from finish();
rollback;
