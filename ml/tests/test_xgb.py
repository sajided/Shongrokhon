"""TC-P2-XGB-01, 03..11 on the synthetic hold-out split."""
import json

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

from shongrokhon_ml import features as F
from shongrokhon_ml.dataset import TRAIN_END_DAY, VAL_END_DAY
from shongrokhon_ml.evaluate import GATES
from shongrokhon_ml.synth import DAY, DAY0
from shongrokhon_ml.train import ARTIFACTS


def test_xgb_01_split_has_no_user_or_transaction_leakage(dataset):
    _, _, data = dataset
    s = data[data.split.notna()]
    users = {k: set(g.payer) for k, g in s.groupby("split")}
    assert users["train"].isdisjoint(users["val"]) and users["train"].isdisjoint(users["test"])
    assert users["val"].isdisjoint(users["test"])
    assert s.txn_id.is_unique
    day = (s.ts - DAY0) // DAY
    assert (day[s.split == "train"] < TRAIN_END_DAY).all()
    assert day[s.split == "val"].between(TRAIN_END_DAY, VAL_END_DAY - 1).all()
    assert (day[s.split == "test"] >= VAL_END_DAY).all()


def test_xgb_03_06_hold_out_performance_meets_gates(dataset, model):
    _, _, data = dataset
    test = data[data.split == "test"]
    y = test.label.to_numpy()
    risk = model.risk(test)
    flagged = risk >= model.thresholds["flag"]
    assert average_precision_score(y, risk) >= GATES["pr_auc_min"]
    recall = flagged[y == 1].mean()
    assert recall >= GATES["recall_at_flag_min"] and recall > 0  # XGB-06: minority class is not ignored
    assert flagged[y == 0].mean() <= GATES["fpr_at_flag_max"]


def test_xgb_04_abuser_to_pseudo_is_flagged(dataset, model):
    _, _, data = dataset
    rows = data[(data.split == "test") & (data.segment == "abuser") & (data.payee_segment == "pseudo")]
    assert len(rows) > 20
    assert (model.risk(rows) >= model.thresholds["flag"]).mean() >= 0.85


def test_xgb_05_normal_to_legit_stays_below_review(dataset, model):
    _, _, data = dataset
    rows = data[(data.split == "test") & (data.segment == "normal") & (data.payee_segment == "legit")]
    assert (model.risk(rows) < model.thresholds["review"]).mean() >= 0.99


def test_xgb_07_scores_are_probabilities(model):
    rng = np.random.default_rng(0)
    n = 10_000
    X = pd.DataFrame({
        "amount": rng.uniform(1, 25000, n),
        "payer_txn_count_90d": rng.integers(0, 200, n), "payer_median_amount_90d": rng.uniform(0, 5000, n),
        "amount_to_median": rng.uniform(0, 50, n), "payer_hour_share": rng.uniform(0, 1, n),
        "payer_cashout_count_30d": rng.integers(0, 30, n), "payer_txn_count_1h": rng.integers(0, 10, n),
        "payer_merchant_prior_count": rng.integers(0, 50, n), "amount_to_merchant_median": rng.uniform(0, 50, n),
        "merchant_new_for_payer": rng.integers(0, 2, n), "payer_merchant_count_10m": rng.integers(0, 6, n),
        "merchant_distinct_payers_30d": rng.integers(0, 300, n), "merchant_round_share_30d": rng.uniform(0, 1, n),
        "merchant_cashout_ratio_7d": rng.uniform(0, 5, n), "merchant_cashout_lag_min": rng.uniform(0, 1440, n),
        "merchant_age_days": rng.uniform(0, 365, n), "hour_sin": rng.uniform(-1, 1, n), "hour_cos": rng.uniform(-1, 1, n),
        "is_night": rng.integers(0, 2, n),
    })
    scores = model.score(X.to_dict("records"))
    risk = np.array([s.risk_score for s in scores])
    assert np.isfinite(risk).all() and (risk >= 0).all() and (risk <= 1).all()
    assert np.isfinite([s.anomaly_score for s in scores]).all()


def test_xgb_08_missing_and_unknown_features_use_defaults(model):
    [s] = model.score([{"amount": 750.0, "merchant_category": "never-seen", "payer_hour_share": None}])
    assert 0 <= s.risk_score <= 1 and s.decision in {"ALLOW", "REVIEW", "FLAG"}


def test_xgb_09_thresholds_are_documented():
    meta = json.loads((ARTIFACTS / "metadata.json").read_text())
    t = meta["thresholds"]
    assert 0 < t["review"] <= t["flag"] < 1
    assert {"flag_target_fpr", "review_target_fpr"} <= t.keys()
    report = json.loads((ARTIFACTS.parent / "reports" / "metrics.json").read_text())
    assert report["model_version"] == meta["model_version"]
    assert {"fpr_at_flag", "fnr_at_flag"} <= report["xgb"].keys()


def test_xgb_10_artifact_carries_version_date_and_features(model):
    meta = model.metadata
    assert meta["model_version"].startswith("p2-")
    assert len(meta["training_date"]) == 10
    assert meta["features"] == F.FEATURES


def test_xgb_11_no_segment_fpr_significantly_above_limit():
    report = json.loads((ARTIFACTS.parent / "reports" / "metrics.json").read_text())
    x = report["xgb"]
    groups = {**x["fpr_by_region"], **x["fpr_by_segment"]}
    assert groups and all(g["fpr_lower95"] <= x["fairness_limit"] for g in groups.values())
