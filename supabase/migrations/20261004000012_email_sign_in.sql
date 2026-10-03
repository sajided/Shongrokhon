-- Email sign-in for customers, for deployments without an SMS provider.
--
-- Off by default (app_config.email_sign_in = false): an email account without a
-- staff invite is refused, as before (TC-P4-INV-01, TC-P4-SEC-03). When it is on,
-- the otp Edge Function sends a 6-digit email code and the new account becomes a
-- customer with a wallet. Staff still need a service-role invite.
--
-- users.phone holds the sign-in identifier: +8801XXXXXXXXX for SMS accounts and
-- the lowercased email for email accounts. normalize_phone and mask_phone accept
-- both, so recipient lookup, send money, receipts and the analyst view work
-- unchanged.

alter table public.app_config add column if not exists email_sign_in boolean not null default false;

create or replace function private.normalize_phone(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case
    when position('@' in coalesce(p_phone, '')) > 0 then
      case when lower(btrim(p_phone)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(btrim(p_phone)) end
    when d ~ '^01[3-9][0-9]{8}$' then '+88' || d
    when d ~ '^8801[3-9][0-9]{8}$' then '+' || d
    else null end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- r***@example.com for emails; the last four digits for phone numbers.
create or replace function private.mask_phone(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_phone is null then null
    when position('@' in p_phone) > 0 then left(p_phone, 1) || '***' || substr(p_phone, position('@' in p_phone))
    else repeat('*', greatest(length(p_phone) - 4, 0)) || right(p_phone, 4) end;
$$;

create or replace function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'staff', 'false') = 'true' then
    return new;
  end if;

  if coalesce(new.phone, '') <> '' then
    insert into public.users (id, phone)
    values (new.id, '+' || ltrim(new.phone, '+'))
    on conflict (id) do nothing;
  else
    -- Staff: an invite is valid for one hour and is consumed by the first account.
    delete from private.staff_invites
     where email = lower(coalesce(new.email, '')) and created_at > now() - interval '1 hour';
    if found then
      return new;
    end if;
    if coalesce(new.email, '') = ''
       or not coalesce((select c.email_sign_in from public.app_config c), false) then
      raise exception 'EMAIL_SIGNUP_DISABLED' using errcode = '42501';
    end if;
    insert into public.users (id, phone)
    values (new.id, lower(new.email))
    on conflict (id) do nothing;
  end if;

  insert into public.wallets (user_id, kind)
  values (new.id, 'customer')
  on conflict (user_id, kind) do nothing;

  return new;
end $$;
