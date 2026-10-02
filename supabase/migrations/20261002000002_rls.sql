-- Row Level Security: clients may only read their own rows and may never write
-- directly. All money movement goes through SECURITY DEFINER functions
-- (TC-P1-DB-05, TC-P1-DB-06).

alter table public.app_config enable row level security;
alter table public.users enable row level security;
alter table public.wallets enable row level security;
alter table public.transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.otp_attempts enable row level security;

revoke all on public.app_config, public.users, public.wallets, public.transactions,
  public.ledger_entries, public.otp_attempts from anon, authenticated;

-- Read-only grants. pin_hash is deliberately not granted.
grant select (id, phone, full_name, role, pin_failed_attempts, pin_locked_until, created_at, updated_at)
  on public.users to authenticated;
grant select on public.wallets, public.transactions, public.ledger_entries to authenticated;

drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists wallets_select_own on public.wallets;
create policy wallets_select_own on public.wallets
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists transactions_select_own on public.transactions;
create policy transactions_select_own on public.transactions
  for select to authenticated using (
    exists (
      select 1 from public.wallets w
      where w.id in (payer_wallet_id, payee_wallet_id) and w.user_id = (select auth.uid())
    )
  );

drop policy if exists ledger_entries_select_own on public.ledger_entries;
create policy ledger_entries_select_own on public.ledger_entries
  for select to authenticated using (
    exists (select 1 from public.wallets w where w.id = wallet_id and w.user_id = (select auth.uid()))
  );

-- Nothing in the private schema is reachable through the API.
revoke all on schema private from public, anon, authenticated;
