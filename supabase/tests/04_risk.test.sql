-- Phase 2 risk pipeline in the database: TC-P2-FLOW-01/02/03/04/06/07, alerts,
-- flags, notices and the service-only RPCs.
begin;
\ir _helpers.psql
select no_plan();

select pg_temp.mk_user('8801700000401', 50000) as u \gset
select pg_temp.mk_merchant('8801700000402', 'MRISK0001', 'Risk Shop') as m \gset
select pg_temp.wallet_of(:'u') as u_wallet \gset
select pg_temp.wallet_of(:'m', 'merchant') as m_wallet \gset

--------------------------------------------------------------------------------
-- TC-P2-FLOW-07: no score, wrong score, expired score
--------------------------------------------------------------------------------
select pg_temp.as_user(:'u') \gset
select public.make_payment('MRISK0001', 100, '12345', gen_random_uuid()) as no_score \gset
reset role;
select is((:'no_score'::jsonb) ->> 'code', 'SCORE_REQUIRED', 'FLOW-07: execution without a score is rejected');

select gen_random_uuid() as k_a \gset
select pg_temp.mk_score(:'u', 'MRISK0001', 100, :'k_a') as s_a \gset
select pg_temp.as_user(:'u') \gset
select public.make_payment('MRISK0001', 150, '12345', :'k_a', null, :'s_a') as wrong_amount \gset
select public.make_payment('MRISK0001', 100, '12345', gen_random_uuid(), null, :'s_a') as wrong_key \gset
select public.make_payment('MRISK0001', 100, '12345', :'k_a', null, gen_random_uuid()) as unknown_score \gset
reset role;
select is((:'wrong_amount'::jsonb) ->> 'code', 'SCORE_INVALID', 'FLOW-07: score for another amount is rejected');
select is((:'wrong_key'::jsonb) ->> 'code', 'SCORE_INVALID', 'FLOW-07: score for another request is rejected');
select is((:'unknown_score'::jsonb) ->> 'code', 'SCORE_INVALID', 'FLOW-07: made-up score id is rejected');

select gen_random_uuid() as k_exp \gset
select pg_temp.mk_score(:'u', 'MRISK0001', 100, :'k_exp', 'ALLOW', interval '-1 second') as s_exp \gset
select pg_temp.as_user(:'u') \gset
select public.make_payment('MRISK0001', 100, '12345', :'k_exp', null, :'s_exp') as expired \gset
reset role;
select is((:'expired'::jsonb) ->> 'code', 'SCORE_EXPIRED', 'FLOW-07: expired score is rejected');

-- Another user's score cannot be borrowed.
select pg_temp.mk_user('8801700000403', 1000) as other \gset
select gen_random_uuid() as k_other \gset
select pg_temp.mk_score(:'u', 'MRISK0001', 100, :'k_other') as s_other \gset
select pg_temp.as_user(:'other') \gset
select public.make_payment('MRISK0001', 100, '12345', :'k_other', null, :'s_other') as borrowed \gset
reset role;
select is((:'borrowed'::jsonb) ->> 'code', 'SCORE_INVALID', 'FLOW-07: another user''s score is rejected');

-- Clients can neither write scores nor call the scoring RPCs.
select pg_temp.as_user(:'u') \gset
select throws_ok($$insert into public.risk_scores (user_id, payer_wallet_id, payee_wallet_id, amount, idempotency_key,
                   features, decision, source, model_version, expires_at)
                   values (auth.uid(), gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), '{}', 'ALLOW', 'MODEL', 'x', now())$$,
  '42501', null, 'FLOW-07: authenticated cannot insert risk scores');
select throws_ok($$select public.record_risk_score(auth.uid(), 'MRISK0001', 1, gen_random_uuid(), '{}', 'FALLBACK')$$,
  '42501', null, 'FLOW-07: authenticated cannot call record_risk_score');
select throws_ok($$select public.risk_context(auth.uid(), 'MRISK0001', 1, gen_random_uuid())$$,
  '42501', null, 'risk_context is service-only');
select throws_ok($$select count(*) from public.risk_alerts$$, '42501', null, 'risk_alerts are not readable by customers');
select throws_ok($$select count(*) from public.risk_scores$$, '42501', null, 'risk_scores are not readable by customers');
reset role;
select is(pg_temp.balance_of(:'u'), 50000.00::numeric, 'FLOW-07: no money moved by rejected attempts');

--------------------------------------------------------------------------------
-- TC-P2-FLOW-01/06: ALLOW executes and the score is stored with the transaction
--------------------------------------------------------------------------------
select gen_random_uuid() as k1 \gset
select pg_temp.mk_score(:'u', 'MRISK0001', 500, :'k1', 'ALLOW') as s1 \gset
select pg_temp.as_user(:'u') \gset
select public.make_payment('MRISK0001', 500, '12345', :'k1', null, :'s1') as r1 \gset
reset role;
select is((:'r1'::jsonb) ->> 'status', 'SUCCESS', 'FLOW-01: low risk executes');
select is((:'r1'::jsonb) ->> 'risk_decision', 'ALLOW', 'FLOW-01: result carries the decision');
select is((:'r1'::jsonb) ->> 'flagged', 'false', 'FLOW-01: not flagged');
select is((select risk_score_id from public.transactions where id = ((:'r1'::jsonb) ->> 'transaction_id')::uuid),
  :'s1'::uuid, 'FLOW-06: score is linked to the transaction');
select ok((select risk_score is not null and model_version is not null and decision = 'ALLOW'
             from public.risk_scores where id = :'s1'), 'FLOW-06: score, model version and decision stored');

-- A score cannot be spent twice: same key replays, a new key needs a new score.
select pg_temp.as_user(:'u') \gset
select public.make_payment('MRISK0001', 500, '12345', :'k1', null, :'s1') as r1_replay \gset
select public.make_payment('MRISK0001', 500, '12345', gen_random_uuid(), null, :'s1') as r1_reuse \gset
reset role;
select is((:'r1_replay'::jsonb) ->> 'replayed', 'true', 'Replay returns the original result');
select is((:'r1_reuse'::jsonb) ->> 'code', 'SCORE_INVALID', 'FLOW-07: a used score cannot pay again');

--------------------------------------------------------------------------------
-- TC-P2-FLOW-03: REVIEW requires step-up confirmation
--------------------------------------------------------------------------------
select gen_random_uuid() as k3 \gset
select pg_temp.mk_score(:'u', 'MRISK0001', 2000, :'k3', 'REVIEW') as s3 \gset
select pg_temp.balance_of(:'u') as bal_before_review \gset
select pg_temp.as_user(:'u') \gset
select public.make_payment('MRISK0001', 2000, '12345', :'k3', null, :'s3') as r3a \gset
select public.make_payment('MRISK0001', 2000, '99999', :'k3', null, :'s3', true) as r3_badpin \gset
reset role;
select is((:'r3a'::jsonb) ->> 'status', 'STEP_UP_REQUIRED', 'FLOW-03: medium risk asks for confirmation');
select is((:'r3a'::jsonb) ->> 'code', 'CONFIRM_PAYMENT', 'FLOW-03: step-up code');
select is(pg_temp.balance_of(:'u'), :'bal_before_review'::numeric, 'FLOW-03: nothing debited before confirmation');
select is((:'r3_badpin'::jsonb) ->> 'code', 'WRONG_PIN', 'FLOW-03: confirmation still needs the right PIN');
select pg_temp.as_user(:'u') \gset
select public.make_payment('MRISK0001', 2000, '12345', :'k3', null, :'s3', true) as r3b \gset
reset role;
select is((:'r3b'::jsonb) ->> 'status', 'SUCCESS', 'FLOW-03: executes after confirmation');
select is(pg_temp.balance_of(:'u'), :'bal_before_review'::numeric - 2000, 'FLOW-03: debited once');
update public.users set pin_failed_attempts = 0 where id = :'u';

--------------------------------------------------------------------------------
-- TC-P2-FLOW-02 (Phase 2 policy): FLAG pays, then alerts, flags and notifies
--------------------------------------------------------------------------------
select gen_random_uuid() as k2 \gset
select pg_temp.mk_score(:'u', 'MRISK0001', 10000, :'k2', 'FLAG') as s2 \gset
select pg_temp.balance_of(:'u') as bal_before_flag \gset
select pg_temp.as_user(:'u') \gset
select public.make_payment('MRISK0001', 10000, '12345', :'k2', null, :'s2') as r2 \gset
reset role;
select is((:'r2'::jsonb) ->> 'status', 'SUCCESS', 'FLOW-02: flagged payment still executes');
select is((:'r2'::jsonb) ->> 'flagged', 'true', 'FLOW-02: result says flagged');
select is(pg_temp.balance_of(:'u'), :'bal_before_flag'::numeric - 10000, 'FLOW-02: payer debited');
select is((select count(*) from public.risk_alerts where risk_score_id = :'s2' and kind = 'TXN' and status = 'OPEN'),
  1::bigint, 'FLOW-02: one alert created');
select is((select array_agg(id order by id) from public.wallets where risk_flagged and id in (:'u_wallet', :'m_wallet')),
  (select array_agg(x order by x) from unnest(array[:'u_wallet'::uuid, :'m_wallet'::uuid]) x),
  'FLOW-02: payer and merchant wallets flagged');
select is((select count(*) from public.notifications where user_id = :'u' and kind = 'PAYMENT_FLAGGED'), 1::bigint,
  'FLOW-02: payer notified');
select is((select count(*) from public.notifications where user_id = :'m' and kind = 'PAYMENT_RECEIVED_FLAGGED'), 1::bigint,
  'FLOW-02: merchant notified');
select ok((select body like '%৳10,000.00%Risk Shop%' from public.notifications where user_id = :'u' and kind = 'PAYMENT_FLAGGED'),
  'FLOW-02: notice names the amount and merchant');

-- Replay does not duplicate alerts or notices.
select pg_temp.as_user(:'u') \gset
select public.make_payment('MRISK0001', 10000, '12345', :'k2', null, :'s2') as r2_replay \gset
select count(*) as my_notices from public.get_my_notifications() \gset
select (select id from public.get_my_notifications() limit 1) as notice_id \gset
select public.mark_notification_read(:'notice_id') \gset
select read_at is not null as notice_read from public.get_my_notifications() where id = :'notice_id' \gset
select count(*) as visible_notices from public.notifications \gset
select flagged as history_flag from public.get_my_transactions(1, null, ((:'r2'::jsonb) ->> 'transaction_id')::uuid) \gset
reset role;
select is((select count(*) from public.risk_alerts where risk_score_id = :'s2'), 1::bigint, 'Replay keeps one alert');
select is(:'my_notices'::int, 1, 'get_my_notifications returns only my notices');
select is(:'notice_read'::boolean, true, 'mark_notification_read works');
select is(:'visible_notices'::int, 1, 'RLS: notifications table shows only my rows');
select is(:'history_flag'::boolean, true, 'History marks the flagged transaction');

--------------------------------------------------------------------------------
-- record_risk_score: decisions from app_config, fallback rules, concurrency
--------------------------------------------------------------------------------
update public.app_config set risk_review_threshold = 0.3, risk_flag_threshold = 0.7, anomaly_threshold = 0.05;
select gen_random_uuid() as k5 \gset
select public.record_risk_score(:'u', 'MRISK0001', 100, :'k5', '{}', 'MODEL', 0.1, -0.2, false, 'v1', 3) as rs_allow \gset
select is((:'rs_allow'::jsonb) ->> 'decision', 'ALLOW', 'Below thresholds -> ALLOW');
select is((public.record_risk_score(:'u', 'MRISK0001', 100, gen_random_uuid(), '{}', 'MODEL', 0.35, -0.2, false, 'v1')) ->> 'decision',
  'REVIEW', 'Risk above review threshold -> REVIEW');
select is((public.record_risk_score(:'u', 'MRISK0001', 100, gen_random_uuid(), '{}', 'MODEL', 0.1, 0.2, false, 'v1')) ->> 'decision',
  'REVIEW', 'IF-03 in the flow: anomaly -> REVIEW');
select is((public.record_risk_score(:'u', 'MRISK0001', 100, gen_random_uuid(), '{}', 'MODEL', 0.1, 0.2, true, 'v1')) ->> 'decision',
  'ALLOW', 'IF-06 in the flow: low-confidence anomaly alone does not step up');
select is((public.record_risk_score(:'u', 'MRISK0001', 100, gen_random_uuid(), '{}', 'MODEL', 0.9, -0.2, false, 'v1')) ->> 'decision',
  'FLAG', 'Risk above flag threshold -> FLAG');
select is((public.record_risk_score(:'u', 'MRISK0001', 100, :'k5', '{}', 'MODEL', 0.99, 0, false, 'v1')) ->> 'id',
  (:'rs_allow'::jsonb) ->> 'id', 'Same key returns the existing unexpired score (retries never re-score)');
select throws_ok($$select public.record_risk_score(gen_random_uuid(), 'MRISK0001', 1, gen_random_uuid(), '{}', 'MODEL', 1.5, 0)$$,
  '22023', 'INVALID_REQUEST', 'Unknown user is rejected');
select throws_ok(format($$select public.record_risk_score(%L, 'MRISK0001', 1, gen_random_uuid(), '{}', 'MODEL', 1.5, 0)$$, :'u'),
  '22023', 'INVALID_SCORE', 'Out-of-range model score is rejected');

-- TC-P2-FLOW-04/05: fallback rules.
select is((public.record_risk_score(:'u', 'MRISK0001', 500, gen_random_uuid(),
  '{"amount": 500, "payer_merchant_count_10m": 0}', 'FALLBACK')) ->> 'decision', 'ALLOW', 'FLOW-04: fallback allows ordinary payments');
select is((public.record_risk_score(:'u', 'MRISK0001', 12000, gen_random_uuid(),
  '{"amount": 12000, "payer_merchant_count_10m": 0}', 'FALLBACK')) ->> 'decision', 'REVIEW', 'FLOW-04: fallback steps up large amounts');
select is((public.record_risk_score(:'u', 'MRISK0001', 100, gen_random_uuid(),
  '{"amount": 100, "payer_merchant_count_10m": 4}', 'FALLBACK')) ->> 'decision', 'REVIEW', 'FLOW-04: fallback steps up bursts');
select is((select model_version from public.risk_scores where source = 'FALLBACK' limit 1), 'rules-v1', 'FLOW-04: fallback is recorded as such');

-- Expired, unused scores are replaced on re-score.
update public.risk_scores set expires_at = now() - interval '1 second' where id = ((:'rs_allow'::jsonb) ->> 'id')::uuid;
select is((public.record_risk_score(:'u', 'MRISK0001', 100, :'k5', '{}', 'MODEL', 0.99, 0, false, 'v2')) ->> 'decision',
  'FLAG', 'An expired score is replaced');

--------------------------------------------------------------------------------
-- Network risk (FLOW-08 hand-off) and risk_context
--------------------------------------------------------------------------------
select is(public.set_merchant_network_risk(jsonb_build_object(:'m_wallet', 0.85, :'u_wallet', 0.9)), 1,
  'Network scores are stored for merchant wallets only');
select is((public.record_risk_score(:'u', 'MRISK0001', 100, gen_random_uuid(), '{}', 'MODEL', 0.01, -0.5, false, 'v1')) ->> 'decision',
  'FLAG', 'Ring merchant forces FLAG even for a low model score');
select is((public.record_risk_score(:'u', 'MRISK0001', 100, gen_random_uuid(), '{"amount":100,"payer_merchant_count_10m":0}',
  'FALLBACK')) ->> 'decision', 'FLAG', 'Fallback also honours the ring override');

-- now() is frozen inside this test transaction and features only count events
-- strictly before the scoring instant, so move the earlier payments back an hour.
update public.transactions set created_at = now() - interval '1 hour' where payer_wallet_id = :'u_wallet';
select gen_random_uuid() as k6 \gset
select public.risk_context(:'u', 'MRISK0001', 250, :'k6') as ctx \gset
select ok((:'ctx'::jsonb) ? 'features' and ((:'ctx'::jsonb) -> 'network_risk')::float8 = 0.85
          and ((:'ctx'::jsonb) -> 'ml_timeout_ms')::int > 0, 'risk_context returns features, network risk and timeout');
select is(((:'ctx'::jsonb) -> 'features' ->> 'payer_merchant_prior_count')::float8, 3::float8,
  'risk_context features see this payer''s history');
select is(public.risk_context(:'u', 'NOPE', 250, :'k6'), '{"skip": true}'::jsonb, 'Unknown merchant is skipped');
select is(public.risk_context(:'u', 'MRISK0001', 0, :'k6'), '{"skip": true}'::jsonb, 'Invalid amount is skipped');
select is(public.risk_context(:'m', 'MRISK0001', 10, :'k6'), '{"skip": true}'::jsonb, 'Self-payment is skipped');
select ok(public.risk_context(:'u', 'MRISK0001', 100, :'k5') ? 'score', 'Existing score is returned for a retry');

--------------------------------------------------------------------------------
-- Ring alerts and cash-out
--------------------------------------------------------------------------------
select public.record_ring_alert('fp-1', array[:'u_wallet'::uuid, :'other'::uuid], array[:'m_wallet'::uuid], '{"score":0.9}') as ring1 \gset
select is(public.record_ring_alert('fp-1', array[:'u_wallet'::uuid], array[:'m_wallet'::uuid], '{}'), :'ring1'::uuid,
  'Ring alerts are idempotent per fingerprint');
select is((select kind::text from public.risk_alerts where id = :'ring1'), 'RING', 'Ring alert kind');

select public.admin_cashout(:'m_wallet', 1000) as co \gset
select is((select type::text from public.transactions where id = :'co'), 'CASHOUT', 'admin_cashout posts a CASHOUT');
select throws_ok(format($$select public.admin_cashout(%L, 99999999)$$, :'m_wallet'), '22023', 'INSUFFICIENT_FUNDS',
  'Cash-out cannot exceed the balance');
select is((select sum(case when direction = 'DEBIT' then amount else -amount end) from public.ledger_entries),
  0.00::numeric, 'Ledger stays balanced');

select * from finish();
rollback;
