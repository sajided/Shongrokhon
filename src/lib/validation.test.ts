import { isValidOtp, isValidPin, normalizeBdPhone, toAsciiDigits, validateAmount } from './validation';

describe('TC-P1-AUTH-02: phone validation', () => {
  it.each([
    ['01712345678', '+8801712345678'],
    ['+8801712345678', '+8801712345678'],
    ['8801712345678', '+8801712345678'],
    ['017-1234-5678', '+8801712345678'],
    [' 01912 345678 ', '+8801912345678'],
    ['০১৭১২৩৪৫৬৭৮', '+8801712345678'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeBdPhone(input)).toBe(expected);
  });

  it.each(['0123', '+15551234567', 'abcdefghijk', '01212345678', '0171234567', '017123456789', '', '+880'])(
    'rejects %s',
    (input) => {
      expect(normalizeBdPhone(input)).toBeNull();
    },
  );
});

describe('TC-P1-PAY-06: amount validation', () => {
  it.each([
    ['', 'REQUIRED'],
    ['0', 'INVALID_AMOUNT'],
    ['0.00', 'INVALID_AMOUNT'],
    ['-5', 'INVALID_AMOUNT'],
    ['abc', 'INVALID_AMOUNT'],
    ['1e5', 'INVALID_AMOUNT'],
    ['10.123', 'AMOUNT_TOO_PRECISE'],
    ['25000.01', 'AMOUNT_ABOVE_LIMIT'],
  ])('rejects %p with %s', (input, code) => {
    expect(validateAmount(input)).toEqual({ ok: false, code });
  });

  it.each([
    ['500', 500],
    ['10.5', 10.5],
    ['.5', 0.5],
    ['1,250.75', 1250.75],
    ['25000', 25000],
    ['৫০০', 500],
  ])('accepts %p', (input, value) => {
    expect(validateAmount(input)).toEqual({ ok: true, value });
  });
});

describe('PIN and OTP format', () => {
  it('accepts 4 or 5 digit PINs only', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });

  it('accepts 6 digit OTPs only', () => {
    expect(isValidOtp('123456')).toBe(true);
    expect(isValidOtp('12345')).toBe(false);
  });

  it('converts Bangla digits', () => {
    expect(toAsciiDigits('৩০০০০')).toBe('30000');
  });
});
