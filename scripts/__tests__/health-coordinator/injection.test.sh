#!/usr/bin/env bash
# SPEC AC #13: forced-throw injection surfaces as 'unknown', NOT 'healthy'.
#
# Phase 33-15 vector: POST /test/inject (loopback-gated HTTP endpoint).
# Replaces the falsified 33-12 launchctl-setenv approach (see 33-12-SUMMARY.md
# for the 3 independent reproductions proving plist-vs-domain env precedence
# wins on macOS Sequoia).
#
# Runs against the live coordinator on :3034 with NO plist mutations.

set -euo pipefail
COORD="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"

echo "=== AC#13 — injection: forced throw → unknown ==="
echo "  coordinator: $COORD"

# 1. Reset any leftover flags (idempotent — fresh start).
if ! curl -fs -X POST "$COORD/test/inject" \
     -H 'Content-Type: application/json' -d '{"reset":true}' >/dev/null; then
  echo "FAIL: coordinator unreachable at $COORD (or /test/inject not registered)"
  echo "       check that the coordinator is running and includes plan 33-15."
  exit 1
fi
echo "  reset: leftover flags cleared"

# 2. Inject db_health throw via POST /test/inject.
SET_RESULT=$(curl -fs -X POST "$COORD/test/inject" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"db_health","mode":"throw"}')
echo "$SET_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok') is True, 'set failed'" || {
  echo "FAIL: could not set injection flag"
  echo "       response: $SET_RESULT"
  exit 1
}
echo "  injection flag set: db_health=throw"

# 3. Wait one tick (~5s default) plus margin for the next runAllChecks pass.
sleep 7

# 4. Assert databases.status is now 'unknown' (NOT 'healthy' — SPEC R6).
STATUS=$(curl -fs "$COORD/health/state" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('databases',{}).get('status'))")
if [ "$STATUS" = "unknown" ]; then
  echo "  PASS: databases.status=unknown (R6 satisfied — never healthy on inject-throw)"
elif [ "$STATUS" = "healthy" ]; then
  echo "  FAIL: databases.status=healthy (SPEC R6 violated — silent fallback)"
  curl -fs -X POST "$COORD/test/inject" \
    -H 'Content-Type: application/json' -d '{"reset":true}' >/dev/null || true
  exit 1
else
  echo "  FAIL: databases.status=$STATUS (expected 'unknown')"
  curl -fs -X POST "$COORD/test/inject" \
    -H 'Content-Type: application/json' -d '{"reset":true}' >/dev/null || true
  exit 1
fi

# 5. Reset (always — even on assertion success — so the live coordinator is
#    left in a clean baseline for the next test in run-all.sh).
curl -fs -X POST "$COORD/test/inject" \
  -H 'Content-Type: application/json' -d '{"reset":true}' >/dev/null
echo "  reset complete"

# 6. Optional recovery check — give one tick for the normal db_health probe to
#    re-run. Not a hard assertion (the coordinator's PSM may legitimately report
#    'degraded' on a system where Qdrant is down independently of the test);
#    we just record the post-reset value for diagnostic context.
sleep 7
RECOVERED=$(curl -fs "$COORD/health/state" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('databases',{}).get('status'))")
echo "  post-reset databases.status: $RECOVERED"

echo "=== AC#13 — PASS ==="
