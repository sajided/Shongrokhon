// ML scoring client for the `pay` Edge Function (TC-P2-FLOW-04/05).
//
// Pure: no Deno or Supabase imports, `fetch` and the clock are injected, so
// the timeout and fallback rules are unit-tested with Jest
// (score.test.ts). Never throws: any failure becomes a FALLBACK outcome,
// and the rule-based policy in SQL (private.fallback_risk) decides.

export interface ModelScore {
  risk_score: number;
  anomaly_score: number;
  low_confidence: boolean;
  model_version: string;
}

export type FallbackReason = 'NOT_CONFIGURED' | 'TIMEOUT' | 'UNAVAILABLE' | 'BAD_RESPONSE';

export type ScoreOutcome =
  | { source: 'MODEL'; score: ModelScore; latencyMs: number }
  | { source: 'FALLBACK'; reason: FallbackReason; latencyMs: number };

export interface ScoreOptions {
  url: string | undefined;
  token: string | undefined;
  features: Record<string, number>;
  requestId: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function isModelScore(x: unknown): x is ModelScore {
  const s = x as ModelScore;
  return (
    !!s &&
    typeof s.risk_score === 'number' && s.risk_score >= 0 && s.risk_score <= 1 &&
    typeof s.anomaly_score === 'number' && Number.isFinite(s.anomaly_score) &&
    typeof s.low_confidence === 'boolean' &&
    typeof s.model_version === 'string'
  );
}

export async function scoreWithModel(opts: ScoreOptions): Promise<ScoreOutcome> {
  const now = opts.now ?? (() => Date.now());
  const fetchImpl = opts.fetchImpl ?? fetch;
  const started = now();
  const done = (reason: FallbackReason): ScoreOutcome => ({ source: 'FALLBACK', reason, latencyMs: now() - started });

  if (!opts.url || !opts.token) return done('NOT_CONFIGURED');

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, opts.timeoutMs));
  try {
    const res = await fetchImpl(`${opts.url.replace(/\/$/, '')}/score`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: opts.requestId, ...opts.features }),
      signal: controller.signal,
    });
    if (!res.ok) return done('UNAVAILABLE');
    const body: unknown = await res.json();
    if (!isModelScore(body)) return done('BAD_RESPONSE');
    return { source: 'MODEL', score: body, latencyMs: now() - started };
  } catch {
    return done(timedOut ? 'TIMEOUT' : 'UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}
