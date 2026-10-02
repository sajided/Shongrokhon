import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiError, NetworkError, SessionExpiredError } from './errors';
import { getSupabase } from './supabase';

export { ApiError, NetworkError, SessionExpiredError };

const REQUEST_TIMEOUT_MS = 15000;
const NETWORK_MESSAGE = /network request failed|fetch failed|failed to fetch|networkerror|abort|timed? ?out/i;

export async function callRpc<T>(fn: string, args: Record<string, unknown> = {}, client?: SupabaseClient): Promise<T> {
  const supabase = client ?? getSupabase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const { data, error, status } = await supabase.rpc(fn, args).abortSignal(controller.signal);
    if (!error) return data as T;
    if (status === 401 || error.code === 'PT401') {
      await supabase.auth.signOut({ scope: 'local' });
      throw new SessionExpiredError();
    }
    if (status === 0 || NETWORK_MESSAGE.test(error.message ?? '')) throw new NetworkError();
    // Business errors are raised with an UPPER_SNAKE code as the message.
    throw new ApiError(/^[A-Z_]+$/.test(error.message) ? error.message : 'INTERNAL_ERROR');
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Typed RPC wrappers
// ---------------------------------------------------------------------------

export interface Profile {
  user_id: string;
  phone: string;
  full_name: string | null;
  role: 'customer' | 'merchant';
  has_pin: boolean;
  pin_locked_until: string | null;
  wallet_id: string;
  balance: number;
  currency: string;
}

export interface PaymentResponse {
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'NOT_FOUND';
  code?: string | null;
  transaction_id?: string;
  amount?: number;
  merchant_id?: string;
  merchant_name?: string;
  created_at?: string;
  balance_after?: number;
  replayed?: boolean;
  attempts_left?: number;
  locked_until?: string;
}

export interface PaymentRequest {
  merchantId: string;
  amount: number;
  pin: string;
  idempotencyKey: string;
  note?: string;
}

export interface TransactionRow {
  id: string;
  type: 'PAYMENT' | 'TOPUP';
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  direction: 'IN' | 'OUT';
  amount: number;
  counterparty_name: string | null;
  counterparty_ref: string | null;
  note: string | null;
  created_at: string;
}

export interface MerchantInfo {
  merchant_id: string;
  merchant_name: string;
  is_active: boolean;
}

export const getProfile = () => callRpc<Profile>('get_my_profile');

export const setPin = (pin: string) => callRpc<void>('set_pin', { p_pin: pin });

export async function lookupMerchant(merchantId: string): Promise<MerchantInfo | null> {
  const rows = await callRpc<MerchantInfo[]>('lookup_merchant', { p_merchant_id: merchantId });
  return rows[0] ?? null;
}

export const makePayment = (req: PaymentRequest) =>
  callRpc<PaymentResponse>('make_payment', {
    p_merchant_id: req.merchantId,
    p_amount: req.amount,
    p_pin: req.pin,
    p_idempotency_key: req.idempotencyKey,
    p_note: req.note ?? null,
  });

export const getPaymentStatus = (idempotencyKey: string) =>
  callRpc<PaymentResponse>('get_payment_status', { p_idempotency_key: idempotencyKey });

export const getTransactions = (opts: { limit?: number; before?: string; id?: string } = {}) =>
  callRpc<TransactionRow[]>('get_my_transactions', {
    p_limit: opts.limit ?? 50,
    p_before: opts.before ?? null,
    p_id: opts.id ?? null,
  });
