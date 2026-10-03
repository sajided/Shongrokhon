-- Phase 4: AI Investigation Assistant for compliance analysts (TC-P4-INV-*).
--
-- Staff are email accounts created with the service role (scripts/create-analyst.ts)
-- and listed in public.staff; they get no customer profile or wallet. Every
-- analyst RPC calls private.require_analyst() first (INV-01). Analyst actions
-- are written to an append-only audit log (INV-07/10) and confirmed / false
-- positive decisions become training labels for the risk model (INV-08).

create table if not exists public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'analyst' check (role in ('analyst')),
  created_at timestamptz not null default now()
);

create table if not exists public.alert_actions (
  id bigint generated always as identity primary key,
  alert_id uuid not null references public.risk_alerts (id),
  analyst_id uuid not null references public.staff (user_id),
  action text not null check (action in ('CONFIRMED', 'FALSE_POSITIVE', 'ESCALATED', 'NOTE')),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists alert_actions_alert_idx on public.alert_actions (alert_id, created_at);

-- Latest analyst decision per scored transaction, exported for retraining
-- (ml/shongrokhon_ml/labels.py). label 1 = confirmed abuse, 0 = false positive.
create table if not exists public.training_labels (
  risk_score_id uuid primary key references public.risk_scores (id),
  alert_id uuid not null references public.risk_alerts (id),
  label smallint not null check (label in (0, 1)),
  analyst_id uuid not null references public.staff (user_id),
  model_version text not null,
  features jsonb not null,
  updated_at timestamptz not null default now()
);

-- SHAP values and the LLM evidence summary, cached per alert (investigate function).
create table if not exists public.alert_explanations (
  alert_id uuid primary key references public.risk_alerts (id),
  model_version text,
  shap jsonb,
  summary jsonb,
  summary_source text,
  created_at timestamptz not null default now()
);

alter table public.risk_alerts add column if not exists updated_at timestamptz not null default now();

-- INV-10: the audit log cannot be edited or deleted, by anyone.
create or replace function private.forbid_audit_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'alert_actions is append-only' using errcode = '42501';
end $$;
create or replace trigger alert_actions_append_only before update or delete on public.alert_actions
  for each row execute function private.forbid_audit_mutation();

alter table public.staff enable row level security;
alter table public.alert_actions enable row level security;
alter table public.training_labels enable row level security;
alter table public.alert_explanations enable row level security;
revoke all on public.staff, public.alert_actions, public.training_labels, public.alert_explanations
  from anon, authenticated;

alter table public.coach_llm_requests drop constraint if exists coach_llm_requests_action_check;
alter table public.coach_llm_requests
  add constraint coach_llm_requests_action_check check (action in ('CATEGORIZE', 'INSIGHTS', 'ASK', 'INVESTIGATE'));

--------------------------------------------------------------------------------
-- Staff accounts get no customer profile or wallet.
--------------------------------------------------------------------------------
create or replace function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'staff', 'false') = 'true' then
    return new;
  end if;

  insert into public.users (id, phone)
  values (new.id, '+' || ltrim(coalesce(new.phone, ''), '+'))
  on conflict (id) do nothing;

  insert into public.wallets (user_id, kind)
  values (new.id, 'customer')
  on conflict (user_id, kind) do nothing;

  return new;
end $$;

-- INV-01: a live session and a staff row, or 42501.
create or replace function private.require_analyst() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  if not exists (select 1 from public.staff s where s.user_id = v_uid) then
    raise exception 'NOT_ANALYST' using errcode = '42501';
  end if;
  return v_uid;
end $$;

-- What an analyst sees for a wallet: the business name, or a masked customer number.
create or replace function private.wallet_label(p_wallet uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'wallet_id', w.id,
    'kind', w.kind,
    'label', coalesce(w.merchant_name, w.agent_name, private.mask_phone(u.phone), 'System'),
    'ref', coalesce(w.merchant_id, w.agent_code),
    'risk_flagged', w.risk_flagged)
    from public.wallets w
    left join public.users u on u.id = w.user_id
   where w.id = p_wallet;
$$;

create or replace function private.alert_score(a public.risk_alerts) returns float8
language sql stable security definer set search_path = '' as $$
  select coalesce((a.summary ->> 'risk_score')::float8, (a.summary ->> 'score')::float8,
                  (select s.risk_score from public.risk_scores s where s.id = a.risk_score_id));
$$;

--------------------------------------------------------------------------------
-- Analyst RPCs
--------------------------------------------------------------------------------
create or replace function public.am_i_analyst() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  return exists (select 1 from public.staff s where s.user_id = v_uid);
end $$;

-- INV-02/09: queue with filters (dates, score range, status) and wallet search
-- (wallet id, merchant id, agent code or the last digits of a phone number).
create or replace function public.analyst_list_alerts(
  p_from timestamptz default null, p_to timestamptz default null,
  p_min_score float8 default null, p_max_score float8 default null,
  p_status text default null, p_wallet text default null,
  p_limit int default 50, p_before timestamptz default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_search text := nullif(trim(coalesce(p_wallet, '')), '');
begin
  perform private.require_analyst();
  return coalesce((
    select jsonb_agg(row order by (row ->> 'created_at') desc)
      from (
        select jsonb_build_object(
                 'id', a.id, 'kind', a.kind, 'status', a.status, 'created_at', a.created_at,
                 'score', private.alert_score(a), 'amount', (a.summary ->> 'amount')::numeric,
                 'flow', coalesce(a.summary ->> 'flow', case when a.kind = 'TXN' then 'PAYMENT' end),
                 'wallets', (select jsonb_agg(private.wallet_label(w)) from unnest(a.wallet_ids) w)) as row
          from public.risk_alerts a
         where (p_from is null or a.created_at >= p_from)
           and (p_to is null or a.created_at < p_to)
           and (p_status is null or a.status = p_status)
           and (p_before is null or a.created_at < p_before)
           and (p_min_score is null or private.alert_score(a) >= p_min_score)
           and (p_max_score is null or private.alert_score(a) <= p_max_score)
           and (v_search is null or exists (
                 select 1 from unnest(a.wallet_ids) w
                   join public.wallets wl on wl.id = w
                   left join public.users u on u.id = wl.user_id
                  where w::text = lower(v_search) or wl.merchant_id = upper(v_search) or wl.agent_code = upper(v_search)
                     or (length(v_search) >= 4 and u.phone like '%' || v_search)))
         order by a.created_at desc
         limit least(greatest(coalesce(p_limit, 50), 1), 200)
      ) q), '[]'::jsonb);
end $$;

-- INV-02/03/06/07: everything about one alert. For RING alerts, the money
-- flows among its wallets over the last 30 days form the network graph.
create or replace function public.analyst_get_alert(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  a public.risk_alerts;
  s public.risk_scores;
  t public.transactions;
begin
  perform private.require_analyst();
  select * into a from public.risk_alerts where id = p_id;
  if a.id is null then
    raise exception 'ALERT_NOT_FOUND' using errcode = '22023';
  end if;
  select * into s from public.risk_scores where id = a.risk_score_id;
  select * into t from public.transactions where id = a.transaction_id;

  return jsonb_build_object(
    'alert', jsonb_build_object('id', a.id, 'kind', a.kind, 'status', a.status, 'created_at', a.created_at,
                                'score', private.alert_score(a), 'summary', a.summary),
    'score', case when s.id is null then null else jsonb_build_object(
      'id', s.id, 'risk_score', s.risk_score, 'anomaly_score', s.anomaly_score, 'network_risk', s.network_risk,
      'low_confidence', s.low_confidence, 'decision', s.decision, 'source', s.source,
      'model_version', s.model_version, 'features', s.features) end,
    'transaction', case when t.id is null then null else jsonb_build_object(
      'id', t.id, 'type', t.type, 'amount', t.amount, 'created_at', t.created_at,
      'payer', private.wallet_label(t.payer_wallet_id), 'payee', private.wallet_label(t.payee_wallet_id)) end,
    'wallets', (select jsonb_agg(private.wallet_label(w)) from unnest(a.wallet_ids) w),
    'graph', case when a.kind = 'RING' then jsonb_build_object(
      'nodes', (select jsonb_agg(private.wallet_label(w)) from unnest(a.wallet_ids) w),
      'edges', coalesce((
        select jsonb_agg(jsonb_build_object('from', e.payer_wallet_id, 'to', e.payee_wallet_id,
                                            'count', e.n, 'total', e.total) order by e.total desc)
          from (select tr.payer_wallet_id, tr.payee_wallet_id, count(*) as n, sum(tr.amount) as total
                  from public.transactions tr
                 where tr.payer_wallet_id = any (a.wallet_ids) and tr.payee_wallet_id = any (a.wallet_ids)
                   and tr.status = 'SUCCESS' and tr.created_at >= a.created_at - interval '30 days'
                 group by 1, 2) e), '[]'::jsonb)) end,
    'explanation', (select jsonb_build_object('model_version', x.model_version, 'shap', x.shap, 'summary', x.summary,
                                              'summary_source', x.summary_source, 'created_at', x.created_at)
                      from public.alert_explanations x where x.alert_id = a.id),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object('action', ac.action, 'note', ac.note, 'analyst', st.email,
                                          'created_at', ac.created_at) order by ac.created_at)
        from public.alert_actions ac join public.staff st on st.user_id = ac.analyst_id
       where ac.alert_id = a.id), '[]'::jsonb));
end $$;

-- INV-07/08: status change + audit row; confirmed / false positive -> training label.
create or replace function public.analyst_act(p_id uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_analyst();
  a public.risk_alerts;
  s public.risk_scores;
begin
  if p_action is null or p_action not in ('CONFIRMED', 'FALSE_POSITIVE', 'ESCALATED', 'NOTE') then
    raise exception 'INVALID_ACTION' using errcode = '22023';
  end if;
  if p_action = 'NOTE' and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'NOTE_REQUIRED' using errcode = '22023';
  end if;
  select * into a from public.risk_alerts where id = p_id for update;
  if a.id is null then
    raise exception 'ALERT_NOT_FOUND' using errcode = '22023';
  end if;

  insert into public.alert_actions (alert_id, analyst_id, action, note)
  values (p_id, v_uid, p_action, nullif(trim(coalesce(p_note, '')), ''));
  if p_action <> 'NOTE' then
    update public.risk_alerts set status = p_action, updated_at = now() where id = p_id;
  end if;

  -- Labels exist for alerts on a scored transaction; ring alerts have no single score.
  if p_action in ('CONFIRMED', 'FALSE_POSITIVE') and a.risk_score_id is not null then
    select * into s from public.risk_scores where id = a.risk_score_id;
    insert into public.training_labels (risk_score_id, alert_id, label, analyst_id, model_version, features)
    values (s.id, a.id, case when p_action = 'CONFIRMED' then 1 else 0 end, v_uid, s.model_version, s.features)
    on conflict (risk_score_id) do update
      set label = excluded.label, analyst_id = excluded.analyst_id, updated_at = now();
  end if;
  return jsonb_build_object('id', p_id, 'status', case when p_action = 'NOTE' then a.status else p_action end);
end $$;

--------------------------------------------------------------------------------
-- Service role: the `investigate` function stores SHAP + summary per alert.
--------------------------------------------------------------------------------
create or replace function public.store_alert_explanation(
  p_alert_id uuid, p_model_version text, p_shap jsonb, p_summary jsonb, p_summary_source text
) returns void
language sql security definer set search_path = '' as $$
  insert into public.alert_explanations (alert_id, model_version, shap, summary, summary_source)
  values (p_alert_id, p_model_version, p_shap, p_summary, p_summary_source)
  on conflict (alert_id) do update
    set model_version = excluded.model_version, shap = coalesce(excluded.shap, public.alert_explanations.shap),
        summary = coalesce(excluded.summary, public.alert_explanations.summary),
        summary_source = coalesce(excluded.summary_source, public.alert_explanations.summary_source),
        created_at = now();
$$;

revoke all on function
  private.require_analyst(), private.wallet_label(uuid), private.alert_score(public.risk_alerts),
  private.forbid_audit_mutation()
  from public, anon, authenticated;
revoke all on function
  public.am_i_analyst(),
  public.analyst_list_alerts(timestamptz, timestamptz, float8, float8, text, text, int, timestamptz),
  public.analyst_get_alert(uuid),
  public.analyst_act(uuid, text, text),
  public.store_alert_explanation(uuid, text, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function
  public.am_i_analyst(),
  public.analyst_list_alerts(timestamptz, timestamptz, float8, float8, text, text, int, timestamptz),
  public.analyst_get_alert(uuid),
  public.analyst_act(uuid, text, text)
  to authenticated;
grant execute on function public.store_alert_explanation(uuid, text, jsonb, jsonb, text) to service_role;
