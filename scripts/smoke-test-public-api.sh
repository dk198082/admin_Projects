#!/usr/bin/env bash
# smoke-test-public-api.sh
#
# One-time (or repeatable) smoke test that confirms the production API is
# publicly reachable and auth behaves correctly.
#
# Usage:
#   bash scripts/smoke-test-public-api.sh                    # tests production URL
#   bash scripts/smoke-test-public-api.sh https://custom.url # tests a custom URL
#
# Prerequisites for the "allowed" test case:
#   Set SMOKE_API_KEY to a valid, non-revoked key before running.
#   Set SMOKE_ENTRA_OID to the entraObjectId of an active, permissioned user.
#   Set SMOKE_APP_NAME to the app that the key is scoped to (e.g. "Field Service Calendar").
#
# Exit code: 0 = all required tests passed, 1 = one or more failures.
#
# Required tests (always run):
#   1. GET /healthz           → 200 {"status":"ok"}   (JSON, no redirect)
#   2. GET /access-check      → 401, JSON body         (missing key)
#   3. GET /access-check + bad key → 401, JSON body    (invalid key)
#
# Optional test (only when SMOKE_API_KEY is set):
#   4. GET /access-check + valid key + valid user → 200 {"allowed":true,...}
#   5. GET /access-check + valid key + wrong app  → 403, JSON body

set -euo pipefail

BASE_URL="${1:-https://data-admin-suite.replit.app/api}"
FAILURES=0

pass() { printf '\033[32m  PASS\033[0m %s\n' "$1"; }
fail() { printf '\033[31m  FAIL\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '\033[34m  INFO\033[0m %s\n' "$1"; }

assert_json_status() {
  local label="$1" url="$2" expected_status="$3"
  shift 3
  local extra_args=("$@")

  local http_out
  http_out=$(curl -s -o /tmp/_smoke_body -w "%{http_code}\t%{content_type}" \
    -H "Accept: application/json" \
    "${extra_args[@]}" \
    "$url" 2>&1) || true

  local status ct body redirect_check
  status=$(echo "$http_out" | cut -f1)
  ct=$(echo "$http_out" | cut -f2)
  body=$(cat /tmp/_smoke_body 2>/dev/null || true)

  # Fail if we got an HTML redirect page (Replit auth gate)
  if echo "$body" | grep -qi "replshield\|replit.com/__repl\|<html"; then
    fail "$label — got HTML redirect (Replit auth gate still active). status=$status"
    return
  fi

  # Check status code
  if [ "$status" != "$expected_status" ]; then
    fail "$label — expected HTTP $expected_status, got $status. body=${body:0:200}"
    return
  fi

  # Confirm Content-Type is JSON
  if ! echo "$ct" | grep -qi "application/json"; then
    fail "$label — expected JSON Content-Type, got: $ct"
    return
  fi

  pass "$label (HTTP $status, JSON)"
  info "  body: ${body:0:300}"
}

echo ""
echo "========================================"
echo "  Data Admin Suite — API Smoke Test"
echo "  Target: $BASE_URL"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "========================================"
echo ""

# -------------------------------------------------------------------
# Test 1 — Health check
# -------------------------------------------------------------------
info "Test 1: GET /healthz — should return 200 {\"status\":\"ok\"}"
assert_json_status "healthz" "$BASE_URL/healthz" "200"

# Verify the body contains "ok"
body=$(cat /tmp/_smoke_body 2>/dev/null || true)
if ! echo "$body" | grep -q 'ok'; then
  fail "healthz body — expected {\"status\":\"ok\"}, got: $body"
fi

# -------------------------------------------------------------------
# Test 2 — access-check with no API key → 401
# -------------------------------------------------------------------
info "Test 2: GET /access-check (no key) — should return 401 JSON"
assert_json_status "access-check/no-key" \
  "$BASE_URL/access-check?entraObjectId=smoke-test-oid&app=SmokeApp" "401"

body=$(cat /tmp/_smoke_body 2>/dev/null || true)
if ! echo "$body" | grep -qi 'Missing API key'; then
  fail "access-check/no-key body — expected 'Missing API key' in error, got: $body"
fi

# -------------------------------------------------------------------
# Test 3 — access-check with wrong key → 401
# -------------------------------------------------------------------
info "Test 3: GET /access-check (wrong key) — should return 401 JSON"
assert_json_status "access-check/wrong-key" \
  "$BASE_URL/access-check?entraObjectId=smoke-test-oid&app=SmokeApp" "401" \
  -H "X-API-Key: invalid-smoke-test-key-$(date +%s)"

body=$(cat /tmp/_smoke_body 2>/dev/null || true)
if ! echo "$body" | grep -qi 'Invalid or revoked'; then
  fail "access-check/wrong-key body — expected 'Invalid or revoked' in error, got: $body"
fi

# -------------------------------------------------------------------
# Test 4 — access-check with valid key → 200 allowed:true  [optional]
# -------------------------------------------------------------------
if [ -n "${SMOKE_API_KEY:-}" ] && [ -n "${SMOKE_ENTRA_OID:-}" ] && [ -n "${SMOKE_APP_NAME:-}" ]; then
  info "Test 4: GET /access-check (valid key) — should return 200 {\"allowed\":true}"
  assert_json_status "access-check/valid-key" \
    "$BASE_URL/access-check?entraObjectId=${SMOKE_ENTRA_OID}&app=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$SMOKE_APP_NAME")" "200" \
    -H "X-API-Key: $SMOKE_API_KEY"

  body=$(cat /tmp/_smoke_body 2>/dev/null || true)
  if ! echo "$body" | grep -q '"allowed":true'; then
    fail "access-check/valid-key body — expected {\"allowed\":true}, got: $body"
  fi

  # -------------------------------------------------------------------
  # Test 5 — valid key but wrong app name → 403
  # -------------------------------------------------------------------
  info "Test 5: GET /access-check (valid key, wrong app) — should return 403"
  assert_json_status "access-check/wrong-app" \
    "$BASE_URL/access-check?entraObjectId=${SMOKE_ENTRA_OID}&app=NonExistentApp_$(date +%s)" "403" \
    -H "X-API-Key: $SMOKE_API_KEY"
else
  # When testing the default production URL, all five cases are required.
  # Treat missing credentials as an INCOMPLETE result, not a pass.
  if [ "${1:-}" = "" ] || echo "${BASE_URL}" | grep -q "replit\.app"; then
    fail "INCOMPLETE: SMOKE_API_KEY, SMOKE_ENTRA_OID, and SMOKE_APP_NAME must all be set to certify the production endpoint."
    fail "  Tests 4 & 5 (allowed:true and wrong-app 403) were not run."
  else
    info "Skipping Tests 4 & 5 (SMOKE_API_KEY / SMOKE_ENTRA_OID / SMOKE_APP_NAME not set)."
    info "  Acceptable for dev/staging; required for production certification."
  fi
fi

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
echo ""
echo "========================================"
if [ "$FAILURES" -eq 0 ]; then
  echo "  RESULT: ALL TESTS PASSED ✓"
  echo "  The API is publicly reachable and auth is behaving correctly."
else
  echo "  RESULT: $FAILURES TEST(S) FAILED ✗"
  echo "  Check output above for details."
fi
echo "========================================"
echo ""

exit $FAILURES
