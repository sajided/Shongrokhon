// Request flow of the `coach` Edge Function. Pure: database calls, the live
// LLM provider and logging are injected, so every branch is Jest-tested
// (orchestrator.test.ts).
//
// insights: rate limit -> coach_context -> categorise new merchants ->
//   not enough data? (no LLM call, MW-05) -> cached? (MW-08) -> LLM with a
//   timeout -> grounding check -> cache; any failure -> template (LLM-07, MW-09)
// ask: rate limit -> coach_context -> scrub question -> LLM -> grounding ->
//   regulated-advice disclaimer (LLM-05)

import { CATEGORIZE_SCHEMA, merchantRefs, parseCategories } from './categorize.ts';
import { buildFacts, ground, numbersIn, type Facts } from './grounding.ts';
import {
  ASK_SCHEMA, ASK_SYSTEM, askMessage, CATEGORIZE_SYSTEM, categorizeMessage, INSIGHTS_SCHEMA, INSIGHTS_SYSTEM,
  insightsMessage, PROMPT_VERSION,
} from './prompts.ts';
import { LlmError, MockProvider, type LlmProvider, type LlmRequest } from './provider.ts';
import { scrubPII } from './sanitize.ts';
import { REGULATED_DISCLAIMER, templateInsights, UNAVAILABLE_ANSWER, type InsightsInput } from './template.ts';
import {
  ASK_TOPICS, INSIGHT_KINDS, PERIOD_LABELS, type AskTopic, type CoachContext, type Insight, type Period, type Summary,
} from './types.ts';

export interface CoachDeps {
  /** Service-role RPC; throws on error. */
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** The Anthropic provider, or null when no API key is configured. */
  liveProvider: LlmProvider | null;
  now(): number;
  log(event: Record<string, unknown>): void;
}

export interface CoachResponse {
  status: number;
  body: Record<string, unknown>;
}

const MAX_QUESTION = 300;

function providerFor(ctx: CoachContext, deps: CoachDeps): LlmProvider | null {
  switch (ctx.config.llm_mode) {
    case 'mock': return new MockProvider(ctx.config.mock_delay_ms);
    case 'live': return deps.liveProvider;
    default: return null;
  }
}

/**
 * One LLM call with a hard timeout, validated by `parse`, retried once if the
 * output is invalid. Every attempt is written to coach_llm_requests.
 */
async function callLlm<T>(
  deps: CoachDeps, provider: LlmProvider, userId: string, req: LlmRequest, timeoutMs: number,
  parse: (text: string) => T | null,
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  let reason = 'INVALID';
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = deps.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The race guarantees no hung request even if a provider ignores the signal (TC-P3-MW-09).
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new LlmError('TIMEOUT'));
      }, timeoutMs);
    });
    let value: T | null = null;
    try {
      const text = await Promise.race([provider.complete(req, controller.signal), timeout]);
      value = parse(text);
      reason = value === null ? 'INVALID' : 'OK';
    } catch (e) {
      reason = e instanceof LlmError ? e.reason : 'UNAVAILABLE';
    } finally {
      clearTimeout(timer);
    }
    const latency = Math.round(deps.now() - t0);
    try {
      await deps.rpc('log_coach_request', {
        p_user_id: userId, p_action: req.action, p_payload: { prompt_version: PROMPT_VERSION, user: req.user },
        p_model: provider.model, p_latency_ms: latency, p_outcome: reason,
      });
    } catch {
      deps.log({ event: 'coach_audit_failed', action: req.action });
    }
    deps.log({ event: 'coach_llm', action: req.action, outcome: reason, ms: latency, attempt });
    if (value !== null) return { ok: true, value };
    if (reason !== 'INVALID') break; // timeouts and outages are not retried: the budget is spent
  }
  return { ok: false, reason };
}

async function context(deps: CoachDeps, userId: string, period: Period): Promise<CoachContext> {
  return deps.rpc<CoachContext>('coach_context', { p_user_id: userId, p_period: period });
}

/** Categorises merchants the user paid that have no category yet. Returns true if any were added. */
async function categorizePending(deps: CoachDeps, provider: LlmProvider | null, userId: string, ctx: CoachContext) {
  if (ctx.uncategorized.length === 0) return false;
  const refs = merchantRefs(ctx.uncategorized);
  let fromModel = new Set<string>();
  let byRef = parseCategories('{}', refs).byRef;
  if (provider) {
    const res = await callLlm(deps, provider, userId, {
      action: 'CATEGORIZE', system: CATEGORIZE_SYSTEM, user: categorizeMessage(refs), schema: CATEGORIZE_SCHEMA,
      maxTokens: 4000,
    }, ctx.config.llm_timeout_ms, (text) => {
      const parsed = parseCategories(text, refs);
      return parsed.fromModel.size > 0 ? parsed : null;
    });
    if (res.ok) ({ byRef, fromModel } = res.value);
  }
  await deps.rpc('record_merchant_categories', {
    p_items: refs.map((r, i) => ({
      wallet_id: ctx.uncategorized[i].wallet_id,
      category: byRef.get(r.ref),
      source: fromModel.has(r.ref) ? provider!.source : 'RULE',
      model: fromModel.has(r.ref) ? provider!.model : null,
    })),
  });
  return true;
}

export function insightsInput(summary: Summary, period: Period, facts: Facts): InsightsInput {
  return {
    period: PERIOD_LABELS[period],
    cash_dependency: summary.cashout.level,
    net_is_positive: summary.net >= 0,
    has_savings: summary.saved > 0,
    categories: summary.categories.map((c) => c.category),
    merchants: summary.merchants.map((m) => ({ label: m.label, category: m.category })),
    facts,
  };
}

/** Parses and grounds LLM insight cards; null if anything is off. */
export function validateInsights(text: string, facts: Facts): Insight[] | null {
  let raw: unknown;
  try {
    raw = (JSON.parse(text) as { insights?: unknown }).insights;
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) return null;
  const out: Insight[] = [];
  for (const item of raw) {
    const { kind, title, body } = (item ?? {}) as Record<string, unknown>;
    if (!(INSIGHT_KINDS as readonly unknown[]).includes(kind)) return null;
    if (typeof title !== 'string' || typeof body !== 'string') return null;
    if (!title.trim() || title.length > 80 || !body.trim() || body.length > 400) return null;
    const t = ground(title, facts);
    const b = ground(body, facts);
    if (!t.ok || !b.ok) return null;
    out.push({ kind: kind as Insight['kind'], title: t.text, body: b.text });
  }
  return out;
}

function fillTemplate(input: InsightsInput, facts: Facts): Insight[] {
  return templateInsights(input).map((i) => {
    const t = ground(i.title, facts);
    const b = ground(i.body, facts);
    if (!t.ok || !b.ok) throw new Error('template uses an unknown fact'); // a bug, caught by unit tests
    return { ...i, title: t.text, body: b.text };
  });
}

async function rateLimited(deps: CoachDeps, userId: string): Promise<CoachResponse | null> {
  const r = await deps.rpc<{ allowed: boolean; retry_after: number }>('coach_rate_hit', {
    p_user_id: userId, p_bucket: 'coach',
  });
  return r.allowed ? null : { status: 429, body: { code: 'RATE_LIMITED', retry_after: r.retry_after } };
}

export async function runInsights(deps: CoachDeps, userId: string, period: Period): Promise<CoachResponse> {
  const limited = await rateLimited(deps, userId);
  if (limited) return limited;

  let ctx = await context(deps, userId, period);
  const provider = providerFor(ctx, deps);
  const categoriesUpdated = await categorizePending(deps, provider, userId, ctx);
  if (categoriesUpdated) ctx = await context(deps, userId, period);

  const base = { period, categories_updated: categoriesUpdated };
  if (ctx.summary.txn_count < ctx.config.min_txns) {
    return { status: 200, body: { ...base, status: 'INSUFFICIENT_DATA', insights: [] } };
  }
  if (ctx.cached) {
    return {
      status: 200,
      body: { ...base, status: 'OK', source: ctx.cached.source, cached: true, insights: ctx.cached.payload.insights,
              generated_at: ctx.cached.created_at },
    };
  }

  const facts = buildFacts(ctx.summary, period);
  const input = insightsInput(ctx.summary, period, facts);
  const generatedAt = new Date(deps.now()).toISOString();
  if (provider) {
    const res = await callLlm(deps, provider, userId, {
      action: 'INSIGHTS', system: INSIGHTS_SYSTEM, user: insightsMessage(input), schema: INSIGHTS_SCHEMA,
      maxTokens: 2000,
    }, ctx.config.llm_timeout_ms, (text) => validateInsights(text, facts));
    if (res.ok) {
      await deps.rpc('coach_cache_put', {
        p_user_id: userId, p_period: period, p_hash: ctx.summary.data_hash,
        p_payload: { insights: res.value }, p_source: provider.source,
      });
      return {
        status: 200,
        body: { ...base, status: 'OK', source: provider.source, cached: false, insights: res.value, generated_at: generatedAt },
      };
    }
  }
  // Not cached, so the next request tries the LLM again.
  return {
    status: 200,
    body: { ...base, status: 'OK', source: 'TEMPLATE', cached: false, insights: fillTemplate(input, facts),
            generated_at: generatedAt },
  };
}

export function validateAnswer(text: string, facts: Facts, allowedNumbers: string[]): { topic: AskTopic; answer: string } | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const { topic, answer } = raw ?? {};
  if (!(ASK_TOPICS as readonly unknown[]).includes(topic)) return null;
  if (typeof answer !== 'string' || !answer.trim() || answer.length > 800) return null;
  const g = ground(answer, facts, allowedNumbers);
  return g.ok ? { topic: topic as AskTopic, answer: g.text } : null;
}

export async function runAsk(deps: CoachDeps, userId: string, question: unknown): Promise<CoachResponse> {
  if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION) {
    return { status: 400, body: { code: 'INVALID_QUESTION' } };
  }
  const limited = await rateLimited(deps, userId);
  if (limited) return limited;

  const period: Period = 'MONTH';
  const ctx = await context(deps, userId, period);
  const provider = providerFor(ctx, deps);
  if (!provider) return { status: 200, body: { status: 'UNAVAILABLE', answer: UNAVAILABLE_ANSWER } };

  const clean = scrubPII(question, MAX_QUESTION);
  const facts = buildFacts(ctx.summary, period);
  const allowed = numbersIn(clean);
  const res = await callLlm(deps, provider, userId, {
    action: 'ASK', system: ASK_SYSTEM, user: askMessage(clean, insightsInput(ctx.summary, period, facts)),
    schema: ASK_SCHEMA, maxTokens: 1000,
  }, ctx.config.llm_timeout_ms, (text) => validateAnswer(text, facts, allowed));
  if (!res.ok) return { status: 200, body: { status: 'UNAVAILABLE', answer: UNAVAILABLE_ANSWER } };

  const { topic, answer } = res.value;
  const declined = topic === 'REGULATED_ADVICE';
  return {
    status: 200,
    body: { status: 'OK', source: provider.source, topic, declined,
            answer: declined ? `${REGULATED_DISCLAIMER} ${answer}` : answer },
  };
}
