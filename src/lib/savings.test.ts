import { checkCommitment, monthsElapsed, planGoal, progress, stillNeededMonthly } from './savings';

describe('TC-P3-SAVE-01: PRD example, ৳30,000 in 6 months', () => {
  it('needs ৳5,000 a month and fits a ৳8,000 surplus', () => {
    expect(planGoal(30000, 6, 8000)).toEqual({ monthly: 5000, status: 'ACHIEVABLE', shareOfSurplus: 0.625, alternatives: null });
  });
});

describe('TC-P3-SAVE-02: plan is based on history', () => {
  it('flags ৳5,000/month as unrealistic on a ৳3,000 surplus and suggests alternatives', () => {
    const plan = planGoal(30000, 6, 3000);
    expect(plan.status).toBe('UNREALISTIC');
    // 80% of ৳3,000 = ৳2,400 a month: 13 months, or ৳14,400 in 6 months.
    expect(plan.alternatives).toEqual({ months: 13, target: 14400 });
  });

  it('marks a plan that needs 80-100% of the surplus as tight', () => {
    expect(planGoal(27000, 6, 5000).status).toBe('TIGHT');
  });
});

describe('TC-P3-SAVE-04: very short timeline', () => {
  it('৳30,000 in 1 month on a low income is not achievable', () => {
    const plan = planGoal(30000, 1, 2000);
    expect(plan.status).toBe('UNREALISTIC');
    expect(plan.alternatives).toEqual({ months: 19, target: 1600 });
  });

  it('no alternative timeline beyond 60 months; no surplus at all', () => {
    expect(planGoal(1000000, 12, 1000).alternatives?.months).toBeNull();
    expect(planGoal(30000, 6, -500)).toMatchObject({ status: 'UNREALISTIC', alternatives: { months: null, target: 0 } });
  });

  it('UNKNOWN without 30 days of history', () => {
    expect(planGoal(30000, 6, null)).toMatchObject({ monthly: 5000, status: 'UNKNOWN' });
  });
});

describe('TC-P3-SAVE-05: progress tracking', () => {
  const goal = { target_amount: 30000, months: 6, start_date: '2026-08-15', saved: 9500 };

  it('progress and what is still needed per month', () => {
    expect(progress(goal)).toBeCloseTo(0.3167, 3);
    expect(monthsElapsed('2026-08-15', new Date(2026, 9, 20))).toBe(2);
    expect(monthsElapsed('2026-08-15', new Date(2026, 9, 10))).toBe(1);
    // ৳20,500 left over the 4 remaining months.
    expect(stillNeededMonthly(goal, new Date(2026, 9, 20))).toBe(5125);
    expect(progress({ ...goal, saved: 40000 })).toBe(1);
  });

  it('a goal past its end date needs the rest in one month', () => {
    expect(stillNeededMonthly(goal, new Date(2027, 5, 1))).toBe(20500);
  });
});

describe('TC-P3-SAVE-07: multiple goals', () => {
  it('warns when goals together need more than the surplus', () => {
    const today = new Date(2026, 9, 3);
    const g = (target: number) => ({ target_amount: target, months: 6, start_date: '2026-10-03', saved: 0 });
    expect(checkCommitment([g(12000), g(12000)], 5000, today)).toEqual({ total: 4000, overCommitted: false });
    expect(checkCommitment([g(12000), g(12000), g(12000)], 5000, today)).toEqual({ total: 6000, overCommitted: true });
  });
});
