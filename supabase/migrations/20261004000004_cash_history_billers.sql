-- Phase 4: forecast rows carry the biller's merchant id, so a low-balance
-- warning about a bill can open bill pay pre-filled (TC-P4-E2E-04).
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
               'key', coalesce(x.counterparty::text, x.kind), 'name', w.merchant_name,
               'merchant_id', case when w.biller_category is not null then w.merchant_id end)
             order by x.created_at, x.id)
        from private.coach_txns(v_wallet, now() - make_interval(days => v_days), now()) x
        left join public.wallets w on w.id = x.counterparty), '[]'::jsonb));
end $$;

revoke all on function public.get_cash_history(int) from public, anon, authenticated;
grant execute on function public.get_cash_history(int) to authenticated;
