-- Phase 4: success-metric analytics (testcase.md §5, TC-MET-01..05).
--
-- Events carry no personal data (MET-05): the user is an HMAC of the user id
-- (key in Vault), event names and property keys are allowlisted, and property
-- values must be short codes, never free text. A screen view repeated within
-- 30 seconds is the same visit and is not counted twice (MET-04).
-- The metric views live in `private` (not exposed by the API).

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'analytics_user_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'analytics_user_key',
                                'HMAC key for analytics_events.user_ref');
  end if;
end $$;

create or replace function private.user_ref(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select encode(extensions.hmac(p_user::text,
                                (select decrypted_secret from vault.decrypted_secrets where name = 'analytics_user_key' limit 1),
                                'sha256'), 'hex');
$$;

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  user_ref text not null,
  event text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_ref_idx on public.analytics_events (user_ref, event, created_at desc);
create index if not exists analytics_events_time_idx on public.analytics_events (created_at);
alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;

-- Allowed events and, for each, the allowed property keys and values.
create or replace function private.event_allowed(p_event text, p_props jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  allowed_keys text[] := case p_event
    when 'screen_view' then array['screen']
    when 'insights_loaded' then array['period', 'source']
    when 'ask_coach' then array['topic']
    when 'goal_created' then array['status']
    when 'forecast_warning' then array['action']
    else null end;
begin
  if allowed_keys is null or jsonb_typeof(p_props) <> 'object' then
    return false;
  end if;
  for k, v in select * from jsonb_each(p_props) loop
    if not (k = any (allowed_keys)) or jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[A-Za-z0-9_]{1,32}$' then
      return false;
    end if;
  end loop;
  if p_event = 'screen_view' and (p_props ->> 'screen') not in
     ('home', 'coach', 'savings', 'forecast', 'cashout', 'send', 'bills', 'settings') then
    return false;
  end if;
  return true;
end $$;

create or replace function public.log_event(p_event text, p_props jsonb default '{}'::jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
  v_ref text;
begin
  if not private.event_allowed(p_event, coalesce(p_props, '{}'::jsonb)) then
    raise exception 'EVENT_NOT_ALLOWED' using errcode = '22023';
  end if;
  v_ref := private.user_ref(v_uid);
  -- MET-04: one visit = one event.
  if exists (select 1 from public.analytics_events e
              where e.user_ref = v_ref and e.event = p_event and e.props = coalesce(p_props, '{}'::jsonb)
                and e.created_at > now() - interval '30 seconds') then
    return false;
  end if;
  insert into public.analytics_events (user_ref, event, props) values (v_ref, p_event, coalesce(p_props, '{}'::jsonb));
  return true;
end $$;

--------------------------------------------------------------------------------
-- Metric views (private: reporting only)
--------------------------------------------------------------------------------
-- MET-04: daily active users per coach screen.
create or replace view private.metrics_daily_active as
  select (created_at at time zone 'Asia/Dhaka')::date as day, props ->> 'screen' as screen,
         count(distinct user_ref) as users, count(*) as views
    from public.analytics_events
   where event = 'screen_view' and props ->> 'screen' in ('coach', 'savings', 'forecast')
   group by 1, 2;

-- MET-03: monthly cash-outs per user, for users who opened the coach that month vs those who did not.
-- Significance needs real users and a control group; this is the measurement.
create or replace view private.metrics_cashouts_by_engagement as
  with months as (
    select w.user_id, private.user_ref(w.user_id) as ref, date_trunc('month', t.created_at at time zone 'Asia/Dhaka') as month,
           count(*) as cashouts
      from public.transactions t join public.wallets w on w.id = t.payer_wallet_id and w.kind = 'customer'
     where t.type = 'CASHOUT' and t.status = 'SUCCESS'
     group by 1, 2, 3
  ), engaged as (
    select distinct user_ref, date_trunc('month', created_at at time zone 'Asia/Dhaka') as month
      from public.analytics_events where event = 'screen_view' and props ->> 'screen' = 'coach'
  )
  select m.month, (e.user_ref is not null) as coach_engaged, count(*) as users,
         round(avg(m.cashouts), 2) as avg_cashouts_per_user
    from months m left join engaged e on e.user_ref = m.ref and e.month = m.month
   group by 1, 2;

-- MET-03 also: what users chose when the companion intercepted a cash-out.
create or replace view private.metrics_nudge_outcomes as
  select date_trunc('week', created_at at time zone 'Asia/Dhaka') as week, choice, count(*) as times
    from public.nudge_events where kind = 'CHOICE'
   group by 1, 2;

-- MET-01: precision of alerts as judged by analysts (weekly), from the training labels.
create or replace view private.metrics_alert_quality as
  select date_trunc('week', updated_at) as week,
         count(*) filter (where label = 1) as confirmed,
         count(*) filter (where label = 0) as false_positives,
         round(count(*) filter (where label = 1)::numeric / nullif(count(*), 0), 3) as precision
    from public.training_labels
   group by 1;

revoke all on private.metrics_daily_active, private.metrics_cashouts_by_engagement, private.metrics_nudge_outcomes,
  private.metrics_alert_quality from public, anon, authenticated;
revoke all on function private.user_ref(uuid), private.event_allowed(text, jsonb) from public, anon, authenticated;
revoke all on function public.log_event(text, jsonb) from public, anon, authenticated;
grant execute on function public.log_event(text, jsonb) to authenticated;

-- Account deletion (SEC-05) also removes analytics events.
create or replace function private.delete_user_analytics(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.analytics_events where user_ref = private.user_ref(p_user);
$$;
revoke all on function private.delete_user_analytics(uuid) from public, anon, authenticated;
