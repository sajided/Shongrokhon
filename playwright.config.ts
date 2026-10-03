// Web E2E (testcase.md §1–4). Builds the production web bundles, serves them,
// and runs against the local Supabase stack (+ ML container). Tests share
// database state, so they run serially.
//
// Projects:
//   chromium-mobile   every customer-app spec on a Pixel 7 (the default)
//   admin             the analysts' Investigation Assistant (admin/), desktop
//   android-low-end   TC-P4-E2E-06: the new-user journey on a small, CPU-throttled Android
//   iphone            TC-P4-E2E-06: the same journey on WebKit (iPhone 15)
import { defineConfig, devices } from '@playwright/test';

const PORT = 8765;
const ADMIN_PORT = 8766;
const DEVICE_MATRIX = /device-matrix\.spec\.ts/;
const ADMIN = /admin\.spec\.ts/;

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
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-mobile',
      testIgnore: [ADMIN],
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
    {
      name: 'admin',
      testMatch: ADMIN,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${ADMIN_PORT}` },
    },
    {
      name: 'android-low-end',
      testMatch: DEVICE_MATRIX,
      // A small, slow phone: Moto G4 viewport; CPU throttled 4x inside the spec (CDP).
      use: { ...devices['Moto G4'], browserName: 'chromium' },
    },
    {
      name: 'iphone',
      testMatch: DEVICE_MATRIX,
      use: { ...devices['iPhone 15'], browserName: 'webkit' },
    },
  ],
  webServer: [
    {
      command: `node scripts/copy-zxing.mjs && npx expo export --platform web --clear && npx serve -s dist -l ${PORT} --no-clipboard`,
      url: `http://localhost:${PORT}`,
      // Never reuse: a different app on the same port would be tested by mistake.
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      command: 'npm --prefix admin run build && npm --prefix admin run preview',
      url: `http://localhost:${ADMIN_PORT}`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
