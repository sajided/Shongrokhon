"""Network risk batch job (PRD §4.1 "Network Risk Intelligence", TC-P2-FLOW-08).

Every run looks at the last 30 days of payments and cash-outs:
  1. Scores each merchant for cash-out-like behaviour: share of receipts cashed
     out, share of round-amount receipts, and share of receipts mirrored by a
     cash-out (80-100% of it, within an hour). A merchant is suspicious when it
     cashes out most of what it receives AND its receipts are round or mirrored.
  2. Builds a payer-merchant graph from payers with 2 or more payments into suspicious merchants.
  3. Keeps small connected groups whole and splits large ones into communities
     (Louvain). A group with MIN_RING_SIZE or more payers, mostly paying round
     amounts, is a ring: one RING alert lists all of its wallets, and they are
     all flagged.
  4. Stores a network-risk score per merchant: 0.8-1.0 for merchants inside a
     detected ring, below 0.5 otherwise. Live scoring forces FLAG at
     app_config.network_flag_threshold (0.8) or above.

    python -m shongrokhon_ml.network --once          # one run (tests)
    python -m shongrokhon_ml.network --interval 3600 # hourly loop
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass, field

import networkx as nx
import numpy as np
import pandas as pd

log = logging.getLogger("shongrokhon_ml.network")

WINDOW_DAYS = 30
FAST_CASHOUT_MIN = 60
MIN_CASHOUT_RATIO = 0.55
MIN_PATTERN_SHARE = 0.3  # round-amount or mirrored receipts
MIN_RING_ROUND_SHARE = 0.5  # most money inside a ring moves in round amounts
ROUND_CENTS = 50000  # "round" here = a multiple of ৳500
MAX_UNSPLIT_PAYERS = 12   # rings are 5-10 wallets (testcase.md §0.4); bigger groups get split
LOUVAIN_RESOLUTION = 0.5  # favour whole rings over splitting them per merchant
MIN_RING_SIZE = 5
MIN_REPEAT_PAYMENTS = 2
NON_RING_DAMPING = 0.5  # a merchant outside any ring stays below the FLAG override
MIN_MERCHANT_PAYMENTS = 10  # too few receipts to judge a merchant's habits (a new shop is not a mule)
SESSION_WINDOW_MIN = 30     # ring members pay in coordinated sessions: minutes apart, not hours
                            # (a busy pseudo merchant used by unrelated abusers has another payer
                            # within 2 h by chance, but rarely within 30 min)
MIN_SESSION_SHARE = 0.5     # share of a group's payments that have another member paying in the same session


@dataclass
class Ring:
    payers: list[str]
    merchants: list[str]
    score: float
    flow: float
    payments: int
    fingerprint: str = field(init=False)

    def __post_init__(self) -> None:
        key = "|".join(sorted(self.payers)) + "#" + "|".join(sorted(self.merchants))
        self.fingerprint = hashlib.sha1(key.encode()).hexdigest()


def mirrored_share(receipts: pd.DataFrame, cashouts: pd.DataFrame) -> float:
    """Share of receipts followed within FAST_CASHOUT_MIN by a cash-out of 80-100% of that receipt."""
    c_ts, c_amt = cashouts.ts.to_numpy(), cashouts.amount.to_numpy()
    hits = 0
    for ts, amt in zip(receipts.ts.to_numpy(), receipts.amount.to_numpy()):
        lo, hi = np.searchsorted(c_ts, ts, side="right"), np.searchsorted(c_ts, ts + FAST_CASHOUT_MIN * 60, side="right")
        share = c_amt[lo:hi] / amt
        hits += bool(((share >= 0.8) & (share <= 1.0)).any())
    return hits / len(receipts)


def session_share(flows: pd.DataFrame) -> float:
    """Share of a group's payments made within SESSION_WINDOW_MIN of a payment by a
    *different* member of the group. Rings move money in coordinated sessions;
    unrelated abusers who happen to share a pseudo merchant do not."""
    if len(flows) < 2:
        return 0.0
    f = flows.sort_values("ts", kind="mergesort")
    ts, payers = f.ts.to_numpy(), f.payer.to_numpy()
    w = SESSION_WINDOW_MIN * 60
    hits = 0
    for i, (t, p) in enumerate(zip(ts, payers)):
        lo, hi = np.searchsorted(ts, t - w, side="left"), np.searchsorted(ts, t + w, side="right")
        hits += bool((payers[lo:hi] != p).any())
    return hits / len(flows)


def merchant_suspicion(events: pd.DataFrame, now: int) -> pd.DataFrame:
    """events: type, payer, payee, amount, ts (see synth.py). Merchants = PAYMENT payees."""
    start = now - WINDOW_DAYS * 86400
    pay = events[(events.type == "PAYMENT") & (events.ts < now)].sort_values("ts", kind="mergesort")
    cash = events[(events.type == "CASHOUT") & (events.ts >= start) & (events.ts < now)]
    recent = pay[pay.ts >= start]
    rows = []
    for m, g in recent.groupby("payee", sort=True):
        received = float(g.amount.sum())
        cents = np.round(g.amount.to_numpy() * 100)
        c = cash[cash.payer == m]
        out = float(c.amount.sum())
        fast = mirrored_share(g, c.sort_values("ts", kind="mergesort")) if len(c) else 0.0
        ratio = min(out / received, 1.0) if received > 0 else 0.0
        round_share = float(np.mean(cents % ROUND_CENTS == 0))
        rows.append({
            "merchant": m, "received": received, "payments": len(g), "payers": g.payer.nunique(),
            "cashout_ratio": ratio, "round_share": round_share, "fast_share": fast,
            "suspicion": 0.35 * ratio + 0.35 * round_share + 0.3 * fast,
            "suspicious": len(g) >= MIN_MERCHANT_PAYMENTS and ratio >= MIN_CASHOUT_RATIO
                          and max(round_share, fast) >= MIN_PATTERN_SHARE,
        })
    return pd.DataFrame(rows, columns=["merchant", "received", "payments", "payers", "cashout_ratio",
                                       "round_share", "fast_share", "suspicion", "suspicious"])


def detect(events: pd.DataFrame, now: int) -> tuple[list[Ring], dict[str, float]]:
    merchants = merchant_suspicion(events, now)
    suspicious = merchants[merchants.suspicious.astype(bool)].set_index("merchant")
    start = now - WINDOW_DAYS * 86400
    pay = events[(events.type == "PAYMENT") & (events.ts >= start) & (events.ts < now)
                 & events.payee.isin(suspicious.index)]
    edges = pay.groupby(["payer", "payee"]).agg(n=("amount", "size"), flow=("amount", "sum")).reset_index()
    repeaters = pay.groupby("payer").size()  # across all suspicious merchants: rings spread their payments
    edges = edges[edges.payer.map(repeaters) >= MIN_REPEAT_PAYMENTS]

    g = nx.Graph()
    for e in edges.itertuples(index=False):
        g.add_node(e.payer, kind="payer")
        g.add_node(e.payee, kind="merchant")
        g.add_edge(e.payer, e.payee, weight=float(e.flow), n=int(e.n))

    rings: list[Ring] = []
    for component in nx.connected_components(g):
        if sum(g.nodes[n]["kind"] == "payer" for n in component) < MIN_RING_SIZE:
            continue
        sub = g.subgraph(component)
        n_payers = sum(g.nodes[n]["kind"] == "payer" for n in component)
        # Small groups are one ring; only large tangles are split into communities.
        groups = [component] if n_payers <= MAX_UNSPLIT_PAYERS else nx.community.louvain_communities(
            sub, weight="weight", resolution=LOUVAIN_RESOLUTION, seed=42)
        for community in groups:
            payers = sorted(n for n in community if g.nodes[n]["kind"] == "payer")
            ms = sorted(n for n in community if g.nodes[n]["kind"] == "merchant")
            if len(payers) < MIN_RING_SIZE or not ms:
                continue
            inner = sub.subgraph(community)
            flows = pay[pay.payer.isin(payers) & pay.payee.isin(ms)]
            if np.mean(np.round(flows.amount.to_numpy() * 100) % ROUND_CENTS == 0) < MIN_RING_ROUND_SHARE:
                continue
            if session_share(flows) < MIN_SESSION_SHARE:
                continue
            rings.append(Ring(
                payers=payers, merchants=ms,
                score=round(float(suspicious.loc[ms, "suspicion"].mean()), 4),
                flow=round(sum(d["weight"] for *_, d in inner.edges(data=True)), 2),
                payments=int(sum(d["n"] for *_, d in inner.edges(data=True))),
            ))

    scores = {m: round(float(s) * NON_RING_DAMPING, 4) for m, s in merchants.set_index("merchant").suspicion.items()}
    for r in rings:
        for m in r.merchants:
            scores[m] = max(scores.get(m, 0.0), round(0.8 + 0.2 * r.score, 4))
    return rings, scores


# --------------------------------------------------------------------------
# Database I/O
# --------------------------------------------------------------------------
LOAD_SQL = """
select t.type::text as type, t.payer_wallet_id::text as payer,
       case when t.type = 'CASHOUT' then 'SYSTEM' else t.payee_wallet_id::text end as payee,
       t.amount::float8 as amount, floor(extract(epoch from t.created_at))::bigint as ts
  from public.transactions t
 where t.status = 'SUCCESS' and t.type in ('PAYMENT', 'CASHOUT')
   and t.created_at >= now() - make_interval(days => %s)
 order by t.created_at, t.id
"""


def run_once(db_url: str) -> dict:
    import psycopg

    with psycopg.connect(db_url) as conn:
        now = int(conn.execute("select floor(extract(epoch from now()))::bigint").fetchone()[0])
        rows = conn.execute(LOAD_SQL, (WINDOW_DAYS + 1,)).fetchall()
        events = pd.DataFrame(rows, columns=["type", "payer", "payee", "amount", "ts"])
        rings, scores = detect(events, now + 1) if len(events) else ([], {})
        alerts = []
        for r in rings:
            summary = {"payers": len(r.payers), "merchants": len(r.merchants), "score": r.score,
                       "flow": r.flow, "payments": r.payments, "window_days": WINDOW_DAYS}
            alert_id = conn.execute(
                "select public.record_ring_alert(%s, %s::uuid[], %s::uuid[], %s::jsonb)",
                (r.fingerprint, r.payers, r.merchants, json.dumps(summary)),
            ).fetchone()[0]
            alerts.append(str(alert_id))
        conn.execute("select public.set_merchant_network_risk(%s::jsonb)", (json.dumps(scores),))
    result = {"events": len(events), "rings": len(rings), "alerts": alerts, "merchants_scored": len(scores)}
    log.info("network run rings=%d merchants=%d", len(rings), len(scores))
    return result


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int, default=3600)
    args = ap.parse_args()
    db_url = os.environ.get("ML_DB_URL", "postgresql://postgres:postgres@supabase_db_shongrokhon:5432/postgres")
    if args.once:
        print(json.dumps(run_once(db_url)))
        return
    while True:
        try:
            run_once(db_url)
        except Exception as exc:  # keep the loop alive; the next run retries
            log.error("network run failed type=%s", type(exc).__name__)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
