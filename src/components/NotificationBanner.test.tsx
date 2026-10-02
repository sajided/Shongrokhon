import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Notice } from '@/lib/api';

import { NotificationBanner } from './NotificationBanner';

const notice = (over: Partial<Notice> = {}): Notice => ({
  id: 'n1',
  kind: 'PAYMENT_FLAGGED',
  title: 'Payment under review',
  body: 'Your payment of ৳10,000.00 to Quick Mart went through and has been flagged for a routine review.',
  data: {},
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
