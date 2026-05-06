#!/bin/bash
# D-10: stopped sessions evict from .lsl after 5 minutes (310s with slack).
#
# Wave 0 stub: bash -n passes; runtime fails until plan 33-02 lands the
# coordinator and the LSL session-tracking machinery.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.sh"
URL="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"

SID="evict-test-$$"
# Send one heartbeat then stop
curl -sf -X POST -H 'Content-Type: application/json' \
  -d "{\"kind\":\"lsl_heartbeat\",\"session_id\":\"$SID\",\"source\":\"mock\",\"status\":\"running\",\"payload\":{\"projectPath\":\"/tmp\"},\"ts\":$(python3 -c 'import time; print(int(time.time()*1000))')}" \
  "$URL/signals" >/dev/null

sleep 17  # > 15s threshold → status: stopped
assert_state_field ".lsl[\"$SID\"].status" 'stopped' 'session stopped' || exit 1

# Wait 5 min + slack — D-10: stopped sessions evict after 5min
echo "Waiting 310s for eviction..."
sleep 310

[[ $(curl -sf "$URL/health/state" | jq -r ".lsl[\"$SID\"]") == 'null' ]] \
  || { echo "FAIL: session still in lsl after 5min"; exit 1; }
echo "PASS: session evicted after 5min"
