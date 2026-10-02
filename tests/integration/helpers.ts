// Shared helpers for integration tests against the local Supabase stack.
// Run `supabase db reset` first (npm run test:integration does) so seeded
// personas and test phone numbers start from a known state.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';

interface StackEnv {
  url: string;
  anonKey: string;
  serviceKey: string;
}

let cached: StackEnv | null = null;

export function stackEnv(): StackEnv {
  if (cached) return cached;
  const out = execSync('supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const vars = Object.fromEntries(
    out
      .split('\n')
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1], m[2]]),
  );
  cached = { url: vars.API_URL, anonKey: vars.ANON_KEY, serviceKey: vars.SERVICE_ROLE_KEY };
  return cached;
}

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };

export const admin = () => createClient(stackEnv().url, stackEnv().serviceKey, noPersist);
export const anon = () => createClient(stackEnv().url, stackEnv().anonKey, noPersist);

export const TEST_OTP = '123456';

export async function otp(body: Record<string, string>): Promise<{ status: number; body: Record<string, any> }> {
  const res = await fetch(`${stackEnv().url}/functions/v1/otp`, {
    method: 'POST',
    headers: { apikey: stackEnv().anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** Signs in through the `otp` Edge Function exactly like the app does. */
export async function signIn(phone: string): Promise<{ client: SupabaseClient; userId: string; accessToken: string }> {
  let sent = await otp({ action: 'send', phone });
  if (sent.body.code === 'RATE_LIMITED') {
    // GoTrue allows one SMS per number every few seconds.
    await new Promise((r) => setTimeout(r, 6000));
    sent = await otp({ action: 'send', phone });
  }
  if (sent.status !== 200) throw new Error(`send failed: ${JSON.stringify(sent.body)}`);
  const verified = await otp({ action: 'verify', phone, token: TEST_OTP });
  if (verified.status !== 200) throw new Error(`verify failed: ${JSON.stringify(verified.body)}`);
  const { access_token, refresh_token, user } = verified.body.session;
  const client = anon();
  await client.auth.setSession({ access_token, refresh_token });
  return { client, userId: user.id, accessToken: access_token };
}

/** A client that sends a fixed access token (no refresh), as an old device would. */
export function withToken(accessToken: string): SupabaseClient {
  return createClient(stackEnv().url, stackEnv().anonKey, {
    ...noPersist,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function rpc<T = any>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}) {
  const { data, error, status } = await client.rpc(fn, args);
  return { data: data as T, error, status };
}

export async function walletOf(userId: string) {
  const { data, error } = await admin().from('wallets').select('id, balance').eq('user_id', userId).eq('kind', 'customer').single();
  if (error) throw error;
  return { id: data.id as string, balance: Number(data.balance) };
}
