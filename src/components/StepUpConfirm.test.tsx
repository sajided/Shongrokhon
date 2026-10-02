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

  it('never says why the payment is being checked', async () => {
    await render(<StepUpConfirm {...base} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByTestId('step-up')).not.toHaveTextContent(/risk|fraud|suspicious|cash-?out/i);
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
