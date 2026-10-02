"""Trains the XGBoost cash-out classifier and the Isolation Forest, calibrates
thresholds on the validation split and writes artifacts/ (TC-P2-XGB-*, IF-*).

    python -m shongrokhon_ml.train
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import date
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.ensemble import IsolationForest

from . import features as F
from .dataset import build
from .synth import GENERATOR_VERSION, SynthConfig

ARTIFACTS = Path(os.environ.get("ML_ARTIFACTS_DIR", Path(__file__).resolve().parents[1] / "artifacts"))

# Operating points, chosen on the validation split (TC-P2-XGB-09).
FLAG_TARGET_FPR = 0.003    # FLAG: pay, alert and flag the wallets
REVIEW_TARGET_FPR = 0.008  # REVIEW: step-up confirmation
CONTAMINATION = 0.01       # IF alert rate on in-pattern traffic (TC-P2-IF-08 sweep in reports/)

XGB_PARAMS = dict(
    n_estimators=300, max_depth=5, learning_rate=0.08, subsample=0.9, colsample_bytree=0.9,
    min_child_weight=2, tree_method="hist", n_jobs=1, random_state=42, eval_metric="aucpr",
)
IF_PARAMS = dict(n_estimators=200, max_samples=1024, random_state=42, n_jobs=1)


GRID = np.round(np.arange(0.01, 1.0, 0.01), 2)


def calibrate(scores: np.ndarray, labels: np.ndarray, target_fpr: float, upper: float = 1.0) -> float:
    """Operating threshold from the validation precision/recall trade-off (TC-P2-XGB-09).

    Finds the best recall reachable with FPR <= target_fpr, then returns the
    midpoint of the grid thresholds that reach it (within half a point), so the
    threshold sits in the middle of the score gap instead of on its edge.
    """
    scores, labels = np.asarray(scores, dtype=float), np.asarray(labels)
    pos, neg = scores[labels == 1], scores[labels == 0]
    grid = GRID[GRID < upper]
    recall = np.array([np.mean(pos >= t) for t in grid])
    fpr = np.array([np.mean(neg >= t) for t in grid])
    ok = fpr <= target_fpr
    if not ok.any():
        return float(grid[-1])
    best = recall[ok].max()
    good = grid[ok & (recall >= best - 0.005)]
    return float(np.round((good.min() + good.max()) / 2, 2))


def anomaly_rows(data: pd.DataFrame) -> pd.Series:
    """Rows that describe normal behaviour of established users (the IF baseline)."""
    return data.segment.isin(["normal", "cashheavy", "drift"]) & (data.label == 0) & ~F.low_confidence(data)


def fit_xgb(train: pd.DataFrame) -> xgb.XGBClassifier:
    pos = int(train.label.sum())
    params = dict(XGB_PARAMS, scale_pos_weight=(len(train) - pos) / max(pos, 1))  # TC-P2-XGB-06
    model = xgb.XGBClassifier(**params)
    model.fit(train[F.FEATURES].astype(float), train.label)
    return model


def fit_iforest(rows: pd.DataFrame, contamination: float = CONTAMINATION) -> IsolationForest:
    model = IsolationForest(contamination=contamination, **IF_PARAMS)
    model.fit(F.anomaly_matrix(rows))
    return model


def anomaly_score(model: IsolationForest, features: pd.DataFrame) -> np.ndarray:
    """Higher = more unusual. > 0 means outside the learned baseline at the trained contamination."""
    return -model.decision_function(F.anomaly_matrix(features))


def main(cfg: SynthConfig = SynthConfig()) -> dict:
    events, wallets, data = build(cfg)
    train, val = data[data.split == "train"], data[data.split == "val"]

    clf = fit_xgb(train)
    val_scores = clf.predict_proba(val[F.FEATURES].astype(float))[:, 1]
    y = val.label.to_numpy()
    flag_t = calibrate(val_scores, y, FLAG_TARGET_FPR)
    review_t = calibrate(val_scores, y, REVIEW_TARGET_FPR, upper=flag_t)

    iforest = fit_iforest(train[anomaly_rows(train)])

    defaults = {k: float(v) for k, v in train[F.FEATURES].median().items()}
    fingerprint = hashlib.sha256(
        json.dumps({"gen": GENERATOR_VERSION, "cfg": cfg.__dict__, "features": F.FEATURES, "xgb": XGB_PARAMS, "if": IF_PARAMS}, sort_keys=True).encode()
    ).hexdigest()[:8]
    version = f"p2-{fingerprint}"

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    clf.get_booster().save_model(ARTIFACTS / "xgb.json")
    joblib.dump(iforest, ARTIFACTS / "iforest.joblib")
    metadata = {
        "model_version": version,
        "training_date": os.environ.get("ML_TRAINING_DATE", date.today().isoformat()),
        "seed": cfg.seed,
        "synth_config": cfg.__dict__,
        "features": F.FEATURES,
        "anomaly_features": F.ANOMALY_FEATURES,
        "feature_defaults": defaults,
        "thresholds": {
            "review": review_t,
            "flag": flag_t,
            "anomaly": 0.0,
            "flag_target_fpr": FLAG_TARGET_FPR,
            "review_target_fpr": REVIEW_TARGET_FPR,
            "contamination": CONTAMINATION,
        },
        "low_confidence_min_txns": F.LOW_CONFIDENCE_MIN_TXNS,
        "rows": {"train": int(len(train)), "val": int(len(val)), "test": int((data.split == "test").sum())},
    }
    (ARTIFACTS / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps({"model_version": version, "thresholds": metadata["thresholds"], "rows": metadata["rows"]}, indent=2))
    return metadata


if __name__ == "__main__":
    main()
