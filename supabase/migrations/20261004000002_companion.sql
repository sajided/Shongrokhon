-- Phase 4: Smart Spending Companion (TC-P4-SSC-*) and user preferences.
--
-- Before a cash-out's PIN step the app calls cashout_nudge(). When the user is
-- about to make their Nth cash-out in 30 days (app_config.nudge_min_cashouts_30d
-- earlier ones), it returns show = true with the fee they would save and the
-- digital alternatives. It is advice only: "Continue" runs the normal cash-out
-- through the risk pipeline, and Phase 2/4 risk rules apply whether or not
-- nudges are on (SSC-05/09). Shown/choice events feed the cash-out reduction
-- metric (SSC-07, TC-MET-03).

alter table public.users
  add column if not exists language text not null default 'en',
  add column if not exists bangla_digits boolean not null default true,
  add column if not exists nudges_enabled boolean not null default true;
do $$ begin
  alter table public.users add constraint users_language check (language in ('en', 'bn'));
exception when duplicate_object then null; end $$;
grant select (language, bangla_digits, nudges_enabled) on public.users to authenticated;

alter table public.app_config
  add column if not exists nudge_min_cashouts_30d int not null default 4,
  add column if not exists nudge_max_per_day int not null default 2;

create table if not exists public.nudge_events (
  id bigint generated always as identity primary key,
  nudge_id uuid not null,
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null check (kind in ('SHOWN', 'CHOICE')),
  choice text check (choice in ('PAY_QR', 'BILL_PAY', 'SEND_MONEY', 'CONTINUE', 'CANCEL')),
  amount numeric(14, 2),
  cashouts_30d int,
  created_at timestamptz not null default now(),
  check ((kind = 'CHOICE') = (choice is not null))
);
create unique index if not exists nudge_events_one_choice on public.nudge_events (nudge_id) where kind = 'CHOICE';
create index if not exists nudge_events_user_idx on public.nudge_events (user_id, created_at desc);

alter table public.nudge_events enable row level security;
revoke all on public.nudge_events from anon, authenticated;

--------------------------------------------------------------------------------
-- Preferences
--------------------------------------------------------------------------------
create or replace function public.get_my_profile() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  return (
    select jsonb_build_object(
      'user_id', u.id,
      'phone', u.phone,
      'full_name', u.full_name,
      'role', u.role,
      'has_pin', u.pin_hash is not null,
      'pin_locked_until', u.pin_locked_until,
      'wallet_id', w.id,
      'balance', w.balance,
      'currency', w.currency,
      'language', u.language,
      'bangla_digits', u.bangla_digits,
      'nudges_enabled', u.nudges_enabled
    )
    from public.users u
    join public.wallets w on w.user_id = u.id and w.kind = 'customer'
    where u.id = v_uid
  );
end $$;

-- Null leaves a setting unchanged.
create or replace function public.set_my_preferences(
  p_language text default null, p_bangla_digits boolean default null, p_nudges_enabled boolean default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  if p_language is not null and p_language not in ('en', 'bn') then
    raise exception 'INVALID_LANGUAGE' using errcode = '22023';
  end if;
  update public.users
     set language = coalesce(p_language, language),
         bangla_digits = coalesce(p_bangla_digits, bangla_digits),
         nudges_enabled = coalesce(p_nudges_enabled, nudges_enabled)
   where id = v_uid;
end $$;

--------------------------------------------------------------------------------
-- Companion
--------------------------------------------------------------------------------
create or replace function public.cashout_nudge(p_amount numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
  v_cfg public.app_config;
  v_user public.users;
  v_wallet uuid := private.customer_wallet(v_uid);
  v_count int;
  v_shown_today int;
  v_nudge uuid := gen_random_uuid();
begin
  select * into v_cfg from public.app_config where id;
  select * into v_user from public.users where id = v_uid;
  if not v_user.nudges_enabled then
    return jsonb_build_object('show', false, 'reason', 'OPTED_OUT');
  end if;

  select count(*) into v_count from public.transactions t
   where t.payer_wallet_id = v_wallet and t.type = 'CASHOUT' and t.status = 'SUCCESS'
     and t.created_at >= now() - interval '30 days';
  if v_count < v_cfg.nudge_min_cashouts_30d then
    return jsonb_build_object('show', false, 'reason', 'BELOW_THRESHOLD', 'cashouts_30d', v_count);
  end if;

  -- Frequency cap (SSC-06): at most nudge_max_per_day interceptions per Dhaka day.
  select count(*) into v_shown_today from public.nudge_events e
   where e.user_id = v_uid and e.kind = 'SHOWN'
     and e.created_at >= date_trunc('day', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka';
  if v_shown_today >= v_cfg.nudge_max_per_day then
    return jsonb_build_object('show', false, 'reason', 'CAPPED', 'cashouts_30d', v_count);
  end if;

  insert into public.nudge_events (nudge_id, user_id, kind, amount, cashouts_30d)
  values (v_nudge, v_uid, 'SHOWN', p_amount, v_count);
  return jsonb_build_object(
    'show', true,
    'nudge_id', v_nudge,
    'cashouts_30d', v_count,
    'nth', v_count + 1,
    'fee', case when p_amount > 0 then round(p_amount * v_cfg.cashout_fee_rate, 2) else 0 end,
    'fee_rate', v_cfg.cashout_fee_rate,
    'alternatives', jsonb_build_array('PAY_QR', 'BILL_PAY', 'SEND_MONEY'));
end $$;

-- Records what the user did with an interception (once per nudge).
create or replace function public.log_nudge_choice(p_nudge_id uuid, p_choice text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
begin
  if p_choice is null or p_choice not in ('PAY_QR', 'BILL_PAY', 'SEND_MONEY', 'CONTINUE', 'CANCEL') then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  if not exists (select 1 from public.nudge_events e
                  where e.nudge_id = p_nudge_id and e.user_id = v_uid and e.kind = 'SHOWN') then
    raise exception 'NUDGE_NOT_FOUND' using errcode = '22023';
  end if;
  insert into public.nudge_events (nudge_id, user_id, kind, choice)
  values (p_nudge_id, v_uid, 'CHOICE', p_choice)
  on conflict (nudge_id) where kind = 'CHOICE' do nothing;
end $$;

revoke all on function
  public.get_my_profile(),
  public.set_my_preferences(text, boolean, boolean),
  public.cashout_nudge(numeric),
  public.log_nudge_choice(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.get_my_profile(),
  public.set_my_preferences(text, boolean, boolean),
  public.cashout_nudge(numeric),
  public.log_nudge_choice(uuid, text)
  to authenticated;
