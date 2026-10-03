-- Phase 4 money flows: cash-out at an agent, send money, bill pay, rule scoring.
begin;
\ir _helpers.psql
select no_plan();

select pg_temp.mk_user('8801700000701', 20000) as u \gset
select pg_temp.mk_user('8801700000702', 500) as friend \gset
select pg_temp.mk_agent('8801700000711', 'AGT0701', 'Rahman Agent Point') as a \gset
select pg_temp.mk_merchant('8801700000721', 'MBILL0701', 'Test Electric Co') as biller \gset
update public.wallets set biller_category = 'ELECTRICITY' where user_id = :'biller' and kind = 'merchant';
update public.users set full_name = 'Rina Akter' where id = :'friend';
select pg_temp.wallet_of(:'u') as u_wallet \gset
select pg_temp.wallet_of(:'a', 'agent') as a_wallet \gset
select pg_temp.wallet_of(:'friend') as f_wallet \gset

--------------------------------------------------------------------------------
-- Cash-out: amount to the agent, 1.85% fee to the fee wallet, one key
--------------------------------------------------------------------------------
select gen_random_uuid() as k1 \gset
select pg_temp.mk_flow_score(:'u', :'a_wallet', 2000, :'k1') as s1 \gset
select coalesce((select balance from public.wallets where id = '00000000-0000-0000-0000-00000000a002'), 0) as fee_before \gset
select pg_temp.as_user(:'u') \gset
select public.make_cashout('agt0701', 2000, '12345', :'k1', :'s1') as co \gset
select public.make_cashout('AGT0701', 2000, '12345', :'k1', :'s1') as co_replay \gset
select public.get_payment_status(:'k1') as co_status \gset
reset role;
select is(:'co'::jsonb ->> 'status', 'SUCCESS', 'Cash-out succeeds (agent code is case-insensitive)');
select is((:'co'::jsonb ->> 'fee')::numeric, 37.00, 'Cash-out fee is 1.85%');
select is(pg_temp.balance_of(:'u'), 20000 - 2000 - 37.00, 'Payer pays amount + fee');
select is(pg_temp.balance_of(:'a', 'agent'), 2000.00, 'Agent receives the amount');
select is((select balance from public.wallets where id = '00000000-0000-0000-0000-00000000a002') - :'fee_before'::numeric,
  37.00, 'Fee wallet receives the fee');
select is((:'co'::jsonb ->> 'balance_after')::numeric, 17963.00, 'balance_after includes the fee');
select is(:'co'::jsonb ->> 'counterparty_name', 'Rahman Agent Point', 'Receipt names the agent');
select is((:'co_replay'::jsonb ->> 'replayed')::boolean, true, 'Same key replays the original result (PAY-07)');
select is((select count(*) from public.transactions where payer_wallet_id = :'u_wallet'), 2::bigint,
  'One cash-out and one fee row, no duplicate on replay');
select is(:'co_status'::jsonb ->> 'kind', 'CASHOUT', 'get_payment_status covers cash-outs (PAY-10)');
select is((select type::text from public.transactions where risk_score_id = :'s1'), 'CASHOUT', 'Score is linked to the cash-out');

-- Score checks (FLOW-07), amount rules, funds, PIN.
select pg_temp.as_user(:'u') \gset
select public.make_cashout('AGT0701', 100, '12345', gen_random_uuid()) as no_score \gset
select public.make_cashout('AGT0701', 150, '12345', :'k1', :'s1') as reused \gset
reset role;
select is(:'no_score'::jsonb ->> 'code', 'SCORE_REQUIRED', 'FLOW-07: cash-out without a score is rejected');
select is(:'reused'::jsonb ->> 'code', 'IDEMPOTENCY_KEY_REUSED', 'A key cannot be reused for another amount');

select gen_random_uuid() as k2 \gset
select pg_temp.mk_flow_score(:'u', :'a_wallet', 100, :'k2') as s2 \gset
select pg_temp.as_user(:'u') \gset
select public.make_cashout('AGT0701', 120, '12345', :'k2', :'s2') as bad_score \gset
select public.make_cashout('NOPE', 100, '12345', :'k2', :'s2') as no_agent \gset
select public.make_cashout('AGT0701', 100, '99999', :'k2', :'s2') as wrong_pin \gset
select public.make_cashout('AGT0701', 0, '12345', gen_random_uuid()) as zero \gset
reset role;
select is(:'bad_score'::jsonb ->> 'code', 'SCORE_INVALID', 'Score for another amount is rejected');
select is(:'no_agent'::jsonb ->> 'code', 'AGENT_NOT_FOUND', 'Unknown agent');
select is(:'wrong_pin'::jsonb ->> 'code', 'WRONG_PIN', 'Wrong PIN is rejected');
select is((:'wrong_pin'::jsonb ->> 'attempts_left')::int, 2, 'Wrong PIN increments the counter');
select is(:'zero'::jsonb ->> 'code', 'INVALID_AMOUNT', 'Zero amount');

select pg_temp.mk_user('8801700000703', 1000) as low \gset
select pg_temp.wallet_of(:'low') as low_wallet \gset
select gen_random_uuid() as k3 \gset
select pg_temp.mk_flow_score(:'low', :'a_wallet', 990, :'k3') as s3 \gset
select pg_temp.as_user(:'low') \gset
select public.make_cashout('AGT0701', 990, '12345', :'k3', :'s3') as poor \gset
reset role;
select is(:'poor'::jsonb ->> 'code', 'INSUFFICIENT_FUNDS', 'Funds must cover amount + fee');
select is(pg_temp.balance_of(:'low'), 1000.00, 'Nothing moves on failure');

-- Daily limit.
update public.app_config set cashout_daily_limit = 3000 where id;
select gen_random_uuid() as k4 \gset
select pg_temp.mk_flow_score(:'u', :'a_wallet', 1500, :'k4') as s4 \gset
select pg_temp.as_user(:'u') \gset
select public.make_cashout('AGT0701', 1500, '12345', :'k4', :'s4') as over_limit \gset
reset role;
select is(:'over_limit'::jsonb ->> 'code', 'DAILY_LIMIT_EXCEEDED', 'Daily cash-out limit is enforced');
update public.app_config set cashout_daily_limit = 50000 where id;

-- REVIEW -> step-up; confirm executes once.
select gen_random_uuid() as k5 \gset
select pg_temp.mk_flow_score(:'u', :'a_wallet', 500, :'k5', 'REVIEW') as s5 \gset
select pg_temp.as_user(:'u') \gset
select public.make_cashout('AGT0701', 500, '12345', :'k5', :'s5') as step \gset
select public.make_cashout('AGT0701', 500, '12345', :'k5', :'s5', true) as confirmed \gset
reset role;
select is(:'step'::jsonb ->> 'status', 'STEP_UP_REQUIRED', 'REVIEW asks for confirmation');
select is((:'step'::jsonb ->> 'fee')::numeric, 9.25, 'Step-up shows the fee');
select is(:'confirmed'::jsonb ->> 'status', 'SUCCESS', 'Confirmed cash-out executes');

--------------------------------------------------------------------------------
-- Send money (P2P)
--------------------------------------------------------------------------------
select gen_random_uuid() as k6 \gset
select pg_temp.mk_flow_score(:'u', :'f_wallet', 750, :'k6') as s6 \gset
select pg_temp.as_user(:'u') \gset
select * from public.lookup_recipient('017-0000-0702') \gset rcp_
select public.make_transfer('01700000702', 750, '12345', :'k6', 'Lunch', :'s6') as tr \gset
select public.make_transfer('01700000701', 10, '12345', gen_random_uuid()) as self \gset
select public.make_transfer('01799999999', 10, '12345', gen_random_uuid()) as nobody \gset
reset role;
select is(:'rcp_display_name'::text, 'Rina', 'Recipient lookup shows only the first name');
select is(:'rcp_masked_phone'::text, '**********0702', 'Recipient lookup masks the number');
select is(:'tr'::jsonb ->> 'status', 'SUCCESS', 'Transfer succeeds');
select is((:'tr'::jsonb ->> 'fee')::numeric, 0.00, 'Transfers are free by default');
select is(pg_temp.balance_of(:'friend'), 1250.00, 'Recipient is credited');
select is((select kind from public.notifications where user_id = :'friend' order by created_at desc limit 1),
  'TRANSFER_RECEIVED', 'Recipient gets a notice');
select is(:'self'::jsonb ->> 'code', 'SELF_TRANSFER', 'Cannot send money to yourself');
select is(:'nobody'::jsonb ->> 'code', 'RECIPIENT_NOT_FOUND', 'Unknown recipient');
select is(private.decrypt_field((select note_enc from public.transactions where risk_score_id = :'s6')), 'Lunch',
  'Transfer note is stored encrypted');

-- FLAG: executes, alert + flags, payer-only notice.
select gen_random_uuid() as k7 \gset
select pg_temp.mk_flow_score(:'u', :'f_wallet', 100, :'k7', 'FLAG') as s7 \gset
select pg_temp.as_user(:'u') \gset
select public.make_transfer('01700000702', 100, '12345', :'k7', null, :'s7') as flagged \gset
reset role;
select is((:'flagged'::jsonb ->> 'flagged')::boolean, true, 'FLAG: the transfer executes and is flagged');
select ok((select risk_flagged from public.wallets where id = :'f_wallet'), 'FLAG: recipient wallet is flagged');
select is((select kind from public.notifications where user_id = :'u' order by created_at desc limit 1),
  'FLOW_FLAGGED', 'FLAG: payer gets a neutral notice');

--------------------------------------------------------------------------------
-- Rule scoring (service role)
--------------------------------------------------------------------------------
-- now() is frozen in this transaction and features count strictly earlier rows: backdate what happened so far.
update public.transactions set created_at = now() - interval '1 minute' where payer_wallet_id = :'u_wallet';
select public.flow_score(:'u', 'TRANSFER', '01700000702', 50, gen_random_uuid()) as r_flag \gset
update public.wallets set risk_flagged = false where id = :'f_wallet';
select public.flow_score(:'u', 'CASHOUT', 'AGT0701', 12000, gen_random_uuid()) as r_big \gset
select public.flow_score(:'u', 'CASHOUT', 'AGT0701', 300, gen_random_uuid()) as r_ok \gset
select public.flow_score(:'u', 'CASHOUT', 'NOPE', 300, gen_random_uuid()) as r_skip \gset
select is(:'r_flag'::jsonb ->> 'decision', 'FLAG', 'Rules: a flagged counterparty -> FLAG');
select is(:'r_big'::jsonb ->> 'decision', 'REVIEW', 'Rules: a large cash-out -> REVIEW');
select is(:'r_ok'::jsonb ->> 'source', 'RULES', 'Rule scores are recorded with source RULES');
select is(:'r_skip'::jsonb, '{"skip": true}'::jsonb, 'Unknown agent is skipped');
select ok((select (features ->> 'payer_cashout_count_30d')::int >= 2 from public.risk_scores where id = (:'r_ok'::jsonb ->> 'id')::uuid),
  'Rule features count the payer''s cash-outs');

--------------------------------------------------------------------------------
-- Bill pay, lookups, access
--------------------------------------------------------------------------------
select pg_temp.as_user(:'u') \gset
select count(*) as billers from public.list_billers() where merchant_id = 'MBILL0701' and biller_category = 'ELECTRICITY' \gset
select * from public.lookup_agent('agt0701') \gset ag_
select throws_ok($$select public.flow_score(auth.uid(), 'CASHOUT', 'AGT0701', 1, gen_random_uuid())$$,
  '42501', null, 'flow_score is service-only');
select throws_ok($$select private.make_flow('CASHOUT', 'AGT0701', 1, '12345', gen_random_uuid(), null, null, false)$$,
  '42501', null, 'private.make_flow is not reachable');
reset role;
select is(:'billers'::int, 1, 'Billers are listed with their category');
select is(:'ag_agent_name'::text, 'Rahman Agent Point', 'Agent lookup');
select pg_temp.as_anon() \gset
select throws_ok($$select public.make_cashout('AGT0701', 1, '12345', gen_random_uuid())$$, '42501', null,
  'anon cannot cash out');
reset role;
select throws_ok($$update public.wallets set biller_category = 'FOOD' where kind = 'merchant'$$, '23514', null,
  'Biller categories come from a fixed list');

-- Coach sees an agent cash-out as cash-out and the fee as spending.
select is((public.coach_context(:'u', 'MONTH') -> 'summary' -> 'cashout' ->> 'count')::int, 2,
  'Coach counts customer cash-outs');

select is((select sum(case when direction = 'DEBIT' then amount else -amount end) from public.ledger_entries),
  0.00::numeric, 'Ledger stays balanced');

select * from finish();
rollback;
