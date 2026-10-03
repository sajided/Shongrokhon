import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Notice } from '@/lib/api';

import { makeI18n } from '@/i18n/LocaleProvider';

import { NotificationBanner, noticeText } from './NotificationBanner';

const notice = (over: Partial<Notice> = {}): Notice => ({
  id: 'n1',
  kind: 'PAYMENT_FLAGGED',
  title: 'Payment under review',
  body: 'Your payment of ৳10,000.00 to Quick Mart went through and has been flagged for a routine review.',
  data: { transaction_id: 't1', amount: 10000, merchant_name: 'Quick Mart' },
  created_at: '2026-10-02T10:00:00Z',
  read_at: null,
  ...over,
});

describe('TC-P2-FLOW-02: flagged-payment notice', () => {
  it('shows unread notices and dismisses them', async () => {
    const onDismiss = jest.fn();
    await render(<NotificationBanner notices={[notice()]} onDismiss={onDismiss} />);
    expect(screen.getByTestId('notice')).toHaveTextContent(/Payment under review/);
    expect(screen.getByTestId('notice-body')).toHaveTextContent(/৳10,000\.00 to Quick Mart/);
    await fireEvent.press(screen.getByTestId('notice-dismiss'));
    expect(onDismiss).toHaveBeenCalledWith('n1');
  });

  it('renders nothing when every notice is read', async () => {
    await render(<NotificationBanner notices={[notice({ read_at: '2026-10-02T11:00:00Z' })]} onDismiss={jest.fn()} />);
    expect(screen.queryByTestId('notice')).toBeNull();
  });
});

describe('TC-P4-L10N-01: notices follow the selected language', () => {
  const noop = { setLanguage: () => {}, setBanglaDigits: () => {} };

  it('renders the notice in Bangla from kind + data, with Bangla digits', () => {
    const bn = makeI18n({ locale: 'bn', banglaDigits: true }, noop);
    expect(noticeText(notice(), bn)).toEqual({
      title: 'পেমেন্টটি যাচাই করা হচ্ছে',
      body: expect.stringContaining('Quick Mart-কে আপনার ৳১০,০০০.০০ পেমেন্ট'),
    });
  });

  it('falls back to the server text for an unknown kind', () => {
    const en = makeI18n({ locale: 'en', banglaDigits: false }, noop);
    expect(noticeText(notice({ kind: 'SOMETHING_NEW', title: 'T', body: 'B' }), en)).toEqual({ title: 'T', body: 'B' });
  });

  it('renders transfer and flow notices', () => {
    const en = makeI18n({ locale: 'en', banglaDigits: false }, noop);
    expect(noticeText(notice({ kind: 'TRANSFER_RECEIVED', data: { amount: 750, from: '*********0001' } }), en).body)
      .toBe('You received ৳750.00 from *********0001.');
    expect(noticeText(notice({ kind: 'FLOW_FLAGGED', data: { amount: 500, flow: 'CASHOUT' } }), en).body)
      .toMatch(/^Your cash-out went through/);
  });
});
