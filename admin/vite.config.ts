import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Reads the repo's .env (EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY): one config for
// both apps. Only the public anon key is used; scripts/check-bundle-secrets.sh
// also scans this bundle.
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  envPrefix: ['VITE_', 'EXPO_PUBLIC_'],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
});
