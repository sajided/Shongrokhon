import { formatDateTime as localDateTime, formatMoney, translate, type LocaleOptions } from '@/i18n/translate';

import type { TransactionRow } from './api';

const EN: LocaleOptions = { locale: 'en', banglaDigits: false };

/** ৳ with South Asian digit grouping, e.g. 125000 -> ৳1,25,000.00 (English digits; see useI18n().money). */
export function formatTaka(amount: number, opts: LocaleOptions = EN): string {
  return formatMoney(amount, opts);
}

export function formatDateTime(iso: string, opts: LocaleOptions = EN): string {
  return localDateTime(iso, opts);
}

export function receiptText(t: TransactionRow, opts: LocaleOptions = EN): string {
  const tr = (key: Parameters<typeof translate>[1]) => translate(opts.locale, key, {}, opts.banglaDigits);
  return [
    tr('receipt.text.title'),
    `${tr('receipt.id')}: ${t.id}`,
    `${tr('receipt.text.amount')}: ${formatTaka(Number(t.amount), opts)}`,
    `${tr(t.direction === 'OUT' ? 'receipt.paidTo' : 'receipt.receivedFrom')}: ${t.counterparty_name ?? '—'}${t.counterparty_ref ? ` (${t.counterparty_ref})` : ''}`,
    `${tr('receipt.text.date')}: ${formatDateTime(t.created_at, opts)}`,
    `${tr('receipt.text.status')}: ${tr(`status.${t.status}` as never)}`,
  ].join('\n');
}
