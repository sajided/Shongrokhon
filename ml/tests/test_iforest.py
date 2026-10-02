"""TC-P2-IF-01..08."""
import json

import numpy as np

from shongrokhon_ml import features as F
from shongrokhon_ml import scenarios
from shongrokhon_ml.train import ARTIFACTS, CONTAMINATION
import pytest


@pytest.fixture(scope="module")
def scored(dataset, model):
    events, wallets, data = dataset
    users = scenarios.established_users(events, wallets, data)
    sc = scenarios.build(events, users)
    sc["anomaly"] = model.anomaly(sc)
    return {name: g.set_index("user").anomaly for name, g in sc.groupby("scenario")}


def test_if_01_baseline_is_stored(model):
    assert (ARTIFACTS / "iforest.joblib").exists()
    assert model.metadata["anomaly_features"] == F.ANOMALY_FEATURES
    assert model.iforest.n_features_in_ == len(F.ANOMALY_FEATURES)


def test_if_02_in_pattern_payment_is_not_flagged(scored):
    assert (scored["in_pattern"] < 0).mean() >= 0.95


def test_if_03_ten_times_usual_ticket_is_flagged(scored):
    assert (scored["spike_10x"] >= 0).mean() >= 0.95


def test_if_04_unseen_3am_raises_the_score(scored):
    assert (scored["night_3am"] > scored["in_pattern"]).mean() >= 0.9


def test_if_05_velocity_burst_is_flagged(scored):
    assert (scored["velocity_burst"] >= 0).mean() >= 0.95


def test_if_06_cold_start_falls_back_with_low_confidence(model):
    [s] = model.score([{"amount": 500.0, "payer_txn_count_90d": 0.0}])
    assert s.low_confidence is True
    assert np.isfinite(s.anomaly_score)
    # Low confidence never turns an anomaly into a step-up on its own.
    assert model.decide(0.0, 10.0, True) == "ALLOW"


def test_if_07_retrain_absorbs_drift():
    report = json.loads((ARTIFACTS.parent / "reports" / "metrics.json").read_text())
    assert report["iforest"]["drift_alert_rate_after_retrain"] <= 2 * CONTAMINATION


def test_if_08_contamination_choice_is_documented():
    report = json.loads((ARTIFACTS.parent / "reports" / "metrics.json").read_text())
    sweep = report["contamination_sweep"]
    assert [s["contamination"] for s in sweep] == [0.01, 0.02, 0.03, 0.04, 0.05]
    [chosen] = [s for s in sweep if s["chosen"]]
    assert chosen["contamination"] == CONTAMINATION and "val_alert_rate" in chosen


def test_fast_scorer_matches_sklearn(dataset, model):
    """The serving path (FastIsolationForest) must equal sklearn's decision_function."""
    _, _, data = dataset
    rows = data.sample(2000, random_state=1)
    X = F.anomaly_matrix(rows)
    fast = model.fast_iforest.decision_function(X.to_numpy())
    slow = model.iforest.decision_function(X)
    assert np.allclose(fast, slow, atol=1e-12)


def test_serving_path_matches_batch_path(dataset, model):
    """model.score (numpy, one row) equals the DataFrame path used in evaluation."""
    _, _, data = dataset
    rows = data.sample(300, random_state=2)[F.FEATURES]
    batch_risk, batch_anomaly = model.risk(rows), model.anomaly(rows)
    for i, r in enumerate(rows.to_dict("records")):
        [s] = model.score([r])
        assert np.isclose(s.risk_score, batch_risk[i], atol=1e-6)
        assert np.isclose(s.anomaly_score, batch_anomaly[i], atol=1e-9)
