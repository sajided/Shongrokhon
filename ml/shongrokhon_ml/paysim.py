"""External validation of the cash-out pipeline on PaySim (model card §6).

PaySim is a public simulation of one month of mobile-money transactions from an
African operator (Lopez-Rojas et al., 2016; Kaggle `ealaxi/paysim1`). It is
independent of our generator, so it answers "does the pipeline learn anything
that is not an artefact of synth.py?". Its fraud pattern is a TRANSFER into a
mule account followed by a CASH_OUT from that account, which is the signal
`merchant_cashout_ratio_7d` / `merchant_cashout_lag_min` were designed for.

    npm run ml:paysim            # needs ml/data/paysim/<file>.csv (see download())

The CSV (about 470 MB, 6.36 M rows) is not committed. Download it from
https://www.kaggle.com/datasets/ealaxi/paysim1 and unzip it into ml/data/paysim/.

What is reused from the production pipeline, unchanged: the event schema,
`features.History` / `features.compute` (all 22 features), `train.fit_xgb`
(same hyper-parameters) and `train.calibrate` (same target false-positive rates).

Caveats, also written to the report:
  * PaySim has no per-customer history: nearly every `nameOrig` appears once, so
    the payer-behaviour features sit at their cold-start values and only the
    amount, time and payee-side features carry signal.
  * One month of data truncates our 30/90-day windows.
  * The PaySim fraud is "drain the account into a mule, cash out", not the
    disguised cash-out at a pseudo-merchant our generator models. Balance
    columns are not used (PaySim cancels detected frauds, which leaks the label).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, confusion_matrix, precision_recall_curve

from . import features as F
from .synth import DAY0
from .train import FLAG_TARGET_FPR, REVIEW_TARGET_FPR, calibrate, fit_xgb

DATA_DIR = Path(os.environ.get("ML_PAYSIM_DIR", Path(__file__).resolve().parents[1] / "data" / "paysim"))
REPORTS = Path(__file__).resolve().parents[1] / "reports"

STEP_SECONDS = 3600          # one PaySim step is one hour
TRAIN_END_STEP = 500         # ~21 days train, 5 days validation, 5 days test
VAL_END_STEP = 620
N_NEG_PAYMENT = 40_000       # sampled legitimate PAYMENT rows (to merchants)
N_NEG_TRANSFER = 40_000      # sampled legitimate TRANSFER rows (to customer accounts)
SEED = 42

COLUMNS = ["step", "type", "amount", "nameOrig", "nameDest", "isFraud", "isFlaggedFraud"]


def download_hint() -> str:
    return (
        f"PaySim CSV not found in {DATA_DIR}.\n"
        "Download https://www.kaggle.com/datasets/ealaxi/paysim1 (Kaggle account needed), unzip, and put\n"
        f"the .csv in {DATA_DIR} (gitignored). Then run: npm run ml:paysim"
    )


def find_csv() -> Path | None:
    files = sorted(DATA_DIR.glob("*.csv")) if DATA_DIR.exists() else []
    return files[0] if files else None


def to_events(df: pd.DataFrame) -> pd.DataFrame:
    """PaySim rows -> the events table synth.py documents.

    PAYMENT and TRANSFER become PAYMENT events (payer -> payee) labelled with
    isFraud; CASH_OUT becomes a CASHOUT event by the account that cashed out.
    CASH_IN and DEBIT carry no signal for this model and are dropped.
    """
    ts = DAY0 + df.step.astype(np.int64) * STEP_SECONDS
    pay = df.type.isin(["PAYMENT", "TRANSFER"])
    cash = df.type == "CASH_OUT"
    events = pd.concat([
        pd.DataFrame({"type": "PAYMENT", "payer": df.nameOrig[pay], "payee": df.nameDest[pay],
                      "amount": df.amount[pay].round(2), "ts": ts[pay], "label": df.isFraud[pay].astype(int)}),
        pd.DataFrame({"type": "CASHOUT", "payer": df.nameOrig[cash], "payee": "SYSTEM",
                      "amount": df.amount[cash].round(2), "ts": ts[cash], "label": 0}),
    ], ignore_index=True)
    events = events.sort_values(["ts", "type", "payer"], kind="mergesort").reset_index(drop=True)
    events.insert(0, "txn_id", np.arange(len(events)))
    return events


def sample_queries(df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """Rows to score: every fraudulent TRANSFER plus random legitimate PAYMENT and TRANSFER rows."""
    fraud = df[(df.isFraud == 1) & (df.type == "TRANSFER")]
    legit_pay = df[(df.isFraud == 0) & (df.type == "PAYMENT")]
    legit_tr = df[(df.isFraud == 0) & (df.type == "TRANSFER")]
    parts = [fraud,
             legit_pay.sample(min(N_NEG_PAYMENT, len(legit_pay)), random_state=int(rng.integers(2**31))),
             legit_tr.sample(min(N_NEG_TRANSFER, len(legit_tr)), random_state=int(rng.integers(2**31)))]
    return pd.concat(parts).sort_values("step", kind="mergesort")


def history_for(df: pd.DataFrame, queries: pd.DataFrame) -> pd.DataFrame:
    """The subset of PaySim rows the sampled queries' features depend on: everything by the
    payers, everything received by the payees and the payees' own cash-outs."""
    payers = set(queries.nameOrig)
    payees = set(queries.nameDest)
    keep = df.nameOrig.isin(payers) | df.nameDest.isin(payees) | (df.nameOrig.isin(payees) & (df.type == "CASH_OUT"))
    return df[keep]


def split_for(step: pd.Series) -> pd.Series:
    return pd.Series(np.where(step < TRAIN_END_STEP, "train", np.where(step < VAL_END_STEP, "val", "test")), index=step.index)


def main() -> int:
    csv = find_csv()
    if csv is None:
        print(download_hint(), file=sys.stderr)
        return 2
    rng = np.random.default_rng(SEED)
    df = pd.read_csv(csv, usecols=COLUMNS)
    total_rows, total_fraud = len(df), int(df.isFraud.sum())

    queries = sample_queries(df, rng)
    hist = history_for(df, queries)
    events = to_events(hist)
    history = F.History(events)
    q = pd.DataFrame({"payer": queries.nameOrig.values, "payee": queries.nameDest.values,
                      "amount": queries.amount.values, "ts": DAY0 + queries.step.values.astype(np.int64) * STEP_SECONDS})
    X = F.compute(history, q)
    data = pd.concat([q.reset_index(drop=True), X.reset_index(drop=True)], axis=1)
    data["label"] = queries.isFraud.values.astype(int)
    data["flagged_by_paysim_rule"] = queries.isFlaggedFraud.values.astype(int)
    data["split"] = split_for(queries.step.reset_index(drop=True))

    train, val, test = (data[data.split == s] for s in ("train", "val", "test"))
    clf = fit_xgb(train)
    val_scores = clf.predict_proba(val[F.FEATURES].astype(float))[:, 1]
    flag_t = calibrate(val_scores, val.label.to_numpy(), FLAG_TARGET_FPR)
    review_t = calibrate(val_scores, val.label.to_numpy(), REVIEW_TARGET_FPR, upper=flag_t)

    y = test.label.to_numpy()
    risk = clf.predict_proba(test[F.FEATURES].astype(float))[:, 1]
    flagged = risk >= flag_t
    tn, fp, fn, tp = confusion_matrix(y, flagged, labels=[0, 1]).ravel()
    gain = clf.get_booster().get_score(importance_type="gain")
    total_gain = sum(gain.values()) or 1.0

    report = {
        "dataset": "PaySim 1 (Kaggle ealaxi/paysim1)",
        "file": csv.name,
        "source_rows": total_rows,
        "source_frauds": total_fraud,
        "sampling": {"all_fraud_transfers": int((queries.isFraud == 1).sum()),
                     "legit_payments": N_NEG_PAYMENT, "legit_transfers": N_NEG_TRANSFER,
                     "history_rows_indexed": int(len(events)), "seed": SEED},
        "split": {"by": "time (step)", "train_end_step": TRAIN_END_STEP, "val_end_step": VAL_END_STEP,
                  "rows": {s: int((data.split == s).sum()) for s in ("train", "val", "test")},
                  "positives": {s: int(data.loc[data.split == s, "label"].sum()) for s in ("train", "val", "test")}},
        "thresholds": {"review": review_t, "flag": flag_t,
                       "flag_target_fpr": FLAG_TARGET_FPR, "review_target_fpr": REVIEW_TARGET_FPR},
        "xgb": {
            "pr_auc": float(average_precision_score(y, risk)),
            "recall_at_flag": float(tp / max(tp + fn, 1)),
            "fpr_at_flag": float(fp / max(fp + tn, 1)),
            "precision_at_flag": float(tp / max(tp + fp, 1)),
            "recall_at_review": float(np.mean(risk[y == 1] >= review_t)),
            "fpr_at_review": float(np.mean(risk[y == 0] >= review_t)),
            "confusion_at_flag": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        },
        "paysim_builtin_rule": {  # isFlaggedFraud: PaySim's own rule (transfers above 200k)
            "recall_on_test": float(np.mean(test.flagged_by_paysim_rule[y == 1])),
            "fpr_on_test": float(np.mean(test.flagged_by_paysim_rule[y == 0])),
        },
        "gain_share": {f: float(gain.get(f, 0.0) / total_gain) for f in sorted(F.FEATURES, key=lambda f: -gain.get(f, 0.0))},
        "note": (
            "Independent synthetic data (PaySim), retrained with the production feature code and hyper-parameters. "
            "PaySim has no per-customer history, so payer-behaviour features are at cold-start values; "
            "one month of data truncates the 30/90-day windows; balance columns are not used."
        ),
    }
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "paysim.json").write_text(json.dumps(report, indent=2) + "\n")

    import matplotlib.pyplot as plt

    p, r, _ = precision_recall_curve(y, risk)
    fig, ax = plt.subplots(figsize=(5, 4))
    ax.plot(r, p)
    ax.axvline(report["xgb"]["recall_at_flag"], linestyle="--", linewidth=1, label=f"flag ({flag_t})")
    ax.set_xlabel("Recall (fraud transfers)")
    ax.set_ylabel("Precision")
    ax.set_title(f"PaySim hold-out PR curve — AP {report['xgb']['pr_auc']:.3f}")
    ax.legend(loc="lower left")
    fig.tight_layout()
    fig.savefig(REPORTS / "paysim_pr_curve.png", dpi=120)

    print(json.dumps({k: report[k] for k in ("split", "thresholds", "xgb", "paysim_builtin_rule")}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
