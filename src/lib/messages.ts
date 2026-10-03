// User-facing text for every error code the app can receive. The text lives in
// src/i18n (en.ts / bn.ts); components use useI18n().msg, which follows the
// selected language. messageFor() is the English default for non-React code.
import { messageText } from '@/i18n/LocaleProvider';
import type { LocaleOptions } from '@/i18n/translate';

export function messageFor(
  code: string | null | undefined,
  extra?: { attempts_left?: number },
  opts: LocaleOptions = { locale: 'en', banglaDigits: false },
): string {
  return messageText(opts, code, extra);
}
