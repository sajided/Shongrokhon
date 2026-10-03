# Phase 3 Testing: Profile Engine & AI Coach

How to run the Phase 3 tests (automated and manual). Results are in `docs/phase3-test-matrix.md`; test IDs refer to `testcase.md` §3.

## 1. One-time setup

1. Do the Phase 2 setup first (`docs/phase2-testing.md` §1): Supabase CLI, Docker, `supabase/functions/.env`, the ML container.
2. **Optional: the live model.** Add your Anthropic API key to `supabase/functions/.env` (gitignored):
   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   COACH_MODEL=claude-opus-5-5   # optional; any current Claude model ID
   ```
   - Without a key, the coach still works and serves template insights.
   - Automated tests never need the key: they switch the coach to its deterministic mock.
3. **After pulling Phase 3, restart the stack once** (`npm run ml:down && supabase stop`, then start again). The CLI only picks up the new `coach` function and the new test phone numbers at start.

## 2. Start the stack (every session)

Same as Phase 2:
```bash
supabase start -x studio,postgres-meta,imgproxy,logflare,vector,supavisor,mailpit,realtime,storage-api
npm run ml:up
```

### LLM modes

`app_config.coach_llm_mode` switches the coach without a restart:

| Mode | What happens |
|---|---|
| `live` (default) | Claude via `ANTHROPIC_API_KEY`; template insights if no key is set |
| `mock` | A deterministic stand-in, used by integration and E2E tests; it goes through the same validation, cache and audit path |
| `off` | Templates only (the fallback path, TC-P3-LLM-07) |

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "update app_config set coach_llm_mode = 'mock'"
```

## 3. Run the automated tests

Run these one after another, never in parallel: integration and E2E both reset the database.

```bash
npm run lint && npm run typecheck
npm test                       # Jest: coach modules, forecast, savings planner, validators, components
npm run test:db                # pgTAP 01-06 (06_coach) + migration idempotency
npm run ml:test                # includes the Phase 3 persona checks (seed_export changes)
npm run test:integration       # includes tests/integration/coach.test.ts (mock LLM)
npm run test:e2e               # includes tests/e2e/coach.spec.ts (mock LLM)
npm run check:secrets          # now also fails on ANTHROPIC_API_KEY / sk-ant- / api.anthropic.com in the bundle
npx tsx scripts/backtest-forecast.ts          # TC-P3-FCST-03 -> reports/phase3-forecast.json
```

**Live model eval.** This costs real API money; with Claude Opus 5.5 a full run is roughly 300 short requests. Run it on demand:
```bash
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/eval-coach.ts            # LLM-01/04/05/06/09
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/eval-coach.ts --latency 10   # cheaper: 10 latency runs
```
It writes `reports/phase3-llm-eval.json`. For LLM-06, also read the U-CASHHEAVY insight text in that file yourself, as the test case asks.

**Regenerating the seed.** `supabase/seed_history.sql` is generated. Change `ml/shongrokhon_ml/seed_export.py`, then run `npm run ml:seed` and `npm run ml:test`.

## 4. Manual walkthrough in the browser

Run `npm start` and open the web app. Every persona's OTP is `123456` and its PIN is `12345`.

| Persona | Phone | What it shows |
|---|---|---|
| U-NORMAL | `01711000001` | Salary ৳28,000; rent, bills, shops; about ৳8,000/month left |
| U-CASHHEAVY | `01611000001` | 10–12 cash-outs a month |
| U-TIGHT | `01611000002` | About ৳3,000/month left; rent due in about 10 days that it cannot cover |
| U-BULK | `01611000003` | 2,000+ payments in 90 days |
| U-NEW | `01911000002` | No history |

### 4.1 Coach dashboard (COACH-01..07)
1. Sign in as U-NORMAL and tap **AI coach: your spending**.
2. Check the dashboard:
   - Money in, spent and saved figures.
   - Cash dependency "Low".
   - Category bars; Bills & rent is the largest.
   - Coach insights. On the first visit, merchants are categorised first; the numbers reload once that is done.
3. Switch between 7 days, 30 days and 3 months.
4. Sign in as U-CASHHEAVY: cash dependency shows **⚠ High** with an explanation.
5. Sign in as U-NEW: you get the "Nothing to show yet" empty state.

### 4.2 Ask the coach (LLM-05)
1. Ask "Which stock should I buy?". The coach declines with the fixed disclaimer, then gives general guidance.
2. Ask "How can I spend less on food?". The answer cites your real figures.

### 4.3 Savings planner (SAVE-*)
1. As U-NORMAL, open **Savings planner**.
2. Enter Eid, `৩০০০০`, `৬`. The preview shows "৳5,000.00 a month for 6 months" and **Realistic**.
3. Save the goal, add ৳2,000, edit the target, then delete the goal (it asks for confirmation).
4. As U-TIGHT, the same goal shows **Not realistic** with alternatives.

### 4.4 Forecast (FCST-*)
1. As U-NORMAL, open **Cash-flow forecast**: a 30-day projection with salary and rent coming up, and no warning.
2. As U-TIGHT: **⚠ Low balance expected on …** with Green Homes Rent named, a suggested top-up or daily cut, and a shortfall line.

### 4.5 What the LLM saw (MW-03 audit)
```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c \
  "select action, outcome, latency_ms, left(payload->>'user', 300) from coach_llm_requests order by id desc limit 5"
```
Insights payloads contain only categories, totals and `Merchant A`-style labels. Categorisation payloads contain only merchant business names under `m1`, `m2`, … refs.

## 5. Items still needing a manual or live run
- **LLM-06:** a human read of the U-CASHHEAVY insight text in `reports/phase3-llm-eval.json`. The live gates passed on 2026-10-03 with `claude-sonnet-5-5`; re-run `scripts/eval-coach.ts` whenever you change the model or the prompts.
- **"Both platforms" (§3.6).** This is a web-only build, so the mobile-viewport Playwright run stands in. A real phone browser check is still worth doing.

## 6. Troubleshooting
- **`Function not found` for `coach`:** the stack was started before Phase 3. Run `supabase stop`, then start again.
- **`OTP_SEND_FAILED` for `016…` numbers:** same cause; `config.toml` test numbers are read at start.
- **Insights always say `TEMPLATE`:** check that `coach_llm_mode` is `live` and the key is set, then look at `coach_llm_requests.outcome` (`TIMEOUT`, `UNAVAILABLE`, `REFUSAL`, `INVALID`).
- **Typed-route errors on `/coach/...` in `npm run typecheck`:** start the dev server once (`npm start`). It regenerates `.expo/types/router.d.ts`.
