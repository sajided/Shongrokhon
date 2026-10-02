// Phase 2 in the browser: TC-P2-FLOW-02 (flagged payment), FLOW-03 (step-up)
// and FLOW-09 (Pay tap -> result latency on a throttled 4G-like network).
// Needs the ML container (npm run ml:up). Uses only Phase 2 personas, so it is
// independent of pay.spec.ts order.
import { expect, test } from '@playwright/test';

import { buildBanglaQr } from '../../src/lib/qr/emv';
import { admin, ALWAYS_ALLOW, setRiskConfig, walletOf } from '../integration/helpers';
import { balanceOf, loginWithSession, PHONES, scanImage } from './helpers';

test('TC-P2-FLOW-02: U-ABUSER pays M-PSEUDO ৳10,000 -> paid, receipt and home show the review notice', async ({ page }) => {
  await loginWithSession(page, PHONES.abuser);
  await expect(page.getByTestId('balance')).toHaveText('৳20,000.00');
  await scanImage(page, 'valid-static-mpseudo');
  await expect(page.getByTestId('merchant-name')).toHaveText('Quick Mart');
  await page.getByTestId('amount-input').fill('10000');
  await page.getByTestId('pin-input').fill('12345');
  await page.getByTestId('pay-button').click();

  await expect(page.getByText('Payment successful')).toBeVisible();
  await expect(page.getByTestId('receipt-flag-notice')).toContainText('flagged for a routine review');
  expect(await balanceOf(PHONES.abuser)).toBe(10000);

  await page.getByTestId('receipt-done').click();
  await expect(page.getByTestId('notice')).toContainText('Payment under review');
  await expect(page.getByTestId('notice-body')).toContainText('৳10,000.00 to Quick Mart');
  await page.getByTestId('notice-dismiss').click();
  await expect(page.getByTestId('notice')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('balance')).toBeVisible();
  await expect(page.getByTestId('notice')).toHaveCount(0); // stays read
});

test('TC-P2-FLOW-03: a medium-risk payment asks for PIN confirmation, then pays once', async ({ page }) => {
  // RING-01-8 (no network-job run in E2E): scored REVIEW at legit shops. Uses its
  // own persona so this spec never changes the Phase 1 personas' balances.
  const before = await balanceOf(PHONES.ringMember);
  await loginWithSession(page, PHONES.ringMember);
  await scanImage(page, 'valid-static-mlegit');
  await page.getByTestId('amount-input').fill('4200');
  await page.getByTestId('pin-input').fill('12345');
  await page.getByTestId('pay-button').click();

  await expect(page.getByTestId('step-up')).toContainText('Confirm this payment');
  await expect(page.getByTestId('step-up-amount')).toHaveText('৳4,200.00');
  expect(await balanceOf(PHONES.ringMember)).toBe(before); // nothing debited yet

  await page.getByTestId('step-up-pin').fill('12345');
  await page.getByTestId('step-up-confirm').click();
  await expect(page.getByText('Payment successful')).toBeVisible();
  await expect(page.getByTestId('receipt-flag-notice')).toHaveCount(0);
  expect(await balanceOf(PHONES.ringMember)).toBe(before - 4200);
});

test('TC-P2-FLOW-09: Pay tap -> receipt p95 < 1.5 s over 100 runs on throttled 4G', async ({ page, context }) => {
  test.setTimeout(15 * 60_000);
  // Every run takes the full path (ML score + ledger update); bursts by one user
  // would otherwise be stepped up, which skips the ledger update being timed.
  const restore = await setRiskConfig(ALWAYS_ALLOW);
  try {
    const { data } = await admin().from('users').select('id').eq('phone', `+88${PHONES.newUser}`).single();
    await admin().rpc('admin_credit_wallet', { p_wallet_id: (await walletOf(data!.id)).id, p_amount: 5000 });
    await loginWithSession(page, PHONES.newUser);

    // Chrome DevTools-style 4G profile: 150 ms RTT, 9 Mbps down, 1.5 Mbps up.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (9 * 1024 * 1024) / 8,
      uploadThroughput: (1.5 * 1024 * 1024) / 8,
    });

    const payload = encodeURIComponent(buildBanglaQr({ merchantId: 'MLEGIT0002', merchantName: 'Karim Pharmacy' }));
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      await page.goto(`/pay?payload=${payload}`);
      await page.getByTestId('amount-input').fill('10');
      await page.getByTestId('pin-input').fill('12345');
      const started = Date.now();
      await page.getByTestId('pay-button').click();
      await expect(page.getByTestId('receipt-amount')).toHaveText('৳10.00');
      times.push(Date.now() - started);
    }
    times.sort((a, b) => a - b);
    const p50 = times[49];
    const p95 = times[94];
    console.log(`FLOW-09 browser (4G throttled): p50=${p50}ms p95=${p95}ms max=${times[99]}ms`);
    test.info().annotations.push({ type: 'latency', description: `p50=${p50}ms p95=${p95}ms` });
    expect(p95).toBeLessThan(1500);
  } finally {
    await restore();
  }
});
