// Runtime configuration (TC-P1-SETUP-04). Only public values belong here:
// anything under EXPO_PUBLIC_ is inlined into the app bundle.

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export class ConfigError extends Error {
  constructor(public readonly missing: string[]) {
    // Name the variables, never their values.
    super(`Missing or invalid configuration: ${missing.join(', ')}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

// Expo only inlines `process.env.EXPO_PUBLIC_*` when accessed statically, so the
// default must list each variable explicitly.
const defaultEnv = (): Env => ({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function readConfig(env: Env = defaultEnv()): AppConfig {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
  const missing: string[] = [];
  if (!url || !isHttpUrl(url)) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!key) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (missing.length) throw new ConfigError(missing);
  return { supabaseUrl: url, supabaseAnonKey: key };
}
