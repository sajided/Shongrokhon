"""TC-P2-FLOW-08 (network side): ring detection on the synthetic population."""
import pytest

from shongrokhon_ml import network
from shongrokhon_ml.synth import DAY, DAY0, WINDOW_DAYS


@pytest.fixture(scope="module")
def result(dataset):
    events, wallets, _ = dataset
    now = DAY0 + WINDOW_DAYS * DAY - 1
    rings, scores = network.detect(events, now)
    return events, wallets, rings, scores


def test_every_synthetic_ring_is_found_as_one_group(result):
    events, wallets, rings, _ = result
    seg = wallets.set_index("wallet").segment
    ring_members = wallets[wallets.segment == "ring"].wallet.tolist()
    groups = [set(r.payers) for r in rings]
    # Members of each simulated ring (8 consecutive wallets) land together in one detected ring.
    for i in range(0, len(ring_members), 8):
        members = set(ring_members[i:i + 8])
        assert any(len(members & g) >= 6 for g in groups), f"ring {i // 8} not detected"
    # Rings never consist of ordinary customers.
    for r in rings:
        legit = sum(seg[p] in ("normal", "cashheavy", "drift") for p in r.payers)
        assert legit / len(r.payers) < 0.2


def test_ring_merchants_cross_the_flag_override_and_legit_ones_do_not(result):
    _, wallets, rings, scores = result
    seg = wallets.set_index("wallet").segment
    ring_merchants = {m for r in rings for m in r.merchants}
    assert ring_merchants and all(scores[m] >= 0.8 for m in ring_merchants)
    assert all(s < 0.8 for m, s in scores.items() if seg.get(m) == "legit")


def test_fingerprint_is_stable(result):
    _, _, rings, _ = result
    r = rings[0]
    again = network.Ring(list(reversed(r.payers)), r.merchants, r.score, r.flow, r.payments)
    assert again.fingerprint == r.fingerprint
