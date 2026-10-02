"""TC-P2-MLAPI-01..04, 07..09."""
import logging
import re
import time

import pytest

VALID = {
    "request_id": "6f1c1e1a-0000-4000-8000-000000000001",
    "amount": 500.0, "payer_txn_count_90d": 40.0, "payer_median_amount_90d": 450.0, "amount_to_median": 1.1,
    "payer_hour_share": 0.4, "payer_merchant_prior_count": 20.0, "amount_to_merchant_median": 1.0,
    "merchant_new_for_payer": 0.0, "merchant_distinct_payers_30d": 30.0, "merchant_cashout_lag_min": 300.0,
    "merchant_age_days": 365.0, "hour_sin": 0.5, "hour_cos": -0.8,
}


def test_mlapi_01_health_reports_loaded_versions(client, model):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["models"]["xgboost"] == model.version


def test_mlapi_02_valid_request(client, auth):
    r = client.post("/score", json=VALID, headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"risk_score", "anomaly_score", "low_confidence", "decision", "model_version"}
    assert 0 <= body["risk_score"] <= 1 and body["decision"] == "ALLOW"


@pytest.mark.parametrize("payload, field", [
    ({k: v for k, v in VALID.items() if k != "amount"}, "amount"),
    ({**VALID, "amount": "500"}, "amount"),
    ({**VALID, "amount": -5.0}, "amount"),
    ({**VALID, "payer_txn_count_90d": "lots"}, "payer_txn_count_90d"),
])
def test_mlapi_03_schema_validation(client, auth, payload, field):
    r = client.post("/score", json=payload, headers=auth)
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "INVALID_REQUEST"
    assert field in [e["field"] for e in body["errors"]]
    # Field names and error types only: no traceback and no echo of the submitted values.
    assert "Traceback" not in r.text and "lots" not in r.text and '"500"' not in r.text
    assert all(set(e) == {"field", "type"} for e in body["errors"])


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong-token-xxxxxxxxxxxx"}, {"Authorization": "Basic abc"}])
def test_mlapi_04_requires_service_token(client, headers):
    r = client.post("/score", json=VALID, headers=headers)
    assert r.status_code == 401


def test_mlapi_07_models_are_loaded_before_first_request(auth):
    from fastapi.testclient import TestClient

    from shongrokhon_ml.service import app

    with TestClient(app) as fresh:
        started = time.perf_counter()
        r = fresh.post("/score", json=VALID, headers=auth)
        assert r.status_code == 200
        assert (time.perf_counter() - started) * 1000 < 200


def test_mlapi_08_deterministic(client, auth):
    results = {client.post("/score", json=VALID, headers=auth).text for _ in range(10)}
    assert len(results) == 1


def test_mlapi_09_no_pii_in_logs(client, auth, caplog):
    caplog.set_level(logging.INFO, logger="shongrokhon_ml")
    # Callers never send PII; even if one did, unknown fields are dropped and never logged.
    client.post("/score", json={**VALID, "phone": "+8801711000001", "name": "Normal User", "pin": "12345"}, headers=auth)
    client.post("/score", json={**VALID, "amount": "bad", "phone": "+8801711000001"}, headers=auth)
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "decision=" in text
    assert not re.search(r"01711000001|Normal User|12345|\b500\.0\b", text)
