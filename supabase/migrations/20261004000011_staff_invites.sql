-- Staff creation fix. GoTrue's admin createUser inserts the auth.users row
-- before it applies the requested app_metadata, so the sign-up trigger never
-- saw staff = true and refused every analyst with EMAIL_SIGNUP_DISABLED.
-- scripts/create-analyst.ts now pre-approves the email with the service role;
-- the trigger lets exactly that email through once (TC-P4-INV-01, TC-P4-SEC-03).

create table if not exists private.staff_invites (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create or replace function public.admin_invite_staff(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = '22023';
  end if;
  insert into private.staff_invites (email) values (lower(p_email))
  on conflict (email) do update set created_at = now();
end $$;

revoke all on function public.admin_invite_staff(text) from public, anon, authenticated;
grant execute on function public.admin_invite_staff(text) to service_role;

create or replace function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'staff', 'false') = 'true' then
    return new;
  end if;
  if coalesce(new.phone, '') = '' then
    -- An invite is valid for one hour and is consumed by the first account.
    delete from private.staff_invites
     where email = lower(coalesce(new.email, '')) and created_at > now() - interval '1 hour';
    if found then
      return new;
    end if;
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
