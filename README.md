# Shongrokhon — Unified MFS & AI Financial Coach

Phase 1 (Foundation & Core MFS) of the PRD, delivered as a **web app** (Expo for web, mobile-first layout): Supabase auth and ledger, Bangla QR scanning in the browser, and the payment flow.
The PRD is in `unified_mfs_ai_financial_coach_prd.md`. The test plan is in `testcase.md`, and the Phase 1 results are in `docs/phase1-test-matrix.md`.

## Stack
- **App:** Expo SDK 57 for web (react-native-web, expo-router, SPA output), TypeScript (`src/`)
  - **QR scanning:** browser camera via `expo-camera` (native `BarcodeDetector`, zxing-wasm fallback for Safari/Firefox), or image upload. The camera needs HTTPS or `localhost`.
- **Backend:** Supabase (Postgres + Auth + Edge Functions) in `supabase/`
  - **Money movement:** happens only inside `SECURITY DEFINER` functions (`make_payment`, `admin_credit_wallet`). Clients get read-only, row-level-secured access.
  - **Ledger:** double-entry `ledger_entries`, append-only. Balances can never go negative.
  - **OTP:** the `otp` Edge Function adds a per-number attempt counter, lockout, and expiry on top of GoTrue phone auth.

## Setup
```bash
npm install
supabase start -x studio,postgres-meta,imgproxy,logflare,vector,supavisor,mailpit,realtime,storage-api
cp .env.example .env   # fill API_URL / ANON_KEY from `supabase status -o env`
npm start              # dev server -> http://localhost:8081
npm run build          # production build -> dist/ (static SPA; serve with an index.html fallback)
```
`supabase/.env` must define `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`. Any value works locally, because test numbers never reach Twilio.

## Test personas (seeded by `supabase/seed.sql`)
Every test number uses OTP `123456`.

| Persona | Phone | Balance | PIN |
|---|---|---|---|
| U-NORMAL | 01711000001 | ৳5,000 | 12345 |
| U-LOW | 01711000002 | ৳100 | 12345 |
| M-LEGIT (merchant `MLEGIT0001`, "Rahim Store") | 01811000001 | ৳0 | 12345 |
| Unregistered, for sign-up tests | 01711000003 … 01711000009 | — | — |

The QR fixtures (PNG + payloads) come from `npm run qr:fixtures` and are written to `fixtures/qr/`.

## Tests
| Command | What |
|---|---|
| `npm test` | Unit + component tests (Jest, RNTL) |
| `npm run test:db` | pgTAP schema / RLS / payment tests, plus the migration idempotency check |
| `npm run test:integration` | Resets the local DB, then exercises the OTP function, PostgREST, RLS and concurrency over HTTP |
| `npm run check:secrets` | Builds the production web bundle and fails if any server key is inside |
| `npm run test:e2e` | Playwright browser E2E: resets the DB, builds and serves the web app, scans QR images and a fake camera stream |
| `npm run lint && npm run typecheck` | Static checks |
