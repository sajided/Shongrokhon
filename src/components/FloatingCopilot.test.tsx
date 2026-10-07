import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { FloatingCopilot } from './FloatingCopilot';

describe('FloatingCopilot component', () => {
  it('renders floating action button and toggles chat window open and closed', async () => {
    await render(<FloatingCopilot />);

    const fab = screen.getByTestId('copilot-fab');
    expect(fab).toBeTruthy();

    // Open chat
    await fireEvent.press(fab);
    expect(await screen.findByTestId('copilot-window')).toBeTruthy();
    expect(screen.getByTestId('copilot-welcome')).toBeTruthy();

    // Close chat
    const closeBtn = screen.getByTestId('copilot-close');
    await fireEvent.press(closeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('copilot-window')).toBeNull();
    });
    expect(screen.getByTestId('copilot-fab')).toBeTruthy();
  });

  it('triggers quick prompt and renders response', async () => {
    const mockAsk = jest.fn().mockResolvedValue({
      status: 'OK',
      source: 'MOCK',
      topic: 'BUDGET',
      declined: false,
      answer: 'Cut down dining out to save ৳3,000 this month.',
    });

    await render(<FloatingCopilot initialOpen={true} ask={mockAsk} />);

    expect(await screen.findByTestId('copilot-window')).toBeTruthy();
    const prompt0 = screen.getByTestId('copilot-prompt-0');
    await fireEvent.press(prompt0);

    expect(await screen.findByText(/Cut down dining out to save ৳3,000/i)).toBeTruthy();
    expect(mockAsk).toHaveBeenCalled();
  });

  it('submits typed question and renders chat bubbles with clear action', async () => {
    const mockAsk = jest.fn().mockResolvedValue({
      status: 'OK',
      source: 'MOCK',
      topic: 'CASHOUT',
      declined: false,
      answer: 'Your cash dependency is low at 12%.',
    });

    await render(<FloatingCopilot initialOpen={true} ask={mockAsk} />);

    const input = await screen.findByTestId('copilot-input');
    await fireEvent.changeText(input, 'What is my cash dependency?');

    const send = screen.getByTestId('copilot-send');
    await fireEvent.press(send);

    expect(await screen.findByText(/Your cash dependency is low at 12%/i)).toBeTruthy();
    expect(mockAsk).toHaveBeenCalledWith('What is my cash dependency?', 'en');

    // Test clear chat
    const clearBtn = screen.getByTestId('copilot-clear');
    await fireEvent.press(clearBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Your cash dependency is low at 12%/i)).toBeNull();
    });
    expect(screen.getByTestId('copilot-welcome')).toBeTruthy();
  });
});
