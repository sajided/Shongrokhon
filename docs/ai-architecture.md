# AI coach and investigation assistant: architecture

How the Claude-based features are built so that the language model never decides a number, never sees personal data, and can fail without taking the feature down. Every figure in this document comes from a committed report (`reports/phase3-llm-eval.json`, `reports/phase4-llm-eval.json`, `reports/phase3-forecast.json`) or from code paths named inline.

**In one sentence:** SQL computes every fact, deterministic TypeScript decides what the user is allowed to see, the LLM only chooses words around `{{placeholders}}`, and a validator rejects anything else before it reaches a screen.

## 1. Request path

```
 app ──► coach Edge Function (Deno)
          │
          ├─ 1. auth: getClaims() → 401 / 403, rate limit (coach_rate_hit, 10/min)
          ├─ 2. facts: coach_context RPC → private.coach_summary(user, period, p_names => false)
          │        income, spending, saved, net, cash-out share/level, category totals,
          │        top merchants as "Merchant A…H", monthly series, data_hash
          ├─ 3. short-circuits: < coach_min_txns → INSUFFICIENT_DATA (no LLM call)
          │                     data_hash unchanged → cached cards (no LLM call)
          ├─ 4. LLM (Anthropic Messages API, JSON-schema output, prompt cached)
          │        input:  InsightsInput = {period, cashLevel, categories, merchant labels, facts keys}
          │        output: 1–4 cards whose bodies contain only {{placeholders}}
          ├─ 5. validate: schema → length → grounding (no raw digit, no unknown key)
          │        fail → retry once (INVALID only) → fillTemplate (deterministic EN/BN cards)
          ├─ 6. fill: grounding.ground() substitutes the SQL values, formats ৳ and %, Bangla digits
          └─ 7. audit: log_coach_request (prompt_version, model, latency, outcome) → coach_llm_requests
```

The same skeleton serves **ask** (free-text questions), **categorise** (merchant → category) and the analyst-facing **investigate** function.

| Component | Where | Role |
|---|---|---|
| Facts | `supabase/migrations/20261003000001_coach.sql` (`private.coach_summary`, `coach_context`) | The only source of numbers. |
| Orchestrator | `supabase/functions/coach/orchestrator.ts` | Rate limit, cache, retries, fallback, audit. |
| Prompts | `supabase/functions/coach/prompts.ts` (`PROMPT_VERSION`) | Frozen per language, byte-stable for prompt caching. |
| Grounding | `supabase/functions/_shared/llm/grounding.ts` | Rejects raw digits and unknown placeholders; fills values. |
| PII scrubbing | `supabase/functions/_shared/llm/sanitize.ts` | Strips emails, UUIDs, Bangladeshi phone numbers, long digit runs, tags and braces. |
| Template fallback | `supabase/functions/coach/template.ts` | Deterministic cards in English and Bangla when the LLM fails. |
| Provider | `supabase/functions/_shared/llm/anthropic.ts`, `provider.ts` | Thin adapter; a `MockProvider` for tests. |
| Audit | `coach_llm_requests` table | Every attempt, with prompt version, model, latency, outcome. |

## 2. Numbers are computed, never generated

The model is not allowed to write a number. Its system prompt says so (`NUMBERS_RULE`), but the guarantee comes from the validator, not the prompt:

1. `private.coach_summary` returns the facts and a `data_hash`. The Edge Function turns them into a flat map of **placeholder keys** such as `income`, `cat.FOOD.total`, `merchant.A.share`, `cashout.count`.
2. The LLM receives the list of keys, the category names, and three booleans. It receives no amounts.
3. The output text is scanned by `ground()`:
   * any `{{key}}` not in the fact map → `UNKNOWN_PLACEHOLDER`, card rejected;
   * any Latin or Bangla digit left after placeholders are removed → `RAW_NUMBER`, card rejected.
4. Only then are the SQL values substituted, with locale formatting (`৳12,500`, `৩০%`).

The deterministic template cards go through the same check, so the fallback cannot regress either. The live evaluation (TC-P3-LLM-04) checks that every generated insight passes grounding on the first attempt for all three personas; the Bangla run (L10N-08) checks that English and Bangla cards cite identical SQL figures.

For **questions**, the user's own numbers are the one exception: `numbersIn(question)` extracts digits the user typed, and the answer may repeat those and nothing else.

## 3. The model never sees personal data

| Call | What the LLM sees | What it never sees |
|---|---|---|
| Insights | Category names, `Merchant A…H` labels, cash-out level, placeholder keys | Amounts, merchant names, phone, wallet id, transaction notes |
| Ask | The question after `scrubPII()` (max 300 chars), the same facts map | Emails, UUIDs, phone numbers, NID/account numbers (replaced by `[email]`, `[id]`, `[phone]`, `[number]`) |
| Categorise | Scrubbed merchant names under refs `m1`, `m2`, … | Who paid them, how much, when |
| Investigate | Alert kind, decision, SHAP driver labels, placeholder keys | Payer and merchant identities (they are "the payer" and "the merchant") |

`coach_summary` is called with `p_names => false` for everything that reaches the LLM. The user's own dashboard (`get_coach_dashboard`) uses `p_names => true`, but that path has no LLM in it. Logs record event names and timings only.

Prompt injection is tested, not assumed: the seeded merchant `M-INJECT` has instructions in its name; the categoriser must classify it as `OTHERS` and the insight prompt treats tagged data as data (TC-P3-MW-06, TC-P4-INV-05).

## 4. Failure never reaches the user as an error

| Failure | Handling |
|---|---|
| LLM slower than `coach_llm_timeout_ms` (8 s) | `Promise.race` against an `AbortController`; template cards |
| Output fails schema or grounding | One retry; then template cards (`source: 'TEMPLATE'`, not cached) |
| Refusal or truncated output | Mapped to an error, no retry; template cards |
| No API key or `coach_llm_mode = off` | Template cards for insights; `UNAVAILABLE` for questions |
| Categoriser returns an unknown ref or category | Keyword rules (`RULES`), never overwrite an LLM category with a rule one |
| Rate limit exceeded | `RATE_LIMITED` before any LLM call |

`coach_llm_mode` has three values: `live`, `mock` (deterministic provider used by the integration and E2E suites) and `off`. Every attempt, including failures, is written to `coach_llm_requests`.

## 5. Deterministic analytics (no LLM at all)

Two user-facing features are pure functions with their own backtests:

**Cash-flow forecast** (`src/lib/forecast.ts`)
* Recurring items: group by direction and counterparty; keep rows within 25 % of the group median; need ≥ 3 occurrences, a median gap of 25–35 days with every gap within ±5 days, and an amount coefficient of variation ≤ 0.25.
* Baseline: mean non-recurring outflow per day over the last 60 complete days.
* Projection: balance minus the baseline each day, plus or minus each recurring item on its due dates, 30 days ahead; first day below `forecast_low_balance` (৳500) raises a warning with the cause, a top-up amount and a daily cut.
* Backtest (`scripts/backtest-forecast.ts`, `reports/phase3-forecast.json`): 50 seeded users, 120 days of history, 30-day horizon.

| Metric | Value | Gate |
|---|---|---|
| Median day-30 error (share of monthly income) | 11.2 % | ≤ 15 % |
| Mean / p90 day-30 error | 15.6 % / 36.7 % | |
| Path error vs naive "balance stays flat" | 65 % better | ≥ 30 % |
| Users whose recurring items were detected | 96 % | |

**Savings planner** (`src/lib/savings.ts`): monthly need = ⌈target / months⌉ compared with the 90-day surplus from `private.monthly_surplus`; ≤ 80 % of surplus is ACHIEVABLE, ≤ 100 % TIGHT, otherwise UNREALISTIC with a suggested longer horizon or smaller target. Goals are records; no money moves.

## 6. Investigation assistant (analysts)

The analyst app (`admin/`) explains a flagged payment or a ring from evidence, not from the model's imagination:

1. `analyst_get_alert` (SQL, requires the analyst role) returns the alert, the stored risk score and its features.
2. If the score came from the ML model, `/explain` returns exact TreeSHAP contributions (`booster.predict(pred_contribs=True)`), refused with 409 if the model version changed since scoring.
3. `evidence.ts` keeps the six strongest drivers, labels them in plain language (`FEATURE_LABELS`), and turns values into placeholder facts (`f1.label`, `f1.value`, `f1.impact`, `ring.payers`, …).
4. The LLM writes a headline (≤ 140 chars) and 1–6 points using those placeholders only; `validateSummary` applies the same grounding check; `templateSummary` is the fallback; the result is cached per alert.

The evaluation (TC-P4-INV-05) checks that summaries for a flagged payment and for a ring are grounded, name the same drivers as SHAP, and invent nothing (LLM-judge score 95/100 for both).

## 7. Measured behaviour

Live runs against the Anthropic API, same adapter, prompts and validators as production. Both recorded runs used `claude-sonnet-5-5`; the code default is `claude-opus-5-5`. Re-run with `npx tsx scripts/eval-coach.ts` and `npx tsx scripts/eval-phase4.ts`.

| Test | What it measures | Result | Gate |
|---|---|---|---|
| LLM-01 | Merchant categorisation on 200 labelled names | 99 % | ≥ 90 % |
| LLM-04 | Insights pass grounding, 3 personas | 3/3, first attempt | 100 % |
| LLM-05 | Regulated-advice questions declined without product recommendations; ordinary questions answered | 20/20 declined, 5/5 answered | all |
| LLM-06 | Tone for a cash-heavy user (LLM judge) | 4/5 | ≥ 4 |
| LLM-09 | Insights latency, 50 runs | p50 4.5 s, p95 4.8 s | p95 ≤ 5 s |
| L10N-06 | Bangla insights grounded, in Bangla script, judged natural | 4/5 per persona, 98–99 % Bangla script | ≥ 4 |
| L10N-07 | Banglish and Bangla questions answered in Bangla | 4/4 | all |
| L10N-08 | Bangla and English cite the same SQL figures | pass | all |
| INV-05 | Investigation summaries grounded and consistent with SHAP | 2/2, judge 95/100 | all |

Native-speaker sign-off of the Bangla output is still an open release item.

## 8. What the LLM contributes, and what it cannot do

It contributes wording, tone, a natural Bangla register, a sensible choice of which two to four facts matter this month, and merchant categorisation. It cannot state a number, name a product, see who the user is, or keep the feature from working when it is slow or wrong. The parts of the system that judges can hold to account, the risk model (see `docs/ml-model-card.md`), the forecast, the savings planner and the ledger, are deterministic and tested without it.
