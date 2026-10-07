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


@pytest.mark.parametrize("payee, amount", [("M-LEGIT", 500.0), ("M-LEGIT2", 100.0), ("M-LEGIT3", 1000.0)])
def test_new_customers_paying_legit_shops_are_allowed(model, history, payee, amount):
    _, h = history
    assert decide(model, h, "fresh-user", payee, amount, ANCHOR + 13 * 3600) == "ALLOW"


def test_new_customer_large_first_payment_is_never_flagged(model, history):
    """A brand-new account's first ৳3,000 at a small shop may ask for a PIN re-entry
    (cold start: no payer history, model card §11) but must never be flagged."""
    _, h = history
    assert decide(model, h, "fresh-user", "M-LEGIT", 3000.0, ANCHOR + 13 * 3600) in ("ALLOW", "REVIEW")


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


# Phase 3 (AI coach) personas: the shapes the coach tests rely on.
DAY = 86400


def _balance(ev, key, until, opening=0.0):
    e = ev[ev.ts < until]
    return opening + e.loc[(e.type == "TOPUP") & (e.payee == key), "amount"].sum() \
        - e.loc[(e.type != "TOPUP") & (e.payer == key), "amount"].sum()


def _surplus(ev, key):
    """Monthly income - spending over the last 90 days, savings transfers excluded (private.monthly_surplus)."""
    e = ev[ev.ts >= ANCHOR - 90 * DAY]
    income = e.loc[(e.type == "TOPUP") & (e.payee == key), "amount"].sum()
    spending = e.loc[(e.type != "TOPUP") & (e.payer == key) & (e.payee != "M-BANK"), "amount"].sum()
    return (income - spending) / 3


def test_phase3_billers_never_look_like_pseudo_merchants(history):
    ev, _ = history
    s = network.merchant_suspicion(ev[ev.type != "TOPUP"], ANCHOR + 3600).set_index("merchant")
    for m in seed_export.BILLERS:
        assert not s.loc[m, "suspicious"], m


def test_u_normal_keeps_5000_and_can_save_5000_a_month(history):
    ev, _ = history
    assert _balance(ev, "U-NORMAL", ANCHOR, opening=5000.0) == pytest.approx(5000.0)
    assert _surplus(ev, "U-NORMAL") >= 5000  # TC-P3-SAVE-01


def test_u_tight_surplus_and_upcoming_shortfall(history):
    ev, _ = history
    assert 2000 <= _surplus(ev, "U-TIGHT") <= 4000  # TC-P3-SAVE-02
    bal = _balance(ev, "U-TIGHT", ANCHOR)
    assert bal == pytest.approx(9500 + 500 + 650 - 300)  # rent + electricity + 10 days of shops > balance (FCST-02)
    rents = ev[(ev.payer == "U-TIGHT") & (ev.payee == "M-RENT")].ts
    assert (ANCHOR - rents.max()) // DAY == 19  # last rent 20 days ago (19 days + hours), next one in ~10 days


def test_u_cashheavy_cashes_out_at_least_8_times_a_month(history):
    ev, _ = history
    for k in range(1, 5):  # each complete salary month (salary 5 + 30k days ago)
        window = ev[(ev.type == "CASHOUT") & (ev.payer == "U-CASHHEAVY")
                    & (ev.ts >= ANCHOR - (5 + 30 * k) * DAY) & (ev.ts < ANCHOR - (5 + 30 * (k - 1)) * DAY)]
        assert len(window) >= 8, k
    assert ((ev.payer == "U-CASHHEAVY") & (ev.payee == "M-INJECT")).any()  # TC-P3-MW-06
    # The last 30 days look like a normal month: one salary, 8-14 cash-outs, no big overspend.
    last = ev[ev.ts >= ANCHOR - 30 * DAY]
    cash = last[(last.type == "CASHOUT") & (last.payer == "U-CASHHEAVY")]
    assert 8 <= len(cash) <= 14
    income = last.loc[(last.type == "TOPUP") & (last.payee == "U-CASHHEAVY"), "amount"].sum()
    out = last.loc[(last.type != "TOPUP") & (last.payer == "U-CASHHEAVY"), "amount"].sum()
    assert out <= income * 1.2


def test_u_bulk_has_2000_payments_in_90_days(history):
    ev, _ = history
    recent = ev[(ev.type == "PAYMENT") & (ev.payer == "U-BULK") & (ev.ts >= ANCHOR - 90 * DAY)]
    assert len(recent) >= 2000  # TC-P3-MW-04
