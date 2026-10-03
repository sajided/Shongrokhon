// Cash-Flow Forecasting (PRD §4.2, TC-P3-FCST-*). Pure, so it is unit-tested
// and backtested (scripts/backtest-forecast.ts). Input: get_cash_history.
//
// 1. Recurring items: same counterparty, 3+ times at about the same amount
//    (within 25% of its median), every 25-35 days with no gap more than 5 days
//    off (salary, rent, bills).
// 2. Baseline: other spending (payments and cash-outs) per day over the last
//    60 complete days. A plain mean: trimming busy days biased it low, and the
//    error compounded over 30 days (scripts/backtest-forecast.ts).
// 3. Projection: today's balance, minus the baseline every day, plus or minus
//    each recurring item on its next due dates.
// 4. Warning: the first day the balance falls below app_config.forecast_low_balance.

export interface CashRow {
  at: string;
  kind: 'INCOME' | 'SPEND' | 'CASH_OUT';
  category: string;
  amount: number;
  key: string;
  name: string | null;
  /** Billers only (Phase 4): lets a warning link straight to bill pay. */
  merchant_id?: string | null;
}

export interface CashHistory {
  as_of: string;
  balance: number;
  low_balance: number;
  first_txn_at: string | null;
  rows: CashRow[];
}

export interface Recurring {
  key: string;
  name: string;
  direction: 'IN' | 'OUT';
  category: string;
  amount: number;
  intervalDays: number;
  nextDue: string; // YYYY-MM-DD (Dhaka)
  occurrences: number;
  /** Set for billers, see CashRow.merchant_id. */
  merchantId?: string;
}

export interface ForecastDay {
  date: string; // YYYY-MM-DD (Dhaka)
  balance: number;
  events: { name: string; amount: number; merchantId?: string }[]; // + in, - out
}

export interface Forecast {
  days: ForecastDay[]; // day 1..horizon
  recurring: Recurring[];
  dailySpend: number;
  historyDays: number;
  lowConfidence: boolean;
  minBalance: number;
  minDate: string | null;
  /** How far the balance goes below zero, if it does (TC-P3-FCST-06). */
  shortfall: number;
  warning: null | {
    date: string;
    balance: number;
    threshold: number;
    /** The recurring payment due that day, if any. */
    cause: { name: string; amount: number; merchantId?: string } | null;
    /** Top up this much before `date` to stay at the threshold for the whole horizon. */
    topUp: number;
    /** Or spend this much less per day until `date`. */
    dailyCut: number;
  };
}

const DAY_MS = 86400000;
const DHAKA_MS = 6 * 3600000;
export const MIN_HISTORY_DAYS = 30;
const MIN_OCCURRENCES = 3;
const MAX_CV = 0.25;
const MAX_GAP_DRIFT_DAYS = 5;

/** Calendar day number in Dhaka time (days since the epoch). */
const dhakaDay = (ms: number) => Math.floor((ms + DHAKA_MS) / DAY_MS);
const dayString = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function cv(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return Infinity;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / mean;
}

/** TC-P3-FCST-04. Returns the recurring items and the rows they explain. */
export function detectRecurring(rows: CashRow[], today: number): { items: Recurring[]; rowsUsed: Set<CashRow> } {
  const groups = new Map<string, CashRow[]>();
  for (const r of rows) {
    const key = `${r.kind === 'INCOME' ? 'IN' : 'OUT'}:${r.key}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const items: Recurring[] = [];
  const rowsUsed = new Set<CashRow>();
  for (const group of groups.values()) {
    // Only rows near the typical amount: a one-off cash-in must not hide a salary.
    const typical = median(group.map((r) => r.amount));
    const series = group.filter((r) => Math.abs(r.amount - typical) <= MAX_CV * typical);
    if (series.length < MIN_OCCURRENCES) continue;
    const sorted = [...series].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const gaps = sorted.slice(1).map((r, i) => (Date.parse(r.at) - Date.parse(sorted[i].at)) / DAY_MS);
    const interval = median(gaps);
    if (interval < 25 || interval > 35 || cv(sorted.map((r) => r.amount)) > MAX_CV) continue;
    // Every gap must be regular, so a few similar shop visits never look monthly by chance.
    if (gaps.some((g) => Math.abs(g - interval) > MAX_GAP_DRIFT_DAYS)) continue;
    const last = dhakaDay(Date.parse(sorted[sorted.length - 1].at));
    let next = last + Math.round(interval);
    if (next < today - 3) continue; // missed: probably stopped
    if (next <= today) next = today + 1; // a little late: expect it tomorrow
    const r0 = sorted[sorted.length - 1];
    items.push({
      key: r0.key,
      name: r0.kind === 'INCOME' ? 'Income' : r0.kind === 'CASH_OUT' ? 'Cash-out' : r0.name ?? 'Payment',
      direction: r0.kind === 'INCOME' ? 'IN' : 'OUT',
      category: r0.category,
      amount: Math.round(median(sorted.map((r) => r.amount))),
      intervalDays: Math.round(interval),
      nextDue: dayString(next),
      occurrences: sorted.length,
      ...(r0.merchant_id ? { merchantId: r0.merchant_id } : {}),
    });
    sorted.forEach((r) => rowsUsed.add(r));
  }
  return { items, rowsUsed };
}

/** Average non-recurring outflow per day over the last 60 complete days. */
export function baselineDailySpend(rows: CashRow[], rowsUsed: Set<CashRow>, today: number, historyDays: number): number {
  const window = Math.max(1, Math.min(60, Math.floor(historyDays)));
  const perDay = new Array<number>(window).fill(0);
  for (const r of rows) {
    if (r.kind === 'INCOME' || rowsUsed.has(r)) continue;
    const ago = today - dhakaDay(Date.parse(r.at)); // 1 = yesterday; today is not over yet
    if (ago >= 1 && ago <= window) perDay[ago - 1] += r.amount;
  }
  return perDay.reduce((a, b) => a + b, 0) / window;
}

export function forecast(history: CashHistory, horizonDays = 30): Forecast {
  const asOf = Date.parse(history.as_of);
  const today = dhakaDay(asOf);
  const historyDays = history.first_txn_at ? (asOf - Date.parse(history.first_txn_at)) / DAY_MS : 0;
  const { items, rowsUsed } = detectRecurring(history.rows, today);
  const dailySpend = baselineDailySpend(history.rows, rowsUsed, today, historyDays);

  const due = new Map<number, { name: string; amount: number }[]>();
  for (const item of items) {
    const first = Math.floor(Date.parse(item.nextDue) / DAY_MS);
    for (let d = first; d <= today + horizonDays; d += item.intervalDays) {
      const amount = item.direction === 'IN' ? item.amount : -item.amount;
      due.set(d, [...(due.get(d) ?? []), { name: item.name, amount, ...(item.merchantId ? { merchantId: item.merchantId } : {}) }]);
    }
  }

  const days: ForecastDay[] = [];
  let balance = history.balance;
  for (let i = 1; i <= horizonDays; i++) {
    const events = due.get(today + i) ?? [];
    balance += events.reduce((a, e) => a + e.amount, 0) - dailySpend;
    days.push({ date: dayString(today + i), balance: Math.round(balance), events });
  }

  const min = days.reduce((m, d) => (d.balance < m.balance ? d : m), days[0]);
  const threshold = history.low_balance;
  const lowIndex = days.findIndex((d) => d.balance < threshold);
  let warning: Forecast['warning'] = null;
  if (lowIndex >= 0) {
    const low = days[lowIndex];
    const bill = low.events.filter((e) => e.amount < 0).sort((a, b) => a.amount - b.amount)[0];
    warning = {
      date: low.date,
      balance: low.balance,
      threshold,
      cause: bill ? { name: bill.name, amount: -bill.amount, ...(bill.merchantId ? { merchantId: bill.merchantId } : {}) } : null,
      topUp: Math.ceil(threshold - min.balance),
      dailyCut: Math.ceil((threshold - low.balance) / (lowIndex + 1)),
    };
  }
  return {
    days,
    recurring: items.sort((a, b) => a.nextDue.localeCompare(b.nextDue)),
    dailySpend: Math.round(dailySpend),
    historyDays: Math.floor(historyDays),
    lowConfidence: historyDays < MIN_HISTORY_DAYS,
    minBalance: min?.balance ?? history.balance,
    minDate: min?.date ?? null,
    shortfall: Math.max(0, -(min?.balance ?? 0)),
    warning,
  };
}
