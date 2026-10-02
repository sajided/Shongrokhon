// Phone OTP gateway (TC-P1-AUTH-02..06).
//
// The app never calls GoTrue's OTP endpoints directly. This function adds what
// GoTrue does not provide: a per-number failed-attempt counter, a lockout after
// repeated wrong codes, and a distinct "expired" error.
//
// POST { action: "send", phone }          -> { ok: true, expires_in }
// POST { action: "verify", phone, token } -> { session } | { code, ... }
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// Accepts 01XXXXXXXXX, 8801XXXXXXXXX or +8801XXXXXXXXX; returns 8801XXXXXXXXX.
function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s-]/g, '').replace(/^\+/, '');
  const local = digits.startsWith('880') ? digits.slice(2) : digits;
  return /^01[3-9]\d{8}$/.test(local) ? `88${local}` : null;
}

async function rpc<T>(fn: string, phone: string): Promise<T> {
  const { data, error } = await admin.rpc(fn, { p_phone: phone });
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

async function send(phone: string) {
  const gate = await rpc<{ allowed: boolean; code?: string; locked_until?: string }>('otp_before_send', phone);
  if (!gate.allowed) return json(429, { code: gate.code, locked_until: gate.locked_until });

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await anon.auth.signInWithOtp({ phone: `+${phone}` });
  if (error) {
    return json(error.status === 429 ? 429 : 502, { code: error.status === 429 ? 'RATE_LIMITED' : 'OTP_SEND_FAILED' });
  }
  const { data: cfg } = await admin.from('app_config').select('otp_expiry_seconds').single();
  return json(200, { ok: true, expires_in: cfg?.otp_expiry_seconds ?? null });
}

async function verify(phone: string, token: unknown) {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) return json(400, { code: 'INVALID_OTP_FORMAT' });

  const gate = await rpc<{ state: string; locked_until?: string }>('otp_before_verify', phone);
  if (gate.state === 'NO_OTP') return json(400, { code: 'OTP_NOT_REQUESTED' });
  if (gate.state === 'LOCKED') return json(429, { code: 'OTP_LOCKED', locked_until: gate.locked_until });
  if (gate.state === 'EXPIRED') return json(400, { code: 'OTP_EXPIRED' });

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.verifyOtp({ phone: `+${phone}`, token, type: 'sms' });
  if (error || !data.session) {
    const fail = await rpc<{ attempts_left: number; locked_until: string | null }>('otp_record_failure', phone);
    if (fail.locked_until) return json(429, { code: 'OTP_LOCKED', locked_until: fail.locked_until });
    return json(400, { code: 'WRONG_OTP', attempts_left: fail.attempts_left });
  }
  await rpc('otp_record_success', phone);
  return json(200, { session: data.session });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED' });

  let body: { action?: string; phone?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { code: 'INVALID_REQUEST' });
  }
  const phone = normalizePhone(body.phone);
  if (!phone) return json(400, { code: 'INVALID_PHONE' });

  try {
    if (body.action === 'send') return await send(phone);
    if (body.action === 'verify') return await verify(phone, body.token);
    return json(400, { code: 'INVALID_REQUEST' });
  } catch (e) {
    // Never echo phone numbers or tokens into logs.
    console.error('otp function error', e instanceof Error ? e.message : 'unknown');
    return json(500, { code: 'INTERNAL_ERROR' });
  }
});
