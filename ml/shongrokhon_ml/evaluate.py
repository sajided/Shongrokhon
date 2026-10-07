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
import xgboost as xgb
from sklearn.calibration import calibration_curve
from sklearn.metrics import average_precision_score, confusion_matrix, precision_recall_curve

from . import features as F
from . import scenarios
from .dataset import VAL_END_DAY, build
from .model import RiskModel
from .synth import DAY, DAY0
from .train import CONTAMINATION, anomaly_rows, fit_iforest, fit_xgb

REPORTS = Path(__file__).resolve().parents[1] / "reports"

# Feature groups for the ablation study (model card §5). Dropping a group and
# retraining shows how much of the signal lives there.
FEATURE_GROUPS = {
    "amount_time": ["amount", "log_amount", "is_round_100", "is_round_1000", "hour_sin", "hour_cos", "is_night"],
    "payer_behaviour": ["payer_txn_count_90d", "payer_median_amount_90d", "amount_to_median", "payer_hour_share",
                        "payer_cashout_count_30d", "payer_txn_count_1h"],
    "payer_merchant": ["payer_merchant_prior_count", "amount_to_merchant_median", "merchant_new_for_payer",
                       "payer_merchant_count_10m"],
    "merchant": ["merchant_distinct_payers_30d", "merchant_round_share_30d", "merchant_cashout_ratio_7d",
                 "merchant_cashout_lag_min", "merchant_age_days"],
}
BOOTSTRAP_SAMPLES = 1000

# Agreed gates for synthetic data (user decision, Phase 2 plan).
# Generator v5 (2026-10-07): the hold-out month contains merchants and a ring the
# model never saw, so the FLAG recall gate moved from 0.85 to 0.80 and a gate on
# the system catch rate (FLAG or REVIEW step-up) was added at 0.85. Recall on
# channels seen in training stays above 0.95 (metrics.json → abuser_pseudo_seen_above_flag).
GATES = {
    "pr_auc_min": 0.90,
    "recall_at_flag_min": 0.80,
    "recall_at_review_min": 0.85,
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


def bootstrap_ci(y: np.ndarray, risk: np.ndarray, flag_t: float, n: int = BOOTSTRAP_SAMPLES, seed: int = 0) -> dict:
    """95% percentile intervals from resampling the hold-out rows (with replacement)."""
    rng = np.random.default_rng(seed)
    ap, rec, fpr = [], [], []
    for _ in range(n):
        idx = rng.integers(0, len(y), len(y))
        yy, rr = y[idx], risk[idx]
        if yy.sum() == 0 or yy.sum() == len(yy):
            continue
        ap.append(average_precision_score(yy, rr))
        rec.append(np.mean(rr[yy == 1] >= flag_t))
        fpr.append(np.mean(rr[yy == 0] >= flag_t))
    lo, hi = 2.5, 97.5
    return {
        "samples": len(ap),
        "pr_auc": [float(np.percentile(ap, lo)), float(np.percentile(ap, hi))],
        "recall_at_flag": [float(np.percentile(rec, lo)), float(np.percentile(rec, hi))],
        "fpr_at_flag": [float(np.percentile(fpr, lo)), float(np.percentile(fpr, hi))],
    }


def importance(model: RiskModel, test: pd.DataFrame) -> dict:
    """Mean |SHAP| on the hold-out split (same pred_contribs call the /explain endpoint uses) and XGBoost gain."""
    X = test[model.features].to_numpy(dtype=np.float32)
    contribs = model.booster.predict(xgb.DMatrix(X, feature_names=model.features), pred_contribs=True)
    mean_abs = {f: float(v) for f, v in zip(model.features, np.abs(contribs[:, :-1]).mean(axis=0))}
    gain = model.booster.get_score(importance_type="gain")
    total = sum(gain.values()) or 1.0
    return {
        "mean_abs_shap": dict(sorted(mean_abs.items(), key=lambda kv: -kv[1])),
        "gain_share": {f: float(gain.get(f, 0.0) / total) for f in sorted(model.features, key=lambda f: -gain.get(f, 0.0))},
    }


def ablation(train: pd.DataFrame, test: pd.DataFrame, flag_target_fpr: float) -> dict:
    """PR-AUC after dropping one feature group at a time (and with each group alone)."""
    from .train import calibrate

    y = test.label.to_numpy()
    out = {}

    def run(name: str, feats: list[str]) -> None:
        clf = fit_xgb(train, feats)
        r = clf.predict_proba(test[feats].astype(float))[:, 1]
        ft = calibrate(r, y, flag_target_fpr)
        out[name] = {"features": len(feats), "pr_auc": float(average_precision_score(y, r)),
                     "recall_at_flag": float(np.mean(r[y == 1] >= ft)), "fpr_at_flag": float(np.mean(r[y == 0] >= ft))}

    run("all", F.FEATURES)
    for g, feats in FEATURE_GROUPS.items():
        run(f"without_{g}", [f for f in F.FEATURES if f not in feats])
    for g, feats in FEATURE_GROUPS.items():
        run(f"only_{g}", feats)
    return out


def main() -> int:
    events, wallets, data = build()
    model = RiskModel()
    t = model.thresholds
    test = data[data.split == "test"].reset_index(drop=True)
    y = test.label.to_numpy()
    risk = model.risk(test)
    flagged = risk >= t["flag"]
    # Positives paid to merchants that never appear in the training split (new mule
    # merchants): the case the model must generalise to.
    seen_merchants = set(data.loc[data.split == "train", "payee"])
    unseen_pos = ((~test.payee.isin(seen_merchants)) & (y == 1)).to_numpy()

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
        "abuser_pseudo_seen_above_flag": float(np.mean(risk[abuser_pseudo & ~unseen_pos] >= t["flag"])),
        "abuser_pseudo_unseen_above_flag": float(np.mean(risk[abuser_pseudo & unseen_pos] >= t["flag"])) if (abuser_pseudo & unseen_pos).any() else None,
        "fpr_by_region": region_fpr,
        "fpr_by_segment": seg_fpr,
        "fairness_limit": fairness_limit,
        "test_rows": int(len(test)),
        "test_positives": int(y.sum()),
        "test_positives_to_unseen_merchants": int(unseen_pos.sum()),
        "recall_at_flag_unseen_merchants": float(np.mean(flagged[unseen_pos])) if unseen_pos.any() else None,
        "ci95": bootstrap_ci(y, risk, t["flag"]),
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
    after = -retrained.decision_function(F.anomaly_matrix(drift_rows)) >= 0
    if_metrics["drift_rows"] = int(len(drift_rows))
    if_metrics["drift_alert_rate_before"] = float(np.mean(model.anomaly(drift_rows) >= 0))
    if_metrics["drift_alert_rate_after_retrain"] = float(np.mean(after))
    # Gated on the Wilson 95% lower bound, like XGB-11: ~1,000 drift rows make the
    # point estimate move by ±0.5 pt between generator seeds.
    if_metrics["drift_alert_rate_after_retrain_lower95"] = wilson_lower(int(after.sum()), int(len(after)))

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
        "XGB-03 recall_at_review": xgb_metrics["recall_at_review"] >= GATES["recall_at_review_min"],
        "XGB-03 fpr_at_flag": xgb_metrics["fpr_at_flag"] <= GATES["fpr_at_flag_max"],
        "XGB-05 normal_legit_below_review": xgb_metrics["normal_legit_below_review"] >= GATES["normal_legit_below_review_min"],
        "XGB-06 minority_recall": xgb_metrics["recall_at_flag"] > 0,
        "XGB-11 fairness": all(v["fpr_lower95"] <= fairness_limit for v in {**region_fpr, **seg_fpr}.values()),
        "IF-02 in_pattern": if_metrics["in_pattern_not_flagged"] >= GATES["if_in_pattern_not_flagged_min"],
        "IF-03 spike": if_metrics["spike_flagged"] >= GATES["if_spike_flagged_min"],
        "IF-04 night": if_metrics["night_score_increase"] >= GATES["if_night_score_increase_min"],
        "IF-05 velocity": if_metrics["velocity_flagged"] >= GATES["if_velocity_flagged_min"],
        "IF-07 drift": if_metrics["drift_alert_rate_after_retrain_lower95"] <= 2 * CONTAMINATION,
    }

    imp = importance(model, test)
    abl = ablation(train, test, t["flag_target_fpr"])
    cfg = model.metadata.get("synth_config", {})
    data_notes = {
        "generator_version": model.metadata.get("generator_version"),
        "held_out_pseudo_merchants": cfg.get("holdout_pseudo"),
        "held_out_rings": cfg.get("holdout_rings"),
        "mimic_abuser_share": cfg.get("mimic_share"),
        "abuse_via_legit_fast_shops_share": cfg.get("abuser_legit_share"),
        "test_merchants_unseen_in_training": int((~test.payee.isin(seen_merchants)).sum()),
    }

    REPORTS.mkdir(exist_ok=True)
    report = {
        "model_version": model.version,
        "training_date": model.metadata["training_date"],
        "thresholds": t,
        "gates": GATES,
        "data": data_notes,
        "xgb": xgb_metrics,
        "importance": imp,
        "ablation": abl,
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

    # Feature importance: mean |SHAP| on the hold-out split.
    names = list(imp["mean_abs_shap"])[::-1]
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.barh(names, [imp["mean_abs_shap"][n] for n in names])
    ax.set_xlabel("mean |SHAP| (log-odds), test split")
    ax.set_title("Feature importance")
    fig.tight_layout()
    fig.savefig(REPORTS / "feature_importance.png", dpi=120)

    # Score distribution by class (log scale so the minority class is visible).
    fig, ax = plt.subplots(figsize=(5, 4))
    bins = np.linspace(0, 1, 41)
    ax.hist(risk[y == 0], bins=bins, alpha=0.6, label=f"legitimate (n={int((y == 0).sum())})")
    ax.hist(risk[y == 1], bins=bins, alpha=0.6, label=f"disguised cash-out (n={int(y.sum())})")
    for name in ("review", "flag"):
        ax.axvline(t[name], linestyle="--", linewidth=1, color="black")
    ax.set_yscale("log")
    ax.set_xlabel("risk score")
    ax.set_ylabel("payments")
    ax.set_title("Hold-out score distribution")
    ax.legend(loc="upper center")
    fig.tight_layout()
    fig.savefig(REPORTS / "score_hist.png", dpi=120)

    # Reliability curve: are the scores honest probabilities?
    frac, mean_pred = calibration_curve(y, risk, n_bins=10, strategy="uniform")
    fig, ax = plt.subplots(figsize=(4.5, 4))
    ax.plot([0, 1], [0, 1], linestyle=":", color="grey", label="perfect")
    ax.plot(mean_pred, frac, marker="o", label="XGBoost")
    ax.set_xlabel("mean predicted risk")
    ax.set_ylabel("observed cash-out rate")
    ax.set_title("Calibration, test split")
    ax.legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(REPORTS / "calibration.png", dpi=120)

    for name, ok in checks.items():
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print(json.dumps({k: v for k, v in xgb_metrics.items() if not isinstance(v, dict)}, indent=2))
    print(json.dumps(if_metrics, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
