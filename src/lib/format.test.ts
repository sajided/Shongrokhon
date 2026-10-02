import { formatTaka, receiptText } from './format';

describe('formatTaka', () => {
  it.each([
    [0, '৳0.00'],
    [500, '৳500.00'],
    [4500, '৳4,500.00'],
    [125000, '৳1,25,000.00'],
    [12345678.9, '৳1,23,45,678.90'],
  ])('%p -> %s', (amount, expected) => {
    expect(formatTaka(amount)).toBe(expected);
  });
});

describe('TC-P1-PAY-13: receipt text', () => {
  it('includes ID, amount, merchant and date', () => {
    const text = receiptText({
      id: 'txn-123',
      type: 'PAYMENT',
      status: 'SUCCESS',
      flagged: false,
      direction: 'OUT',
      amount: 500,
      counterparty_name: 'Rahim Store',
      counterparty_ref: 'MLEGIT0001',
      note: null,
      created_at: '2026-10-02T10:00:00Z',
    });
    expect(text).toContain('txn-123');
    expect(text).toContain('৳500.00');
    expect(text).toContain('Rahim Store (MLEGIT0001)');
    expect(text).toMatch(/Date: 2026-10-02 \d{2}:\d{2}/);
  });
});
