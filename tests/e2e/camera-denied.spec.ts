// TC-P1-QR-02: the browser denies camera access.
import { expect, test } from '@playwright/test';

import { loginWithSession, PHONES, scanImage } from './helpers';

test.use({ permissions: [], launchOptions: { args: ['--deny-permission-prompts', '--use-fake-device-for-media-stream'] } });

test('TC-P1-QR-02: denied camera shows guidance, no crash, and image upload still works', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loginWithSession(page, PHONES.low);

  await scanImage(page, 'valid-static-mlegit');
  await expect(page.getByTestId('merchant-name')).toHaveText('Rahim Store');

  await page.goBack();
  await expect(page.getByTestId('camera-permission-denied')).toBeVisible();
  await expect(page.getByText(/Allow camera access for this site/)).toBeVisible();
  expect(errors).toEqual([]);
});
