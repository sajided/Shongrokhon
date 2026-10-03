// TC-P4-L10N-02/04/05/08: translation coverage, formats, and figures that
// match across languages.
import { findHardcodedText } from '../../scripts/check-i18n';

import { bn } from './bn';
import { en, type MessageKey } from './en';
import { formatDateTime, formatDay, formatMoney, localizeDigits, ordinal, translate } from './translate';

const BN = { locale: 'bn' as const, banglaDigits: true };
const EN = { locale: 'en' as const, banglaDigits: false };
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('TC-P4-L10N-02: translation coverage', () => {
  const keys = Object.keys(en) as MessageKey[];

  it('every key has a non-empty Bangla value with the same placeholders', () => {
    const problems = keys.filter((k) => !bn[k]?.trim() || placeholders(bn[k]).join() !== placeholders(en[k]).join());
    expect(problems).toEqual([]);
  });

  it('Bangla is actually Bangla, not untranslated English', () => {
    // Exceptions: language names, and texts that are only codes or placeholders.
    const allowed = new Set<MessageKey>(['settings.english', 'config.fix']);
    const untranslated = keys.filter((k) => !allowed.has(k) && bn[k] === en[k] && /[A-Za-z]{3}/.test(en[k]));
    expect(untranslated).toEqual([]);
  });

  it('no hard-coded UI text outside t() in src/app and src/components', () => {
    expect(findHardcodedText()).toEqual([]);
  });
});

describe('translate', () => {
  it('fills parameters, localising numeric ones', () => {
    expect(translate('en', 'verify.body', { phone: '+8801711000001' })).toBe('We sent a 6-digit code to +8801711000001.');
    expect(translate('bn', 'forecast.days', { count: 30 })).toBe('৩০ দিন');
    expect(translate('bn', 'forecast.days', { count: 30 }, false)).toBe('30 দিন');
  });

  it('chooses plural forms by count', () => {
    expect(translate('en', 'coach.cashCount', { count: 1, amount: '৳500.00' })).toBe('1 cash-out, ৳500.00');
    expect(translate('en', 'coach.cashCount', { count: 3, amount: '৳500.00' })).toBe('3 cash-outs, ৳500.00');
  });

  it('falls back to the key for unknown keys', () => {
    expect(translate('bn', 'nope.key')).toBe('nope.key');
  });
});

describe('TC-P4-L10N-04: number & currency format', () => {
  it.each([
    [125000, '৳১,২৫,০০০.০০'],
    [4500, '৳৪,৫০০.০০'],
    [12345678.9, '৳১,২৩,৪৫,৬৭৮.৯০'],
    [-300, '-৳৩০০.০০'],
  ])('%p -> %s in Bangla', (n, s) => expect(formatMoney(n, BN)).toBe(s));

  it('Bangla mode can keep Latin digits', () => {
    expect(formatMoney(125000, { locale: 'bn', banglaDigits: false })).toBe('৳1,25,000.00');
  });

  it('English is unchanged', () => {
    expect(formatMoney(125000, EN)).toBe('৳1,25,000.00');
  });
});

describe('TC-P4-L10N-05: dates', () => {
  it('Bangla month names and digits', () => {
    const local = new Date(2026, 9, 3, 14, 5).toISOString();
    expect(formatDateTime(local, BN)).toBe('৩ অক্টোবর ২০২৬, ১৪:০৫');
    expect(formatDateTime(local, EN)).toBe('2026-10-03 14:05');
    expect(formatDay('2026-10-13', BN)).toBe('১৩ অক্টোবর');
    expect(formatDay('2026-10-13', EN)).toBe('13 Oct');
  });
});

describe('ordinals', () => {
  it.each([[1, '1st', '১ম'], [2, '2nd', '২য়'], [3, '3rd', '৩য়'], [4, '4th', '৪র্থ'], [5, '5th', '৫ম'], [6, '6th', '৬ষ্ঠ'],
    [11, '11th', '১১তম'], [22, '22nd', '২২তম']])('%p', (n, e, b) => {
    expect(ordinal(n, EN)).toBe(e);
    expect(ordinal(n, BN)).toBe(b);
  });
});

describe('TC-P4-L10N-08: the same figures in both languages', () => {
  it('a message with amounts carries identical numbers', () => {
    const params = (o: typeof EN | typeof BN) => ({ amount: formatMoney(9500, o), fee: formatMoney(175.75, o) });
    const english = translate('en', 'nudge.fee', params(EN));
    const bangla = translate('bn', 'nudge.fee', params(BN));
    const numbers = (s: string) => (localizeDigits(s, EN).replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).match(/[\d,.]+\d/g) ?? []);
    expect(numbers(bangla)).toEqual(numbers(english));
    expect(numbers(english)).toEqual(['9,500.00', '175.75']);
  });
});
