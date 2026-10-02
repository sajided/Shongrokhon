import { buildBanglaQr, crc16, parseBanglaQr, parseTlv } from './emv';

const NOW = new Date('2026-10-02T10:00:00Z');
const staticQr = buildBanglaQr({ merchantId: 'MLEGIT0001', merchantName: 'Rahim Store' });
const dynamicQr = buildBanglaQr({
  merchantId: 'MLEGIT0001',
  merchantName: 'Rahim Store',
  amount: 250,
  expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000),
});

describe('crc16 (CRC-16/CCITT-FALSE)', () => {
  it('matches the standard check value', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
});

describe('parseTlv', () => {
  it('rejects truncated or malformed input', () => {
    expect(parseTlv('0002')).toBeNull();
    expect(parseTlv('ab02xx')).toBeNull();
    expect(parseTlv('000201')).toEqual(new Map([['00', '01']]));
  });
});

describe('TC-P1-QR-03: static Bangla QR', () => {
  it('returns merchant details and no amount', () => {
    const result = parseBanglaQr(staticQr, NOW);
    expect(result).toMatchObject({
      ok: true,
      qr: { kind: 'static', merchantId: 'MLEGIT0001', merchantName: 'Rahim Store', amount: null, mcc: '5411' },
    });
  });
});

describe('TC-P1-QR-04: dynamic Bangla QR', () => {
  it('returns the amount from tag 54', () => {
    const result = parseBanglaQr(dynamicQr, NOW);
    expect(result).toMatchObject({ ok: true, qr: { kind: 'dynamic', amount: 250, merchantId: 'MLEGIT0001' } });
  });

  it('accepts surrounding whitespace from scanners', () => {
    expect(parseBanglaQr(`  ${dynamicQr}\n`, NOW).ok).toBe(true);
  });
});

describe('TC-P1-QR-05: tampered CRC', () => {
  it('rejects a payload whose content was changed', () => {
    const tampered = staticQr.replace('Rahim Store', 'Rahim Stora');
    expect(parseBanglaQr(tampered, NOW)).toEqual({ ok: false, code: 'INVALID_QR' });
  });

  it('rejects a payload whose CRC was changed', () => {
    const crc = staticQr.slice(-4);
    const wrong = staticQr.slice(0, -4) + (crc === '0000' ? '0001' : '0000');
    expect(parseBanglaQr(wrong, NOW)).toEqual({ ok: false, code: 'INVALID_QR' });
  });

  it('rejects a dynamic QR whose amount was edited', () => {
    expect(parseBanglaQr(dynamicQr.replace('5406250.00', '5406950.00'), NOW)).toEqual({ ok: false, code: 'INVALID_QR' });
  });
});

describe('TC-P1-QR-06: non-payment QR', () => {
  it.each([
    ['URL', 'https://example.com/pay?id=1'],
    ['plain text', 'hello world'],
    ['Wi-Fi QR', 'WIFI:S:home;T:WPA;P:secret;;'],
    ['empty', ''],
  ])('rejects %s', (_label, payload) => {
    expect(parseBanglaQr(payload, NOW)).toEqual({ ok: false, code: 'NOT_BANGLA_QR' });
  });

  it('rejects a valid EMVCo QR in a non-BDT currency', () => {
    const body = '000201010211' + '26180006GUID010401AB' + '52045411' + '5303840' + '5802US' + '5904Shop' + '6304';
    expect(parseBanglaQr(body + crc16(body), NOW)).toEqual({ ok: false, code: 'NOT_BANGLA_QR' });
  });

  it('rejects an EMVCo QR without a merchant ID', () => {
    const body = '000201010211' + '52045411' + '5303050' + '5802BD' + '5904Shop' + '6304';
    expect(parseBanglaQr(body + crc16(body), NOW)).toEqual({ ok: false, code: 'NOT_BANGLA_QR' });
  });
});

describe('TC-P1-QR-07: expired dynamic QR', () => {
  it('rejects a dynamic QR past its expiry', () => {
    const expired = buildBanglaQr({
      merchantId: 'MLEGIT0001',
      merchantName: 'Rahim Store',
      amount: 100,
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    expect(parseBanglaQr(expired, NOW)).toEqual({ ok: false, code: 'EXPIRED_QR' });
  });

  it('accepts it before expiry', () => {
    expect(parseBanglaQr(dynamicQr, NOW).ok).toBe(true);
  });
});

describe('builder', () => {
  it('produces payloads the parser round-trips', () => {
    const qr = buildBanglaQr({ merchantId: 'M1', merchantName: 'Shop', merchantCity: 'Chattogram', amount: 12.5 });
    expect(parseBanglaQr(qr, NOW)).toMatchObject({ ok: true, qr: { merchantCity: 'Chattogram', amount: 12.5 } });
  });
});
