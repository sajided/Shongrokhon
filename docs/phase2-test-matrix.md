# Phase 2 Test Matrix: Risk Intelligence Pipeline

Covers every `TC-P2-*` case in `testcase.md` §2.1–2.5. For each case it gives where the test lives and the latest result.

**Run date:** 2026-10-02, local stack (Supabase CLI 2.75, Expo SDK 57 for web, Node 22, Playwright Chromium, Python 3.11 in Docker, XGBoost 2.1, scikit-learn 1.6). Model version `p2-1561165e`.

**Read this first: the data is synthetic.** There is no real MFS data, so both models are trained and evaluated on a seeded simulation (`ml/shongrokhon_ml/synth.py`). The near-perfect hold-out scores below show that the pipeline, features and gates work end to end. They say nothing about real-world accuracy, because simulated cash-out abuse is far easier to separate than real abuse. Retrain on real labelled data before relying on these thresholds.

**Policy decisions taken in Phase 2 (with the product owner):**
- **High risk (FLAG):** the payment executes. The system then raises an alert, flags the payer and merchant wallets, and sends both an in-app notice. `testcase.md` FLOW-02 was updated to match. The original wording was "held or blocked; ledger unchanged; neutral message".
- **Medium risk (REVIEW):** the user must re-enter their PIN before the payment executes (FLOW-03).
- **Model gates (synthetic data):**
  - PR-AUC ≥ 0.90
  - cash-out recall ≥ 0.85 at the flag threshold
  - FPR ≤ 1%
  - ≥ 99% of U-NORMAL → M-LEGIT payments below the review threshold
- **Ring detection:** an hourly batch graph job (networkx). It writes one group alert per ring and a per-merchant network score. A score ≥ 0.8 forces FLAG on live payments.

**Status legend:**
- ✅ **pass:** automated and passing.
- 🟡 **pending:** needs a device, real network or manual run that has not been done yet.
- ⚠️ **partial:** covered, with a caveat noted in the row.

**Test locations:**

| Location | What runs there |
|---|---|
| `ml/<file>` | pytest in Docker (`npm run ml:test`): `ml/tests/<file>.py` |
| `eval` | `python -m shongrokhon_ml.evaluate` gates, written to `ml/reports/metrics.json` and `pr_curve.png` |
| `bench` | `ml/bench/latency.py` against the running container (`npm run ml:bench`) |
| `db/04` | `supabase/tests/04_risk.test.sql` |
| `db/05` | `supabase/tests/05_feature_parity.test.sql` (generated: SQL features = Python features) |
| `int/risk` | `tests/integration/risk.test.ts` |
| `int/pay` | `tests/integration/payments.test.ts` (Phase 1 cases, now through the `pay` function) |
| `unit` / `comp` | Jest: `src/**`, `supabase/functions/pay/score.test.ts` |
| `e2e/risk` | `tests/e2e/risk.spec.ts` |

## 2.1 XGBoost Transaction Risk Model
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| XGB-01 | P0 | `ml/test_xgb` | ✅ | Users are hashed into train, validation or test, and each split is also time-boxed: months 1–4 train, month 5 validation, month 6 test. No user or transaction appears in two splits. Rows: 76,245 train / 4,182 validation / 4,084 test. |
| XGB-02 | P1 | `ml/test_features` | ✅ | Generating twice gives identical events and identical feature matrices. |
| XGB-03 | P0 | `eval`, `ml/test_xgb` | ✅ | Hold-out: PR-AUC 1.000, recall@flag 1.000, FPR@flag 0.000, FNR 0.000 (121 positives among 4,084 rows). Synthetic data, see the note at the top. |
| XGB-04 | P0 | `ml/test_xgb`, `ml/test_seed_personas`, `int/risk`, `e2e/risk` | ✅ | 100% of abuser → pseudo-merchant test payments score ≥ the flag threshold (0.5). The seeded U-ABUSER → MPSEUDO01 ৳10,000 is FLAG live. |
| XGB-05 | P0 | `eval`, `ml/test_xgb`, `ml/test_seed_personas` | ✅ | 100% of normal → legit payments score below the review threshold (gate: ≥ 99%). Seeded U-NORMAL → M-LEGIT ৳500 is ALLOW at every hour of the day. |
| XGB-06 | P1 | `eval`, `ml/test_xgb` | ✅ | Uses `scale_pos_weight` (negatives ÷ positives). Minority-class recall is 1.0. |
| XGB-07 | P0 | `ml/test_xgb` | ✅ | 10,000 random valid inputs: every score is finite and in [0, 1]. |
| XGB-08 | P1 | `ml/test_xgb`, `ml/test_service` | ✅ | Missing or null features fall back to training medians, amount-only features are derived, and unknown keys (e.g. `merchant_category`) are ignored. |
| XGB-09 | P1 | `train.calibrate`, `eval` (`pr_curve.png`) | ✅ | Thresholds are taken from the validation PR curve: FLAG 0.5 (target FPR 0.3%) and REVIEW 0.25 (target FPR 0.8%). The expected FPR and FNR are recorded in `metrics.json`. The `app_config` defaults must equal `metadata.json` (`ml/test_thresholds_in_sync`). |
| XGB-10 | P2 | `ml/test_xgb` | ✅ | `ml/artifacts/metadata.json` stores the version, training date, feature list, seed, thresholds and defaults. |
| XGB-11 | P2 | `eval`, `ml/test_xgb` | ✅ | FPR per region and per segment for legitimate customers. The agreed limit is 3× the overall FPR, with a 1% floor, tested on the Wilson 95% lower bound so tiny groups don't fail on noise. Every group is at 0. |

## 2.2 Isolation Forest Behavioral Anomaly Model
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| IF-01 | P0 | `ml/test_iforest` | ✅ | One global forest over user-relative features: amount vs. the user's usual ticket at this merchant, how usual this hour is for the user, 1-hour velocity and 10-minute repeats. Each user's baseline is computed from their last 90 days at scoring time. The artifact is `iforest.joblib`. |
| IF-02 | P0 | `eval`, `ml/test_iforest` | ✅ | Usual merchant, usual amount, usual hour: 60 of 60 established users not flagged. |
| IF-03 | P0 | `eval`, `ml/test_iforest`, `int/risk`, `e2e/risk` | ✅ | 10× the usual ticket: 60 of 60 flagged. Live, U-NORMAL paying ৳4,200 at Rahim Store returns STEP_UP_REQUIRED. |
| IF-04 | P1 | `eval`, `ml/test_iforest` | ✅ | A never-seen 3 AM payment raises the anomaly score for 98% of users (gate: ≥ 90%). |
| IF-05 | P0 | `eval`, `ml/test_iforest` | ✅ | 6 payments in 10 minutes to a new merchant: 100% flagged. |
| IF-06 | P0 | `ml/test_iforest`, `db/04` | ✅ | Fewer than 5 payments in 90 days sets `low_confidence`, and the score is still returned. In the SQL decision, an anomaly with low confidence never triggers step-up on its own. |
| IF-07 | P2 | `eval`, `ml/test_iforest` | ✅ | Drifting users in month 6: alert rate 2.2% with the production baseline, 1.9% after a rolling 90-day retrain (gate: ≤ 2 × contamination). |
| IF-08 | P2 | `eval`, `ml/test_iforest` | ✅ | Sweep from 0.01 to 0.05. Validation alert rates were 0.9%, 1.9%, 2.8%, 4.0% and 4.9%; spike detection was 100% at every setting. The chosen contamination is 0.01, the lowest friction with full detection. |

## 2.3 ML Microservice (FastAPI)
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| MLAPI-01 | P0 | `ml/test_service`, compose healthcheck | ✅ | `GET /health` returns 200 with the model version and training date. |
| MLAPI-02 | P0 | `ml/test_service` | ✅ | The response has exactly `risk_score`, `anomaly_score`, `low_confidence`, `decision` and `model_version`. |
| MLAPI-03 | P0 | `ml/test_service` | ✅ | A missing amount, a string amount, a negative amount or a non-numeric feature returns 422 `INVALID_REQUEST` with field names and error types only: no traceback, and no echo of the submitted values. |
| MLAPI-04 | P0 | `ml/test_service`, `unit` score.test.ts | ✅ | No token, a wrong token or the Basic scheme returns 401. The token is compared in constant time. Only the `pay` function holds it (`supabase/functions/.env`), and `check:secrets` fails if it reaches the bundle. |
| MLAPI-05 | P0 | `bench` | ✅ | 1,000 sequential requests in the Docker network: p50 5.5 ms, p95 10.5 ms (budget 200 ms). The serving path uses numpy only, with a vectorised Isolation Forest scorer whose equality with sklearn is tested. |
| MLAPI-06 | P1 | `bench` (`--concurrency 100 --duration 300`) | ⚠️ | **100 users, each paying about once a second, for 5 minutes:** 29,464 requests, 0 errors, p95 35 ms. ✅<br>**100 users firing back to back with no pause (saturation):** 342 req/s, error rate 0.001%, but p95 921 ms. ❌ against the 200 ms budget.<br>The service has 4 workers sharing one laptop VM with the load generator. Re-run on production-sized hardware, adding workers or replicas if needed. |
| MLAPI-07 | P1 | `ml/test_service` | ✅ | The models load and a warm-up prediction runs during startup. A fresh app's first `/score` takes under 200 ms. |
| MLAPI-08 | P1 | `ml/test_service` | ✅ | The same payload sent 10 times gives byte-identical responses. |
| MLAPI-09 | P1 | `ml/test_service` | ✅ | The service receives numeric features only; there are no IDs, phone numbers or names in the request. Logs hold `request_id`, decision and latency only. Even if a caller sends a phone number, name or PIN, it is dropped and never logged. |

## 2.4 Pipeline Integration: Scan → Score → Execute/Flag
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| FLOW-01 | P0 | `int/pay`, `int/risk`, `db/04`, `e2e/pay` | ✅ | U-NORMAL → M-LEGIT is scored by the model, decided ALLOW and executes. |
| FLOW-02 | P0 | `int/risk`, `db/04`, `e2e/risk` | ✅ | Phase 2 policy. U-ABUSER pays MPSEUDO01 ৳10,000: it executes, one OPEN TXN alert is created, both wallets are flagged, and the payer gets "Payment under review" while the merchant gets "Payment received under review". The receipt and home screen show the notice. A replay does not duplicate the alert or notices. |
| FLOW-03 | P1 | `int/risk`, `db/04`, `comp` StepUpConfirm, `unit` payment-flow, `e2e/risk` | ✅ | REVIEW returns `STEP_UP_REQUIRED` and debits nothing. Confirming with the same idempotency key and the PIN executes exactly once; a wrong PIN on confirmation is rejected. The wording never says why. |
| FLOW-04 | P0 | `int/risk`, `db/04` | ✅ | With the ML container stopped, the SQL rules decide (`rules-v1`, `source=FALLBACK`): ordinary payments pass, ≥ ৳10,000 or 3 or more repeats in 10 minutes step up, and ring merchants are still flagged. The function logs `risk_fallback` with a reason. The user never sees an unhandled error. |
| FLOW-05 | P0 | `unit` score.test.ts, `int/risk` | ✅ | A 3-second ML response is cut off at `app_config.ml_timeout_ms` (default 800 ms) and the fallback applies. Live, with the timeout set to 1 ms, the payment completes with `source=FALLBACK`. |
| FLOW-06 | P1 | `int/risk`, `db/04` | ✅ | `transactions.risk_score_id` links to `risk_scores`, which holds the features, risk and anomaly scores, decision, source, model version and latency. |
| FLOW-07 | P0 | `db/04`, `int/risk` | ✅ | `make_payment` returns `SCORE_REQUIRED` without a score, and `SCORE_INVALID` for a score with a different amount, request, user or a made-up ID, or one already spent. It returns `SCORE_EXPIRED` after 300 s. Clients can't read or write `risk_scores` or call the scoring RPCs. The `pay` function rejects calls without a valid user JWT. |
| FLOW-08 | P1 | `int/risk`, `ml/test_network`, `ml/test_seed_personas` | ✅ | The network job finds exactly one RING alert, holding the 8 RING-01 wallets plus MPSEUDO02/03. Re-running doesn't duplicate it. A small ৳120 payment into the ring is then FLAGged by the network score. On the synthetic population, all 4 simulated rings are found and no ring is made of ordinary customers. |
| FLOW-09 | P0 | `e2e/risk`, `int/risk` | ✅ / 🟡 4G device | **Browser, from tapping Pay to the receipt showing,** 100 runs with CDP throttling (150 ms RTT, 9/1.5 Mbps): p50 867 ms, p95 886 ms. ✅<br>**Server side, the `pay` function** (ML score + ledger update), 50 runs: p95 94–205 ms across runs. ✅<br>**Still pending:** a run on a real phone over a real 4G network. |

## Phase 1 regression (with scoring in the flow)
- **pgTAP:** `db/02` and `db/03` now pay through `pg_temp.pay`, which inserts a matching score, so every Phase 1 case runs against `make_payment` v2.
- **Integration:** the Phase 1 integration tests pay through the `pay` Edge Function. The PAY-07/09 concurrency block pins decisions to ALLOW (`ALWAYS_ALLOW`, which also covers the fallback rules), because its deliberate bursts are velocity anomalies by design.
- **E2E:**
  - PAY-10 (network drop) pins ALLOW for the same reason: it is U-NORMAL's third payment at one shop within minutes.
  - PAY-01's receipt checks are now scoped by test ID, because U-NORMAL has seeded history.
- **Deadlock found and fixed during the final run:**
  - **Symptom:** bursts of parallel payments could deadlock. `record_risk_score`'s foreign-key KEY SHARE locks met `make_payment`'s `FOR UPDATE` wallet locks taken in a different order. Postgres aborted one transaction, so no money moved, but the user got a 500.
  - **Fix:** `make_payment` now locks wallets with `FOR NO KEY UPDATE`.
  - **Visibility:** unexpected DB errors are logged as `pay_db_error`.

## Automated run summary
| Suite | Result |
|---|---|
| ML pytest (`npm run ml:test`) | 71 / 71 pass |
| Model gates (`evaluate`) | 11 / 11 pass |
| pgTAP (`supabase test db`, files 01–05) | 176 / 176 pass |
| Migration idempotency | pass |
| Jest unit + component | 106 / 106 pass |
| Integration (HTTP, local stack + ML) | 28 / 28 pass (payments suite re-run 10× after the deadlock fix) |
| Playwright web E2E | 19 / 19 pass (last full run was just before the `FOR NO KEY UPDATE` change; that change is covered by pgTAP + integration) |
| Bundle secrets check (service key + ML token) | pass |
| Lint + typecheck | clean |

## §2.5 Exit criteria status
- [x] **XGBoost and Isolation Forest metrics are recorded and meet the agreed targets (XGB-03, IF-02/03).** Synthetic data: the pipeline is validated, real-world accuracy is not.
- [x] **FLOW-01, -02, -04, -07 and -09 pass.** FLOW-09 passed in a throttled browser; a real-device 4G run is still pending.
- [x] **The Phase 1 regression suite passes with the scoring step in the flow.**

**Open items:**
- **MLAPI-06:** the saturation p95 needs production-sized hardware.
- **FLOW-09:** run on a real phone over a real 4G network.
- **Ring members are not notified:** ring alerts flag wallets but notify nobody, to avoid tipping off the ring. Analyst review arrives with the Phase 4 Investigation Assistant.
- **Real data:** retrain on real labelled data before production.
