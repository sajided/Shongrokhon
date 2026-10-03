-- Phase 4 Investigation Assistant in the database: TC-P4-INV-01/02/06/07/08/09/10.
begin;
\ir _helpers.psql
select no_plan();

select pg_temp.mk_user('8801700000901', 50000) as payer \gset
select pg_temp.mk_merchant('8801700000911', 'MINV0001', 'Fast Cash Shop') as m \gset
select pg_temp.mk_analyst('analyst-test@shongrokhon.test') as analyst \gset

select ok(not exists (select 1 from public.wallets where user_id = :'analyst'), 'Staff accounts get no customer wallet');
select ok(not exists (select 1 from public.users where id = :'analyst'), 'Staff accounts get no customer profile');

-- A flagged payment raises a TXN alert (Phase 2 policy).
select pg_temp.as_user(:'payer') \gset
select pg_temp.pay('MINV0001', 10000, '12345', gen_random_uuid(), null, 'FLAG') as flagged \gset
reset role;
select a.id as alert from public.risk_alerts a where a.transaction_id = (:'flagged'::jsonb ->> 'transaction_id')::uuid \gset

--------------------------------------------------------------------------------
-- INV-01: analysts only
--------------------------------------------------------------------------------
select pg_temp.as_user(:'payer') \gset
select throws_ok($$select public.analyst_list_alerts()$$, '42501', 'NOT_ANALYST', 'INV-01: a customer cannot open the queue');
select throws_ok(format($$select public.analyst_get_alert(%L)$$, :'alert'), '42501', 'NOT_ANALYST', 'INV-01: or an alert');
select throws_ok(format($$select public.analyst_act(%L, 'FALSE_POSITIVE')$$, :'alert'), '42501', 'NOT_ANALYST',
  'INV-01: or act on it');
select is(public.am_i_analyst(), false, 'am_i_analyst is false for customers');
select throws_ok($$select count(*) from public.alert_actions$$, '42501', null, 'Audit log not readable directly');
reset role;
select pg_temp.as_anon() \gset
select throws_ok($$select public.analyst_list_alerts()$$, '42501', null, 'INV-01: anon cannot call analyst RPCs');
reset role;

--------------------------------------------------------------------------------
-- INV-02/09: queue, filters, search
--------------------------------------------------------------------------------
select pg_temp.as_user(:'analyst') \gset
select public.am_i_analyst() as is_analyst \gset
select public.analyst_list_alerts() as queue \gset
select public.analyst_list_alerts(p_wallet => 'MINV0001') as mine \gset
-- Filters are combined with this test's merchant: other suites may have left alerts behind.
select public.analyst_list_alerts(p_status => 'CONFIRMED', p_wallet => 'MINV0001') as confirmed_only \gset
select public.analyst_list_alerts(p_min_score => 0.001, p_wallet => 'MINV0001') as by_score \gset
select public.analyst_list_alerts(p_min_score => 0.999, p_wallet => 'MINV0001') as above_score \gset
select public.analyst_list_alerts(p_wallet => 'minv0001') as by_merchant \gset
select public.analyst_list_alerts(p_wallet => '0901') as by_phone \gset
select public.analyst_list_alerts(p_wallet => 'NOBODY') as nobody \gset
select public.analyst_list_alerts(p_from => now() + interval '1 day', p_wallet => 'MINV0001') as future \gset
reset role;
select is(:'is_analyst'::boolean, true, 'am_i_analyst is true for staff');
select ok(:'queue'::jsonb @> jsonb_build_array(jsonb_build_object('id', :'alert'::text)), 'INV-02: the alert is in the queue');
select is((:'mine'::jsonb -> 0 ->> 'amount')::numeric, 10000::numeric, 'INV-02: with its amount');
select is(jsonb_array_length(:'mine'::jsonb -> 0 -> 'wallets'), 2, 'INV-02: and the wallets involved');
select is(:'mine'::jsonb -> 0 -> 'wallets' -> 0 ->> 'label', '**********0901', 'Customers appear only as masked numbers');
select is(:'mine'::jsonb -> 0 ->> 'status', 'OPEN', 'INV-02: and its status');
select is(jsonb_array_length(:'confirmed_only'::jsonb), 0, 'INV-09: status filter');
select is(jsonb_array_length(:'by_score'::jsonb), 1, 'INV-09: score filter (in range)');
select is(jsonb_array_length(:'above_score'::jsonb), 0, 'INV-09: score filter (out of range)');
select is(jsonb_array_length(:'by_merchant'::jsonb), 1, 'INV-09: search by merchant id');
select is(jsonb_array_length(:'by_phone'::jsonb), 1, 'INV-09: search by the last digits of a number');
select is(jsonb_array_length(:'nobody'::jsonb), 0, 'INV-09: unknown wallet finds nothing');
select is(jsonb_array_length(:'future'::jsonb), 0, 'INV-09: date filter');

-- Alert detail: score with stored features, transaction, wallets.
select pg_temp.as_user(:'analyst') \gset
select public.analyst_get_alert(:'alert') as detail \gset
reset role;
select is(:'detail'::jsonb -> 'score' ->> 'decision', 'FLAG', 'Detail carries the score');
select is(:'detail'::jsonb -> 'transaction' -> 'payee' ->> 'label', 'Fast Cash Shop', 'Detail carries the transaction');
select is(:'detail'::jsonb -> 'graph', 'null'::jsonb, 'TXN alerts have no network graph');

--------------------------------------------------------------------------------
-- INV-07/08/10: actions, audit log, labels
--------------------------------------------------------------------------------
select pg_temp.as_user(:'analyst') \gset
select public.analyst_act(:'alert', 'NOTE', 'Merchant cashes out within minutes') as noted \gset
select throws_ok(format($$select public.analyst_act(%L, 'NOTE')$$, :'alert'), '22023', 'NOTE_REQUIRED', 'A note needs text');
select throws_ok(format($$select public.analyst_act(%L, 'DELETE')$$, :'alert'), '22023', 'INVALID_ACTION', 'Unknown actions');
select public.analyst_act(:'alert', 'CONFIRMED', 'Disguised cash-out') as confirmed \gset
select public.analyst_act(:'alert', 'FALSE_POSITIVE', 'Re-checked: legitimate wholesale purchase') as fp \gset
select public.analyst_get_alert(:'alert') as after \gset
reset role;
select is(:'noted'::jsonb ->> 'status', 'OPEN', 'A note leaves the status');
select is(:'confirmed'::jsonb ->> 'status', 'CONFIRMED', 'INV-07: status updated');
select is((select status from public.risk_alerts where id = :'alert'), 'FALSE_POSITIVE', 'INV-07: latest decision wins');
select is(jsonb_array_length(:'after'::jsonb -> 'actions'), 3, 'INV-07: every action is in the audit log');
select is(:'after'::jsonb -> 'actions' -> 1 ->> 'analyst', 'analyst-test@shongrokhon.test', 'INV-07: with the analyst');
select ok((:'after'::jsonb -> 'actions' -> 1 ->> 'created_at') is not null, 'INV-07: and the time');
select is((select label from public.training_labels where alert_id = :'alert'), 0::smallint,
  'INV-08: a false positive is saved as label 0 for retraining');
select is((select l.features from public.training_labels l where l.alert_id = :'alert'),
  (select s.features from public.risk_scores s join public.risk_alerts a on a.risk_score_id = s.id where a.id = :'alert'),
  'INV-08: labels carry the features the model scored');
select throws_ok($$update public.alert_actions set note = 'edited'$$, '42501', null, 'INV-10: audit entries cannot be edited');
select throws_ok($$delete from public.alert_actions$$, '42501', null, 'INV-10: or deleted');

--------------------------------------------------------------------------------
-- INV-06: ring alerts come with the network graph
--------------------------------------------------------------------------------
select pg_temp.mk_user('8801700000902', 50000) as r1 \gset
select pg_temp.mk_user('8801700000903', 50000) as r2 \gset
select pg_temp.mk_merchant('8801700000912', 'MINV0002', 'Ring Shop') as rm \gset
select count(private.post_transfer('PAYMENT', pg_temp.wallet_of(r), pg_temp.wallet_of(:'rm', 'merchant'), 2000,
                                   gen_random_uuid(), null, '{"out_name":"x","in_name":"y"}'))
  from unnest(array[:'r1'::uuid, :'r1'::uuid, :'r2'::uuid]) r;
update public.transactions set created_at = now() - interval '1 day' where payee_wallet_id = pg_temp.wallet_of(:'rm', 'merchant');
select public.record_ring_alert('fp-inv', array[pg_temp.wallet_of(:'r1'), pg_temp.wallet_of(:'r2')],
                                array[pg_temp.wallet_of(:'rm', 'merchant')], '{"score":0.9}') as ring \gset
select pg_temp.as_user(:'analyst') \gset
select public.analyst_get_alert(:'ring') as ring_detail \gset
select public.analyst_act(:'ring', 'CONFIRMED') as ring_ok \gset
reset role;
select is(jsonb_array_length(:'ring_detail'::jsonb -> 'graph' -> 'nodes'), 3, 'INV-06: every ring wallet is a node');
select is(jsonb_array_length(:'ring_detail'::jsonb -> 'graph' -> 'edges'), 2, 'INV-06: flows between them are edges');
select is((select (e ->> 'total')::numeric from jsonb_array_elements(:'ring_detail'::jsonb -> 'graph' -> 'edges') e
            where e ->> 'from' = pg_temp.wallet_of(:'r1')::text), 4000::numeric, 'INV-06: edges carry the flow');
select is((:'ring_detail'::jsonb -> 'alert' ->> 'score')::float8, 0.9::float8, 'Ring score shown');
select is((select count(*) from public.training_labels where alert_id = :'ring'), 0::bigint,
  'Ring alerts have no single score to label');

-- Explanations are written by the service only.
select pg_temp.as_user(:'analyst') \gset
select throws_ok(format($$select public.store_alert_explanation(%L, 'v', '{}', '{}', 'LLM')$$, :'alert'),
  '42501', null, 'Explanations are stored by the investigate function only');
reset role;
select public.store_alert_explanation(:'alert', 'p2-test', '{"base_value": -3}', null, null);
select public.store_alert_explanation(:'alert', 'p2-test', null, '{"text": "s"}', 'LLM');
select is((select shap ->> 'base_value' from public.alert_explanations where alert_id = :'alert'), '-3',
  'SHAP and summary can be stored separately without overwriting each other');

select * from finish();
rollback;
