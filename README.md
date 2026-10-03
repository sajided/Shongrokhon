# Shongrokhon: Unified MFS & AI Financial Coach

A mobile financial services (MFS) wallet with built-in fraud scoring and an AI financial coach, delivered as a **web app** with a mobile-first layout.

**Live app:** [shongrokhon.vercel.app](https://shongrokhon.vercel.app)

The hosted project has no seeded test users. To try the app with the test personas below, run it locally (see [Setup](#setup)).

## Features

| Phase | What it adds | Results | How to test |
| ----- | ------------ | ------- | ----------- |
| 1. Foundation & core MFS | Phone/email sign-in with OTP lockout, double-entry ledger, Bangla QR (EMVCo) scanning in the browser, payments | [Matrix](docs/phase1-test-matrix.md) | — |
| 2. Risk intelligence | ML risk scoring in every payment (scan → score → pay or flag), SQL fallback rules, fraud-ring detection | [Matrix](docs/phase2-test-matrix.md) | [Guide](docs/phase2-testing.md) |
| 3. AI coach | Spending dashboard with Claude insights (via the `coach` Edge Function), savings planner, cash-flow forecast | [Matrix](docs/phase3-test-matrix.md) | [Guide](docs/phase3-testing.md) |
| 4. Active interventions | Cash-out at agents, send money, bill pay, Smart Spending Companion, AI Investigation Assistant (admin app), Bangla UI and coach, analytics, account deletion | [Matrix](docs/phase4-test-matrix.md) | [Guide](docs/phase4-testing.md) |

## Documentation

- [Product requirements (PRD)](unified_mfs_ai_financial_coach_prd.md)
- [Test plan](testcase.md), with test IDs like `TC-P1-PAY-01`
- [Security review](docs/security-review.md)
- [Deploying to hosted Supabase and Vercel](docs/deploy-hosted.md)
- [CLAUDE.md](CLAUDE.md): architecture, backend rules and testing notes for contributors

## Stack

- **App** (`src/`): Expo SDK 57 for web (react-native-web, expo-router, SPA output), TypeScript.
  - **QR scanning:** browser camera via `expo-camera` (native `BarcodeDetector`, with a zxing-wasm fallback for Safari and Firefox), or image upload. The camera needs HTTPS or `localhost`.
  - **Languages:** English and Bangla (`src/i18n/`).
- **Admin app** (`admin/`): the AI Investigation Assistant for analysts. Vite + React, with its own `package.json`.
- **Backend** (`supabase/`): Supabase (Postgres, Auth, Edge Functions).
  - **Money movement** happens only inside `SECURITY DEFINER` functions (`make_payment`, `make_cashout`, `make_transfer`, and the service-role-only admin functions). Clients get read-only, row-level-secured access.
  - **Ledger:** double-entry `ledger_entries`, append-only. Balances can never go negative.
  - **Edge Functions:** `otp` (attempt counting, lockout, expiry), `pay` (risk scoring before payment), `coach` (LLM insights) and `investigate` (analyst summaries).
- **ML service** (`ml/`): Python, FastAPI, XGBoost, Isolation Forest and networkx. Runs in Docker.

## Setup

```bash
npm install
supabase start -x studio,postgres-meta,imgproxy,logflare,vector,supavisor,mailpit,realtime,storage-api
cp .env.example .env                              # fill API_URL / ANON_KEY from `supabase status -o env`
cp supabase/functions/.env.example supabase/functions/.env   # ML token, ANTHROPIC_API_KEY, COACH_MODEL
npm run ml:up                                     # ML scoring service (after the Supabase stack is up)
npm start                                         # dev server -> http://localhost:8081
npm run build                                     # production build -> dist/ (static SPA)
```

- `supabase/.env` must define `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`. Any value works locally, because test numbers never reach Twilio.
- Admin app: `npm --prefix admin install`, then `npm --prefix admin run dev` (http://localhost:8766).
- Stop the ML container (`npm run ml:down`) before `supabase stop`.

## Test accounts (local only)

Seeded by `supabase/seed.sql` and `supabase/seed_history.sql`. Every test number uses OTP `123456` and PIN `12345`.

| Persona | Phone | Balance |
| ------- | ----- | ------- |
| U-NORMAL (six months of history) | 01711000001 | ৳5,000 |
| U-LOW | 01711000002 | ৳100 |
| M-LEGIT (merchant `MLEGIT0001`, "Rahim Store") | 01811000001 | ৳0 |
| U-ABUSER | 01911000001 | ৳20,000 |
| U-CASHHEAVY (cashes out at agents) | 01611000001 | ৳3,000 |
| Unregistered, for sign-up tests | 01711000003 … 01711000009 | — |

Analyst (admin app): `analyst@shongrokhon.test` / `analyst-pass-123`.

The full persona list (ring members, pseudo-merchants, agents, billers) is in [CLAUDE.md](CLAUDE.md) and the phase testing guides. QR fixtures (PNG + payloads) come from `npm run qr:fixtures` and are written to `fixtures/qr/`.

## Tests

| Command | What |
| ------- | ---- |
| `npm run lint && npm run typecheck` | Static checks |
| `npm test` | Unit and component tests (Jest, RNTL), plus the hard-coded-text check |
| `npm run test:db` | pgTAP schema, RLS and payment tests, plus the migration idempotency check |
| `npm run test:integration` | Resets the local DB, then tests the Edge Functions, PostgREST and RLS over HTTP |
| `npm run test:e2e` | Playwright: resets the DB, builds and serves the web app, runs browser flows |
| `npm run ml:test` | ML service tests (pytest, in Docker) |
| `npm --prefix admin test` | Admin app tests (Vitest) |
| `npm run check:secrets` | Fails if a server key or the ML token is in a web bundle |

Integration and E2E tests reset the database and need the ML container. Run them one after the other, never in parallel.

## Deployment

The web app is hosted on Vercel at [shongrokhon.vercel.app](https://shongrokhon.vercel.app). `vercel.json` holds the build and the security headers. The backend runs on a hosted Supabase project. See [docs/deploy-hosted.md](docs/deploy-hosted.md) for the full steps.
