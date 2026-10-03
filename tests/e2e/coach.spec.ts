// Phase 3 in the browser (testcase.md §3.3-3.5): AI coach dashboard, savings
// planner and cash-flow forecast. The LLM runs in mock mode, so text is
// deterministic and no API key is needed. Never changes U-NORMAL's balance
// (pay.spec.ts expects ৳5,000).
import { expect, test, type Page } from '@playwright/test';

import { ALWAYS_ALLOW, setAppConfig, setRiskConfig } from '../integration/helpers';
import { loginWithSession, PHONES, scanImage } from './helpers';

let restore: () => Promise<void>;
test.beforeAll(async () => {
  restore = await setAppConfig({ coach_llm_mode: 'mock', coach_rate_per_minute: 1000, coach_mock_delay_ms: 0 });
});
test.afterAll(async () => restore());

const taka = (text: string | null) => Number((text ?? '').replace(/[^\d.]/g, ''));

async function openCoach(page: Page, phone: string) {
  await loginWithSession(page, phone);
  await page.getByTestId('coach-button').click();
}

test('TC-P3-COACH-01 / LLM-08: U-NORMAL sees breakdown, cash indicator and insights; the browser never calls the LLM', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  await openCoach(page, PHONES.normal);
  await expect(page.getByTestId('coach-summary')).toBeVisible();
  await expect(page.getByTestId('cash-level')).toHaveText('Low');
  await expect(page.getByTestId('category-BILLS')).toContainText('Bills & rent');
  await expect(page.getByTestId('insight-card').first()).toBeVisible();
  await expect(page.getByTestId('category-breakdown')).toHaveAttribute('aria-label', /^Spending by category: /);
  expect([...hosts].some((h) => /anthropic|googleapis|groq/.test(h))).toBe(false);
});

test('TC-P3-COACH-03: U-CASHHEAVY sees high cash dependency, highlighted and explained', async ({ page }) => {
  await openCoach(page, PHONES.cashHeavy);
  await expect(page.getByTestId('cash-level')).toHaveText('⚠ High');
  await expect(page.getByTestId('cash-dependency')).toContainText('paying shops directly by QR');
  await expect(page.getByTestId('insight-card').first()).toContainText('Cash-outs are');
});

test('TC-P3-COACH-04: switching the period updates the numbers', async ({ page }) => {
  await openCoach(page, PHONES.normal);
  await expect(page.getByTestId('coach-income')).toBeVisible();
  const month = taka(await page.getByTestId('coach-income').textContent());
  await page.getByTestId('period-3M').click();
  await expect.poll(async () => taka(await page.getByTestId('coach-income').textContent())).toBeGreaterThan(month);
  await page.getByTestId('period-WEEK').click();
  await expect(page.getByTestId('period-WEEK')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('coach-summary')).toBeVisible();
});

test('TC-P3-COACH-05: U-NEW gets a helpful empty state, no broken charts', async ({ page }) => {
  await openCoach(page, PHONES.newUser);
  await expect(page.getByTestId('empty-state')).toContainText('Nothing to show yet');
  await expect(page.getByTestId('category-breakdown')).toHaveCount(0);
});

test('TC-P3-COACH-06: insights failure shows a retry that recovers', async ({ page }) => {
  await page.route('**/functions/v1/coach', (route) => route.abort());
  await openCoach(page, PHONES.tight);
  await expect(page.getByTestId('coach-summary')).toBeVisible(); // numbers still load
  await expect(page.getByTestId('insights-error')).toContainText('No connection');
  await page.unroute('**/functions/v1/coach');
  await page.getByTestId('insights-error-retry').click();
  await expect(page.getByTestId('insight-card').first()).toBeVisible();
});

test('TC-P3-COACH-07: a new payment shows up after returning to the dashboard', async ({ page }) => {
  const undo = await setRiskConfig(ALWAYS_ALLOW); // about the dashboard, not risk decisions
  try {
    await openCoach(page, PHONES.cashHeavy);
    await page.getByTestId('period-WEEK').click();
    await expect(page.getByTestId('coach-spending')).toBeVisible();
    const before = taka(await page.getByTestId('coach-spending').textContent());
    await page.goBack();
    await scanImage(page, 'valid-static-mlegit');
    await page.getByTestId('amount-input').fill('300');
    await page.getByTestId('pin-input').fill('12345');
    await page.getByTestId('pay-button').click();
    await expect(page.getByText('Payment successful')).toBeVisible();
    await page.getByTestId('receipt-done').click();
    await page.getByTestId('coach-button').click();
    await page.getByTestId('period-WEEK').click();
    await expect.poll(async () => taka(await page.getByTestId('coach-spending').textContent())).toBe(before + 300);
  } finally {
    await undo();
  }
});

test('TC-P3-LLM-05: asking for stock tips is declined', async ({ page }) => {
  await openCoach(page, PHONES.normal);
  await page.getByTestId('ask-input').fill('Which stock should I buy?');
  await page.getByTestId('ask-submit').click();
  await expect(page.getByTestId('ask-answer')).toContainText("I can't recommend specific investments");
});

test('TC-P3-SAVE-01/05/06/08: create ৳৩০০০০ in ৬ months, add savings, edit, delete', async ({ page }) => {
  await openCoach(page, PHONES.normal);
  await page.getByTestId('open-savings').click();
  await page.getByTestId('goal-name').fill('Eid');
  await page.getByTestId('goal-target').fill('৩০০০০');
  await page.getByTestId('goal-months').fill('৬');
  await expect(page.getByTestId('plan-monthly')).toHaveText('৳5,000.00 a month for 6 months');
  await expect(page.getByTestId('plan-status')).toContainText('Realistic');
  await page.getByTestId('goal-submit').click();

  const card = page.getByTestId('goal-card');
  await expect(card).toContainText('Eid');
  await page.getByTestId('contribution-amount').fill('2000');
  await page.getByTestId('contribution-submit').click();
  await expect(page.getByTestId('goal-progress')).toHaveText('৳2,000.00 saved · ৳28,000.00 to go');

  await page.getByTestId('goal-edit').click();
  await page.getByTestId('goal-form').first().getByTestId('goal-target').fill('24000');
  await page.getByTestId('goal-form').first().getByTestId('goal-submit').click();
  await expect(page.getByTestId('goal-progress')).toHaveText('৳2,000.00 saved · ৳22,000.00 to go');

  await page.getByTestId('goal-delete').click();
  await expect(page.getByTestId('delete-confirm')).toContainText('Delete “Eid”');
  await page.getByTestId('delete-confirm-yes').click();
  await expect(card).toHaveCount(0);
});

test('TC-P3-SAVE-02: the same goal is flagged as unrealistic for U-TIGHT', async ({ page }) => {
  await openCoach(page, PHONES.tight);
  await page.getByTestId('open-savings').click();
  await page.getByTestId('goal-target').fill('30000');
  await page.getByTestId('goal-months').fill('6');
  await expect(page.getByTestId('plan-status')).toContainText('Not realistic');
  await expect(page.getByTestId('plan-alternatives')).toContainText('months instead');
});

test('TC-P3-FCST-01: U-NORMAL sees a 30-day projection with upcoming salary and rent', async ({ page }) => {
  await openCoach(page, PHONES.normal);
  await page.getByTestId('open-forecast').click();
  await expect(page.getByTestId('forecast-chart')).toBeVisible();
  await expect(page.getByTestId('recurring-list')).toContainText('Green Homes Rent');
  await expect(page.getByTestId('recurring-list')).toContainText('Income');
  await expect(page.getByTestId('low-balance-warning')).toHaveCount(0);
  await page.getByTestId('horizon-7').click();
  await expect(page.getByTestId('forecast-plot')).toHaveAttribute('aria-label', /next 7 days/);
});

test('TC-P3-FCST-02/06: U-TIGHT is warned before rent and sees the shortfall', async ({ page }) => {
  await openCoach(page, PHONES.tight);
  await page.getByTestId('open-forecast').click();
  await expect(page.getByTestId('low-balance-warning')).toContainText('Low balance expected on');
  await expect(page.getByTestId('low-balance-warning')).toContainText('Green Homes Rent');
  await expect(page.getByTestId('warning-action')).toContainText('before then');
  await expect(page.getByTestId('forecast-shortfall')).toContainText('below zero');
});
