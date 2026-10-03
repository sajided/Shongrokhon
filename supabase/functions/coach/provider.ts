// LLM provider interface. The live provider (anthropic.ts) is Deno-only; the
// mock is deterministic and used by integration and E2E tests
// (app_config.coach_llm_mode = 'mock'). Both return raw JSON text that the
// orchestrator validates exactly the same way.

import { ruleCategory, type MerchantRef } from './categorize.ts';
import { tagged } from './prompts.ts';
import { templateInsights, type InsightsInput } from './template.ts';

export type LlmAction = 'CATEGORIZE' | 'INSIGHTS' | 'ASK';

export interface LlmRequest {
  action: LlmAction;
  system: string;
  user: string;
  schema: object;
  maxTokens: number;
}

export type LlmFailure = 'TIMEOUT' | 'REFUSAL' | 'TRUNCATED' | 'UNAVAILABLE';

export class LlmError extends Error {
  constructor(readonly reason: LlmFailure, message?: string) {
    super(message ?? reason);
  }
}

export interface LlmProvider {
  /** 'LLM' or 'MOCK': stored as the source of categories and insights. */
  readonly source: 'LLM' | 'MOCK';
  readonly model: string;
  /** Resolves to the model's JSON text; rejects with LlmError. Must stop when `signal` aborts. */
  complete(req: LlmRequest, signal: AbortSignal): Promise<string>;
}

const REGULATED = /\b(stocks?|shares?|share ?market|invest(ment|ing)?|crypto|bitcoin|mutual ?funds?|bonds?|forex|sanchaypatra|savings? certificates?|loans?|borrow(ing)?|interest rate|emi)\b|শেয়ার|বিনিয়োগ|ঋণ|লোন/i;
const MONEY = /\b(spend|spending|save|saving|savings|budget|money|cash|khoroch|komabo|taka|income|expense|bill|rent)\b|খরচ|টাকা|সঞ্চয়/i;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new LlmError('TIMEOUT'));
    }, { once: true });
  });
}

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
    if (REGULATED.test(question)) {
      return JSON.stringify({
        topic: 'REGULATED_ADVICE',
        answer: 'A good general rule is to keep an emergency fund before taking any risk, and to compare the total '
          + 'cost and terms of any product carefully.',
      });
    }
    if (!MONEY.test(question)) {
      return JSON.stringify({ topic: 'OFF_TOPIC', answer: 'I can only help with your spending and saving.' });
    }
    return JSON.stringify({
      topic: 'GENERAL',
      answer: 'You spent {{spending}} in {{period}}. Start with your biggest category and set a weekly limit for it.',
    });
  }
}
