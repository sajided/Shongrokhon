-- Phase 2: risk scoring pipeline (scan -> score -> execute/flag).
--
-- The `pay` Edge Function computes features here (risk_context), calls the ML
-- service, and stores the result (record_risk_score). make_payment (migration 7)
-- will only move money against a matching, unexpired score row, and only
-- service_role can write those rows (TC-P2-FLOW-07).

--------------------------------------------------------------------------------
-- Configuration. Thresholds come from ml/artifacts/metadata.json (TC-P2-XGB-09);
-- ml/tests/test_thresholds_in_sync.py keeps these defaults in step with it.
--------------------------------------------------------------------------------
alter table public.app_config
  add column if not exists risk_review_threshold float8 not null default 0.25,
  add column if not exists risk_flag_threshold float8 not null default 0.5,
  add column if not exists anomaly_threshold float8 not null default 0.0,
  add column if not exists network_flag_threshold float8 not null default 0.8,
  add column if not exists ml_timeout_ms int not null default 800,
  add column if not exists risk_score_ttl_seconds int not null default 300,
  add column if not exists fallback_review_amount numeric(14, 2) not null default 10000,
  add column if not exists fallback_burst_count int not null default 3;

alter table public.wallets
  add column if not exists risk_flagged boolean not null default false,
  add column if not exists risk_flagged_at timestamptz;

--------------------------------------------------------------------------------
-- Tables
--------------------------------------------------------------------------------
create table if not exists public.risk_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  payer_wallet_id uuid not null references public.wallets (id),
  payee_wallet_id uuid not null references public.wallets (id),
  amount numeric(14, 2) not null check (amount > 0),
  idempotency_key uuid not null,
  features jsonb not null,
  risk_score float8 check (risk_score between 0 and 1),
  anomaly_score float8,
  low_confidence boolean not null default false,
  network_risk float8 not null default 0,
  decision public.risk_decision not null,
  source public.risk_source not null,
  model_version text not null,
  latency_ms int,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (payer_wallet_id, idempotency_key)
);

alter table public.transactions add column if not exists risk_score_id uuid references public.risk_scores (id);
create unique index if not exists transactions_risk_score_id_key on public.transactions (risk_score_id);

create table if not exists public.risk_alerts (
  id uuid primary key default gen_random_uuid(),
  kind public.alert_kind not null,
  risk_score_id uuid unique references public.risk_scores (id),
  transaction_id uuid references public.transactions (id),
  fingerprint text unique,
  wallet_ids uuid[] not null,
  summary jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN', 'CONFIRMED', 'FALSE_POSITIVE', 'ESCALATED')),
  created_at timestamptz not null default now(),
  check ((kind = 'TXN') = (risk_score_id is not null)),
  check ((kind = 'RING') = (fingerprint is not null))
);
create index if not exists risk_alerts_created_at_idx on public.risk_alerts (created_at desc);

create table if not exists public.merchant_network_risk (
  wallet_id uuid primary key references public.wallets (id),
  score float8 not null check (score between 0 and 1),
  computed_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- Indexes for point-in-time feature queries.
create index if not exists transactions_payer_type_created_idx on public.transactions (payer_wallet_id, type, created_at);
create index if not exists transactions_payee_type_created_idx on public.transactions (payee_wallet_id, type, created_at);

--------------------------------------------------------------------------------
-- Access: risk tables are server-only; users read their own notifications.
-- (Supabase grants new public tables to anon/authenticated by default.)
--------------------------------------------------------------------------------
alter table public.risk_scores enable row level security;
alter table public.risk_alerts enable row level security;
alter table public.merchant_network_risk enable row level security;
alter table public.notifications enable row level security;

revoke all on public.risk_scores, public.risk_alerts, public.merchant_network_risk, public.notifications
  from anon, authenticated;
grant select on public.notifications to authenticated;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

--------------------------------------------------------------------------------
-- Point-in-time features. MUST match ml/shongrokhon_ml/features.py;
-- supabase/tests/05_feature_parity.test.sql (generated) checks it.
-- Windows are [p_at - window, p_at); hours are Asia/Dhaka.
--------------------------------------------------------------------------------
create or replace function private.risk_features(p_payer uuid, p_payee uuid, p_amount numeric, p_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_amount float8 := p_amount::float8;
  v_hour int := extract(hour from (p_at at time zone 'Asia/Dhaka'))::int;
  v_cnt90 int;
  v_med90 float8;
  v_hour_share float8;
  v_cnt1h int;
  v_cash30 int;
  v_prior int;
  v_pmed float8;
  v_cnt10m int;
  v_payers int;
  v_round float8;
  v_recv7 float8;
  v_out7 float8;
  v_first timestamptz;
  v_lag float8;
begin
  -- Payer, last 90 days.
  select count(*),
         coalesce(percentile_cont(0.5) within group (order by p.amount), 0),
         coalesce(avg(case when least(abs(p.h - v_hour), 24 - abs(p.h - v_hour)) <= 1 then 1.0 else 0.0 end), 0),
         count(*) filter (where p.created_at >= p_at - interval '1 hour')
    into v_cnt90, v_med90, v_hour_share, v_cnt1h
    from (select t.amount::float8 as amount, t.created_at,
                 extract(hour from (t.created_at at time zone 'Asia/Dhaka'))::int as h
            from public.transactions t
           where t.payer_wallet_id = p_payer and t.type = 'PAYMENT' and t.status = 'SUCCESS'
             and t.created_at >= p_at - interval '2160 hours' and t.created_at < p_at) p;

  select count(*) into v_cash30
    from public.transactions t
   where t.payer_wallet_id = p_payer and t.type = 'CASHOUT' and t.status = 'SUCCESS'
     and t.created_at >= p_at - interval '720 hours' and t.created_at < p_at;

  -- Payer -> this merchant.
  select count(*) filter (where t.created_at >= p_at - interval '2160 hours'),
         coalesce(percentile_cont(0.5) within group (order by t.amount::float8)
                  filter (where t.created_at >= p_at - interval '2160 hours'), 0),
         count(*) filter (where t.created_at >= p_at - interval '600 seconds')
    into v_prior, v_pmed, v_cnt10m
    from public.transactions t
   where t.payer_wallet_id = p_payer and t.payee_wallet_id = p_payee and t.type = 'PAYMENT'
     and t.status = 'SUCCESS' and t.created_at < p_at;

  -- Merchant.
  select count(distinct t.payer_wallet_id) filter (where t.created_at >= p_at - interval '720 hours'),
         coalesce(avg(case when t.amount % 1000 = 0 then 1.0 else 0.0 end)
                  filter (where t.created_at >= p_at - interval '720 hours'), 0),
         coalesce(sum(t.amount::float8) filter (where t.created_at >= p_at - interval '168 hours'), 0),
         min(t.created_at)
    into v_payers, v_round, v_recv7, v_first
    from public.transactions t
   where t.payee_wallet_id = p_payee and t.type = 'PAYMENT' and t.status = 'SUCCESS' and t.created_at < p_at;

  select coalesce(sum(t.amount::float8) filter (where t.created_at >= p_at - interval '168 hours'), 0),
         percentile_cont(0.5) within group (order by least(coalesce(extract(epoch from t.created_at - (
           select max(r.created_at) from public.transactions r
            where r.payee_wallet_id = p_payee and r.type = 'PAYMENT' and r.status = 'SUCCESS'
              and r.created_at < t.created_at)) / 60.0, 1440.0), 1440.0))
    into v_out7, v_lag
    from public.transactions t
   where t.payer_wallet_id = p_payee and t.type = 'CASHOUT' and t.status = 'SUCCESS'
     and t.created_at >= p_at - interval '720 hours' and t.created_at < p_at;

  return jsonb_build_object(
    'amount', v_amount,
    'log_amount', ln(1 + v_amount),
    'is_round_100', case when p_amount % 100 = 0 then 1.0 else 0.0 end,
    'is_round_1000', case when p_amount % 1000 = 0 then 1.0 else 0.0 end,
    'hour_sin', sin(2 * pi() * v_hour / 24),
    'hour_cos', cos(2 * pi() * v_hour / 24),
    'is_night', case when v_hour < 5 then 1.0 else 0.0 end,
    'payer_txn_count_90d', v_cnt90::float8,
    'payer_median_amount_90d', v_med90,
    'amount_to_median', case when v_med90 > 0 then v_amount / v_med90 else 1.0 end,
    'payer_hour_share', v_hour_share,
    'payer_cashout_count_30d', v_cash30::float8,
    'payer_txn_count_1h', v_cnt1h::float8,
    'payer_merchant_prior_count', v_prior::float8,
    'amount_to_merchant_median', case when v_pmed > 0 then v_amount / v_pmed else 1.0 end,
    'merchant_new_for_payer', case when v_prior = 0 then 1.0 else 0.0 end,
    'payer_merchant_count_10m', v_cnt10m::float8,
    'merchant_distinct_payers_30d', v_payers::float8,
    'merchant_round_share_30d', v_round,
    'merchant_cashout_ratio_7d', case when v_recv7 > 0 then least(v_out7 / v_recv7, 5.0) else 0.0 end,
    'merchant_cashout_lag_min', coalesce(v_lag, 1440.0),
    'merchant_age_days', case when v_first is null then 0.0
                              else least(extract(epoch from p_at - v_first) / 86400.0, 365.0) end
  );
end $$;

--------------------------------------------------------------------------------
-- Decisions. The ML service also returns an advisory decision; this one is
-- authoritative, so thresholds can be changed in app_config without a deploy.
--------------------------------------------------------------------------------
create or replace function private.decide_risk(
  p_risk float8, p_anomaly float8, p_low_confidence boolean, p_network float8
) returns public.risk_decision
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg public.app_config;
begin
  select * into v_cfg from public.app_config where id;
  if p_risk >= v_cfg.risk_flag_threshold or p_network >= v_cfg.network_flag_threshold then
    return 'FLAG';
  end if;
  if p_risk >= v_cfg.risk_review_threshold
     or (p_anomaly >= v_cfg.anomaly_threshold and not p_low_confidence) then
    return 'REVIEW';
  end if;
  return 'ALLOW';
end $$;

-- Rule-based policy used when the ML service is down or slow (TC-P2-FLOW-04/05).
create or replace function private.fallback_risk(p_features jsonb, p_network float8)
returns public.risk_decision
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg public.app_config;
begin
  select * into v_cfg from public.app_config where id;
  if p_network >= v_cfg.network_flag_threshold then
    return 'FLAG';
  end if;
  if (p_features ->> 'amount')::numeric >= v_cfg.fallback_review_amount
     or (p_features ->> 'payer_merchant_count_10m')::float8 >= v_cfg.fallback_burst_count then
    return 'REVIEW';
  end if;
  return 'ALLOW';
end $$;

--------------------------------------------------------------------------------
-- Service-role RPCs used by the `pay` Edge Function.
--------------------------------------------------------------------------------

-- Returns {skip:true} when make_payment will reject the request anyway (unknown
-- merchant, bad amount, ...), {score:{...}} when an unexpired score already
-- exists for this idempotency key (retries never re-score), otherwise the
-- features to send to the ML service.
create or replace function public.risk_context(
  p_user_id uuid, p_merchant_id text, p_amount numeric, p_idempotency_key uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg public.app_config;
  v_payer public.wallets;
  v_payee public.wallets;
  v_score public.risk_scores;
  v_network float8;
begin
  select * into v_cfg from public.app_config where id;
  select * into v_payee from public.wallets where kind = 'merchant' and merchant_id = trim(p_merchant_id);
  select * into v_payer from public.wallets where user_id = p_user_id and kind = 'customer';
  if v_payee.id is null or v_payer.id is null or v_payee.user_id = p_user_id or p_idempotency_key is null
     or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount > v_cfg.per_txn_limit then
    return jsonb_build_object('skip', true);
  end if;

  select * into v_score from public.risk_scores
   where payer_wallet_id = v_payer.id and idempotency_key = p_idempotency_key and expires_at > now();
  if found then
    return jsonb_build_object('score', jsonb_build_object('id', v_score.id, 'decision', v_score.decision));
  end if;

  select score into v_network from public.merchant_network_risk where wallet_id = v_payee.id;
  return jsonb_build_object(
    'features', private.risk_features(v_payer.id, v_payee.id, p_amount, now()),
    'network_risk', coalesce(v_network, 0),
    'ml_timeout_ms', v_cfg.ml_timeout_ms
  );
end $$;

-- Stores a score and returns {id, decision}. p_source = 'FALLBACK' ignores the
-- model fields and applies private.fallback_risk. Concurrent calls for the
-- same key resolve to one row; an expired row is replaced.
create or replace function public.record_risk_score(
  p_user_id uuid,
  p_merchant_id text,
  p_amount numeric,
  p_idempotency_key uuid,
  p_features jsonb,
  p_source public.risk_source,
  p_risk_score float8 default null,
  p_anomaly_score float8 default null,
  p_low_confidence boolean default false,
  p_model_version text default null,
  p_latency_ms int default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.app_config;
  v_payer public.wallets;
  v_payee public.wallets;
  v_network float8;
  v_decision public.risk_decision;
  v_row public.risk_scores;
begin
  select * into v_cfg from public.app_config where id;
  select * into v_payee from public.wallets where kind = 'merchant' and merchant_id = trim(p_merchant_id);
  select * into v_payer from public.wallets where user_id = p_user_id and kind = 'customer';
  if v_payee.id is null or v_payer.id is null then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  if p_source = 'MODEL' and (p_risk_score is null or p_risk_score not between 0 and 1 or p_anomaly_score is null) then
    raise exception 'INVALID_SCORE' using errcode = '22023';
  end if;
  select coalesce((select score from public.merchant_network_risk where wallet_id = v_payee.id), 0) into v_network;

  v_decision := case when p_source = 'MODEL'
    then private.decide_risk(p_risk_score, p_anomaly_score, coalesce(p_low_confidence, false), v_network)
    else private.fallback_risk(p_features, v_network) end;

  insert into public.risk_scores as s (
    user_id, payer_wallet_id, payee_wallet_id, amount, idempotency_key, features, risk_score, anomaly_score,
    low_confidence, network_risk, decision, source, model_version, latency_ms, expires_at
  ) values (
    p_user_id, v_payer.id, v_payee.id, p_amount, p_idempotency_key, p_features,
    case when p_source = 'MODEL' then p_risk_score end, case when p_source = 'MODEL' then p_anomaly_score end,
    coalesce(p_low_confidence, false), v_network, v_decision, p_source,
    coalesce(p_model_version, case when p_source = 'FALLBACK' then 'rules-v1' else 'unknown' end),
    p_latency_ms, now() + make_interval(secs => v_cfg.risk_score_ttl_seconds)
  )
  on conflict (payer_wallet_id, idempotency_key) do update
     set payee_wallet_id = excluded.payee_wallet_id, amount = excluded.amount, features = excluded.features,
         risk_score = excluded.risk_score, anomaly_score = excluded.anomaly_score,
         low_confidence = excluded.low_confidence, network_risk = excluded.network_risk,
         decision = excluded.decision, source = excluded.source, model_version = excluded.model_version,
         latency_ms = excluded.latency_ms, created_at = now(), expires_at = excluded.expires_at
   where s.expires_at <= now()
     and not exists (select 1 from public.transactions t where t.risk_score_id = s.id)
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.risk_scores
     where payer_wallet_id = v_payer.id and idempotency_key = p_idempotency_key;
  end if;
  return jsonb_build_object('id', v_row.id, 'decision', v_row.decision, 'source', v_row.source);
end $$;

--------------------------------------------------------------------------------
-- Alerts, flags and notices
--------------------------------------------------------------------------------

-- FLAG decision on an executed payment: one TXN alert, both wallets flagged,
-- and an in-app notice to the payer and the merchant (user decision for Phase 2).
create or replace function private.raise_risk_alert(p_score_id uuid, p_txn_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_score public.risk_scores;
  v_payee public.wallets;
  v_alert uuid;
  v_amount text;
begin
  select * into v_score from public.risk_scores where id = p_score_id;
  select * into v_payee from public.wallets where id = v_score.payee_wallet_id;

  insert into public.risk_alerts (kind, risk_score_id, transaction_id, wallet_ids, summary)
  values ('TXN', p_score_id, p_txn_id, array[v_score.payer_wallet_id, v_score.payee_wallet_id],
          jsonb_build_object('risk_score', v_score.risk_score, 'anomaly_score', v_score.anomaly_score,
                             'network_risk', v_score.network_risk, 'source', v_score.source,
                             'model_version', v_score.model_version, 'amount', v_score.amount))
  on conflict (risk_score_id) do nothing
  returning id into v_alert;
  if v_alert is null then
    return (select id from public.risk_alerts where risk_score_id = p_score_id);
  end if;

  update public.wallets set risk_flagged = true, risk_flagged_at = coalesce(risk_flagged_at, now())
   where id in (v_score.payer_wallet_id, v_score.payee_wallet_id);

  v_amount := '৳' || to_char(v_score.amount, 'FM999,999,990.00');
  insert into public.notifications (user_id, kind, title, body, data) values
    (v_score.user_id, 'PAYMENT_FLAGGED', 'Payment under review',
     'Your payment of ' || v_amount || ' to ' || v_payee.merchant_name
       || ' went through and has been flagged for a routine review. You don''t need to do anything. '
       || 'If you didn''t make this payment, contact support.',
     jsonb_build_object('transaction_id', p_txn_id, 'amount', v_score.amount, 'merchant_name', v_payee.merchant_name)),
    (v_payee.user_id, 'PAYMENT_RECEIVED_FLAGGED', 'Payment received under review',
     'A payment of ' || v_amount || ' you received has been flagged for a routine review.',
     jsonb_build_object('transaction_id', p_txn_id, 'amount', v_score.amount));
  return v_alert;
end $$;

-- Network job (ml/shongrokhon_ml/network.py): one RING alert per ring fingerprint.
create or replace function public.record_ring_alert(
  p_fingerprint text, p_payer_wallets uuid[], p_merchant_wallets uuid[], p_summary jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_alert uuid;
begin
  insert into public.risk_alerts (kind, fingerprint, wallet_ids, summary)
  values ('RING', p_fingerprint, p_payer_wallets || p_merchant_wallets,
          coalesce(p_summary, '{}'::jsonb) || jsonb_build_object('payer_wallets', p_payer_wallets,
                                                                  'merchant_wallets', p_merchant_wallets))
  on conflict (fingerprint) do nothing
  returning id into v_alert;
  if v_alert is null then
    return (select id from public.risk_alerts where fingerprint = p_fingerprint);
  end if;
  update public.wallets set risk_flagged = true, risk_flagged_at = coalesce(risk_flagged_at, now())
   where id = any (p_payer_wallets || p_merchant_wallets);
  return v_alert;
end $$;

create or replace function public.set_merchant_network_risk(p_scores jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  insert into public.merchant_network_risk (wallet_id, score, computed_at)
  select k::uuid, least(greatest(v::float8, 0), 1), now()
    from jsonb_each_text(coalesce(p_scores, '{}'::jsonb)) as e (k, v)
    join public.wallets w on w.id = k::uuid and w.kind = 'merchant'
  on conflict (wallet_id) do update set score = excluded.score, computed_at = excluded.computed_at;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Service-role only: cash-out to the system wallet (seed data, tests, future agent cash-out).
create or replace function public.admin_cashout(p_wallet_id uuid, p_amount numeric, p_note text default 'Cash out')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_system uuid := '00000000-0000-0000-0000-00000000a001';
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  perform 1 from public.wallets where id in (v_system, p_wallet_id) order by id for update;
  if (select balance from public.wallets where id = p_wallet_id) < p_amount then
    raise exception 'INSUFFICIENT_FUNDS' using errcode = '22023';
  end if;
  return private.post_transfer(
    'CASHOUT', p_wallet_id, v_system, p_amount, gen_random_uuid(), p_note,
    jsonb_build_object('out_name', 'Cash out', 'in_name', 'Cash out')
  );
end $$;

--------------------------------------------------------------------------------
-- Customer-facing notices
--------------------------------------------------------------------------------
create or replace function public.get_my_notifications(p_limit int default 20)
returns table (id uuid, kind text, title text, body text, data jsonb, created_at timestamptz, read_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := private.require_session();
begin
  return query
    select n.id, n.kind, n.title, n.body, n.data, n.created_at, n.read_at
      from public.notifications n
     where n.user_id = v_uid
     order by n.created_at desc, n.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;

create or replace function public.mark_notification_read(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  update public.notifications set read_at = coalesce(read_at, now()) where id = p_id and user_id = v_uid;
end $$;

--------------------------------------------------------------------------------
-- Grants
--------------------------------------------------------------------------------
revoke all on function
  private.risk_features(uuid, uuid, numeric, timestamptz),
  private.decide_risk(float8, float8, boolean, float8),
  private.fallback_risk(jsonb, float8),
  private.raise_risk_alert(uuid, uuid)
  from public, anon, authenticated;

revoke all on function
  public.risk_context(uuid, text, numeric, uuid),
  public.record_risk_score(uuid, text, numeric, uuid, jsonb, public.risk_source, float8, float8, boolean, text, int),
  public.record_ring_alert(text, uuid[], uuid[], jsonb),
  public.set_merchant_network_risk(jsonb),
  public.admin_cashout(uuid, numeric, text),
  public.get_my_notifications(int),
  public.mark_notification_read(uuid)
  from public, anon, authenticated;

grant execute on function
  public.risk_context(uuid, text, numeric, uuid),
  public.record_risk_score(uuid, text, numeric, uuid, jsonb, public.risk_source, float8, float8, boolean, text, int),
  public.record_ring_alert(text, uuid[], uuid[], jsonb),
  public.set_merchant_network_risk(jsonb),
  public.admin_cashout(uuid, numeric, text)
  to service_role;

grant execute on function public.get_my_notifications(int), public.mark_notification_read(uuid) to authenticated;
