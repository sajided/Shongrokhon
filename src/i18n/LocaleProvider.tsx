// Language context (TC-P4-L10N-01): switching re-renders every screen, no restart.
//
// The language in force is, in order: what the user just chose on this device,
// then the signed-in user's saved preference (users.language), then the last
// choice stored in this browser, then English.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { useSession } from '@/hooks/session';
import { setMyPreferences } from '@/lib/api';

import { en, type TranslationKey } from './en';
import {
  formatDateTime, formatDay, formatMoney, formatPercent, localizeDigits, ordinal, translate,
  type Locale, type LocaleOptions, type Params,
} from './translate';

const STORAGE_KEY = 'shongrokhon.locale';

// Error codes with a message (en.ts is the source of truth).
const ERROR_KEYS: Record<string, true> = Object.fromEntries(
  Object.keys(en).filter((k) => k.startsWith('error.')).map((k) => [k, true]),
);

function stored(): Partial<LocaleOptions> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<LocaleOptions>) : {};
  } catch {
    return {};
  }
}

function persist(opts: LocaleOptions) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
    // Private mode etc.: the server preference still applies after sign-in.
  }
}

export interface I18n extends LocaleOptions {
  t: (key: TranslationKey, params?: Params) => string;
  /** User-facing text for an error code (falls back to INTERNAL_ERROR). */
  msg: (code: string | null | undefined, extra?: { attempts_left?: number }) => string;
  money: (amount: number, options?: { decimals?: number }) => string;
  percent: (share: number) => string;
  dateTime: (iso: string) => string;
  day: (day: string) => string;
  ordinal: (n: number) => string;
  digits: (text: string) => string;
  setLanguage: (locale: Locale) => void;
  setBanglaDigits: (on: boolean) => void;
}

export function makeI18n(opts: LocaleOptions, setters: Pick<I18n, 'setLanguage' | 'setBanglaDigits'>): I18n {
  return {
    ...opts,
    ...setters,
    t: (key, params) => translate(opts.locale, key, params, opts.banglaDigits),
    msg: (code, extra) => messageText(opts, code, extra),
    money: (amount, options) => formatMoney(amount, opts, options),
    percent: (share) => formatPercent(share, opts),
    dateTime: (iso) => formatDateTime(iso, opts),
    day: (d) => formatDay(d, opts),
    ordinal: (n) => ordinal(n, opts),
    digits: (text) => localizeDigits(text, opts),
  };
}

export function messageText(opts: LocaleOptions, code: string | null | undefined, extra?: { attempts_left?: number }): string {
  const key = `error.${code}`;
  const base = translate(opts.locale, key in ERROR_KEYS ? key : 'error.INTERNAL_ERROR', {}, opts.banglaDigits);
  if (extra?.attempts_left !== undefined && (code === 'WRONG_PIN' || code === 'WRONG_OTP')) {
    return `${base} ${translate(opts.locale, 'error.attemptsLeft', { count: extra.attempts_left }, opts.banglaDigits)}`;
  }
  return base;
}

const noop = () => {};
const I18nContext = createContext<I18n>(makeI18n({ locale: 'en', banglaDigits: true }, { setLanguage: noop, setBanglaDigits: noop }));

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { profile, refreshProfile } = useSession();
  const [choice, setChoice] = useState<Partial<LocaleOptions>>({});
  const [saved] = useState(stored);

  const opts: LocaleOptions = {
    locale: choice.locale ?? profile?.language ?? saved.locale ?? 'en',
    banglaDigits: choice.banglaDigits ?? profile?.bangla_digits ?? saved.banglaDigits ?? true,
  };

  const update = useCallback((next: Partial<LocaleOptions>) => {
    setChoice((prev) => {
      const merged = { ...prev, ...next };
      persist({ locale: merged.locale ?? opts.locale, banglaDigits: merged.banglaDigits ?? opts.banglaDigits });
      return merged;
    });
    if (profile) {
      // Saved to the account so other devices follow; a failure keeps the local choice.
      setMyPreferences({ language: next.locale, banglaDigits: next.banglaDigits })
        .then(refreshProfile)
        .catch(() => undefined);
    }
  }, [profile, refreshProfile, opts.locale, opts.banglaDigits]);

  const value = useMemo(
    () => makeI18n(opts, {
      setLanguage: (locale) => update({ locale }),
      setBanglaDigits: (banglaDigits) => update({ banglaDigits }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.locale, opts.banglaDigits, update],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
