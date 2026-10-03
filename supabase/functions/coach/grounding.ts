// Coach facts: every figure the coach's LLM may cite, from the SQL summary.
// The grounding check itself is shared: ../_shared/llm/grounding.ts.

import { digits, percent, taka, type Facts } from '../_shared/llm/grounding.ts';
import { CATEGORY_LABELS, CATEGORY_LABELS_BN, PERIOD_LABELS, PERIOD_LABELS_BN, type Lang, type Period, type Summary } from './types.ts';

export { digits, ground, numbersIn, percent, taka } from '../_shared/llm/grounding.ts';
export type { Facts, GroundingResult } from '../_shared/llm/grounding.ts';

/** Every figure the LLM may cite, formatted for display. */
export function buildFacts(summary: Summary, period: Period, lang: Lang = 'en'): Facts {
  const n = (x: number) => digits(String(x), lang);
  const f: Facts = {
    period: (lang === 'bn' ? PERIOD_LABELS_BN : PERIOD_LABELS)[period],
    income: taka(summary.income, lang),
    spending: taka(summary.spending, lang),
    saved: taka(summary.saved, lang),
    net: taka(Math.abs(summary.net), lang),
    txn_count: n(summary.txn_count),
    'cashout.total': taka(summary.cashout.total, lang),
    'cashout.count': n(summary.cashout.count),
    'cashout.share': percent(summary.cashout.share, lang),
  };
  for (const c of summary.categories) {
    f[`cat.${c.category}.name`] = lang === 'bn' ? CATEGORY_LABELS_BN[c.category] : CATEGORY_LABELS[c.category].toLowerCase();
    f[`cat.${c.category}.total`] = taka(c.total, lang);
    f[`cat.${c.category}.share`] = percent(c.share, lang);
    f[`cat.${c.category}.count`] = n(c.count);
  }
  for (const m of summary.merchants) {
    const key = m.label.replace(/^Merchant /, '');
    f[`merchant.${key}.total`] = taka(m.total, lang);
    f[`merchant.${key}.count`] = n(m.count);
  }
  return f;
}

