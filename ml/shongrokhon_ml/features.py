"""Point-in-time risk features.

These definitions MUST match `private.risk_features` in
supabase/migrations/20261002000006_risk.sql. `fixtures/parity.json` (written by
`python -m shongrokhon_ml.parity`) is checked against the SQL implementation by
tests/integration/risk.test.ts, so train/serve skew fails a test.

Every window is half-open: [at - window, at). Only events strictly before `at`
count, so the transaction being scored never sees itself.

Hours are Asia/Dhaka local time (UTC+6, no DST).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

DAY = 86400
DHAKA_OFFSET = 6 * 3600
LAG_CAP_MIN = 1440.0
AGE_CAP_DAYS = 365.0
CASHOUT_RATIO_CAP = 5.0
LOW_CONFIDENCE_MIN_TXNS = 5

FEATURES = [
    "amount",
    "log_amount",
    "is_round_100",
    "is_round_1000",
    "hour_sin",
    "hour_cos",
    "is_night",
    "payer_txn_count_90d",
    "payer_median_amount_90d",
    "amount_to_median",
    "payer_hour_share",
    "payer_cashout_count_30d",
    "payer_txn_count_1h",
    "payer_merchant_prior_count",
    "amount_to_merchant_median",
    "merchant_new_for_payer",
    "payer_merchant_count_10m",
    "merchant_distinct_payers_30d",
    "merchant_round_share_30d",
    "merchant_cashout_ratio_7d",
    "merchant_cashout_lag_min",
    "merchant_age_days",
]

# Behavioural (user-relative) features for the Isolation Forest.
ANOMALY_FEATURES = [
    "log_amount_to_merchant_median",
    "payer_hour_share",
    "payer_txn_count_1h",
    "payer_merchant_count_10m",
]


def dhaka_hour(ts: int) -> int:
    return int(((ts + DHAKA_OFFSET) // 3600) % 24)


@dataclass
class _Stream:
    ts: np.ndarray
    amount: np.ndarray
    other: np.ndarray  # payee for payer streams, payer for merchant streams
    hour: np.ndarray


@dataclass
class _Pair:
    ts: np.ndarray
    amount: np.ndarray


def _streams(df: pd.DataFrame, key: str, other: str) -> dict[str, _Stream]:
    out = {}
    for k, g in df.groupby(key, sort=False):
        g = g.sort_values("ts", kind="mergesort")
        ts = g.ts.to_numpy(dtype=np.int64)
        out[k] = _Stream(ts, g.amount.to_numpy(dtype=float), g[other].to_numpy(), ((ts + DHAKA_OFFSET) // 3600) % 24)
    return out


class History:
    """Indexes an events table (see synth.py) for fast point-in-time lookups."""

    def __init__(self, events: pd.DataFrame):
        pay = events[events.type == "PAYMENT"]
        cash = events[events.type == "CASHOUT"]
        self.payer = _streams(pay, "payer", "payee")
        self.merchant = _streams(pay, "payee", "payer")
        self.pair = {}
        for k, g in pay.groupby(["payer", "payee"], sort=False):
            g = g.sort_values("ts", kind="mergesort")
            self.pair[k] = _Pair(g.ts.to_numpy(dtype=np.int64), g.amount.to_numpy(dtype=float))
        self.cash: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
        for w, g in cash.groupby("payer", sort=False):
            g = g.sort_values("ts", kind="mergesort")
            ts = g.ts.to_numpy(dtype=np.int64)
            recv = self.merchant.get(w)
            lag = np.full(len(ts), LAG_CAP_MIN)
            if recv is not None:
                # Latest receipt strictly before each cash-out.
                idx = np.searchsorted(recv.ts, ts, side="left") - 1
                ok = idx >= 0
                lag[ok] = np.minimum((ts[ok] - recv.ts[idx[ok]]) / 60.0, LAG_CAP_MIN)
            self.cash[w] = (ts, g.amount.to_numpy(dtype=float), lag)

    def features(self, payer: str, payee: str, amount: float, at: int) -> dict[str, float]:
        f: dict[str, float] = {}
        amount = float(amount)
        hour = dhaka_hour(at)
        f["amount"] = amount
        f["log_amount"] = math.log1p(amount)
        f["is_round_100"] = float(round(amount * 100) % 10000 == 0)
        f["is_round_1000"] = float(round(amount * 100) % 100000 == 0)
        f["hour_sin"] = math.sin(2 * math.pi * hour / 24)
        f["hour_cos"] = math.cos(2 * math.pi * hour / 24)
        f["is_night"] = float(hour < 5)

        # Payer, 90 days.
        p = self.payer.get(payer)
        if p is not None:
            hi = np.searchsorted(p.ts, at, side="left")
            lo = np.searchsorted(p.ts, at - 90 * DAY, side="left")
            amts = p.amount[lo:hi]
            n = hi - lo
            f["payer_txn_count_90d"] = float(n)
            med = float(np.median(amts)) if n else 0.0
            f["payer_median_amount_90d"] = med
            f["amount_to_median"] = amount / med if med > 0 else 1.0
            if n:
                d = np.abs(p.hour[lo:hi] - hour)
                d = np.minimum(d, 24 - d)
                f["payer_hour_share"] = float(np.mean(d <= 1))
            else:
                f["payer_hour_share"] = 0.0
            f["payer_txn_count_1h"] = float(hi - np.searchsorted(p.ts, at - 3600, side="left"))
        else:
            f.update(payer_txn_count_90d=0.0, payer_median_amount_90d=0.0, amount_to_median=1.0,
                     payer_hour_share=0.0, payer_txn_count_1h=0.0)

        c = self.cash.get(payer)
        if c is not None:
            f["payer_cashout_count_30d"] = float(
                np.searchsorted(c[0], at, side="left") - np.searchsorted(c[0], at - 30 * DAY, side="left"))
        else:
            f["payer_cashout_count_30d"] = 0.0

        # Payer -> this merchant.
        pt = self.pair.get((payer, payee))
        if pt is not None:
            hi = np.searchsorted(pt.ts, at, side="left")
            lo = np.searchsorted(pt.ts, at - 90 * DAY, side="left")
            prior = hi - lo
            f["payer_merchant_prior_count"] = float(prior)
            pmed = float(np.median(pt.amount[lo:hi])) if prior else 0.0
            f["amount_to_merchant_median"] = amount / pmed if pmed > 0 else 1.0
            f["merchant_new_for_payer"] = float(prior == 0)
            f["payer_merchant_count_10m"] = float(hi - np.searchsorted(pt.ts, at - 600, side="left"))
        else:
            f.update(payer_merchant_prior_count=0.0, amount_to_merchant_median=1.0, merchant_new_for_payer=1.0,
                     payer_merchant_count_10m=0.0)

        # Merchant.
        m = self.merchant.get(payee)
        recv7 = 0.0
        if m is not None:
            hi = np.searchsorted(m.ts, at, side="left")
            lo = np.searchsorted(m.ts, at - 30 * DAY, side="left")
            n = hi - lo
            f["merchant_distinct_payers_30d"] = float(len(np.unique(m.other[lo:hi]))) if n else 0.0
            if n:
                cents = np.round(m.amount[lo:hi] * 100)
                f["merchant_round_share_30d"] = float(np.mean(cents % 100000 == 0))
            else:
                f["merchant_round_share_30d"] = 0.0
            lo7 = np.searchsorted(m.ts, at - 7 * DAY, side="left")
            recv7 = float(m.amount[lo7:hi].sum())
            f["merchant_age_days"] = min((at - m.ts[0]) / DAY, AGE_CAP_DAYS) if hi > 0 else 0.0
        else:
            f.update(merchant_distinct_payers_30d=0.0, merchant_round_share_30d=0.0, merchant_age_days=0.0)

        mc = self.cash.get(payee)
        if mc is not None:
            ts, amt, lag = mc
            hi = np.searchsorted(ts, at, side="left")
            lo7 = np.searchsorted(ts, at - 7 * DAY, side="left")
            lo30 = np.searchsorted(ts, at - 30 * DAY, side="left")
            out7 = float(amt[lo7:hi].sum())
            f["merchant_cashout_ratio_7d"] = min(out7 / recv7, CASHOUT_RATIO_CAP) if recv7 > 0 else 0.0
            f["merchant_cashout_lag_min"] = float(np.median(lag[lo30:hi])) if hi > lo30 else LAG_CAP_MIN
        else:
            f["merchant_cashout_ratio_7d"] = 0.0
            f["merchant_cashout_lag_min"] = LAG_CAP_MIN
        return {k: f[k] for k in FEATURES}


def compute(history: History, queries: pd.DataFrame) -> pd.DataFrame:
    """Features for each query row (payer, payee, amount, ts) using only history before its ts."""
    rows = [history.features(r.payer, r.payee, r.amount, int(r.ts)) for r in queries.itertuples(index=False)]
    return pd.DataFrame(rows, columns=FEATURES, index=queries.index)


def low_confidence(features: pd.DataFrame | dict) -> np.ndarray | bool:
    return features["payer_txn_count_90d"] < LOW_CONFIDENCE_MIN_TXNS


def anomaly_matrix(features: pd.DataFrame) -> pd.DataFrame:
    out = features.copy()
    # Only above-usual amounts matter for cash-out risk; smaller tickets (a second
    # purchase, a top-up) are clipped to 0 so they don't stretch the feature range.
    out["log_amount_to_median"] = np.log(np.maximum(out["amount_to_median"].astype(float), 1.0))
    out["log_amount_to_merchant_median"] = np.log(np.maximum(out["amount_to_merchant_median"].astype(float), 1.0))
    return out[ANOMALY_FEATURES].astype(float)
