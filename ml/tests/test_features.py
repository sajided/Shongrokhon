"""TC-P2-XGB-02 and point-in-time feature semantics."""
import numpy as np
import pandas as pd

from shongrokhon_ml import features as F
from shongrokhon_ml.synth import SynthConfig, generate

DAY = 86400
T = 1773576000  # 2026-03-15 12:00 UTC = 18:00 Dhaka


def ev(rows):
    return pd.DataFrame(rows, columns=["type", "payer", "payee", "amount", "ts"])


def test_xgb_02_feature_pipeline_is_reproducible():
    cfg = SynthConfig(n_normal=60, n_cashheavy=10, n_drift=5, n_abuser=8, n_rings=1, n_legit_merchants=20, n_pseudo_merchants=3)
    a_events, _ = generate(cfg)
    b_events, _ = generate(cfg)
    pd.testing.assert_frame_equal(a_events, b_events)
    rows = a_events[a_events.type == "PAYMENT"].tail(500)
    fa = F.compute(F.History(a_events), rows)
    fb = F.compute(F.History(b_events), rows)
    pd.testing.assert_frame_equal(fa, fb)


def test_windows_are_half_open_and_exclude_the_current_instant():
    h = F.History(ev([
        ("PAYMENT", "c", "m", 100.0, T - 90 * DAY),      # on the boundary: included
        ("PAYMENT", "c", "m", 200.0, T - 90 * DAY - 1),  # outside
        ("PAYMENT", "c", "m", 300.0, T),                 # same instant: excluded
    ]))
    f = h.features("c", "m", 50.0, T)
    assert f["payer_txn_count_90d"] == 1
    assert f["payer_median_amount_90d"] == 100.0
    assert f["payer_merchant_prior_count"] == 1
    assert f["merchant_new_for_payer"] == 0


def test_cold_start_defaults():
    f = F.History(ev([("PAYMENT", "x", "y", 10.0, T - DAY)])).features("new", "unknown", 2000.0, T)
    assert f["payer_txn_count_90d"] == 0 and f["amount_to_median"] == 1.0
    assert f["merchant_new_for_payer"] == 1 and f["merchant_cashout_lag_min"] == F.LAG_CAP_MIN
    assert f["is_round_1000"] == 1 and f["is_round_100"] == 1
    assert F.low_confidence(f)


def test_dhaka_hours_and_velocity():
    rows = [("PAYMENT", "c", "m", 100.0, T - k * 60) for k in range(1, 6)]
    f = F.History(ev(rows)).features("c", "m", 100.0, T)
    assert F.dhaka_hour(T) == 18
    assert f["payer_merchant_count_10m"] == 5 and f["payer_txn_count_1h"] == 5
    assert np.isclose(f["hour_sin"], np.sin(2 * np.pi * 18 / 24))


def test_merchant_cashout_features():
    rows = [
        ("PAYMENT", "a", "m", 1000.0, T - 2 * DAY),
        ("PAYMENT", "b", "m", 1000.0, T - 2 * DAY + 60),
        ("CASHOUT", "m", "SYSTEM", 1900.0, T - 2 * DAY + 60 + 600),  # 10 minutes after the latest receipt
    ]
    f = F.History(ev(rows)).features("c", "m", 500.0, T)
    assert f["merchant_distinct_payers_30d"] == 2
    assert f["merchant_round_share_30d"] == 1.0
    assert np.isclose(f["merchant_cashout_ratio_7d"], 0.95)
    assert np.isclose(f["merchant_cashout_lag_min"], 10.0)
