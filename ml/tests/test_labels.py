"""TC-P4-INV-08: analyst labels become a labelled feature table for retraining."""
import math

from shongrokhon_ml import labels
from shongrokhon_ml.features import FEATURES


def test_inv_08_labels_become_training_rows(model):
    feats = {k: 1.0 for k in FEATURES}
    rows = [
        {"risk_score_id": "a", "label": 1, "model_version": "p2-x", "features": feats, "updated_at": "2026-10-03"},
        {"risk_score_id": "b", "label": 0, "model_version": "p2-x", "features": '{"amount": 500}', "updated_at": "2026-10-04"},
    ]
    frame = labels.to_frame(rows)
    assert list(frame.label) == [1, 0]
    assert list(frame.columns[4:]) == FEATURES
    assert frame.loc[1, "amount"] == 500 and math.isnan(frame.loc[1, "merchant_age_days"])
    # The model scores exported rows exactly like live requests (missing features -> training medians).
    assert len(model.score(frame[FEATURES].to_dict("records"))) == 2
