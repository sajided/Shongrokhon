// Bangla QR (EMVCo Merchant-Presented Mode) parsing and building.
//
// Project conventions (documented in scripts/gen-qr-fixtures.ts):
//   - Merchant account information: a template in tags 26–51; sub-tag 01 holds the merchant ID.
//   - Dynamic QR expiry: template tag 80, sub-tag 01 = expiry as Unix seconds.
//     EMVCo defines no standard expiry field, so this is ours.

export type QrErrorCode = 'NOT_BANGLA_QR' | 'INVALID_QR' | 'EXPIRED_QR';

export interface ParsedQr {
  kind: 'static' | 'dynamic';
  merchantId: string;
  merchantName: string;
  merchantCity: string | null;
  mcc: string;
  amount: number | null;
  expiresAt: Date | null;
  raw: string;
}

export type QrParseResult = { ok: true; qr: ParsedQr } | { ok: false; code: QrErrorCode };

const BDT = '050';
const EXPIRY_TEMPLATE_TAG = '80';

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as required by EMVCo tag 63. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(input)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Strict TLV parse: 2-digit tag, 2-digit length, value; must consume the whole string. */
export function parseTlv(input: string): Map<string, string> | null {
  const out = new Map<string, string>();
  let i = 0;
  while (i < input.length) {
    const tag = input.slice(i, i + 2);
    const lenText = input.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenText)) return null;
    const len = Number(lenText);
    const value = input.slice(i + 4, i + 4 + len);
    if (value.length !== len || out.has(tag)) return null;
    out.set(tag, value);
    i += 4 + len;
  }
  return out;
}

function findMerchantId(tags: Map<string, string>): string | null {
  for (let t = 26; t <= 51; t++) {
    const template = tags.get(String(t));
    if (!template) continue;
    const id = parseTlv(template)?.get('01')?.trim();
    if (id) return id;
  }
  return null;
}

export function parseBanglaQr(payload: string, now: Date = new Date()): QrParseResult {
  const raw = payload.trim();
  const tags = parseTlv(raw);
  // Must look like EMVCo MPM: format indicator first, CRC last.
  if (!tags || !raw.startsWith('000201') || !/6304[0-9A-Fa-f]{4}$/.test(raw)) {
    return { ok: false, code: 'NOT_BANGLA_QR' };
  }

  const withoutCrc = raw.slice(0, -4);
  if (crc16(withoutCrc) !== raw.slice(-4).toUpperCase()) return { ok: false, code: 'INVALID_QR' };

  const initiation = tags.get('01');
  const mcc = tags.get('52');
  const merchantName = tags.get('59')?.trim();
  const merchantId = findMerchantId(tags);
  if (
    (initiation !== '11' && initiation !== '12') ||
    !mcc || !/^\d{4}$/.test(mcc) ||
    tags.get('53') !== BDT ||
    tags.get('58') !== 'BD' ||
    !merchantName ||
    !merchantId
  ) {
    return { ok: false, code: 'NOT_BANGLA_QR' };
  }

  let amount: number | null = null;
  const amountText = tags.get('54');
  if (amountText !== undefined) {
    if (!/^\d+(\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0) return { ok: false, code: 'INVALID_QR' };
    amount = Number(amountText);
  }

  let expiresAt: Date | null = null;
  const expiryTemplate = tags.get(EXPIRY_TEMPLATE_TAG);
  if (expiryTemplate) {
    const seconds = parseTlv(expiryTemplate)?.get('01');
    if (!seconds || !/^\d+$/.test(seconds)) return { ok: false, code: 'INVALID_QR' };
    expiresAt = new Date(Number(seconds) * 1000);
  }

  const kind = initiation === '12' ? 'dynamic' : 'static';
  if (kind === 'dynamic' && expiresAt && expiresAt.getTime() <= now.getTime()) {
    return { ok: false, code: 'EXPIRED_QR' };
  }

  return {
    ok: true,
    qr: { kind, merchantId, merchantName, merchantCity: tags.get('60')?.trim() || null, mcc, amount, expiresAt, raw },
  };
}

// ---------------------------------------------------------------------------
// Builder (fixtures, tests, and later a merchant "receive" screen)
// ---------------------------------------------------------------------------

function tlv(tag: string, value: string): string {
  if (value.length > 99) throw new Error(`TLV value too long for tag ${tag}`);
  return tag + String(value.length).padStart(2, '0') + value;
}

export interface BuildQrOptions {
  merchantId: string;
  merchantName: string;
  merchantCity?: string;
  mcc?: string;
  amount?: number;
  expiresAt?: Date;
  guid?: string;
}

export function buildBanglaQr(opts: BuildQrOptions): string {
  const dynamic = opts.amount !== undefined;
  let body =
    tlv('00', '01') +
    tlv('01', dynamic ? '12' : '11') +
    tlv('26', tlv('00', opts.guid ?? 'BD.SHONGROKHON') + tlv('01', opts.merchantId)) +
    tlv('52', opts.mcc ?? '5411') +
    tlv('53', BDT);
  if (dynamic) body += tlv('54', opts.amount!.toFixed(2));
  body += tlv('58', 'BD') + tlv('59', opts.merchantName) + tlv('60', opts.merchantCity ?? 'Dhaka');
  if (opts.expiresAt) body += tlv(EXPIRY_TEMPLATE_TAG, tlv('01', String(Math.floor(opts.expiresAt.getTime() / 1000))));
  body += '6304';
  return body + crc16(body);
}
