import { expect, type Page } from '@playwright/test';
import { join } from 'node:path';

import { admin, otp, TEST_OTP, walletOf } from '../integration/helpers';

export const fixture = (name: string) => join(__dirname, '..', '..', 'fixtures', 'qr', `${name}.png`);

export const PHONES = {
  normal: '01711000001', // U-NORMAL ৳5,000
  low: '01711000002', // U-LOW ৳100
  fresh: '01711000003', // unregistered
} as const;

/** Signs in through the real sign-in screen (OTP 123456). */
export async function loginViaUi(page: Page, phone: string) {
  await page.goto('/');
  await page.getByTestId('phone-input').fill(phone);
  await page.getByTestId('send-otp').click();
  // GoTrue allows one SMS per number every few seconds; wait and retry once.
  const rateLimited = page.getByText('Too many requests');
  await expect(page.getByTestId('otp-input').or(rateLimited)).toBeVisible();
  if (await rateLimited.isVisible()) {
    await page.waitForTimeout(6000);
    await page.getByTestId('send-otp').click();
  }
  await page.getByTestId('otp-input').fill(TEST_OTP);
  await page.getByTestId('verify-otp').click();
}

/** Fast path for tests that are not about login: put a real session in storage. */
export async function loginWithSession(page: Page, phone: string) {
  let sent = await otp({ action: 'send', phone });
  if (sent.body.code === 'RATE_LIMITED') {
    await new Promise((r) => setTimeout(r, 6000));
    sent = await otp({ action: 'send', phone });
  }
  expect(sent.status).toBe(200);
  const verified = await otp({ action: 'verify', phone, token: TEST_OTP });
  expect(verified.status).toBe(200);
  await page.goto('/');
  await page.evaluate((session) => localStorage.setItem('shongrokhon.auth', session), JSON.stringify(verified.body.session));
  await page.reload();
  await expect(page.getByTestId('balance')).toBeVisible();
}

/** Opens the scanner and uploads a QR image (same decode path as the camera). */
export async function scanImage(page: Page, fixtureName: string) {
  await page.getByTestId('scan-button').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('gallery').click();
  await (await chooser).setFiles(fixture(fixtureName));
}

export async function balanceOf(phone: string): Promise<number> {
  const { data } = await admin().from('users').select('id').eq('phone', `+88${phone}`).single();
  return (await walletOf(data!.id)).balance;
}
