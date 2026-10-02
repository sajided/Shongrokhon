"""app_config defaults in the risk migration must match the calibrated thresholds
(TC-P2-XGB-09): the SQL decision is authoritative, so drift here would silently
change who gets stepped up or flagged."""
import json
import re
from pathlib import Path

from shongrokhon_ml.train import ARTIFACTS

MIGRATION = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "20261002000006_risk.sql"


def default(column: str) -> float:
    m = re.search(rf"{column} float8 not null default ([0-9.]+)", MIGRATION.read_text())
    assert m, column
    return float(m.group(1))


def test_migration_defaults_match_model_metadata():
    t = json.loads((ARTIFACTS / "metadata.json").read_text())["thresholds"]
    assert default("risk_review_threshold") == t["review"]
    assert default("risk_flag_threshold") == t["flag"]
    assert default("anomaly_threshold") == t["anomaly"]
