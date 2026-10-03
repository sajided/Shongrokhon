// Shared types for the `coach` Edge Function. Pure: no Deno or npm imports,
// so every module here except anthropic.ts and index.ts is Jest-tested.

export const CATEGORIES = [
  'FOOD', 'TRANSPORT', 'UTILITIES', 'BILLS', 'SHOPPING', 'HEALTH', 'EDUCATION', 'SAVINGS', 'CASH_OUT', 'OTHERS',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Categories a merchant can have (cash-outs are a transaction type, not a merchant). */
export const MERCHANT_CATEGORIES = CATEGORIES.filter((c) => c !== 'CASH_OUT');

export const CATEGORY_LABELS: Record<Category, string> = {
  FOOD: 'Food', TRANSPORT: 'Transport', UTILITIES: 'Utilities', BILLS: 'Bills & rent', SHOPPING: 'Shopping',
  HEALTH: 'Health', EDUCATION: 'Education', SAVINGS: 'Savings', CASH_OUT: 'Cash-out', OTHERS: 'Others',
};

export type Period = 'WEEK' | 'MONTH' | '3M';
export const PERIODS: readonly Period[] = ['WEEK', 'MONTH', '3M'];
export const PERIOD_LABELS: Record<Period, string> = {
  WEEK: 'the last 7 days', MONTH: 'the last 30 days', '3M': 'the last 3 months',
};

export type CashLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** private.coach_summary(..., p_names = false): already anonymised by SQL. */
export interface Summary {
  txn_count: number;
  income: number;
  spending: number;
  saved: number;
  net: number;
  cashout: { total: number; count: number; share: number; level: CashLevel };
  categories: { category: Category; total: number; count: number; share: number }[];
  merchants: { label: string; category: Category; total: number; count: number }[];
  monthly: { month: string; income: number; spending: number; cashout: number }[];
  data_hash: string;
}

export interface CoachContext {
  summary: Summary;
  uncategorized: { wallet_id: string; name: string }[];
  cached: { payload: { insights: Insight[] }; source: string; created_at: string } | null;
  config: { min_txns: number; llm_mode: 'live' | 'mock' | 'off'; llm_timeout_ms: number; mock_delay_ms: number };
}

export const INSIGHT_KINDS = ['SPENDING', 'CASH', 'SAVING', 'TIP'] as const;
export interface Insight {
  kind: (typeof INSIGHT_KINDS)[number];
  title: string;
  body: string;
}

export const ASK_TOPICS = ['GENERAL', 'REGULATED_ADVICE', 'OFF_TOPIC'] as const;
export type AskTopic = (typeof ASK_TOPICS)[number];
