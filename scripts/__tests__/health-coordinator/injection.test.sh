#!/bin/bash
# SPEC AC #13: forced-throw injection surfaces as 'unknown', NOT 'healthy'.
#
# Uses HEALTH_COORDINATOR_INJECT_THROW env var + launchctl kickstart
# to restart the coordinator and force a throw on the next tick.
#
# Wave 0 stub: bash -n passes; runtime fails until coordinator + plist
# land in plan 33-02 and the launchd label is registered.
set -e
URL="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"

launchctl setenv HEALTH_COORDINATOR_INJECT_THROW "db_health"
launchctl kickstart -k "gui/$UID/com.coding.health-coordinator"
sleep 8  # one 5s tick + slack

result=$(curl -sf "$URL/health/state" | jq -r '.databases.status')
launchctl unsetenv HEALTH_COORDINATOR_INJECT_THROW
launchctl kickstart -k "gui/$UID/com.coding.health-coordinator"

if [ "$result" = "healthy" ]; then
  echo "FAIL: injected throw resulted in 'healthy' (SPEC R6 violated)"; exit 1
fi
if [ "$result" != "unknown" ]; then
  echo "FAIL: expected 'unknown', got '$result'"; exit 1
fi
echo "PASS: injection → unknown (SPEC R6 + AC #13)"
