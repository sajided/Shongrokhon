-- Cash in / top-up for authenticated users (TC-P4-CASHIN)
create or replace function public.cash_in(p_amount numeric, p_source text default 'Agent Cash-in')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_wallet_id uuid;
  v_system uuid := '00000000-0000-0000-0000-00000000a001';
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PT401';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 50000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  select id into v_wallet_id from public.wallets where user_id = v_uid and kind = 'customer';
  if v_wallet_id is null then
    raise exception 'WALLET_NOT_FOUND' using errcode = '22023';
  end if;

  perform 1 from public.wallets where id in (v_system, v_wallet_id) order by id for update;
  return private.post_transfer(
    'TOPUP', v_system, v_wallet_id, p_amount, gen_random_uuid(), coalesce(p_source, 'Cash In'),
    jsonb_build_object('out_name', 'Cash In deposit', 'in_name', coalesce(p_source, 'Cash In'))
  );
end $$;

-- Not customer-callable: it would let any user mint up to 50,000 per call from the
-- system treasury with no agent or cash involved. Service role only (like
-- admin_credit_wallet) until an agent-initiated, customer-confirmed cash-in exists.
revoke execute on function public.cash_in(numeric, text) from public, anon, authenticated;
grant execute on function public.cash_in(numeric, text) to service_role;
