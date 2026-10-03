// Client-side input rules. The server re-checks every one of these.

export const PER_TXN_LIMIT = 25000;

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Converts Bangla digits (০-৯) to ASCII so either keyboard works. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
}

/**
 * TC-P1-AUTH-02: accepts 01XXXXXXXXX (with optional +880 / 880 prefix, spaces or dashes)
 * and returns E.164 (+8801XXXXXXXXX), or null when it is not a BD mobile number.
 */
export function normalizeBdPhone(input: string): string | null {
  const compact = toAsciiDigits(input).replace(/[\s-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;
  const digits = compact.replace(/^\+/, '');
  const local = digits.startsWith('880') ? digits.slice(2) : digits;
  return /^01[3-9]\d{8}$/.test(local) ? `+88${local}` : null;
}

/** Lowercased email, or null when it does not look like one. The server re-checks. */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/** Send-money recipient: a BD mobile number (as E.164) or an email-registered account. */
export function normalizeRecipient(input: string): string | null {
  return input.includes('@') ? normalizeEmail(input) : normalizeBdPhone(input);
}

export type AmountError = 'REQUIRED' | 'INVALID_AMOUNT' | 'AMOUNT_TOO_PRECISE' | 'AMOUNT_ABOVE_LIMIT';

/** TC-P1-PAY-06. */
export function validateAmount(
  input: string,
  limit: number = PER_TXN_LIMIT,
): { ok: true; value: number } | { ok: false; code: AmountError } {
  const text = toAsciiDigits(input).replace(/,/g, '').trim();
  if (!text) return { ok: false, code: 'REQUIRED' };
  if (!/^-?\d*\.?\d+$/.test(text)) return { ok: false, code: 'INVALID_AMOUNT' };
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, code: 'INVALID_AMOUNT' };
  if (!/^(\d+|\d*\.\d{1,2})$/.test(text)) return { ok: false, code: 'AMOUNT_TOO_PRECISE' };
  if (value > limit) return { ok: false, code: 'AMOUNT_ABOVE_LIMIT' };
  return { ok: true, value };
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,5}$/.test(pin);
}

export function isValidOtp(otp: string): boolean {
  return /^\d{6}$/.test(otp);
}

/** Same as app_config.savings_max_target. */
export const SAVINGS_MAX_TARGET = 1000000;

export type GoalAmountError = AmountError | 'GOAL_AMOUNT_TOO_LARGE';

/** TC-P3-SAVE-03/08: a savings target; Bangla digits and commas are accepted. */
export function validateGoalAmount(input: string): { ok: true; value: number } | { ok: false; code: GoalAmountError } {
  const result = validateAmount(input, Number.POSITIVE_INFINITY);
  if (result.ok && result.value > SAVINGS_MAX_TARGET) return { ok: false, code: 'GOAL_AMOUNT_TOO_LARGE' };
  return result;
}

/** TC-P3-SAVE-03: whole months, 1 to 60. */
export function validateGoalMonths(input: string): { ok: true; value: number } | { ok: false; code: 'GOAL_MONTHS_INVALID' } {
  const text = toAsciiDigits(input).trim();
  const value = Number(text);
  if (!/^\d+$/.test(text) || value < 1 || value > 60) return { ok: false, code: 'GOAL_MONTHS_INVALID' };
  return { ok: true, value };
}
