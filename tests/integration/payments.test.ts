// TC-P1-PAY-01/02/07/09 and DB-05/06 over HTTP with real user JWTs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { admin, rpc, signIn, walletOf } from './helpers';

const MERCHANT = 'MLEGIT0001';

async function ledgerImbalance(): Promise<number> {
  const { data, error } = await admin().from('ledger_entries').select('direction, amount');
  if (error) throw error;
  return data.reduce((sum, e) => sum + (e.direction === 'DEBIT' ? 1 : -1) * Number(e.amount), 0);
}

describe('TC-P1-PAY-01/02: standard low-risk payment (U-NORMAL -> M-LEGIT)', () => {
  it('debits ৳500, credits the merchant, and keeps the ledger balanced', async () => {
    const { client, userId } = await signIn('01711000001');
    const merchantBefore = Number(
      (await admin().from('wallets').select('balance').eq('merchant_id', MERCHANT).single()).data!.balance,
    );
    const before = await walletOf(userId);
    assert.equal(before.balance, 5000, 'seeded balance');

    const res = await rpc(client, 'make_payment', {
      p_merchant_id: MERCHANT,
      p_amount: 500,
      p_pin: '12345',
      p_idempotency_key: randomUUID(),
    });
    assert.equal(res.error, null);
    assert.equal(res.data.status, 'SUCCESS');
    assert.equal(res.data.merchant_name, 'Rahim Store');

    assert.equal((await walletOf(userId)).balance, 4500);
    const merchantAfter = Number(
      (await admin().from('wallets').select('balance').eq('merchant_id', MERCHANT).single()).data!.balance,
    );
    assert.equal(merchantAfter - merchantBefore, 500);

    const { data: entries } = await admin().from('ledger_entries').select('direction, amount').eq('transaction_id', res.data.transaction_id);
    assert.equal(entries!.length, 2);
    assert.equal(await ledgerImbalance(), 0);

    const history = await rpc(client, 'get_my_transactions', { p_id: res.data.transaction_id });
    assert.equal(history.data[0].counterparty_name, 'Rahim Store');
  });
});

describe('concurrency', () => {
  let client: SupabaseClient;
  let userId: string;

  before(async () => {
    ({ client, userId } = await signIn('01711000009'));
    await rpc(client, 'set_pin', { p_pin: '12345' });
    const wallet = await walletOf(userId);
    const topup = await admin().rpc('admin_credit_wallet', { p_wallet_id: wallet.id, p_amount: 5000 - wallet.balance });
    assert.equal(topup.error, null);
    assert.equal((await walletOf(userId)).balance, 5000);
  });

  it('TC-P1-PAY-09: two parallel ৳3,000 payments from ৳5,000 -> one succeeds, one fails', async () => {
    const pay = () =>
      rpc(client, 'make_payment', { p_merchant_id: MERCHANT, p_amount: 3000, p_pin: '12345', p_idempotency_key: randomUUID() });
    const results = await Promise.all([pay(), pay()]);
    const outcomes = results.map((r) => r.data.status === 'SUCCESS' ? 'SUCCESS' : r.data.code).sort();
    assert.deepEqual(outcomes, ['INSUFFICIENT_FUNDS', 'SUCCESS']);
    assert.equal((await walletOf(userId)).balance, 2000);
  });

  it('TC-P1-PAY-09: a burst of 10 parallel ৳500 payments never overdraws ৳2,000', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        rpc(client, 'make_payment', { p_merchant_id: MERCHANT, p_amount: 500, p_pin: '12345', p_idempotency_key: randomUUID() }),
      ),
    );
    assert.equal(results.filter((r) => r.data.status === 'SUCCESS').length, 4);
    assert.equal(results.filter((r) => r.data.code === 'INSUFFICIENT_FUNDS').length, 6);
    assert.equal((await walletOf(userId)).balance, 0);
    assert.equal(await ledgerImbalance(), 0);
  });

  it('TC-P1-PAY-07: the same request sent twice at once debits exactly once', async () => {
    const wallet = await walletOf(userId);
    await admin().rpc('admin_credit_wallet', { p_wallet_id: wallet.id, p_amount: 1000 });
    const key = randomUUID();
    const args = { p_merchant_id: MERCHANT, p_amount: 400, p_pin: '12345', p_idempotency_key: key };
    const [a, b] = await Promise.all([rpc(client, 'make_payment', args), rpc(client, 'make_payment', args)]);
    assert.equal(a.data.status, 'SUCCESS');
    assert.equal(b.data.status, 'SUCCESS');
    assert.equal(a.data.transaction_id, b.data.transaction_id, 'both return the original result');
    assert.equal((await walletOf(userId)).balance, 600);
  });
});

describe('TC-P1-DB-05/06: RLS with real JWTs over REST', () => {
  let client: SupabaseClient;
  let userId: string;
  before(async () => {
    ({ client, userId } = await signIn('01711000002'));
  });

  it('a user cannot read another user\'s wallet or transactions', async () => {
    const other = await walletOf('11111111-1111-1111-1111-000000000001');
    const wallets = await client.from('wallets').select('id, balance').eq('id', other.id);
    assert.deepEqual(wallets.data, []);
    const txns = await client.from('transactions').select('id').eq('payer_wallet_id', other.id);
    assert.deepEqual(txns.data, []);
  });

  it('a user cannot write their own balance from the client', async () => {
    const before = await walletOf(userId);
    const res = await client.from('wallets').update({ balance: 999999 }).eq('user_id', userId).select();
    assert.ok(res.error, 'update is refused');
    assert.equal(res.error!.code, '42501');
    assert.equal((await walletOf(userId)).balance, before.balance);
  });

  it('a user cannot call service-only functions', async () => {
    const wallet = await walletOf(userId);
    const res = await rpc(client, 'admin_credit_wallet', { p_wallet_id: wallet.id, p_amount: 1000 });
    assert.ok(res.error);
    assert.equal((await walletOf(userId)).balance, wallet.balance);
  });
});
