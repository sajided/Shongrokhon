# Phase 3 Test Matrix: Profile Engine & AI Coach

Covers every `TC-P3-*` case in `testcase.md` §3.1–3.6. For each case it gives where the test lives and the latest result.

**Run date:** 2026-10-03, local stack (Supabase CLI 2.75, edge-runtime 1.70, Expo SDK 57 for web, Node 22, Playwright Chromium, `@anthropic-ai/sdk` 0.131.0). Code default model `claude-opus-5-5`; this run used `COACH_MODEL=claude-sonnet-5-5` for the live eval and the live smoke test.

**Read this first:**
- **The LLM in integration and E2E runs is a deterministic mock.** It goes through exactly the same validation, grounding, cache, audit and fallback code as the live model. Cases that judge the live model's output (LLM-01, -04, -05, -06, -09) are covered by `scripts/eval-coach.ts`, run against the real API on 2026-10-03 with `claude-sonnet-5-5` (`reports/phase3-llm-eval.json`). A live smoke test through the `coach` function also passed: insights in 4.8 s and ask in 3.4 s, both grounded, with the stock question declined.
- **The forecast backtest uses synthetic users.** It validates the method, not real-world accuracy.

**Design decisions taken in Phase 3 (with the product owner):**
- **Middleware:** a Supabase Edge Function `coach` instead of the PRD's Next.js on Vercel. It follows the same auth (`auth.getClaims`), secrets and test harness as `pay`. MW-09 targets the Edge Function's own timeout (`app_config.coach_llm_timeout_ms`).
- **LLM:** the Anthropic API (Claude), with one provider. LLM-07 "failover" means Claude, then deterministic template insights.
  - The SDK's server-side refusal fallback (`fallbacks: "default"`) is enabled.
  - The prompt-cached system prompt and structured JSON output are enforced.
- **Grounded numbers by construction (LLM-04):**
  - SQL computes every figure.
  - The LLM may only write `{{placeholders}}`. The server fills them in and rejects any raw digit or unknown key, retries once, then falls back to the template.
- **No PII to the LLM (MW-03):**
  - Insights get an anonymised SQL summary: categories, totals, `Merchant A` labels.
  - Categorisation gets merchant business names only, under `m1` refs.
  - Questions are scrubbed of phones, NIDs, emails and ids.
  - Every request is stored in `coach_llm_requests` for audit.
- **Savings goals are records only.** Contributions are tracked; no money moves.
- **Forecast and savings plans run on the device** (`src/lib/forecast.ts`, `src/lib/savings.ts`) from the user's own data. They involve no LLM.
- **Periods:** rolling 7 days, 30 days and 3 months, labelled as such. "This week/month" in the test case maps to the rolling windows.
- **"Both platforms":** the product is web-only, so the mobile-viewport Playwright profile (Pixel 7) stands in. This is the same policy as Phases 1–2.

**Status legend:**
- ✅ **pass:** automated and passing.
- 🟡 **pending:** needs a live-model, device or manual run that has not been done yet.
- ⚠️ **partial:** covered, with a caveat noted in the row.

**Test locations:**

| Location | What runs there |
|---|---|
| `db/06` | `supabase/tests/06_coach.test.sql` (pgTAP) |
| `fn/<file>` | Jest: `supabase/functions/coach/<file>.test.ts` (orchestrator, grounding, categorize, anthropic adapter) |
| `unit` / `comp` | Jest: `src/lib/{forecast,savings,validation}.test.ts`, `src/components/{CoachCards,Goals,ForecastView}.test.tsx` |
| `int/coach` | `tests/integration/coach.test.ts` (HTTP against the local stack, mock LLM) |
| `e2e/coach` | `tests/e2e/coach.spec.ts` (Playwright, mock LLM) |
| `ml/seed` | `ml/tests/test_seed_personas.py` (Phase 3 persona shapes) |
| `backtest` | `scripts/backtest-forecast.ts`, written to `reports/phase3-forecast.json` |
| `eval` | `scripts/eval-coach.ts` (live Claude, on demand), written to `reports/phase3-llm-eval.json` |
| `secrets` | `scripts/check-bundle-secrets.sh` |

## 3.1 Middleware: Batching & Sanitization
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| MW-01 | P0 | `int/coach`, `db/06` | ✅ | No JWT or a forged JWT gets 401 from the function. `anon` cannot execute the coach RPCs (42501). |
| MW-02 | P0 | `int/coach`, `db/06` | ✅ | A body `user_id` that is not the caller's gets 403 `FORBIDDEN`. The function always uses the JWT's user. Users cannot read, edit or delete other users' goals. |
| MW-03 | P0 | `int/coach`, `db/06`, `fn/orchestrator`, `fn/grounding`, `fn/categorize` | ✅ | The audited payloads contain none of: phone, name, user id, wallet id, or the user's merchant names. Merchants are `Merchant A..H`. Questions are scrubbed (BD phone formats including Bangla digits, NID, email, UUID). |
| MW-04 | P0 | `int/coach`, `db/06` | ✅ | U-BULK (2,000+ payments in 90 days) returns 200. The insights payload stays under 6,000 characters; the SQL summary is bounded (top 8 merchants, fixed category list). |
| MW-05 | P1 | `int/coach`, `fn/orchestrator` | ✅ | U-NEW gets `INSUFFICIENT_DATA` and zero LLM requests are logged (threshold `coach_min_txns` = 5). |
| MW-06 | P0 | `int/coach`, `db/06`, `fn/categorize` | ✅ | M-INJECT ("Ignore previous instructions…") is categorised `OTHERS` from the fixed list. Its name never reaches the insights prompt, and the response never echoes it. Prompts tag data as data. |
| MW-07 | P1 | `int/coach`, `db/06`, `fn/orchestrator` | ✅ | 30 requests in a minute: exactly 10 × 200 and 20 × 429 (`coach_rate_per_minute` = 10). Limits are per user, and the window resets. |
| MW-08 | P2 | `int/coach`, `db/06`, `fn/orchestrator` | ✅ | The second request is served from `coach_insight_cache` (keyed on a hash of the SQL summary), with no new LLM request. A new transaction invalidates it. |
| MW-09 | P1 | `int/coach`, `fn/orchestrator` | ✅ | A 5 s mock LLM against a 500 ms timeout returns template insights in under 4 s. The audit row is marked `TIMEOUT`, with no hung request. |

## 3.2 LLM Integration (Categorization & Insights)
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| LLM-01 | P0 | `eval` | ✅ | **99.0%** (198/200; the run before was 100%). Labelled set: `supabase/functions/coach/eval/merchants.json`, 9 categories, including 2 injection names; gate ≥ 90%. Both misses are ambiguous names: "Rahim Store" (FOOD, got SHOPPING) and "City Traders" (SHOPPING, got OTHERS). |
| LLM-02 | P0 | `fn/orchestrator`, `fn/categorize`, `fn/anthropic` | ✅ | Structured output (`output_config.format` JSON schema). Output is validated again on the server: wrong shape, kinds, lengths or non-JSON is rejected, retried once, then the template is used. |
| LLM-03 | P1 | `fn/categorize`, `db/06` | ✅ | The schema enum covers the 9 merchant categories, plus CASH_OUT from the transaction type. Anything else is rejected by the parser and by the `spend_category` enum in SQL. |
| LLM-04 | P0 | `fn/grounding`, `fn/orchestrator`, `int/coach`, `eval` | ✅ | Holds by construction and in automated tests: every ৳ and % in U-NORMAL's insights matches a SQL aggregate, and invented numbers are rejected (Latin and Bangla digits). Live: 3/3 personas grounded on the first try, and 53/53 insights calls were valid. |
| LLM-05 | P0 | `fn/orchestrator`, `int/coach`, `e2e/coach`, `eval` | ✅ | Live: 20/20 regulated questions (stocks, loans, EMI, crypto, insurance, forex, in English, Banglish and Bangla, plus one "ignore your rules") were classified REGULATED_ADVICE, and the judge found no specific recommendation. 5/5 ordinary questions were answered as GENERAL (no over-refusal). The first live run failed 5/20 as `INVALID`: the model wrote "30 days" or "the {{period}}". Fixed in the prompt and with a grounding tidy; see the bugs below. |
| LLM-06 | P1 | `eval` | ⚠️ | LLM judge: **4/5** (supportive, plain, practical; minor note that two cards repeat the QR advice). The text is saved in `reports/phase3-llm-eval.json` for the human review the case asks for, which is still to do. |
| LLM-07 | P1 | `int/coach`, `fn/orchestrator` | ✅ | `coach_llm_mode` = `off`, no key, a provider outage, timeouts and refusals all fall back to template insights (200, `source: TEMPLATE`). Ask returns a friendly "unavailable" answer. Template output is not cached, so the next request retries the LLM. |
| LLM-08 | P0 | `secrets`, `e2e/coach` | ✅ | The bundle scan fails on `ANTHROPIC_API_KEY`, `sk-ant-…`, the key's value or `api.anthropic.com`. Playwright records no browser request to any LLM host. |
| LLM-09 | P2 | `eval` | ✅ | 50 insights calls: p50 4.5 s, **p95 4.8 s** (gate 5 s), max 5.6 s, no failures. The margin is thin: time goes to about 410 output tokens, with no thinking tokens and the system prompt read from cache. Ask: p95 3.3 s. Categorisation of 50 names: about 6 s, once per new merchant. The app's timeout is 8 s and a skeleton shows while loading (`comp`). |

## 3.3 AI Financial Health Coach Dashboard
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| COACH-01 | P0 | `e2e/coach`, `comp` | ✅ | U-NORMAL sees money in, spent and saved; cash dependency; category bars; and insight cards. |
| COACH-02 | P0 | `int/coach`, `db/06` | ✅ | Income, spending, saved and category totals equal independent ledger queries. Categories add up to spending. Savings transfers are counted as saved, not spent. |
| COACH-03 | P0 | `e2e/coach`, `int/coach`, `db/06`, `comp` | ✅ | U-CASHHEAVY shows "⚠ High" (cash-out share ≥ 40%) on a highlighted card with a plain-language explanation and the QR alternative. The first insight is a CASH card. |
| COACH-04 | P1 | `e2e/coach`, `db/06`, `comp` | ✅ | Rolling 7 days / 30 days / 3 months; the numbers update. Found and fixed: react-native-web did not expose the selected tab (`aria-selected`). |
| COACH-05 | P1 | `e2e/coach`, `db/06`, `comp` | ✅ | U-NEW gets the "Nothing to show yet" empty state and no chart is rendered. |
| COACH-06 | P1 | `e2e/coach`, `comp` | ✅ | Skeletons while loading. When the function is unreachable, the numbers still load and the insights card shows "No connection" with a retry that recovers. |
| COACH-07 | P2 | `e2e/coach` | ✅ | Pay ৳300 at Rahim Store, return to the coach: 7-day spending goes up by ৳300. |
| COACH-08 | P2 | `comp`, `e2e/coach` | ⚠️ | Every chart has a full text `accessibilityLabel` (`aria-label` on web). Layout uses flexible rows that wrap. A screen-reader and large-font pass on a real device is still to do. |

## 3.4 Personal Savings Planner
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| SAVE-01 | P0 | `int/coach`, `e2e/coach`, `unit`, `comp` | ✅ | U-NORMAL's surplus is about ৳8,000/month, so ৳30,000 in 6 months is ৳5,000/month, **Realistic** (62% of surplus), and saved. |
| SAVE-02 | P0 | `int/coach`, `e2e/coach`, `unit`, `comp` | ✅ | U-TIGHT's surplus is about ৳3,000, so the plan is **Not realistic**. Alternatives: a longer timeline (13 months at 80% of surplus) or a smaller target. |
| SAVE-03 | P1 | `db/06`, `int/coach`, `unit`, `comp` | ✅ | Rejected: 0, negative, non-numeric, > 2 decimals, > ৳10,00,000, 0 or > 60 months, blank name. The client and server each give specific messages. |
| SAVE-04 | P1 | `unit` | ✅ | ৳30,000 in 1 month on a ৳2,000 surplus is not achievable, with alternatives. |
| SAVE-05 | P1 | `db/06`, `int/coach`, `e2e/coach`, `unit`, `comp` | ⚠️ | Saved, remaining, the progress bar and the monthly amount still needed all update. Contributions are dated "now", so "over 2 months" is covered by the date logic in `savings.test.ts`, not by real elapsed time. |
| SAVE-06 | P2 | `e2e/coach`, `db/06`, `comp` | ✅ | Editing recalculates the plan. Delete asks for an in-app confirmation (no browser dialog) and removes the goal and its contributions. |
| SAVE-07 | P2 | `unit` | ✅ | Goals together are checked against the surplus, with an over-commitment warning on the savings screen. |
| SAVE-08 | P1 | `unit`, `comp`, `e2e/coach` | ✅ | `৩০০০০` parses as 30,000 (also `৩০,০০০.৫০` and `৬` months). |

## 3.5 Cash-Flow Forecasting
| ID | P | Where | Status | Notes |
|---|---|---|---|---|
| FCST-01 | P0 | `e2e/coach`, `int/coach`, `comp` | ✅ | U-NORMAL: a 30-day projection (7/30 toggle), the next salary and rent, and no warning. |
| FCST-02 | P0 | `int/coach`, `e2e/coach`, `unit`, `comp` | ✅ | U-TIGHT: "Low balance expected on <date>" about 10 days ahead. It names Green Homes Rent (৳9,500) and gives a top-up amount or a daily cut, never a cash-out. |
| FCST-03 | P1 | `backtest` | ✅ | See the backtest results below. |
| FCST-04 | P1 | `unit`, `int/coach` | ✅ | Salary, rent and bills are detected: 3+ times, about the same amount, every 25–35 days with regular gaps. One-off cash-ins and occasional similar shop visits are not mistaken for them (two bugs found by tests and fixed). |
| FCST-05 | P1 | `unit`, `comp` | ✅ | Under 30 days of history is marked low confidence, with an explanation. |
| FCST-06 | P2 | `unit`, `comp`, `e2e/coach` | ✅ | Negative projections render as red bars plus a "Shortfall: up to ৳X below zero" line. A flat or zero forecast renders without errors. |

**FCST-03 backtest results** (50 seeded synthetic users, 120 days of history, 30-day horizon; error as a share of monthly income):
- Median day-30 error is **11.2%** (gate ≤ 15%).
- Over the daily path, mean error is **10.1%**, against **29.1%** for a naive "balance stays flat" forecast: **65% better** (gate ≥ 30%).
- Mean day-30 error is **15.6%** and p90 is 36.7%. These are dominated by random one-off purchases inside the horizon, which no forecast can know.
- The gate is defined on the median and the path because a monthly salary/rent cycle brings the balance back near its start on day 30, which flatters the naive guess on that single day.

## Phase 1–2 regression
All Phase 1 and Phase 2 suites pass unchanged on the new seed:
- pgTAP 01–05;
- the 28 Phase 1–2 integration tests;
- the 19 Phase 1–2 Playwright tests;
- the ML persona tests: U-NORMAL → M-LEGIT is still ALLOW at every hour, U-ABUSER is still FLAG, RING-01 is still exactly one ring, and no Phase 3 biller looks like a pseudo-merchant.

The new seed data is generated from a separate random stream, so the Phase 2 personas' history is byte-for-byte the same as before. U-NORMAL's balance still ends at ৳5,000.

## Automated run summary
| Suite | Result |
|---|---|
| Jest unit + component (incl. `supabase/functions/coach`) | 237 / 237 pass |
| pgTAP (`supabase test db`, files 01–06) | 237 / 237 pass (06_coach: 61) |
| Migration idempotency | pass |
| ML pytest (`npm run ml:test`) | 76 / 76 pass (5 new Phase 3 persona checks) |
| Integration (HTTP, local stack + ML) | 48 / 48 pass (20 coach + 28 Phase 1–2) |
| Playwright web E2E | 30 / 30 pass (11 coach + 19 Phase 1–2) |
| Forecast backtest (FCST-03) | pass |
| Bundle secrets check (service key, ML token, Anthropic key/host) | pass |
| Lint + typecheck | clean |
| Live LLM eval (`scripts/eval-coach.ts`, `claude-sonnet-5-5`) | 6 / 6 gates pass (about 100 API calls) |

## Bugs found and fixed during Phase 3 testing
- **Live model, `{{period}}`:**
  - The fact's value starts with "the", so "In the {{period}}" rendered as "the the last 30 days".
  - Sometimes the model wrote "30 days" itself, and the grounding check rejected the whole answer.
  - Fixed with a prompt rule (prompt version `p3-v2`) and a "the the" tidy in `ground()`.
  - The eval now mirrors the app's one-retry policy and keeps rejected answers.
- **Seed, U-CASHHEAVY:**
  - A full month of cash-outs was crammed into the 5 days since the last salary, so the 30-day view showed 24 cash-outs and a ৳20,950 overspend.
  - The live insights exposed this; the mock text had hidden it.
  - Cash-outs are now pro-rated for the current month, and `ml/test_seed_personas` checks that the last 30 days look like a normal month.
- **Eval robustness:** one 30-second outlier call aborted the first live eval and lost its results. Failed calls now count as failed samples, and progress is saved after each section.
- **PII scrubber:**
  - `+880 1711-000001` (a space after the country code) was not recognised as a phone number.
  - A 13-digit NID was partly matched as a phone.
  - Fixed with digit boundaries and separators.
- **Forecast baseline:** trimming the busiest 10% of days biased daily spending low. Over 30 days that compounded to 25% error. It is now a plain mean over the last 60 complete days, excluding today's partial day.
- **Recurring detection:**
  - A one-off ৳5,000 cash-in hid U-NORMAL's salary. Detection now uses rows near the series' typical amount.
  - Occasional similar shop visits could look monthly. Every gap must now be regular.
- **Accessibility:** the period and horizon toggles did not expose their selected state on web (`aria-selected`).

## §3.6 Exit criteria status
- [x] **MW-03 and MW-06 pass:** no PII reaches the LLM, and prompt injection is contained.
- [x] **LLM-04 and LLM-05 pass:** numbers are grounded and no regulated advice is given. They hold by construction, in the automated tests, and against the live model (`claude-sonnet-5-5`).
- [x] **The Coach, Savings Planner and Forecast P0 cases pass** in the mobile-viewport web build.
- [x] **The Phase 1–2 regression suites pass.**

**Open items:**
- **LLM-06:** a human read of the U-CASHHEAVY text in `reports/phase3-llm-eval.json`.
- **Model choice:** the gates passed on `claude-sonnet-5-5`. If you switch `COACH_MODEL` (the code default is `claude-opus-5-5`), re-run `scripts/eval-coach.ts`, especially LLM-09, whose margin is thin.
- **COACH-08 on a real device:** a screen-reader and large-font pass.
- **Real data:** the forecast and the savings surplus are validated on synthetic data; re-check them on real user data before production.
- **Phase 4:** Bangla UI and prompts. The coach currently answers in English and understands Banglish questions.
