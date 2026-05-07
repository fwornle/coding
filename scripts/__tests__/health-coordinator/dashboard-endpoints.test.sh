#!/bin/bash
# Phase 33 — AC #9 (dashboard endpoints preserved) + AC #5 (dashboard-step of
# two-session-agreement). Asserts that the SPA frontend on port 3032 reverse-
# proxies /api/* to the api-server on port 3033 instead of hijacking the
# routes with its `app.get('*', sendFile(index.html))` SPA fallback.
#
# Closes Phase 33 G2 (static-server.js mounted SPA catch-all BEFORE /api/*).
#
# Pre-fix expected: 200 text/html (SPA HTML) — TEST FAILS.
# Post-fix expected: 200 application/json (proxied through to api-server) — TEST PASSES.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_helpers.sh
source "$SCRIPT_DIR/_helpers.sh"

DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3032}"

echo "=== AC #9 / G2 — dashboard endpoints reverse-proxy ==="
echo "Dashboard URL: $DASHBOARD_URL"

# 1. /api/health-verifier/status MUST return application/json (NOT text/html).
CT_STATUS=$(curl -s -o /dev/null -w "%{content_type}" "$DASHBOARD_URL/api/health-verifier/status")
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DASHBOARD_URL/api/health-verifier/status")
echo "  GET /api/health-verifier/status -> $HTTP_STATUS $CT_STATUS"
case "$CT_STATUS" in
  application/json*)
    echo "  PASS: content-type is application/json"
    ;;
  *)
    echo "  FAIL: expected application/json, got '$CT_STATUS' (G2 not closed)"
    exit 1
    ;;
esac

# 2. Body MUST parse as JSON and contain the SPEC R8 keys (or a 503 envelope).
BODY=$(curl -fs "$DASHBOARD_URL/api/health-verifier/status")
if echo "$BODY" | jq -e 'has("data") or has("status")' >/dev/null; then
  echo "  PASS: JSON body parses and has data/status key"
else
  echo "  FAIL: JSON body missing data/status key:"
  echo "$BODY" | head -c 200
  exit 1
fi

# 3. SPA fallback MUST still work for non-/api/* paths.
CT_ROOT=$(curl -s -o /dev/null -w "%{content_type}" "$DASHBOARD_URL/")
HTTP_ROOT=$(curl -s -o /dev/null -w "%{http_code}" "$DASHBOARD_URL/")
echo "  GET /                              -> $HTTP_ROOT $CT_ROOT"
case "$CT_ROOT" in
  text/html*)
    echo "  PASS: SPA root still serves index.html"
    ;;
  *)
    echo "  FAIL: SPA root broken — expected text/html, got '$CT_ROOT'"
    exit 1
    ;;
esac

# 4. React Router client-side route (e.g. /ukb-history) MUST also fall through to SPA.
CT_RR=$(curl -s -o /dev/null -w "%{content_type}" "$DASHBOARD_URL/ukb-history")
echo "  GET /ukb-history                    -> $(curl -s -o /dev/null -w '%{http_code}' "$DASHBOARD_URL/ukb-history") $CT_RR"
case "$CT_RR" in
  text/html*)
    echo "  PASS: React Router fallback still works"
    ;;
  *)
    echo "  FAIL: React Router path broken — expected text/html, got '$CT_RR'"
    exit 1
    ;;
esac

echo "=== AC #9 / G2 — ALL ASSERTIONS PASS ==="
