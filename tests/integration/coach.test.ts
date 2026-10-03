// Phase 3 AI coach over HTTP (testcase.md §3): the `coach` Edge Function,
// coach and savings RPCs, seeded personas. The LLM runs in mock mode
// (app_config.coach_llm_mode = 'mock'), so results are deterministic and no
// API key is needed; scripts/eval-coach.ts covers the live model.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { forecast, type CashHistory } from '../../src/lib/forecast';
import { planGoal } from '../../src/lib/savings';
import { admin, coach, rpc, setAppConfig, signIn, walletOf } from './helpers';

type Session = { client: SupabaseClient; userId: string; accessToken: string };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function llmRequests(userId: string, action?: string) {
  let q = admin().from('coach_llm_requests').select('action, payload, outcome').eq('user_id', userId);
  if (action) q = q.eq('action', action);
  const { data, error } = await q;
  if (error) throw error;
  return data as { action: string; payload: { user: string }; outcome: string }[];
}

/** Same formatting as the coach facts: ৳ whole taka with South Asian grouping. */
function taka(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `৳${rest ? `${rest},${s.slice(-3)}` : s.slice(-3)}`;
}

describe('Phase 3: AI coach', () => {
  let restore: () => Promise<void>;
  let normal: Session;
  let cashHeavy: Session;
  let tight: Session;

  before(async () => {
    restore = await setAppConfig({ coach_llm_mode: 'mock', coach_rate_per_minute: 1000, coach_mock_delay_ms: 0,
                                   coach_llm_timeout_ms: 8000 });
    normal = await signIn('01711000001');
    cashHeavy = await signIn('01611000001');
    tight = await signIn('01611000002');
  });
  after(async () => restore());

  describe('§3.1 middleware', () => {
    it('TC-P3-MW-01: no JWT or a bad JWT -> 401', async () => {
      assert.equal((await coach(null, { action: 'insights' })).status, 401);
      assert.equal((await coach('not-a-jwt', { action: 'insights' })).status, 401);
      const { status } = await rpc(admin(), 'coach_context', { p_user_id: normal.userId, p_period: 'MONTH' });
      assert.equal(status, 200, 'service role can build the context');
    });

    it('TC-P3-MW-02: asking for another user\'s insights -> 403', async () => {
      const res = await coach(normal.accessToken, { action: 'insights', user_id: cashHeavy.userId });
      assert.equal(res.status, 403);
      assert.equal(res.data.code, 'FORBIDDEN');
      assert.equal((await coach(normal.accessToken, { action: 'insights', user_id: normal.userId })).status, 200);
    });

    it('TC-P3-MW-03 / LLM-04: U-NORMAL gets grounded insights; the LLM saw no PII', async () => {
      const res = await coach(normal.accessToken, { action: 'insights', period: '3M' });
      assert.equal(res.status, 200);
      assert.equal(res.data.status, 'OK');
      assert.equal(res.data.source, 'MOCK');
      assert.ok(res.data.insights.length >= 2);

      const dash = (await rpc(normal.client, 'get_coach_dashboard', { p_period: '3M' })).data;
      const allowed = new Set<string>([dash.income, dash.spending, dash.saved, Math.abs(dash.net), dash.cashout.total,
        ...dash.categories.map((c: { total: number }) => c.total)].map(taka));
      for (const c of dash.categories) allowed.add(`${Math.round(c.share * 100)}%`);
      allowed.add(`${Math.round(dash.cashout.share * 100)}%`);
      const text = res.data.insights.map((i: { title: string; body: string }) => `${i.title} ${i.body}`).join(' ');
      const figures = text.match(/৳[\d,]+|\d+%/g) ?? [];
      assert.ok(figures.length > 0, 'insights cite figures');
      for (const f of figures) assert.ok(allowed.has(f), `LLM-04: ${f} matches a SQL aggregate`);

      const sent = (await llmRequests(normal.userId)).map((r) => JSON.stringify(r.payload)).join('\n');
      assert.ok(sent.length > 0, 'requests were audited');
      for (const pii of ['01711000001', '8801711000001', 'Normal User', normal.userId, (await walletOf(normal.userId)).id]) {
        assert.ok(!sent.includes(pii), `MW-03: payload does not contain ${pii}`);
      }
      const insightsPayload = (await llmRequests(normal.userId, 'INSIGHTS')).map((r) => r.payload.user).join('\n');
      assert.ok(!UUID.test(insightsPayload), 'MW-03: no ids in the insights payload');
      for (const name of ['Rahim Store', 'Karim Pharmacy', 'Green Homes', 'City Bank']) {
        assert.ok(!insightsPayload.includes(name), `MW-03: merchant names are anonymised (${name})`);
      }
    });

    it('TC-P3-COACH-02: dashboard totals equal an independent ledger query', async () => {
      const dash = (await rpc(normal.client, 'get_coach_dashboard', { p_period: 'MONTH' })).data;
      assert.equal(dash.uncategorized, 0, 'every merchant was categorised by the insights call');
      const wallet = (await walletOf(normal.userId)).id;
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: txns } = await admin().from('transactions')
        .select('type, amount, payer_wallet_id, payee_wallet_id').eq('status', 'SUCCESS').gte('created_at', since)
        .or(`payer_wallet_id.eq.${wallet},payee_wallet_id.eq.${wallet}`);
      const { data: cats } = await admin().from('merchant_categories').select('wallet_id, category');
      const savings = new Set((cats ?? []).filter((c) => c.category === 'SAVINGS').map((c) => c.wallet_id));
      const sum = (rows: typeof txns) => Math.round((rows ?? []).reduce((a, t) => a + Number(t.amount), 0) * 100) / 100;
      const out = (txns ?? []).filter((t) => t.payer_wallet_id === wallet);
      assert.equal(dash.income, sum((txns ?? []).filter((t) => t.payee_wallet_id === wallet)));
      assert.equal(dash.spending, sum(out.filter((t) => !savings.has(t.payee_wallet_id))));
      assert.equal(dash.saved, sum(out.filter((t) => savings.has(t.payee_wallet_id))));
      const byCat = dash.categories.reduce((a: number, c: { total: number }) => a + c.total, 0);
      assert.equal(Math.round(byCat * 100) / 100, dash.spending, 'category totals add up');
      assert.equal(dash.merchants.find((m: { name: string }) => m.name === 'Karim Pharmacy')?.category, 'HEALTH');
      assert.equal(dash.merchants.find((m: { name: string }) => m.name === 'City Bank Savings Transfer')?.category, 'SAVINGS');
    });

    it('TC-P3-MW-06: a merchant name with instructions is data, not instructions', async () => {
      const res = await coach(cashHeavy.accessToken, { action: 'insights', period: 'MONTH' });
      assert.equal(res.status, 200);
      assert.ok(!JSON.stringify(res.data).toLowerCase().includes('spending is fine'));
      const { data } = await admin().from('wallets').select('id').eq('merchant_id', 'MINJECT01').single();
      const { data: cat } = await admin().from('merchant_categories').select('category').eq('wallet_id', data!.id).single();
      assert.equal(cat!.category, 'OTHERS', 'categorised from the allowed list');
      const insightsPayload = (await llmRequests(cashHeavy.userId, 'INSIGHTS')).map((r) => r.payload.user).join('\n');
      assert.ok(insightsPayload.length > 0);
      assert.ok(!insightsPayload.includes('Ignore previous'), 'the injected text never reaches the insights prompt');
    });

    it('TC-P3-COACH-03: U-CASHHEAVY shows high cash dependency and a cash insight', async () => {
      const dash = (await rpc(cashHeavy.client, 'get_coach_dashboard', { p_period: 'MONTH' })).data;
      assert.equal(dash.cashout.level, 'HIGH');
      assert.ok(dash.cashout.count >= 8);
      const res = await coach(cashHeavy.accessToken, { action: 'insights', period: 'MONTH' });
      assert.equal(res.data.insights[0].kind, 'CASH');
    });

    it('TC-P3-MW-04: 2,000+ transactions are summarised within the token budget', async () => {
      const bulk = await signIn('01611000003');
      const dash = (await rpc(bulk.client, 'get_coach_dashboard', { p_period: '3M' })).data;
      assert.ok(dash.txn_count >= 2000, `${dash.txn_count} transactions`);
      const res = await coach(bulk.accessToken, { action: 'insights', period: '3M' });
      assert.equal(res.status, 200);
      assert.equal(res.data.status, 'OK');
      const [req] = await llmRequests(bulk.userId, 'INSIGHTS');
      assert.ok(req.payload.user.length < 6000, `payload is ${req.payload.user.length} characters`);
    });

    it('TC-P3-MW-05: U-NEW gets "not enough data" and no LLM call', async () => {
      const fresh = await signIn('01911000002');
      const res = await coach(fresh.accessToken, { action: 'insights', period: 'MONTH' });
      assert.equal(res.status, 200);
      assert.equal(res.data.status, 'INSUFFICIENT_DATA');
      assert.deepEqual(res.data.insights, []);
      assert.equal((await llmRequests(fresh.userId)).length, 0);
    });

    it('TC-P3-MW-08: the same data is served from cache without a second LLM call', async () => {
      const first = await coach(tight.accessToken, { action: 'insights', period: 'MONTH' });
      const count = (await llmRequests(tight.userId, 'INSIGHTS')).length;
      const second = await coach(tight.accessToken, { action: 'insights', period: 'MONTH' });
      assert.equal(first.data.cached, false);
      assert.equal(second.data.cached, true);
      assert.deepEqual(second.data.insights, first.data.insights);
      assert.equal((await llmRequests(tight.userId, 'INSIGHTS')).length, count);
    });

    it('TC-P3-MW-09: a slow LLM is cut off at the timeout; the user gets template insights', async () => {
      const undo = await setAppConfig({ coach_mock_delay_ms: 5000, coach_llm_timeout_ms: 500 });
      try {
        const t0 = Date.now();
        const res = await coach(tight.accessToken, { action: 'insights', period: '3M' });
        assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
        assert.equal(res.status, 200);
        assert.equal(res.data.source, 'TEMPLATE');
        assert.ok(res.data.insights.length > 0);
        const outcomes = (await llmRequests(tight.userId, 'INSIGHTS')).map((r) => r.outcome);
        assert.ok(outcomes.includes('TIMEOUT'));
      } finally {
        await undo();
      }
    });

    it('TC-P3-LLM-07: with the LLM off the coach still answers from templates', async () => {
      const undo = await setAppConfig({ coach_llm_mode: 'off' });
      try {
        const before = (await llmRequests(tight.userId)).length;
        const res = await coach(tight.accessToken, { action: 'insights', period: '3M' });
        assert.equal(res.data.source, 'TEMPLATE');
        assert.ok(res.data.insights.length > 0);
        assert.equal((await llmRequests(tight.userId)).length, before, 'no LLM request');
        const ask = await coach(tight.accessToken, { action: 'ask', question: 'How can I spend less?' });
        assert.equal(ask.data.status, 'UNAVAILABLE');
      } finally {
        await undo();
      }
    });

    it('TC-P3-MW-07: more than 10 requests a minute -> 429', async () => {
      const low = await signIn('01711000002'); // U-LOW: its own rate-limit window
      const undo = await setAppConfig({ coach_rate_per_minute: 10 });
      try {
        const results = [];
        for (let i = 0; i < 30; i++) results.push((await coach(low.accessToken, { action: 'insights', period: 'WEEK' })).status);
        assert.equal(results.filter((s) => s === 200).length, 10);
        assert.equal(results.filter((s) => s === 429).length, 20);
      } finally {
        await undo();
      }
    });

    it('TC-P3-LLM-05: "Which stock should I buy?" is declined with general guidance', async () => {
      const res = await coach(normal.accessToken, { action: 'ask', question: 'Which stock should I buy?' });
      assert.equal(res.status, 200);
      assert.equal(res.data.declined, true);
      assert.match(res.data.answer, /^I can't recommend specific investments/);
      const loan = await coach(normal.accessToken, { action: 'ask', question: 'Should I take a loan to buy a phone?' });
      assert.equal(loan.data.declined, true);
      const general = await coach(normal.accessToken, { action: 'ask', question: 'How can I spend less on food?' });
      assert.equal(general.data.topic, 'GENERAL');
      assert.match(general.data.answer, /৳[\d,]+/, 'answer cites a real figure');
    });

    it('rejects bad requests', async () => {
      assert.equal((await coach(normal.accessToken, { action: 'insights', period: 'YEAR' })).status, 400);
      assert.equal((await coach(normal.accessToken, { action: 'ask', question: '' })).status, 400);
      assert.equal((await coach(normal.accessToken, { action: 'delete_everything' })).status, 400);
    });
  });

  describe('§3.4 savings planner', () => {
    it('TC-P3-SAVE-01: ৳30,000 in 6 months for U-NORMAL is ≈ ৳5,000/month and achievable', async () => {
      const { data } = await rpc(normal.client, 'get_savings_goals');
      assert.ok(data.surplus.surplus >= 5000, `surplus ${data.surplus.surplus}`);
      const plan = planGoal(30000, 6, data.surplus.surplus);
      assert.equal(plan.monthly, 5000);
      assert.equal(plan.status, 'ACHIEVABLE');
      const { data: id, error } = await rpc(normal.client, 'create_savings_goal', { p_name: 'Eid', p_target: 30000, p_months: 6 });
      assert.equal(error, null);
      const goals = (await rpc(normal.client, 'get_savings_goals')).data.goals;
      assert.deepEqual(goals.map((g: { id: string; target_amount: number }) => [g.id, g.target_amount]), [[id, 30000]]);
    });

    it('TC-P3-SAVE-02: the same goal is unrealistic for U-TIGHT (~৳3,000 surplus)', async () => {
      const { data } = await rpc(tight.client, 'get_savings_goals');
      assert.ok(data.surplus.surplus > 2000 && data.surplus.surplus < 4000, `surplus ${data.surplus.surplus}`);
      const plan = planGoal(30000, 6, data.surplus.surplus);
      assert.equal(plan.status, 'UNREALISTIC');
      assert.ok(plan.alternatives!.months! > 6);
      assert.ok(plan.alternatives!.target < 30000);
    });

    it('TC-P3-SAVE-05: contributions update progress', async () => {
      const { data: id } = await rpc(tight.client, 'create_savings_goal', { p_name: 'Phone', p_target: 12000, p_months: 6 });
      await rpc(tight.client, 'add_savings_contribution', { p_goal_id: id, p_amount: 2000 });
      await rpc(tight.client, 'add_savings_contribution', { p_goal_id: id, p_amount: 1500 });
      const goal = (await rpc(tight.client, 'get_savings_goals')).data.goals.find((g: { id: string }) => g.id === id);
      assert.equal(goal.saved, 3500);
      assert.equal(goal.remaining, 8500);
      const other = await rpc(normal.client, 'add_savings_contribution', { p_goal_id: id, p_amount: 1 });
      assert.equal(other.error?.message, 'GOAL_NOT_FOUND', 'other users cannot add to it');
    });

    it('TC-P3-SAVE-03: the server rejects invalid goals', async () => {
      for (const [target, months, code] of [[0, 6, 'GOAL_AMOUNT_INVALID'], [-1, 6, 'GOAL_AMOUNT_INVALID'],
        [30000, 0, 'GOAL_MONTHS_INVALID'], [30000, 61, 'GOAL_MONTHS_INVALID']] as const) {
        const { error } = await rpc(tight.client, 'create_savings_goal', { p_name: 'x', p_target: target, p_months: months });
        assert.equal(error?.message, code);
      }
    });
  });

  describe('§3.5 forecast', () => {
    it('TC-P3-FCST-01: U-NORMAL gets a 30-day projection with salary and rent, no warning', async () => {
      const { data } = await rpc<CashHistory>(normal.client, 'get_cash_history', { p_days: 120 });
      const f = forecast(data);
      assert.equal(f.days.length, 30);
      assert.equal(f.lowConfidence, false);
      const names = f.recurring.map((r) => r.name);
      assert.ok(names.includes('Income') && names.includes('Green Homes Rent'), names.join(', '));
      assert.equal(f.warning, null);
    });

    it('TC-P3-FCST-02/06: U-TIGHT is warned about a low balance on the rent date', async () => {
      const { data } = await rpc<CashHistory>(tight.client, 'get_cash_history', { p_days: 120 });
      const f = forecast(data);
      assert.ok(f.warning, 'a warning is shown');
      assert.equal(f.warning!.cause?.name, 'Green Homes Rent');
      const days = (Date.parse(f.warning!.date) - Date.parse(data.as_of)) / 86400000;
      assert.ok(days > 7 && days < 12, `warning in ${days.toFixed(1)} days`);
      assert.ok(f.warning!.topUp > 0);
      assert.ok(f.shortfall > 0, 'the projection goes below zero');
    });
  });
});
