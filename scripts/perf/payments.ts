// TC-P4-PERF-01/02/03 (and TC-MET-02): payment latency and ledger consistency
// through the real `pay` Edge Function on the local stack (+ ML container).
//
//   npx tsx scripts/perf/payments.ts --sequential 1000              # PERF-01
//   npx tsx scripts/perf/payments.ts --concurrency 50 --duration 180 # PERF-02 (scaled)
//
// Mixed risk: ~70% shop payments (ALLOW), ~10% round amounts to a pseudo-merchant
// (FLAG), ~10% agent cash-outs and ~10% transfers (SQL rules). A REVIEW step-up
// is confirmed and timed as part of the same payment. Latency is the client
// round trip from "Pay" to the final result (score + ledger update). After the
// run, every wallet balance is reconciled against the ledger (PERF-03).
// Writes reports/phase4-perf.json. Resets nothing: run `supabase db reset` after.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const SEQUENTIAL = opt('sequential', 0);
const CONCURRENCY = opt('concurrency', 0);
const DURATION_S = opt('duration', 60);
const SLA_MS = 1500;
const PIN = '12345';

const env = Object.fromEntries(
  execSync('supabase status -o env', { encoding: 'utf8' }).split('\n')
    .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => [m[1], m[2]]),
);
const URL_ = env.API_URL;
const admin = createClient(URL_, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

interface Payer { client: SupabaseClient; token: string; walletId: string }

async function makePayer(i: number): Promise<Payer> {
  const phone = `88017${String(90000000 + i).padStart(8, '0')}`;
  const password = `perf-${i}-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ phone, password, phone_confirm: true });
  if (error) throw error;
  const client = createClient(URL_, env.ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ phone, password });
  if (e2) throw e2;
  await client.rpc('set_pin', { p_pin: PIN });
  const { data: w } = await admin.from('wallets').select('id').eq('user_id', data.user.id).eq('kind', 'customer').single();
  await admin.rpc('admin_credit_wallet', { p_wallet_id: w!.id, p_amount: 1_000_000, p_note: 'Perf test' });
  return { client, token: s.session!.access_token, walletId: w!.id };
}

type Kind = 'PAYMENT' | 'FLAGGED' | 'CASHOUT' | 'TRANSFER';
function pick(n: number): Kind {
  const r = n % 10;
  return r < 7 ? 'PAYMENT' : r === 7 ? 'FLAGGED' : r === 8 ? 'CASHOUT' : 'TRANSFER';
}

interface Outcome { ms: number; status: string; decision?: string; failed?: boolean; recovered: number }

/** A business rejection the server decided (limits, funds), as opposed to a system error. */
const BUSINESS = new Set(['DAILY_LIMIT_EXCEEDED', 'INSUFFICIENT_FUNDS', 'AMOUNT_ABOVE_LIMIT', 'WALLET_FROZEN']);

async function payOnce(p: Payer, kind: Kind, n: number): Promise<Outcome> {
  const key = randomUUID();
  const body = kind === 'PAYMENT' ? { merchantId: ['MLEGIT0001', 'MLEGIT0002', 'MLEGIT0003'][n % 3], amount: 120 + (n % 9) * 37 }
    : kind === 'FLAGGED' ? { merchantId: 'MPSEUDO01', amount: 5000 }
    : kind === 'CASHOUT' ? { kind: 'CASHOUT', agentCode: 'AGENT001', amount: 500 }
    : { kind: 'TRANSFER', phone: '01911000002', amount: 50 };
  let recovered = 0;
  type Reply = { status: string; risk_decision?: string; code?: string };
  // Like the app (src/lib/payment-flow.ts): a dropped connection or a server error
  // without a business code leaves the outcome unknown, so the same idempotency
  // key is sent again (at most one debit per key).
  const send = async (confirm: boolean): Promise<Reply> => {
    for (let attempt = 0; ; attempt++) {
      let reply: Reply | null = null;
      try {
        const res = await fetch(`${URL_}/functions/v1/pay`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${p.token}`, apikey: env.ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, pin: PIN, idempotencyKey: key, confirm }),
        });
        const json = (await res.json().catch(() => null)) as Reply | null;
        if (json?.status || (json?.code && json.code !== 'INTERNAL_ERROR')) reply = json;
      } catch {
        // transport failure: outcome unknown
      }
      if (reply) return reply;
      if (attempt >= 3) return { status: 'UNKNOWN', code: 'SYSTEM_ERROR' };
      recovered += 1;
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const t0 = performance.now();
  let out = await send(false);
  if (out.status === 'STEP_UP_REQUIRED') out = await send(true);
  const status = out.status === 'SUCCESS' ? 'SUCCESS' : out.code ?? out.status;
  return { ms: performance.now() - t0, status, decision: out.risk_decision, failed: status !== 'SUCCESS' && !BUSINESS.has(status), recovered };
}

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0);
};

async function main() {
  if (!SEQUENTIAL && !CONCURRENCY) {
    console.error('Usage: --sequential N | --concurrency C --duration S');
    process.exit(2);
  }
  const results: Outcome[] = [];
  const started = Date.now();
  if (SEQUENTIAL) {
    const payer = await makePayer(1);
    for (let n = 0; n < SEQUENTIAL; n++) results.push(await payOnce(payer, pick(n), n));
  } else {
    const payers = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => makePayer(100 + i)));
    const deadline = Date.now() + DURATION_S * 1000;
    await Promise.all(payers.map(async (p, i) => {
      for (let n = i; Date.now() < deadline; n += CONCURRENCY) results.push(await payOnce(p, pick(n), n));
    }));
  }
  const elapsed = (Date.now() - started) / 1000;
  const times = results.map((r) => r.ms);
  const errors = results.filter((r) => r.failed);
  const rejected = results.filter((r) => r.status !== 'SUCCESS' && !r.failed);
  const { data: reconcile, error } = await admin.rpc('reconcile_ledger');
  if (error) throw error;

  const report = {
    mode: SEQUENTIAL ? `sequential ${SEQUENTIAL}` : `concurrency ${CONCURRENCY} x ${DURATION_S}s`,
    payments: results.length,
    throughput_per_s: Math.round((results.length / elapsed) * 10) / 10,
    p50_ms: pct(times, 0.5),
    p95_ms: pct(times, 0.95),
    p99_ms: pct(times, 0.99),
    max_ms: Math.round(Math.max(...times)),
    error_rate: Math.round((errors.length / results.length) * 10000) / 10000,
    rejected_by_rule: rejected.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}),
    recovered_retries: results.reduce((a, r) => a + r.recovered, 0),
    errors_by_code: errors.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}),
    decisions: results.reduce<Record<string, number>>((a, r) => ({ ...a, [r.decision ?? 'none']: (a[r.decision ?? 'none'] ?? 0) + 1 }), {}),
    reconcile,
    sla_ms: SLA_MS,
    pass: pct(times, 0.95) < SLA_MS && (reconcile as { mismatched_wallets: number }).mismatched_wallets === 0
      && Number((reconcile as { ledger_imbalance: number }).ledger_imbalance) === 0
      && errors.length / results.length < 0.001,
    note: 'Local Docker stack on a laptop; production numbers need production-like hardware.',
  };
  mkdirSync(join(__dirname, '..', '..', 'reports'), { recursive: true });
  const file = join(__dirname, '..', '..', 'reports', `phase4-perf-${SEQUENTIAL ? 'sequential' : 'load'}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`${report.pass ? 'PASS' : 'FAIL'} p95 ${report.p95_ms} ms (SLA < ${SLA_MS} ms), error rate ${report.error_rate}, `
    + `${(reconcile as { mismatched_wallets: number }).mismatched_wallets} ledger mismatches`);
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
