// PII scrubbing for text that may reach the LLM (TC-P3-MW-03): merchant names
// for categorisation and the user's own "ask the coach" question. The
// insights payload never contains free text at all.

const BANGLA_DIGITS = /[০-৯]/g;
// BD mobile: 01XXXXXXXXX, +8801XXXXXXXXX, +880 1XXX-XXXXXX. Not inside a longer digit run (an NID).
const PHONE = /(?<!\d)(?:\+?\s*88[\s-]*)?0?[\s-]*1[3-9](?:[\s-]*\d){8}(?!\d)/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_NUMBER = /\d{10,}/g; // NID (10/13/17 digits), account and wallet numbers
const CONTROL = /[\u0000-\u001f\u007f<>{}]/g; // control chars; brackets that could fake tags or placeholders

/** Bangla digits to ASCII, so ০১৭১১০০০০০০১ is recognised as a phone number. */
export function asciiDigits(text: string): string {
  return text.replace(BANGLA_DIGITS, (d) => String(d.charCodeAt(0) - 0x09e6));
}

export function scrubPII(text: string, maxLength: number): string {
  return asciiDigits(text)
    .replace(CONTROL, ' ')
    .replace(EMAIL, '[email]')
    .replace(UUID, '[id]')
    .replace(PHONE, '[phone]')
    .replace(LONG_NUMBER, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
