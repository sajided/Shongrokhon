-- Phase 4 release pieces: analytics (TC-MET-04/05), account deletion
-- (TC-P4-SEC-05), ledger reconciliation (TC-P4-PERF-03).
begin;
\ir _helpers.psql
select no_plan();

select pg_temp.mk_user('8801700001001', 1000) as u \gset
select pg_temp.mk_user('8801700001002', 0) as gone \gset
select pg_temp.mk_merchant('8801700001011', 'MREL0001', 'Release Shop') as m \gset
update public.users set full_name = 'Rahima Begum' where id = :'gone';

--------------------------------------------------------------------------------
-- MET-04/05: analytics events
--------------------------------------------------------------------------------
select pg_temp.as_user(:'u') \gset
select public.log_event('screen_view', '{"screen":"coach"}') as first \gset
select public.log_event('screen_view', '{"screen":"coach"}') as again \gset
select public.log_event('screen_view', '{"screen":"savings"}') as other \gset
select throws_ok($$select public.log_event('screen_view', '{"screen":"01711000001"}')$$, '22023', 'EVENT_NOT_ALLOWED',
  'MET-05: a phone number cannot be sent as a property');
select throws_ok($$select public.log_event('screen_view', '{"screen":"coach","phone":"x"}')$$, '22023', 'EVENT_NOT_ALLOWED',
  'MET-05: unknown property keys are rejected');
select throws_ok($$select public.log_event('ask_coach', '{"topic":"how do I save money"}')$$, '22023', 'EVENT_NOT_ALLOWED',
  'MET-05: free text values are rejected');
select throws_ok($$select public.log_event('anything', '{}')$$, '22023', 'EVENT_NOT_ALLOWED', 'MET-05: unknown events are rejected');
select throws_ok($$select count(*) from public.analytics_events$$, '42501', null, 'Events are not readable by clients');
reset role;
select is(:'first'::boolean, true, 'MET-04: a visit is recorded');
select is(:'again'::boolean, false, 'MET-04: the same visit within 30 s is not counted twice');
select is(:'other'::boolean, true, 'MET-04: another screen is its own visit');
select is((select count(*) from public.analytics_events where user_ref = private.user_ref(:'u')), 2::bigint,
  'MET-04: raw events match the visits');
select ok(not exists (select 1 from public.analytics_events where user_ref = :'u'::text or props::text like '%8801700001001%'),
  'MET-05: events hold no user id or phone number');
select is((select users from private.metrics_daily_active where screen = 'coach'
            and day = (now() at time zone 'Asia/Dhaka')::date),
          (select count(distinct user_ref) from public.analytics_events where event = 'screen_view' and props ->> 'screen' = 'coach'
            and (created_at at time zone 'Asia/Dhaka')::date = (now() at time zone 'Asia/Dhaka')::date),
          'MET-04: DAU view matches raw events');

--------------------------------------------------------------------------------
-- SEC-05: account deletion
--------------------------------------------------------------------------------
select pg_temp.as_user(:'u') \gset
select public.delete_my_account('12345') as not_zero \gset
select public.delete_my_account('99999') as wrong_pin \gset
reset role;
select is(:'not_zero'::jsonb ->> 'code', 'BALANCE_NOT_ZERO', 'SEC-05: the balance must be zero first');
select is(:'wrong_pin'::jsonb ->> 'code', 'WRONG_PIN', 'SEC-05: the PIN is required');

-- A user with history and a zero balance.
select private.post_transfer('TOPUP', '00000000-0000-0000-0000-00000000a001', pg_temp.wallet_of(:'gone'), 500,
                             gen_random_uuid(), null, '{"out_name":"x","in_name":"y"}') as topup \gset
select private.post_transfer('PAYMENT', pg_temp.wallet_of(:'gone'), pg_temp.wallet_of(:'m', 'merchant'), 500,
                             gen_random_uuid(), 'secret note', '{"out_name":"x","in_name":"y"}') as paid \gset
select pg_temp.as_user(:'gone') \gset
select public.log_event('screen_view', '{"screen":"home"}');
select public.create_savings_goal('Eid', 1000, 2);
select public.delete_my_account('12345') as deleted \gset
reset role;
select is(:'deleted'::jsonb ->> 'status', 'DELETED', 'SEC-05: account deleted');
select is((select phone from public.users where id = :'gone'), 'deleted:' || :'gone', 'SEC-05: phone number removed');
select is((select full_name from public.users where id = :'gone'), null, 'SEC-05: name removed');
select is((select pin_hash from public.users where id = :'gone'), null, 'SEC-05: PIN removed');
select is((select count(*) from public.savings_goals where user_id = :'gone'), 0::bigint, 'SEC-05: goals removed');
select is((select count(*) from public.analytics_events where user_ref = private.user_ref(:'gone')), 0::bigint,
  'SEC-05: analytics removed');
select is((select count(*) from auth.sessions where user_id = :'gone'), 0::bigint, 'SEC-05: signed out everywhere');
select ok((select banned_until > now() from auth.users where id = :'gone'), 'SEC-05: cannot sign in again');
select is((select status from public.wallets where user_id = :'gone'), 'frozen', 'SEC-05: wallet frozen');
select is((select count(*) from public.transactions where id in (:'topup', :'paid')), 2::bigint,
  'SEC-05: transactions are retained (regulation)');
select is((select count(*) from public.ledger_entries where transaction_id in (:'topup', :'paid')), 4::bigint,
  'SEC-05: ledger entries are retained');
select throws_ok($$select public.get_my_profile()$$, 'PT401', null, 'SEC-05: the old session no longer works')
  from (select pg_temp.as_user(:'gone')) x;
reset role;

--------------------------------------------------------------------------------
-- PERF-03: reconciliation
--------------------------------------------------------------------------------
select public.reconcile_ledger() as rec \gset
select is((:'rec'::jsonb ->> 'mismatched_wallets')::int, 0, 'PERF-03: every balance equals its ledger');
select is((:'rec'::jsonb ->> 'ledger_imbalance')::numeric, 0::numeric, 'PERF-03: the ledger balances');
select is((:'rec'::jsonb ->> 'unpaired_transactions')::int, 0, 'PERF-03: every transaction has a debit and a credit');

-- It notices a discrepancy (forced here by bypassing the payment functions).
alter table public.wallets disable trigger user;
update public.wallets set balance = balance + 1 where id = pg_temp.wallet_of(:'m', 'merchant');
select is((public.reconcile_ledger() ->> 'mismatched_wallets')::int, 1, 'PERF-03: a broken balance is reported');

--------------------------------------------------------------------------------
-- INV-01 / SEC-03: staff accounts need a service-role invite
--------------------------------------------------------------------------------
select throws_ok($$insert into auth.users (id, email) values (gen_random_uuid(), 'nobody@example.com')$$,
  '42501', 'EMAIL_SIGNUP_DISABLED', 'An uninvited email account is refused');
select public.admin_invite_staff('New.Analyst@Example.com');
select lives_ok($$insert into auth.users (id, email) values (gen_random_uuid(), 'new.analyst@example.com')$$,
  'An invited email account is created');
select is((select count(*) from private.staff_invites where email = 'new.analyst@example.com'), 0::bigint,
  'The invite is used up');
select throws_ok($$insert into auth.users (id, email) values (gen_random_uuid(), 'new.analyst2@example.com')$$,
  '42501', 'EMAIL_SIGNUP_DISABLED', 'An invite only admits its own email');
insert into private.staff_invites (email, created_at) values ('late@example.com', now() - interval '2 hours');
select throws_ok($$insert into auth.users (id, email) values (gen_random_uuid(), 'late@example.com')$$,
  '42501', 'EMAIL_SIGNUP_DISABLED', 'An expired invite is refused');
select throws_ok($$select public.admin_invite_staff('not-an-email')$$, '22023', 'INVALID_EMAIL', 'A malformed email is refused');
select pg_temp.as_user(:'u') \gset
select throws_ok($$select public.admin_invite_staff('me@example.com')$$, '42501', null, 'Customers cannot invite staff');
reset role;

--------------------------------------------------------------------------------
-- Email sign-in (app_config.email_sign_in): customers without an SMS provider
--------------------------------------------------------------------------------
update public.app_config set email_sign_in = true;
select lives_ok($$insert into auth.users (id, email) values ('77777777-0000-0000-0000-000000000001', 'Rahim@Example.com')$$,
  'With email sign-in on, an email account is created');
select is((select phone from public.users where id = '77777777-0000-0000-0000-000000000001'), 'rahim@example.com',
  'The lowercased email is the sign-in identifier');
select is((select count(*) from public.wallets where user_id = '77777777-0000-0000-0000-000000000001' and kind = 'customer'),
  1::bigint, 'An email customer gets a wallet');
select is((select count(*) from public.staff where user_id = '77777777-0000-0000-0000-000000000001'), 0::bigint,
  'An email customer is not staff');
select public.admin_invite_staff('staffer@example.com');
insert into auth.users (id, email) values ('77777777-0000-0000-0000-000000000002', 'staffer@example.com');
select is((select count(*) from public.wallets where user_id = '77777777-0000-0000-0000-000000000002'), 0::bigint,
  'An invited staff email still gets no wallet');
select is(private.normalize_phone(' Rahim@EXAMPLE.com '), 'rahim@example.com', 'An email recipient is normalised');
select is(private.normalize_phone('rahim@nodot'), null, 'A malformed email recipient is rejected');
select is(private.normalize_phone('01712345678'), '+8801712345678', 'Phone recipients are unchanged');
select is(private.mask_phone('rahim@example.com'), 'r***@example.com', 'An email is masked');
select is(private.mask_phone('+8801712345678'), '**********5678', 'A phone number is masked as before');
select pg_temp.as_user(:'u') \gset
select is((select masked_phone from public.lookup_recipient('RAHIM@example.com')), 'r***@example.com',
  'Send money finds an email customer');
reset role;
update public.app_config set email_sign_in = false;
select throws_ok($$insert into auth.users (id, email) values (gen_random_uuid(), 'later@example.com')$$,
  '42501', 'EMAIL_SIGNUP_DISABLED', 'With email sign-in off, an uninvited email account is refused');

select * from finish();
rollback;
