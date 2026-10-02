"""Evaluates the trained artifacts on the hold-out split and writes reports/.
Exits non-zero if a Phase 2 gate fails (testcase.md §2.5).

    python -m shongrokhon_ml.evaluate
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, confusion_matrix, precision_recall_curve

from . import features as F
from . import scenarios
from .dataset import VAL_END_DAY, build
from .model import RiskModel
from .synth import DAY, DAY0
from .train import CONTAMINATION, anomaly_rows, fit_iforest

REPORTS = Path(__file__).resolve().parents[1] / "reports"

# Agreed gates for synthetic data (user decision, Phase 2 plan).
GATES = {
    "pr_auc_min": 0.90,
    "recall_at_flag_min": 0.85,
    "fpr_at_flag_max": 0.01,
    "normal_legit_below_review_min": 0.99,
    "segment_fpr_multiple_max": 3.0,   # TC-P2-XGB-11, with an absolute floor below
    "segment_fpr_floor": 0.01,
    "if_in_pattern_not_flagged_min": 0.95,
    "if_spike_flagged_min": 0.95,
    "if_night_score_increase_min": 0.90,
    "if_velocity_flagged_min": 0.95,
}


def wilson_lower(k: int, n: int, z: float = 1.96) -> float:
    if n == 0:
        return 0.0
    p = k / n
    centre = p + z * z / (2 * n)
    margin = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return float(max(0.0, (centre - margin) / (1 + z * z / n)))


def segment_fpr(test: pd.DataFrame, flagged: np.ndarray, by: str) -> dict[str, dict]:
    """FPR per group, with a 95% Wilson lower bound so tiny groups don't fail on noise."""
    neg = test.label.to_numpy() == 0
    out = {}
    for key, idx in test.groupby(by).indices.items():
        n = neg[idx]
        if n.sum():
            k = int(flagged[idx][n].sum())
            out[str(key)] = {"fpr": k / int(n.sum()), "fp": k, "negatives": int(n.sum()),
                             "fpr_lower95": wilson_lower(k, int(n.sum()))}
    return out


def main() -> int:
    events, wallets, data = build()
    model = RiskModel()
    t = model.thresholds
    test = data[data.split == "test"].reset_index(drop=True)
    y = test.label.to_numpy()
    risk = model.risk(test)
    flagged = risk >= t["flag"]

    tn, fp, fn, tp = confusion_matrix(y, flagged, labels=[0, 1]).ravel()
    normal_legit = ((test.segment == "normal") & (test.payee_segment == "legit")).to_numpy()
    abuser_pseudo = ((test.segment == "abuser") & (test.payee_segment == "pseudo")).to_numpy()
    overall_fpr = float(fp / max(fp + tn, 1))
    # Fairness is about legitimate customers, so abuser and ring wallets are excluded.
    legit_users = test.segment.isin(["normal", "cashheavy", "drift"]).to_numpy()
    region_fpr = segment_fpr(test[legit_users], flagged[legit_users], "region")
    seg_fpr = segment_fpr(test[legit_users], flagged[legit_users], "segment")
    fairness_limit = max(GATES["segment_fpr_multiple_max"] * overall_fpr, GATES["segment_fpr_floor"])

    xgb_metrics = {
        "pr_auc": float(average_precision_score(y, risk)),
        "recall_at_flag": float(tp / max(tp + fn, 1)),
        "fpr_at_flag": overall_fpr,
        "fnr_at_flag": float(fn / max(tp + fn, 1)),
        "precision_at_flag": float(tp / max(tp + fp, 1)),
        "confusion_at_flag": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "recall_at_review": float(np.mean(risk[y == 1] >= t["review"])),
        "fpr_at_review": float(np.mean(risk[y == 0] >= t["review"])),
        "normal_legit_below_review": float(np.mean(risk[normal_legit] < t["review"])),
        "abuser_pseudo_above_flag": float(np.mean(risk[abuser_pseudo] >= t["flag"])),
        "fpr_by_region": region_fpr,
        "fpr_by_segment": seg_fpr,
        "fairness_limit": fairness_limit,
        "test_rows": int(len(test)),
        "test_positives": int(y.sum()),
    }

    # Isolation Forest scenarios (IF-02..05).
    users = scenarios.established_users(events, wallets, data)
    sc = scenarios.build(events, users)
    sc["anomaly"] = model.anomaly(sc)
    by = {name: g.set_index("user").anomaly for name, g in sc.groupby("scenario")}
    if_metrics = {
        "users": len(users),
        "in_pattern_not_flagged": float(np.mean(by["in_pattern"] < t["anomaly"])),
        "spike_flagged": float(np.mean(by["spike_10x"] >= t["anomaly"])),
        "night_score_increase": float(np.mean(by["night_3am"] > by["in_pattern"])),
        "velocity_flagged": float(np.mean(by["velocity_burst"] >= t["anomaly"])),
    }

    # IF-07: drift users in month 6, production baseline vs a rolling-window retrain.
    drift_rows = data[(data.segment == "drift") & (data.ts >= DAY0 + VAL_END_DAY * DAY)]
    recent = data[(data.ts >= DAY0 + (VAL_END_DAY - 90) * DAY) & (data.ts < DAY0 + VAL_END_DAY * DAY)]
    retrained = fit_iforest(recent[anomaly_rows(recent)])
    if_metrics["drift_alert_rate_before"] = float(np.mean(model.anomaly(drift_rows) >= 0))
    if_metrics["drift_alert_rate_after_retrain"] = float(np.mean(-retrained.decision_function(F.anomaly_matrix(drift_rows)) >= 0))

    # IF-08: contamination sweep on the validation split.
    train = data[data.split == "train"]
    val_in = data[(data.split == "val") & anomaly_rows(data)]
    spikes = sc[sc.scenario == "spike_10x"]
    sweep = []
    for c in [0.01, 0.02, 0.03, 0.04, 0.05]:
        m = fit_iforest(train[anomaly_rows(train)], contamination=c)
        sweep.append({
            "contamination": c,
            "val_alert_rate": float(np.mean(-m.decision_function(F.anomaly_matrix(val_in)) >= 0)),
            "spike_detection": float(np.mean(-m.decision_function(F.anomaly_matrix(spikes)) >= 0)),
            "chosen": c == CONTAMINATION,
        })

    checks = {
        "XGB-03 pr_auc": xgb_metrics["pr_auc"] >= GATES["pr_auc_min"],
        "XGB-03 recall_at_flag": xgb_metrics["recall_at_flag"] >= GATES["recall_at_flag_min"],
        "XGB-03 fpr_at_flag": xgb_metrics["fpr_at_flag"] <= GATES["fpr_at_flag_max"],
        "XGB-05 normal_legit_below_review": xgb_metrics["normal_legit_below_review"] >= GATES["normal_legit_below_review_min"],
        "XGB-06 minority_recall": xgb_metrics["recall_at_flag"] > 0,
        "XGB-11 fairness": all(v["fpr_lower95"] <= fairness_limit for v in {**region_fpr, **seg_fpr}.values()),
        "IF-02 in_pattern": if_metrics["in_pattern_not_flagged"] >= GATES["if_in_pattern_not_flagged_min"],
        "IF-03 spike": if_metrics["spike_flagged"] >= GATES["if_spike_flagged_min"],
        "IF-04 night": if_metrics["night_score_increase"] >= GATES["if_night_score_increase_min"],
        "IF-05 velocity": if_metrics["velocity_flagged"] >= GATES["if_velocity_flagged_min"],
        "IF-07 drift": if_metrics["drift_alert_rate_after_retrain"] <= 2 * CONTAMINATION,
    }

    REPORTS.mkdir(exist_ok=True)
    report = {
        "model_version": model.version,
        "training_date": model.metadata["training_date"],
        "thresholds": t,
        "gates": GATES,
        "xgb": xgb_metrics,
        "iforest": if_metrics,
        "contamination_sweep": sweep,
        "checks": checks,
        "note": "Synthetic data (synth.py). Metrics validate the pipeline, not real-world performance.",
    }
    (REPORTS / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")

    p, r, _ = precision_recall_curve(y, risk)
    fig, ax = plt.subplots(figsize=(5, 4))
    ax.plot(r, p)
    for name in ("review", "flag"):
        ax.axvline(float(np.mean(risk[y == 1] >= t[name])), linestyle="--", linewidth=1, label=f"{name} ({t[name]})")
    ax.set_xlabel("Recall (cash-out class)")
    ax.set_ylabel("Precision")
    ax.set_title(f"XGBoost PR curve, test split — AP {xgb_metrics['pr_auc']:.3f}")
    ax.legend(loc="lower left")
    fig.tight_layout()
    fig.savefig(REPORTS / "pr_curve.png", dpi=120)

    for name, ok in checks.items():
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print(json.dumps({k: v for k, v in xgb_metrics.items() if not isinstance(v, dict)}, indent=2))
    print(json.dumps(if_metrics, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
