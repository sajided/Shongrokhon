import { fireEvent, render, screen } from '@testing-library/react-native';

import { makeI18n } from '@/i18n/LocaleProvider';

import { Interception } from './Interception';

describe('TC-P4-SSC-03: interception content', () => {
  it('shows which cash-out this is, the fee, and three digital alternatives', async () => {
    const onChoose = jest.fn();
    await render(<Interception nth={5} amount={2000} fee={37} onChoose={onChoose} />);
    expect(screen.getByTestId('interception-count')).toHaveTextContent('This would be your 5th cash-out in the last 30 days.');
    expect(screen.getByTestId('interception-fee')).toHaveTextContent(/Cashing out ৳2,000.00 costs a ৳37.00 fee/);
    for (const choice of ['PAY_QR', 'BILL_PAY', 'SEND_MONEY', 'CONTINUE', 'CANCEL']) {
      await fireEvent.press(screen.getByTestId(`nudge-${choice}`));
      expect(onChoose).toHaveBeenLastCalledWith(choice);
    }
  });
});

describe('TC-P4-L10N: Bangla interception text', () => {
  it('uses Bangla ordinals and digits', () => {
    const bn = makeI18n({ locale: 'bn', banglaDigits: true }, { setLanguage: () => {}, setBanglaDigits: () => {} });
    expect(bn.t('nudge.body', { ordinal: bn.ordinal(5) })).toBe('গত ৩০ দিনে এটি হবে আপনার ৫ম ক্যাশ আউট।');
    expect(bn.t('nudge.fee', { amount: bn.money(2000), fee: bn.money(37) })).toMatch(/^৳২,০০০.০০ ক্যাশ আউট করলে ৳৩৭.০০ চার্জ কাটবে/);
  });
});
