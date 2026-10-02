import { ConfigError, readConfig } from './config';

describe('TC-P1-SETUP-04: environment config', () => {
  it('returns the config when both values are present', () => {
    expect(
      readConfig({ EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon' }),
    ).toEqual({ supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'anon' });
  });

  it('throws ConfigError naming the missing URL', () => {
    const run = () => readConfig({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-value' });
    expect(run).toThrow(ConfigError);
    expect(run).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('rejects a malformed URL', () => {
    expect(() => readConfig({ EXPO_PUBLIC_SUPABASE_URL: 'not a url', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'k' })).toThrow(
      ConfigError,
    );
  });

  it('never puts secret values into the error', () => {
    try {
      readConfig({ EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'super-secret-anon-key' });
      throw new Error('expected ConfigError');
    } catch (e) {
      expect((e as Error).message).not.toContain('super-secret-anon-key');
      expect((e as ConfigError).missing).toEqual(['EXPO_PUBLIC_SUPABASE_URL']);
    }
  });
});
