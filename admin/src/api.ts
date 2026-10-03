// Analyst API: analyst_* RPCs (SQL enforces the analyst role, TC-P4-INV-01)
// and the `investigate` Edge Function (SHAP + evidence summary).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface WalletLabel {
  wallet_id: string;
  kind: 'customer' | 'merchant' | 'agent' | 'system';
  label: string;
  ref: string | null;
  risk_flagged: boolean;
}

export type AlertStatus = 'OPEN' | 'CONFIRMED' | 'FALSE_POSITIVE' | 'ESCALATED';
export type AlertAction = 'CONFIRMED' | 'FALSE_POSITIVE' | 'ESCALATED' | 'NOTE';

export interface AlertRow {
  id: string;
  kind: 'TXN' | 'RING';
  status: AlertStatus;
  created_at: string;
  score: number | null;
  amount: number | null;
  flow: string | null;
  wallets: WalletLabel[];
}

export interface AlertDetailData {
  alert: { id: string; kind: 'TXN' | 'RING'; status: AlertStatus; created_at: string; score: number | null; summary: Record<string, unknown> };
  score: null | { risk_score: number | null; anomaly_score: number | null; network_risk: number; decision: string; source: string; model_version: string };
  transaction: null | { id: string; type: string; amount: number; created_at: string; payer: WalletLabel; payee: WalletLabel };
  wallets: WalletLabel[];
  graph: null | { nodes: WalletLabel[]; edges: { from: string; to: string; count: number; total: number }[] };
  actions: { action: AlertAction; note: string | null; analyst: string; created_at: string }[];
}

export interface Driver {
  feature: string;
  label: string;
  value: string;
  contribution: number;
  direction: 'raises' | 'lowers';
}

export interface Investigation {
  shap: null | { base_value: number; margin: number; risk_score: number; model_version: string };
  drivers: Driver[];
  summary: { headline: string; points: string[]; next_step: string };
  summary_source: 'LLM' | 'MOCK' | 'TEMPLATE';
  cached: boolean;
}

export interface Filters {
  from?: string;
  to?: string;
  minScore?: number;
  maxScore?: number;
  status?: AlertStatus;
  wallet?: string;
}

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  const url = import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined;
  const key = import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  client ??= createClient(url, key, { auth: { storageKey: 'shongrokhon.admin.auth' } });
  return client;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const amIAnalyst = () => rpc<boolean>('am_i_analyst');

export const listAlerts = (f: Filters) => rpc<AlertRow[]>('analyst_list_alerts', {
  p_from: f.from || null, p_to: f.to || null, p_min_score: f.minScore ?? null, p_max_score: f.maxScore ?? null,
  p_status: f.status || null, p_wallet: f.wallet || null,
});

export const getAlert = (id: string) => rpc<AlertDetailData>('analyst_get_alert', { p_id: id });

export const act = (id: string, action: AlertAction, note: string) =>
  rpc<{ status: AlertStatus }>('analyst_act', { p_id: id, p_action: action, p_note: note || null });

export async function investigate(alertId: string, refresh = false): Promise<Investigation> {
  const { data, error } = await supabase().functions.invoke<Investigation>('investigate', { body: { alertId, refresh } });
  if (error || !data) throw new Error('INVESTIGATE_FAILED');
  return data;
}
