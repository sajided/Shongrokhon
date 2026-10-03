# Phase 4 Testing: Active Interventions & Polish

How to run the Phase 4 tests. Results are in `docs/phase4-test-matrix.md`; test IDs refer to `testcase.md` §4–5. The security review is in `docs/security-review.md`.

## 1. One-time setup
1. Do the Phase 3 setup first (`docs/phase3-testing.md`).
2. Run `npm install` once more after pulling. Its `postinstall` copies the QR decoder's WebAssembly into `public/zxing/`; without it, uploading a QR image fails under the CSP.
3. Install the admin app's dependencies:
   ```bash
   npm_config_cache=/tmp/npm-cache npm --prefix admin install
   ```
4. Install WebKit for the iPhone device profile:
   ```bash
   npx playwright install webkit
   ```
5. Restart the stack once after pulling Phase 4 (`npm run ml:down && supabase stop`, then start again). This picks up the `investigate` function and rebuilds the ML image with `/explain` (`npm run ml:up`).

## 2. Accounts
| Who | Sign in | Notes |
|---|---|---|
| Customers | phone + OTP `123456`, PIN `12345` (see CLAUDE.md) | U-CASHHEAVY `01611000001` is intercepted on cash-out |
| Analyst | `analyst@shongrokhon.test` / `analyst-pass-123` in the admin app | Seeded for local use only. Create real staff with `scripts/create-analyst.ts`. |
| Agents | `AGENT001` "Rahman Agent Point", `AGENT002` "Shapla Telecom Agent" | Cash-out points |
| Billers | Titas Gas `MGAS0001`, Link3 `MNET0001`, Dhaka WASA `MWATER001`, GP `MMOBILE01`, Green Homes Rent `MRENT0001`, DESCO `MUTIL0001` | Listed under "Pay a bill" |

## 3. Automated tests
Run integration, E2E and perf one after another: they share and reset the database.
```bash
npm run lint && npm run typecheck && npm test   # includes i18n coverage + the hard-coded-text scan
npm --prefix admin test && npm --prefix admin run typecheck
npm run test:db                                 # pgTAP 01-10 + migration idempotency
npm run ml:test                                 # includes /explain (SHAP) and label export
npm run test:integration                        # includes phase4 + authz-sweep
npm run test:e2e                                # projects: chromium-mobile, admin, android-low-end, iphone
npm run check:i18n && npm run check:secrets     # secrets: app + admin bundles
npx tsx scripts/perf/payments.ts --sequential 1000                # PERF-01
npx tsx scripts/perf/payments.ts --concurrency 50 --duration 180  # PERF-02 (scaled) + PERF-03
supabase db reset                               # perf leaves synthetic payers behind
```

**Live LLM checks.** These cost real money, about 30 short requests each:
```bash
set -a; . supabase/functions/.env; set +a
npx tsx scripts/eval-phase4.ts     # L10N-06/07/08, INV-05 -> reports/phase4-llm-eval.json
npx tsx scripts/eval-coach.ts      # Phase 3 gates, re-run after prompt changes
```

## 4. Manual walkthrough
1. **Companion (SSC):** sign in as U-CASHHEAVY and go to **Cash out**.
   - Enter `AGENT001` and ৳1,000, then tap **Continue**. The interception shows "your 9th cash-out…", the ৳18.50 fee, and three alternatives.
   - Choose **Pay a bill** and pay Titas Gas. Nothing was cashed out.
   - The interception appears at most twice a day. **Settings → Coaching nudges** turns it off.
2. **Send money:** use **Send money** to `01911000002` (U-NEW). The recipient appears only as "New ·········0002".
3. **Forecast to bill (E2E-04):** as U-TIGHT, go to **AI coach → Cash-flow forecast**. The warning offers **Pay Green Homes Rent now**.
4. **Bangla (L10N):** go to **Settings → বাংলা**.
   - Every screen switches immediately: balance `৳৫,০০০.০০`, Bangla dates, a Bangla coach, Bangla errors.
   - The font check shows conjuncts (ক্ষ ঞ্জ ন্ত্র স্ক্র).
   - Ask the coach "amar khoroch komabo kivabe?".
5. **Investigation Assistant:** run `npm --prefix admin run dev` and open http://localhost:8766.
   - Sign in as the analyst.
   - Make U-ABUSER pay M-PSEUDO ৳10,000 (Phase 2 walkthrough). The alert appears with SHAP bars and an evidence summary. Mark it **Confirmed abuse** with a note, and check the audit log.
   - For a ring alert, run `npm run ml:network` and open the RING alert to see the graph.
6. **Delete account:** go to **Settings → Delete my account** (the balance must be ৳0).

## 5. Still manual or pending
- **L10N-06:** native-speaker review of the Bangla coach text (`reports/phase4-llm-eval.json` → `l10n06.*.bangla`). It needs a ≥ 4/5 rating and sign-off.
- **E2E-06 on real devices:** run E2E-01 on a 2 GB Android, a mid-range Android and a recent iPhone. Playwright emulates these; it does not replace a device run.
- **PERF-02 at full scale:** 500 payers for 15 minutes needs production-like hardware. The local run is scaled to 50 × 3 minutes.
- **SEC-01:** verify TLS and the security headers on the deployed host (`docs/security-review.md`).
- **MET-03:** the A/B or pre/post comparison needs real users. The query is `private.metrics_cashouts_by_engagement`.
- **PERF-05:** a memory profile on a real low-end phone.
