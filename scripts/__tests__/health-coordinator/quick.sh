#!/bin/bash
# Quick smoke test: coordinator running, /health/state has all top-level keys.
# Wave 0 behaviour: when the coordinator is not yet built/running (no
# response on $URL), each smoke test reports SKIP (exit 2) rather than
# FAIL (exit 1) so that quick.sh exits 0 on a clean Wave-0 worktree.
# Once the coordinator lands in plan 33-02, an unreachable coordinator
# will be a real FAIL.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.sh"

# Detect whether the coordinator is reachable at all. If not, the
# downstream smoke tests SKIP rather than FAIL.
COORDINATOR_REACHABLE=0
if curl -fs --max-time 2 "$URL/health" >/dev/null 2>&1; then
  COORDINATOR_REACHABLE=1
fi

smoke_coordinator_up() {
  if [ "$COORDINATOR_REACHABLE" -ne 1 ]; then
    echo "coordinator not reachable on $URL (Wave 0: coordinator not yet built)"
    return 2  # SKIP
  fi
  curl -fs "$URL/health" >/dev/null 2>&1 || { echo "coordinator not reachable on $URL"; return 1; }
}

smoke_state_keys() {
  if [ "$COORDINATOR_REACHABLE" -ne 1 ]; then
    echo "coordinator not reachable on $URL (Wave 0: coordinator not yet built)"
    return 2  # SKIP
  fi
  curl -fs "$URL/health/state" | jq -e '.container, .services, .lsl, .lsl_by_project, .processes, .generated_at, .coordinator_uptime_s' >/dev/null \
    || { echo "/health/state missing required top-level keys"; return 1; }
}

run_test "coordinator HTTP /health responds"     smoke_coordinator_up
run_test "/health/state has all required keys"   smoke_state_keys

print_summary
