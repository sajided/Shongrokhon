# Deploying to the hosted Supabase project

Project: `https://ljxabckmeelssiffahzy.supabase.co` (ref `ljxabckmeelssiffahzy`).

**Already done (2026-10-03):**

- Migrations up to `20261004000011` were pushed with `supabase db push --db-url …`.
- `otp`, `pay`, `coach` and `investigate` were deployed.
- The function secrets were set (`ML_URL` left out until the ML service is hosted).
- The first analyst was created.

The seed files were **not** run, so the project has no test users or balances.

The steps below need someone signed in to the account that owns the project. Run them from a clone of this repo.

## 1. Link the project

```bash
supabase login
supabase link --project-ref ljxabckmeelssiffahzy
supabase migration list        # every row should show the same version under Local and Remote
```

**Do not run `supabase config push`.** `supabase/config.toml` lists test phone numbers under
`[auth.sms.test_otp]`, and every one of them accepts the code `123456`. Pushing it would let anyone sign in to those accounts.

## 2. Deploy the Edge Functions

```bash
supabase functions deploy otp pay coach investigate --no-verify-jwt
```

`--no-verify-jwt` is required. Each function verifies the caller's token itself with `auth.getClaims()`. The gateway
can't verify the ES256 user tokens, so with its check on, every call fails.

## 3. Set the function secrets

```bash
supabase secrets set \
  ML_URL=https://<public ML service URL> \
  ML_SERVICE_TOKEN=<random token, same value the ML container uses> \
  ANTHROPIC_API_KEY=<key> \
  COACH_MODEL=claude-opus-5-5
supabase secrets list
```

- You don't need to set `SUPABASE_URL`, `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY`. Supabase gives them to
  every function automatically. If the project has disabled its legacy API keys, check that these values are still provided.
- `ML_URL` must be a URL the internet can reach. The one in `.env.example`, `http://shongrokhon-ml:8000`,
  only resolves on the local Docker network. Without a working ML service, `pay` waits for
  `app_config.ml_timeout_ms` (800 ms) on every payment, then lets the SQL fallback rules decide. Payments still
  work, but they are slower and use the rule-based score instead of the model. If `ML_URL` is not set at all, `pay`
  skips the ML call and uses the rules straight away (the current setup).
- If you don't want the coach to call the LLM yet, run
  `update public.app_config set coach_llm_mode = 'off';` in the SQL editor. The coach then shows template insights.

## 4. Customer sign-in

### Email codes (current setup, no SMS provider)

1. **Turn on the switch** in the SQL editor: `update public.app_config set email_sign_in = true;`
2. **Build the app for email** by adding `EXPO_PUBLIC_AUTH_METHOD=email` to the root `.env`, then rebuilding with `npx expo export --platform web --clear`.
3. **Make the emails contain the code.** In Authentication → Emails → Templates, edit **Magic Link** and **Confirm signup**. Both must contain `{{ .Token }}`, for example `Your Shongrokhon code is {{ .Token }}`. Supabase's default templates send a link instead, and the app has nowhere to use a link.
4. **Use 6-digit codes.** In Authentication → Sign In / Providers → Email, set **Email OTP Length** to 6. The app and the `otp` function accept only 6-digit codes.
5. **Set up email sending.** Supabase's built-in sender is for testing. It only delivers to members of the project's team, and it sends only a few emails per hour. Before inviting real customers, add your own SMTP service (Resend, Postmark, SES and so on) under Authentication → Emails → SMTP Settings.

How it works:

- An email customer gets a wallet like a phone customer. Their lowercased email is their identifier, so others send them money by typing their email (shown masked as `r***@example.com`).
- Staff emails are refused by the `otp` function. Staff sign in to the admin app with a password.
- Wrong codes count toward the same 5-attempt lockout as SMS codes.

### SMS codes (when a provider is ready)

Authentication → Sign In / Providers → Phone:

- Turn it on, choose the provider (Twilio, Vonage, MessageBird or Textlocal) and enter its credentials.
- Leave the test OTP list empty.
- Then set `EXPO_PUBLIC_AUTH_METHOD=phone` (or remove it) and rebuild.
- An app built for phone only shows the phone field, so customers who registered by email can't sign in after the switch. Moving them over (for example by adding a phone number to their account) still has to be built.

Either way, check Authentication → Rate Limits. The app limits OTP attempts itself (lockout after 5 wrong codes), but GoTrue's own `/auth/v1/verify` endpoint is protected only by the per-IP rate limit.

## 5. Create the first analyst

Use the service-role key from Project Settings → API Keys. Pass it on the command line only; never put it in `.env`.

```bash
SUPABASE_URL=https://ljxabckmeelssiffahzy.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
npx tsx scripts/create-analyst.ts analyst@yourcompany.com '<password, 12+ characters>'
```

## 6. Check it works

In SQL editor:

```sql
select name from vault.secrets;                 -- txn_field_key, analytics_user_key
select * from public.app_config;                -- one row with the default thresholds
```

Then build the web app against the project (`npx expo export --clear`), sign in with a real phone number, and
check that you receive the SMS code. The web CSP (`public/index.html`, `admin/index.html`) already allows
`https://*.supabase.co`.

## Later migrations

Anyone with the database connection string in `supabase/.env` as `SUPABASE_DB_URL` (gitignored) can apply new
migrations:

```bash
set -a; source supabase/.env; set +a
supabase db push --db-url "$SUPABASE_DB_URL" --dry-run   # review the list first
supabase db push --db-url "$SUPABASE_DB_URL"
```
