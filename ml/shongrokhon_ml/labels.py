"""Analyst labels for retraining (TC-P4-INV-08, TC-MET-01).

Compliance analysts mark alerts as confirmed abuse (1) or false positive (0) in
the Investigation Assistant; public.training_labels keeps the latest decision
with the exact features the model scored. This exports them as a labelled
feature table that train.py can append to the synthetic data.

    python -m shongrokhon_ml.labels --out .cache/analyst_labels.csv
"""
from __future__ import annotations

import argparse
import json
import os

import pandas as pd

from .features import FEATURES


def to_frame(rows: list[dict]) -> pd.DataFrame:
    """rows: {risk_score_id, label, model_version, features (dict or JSON text), updated_at}."""
    records = []
    for r in rows:
        feats = r["features"] if isinstance(r["features"], dict) else json.loads(r["features"])
        records.append({"risk_score_id": str(r["risk_score_id"]), "label": int(r["label"]),
                        "model_version": r["model_version"], "updated_at": r["updated_at"],
                        **{k: float(feats[k]) if feats.get(k) is not None else float("nan") for k in FEATURES}})
    return pd.DataFrame(records, columns=["risk_score_id", "label", "model_version", "updated_at", *FEATURES])


def fetch(db_url: str) -> list[dict]:
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        return conn.execute("select risk_score_id, label, model_version, features, updated_at "
                            "from public.training_labels order by updated_at").fetchall()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".cache/analyst_labels.csv")
    args = ap.parse_args()
    frame = to_frame(fetch(os.environ["ML_DB_URL"]))
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    frame.to_parquet(args.out) if args.out.endswith(".parquet") else frame.to_csv(args.out, index=False)
    print(f"wrote {len(frame)} analyst labels ({int(frame.label.sum())} confirmed) to {args.out}")


if __name__ == "__main__":
    main()
