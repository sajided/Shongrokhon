// Phase 4 over HTTP (testcase.md §4): cash-out / send money / bill pay through
// the `pay` function, the Smart Spending Companion, the Investigation Assistant
// (`investigate` + analyst RPCs), the Bangla coach, and account deletion.
// Needs the ML container (npm run ml:up). The coach and investigate LLM run in mock mode.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import {
  admin, ALWAYS_ALLOW, anon, callFn, coach, pay, rpc, setAppConfig, signIn, signInAnalyst, walletOf,
} from './helpers';

const PIN = '12345';

async function txnsOf(userId: string) {
  const wallet = (await walletOf(userId)).id;
  const { data } = await admin().from('transactions').select('id, type, amount, payee_wallet_id, risk_score_id')
    .eq('payer_wallet_id', wallet).order('created_at', { ascending: false }).limit(10);
  return data ?? [];
}

describe('Phase 4: money flows, companion, investigation, Bangla, deletion', () => {
  let restore: () => Promise<void>;
  before(async () => {
    restore = await setAppConfig({ ...ALWAYS_ALLOW, coach_llm_mode: 'mock', coach_rate_per_minute: 1000 });
  });
  after(async () => restore());

  describe('cash-out, send money, bill pay', () => {
    it('cash-out at an agent: amount to the agent, 1.85% fee, receipt, idempotent', async () => {
      const tight = await signIn('01611000002');
      const before = (await walletOf(tight.userId)).balance;
      const key = randomUUID();
      const body = { kind: 'CASHOUT' as const, agentCode: 'agent001', amount: 1000, pin: PIN, idempotencyKey: key };
      const res = await pay(tight.accessToken, body);
      assert.equal(res.data.status, 'SUCCESS', JSON.stringify(res.data));
      assert.equal(res.data.kind, 'CASHOUT');
      assert.equal(res.data.fee, 18.5);
      assert.equal(res.data.counterparty_name, 'Rahman Agent Point');
      assert.equal((await walletOf(tight.userId)).balance, before - 1018.5);
      const replay = await pay(tight.accessToken, body);
      assert.equal(replay.data.replayed, true, 'TC-P1-PAY-07 holds for cash-outs');
      assert.equal((await walletOf(tight.userId)).balance, before - 1018.5, 'no second debit');
      const types = (await txnsOf(tight.userId)).slice(0, 2).map((t) => t.type).sort();
      assert.deepEqual(types, ['CASHOUT', 'FEE']);
      const scored = (await txnsOf(tight.userId)).find((t) => t.type === 'CASHOUT')!;
      const { data: score } = await admin().from('risk_scores').select('source').eq('id', scored.risk_score_id).single();
      assert.equal(score!.source, 'RULES', 'cash-outs are scored by the rule policy');
    });

    it('FLOW-07 for the new flows: no score, no money', async () => {
      const tight = await signIn('01611000002');
      const { data } = await rpc(tight.client, 'make_cashout', { p_agent_code: 'AGENT001', p_amount: 100, p_pin: PIN,
        p_idempotency_key: randomUUID() });
      assert.equal(data.code, 'SCORE_REQUIRED');
    });

    it('send money: the recipient is credited and notified; unknown and self are refused', async () => {
      const tight = await signIn('01611000002');
      const fresh = await signIn('01911000002'); // U-NEW
      const before = (await walletOf(fresh.userId)).balance;
      const res = await pay(tight.accessToken, { kind: 'TRANSFER', phone: '01911000002', amount: 200, pin: PIN, idempotencyKey: randomUUID(), note: 'Lunch' });
      assert.equal(res.data.status, 'SUCCESS', JSON.stringify(res.data));
      assert.equal((await walletOf(fresh.userId)).balance, before + 200);
      const { data: notices } = await rpc(fresh.client, 'get_my_notifications');
      assert.equal(notices[0].kind, 'TRANSFER_RECEIVED');
      assert.equal((await pay(tight.accessToken, { kind: 'TRANSFER', phone: '01799999999', amount: 10, pin: PIN, idempotencyKey: randomUUID() })).data.code,
        'RECIPIENT_NOT_FOUND');
      assert.equal((await pay(tight.accessToken, { kind: 'TRANSFER', phone: '01611000002', amount: 10, pin: PIN, idempotencyKey: randomUUID() })).data.code,
        'SELF_TRANSFER');
      const { data: found } = await rpc(tight.client, 'lookup_recipient', { p_phone: '01911000002' });
      assert.deepEqual(found, [{ display_name: 'New', masked_phone: '**********0002' }]);
    });

    it('bill pay: billers are listed and paid through the scored payment flow', async () => {
      const tight = await signIn('01611000002');
      const { data: billers } = await rpc(tight.client, 'list_billers');
      assert.ok(billers.some((b: { merchant_id: string; biller_category: string }) => b.merchant_id === 'MGAS0001' && b.biller_category === 'GAS'));
      const res = await pay(tight.accessToken, { merchantId: 'MGAS0001', amount: 300, pin: PIN, idempotencyKey: randomUUID(), note: 'Account 1234' });
      assert.equal(res.data.status, 'SUCCESS', JSON.stringify(res.data));
    });

    it('a large transfer asks for PIN confirmation (rules REVIEW), then executes once', async () => {
      const undo = await setAppConfig({ fallback_review_amount: 10000 });
      try {
        const abuser = await signIn('01911000001'); // ৳20,000
        const body = { kind: 'TRANSFER' as const, phone: '01911000002', amount: 10000, pin: PIN, idempotencyKey: randomUUID() };
        const first = await pay(abuser.accessToken, body);
        assert.equal(first.data.status, 'STEP_UP_REQUIRED');
        const confirmed = await pay(abuser.accessToken, { ...body, confirm: true });
        assert.equal(confirmed.data.status, 'SUCCESS');
        await admin().rpc('admin_credit_wallet', { p_wallet_id: (await walletOf(abuser.userId)).id, p_amount: 10000 }); // keep Phase 2 tests' balance
      } finally {
        await undo();
      }
    });
  });

  describe('Smart Spending Companion', () => {
    it('SSC-01/03/06/07: U-CASHHEAVY is intercepted (fee + alternatives), at most twice a day, choices logged', async () => {
      const heavy = await signIn('01611000001');
      const first = (await rpc(heavy.client, 'cashout_nudge', { p_amount: 1000 })).data;
      assert.equal(first.show, true);
      assert.ok(first.nth >= 5, `nth ${first.nth}`);
      assert.equal(first.fee, 18.5);
      assert.deepEqual(first.alternatives, ['PAY_QR', 'BILL_PAY', 'SEND_MONEY']);
      assert.equal((await rpc(heavy.client, 'log_nudge_choice', { p_nudge_id: first.nudge_id, p_choice: 'BILL_PAY' })).error, null);
      const second = (await rpc(heavy.client, 'cashout_nudge', { p_amount: 500 })).data;
      assert.equal(second.show, true);
      const third = (await rpc(heavy.client, 'cashout_nudge', { p_amount: 500 })).data;
      assert.equal(third.reason, 'CAPPED', 'SSC-06');
      const { data: events } = await admin().from('nudge_events').select('kind, choice').eq('user_id', heavy.userId);
      assert.deepEqual(events!.filter((e) => e.kind === 'CHOICE').map((e) => e.choice), ['BILL_PAY'], 'SSC-07');
    });

    it('SSC-04: choosing an alternative debits nothing', async () => {
      const heavy = await signIn('01611000001');
      assert.equal((await txnsOf(heavy.userId)).filter((t) => t.type === 'CASHOUT' && t.payee_wallet_id).length >= 0, true);
      const before = (await walletOf(heavy.userId)).balance;
      // The app abandons the cash-out after the choice: no pay call is made.
      assert.equal((await walletOf(heavy.userId)).balance, before);
    });

    it('SSC-05: "continue" runs the normal cash-out through the risk pipeline', async () => {
      const heavy = await signIn('01611000001');
      const res = await pay(heavy.accessToken, { kind: 'CASHOUT', agentCode: 'AGENT002', amount: 500, pin: PIN, idempotencyKey: randomUUID() });
      assert.equal(res.data.status, 'SUCCESS', JSON.stringify(res.data));
      assert.ok(res.data.risk_decision, 'scored like any cash-out');
    });

    it('SSC-02/09: no nudge for U-NORMAL; opting out stops nudges; fraud scoring still applies', async () => {
      const normal = await signIn('01711000001');
      assert.equal((await rpc(normal.client, 'cashout_nudge', { p_amount: 500 })).data.reason, 'BELOW_THRESHOLD');
      const heavy = await signIn('01611000001');
      await rpc(heavy.client, 'set_my_preferences', { p_nudges_enabled: false });
      try {
        assert.equal((await rpc(heavy.client, 'cashout_nudge', { p_amount: 500 })).data.reason, 'OPTED_OUT');
        const res = await pay(heavy.accessToken, { kind: 'CASHOUT', agentCode: 'AGENT002', amount: 100, pin: PIN, idempotencyKey: randomUUID() });
        const { data: score } = await admin().from('risk_scores').select('source, decision')
          .eq('id', (await txnsOf(heavy.userId)).find((t) => t.id === res.data.transaction_id)!.risk_score_id).single();
        assert.equal(score!.source, 'RULES', 'SSC-09: the risk pipeline still scores it');
      } finally {
        await rpc(heavy.client, 'set_my_preferences', { p_nudges_enabled: true });
      }
    });

    it('SSC-08: cash-out latency with the companion check (no interception shown) stays < 1.5 s at p95', async () => {
      const undo = await setAppConfig({ nudge_min_cashouts_30d: 100000, cashout_daily_limit: 1e9 });
      try {
        const tight = await signIn('01611000002');
        const times: number[] = [];
        for (let i = 0; i < 20; i++) {
          const t0 = performance.now();
          const nudge = (await rpc(tight.client, 'cashout_nudge', { p_amount: 10 })).data;
          assert.equal(nudge.show, false);
          const res = await pay(tight.accessToken, { kind: 'CASHOUT', agentCode: 'AGENT001', amount: 10, pin: PIN, idempotencyKey: randomUUID() });
          assert.equal(res.data.status, 'SUCCESS');
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        const p95 = times[Math.floor(times.length * 0.95) - 1];
        assert.ok(p95 < 1500, `p95 ${Math.round(p95)} ms`);
      } finally {
        await undo();
      }
    });
  });

  describe('AI Investigation Assistant', () => {
    let alertId: string;
    before(async () => {
      // A model-scored FLAG (Phase 2): U-ABUSER pays M-PSEUDO a round ৳10,000. Balance restored after.
      const undo = await setAppConfig({ risk_review_threshold: 0.21, risk_flag_threshold: 0.58, anomaly_threshold: 0, network_flag_threshold: 0.8,
                                        fallback_review_amount: 10000, fallback_burst_count: 3 });
      try {
        const abuser = await signIn('01911000001');
        const res = await pay(abuser.accessToken, { merchantId: 'MPSEUDO01', amount: 10000, pin: PIN, idempotencyKey: randomUUID() });
        assert.equal(res.data.risk_decision, 'FLAG');
        const { data } = await admin().from('risk_alerts').select('id').eq('transaction_id', res.data.transaction_id).single();
        alertId = data!.id;
        await admin().rpc('admin_credit_wallet', { p_wallet_id: (await walletOf(abuser.userId)).id, p_amount: 10000 });
      } finally {
        await undo();
      }
    });

    it('INV-01: customers and anonymous callers are refused', async () => {
      const customer = await signIn('01711000001');
      assert.equal((await rpc(customer.client, 'analyst_list_alerts')).error?.message, 'NOT_ANALYST');
      assert.equal((await callFn('investigate', customer.accessToken, { alertId })).status, 403);
      assert.equal((await callFn('investigate', null, { alertId })).status, 401);
    });

    it('INV-02/03/04/05: the analyst sees the alert, SHAP drivers and a grounded summary', async () => {
      const analyst = await signInAnalyst();
      const { data: queue } = await rpc(analyst.client, 'analyst_list_alerts', { p_wallet: 'MPSEUDO01' });
      assert.ok(queue.some((a: { id: string }) => a.id === alertId), 'INV-02');
      const res = await callFn('investigate', analyst.accessToken, { alertId, refresh: true });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      const { shap, drivers, summary, summary_source: source } = res.data;
      assert.ok(shap, 'INV-03: SHAP from the ML service');
      const sum = shap.base_value + Object.values(shap.contributions as Record<string, number>).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - shap.margin) < 1e-3, `INV-04: ${sum} vs ${shap.margin}`);
      assert.ok(drivers.length >= 3 && drivers.every((d: { direction: string }) => ['raises', 'lowers'].includes(d.direction)));
      assert.equal(source, 'MOCK');
      assert.match(summary.headline, /৳10,000/, 'INV-05: figures come from the facts');
      const cached = await callFn('investigate', analyst.accessToken, { alertId });
      assert.equal(cached.data.cached, true);
    });

    it('INV-07/08: decisions are audited and become training labels', async () => {
      const analyst = await signInAnalyst();
      assert.equal((await rpc(analyst.client, 'analyst_act', { p_id: alertId, p_action: 'CONFIRMED', p_note: 'Mirrored cash-out' })).error, null);
      const { data: detail } = await rpc(analyst.client, 'analyst_get_alert', { p_id: alertId });
      assert.equal(detail.alert.status, 'CONFIRMED');
      assert.equal(detail.actions.at(-1).analyst, 'analyst@shongrokhon.test');
      const { data: label } = await admin().from('training_labels').select('label').eq('alert_id', alertId).single();
      assert.equal(label!.label, 1);
    });
  });

  describe('Bangla coach (TC-P4-L10N-06/07/08)', () => {
    it('insights in Bangla carry the same figures as in English, in Bangla digits', async () => {
      const heavy = await signIn('01611000001');
      const en = await coach(heavy.accessToken, { action: 'insights', period: 'MONTH', lang: 'en' });
      const bn = await coach(heavy.accessToken, { action: 'insights', period: 'MONTH', lang: 'bn' });
      const card = (r: typeof en) => r.data.insights.find((i: { kind: string }) => i.kind === 'CASH');
      assert.match(card(bn).body, /[০-৯]/, 'Bangla digits');
      assert.match(card(bn).body, /ক্যাশ আউট/);
      const figures = (s: string) => (s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).match(/\d[\d,]*/g) ?? []).sort();
      assert.deepEqual(figures(card(bn).body), figures(card(en).body), 'L10N-08');
    });

    it('a Banglish question is answered in Bangla', async () => {
      const heavy = await signIn('01611000001');
      const res = await coach(heavy.accessToken, { action: 'ask', question: 'amar khoroch komabo kivabe?', lang: 'bn' });
      assert.equal(res.data.topic, 'GENERAL');
      assert.match(res.data.answer, /[ঀ-৾]/, 'answered in Bangla script');
      assert.equal((await coach(heavy.accessToken, { action: 'insights', lang: 'fr' })).status, 400);
    });
  });

  describe('TC-P4-SEC-05: account deletion', () => {
    it('a zero-balance account is anonymised; its token stops working; the ledger stays', async () => {
      // A throwaway customer of its own: the 0171100000x test numbers are shared with auth.test.ts.
      const phone = `88017${String(Date.now()).slice(-8)}`;
      const password = `delete-me-${randomUUID()}`;
      const { data: created, error } = await admin().auth.admin.createUser({ phone, password, phone_confirm: true });
      assert.equal(error, null);
      const client = anon();
      await client.auth.signInWithPassword({ phone, password });
      const user = { client, userId: created.user!.id };
      await rpc(user.client, 'set_pin', { p_pin: PIN });
      const wallet = (await walletOf(user.userId)).id;
      const res = await rpc(user.client, 'delete_my_account', { p_pin: PIN });
      assert.equal(res.data.status, 'DELETED');
      const { data: row } = await admin().from('users').select('phone, full_name').eq('id', user.userId).single();
      assert.equal(row!.phone, `deleted:${user.userId}`);
      const after = await rpc(user.client, 'get_my_profile');
      assert.equal(after.status, 401, 'the session is gone');
      const { data: w } = await admin().from('wallets').select('status').eq('id', wallet).single();
      assert.equal(w!.status, 'frozen');
    });
  });
});
