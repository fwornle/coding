#!/usr/bin/env bash
set -euo pipefail

# Launchd-side runner for the Phase 51 sub-agent sweep (Path B tier).
#
# Driven by ~/Library/LaunchAgents/com.coding.sub-agent-sweep.plist
# (StartInterval=1800 — every 30 minutes). Responsibilities:
#   1. Probe the rapid-llm-proxy first; if unreachable, exit 0 (NOT 1)
#      so launchd doesn't tight-loop the next interval at high error rate.
#      We don't use KeepAlive, so this is purely log cleanliness.
#   2. Compute --since from a state file (.data/sub-agent-sweep-state.json)
#      OR default to 7 days ago on the first run.
#   3. Call the Plan 51-01 CLI: node scripts/sweep-sub-agents.mjs
#      --since <ISO> --limit <N> --project coding.
#   4. On success, atomically update the state file via .tmp + mv.
#   5. On CLI failure, exit non-zero and leave the state file untouched
#      so the next run retries the same --since window.
#
# Env overrides (for tests and for hand-driving the script):
#   SUB_AGENT_SWEEP_STATE_FILE  path to the state JSON
#                              (default: .data/sub-agent-sweep-state.json)
#   SUB_AGENT_SWEEP_LIMIT       --limit value passed to the CLI (default: 100)
#   SWEEP_BIN                   path to the sweep script (default:
#                              `node scripts/sweep-sub-agents.mjs`).
#                              When set, it is invoked DIRECTLY (no `node`
#                              prefix); useful in tests with a bash shim.
#   LLM_CLI_PROXY_URL           LLM proxy base URL (default: http://localhost:12435).
#                              Matches the CLAUDE.md precedence chain.
#
# Phase 51, Plan 11 (Task 1). Mirrors scripts/lsl-resolver-job.sh.

REPO_ROOT="/Users/Q284340/Agentic/coding"
STATE_FILE="${SUB_AGENT_SWEEP_STATE_FILE:-${REPO_ROOT}/.data/sub-agent-sweep-state.json}"
LIMIT="${SUB_AGENT_SWEEP_LIMIT:-100}"
PROXY_URL="${LLM_CLI_PROXY_URL:-${RAPID_LLM_PROXY_URL:-${LLM_PROXY_URL:-http://localhost:12435}}}"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log() { printf '[sub-agent-sweep][%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }

cd "${REPO_ROOT}"

# ---- 1. Probe the LLM proxy. -------------------------------------------------
# GET /health is the canonical reachability endpoint. We previously POST'd
# an empty body to /api/complete and expected 4xx, but the current
# rapid-llm-proxy returns 500 (not 400) for "no messages or prompt"
# validation errors, which made the probe fail-closed even on a healthy
# proxy and silently no-op'd the sweep for hours. /health returns 200
# when the proxy is up; anything else (5xx, 404, 000 network error) gates
# us out. Mirrors the probe used in scripts/test-coding.sh.
PROXY_HTTP_CODE="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' \
  "${PROXY_URL}/health" 2>/dev/null || echo '000')"

case "${PROXY_HTTP_CODE}" in
  2*|4*)
    log "LLM proxy reachable (HTTP ${PROXY_HTTP_CODE}), proceeding"
    ;;
  *)
    log "LLM proxy unreachable (HTTP ${PROXY_HTTP_CODE}) — skipping this run"
    exit 0
    ;;
esac

# ---- 1b. AFK gate. -----------------------------------------------------------
# This sweep makes one LLM call per discovered sub-agent transcript — the
# dominant overnight LLM burn while the operator is away (no live consumer for
# the resulting observations). The health-coordinator is the single presence
# authority: it exposes `user_active` on /health/state (transcript-mtime based,
# see scripts/health-coordinator.js userActiveNow()). Skip the whole run while
# AFK; the --since window is preserved (state file untouched on exit 0 before
# the CLI runs), so the first run after the operator returns covers the gap.
#
# Fail-safe: if the coordinator is unreachable OR the field is absent, we CANNOT
# prove the user is away, so we DEFAULT TO PROCEEDING (fail-open) rather than
# silently starving capture during a coordinator restart window.
COORD_URL="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"
USER_ACTIVE="$(curl -sS --max-time 5 "${COORD_URL}/health/state" 2>/dev/null | node -e "
  let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
    try { const j = JSON.parse(s); process.stdout.write(j.user_active === false ? 'afk' : 'active'); }
    catch (e) { process.stdout.write('unknown'); }
  });
" 2>/dev/null || echo 'unknown')"

if [[ "${USER_ACTIVE}" == "afk" ]]; then
  log "operator AFK (coordinator user_active=false) — suspending sweep this run"
  exit 0
fi
log "operator present or presence unknown (${USER_ACTIVE}) — proceeding"

# ---- 2. Compute --since. -----------------------------------------------------
SINCE=""
if [[ -f "${STATE_FILE}" ]]; then
  # Use node so we can parse the JSON safely (tolerates pretty-printing,
  # trailing whitespace, etc). On any parse error, fall through to default.
  SINCE="$(node -e "
    try {
      const fs = require('fs');
      const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      process.stdout.write(typeof j.last_run_at === 'string' ? j.last_run_at : '');
    } catch (e) { process.stdout.write(''); }
  " "${STATE_FILE}" 2>/dev/null || true)"
fi

if [[ -z "${SINCE}" ]]; then
  # macOS `date` uses -v -7d; GNU `date` uses -d '7 days ago'. Try both.
  SINCE="$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
        || date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
        || echo '')"
  log "no prior state — defaulting --since to ${SINCE}"
else
  log "resuming from ${SINCE}"
fi

if [[ -z "${SINCE}" ]]; then
  log "ERROR: could not compute --since (date arithmetic failed) — skipping run"
  exit 0
fi

# ---- 3. Invoke the Plan 51-01 CLI. ------------------------------------------
if [[ -n "${SWEEP_BIN:-}" ]]; then
  log "running (override): ${SWEEP_BIN} --since ${SINCE} --limit ${LIMIT} --project coding"
  set +e
  "${SWEEP_BIN}" --since "${SINCE}" --limit "${LIMIT}" --project coding
  EXIT_CODE=$?
  set -e
else
  log "running: node scripts/sweep-sub-agents.mjs --since ${SINCE} --limit ${LIMIT} --project coding"
  set +e
  node scripts/sweep-sub-agents.mjs --since "${SINCE}" --limit "${LIMIT}" --project coding
  EXIT_CODE=$?
  set -e
fi

if [[ ${EXIT_CODE} -ne 0 ]]; then
  log "sweep returned exit ${EXIT_CODE} — state file NOT updated, next run will retry from ${SINCE}"
  exit ${EXIT_CODE}
fi

# ---- 4. Atomic state-file write. --------------------------------------------
mkdir -p "$(dirname "${STATE_FILE}")"
TMP_FILE="${STATE_FILE}.tmp"
printf '{"last_run_at":"%s","last_run_limit":%s}\n' "${NOW_ISO}" "${LIMIT}" > "${TMP_FILE}"
mv "${TMP_FILE}" "${STATE_FILE}"

log "run complete — state updated to ${NOW_ISO}"
