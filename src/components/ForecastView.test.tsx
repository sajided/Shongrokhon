import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Forecast } from '@/lib/forecast';

import { ForecastChart, LowBalanceWarning, LowConfidenceNote, RecurringList } from './ForecastView';

const days = (balances: number[]) =>
  balances.map((balance, i) => ({
    date: new Date(Date.UTC(2026, 9, 4 + i)).toISOString().slice(0, 10), balance, events: [],
  }));

const base = (over: Partial<Forecast> = {}): Forecast => ({
  days: days(Array.from({ length: 30 }, (_, i) => 10000 - i * 400)),
  recurring: [
    { key: 'rent', name: 'Green Homes Rent', direction: 'OUT', category: 'BILLS', amount: 9500, intervalDays: 30, nextDue: '2026-10-13', occurrences: 3 },
    { key: 'INCOME', name: 'Income', direction: 'IN', category: 'INCOME', amount: 15000, intervalDays: 30, nextDue: '2026-10-18', occurrences: 3 },
  ],
  dailySpend: 65,
  historyDays: 170,
  lowConfidence: false,
  minBalance: -1600,
  minDate: '2026-11-02',
  shortfall: 1600,
  warning: null,
  ...over,
});

describe('TC-P3-FCST-01: forecast chart', () => {
  it('shows 30 days by default and switches to 7', async () => {
    await render(<ForecastChart forecast={base()} />);
    expect(screen.getByTestId('forecast-end')).toHaveTextContent('-৳1,600.00 expected on 2 Nov');
    await fireEvent.press(screen.getByTestId('horizon-7'));
    expect(screen.getByTestId('forecast-end')).toHaveTextContent('৳7,600.00 expected on 10 Oct');
    expect(screen.getByTestId('forecast-plot').props.accessibilityLabel)
      .toBe('Projected balance for the next 7 days: ৳7,600.00 on 10 Oct. Lowest ৳7,600.00 on 10 Oct.');
  });

  it('TC-P3-FCST-06: a shortfall renders as text and does not break the chart', async () => {
    await render(<ForecastChart forecast={base()} />);
    expect(screen.getByTestId('forecast-shortfall')).toHaveTextContent('Shortfall: up to ৳1,600.00 below zero');
  });

  it('copes with a flat zero forecast', async () => {
    await render(<ForecastChart forecast={base({ days: days(Array(30).fill(0)), shortfall: 0 })} />);
    expect(screen.queryByTestId('forecast-shortfall')).toBeNull();
  });
});

describe('TC-P3-FCST-02: low-balance warning', () => {
  it('names the date, the bill and an action', async () => {
    await render(<LowBalanceWarning warning={{ date: '2026-10-13', balance: -300, threshold: 500,
      cause: { name: 'Green Homes Rent', amount: 9500 }, topUp: 1060, dailyCut: 80 }} />);
    expect(screen.getByTestId('low-balance-warning')).toHaveTextContent(/Low balance expected on 13 Oct/);
    expect(screen.getByTestId('low-balance-warning')).toHaveTextContent(/Green Homes Rent \(৳9,500.00\) is due/);
    expect(screen.getByTestId('warning-action')).toHaveTextContent(/add ৳1,060.00 before then, or spend about ৳80.00 less/);
  });
});

describe('TC-P3-FCST-04/05: recurring items and low confidence', () => {
  it('lists upcoming income and bills', async () => {
    await render(<RecurringList forecast={base()} />);
    const items = screen.getAllByTestId('recurring-item');
    expect(items[0]).toHaveTextContent(/Green Homes Rent · 13 Oct.*−৳9,500\.00/);
    expect(items[1]).toHaveTextContent(/Income · 18 Oct.*\+৳15,000\.00/);
  });

  it('explains a low-confidence forecast', async () => {
    await render(<LowConfidenceNote days={12} />);
    expect(screen.getByTestId('forecast-low-confidence')).toHaveTextContent(/only have 12 days/);
  });
});
