"""Loads the trained artifacts and scores feature rows. Used by the service,
the evaluation report and the tests, so they all score the same way."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb

from . import features as F
from .train import ARTIFACTS


class FastIsolationForest:
    """Same result as IsolationForest.decision_function, ~100x faster for one row.

    sklearn walks the trees in a Python loop with per-call input validation
    (~24 ms per request with 200 trees). Here every tree is packed into padded
    arrays and all trees are walked together, one numpy step per level.
    tests/test_iforest.py checks equality with sklearn.
    """

    def __init__(self, forest):
        from sklearn.ensemble._iforest import _average_path_length

        trees = [e.tree_ for e in forest.estimators_]
        width = max(t.node_count for t in trees)
        n = len(trees)
        self.left = np.full((n, width), -1, dtype=np.int64)
        self.right = np.full((n, width), -1, dtype=np.int64)
        self.feature = np.zeros((n, width), dtype=np.int64)
        self.threshold = np.zeros((n, width), dtype=np.float64)
        self.leaf_depth = np.zeros((n, width), dtype=np.float64)
        for i, (t, feats) in enumerate(zip(trees, forest.estimators_features_)):
            k = t.node_count
            self.left[i, :k] = t.children_left
            self.right[i, :k] = t.children_right
            leaf = t.children_left == -1
            # Tree features index the estimator's feature subset; map them to columns.
            self.feature[i, :k] = np.where(leaf, 0, np.asarray(feats)[np.maximum(t.feature, 0)])
            self.threshold[i, :k] = t.threshold
            depth = np.zeros(k)
            for node in range(k):  # parents always precede children in sklearn trees
                if not leaf[node]:
                    depth[t.children_left[node]] = depth[t.children_right[node]] = depth[node] + 1
            # Depth of the leaf plus the expected path length for the samples left in it.
            self.leaf_depth[i, :k] = depth + _average_path_length(t.n_node_samples) * leaf
        self.max_depth = int(max(t.max_depth for t in trees))
        self.trees = np.arange(n)
        self.norm = float(_average_path_length([forest.max_samples_])[0])
        self.offset = float(forest.offset_)

    def decision_function(self, X: np.ndarray) -> np.ndarray:
        # sklearn trees compare float32 inputs against their thresholds.
        X = np.asarray(X, dtype=np.float32).astype(np.float64)
        out = np.empty(len(X))
        for r, x in enumerate(X):
            node = np.zeros(len(self.trees), dtype=np.int64)
            for _ in range(self.max_depth):
                left = self.left[self.trees, node]
                internal = left != -1
                if not internal.any():
                    break
                go_left = x[self.feature[self.trees, node]] <= self.threshold[self.trees, node]
                node = np.where(internal, np.where(go_left, left, self.right[self.trees, node]), node)
            depth = self.leaf_depth[self.trees, node].mean()
            out[r] = -(2.0 ** (-depth / self.norm)) - self.offset
        return out


@dataclass
class Explanation:
    """Exact TreeSHAP values of the XGBoost risk model, in log-odds (margin) space:
    base_value + sum(contributions) = margin, the model's raw output, and
    risk_score = sigmoid(margin) (TC-P4-INV-03/04)."""
    risk_score: float
    margin: float
    base_value: float
    contributions: dict[str, float]
    features: dict[str, float]


@dataclass
class Score:
    risk_score: float
    anomaly_score: float
    low_confidence: bool
    decision: str


class RiskModel:
    def __init__(self, artifacts: Path = ARTIFACTS):
        self.metadata = json.loads((artifacts / "metadata.json").read_text())
        self.version: str = self.metadata["model_version"]
        self.features: list[str] = self.metadata["features"]
        self.defaults: dict[str, float] = self.metadata["feature_defaults"]
        self.thresholds: dict[str, float] = self.metadata["thresholds"]
        self.booster = xgb.Booster()
        self.booster.load_model(artifacts / "xgb.json")
        self.booster.set_param({"nthread": 1})
        self.iforest = joblib.load(artifacts / "iforest.joblib")
        self.fast_iforest = FastIsolationForest(self.iforest)
        self._col = {k: i for i, k in enumerate(self.features)}

    def frame(self, rows: list[dict]) -> pd.DataFrame:
        """Derives amount-only features when absent, fills other missing or null features
        with training medians (TC-P2-XGB-08) and ignores unknown keys."""
        out = []
        for r in rows:
            r = {k: v for k, v in r.items() if v is not None}
            amount = float(r["amount"])
            cents = round(amount * 100)
            r.setdefault("log_amount", math.log1p(amount))
            r.setdefault("is_round_100", float(cents % 10000 == 0))
            r.setdefault("is_round_1000", float(cents % 100000 == 0))
            out.append({k: float(r.get(k, self.defaults[k])) for k in self.features})
        return pd.DataFrame(out, columns=self.features)

    def _row(self, r: dict) -> np.ndarray:
        """Same filling rules as frame(), for one row, straight into numpy."""
        r = {k: v for k, v in r.items() if v is not None}
        amount = float(r["amount"])
        cents = round(amount * 100)
        r.setdefault("log_amount", math.log1p(amount))
        r.setdefault("is_round_100", float(cents % 10000 == 0))
        r.setdefault("is_round_1000", float(cents % 100000 == 0))
        return np.array([[float(r.get(k, self.defaults[k])) for k in self.features]])

    def _anomaly_np(self, X: np.ndarray) -> np.ndarray:
        """numpy twin of features.anomaly_matrix (checked equal in tests)."""
        cols = []
        for name in F.ANOMALY_FEATURES:
            if name == "log_amount_to_median":
                cols.append(np.log(np.maximum(X[:, self._col["amount_to_median"]], 1.0)))
            elif name == "log_amount_to_merchant_median":
                cols.append(np.log(np.maximum(X[:, self._col["amount_to_merchant_median"]], 1.0)))
            else:
                cols.append(X[:, self._col[name]])
        return np.column_stack(cols)

    def risk(self, X: pd.DataFrame) -> np.ndarray:
        return self.booster.inplace_predict(X[self.features].to_numpy(dtype=np.float32))

    def anomaly(self, X: pd.DataFrame) -> np.ndarray:
        return -self.fast_iforest.decision_function(F.anomaly_matrix(X).to_numpy())

    def decide(self, risk: float, anomaly: float, low_confidence: bool) -> str:
        """Advisory decision. The authoritative one is computed in SQL from app_config."""
        t = self.thresholds
        if risk >= t["flag"]:
            return "FLAG"
        if risk >= t["review"] or (anomaly >= t["anomaly"] and not low_confidence):
            return "REVIEW"
        return "ALLOW"

    def explain(self, row: dict) -> Explanation:
        """SHAP values for one row (the same filling rules as score()). Uses XGBoost's native
        pred_contribs, so no extra library and exact values for this model."""
        X = self._row(row).astype(np.float32)
        dm = xgb.DMatrix(X, feature_names=self.features)
        contribs = self.booster.predict(dm, pred_contribs=True)[0]
        margin = float(self.booster.predict(dm, output_margin=True)[0])
        return Explanation(
            risk_score=float(self.booster.predict(dm)[0]),
            margin=margin,
            base_value=float(contribs[-1]),
            contributions={f: float(c) for f, c in zip(self.features, contribs[:-1])},
            features={f: float(v) for f, v in zip(self.features, X[0])},
        )

    def score(self, rows: list[dict]) -> list[Score]:
        # Serving path: plain numpy, no DataFrames (a request scores one row).
        X = self.frame(rows)[self.features].to_numpy(dtype=np.float64) if len(rows) > 1 else self._row(rows[0])
        risk = self.booster.inplace_predict(X.astype(np.float32))
        anomaly = -self.fast_iforest.decision_function(self._anomaly_np(X))
        low = X[:, self._col["payer_txn_count_90d"]] < F.LOW_CONFIDENCE_MIN_TXNS
        return [
            Score(float(r), float(a), bool(lc), self.decide(float(r), float(a), bool(lc)))
            for r, a, lc in zip(risk, anomaly, low)
        ]
