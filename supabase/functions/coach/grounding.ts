// Grounded numbers (TC-P3-LLM-04). The LLM never writes a figure: it refers to
// facts by placeholder, e.g. "You spent {{cat.FOOD.total}} on food", and the
// server substitutes values computed by SQL. Output containing a raw digit
// (Latin or Bangla) or an unknown placeholder is rejected.

import { asciiDigits } from './sanitize.ts';
import { CATEGORY_LABELS, PERIOD_LABELS, type Period, type Summary } from './types.ts';

export type Facts = Record<string, string>;

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
const DIGIT = /[0-9০-৯]/;

/** Whole taka with South Asian grouping: 125000 -> ৳1,25,000 (same grouping as src/lib/format.ts). */
export function taka(n: number): string {
  const rounded = Math.round(Math.abs(n));
  const s = String(rounded);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${n < 0 && rounded > 0 ? '-' : ''}৳${rest ? `${rest},${last3}` : last3}`;
}

export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Every figure the LLM may cite, formatted for display. */
export function buildFacts(summary: Summary, period: Period): Facts {
  const f: Facts = {
    period: PERIOD_LABELS[period],
    income: taka(summary.income),
    spending: taka(summary.spending),
    saved: taka(summary.saved),
    net: taka(Math.abs(summary.net)),
    txn_count: String(summary.txn_count),
    'cashout.total': taka(summary.cashout.total),
    'cashout.count': String(summary.cashout.count),
    'cashout.share': percent(summary.cashout.share),
  };
  for (const c of summary.categories) {
    f[`cat.${c.category}.name`] = CATEGORY_LABELS[c.category].toLowerCase();
    f[`cat.${c.category}.total`] = taka(c.total);
    f[`cat.${c.category}.share`] = percent(c.share);
    f[`cat.${c.category}.count`] = String(c.count);
  }
  for (const m of summary.merchants) {
    const key = m.label.replace(/^Merchant /, '');
    f[`merchant.${key}.total`] = taka(m.total);
    f[`merchant.${key}.count`] = String(m.count);
  }
  return f;
}

export type GroundingResult = { ok: true; text: string } | { ok: false; reason: 'UNKNOWN_PLACEHOLDER' | 'RAW_NUMBER' };

/**
 * Checks one LLM-written string and fills its placeholders.
 * allowedNumbers: numbers the user typed in their own question, which the
 * answer may repeat (e.g. "how can I save 5000?").
 */
export function ground(text: string, facts: Facts, allowedNumbers: string[] = []): GroundingResult {
  let unknown = false;
  const withoutPlaceholders = text.replace(PLACEHOLDER, (_, key: string) => {
    if (!(key in facts)) unknown = true;
    return '';
  });
  if (unknown) return { ok: false, reason: 'UNKNOWN_PLACEHOLDER' };
  let rest = asciiDigits(withoutPlaceholders).replace(/(\d),(\d)/g, '$1$2');
  for (const n of allowedNumbers) rest = rest.split(n).join('');
  if (DIGIT.test(rest)) return { ok: false, reason: 'RAW_NUMBER' };
  // "the {{period}}" + "the last 30 days" would read "the the last 30 days".
  const filled = text.replace(PLACEHOLDER, (_, key: string) => facts[key]).replace(/\b(the) the\b/gi, '$1');
  return { ok: true, text: filled };
}

/** Numbers in the user's question, normalised (Bangla digits, thousands separators removed). */
export function numbersIn(question: string): string[] {
  return (asciiDigits(question).replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? [])
    .sort((a, b) => b.length - a.length);
}
