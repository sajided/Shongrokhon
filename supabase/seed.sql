-- Phase 1 personas (testcase.md §0.4). All use test OTP 123456 (see config.toml).
--   U-NORMAL  +8801711000001  balance ৳5,000  PIN 12345
--   U-LOW     +8801711000002  balance ৳100    PIN 12345
--   M-LEGIT   +8801811000001  merchant MLEGIT0001 "Rahim Store"
-- +8801711000003..09 are left unregistered for registration tests.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('11111111-1111-1111-1111-000000000001'::uuid, '8801711000001'),
      ('11111111-1111-1111-1111-000000000002'::uuid, '8801711000002'),
      ('22222222-2222-2222-2222-000000000001'::uuid, '8801811000001')
    ) as v (id, phone)
  loop
    insert into auth.users (
      instance_id, id, aud, role, phone, phone_confirmed_at, encrypted_password,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone_change, phone_change_token, email_change_token_current, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.phone, now(), '',
      '{"provider":"phone","providers":["phone"]}', '{}', now(), now(),
      '', '', '', '', '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), r.id, r.id::text, 'phone',
            jsonb_build_object('sub', r.id::text, 'phone', r.phone), now(), now(), now())
    on conflict do nothing;
  end loop;
end $$;

update public.users set full_name = 'Normal User', pin_hash = extensions.crypt('12345', extensions.gen_salt('bf', 8))
 where id = '11111111-1111-1111-1111-000000000001';
update public.users set full_name = 'Low Balance User', pin_hash = extensions.crypt('12345', extensions.gen_salt('bf', 8))
 where id = '11111111-1111-1111-1111-000000000002';
update public.users set full_name = 'Rahim Store Owner', role = 'merchant', pin_hash = extensions.crypt('12345', extensions.gen_salt('bf', 8))
 where id = '22222222-2222-2222-2222-000000000001';

insert into public.wallets (user_id, kind, merchant_id, merchant_name)
values ('22222222-2222-2222-2222-000000000001', 'merchant', 'MLEGIT0001', 'Rahim Store')
on conflict (user_id, kind) do nothing;

select public.admin_credit_wallet(w.id, 5000, 'Opening balance')
  from public.wallets w where w.user_id = '11111111-1111-1111-1111-000000000001' and w.kind = 'customer';
select public.admin_credit_wallet(w.id, 100, 'Opening balance')
  from public.wallets w where w.user_id = '11111111-1111-1111-1111-000000000002' and w.kind = 'customer';

-- Phase 4: a compliance analyst for the Investigation Assistant (admin/ app).
--   analyst@shongrokhon.test / analyst-pass-123   (local development and tests only)
-- Staff accounts carry app_metadata.staff = true, so they get no customer wallet.
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-000000000001', 'authenticated', 'authenticated',
  'analyst@shongrokhon.test', now(), extensions.crypt('analyst-pass-123', extensions.gen_salt('bf', 8)),
  '{"provider":"email","providers":["email"],"staff":true}', '{}', now(), now(),
  '', '', '', '', '', '', '', ''
) on conflict (id) do nothing;
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '66666666-6666-6666-6666-000000000001', '66666666-6666-6666-6666-000000000001', 'email',
        jsonb_build_object('sub', '66666666-6666-6666-6666-000000000001', 'email', 'analyst@shongrokhon.test',
                           'email_verified', true),
        now(), now(), now())
on conflict do nothing;
insert into public.staff (user_id, email) values ('66666666-6666-6666-6666-000000000001', 'analyst@shongrokhon.test')
on conflict (user_id) do nothing;
