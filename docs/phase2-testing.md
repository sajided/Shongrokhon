# How to Test Phase 2: Risk Intelligence Pipeline

This guide shows how to run every Phase 2 check: the automated suites, a manual walkthrough in the browser, and the two items that still need a manual run. Results and per-case status are in [`phase2-test-matrix.md`](phase2-test-matrix.md). The test cases are in [`../testcase.md`](../testcase.md) §2.

---

## 1. One-time setup

**You need:**
- Docker Desktop
- Supabase CLI 2.75 or later
- Node 22
- `ffmpeg`, used by the E2E camera fixtures

Python is **not** needed on your machine. All ML code runs in Docker.

1. **Install dependencies.** If `~/.npm` has root-owned files, first set `npm_config_cache` to a writable folder.
   ```bash
   npm install
   npx playwright install chromium
   ```
2. **Create the secrets files.** Both are gitignored.
   ```bash
   # Twilio placeholder for the Supabase CLI (any value works)
   echo 'SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN=dev' >> supabase/.env

   # ML token shared by the `pay` Edge Function and the ML container
   cp supabase/functions/.env.example supabase/functions/.env
   sed -i '' "s/change-me-to-a-random-token/$(openssl rand -hex 24)/" supabase/functions/.env
   ```
3. **Create the web app's `.env`** from `.env.example`. It needs `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`; get the values from `supabase status`.

---

## 2. Start the stack (every session)

Order matters: the ML container joins the Supabase Docker network, so start Supabase first.

```bash
supabase start -x studio,postgres-meta,imgproxy,logflare,vector,supavisor,mailpit,realtime,storage-api
npm run ml:up          # builds + starts the ML service and waits until it is healthy
curl localhost:8710/health   # -> {"status":"ok","model_version":"p2-...", ...}
```

Shut down in reverse order. The ML container holds an endpoint on Supabase's network, so `supabase stop` fails while it is running.

```bash
npm run ml:down
supabase stop
```

---

## 3. Run the automated tests

Run these **one after the other**, never in parallel. Integration and E2E both reset the database.

| Step | Command | What it covers | Expected |
|---|---|---|---|
| 1 | `npm run ml:test` | Models, features, service, ring detection, seed personas, PaySim mapping (XGB-\*, IF-\*, MLAPI-01..04/07..09) | 88 passed |
| 2 | `docker compose -f ml/docker-compose.yml run --rm --no-deps -v "$PWD":/repo -w /repo/ml ml python -m shongrokhon_ml.evaluate` | Model gates (XGB-03/05/06/11, IF-02..07). Writes `ml/reports/metrics.json` (with bootstrap CIs, feature importance and the ablation study) and `pr_curve.png`, `feature_importance.png`, `score_hist.png`, `calibration.png` | 12 lines `PASS`, exit 0 |
| 3 | `npm run lint && npm run typecheck` | Code quality | clean |
| 4 | `npm test` | Jest: step-up screen, notices, API client, `pay/score.ts` timeout and fallback (FLOW-03/05) | 106 passed |
| 5 | `npm run test:db` | pgTAP: decisions, bypass protection, alerts, fallback (FLOW-01..07), SQL = Python feature parity, migration idempotency | 176 tests, `Result: PASS`, `DB-02 ... cleanly` |
| 6 | `npm run test:integration` | Over HTTP against the real stack + ML: FLOW-01..09, including stopping the ML container (FLOW-04) and running the ring job (FLOW-08) | 28 pass, 0 fail |
| 7 | `npm run test:e2e` | Browser: flagged payment, step-up, 100-run latency on throttled 4G (FLOW-09), and the Phase 1 regression | 19 passed (~7 min) |
| 8 | `npm run check:secrets` | No service key or ML token in the web bundle | `SETUP-05: no secrets ...` |

**Notes:**
- Step 6 stops and restarts the ML container itself (FLOW-04). If a run is interrupted, run `npm run ml:up` again.
- Steps 6 and 7 print latency lines, for example `pay p50=…ms p95=…ms` and `FLOW-09 browser (4G throttled): p50=… p95=…`. Record them in the matrix.
- **Do not run `npm run ml:train` just to test.** It retrains the models and **regenerates** `ml/artifacts/*`, `supabase/tests/05_feature_parity.test.sql` and `supabase/seed_history.sql`. Use it only when you change the simulation, the features or the model. After running it:
  - commit the regenerated files;
  - check that the thresholds in `ml/artifacts/metadata.json` still match the `app_config` defaults in `supabase/migrations/20261002000006_risk.sql` (`ml:test` checks this);
  - restart the service with `npm run ml:up`.

---

## 4. Manual walkthrough in the browser

Reset the database first so balances match the table below. Then start the web app.

```bash
supabase db reset
npm start   # opens the web app (use a phone-sized window, or a real phone on your LAN)
```

Sign in with the phone number, then the OTP **123456**. Every PIN is **12345**.

| Persona | Phone | Balance | Use it for |
|---|---|---|---|
| U-NORMAL | 01711000001 | ৳5,000 | Normal payments, ~10× spike |
| U-ABUSER | 01911000001 | ৳20,000 | High risk (FLAG) |
| U-NEW | 01911000002 | ৳0 | Cold start; top it up first (see below) |
| RING-01 member | 01911000003 – 01911000010 | ৳5,000 | Step-up (REVIEW); ring detection |
| M-PSEUDO owner | 01811000011 | — | Seeing the merchant's notice |

To pay, tap **Scan QR to pay**, choose the gallery or upload option, and pick an image from `fixtures/qr/`. Run `npm run qr:fixtures` first if the folder is empty.
- `valid-static-mlegit.png`: Rahim Store (`MLEGIT0001`)
- `valid-static-mpseudo.png`: Quick Mart (`MPSEUDO01`), the pseudo merchant

### 4.1 Low risk executes (FLOW-01)
1. Sign in as **U-NORMAL**, upload `valid-static-mlegit.png`, and pay **৳500**.
2. ✅ The receipt says *Payment successful*, there is **no** review notice, and the balance is ৳4,500.

### 4.2 High risk pays, then alerts and flags (FLOW-02)
1. Sign in as **U-ABUSER**, upload `valid-static-mpseudo.png`, and pay **৳10,000**.
2. ✅ The receipt says *Payment successful* and shows the notice *"This payment has been flagged for a routine review…"*.
3. ✅ Tap **Done**. Home shows *Payment under review* with the amount and merchant. **OK** dismisses it, and it stays dismissed after a reload.
4. Sign in as **01811000011** (the merchant). ✅ Home shows *Payment received under review*.
5. Check the database:
   ```bash
   docker exec -i supabase_db_shongrokhon psql -U postgres -c \
     "select kind, status, summary->>'risk_score' as risk from risk_alerts order by created_at desc limit 3;"
   docker exec -i supabase_db_shongrokhon psql -U postgres -c \
     "select merchant_id, risk_flagged from wallets where risk_flagged;"
   ```

### 4.3 Medium risk asks for step-up (FLOW-03, IF-03)
1. Sign in as **U-NORMAL**, upload `valid-static-mlegit.png`, and pay **৳4,200**, about 10× their usual ticket at that shop. Top up first if the balance is too low (see 4.6).
2. ✅ A **Confirm this payment** screen appears. It must not mention risk or fraud, and the balance must be unchanged.
3. Enter a wrong PIN. ✅ You see *Wrong PIN. N attempts left.* and nothing is debited.
4. Enter **12345** and confirm. ✅ The payment succeeds, and is debited exactly once.

A **RING-01** member, for example 01911000010, gets the step-up screen for any amount at the legit shops, because their history looks cash-out-like.

### 4.4 Scoring service down: fallback (FLOW-04)
```bash
docker compose -f ml/docker-compose.yml stop ml
```
1. Pay **৳300** as U-NORMAL. ✅ It succeeds, with no error shown.
2. Pay **৳12,000** after a top-up. ✅ You get the step-up screen: the fallback rule steps up any amount of ৳10,000 or more.
3. Check that the fallback decided:
   ```bash
   docker exec -i supabase_db_shongrokhon psql -U postgres -c \
     "select source, model_version, decision, amount from risk_scores order by created_at desc limit 2;"
   # -> FALLBACK | rules-v1
   ```
4. Restart the service: `docker compose -f ml/docker-compose.yml start ml`.

To simulate a **slow** service (FLOW-05), lower the timeout. Restore it afterwards.
```bash
docker exec -i supabase_db_shongrokhon psql -U postgres -c "update app_config set ml_timeout_ms = 1;"
# pay something -> risk_scores.source = FALLBACK
docker exec -i supabase_db_shongrokhon psql -U postgres -c "update app_config set ml_timeout_ms = 800;"
```

### 4.5 Ring detection (FLOW-08)
```bash
npm run ml:network        # -> {"events": ..., "rings": 1, "alerts": ["<uuid>"], ...}
docker exec -i supabase_db_shongrokhon psql -U postgres -c \
  "select kind, jsonb_array_length(summary->'payer_wallets') as payers, summary->>'score' from risk_alerts where kind = 'RING';"
```
1. ✅ There is exactly one RING alert, with 8 payers. Running the job again does not add a second one.
2. Sign in as a RING-01 member and pay ৳120 to Star Telecom (`MPSEUDO02`). You'll need a QR for it: use `buildBanglaQr` in `scripts/gen-qr-fixtures.ts`, or call the `pay` function directly. ✅ The payment is flagged even though the amount is small, because of the merchant's network score.

### 4.6 Useful commands
```bash
# Top up a wallet (service-only function, run as postgres)
docker exec -i supabase_db_shongrokhon psql -U postgres -c \
  "select admin_credit_wallet((select w.id from wallets w join users u on u.id = w.user_id
     where u.phone = '+8801711000001' and w.kind = 'customer'), 5000);"

# Latest scores, with the inputs that drove them
docker exec -i supabase_db_shongrokhon psql -U postgres -c \
  "select decision, source, round(risk_score::numeric,4) risk, round(anomaly_score::numeric,3) anomaly,
          features->>'amount_to_merchant_median' as x_usual, features->>'payer_merchant_count_10m' as repeats
     from risk_scores order by created_at desc limit 5;"

# Edge Function logs (fallbacks, errors; no personal data)
docker logs --since 10m supabase_edge_runtime_shongrokhon 2>&1 | grep -E "risk_|pay_"

# Force a decision for a demo: thresholds live in app_config (restore afterwards!)
#   review 0.21, flag 0.58, anomaly 0.0, network 0.8, fallback amount 10000, burst 3 (see ml/artifacts/metadata.json)
docker exec -i supabase_db_shongrokhon psql -U postgres -c "update app_config set risk_review_threshold = 0;"
```

---

## 5. Items still needing a manual run

### 5.1 FLOW-09 on a real phone over 4G (P0, 🟡)
**Pass criterion:** p95 under 1.5 s from tapping Pay to seeing the result, over 100 runs.

1. Serve the app over HTTPS, or on a LAN URL the phone can reach. Point `EXPO_PUBLIC_SUPABASE_URL` at an address the phone can reach, then run `npx expo export --platform web --clear` and serve `dist/`.
2. On the phone, turn Wi-Fi **off** and use mobile data (4G).
3. Sign in as U-NEW and top it up (4.6). To time the full path every time, pin decisions to ALLOW:
   ```bash
   docker exec -i supabase_db_shongrokhon psql -U postgres -c \
     "update app_config set risk_review_threshold=2, risk_flag_threshold=2, anomaly_threshold=1e9, network_flag_threshold=2;"
   ```
4. Pay ৳10 repeatedly and time each tap-to-receipt with a stopwatch or screen recording. Alternatively, read the server-side time: the Edge Function logs `risk_scored … total_ms`, and you add the network round trip on top.
5. Restore the thresholds to 0.21 / 0.58 / 0 / 0.8 (the `metadata.json` values) and record p50 and p95 in the matrix.

### 5.2 MLAPI-06 at saturation (P1, ⚠️)
**Pass criterion:** p95 within the 200 ms budget, with an error rate under 0.1%, for 100 concurrent users over 5 minutes.

```bash
# realistic: 100 users, each scoring about once a second (currently passes, p95 ~35 ms)
docker compose -f ml/docker-compose.yml run --rm --no-deps ml \
  python bench/latency.py --url http://shongrokhon-ml:8000 --concurrency 100 --duration 300 --processes 4 --think 1

# saturation: 100 users back to back (fails on a laptop: p95 ~920 ms)
docker compose -f ml/docker-compose.yml run --rm --no-deps ml \
  python bench/latency.py --url http://shongrokhon-ml:8000 --concurrency 100 --duration 300 --processes 4
```

Run the saturation case on production-sized hardware, with the load generator on a **separate** machine. One Python client process saturates at about 100 req/s, so keep `--processes` at 4 or more. To scale, raise `--workers` in `ml/Dockerfile` or run more replicas.

---

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ML service not reachable on :8710` | Run `npm run ml:up`. Supabase must be running first. |
| `network supabase_network_shongrokhon not found` | Supabase isn't started. Run `supabase start`, then `npm run ml:up`. |
| `supabase stop` fails with "active endpoints" | Run `npm run ml:down` first. |
| `pay` returns 404 *Function not found* | The stack was started before `functions/pay` existed. Run `npm run ml:down && supabase stop && supabase start … && npm run ml:up`. |
| `pay` returns 401 *Invalid JWT* | `[functions.pay] verify_jwt` must be `false`, because the function verifies the token itself. Restart the stack after editing `config.toml`. |
| Every score has `source = FALLBACK` | Check that `supabase/functions/.env` exists, that its token matches the running container, and that `ml_timeout_ms` is not left at 1. Restart both after changing it. |
| Sign-in fails with `OTP_SEND_FAILED` | The number isn't in `[auth.sms.test_otp]` in `config.toml`. Add it and restart Supabase. |
| A normal payment unexpectedly asks for step-up | Rapid repeat payments, or a far larger amount than usual, are anomalies by design. Check `features` in the latest `risk_scores` row (see 4.6). |
| `npm run ml:up` hangs on `pip install` | A transient PyPI download error. Run it again. |
| `db/05` parity test fails | `private.risk_features` (SQL) and `ml/shongrokhon_ml/features.py` have drifted apart. Fix one of them, then regenerate with `python -m shongrokhon_ml.parity` inside the ML container. |
