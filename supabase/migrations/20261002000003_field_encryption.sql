-- Encryption at rest for sensitive transaction fields (TC-P1-DB-07, PRD §5).
-- The symmetric key lives in Supabase Vault. In hosted environments create the
-- `txn_field_key` secret out of band; the block below only fills it in for
-- fresh local/dev databases.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'txn_field_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'txn_field_key',
      'Symmetric key for transactions.note_enc / counterparty_enc'
    );
  end if;
end $$;

create or replace function private.field_key() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'txn_field_key' limit 1;
$$;

create or replace function private.encrypt_field(p_plain text) returns bytea
language sql stable security definer set search_path = '' as $$
  select case when p_plain is null then null
              else extensions.pgp_sym_encrypt(p_plain, private.field_key()) end;
$$;

create or replace function private.decrypt_field(p_cipher bytea) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_cipher is null then null
              else extensions.pgp_sym_decrypt(p_cipher, private.field_key()) end;
$$;

revoke all on function private.field_key(), private.encrypt_field(text), private.decrypt_field(bytea)
  from public, anon, authenticated;
