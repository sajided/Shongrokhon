import type { TransactionRow } from './api';

/** ৳ with South Asian digit grouping, e.g. 125000 -> ৳1,25,000.00 */
export function formatTaka(amount: number): string {
  const negative = amount < 0;
  const [whole, fraction] = Math.abs(amount).toFixed(2).split('.');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
  return `${negative ? '-' : ''}৳${grouped}.${fraction}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function receiptText(t: TransactionRow): string {
  return [
    'Shongrokhon payment receipt',
    `Transaction ID: ${t.id}`,
    `Amount: ${formatTaka(Number(t.amount))}`,
    `${t.direction === 'OUT' ? 'Paid to' : 'Received from'}: ${t.counterparty_name ?? '—'}${t.counterparty_ref ? ` (${t.counterparty_ref})` : ''}`,
    `Date: ${formatDateTime(t.created_at)}`,
    `Status: ${t.status}`,
  ].join('\n');
}
