// TC-P4-L10N-01/03/04/05/06/09 in the browser: switch to Bangla without a
// restart, Bangla digits and dates, the Bangla coach, errors in Bangla, and
// conjuncts that are not clipped. Leaves U-NORMAL in English for later specs.
import { expect, test, type Page } from '@playwright/test';

import { admin, setAppConfig } from '../integration/helpers';
import { loginWithSession, PHONES } from './helpers';

async function toEnglish() {
  await admin().from('users').update({ language: 'en', bangla_digits: true }).eq('phone', `+88${PHONES.normal}`);
}

/** No text element in view is cut off vertically (TC-P4-L10N-03 proxy for clipped conjuncts). */
async function clippedText(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('div[dir="auto"]')]
    .filter((el) => el.childElementCount === 0 && el.textContent?.trim())
    .filter((el) => el.scrollHeight > el.clientHeight + 1)
    .map((el) => el.textContent));
}

test.afterEach(toEnglish);

test('TC-P4-L10N-01/04/05: switching to বাংলা changes every screen at once, with Bangla digits and dates', async ({ page }) => {
  await loginWithSession(page, PHONES.normal);
  await expect(page.getByTestId('balance')).toHaveText('৳5,000.00');
  await page.getByTestId('settings-button').click();
  await page.getByTestId('lang-bn').click();
  // No reload: the settings screen itself is already Bangla.
  await expect(page.getByText('সংখ্যা বাংলা অঙ্কে দেখান')).toBeVisible();
  await page.goBack();
  await expect(page.getByText('বর্তমান ব্যালেন্স')).toBeVisible();
  await expect(page.getByTestId('balance')).toHaveText('৳৫,০০০.০০'); // L10N-04
  await expect(page.getByTestId('txn-row').first()).toContainText(/(জানুয়ারি|ফেব্রুয়ারি|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর)/); // L10N-05
  await expect(page.getByTestId('txn-row').first()).toContainText('সফল');
  // The choice is saved to the account, so it survives a reload.
  await page.reload();
  await expect(page.getByText('বর্তমান ব্যালেন্স')).toBeVisible();
});

test('TC-P4-L10N-06/03: the coach in Bangla, with nothing clipped', async ({ page }) => {
  const restore = await setAppConfig({ coach_llm_mode: 'mock' });
  try {
    await admin().from('users').update({ language: 'bn' }).eq('phone', `+88${PHONES.normal}`);
    await loginWithSession(page, PHONES.normal);
    await page.getByTestId('coach-button').click();
    await expect(page.getByText('টাকা কোথায় গেল')).toBeVisible();
    await expect(page.getByTestId('category-BILLS')).toContainText('বিল ও বাসাভাড়া');
    await expect(page.getByTestId('insight-card').first()).toContainText(/[০-৯]/);
    expect(await clippedText(page)).toEqual([]);
    await page.getByTestId('open-forecast').click();
    await expect(page.getByTestId('forecast-chart')).toContainText('সম্ভাব্য ব্যালেন্স');
    await page.goBack();
    await page.goBack();
    await page.getByTestId('settings-button').click();
    await expect(page.getByTestId('font-sample')).toContainText('ক্ষ ঞ্জ ন্ত্র স্ক্র');
    expect(await clippedText(page)).toEqual([]);
    const box = await page.getByTestId('font-sample').boundingBox();
    expect(box!.height).toBeGreaterThan(40); // the conjunct line has room
  } finally {
    await restore();
  }
});

test('TC-P4-L10N-09: errors are shown in Bangla', async ({ page }) => {
  await admin().from('users').update({ language: 'bn' }).eq('phone', `+88${PHONES.normal}`);
  await loginWithSession(page, PHONES.normal);
  await page.getByTestId('cashout-button').click();
  await page.getByTestId('agent-input').fill('NOBODY99');
  await page.getByTestId('agent-find').click();
  await expect(page.getByTestId('error-banner')).toHaveText('এই নম্বরে কোনো এজেন্ট নেই।');
});
