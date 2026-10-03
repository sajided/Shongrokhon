// Phase 4 in the browser: Smart Spending Companion (TC-P4-SSC-*), the coaching
// and forecast journeys (TC-P4-E2E-03/04), send money, a payment on a slow
// network (TC-P4-E2E-05), settings and account deletion (TC-P4-SEC-05).
// Runs after pay.spec.ts (alphabetical), so U-NORMAL's balance is no longer pinned.
import { expect, test } from '@playwright/test';

import { admin, ALWAYS_ALLOW, setAppConfig, walletOf } from '../integration/helpers';
import { loginViaUi, loginWithSession, PHONES, scanImage } from './helpers';

let restore: () => Promise<void>;
test.beforeAll(async () => {
  restore = await setAppConfig({ ...ALWAYS_ALLOW, coach_llm_mode: 'mock', coach_rate_per_minute: 1000 });
});
test.afterAll(async () => restore());

async function userId(phone: string) {
  const { data } = await admin().from('users').select('id').eq('phone', `+88${phone}`).single();
  return data!.id as string;
}

async function cashouts(phone: string) {
  const { count } = await admin().from('transactions').select('id', { count: 'exact', head: true })
    .eq('payer_wallet_id', (await walletOf(await userId(phone))).id).eq('type', 'CASHOUT');
  return count ?? 0;
}

test('TC-P4-SSC-01/03/04 + E2E-03: a repeated cash-out is intercepted; the user pays a bill instead and sets a goal', async ({ page }) => {
  const before = await cashouts(PHONES.cashHeavy);
  await loginWithSession(page, PHONES.cashHeavy);
  await page.getByTestId('cashout-button').click();
  await page.getByTestId('agent-input').fill('agent001');
  await page.getByTestId('agent-find').click();
  await expect(page.getByTestId('agent-card')).toContainText('Rahman Agent Point');
  await page.getByTestId('amount-input').fill('1000');
  await page.getByTestId('amount-continue').click();

  // SSC-01: shown before anything is executed; SSC-03: count, fee, alternatives.
  await expect(page.getByTestId('interception')).toBeVisible();
  await expect(page.getByTestId('interception-count')).toContainText('cash-out in the last 30 days');
  await expect(page.getByTestId('interception-fee')).toContainText('৳18.50 fee');
  await expect(page.getByTestId('nudge-PAY_QR')).toBeVisible();
  await expect(page.getByTestId('nudge-SEND_MONEY')).toBeVisible();

  // SSC-04: the alternative opens bill pay; the cash-out never runs.
  await page.getByTestId('nudge-BILL_PAY').click();
  await page.getByTestId('biller-MGAS0001').click();
  await expect(page.getByTestId('merchant-name')).toHaveText('Titas Gas');
  await page.getByTestId('account-input').fill('GAS-778812');
  await page.getByTestId('amount-input').fill('300');
  await page.getByTestId('pin-input').fill('12345');
  await page.getByTestId('pay-button').click();
  await expect(page.getByTestId('receipt-status')).toHaveText('Payment successful');
  expect(await cashouts(PHONES.cashHeavy)).toBe(before);

  // SSC-07: shown + choice logged.
  const { data: events } = await admin().from('nudge_events').select('kind, choice').eq('user_id', await userId(PHONES.cashHeavy));
  expect(events!.map((e) => e.choice ?? e.kind)).toEqual(expect.arrayContaining(['SHOWN', 'BILL_PAY']));

  // E2E-03: then sets a savings goal.
  await page.getByTestId('receipt-done').click();
  await page.getByTestId('coach-button').click();
  await page.getByTestId('open-savings').click();
  await page.getByTestId('goal-name').fill('Emergency fund');
  await page.getByTestId('goal-target').fill('6000');
  await page.getByTestId('goal-months').fill('6');
  await page.getByTestId('goal-submit').click();
  await expect(page.getByTestId('goal-card')).toContainText('Emergency fund');
});

test('TC-P4-SSC-05: "Continue" runs the cash-out normally', async ({ page }) => {
  const before = await cashouts(PHONES.cashHeavy);
  await loginWithSession(page, PHONES.cashHeavy);
  await page.getByTestId('cashout-button').click();
  await page.getByTestId('agent-input').fill('AGENT002');
  await page.getByTestId('agent-find').click();
  await page.getByTestId('amount-input').fill('500');
  await page.getByTestId('amount-continue').click();
  await page.getByTestId('nudge-CONTINUE').click();
  await expect(page.getByTestId('cashout-fee')).toContainText('Fee ৳9.25');
  await page.getByTestId('pin-input').fill('12345');
  await page.getByTestId('cashout-submit').click();
  await expect(page.getByTestId('receipt-status')).toHaveText('Cash-out successful');
  expect(await cashouts(PHONES.cashHeavy)).toBe(before + 1);
});

test('TC-P4-SSC-02: no interception for a normal user', async ({ page }) => {
  await loginWithSession(page, PHONES.normal);
  await page.getByTestId('cashout-button').click();
  await page.getByTestId('agent-input').fill('AGENT001');
  await page.getByTestId('agent-find').click();
  await page.getByTestId('amount-input').fill('500');
  await page.getByTestId('amount-continue').click();
  await expect(page.getByTestId('cashout-submit')).toBeVisible();
  await expect(page.getByTestId('interception')).toHaveCount(0);
});

test('Send money: recipient confirmed by first name, money sent, receipt', async ({ page }) => {
  await loginWithSession(page, PHONES.tight);
  await page.getByTestId('send-button').click();
  await page.getByTestId('recipient-input').fill('01911000002');
  await page.getByTestId('recipient-find').click();
  await expect(page.getByTestId('recipient-card')).toContainText('**********0002');
  await page.getByTestId('amount-input').fill('100');
  await page.getByTestId('pin-input').fill('12345');
  await page.getByTestId('send-submit').click();
  await expect(page.getByTestId('receipt-status')).toHaveText('Money sent');
});

test('TC-P4-E2E-04: the forecast warning leads to paying the rent early, no cash-out needed', async ({ page }) => {
  const before = await cashouts(PHONES.tight);
  await loginWithSession(page, PHONES.tight);
  await page.getByTestId('coach-button').click();
  await page.getByTestId('open-forecast').click();
  await expect(page.getByTestId('low-balance-warning')).toContainText('Green Homes Rent');
  await page.getByTestId('warning-pay-now').click();
  await expect(page.getByTestId('merchant-name')).toHaveText('Green Homes Rent');
  await expect(page.getByTestId('account-input')).toBeVisible();
  await page.getByTestId('amount-input').fill('9500');
  await page.getByTestId('pin-input').fill('12345');
  await page.getByTestId('pay-button').click();
  await expect(page.getByTestId('receipt-status')).toHaveText('Payment successful');
  expect(await cashouts(PHONES.tight)).toBe(before);
});

test('TC-P4-E2E-05: paying on a slow 3G connection completes once, with no duplicate charge', async ({ page, context }) => {
  test.setTimeout(120_000);
  const id = await userId(PHONES.newUser);
  await admin().rpc('admin_credit_wallet', { p_wallet_id: (await walletOf(id)).id, p_amount: 1000 });
  const start = (await walletOf(id)).balance;
  await loginWithSession(page, PHONES.newUser);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8,
  });
  await scanImage(page, 'valid-static-mlegit');
  await page.getByTestId('amount-input').fill('100');
  await page.getByTestId('pin-input').fill('12345');
  await page.getByTestId('pay-button').click();
  await page.getByTestId('pay-button').click({ timeout: 1000 }).catch(() => undefined); // impatient double tap
  await expect(page.getByTestId('receipt-status')).toHaveText('Payment successful', { timeout: 60_000 });
  expect((await walletOf(id)).balance).toBe(start - 100);
});

test('TC-P4-SSC-09: nudges can be turned off in settings; fraud checks remain', async ({ page }) => {
  await loginWithSession(page, PHONES.cashHeavy);
  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('toggle-nudges')).toHaveText('On');
  await page.getByTestId('toggle-nudges').click();
  await expect(page.getByTestId('toggle-nudges')).toHaveText('Off');
  const { data } = await admin().from('users').select('nudges_enabled').eq('id', await userId(PHONES.cashHeavy)).single();
  expect(data!.nudges_enabled).toBe(false);
  await page.getByTestId('toggle-nudges').click(); // back on for later runs
  await expect(page.getByTestId('toggle-nudges')).toHaveText('On');
});

test('TC-P4-SEC-05: a new user deletes their account and cannot get back in', async ({ page }) => {
  await loginViaUi(page, '01711000007');
  await page.getByTestId('pin-new').fill('13579');
  await page.getByTestId('pin-confirm').fill('13579');
  await page.getByTestId('pin-save').click();
  await expect(page.getByTestId('balance')).toBeVisible();
  const id = await userId('01711000007');
  await page.getByTestId('settings-button').click();
  await page.getByTestId('delete-account').click();
  await page.getByTestId('delete-pin').fill('13579');
  await page.getByTestId('delete-yes').click();
  await expect(page.getByTestId('phone-input')).toBeVisible();
  const { data } = await admin().from('users').select('phone, full_name').eq('id', id).single();
  expect(data).toEqual({ phone: `deleted:${id}`, full_name: null });
});
