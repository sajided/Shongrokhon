// Generates QR-VALID / QR-INVALID fixtures (testcase.md §0.4) as payload text
// and PNG images, for gallery import, printing, on-screen scanning and Maestro.
//
//   npm run qr:fixtures            -> fixtures/qr/*.png + fixtures/qr/index.json
//
// Conventions used by src/lib/qr/emv.ts:
//   - Merchant ID lives in merchant account template tag 26, sub-tag 01.
//   - Dynamic QR expiry lives in template tag 80, sub-tag 01 (Unix seconds).
//     EMVCo has no standard expiry field; this one is project-specific.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import QRCode from 'qrcode';

import { buildBanglaQr, crc16 } from '../src/lib/qr/emv';

const outDir = join(__dirname, '..', 'fixtures', 'qr');
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const staticLegit = buildBanglaQr({ merchantId: 'MLEGIT0001', merchantName: 'Rahim Store' });
const nonBdtBody = '000201010211' + '26180006GUID0104MX01' + '52045411' + '5303840' + '5802US' + '5904Shop' + '6304';

const fixtures: Record<string, { payload: string; expect: string }> = {
  'valid-static-mlegit': { payload: staticLegit, expect: 'static, merchant MLEGIT0001, amount editable' },
  'valid-dynamic-mlegit-250': {
    payload: buildBanglaQr({
      merchantId: 'MLEGIT0001',
      merchantName: 'Rahim Store',
      amount: 250,
      expiresAt: new Date(now + 30 * DAY),
    }),
    expect: 'dynamic, ৳250.00 read-only (valid for 30 days from generation)',
  },
  'valid-static-unregistered': {
    payload: buildBanglaQr({ merchantId: 'NOPE9999', merchantName: 'Ghost Shop' }),
    expect: 'parses, but the server reports MERCHANT_NOT_FOUND',
  },
  'invalid-tampered-crc': {
    payload: staticLegit.replace('Rahim Store', 'Rahim Stora'),
    expect: 'INVALID_QR',
  },
  'invalid-expired-dynamic': {
    payload: buildBanglaQr({
      merchantId: 'MLEGIT0001',
      merchantName: 'Rahim Store',
      amount: 100,
      expiresAt: new Date(now - DAY),
    }),
    expect: 'EXPIRED_QR',
  },
  'invalid-url': { payload: 'https://example.com/pay?id=1', expect: 'NOT_BANGLA_QR' },
  'invalid-plain-text': { payload: 'hello from shongrokhon', expect: 'NOT_BANGLA_QR' },
  'invalid-non-bdt': { payload: nonBdtBody + crc16(nonBdtBody), expect: 'NOT_BANGLA_QR' },
};

async function main() {
  mkdirSync(outDir, { recursive: true });
  for (const [name, { payload }] of Object.entries(fixtures)) {
    await QRCode.toFile(join(outDir, `${name}.png`), payload, { width: 600, margin: 4 });
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(fixtures, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(fixtures).length} fixtures to ${outDir}`);
}

main();
