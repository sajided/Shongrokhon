"""Builds the labelled feature dataset and the leakage-free split (TC-P2-XGB-01)."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pandas as pd

from . import features as F
from .synth import DAY, DAY0, GENERATOR_VERSION, SynthConfig, generate, labelled_window

# Time windows inside the labelled period (days since DAY0).
TRAIN_END_DAY = 120  # months 1-4
VAL_END_DAY = 151    # month 5; month 6 is test

CACHE_DIR = Path(os.environ.get("ML_CACHE_DIR", Path(__file__).resolve().parents[1] / ".cache"))


def user_split(wallet: str, seed: int) -> str:
    """Stable per-user assignment so no user appears in more than one split."""
    h = int(hashlib.sha1(f"{seed}:{wallet}".encode()).hexdigest(), 16) % 100
    return "train" if h < 70 else "val" if h < 85 else "test"


def time_split(ts: int) -> str:
    day = (ts - DAY0) // DAY
    return "train" if day < TRAIN_END_DAY else "val" if day < VAL_END_DAY else "test"


def build(cfg: SynthConfig = SynthConfig(), use_cache: bool = True) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Returns (events, wallets, data). `data` holds FEATURES plus meta columns:
    txn_id, payer, payee, ts, label, segment, region, payee_segment, user_split, time_split, split.
    `split` is set only where the user and time assignments agree; other rows have split=None.
    """
    key = hashlib.sha1(repr((GENERATOR_VERSION, sorted(cfg.__dict__.items()), F.FEATURES)).encode()).hexdigest()[:12]
    cache = CACHE_DIR / f"dataset-{key}.pkl"
    if use_cache and cache.exists():
        return pd.read_pickle(cache)

    events, wallets = generate(cfg)
    rows = labelled_window(events)
    history = F.History(events)
    X = F.compute(history, rows)
    seg = wallets.set_index("wallet")
    data = pd.concat([rows[["txn_id", "payer", "payee", "ts", "label"]], X], axis=1)
    data["segment"] = data.payer.map(seg.segment)
    data["region"] = data.payer.map(seg.region)
    data["payee_segment"] = data.payee.map(seg.segment)
    data["user_split"] = [user_split(w, cfg.seed) for w in data.payer]
    data["time_split"] = [time_split(int(t)) for t in data.ts]
    data["split"] = data.user_split.where(data.user_split == data.time_split)
    data = data.reset_index(drop=True)

    result = (events, wallets, data)
    if use_cache:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        pd.to_pickle(result, cache)
    return result
