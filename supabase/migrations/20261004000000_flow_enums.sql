-- Phase 4 enum values. Kept in its own migration: a value added with
-- ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it.

alter type public.wallet_kind add value if not exists 'agent';
alter type public.user_role add value if not exists 'agent';
alter type public.txn_type add value if not exists 'TRANSFER';
alter type public.txn_type add value if not exists 'FEE';
-- Cash-outs and send-money are scored by SQL rules (the ML model is trained on QR merchant payments only).
alter type public.risk_source add value if not exists 'RULES';
