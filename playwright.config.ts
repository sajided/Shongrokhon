// Web E2E for Phase 1 (testcase.md §1.2, §1.4, §1.5).
// Builds the production web bundle, serves it, and runs against the local
// Supabase stack. Tests share database state, so they run serially.
import { defineConfig, devices } from '@playwright/test';

const PORT = 8765;

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium-mobile', use: { browserName: 'chromium' } }],
  webServer: {
    command: `npx expo export --platform web --clear && npx serve -s dist -l ${PORT} --no-clipboard`,
    url: `http://localhost:${PORT}`,
    // Never reuse: a different app on the same port would be tested by mistake.
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
