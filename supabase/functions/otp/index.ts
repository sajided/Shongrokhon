// Phone / email OTP gateway (TC-P1-AUTH-02..06).
//
// The app never calls GoTrue's OTP endpoints directly. This function adds what
// GoTrue does not provide: a per-number (or per-email) failed-attempt counter, a
// lockout after repeated wrong codes, and a distinct "expired" error.
//
// POST { action: "send", phone | email }          -> { ok: true, expires_in }
// POST { action: "verify", phone | email, token } -> { session } | { code, ... }
//
// Email codes are only accepted while app_config.email_sign_in is on, and never
// for staff accounts (they sign in to the admin app with a password).
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

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

// Who the code goes to. `key` identifies the attempt counter in otp_attempts.
type Target = { key: string; send: { phone: string } | { email: string } };

// The attempt counter is keyed by the identifier: 8801XXXXXXXXX or the email.
async function rpc<T>(fn: string, key: string): Promise<T> {
  const { data, error } = await admin.rpc(fn, { p_phone: key });
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

async function send(target: Target) {
  const gate = await rpc<{ allowed: boolean; code?: string; locked_until?: string }>('otp_before_send', target.key);
  if (!gate.allowed) return json(429, { code: gate.code, locked_until: gate.locked_until });

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await anon.auth.signInWithOtp(target.send);
  if (error) {
    return json(error.status === 429 ? 429 : 502, { code: error.status === 429 ? 'RATE_LIMITED' : 'OTP_SEND_FAILED' });
  }
  const { data: cfg } = await admin.from('app_config').select('otp_expiry_seconds').single();
  return json(200, { ok: true, expires_in: cfg?.otp_expiry_seconds ?? null });
}

async function verify(target: Target, token: unknown) {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) return json(400, { code: 'INVALID_OTP_FORMAT' });

  const gate = await rpc<{ state: string; locked_until?: string }>('otp_before_verify', target.key);
  if (gate.state === 'NO_OTP') return json(400, { code: 'OTP_NOT_REQUESTED' });
  if (gate.state === 'LOCKED') return json(429, { code: 'OTP_LOCKED', locked_until: gate.locked_until });
  if (gate.state === 'EXPIRED') return json(400, { code: 'OTP_EXPIRED' });

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = 'email' in target.send
    ? await anon.auth.verifyOtp({ email: target.send.email, token, type: 'email' })
    : await anon.auth.verifyOtp({ phone: target.send.phone, token, type: 'sms' });
  if (error || !data.session) {
    const fail = await rpc<{ attempts_left: number; locked_until: string | null }>('otp_record_failure', target.key);
    if (fail.locked_until) return json(429, { code: 'OTP_LOCKED', locked_until: fail.locked_until });
    return json(400, { code: 'WRONG_OTP', attempts_left: fail.attempts_left });
  }
  await rpc('otp_record_success', target.key);
  return json(200, { session: data.session });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED' });

  let body: { action?: string; phone?: unknown; email?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { code: 'INVALID_REQUEST' });
  }
  try {
    let target: Target;
    if (body.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (!email) return json(400, { code: 'INVALID_EMAIL' });
      const { data: cfg } = await admin.from('app_config').select('email_sign_in').single();
      if (!cfg?.email_sign_in) return json(403, { code: 'EMAIL_SIGN_IN_DISABLED' });
      const { data: staff } = await admin.from('staff').select('user_id').eq('email', email).maybeSingle();
      if (staff) return json(403, { code: 'STAFF_ACCOUNT' });
      target = { key: email, send: { email } };
    } else {
      const phone = normalizePhone(body.phone);
      if (!phone) return json(400, { code: 'INVALID_PHONE' });
      target = { key: phone, send: { phone: `+${phone}` } };
    }
    if (body.action === 'send') return await send(target);
    if (body.action === 'verify') return await verify(target, body.token);
    return json(400, { code: 'INVALID_REQUEST' });
  } catch (e) {
    // Never echo phone numbers, emails or tokens into logs.
    console.error('otp function error', e instanceof Error ? e.message : 'unknown');
    return json(500, { code: 'INTERNAL_ERROR' });
  }
});
