-- Phase 4 Smart Spending Companion and preferences: TC-P4-SSC-01/02/06/07/09.
begin;
\ir _helpers.psql
select no_plan();

select pg_temp.mk_user('8801700000801', 50000) as heavy \gset
select pg_temp.mk_user('8801700000802', 5000) as normal \gset
select pg_temp.mk_agent('8801700000811', 'AGT0801', 'Test Agent') as a \gset

-- Four earlier cash-outs in the last 30 days (backdated: now() is frozen in the test).
select count(private.post_transfer('CASHOUT', pg_temp.wallet_of(:'heavy'), pg_temp.wallet_of(:'a', 'agent'), 500,
                                   gen_random_uuid(), null, '{"out_name":"x","in_name":"y"}'))
  from generate_series(1, 4);
update public.transactions set created_at = now() - interval '2 days' where payer_wallet_id = pg_temp.wallet_of(:'heavy');

select pg_temp.as_user(:'heavy') \gset
select public.cashout_nudge(2000) as n1 \gset
select public.cashout_nudge(1000) as n2 \gset
select public.cashout_nudge(1000) as n3 \gset
reset role;
select is((:'n1'::jsonb ->> 'show')::boolean, true, 'SSC-01: the 5th cash-out in 30 days is intercepted');
select is((:'n1'::jsonb ->> 'nth')::int, 5, 'SSC-03: the screen says which cash-out this is');
select is((:'n1'::jsonb ->> 'fee')::numeric, 37.00, 'SSC-03: the fee the user would save');
select is(:'n1'::jsonb -> 'alternatives', '["PAY_QR", "BILL_PAY", "SEND_MONEY"]'::jsonb, 'SSC-03: digital alternatives');
select is((:'n2'::jsonb ->> 'show')::boolean, true, 'Second interception today is still shown');
select is(:'n3'::jsonb ->> 'reason', 'CAPPED', 'SSC-06: at most nudge_max_per_day (2) interceptions a day');

-- SSC-07: choices are logged once per nudge.
select pg_temp.as_user(:'heavy') \gset
select public.log_nudge_choice((:'n1'::jsonb ->> 'nudge_id')::uuid, 'BILL_PAY');
select public.log_nudge_choice((:'n1'::jsonb ->> 'nudge_id')::uuid, 'CONTINUE');
select throws_ok(format($$select public.log_nudge_choice(%L, 'BUY_STOCKS')$$, :'n1'::jsonb ->> 'nudge_id'),
  '22023', 'INVALID_REQUEST', 'Only known choices are logged');
reset role;
select is((select choice from public.nudge_events where nudge_id = (:'n1'::jsonb ->> 'nudge_id')::uuid and kind = 'CHOICE'),
  'BILL_PAY', 'SSC-07: the first choice is logged');
select is((select count(*) from public.nudge_events where nudge_id = (:'n1'::jsonb ->> 'nudge_id')::uuid), 2::bigint,
  'SSC-07: one SHOWN and one CHOICE row per nudge');

select pg_temp.as_user(:'normal') \gset
select public.cashout_nudge(1000) as nn \gset
select throws_ok(format($$select public.log_nudge_choice(%L, 'CANCEL')$$, :'n2'::jsonb ->> 'nudge_id'),
  '22023', 'NUDGE_NOT_FOUND', 'Users cannot log choices on other users'' nudges');
reset role;
select is((:'nn'::jsonb ->> 'show')::boolean, false, 'SSC-02: no interception for a user without repeated cash-outs');
select is(:'nn'::jsonb ->> 'reason', 'BELOW_THRESHOLD', 'SSC-02: reason recorded');

-- SSC-09: opting out stops nudges; preferences round-trip through the profile.
update public.nudge_events set created_at = now() - interval '2 days' where user_id = :'heavy';
select pg_temp.as_user(:'heavy') \gset
select public.set_my_preferences(p_nudges_enabled => false, p_language => 'bn');
select public.cashout_nudge(1000) as off \gset
select public.get_my_profile() as prof \gset
select throws_ok($$select public.set_my_preferences('fr')$$, '22023', 'INVALID_LANGUAGE', 'Only en/bn');
select throws_ok($$select count(*) from public.nudge_events$$, '42501', null, 'Nudge events are not readable by clients');
reset role;
select is(:'off'::jsonb ->> 'reason', 'OPTED_OUT', 'SSC-09: nudges stop when turned off');
select is(:'prof'::jsonb ->> 'language', 'bn', 'Language preference is stored');
select is((:'prof'::jsonb ->> 'nudges_enabled')::boolean, false, 'Nudge preference is stored');
select is((:'prof'::jsonb ->> 'bangla_digits')::boolean, true, 'Bangla digits default on');

select pg_temp.as_anon() \gset
select throws_ok($$select public.cashout_nudge(100)$$, '42501', null, 'anon cannot call the companion');
reset role;

select * from finish();
rollback;
