import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { readConfig } from './config';

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client. The session is kept in localStorage so it survives
 * reloads (TC-P1-AUTH-08) and is removed on sign-out (TC-P1-AUTH-09).
 * Throws ConfigError when the environment is incomplete; the root layout handles it.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const { supabaseUrl, supabaseAnonKey } = readConfig();
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        storageKey: 'shongrokhon.auth',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
