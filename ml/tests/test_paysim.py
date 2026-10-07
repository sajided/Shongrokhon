"""PaySim mapping (external validation, model card §6). The CSV itself is not needed."""
import numpy as np
import pandas as pd

from shongrokhon_ml import features as F
from shongrokhon_ml import paysim
from shongrokhon_ml.synth import DAY0


def _rows():
    # A victim transfers to a mule, the mule cashes out an hour later (the PaySim fraud
    # shape); a shopper pays a merchant; a cash-in and a debit that must be dropped.
    return pd.DataFrame([
        dict(step=10, type="TRANSFER", amount=181_000.0, nameOrig="C_victim", nameDest="C_mule", isFraud=1, isFlaggedFraud=0),
        dict(step=11, type="CASH_OUT", amount=181_000.0, nameOrig="C_mule", nameDest="C_bank", isFraud=1, isFlaggedFraud=0),
        dict(step=12, type="PAYMENT", amount=950.5, nameOrig="C_shopper", nameDest="M_shop", isFraud=0, isFlaggedFraud=0),
        dict(step=12, type="CASH_IN", amount=500.0, nameOrig="C_shopper", nameDest="C_shopper", isFraud=0, isFlaggedFraud=0),
        dict(step=13, type="DEBIT", amount=20.0, nameOrig="C_shopper", nameDest="C_bank", isFraud=0, isFlaggedFraud=0),
        dict(step=14, type="TRANSFER", amount=2_000.0, nameOrig="C_other", nameDest="C_mule", isFraud=0, isFlaggedFraud=0),
    ])


def test_to_events_maps_types_labels_and_time():
    ev = paysim.to_events(_rows())
    assert list(ev.columns) == ["txn_id", "type", "payer", "payee", "amount", "ts", "label"]
    assert ev.txn_id.is_unique and ev.ts.is_monotonic_increasing
    assert set(ev.type) == {"PAYMENT", "CASHOUT"}  # CASH_IN and DEBIT dropped
    fraud = ev[(ev.type == "PAYMENT") & (ev.payer == "C_victim")].iloc[0]
    assert fraud.payee == "C_mule" and fraud.label == 1 and fraud.ts == DAY0 + 10 * 3600
    cash = ev[ev.type == "CASHOUT"].iloc[0]
    assert cash.payer == "C_mule" and cash.payee == "SYSTEM" and cash.label == 0
    assert ev[ev.type == "PAYMENT"].label.sum() == 1


def test_mule_cashout_shows_up_in_merchant_features():
    ev = paysim.to_events(_rows())
    history = F.History(ev)
    # The later transfer to the mule sees the mule's earlier receipt and quick cash-out.
    X = F.compute(history, pd.DataFrame([dict(payer="C_other", payee="C_mule", amount=2000.0, ts=DAY0 + 14 * 3600)]))
    assert X.merchant_cashout_ratio_7d.iloc[0] > 0.9
    assert X.merchant_cashout_lag_min.iloc[0] == 60.0
    assert X.merchant_distinct_payers_30d.iloc[0] == 1
    # Cold-start payer: PaySim customers appear once.
    assert X.payer_txn_count_90d.iloc[0] == 0


def test_history_subset_keeps_payee_receipts_and_cashouts():
    df = _rows()
    queries = df[(df.type == "TRANSFER") & (df.nameOrig == "C_other")]
    hist = paysim.history_for(df, queries)
    assert {"C_victim", "C_mule", "C_other"} <= set(hist.nameOrig)
    assert "C_shopper" not in set(hist.nameOrig)


def test_split_is_by_time():
    s = paysim.split_for(pd.Series([0, paysim.TRAIN_END_STEP - 1, paysim.TRAIN_END_STEP, paysim.VAL_END_STEP, 743]))
    assert list(s) == ["train", "train", "val", "test", "test"]


def test_missing_csv_exits_with_instructions(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(paysim, "DATA_DIR", tmp_path / "nowhere")
    assert paysim.main() == 2
    assert "kaggle.com/datasets/ealaxi/paysim1" in capsys.readouterr().err
    assert isinstance(np.int64(1), np.integer)
