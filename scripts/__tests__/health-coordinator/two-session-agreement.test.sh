#!/bin/bash
# SPEC AC #5: two-session agreement — both sessions tracked, project rollup
# remains 'healthy' when one of two sessions stops.
#
# Wave 0 stub: this script exits non-zero against a missing coordinator.
# It becomes green once plans 33-02..33-07 land. See PATTERNS.md
# "two-session-agreement.test.sh" + RESEARCH §4.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.sh"

URL="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"
SID_A="claude-test-A-$$"
SID_B="claude-test-B-$$"

# Spawn two mock reporters in /coding (project rollup expects projectPath=…/coding)
PROJECT="/Users/Q284340/Agentic/coding"
mock_reporter() {
  local sid="$1"
  while true; do
    curl -s -X POST -H 'Content-Type: application/json' \
      -d "{\"kind\":\"lsl_heartbeat\",\"session_id\":\"$sid\",\"source\":\"mock\",\"status\":\"running\",\"payload\":{\"projectPath\":\"$PROJECT\"},\"ts\":$(python3 -c 'import time; print(int(time.time()*1000))')}" \
      "$URL/signals" >/dev/null
    sleep 4
  done
}
mock_reporter "$SID_A" & A_PID=$!
mock_reporter "$SID_B" & B_PID=$!
trap 'kill $A_PID $B_PID 2>/dev/null || true' EXIT

sleep 7  # let two ticks roll through

assert_state_field '.lsl_by_project["coding"]' 'healthy' 'both sessions live' || exit 1
[[ $(curl -sf "$URL/health/state" | jq -r '.lsl | length') -ge 2 ]] || { echo "expected ≥2 lsl entries"; exit 1; }

# Kill A
kill -9 "$A_PID"
sleep 17  # > 15s heartbeat-staleness threshold (D-10)

assert_state_field ".lsl[\"$SID_A\"].status" 'stopped' 'A killed' || exit 1
assert_state_field ".lsl[\"$SID_B\"].status" 'running' 'B alive'   || exit 1
assert_state_field '.lsl_by_project["coding"]' 'healthy' 'project still healthy' || exit 1

# Three-reader agreement (SPEC AC #5 / R8) — health-prompt-hook output shape
prompt_hook_out=$(echo '{"cwd":"/Users/Q284340/Agentic/coding"}' | node "$SCRIPT_DIR/../../health-prompt-hook.js")
echo "$prompt_hook_out" | grep -qF -- '"hookSpecificOutput"' || { echo "prompt-hook shape broken"; exit 1; }
echo "$prompt_hook_out" | grep -qF 'LSL DOWN' && { echo "prompt-hook reported LSL DOWN — FAIL (expected healthy)"; exit 1; } || true

curl -fs http://localhost:3032/api/health-verifier/status | jq -e '.data.overallStatus != "unhealthy"' >/dev/null \
  || { echo "dashboard reports unhealthy — FAIL"; exit 1; }

echo "PASS: two-session agreement — A=stopped, B=running, project=healthy"
