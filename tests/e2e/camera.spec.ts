// TC-P1-QR-01/03/11 with a real camera stream: Chromium plays a QR image as the
// webcam, so this covers getUserMedia -> BarcodeDetector/zxing -> pay screen.
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { loginWithSession, PHONES } from './helpers';

const video = join(__dirname, '..', '..', 'fixtures', 'qr', 'valid-static-mlegit.y4m');

test.use({
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  },
});

test('TC-P1-QR-01/03/11: camera scan opens exactly one payment screen for a static QR', async ({ page }) => {
  await loginWithSession(page, PHONES.low);
  const lookups: string[] = [];
  page.on('request', (r) => r.url().includes('/rpc/lookup_merchant') && lookups.push(r.url()));

  await page.getByTestId('scan-button').click();
  const started = Date.now();
  await expect(page.getByTestId('merchant-name')).toHaveText('Rahim Store', { timeout: 15_000 });
  test.info().annotations.push({ type: 'scan-to-pay-screen-ms', description: String(Date.now() - started) });

  // The QR stays in view for several seconds; only one pay screen may open.
  await page.waitForTimeout(3000);
  expect(lookups).toHaveLength(1);
  await expect(page.getByTestId('pay-button')).toHaveCount(1);
});
