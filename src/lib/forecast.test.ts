import { detectRecurring, forecast, type CashHistory, type CashRow } from './forecast';

const AS_OF = '2026-10-03T06:00:00Z'; // noon in Dhaka
const DAY = 86400000;
const ago = (days: number, hour = 6) => new Date(Date.parse('2026-10-03T00:00:00Z') - days * DAY + hour * 3600000).toISOString();

const row = (over: Partial<CashRow>): CashRow => ({
  at: ago(1), kind: 'SPEND', category: 'FOOD', amount: 100, key: 'shop', name: 'Shop', ...over,
});

/** U-TIGHT's shape: salary 15 days ago, rent due in 10 days, ৳65 a day of shopping. */
function tight(): CashHistory {
  const rows: CashRow[] = [];
  for (const k of [0, 1, 2]) {
    rows.push(row({ at: ago(15 + 30 * k), kind: 'INCOME', category: 'INCOME', amount: 15000, key: 'INCOME', name: null }));
    rows.push(row({ at: ago(20 + 30 * k), category: 'BILLS', amount: 9500, key: 'rent', name: 'Green Homes Rent' }));
    rows.push(row({ at: ago(25 + 30 * k), category: 'UTILITIES', amount: 480 + 20 * k, key: 'desco', name: 'DESCO' }));
  }
  for (let d = 1; d <= 89; d++) rows.push(row({ at: ago(d, 8), amount: 65 }));
  return { as_of: AS_OF, balance: 10350, low_balance: 500, first_txn_at: ago(170), rows };
}

describe('TC-P3-FCST-04: recurring payment detection', () => {
  it('finds salary, rent and the monthly bill, not daily shopping', () => {
    const today = Math.floor((Date.parse(AS_OF) + 6 * 3600000) / DAY);
    const { items } = detectRecurring(tight().rows, today);
    expect(items.map((i) => [i.name, i.direction, i.amount, i.nextDue])).toEqual(expect.arrayContaining([
      ['Income', 'IN', 15000, '2026-10-18'],
      ['Green Homes Rent', 'OUT', 9500, '2026-10-13'],
      ['DESCO', 'OUT', 500, '2026-10-08'],
    ]));
    expect(items).toHaveLength(3);
  });

  it('a one-off cash-in does not hide the salary', () => {
    const rows = tight().rows.concat(row({ at: ago(0, 3), kind: 'INCOME', category: 'INCOME', amount: 5000, key: 'INCOME', name: null }));
    const { items } = detectRecurring(rows, 20729);
    expect(items.find((i) => i.name === 'Income')).toMatchObject({ amount: 15000, occurrences: 3 });
  });

  it('ignores irregular amounts and too few occurrences', () => {
    const rows = [0, 1, 2].map((k) => row({ at: ago(30 * k + 1), amount: [100, 900, 3000][k], key: 'x' }))
      .concat([0, 1].map((k) => row({ at: ago(30 * k + 2), amount: 500, key: 'y' })));
    expect(detectRecurring(rows, 20729).items).toEqual([]);
  });
});

describe('TC-P3-FCST-01/02: projection and liquidity warning', () => {
  it('warns about the low balance on the rent date with an action', () => {
    const f = forecast(tight());
    expect(f.days).toHaveLength(30);
    expect(f.dailySpend).toBe(65);
    expect(f.warning).toMatchObject({
      date: '2026-10-13', threshold: 500, cause: { name: 'Green Homes Rent', amount: 9500 },
    });
    // 10,350 - 10 x 65 - 500 - 9,500 = -300 on the rent day.
    expect(f.warning!.balance).toBe(-300);
    expect(f.warning!.dailyCut).toBe(80);
    // Lowest point the day before the salary: -300 - 4 x 65 = -560, so top up ৳1,060.
    expect(f.minBalance).toBe(-560);
    expect(f.warning!.topUp).toBe(1060);
    expect(f.days.find((d) => d.date === '2026-10-18')!.events).toEqual([{ name: 'Income', amount: 15000 }]);
  });

  it('TC-P3-FCST-06: reports the shortfall when spending exceeds the balance', () => {
    expect(forecast(tight()).shortfall).toBe(560);
  });

  it('no warning when the balance stays healthy', () => {
    const f = forecast({ ...tight(), balance: 20000 });
    expect(f.warning).toBeNull();
    expect(f.shortfall).toBe(0);
  });
});

describe('TC-P3-FCST-05: insufficient history', () => {
  it('is low confidence with under 30 days of data', () => {
    const f = forecast({ as_of: AS_OF, balance: 1000, low_balance: 500, first_txn_at: ago(12),
                         rows: [row({ at: ago(3), amount: 120 })] });
    expect(f.lowConfidence).toBe(true);
    expect(f.historyDays).toBe(12);
  });

  it('copes with no history at all', () => {
    const f = forecast({ as_of: AS_OF, balance: 0, low_balance: 500, first_txn_at: null, rows: [] });
    expect(f.lowConfidence).toBe(true);
    expect(f.dailySpend).toBe(0);
    expect(f.warning).toMatchObject({ date: '2026-10-04', balance: 0, topUp: 500 });
  });
});
