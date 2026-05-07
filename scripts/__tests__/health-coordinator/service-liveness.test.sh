#!/bin/bash
# Phase 33 G1 closure (plan 33-09): coordinator's services[] populates from
# real probes (probeHttpHealth + probeTcpPort), not the frozen 'unknown' stub.
#
# Asserts:
#   1. Every enabled rule in config/health-verification-rules.json::services
#      appears in /health/state.services[].name (proves rule iteration runs).
#   2. obs_api rule (added by plan 33-09 task 2) is visible.
#   3. At least one service shows status='running' (proves probe dispatch
#      actually flipped status from initial 'unknown' to 'running' — without
#      this, AC#6 detection-latency stays FAIL-no-run).
#
# Honors HEALTH_COORDINATOR_URL (default :3034). To run against a worktree
# coordinator on a non-default port:
#   HEALTH_COORDINATOR_URL=http://localhost:13934 \
#     bash scripts/__tests__/health-coordinator/service-liveness.test.sh
#
# Wave-0 behavior (matches quick.sh): if no coordinator is reachable, the test
# SKIPs and exits 0 so it can sit in run-all.sh without failing pre-merge
# worktrees. (Standalone "did this exercise the probe path?" runs should set
# HEALTH_COORDINATOR_URL to point at a coordinator built from the worktree.)
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RULES="$REPO_ROOT/config/health-verification-rules.json"

# Reachability gate (matches quick.sh Wave-0 pattern). Exit 0 on SKIP so
# run-all.sh's `set -e` does not flag a missing coordinator as suite failure.
if ! curl -fs --max-time 2 "$URL/health" >/dev/null 2>&1; then
  echo "SKIP: coordinator not reachable on $URL (Wave-0 / pre-cutover worktree)"
  exit 0
fi

state=$(curl -sf "$URL/health/state")
[ -n "$state" ] || { echo "FAIL: coordinator /health/state empty"; exit 1; }

# 1. Every enabled services rule must appear in services[]
#    Pass state JSON via env to avoid bash heredoc-vs-redirection collisions.
missing=$(STATE_JSON="$state" RULES_PATH="$RULES" python3 - <<'PYEOF'
import json, os
state = json.loads(os.environ["STATE_JSON"])
with open(os.environ["RULES_PATH"]) as fh:
    rules = json.load(fh)["rules"]["services"]
have = {s["name"] for s in state.get("services", [])}
miss = [n for n, r in rules.items() if r.get("enabled", True) and n not in have]
print(",".join(miss))
PYEOF
)
if [ -n "$missing" ]; then
  echo "FAIL: services missing from /health/state.services[]: $missing"
  exit 1
fi
echo "PASS: all enabled services rules represented in services[]"

# 2. obs_api rule visible (regardless of running/stopped — what matters is the
#    coordinator can FIND obs_api; AC#6 detection-latency test selects on .name)
obs_status=$(jq -r '.services[] | select(.name=="obs_api") | .status' <<<"$state")
[ -n "$obs_status" ] || { echo "FAIL: obs_api not in /health/state.services[]"; exit 1; }
echo "PASS: obs_api visible (status=$obs_status)"

# 3. At least one service shows status='running' (proves probe dispatch fired)
running=$(jq -r '.services[] | select(.status=="running") | .name' <<<"$state" | head -1)
if [ -z "$running" ]; then
  echo "FAIL: no service shows status='running' — probe dispatch may not be wired"
  echo "Diagnostic — current services[]:"
  jq -c '.services[] | {name, status, latency_ms, probe_error}' <<<"$state"
  exit 1
fi
echo "PASS: probe dispatch produced at least one running service ($running)"

# Bonus assertion: SPEC R6 — no service entry should ever have status='healthy'
healthy=$(jq -r '.services[] | select(.status=="healthy") | .name' <<<"$state" | head -1)
if [ -n "$healthy" ]; then
  echo "FAIL: service '$healthy' has status='healthy' — SPEC R6 violation"
  echo "Coordinator must use 'running'/'stopped'/'unknown', never 'healthy'"
  exit 1
fi
echo "PASS: SPEC R6 — no service has status='healthy'"

echo ""
echo "service-liveness test: ALL PASS (G1 closed)"
exit 0
