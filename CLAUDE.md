# CLAUDE.md

Project Shongrokhon is an MFS wallet with an AI financial coach.
- Product spec: `unified_mfs_ai_financial_coach_prd.md`.
- Test plan: `testcase.md`, with test IDs like `TC-P1-PAY-01`.
- Results: `docs/phase1-test-matrix.md`, `docs/phase2-test-matrix.md`, `docs/phase3-test-matrix.md`. Update the matrix whenever tests change.
- How to run the tests (automated + manual walkthrough): `docs/phase2-testing.md`, `docs/phase3-testing.md`.

## Scope
- **Web app only.** Expo SDK 57 renders to the web through react-native-web, using expo-router with `web.output: "single"` (SPA). Do not add iOS/Android code, native config plugins, EAS, or Maestro.
- **Phase 1 is done:** auth, ledger, Bangla QR, payments.
- **Phase 2 is done:** ML risk scoring in the payment flow (scan → score → execute/flag), ring detection.
- **Phase 3 is done:** AI coach (Claude via the `coach` Edge Function, not Next.js), coach dashboard, savings planner, cash-flow forecast.
- **Phase 4 is not started:** Smart Spending Companion, Investigation Assistant, Bangla localization.
- **Expo APIs change between SDK releases.** Check the versioned docs (`https://docs.expo.dev/versions/v57.0.0/`) or the `.d.ts` in `node_modules` before using one. Don't rely on memory.

## Layout
- `src/app/`: routes. `_layout.tsx` guards them with `Stack.Protected`:
  - signed out → `sign-in`, `verify`
  - no PIN → `set-pin`
  - otherwise the app screens
- `src/lib/`: framework-free logic. Unit-test it here.
  - `qr/emv.ts`: Bangla QR / EMVCo parser and builder.
  - `validation.ts`, `format.ts`, `messages.ts`.
  - `payment-flow.ts`: offline recovery.
  - `forecast.ts` (cash-flow forecast), `savings.ts` (goal plans): pure, client-side, backtested by `scripts/backtest-forecast.ts`.
  - `api.ts`: typed RPC wrappers; `callFunction` for Edge Functions.
  - `errors.ts`.
- `src/components/`: UI. `ui.tsx` holds the shared primitives and color tokens.
- `supabase/`:
  - `migrations/`, `seed.sql` (test personas)
  - `tests/*.test.sql` (pgTAP)
  - `seed_history.sql`: Phase 2 personas with backdated history. **Generated** by `ml/shongrokhon_ml/seed_export.py`; don't hand-edit.
  - `functions/otp/`, `functions/pay/`, `functions/coach/` (Deno Edge Functions). Every module except `index.ts` is pure and Jest-tested (`pay/score.ts`, `coach/*.ts`). Pure modules import each other with `.ts` extensions; the Anthropic SDK is passed into `coach/anthropic.ts` from `index.ts` (`npm:` import).
- `ml/`: Python (FastAPI, XGBoost, Isolation Forest, networkx). Runs only in Docker (xgboost needs libomp on macOS).
  - `shongrokhon_ml/`: `synth` (synthetic data), `features` (must match SQL), `train`, `evaluate` (gates), `model`, `service`, `network` (ring job), `parity`, `seed_export`.
  - `artifacts/` (committed models + `metadata.json`), `reports/metrics.json`, `tests/` (pytest), `bench/latency.py`.
- `tests/integration/`: node:test against the local stack over HTTP.
- `tests/e2e/`: Playwright against the production web build.

## Commands
```bash
npm start                      # web dev server
npm run lint && npm run typecheck
npm test                       # Jest unit + component (jest-expo, RNTL)
npm run test:db                # pgTAP + migration idempotency
npm run test:integration       # runs `supabase db reset` first
npm run test:e2e               # Playwright; global setup resets the DB and builds + serves dist/ on :8765
npm run check:secrets          # fails if a server key or the ML token is in the web bundle
npm run ml:up                  # build + start the ML service (needs the Supabase stack running first)
npm run ml:test                # pytest in Docker
npm run ml:train               # retrain, evaluate gates, regenerate parity test + seed_history.sql
npm run ml:seed                # regenerate seed_history.sql only (after editing seed_export.py)
npm run ml:network             # run the ring-detection job once
npm run ml:bench               # 1,000 sequential /score requests (MLAPI-05)
npx tsx scripts/backtest-forecast.ts   # FCST-03 forecast backtest
npx tsx scripts/eval-coach.ts          # live LLM gates (LLM-01/04/05/06/09); needs ANTHROPIC_API_KEY, costs money
```
- Start the local stack with `supabase start -x studio,postgres-meta,imgproxy,logflare,vector,supavisor,mailpit,realtime,storage-api`. `postgres-meta` fails its health check on this machine.
- `supabase/.env` must define `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`. Any value works.
- `~/.npm` has root-owned files. Until someone runs `sudo chown -R 501:20 ~/.npm`, set `npm_config_cache` to a writable dir before `npm install`.
- Integration and E2E tests **reset the database** and need the ML container (`npm run ml:up`). Run them one after the other, never in parallel.
- `supabase/functions/.env` (gitignored; copy `.env.example`) holds `ML_URL` and `ML_SERVICE_TOKEN` for the `pay` function and the ML container, and `ANTHROPIC_API_KEY` / `COACH_MODEL` for `coach`.
- New Edge Functions and `[auth.sms.test_otp]` numbers are only picked up by `supabase start`: restart the stack after adding either.
- Stop the ML container (`npm run ml:down`) before `supabase stop`: it holds an endpoint on the Supabase Docker network.
- **Done means:** also `npm run ml:test` when `ml/` or the risk SQL changes.
- **Done means:** lint, typecheck, `npm test`, `npm run test:db`, and any affected integration/E2E tests all pass.

## Backend rules (money and security)
- **Clients never write tables.**
  - Every money movement goes through a `SECURITY DEFINER` function with `set search_path = ''`.
  - The current ones are `make_payment`, and the service-role-only `admin_credit_wallet` and `admin_cashout`.
  - All of them post a balanced DEBIT/CREDIT pair via `private.post_transfer`.
- **Every new user-facing RPC must:**
  - Call `private.require_session()` first. This returns HTTP 401 `PT401` for revoked sessions.
  - Be revoked from `public, anon, authenticated`, then granted explicitly. Supabase grants EXECUTE by default.
- **Business failures inside `make_payment`** (wrong PIN, insufficient funds) **return** `{status:'FAILED', code}` instead of raising, so counter updates still commit.
- **Other RPCs raise** with an `UPPER_SNAKE` message, e.g. `PIN_ALREADY_SET`. The client maps every code to user text in `src/lib/messages.ts`.
- **Write migrations so they can be re-applied:** `if not exists`, `create or replace`, and `drop policy if exists` before `create policy`. `scripts/check-migrations-idempotent.sh` enforces this.
- **Encrypted fields:** `note_enc` and `counterparty_enc` are encrypted with `private.encrypt_field`, which uses a key from Vault. Only `get_my_transactions` decrypts them.
- **`ledger_entries` is append-only.** Even the owner cannot update or delete rows.
- **Payments go through the `pay` Edge Function**, never `make_payment` directly:
  - `risk_context` → ML `/score` (timeout `app_config.ml_timeout_ms`; on failure, the SQL fallback rules decide) → `record_risk_score` → `make_payment(..., p_score_id, p_confirm)` as the caller.
  - `make_payment` returns `SCORE_REQUIRED` / `SCORE_INVALID` / `SCORE_EXPIRED` without a matching unexpired score. Only `service_role` can write `risk_scores`.
  - Decisions are made in SQL (`private.decide_risk`) from `app_config` thresholds: ALLOW pays; REVIEW returns `STEP_UP_REQUIRED` until `p_confirm`; FLAG pays, then `private.raise_risk_alert` (alert, both wallets flagged, notices to payer and merchant).
  - `app_config` threshold defaults must equal `ml/artifacts/metadata.json` (`ml/tests/test_thresholds_in_sync.py`).
  - `verify_jwt = false` for `pay`: the gateway only knows the legacy HS256 secret, and user tokens are ES256. The function verifies with `auth.getClaims()`.
- **Risk features exist twice:** `private.risk_features` (SQL) and `ml/shongrokhon_ml/features.py`. Change both, then run `python -m shongrokhon_ml.parity`; the generated `supabase/tests/05_feature_parity.test.sql` must pass.
- **AI coach (`coach` Edge Function):**
  - Every number comes from SQL (`private.coach_summary`, `get_coach_dashboard`). The LLM writes figures only as `{{placeholders}}`; `coach/grounding.ts` fills them and rejects any raw digit or unknown key (TC-P3-LLM-04). Keep it that way.
  - The LLM never sees PII: insights get `coach_summary(..., p_names => false)` (categories, totals, `Merchant A` labels); categorisation gets merchant names only, under `m1` refs; questions are scrubbed by `coach/sanitize.ts`. Every call is logged in `coach_llm_requests`.
  - `app_config.coach_llm_mode`: `live` | `mock` (tests) | `off`. Integration/E2E tests set `mock` with `setAppConfig` and restore it.
  - Any LLM failure (timeout `coach_llm_timeout_ms`, refusal, invalid output after one retry) falls back to template insights; never a 5xx.
  - Savings goals are records only (`create_savings_goal` etc.); no money moves.
- **OTP:** the app calls only the `otp` Edge Function, never GoTrue's OTP endpoints. The function adds per-number attempt counting, a lockout after 5 wrong codes, and expiry.

## Testing gotchas
- **pgTAP:**
  - Each file does `\ir _helpers.psql`, which defines `pg_temp.mk_user`, `mk_merchant`, `as_user`, `as_anon`, `balance_of`, `wallet_of`, `mk_score` and `pay` (scores, then calls `make_payment`).
  - `now()` is frozen inside a test transaction, and features only count events strictly before it: backdate rows when a test needs history.
  - Capture RPC results with `\gset`. Run `reset role` before using the helpers again.
  - Cast psql variables (`:'x'::text`) inside `is()`.
- **RNTL v14 is async:** `await render(...)`, `await fireEvent.press(...)`, `await act(async () => ...)`. A synchronous `act` leaks state into later tests.
- **The React Compiler lint rule rejects `setState` called synchronously in an effect.** Set state in a promise callback instead (see `src/hooks/session.tsx`).
- **Test numbers** all use OTP `123456`:
  - `01711000001` U-NORMAL (৳5,000, six months of history), `…02` U-LOW (৳100), `…03`–`…09` unregistered.
  - `01811000001` M-LEGIT (`MLEGIT0001`); `…02`/`…03` M-LEGIT2/3; `…11` M-PSEUDO (`MPSEUDO01`); `…12`/`…13` M-PSEUDO2/3.
  - `01911000001` U-ABUSER (৳20,000), `…02` U-NEW (৳0), `…03`–`…10` RING-01 (৳5,000 each).
  - Phase 3: `01611000001` U-CASHHEAVY (৳3,000), `…02` U-TIGHT (rent due it can't cover), `…03` U-BULK (2,000+ payments). Merchants `01811000021`–`28`: M-GROCER, M-RENT, M-UTIL, M-RIDE, M-BANK (SAVINGS), M-CAFE, M-FASHION, M-INJECT (prompt-injection name).
  - U-NORMAL has a ৳28,000 monthly salary, rent and bank transfers; its balance still ends at ৳5,000.
- **Tests about ledger semantics, not risk,** pin decisions with `setRiskConfig(ALWAYS_ALLOW)` (tests/integration/helpers.ts) and restore after. Bursts of payments are velocity anomalies by design.
  - GoTrue allows one SMS per number every ~5 s. Test helpers retry once after 6 s.
- **Element lookup:** `testID` becomes `data-testid` on web. Playwright and RNTL both look elements up by test ID.
- **Env vars:** `EXPO_PUBLIC_*` values are inlined only when read as `process.env.EXPO_PUBLIC_X` (see `src/lib/config.ts`). Metro caches the inlined values; use `expo export --clear` after changing `.env`.
- **Keys:** never put the service-role key or an `sb_secret_` key in `.env` or anywhere the app imports.

## Known open items
- Phase 1 still needs a manual run in a real phone browser: PAY-01, QR-08 and QR-09.
- GoTrue's direct `/auth/v1/verify` endpoint bypasses the OTP lockout. Only the per-IP rate limit protects it.
- The session token is stored in `localStorage`. Add a strict CSP when the app is deployed.
- Phase 2 models are trained on synthetic data (`ml/shongrokhon_ml/synth.py`). Their metrics validate the pipeline, not real-world accuracy; retrain on real labelled data before production.
- Ring alerts flag wallets but do not notify ring members (to avoid tipping them off). Analyst review is Phase 4.
- Coach text is English; Bangla prompts and UI are Phase 4. After changing `coach/prompts.ts` or `COACH_MODEL`, re-run `scripts/eval-coach.ts` (live, costs money) and bump `PROMPT_VERSION`.
