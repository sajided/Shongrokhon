// The analysts' Investigation Assistant (admin/), desktop: TC-P4-INV-01/02/03/05/06/07
// and TC-P4-E2E-02 (abuse journey ends in the queue with SHAP + summary).
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { admin, ANALYST, pay, setAppConfig, signIn, walletOf } from '../integration/helpers';

let restore: () => Promise<void>;
test.beforeAll(async () => {
  restore = await setAppConfig({ coach_llm_mode: 'mock' });
});
test.afterAll(async () => restore());

async function signInAs(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('sign-in').click();
}

test('TC-P4-INV-01: a non-analyst account is refused', async ({ page }) => {
  // A customer who also has an email login (created by an operator) is still not staff.
  const email = `customer-${Date.now()}@example.com`;
  const password = 'customer-pass-123';
  const { error } = await admin().auth.admin.createUser({
    email, password, email_confirm: true, phone: `88017${Date.now().toString().slice(-8)}`, phone_confirm: true,
  });
  expect(error).toBeNull();
  await signInAs(page, email, password);
  await expect(page.getByTestId('access-denied')).toHaveText('Access denied');
  await expect(page.getByTestId('alert-row')).toHaveCount(0);
});

test('TC-P4-E2E-02 + INV-02/03/05/07: a disguised cash-out reaches the analyst with SHAP and a summary', async ({ page }) => {
  // The abuse journey (payment side is covered in the app by risk.spec.ts).
  const abuser = await signIn('01911000001');
  const res = await pay(abuser.accessToken, { merchantId: 'MPSEUDO01', amount: 10000, pin: '12345', idempotencyKey: randomUUID() });
  expect(res.data.risk_decision).toBe('FLAG');
  await admin().rpc('admin_credit_wallet', { p_wallet_id: (await walletOf(abuser.userId)).id, p_amount: 10000 });

  await signInAs(page, ANALYST.email, ANALYST.password);
  await page.getByTestId('filter-wallet').fill('MPSEUDO01');
  await page.getByTestId('filter-status').selectOption('OPEN');
  await page.getByTestId('filter-apply').click();
  const row = page.getByTestId('alert-row').first();
  await expect(row).toContainText('Quick Mart');
  await expect(row).toContainText('৳10,000.00');
  await expect(row).toContainText('OPEN');
  await row.click();

  await expect(page.getByTestId('detail-amount')).toHaveText('৳10,000.00');
  await expect(page.getByTestId('summary-headline')).toContainText('৳10,000'); // INV-05: grounded figures
  await expect(page.getByTestId('shap-row').first()).toBeVisible(); // INV-03
  expect(await page.getByTestId('shap-row').count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('shap-impact').first()).toContainText(/[▲▼]/);

  await page.getByTestId('action-note').fill('Merchant cashes out every receipt within minutes');
  await page.getByTestId('action-CONFIRMED').click(); // INV-07
  await expect(page.getByTestId('detail-status')).toHaveText('CONFIRMED');
  await expect(page.getByTestId('audit-log')).toContainText('analyst@shongrokhon.test');
  await expect(page.getByTestId('audit-log')).toContainText('Merchant cashes out every receipt within minutes');
});

test('TC-P4-INV-06: a ring alert shows its wallets and flows as a graph', async ({ page }) => {
  const ids = async (phones: string[]) => Promise.all(phones.map(async (p) => {
    const { data } = await admin().from('users').select('id').eq('phone', `+88${p}`).single();
    return (await walletOf(data!.id)).id;
  }));
  const payers = await ids(['01911000003', '01911000004', '01911000005', '01911000006', '01911000007']);
  const { data: merchants } = await admin().from('wallets').select('id').in('merchant_id', ['MPSEUDO02', 'MPSEUDO03']);
  const { data: ring } = await admin().rpc('record_ring_alert', {
    p_fingerprint: `e2e-${Date.now()}`, p_payer_wallets: payers, p_merchant_wallets: merchants!.map((m) => m.id),
    p_summary: { score: 0.93 },
  });
  await signInAs(page, ANALYST.email, ANALYST.password);
  await page.goto(`/#/alert/${ring}`);
  await expect(page.getByTestId('network-graph')).toBeVisible();
  expect(await page.getByTestId('graph-node').count()).toBe(7);
  expect(await page.getByTestId('graph-edge').count()).toBeGreaterThan(0);
});
