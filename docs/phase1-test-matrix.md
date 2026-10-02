# Phase 1 Test Matrix: Foundation & Core MFS

Covers every `TC-P1-*` case in `testcase.md` §1.1–1.5. **Scope change:** the product is now a web app only, so the Android/iOS build cases are replaced by the web build, and device runs mean a phone browser. For each case it gives where the test lives and the latest result.

**Run date:** 2026-10-02, local stack (Supabase CLI 2.75, Expo SDK 57 for web, Node 22, Playwright Chromium).

**Status legend:**
- ✅ **pass:** automated and passing.
- 🟡 **pending:** needs a device, simulator or manual run that has not been done yet.
- ⚠️ **partial:** covered, with a caveat noted in the row.

**Test locations:**

| Location | What runs there |
|---|---|
| `db/01` | `supabase/tests/01_schema.test.sql` |
| `db/02` | `supabase/tests/02_rls.test.sql` |
| `db/03` | `supabase/tests/03_payments.test.sql` |
| `int/auth` | `tests/integration/auth.test.ts` |
| `int/pay` | `tests/integration/payments.test.ts` |
| `unit` / `comp` | Jest under `src/` |
| `e2e/*` | Playwright specs in `tests/e2e/` (production web build, headless Chromium, Pixel 7 viewport) |

## 1.1 Project Setup & Build
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| SETUP-01 | P0 | `npm install && npm start` | ✅ | Clean install and dev server verified. On this machine `~/.npm` has root-owned files: run `sudo chown -R 501:20 ~/.npm` once. |
| SETUP-02 | P0 | `npm run build` (web) | ✅ | N/A as written (no Android app). Replaced by the production web export, which `e2e` builds and serves on every run. |
| SETUP-03 | P0 | — | N/A | No iOS app (web only). |
| SETUP-04 | P1 | `unit` config.test.ts, `comp` ConfigGate.test.tsx | ✅ | Shows a configuration error screen. No values are logged. |
| SETUP-05 | P0 | `scripts/check-bundle-secrets.sh` | ✅ | Negative control confirmed: a bundled service-role key fails the check. |
| SETUP-06 | P2 | `.github/workflows/ci.yml` | 🟡 | Workflow written. Runs once a GitHub remote exists. |

## 1.2 Authentication
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| AUTH-01 | P0 | `int/auth`, `db/01`, `e2e/auth` | ✅ | The users row and a ৳0 wallet are created by trigger. |
| AUTH-02 | P1 | `unit` validation.test.ts, `int/auth` (server), `e2e/auth` | ✅ | Rejected on the client before any network call (E2E asserts zero OTP requests), and again by the `otp` function. |
| AUTH-03 | P0 | `int/auth` | ✅ | Returns `WRONG_OTP`, `attempts_left` 4, counter 1, no session. |
| AUTH-04 | P1 | `int/auth` | ⚠️ | Expiry is enforced by the `otp` function (`app_config.otp_expiry_seconds`, 300 s). The test backdates the send time because test OTPs in GoTrue never expire. Re-check with the real SMS provider. |
| AUTH-05 | P0 | `int/auth` | ✅ | Locks after 5 wrong codes for 15 min. Both verify and resend return `OTP_LOCKED`. **Caveat:** GoTrue `/auth/v1/verify` is still reachable directly with the anon key. Only the per-IP `token_verifications` rate limit covers that path. |
| AUTH-06 | P1 | `int/auth` | ✅ | The same user id is returned and there is one users row. |
| AUTH-07 | P0 | `db/02`, `db/03`, `comp` PinSetupForm.test.tsx, `e2e/auth` | ✅ | Stored as a bcrypt hash. `pin_hash` is not readable by clients. A mismatch is rejected. A PIN cannot be silently overwritten. |
| AUTH-08 | P1 | `e2e/auth` | ✅ | The session survives a reload. On web it is kept in `localStorage`, so an XSS bug could read it. Mitigate with a strict CSP when the app is deployed. |
| AUTH-09 | P0 | `int/auth`, `e2e/auth` | ✅ | After logout the old access and refresh tokens are rejected and `localStorage` is cleared. `/`, `/scan` and `/pay` all redirect to sign-in. |
| AUTH-10 | P1 | `int/auth`, `db/02` | ✅ | A revoked session returns HTTP 401 `PT401 SESSION_REVOKED`. The app signs out locally and routes to sign-in. |

## 1.3 Database Schemas & Security
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| DB-01 | P0 | `db/01` | ✅ | Tables, PKs, FKs, types and indexes. |
| DB-02 | P2 | `scripts/check-migrations-idempotent.sh` | ✅ | All migrations re-applied on a migrated DB with no errors. Negative control checked. |
| DB-03 | P0 | `db/01` | ✅ | `CHECK` constraint, SQLSTATE 23514. |
| DB-04 | P0 | `db/01` | ✅ | FK violation, SQLSTATE 23503. |
| DB-05 | P0 | `db/02`, `int/pay` | ✅ | Tested both in SQL and over REST with real JWTs. |
| DB-06 | P0 | `db/02`, `int/pay` | ✅ | Clients get no write grants. Balances change only via `make_payment` / `admin_credit_wallet` (service-only). |
| DB-07 | P1 | `db/03` | ✅ | `note` and counterparty are encrypted with `pgp_sym_encrypt`, using a key held in Supabase Vault. Only the owner can decrypt, via `get_my_transactions`. |
| DB-08 | P2 | `db/01` | ✅ | Columns are `timestamptz` and maintained by trigger. |

## 1.4 QR Scanning Module
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| QR-01 | P0 | `comp` Scanner.test.tsx, `e2e/camera` | ✅ | Real browser camera path: Chromium plays a QR image as the webcam stream, which is decoded and opens the pay screen. A real phone browser is still worth a manual check. |
| QR-02 | P1 | `comp` Scanner.test.tsx, `e2e/camera-denied` | ✅ | Explains how to allow the camera in browser site settings, offers "Try again", keeps image upload working, and throws no page errors. |
| QR-03 | P0 | `unit` emv.test.ts, `comp` PayForm.test.tsx, `e2e/pay`, `e2e/camera` | ✅ | |
| QR-04 | P0 | `unit` emv.test.ts, `comp` PayForm.test.tsx, `e2e/pay` | ✅ | The amount is pre-filled and `editable=false`. Changing the amount breaks the CRC, so the QR is rejected. |
| QR-05 | P0 | `unit` emv.test.ts, `e2e/pay` | ✅ | |
| QR-06 | P1 | `unit` emv.test.ts, `e2e/pay` | ✅ | Rejected inputs: URL, plain text, Wi-Fi, non-BDT EMV, missing merchant ID. |
| QR-07 | P1 | `unit` emv.test.ts, `e2e/pay` | ✅ | Uses the project convention: tag 80 / sub-tag 01 = expiry epoch. |
| QR-08 | P1 | manual, phone browser | 🟡 | Scan a printed `fixtures/qr/valid-static-mlegit.png` indoors; target ≤ 1 s. (The `e2e/camera` timing is recorded in the HTML report but is not representative of a real phone.) |
| QR-09 | P2 | `comp` (torch), manual phone browser | ✅ (torch) / 🟡 conditions | Torch support depends on the browser and device. Still to do on a phone: low light, glare, 30° angle, printed vs on-screen. |
| QR-10 | P2 | `comp` Scanner.test.tsx, `e2e/pay` | ✅ | Image upload goes through `scanFromURLAsync` (BarcodeDetector / zxing-wasm). |
| QR-11 | P1 | `comp` Scanner.test.tsx, `e2e/camera` | ✅ | 30 scan events produce 1 payload. In the browser, with the QR in view for more than 3 s, there is exactly one merchant lookup and one pay screen. |

## 1.5 Payment Flow & Ledger
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| PAY-01 | P0 | `db/03`, `int/pay`, `e2e/pay`, **real phone browser** | ✅ (db, int, e2e) / 🟡 phone | ৳5,000 → ৳4,500, merchant +৳500, 1 transaction row. |
| PAY-02 | P0 | `db/03`, `int/pay` | ✅ | Per-transaction and whole-ledger debits equal credits. |
| PAY-03 | P0 | `db/03`, `e2e/pay` | ✅ | Balance unchanged and no transaction row written. |
| PAY-04 | P0 | `db/03`, `e2e/pay` | ✅ | Returns `WRONG_PIN` with `attempts_left`. The counter is incremented and the ledger is untouched. |
| PAY-05 | P1 | `db/03` | ✅ | Locks for 30 min after 3 wrong PINs, and the correct PIN is refused while locked. Payments resume after the lock and the counter resets. |
| PAY-06 | P1 | `db/03`, `unit` validation.test.ts, `comp` PayForm.test.tsx | ✅ | Rejects 0, negative values, more than 2 decimals, and amounts over ৳25,000, each with a specific code and message. |
| PAY-07 | P0 | `db/03`, `int/pay`, `comp` (button disabled) | ✅ | Two concurrent requests with the same key return the same transaction and debit once. Reusing a key with a different amount is rejected. |
| PAY-08 | P0 | `db/03` | ✅ | A failure injected on the CREDIT insert rolls back the whole payment. |
| PAY-09 | P0 | `int/pay` | ✅ | 2×৳3,000 from ৳5,000 → one success and one `INSUFFICIENT_FUNDS`. A burst of 10×৳500 from ৳2,000 → 4 succeed. Balances never go below 0. |
| PAY-10 | P1 | `unit` payment-flow.test.ts, `db/03`, `e2e/pay` | ✅ | The browser goes offline when Pay is tapped. The app shows "Checking payment status…" and completes once back online. Exactly one ৳100 debit. |
| PAY-11 | P2 | `db/03` | ✅ | Returns `SELF_PAYMENT`. |
| PAY-12 | P1 | `db/03`, `e2e/pay` | ✅ | Newest first, with amount, merchant, time and status. |
| PAY-13 | P2 | `unit` format.test.ts, `e2e/pay` | ✅ | Shares with the Web Share API where available, otherwise copies to the clipboard. |

## Automated run summary
> Phase 2 changed how payments run (scored through the `pay` Edge Function). The latest Phase 1 regression results, with scoring in the flow, are in `docs/phase2-test-matrix.md`.

| Suite | Result |
|---|---|
| pgTAP (`supabase test db`) | 98 / 98 pass |
| Migration idempotency | pass |
| Jest unit + component | 87 / 87 pass |
| Integration (HTTP, local stack) | 17 / 17 pass |
| Bundle secrets check | pass (negative control fails as expected) |
| Lint + typecheck | clean |
| Playwright web E2E | 16 / 16 pass |

## §1.6 Exit criteria status (web)
- [x] **All P0 cases pass.** "Android and iOS" now means the web build in a mobile-sized Chromium viewport.
- [ ] **TC-P1-PAY-01 passes end to end on a physical device.** Pending: open the app in a phone browser over HTTPS or a LAN dev URL, scan a printed QR, and pay ৳500.
- [x] **No open P0/P1 security defects (RLS, PIN storage, secrets).** Two known caveats:
  - **AUTH-05:** GoTrue's direct `/verify` endpoint is protected only by the per-IP rate limit.
  - **AUTH-08:** the session token lives in `localStorage`.
