import { fireEvent, render, screen } from '@testing-library/react-native';

import { PinSetupForm } from './PinSetupForm';

async function fill(pin: string, confirm: string) {
  await fireEvent.changeText(screen.getByTestId('pin-new'), pin);
  await fireEvent.changeText(screen.getByTestId('pin-confirm'), confirm);
  await fireEvent.press(screen.getByTestId('pin-save'));
}

describe('TC-P1-AUTH-07: PIN setup', () => {
  it('rejects a mismatched confirmation', async () => {
    const onSubmit = jest.fn();
    await render(<PinSetupForm onSubmit={onSubmit} busy={false} serverError={null} />);
    await fill('12345', '12346');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('error-banner')).toHaveTextContent('The PINs do not match.');
  });

  it('rejects PINs that are not 4-5 digits', async () => {
    const onSubmit = jest.fn();
    await render(<PinSetupForm onSubmit={onSubmit} busy={false} serverError={null} />);
    await fill('123', '123');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('error-banner')).toHaveTextContent('PIN must be 4 or 5 digits.');
  });

  it('strips non-digits and hides the PIN', async () => {
    await render(<PinSetupForm onSubmit={jest.fn()} busy={false} serverError={null} />);
    await fireEvent.changeText(screen.getByTestId('pin-new'), '12a4');
    expect(screen.getByTestId('pin-new').props.value).toBe('124');
    expect(screen.getByTestId('pin-new').props.secureTextEntry).toBe(true);
  });

  it('submits a matching PIN', async () => {
    const onSubmit = jest.fn();
    await render(<PinSetupForm onSubmit={onSubmit} busy={false} serverError={null} />);
    await fill('2468', '2468');
    expect(onSubmit).toHaveBeenCalledWith('2468');
  });
});
