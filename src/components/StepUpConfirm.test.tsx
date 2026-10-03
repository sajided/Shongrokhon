import { fireEvent, render, screen } from '@testing-library/react-native';

import { StepUpConfirm } from './StepUpConfirm';

const base = { merchantName: 'Karim Pharmacy', amount: 4200, busy: false, serverError: null };

describe('TC-P2-FLOW-03: step-up confirmation', () => {
  it('asks the user to confirm the amount and merchant with their PIN', async () => {
    const onConfirm = jest.fn();
    await render(<StepUpConfirm {...base} onConfirm={onConfirm} onCancel={jest.fn()} />);
    expect(screen.getByTestId('step-up')).toHaveTextContent(/Confirm this payment/);
    expect(screen.getByTestId('step-up-amount')).toHaveTextContent('৳4,200.00');
    expect(screen.getByTestId('step-up')).toHaveTextContent(/Karim Pharmacy/);

    await fireEvent.changeText(screen.getByTestId('step-up-pin'), '12345');
    await fireEvent.press(screen.getByTestId('step-up-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('12345');
  });

  it('does not confirm without a valid PIN', async () => {
    const onConfirm = jest.fn();
    await render(<StepUpConfirm {...base} onConfirm={onConfirm} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('step-up-pin'), '12');
    await fireEvent.press(screen.getByTestId('step-up-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('error-banner')).toHaveTextContent(/4 or 5 digits/);
  });

  it('warns the user about scams before they confirm', async () => {
    await render(<StepUpConfirm {...base} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    const warning = screen.getByTestId('step-up-warning');
    expect(warning).toHaveTextContent(/Stop and check/);
    expect(warning).toHaveTextContent(/never calls or messages you to ask for your PIN/);
    expect(warning).toHaveTextContent(/Nothing has been charged yet/);
  });

  it('tells the user not to pay a merchant that looks like a cash-out point', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await render(<StepUpConfirm {...base} warning="CASHOUT_MERCHANT" onConfirm={onConfirm} onCancel={onCancel} />);
    const warning = screen.getByTestId('step-up-cashout-warning');
    expect(warning).toHaveTextContent(/Don't pay: this looks like a cash-out/);
    expect(warning).toHaveTextContent(/Karim Pharmacy usually withdraws money as cash/);
    expect(warning).toHaveTextContent(/Nothing has been charged yet/);
    expect(screen.queryByTestId('step-up-warning')).toBeNull();
    expect(screen.getByTestId('step-up-cancel')).toHaveTextContent("Don't pay");
    expect(screen.getByTestId('step-up-confirm')).toHaveTextContent('Pay anyway');

    await fireEvent.press(screen.getByTestId('step-up-cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('still needs the PIN to pay anyway after the cash-out warning', async () => {
    const onConfirm = jest.fn();
    await render(<StepUpConfirm {...base} warning="CASHOUT_MERCHANT" onConfirm={onConfirm} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('step-up-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('step-up-pin'), '12345');
    await fireEvent.press(screen.getByTestId('step-up-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('12345');
  });

  it('never says why the payment is being checked', async () => {
    await render(<StepUpConfirm {...base} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByTestId('step-up')).not.toHaveTextContent(/risk|fraud|suspicious|flag|score|unusual/i);
  });

  it('shows server errors and lets the user cancel', async () => {
    const onCancel = jest.fn();
    await render(<StepUpConfirm {...base} serverError="Wrong PIN. 2 attempts left." onConfirm={jest.fn()} onCancel={onCancel} />);
    expect(screen.getByTestId('error-banner')).toHaveTextContent('Wrong PIN. 2 attempts left.');
    await fireEvent.press(screen.getByTestId('step-up-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables the buttons while confirming (no double submit)', async () => {
    await render(<StepUpConfirm {...base} busy onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByTestId('step-up-confirm')).toBeDisabled();
    expect(screen.getByTestId('step-up-cancel')).toBeDisabled();
  });
});
