import type { SupabaseClient } from '@supabase/supabase-js';

import { readConfig } from './config';
import { ApiError, NetworkError, SessionExpiredError } from './errors';
import type { CashHistory } from './forecast';
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

export interface FunctionTransport {
  url: string;
  anonKey: string;
  accessToken: () => Promise<string | null>;
  onUnauthorized: () => Promise<void>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * POSTs to a Supabase Edge Function with the same error mapping as callRpc:
 * 401 -> local sign-out + SessionExpiredError, transport failure or timeout ->
 * NetworkError, an UPPER_SNAKE `code` in an error body -> ApiError(code).
 */
export async function invokeFunction<T>(name: string, body: unknown, t: FunctionTransport): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), t.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    const token = await t.accessToken();
    res = await (t.fetchImpl ?? fetch)(`${t.url}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        apikey: t.anonKey,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    await t.onUnauthorized();
    throw new SessionExpiredError();
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError('INTERNAL_ERROR');
  }
  if (!res.ok) {
    const code = (data as { code?: unknown })?.code;
    throw new ApiError(typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'INTERNAL_ERROR');
  }
  return data as T;
}

export function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { supabaseUrl, supabaseAnonKey } = readConfig();
  const supabase = getSupabase();
  return invokeFunction<T>(name, body, {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
    onUnauthorized: async () => {
      await supabase.auth.signOut({ scope: 'local' });
    },
  });
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
  /** STEP_UP_REQUIRED: medium risk; resubmit with `confirm: true` after the user re-enters their PIN (TC-P2-FLOW-03). */
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'NOT_FOUND' | 'STEP_UP_REQUIRED';
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
  risk_decision?: 'ALLOW' | 'REVIEW' | 'FLAG' | null;
  /** The payment went through but was flagged for review (TC-P2-FLOW-02). */
  flagged?: boolean;
}

export interface PaymentRequest {
  merchantId: string;
  amount: number;
  pin: string;
  idempotencyKey: string;
  note?: string;
  /** Step-up confirmation of a REVIEW decision. */
  confirm?: boolean;
}

export interface TransactionRow {
  id: string;
  type: 'PAYMENT' | 'TOPUP' | 'CASHOUT';
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  direction: 'IN' | 'OUT';
  amount: number;
  counterparty_name: string | null;
  counterparty_ref: string | null;
  note: string | null;
  created_at: string;
  flagged: boolean;
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

// Scan -> score -> execute: the `pay` Edge Function scores the payment before
// make_payment runs (TC-P2-FLOW-*). make_payment rejects calls without a score.
export const makePayment = (req: PaymentRequest) =>
  callFunction<PaymentResponse>('pay', {
    merchantId: req.merchantId,
    amount: req.amount,
    pin: req.pin,
    idempotencyKey: req.idempotencyKey,
    note: req.note ?? null,
    confirm: req.confirm ?? false,
  });

export const getPaymentStatus = (idempotencyKey: string) =>
  callRpc<PaymentResponse>('get_payment_status', { p_idempotency_key: idempotencyKey });

export const getTransactions = (opts: { limit?: number; before?: string; id?: string } = {}) =>
  callRpc<TransactionRow[]>('get_my_transactions', {
    p_limit: opts.limit ?? 50,
    p_before: opts.before ?? null,
    p_id: opts.id ?? null,
  });

export interface Notice {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

export const getNotifications = (limit = 20) => callRpc<Notice[]>('get_my_notifications', { p_limit: limit });

export const markNotificationRead = (id: string) => callRpc<void>('mark_notification_read', { p_id: id });

// ---------------------------------------------------------------------------
// AI coach and savings planner (Phase 3). Numbers come from SQL RPCs; only the
// insight text comes from the `coach` Edge Function (which never sends the
// LLM names, phone numbers or ids).
// ---------------------------------------------------------------------------

export type CoachPeriod = 'WEEK' | 'MONTH' | '3M';
export type SpendCategory =
  | 'FOOD' | 'TRANSPORT' | 'UTILITIES' | 'BILLS' | 'SHOPPING' | 'HEALTH' | 'EDUCATION' | 'SAVINGS' | 'CASH_OUT' | 'OTHERS';

export interface CoachDashboard {
  period: CoachPeriod;
  txn_count: number;
  income: number;
  spending: number;
  saved: number;
  net: number;
  cashout: { total: number; count: number; share: number; level: 'LOW' | 'MEDIUM' | 'HIGH' };
  categories: { category: SpendCategory; total: number; count: number; share: number }[];
  merchants: { label: string; name: string; category: SpendCategory; total: number; count: number }[];
  monthly: { month: string; income: number; spending: number; cashout: number }[];
  uncategorized: number;
}

export interface Insight {
  kind: 'SPENDING' | 'CASH' | 'SAVING' | 'TIP';
  title: string;
  body: string;
}

export interface InsightsResponse {
  status: 'OK' | 'INSUFFICIENT_DATA';
  source?: 'LLM' | 'MOCK' | 'TEMPLATE';
  cached?: boolean;
  insights: Insight[];
  categories_updated: boolean;
}

export interface AskResponse {
  status: 'OK' | 'UNAVAILABLE';
  topic?: 'GENERAL' | 'REGULATED_ADVICE' | 'OFF_TOPIC';
  declined?: boolean;
  answer: string;
}

export interface SavingsGoal {
  id: string;
  name: string;
  target_amount: number;
  months: number;
  start_date: string;
  created_at: string;
  saved: number;
  remaining: number;
}

export interface SavingsOverview {
  surplus: { surplus: number | null; income: number | null; spending: number | null; history_days: number };
  goals: SavingsGoal[];
}

export const getCoachDashboard = (period: CoachPeriod) =>
  callRpc<CoachDashboard>('get_coach_dashboard', { p_period: period });

export const getInsights = (period: CoachPeriod) => callFunction<InsightsResponse>('coach', { action: 'insights', period });

export const askCoach = (question: string) => callFunction<AskResponse>('coach', { action: 'ask', question });

export const getCashHistory = (days = 120) => callRpc<CashHistory>('get_cash_history', { p_days: days });

export const getSavingsGoals = () => callRpc<SavingsOverview>('get_savings_goals');

export const createSavingsGoal = (name: string, target: number, months: number) =>
  callRpc<string>('create_savings_goal', { p_name: name, p_target: target, p_months: months });

export const updateSavingsGoal = (id: string, name: string, target: number, months: number) =>
  callRpc<void>('update_savings_goal', { p_id: id, p_name: name, p_target: target, p_months: months });

export const deleteSavingsGoal = (id: string) => callRpc<void>('delete_savings_goal', { p_id: id });

export const addSavingsContribution = (goalId: string, amount: number) =>
  callRpc<void>('add_savings_contribution', { p_goal_id: goalId, p_amount: amount });
