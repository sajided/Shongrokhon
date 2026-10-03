# Security Review: Release Gate (Phase 4, testcase.md §4.6)

**Scope:**
- the customer web app (`src/`);
- the analyst web app (`admin/`);
- Supabase (migrations, RPCs, RLS, Edge Functions);
- the ML service (`ml/`).

**Review date:** 2026-10-03. The method was the OWASP Mobile Top 10 (2024) and the OWASP ASVS checks that apply to a web app, plus automated scans.

## Summary
| Case | Result |
|---|---|
| SEC-01 Transport security | ⚠️ A strict CSP is in place; TLS can only be verified once deployed (the local stack is plain HTTP) |
| SEC-02 OWASP review and scans | ✅ No open high or critical finding in shipped code; the dependency findings are triaged below |
| SEC-03 API authorisation sweep | ✅ Automated (`tests/integration/authz-sweep.test.ts`) |
| SEC-04 Rooted device | N/A: a web app cannot detect root; mitigations below |
| SEC-05 Data deletion | ✅ `delete_my_account` (pgTAP `10_release`, integration, E2E) |
| SEC-06 Screenshot protection | N/A: no `FLAG_SECURE` on the web; mitigations below |

## SEC-01: transport
- **Both apps ship a strict Content-Security-Policy** (`public/index.html` and `admin/index.html`). The session token lives in `localStorage`, so the policy allows:
  - scripts from this origin only;
  - connections only to the Supabase API (the local stack, or `*.supabase.co`) and the dev server's WebSocket;
  - no plugins, no `<base>` override, no form posts.

  This closes the CLAUDE.md open item "add a strict CSP".
- **The QR decoder is self-hosted.** expo-camera's web decoder (zxing-wasm) would otherwise download its WebAssembly from the jsDelivr CDN at runtime: a third-party code dependency on the payment path.
  - The file is copied into `public/zxing/` on install (`scripts/copy-zxing.mjs`) and served from this origin (`src/lib/qr/decoder.ts`).
  - The app's CSP adds `'wasm-unsafe-eval'` so it can compile. That permits WebAssembly compilation only, not `eval()` of scripts.
- **The deployment must also send these headers** (a `<meta>` CSP cannot carry `frame-ancestors`):
  - `Content-Security-Policy` (the same policy plus `frame-ancestors 'none'`)
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
- **TLS:** hosted Supabase and any static host (Vercel, Netlify, Cloudflare Pages) serve TLS 1.2+ only. Verify with an intercepting proxy after the first deployment. Status stays 🟡 until then.
- **Certificate pinning** is not possible for a browser app. HSTS preload is the web equivalent.

## SEC-02: OWASP Mobile Top 10, mapped to this web app
| Risk | What protects it | Evidence |
|---|---|---|
| M1 Improper credential usage | No secrets in either bundle: service-role key, ML token, Anthropic key and host. OTP lockout. Bcrypt PIN hashes. Staff accounts only via the service role (public email sign-up refused in SQL). | `npm run check:secrets` (both apps), `authz-sweep` (sign-up refused), pgTAP 03 |
| M2 Supply chain | Locked dependencies; audits below | `npm audit`, `pip-audit` |
| M3 Authentication/authorisation | Every RPC: `require_session()` first, revoke-then-grant, role checks in SQL. Edge Functions verify the JWT (`getClaims`) and act only as the caller. | `authz-sweep` enumerates every callable function from `pg_catalog`; pgTAP 02, 06–10 |
| M4 Input/output validation | Typed RPC arguments, amount/PIN/phone validation on client and server, schema-validated ML requests (422 without echoing input), LLM output schema plus grounding checks, prompt-injection containment | pgTAP, Jest (`sanitize`, `grounding`), MW-06, INV-05 |
| M5 Insecure communication | CSP; HTTPS when deployed (SEC-01) | — |
| M6 Privacy | PII never reaches the LLM. Notes and counterparties encrypted at rest. Analytics keyed by HMAC with allowlisted values. Masked numbers for analysts and recipients. Account deletion. | MW-03, pgTAP 10, MET-05 |
| M7 Binary protections | N/A for the web; production bundles are minified | — |
| M8 Security misconfiguration | RLS on every table; clients write no table; `private` schema not exposed; metric views private | pgTAP 02, `authz-sweep` |
| M9 Insecure data storage | Only the Supabase session (`localStorage`) and the language choice are stored client-side; no PIN or OTP is ever stored | Code review |
| M10 Insufficient cryptography | pgcrypto with a Vault key for field encryption; bcrypt for PINs; HMAC-SHA256 for analytics | Migrations 03, 07 (analytics) |

## Dependency audit (2026-10-03)
- **`admin/`:** `npm audit` reports 0 vulnerabilities.
- **ML service:** `pip-audit` flagged `starlette 0.41.3` (pulled in by FastAPI 0.115.6) with several advisories, and `pytest 8.3.4` (test-only).
  - **Fixed:** upgraded FastAPI so Starlette is ≥ 1.3.1, and pytest to ≥ 9.0.3. See "Fixes made" below.
- **Customer app:** `npm audit` reports 61 advisories (10 moderate, 51 high, 0 critical). All are transitive through the Expo / React Native / Metro / Jest toolchain (`micromatch`/`braces` ReDoS, `node-forge` in `@expo/code-signing-certificates`, and so on).
  - **Shipped bundle:** none of these packages is in it. A scan of `dist/` for them finds nothing; they run only at build or test time, on developer and CI machines with trusted input.
  - **The fix** is an Expo SDK upgrade (`npm audit fix --force` would replace Expo). **Accepted for this release**, tracked as a follow-up: upgrade Expo when the next SDK is adopted, and re-run `npm audit`.

## SEC-03: authorisation sweep
- The test enumerates every `public` function `authenticated` may execute. It calls each one as another user with the victim's user id, wallet id, phone and goal id, and asserts none of the victim's data comes back.
- The callable set is **pinned to a reviewed list**, so any new grant fails CI until it is reviewed.
- Also checked: service-only functions are refused, and the Edge Functions return 401 without a token and 403 for someone else's data.
- Customers are refused by `investigate` and the analyst RPCs.

## SEC-04 / SEC-06: not applicable to a web app
- A browser cannot detect a rooted device or block screenshots (`FLAG_SECURE` is Android-native). Mitigations in place:
  - PIN fields are masked (`secureTextEntry`);
  - the PIN never leaves the server once set, and is never shown;
  - sessions can be revoked server-side (TC-P1-AUTH-10).
- If native apps are built later, add root/jailbreak checks and `FLAG_SECURE` there.

## SEC-05: data deletion
- `delete_my_account(pin)`:
  - requires the PIN and a ৳0 balance, so no money is stranded;
  - deletes goals, coach cache, nudges, rate limits, notifications and analytics;
  - unlinks LLM audit rows (their payloads hold no PII);
  - anonymises the profile (phone, name, PIN);
  - freezes the wallet;
  - deletes sessions and identities, and bans the auth user.
- **Ledger and transactions are kept**, as financial regulation requires. Their counterparty fields hold only names or masked numbers, encrypted.

## Fixes made during this review
- **Email accounts:**
  - Public email sign-up was possible (the CLI's email provider must stay on for staff logins). It is now refused in `private.handle_new_auth_user`: only phone customers, or staff created with the service role.
  - Staff accounts get no customer wallet.
- **ML web stack:** upgraded off the vulnerable Starlette.
- **CSP:** added to both apps. The QR decoder's WebAssembly is now served from the app's own origin instead of a CDN.
- **Payments under load:** a server error without a business code (e.g. a function worker shut down mid-request) is now treated like a lost connection. The app checks the payment's status and retries with the same idempotency key, instead of showing a generic error while the outcome is unknown (`src/lib/payment-flow.ts`).
