// TC-P4-SEC-03: authorisation sweep. Every database function a signed-in
// customer may call is found in pg_catalog (not hand-listed), called as user B
// with user A's identifiers, and must never return A's data. The list is also
// pinned, so a new function granted to `authenticated` fails this test until
// it is reviewed and added here. Edge Functions are swept too.
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { admin, anon, callFn, rpc, signIn, signInAnalyst, walletOf } from './helpers';

/** Customer-callable functions after review (name -> why it is safe for any signed-in user). */
const REVIEWED: Record<string, string> = {
  add_savings_contribution: "own goals only (GOAL_NOT_FOUND for others')",
  am_i_analyst: 'returns only a boolean about the caller',
  analyst_act: 'analyst role required (NOT_ANALYST)',
  analyst_get_alert: 'analyst role required',
  analyst_list_alerts: 'analyst role required',
  cash_in: "credits caller's own wallet only",
  cashout_nudge: "caller's own cash-outs",
  create_savings_goal: 'creates for the caller',
  delete_my_account: 'caller only, PIN required',
  delete_savings_goal: 'own goals only',
  get_cash_history: "caller's wallet",
  get_coach_dashboard: "caller's wallet",
  get_my_notifications: "caller's notices",
  get_my_profile: "caller's profile",
  get_my_transactions: "caller's wallets",
  get_payment_status: "caller's wallet + key",
  get_savings_goals: "caller's goals",
  list_billers: 'public biller directory',
  log_event: "writes the caller's own allowlisted events",
  log_nudge_choice: "caller's own nudges (NUDGE_NOT_FOUND)",
  lookup_agent: 'public agent directory',
  lookup_merchant: 'public merchant directory',
  lookup_recipient: 'first name + masked number only',
  make_cashout: "debits the caller's wallet only; needs the caller's PIN + score",
  make_payment: "debits the caller's wallet only; needs the caller's PIN + score",
  make_transfer: "debits the caller's wallet only; needs the caller's PIN + score",
  mark_notification_read: "caller's notices only",
  set_my_preferences: "caller's preferences",
  set_pin: 'caller only, once',
  update_savings_goal: 'own goals only',
};

function psql(sql: string): string {
  return execSync(`docker exec supabase_db_shongrokhon psql -U postgres -d postgres -Atc "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' }).trim();
}

interface Fn { name: string; args: { name: string; type: string }[] }

function callableFunctions(): Fn[] {
  const rows = psql(`select p.proname, coalesce(array_to_string(p.proargnames, ','), ''),
                            coalesce((select string_agg(format_type(t, null), ',' order by i)
                                        from unnest(p.proargtypes) with ordinality as a(t, i)), '')
                       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
                      order by 1`).split('\n').filter(Boolean);
  return rows.map((r) => {
    const [name, names, types] = r.split('|');
    const ns = names ? names.split(',') : [];
    const ts = types ? types.split(',') : [];
    return { name, args: ts.map((type, i) => ({ name: ns[i], type })) };
  });
}

describe('TC-P4-SEC-03: authorization sweep', () => {
  let victim: { userId: string; wallet: string; phone: string; goal: string; secret: string };
  let attacker: Awaited<ReturnType<typeof signIn>>;

  before(async () => {
    const a = await signIn('01711000001'); // U-NORMAL: rich history = lots to leak
    const { data: goal } = await rpc(a.client, 'create_savings_goal', { p_name: 'Victim goal', p_target: 1000, p_months: 2 });
    victim = { userId: a.userId, wallet: (await walletOf(a.userId)).id, phone: '+8801711000001', goal, secret: 'Victim goal' };
    attacker = await signIn('01911000002'); // U-NEW
  });
  // Leave U-NORMAL as the other suites expect it (coach SAVE-01 counts its goals).
  after(async () => {
    await admin().from('savings_goals').delete().eq('id', victim.goal);
  });

  it('the set of customer-callable functions is exactly the reviewed list', () => {
    const names = [...new Set(callableFunctions().map((f) => f.name))].sort();
    assert.deepEqual(names, Object.keys(REVIEWED).sort(),
      'a function was granted to authenticated without review: add it to REVIEWED after checking it');
  });

  it("every callable function, given another user's ids, leaks nothing of theirs", async () => {
    const value = (arg: { name: string; type: string }): unknown => {
      const n = arg.name ?? '';
      if (arg.type === 'uuid') return n.includes('goal') ? victim.goal : n.includes('id') ? victim.userId : victim.wallet;
      if (arg.type === 'text') return n.includes('phone') ? victim.phone : n.includes('pin') ? '12345' : n.includes('lang') ? 'en' : 'MLEGIT0001';
      if (arg.type === 'numeric' || arg.type === 'integer' || arg.type === 'double precision') return 1;
      if (arg.type === 'boolean') return false;
      if (arg.type === 'jsonb') return {};
      if (arg.type.startsWith('timestamp')) return null;
      return null;
    };
    const leaks: string[] = [];
    for (const fn of callableFunctions()) {
      if (fn.name === 'delete_my_account' || fn.name === 'set_pin') continue; // act on the caller only, covered elsewhere
      const args = Object.fromEntries(fn.args.map((a) => [a.name, value(a)]));
      const { data, error } = await rpc(attacker.client, fn.name, args);
      const out = JSON.stringify(data ?? error ?? '');
      if ([victim.userId, victim.wallet, victim.phone, victim.secret].some((s) => out.includes(s))) leaks.push(`${fn.name}: ${out.slice(0, 120)}`);
    }
    assert.deepEqual(leaks, []);
    // The victim's goal and balance are untouched.
    const { data: goals } = await admin().from('savings_goals').select('id').eq('id', victim.goal);
    assert.equal(goals!.length, 1);
  });

  it('service-only functions are not callable by customers', async () => {
    for (const fn of ['risk_context', 'record_risk_score', 'flow_score', 'coach_context', 'store_alert_explanation',
                      'admin_credit_wallet', 'admin_cashout', 'reconcile_ledger', 'record_ring_alert']) {
      const { error } = await rpc(attacker.client, fn, {});
      assert.ok(error, `${fn} must be refused`);
    }
  });

  it('Edge Functions: no token -> 401, someone else\'s data -> 403, customers cannot investigate', async () => {
    for (const name of ['pay', 'coach', 'investigate']) {
      assert.equal((await callFn(name, null, {})).status, 401, name);
    }
    assert.equal((await callFn('coach', attacker.accessToken, { action: 'insights', user_id: victim.userId })).status, 403);
    assert.equal((await callFn('investigate', attacker.accessToken, { alertId: randomUUID() })).status, 403);
    // pay only ever debits the caller: a request naming the victim's wallet is just an unknown merchant.
    const res = await callFn('pay', attacker.accessToken, { merchantId: victim.wallet, amount: 1, pin: '12345', idempotencyKey: randomUUID() });
    assert.equal(res.data.code, 'MERCHANT_NOT_FOUND');
  });

  it('nobody can self-register an email (staff) account; the analyst can still sign in', async () => {
    const { error } = await anon().auth.signUp({ email: `intruder-${Date.now()}@example.com`, password: 'password-123456' });
    assert.ok(error, 'public email sign-up is refused');
    const analyst = await signInAnalyst();
    assert.ok(analyst.accessToken);
  });
});
