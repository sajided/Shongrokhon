"""The generated seed personas (supabase/seed_history.sql) score as the
integration and E2E tests expect: U-NORMAL -> M-LEGIT is allowed at any
hour, U-ABUSER -> M-PSEUDO is flagged, RING-01 is one ring."""
import pandas as pd
import pytest

from shongrokhon_ml import features as F
from shongrokhon_ml import network, seed_export

ANCHOR = 1790000000 - (1790000000 + 6 * 3600) % 86400  # a Dhaka midnight


@pytest.fixture(scope="module")
def history():
    ev = seed_export.events(anchor=ANCHOR)
    return ev, F.History(ev[ev.type != "TOPUP"])


def decide(model, history, payer, payee, amount, at, network_risk=0.0):
    [s] = model.score([history.features(payer, payee, amount, at)])
    # Same rule as private.decide_risk in SQL.
    if s.risk_score >= model.thresholds["flag"] or network_risk >= 0.8:
        return "FLAG"
    if s.risk_score >= model.thresholds["review"] or (s.anomaly_score >= model.thresholds["anomaly"] and not s.low_confidence):
        return "REVIEW"
    return "ALLOW"


@pytest.mark.parametrize("hour", range(24))
def test_u_normal_pays_m_legit_500_at_any_hour(model, history, hour):
    _, h = history
    assert decide(model, h, "U-NORMAL", "M-LEGIT", 500.0, ANCHOR + hour * 3600 + 600) == "ALLOW"


@pytest.mark.parametrize("payee, amount", [("M-LEGIT", 500.0), ("M-LEGIT", 3000.0), ("M-LEGIT2", 100.0), ("M-LEGIT3", 1000.0)])
def test_new_customers_paying_legit_shops_are_allowed(model, history, payee, amount):
    _, h = history
    assert decide(model, h, "fresh-user", payee, amount, ANCHOR + 13 * 3600) == "ALLOW"


def test_u_abuser_round_payment_to_m_pseudo_is_flagged(model, history):
    _, h = history
    assert decide(model, h, "U-ABUSER", "M-PSEUDO", 10000.0, ANCHOR + 14 * 3600) == "FLAG"


def test_ring_01_is_detected_as_exactly_one_ring(history):
    ev, _ = history
    events = ev[ev.type != "TOPUP"]
    rings, scores = network.detect(events, ANCHOR + 3600)
    assert len(rings) == 1
    assert set(rings[0].payers) == {f"RING-01-{i}" for i in range(1, 9)}
    assert set(rings[0].merchants) == {"M-PSEUDO2", "M-PSEUDO3"}
    assert scores["M-PSEUDO2"] >= 0.8 and scores["M-LEGIT"] < 0.8 and scores["M-PSEUDO"] < 0.8


def test_balances_never_go_negative(history):
    ev, _ = history
    bal: dict[str, float] = {"U-NORMAL": 5000.0}
    for r in ev.itertuples(index=False):
        if r.type == "TOPUP":
            bal[r.payee] = bal.get(r.payee, 0) + r.amount
        else:
            bal[r.payer] = bal.get(r.payer, 0) - r.amount
            assert bal[r.payer] >= -1e-6, f"{r.payer} negative at {r.ts}"
            if r.type == "PAYMENT":
                bal[r.payee] = bal.get(r.payee, 0) + r.amount
