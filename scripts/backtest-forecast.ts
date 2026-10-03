// TC-P3-FCST-03: backtest src/lib/forecast.ts on 50 synthetic users.
//
//   npx tsx scripts/backtest-forecast.ts
//
// Each user gets 150 days of history from a seeded generator: a monthly salary,
// rent and a utility bill, everyday spending with noise, one-off purchases, and
// (for a third of them) frequent cash-outs. The forecast runs on day 120 with
// days 1-120 only; days 121-150 are held out. A wallet cannot go below zero, so
// payments that do not fit are skipped, as they would be in the app.
//
// Error is measured against monthly income, because balances near zero make a
// plain percentage error meaningless. Gates (both must hold):
//   - median day-30 balance error <= 15% of monthly income (the typical user);
//   - over the 30-day path (mean daily error), the forecast beats a naive
//     "balance stays where it is" forecast by >= 30%. On day 30 alone a monthly
//     salary/rent cycle brings the balance back near its start, so the naive
//     guess looks good there; the path is what the forecast is for (the dip).
// The mean day-30 error is reported too: random one-off purchases inside the
// 30 days are unpredictable and dominate it. Writes reports/phase3-forecast.json.
// Synthetic data: this validates the method, not real-world accuracy.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { forecast, type CashRow } from '../src/lib/forecast';

const USERS = 50;
const HISTORY_DAYS = 150;
const CUTOFF = 120;
const GATE_MEDIAN_NMAE_DAY30 = 0.15;
const GATE_SKILL_VS_NAIVE = 0.3;
const DAY = 86400000;
const START = Date.UTC(2026, 3, 1); // day 0, midnight UTC (06:00 Dhaka)

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface User {
  rows: CashRow[];
  balanceAt: number[]; // closing balance per day
  income: number;
}

function simulate(seed: number): User {
  const r = rng(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const income = Math.round(between(12000, 40000) / 500) * 500;
  const rent = Math.round(between(0.2, 0.4) * income / 50) * 50;
  const salaryDay = Math.floor(between(0, 28));
  const rentDay = (salaryDay + Math.floor(between(1, 10))) % 30;
  const billDay = (salaryDay + Math.floor(between(8, 20))) % 30;
  const cashHeavy = seed % 3 === 0;
  const daily = (income - rent) * between(0.55, 0.95) / 30 * (cashHeavy ? 0.4 : 1);
  let balance = Math.round(between(500, 6000));
  const rows: CashRow[] = [];
  const balanceAt: number[] = [];

  const post = (day: number, kind: CashRow['kind'], key: string, name: string | null, amount: number, hour: number) => {
    amount = Math.round(amount);
    if (amount <= 0) return;
    if (kind !== 'INCOME') {
      if (amount > balance) return; // the wallet cannot go negative
      balance -= amount;
    } else {
      balance += amount;
    }
    rows.push({ at: new Date(START + day * DAY + hour * 3600000).toISOString(), kind,
                category: kind === 'INCOME' ? 'INCOME' : kind === 'CASH_OUT' ? 'CASH_OUT' : 'FOOD', amount, key, name });
  };

  for (let day = 0; day < HISTORY_DAYS; day++) {
    if (day % 30 === salaryDay) post(day, 'INCOME', 'INCOME', null, income, 1);
    if (day % 30 === rentDay) post(day, 'SPEND', 'rent', 'Rent', rent, 4);
    if (day % 30 === billDay) post(day, 'SPEND', 'bill', 'Electricity', between(400, 1500) * (income / 25000), 6);
    // Everyday spending: a few payments a day, busier on some days.
    const n = Math.floor(between(0, 4));
    for (let i = 0; i < n; i++) post(day, 'SPEND', `shop-${Math.floor(between(0, 6))}`, 'Shop', daily / 1.5 * between(0.3, 1.7), 5 + i * 3);
    if (cashHeavy && r() < 0.35) post(day, 'CASH_OUT', 'CASH_OUT', null, Math.round(between(1, 6)) * 500, 9);
    if (r() < 0.02) post(day, 'SPEND', 'big', 'Electronics', between(2000, 8000), 10);
    balanceAt.push(balance);
  }
  return { rows, balanceAt, income };
}

const results = [];
for (let u = 1; u <= USERS; u++) {
  const user = simulate(u * 7919);
  const asOf = new Date(START + (CUTOFF - 1) * DAY + 17 * 3600000).toISOString(); // end of day 119
  const f = forecast({
    as_of: asOf,
    balance: user.balanceAt[CUTOFF - 1],
    low_balance: 500,
    first_txn_at: user.rows[0]?.at ?? null,
    rows: user.rows.filter((r) => Date.parse(r.at) <= Date.parse(asOf)),
  });
  const errors = f.days.map((d, i) => Math.abs(d.balance - user.balanceAt[CUTOFF + i]));
  results.push({
    user: u,
    income: user.income,
    recurring: f.recurring.length,
    mae: errors.reduce((a, b) => a + b, 0) / errors.length,
    day30Error: errors[29],
    nmaeDay30: errors[29] / user.income,
    naiveNmaeDay30: Math.abs(user.balanceAt[CUTOFF - 1] - user.balanceAt[CUTOFF + 29]) / user.income,
    pathNmae: errors.reduce((a, b) => a + b, 0) / errors.length / user.income,
    naivePathNmae: f.days.reduce((a, _, i) => a + Math.abs(user.balanceAt[CUTOFF - 1] - user.balanceAt[CUTOFF + i]), 0)
      / f.days.length / user.income,
  });
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))];
const nmae = results.map((r) => r.nmaeDay30);
const naive = results.map((r) => r.naiveNmaeDay30);
const path = results.map((r) => r.pathNmae);
const naivePath = results.map((r) => r.naivePathNmae);
const skill = 1 - mean(path) / mean(naivePath);
const report = {
  users: USERS,
  history_days: CUTOFF,
  horizon_days: HISTORY_DAYS - CUTOFF,
  mae_taka: Math.round(mean(results.map((r) => r.mae))),
  day30_error_taka: Math.round(mean(results.map((r) => r.day30Error))),
  median_nmae_day30: Number(quantile(nmae, 0.5).toFixed(4)),
  mean_nmae_day30: Number(mean(nmae).toFixed(4)),
  p90_nmae_day30: Number(quantile(nmae, 0.9).toFixed(4)),
  naive_mean_nmae_day30: Number(mean(naive).toFixed(4)),
  path_mean_nmae: Number(mean(path).toFixed(4)),
  naive_path_mean_nmae: Number(mean(naivePath).toFixed(4)),
  skill_vs_naive: Number(skill.toFixed(4)),
  recurring_detected_share: Number((results.filter((r) => r.recurring >= 2).length / USERS).toFixed(2)),
  gates: { median_nmae_day30_max: GATE_MEDIAN_NMAE_DAY30, skill_vs_naive_min: GATE_SKILL_VS_NAIVE },
  pass: quantile(nmae, 0.5) <= GATE_MEDIAN_NMAE_DAY30 && skill >= GATE_SKILL_VS_NAIVE,
  note: 'Synthetic users (seeded). Validates the forecasting method, not real-world accuracy.',
};

mkdirSync(join(__dirname, '..', 'reports'), { recursive: true });
writeFileSync(join(__dirname, '..', 'reports', 'phase3-forecast.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`${report.pass ? 'PASS' : 'FAIL'} TC-P3-FCST-03 median day-30 error ${(report.median_nmae_day30 * 100).toFixed(1)}% `
  + `of monthly income (gate ${GATE_MEDIAN_NMAE_DAY30 * 100}%), mean ${(report.mean_nmae_day30 * 100).toFixed(1)}%, `
  + `${(report.skill_vs_naive * 100).toFixed(0)}% better than naive (gate ${GATE_SKILL_VS_NAIVE * 100}%)`);
process.exit(report.pass ? 0 : 1);
