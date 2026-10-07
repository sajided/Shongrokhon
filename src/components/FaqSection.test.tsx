import { fireEvent, render, screen } from '@testing-library/react-native';

import { FaqSection } from './FaqSection';

describe('FaqSection component', () => {
  it('renders FAQ questions and toggles answers on press', async () => {
    await render(<FaqSection />);

    // Title should be visible
    expect(screen.getByTestId('faq-section')).toBeTruthy();

    // First item is open by default
    expect(screen.getByTestId('faq-answer-1')).toBeTruthy();
    expect(screen.getByTestId('faq-answer-1')).toHaveTextContent(/intercepting fraudulent transactions/i);

    // Press toggle for item 1 to collapse it
    await fireEvent.press(screen.getByTestId('faq-toggle-1'));
    expect(screen.queryByTestId('faq-answer-1')).toBeNull();

    // Item 2 should initially be closed
    expect(screen.queryByTestId('faq-answer-2')).toBeNull();

    // Press toggle for item 2 to open it
    await fireEvent.press(screen.getByTestId('faq-toggle-2'));
    expect(screen.getByTestId('faq-answer-2')).toBeTruthy();
    expect(screen.getByTestId('faq-answer-2')).toHaveTextContent(/withdrawal velocity/i);
  });

  it('renders properly in landing mode', async () => {
    await render(<FaqSection variant="landing" />);
    expect(screen.getByTestId('faq-section')).toBeTruthy();
    expect(screen.getByTestId('faq-item-1')).toBeTruthy();
  });
});
