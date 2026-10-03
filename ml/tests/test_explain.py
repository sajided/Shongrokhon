"""TC-P4-INV-03/04: SHAP explanations of the risk model (/explain)."""
import math

import numpy as np

from test_service import VALID


def logit(p: float) -> float:
    return math.log(p / (1 - p))


def test_inv_04_shap_sums_to_the_model_output_on_1000_rows(model, dataset):
    _, _, data = dataset
    test = data[data.split == "test"]
    # Include every positive, so abuse explanations are checked too.
    rows = data.loc[test.index.union(test[test.label == 1].index)].sample(n=1000, random_state=7)
    worst = worst_prob = 0.0
    for r in rows[model.features].to_dict("records"):
        e = model.explain(r)
        # SHAP values add up to the raw model output (log-odds)...
        worst = max(worst, abs(e.base_value + sum(e.contributions.values()) - e.margin))
        # ...and that output is the served probability.
        worst_prob = max(worst_prob, abs(1 / (1 + math.exp(-e.margin)) - e.risk_score))
    assert worst < 1e-4
    assert worst_prob < 1e-5


def test_inv_04_explained_score_matches_the_served_score(model):
    e = model.explain(dict(VALID))
    [s] = model.score([dict(VALID)])
    assert abs(e.risk_score - s.risk_score) < 1e-6


def test_inv_03_explain_endpoint_returns_every_feature(client, auth, model):
    r = client.post("/explain", json={**VALID, "model_version": model.version}, headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert set(body["contributions"]) == set(model.features)
    total = body["base_value"] + sum(body["contributions"].values())
    assert abs(total - body["margin"]) < 1e-4
    assert abs(total - logit(body["risk_score"])) < 1e-3  # not near 0/1 here, so float32 probability is precise enough


def test_inv_03_abuse_pattern_is_explained_by_cash_out_features(client, auth, model):
    abuse = {**VALID, "amount": 10000.0, "is_round_1000": 1.0, "merchant_cashout_ratio_7d": 0.95,
             "merchant_round_share_30d": 0.9, "merchant_cashout_lag_min": 8.0, "merchant_distinct_payers_30d": 3.0,
             "amount_to_median": 20.0, "merchant_new_for_payer": 1.0}
    body = client.post("/explain", json={**abuse, "model_version": model.version}, headers=auth).json()
    top = sorted(body["contributions"].items(), key=lambda kv: -abs(kv[1]))[:5]
    assert body["risk_score"] > 0.5
    assert any(name.startswith("merchant_") for name, value in top if value > 0)


def test_explain_requires_the_service_token_and_the_matching_model(client, auth, model):
    assert client.post("/explain", json={**VALID, "model_version": model.version}).status_code == 401
    r = client.post("/explain", json={**VALID, "model_version": "p0-old"}, headers=auth)
    assert r.status_code == 409


def test_contributions_are_finite(model):
    e = model.explain(dict(VALID))
    assert all(np.isfinite(v) for v in e.contributions.values())
