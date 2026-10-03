// Grounded numbers (TC-P3-LLM-04, TC-P4-INV-05). The LLM never writes a
// figure: it refers to facts by placeholder, e.g. "You spent {{cat.FOOD.total}}",
// and the server substitutes values computed by SQL (or SHAP). Output with a
// raw digit (Latin or Bangla) or an unknown placeholder is rejected.

import { asciiDigits } from './sanitize.ts';

export type Facts = Record<string, string>;
export type Lang = 'en' | 'bn';

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
const DIGIT = /[0-9০-৯]/;

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
/** Bangla mode shows Bangla digits (TC-P4-L10N-04); the figures are the same (L10N-08). */
export function digits(text: string, lang: Lang): string {
  return lang === 'bn' ? text.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]) : text;
}

/** Whole taka with South Asian grouping: 125000 -> ৳1,25,000 / ৳১,২৫,০০০ (same grouping as src/lib/format.ts). */
export function taka(n: number, lang: Lang = 'en'): string {
  return digits(takaLatin(n), lang);
}

function takaLatin(n: number): string {
  const rounded = Math.round(Math.abs(n));
  const s = String(rounded);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${n < 0 && rounded > 0 ? '-' : ''}৳${rest ? `${rest},${last3}` : last3}`;
}

export function percent(share: number, lang: Lang = 'en'): string {
  return digits(`${Math.round(share * 100)}%`, lang);
}

export type GroundingResult = { ok: true; text: string } | { ok: false; reason: 'UNKNOWN_PLACEHOLDER' | 'RAW_NUMBER' };

/**
 * Checks one LLM-written string and fills its placeholders.
 * allowedNumbers: numbers the user typed in their own question, which the
 * answer may repeat (e.g. "how can I save 5000?").
 */
export function ground(text: string, facts: Facts, allowedNumbers: string[] = []): GroundingResult {
  let unknown = false;
  const withoutPlaceholders = text.replace(PLACEHOLDER, (_, key: string) => {
    if (!(key in facts)) unknown = true;
    return '';
  });
  if (unknown) return { ok: false, reason: 'UNKNOWN_PLACEHOLDER' };
  let rest = asciiDigits(withoutPlaceholders).replace(/(\d),(\d)/g, '$1$2');
  for (const n of allowedNumbers) rest = rest.split(n).join('');
  if (DIGIT.test(rest)) return { ok: false, reason: 'RAW_NUMBER' };
  // "the {{period}}" + "the last 30 days" would read "the the last 30 days".
  const filled = text.replace(PLACEHOLDER, (_, key: string) => facts[key]).replace(/\b(the) the\b/gi, '$1');
  return { ok: true, text: filled };
}

/** Numbers in the user's question, normalised (Bangla digits, thousands separators removed). */
export function numbersIn(question: string): string[] {
  return (asciiDigits(question).replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? [])
    .sort((a, b) => b.length - a.length);
}
