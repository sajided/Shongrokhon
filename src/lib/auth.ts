import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { ApiError, NetworkError } from './api';
import { getSupabase } from './supabase';

async function invokeOtp(body: Record<string, string>): Promise<Record<string, unknown>> {
  const { data, error } = await getSupabase().functions.invoke('otp', { body });
  if (!error) return data as Record<string, unknown>;
  if (error instanceof FunctionsHttpError) {
    const payload = (await error.context.json().catch(() => ({}))) as Record<string, unknown>;
    const { code, ...details } = payload;
    throw new ApiError(typeof code === 'string' ? code : 'INTERNAL_ERROR', details);
  }
  if (error instanceof FunctionsFetchError) throw new NetworkError();
  throw new ApiError('INTERNAL_ERROR');
}

// `to` is an E.164 phone number or an email (readAuthMethod).
const target = (to: string): Record<string, string> => (to.includes('@') ? { email: to } : { phone: to });

/** Sends an SMS or email code. Registration and login are the same flow (TC-P1-AUTH-06). */
export async function sendOtp(to: string): Promise<void> {
  await invokeOtp({ action: 'send', ...target(to) });
}

/** Verifies the code through the `otp` Edge Function and stores the session securely. */
export async function verifyOtp(to: string, token: string): Promise<void> {
  const data = await invokeOtp({ action: 'verify', ...target(to), token });
  const session = data.session as { access_token: string; refresh_token: string } | undefined;
  if (!session) throw new ApiError('INTERNAL_ERROR');
  const { error } = await getSupabase().auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw new ApiError('INTERNAL_ERROR');
}

/** TC-P1-AUTH-09: revokes the session server-side and clears secure storage. */
export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.auth.signOut();
  // Offline: still drop the local session so protected screens become unreachable.
  if (error) await supabase.auth.signOut({ scope: 'local' });
}
