-- Phase 4: account deletion (TC-P4-SEC-05) also removes the user's analytics events.
create or replace function public.delete_my_account(p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_session();
  v_failure jsonb;
  v_wallet public.wallets;
begin
  v_failure := private.check_pin(v_uid, p_pin);
  if v_failure is not null then
    return v_failure;
  end if;
  select * into v_wallet from public.wallets where user_id = v_uid and kind = 'customer' for update;
  if v_wallet.balance <> 0 then
    return private.payment_failure('BALANCE_NOT_ZERO', jsonb_build_object('balance', v_wallet.balance));
  end if;

  delete from public.savings_goals where user_id = v_uid;          -- contributions cascade
  delete from public.coach_insight_cache where user_id = v_uid;
  delete from public.nudge_events where user_id = v_uid;
  delete from public.rate_limits where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;
  perform private.delete_user_analytics(v_uid);
  update public.coach_llm_requests set user_id = null where user_id = v_uid;  -- payloads hold no PII

  update public.users
     set phone = 'deleted:' || v_uid::text, full_name = null, pin_hash = null,
         pin_failed_attempts = 0, pin_locked_until = null
   where id = v_uid;
  update public.wallets set status = 'frozen' where user_id = v_uid;

  delete from auth.sessions where user_id = v_uid;
  delete from auth.identities where user_id = v_uid;
  update auth.users set phone = null, raw_user_meta_data = '{}'::jsonb, banned_until = 'infinity' where id = v_uid;

  return jsonb_build_object('status', 'DELETED');
end $$;

revoke all on function public.delete_my_account(text) from public, anon, authenticated;
grant execute on function public.delete_my_account(text) to authenticated;
