"""Hand-built transactions for established users, used to check the anomaly
model against testcase.md §2.2 (IF-02..05) in both evaluate.py and the tests."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import features as F
from .synth import DAY, local_ts

SCENARIO_DAY = 165  # inside the test month


def established_users(events: pd.DataFrame, wallets: pd.DataFrame, data: pd.DataFrame, n: int = 60) -> list[str]:
    """Normal-segment test users with plenty of history before the scenario day."""
    cutoff = local_ts(SCENARIO_DAY, 0)
    pay = events[(events.type == "PAYMENT") & (events.ts < cutoff) & (events.ts >= cutoff - 90 * DAY)]
    counts = pay.groupby("payer").size()
    test_users = set(data.loc[data.user_split == "test", "payer"])
    normal = set(wallets.loc[wallets.segment == "normal", "wallet"])
    eligible = sorted(w for w in counts[counts >= 30].index if w in test_users and w in normal)
    return eligible[:n]


def _profile(events: pd.DataFrame, user: str) -> tuple[str, float, int]:
    cutoff = local_ts(SCENARIO_DAY, 0)
    mine = events[(events.type == "PAYMENT") & (events.payer == user) & (events.ts < cutoff) & (events.ts >= cutoff - 90 * DAY)]
    merchant = mine.payee.value_counts().index[0]
    median = float(np.median(mine.amount[mine.payee == merchant]))  # usual ticket at the usual merchant
    hour = int(pd.Series(F.dhaka_hour(int(t)) for t in mine.ts).mode().iloc[0])
    return merchant, median, hour


def build(events: pd.DataFrame, users: list[str]) -> pd.DataFrame:
    """Rows: user, scenario, payer, payee, amount, ts, plus features."""
    history = F.History(events)
    rows = []
    for u in users:
        merchant, median, hour = _profile(events, u)
        usual = round(median / 10) * 10 or 10
        at = local_ts(SCENARIO_DAY, hour + 0.25)
        rows.append(dict(user=u, scenario="in_pattern", payer=u, payee=merchant, amount=usual, ts=at))
        rows.append(dict(user=u, scenario="spike_10x", payer=u, payee=merchant, amount=usual * 10, ts=at))
        rows.append(dict(user=u, scenario="night_3am", payer=u, payee=merchant, amount=usual, ts=local_ts(SCENARIO_DAY, 3.25)))
    out = pd.DataFrame(rows)
    feats = F.compute(history, out)

    # Velocity burst (IF-05): 5 earlier payments in the last 9 minutes to a merchant the user never used.
    burst_rows = []
    legit = sorted(set(events.loc[events.payee.str.startswith("m"), "payee"]))
    for u in users:
        _, median, hour = _profile(events, u)
        used = set(events.loc[events.payer == u, "payee"])
        new_merchant = next(m for m in legit if m not in used)
        usual = round(median / 10) * 10 or 10
        at = local_ts(SCENARIO_DAY, hour + 0.5)
        extra = pd.DataFrame([dict(txn_id=-1, type="PAYMENT", payer=u, payee=new_merchant, amount=usual,
                                   ts=at - k * 100, label=0) for k in range(5, 0, -1)])
        h = F.History(pd.concat([events[(events.payer == u) | (events.payee == new_merchant)], extra], ignore_index=True))
        burst_rows.append({"user": u, "scenario": "velocity_burst", "payer": u, "payee": new_merchant, "ts": at,
                           **h.features(u, new_merchant, usual, at)})
    burst = pd.DataFrame(burst_rows)
    return pd.concat([pd.concat([out.drop(columns="amount"), feats], axis=1), burst], ignore_index=True)
