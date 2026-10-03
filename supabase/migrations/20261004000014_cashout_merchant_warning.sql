-- Cash-out through a merchant payment (Phase 4 follow-up).
--
-- A merchant that cashes out most of what it receives, within minutes, is
-- being used as a fee-free cash-out point. Paying it steps up (REVIEW) and the
-- app shows the payer a warning not to go ahead; nothing moves unless they
-- confirm with their PIN. Uses features both scorers already compute
-- (merchant_cashout_ratio_7d, merchant_cashout_lag_min), so ML parity is unchanged.

alter table public.app_config
  add column if not exists cashout_pattern_ratio float8 not null default 0.6,
  add column if not exists cashout_pattern_lag_min float8 not null default 120;

alter table public.risk_scores
  add column if not exists warning text;

alter table public.risk_scores drop constraint if exists risk_scores_warning_known;
alter table public.risk_scores add constraint risk_scores_warning_known
  check (warning is null or warning in ('CASHOUT_MERCHANT'));

create or replace function private.cashout_merchant_pattern(p_features jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg public.app_config;
begin
  select * into v_cfg from public.app_config where id;
  return coalesce((p_features ->> 'merchant_cashout_ratio_7d')::float8, 0) >= v_cfg.cashout_pattern_ratio
     and coalesce((p_features ->> 'merchant_cashout_lag_min')::float8, 1440) <= v_cfg.cashout_pattern_lag_min;
end $$;

revoke execute on function private.cashout_merchant_pattern(jsonb) from public, anon, authenticated;

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
  v_warning text;
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

  -- A merchant that cashes out what it receives, fast, is a disguised cash-out
  -- point: warn the payer before anything moves (FLAG keeps its own path).
  if private.cashout_merchant_pattern(p_features) then
    v_warning := 'CASHOUT_MERCHANT';
    if v_decision = 'ALLOW' then
      v_decision := 'REVIEW';
    end if;
  end if;

  insert into public.risk_scores as s (
    user_id, payer_wallet_id, payee_wallet_id, amount, idempotency_key, features, risk_score, anomaly_score,
    low_confidence, network_risk, decision, warning, source, model_version, latency_ms, expires_at
  ) values (
    p_user_id, v_payer.id, v_payee.id, p_amount, p_idempotency_key, p_features,
    case when p_source = 'MODEL' then p_risk_score end, case when p_source = 'MODEL' then p_anomaly_score end,
    coalesce(p_low_confidence, false), v_network, v_decision, v_warning, p_source,
    coalesce(p_model_version, case when p_source = 'FALLBACK' then 'rules-v1' else 'unknown' end),
    p_latency_ms, now() + make_interval(secs => v_cfg.risk_score_ttl_seconds)
  )
  on conflict (payer_wallet_id, idempotency_key) do update
     set payee_wallet_id = excluded.payee_wallet_id, amount = excluded.amount, features = excluded.features,
         risk_score = excluded.risk_score, anomaly_score = excluded.anomaly_score,
         low_confidence = excluded.low_confidence, network_risk = excluded.network_risk,
         decision = excluded.decision, warning = excluded.warning, source = excluded.source, model_version = excluded.model_version,
         latency_ms = excluded.latency_ms, created_at = now(), expires_at = excluded.expires_at
   where s.expires_at <= now()
     and not exists (select 1 from public.transactions t where t.risk_score_id = s.id)
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.risk_scores
     where payer_wallet_id = v_payer.id and idempotency_key = p_idempotency_key;
  end if;
  return jsonb_build_object('id', v_row.id, 'decision', v_row.decision, 'source', v_row.source,
                            'warning', v_row.warning);
end $$;
