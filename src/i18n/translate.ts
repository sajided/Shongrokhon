// Pure localization helpers (no React): translation lookup, Bangla digits,
// money and date formats. Components use them through useI18n()
// (LocaleProvider); messageFor() and tests call them directly.
import { bn } from './bn';
import { en, type MessageKey, type TranslationKey } from './en';

export type Locale = 'en' | 'bn';
export const LOCALES: readonly Locale[] = ['en', 'bn'];

export interface LocaleOptions {
  locale: Locale;
  /** Bangla digits in Bangla mode (TC-P4-L10N-04). Ignored in English. */
  banglaDigits: boolean;
}

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, bn };
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

export type Params = Record<string, string | number>;

/** Looks up a key (plural _one/_other by `count`), then fills {params}. Falls back to English. */
export function translate(locale: Locale, key: TranslationKey | string, params: Params = {}, banglaDigits = true): string {
  const dict = DICTIONARIES[locale];
  let k = key as MessageKey;
  if (typeof params.count === 'number') {
    const plural = `${key}_${params.count === 1 ? 'one' : 'other'}` as MessageKey;
    if (plural in en) k = plural;
  }
  const template = dict[k] ?? en[k] ?? String(key);
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === 'number' ? localizeDigits(String(value), { locale, banglaDigits }) : value;
  });
}

export function hasKey(key: string): key is MessageKey {
  return key in en;
}

export function localizeDigits(text: string, { locale, banglaDigits }: LocaleOptions): string {
  if (locale !== 'bn' || !banglaDigits) return text;
  return text.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/** ৳ with South Asian grouping: 125000 -> ৳1,25,000.00, or ৳১,২৫,০০০.০০ in Bangla digits. */
export function formatMoney(amount: number, opts: LocaleOptions, { decimals = 2 }: { decimals?: number } = {}): string {
  const negative = amount < 0;
  const [whole, fraction] = Math.abs(amount).toFixed(decimals).split('.');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
  return localizeDigits(`${negative ? '-' : ''}৳${grouped}${fraction ? `.${fraction}` : ''}`, opts);
}

export function formatPercent(share: number, opts: LocaleOptions): string {
  return localizeDigits(`${Math.round(share * 100)}%`, opts);
}

const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Date and time in the device's time zone. English keeps the Phase 1 format
 * (2026-10-03 14:05); Bangla uses month names and digits (৩ অক্টোবর ২০২৬, ১৪:০৫)
 * from built-in tables, not ICU, so it is the same on every browser (TC-P4-L10N-05).
 */
export function formatDateTime(iso: string, opts: LocaleOptions): string {
  const d = new Date(iso);
  if (opts.locale === 'en') {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return localizeDigits(`${d.getDate()} ${BN_MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`, opts);
}

/** A calendar day (YYYY-MM-DD, UTC-based like the forecast): "13 Oct" / "১৩ অক্টোবর". */
export function formatDay(day: string, opts: LocaleOptions): string {
  const [, m, d] = day.split('-').map(Number);
  return opts.locale === 'en' ? `${d} ${EN_MONTHS[m - 1]}` : localizeDigits(`${d} ${BN_MONTHS[m - 1]}`, opts);
}

/** 5 -> "5th" / "৫ম". */
export function ordinal(n: number, opts: LocaleOptions): string {
  if (opts.locale === 'bn') {
    const special: Record<number, string> = { 1: '১ম', 2: '২য়', 3: '৩য়', 4: '৪র্থ', 6: '৬ষ্ঠ' };
    if (special[n]) return opts.banglaDigits ? special[n] : `${n}${special[n].replace(/[০-৯]/g, '')}`;
    return localizeDigits(`${n}`, opts) + (n <= 10 ? 'ম' : 'তম');
  }
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}
