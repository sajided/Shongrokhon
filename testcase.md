# Test Cases — Project Shongrokhon (Unified MFS & AI Financial Coach)

**Source:** `unified_mfs_ai_financial_coach_prd.md`
**Scope:** Every development phase in PRD §6 (Phases 1–4), plus the success metrics in PRD §7.
**Platform under test:** React Native / Expo (iOS & Android), Next.js API (Vercel), Supabase (PostgreSQL + Auth), FastAPI ML microservices, Gemini/Groq LLM.

---

## 0. Conventions

### 0.1 Test Case ID Format
`TC-P<phase>-<area>-<nn>`, for example `TC-P1-AUTH-03`.

| Area code | Meaning |
|---|---|
| SETUP | Repo, build, CI, environment |
| AUTH | Supabase authentication & sessions |
| DB | Schemas, constraints, Row Level Security (RLS) |
| QR | Bangla QR scanning & parsing |
| PAY | Payment flow & ledger |
| XGB | Transaction risk classification model |
| IF | Behavioral anomaly detection model (Isolation Forest) |
| MLAPI | FastAPI ML microservice |
| FLOW | Scan → score → execute/flag integration |
| MW | Next.js middleware (batching, sanitization) |
| LLM | Gemini/Groq integration & prompts |
| COACH | AI Financial Health Coach dashboard |
| SAVE | Personal Savings Planner |
| FCST | Cash-flow forecasting |
| SSC | Smart Spending Companion (interception) |
| INV | AI Investigation Assistant (SHAP + LLM) |
| L10N | Bangla localization |
| E2E | End-to-end flows |
| PERF | Latency & load |
| SEC | Security & privacy |
| MET | Success metric validation |

### 0.2 Priority
- **P0** — Blocker. Must pass before the phase can exit.
- **P1** — High. Must pass before release, can be fixed in the next sprint of the same phase.
- **P2** — Medium/Low. Nice to have, or edge cases.

### 0.3 Test Types
Unit · Integration · E2E · UI · Performance · Security · Model Evaluation · Usability · Localization

### 0.4 Shared Test Data
| Data set | Description |
|---|---|
| `U-NORMAL` | Customer with 6+ months of regular, mixed merchant payments, low cash-out frequency |
| `U-CASHHEAVY` | Customer with frequent cash-outs (≥ 8/month) and high cash dependency |
| `U-NEW` | Newly registered customer with 0 transactions (cold start) |
| `U-ABUSER` | Customer repeatedly paying the same pseudo-merchant with round amounts, then the merchant cashes out immediately |
| `M-LEGIT` | Verified merchant with diverse customers and normal ticket sizes |
| `M-PSEUDO` | Pseudo-merchant: few customers, round-amount receipts, quick onward transfer or cash-out |
| `RING-01` | Connected network of 5–10 wallets that cycle funds between each other through `M-PSEUDO` |
| `QR-VALID` | Valid Bangla QR (EMVCo-compliant) payloads: static and dynamic |
| `QR-INVALID` | Malformed, tampered-CRC, expired-dynamic, and non-Bangla-QR payloads |

---

## Phase 1 — Foundation & Core MFS (Weeks 1–3)

**Goal (PRD §6):** Expo repo initialised; Supabase Auth + schemas (Users, Transactions, Wallets); QR scanning module; basic payment flow with ledger updates; the app processes a standard low-risk transaction.

### 1.1 Project Setup & Build
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P1-SETUP-01 | Fresh clone installs & runs | Clone repo → `npm install` → `npx expo start` | Installs with no errors; Metro bundler starts; app loads in Expo Go / dev client | Integration | P0 |
| TC-P1-SETUP-02 | Android build | Run EAS/local Android build | APK/AAB builds; app launches on Android 10+ device and emulator | Integration | P0 |
| TC-P1-SETUP-03 | iOS build | Run EAS/local iOS build | IPA builds; app launches on iOS 15+ device and simulator | Integration | P0 |
| TC-P1-SETUP-04 | Environment config | Start app with `.env` missing the Supabase URL | App shows a clear configuration error and does not crash silently; no secrets are logged | Unit | P1 |
| TC-P1-SETUP-05 | Secrets not bundled | Inspect the JS bundle for the service-role key | Only the anon/public key is present; the service-role key is absent | Security | P0 |
| TC-P1-SETUP-06 | Lint & type check in CI | Push a commit with a lint/type error | CI fails and reports the error | Integration | P2 |

### 1.2 Authentication (Supabase)
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P1-AUTH-01 | Register with a valid phone number | Enter a valid BD mobile number (`01XXXXXXXXX`) → receive OTP → verify | Account created; `users` row and a `wallets` row (balance 0) are created; user lands on home screen | E2E | P0 |
| TC-P1-AUTH-02 | Invalid phone format | Enter `0123`, `+1555…`, letters | Inline validation error; no OTP is sent | UI | P1 |
| TC-P1-AUTH-03 | Wrong OTP | Enter an incorrect OTP | Error message; attempt counter increments; no session is created | Integration | P0 |
| TC-P1-AUTH-04 | OTP expiry | Enter the OTP after its expiry window | Rejected with an "OTP expired" message; resend is offered | Integration | P1 |
| TC-P1-AUTH-05 | OTP brute-force lockout | Submit 5+ wrong OTPs in a row | Account/number temporarily locked; rate limit is enforced server-side | Security | P0 |
| TC-P1-AUTH-06 | Duplicate registration | Register with an already registered number | Routed to login, not a second account | Integration | P1 |
| TC-P1-AUTH-07 | Transaction PIN setup | Set a 4/5-digit PIN; confirm with a mismatched PIN | Mismatch rejected; PIN is stored hashed, never in plain text | Security | P0 |
| TC-P1-AUTH-08 | Session persistence | Log in → kill the app → reopen | User stays logged in (secure storage); token refreshes automatically | Integration | P1 |
| TC-P1-AUTH-09 | Logout | Tap logout | Session and secure-storage tokens cleared; protected screens are not reachable | Integration | P0 |
| TC-P1-AUTH-10 | Expired/revoked token | Revoke the session server-side → perform an action | API returns 401; app redirects to login without crashing | Integration | P1 |

### 1.3 Database Schemas & Security
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P1-DB-01 | Schema migration | Run migrations on an empty database | `users`, `wallets`, `transactions` tables created with the expected columns, PKs, FKs and indexes | Integration | P0 |
| TC-P1-DB-02 | Migration idempotency | Run migrations twice | Second run is a no-op with no errors | Integration | P2 |
| TC-P1-DB-03 | Non-negative balance | Directly `UPDATE wallets SET balance = -1` | Rejected by a CHECK constraint | Unit | P0 |
| TC-P1-DB-04 | Referential integrity | Insert a transaction with a non-existent `wallet_id` | Rejected by FK constraint | Unit | P0 |
| TC-P1-DB-05 | RLS: own data only | User A queries User B's transactions with A's JWT | Zero rows returned / permission denied | Security | P0 |
| TC-P1-DB-06 | RLS: no direct balance writes | User A tries to update their own wallet balance from the client | Denied; balances change only through the server-side payment function | Security | P0 |
| TC-P1-DB-07 | Transaction history encryption | Inspect sensitive transaction fields at rest | Sensitive fields (e.g., notes, counterparty details as defined) are encrypted per PRD §5 | Security | P1 |
| TC-P1-DB-08 | Audit timestamps | Insert/update a transaction | `created_at` / `updated_at` set automatically in UTC | Unit | P2 |

### 1.4 QR Scanning Module
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P1-QR-01 | Camera permission granted | Open the scanner for the first time → allow | Camera preview opens | UI | P0 |
| TC-P1-QR-02 | Camera permission denied | Deny permission | Friendly explanation + "Open Settings" link; no crash | UI | P1 |
| TC-P1-QR-03 | Scan valid static Bangla QR | Scan `QR-VALID` static | Merchant name, merchant ID and an empty amount field are shown | Integration | P0 |
| TC-P1-QR-04 | Scan valid dynamic Bangla QR | Scan `QR-VALID` dynamic with amount | Merchant and amount pre-filled; amount is read-only | Integration | P0 |
| TC-P1-QR-05 | Tampered CRC | Scan a QR whose CRC does not match | Rejected as "Invalid QR"; no payment screen | Unit | P0 |
| TC-P1-QR-06 | Non-payment QR | Scan a URL / plain-text QR | "Not a Bangla QR payment code" message | Unit | P1 |
| TC-P1-QR-07 | Expired dynamic QR | Scan a dynamic QR past its expiry | Rejected with an "expired" message | Unit | P1 |
| TC-P1-QR-08 | Scan speed | Scan a valid QR under normal indoor light | Decoded in ≤ 1 s | Performance | P1 |
| TC-P1-QR-09 | Difficult conditions | Low light (with torch), glare, 30° angle, printed vs. on-screen QR | Decodes in all cases; torch toggle works | Usability | P2 |
| TC-P1-QR-10 | Gallery import | Choose a QR image from the gallery | Decoded the same as a camera scan | Integration | P2 |
| TC-P1-QR-11 | Duplicate scan debounce | Hold the camera on a QR for 5 s | Only one payment screen opens | UI | P1 |

### 1.5 Payment Flow & Ledger
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P1-PAY-01 | Successful payment | `U-NORMAL` (balance ৳5,000) pays `M-LEGIT` ৳500 with the correct PIN | Status `SUCCESS`; payer balance ৳4,500; merchant balance +৳500; one transaction row; receipt shown | E2E | P0 |
| TC-P1-PAY-02 | Double-entry ledger balanced | After TC-P1-PAY-01, sum debits and credits | Total debits = total credits for the transaction | Integration | P0 |
| TC-P1-PAY-03 | Insufficient balance | Balance ৳100, pay ৳500 | Rejected before execution; balance unchanged; clear message | Integration | P0 |
| TC-P1-PAY-04 | Wrong PIN | Enter a wrong PIN | Rejected; no ledger change; attempt counter increments | Integration | P0 |
| TC-P1-PAY-05 | PIN lockout | 3 wrong PINs | Payments locked for the configured period | Security | P1 |
| TC-P1-PAY-06 | Amount validation | Enter 0, negative, > 2 decimals, above per-transaction limit | Each is rejected with a specific message | Unit | P1 |
| TC-P1-PAY-07 | Idempotency | Double-tap "Pay" / resend the same request with the same idempotency key | Exactly one debit; second request returns the original result | Integration | P0 |
| TC-P1-PAY-08 | Atomicity on failure | Force a DB error after the debit, before the credit | Whole transaction rolls back; no partial ledger entries | Integration | P0 |
| TC-P1-PAY-09 | Concurrent payments | Fire 2 parallel ৳3,000 payments from a ৳5,000 wallet | One succeeds, one fails for insufficient funds; balance never goes negative | Integration | P0 |
| TC-P1-PAY-10 | Network loss mid-payment | Turn off network after tapping "Pay" | App shows "pending/checking"; on reconnect it shows the final server status; no duplicate charge | E2E | P1 |
| TC-P1-PAY-11 | Self-payment | User scans their own merchant QR | Blocked | Unit | P2 |
| TC-P1-PAY-12 | Transaction history | Open history after 3 payments | All 3 listed newest first with amount, merchant, timestamp and status | UI | P1 |
| TC-P1-PAY-13 | Receipt | Open the receipt for a successful payment | Shows transaction ID, amount (৳), merchant, date/time; can be shared | UI | P2 |

### 1.6 Phase 1 Exit Criteria
- [ ] All P0 cases in §1.1–1.5 pass on both Android and iOS.
- [ ] TC-P1-PAY-01 (standard low-risk transaction) passes end to end on a physical device.
- [ ] No open P0/P1 security defects (RLS, PIN storage, secrets).

---

## Phase 2 — Risk Intelligence Pipeline (Weeks 4–6)

**Goal (PRD §6):** Train XGBoost cash-out classifier; build Isolation Forest anomaly model; deploy as low-latency FastAPI microservices; integrate scan → score → execute/flag.

### 2.1 XGBoost Transaction Risk Model
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P2-XGB-01 | Data split without leakage | Inspect the train/validation/test split | Time-based split; no user or transaction appears in more than one split | Model Evaluation | P0 |
| TC-P2-XGB-02 | Feature pipeline reproducibility | Run feature engineering twice on the same data | Identical feature matrices | Unit | P1 |
| TC-P2-XGB-03 | Baseline performance | Evaluate on the hold-out test set | Meets agreed thresholds (record values): PR-AUC ≥ target, recall on cash-out class ≥ target, FPR ≤ target | Model Evaluation | P0 |
| TC-P2-XGB-04 | Known abuse pattern | Score `U-ABUSER` → `M-PSEUDO` round-amount transactions | Risk score above the flag threshold | Model Evaluation | P0 |
| TC-P2-XGB-05 | Legitimate pattern | Score `U-NORMAL` → `M-LEGIT` transactions | Risk score below the flag threshold for ≥ 99% of cases | Model Evaluation | P0 |
| TC-P2-XGB-06 | Class imbalance handling | Check the confusion matrix on the minority class | Minority class is not ignored (recall > 0 and meets target) | Model Evaluation | P1 |
| TC-P2-XGB-07 | Output range | Score 10,000 random valid inputs | All scores are within [0, 1]; no NaN | Unit | P0 |
| TC-P2-XGB-08 | Missing/unknown features | Score with missing optional fields and an unseen merchant category | Returns a valid score using defaults; no exception | Unit | P1 |
| TC-P2-XGB-09 | Threshold calibration | Plot the precision/recall curve and pick the operating threshold | Threshold documented with its expected FPR/FNR | Model Evaluation | P1 |
| TC-P2-XGB-10 | Model versioning | Load the model artifact | Version, training date and feature list are stored with the model | Unit | P2 |
| TC-P2-XGB-11 | Fairness sanity check | Compare FPR across regions / user segments | No segment has an FPR more than the agreed multiple of the overall FPR | Model Evaluation | P2 |

### 2.2 Isolation Forest Behavioral Anomaly Model
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P2-IF-01 | Baseline learning | Train on `U-NORMAL` history | Per-user (or per-segment) baseline is stored | Unit | P0 |
| TC-P2-IF-02 | In-pattern transaction | `U-NORMAL` pays a usual merchant, usual amount, usual hour | Not flagged as an anomaly | Model Evaluation | P0 |
| TC-P2-IF-03 | Amount spike | `U-NORMAL` pays 10× their median ticket size | Flagged as an anomaly | Model Evaluation | P0 |
| TC-P2-IF-04 | Unusual time | `U-NORMAL` transacts at 3 AM, never seen before | Anomaly score increases | Model Evaluation | P1 |
| TC-P2-IF-05 | Velocity burst | 6 payments in 10 minutes to the same new merchant | Flagged as an anomaly | Model Evaluation | P0 |
| TC-P2-IF-06 | Cold start | Score a transaction for `U-NEW` | Falls back to a segment/global baseline; no error; returns a "low confidence" indicator | Unit | P0 |
| TC-P2-IF-07 | Baseline drift | Normal user gradually changes habits over 3 months | Baseline updates on retrain; new normal behaviour is not permanently flagged | Model Evaluation | P2 |
| TC-P2-IF-08 | Contamination parameter | Vary contamination (e.g., 0.01–0.05) on the validation set | Chosen value documented with its alert rate | Model Evaluation | P2 |

### 2.3 ML Microservice (FastAPI)
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P2-MLAPI-01 | Health check | `GET /health` | 200 with model versions loaded | Integration | P0 |
| TC-P2-MLAPI-02 | Valid scoring request | `POST /score` with a valid payload | 200 with `risk_score`, `anomaly_score`, `decision`, `model_version` | Integration | P0 |
| TC-P2-MLAPI-03 | Schema validation | Missing `amount`, string amount, negative amount | 422 with field-level error; no stack trace leaked | Integration | P0 |
| TC-P2-MLAPI-04 | Authentication | Call `/score` without / with an invalid service token | 401; only the backend can call the service | Security | P0 |
| TC-P2-MLAPI-05 | Latency p95 | 1,000 sequential requests | p95 ≤ 200 ms server time (leaves budget inside the 1.5 s total) | Performance | P0 |
| TC-P2-MLAPI-06 | Latency under load | 100 concurrent users for 5 min | p95 stays within budget; error rate < 0.1% | Performance | P1 |
| TC-P2-MLAPI-07 | Cold start | First request after deploy/scale-up | Model is preloaded at startup; first request is within budget | Performance | P1 |
| TC-P2-MLAPI-08 | Deterministic output | Send the same payload 10 times | Same scores every time | Unit | P1 |
| TC-P2-MLAPI-09 | No PII in logs | Inspect service logs after scoring | No phone numbers, names or PINs in logs | Security | P1 |

### 2.4 Pipeline Integration: Scan → Score → Execute/Flag
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P2-FLOW-01 | Low risk → execute | `U-NORMAL` pays `M-LEGIT` | Scored below threshold; payment executes; score is saved with the transaction | E2E | P0 |
| TC-P2-FLOW-02 | High risk → flag/block | `U-ABUSER` pays `M-PSEUDO` a round ৳10,000 | Payment held or blocked per policy; alert created; ledger unchanged; user sees a neutral message | E2E | P0 |
| TC-P2-FLOW-03 | Medium risk → step-up | Score between the review and block thresholds | Extra verification (e.g., PIN re-entry / confirmation) required; executes only after it | E2E | P1 |
| TC-P2-FLOW-04 | Scoring service down | Stop the ML service → attempt payment | Fallback policy applies (rule-based limits); clearly logged; no unhandled error to the user | Integration | P0 |
| TC-P2-FLOW-05 | Scoring timeout | ML service delays 3 s | Request times out at the configured limit; fallback policy applies | Integration | P0 |
| TC-P2-FLOW-06 | Score persisted | Check the transaction/alerts table after scoring | Score, model version and decision are stored for audit | Integration | P1 |
| TC-P2-FLOW-07 | Score cannot be bypassed | Call the execute endpoint directly without scoring | Rejected; execution requires a valid server-side score record | Security | P0 |
| TC-P2-FLOW-08 | Ring detection (network risk) | Run transactions for `RING-01` | Connected wallets are linked and raised as a group alert (Graph ML per PRD §4.1) | Model Evaluation | P1 |
| TC-P2-FLOW-09 | End-to-end latency | Measure from "Pay" tap to result shown, 100 runs on 4G | ML score + ledger update < 1.5 s at p95 (PRD §7) | Performance | P0 |

### 2.5 Phase 2 Exit Criteria
- [ ] XGBoost and Isolation Forest metrics recorded and meet agreed targets (TC-P2-XGB-03, TC-P2-IF-02/03).
- [ ] TC-P2-FLOW-01, -02, -04, -07, -09 pass.
- [ ] Phase 1 regression suite passes with the scoring step in the flow.

---

## Phase 3 — Profile Engine & AI Coach (Weeks 7–9)

**Goal (PRD §6):** Next.js middleware to batch and sanitize histories; Gemini/Groq with strict prompts for categorization and insights; Coach dashboard; Savings Planner and Cash-Flow Forecasting UI.

### 3.1 Next.js Middleware: Batching & Sanitization
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P3-MW-01 | Authenticated access only | Call the profile/insights API without a JWT | 401 | Security | P0 |
| TC-P3-MW-02 | User isolation | User A requests insights with `user_id` of User B | 403; only the caller's own data is processed | Security | P0 |
| TC-P3-MW-03 | PII stripping | Inspect the payload sent to the LLM | No name, phone, NID, wallet number, exact address or counterparty personal names; only amounts, dates, categories and anonymised merchant labels | Security | P0 |
| TC-P3-MW-04 | Batching | User with 2,000 transactions requests insights | History is aggregated/chunked within the LLM token limit; response succeeds | Integration | P0 |
| TC-P3-MW-05 | Empty history | `U-NEW` requests insights | Friendly "not enough data yet" response; no LLM call | Integration | P1 |
| TC-P3-MW-06 | Prompt injection via data | A merchant name/note contains "Ignore previous instructions and…" | Text is escaped/treated as data; LLM output is unaffected | Security | P0 |
| TC-P3-MW-07 | Rate limiting | 30 insight requests in 1 minute | Requests above the limit get 429 | Security | P1 |
| TC-P3-MW-08 | Caching | Request insights twice with no new transactions | Second response served from cache; no second LLM call | Performance | P2 |
| TC-P3-MW-09 | Vercel timeout | Simulate a slow LLM (> function timeout) | Graceful error / async job; no hung request | Integration | P1 |

### 3.2 LLM Integration (Categorization & Insights)
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P3-LLM-01 | Categorization accuracy | Run 200 labelled transactions through categorization | ≥ target accuracy (record value) against the labelled set | Model Evaluation | P0 |
| TC-P3-LLM-02 | Structured output | Request categorization | Response parses against the JSON schema; invalid output is retried or rejected | Integration | P0 |
| TC-P3-LLM-03 | Fixed category list | Inspect categories returned | Only categories from the allowed list (e.g., Food, Transport, Utilities, Cash-out, Bills, Shopping, Others) | Unit | P1 |
| TC-P3-LLM-04 | Numbers are grounded | Compare figures in the insight text with DB aggregates | Every amount/percentage in the text matches computed values; no invented numbers | Model Evaluation | P0 |
| TC-P3-LLM-05 | No regulated advice | Ask "Which stock should I buy?" / "Should I take a loan?" | Coach declines specific investment/loan advice and gives general guidance only | Model Evaluation | P0 |
| TC-P3-LLM-06 | Tone | Review insights for `U-CASHHEAVY` | Supportive, non-judgemental, plain language | Usability | P1 |
| TC-P3-LLM-07 | Provider failover | Disable Gemini → request insights | Falls back to Groq (or the other way round) or shows a cached/fallback message | Integration | P1 |
| TC-P3-LLM-08 | API key not exposed | Inspect app bundle and network calls from the device | LLM keys only on the server; device never calls the LLM directly | Security | P0 |
| TC-P3-LLM-09 | LLM response latency | 50 insight requests | p95 within the agreed budget (e.g., ≤ 5 s) with a loading state shown | Performance | P2 |

### 3.3 AI Financial Health Coach Dashboard
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P3-COACH-01 | Dashboard load | `U-NORMAL` opens the Coach tab | Shows spending breakdown by category, cash dependency indicator and AI insight cards | UI | P0 |
| TC-P3-COACH-02 | Category totals | Compare dashboard totals with the DB for the selected month | Totals match exactly | Integration | P0 |
| TC-P3-COACH-03 | Cash dependency metric | `U-CASHHEAVY` opens the dashboard | Cash-out share is shown, highlighted, with a plain-language explanation | UI | P0 |
| TC-P3-COACH-04 | Period filter | Switch between This Week / This Month / Last 3 Months | Data and charts update correctly | UI | P1 |
| TC-P3-COACH-05 | Empty state | `U-NEW` opens the dashboard | Helpful empty state; no broken charts | UI | P1 |
| TC-P3-COACH-06 | Loading & error states | Slow network / API error | Skeleton while loading; retry option on error | UI | P1 |
| TC-P3-COACH-07 | Real-time refresh | Make a payment → return to the dashboard | New transaction reflected after refresh/pull-to-refresh | Integration | P2 |
| TC-P3-COACH-08 | Accessibility | Screen reader (TalkBack/VoiceOver), large font size | Charts have text alternatives; layout doesn't break | Usability | P2 |

### 3.4 Personal Savings Planner
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P3-SAVE-01 | Create goal (PRD example) | Goal "Save ৳30,000 in 6 months" for `U-NORMAL` | Plan shows ≈ ৳5,000/month, adjusted to the user's surplus; saved to the profile | Integration | P0 |
| TC-P3-SAVE-02 | Plan is based on history | Same goal for a user with ৳3,000 average monthly surplus | Plan flags that ৳5,000/month is unrealistic and suggests a longer timeline or a smaller target | Integration | P0 |
| TC-P3-SAVE-03 | Input validation | Amount 0, negative, non-numeric; duration 0 or > 60 months | Rejected with specific messages | Unit | P1 |
| TC-P3-SAVE-04 | Very short timeline | ৳30,000 in 1 month with low income | Marked as not achievable, with alternatives | Unit | P1 |
| TC-P3-SAVE-05 | Progress tracking | Add savings contributions over 2 months | Progress bar and remaining amount update correctly | Integration | P1 |
| TC-P3-SAVE-06 | Edit / delete goal | Change the target, then delete | Plan recalculates; deletion asks for confirmation and removes the goal | UI | P2 |
| TC-P3-SAVE-07 | Multiple goals | Create 3 goals | Combined monthly contribution is checked against surplus; over-commitment is warned | Integration | P2 |
| TC-P3-SAVE-08 | Bangla number input | Enter `৩০০০০` (Bangla digits) | Parsed as 30,000 | Localization | P1 |

### 3.5 Cash-Flow Forecasting
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P3-FCST-01 | Forecast display | `U-NORMAL` opens the forecast | Shows projected balance for the next 7/30 days | UI | P0 |
| TC-P3-FCST-02 | Liquidity pressure warning | User with rent/bill due when projected balance is low | Shows a "low balance expected on <date>" warning with an action suggestion | Integration | P0 |
| TC-P3-FCST-03 | Forecast accuracy (backtest) | Backtest on historical data for 50 users | Error (MAPE/MAE) within the agreed target (record value) | Model Evaluation | P1 |
| TC-P3-FCST-04 | Recurring payment detection | User pays the same utility monthly | Recurring item is detected and included in the forecast | Unit | P1 |
| TC-P3-FCST-05 | Insufficient history | User with < 30 days of data | Forecast marked "low confidence" or hidden with an explanation | Unit | P1 |
| TC-P3-FCST-06 | No negative-balance display bug | Forecast where spend > balance | Shows a shortfall clearly; no rendering errors | UI | P2 |

### 3.6 Phase 3 Exit Criteria
- [ ] TC-P3-MW-03 and TC-P3-MW-06 pass (no PII to the LLM; prompt injection contained).
- [ ] TC-P3-LLM-04 and TC-P3-LLM-05 pass (grounded numbers, no regulated advice).
- [ ] Coach, Savings Planner and Forecast P0 cases pass on both platforms.
- [ ] Phase 1–2 regression suites pass.

---

## Phase 4 — Active Interventions & Polish (Weeks 10–12)

**Goal (PRD §6):** Smart Spending Companion interception UI; AI Investigation Assistant (SHAP) for compliance; Bangla localization of UI and prompts; E2E testing, latency optimization, bug fixing.

### 4.1 Smart Spending Companion (Interception)
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P4-SSC-01 | Trigger on repetitive cash-out | `U-CASHHEAVY` starts their Nth cash-out within the detection window | Interception screen appears **before** payment execution | E2E | P0 |
| TC-P4-SSC-02 | No trigger for normal user | `U-NORMAL` makes a regular merchant payment | No interception | E2E | P0 |
| TC-P4-SSC-03 | Digital alternatives shown | Interception screen content | Relevant alternatives listed (e.g., pay the merchant directly by QR, bill pay, send money) with a short explanation of the saved fee | UI | P0 |
| TC-P4-SSC-04 | User chooses alternative | Tap a suggested alternative | Navigates to that flow with context pre-filled; original cash-out is cancelled; nothing is debited | E2E | P1 |
| TC-P4-SSC-05 | User proceeds anyway | Tap "Continue" on a legitimate cash-out | Payment continues normally through the risk pipeline; the user is not blocked by the companion alone | E2E | P0 |
| TC-P4-SSC-06 | Frequency cap | Trigger condition met 5 times in a day | Interception shown at most the configured number of times (avoid nagging) | Unit | P1 |
| TC-P4-SSC-07 | Interaction logging | Show interception → choose an option | Event (shown, choice) logged for the cash-out reduction metric | Integration | P1 |
| TC-P4-SSC-08 | Latency impact | Measure payment latency with interception logic enabled (no interception shown) | Still < 1.5 s p95 | Performance | P0 |
| TC-P4-SSC-09 | Opt-out / settings | Turn off coaching nudges in settings (if offered) | Nudges stop; fraud blocking from Phase 2 still applies | Integration | P2 |

### 4.2 AI Investigation Assistant (Compliance Dashboard)
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P4-INV-01 | Analyst-only access | Customer account / unauthenticated user opens the dashboard | Access denied; only users with the analyst role can enter | Security | P0 |
| TC-P4-INV-02 | Alert queue | Analyst opens the dashboard after TC-P2-FLOW-02 | Alert listed with score, time, users involved and status | UI | P0 |
| TC-P4-INV-03 | SHAP explanation | Open an alert | Top contributing features shown with direction and magnitude | Integration | P0 |
| TC-P4-INV-04 | SHAP correctness | Sum of SHAP values + base value for an alert | Equals the model's raw output (within tolerance) | Unit | P0 |
| TC-P4-INV-05 | LLM evidence summary | Open an alert | Plain-language summary that matches the SHAP features and the transaction facts; no invented facts | Model Evaluation | P0 |
| TC-P4-INV-06 | Network view | Open an alert from `RING-01` | Connected wallets and flows shown as a graph | UI | P1 |
| TC-P4-INV-07 | Analyst actions | Mark alert as "Confirmed abuse" / "False positive" / "Escalate" | Status updated; action, analyst and timestamp written to an audit log | Integration | P0 |
| TC-P4-INV-08 | Feedback loop | Mark alerts as false positive | Labels saved for model retraining | Integration | P1 |
| TC-P4-INV-09 | Filtering & search | Filter by date, score range, status; search by wallet ID | Correct results | UI | P2 |
| TC-P4-INV-10 | Audit log immutability | Try to edit/delete an audit log entry | Not allowed | Security | P1 |

### 4.3 Bangla Localization
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P4-L10N-01 | Language switch | Switch English ↔ বাংলা in settings | All screens switch with no app restart needed; no untranslated keys shown | Localization | P0 |
| TC-P4-L10N-02 | Translation coverage | Automated scan for missing translation keys | 100% of UI strings have a Bangla value | Localization | P0 |
| TC-P4-L10N-03 | Font rendering | View all screens in Bangla on low-end Android | Conjuncts (যুক্তাক্ষর) render correctly; no clipped text or broken layout | Localization | P0 |
| TC-P4-L10N-04 | Number & currency format | Show ৳1,25,000 in Bangla mode | Uses ৳, the correct grouping and Bangla digits if configured (`৳১,২৫,০০০`) | Localization | P1 |
| TC-P4-L10N-05 | Date format | View history in Bangla mode | Dates shown in Bangla month names/digits | Localization | P2 |
| TC-P4-L10N-06 | Conversational Bangla insights | Generate Coach insights in Bangla | Natural, conversational Bangla (reviewed by native speakers, rated ≥ 4/5); not literal machine translation | Usability | P0 |
| TC-P4-L10N-07 | Mixed input (Banglish) | Ask the coach "amar khoroch komabo kivabe?" | Understood and answered in the selected language | Localization | P1 |
| TC-P4-L10N-08 | Numbers consistent across languages | Compare the same insight in English and Bangla | Same figures in both | Localization | P1 |
| TC-P4-L10N-09 | Error messages | Trigger payment/auth errors in Bangla mode | Error messages are in Bangla | Localization | P1 |

### 4.4 End-to-End Scenarios
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P4-E2E-01 | New user journey | Register → set PIN → receive funds → scan QR → pay → view Coach | All steps succeed; Coach shows the new payment | E2E | P0 |
| TC-P4-E2E-02 | Abuse journey | `U-ABUSER` performs disguised cash-out to `M-PSEUDO` | Blocked/flagged; alert appears in the Investigation Assistant with SHAP + summary | E2E | P0 |
| TC-P4-E2E-03 | Coaching journey | `U-CASHHEAVY` → interception → chooses digital alternative → sets a savings goal | Cash-out avoided; goal saved; events logged | E2E | P0 |
| TC-P4-E2E-04 | Forecast-driven journey | User sees low-balance warning → follows suggestion | Suggestion flow works; no panic cash-out needed | E2E | P1 |
| TC-P4-E2E-05 | Offline/poor network | Run E2E-01 on throttled 2G/3G | All steps complete or fail gracefully with retry; no duplicate charges | E2E | P1 |
| TC-P4-E2E-06 | Device matrix | Run E2E-01 on low-end Android (2 GB RAM), mid Android, recent iPhone | Passes on all; no crashes | E2E | P0 |

### 4.5 Performance & Latency Optimization
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P4-PERF-01 | Transaction latency SLA | 1,000 payments, mixed risk, production-like setup | ML score + ledger update < 1.5 s at p95 (PRD §7) | Performance | P0 |
| TC-P4-PERF-02 | Load test | 500 concurrent payers for 15 min | p95 within SLA; error rate < 0.1%; no ledger inconsistency | Performance | P0 |
| TC-P4-PERF-03 | Ledger consistency after load | After PERF-02, reconcile all balances against the ledger | Zero discrepancies | Integration | P0 |
| TC-P4-PERF-04 | App startup time | Cold start on low-end Android | Home screen interactive in ≤ 3 s | Performance | P1 |
| TC-P4-PERF-05 | Memory / battery | 30 min of use including scanner | No memory leaks; no unusual battery drain | Performance | P2 |
| TC-P4-PERF-06 | App size | Check the release build size | Within the agreed limit for low-storage devices | Performance | P2 |

### 4.6 Security & Privacy (Release Gate)
| ID | Scenario | Steps / Input | Expected Result | Type | Priority |
|---|---|---|---|---|---|
| TC-P4-SEC-01 | Transport security | Intercept app traffic with a proxy | All traffic over HTTPS/TLS 1.2+; certificate pinning if adopted | Security | P0 |
| TC-P4-SEC-02 | OWASP Mobile Top 10 review | Static and dynamic scan of the app | No high/critical findings | Security | P0 |
| TC-P4-SEC-03 | API authorization sweep | Call every API with another user's IDs | All return 401/403 | Security | P0 |
| TC-P4-SEC-04 | Rooted/jailbroken device | Launch on a rooted device | Behaviour follows policy (warn or restrict) | Security | P2 |
| TC-P4-SEC-05 | Data deletion request | User requests account deletion | Personal data removed or anonymised per policy; ledger retained as required by regulation | Security | P1 |
| TC-P4-SEC-06 | Screenshot protection | Try to screenshot the PIN entry screen | Blocked / blanked (Android `FLAG_SECURE`) | Security | P2 |

### 4.7 Phase 4 Exit Criteria (Release)
- [ ] All P0 cases across Phases 1–4 pass.
- [ ] TC-P4-PERF-01 and TC-P4-PERF-03 pass.
- [ ] No open P0/P1 security findings.
- [ ] Bangla review sign-off (TC-P4-L10N-06).
- [ ] Full regression suite passes on the device matrix (TC-P4-E2E-06).

---

## 5. Success Metric Validation (PRD §7)

| ID | Metric | How to Measure | Pass Criteria | Priority |
|---|---|---|---|---|
| TC-MET-01 | Risk: false positive / negative rate | Confusion matrix on the hold-out set plus analyst-labelled live alerts (TC-P4-INV-08) | FPR and FNR at or below agreed targets; reported weekly | P0 |
| TC-MET-02 | System: transaction latency | APM tracing from request to ledger commit | p95 < 1.5 s | P0 |
| TC-MET-03 | User: cash-out frequency reduction | Compare monthly cash-outs for Coach-engaged users vs. a control group (A/B or pre/post) | Statistically significant reduction for engaged users | P1 |
| TC-MET-04 | Engagement: DAU on Savings Planner / Insights | Analytics events on tab opens | Events fire once per real visit (no double counting); DAU dashboard matches raw event counts | P1 |
| TC-MET-05 | Analytics event integrity | Perform scripted actions and compare with analytics output | 100% of expected events recorded with the correct properties; no PII in events | P1 |

---

## 6. Traceability Matrix (PRD → Test Cases)

| PRD Requirement | Test Cases |
|---|---|
| §4.1 Real-time transaction risk scoring (XGBoost) | TC-P2-XGB-*, TC-P2-MLAPI-*, TC-P2-FLOW-01–07 |
| §4.1 Behavioral anomaly detection (Isolation Forest) | TC-P2-IF-* |
| §4.1 Network risk intelligence (Graph ML) | TC-P2-FLOW-08, TC-P4-INV-06 |
| §4.1 AI Investigation Assistant (SHAP + LLM) | TC-P4-INV-* |
| §4.2 MFS core utility (Bangla QR) | TC-P1-QR-*, TC-P1-PAY-* |
| §4.2 AI Financial Health Coach | TC-P3-MW-*, TC-P3-LLM-*, TC-P3-COACH-* |
| §4.2 Smart Spending Companion | TC-P4-SSC-* |
| §4.2 Personal Savings Planner | TC-P3-SAVE-* |
| §4.2 Cash-flow forecasting | TC-P3-FCST-* |
| §5 Supabase auth & encrypted histories | TC-P1-AUTH-*, TC-P1-DB-* |
| §5 LLM processing (Gemini/Groq) | TC-P3-LLM-*, TC-P4-L10N-06/07 |
| §5 FastAPI ML microservices | TC-P2-MLAPI-* |
| §7 Success metrics | TC-MET-*, TC-P4-PERF-01 |
