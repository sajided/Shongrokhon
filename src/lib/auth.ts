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

// What an email sign-in link brought back in the URL fragment: the session
// (#access_token=…&refresh_token=…) or why it failed (#error_code=otp_expired).
// Read once at load, before the router can rewrite the URL, and removed from the
// address bar so the tokens are not left in history.
type LinkResult = { access_token: string; refresh_token: string } | { error: string } | null;

export function parseLinkFragment(hash: string): LinkResult {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (access_token && refresh_token) return { access_token, refresh_token };
  if (params.get('error') || params.get('error_code')) {
    return { error: params.get('error_code') === 'otp_expired' ? 'LINK_EXPIRED' : 'LINK_INVALID' };
  }
  return null;
}

let linkResult: LinkResult = null;
if (typeof window !== 'undefined' && window.location?.hash) {
  linkResult = parseLinkFragment(window.location.hash);
  if (linkResult) window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

/** Stores the session from an email sign-in link, if the page was opened from one. */
export async function completeLinkSignIn(): Promise<void> {
  if (!linkResult || !('access_token' in linkResult)) return;
  const { access_token, refresh_token } = linkResult;
  linkResult = null;
  const { error } = await getSupabase().auth.setSession({ access_token, refresh_token });
  if (error) linkResult = { error: 'LINK_INVALID' };
}

/** The error code from a failed email link, until a new link is requested. */
export function linkError(): string | null {
  return linkResult && 'error' in linkResult ? linkResult.error : null;
}

/**
 * Sends an SMS code, or for an email a Supabase sign-in link that returns to this
 * page. Registration and login are the same flow (TC-P1-AUTH-06).
 */
export async function sendOtp(to: string): Promise<void> {
  const body: Record<string, string> = { action: 'send', ...target(to) };
  if (to.includes('@') && typeof window !== 'undefined') body.redirect_to = window.location.origin;
  await invokeOtp(body);
  linkResult = null;
}

/** Verifies the SMS code through the `otp` Edge Function and stores the session securely. */
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
