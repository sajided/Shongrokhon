"""Generates supabase/seed_history.sql: Phase 2 personas (testcase.md §0.4)
with months of backdated history, so live scoring sees realistic features.

    python -m shongrokhon_ml.seed_export

Timestamps are written as offsets from today's Dhaka midnight at seed time,
so the history is always in the past and the local hours are kept.
tests/test_seed_personas.py scores these personas with the trained models.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from .synth import ABUSE_AMOUNTS, round_amount

OUT = Path(__file__).resolve().parents[2] / "supabase" / "seed_history.sql"
DAY = 86400


@dataclass(frozen=True)
class Persona:
    key: str
    user_id: str
    phone: str | None  # None = already created by seed.sql
    name: str
    merchant_id: str | None = None
    merchant_name: str | None = None
    final_balance: float = 0.0


U = "33333333-3333-3333-3333-0000000000"
M = "44444444-4444-4444-4444-0000000000"
CUSTOMERS = [
    Persona("U-NORMAL", "11111111-1111-1111-1111-000000000001", None, "Normal User", final_balance=0),  # seed.sql credits ৳5,000
    Persona("U-ABUSER", f"{U}01", "8801911000001", "Abuser User", final_balance=20000),
    Persona("U-NEW", f"{U}02", "8801911000002", "New User"),
    *[Persona(f"RING-01-{i}", f"{U}{10 + i:02d}", f"88019110000{2 + i:02d}", f"Ring Member {i}", final_balance=5000)
      for i in range(1, 9)],
    *[Persona(f"BG-{i:02d}", f"{U}{30 + i:02d}", f"88019111000{i:02d}", f"Neighbour {i}") for i in range(1, 26)],
]
MERCHANTS = [
    Persona("M-LEGIT", "22222222-2222-2222-2222-000000000001", None, "Rahim Store Owner", "MLEGIT0001", "Rahim Store"),
    Persona("M-LEGIT2", f"{M}02", "8801811000002", "Karim Pharmacy Owner", "MLEGIT0002", "Karim Pharmacy"),
    Persona("M-LEGIT3", f"{M}03", "8801811000003", "Dhaka Diner Owner", "MLEGIT0003", "Dhaka Diner"),
    Persona("M-PSEUDO", f"{M}11", "8801811000011", "Quick Mart Owner", "MPSEUDO01", "Quick Mart"),
    Persona("M-PSEUDO2", f"{M}12", "8801811000012", "Star Telecom Owner", "MPSEUDO02", "Star Telecom"),
    Persona("M-PSEUDO3", f"{M}13", "8801811000013", "City Traders Owner", "MPSEUDO03", "City Traders"),
]
LEGIT = {"M-LEGIT": 450, "M-LEGIT2": 350, "M-LEGIT3": 600}  # typical ticket


def events(anchor: int = 0, seed: int = 2026) -> pd.DataFrame:
    """Columns: type (TOPUP|PAYMENT|CASHOUT), payer, payee (persona keys or SYSTEM), amount, ts.
    ts is seconds relative to `anchor` (today's Dhaka midnight); every event is before it."""
    rng = np.random.default_rng(seed)
    ev: list[tuple] = []

    def at(days_ago: int, hour: float) -> int:
        return anchor - days_ago * DAY + int(hour * 3600)

    def pay(payer, payee, amount, ts, topup=False):
        if topup:
            ev.append(("TOPUP", "SYSTEM", payer, float(amount), ts - 60))
        ev.append(("PAYMENT", payer, payee, float(amount), ts))

    def legit_amount(m):
        return round_amount(rng, LEGIT[m] * rng.lognormal(0, 0.3))

    # U-NORMAL: 6 months at three local shops. A shift worker who pays at any
    # hour, so scheduled test runs never look unusual.
    for d in range(180, 0, -1):
        for _ in range(rng.poisson(0.7)):
            m = rng.choice(list(LEGIT), p=[0.6, 0.25, 0.15])
            pay("U-NORMAL", m, legit_amount(m), at(d, rng.uniform(0, 24)))
    # Monthly top-ups that exactly cover the month's spending (final balance stays ৳5,000).
    spend = pd.DataFrame([e for e in ev if e[1] == "U-NORMAL"], columns=["t", "p", "q", "a", "ts"])
    for month, total in spend.groupby((anchor - spend.ts) // (30 * DAY)).a.sum().items():
        ev.append(("TOPUP", "SYSTEM", "U-NORMAL", float(total), anchor - (int(month) + 1) * 30 * DAY))

    # Neighbourhood customers give the legit shops a realistic customer base.
    for i in range(1, 26):
        c, prof = f"BG-{i:02d}", rng.uniform(9, 20)
        for d in range(90, 0, -1):
            for _ in range(rng.poisson(0.3)):
                m = rng.choice(list(LEGIT))
                pay(c, m, legit_amount(m), at(d, float(np.clip(rng.normal(prof, 1.5), 7, 23))), topup=True)
    for c in ("BG-01", "BG-02"):  # one-off cover traffic at the pseudo merchant
        pay(c, "M-PSEUDO", 350.0, at(int(rng.integers(3, 40)), 15.5), topup=True)

    # U-ABUSER: light everyday spending plus round-amount payments to M-PSEUDO.
    for d in range(120, 0, -1):
        if rng.random() < 0.15:
            m = rng.choice(list(LEGIT))
            pay("U-ABUSER", m, legit_amount(m), at(d, rng.uniform(10, 21)), topup=True)
        if rng.random() < 0.25:
            pay("U-ABUSER", "M-PSEUDO", float(rng.choice(ABUSE_AMOUNTS[3:])), at(d, rng.uniform(9, 22)), topup=True)

    # RING-01: eight wallets cycling money through M-PSEUDO2 and M-PSEUDO3 over the last four weeks.
    members = [f"RING-01-{i}" for i in range(1, 9)]
    for c in members:
        for d in range(60, 0, -1):
            if rng.random() < 0.1:
                m = rng.choice(list(LEGIT))
                pay(c, m, legit_amount(m), at(d, rng.uniform(10, 21)), topup=True)
    for d in range(28, 0, -1):
        if rng.random() < 0.45:
            hour = rng.uniform(11, 20)
            for c in members:
                if rng.random() < 0.65:
                    pay(c, rng.choice(["M-PSEUDO2", "M-PSEUDO3"]), float(rng.choice(ABUSE_AMOUNTS[:8])),
                        at(d, hour + rng.uniform(0, 1.5)), topup=True)

    df = pd.DataFrame(ev, columns=["type", "payer", "payee", "amount", "ts"])

    # Merchant cash-outs: shops in the evening, pseudo merchants within minutes.
    cash = []
    for m, g in df[df.type == "PAYMENT"].groupby("payee"):
        if m in LEGIT:
            for day in sorted(set((g.ts - anchor) // DAY)):
                if rng.random() < 0.5:
                    when = anchor + int(day) * DAY + int(rng.uniform(20, 23) * 3600)
                    # Only what the shop has already received that day, so balances never go negative.
                    taken = g.amount[(g.ts >= anchor + int(day) * DAY) & (g.ts < when)].sum()
                    if taken > 0:
                        cash.append(("CASHOUT", m, "SYSTEM", round(float(taken * rng.uniform(0.4, 0.9)), 2), when))
        else:
            for ts, amt in zip(g.ts, g.amount):
                if amt >= 1000 and rng.random() < 0.9:
                    cash.append(("CASHOUT", m, "SYSTEM", round(float(amt * 0.95), 2), int(ts + rng.uniform(5, 30) * 60)))
    df = pd.concat([df, pd.DataFrame(cash, columns=df.columns)], ignore_index=True)
    df = df[df.ts < anchor - 60].copy()  # everything strictly before seed day
    order = {"TOPUP": 0, "PAYMENT": 1, "CASHOUT": 2}
    df["o"] = df.type.map(order)
    df = df.sort_values(["ts", "o"], kind="mergesort").drop(columns="o").reset_index(drop=True)
    df["amount"] = df.amount.round(2)
    return df


def final_topups(df: pd.DataFrame) -> list[tuple[str, float]]:
    """Top-ups that bring each persona to its final balance (plus seed.sql's U-NORMAL ৳5,000)."""
    out = []
    for p in CUSTOMERS:
        if p.final_balance:
            bal = df.loc[(df.type == "TOPUP") & (df.payee == p.key), "amount"].sum() - \
                  df.loc[(df.type == "PAYMENT") & (df.payer == p.key), "amount"].sum()
            out.append((p.key, round(p.final_balance - bal, 2)))
    return out


def render(df: pd.DataFrame) -> str:
    new_users = [p for p in CUSTOMERS + MERCHANTS if p.phone]
    user_values = ",\n    ".join(f"('{p.user_id}'::uuid, '{p.phone}', '{p.name}')" for p in new_users)
    merchant_values = ",\n  ".join(f"('{p.user_id}'::uuid, '{p.merchant_id}', '{p.merchant_name}')"
                                   for p in MERCHANTS if p.phone)
    wallet_values = ",\n  ".join(
        [f"('{p.key}', (select id from public.wallets where user_id = '{p.user_id}' and kind = 'customer'))" for p in CUSTOMERS]
        + [f"('{p.key}', (select id from public.wallets where merchant_id = '{p.merchant_id}'))" for p in MERCHANTS]
    )
    rows = [(r.type, r.payer, r.payee, r.amount, int(r.ts)) for r in df.itertuples(index=False)]
    rows += [("TOPUP", "SYSTEM", k, amt, -30) for k, amt in final_topups(df) if amt > 0]
    event_values = ",\n  ".join(f"({i}, '{t}', '{p}', '{q}', {a:.2f}::numeric, {ts}::bigint)"
                                  for i, (t, p, q, a, ts) in enumerate(rows))

    return f"""-- GENERATED by `python -m shongrokhon_ml.seed_export` — do not edit by hand.
-- Phase 2 personas (testcase.md §0.4) with backdated history. Runs after seed.sql.
--   U-ABUSER  +8801911000001  round-amount payments to M-PSEUDO, final balance ৳20,000, PIN 12345
--   U-NEW     +8801911000002  registered, no transactions, PIN 12345
--   RING-01   +8801911000003..10  8 wallets cycling money through M-PSEUDO2 / M-PSEUDO3
--   M-LEGIT2  MLEGIT0002 "Karim Pharmacy", M-LEGIT3 MLEGIT0003 "Dhaka Diner"
--   M-PSEUDO  MPSEUDO01 "Quick Mart" (cashes out within minutes)
--   M-PSEUDO2 MPSEUDO02 "Star Telecom", M-PSEUDO3 MPSEUDO03 "City Traders" (RING-01)
--   BG-01..25 +8801911100001..25 neighbourhood customers of the legit shops
-- U-NORMAL also gets six months of history; its final balance stays ৳5,000.
-- Ledger rows keep the seed time as created_at (the ledger is append-only);
-- transactions.created_at carries the historical time used by risk features.

do $$
declare
  r record;
begin
  for r in
    select * from (values
    {user_values}
    ) as v (id, phone, name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, phone, phone_confirmed_at, encrypted_password,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone_change, phone_change_token, email_change_token_current, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.phone, now(), '',
      '{{"provider":"phone","providers":["phone"]}}', '{{}}', now(), now(),
      '', '', '', '', '', '', '', ''
    ) on conflict (id) do nothing;
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), r.id, r.id::text, 'phone', jsonb_build_object('sub', r.id::text, 'phone', r.phone), now(), now(), now())
    on conflict do nothing;
    update public.users set full_name = r.name, pin_hash = extensions.crypt('12345', extensions.gen_salt('bf', 8)) where id = r.id;
  end loop;
end $$;

update public.users set role = 'merchant' where id in (select id from (values
  {merchant_values}
) as v (id, merchant_id, merchant_name));

insert into public.wallets (user_id, kind, merchant_id, merchant_name)
select id, 'merchant', merchant_id, merchant_name from (values
  {merchant_values}
) as v (id, merchant_id, merchant_name)
on conflict (user_id, kind) do nothing;

-- One DO block: the CLI sends seed files as a prepared batch, so no temp tables.
do $$
declare
  r record;
  v_system constant uuid := '00000000-0000-0000-0000-00000000a001';
  v_anchor constant timestamptz := date_trunc('day', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka';
  v_wallets jsonb;
  v_payer uuid;
  v_payee uuid;
  v_merchant public.wallets;
  v_txn uuid;
  v_at timestamptz;
begin
  select jsonb_object_agg(k, w) into v_wallets from (values
  {wallet_values}
  ) as v (k, w);

  -- (seq, type, payer, payee, amount, seconds relative to today's Dhaka midnight)
  for r in
    select * from (values
  {event_values}
    ) as e (seq, type, payer, payee, amount, rel_ts)
    order by seq
  loop
    v_payer := coalesce((v_wallets ->> r.payer)::uuid, v_system);
    v_payee := coalesce((v_wallets ->> r.payee)::uuid, v_system);
    v_at := v_anchor + make_interval(secs => r.rel_ts);
    if r.type = 'TOPUP' then
      v_txn := private.post_transfer('TOPUP', v_system, v_payee, r.amount, gen_random_uuid(), 'Cash in',
        jsonb_build_object('out_name', 'Customer top-up', 'in_name', 'Wallet top-up'));
    elsif r.type = 'PAYMENT' then
      select * into v_merchant from public.wallets where id = v_payee;
      v_txn := private.post_transfer('PAYMENT', v_payer, v_payee, r.amount, gen_random_uuid(), null,
        jsonb_build_object('out_name', v_merchant.merchant_name, 'out_ref', v_merchant.merchant_id,
                           'in_name', 'Customer', 'in_ref', private.mask_phone(
                             (select u.phone from public.users u join public.wallets w on w.user_id = u.id where w.id = v_payer))));
    else
      v_txn := private.post_transfer('CASHOUT', v_payer, v_system, r.amount, gen_random_uuid(), null,
        jsonb_build_object('out_name', 'Cash out', 'in_name', 'Cash out'));
    end if;
    -- Final top-ups (rel_ts just before midnight) keep the real seed time.
    if r.rel_ts < -60 then
      update public.transactions set created_at = v_at, updated_at = v_at where id = v_txn;
    end if;
  end loop;
end $$;
"""


def main() -> None:
    df = events()
    OUT.write_text(render(df))
    counts = df.type.value_counts().to_dict()
    print(f"wrote {OUT}: {counts}")


if __name__ == "__main__":
    main()
