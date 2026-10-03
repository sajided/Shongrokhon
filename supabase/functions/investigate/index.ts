// AI Investigation Assistant entry point (Phase 4, TC-P4-INV-03/05).
//
// POST { alertId, refresh? }   (analyst JWT)
// The alert is read as the caller (analyst_get_alert), so SQL enforces the
// analyst role (INV-01); SHAP comes from the ML service (/explain) and the
// evidence summary from the LLM (grounded, template fallback). Results are
// cached per alert (alert_explanations).
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { AnthropicProvider } from '../_shared/llm/anthropic.ts';
import type { Shap } from './evidence.ts';
import { runInvestigate, type InvestigateDeps } from './orchestrator.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ML_URL = Deno.env.get('ML_URL');
const ML_SERVICE_TOKEN = Deno.env.get('ML_SERVICE_TOKEN');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const COACH_MODEL = Deno.env.get('COACH_MODEL') || 'claude-opus-5-5';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const liveProvider = ANTHROPIC_API_KEY ? new AnthropicProvider(Anthropic, ANTHROPIC_API_KEY, COACH_MODEL) : null;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

async function explain(features: Record<string, number>, modelVersion: string): Promise<Shap | null> {
  if (!ML_URL || !ML_SERVICE_TOKEN) return null;
  try {
    const res = await fetch(`${ML_URL}/explain`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ML_SERVICE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...features, model_version: modelVersion }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn(JSON.stringify({ event: 'explain_unavailable', status: res.status }));
      return null;
    }
    return await res.json() as Shap;
  } catch {
    console.warn(JSON.stringify({ event: 'explain_unavailable', status: 0 }));
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED' });
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { code: 'NOT_AUTHENTICATED' });

  let body: { alertId?: unknown; refresh?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { code: 'INVALID_REQUEST' });
  }
  if (typeof body.alertId !== 'string' || !UUID.test(body.alertId)) return json(400, { code: 'INVALID_REQUEST' });

  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false }, global: { headers: { Authorization: authorization } },
  });
  const deps: InvestigateDeps = {
    async getAlert(id) {
      const { data, error, status } = await asCaller.rpc('analyst_get_alert', { p_id: id });
      if (error) {
        if (status === 401 || error.code === 'PT401') throw new HttpError(401, 'NOT_AUTHENTICATED');
        if (error.code === '42501') throw new HttpError(403, 'NOT_ANALYST');
        if (error.message === 'ALERT_NOT_FOUND') throw new HttpError(404, 'ALERT_NOT_FOUND');
        throw new Error(`analyst_get_alert: ${error.code}`);
      }
      return data;
    },
    explain,
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const { data, error } = await admin.rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.code}`);
      return data as T;
    },
    async config() {
      const { data, error } = await admin.from('app_config')
        .select('coach_llm_mode, coach_llm_timeout_ms, coach_mock_delay_ms').eq('id', true).single();
      if (error) throw new Error('app_config');
      return { llm_mode: data.coach_llm_mode, llm_timeout_ms: data.coach_llm_timeout_ms, mock_delay_ms: data.coach_mock_delay_ms };
    },
    liveProvider,
    now: () => Date.now(),
  };

  try {
    const result = await runInvestigate(deps, body.alertId, body.refresh === true);
    console.log(JSON.stringify({ event: 'investigate', source: result.summary_source, cached: result.cached, shap: !!result.shap }));
    return json(200, result as unknown as Record<string, unknown>);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { code: e.code });
    console.error(JSON.stringify({ event: 'investigate_error', message: e instanceof Error ? e.message.split(':')[0] : 'unknown' }));
    return json(500, { code: 'INTERNAL_ERROR' });
  }
});
