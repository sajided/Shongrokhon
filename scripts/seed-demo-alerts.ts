// Creates demo FLAG alerts for the Investigation Assistant on a project that has
// no ML service attached (e.g. the hosted project): the service role records a
// high model score, then the demo customer pays with it, which is the same path
// pgTAP's pg_temp.pay uses. Safe to re-run: existing demo accounts are reused and
// each run adds a fresh set of alerts.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-demo-alerts.ts
//
// Demo accounts (phone numbers in the unassigned 880179999xxxx range):
//   customers 8801799990001 / 8801799990002, PIN 12345
//   merchants MDEMO0001 "Dhaka Mobile Point", MDEMO0002 "Quick Cash Traders"
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PIN = '12345';
const PASSWORD = 'demo-customer-pass-123';
const CUSTOMERS = [
  { phone: '8801799990001', name: 'Demo Customer One' },
  { phone: '8801799990002', name: 'Demo Customer Two' },
];
const MERCHANTS = [
  { phone: '8801799990101', id: 'MDEMO0001', name: 'Dhaka Mobile Point' },
  { phone: '8801799990102', id: 'MDEMO0002', name: 'Quick Cash Traders' },
];
// Three disguised cash-outs: the shape the model flags (round amount at a merchant
// that cashes out most receipts within minutes, paid by a customer new to it).
const ALERTS = [
  { customer: 0, merchant: 0, amount: 12000, risk: 0.93, anomaly: 0.6 },
  { customer: 1, merchant: 1, amount: 8500, risk: 0.81, anomaly: 0.2 },
  { customer: 0, merchant: 1, amount: 20000, risk: 0.97, anomaly: 1.1 },
];

function features(amount: number, merchantIdx: number) {
  const ratio = merchantIdx === 0 ? 0.91 : 0.78;
  return {
    amount, log_amount: Math.log1p(amount), is_round_100: amount % 100 === 0 ? 1 : 0, is_round_1000: amount % 1000 === 0 ? 1 : 0,
    hour_sin: -0.5, hour_cos: -0.87, is_night: 0,
    payer_txn_count_90d: 14, payer_median_amount_90d: 420, amount_to_median: amount / 420, payer_hour_share: 0.12,
    payer_cashout_count_30d: 3, payer_txn_count_1h: 1,
    payer_merchant_prior_count: 0, amount_to_merchant_median: 1, merchant_new_for_payer: 1, payer_merchant_count_10m: 0,
    merchant_distinct_payers_30d: 9, merchant_round_share_30d: 0.88, merchant_cashout_ratio_7d: ratio,
    merchant_cashout_lag_min: merchantIdx === 0 ? 18 : 41, merchant_age_days: 23,
  };
}

async function findUserByPhone(admin: SupabaseClient, phone: string) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.phone === phone) ?? null;
}

async function ensureUser(admin: SupabaseClient, phone: string) {
  const existing = await findUserByPhone(admin, phone);
  if (existing) return existing.id;
  const { data, error } = await admin.auth.admin.createUser({ phone, password: PASSWORD, phone_confirm: true });
  if (error) throw error;
  return data.user.id;
}

async function walletId(admin: SupabaseClient, userId: string, kind: 'customer' | 'merchant') {
  const { data, error } = await admin.from('wallets').select('id').eq('user_id', userId).eq('kind', kind).maybeSingle();
  if (error) throw error;
  return data?.id as string | undefined;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-demo-alerts.ts');
    process.exit(2);
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  let modelVersion = 'demo';
  try { modelVersion = JSON.parse(readFileSync('ml/artifacts/metadata.json', 'utf8')).model_version; } catch { /* keep 'demo' */ }

  // Merchants: a user with role 'merchant' and a merchant wallet (what seed.sql does).
  for (const m of MERCHANTS) {
    const userId = await ensureUser(admin, m.phone);
    const { error: roleErr } = await admin.from('users').update({ role: 'merchant', full_name: `${m.name} Owner` }).eq('id', userId);
    if (roleErr) throw roleErr;
    if (!(await walletId(admin, userId, 'merchant'))) {
      const { error } = await admin.from('wallets').insert({ user_id: userId, kind: 'merchant', merchant_id: m.id, merchant_name: m.name });
      if (error) throw error;
    }
  }

  // Customers: sign in, set the PIN, fund the wallet for this run's payments.
  const sessions: SupabaseClient[] = [];
  const userIds: string[] = [];
  for (const [i, c] of CUSTOMERS.entries()) {
    const userId = await ensureUser(admin, c.phone);
    userIds.push(userId);
    await admin.from('users').update({ full_name: c.name }).eq('id', userId);
    const user = createClient(url, process.env.SUPABASE_ANON_KEY ?? serviceKey, { auth: { persistSession: false } });
    const { error: signInErr } = await user.auth.signInWithPassword({ phone: c.phone, password: PASSWORD });
    if (signInErr) throw signInErr;
    const { error: pinErr } = await user.rpc('set_pin', { p_pin: PIN });
    if (pinErr && !/PIN_ALREADY_SET/.test(pinErr.message)) throw pinErr;
    const needed = ALERTS.filter((a) => a.customer === i).reduce((s, a) => s + a.amount, 0);
    const wid = await walletId(admin, userId, 'customer');
    if (!wid) throw new Error(`no customer wallet for ${c.phone}`);
    const { error: creditErr } = await admin.rpc('admin_credit_wallet', { p_wallet_id: wid, p_amount: needed, p_note: 'Demo funding' });
    if (creditErr) throw creditErr;
    sessions.push(user);
  }

  for (const a of ALERTS) {
    const merchant = MERCHANTS[a.merchant];
    const key = randomUUID();
    const { data: scored, error: scoreErr } = await admin.rpc('record_risk_score', {
      p_user_id: userIds[a.customer], p_merchant_id: merchant.id, p_amount: a.amount, p_idempotency_key: key,
      p_features: features(a.amount, a.merchant), p_source: 'MODEL', p_risk_score: a.risk, p_anomaly_score: a.anomaly,
      p_low_confidence: false, p_model_version: modelVersion, p_latency_ms: 7,
    });
    if (scoreErr) throw scoreErr;
    const { data: paid, error: payErr } = await sessions[a.customer].rpc('make_payment', {
      p_merchant_id: merchant.id, p_amount: a.amount, p_pin: PIN, p_idempotency_key: key, p_score_id: scored.id,
    });
    if (payErr) throw payErr;
    console.log(`${CUSTOMERS[a.customer].phone} -> ${merchant.id} ৳${a.amount}: ${paid.status} / ${paid.risk_decision ?? scored.decision}`);
  }
  const { count } = await admin.from('risk_alerts').select('id', { count: 'exact', head: true });
  console.log(`risk_alerts rows now: ${count}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
