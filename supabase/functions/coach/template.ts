// Deterministic insights built only from placeholders. Used when the LLM is
// off, times out or returns invalid output (TC-P3-LLM-07, TC-P3-MW-09), and by
// the mock provider. They go through the same grounding check as LLM output.

import { CATEGORY_LABELS, CATEGORY_LABELS_BN, type CashLevel, type Category, type Insight, type Lang } from './types.ts';

/** What the insights prompt sends the model (see prompts.ts). Contains no PII. */
export interface InsightsInput {
  /** Language the user reads the app in (TC-P4-L10N-06). */
  lang: Lang;
  period: string;
  cash_dependency: CashLevel;
  net_is_positive: boolean;
  has_savings: boolean;
  categories: Category[]; // spending categories, largest first
  merchants: { label: string; category: Category }[];
  facts: Record<string, string>;
}

export function templateInsights(input: InsightsInput): Insight[] {
  if (input.lang === 'bn') return templateInsightsBn(input);
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

/** Bangla templates: natural, conversational Bangla, not a word-for-word translation. */
function templateInsightsBn(input: InsightsInput): Insight[] {
  const out: Insight[] = [];
  const top = input.categories.find((c) => c !== 'CASH_OUT');
  if (input.cash_dependency !== 'LOW') {
    out.push({
      kind: 'CASH',
      title: 'আপনার খরচের {{cashout.share}} যাচ্ছে ক্যাশ আউটে',
      body: '{{period}} আপনি {{cashout.count}} বার ক্যাশ আউট করেছেন, মোট {{cashout.total}}। দোকানে সরাসরি QR দিয়ে '
        + 'পেমেন্ট করলে ক্যাশ আউটের চার্জ লাগে না, আর টাকা কোথায় গেল সেটাও দেখা যায়।',
    });
  }
  if (top) {
    out.push({
      kind: 'SPENDING',
      title: `সবচেয়ে বেশি খরচ হচ্ছে ${CATEGORY_LABELS_BN[top]}-এ`,
      body: `{{period}} {{cat.${top}.name}}-এ খরচ হয়েছে {{cat.${top}.total}}, যা আপনার মোট খরচের {{cat.${top}.share}}।`,
    });
  }
  if (input.net_is_positive) {
    out.push({
      kind: 'SAVING',
      title: 'আয়ের চেয়ে খরচ কম হয়েছে',
      body: '{{period}} খরচের পরও আপনার আয়ের {{net}} হাতে রয়ে গেছে। এই টাকাটা একটা সঞ্চয়ের লক্ষ্যে রেখে দিলে '
        + 'সহজে খরচ হয়ে যাবে না।',
    });
  } else {
    out.push({
      kind: 'SAVING',
      title: 'আয়ের চেয়ে খরচ বেশি হয়েছে',
      body: '{{period}} ওয়ালেটে যা এসেছে তার চেয়ে {{net}} বেশি খরচ হয়েছে। সবচেয়ে বড় খরচের খাতটা দিয়েই শুরু করুন, '
        + 'কোথায় একটু কমানো যায় দেখুন।',
    });
  }
  if (input.has_savings) {
    out.push({ kind: 'TIP', title: 'দারুণ অভ্যাস', body: '{{period}} আপনি {{saved}} সঞ্চয়ে রেখেছেন। এভাবেই চালিয়ে যান।' });
  }
  return out.slice(0, 4);
}

export const REGULATED_DISCLAIMER: Record<Lang, string> = {
  en: "I can't recommend specific investments, stocks, crypto or loans. For decisions like these, please talk to "
    + 'a licensed financial adviser or your bank.',
  bn: 'নির্দিষ্ট কোনো বিনিয়োগ, শেয়ার, ক্রিপ্টো বা ঋণের পরামর্শ আমি দিতে পারি না। এ ধরনের সিদ্ধান্তের জন্য '
    + 'লাইসেন্সপ্রাপ্ত আর্থিক পরামর্শদাতা বা আপনার ব্যাংকের সঙ্গে কথা বলুন।',
};

export const UNAVAILABLE_ANSWER: Record<Lang, string> = {
  en: "The coach can't answer questions right now. Please try again in a little while.",
  bn: 'কোচ এই মুহূর্তে প্রশ্নের উত্তর দিতে পারছে না। একটু পরে আবার চেষ্টা করুন।',
};
