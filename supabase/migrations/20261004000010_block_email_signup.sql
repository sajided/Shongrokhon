-- Phase 4: customers sign up by phone only; email accounts are staff, created
-- with the service role and app_metadata.staff = true (scripts/create-analyst.ts).
-- A public email sign-up is refused here, so nobody can self-register an email
-- account (TC-P4-INV-01, TC-P4-SEC-03).
create or replace function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'staff', 'false') = 'true' then
    return new;
  end if;
  if coalesce(new.phone, '') = '' then
    raise exception 'EMAIL_SIGNUP_DISABLED' using errcode = '42501';
  end if;

  insert into public.users (id, phone)
  values (new.id, '+' || ltrim(new.phone, '+'))
  on conflict (id) do nothing;

  insert into public.wallets (user_id, kind)
  values (new.id, 'customer')
  on conflict (user_id, kind) do nothing;

  return new;
end $$;
