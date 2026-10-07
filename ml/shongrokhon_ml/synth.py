"""Deterministic synthetic MFS history (testcase.md §0.4 personas at scale).

There is no real MFS data, so the models are trained on a seeded simulation of
the behaviours the PRD describes. The simulation is fully deterministic for a
given seed, so models and reports are reproducible (TC-P2-XGB-02).

Events table columns:
    txn_id   int     unique, increasing with ts
    type     str     PAYMENT | CASHOUT
    payer    str     wallet id (customer for PAYMENT, any wallet for CASHOUT)
    payee    str     merchant wallet id for PAYMENT, "SYSTEM" for CASHOUT
    amount   float   BDT, two decimals
    ts       int     epoch seconds (UTC)
    label    int     1 = disguised cash-out payment, 0 otherwise

Wallets table columns: wallet, kind (customer|merchant), segment, region, start_day.
Segments: normal, cashheavy, drift, abuser, ring (customers); legit, pseudo, ring_pseudo (merchants).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import pandas as pd

# Bump when the simulation changes so model versions change with it.
GENERATOR_VERSION = 5
DAY = 86400
# Day 0 of the labelled window. History starts BURN_IN_DAYS earlier so that the
# 90-day payer features are fully populated for the first labelled rows.
DAY0 = int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp())
BURN_IN_DAYS = 90
WINDOW_DAYS = 182
# First day of the hold-out month (dataset.VAL_END_DAY). Held-out pseudo merchants
# and rings only start operating here, so the test split contains cash-out
# channels the models never saw in training.
TEST_START_DAY = 151
DHAKA_OFFSET = 6 * 3600

REGIONS = ["Dhaka", "Chattogram", "Khulna", "Rajshahi", "Barishal", "Sylhet", "Rangpur", "Mymensingh"]
CATEGORIES = {  # category -> typical ticket (BDT)
    "grocery": 250, "pharmacy": 450, "restaurant": 380, "clothing": 1500,
    "electronics": 4000, "utilities": 1100, "recharge": 150, "transport": 120,
    "tuition": 2000, "rent": 5000,
}
ROUND_TICKET = {"tuition", "rent"}  # legit merchants paid in round amounts (hard negatives)
ABUSE_AMOUNTS = np.array([800, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000, 20000], dtype=float)


@dataclass(frozen=True)
class SynthConfig:
    seed: int = 42
    n_normal: int = 1000
    n_cashheavy: int = 150
    n_drift: int = 80
    n_abuser: int = 80
    n_rings: int = 4
    ring_size: int = 8
    n_legit_merchants: int = 120
    n_pseudo_merchants: int = 10
    # Realism knobs (generator v5). Each one removes a shortcut the models could
    # otherwise learn, so the hold-out scores reflect a genuinely hard problem.
    holdout_pseudo: int = 3          # pseudo merchants that only open in the hold-out month
    holdout_rings: int = 1           # rings that only start cycling money in the hold-out month
    mimic_share: float = 0.15        # abusers who use in-pattern amounts and their own hours
    abuser_legit_share: float = 0.1  # share of abuse payments routed through legit "fast" shops
    pseudo_cashout_lo: float = 0.4   # lowest per-receipt cash-out probability of a pseudo merchant
    pseudo_lag_hi_max: float = 600.0 # slowest pseudo merchants cash out up to this many minutes later
    cover_share: float = 0.08        # share of random-shop traffic that is legit spending at pseudo merchants
    fast_shop_share: float = 0.25    # legit shops that cash out receipts within hours


def local_ts(day: int, hour: float) -> int:
    """Epoch seconds for `hour` (Dhaka local, may be fractional) on labelled-window day `day`."""
    return int(DAY0 - DHAKA_OFFSET + day * DAY + hour * 3600)


def dhaka_hour(ts: np.ndarray | int) -> np.ndarray | int:
    return ((np.asarray(ts) + DHAKA_OFFSET) // 3600) % 24


def round_amount(rng: np.random.Generator, x: float) -> float:
    r = rng.random()
    step = 10 if r < 0.7 else 50 if r < 0.9 else 100
    return float(max(10, round(x / step) * step))


class _Builder:
    def __init__(self, cfg: SynthConfig):
        self.cfg = cfg
        self.rng = np.random.default_rng(cfg.seed)
        self.rows: list[tuple[str, str, str, float, int, int]] = []
        self.wallets: list[dict] = []

    def add_wallet(self, wallet: str, kind: str, segment: str, start_day: int) -> None:
        self.wallets.append({
            "wallet": wallet, "kind": kind, "segment": segment,
            "region": REGIONS[int(self.rng.integers(len(REGIONS)))], "start_day": start_day,
        })

    def pay(self, payer: str, payee: str, amount: float, ts: int, label: int = 0) -> None:
        self.rows.append(("PAYMENT", payer, payee, round(float(amount), 2), int(ts), label))

    def cashout(self, wallet: str, amount: float, ts: int) -> None:
        if amount > 0:
            self.rows.append(("CASHOUT", wallet, "SYSTEM", round(float(amount), 2), int(ts), 0))

    def hour_profile(self) -> tuple[float, float]:
        a = float(self.rng.uniform(9, 14))
        return a, float(self.rng.uniform(max(a + 3, 16), 21.5))

    def sample_hour(self, profile: tuple[float, float], shift: float = 0.0) -> float:
        centre = profile[0] if self.rng.random() < 0.5 else profile[1]
        return float(np.clip(self.rng.normal(centre + shift, 1.2), 6.0, 23.9))


def generate(cfg: SynthConfig = SynthConfig()) -> tuple[pd.DataFrame, pd.DataFrame]:
    b = _Builder(cfg)
    rng = b.rng
    first_day, last_day = -BURN_IN_DAYS, WINDOW_DAYS

    # --- merchants -------------------------------------------------------------
    cats = list(CATEGORIES)
    legit = []
    for i in range(cfg.n_legit_merchants):
        start = first_day - 200 if rng.random() < 0.8 else int(rng.integers(first_day, last_day - 30))
        # Some real shops cash out each receipt quickly (hard negatives for the cash-out features).
        m = {"id": f"m{i:03d}", "cat": cats[i % len(cats)], "start": start, "fast": bool(rng.random() < cfg.fast_shop_share),
             # Heavy-tailed popularity: a few busy shops and many small ones, so a
             # merchant's number of customers is not a label proxy.
             "pop": float(rng.pareto(1.0) + 1)}
        legit.append(m)
        b.add_wallet(m["id"], "merchant", "legit", start)
    # The last `holdout_pseudo` pseudo merchants only open in the hold-out month:
    # new mule merchants the model has never seen (the real-world case).
    pseudo = [f"p{i:02d}" for i in range(cfg.n_pseudo_merchants)]
    pseudo_open = {p: TEST_START_DAY if i >= cfg.n_pseudo_merchants - cfg.holdout_pseudo else first_day
                   for i, p in enumerate(pseudo)}
    for p in pseudo:
        b.add_wallet(p, "merchant", "pseudo", pseudo_open[p])
    ring_merchants = [[f"r{r}m{j}" for j in range(2)] for r in range(cfg.n_rings)]
    ring_open = [TEST_START_DAY if r >= cfg.n_rings - cfg.holdout_rings else first_day for r in range(cfg.n_rings)]
    for pair, start in zip(ring_merchants, ring_open):
        for p in pair:
            b.add_wallet(p, "merchant", "ring_pseudo", start)

    def legit_open(day: int) -> list[dict]:
        return [m for m in legit if m["start"] <= day]

    def pseudo_open_on(day: int) -> list[str]:
        return [p for p in pseudo if pseudo_open[p] <= day]

    def fast_open(day: int) -> list[dict]:
        return [m for m in legit if m["fast"] and m["start"] <= day]

    def pick_legit(pool: list[dict], size: int = 1) -> list[dict]:
        """Sample shops in proportion to their popularity (without replacement)."""
        p = np.array([m["pop"] for m in pool])
        idx = rng.choice(len(pool), size=min(size, len(pool)), replace=False, p=p / p.sum())
        return [pool[int(i)] for i in idx]

    # --- customers ---------------------------------------------------------------
    def customer_start() -> int:
        return first_day if rng.random() < 0.85 else int(rng.integers(first_day, last_day - 20))

    def normal_payments(cid: str, start: int, rate: float, drift: bool = False, end: int = last_day,
                        profile: tuple[float, float] | None = None) -> None:
        profile = profile or b.hour_profile()
        scale = float(rng.lognormal(0, 0.3))
        open_now = [m for m in legit_open(start)] or legit
        favs = pick_legit(open_now, int(rng.integers(3, 8)))
        weights = rng.dirichlet(np.ones(len(favs)))
        alt_favs = None
        for day in range(start, end):
            # Drifting users move to new merchants, later hours and bigger tickets over months 4-6.
            progress = 0.0
            if drift and day > 90:
                progress = min(1.0, (day - 90) / 90)
                if alt_favs is None:
                    alt_favs = pick_legit(legit_open(day), 4)
            for _ in range(rng.poisson(rate / 30)):
                if alt_favs is not None and rng.random() < progress:
                    m = alt_favs[int(rng.integers(len(alt_favs)))]
                elif rng.random() < 0.9:
                    m = favs[int(rng.choice(len(favs), p=weights))]
                else:
                    open_pseudo = pseudo_open_on(day)
                    if open_pseudo and rng.random() < cfg.cover_share:  # legitimate payment to a pseudo merchant (cover traffic)
                        b.pay(cid, open_pseudo[int(rng.integers(len(open_pseudo)))], round_amount(rng, rng.uniform(100, 900)),
                              local_ts(day, b.sample_hour(profile)))
                        continue
                    m = pick_legit(legit_open(day))[0]
                if m["start"] > day:
                    continue
                hour = b.sample_hour(profile, shift=4 * progress)
                if rng.random() < 0.012:  # occasional big legitimate purchase (hard negative)
                    big = [x for x in legit_open(day) if x["cat"] in ("electronics", "clothing")]
                    m = big[int(rng.integers(len(big)))]
                    amt = float(rng.choice([3000, 5000, 8000, 10000, 12000, 15000]))
                elif m["cat"] in ROUND_TICKET:
                    amt = float(max(500, round(CATEGORIES[m["cat"]] * scale * rng.lognormal(0, 0.3) / 500) * 500))
                else:
                    amt = round_amount(rng, CATEGORIES[m["cat"]] * scale * (1 + progress * 0.8) * rng.lognormal(0, 0.35))
                b.pay(cid, m["id"], amt, local_ts(day, hour))
                if rng.random() < 0.06:  # back for something forgotten: a second, smaller payment minutes later
                    b.pay(cid, m["id"], round_amount(rng, amt * rng.uniform(0.1, 0.6)),
                          local_ts(day, hour) + int(rng.uniform(1, 12) * 60))

    cid = 0

    def new_customer(segment: str, start: int) -> str:
        nonlocal cid
        c = f"c{cid:05d}"
        cid += 1
        b.add_wallet(c, "customer", segment, start)
        return c

    for _ in range(cfg.n_normal):
        start = customer_start()
        normal_payments(new_customer("normal", start), start, float(rng.uniform(8, 35)))

    for _ in range(cfg.n_drift):
        start = first_day
        normal_payments(new_customer("drift", start), start, float(rng.uniform(12, 30)), drift=True)

    for _ in range(cfg.n_cashheavy):
        start = customer_start()
        c = new_customer("cashheavy", start)
        normal_payments(c, start, float(rng.uniform(6, 20)))
        for day in range(start, last_day):
            for _ in range(rng.poisson(rng.uniform(8, 15) / 30)):
                b.cashout(c, float(rng.choice([500, 1000, 1500, 2000, 3000, 5000])), local_ts(day, rng.uniform(9, 21)))

    # Abusers: some background spending plus disguised cash-outs through a pseudo
    # merchant. "Mimics" copy their own spending pattern (in-pattern amounts, their
    # usual hours); some abuse goes through legit fast shops, so the merchant's
    # cash-out habits alone cannot separate the classes.
    # Abusers join at the same rate as everyone else (customer_start), so account
    # age is not a label proxy: a brand-new customer paying a shop must stay ALLOW.
    for _ in range(cfg.n_abuser):
        start = customer_start()
        c = new_customer("abuser", start)
        profile = b.hour_profile()
        normal_payments(c, start, float(rng.uniform(3, 12)), profile=profile)
        mimic = rng.random() < cfg.mimic_share
        targets = list(rng.choice(pseudo, size=int(rng.integers(1, 3)), replace=False))
        rate = float(rng.uniform(4, 12))
        for day in range(start, last_day):
            for _ in range(rng.poisson(rate / 30)):
                if mimic:
                    amt = round_amount(rng, rng.uniform(600, 4000))
                    hour = b.sample_hour(profile)
                else:
                    amt = float(rng.choice(ABUSE_AMOUNTS))
                    if rng.random() < 0.25:  # some abusers avoid perfectly round amounts
                        amt += float(rng.choice([50, 150, 250]))
                    hour = float(rng.uniform(8, 23.5))
                fast_shops = fast_open(day)
                if fast_shops and rng.random() < cfg.abuser_legit_share:
                    payee = fast_shops[int(rng.integers(len(fast_shops)))]["id"]
                else:
                    payee = targets[int(rng.integers(len(targets)))]
                    if pseudo_open[payee] > day:
                        continue
                b.pay(c, payee, amt, local_ts(day, hour), label=1)

    # Rings (RING-01 shape): members cycle money through their two dedicated merchants.
    for r in range(cfg.n_rings):
        members = [new_customer("ring", first_day) for _ in range(cfg.ring_size)]
        for c in members:
            normal_payments(c, first_day, float(rng.uniform(3, 10)))
        for day in range(ring_open[r], last_day):
            if rng.random() < 0.35:  # a coordinated "session"
                hour = float(rng.uniform(10, 22))
                for c in members:
                    if rng.random() < 0.6:
                        amt = float(rng.choice(ABUSE_AMOUNTS[:8]))
                        b.pay(c, ring_merchants[r][int(rng.integers(2))], amt,
                              local_ts(day, hour + rng.uniform(0, 1.5)), label=1)

    events = pd.DataFrame(b.rows, columns=["type", "payer", "payee", "amount", "ts", "label"])
    events = events.sort_values(["ts", "type", "payer"], kind="mergesort").reset_index(drop=True)

    # --- merchant cash-outs ----------------------------------------------------
    # Most legit shops cash out part of the day's takings in the evening; "fast"
    # shops cash out receipts within hours. Pseudo merchants empty most receipts
    # within minutes, each with its own habits.
    cash_rows = []
    pay = events[events.type == "PAYMENT"]
    merchant_seg = {w["wallet"]: w["segment"] for w in b.wallets}
    fast = {m["id"] for m in legit if m["fast"]}
    # (cash-out probability per receipt, min lag, max lag in minutes). Ring
    # merchants exist to cycle money out, so they cash out nearly everything.
    habits = {w: (rng.uniform(0.8, 0.98) if seg == "ring_pseudo" else rng.uniform(cfg.pseudo_cashout_lo, 0.95),
                  rng.uniform(3, 30), rng.uniform(40, cfg.pseudo_lag_hi_max))
              for w, seg in merchant_seg.items() if seg in ("pseudo", "ring_pseudo")}
    for m, grp in pay.groupby("payee", sort=True):
        if m in fast:
            for ts, amt in zip(grp.ts.values, grp.amount.values):
                if rng.random() < 0.5:
                    cash_rows.append(("CASHOUT", m, "SYSTEM", round(float(amt * rng.uniform(0.7, 1.0)), 2),
                                      int(ts + rng.uniform(10, 180) * 60), 0))
        elif merchant_seg[m] == "legit":
            days = (grp.ts.values - (DAY0 - DHAKA_OFFSET)) // DAY
            for day, amt in pd.Series(grp.amount.values).groupby(days).sum().items():
                if rng.random() < 0.5:
                    cash_rows.append(("CASHOUT", m, "SYSTEM", round(float(amt * rng.uniform(0.4, 0.9)), 2),
                                      local_ts(int(day), rng.uniform(19, 23)), 0))
        else:
            prob, lag_lo, lag_hi = habits[m]
            for ts, amt in zip(grp.ts.values, grp.amount.values):
                if rng.random() < prob:
                    cash_rows.append(("CASHOUT", m, "SYSTEM", round(float(amt * rng.uniform(0.85, 0.98)), 2),
                                      int(ts + rng.uniform(lag_lo, lag_hi) * 60), 0))

    events = pd.concat([events, pd.DataFrame(cash_rows, columns=events.columns)], ignore_index=True)
    events = events[events.ts < DAY0 - DHAKA_OFFSET + last_day * DAY]
    events = events.sort_values(["ts", "type", "payer"], kind="mergesort").reset_index(drop=True)
    events.insert(0, "txn_id", np.arange(len(events)))
    wallets = pd.DataFrame(b.wallets)
    return events, wallets


def labelled_window(events: pd.DataFrame) -> pd.DataFrame:
    """Payments inside the labelled window (after burn-in) — the rows models are trained/evaluated on."""
    return events[(events.type == "PAYMENT") & (events.ts >= DAY0)]
