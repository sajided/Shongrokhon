// Request flow of the `investigate` Edge Function (TC-P4-INV-03/05). Pure:
// the caller's alert lookup, the ML client, the service-role RPC and the LLM
// are injected (orchestrator.test.ts).
//
// alert (as the caller: SQL enforces the analyst role, INV-01) -> cached? ->
// SHAP from ML /explain (model-scored payments only) -> LLM evidence summary
// with a timeout -> grounding check -> template on any failure -> cache.

import { LlmError, sleep, type LlmProvider } from '../_shared/llm/provider.ts';
import {
  evidenceInput, summaryMessage, SUMMARY_SCHEMA, SUMMARY_SYSTEM, templateSummary, topDrivers, validateSummary,
  type AlertDetail, type EvidenceSummary, type Shap,
} from './evidence.ts';

export const PROMPT_VERSION = 'inv-v1';

export interface InvestigateConfig {
  llm_mode: 'live' | 'mock' | 'off';
  llm_timeout_ms: number;
  mock_delay_ms: number;
}

export interface InvestigateDeps {
  /** analyst_get_alert as the caller; throws { status: 403 } for non-analysts. */
  getAlert(alertId: string): Promise<AlertDetail & { explanation: null | { model_version: string | null; shap: Shap | null; summary: EvidenceSummary | null; summary_source: string | null } }>;
  /** ML /explain; null when the service is unavailable or the model version differs. */
  explain(features: Record<string, number>, modelVersion: string): Promise<Shap | null>;
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  config(): Promise<InvestigateConfig>;
  liveProvider: LlmProvider | null;
  now(): number;
}

/** Deterministic stand-in for tests (llm_mode = 'mock'): the template, through the same validation. */
class MockSummaryProvider implements LlmProvider {
  readonly source = 'MOCK' as const;
  readonly model = 'mock';
  constructor(private readonly delayMs: number) {}
  async complete(req: { user: string }, signal: AbortSignal): Promise<string> {
    await sleep(this.delayMs, signal);
    const json = req.user.match(/<alert_evidence>\n([\s\S]*?)\n<\/alert_evidence>/)?.[1] ?? '{}';
    return JSON.stringify(templateSummary(JSON.parse(json)));
  }
}

export interface InvestigateResult {
  shap: Shap | null;
  drivers: ReturnType<typeof topDrivers>;
  summary: EvidenceSummary;
  summary_source: 'LLM' | 'MOCK' | 'TEMPLATE';
  cached: boolean;
}

export async function runInvestigate(deps: InvestigateDeps, alertId: string, refresh = false): Promise<InvestigateResult> {
  const detail = await deps.getAlert(alertId);
  const cached = detail.explanation;
  if (!refresh && cached?.summary && (cached.shap || detail.alert.kind === 'RING' || detail.score?.source !== 'MODEL')) {
    return {
      shap: cached.shap, drivers: cached.shap ? topDrivers(cached.shap) : [], summary: cached.summary,
      summary_source: (cached.summary_source ?? 'TEMPLATE') as InvestigateResult['summary_source'], cached: true,
    };
  }

  // SHAP exists only for model-scored payments (rule and fallback scores have no model output).
  const shap = detail.score?.source === 'MODEL' && detail.score.features
    ? await deps.explain(detail.score.features, detail.score.model_version)
    : null;

  const input = evidenceInput(detail, shap);
  const cfg = await deps.config();
  const provider = cfg.llm_mode === 'mock' ? new MockSummaryProvider(cfg.mock_delay_ms)
    : cfg.llm_mode === 'live' ? deps.liveProvider : null;

  let summary: EvidenceSummary | null = null;
  let source: InvestigateResult['summary_source'] = 'TEMPLATE';
  if (provider) {
    const req = { action: 'INVESTIGATE' as const, system: SUMMARY_SYSTEM, user: summaryMessage(input), schema: SUMMARY_SCHEMA, maxTokens: 2000 };
    for (let attempt = 0; attempt < 2 && !summary; attempt++) {
      const t0 = deps.now();
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let outcome = 'INVALID';
      try {
        const text = await Promise.race([
          provider.complete(req, controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new LlmError('TIMEOUT'));
            }, cfg.llm_timeout_ms);
          }),
        ]);
        summary = validateSummary(text, input.facts);
        outcome = summary ? 'OK' : 'INVALID';
      } catch (e) {
        outcome = e instanceof LlmError ? e.reason : 'UNAVAILABLE';
      } finally {
        clearTimeout(timer);
      }
      await deps.rpc('log_coach_request', {
        p_user_id: null, p_action: 'INVESTIGATE', p_payload: { prompt_version: PROMPT_VERSION, alert_id: alertId, user: req.user },
        p_model: provider.model, p_latency_ms: Math.round(deps.now() - t0), p_outcome: outcome,
      }).catch(() => undefined);
      if (outcome !== 'INVALID') break; // timeouts and outages are not retried
    }
    if (summary) source = provider.source;
  }
  if (!summary) summary = validateSummary(JSON.stringify(templateSummary(input)), input.facts)!;

  await deps.rpc('store_alert_explanation', {
    p_alert_id: alertId, p_model_version: shap?.model_version ?? detail.score?.model_version ?? null,
    p_shap: shap, p_summary: summary, p_summary_source: source,
  });
  return { shap, drivers: shap ? topDrivers(shap) : [], summary, summary_source: source, cached: false };
}
