import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { DemoTour } from './DemoTour';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false) } }));

describe('Product tour on the sign-in page', () => {
  it('walks through every screen with mock data and no backend calls', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await render(<DemoTour />);
    expect(screen.getByTestId('demo-title')).toHaveTextContent(/Your wallet at a glance/);
    expect(screen.getByTestId('demo-screen-home')).toHaveTextContent(/৳5,000\.00/);

    const screens = ['pay', 'check', 'cashout', 'coach', 'plan'];
    for (const name of screens) {
      await fireEvent.press(screen.getByTestId('demo-next'));
      expect(screen.getByTestId(`demo-screen-${name}`)).toBeTruthy();
    }
    expect(screen.getByTestId('demo-next')).toHaveTextContent(/Create your account/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('shows the cash-out warning with "Don\'t pay" as the main choice', async () => {
    await render(<DemoTour />);
    await fireEvent.press(screen.getByTestId('demo-dot-4'));
    const warning = screen.getByTestId('demo-screen-cashout');
    expect(warning).toHaveTextContent(/Don't pay: this looks like a cash-out/);
    expect(warning).toHaveTextContent(/Nothing has been charged yet/);
  });

  it('goes back and finishes on the sign-in page', async () => {
    await render(<DemoTour />);
    await fireEvent.press(screen.getByTestId('demo-dot-6'));
    await fireEvent.press(screen.getByTestId('demo-prev'));
    expect(screen.getByTestId('demo-screen-coach')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('demo-dot-6'));
    await fireEvent.press(screen.getByTestId('demo-next'));
    expect(router.replace).toHaveBeenCalledWith('/sign-in');
  });
});
