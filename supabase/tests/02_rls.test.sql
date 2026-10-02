-- TC-P1-DB-05, DB-06, AUTH-07 (hash never readable), service-only functions.
begin;
\ir _helpers.psql
select no_plan();

select pg_temp.mk_user('8801700000201', 1000) as a \gset
select pg_temp.mk_user('8801700000202', 1000) as b \gset
select pg_temp.mk_merchant('8801700000203', 'MRLS0001', 'RLS Shop') as m \gset

-- Give B some history.
select pg_temp.as_user(:'b') \gset
select public.make_payment('MRLS0001', 100, '12345', gen_random_uuid()) as b_pay \gset
reset role;
select is((:'b_pay'::jsonb) ->> 'status', 'SUCCESS', 'setup: B paid the merchant');

-- TC-P1-DB-05: A sees only A's data.
select pg_temp.as_user(:'a') \gset
select is((select count(*) from public.transactions t
            where t.payer_wallet_id in (select id from public.wallets where user_id = :'b')), 0::bigint,
  'DB-05: A cannot see B''s transactions');
select is((select count(*) from public.wallets where user_id = :'b'), 0::bigint, 'DB-05: A cannot see B''s wallet');
select is((select count(*) from public.users where id <> :'a'), 0::bigint, 'DB-05: A sees only their own profile');
select is((select count(*) from public.ledger_entries), 1::bigint, 'DB-05: A sees only their own ledger entry (opening credit)');
select is((select count(*) from public.get_my_transactions()), 1::bigint, 'DB-05: A''s history RPC returns only A''s rows');

-- TC-P1-DB-06: no direct writes from the client, even to your own wallet.
select throws_ok(format('update public.wallets set balance = 999999 where user_id = %L', :'a'),
  '42501', null, 'DB-06: client cannot update own wallet balance');
select throws_ok(format($q$insert into public.wallets (user_id, kind) values (%L, 'merchant')$q$, :'a'),
  '42501', null, 'DB-06: client cannot create wallets');
select throws_ok(format($q$insert into public.transactions (status, payer_wallet_id, payee_wallet_id, amount, idempotency_key)
                          select 'SUCCESS', a.id, b.id, 1, gen_random_uuid() from public.wallets a, public.wallets b
                          where a.user_id = %L and b.id <> a.id limit 1$q$, :'a'),
  '42501', null, 'DB-06: client cannot insert transactions');
select throws_ok('delete from public.ledger_entries', '42501', null, 'DB-06: client cannot delete ledger rows');
select throws_ok(format('update public.users set pin_failed_attempts = 0 where id = %L', :'a'),
  '42501', null, 'DB-06: client cannot update own profile security fields');

-- TC-P1-AUTH-07: the PIN hash is never readable by the client.
select throws_ok('select pin_hash from public.users', '42501', null, 'AUTH-07: pin_hash column not readable by client');

-- Service-only functions are not callable by users.
select throws_ok(format('select public.admin_credit_wallet(%L, 100)', pg_temp.wallet_of(:'a')),
  '42501', null, 'Client cannot call admin_credit_wallet');
select throws_ok($$select public.otp_record_success('8801700000201')$$,
  '42501', null, 'Client cannot call OTP tracking functions');
select throws_ok($$select private.decrypt_field('x'::bytea)$$, '42501', null, 'Client cannot call private helpers');
reset role;

-- Anonymous callers get nothing.
select pg_temp.as_anon() \gset
select throws_ok('select * from public.wallets', '42501', null, 'DB-05: anon cannot read wallets');
select throws_ok($$select public.make_payment('MRLS0001', 1, '12345', gen_random_uuid())$$,
  '42501', null, 'DB-05: anon cannot call make_payment');
reset role;

-- TC-P1-AUTH-10 (DB side): a JWT whose session no longer exists is rejected with PT401.
select pg_temp.as_user(:'a', gen_random_uuid()) \gset
select throws_ok('select public.get_my_profile()', 'PT401', 'SESSION_REVOKED', 'AUTH-10: revoked session is rejected');
reset role;

select * from finish();
rollback;
