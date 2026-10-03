// AI coach entry point (Phase 3): the middleware between the app and the LLM.
//
// POST { action: 'insights', period: 'WEEK' | 'MONTH' | '3M' }   (user JWT)
// POST { action: 'ask', question: string }
// Both take lang: 'en' | 'bn' (Phase 4, TC-P4-L10N-06/07): answers, figures and
// labels come back in that language; insights are cached per language.
// The caller is always the JWT's user. A user_id for someone else is refused
// with 403 (TC-P3-MW-02); the LLM only ever sees anonymised aggregates and
// placeholders (orchestrator.ts). Dashboard numbers come from SQL RPCs, not here.
//
// Logs carry only event names, outcomes and timings, never amounts or text.
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { AnthropicProvider } from '../_shared/llm/anthropic.ts';
import { runAsk, runInsights, type CoachDeps } from './orchestrator.ts';
import { LANGS, PERIODS, type Lang, type Period } from './types.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const COACH_MODEL = Deno.env.get('COACH_MODEL') || 'claude-opus-5-5';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const liveProvider = ANTHROPIC_API_KEY ? new AnthropicProvider(Anthropic, ANTHROPIC_API_KEY, COACH_MODEL) : null;

const deps: CoachDeps = {
  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.code ?? ''} ${error.message}`);
    return data as T;
  },
  liveProvider,
  now: () => Date.now(),
  log: (event) => console.log(JSON.stringify(event)),
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// verify_jwt is off for the same reason as `pay`: getClaims verifies the
// asymmetric user token against the JWKS.
async function callerId(authorization: string | null): Promise<string | null> {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getClaims(token);
  const claims = data?.claims;
  if (error || !claims || claims.role !== 'authenticated' || typeof claims.sub !== 'string') return null;
  return claims.sub;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED' });

  const userId = await callerId(req.headers.get('Authorization'));
  if (!userId) return json(401, { code: 'NOT_AUTHENTICATED' }); // TC-P3-MW-01

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { code: 'INVALID_REQUEST' });
  }
  if (body.user_id !== undefined && body.user_id !== userId) return json(403, { code: 'FORBIDDEN' }); // TC-P3-MW-02

  const lang = (body.lang ?? 'en') as Lang;
  if (!LANGS.includes(lang)) return json(400, { code: 'INVALID_LANGUAGE' });

  try {
    let res;
    if (body.action === 'insights') {
      const period = (body.period ?? 'MONTH') as Period;
      if (!PERIODS.includes(period)) return json(400, { code: 'INVALID_PERIOD' });
      res = await runInsights(deps, userId, period, lang);
    } else if (body.action === 'ask') {
      res = await runAsk(deps, userId, body.question, lang);
    } else {
      return json(400, { code: 'INVALID_REQUEST' });
    }
    return json(res.status, res.body);
  } catch (e) {
    console.error(JSON.stringify({ event: 'coach_error', message: e instanceof Error ? e.message.split(':')[0] : 'unknown' }));
    return json(500, { code: 'INTERNAL_ERROR' });
  }
});
