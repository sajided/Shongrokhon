#!/usr/bin/env bash
# TC-P1-SETUP-05: build the production JS bundles and make sure no server-side
# secret ended up in them. Only the anon/publishable key may be present.
set -euo pipefail
cd "$(dirname "$0")/.."

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

# Public env must never hold a server key.
if [ -f .env ] && grep -qE '^EXPO_PUBLIC_[A-Z_]*=.*(sb_secret_|service_role)' .env; then
  echo "FAIL: .env exposes a secret key through an EXPO_PUBLIC_ variable"
  exit 1
fi

# --clear: Metro caches transforms, including inlined EXPO_PUBLIC_ values.
npx expo export --clear --platform web --output-dir "$out" >/dev/null

fail=0
check() {
  local label="$1" pattern="$2"
  if grep -rqaE "$pattern" "$out"; then
    echo "FAIL: $label found in bundle"
    fail=1
  fi
}

# Names that must never be bundled.
check "service-role variable name" 'SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY'
# (A bare "sb_secret_" prefix appears in supabase-js itself, so match real values below.)

# The actual local service-role / secret keys, when a local stack is running.
if status="$(supabase status -o env 2>/dev/null)"; then
  for var in SERVICE_ROLE_KEY SECRET_KEY; do
    value="$(printf '%s\n' "$status" | sed -n "s/^${var}=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p")"
    [ -n "$value" ] && check "$var value" "$(printf '%s' "$value" | sed 's/[.[\*^$()+?{|]/\\&/g')"
  done
fi

# Phase 2: the ML service token and internal URL are server-side only.
check "ML service variable name" 'ML_SERVICE_TOKEN'
if [ -f supabase/functions/.env ]; then
  token="$(sed -n 's/^ML_SERVICE_TOKEN=//p' supabase/functions/.env)"
  [ -n "$token" ] && check "ML_SERVICE_TOKEN value" "$(printf '%s' "$token" | sed 's/[.[\*^$()+?{|]/\\&/g')"
fi
check "internal ML URL" 'shongrokhon-ml:8000'

# Phase 3 (TC-P3-LLM-08): the LLM key stays in the coach Edge Function; the
# app never calls an LLM API directly.
check "LLM key variable name" 'ANTHROPIC_API_KEY'
check "Anthropic API key" 'sk-ant-[A-Za-z0-9_-]{10,}'
check "LLM API host" 'api\.anthropic\.com'
if [ -f supabase/functions/.env ]; then
  key="$(sed -n 's/^ANTHROPIC_API_KEY=//p' supabase/functions/.env)"
  [ -n "$key" ] && check "ANTHROPIC_API_KEY value" "$(printf '%s' "$key" | sed 's/[.[\*^$()+?{|]/\\&/g')"
fi

# Any JWT in the bundle must carry role=anon.
while IFS= read -r jwt; do
  payload="$(printf '%s' "$jwt" | cut -d. -f2 | tr '_-' '/+')"
  while [ $(( ${#payload} % 4 )) -ne 0 ]; do payload="${payload}="; done
  role="$(printf '%s' "$payload" | base64 -d 2>/dev/null | sed -n 's/.*"role":"\([^"]*\)".*/\1/p')"
  if [ "$role" != "anon" ]; then
    echo "FAIL: bundled JWT with role '${role:-unknown}'"
    fail=1
  fi
done < <(grep -rhaoE 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' "$out" | sort -u)

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "SETUP-05: no secrets in the bundle (only the anon key)"
