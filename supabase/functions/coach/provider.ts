// Deterministic stand-in for the model, used by integration and E2E tests
// (app_config.coach_llm_mode = 'mock'). It returns raw JSON text that the
// orchestrator validates exactly like the live model's.

import { LlmError, sleep, type LlmProvider, type LlmRequest } from '../_shared/llm/provider.ts';
import { ruleCategory, type MerchantRef } from './categorize.ts';
import { tagged } from './prompts.ts';
import { templateInsights, type InsightsInput } from './template.ts';

export { LlmError };
export type { LlmProvider, LlmRequest };

const REGULATED = /\b(stocks?|shares?|share ?market|invest(ment|ing)?|crypto|bitcoin|mutual ?funds?|bonds?|forex|sanchaypatra|savings? certificates?|loans?|borrow(ing)?|interest rate|emi)\b|শেয়ার|বিনিয়োগ|ঋণ|লোন/i;
const MONEY = /\b(spend|spending|save|saving|savings|budget|money|cash|khoroch|komabo|taka|income|expense|bill|rent|shonchoy)\b|খরচ|টাকা|সঞ্চয়/i;

/** Deterministic stand-in for the model. `delayMs` simulates a slow LLM (TC-P3-MW-09). */
export class MockProvider implements LlmProvider {
  readonly source = 'MOCK' as const;
  readonly model = 'mock';

  constructor(private readonly delayMs = 0) {}

  async complete(req: LlmRequest, signal: AbortSignal): Promise<string> {
    await sleep(this.delayMs, signal);
    if (req.action === 'CATEGORIZE') {
      const refs = JSON.parse(tagged(req.user, 'merchants') ?? '[]') as MerchantRef[];
      return JSON.stringify({ items: refs.map((r) => ({ ref: r.ref, category: ruleCategory(r.name) })) });
    }
    const input = JSON.parse(tagged(req.user, 'financial_summary') ?? '{}') as InsightsInput;
    if (req.action === 'INSIGHTS') return JSON.stringify({ insights: templateInsights(input) });

    const question = tagged(req.user, 'user_question') ?? '';
    const bn = input.lang === 'bn';
    if (REGULATED.test(question)) {
      return JSON.stringify({
        topic: 'REGULATED_ADVICE',
        answer: bn
          ? 'সাধারণ নিয়ম হলো, কোনো ঝুঁকি নেওয়ার আগে জরুরি খরচের জন্য কিছু টাকা আলাদা রাখুন, আর যেকোনো পণ্যের মোট খরচ ও শর্ত ভালো করে মিলিয়ে দেখুন।'
          : 'A good general rule is to keep an emergency fund before taking any risk, and to compare the total '
            + 'cost and terms of any product carefully.',
      });
    }
    if (!MONEY.test(question)) {
      return JSON.stringify({
        topic: 'OFF_TOPIC',
        answer: bn ? 'আমি শুধু আপনার খরচ আর সঞ্চয় নিয়ে সাহায্য করতে পারি।' : 'I can only help with your spending and saving.',
      });
    }
    return JSON.stringify({
      topic: 'GENERAL',
      answer: bn
        ? '{{period}} আপনার খরচ হয়েছে {{spending}}। সবচেয়ে বড় খরচের খাত দিয়ে শুরু করুন, আর সেটার জন্য সপ্তাহে একটা সীমা ঠিক করে নিন।'
        : 'You spent {{spending}} in {{period}}. Start with your biggest category and set a weekly limit for it.',
    });
  }
}
