// Personal Savings Planner (PRD §4.2, TC-P3-SAVE-*). Pure: the monthly surplus
// comes from get_savings_goals (private.monthly_surplus: average income minus
// spending over the last 90 days, money moved to savings not counted as spending).

/** A plan is comfortable while it needs at most this share of the monthly surplus. */
export const COMFORTABLE_SHARE = 0.8;

export type PlanStatus = 'ACHIEVABLE' | 'TIGHT' | 'UNREALISTIC' | 'UNKNOWN';

export interface GoalPlan {
  /** What the goal needs each month, whole taka rounded up. */
  monthly: number;
  status: PlanStatus;
  /** monthly / surplus, or null without a surplus figure. */
  shareOfSurplus: number | null;
  /** Shown when the plan is not achievable as asked (TC-P3-SAVE-02/04). */
  alternatives: { months: number | null; target: number } | null;
}

export function planGoal(target: number, months: number, surplus: number | null): GoalPlan {
  const monthly = Math.ceil(target / months);
  if (surplus === null) return { monthly, status: 'UNKNOWN', shareOfSurplus: null, alternatives: null };
  if (surplus <= 0) {
    return { monthly, status: 'UNREALISTIC', shareOfSurplus: null, alternatives: { months: null, target: 0 } };
  }
  const share = monthly / surplus;
  const status: PlanStatus = share <= COMFORTABLE_SHARE ? 'ACHIEVABLE' : share <= 1 ? 'TIGHT' : 'UNREALISTIC';
  if (status === 'ACHIEVABLE') return { monthly, status, shareOfSurplus: share, alternatives: null };
  const comfortable = surplus * COMFORTABLE_SHARE;
  const neededMonths = Math.ceil(target / comfortable);
  return {
    monthly,
    status,
    shareOfSurplus: share,
    alternatives: {
      months: neededMonths <= 60 ? neededMonths : null,
      target: Math.floor((comfortable * months) / 100) * 100,
    },
  };
}

export interface GoalProgress {
  target_amount: number;
  months: number;
  start_date: string; // YYYY-MM-DD
  saved: number;
}

/** Whole months since the goal started, at least 0. */
export function monthsElapsed(startDate: string, today: Date): number {
  const [y, m, d] = startDate.split('-').map(Number);
  const months = (today.getFullYear() - y) * 12 + (today.getMonth() + 1 - m) - (today.getDate() < d ? 1 : 0);
  return Math.max(0, months);
}

/** What a goal still needs per month, given what is saved and the months left (TC-P3-SAVE-05). */
export function stillNeededMonthly(goal: GoalProgress, today: Date): number {
  const remaining = Math.max(goal.target_amount - goal.saved, 0);
  const left = Math.max(goal.months - monthsElapsed(goal.start_date, today), 1);
  return Math.ceil(remaining / left);
}

/** TC-P3-SAVE-07: all goals together against the surplus. */
export function checkCommitment(goals: GoalProgress[], surplus: number | null, today: Date) {
  const total = goals.reduce((sum, g) => sum + stillNeededMonthly(g, today), 0);
  return { total, overCommitted: surplus !== null && total > surplus };
}

export function progress(goal: GoalProgress): number {
  return goal.target_amount > 0 ? Math.min(goal.saved / goal.target_amount, 1) : 0;
}
