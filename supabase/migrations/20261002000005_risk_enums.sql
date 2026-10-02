-- Phase 2 enum values. Kept in its own migration: a value added with
-- ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it.

alter type public.txn_type add value if not exists 'CASHOUT';

do $$ begin create type public.risk_decision as enum ('ALLOW', 'REVIEW', 'FLAG'); exception when duplicate_object then null; end $$;
do $$ begin create type public.risk_source as enum ('MODEL', 'FALLBACK'); exception when duplicate_object then null; end $$;
do $$ begin create type public.alert_kind as enum ('TXN', 'RING'); exception when duplicate_object then null; end $$;
