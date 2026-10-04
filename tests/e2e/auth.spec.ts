// TC-P1-AUTH-01/02/07/08/09 in the browser.
import { expect, test } from '@playwright/test';

import { loginViaUi, PHONES } from './helpers';

test('TC-P1-AUTH-02: invalid phone shows an inline error and sends no OTP', async ({ page }) => {
  const otpCalls: string[] = [];
  page.on('request', (r) => r.url().includes('/functions/v1/otp') && otpCalls.push(r.url()));
  await page.goto('/');
  for (const bad of ['0123', '+15551234567', 'abcdefghijk']) {
    await page.getByTestId('phone-input').fill(bad);
    await page.getByTestId('send-otp').click();
    await expect(page.getByText('Enter a valid Bangladeshi mobile number')).toBeVisible();
  }
  expect(otpCalls).toEqual([]);
});

test('TC-P1-AUTH-01 + AUTH-07: register, set PIN (mismatch rejected), land on home with ৳0', async ({ page }) => {
  await loginViaUi(page, PHONES.fresh);
  await expect(page.getByText('Create your transaction PIN')).toBeVisible();

  await page.getByTestId('pin-new').fill('12345');
  await page.getByTestId('pin-confirm').fill('12346');
  await page.getByTestId('pin-save').click();
  await expect(page.getByText('The PINs do not match.')).toBeVisible();

  await page.getByTestId('pin-confirm').fill('12345');
  await page.getByTestId('pin-save').click();
  await expect(page.getByTestId('balance')).toHaveText('৳0.00');
  await expect(page.getByText('No transactions yet.')).toBeVisible();
});

test('TC-P1-AUTH-08: session survives a reload', async ({ page }) => {
  await loginViaUi(page, PHONES.normal);
  await expect(page.getByTestId('balance')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('balance')).toBeVisible();
  await expect(page.getByTestId('phone-input')).toHaveCount(0);
});

test('TC-P1-AUTH-09: logout clears the session and protected pages are unreachable', async ({ page }) => {
  await loginViaUi(page, PHONES.normal);
  await expect(page.getByTestId('balance')).toBeVisible();
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('phone-input')).toBeVisible();

  expect(await page.evaluate(() => localStorage.getItem('shongrokhon.auth'))).toBeNull();
  for (const path of ['/', '/scan', '/pay']) {
    await page.goto(path);
    await expect(page.getByTestId('phone-input')).toBeVisible();
    await expect(page.getByTestId('balance')).toHaveCount(0);
  }
});

test('Sign-in page explains the app and opens the product tour', async ({ page }) => {
  const calls: string[] = [];
  await page.goto('/');
  await expect(page.getByTestId('cashout-preview')).toBeVisible();
  page.on('request', (r) => r.url().includes('/functions/v1/') && calls.push(r.url()));
  await page.getByTestId('demo-button').click();
  await expect(page.getByTestId('demo-screen-home')).toBeVisible();
  for (const name of ['pay', 'check', 'cashout', 'coach', 'plan']) {
    await page.getByTestId('demo-next').click();
    await expect(page.getByTestId(`demo-screen-${name}`)).toBeVisible();
  }
  await page.getByTestId('demo-next').click();
  await expect(page.getByTestId('phone-input')).toBeVisible();
  expect(calls).toEqual([]);
});
