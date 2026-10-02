-- TC-P1-DB-01, DB-03, DB-04, DB-08, AUTH-01 (DB side), ledger append-only.
begin;
\ir _helpers.psql
select no_plan();

-- TC-P1-DB-01: tables, keys, indexes
select has_table('public', t, 'DB-01: table ' || t || ' exists')
  from unnest(array['users', 'wallets', 'transactions', 'ledger_entries', 'app_config', 'otp_attempts']) t;
select col_is_pk('public', 'users', 'id', 'DB-01: users.id is PK');
select col_is_pk('public', 'wallets', 'id', 'DB-01: wallets.id is PK');
select col_is_pk('public', 'transactions', 'id', 'DB-01: transactions.id is PK');
select fk_ok('public', 'users', 'id', 'auth', 'users', 'id', 'DB-01: users -> auth.users');
select fk_ok('public', 'wallets', 'user_id', 'public', 'users', 'id', 'DB-01: wallets -> users');
select fk_ok('public', 'transactions', 'payer_wallet_id', 'public', 'wallets', 'id', 'DB-01: transactions payer -> wallets');
select fk_ok('public', 'transactions', 'payee_wallet_id', 'public', 'wallets', 'id', 'DB-01: transactions payee -> wallets');
select fk_ok('public', 'ledger_entries', 'transaction_id', 'public', 'transactions', 'id', 'DB-01: ledger -> transactions');
select col_type_is('public', 'wallets', 'balance', 'numeric(14,2)', 'DB-01: balance is numeric(14,2)');
select col_type_is('public', 'transactions', 'amount', 'numeric(14,2)', 'DB-01: amount is numeric(14,2)');
select col_is_unique('public', 'users', 'phone', 'DB-01: phone is unique');
select has_index('public', 'transactions', 'transactions_payer_created_idx', 'DB-01: payer history index');
select has_index('public', 'transactions', 'transactions_payee_created_idx', 'DB-01: payee history index');
select has_column('public', 'transactions', 'idempotency_key', 'DB-01: idempotency_key column');

-- TC-P1-AUTH-01 (DB side): a new auth user gets a profile and a zero-balance wallet.
select pg_temp.mk_user('8801700000101', 0, null) as u1 \gset
select is((select phone from public.users where id = :'u1'), '+8801700000101', 'AUTH-01: profile row created with +phone');
select is(pg_temp.balance_of(:'u1'), 0.00::numeric, 'AUTH-01: customer wallet created with balance 0');

-- TC-P1-DB-03: balance can never go negative
select throws_ok(
  format('update public.wallets set balance = -1 where id = %L', pg_temp.wallet_of(:'u1')),
  '23514', null, 'DB-03: negative balance rejected by CHECK constraint');

-- TC-P1-DB-04: FK on wallet ids
select throws_ok(
  format($q$insert into public.transactions (status, payer_wallet_id, payee_wallet_id, amount, idempotency_key)
            values ('SUCCESS', %L, gen_random_uuid(), 10, gen_random_uuid())$q$, pg_temp.wallet_of(:'u1')),
  '23503', null, 'DB-04: transaction with non-existent wallet rejected by FK');

-- TC-P1-DB-08: timestamps are timestamptz and maintained automatically
select col_type_is('public', 'transactions', 'created_at', 'timestamp with time zone', 'DB-08: created_at is timestamptz (UTC)');
select col_type_is('public', 'transactions', 'updated_at', 'timestamp with time zone', 'DB-08: updated_at is timestamptz (UTC)');
select pg_temp.mk_user('8801700000102', 50, null) as u2 \gset
select isnt((select t.created_at from public.transactions t join public.wallets w on w.id = t.payee_wallet_id
              where w.user_id = :'u2' limit 1), null, 'DB-08: created_at set on insert');
update public.transactions set updated_at = '2000-01-01T00:00:00Z'
 where payee_wallet_id = pg_temp.wallet_of(:'u2');
update public.transactions set status = 'SUCCESS' where payee_wallet_id = pg_temp.wallet_of(:'u2');
select is((select updated_at from public.transactions where payee_wallet_id = pg_temp.wallet_of(:'u2')), now(),
  'DB-08: updated_at refreshed on update');

-- Ledger is append-only, even for the table owner.
select throws_ok(
  format('delete from public.ledger_entries where wallet_id = %L', pg_temp.wallet_of(:'u2')),
  '42501', null, 'Ledger entries cannot be deleted');
select throws_ok(
  format('update public.ledger_entries set amount = 1 where wallet_id = %L', pg_temp.wallet_of(:'u2')),
  '42501', null, 'Ledger entries cannot be updated');

select * from finish();
rollback;
