// Merchant categorisation. The LLM sees only merchant business names, under
// short refs (m1, m2, ...), never wallet ids or any user data (TC-P3-MW-03).
// Its answer must be one of the fixed categories (TC-P3-LLM-03); anything else
// falls back to keyword rules. A merchant name that tries to instruct the
// model can at worst get a wrong category (TC-P3-MW-06).

import { scrubPII } from '../_shared/llm/sanitize.ts';
import { MERCHANT_CATEGORIES, type Category } from './types.ts';

const RULES: [RegExp, Category][] = [
  [/\b(dps|savings?|deposit|fdr|bank)\b/i, 'SAVINGS'],
  [/\b(rent|house|homes?|flat|landlord|apartment)\b/i, 'BILLS'],
  [/\b(desco|dpdc|wasa|titas|electric(ity)?|gas|water|prepaid|internet|broadband|wifi)\b/i, 'UTILITIES'],
  [/\b(ride|rides|uber|pathao|shohoz|bus|cng|taxi|rail|transport|fuel|petrol)\b/i, 'TRANSPORT'],
  [/\b(pharma(cy)?|medic(al|ine)s?|clinic|hospital|diagnostic|doctor)\b/i, 'HEALTH'],
  [/\b(school|college|university|tuition|coaching|academy|books?)\b/i, 'EDUCATION'],
  [/\b(recharge|telecom|mobile|insurance|bill)\b/i, 'BILLS'],
  [/\b(diner|restaurant|cafe|food|biryani|kitchen|bakery|sweets|tea|grocery|grocer|bazar|bazaar|store|mart|super ?shop)\b/i, 'FOOD'],
  [/\b(fashion|cloth(ing)?|shoes?|electronics?|mall|boutique|tailor|gadget|shop|traders)\b/i, 'SHOPPING'],
];

export function ruleCategory(name: string): Category {
  for (const [re, category] of RULES) if (re.test(name)) return category;
  return 'OTHERS';
}

export interface MerchantRef {
  ref: string;
  name: string;
}

export function merchantRefs(merchants: { name: string }[]): MerchantRef[] {
  return merchants.map((m, i) => ({ ref: `m${i + 1}`, name: scrubPII(m.name, 80) }));
}

export const CATEGORIZE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ref: { type: 'string' }, category: { type: 'string', enum: MERCHANT_CATEGORIES } },
        required: ['ref', 'category'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

/** LLM output -> a category per ref. Missing or invalid entries use the keyword rules. */
export function parseCategories(raw: string, refs: MerchantRef[]): { byRef: Map<string, Category>; fromModel: Set<string> } {
  const byRef = new Map<string, Category>();
  const fromModel = new Set<string>();
  let items: unknown = [];
  try {
    items = (JSON.parse(raw) as { items?: unknown }).items;
  } catch {
    items = [];
  }
  const known = new Set(refs.map((r) => r.ref));
  for (const item of Array.isArray(items) ? items : []) {
    const { ref, category } = (item ?? {}) as { ref?: unknown; category?: unknown };
    if (typeof ref === 'string' && known.has(ref) && (MERCHANT_CATEGORIES as readonly unknown[]).includes(category)) {
      byRef.set(ref, category as Category);
      fromModel.add(ref);
    }
  }
  for (const r of refs) if (!byRef.has(r.ref)) byRef.set(r.ref, ruleCategory(r.name));
  return { byRef, fromModel };
}
