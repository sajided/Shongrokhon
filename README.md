# Shongrokhon: Unified MFS & AI Financial Coach

## Project overview
**Problem addressed:** Traditional Mobile Financial Services (MFS) lack personalized financial guidance and real-time, context-aware fraud prevention, leaving users vulnerable to scams and poor financial management.
**Proposed solution:** Shongrokhon is a unified MFS wallet that integrates machine learning for real-time risk scoring and a generative AI coach for personalized financial insights.
**Purpose of the project:** To deliver a secure, intelligent, and user-friendly mobile-first web app that empowers users with seamless payments, proactive fraud protection, and AI-driven financial coaching.

## Features
- **Foundation & Core MFS:** Phone/email sign-in with OTP lockout, double-entry ledger, Bangla QR (EMVCo) scanning in the browser, payments, cash-out at agents, send money, and bill pay.
- **Risk Intelligence (AI Component):** Real-time ML risk scoring in every payment (scan → score → pay or flag) using an ML service (XGBoost, Isolation Forest) to detect fraud rings and anomalies, supported by SQL fallback rules.
- **AI Financial Coach (AI Component):** A Smart Spending Companion that provides personalized spending dashboards, savings planners, and cash-flow forecasts using Claude (via the `coach` Edge Function).
- **AI Investigation Assistant:** An admin app feature that uses AI to summarize flagged transactions and fraud rings for analysts.
- **Localization:** Full English and Bangla UI support.

## Technology stack
- **Frontend App:** Expo SDK 57 for web (react-native-web, expo-router, SPA output), TypeScript.
- **Admin App:** Vite + React.
- **Backend Services:** Supabase (Postgres, Auth, Edge Functions).
- **AI Models & ML:** 
  - Generative AI: Anthropic Claude API (for the AI financial coach and analyst summaries).
  - Machine Learning: Python, FastAPI, XGBoost, Isolation Forest, and networkx (running in Docker).
- **Libraries/APIs:** `expo-camera` (BarcodeDetector, zxing-wasm fallback).

## AI / ML at a glance

Full write-ups: the [risk model card](docs/ml-model-card.md) (data, features, calibration, measured performance, ablation, fairness, PaySim validation) and the [AI coach architecture](docs/ai-architecture.md) (how the LLM is kept grounded, private and optional). Every number traces to a committed report under `ml/reports/` or `reports/`.

| What | How | Measured (synthetic hold-out unless noted) |
|---|---|---|
| Disguised cash-out risk score | XGBoost on 22 point-in-time features (payer behaviour, payer × merchant, merchant cash-out habits), thresholds calibrated to target false-positive rates, SQL twin of every feature with a parity test | PR-AUC 0.91 (95 % CI 0.87–0.94), recall 0.81 at FLAG and 0.87 at FLAG-or-step-up, FPR 0.65 %, on users, a month and 50 merchants never seen in training; 94 % recall on channels seen in training |
| Behavioural anomaly | Isolation Forest on user-relative features (ticket vs usual, hour share, velocity) | 10× ticket 60/60 flagged, in-pattern 60/60 not, drift absorbed by rolling retrain |
| Fraud rings | Hourly bipartite graph job with Louvain, merchant suspicion score, session-coordination test, FLAG override | 4/4 simulated rings found, including one that only starts in the test month; no group of unrelated abusers mistaken for one |
| Explainability | Exact TreeSHAP via `/explain`, rendered as plain-language drivers for analysts | Drivers match the summaries in 2/2 evaluated alerts |
| External validation | Same pipeline retrained on PaySim (public mobile-money dataset) | `npm run ml:paysim` after downloading the CSV |
| Cash-flow forecast | Deterministic recurring-item detection + daily baseline, no LLM | Median 30-day error 11 % of income, 65 % better than naive, backtest on 50 users |
| AI coach | SQL facts → LLM writes `{{placeholders}}` only → grounding validator → template fallback; no PII, every call audited | 99 % categorisation accuracy, 100 % grounded insights, 20/20 regulated questions declined, p95 4.8 s |

Everything above is trained and measured on synthetic data; the model card says what that does and does not prove.

## Requirements
- Node.js and npm
- Supabase CLI
- Docker (for the ML service)
- Anthropic API Key (for the Claude AI Coach)

## Installation and setup
1. Clone the repository and navigate to the project directory.
2. Install frontend dependencies:
   ```bash
   npm install
   ```
3. Install admin app dependencies:
   ```bash
   npm --prefix admin install
   ```
4. Start the local Supabase stack (requires Docker):
   ```bash
   supabase start -x studio,postgres-meta,imgproxy,logflare,vector,supavisor,mailpit,realtime,storage-api
   ```
5. Set up environment variables (see the Environment variables section below).
6. Start the ML scoring service container:
   ```bash
   npm run ml:up
   ```

## Environment variables
Create the required `.env` files using the provided examples.

**Root `.env` (Client-side):**
```bash
cp .env.example .env
```
Populate `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_ANON_KEY` using the output from `supabase status -o env`.

**Supabase Functions `.env` (Backend Secrets):**
```bash
cp supabase/functions/.env.example supabase/functions/.env
```
Required variables:
- `ML_SERVICE_TOKEN`: A secret token to authenticate requests to the ML service.
- `ANTHROPIC_API_KEY`: Your Anthropic API key for the Claude AI coach.
- `COACH_MODEL`: The AI model version to use.

**Supabase Local `.env` (Auth):**
- In `supabase/.env`, define `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`. Any placeholder value works locally because test numbers do not reach Twilio.

## Run and build commands
**Development Server (Main App):**
```bash
npm start
```
This runs the Expo dev server at `http://localhost:8081`.

**Development Server (Admin App):**
```bash
npm --prefix admin run dev
```
This runs the Vite dev server at `http://localhost:8766`.

**Production Build (Main App):**
```bash
npm run build
```
Builds the static SPA output to the `dist/` folder.

**Stop Services:**
```bash
npm run ml:down
supabase stop
```

## Live deployment URL
**Live app:** [shongrokhon.vercel.app](https://shongrokhon.vercel.app)

*Note: The hosted project has no seeded test users. To try the app with the test personas, run it locally.*

## Testing instructions
| Command | What it tests |
| ------- | ------------- |
| `npm run lint && npm run typecheck` | Static checks |
| `npm test` | Unit and component tests (Jest, RNTL), plus hard-coded-text checks |
| `npm run test:db` | pgTAP schema, RLS, payment tests, and migration idempotency |
| `npm run test:integration` | Edge Functions, PostgREST, and RLS over HTTP |
| `npm run test:e2e` | Playwright browser flows |
| `npm run ml:test` | ML service tests (pytest, in Docker) |
| `npm --prefix admin test` | Admin app tests (Vitest) |
| `npm run check:secrets` | Ensures no server keys/ML tokens are in web bundles |

*Note: Integration and E2E tests reset the database and require the ML container. Run them sequentially, never in parallel.*

## Other configuration
**Test Accounts (Local Only):**
Seeded automatically via `supabase/seed.sql` and `supabase/seed_history.sql`. All test numbers use OTP `123456` and PIN `12345`.
- **U-NORMAL:** `01711000001` (Balance: ৳5,000)
- **U-LOW:** `01711000002` (Balance: ৳100)
- **M-LEGIT (Merchant):** `01811000001` (Balance: ৳0)
- **U-ABUSER:** `01911000001` (Balance: ৳20,000)
- **U-CASHHEAVY:** `01611000001` (Balance: ৳3,000)
- **Unregistered (for sign-up):** `01711000003` to `01711000009`
- **Analyst (Admin App):** `analyst@shongrokhon.test` / `analyst-pass-123`

**Additional Documents:**
- [Product requirements (PRD)](unified_mfs_ai_financial_coach_prd.md)
- [Test plan](testcase.md)
- [Security review](docs/security-review.md)
- [Deploying to hosted Supabase and Vercel](docs/deploy-hosted.md)
- [CLAUDE.md](CLAUDE.md)
