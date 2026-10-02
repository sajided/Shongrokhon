// TC-P1-PAY-01/03/10/12/13 and QR-03/04/05/06/07/10 in the browser.
// Runs after auth.spec.ts on the same reset database (U-NORMAL starts at ৳5,000).
import { expect, test } from '@playwright/test';

import { admin } from '../integration/helpers';
import { balanceOf, loginWithSession, PHONES, scanImage } from './helpers';

test.use({ permissions: ['camera'], launchOptions: { args: ['--use-fake-device-for-media-stream'] } });

test('TC-P1-PAY-01: U-NORMAL pays M-LEGIT ৳500 from an uploaded static QR (QR-03, QR-10, PAY-12, PAY-13)', async ({ page }) => {
  await loginWithSession(page, PHONES.normal);
  await expect(page.getByTestId('balance')).toHaveText('৳5,000.00');

  await scanImage(page, 'valid-static-mlegit');
  await expect(page.getByTestId('merchant-name')).toHaveText('Rahim Store');
  await expect(page.getByTestId('merchant-id')).toHaveText('Merchant ID MLEGIT0001');
  await expect(page.getByTestId('amount-input')).toHaveValue('');
  await expect(page.getByTestId('amount-input')).toBeEditable();

  await page.getByTestId('amount-input').fill('500');
  await page.getByTestId('pin-input').fill('12345');
  await page.getByTestId('pay-button').click();

  await expect(page.getByText('Payment successful')).toBeVisible();
  await expect(page.getByTestId('receipt-amount')).toHaveText('৳500.00');
  await expect(page.getByText('Rahim Store')).toBeVisible();
  await expect(page.getByText('MLEGIT0001')).toBeVisible();

  await page.getByTestId('share-receipt').click();
  await expect(page.getByTestId('share-note').or(page.getByTestId('receipt'))).toBeVisible();

  await page.getByTestId('receipt-done').click();
  await expect(page.getByTestId('balance')).toHaveText('৳4,500.00');
  const rows = page.getByTestId('txn-row');
  await expect(rows.first()).toContainText('Rahim Store');
  await expect(rows.first()).toContainText('−৳500.00');
  await expect(rows.first()).toContainText('SUCCESS');
  expect(await balanceOf(PHONES.normal)).toBe(4500);
});

test('TC-P1-QR-04: dynamic QR pre-fills a read-only amount', async ({ page }) => {
  await loginWithSession(page, PHONES.normal);
  await scanImage(page, 'valid-dynamic-mlegit-250');
  await expect(page.getByTestId('amount-input')).toHaveValue('250.00');
  await expect(page.getByTestId('amount-input')).not.toBeEditable();
  await page.getByTestId('pin-input').fill('12345');
  await page.getByTestId('pay-button').click();
  await expect(page.getByTestId('receipt-amount')).toHaveText('৳250.00');
  expect(await balanceOf(PHONES.normal)).toBe(4250);
});

for (const [fixtureName, message] of [
  ['invalid-tampered-crc', 'Invalid QR code.'],
  ['invalid-url', 'This is not a Bangla QR payment code.'],
  ['invalid-non-bdt', 'This is not a Bangla QR payment code.'],
  ['invalid-expired-dynamic', 'This payment QR has expired.'],
] as const) {
  test(`TC-P1-QR-05/06/07: ${fixtureName} is rejected before any payment screen`, async ({ page }) => {
    await loginWithSession(page, PHONES.low);
    await scanImage(page, fixtureName);
    await expect(page.getByTestId('qr-error')).toContainText(message);
    await expect(page.getByTestId('pay-button')).toHaveCount(0);
  });
}

test('unregistered merchant QR is refused by the server', async ({ page }) => {
  await loginWithSession(page, PHONES.low);
  await scanImage(page, 'valid-static-unregistered');
  await expect(page.getByText('This merchant is not registered.')).toBeVisible();
  await expect(page.getByTestId('pay-button')).toHaveCount(0);
});

test('TC-P1-PAY-03: insufficient balance is rejected and the balance is unchanged', async ({ page }) => {
  await loginWithSession(page, PHONES.low);
  await expect(page.getByTestId('balance')).toHaveText('৳100.00');
  await scanImage(page, 'valid-static-mlegit');
  await page.getByTestId('amount-input').fill('500');
  await page.getByTestId('pin-input').fill('12345');
  await page.getByTestId('pay-button').click();
  await expect(page.getByText('Insufficient balance for this payment.')).toBeVisible();
  expect(await balanceOf(PHONES.low)).toBe(100);
});

test('TC-P1-PAY-04: wrong PIN shows attempts left and does not debit', async ({ page }) => {
  await loginWithSession(page, PHONES.low);
  await scanImage(page, 'valid-static-mlegit');
  await page.getByTestId('amount-input').fill('10');
  await page.getByTestId('pin-input').fill('00000');
  await page.getByTestId('pay-button').click();
  await expect(page.getByText('Wrong PIN. 2 attempts left.')).toBeVisible();
  expect(await balanceOf(PHONES.low)).toBe(100);
});

test('TC-P1-PAY-10: network drops mid-payment -> "checking", then the final result, no duplicate charge', async ({ page, context }) => {
  await loginWithSession(page, PHONES.normal);
  const before = await balanceOf(PHONES.normal);
  await scanImage(page, 'valid-static-mlegit');
  await page.getByTestId('amount-input').fill('100');
  await page.getByTestId('pin-input').fill('12345');

  await context.setOffline(true);
  await page.getByTestId('pay-button').click();
  await expect(page.getByTestId('payment-checking')).toBeVisible({ timeout: 20_000 });
  await context.setOffline(false);

  await expect(page.getByText('Payment successful')).toBeVisible({ timeout: 30_000 });
  expect(await balanceOf(PHONES.normal)).toBe(before - 100);
  const { count } = await admin().from('transactions').select('*', { count: 'exact', head: true }).eq('amount', 100).eq('type', 'PAYMENT');
  expect(count).toBe(1);
});
