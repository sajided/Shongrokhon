// Phase 2 pipeline over HTTP: scan -> score -> execute/flag (testcase.md §2.4).
// Needs the ML container (npm run ml:up) next to the local Supabase stack.
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { admin, ALWAYS_ALLOW, pay, rpc, setRiskConfig, signIn, stackEnv, walletOf } from './helpers';

const ML_HEALTH = 'http://127.0.0.1:8710/health';
const COMPOSE = 'docker compose -f ml/docker-compose.yml';

async function mlHealthy(): Promise<boolean> {
  try {
    return (await fetch(ML_HEALTH)).ok;
  } catch {
    return false;
  }
}

async function waitFor(check: () => Promise<boolean>, ms = 60000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('timed out');
}

async function scoreOf(transactionId: string) {
  const { data, error } = await admin()
    .from('transactions')
    .select('risk_score_id, risk_scores!transactions_risk_score_id_fkey(source, decision, model_version, risk_score, anomaly_score, features)')
    .eq('id', transactionId)
    .single();
  if (error) throw error;
  return (data as any).risk_scores as { source: string; decision: string; model_version: string; risk_score: number | null; features: Record<string, number> };
}

async function merchantWallet(merchantId: string): Promise<string> {
  const { data, error } = await admin().from('wallets').select('id').eq('merchant_id', merchantId).single();
  if (error) throw error;
  return data.id;
}

before(async () => {
  assert.ok(await mlHealthy(), `ML service not reachable at ${ML_HEALTH}; run \`npm run ml:up\` first`);
});

describe('TC-P2-FLOW-01/06: low risk executes and the score is stored', () => {
  it('U-NORMAL pays M-LEGIT; the model score, version and decision are kept with the transaction', async () => {
    const { accessToken } = await signIn('01711000001');
    const res = await pay(accessToken, { merchantId: 'MLEGIT0001', amount: 350, pin: '12345', idempotencyKey: randomUUID() });
    assert.equal(res.data.status, 'SUCCESS');
    assert.equal(res.data.risk_decision, 'ALLOW');
    const score = await scoreOf(res.data.transaction_id);
    assert.equal(score.source, 'MODEL');
    assert.match(score.model_version, /^p2-/);
    assert.ok(score.risk_score !== null && score.risk_score < 0.25);
    assert.ok(score.features.payer_txn_count_90d > 50, 'features see the seeded six-month history');
  });
});

describe('TC-P2-FLOW-02: high risk pays, then alerts and flags (Phase 2 policy)', () => {
  it('U-ABUSER pays M-PSEUDO a round ৳10,000', async () => {
    const { client, accessToken, userId } = await signIn('01911000001');
    const before = await walletOf(userId);
    const res = await pay(accessToken, { merchantId: 'MPSEUDO01', amount: 10000, pin: '12345', idempotencyKey: randomUUID() });
    assert.equal(res.data.status, 'SUCCESS', 'the payment still executes');
    assert.equal(res.data.risk_decision, 'FLAG');
    assert.equal(res.data.flagged, true);
    assert.equal((await walletOf(userId)).balance, before.balance - 10000);

    const { data: alerts } = await admin().from('risk_alerts').select('kind, status, wallet_ids').eq('transaction_id', res.data.transaction_id);
    assert.equal(alerts!.length, 1);
    assert.equal(alerts![0].kind, 'TXN');
    assert.equal(alerts![0].status, 'OPEN');

    const pseudo = await merchantWallet('MPSEUDO01');
    const { data: flagged } = await admin().from('wallets').select('id').in('id', [before.id, pseudo]).eq('risk_flagged', true);
    assert.equal(flagged!.length, 2, 'payer and merchant wallets flagged');

    const notices = await rpc(client, 'get_my_notifications');
    assert.equal(notices.data[0].kind, 'PAYMENT_FLAGGED');
    assert.match(notices.data[0].body, /৳10,000\.00 to Quick Mart/);
    const merchant = await signIn('01811000011');
    const merchantNotices = await rpc(merchant.client, 'get_my_notifications');
    assert.equal(merchantNotices.data[0].kind, 'PAYMENT_RECEIVED_FLAGGED');
  });
});

describe('TC-P2-FLOW-03: medium risk needs step-up confirmation', () => {
  let token: string;
  let userId: string;
  before(async () => {
    ({ accessToken: token, userId } = await signIn('01911000002')); // U-NEW
    const wallet = await walletOf(userId);
    await admin().rpc('admin_credit_wallet', { p_wallet_id: wallet.id, p_amount: 10000 });
  });

  it('a REVIEW score holds the payment until the user confirms with their PIN', async () => {
    const restore = await setRiskConfig({ risk_review_threshold: 0, risk_flag_threshold: 2 });
    try {
      const before = await walletOf(userId);
      const key = randomUUID();
      const first = await pay(token, { merchantId: 'MLEGIT0002', amount: 700, pin: '12345', idempotencyKey: key });
      assert.equal(first.data.status, 'STEP_UP_REQUIRED');
      assert.equal(first.data.code, 'CONFIRM_PAYMENT');
      assert.equal((await walletOf(userId)).balance, before.balance, 'nothing debited yet');

      const confirmed = await pay(token, { merchantId: 'MLEGIT0002', amount: 700, pin: '12345', idempotencyKey: key, confirm: true });
      assert.equal(confirmed.data.status, 'SUCCESS');
      assert.equal((await walletOf(userId)).balance, before.balance - 700);
    } finally {
      await restore();
    }
  });

  it('IF-03 in the live flow: U-NORMAL paying ~10x their usual ticket is stepped up', async () => {
    const { accessToken, userId } = await signIn('01711000001');
    // Earlier suites spend from U-NORMAL; make sure funds are not what stops this payment.
    await admin().rpc('admin_credit_wallet', { p_wallet_id: (await walletOf(userId)).id, p_amount: 5000 });
    const res = await pay(accessToken, { merchantId: 'MLEGIT0001', amount: 4200, pin: '12345', idempotencyKey: randomUUID() });
    assert.equal(res.data.status, 'STEP_UP_REQUIRED');
  });
});

describe('TC-P2-FLOW-04/05: scoring service down or slow -> rule-based fallback', () => {
  let token: string;
  before(async () => {
    ({ accessToken: token } = await signIn('01911000002'));
  });

  it('FLOW-05: a timeout falls back to the rules and the payment still completes', async () => {
    const restore = await setRiskConfig({ ml_timeout_ms: 1 });
    try {
      const res = await pay(token, { merchantId: 'MLEGIT0003', amount: 450, pin: '12345', idempotencyKey: randomUUID() });
      assert.equal(res.status, 200);
      assert.equal(res.data.status, 'SUCCESS');
      const score = await scoreOf(res.data.transaction_id);
      assert.equal(score.source, 'FALLBACK');
      assert.equal(score.model_version, 'rules-v1');
    } finally {
      await restore();
    }
  });

  it('FLOW-04: with the ML container stopped, small payments pass and large ones step up', async () => {
    execSync(`${COMPOSE} stop ml`, { stdio: 'ignore' });
    try {
      const small = await pay(token, { merchantId: 'MLEGIT0003', amount: 300, pin: '12345', idempotencyKey: randomUUID() });
      assert.equal(small.status, 200, 'no unhandled error reaches the user');
      assert.equal(small.data.status, 'SUCCESS');
      assert.equal((await scoreOf(small.data.transaction_id)).source, 'FALLBACK');

      const large = await pay(token, { merchantId: 'MLEGIT0003', amount: 12000, pin: '12345', idempotencyKey: randomUUID() });
      assert.notEqual(large.data.status, 'SUCCESS');
      assert.ok(['STEP_UP_REQUIRED', 'FAILED'].includes(large.data.status), JSON.stringify(large.data));
    } finally {
      execSync(`${COMPOSE} start ml`, { stdio: 'ignore' });
      await waitFor(mlHealthy);
    }
  });
});

describe('TC-P2-FLOW-07: execution requires a valid server-side score', () => {
  let client: SupabaseClient;
  let userId: string;
  before(async () => {
    ({ client, userId } = await signIn('01911000002'));
  });

  it('calling make_payment directly is rejected without moving money', async () => {
    const before = await walletOf(userId);
    const none = await rpc(client, 'make_payment', {
      p_merchant_id: 'MLEGIT0001', p_amount: 100, p_pin: '12345', p_idempotency_key: randomUUID(),
    });
    assert.equal(none.data.code, 'SCORE_REQUIRED');
    const forged = await rpc(client, 'make_payment', {
      p_merchant_id: 'MLEGIT0001', p_amount: 100, p_pin: '12345', p_idempotency_key: randomUUID(), p_score_id: randomUUID(),
    });
    assert.equal(forged.data.code, 'SCORE_INVALID');
    assert.equal((await walletOf(userId)).balance, before.balance);
  });

  it('clients cannot write or read scores, nor call the scoring RPCs', async () => {
    const insert = await client.from('risk_scores').insert({ decision: 'ALLOW' });
    assert.ok(insert.error);
    const read = await client.from('risk_scores').select('id');
    assert.ok(read.error);
    const record = await rpc(client, 'record_risk_score', {
      p_user_id: userId, p_merchant_id: 'MLEGIT0001', p_amount: 1, p_idempotency_key: randomUUID(), p_features: {}, p_source: 'FALLBACK',
    });
    assert.ok(record.error);
  });

  it('the pay function rejects calls without a user token', async () => {
    const res = await fetch(`${stackEnv().url}/functions/v1/pay`, {
      method: 'POST',
      headers: { apikey: stackEnv().anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchantId: 'MLEGIT0001', amount: 1, pin: '12345', idempotencyKey: randomUUID() }),
    });
    assert.equal(res.status, 401);
  });
});

describe('TC-P2-FLOW-09 (server side): score + ledger update latency', () => {
  let restore: () => Promise<void>;
  after(() => restore());

  it('p95 of 50 sequential payments through the pay function is under 1.5 s', async () => {
    restore = await setRiskConfig(ALWAYS_ALLOW); // full path every time: score, then ledger update
    const { accessToken, userId } = await signIn('01911000002');
    const wallet = await walletOf(userId);
    await admin().rpc('admin_credit_wallet', { p_wallet_id: wallet.id, p_amount: 1000 });
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t = performance.now();
      const res = await pay(accessToken, { merchantId: 'MLEGIT0001', amount: 10, pin: '12345', idempotencyKey: randomUUID() });
      times.push(performance.now() - t);
      assert.equal(res.data.status, 'SUCCESS');
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(0.95 * times.length) - 1];
    console.log(`pay p50=${times[24].toFixed(0)}ms p95=${p95.toFixed(0)}ms`);
    assert.ok(p95 < 1500, `p95 ${p95.toFixed(0)}ms`);
  });
});

describe('TC-P2-FLOW-08: ring detection (network job)', () => {
  it('one RING alert holds the eight RING-01 wallets, and their merchants force FLAG', async () => {
    const out = execSync(`${COMPOSE} run --rm network-job python -m shongrokhon_ml.network --once`, { encoding: 'utf8' });
    const run = JSON.parse(out.trim().split('\n').pop()!);
    assert.equal(run.rings, 1);

    const { data: alerts } = await admin().from('risk_alerts').select('wallet_ids, summary').eq('kind', 'RING');
    assert.equal(alerts!.length, 1);
    const ring = await admin()
      .from('wallets')
      .select('id, users!inner(phone)')
      .eq('kind', 'customer')
      .in('users.phone', Array.from({ length: 8 }, (_, i) => `+88019110000${String(i + 3).padStart(2, '0')}`));
    const memberIds = ring.data!.map((w: any) => w.id).sort();
    assert.equal(memberIds.length, 8);
    assert.deepEqual([...alerts![0].summary.payer_wallets].sort(), memberIds);
    const merchants = [await merchantWallet('MPSEUDO02'), await merchantWallet('MPSEUDO03')].sort();
    assert.deepEqual([...alerts![0].summary.merchant_wallets].sort(), merchants);

    // Running again does not duplicate the alert.
    execSync(`${COMPOSE} run --rm network-job python -m shongrokhon_ml.network --once`, { stdio: 'ignore' });
    const { count } = await admin().from('risk_alerts').select('id', { count: 'exact', head: true }).eq('kind', 'RING');
    assert.equal(count, 1);

    // A small, ordinary-looking payment into the ring is flagged via the network score.
    const member = await signIn('01911000003');
    const res = await pay(member.accessToken, { merchantId: 'MPSEUDO02', amount: 120, pin: '12345', idempotencyKey: randomUUID() });
    assert.equal(res.data.risk_decision, 'FLAG');
    assert.equal(res.data.flagged, true);
  });
});
