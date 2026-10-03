-- Phase 4: ledger reconciliation (TC-P4-PERF-03), run after every load test
-- (scripts/perf/payments.ts) and by pgTAP. Every wallet's balance must equal
-- its credits minus debits, and the ledger as a whole must balance.
create or replace function public.reconcile_ledger() returns jsonb
language sql stable security definer set search_path = '' as $$
  with sums as (
    select w.id, w.balance,
           coalesce(sum(case when l.direction = 'CREDIT' then l.amount else -l.amount end), 0) as ledger
      from public.wallets w left join public.ledger_entries l on l.wallet_id = w.id
     group by w.id, w.balance
  )
  select jsonb_build_object(
    'wallets', (select count(*) from sums),
    'mismatched_wallets', (select count(*) from sums where balance <> ledger),
    'mismatches', coalesce((select jsonb_agg(jsonb_build_object('wallet_id', id, 'balance', balance, 'ledger', ledger))
                              from (select * from sums where balance <> ledger limit 20) m), '[]'::jsonb),
    'ledger_imbalance', (select coalesce(sum(case when direction = 'DEBIT' then amount else -amount end), 0)
                           from public.ledger_entries),
    'unpaired_transactions', (select count(*) from public.transactions t
                               where (select count(*) from public.ledger_entries l where l.transaction_id = t.id) <> 2));
$$;

revoke all on function public.reconcile_ledger() from public, anon, authenticated;
grant execute on function public.reconcile_ledger() to service_role;
