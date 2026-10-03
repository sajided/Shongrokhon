-- Phase 3: profile engine & AI coach.
--
-- Every number the coach shows or says is computed here, in SQL. The `coach`
-- Edge Function sends the LLM an anonymised summary (private.coach_summary with
-- p_names = false: categories, totals, "Merchant A" labels, no names, phones,
-- wallet ids or notes) and the LLM may only refer to figures through
-- placeholders the function fills in (TC-P3-MW-03, TC-P3-LLM-04).
-- Savings goals are records only; no money moves.

do $$ begin
  create type public.spend_category as enum
    ('FOOD', 'TRANSPORT', 'UTILITIES', 'BILLS', 'SHOPPING', 'HEALTH', 'EDUCATION', 'SAVINGS', 'CASH_OUT', 'OTHERS');
exception when duplicate_object then null; end $$;

alter table public.app_config
  add column if not exists coach_rate_per_minute int not null default 10,
  add column if not exists coach_llm_timeout_ms int not null default 8000,
  add column if not exists coach_min_txns int not null default 5,
  add column if not exists coach_llm_mode text not null default 'live',
  add column if not exists coach_mock_delay_ms int not null default 0,
  add column if not exists forecast_low_balance numeric(14, 2) not null default 500,
  add column if not exists savings_max_target numeric(14, 2) not null default 1000000;

do $$ begin
  alter table public.app_config add constraint app_config_coach_llm_mode check (coach_llm_mode in ('live', 'mock', 'off'));
exception when duplicate_object then null; end $$;

--------------------------------------------------------------------------------
-- Tables
--------------------------------------------------------------------------------
-- One category per merchant wallet. Filled by the coach function: the LLM sees
-- only merchant business names (no user data); keyword rules are the fallback.
create table if not exists public.merchant_categories (
  wallet_id uuid primary key references public.wallets (id),
  category public.spend_category not null,
  source text not null check (source in ('LLM', 'RULE', 'MOCK')),
  model text,
  updated_at timestamptz not null default now()
);

-- Last generated insights per user and period; reused while data_hash matches (TC-P3-MW-08).
create table if not exists public.coach_insight_cache (
  user_id uuid not null references public.users (id) on delete cascade,
  period text not null,
  data_hash text not null,
  payload jsonb not null,
  source text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, period)
);

-- Exactly what was sent to the LLM, for audit (TC-P3-MW-03). Payloads contain no PII by construction.
create table if not exists public.coach_llm_requests (
  id bigint generated always as identity primary key,
  user_id uuid references public.users (id) on delete cascade,
  action text not null check (action in ('CATEGORIZE', 'INSIGHTS', 'ASK')),
  payload jsonb not null,
  model text,
  latency_ms int,
  outcome text not null,
  created_at timestamptz not null default now()
);
create index if not exists coach_llm_requests_user_idx on public.coach_llm_requests (user_id, created_at desc);

-- Fixed one-minute windows per user and bucket (TC-P3-MW-07).
create table if not exists public.rate_limits (
  user_id uuid not null references public.users (id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (user_id, bucket)
);

create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  target_amount numeric(14, 2) not null check (target_amount > 0),
  months int not null check (months between 1 and 60),
  start_date date not null default (now() at time zone 'Asia/Dhaka')::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists savings_goals_user_idx on public.savings_goals (user_id, created_at);

create table if not exists public.savings_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.savings_goals (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists savings_contributions_goal_idx on public.savings_contributions (goal_id, created_at);

create or replace trigger savings_goals_set_updated_at before update on public.savings_goals
  for each row execute function private.set_updated_at();

--------------------------------------------------------------------------------
-- Access: coach tables are server-only; users read their own goals.
--------------------------------------------------------------------------------
alter table public.merchant_categories enable row level security;
alter table public.coach_insight_cache enable row level security;
alter table public.coach_llm_requests enable row level security;
alter table public.rate_limits enable row level security;
alter table public.savings_goals enable row level security;
alter table public.savings_contributions enable row level security;

revoke all on public.merchant_categories, public.coach_insight_cache, public.coach_llm_requests,
  public.rate_limits, public.savings_goals, public.savings_contributions
  from anon, authenticated;
grant select on public.savings_goals, public.savings_contributions to authenticated;

drop policy if exists savings_goals_select_own on public.savings_goals;
create policy savings_goals_select_own on public.savings_goals
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists savings_contributions_select_own on public.savings_contributions;
create policy savings_contributions_select_own on public.savings_contributions
  for select to authenticated using (
    exists (select 1 from public.savings_goals g where g.id = goal_id and g.user_id = (select auth.uid()))
  );

--------------------------------------------------------------------------------
-- Profile engine
--------------------------------------------------------------------------------
create or replace function private.customer_wallet(p_user uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select w.id from public.wallets w where w.user_id = p_user and w.kind = 'customer';
$$;

-- Rolling windows: WEEK = 7 days, MONTH = 30 days, 3M = 90 days.
create or replace function private.period_start(p_period text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  return case p_period
    when 'WEEK' then now() - interval '7 days'
    when 'MONTH' then now() - interval '30 days'
    when '3M' then now() - interval '90 days'
    else null
  end;
end $$;

-- A customer wallet's transactions with a coach category:
--   kind INCOME (top-up in), SPEND (payment out), CASH_OUT (cash-out).
create or replace function private.coach_txns(p_wallet uuid, p_from timestamptz, p_to timestamptz)
returns table (id uuid, kind text, category text, amount numeric, created_at timestamptz, counterparty uuid)
language sql stable security definer set search_path = '' as $$
  select t.id,
         case when t.payee_wallet_id = p_wallet then 'INCOME'
              when t.type = 'CASHOUT' then 'CASH_OUT'
              else 'SPEND' end,
         case when t.payee_wallet_id = p_wallet then 'INCOME'
              when t.type = 'CASHOUT' then 'CASH_OUT'
              else coalesce(mc.category::text, 'OTHERS') end,
         t.amount,
         t.created_at,
         case when t.payer_wallet_id = p_wallet and t.type = 'PAYMENT' then t.payee_wallet_id end
    from public.transactions t
    left join public.merchant_categories mc on mc.wallet_id = t.payee_wallet_id
   where t.status = 'SUCCESS'
     and (t.payer_wallet_id = p_wallet or t.payee_wallet_id = p_wallet)
     and t.created_at >= p_from and t.created_at < p_to;
$$;

-- Bounded-size summary for any history length (TC-P3-MW-04). Spending is
-- payments + cash-outs, excluding SAVINGS (money moved to the user's own bank
-- or deposit scheme). p_names adds merchant names for the user's own dashboard;
-- the LLM payload is always built with p_names = false.
create or replace function private.coach_summary(p_user uuid, p_from timestamptz, p_to timestamptz, p_names boolean)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_wallet uuid := private.customer_wallet(p_user);
  v_out jsonb;
begin
  with tx as (
    select * from private.coach_txns(v_wallet, p_from, p_to)
  ), spend as (
    select * from tx where kind in ('SPEND', 'CASH_OUT') and category <> 'SAVINGS'
  ), totals as (
    select (select count(*) from tx) as txn_count,
           coalesce((select sum(amount) from tx where kind = 'INCOME'), 0) as income,
           coalesce((select sum(amount) from spend), 0) as spending,
           coalesce((select sum(amount) from tx where category = 'SAVINGS'), 0) as saved,
           coalesce((select sum(amount) from tx where kind = 'CASH_OUT'), 0) as cashout,
           (select count(*) from tx where kind = 'CASH_OUT') as cashout_count
  ), cats as (
    select s.category, sum(s.amount) as total, count(*) as cnt
      from spend s group by s.category
  ), merch as (
    select x.counterparty, x.category, sum(x.amount) as total, count(*) as cnt,
           row_number() over (order by sum(x.amount) desc, x.counterparty) as rn
      from tx x where x.kind = 'SPEND' group by x.counterparty, x.category
  ), months as (
    select to_char(x.created_at at time zone 'Asia/Dhaka', 'YYYY-MM') as month,
           coalesce(sum(x.amount) filter (where x.kind = 'INCOME'), 0) as income,
           coalesce(sum(x.amount) filter (where x.kind in ('SPEND', 'CASH_OUT') and x.category <> 'SAVINGS'), 0) as spending,
           coalesce(sum(x.amount) filter (where x.kind = 'CASH_OUT'), 0) as cashout
      from tx x group by 1
  )
  select jsonb_build_object(
    'txn_count', t.txn_count,
    'income', t.income,
    'spending', t.spending,
    'saved', t.saved,
    'net', t.income - t.spending,
    'cashout', jsonb_build_object(
      'total', t.cashout,
      'count', t.cashout_count,
      'share', case when t.spending > 0 then round(t.cashout / t.spending, 4) else 0 end,
      'level', case when t.spending = 0 then 'LOW'
                    when t.cashout / t.spending >= 0.4 then 'HIGH'
                    when t.cashout / t.spending >= 0.2 then 'MEDIUM'
                    else 'LOW' end),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'category', c.category, 'total', c.total, 'count', c.cnt,
               'share', case when t.spending > 0 then round(c.total / t.spending, 4) else 0 end)
             order by c.total desc, c.category)
        from cats c), '[]'::jsonb),
    'merchants', coalesce((
      select jsonb_agg(jsonb_build_object('label', 'Merchant ' || chr(64 + m.rn::int), 'category', m.category,
                                          'total', m.total, 'count', m.cnt)
                       || case when p_names then jsonb_build_object('name', w.merchant_name) else '{}'::jsonb end
             order by m.rn)
        from merch m join public.wallets w on w.id = m.counterparty
       where m.rn <= 8), '[]'::jsonb),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('month', mo.month, 'income', mo.income,
                                          'spending', mo.spending, 'cashout', mo.cashout) order by mo.month)
        from months mo), '[]'::jsonb)
  ) into v_out
  from totals t;

  return v_out || jsonb_build_object('data_hash', md5(v_out::text));
end $$;

-- Average monthly surplus (income - spending) over the last 90 days, the basis
-- of the savings planner (TC-P3-SAVE-01/02). Null with under 30 days of history.
create or replace function private.monthly_surplus(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_wallet uuid := private.customer_wallet(p_user);
  v_first timestamptz;
  v_days numeric;
  v_months numeric;
  v_income numeric;
  v_spending numeric;
begin
  select min(t.created_at) into v_first
    from public.transactions t
   where t.status = 'SUCCESS' and (t.payer_wallet_id = v_wallet or t.payee_wallet_id = v_wallet);
  v_days := coalesce(extract(epoch from now() - v_first) / 86400, 0);
  if v_days < 30 then
    return jsonb_build_object('surplus', null, 'income', null, 'spending', null, 'history_days', floor(v_days));
  end if;
  v_months := least(v_days, 90) / 30;
  select coalesce(sum(amount) filter (where kind = 'INCOME'), 0),
         coalesce(sum(amount) filter (where kind in ('SPEND', 'CASH_OUT') and category <> 'SAVINGS'), 0)
    into v_income, v_spending
    from private.coach_txns(v_wallet, now() - interval '90 days', now());
  return jsonb_build_object(
    'surplus', round((v_income - v_spending) / v_months, 2),
    'income', round(v_income / v_months, 2),
    'spending', round(v_spending / v_months, 2),
    'history_days', floor(v_days));
end $$;

-- Merchants the user has paid in the last year that have no category yet.
create or replace function private.uncategorized_merchants(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('wallet_id', w.id, 'name', w.merchant_name) order by w.id), '[]'::jsonb)
    from (
      select distinct t.payee_wallet_id as id
        from public.transactions t
       where t.payer_wallet_id = private.customer_wallet(p_user)
         and t.type = 'PAYMENT' and t.status = 'SUCCESS'
         and t.created_at >= now() - interval '365 days'
         and not exists (select 1 from public.merchant_categories mc where mc.wallet_id = t.payee_wallet_id)
       limit 50
    ) m
    join public.wallets w on w.id = m.id;
$$;

--------------------------------------------------------------------------------
-- User RPCs
--------------------------------------------------------------------------------
-- Coach dashboard numbers (TC-P3-COACH-01..05). Merchant names are the user's own data here.
create or replace function public.get_coach_dashboard(p_period text default 'MONTH') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
  v_from timestamptz := private.period_start(p_period);
begin
  if v_from is null then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  return private.coach_summary(v_uid, v_from, now(), true)
      || jsonb_build_object('period', p_period, 'from', v_from, 'to', now(),
                            'uncategorized', jsonb_array_length(private.uncategorized_merchants(v_uid)));
end $$;

-- Raw daily flows for the cash-flow forecast (src/lib/forecast.ts, TC-P3-FCST-*).
create or replace function public.get_cash_history(p_days int default 90) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
  v_wallet uuid := private.customer_wallet(v_uid);
  v_days int := least(greatest(coalesce(p_days, 90), 1), 180);
begin
  return jsonb_build_object(
    'as_of', now(),
    'balance', (select w.balance from public.wallets w where w.id = v_wallet),
    'low_balance', (select c.forecast_low_balance from public.app_config c where c.id),
    'first_txn_at', (select min(t.created_at) from public.transactions t
                      where t.status = 'SUCCESS' and (t.payer_wallet_id = v_wallet or t.payee_wallet_id = v_wallet)),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', x.created_at, 'kind', x.kind, 'category', x.category, 'amount', x.amount,
               'key', coalesce(x.counterparty::text, x.kind), 'name', w.merchant_name)
             order by x.created_at, x.id)
        from private.coach_txns(v_wallet, now() - make_interval(days => v_days), now()) x
        left join public.wallets w on w.id = x.counterparty), '[]'::jsonb));
end $$;

--------------------------------------------------------------------------------
-- Savings planner (records only, TC-P3-SAVE-*)
--------------------------------------------------------------------------------
create or replace function private.validate_goal(p_name text, p_target numeric, p_months int) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_name is null or length(trim(p_name)) not between 1 and 60 then
    raise exception 'GOAL_NAME_INVALID' using errcode = '22023';
  end if;
  if p_target is null or p_target <= 0 or p_target <> round(p_target, 2) then
    raise exception 'GOAL_AMOUNT_INVALID' using errcode = '22023';
  end if;
  if p_target > (select c.savings_max_target from public.app_config c where c.id) then
    raise exception 'GOAL_AMOUNT_TOO_LARGE' using errcode = '22023';
  end if;
  if p_months is null or p_months not between 1 and 60 then
    raise exception 'GOAL_MONTHS_INVALID' using errcode = '22023';
  end if;
end $$;

create or replace function public.create_savings_goal(p_name text, p_target numeric, p_months int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
  v_id uuid;
begin
  perform private.validate_goal(p_name, p_target, p_months);
  perform 1 from public.users where id = v_uid for update;  -- serialise the goal-count check
  if (select count(*) from public.savings_goals g where g.user_id = v_uid) >= 10 then
    raise exception 'GOAL_LIMIT_REACHED' using errcode = '22023';
  end if;
  insert into public.savings_goals (user_id, name, target_amount, months)
  values (v_uid, trim(p_name), p_target, p_months)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_savings_goal(p_id uuid, p_name text, p_target numeric, p_months int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  perform private.validate_goal(p_name, p_target, p_months);
  update public.savings_goals
     set name = trim(p_name), target_amount = p_target, months = p_months
   where id = p_id and user_id = v_uid;
  if not found then
    raise exception 'GOAL_NOT_FOUND' using errcode = '22023';
  end if;
end $$;

create or replace function public.delete_savings_goal(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  delete from public.savings_goals where id = p_id and user_id = v_uid;
  if not found then
    raise exception 'GOAL_NOT_FOUND' using errcode = '22023';
  end if;
end $$;

create or replace function public.add_savings_contribution(p_goal_id uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or p_amount > (select c.savings_max_target from public.app_config c where c.id) then
    raise exception 'CONTRIBUTION_INVALID' using errcode = '22023';
  end if;
  if not exists (select 1 from public.savings_goals g where g.id = p_goal_id and g.user_id = v_uid) then
    raise exception 'GOAL_NOT_FOUND' using errcode = '22023';
  end if;
  insert into public.savings_contributions (goal_id, amount) values (p_goal_id, p_amount);
end $$;

-- Goals with progress, plus the surplus the client-side planner (src/lib/savings.ts) checks them against.
create or replace function public.get_savings_goals() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  return jsonb_build_object(
    'surplus', private.monthly_surplus(v_uid),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'name', g.name, 'target_amount', g.target_amount, 'months', g.months,
               'start_date', g.start_date, 'created_at', g.created_at,
               'saved', coalesce(s.saved, 0),
               'remaining', greatest(g.target_amount - coalesce(s.saved, 0), 0))
             order by g.created_at, g.id)
        from public.savings_goals g
        left join lateral (
          select sum(c.amount) as saved from public.savings_contributions c where c.goal_id = g.id
        ) s on true
       where g.user_id = v_uid), '[]'::jsonb));
end $$;

--------------------------------------------------------------------------------
-- Service-role RPCs for the `coach` Edge Function
--------------------------------------------------------------------------------
-- Everything the function needs for one request: the anonymised summary,
-- merchants still to categorise, the cached result if the data is unchanged,
-- and the coach settings.
create or replace function public.coach_context(p_user_id uuid, p_period text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := private.period_start(p_period);
  v_summary jsonb;
  cfg public.app_config;
begin
  if v_from is null then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  select * into cfg from public.app_config where id;
  v_summary := private.coach_summary(p_user_id, v_from, now(), false);
  return jsonb_build_object(
    'summary', v_summary,
    'uncategorized', private.uncategorized_merchants(p_user_id),
    'cached', (select jsonb_build_object('payload', c.payload, 'source', c.source, 'created_at', c.created_at)
                 from public.coach_insight_cache c
                where c.user_id = p_user_id and c.period = p_period and c.data_hash = v_summary ->> 'data_hash'),
    'config', jsonb_build_object(
      'min_txns', cfg.coach_min_txns,
      'llm_mode', cfg.coach_llm_mode,
      'llm_timeout_ms', cfg.coach_llm_timeout_ms,
      'mock_delay_ms', cfg.coach_mock_delay_ms));
end $$;

-- p_items: [{wallet_id, category, source, model}]. An LLM category is never
-- overwritten by a keyword-rule one.
create or replace function public.record_merchant_categories(p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  insert into public.merchant_categories (wallet_id, category, source, model)
  select (i ->> 'wallet_id')::uuid, (i ->> 'category')::public.spend_category, i ->> 'source', i ->> 'model'
    from jsonb_array_elements(p_items) i
    join public.wallets w on w.id = (i ->> 'wallet_id')::uuid and w.kind = 'merchant'
  on conflict (wallet_id) do update
    set category = excluded.category, source = excluded.source, model = excluded.model, updated_at = now()
    where public.merchant_categories.source <> 'LLM' or excluded.source = 'LLM';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Counts one request; allowed while the count in the current minute is within
-- app_config.coach_rate_per_minute (TC-P3-MW-07).
create or replace function public.coach_rate_hit(p_user_id uuid, p_bucket text default 'coach') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_limit int := (select c.coach_rate_per_minute from public.app_config c where c.id);
  r public.rate_limits;
begin
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, now(), 0)
  on conflict (user_id, bucket) do nothing;
  select * into r from public.rate_limits where user_id = p_user_id and bucket = p_bucket for update;
  if r.window_start <= now() - interval '1 minute' then
    update public.rate_limits set window_start = now(), count = 1
     where user_id = p_user_id and bucket = p_bucket returning * into r;
  else
    update public.rate_limits set count = count + 1
     where user_id = p_user_id and bucket = p_bucket returning * into r;
  end if;
  return jsonb_build_object(
    'allowed', r.count <= v_limit,
    'retry_after', greatest(ceil(extract(epoch from r.window_start + interval '1 minute' - now())), 1)::int);
end $$;

create or replace function public.coach_cache_put(p_user_id uuid, p_period text, p_hash text, p_payload jsonb, p_source text)
returns void
language sql security definer set search_path = '' as $$
  insert into public.coach_insight_cache (user_id, period, data_hash, payload, source)
  values (p_user_id, p_period, p_hash, p_payload, p_source)
  on conflict (user_id, period) do update
    set data_hash = excluded.data_hash, payload = excluded.payload, source = excluded.source, created_at = now();
$$;

create or replace function public.log_coach_request(
  p_user_id uuid, p_action text, p_payload jsonb, p_model text, p_latency_ms int, p_outcome text
) returns void
language sql security definer set search_path = '' as $$
  insert into public.coach_llm_requests (user_id, action, payload, model, latency_ms, outcome)
  values (p_user_id, p_action, p_payload, p_model, p_latency_ms, p_outcome);
$$;

--------------------------------------------------------------------------------
-- Grants
--------------------------------------------------------------------------------
revoke all on function
  private.customer_wallet(uuid),
  private.period_start(text),
  private.coach_txns(uuid, timestamptz, timestamptz),
  private.coach_summary(uuid, timestamptz, timestamptz, boolean),
  private.monthly_surplus(uuid),
  private.uncategorized_merchants(uuid),
  private.validate_goal(text, numeric, int)
  from public, anon, authenticated;

revoke all on function
  public.get_coach_dashboard(text),
  public.get_cash_history(int),
  public.create_savings_goal(text, numeric, int),
  public.update_savings_goal(uuid, text, numeric, int),
  public.delete_savings_goal(uuid),
  public.add_savings_contribution(uuid, numeric),
  public.get_savings_goals(),
  public.coach_context(uuid, text),
  public.record_merchant_categories(jsonb),
  public.coach_rate_hit(uuid, text),
  public.coach_cache_put(uuid, text, text, jsonb, text),
  public.log_coach_request(uuid, text, jsonb, text, int, text)
  from public, anon, authenticated;

grant execute on function
  public.get_coach_dashboard(text),
  public.get_cash_history(int),
  public.create_savings_goal(text, numeric, int),
  public.update_savings_goal(uuid, text, numeric, int),
  public.delete_savings_goal(uuid),
  public.add_savings_contribution(uuid, numeric),
  public.get_savings_goals()
  to authenticated;

grant execute on function
  public.coach_context(uuid, text),
  public.record_merchant_categories(jsonb),
  public.coach_rate_hit(uuid, text),
  public.coach_cache_put(uuid, text, text, jsonb, text),
  public.log_coach_request(uuid, text, jsonb, text, int, text)
  to service_role;
