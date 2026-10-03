// Deterministic insights built only from placeholders. Used when the LLM is
// off, times out or returns invalid output (TC-P3-LLM-07, TC-P3-MW-09), and by
// the mock provider. They go through the same grounding check as LLM output.

import { CATEGORY_LABELS, type CashLevel, type Category, type Insight } from './types.ts';

/** What the insights prompt sends the model (see prompts.ts). Contains no PII. */
export interface InsightsInput {
  period: string;
  cash_dependency: CashLevel;
  net_is_positive: boolean;
  has_savings: boolean;
  categories: Category[]; // spending categories, largest first
  merchants: { label: string; category: Category }[];
  facts: Record<string, string>;
}

export function templateInsights(input: InsightsInput): Insight[] {
  const out: Insight[] = [];
  const top = input.categories.find((c) => c !== 'CASH_OUT');

  if (input.cash_dependency !== 'LOW') {
    out.push({
      kind: 'CASH',
      title: 'Cash-outs are {{cashout.share}} of your spending',
      body: 'You cashed out {{cashout.count}} times ({{cashout.total}}) in {{period}}. Paying shops directly by QR '
        + 'avoids cash-out fees and keeps a record of where your money goes.',
    });
  }
  if (top) {
    out.push({
      kind: 'SPENDING',
      title: `${CATEGORY_LABELS[top]} is your biggest expense`,
      body: `You spent {{cat.${top}.total}} on {{cat.${top}.name}} in {{period}}, {{cat.${top}.share}} of your spending.`,
    });
  }
  if (input.net_is_positive) {
    out.push({
      kind: 'SAVING',
      title: 'You spent less than you received',
      body: '{{net}} of your income was left after spending in {{period}}. Setting it aside as a savings goal '
        + 'helps it stay saved.',
    });
  } else {
    out.push({
      kind: 'SAVING',
      title: 'Spending was higher than income',
      body: 'You spent {{net}} more than came into your wallet in {{period}}. Look at your biggest category first '
        + 'to find something to cut back.',
    });
  }
  if (input.has_savings) {
    out.push({ kind: 'TIP', title: 'Good habit', body: 'You moved {{saved}} to savings in {{period}}. Keep it up.' });
  }
  return out.slice(0, 4);
}

export const REGULATED_DISCLAIMER =
  "I can't recommend specific investments, stocks, crypto or loans. For decisions like these, please talk to "
  + 'a licensed financial adviser or your bank.';

export const UNAVAILABLE_ANSWER = "The coach can't answer questions right now. Please try again in a little while.";
