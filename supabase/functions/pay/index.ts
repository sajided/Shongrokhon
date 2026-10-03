// Payment entry point: scan -> score -> execute/flag (TC-P2-FLOW-01..07).
//
// POST { merchantId, amount, pin, idempotencyKey, note?, confirm? }  (user JWT)
//   1. risk_context (service role): features, or the existing score for this key
//   2. ML /score with a timeout; on failure the SQL fallback rules decide
//   3. record_risk_score (service role) -> score id + authoritative decision
//   4. make_payment as the caller (their JWT) with the score id
// Returns make_payment's JSON unchanged (SUCCESS / FAILED / STEP_UP_REQUIRED).
//
// Phase 4: POST { kind: 'CASHOUT', agentCode, ... } or { kind: 'TRANSFER', phone, ... }.
// The ML model only knows QR merchant payments, so these are scored by SQL
// rules (flow_score, service role), then make_cashout / make_transfer run as
// the caller. Same response shapes.
//
// Logs carry only event names, reasons and timings, never phone numbers,
// amounts or PINs.
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { scoreWithModel } from './score.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ML_URL = Deno.env.get('ML_URL');
const ML_SERVICE_TOKEN = Deno.env.get('ML_SERVICE_TOKEN');

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// verify_jwt is off: the gateway only checks the legacy HS256 secret, while user
// tokens are signed with the project's asymmetric key. getClaims verifies the
// signature against the JWKS (cached per worker). PostgREST verifies the same
// token again when make_payment runs as the caller.
async function callerId(authorization: string | null): Promise<string | null> {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getClaims(token);
  const claims = data?.claims;
  if (error || !claims || claims.role !== 'authenticated' || typeof claims.sub !== 'string') return null;
  return claims.sub;
}

interface PayBody {
  kind?: unknown;
  agentCode?: unknown;
  phone?: unknown;
  merchantId?: unknown;
  amount?: unknown;
  pin?: unknown;
  idempotencyKey?: unknown;
  note?: unknown;
  confirm?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function scoreId(userId: string, merchantId: string, amount: number, key: string): Promise<string | null> {
  const t0 = Date.now();
  const { data: ctx, error } = await admin.rpc('risk_context', {
    p_user_id: userId, p_merchant_id: merchantId, p_amount: amount, p_idempotency_key: key,
  });
  if (error) throw new Error(`risk_context: ${error.message}`);
  if (ctx.skip) return null; // make_payment will reject the request with a specific code
  if (ctx.score) return ctx.score.id;

  const outcome = await scoreWithModel({
    url: ML_URL, token: ML_SERVICE_TOKEN, features: ctx.features, requestId: key, timeoutMs: ctx.ml_timeout_ms,
  });
  const args: Record<string, unknown> = {
    p_user_id: userId, p_merchant_id: merchantId, p_amount: amount, p_idempotency_key: key,
    p_features: ctx.features, p_source: outcome.source, p_latency_ms: Math.round(outcome.latencyMs),
  };
  if (outcome.source === 'MODEL') {
    Object.assign(args, {
      p_risk_score: outcome.score.risk_score, p_anomaly_score: outcome.score.anomaly_score,
      p_low_confidence: outcome.score.low_confidence, p_model_version: outcome.score.model_version,
    });
  } else {
    // TC-P2-FLOW-04/05: clearly logged, never surfaced to the user.
    console.warn(JSON.stringify({ event: 'risk_fallback', reason: outcome.reason, ml_ms: Math.round(outcome.latencyMs) }));
  }
  const { data: rec, error: recError } = await admin.rpc('record_risk_score', args);
  if (recError) throw new Error(`record_risk_score: ${recError.message}`);
  console.log(JSON.stringify({ event: 'risk_scored', source: outcome.source, decision: rec.decision,
                               ml_ms: Math.round(outcome.latencyMs), total_ms: Date.now() - t0 }));
  return rec.id;
}

// Cash-outs and transfers: SQL rule score (flow_score), no ML call.
async function flowScoreId(userId: string, kind: string, target: string, amount: number, key: string): Promise<string | null> {
  const t0 = Date.now();
  const { data, error } = await admin.rpc('flow_score', {
    p_user_id: userId, p_kind: kind, p_target: target, p_amount: amount, p_idempotency_key: key,
  });
  if (error) throw new Error(`flow_score: ${error.message}`);
  if (data.skip) return null; // the make_* RPC rejects the request with a specific code
  console.log(JSON.stringify({ event: 'risk_scored', source: 'RULES', kind, decision: data.decision, total_ms: Date.now() - t0 }));
  return data.id;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED' });

  const authorization = req.headers.get('Authorization');
  const userId = await callerId(authorization);
  if (!userId) return json(401, { code: 'NOT_AUTHENTICATED' });

  let body: PayBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { code: 'INVALID_REQUEST' });
  }
  const { merchantId, agentCode, phone, amount, pin, idempotencyKey, note, confirm } = body;
  const kind = body.kind ?? 'PAYMENT';
  const target = kind === 'PAYMENT' ? merchantId : kind === 'CASHOUT' ? agentCode : kind === 'TRANSFER' ? phone : null;
  if (typeof target !== 'string' || typeof amount !== 'number' || !Number.isFinite(amount)
      || typeof idempotencyKey !== 'string' || !UUID.test(idempotencyKey)
      || (pin !== undefined && typeof pin !== 'string') || (note != null && typeof note !== 'string')) {
    return json(400, { code: 'INVALID_REQUEST' });
  }

  try {
    const score = kind === 'PAYMENT'
      ? await scoreId(userId, target, amount, idempotencyKey)
      : await flowScoreId(userId, kind as string, target, amount, idempotencyKey);
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authorization! } },
    });
    const common = { p_amount: amount, p_pin: pin ?? null, p_idempotency_key: idempotencyKey, p_score_id: score,
                     p_confirm: confirm === true };
    const { data, error, status } = kind === 'PAYMENT'
      ? await asUser.rpc('make_payment', { ...common, p_merchant_id: target, p_note: note ?? null })
      : kind === 'CASHOUT'
        ? await asUser.rpc('make_cashout', { ...common, p_agent_code: target })
        : await asUser.rpc('make_transfer', { ...common, p_phone: target, p_note: note ?? null });
    if (error) {
      if (status === 401 || error.code === 'PT401') return json(401, { code: error.message });
      const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'INTERNAL_ERROR';
      if (code === 'INTERNAL_ERROR') {
        // Unexpected database error (e.g. SQLSTATE 40P01): log the code only, never the payload.
        console.error(JSON.stringify({ event: 'pay_db_error', sqlstate: error.code, status }));
      }
      return json(status >= 400 && status < 500 ? 400 : 500, { code });
    }
    return json(200, data);
  } catch (e) {
    console.error(JSON.stringify({ event: 'pay_error', message: e instanceof Error ? e.message : 'unknown' }));
    return json(500, { code: 'INTERNAL_ERROR' });
  }
});
