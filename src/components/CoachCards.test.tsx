import { fireEvent, render, screen } from '@testing-library/react-native';

import type { AskResponse, CoachDashboard } from '@/lib/api';

import { AskCoach } from './AskCoach';
import { CashDependencyCard, CategoryBreakdown, EmptyState, InsightCards, PeriodFilter, RetryCard, Skeleton } from './CoachCards';

const dashboard = (over: Partial<CoachDashboard> = {}): CoachDashboard => ({
  period: 'MONTH',
  txn_count: 30,
  income: 18000,
  spending: 17200,
  saved: 0,
  net: 800,
  cashout: { total: 14000, count: 11, share: 0.814, level: 'HIGH' },
  categories: [
    { category: 'CASH_OUT', total: 14000, count: 11, share: 0.814 },
    { category: 'FOOD', total: 3200, count: 18, share: 0.186 },
  ],
  merchants: [],
  monthly: [],
  uncategorized: 0,
  ...over,
});

describe('TC-P3-COACH-01/08: category breakdown', () => {
  it('lists each category with amount and share, and reads as text', async () => {
    await render(<CategoryBreakdown categories={dashboard().categories} />);
    expect(screen.getByTestId('category-FOOD')).toHaveTextContent(/Food.*৳3,200\.00 · 19%/);
    expect(screen.getByTestId('category-breakdown').props.accessibilityLabel)
      .toBe('Spending by category: Cash-out ৳14,000.00, 81%; Food ৳3,200.00, 19%');
  });
});

describe('TC-P3-COACH-03: cash dependency', () => {
  it('highlights high cash dependency with a label and explanation', async () => {
    await render(<CashDependencyCard cashout={dashboard().cashout} />);
    expect(screen.getByTestId('cash-level')).toHaveTextContent('⚠ High');
    expect(screen.getByTestId('cash-share')).toHaveTextContent(/81%/);
    expect(screen.getByTestId('cash-dependency')).toHaveTextContent(/11 cash-outs, ৳14,000\.00/);
    expect(screen.getByTestId('cash-dependency')).toHaveTextContent(/paying shops directly by QR/);
  });

  it('low dependency is not highlighted', async () => {
    await render(<CashDependencyCard cashout={{ total: 0, count: 0, share: 0, level: 'LOW' }} />);
    expect(screen.getByTestId('cash-level')).toHaveTextContent('Low');
  });
});

describe('TC-P3-COACH-04: period filter', () => {
  it('marks the selected period and reports changes', async () => {
    const onChange = jest.fn();
    await render(<PeriodFilter value="MONTH" onChange={onChange} />);
    expect(screen.getByTestId('period-MONTH').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('period-3M'));
    expect(onChange).toHaveBeenCalledWith('3M');
  });
});

describe('TC-P3-COACH-05/06: empty, loading and error states', () => {
  it('renders each state', async () => {
    const onRetry = jest.fn();
    await render(
      <>
        <EmptyState title="Nothing to show yet" body="Make a few payments." />
        <Skeleton />
        <RetryCard message="No connection." onRetry={onRetry} testID="err" />
      </>,
    );
    expect(screen.getByTestId('empty-state')).toHaveTextContent(/Nothing to show yet/);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('err-retry'));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('insight cards', () => {
  it('renders the coach text', async () => {
    await render(<InsightCards insights={[{ kind: 'CASH', title: 'Cash-outs are 81% of your spending', body: 'Pay by QR.' }]} />);
    expect(screen.getAllByTestId('insight-card')).toHaveLength(1);
    expect(screen.getByTestId('insight-card')).toHaveTextContent(/Cash-outs are 81%/);
  });
});

describe('TC-P3-LLM-05: ask the coach', () => {
  it('sends the question and shows the answer', async () => {
    const answer: AskResponse = { status: 'OK', topic: 'REGULATED_ADVICE', declined: true,
                                  answer: "I can't recommend specific investments. Build an emergency fund first." };
    const ask = jest.fn(async () => answer);
    await render(<AskCoach ask={ask} />);
    expect(screen.getByTestId('ask-submit').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByTestId('ask-input'), '  Which stock should I buy?  ');
    await fireEvent.press(screen.getByTestId('ask-submit'));
    expect(ask).toHaveBeenCalledWith('Which stock should I buy?');
    expect(await screen.findByTestId('ask-answer')).toHaveTextContent(/can't recommend specific investments/);
  });
});
