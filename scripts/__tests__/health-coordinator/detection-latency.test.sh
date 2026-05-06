#!/bin/bash
# SPEC AC #6: detection latency — P95 ≤ 10s, P99 ≤ 15s across 50 trials.
#
# Per planning_context user-resolved Q1: latency injection is
# kill -TERM of a host-polled reporter (per-D-08 the in-container
# supervisord polling path is dropped — using that injection target
# would surface only via the 30s Docker healthcheck, outside the SLA).
#
# Wave 0 stub: bash -n / node --check pass; runtime test fails until
# the coordinator and host obs-api are wired up.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.sh"
URL="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"

# Per user-resolved Q1: latency injection = kill -TERM of a host-polled reporter.
# Locate the host obs-api PID (the coordinator polls it as a tracked service).
inject_failure() {
  local pid
  pid=$(pgrep -f 'observations-api-server.mjs' | head -1)
  if [ -z "$pid" ]; then
    echo "FAIL: no obs-api host process to kill"; exit 2  # SKIP — env not ready
  fi
  kill -TERM "$pid"
  echo "$pid"
}

restore_service() {
  # obs-api is supervised externally; in CI it should auto-restart.
  # Wait briefly for restart before next trial.
  sleep 5
}

samples=()
for i in $(seq 1 50); do
  T0=$(python3 -c 'import time; print(time.time())')
  pid=$(inject_failure)
  while true; do
    state=$(curl -sf "$URL/health/state")
    # Coordinator surfaces stopped obs-api as services[*].status != 'running'
    if echo "$state" | jq -e '[.services[]? | select(.name=="obs-api" and .status!="running")] | length > 0' >/dev/null 2>&1; then
      T1=$(python3 -c 'import time; print(time.time())')
      samples+=( "$(python3 -c "print($T1 - $T0)")" )
      break
    fi
    sleep 0.5
  done
  restore_service
done

# SPEC AC #6 thresholds: P95 <= 10.0 seconds, P99 <= 15.0 seconds.
printf '%s\n' "${samples[@]}" | python3 -c "
import sys, statistics
s=sorted(float(x) for x in sys.stdin)
qs=statistics.quantiles(s, n=100)
print(f'P95={qs[94]:.3f} (threshold 10.0) P99={qs[98]:.3f} (threshold 15.0)')
assert qs[94] <= 10.0, f'P95 violated: {qs[94]}'
assert qs[98] <= 15.0, f'P99 violated: {qs[98]}'
"
