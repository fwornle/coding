#!/usr/bin/env bash
set -euo pipefail

# Launchd-side runner for the Phase 50 LSL observation resolver.
#
# Driven by ~/Library/LaunchAgents/com.coding.lsl-resolver.plist
# (StartInterval=1800 — every 30 minutes). Responsibilities:
#   1. Probe the rapid-llm-proxy first; if unreachable, exit 0 (NOT 1)
#      so launchd doesn't tight-loop the next interval at high error rate.
#      We don't use KeepAlive, so this is purely log cleanliness.
#   2. Compute --since from a state file (.data/lsl-resolver-state.json)
#      OR default to 7 days ago on the first run.
#   3. Call the Plan 1 CLI: node scripts/resolve-observations-from-lsl.mjs
#      --since <ISO> --limit <N>.
#   4. On success, atomically update the state file via .tmp + mv.
#   5. On CLI failure, exit non-zero and leave the state file untouched
#      so the next run retries the same --since window.
#
# Env overrides (for tests and for hand-driving the script):
#   LSL_RESOLVER_STATE_FILE   path to the state JSON (default: .data/lsl-resolver-state.json)
#   LSL_RESOLVER_LIMIT        --limit value passed to the CLI (default: 100)
#   RESOLVER_BIN              path to the resolver script (default:
#                             `node scripts/resolve-observations-from-lsl.mjs`).
#                             When set, it is invoked DIRECTLY (no `node`
#                             prefix); useful in tests with a bash shim.
#   LLM_CLI_PROXY_URL         LLM proxy base URL (default: http://localhost:12435).
#                             Matches the CLAUDE.md precedence chain.
#
# Phase 50, Plan 03 (Task 2).

REPO_ROOT="/Users/Q284340/Agentic/coding"
STATE_FILE="${LSL_RESOLVER_STATE_FILE:-${REPO_ROOT}/.data/lsl-resolver-state.json}"
LIMIT="${LSL_RESOLVER_LIMIT:-100}"
PROXY_URL="${LLM_CLI_PROXY_URL:-${RAPID_LLM_PROXY_URL:-${LLM_PROXY_URL:-http://localhost:12435}}}"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log() { printf '[lsl-resolver][%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }

cd "${REPO_ROOT}"

# ---- 1. Probe the LLM proxy. -------------------------------------------------
# Empty-body POST to /api/complete; expect a 4xx response (validation
# rejection) on a reachable proxy. 5xx and network errors both look like
# "unreachable" and gate us out without running the resolver.
PROXY_HTTP_CODE="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' \
  -X POST -H 'Content-Type: application/json' -d '{}' \
  "${PROXY_URL}/api/complete" 2>/dev/null || echo '000')"

case "${PROXY_HTTP_CODE}" in
  2*|4*)
    log "LLM proxy reachable (HTTP ${PROXY_HTTP_CODE}), proceeding"
    ;;
  *)
    log "LLM proxy unreachable (HTTP ${PROXY_HTTP_CODE}) — skipping this run"
    exit 0
    ;;
esac

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

# ---- 3. Invoke the Plan 1 CLI. ----------------------------------------------
if [[ -n "${RESOLVER_BIN:-}" ]]; then
  log "running (override): ${RESOLVER_BIN} --since ${SINCE} --limit ${LIMIT}"
  set +e
  "${RESOLVER_BIN}" --since "${SINCE}" --limit "${LIMIT}"
  EXIT_CODE=$?
  set -e
else
  log "running: node scripts/resolve-observations-from-lsl.mjs --since ${SINCE} --limit ${LIMIT}"
  set +e
  node scripts/resolve-observations-from-lsl.mjs --since "${SINCE}" --limit "${LIMIT}"
  EXIT_CODE=$?
  set -e
fi

if [[ ${EXIT_CODE} -ne 0 ]]; then
  log "resolver returned exit ${EXIT_CODE} — state file NOT updated, next run will retry from ${SINCE}"
  exit ${EXIT_CODE}
fi

# ---- 4. Atomic state-file write. --------------------------------------------
mkdir -p "$(dirname "${STATE_FILE}")"
TMP_FILE="${STATE_FILE}.tmp"
printf '{"last_run_at":"%s","last_run_limit":%s}\n' "${NOW_ISO}" "${LIMIT}" > "${TMP_FILE}"
mv "${TMP_FILE}" "${STATE_FILE}"

log "run complete — state updated to ${NOW_ISO}"
