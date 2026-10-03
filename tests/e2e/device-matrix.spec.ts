// TC-P4-E2E-01 on the device matrix (TC-P4-E2E-06): register -> set PIN ->
// receive funds -> scan QR -> pay -> the Coach shows the payment. Runs in the
// chromium-mobile (Pixel 7), android-low-end (Moto G4, CPU 4x slower) and
// iphone (WebKit) projects, each with its own unregistered number.
// Also records TC-P4-PERF-04 (cold start) on the low-end profile.
import { expect, test } from '@playwright/test';

import { admin, ALWAYS_ALLOW, setRiskConfig, walletOf } from '../integration/helpers';
import { loginViaUi, scanImage } from './helpers';

const NUMBER: Record<string, string> = {
  'chromium-mobile': '01711000004',
  'android-low-end': '01711000005',
  iphone: '01711000006',
};

test('TC-P4-E2E-01/06: new user journey from registration to the Coach', async ({ page, context }, info) => {
  test.setTimeout(180_000);
  const phone = NUMBER[info.project.name];
  test.skip(!phone, 'device-matrix projects only');

  if (info.project.name === 'android-low-end') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }

  // TC-P4-PERF-04: cold start to an interactive first screen.
  const t0 = Date.now();
  await page.goto('/');
  await expect(page.getByTestId('phone-input')).toBeVisible();
  const coldStart = Date.now() - t0;
  info.annotations.push({ type: 'cold-start', description: `${coldStart} ms on ${info.project.name}` });
  console.log(`PERF-04 ${info.project.name}: first screen interactive in ${coldStart} ms`);
  if (info.project.name === 'android-low-end') expect(coldStart).toBeLessThan(3000);

  const restore = await setRiskConfig(ALWAYS_ALLOW); // about the journey, not risk decisions
  try {
    await loginViaUi(page, phone);
    await page.getByTestId('pin-new').fill('24680');
    await page.getByTestId('pin-confirm').fill('24680');
    await page.getByTestId('pin-save').click();
    await expect(page.getByTestId('balance')).toHaveText('৳0.00');

    // Receive funds (cash-in at an agent is outside the app: credited by the service).
    const { data: user } = await admin().from('users').select('id').eq('phone', `+88${phone}`).single();
    await admin().rpc('admin_credit_wallet', { p_wallet_id: (await walletOf(user!.id)).id, p_amount: 1000 });
    await page.reload();
    await expect(page.getByTestId('balance')).toHaveText('৳1,000.00');

    await scanImage(page, 'valid-static-mlegit');
    await expect(page.getByTestId('merchant-name')).toHaveText('Rahim Store');
    await page.getByTestId('amount-input').fill('150');
    await page.getByTestId('pin-input').fill('24680');
    await page.getByTestId('pay-button').click();
    await expect(page.getByTestId('receipt-status')).toHaveText('Payment successful');
    await page.getByTestId('receipt-done').click();
    await expect(page.getByTestId('balance')).toHaveText('৳850.00');

    await page.getByTestId('coach-button').click();
    await page.getByTestId('period-WEEK').click();
    await expect(page.getByTestId('coach-spending')).toHaveText('৳150.00');
  } finally {
    await restore();
  }
});
