-- Phase 1 core schema: users, wallets, transactions, double-entry ledger.
-- Every statement is re-runnable (TC-P1-DB-02).

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

do $$ begin create type public.user_role as enum ('customer', 'merchant'); exception when duplicate_object then null; end $$;
do $$ begin create type public.wallet_kind as enum ('customer', 'merchant', 'system'); exception when duplicate_object then null; end $$;
do $$ begin create type public.txn_status as enum ('PENDING', 'SUCCESS', 'FAILED'); exception when duplicate_object then null; end $$;
do $$ begin create type public.txn_type as enum ('PAYMENT', 'TOPUP'); exception when duplicate_object then null; end $$;
do $$ begin create type public.ledger_direction as enum ('DEBIT', 'CREDIT'); exception when duplicate_object then null; end $$;

-- Single-row runtime configuration.
create table if not exists public.app_config (
  id boolean primary key default true check (id),
  per_txn_limit numeric(14, 2) not null default 25000,
  pin_max_attempts int not null default 3,
  pin_lock_minutes int not null default 30,
  otp_max_attempts int not null default 5,
  otp_lock_minutes int not null default 15,
  otp_expiry_seconds int not null default 300
);
insert into public.app_config (id) values (true) on conflict (id) do nothing;

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text not null unique,
  full_name text,
  role public.user_role not null default 'customer',
  pin_hash text,
  pin_failed_attempts int not null default 0 check (pin_failed_attempts >= 0),
  pin_locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete restrict,
  kind public.wallet_kind not null default 'customer',
  balance numeric(14, 2) not null default 0,
  currency char(3) not null default 'BDT',
  merchant_id text unique,
  merchant_name text,
  status text not null default 'active' check (status in ('active', 'frozen')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The system treasury is the only wallet allowed below zero (it issues top-ups).
  constraint wallets_balance_non_negative check (balance >= 0 or kind = 'system'),
  constraint wallets_owner_matches_kind check ((kind = 'system') = (user_id is null)),
  constraint wallets_merchant_fields check ((kind = 'merchant') = (merchant_id is not null and merchant_name is not null)),
  constraint wallets_one_per_kind unique (user_id, kind)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  type public.txn_type not null default 'PAYMENT',
  status public.txn_status not null,
  payer_wallet_id uuid not null references public.wallets (id),
  payee_wallet_id uuid not null references public.wallets (id),
  amount numeric(14, 2) not null check (amount > 0),
  idempotency_key uuid not null,
  note_enc bytea,
  counterparty_enc bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_distinct_wallets check (payer_wallet_id <> payee_wallet_id),
  constraint transactions_idempotency unique (payer_wallet_id, idempotency_key)
);
create index if not exists transactions_payer_created_idx on public.transactions (payer_wallet_id, created_at desc);
create index if not exists transactions_payee_created_idx on public.transactions (payee_wallet_id, created_at desc);

create table if not exists public.ledger_entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.transactions (id),
  wallet_id uuid not null references public.wallets (id),
  direction public.ledger_direction not null,
  amount numeric(14, 2) not null check (amount > 0),
  balance_after numeric(14, 2) not null,
  created_at timestamptz not null default now()
);
create index if not exists ledger_entries_txn_idx on public.ledger_entries (transaction_id);
create index if not exists ledger_entries_wallet_idx on public.ledger_entries (wallet_id, created_at desc);

-- Per-phone OTP attempt tracking, written only by the `otp` Edge Function (service role).
create table if not exists public.otp_attempts (
  phone text primary key,
  failed_count int not null default 0,
  locked_until timestamptz,
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

-- updated_at maintenance (TC-P1-DB-08). timestamptz is stored as UTC.
create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace trigger users_set_updated_at before update on public.users
  for each row execute function private.set_updated_at();
create or replace trigger wallets_set_updated_at before update on public.wallets
  for each row execute function private.set_updated_at();
create or replace trigger transactions_set_updated_at before update on public.transactions
  for each row execute function private.set_updated_at();
create or replace trigger otp_attempts_set_updated_at before update on public.otp_attempts
  for each row execute function private.set_updated_at();

-- The ledger is append-only.
create or replace function private.forbid_ledger_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'ledger_entries is append-only' using errcode = '42501';
end $$;

create or replace trigger ledger_entries_append_only before update or delete on public.ledger_entries
  for each row execute function private.forbid_ledger_mutation();

-- Every new auth user gets a profile and a zero-balance customer wallet (TC-P1-AUTH-01).
create or replace function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, phone)
  values (new.id, '+' || ltrim(coalesce(new.phone, ''), '+'))
  on conflict (id) do nothing;

  insert into public.wallets (user_id, kind)
  values (new.id, 'customer')
  on conflict (user_id, kind) do nothing;

  return new;
end $$;

create or replace trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- System treasury wallet used to issue top-ups so every balance is backed by ledger entries.
insert into public.wallets (id, user_id, kind)
values ('00000000-0000-0000-0000-00000000a001', null, 'system')
on conflict (id) do nothing;
