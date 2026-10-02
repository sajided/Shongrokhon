# CLAUDE.md

Project Shongrokhon is an MFS wallet with an AI financial coach.
- Product spec: `unified_mfs_ai_financial_coach_prd.md`.
- Test plan: `testcase.md`, with test IDs like `TC-P1-PAY-01`.
- Phase 1 results: `docs/phase1-test-matrix.md`. Update the matrix whenever tests change.

## Scope
- **Web app only.** Expo SDK 57 renders to the web through react-native-web, using expo-router with `web.output: "single"` (SPA). Do not add iOS/Android code, native config plugins, EAS, or Maestro.
- **Phase 1 is done:** auth, ledger, Bangla QR, payments.
- **Phases 2–4 are not started:** ML scoring, the LLM coach, localization.
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
  - `api.ts`: typed RPC wrappers.
  - `errors.ts`.
- `src/components/`: UI. `ui.tsx` holds the shared primitives and color tokens.
- `supabase/`:
  - `migrations/`, `seed.sql` (test personas)
  - `tests/*.test.sql` (pgTAP)
  - `functions/otp/` (Deno Edge Function)
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
npm run check:secrets          # fails if a server key is in the web bundle
```
- Start the local stack with `supabase start -x studio,postgres-meta,imgproxy,logflare,vector,supavisor,mailpit,realtime,storage-api`. `postgres-meta` fails its health check on this machine.
- `supabase/.env` must define `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`. Any value works.
- `~/.npm` has root-owned files. Until someone runs `sudo chown -R 501:20 ~/.npm`, set `npm_config_cache` to a writable dir before `npm install`.
- Integration and E2E tests **reset the database**. Run them one after the other, never in parallel.
- **Done means:** lint, typecheck, `npm test`, `npm run test:db`, and any affected integration/E2E tests all pass.

## Backend rules (money and security)
- **Clients never write tables.**
  - Every money movement goes through a `SECURITY DEFINER` function with `set search_path = ''`.
  - The current ones are `make_payment` and `admin_credit_wallet`, which is service-role only.
  - All of them post a balanced DEBIT/CREDIT pair via `private.post_transfer`.
- **Every new user-facing RPC must:**
  - Call `private.require_session()` first. This returns HTTP 401 `PT401` for revoked sessions.
  - Be revoked from `public, anon, authenticated`, then granted explicitly. Supabase grants EXECUTE by default.
- **Business failures inside `make_payment`** (wrong PIN, insufficient funds) **return** `{status:'FAILED', code}` instead of raising, so counter updates still commit.
- **Other RPCs raise** with an `UPPER_SNAKE` message, e.g. `PIN_ALREADY_SET`. The client maps every code to user text in `src/lib/messages.ts`.
- **Write migrations so they can be re-applied:** `if not exists`, `create or replace`, and `drop policy if exists` before `create policy`. `scripts/check-migrations-idempotent.sh` enforces this.
- **Encrypted fields:** `note_enc` and `counterparty_enc` are encrypted with `private.encrypt_field`, which uses a key from Vault. Only `get_my_transactions` decrypts them.
- **`ledger_entries` is append-only.** Even the owner cannot update or delete rows.
- **OTP:** the app calls only the `otp` Edge Function, never GoTrue's OTP endpoints. The function adds per-number attempt counting, a lockout after 5 wrong codes, and expiry.

## Testing gotchas
- **pgTAP:**
  - Each file does `\ir _helpers.psql`, which defines `pg_temp.mk_user`, `mk_merchant`, `as_user`, `as_anon`, `balance_of` and `wallet_of`.
  - Capture RPC results with `\gset`. Run `reset role` before using the helpers again.
  - Cast psql variables (`:'x'::text`) inside `is()`.
- **RNTL v14 is async:** `await render(...)`, `await fireEvent.press(...)`, `await act(async () => ...)`. A synchronous `act` leaks state into later tests.
- **The React Compiler lint rule rejects `setState` called synchronously in an effect.** Set state in a promise callback instead (see `src/hooks/session.tsx`).
- **Test numbers** are `01711000001`–`09` and `01811000001`, all with OTP `123456`:
  - `…01` is U-NORMAL (৳5,000) and `…02` is U-LOW (৳100).
  - `…03`–`…09` are unregistered.
  - GoTrue allows one SMS per number every ~5 s. Test helpers retry once after 6 s.
- **Element lookup:** `testID` becomes `data-testid` on web. Playwright and RNTL both look elements up by test ID.
- **Env vars:** `EXPO_PUBLIC_*` values are inlined only when read as `process.env.EXPO_PUBLIC_X` (see `src/lib/config.ts`). Metro caches the inlined values; use `expo export --clear` after changing `.env`.
- **Keys:** never put the service-role key or an `sb_secret_` key in `.env` or anywhere the app imports.

## Known open items
- Phase 1 still needs a manual run in a real phone browser: PAY-01, QR-08 and QR-09.
- GoTrue's direct `/auth/v1/verify` endpoint bypasses the OTP lockout. Only the per-IP rate limit protects it.
- The session token is stored in `localStorage`. Add a strict CSP when the app is deployed.
