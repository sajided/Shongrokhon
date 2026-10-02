import { fireEvent, render, screen } from '@testing-library/react-native';

import { PayForm } from './PayForm';

const base = { merchantName: 'Rahim Store', merchantId: 'MLEGIT0001', busy: false, serverError: null };

describe('TC-P1-QR-03: static QR', () => {
  it('shows merchant name and ID with an empty, editable amount', async () => {
    await render(<PayForm {...base} fixedAmount={null} onSubmit={jest.fn()} />);
    expect(screen.getByTestId('merchant-name')).toHaveTextContent('Rahim Store');
    expect(screen.getByTestId('merchant-id')).toHaveTextContent('Merchant ID MLEGIT0001');
    const amount = screen.getByTestId('amount-input');
    expect(amount.props.value).toBe('');
    expect(amount.props.editable).toBe(true);
  });
});

describe('TC-P1-QR-04: dynamic QR', () => {
  it('pre-fills the amount and makes it read-only', async () => {
    const onSubmit = jest.fn();
    await render(<PayForm {...base} fixedAmount={250} onSubmit={onSubmit} />);
    const amount = screen.getByTestId('amount-input');
    expect(amount.props.value).toBe('250.00');
    expect(amount.props.editable).toBe(false);
    expect(screen.getByTestId('fixed-amount-note')).toHaveTextContent(/৳250\.00/);

    await fireEvent.changeText(screen.getByTestId('pin-input'), '12345');
    await fireEvent.press(screen.getByTestId('pay-button'));
    expect(onSubmit).toHaveBeenCalledWith({ amount: 250, pin: '12345' });
  });
});

describe('TC-P1-PAY-06: amount validation before submit', () => {
  it.each([
    ['0', 'Enter an amount greater than zero.'],
    ['-5', 'Enter an amount greater than zero.'],
    ['10.123', 'Amounts can have at most 2 decimal places.'],
    ['30000', 'This amount is above the per-transaction limit.'],
  ])('rejects %p with a specific message', async (input, message) => {
    const onSubmit = jest.fn();
    await render(<PayForm {...base} fixedAmount={null} onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByTestId('amount-input'), input);
    await fireEvent.changeText(screen.getByTestId('pin-input'), '12345');
    await fireEvent.press(screen.getByTestId('pay-button'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('error-banner')).toHaveTextContent(message);
  });

  it('submits a valid amount and PIN', async () => {
    const onSubmit = jest.fn();
    await render(<PayForm {...base} fixedAmount={null} onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByTestId('amount-input'), '500');
    await fireEvent.changeText(screen.getByTestId('pin-input'), '12345');
    await fireEvent.press(screen.getByTestId('pay-button'));
    expect(onSubmit).toHaveBeenCalledWith({ amount: 500, pin: '12345' });
  });
});

describe('TC-P1-PAY-07: double tap', () => {
  it('disables the Pay button while a payment is in flight', async () => {
    await render(<PayForm {...base} fixedAmount={null} busy onSubmit={jest.fn()} />);
    expect(screen.getByTestId('pay-button')).toBeDisabled();
  });
});

describe('server errors', () => {
  it('shows the server message', async () => {
    await render(<PayForm {...base} fixedAmount={null} serverError="Wrong PIN. 2 attempts left." onSubmit={jest.fn()} />);
    expect(screen.getByTestId('error-banner')).toHaveTextContent('Wrong PIN. 2 attempts left.');
  });
});
