#!/usr/bin/env bash
# Idempotent installer for the Phase 51 sub-agent launchd jobs.
#
# Installs four jobs:
#   - com.coding.sub-agent-sweep         StartInterval=1800 (30 min), no KeepAlive
#   - com.coding.sub-agent-live-claude   KeepAlive=true (restart on any exit)
#   - com.coding.sub-agent-live-opencode KeepAlive=true (restart on any exit)
#   - com.coding.sub-agent-live-copilot  KeepAlive=true (restart on any exit)
#
# The three live plists used to carry KeepAlive={SuccessfulExit=false,
# NetworkState=true}. SuccessfulExit=false means "restart only on a non-zero
# exit", and these daemons trap SIGTERM and exit(0) — so any signalled stop was
# permanent (14.5h capture outage, 2026-09-01). NetworkState, which looks like
# it would cover that case, is not implemented at all (`man 5 launchd.plist`).
# Both keys are gone in favour of plain <true/>; see the plist comments. Stop a
# live daemon with `launchctl bootout`, never with a kill.
#
# Iterates each plist label:
#   - Validates source via `plutil -lint`.
#   - Copies into ~/Library/LaunchAgents/ (backing up any prior copy that
#     differs in content).
#   - Re-bootstraps via `launchctl bootout` + `launchctl bootstrap`
#     (idempotent — works whether the job was previously loaded or not).
#   - Verifies registration via `launchctl list`.
#
# Re-running this script is safe: identical plists short-circuit the copy,
# and bootout-before-bootstrap means a previously loaded agent is replaced
# cleanly rather than producing a "service already loaded" error.
#
# Per Phase 51 Plan 11 Task 1 — mirrors scripts/install-lsl-resolver-launchd.sh
# (Plan 50-03) with a labels array.
#
# Per Wave-5 follow-up: the LIVE daemons emit a 30s heartbeat log line to
# stderr. The plists redirect StandardErrorPath/StandardOutPath into
# .data/live-<agent>.log so they NEVER bleed into the operator's terminal
# (which would corrupt opencode/copilot's TUI). Matches the user's
# `nohup ... >> .data/live-<agent>.log 2>&1 &` recipe.
#
# Per Phase 51 Plan 12 (CR-04 closure): the three live-daemon plists used
# to hardcode `/usr/local/bin/node` in ProgramArguments[0], which does NOT
# exist on Apple Silicon hosts (node lives at /opt/homebrew/bin/node).
# launchd resolves ProgramArguments[0] BEFORE applying
# EnvironmentVariables.PATH, so the PATH-based fix has to go via a wrapper.
# We picked Strategy A (wrapper pattern, mirrors scripts/sub-agent-sweep-job.sh):
# the plists now invoke `/bin/sh -c 'exec node "$@"' node <script> <args>`
# so the shell does PATH-driven node resolution at exec time.
# This installer therefore needs NO node-resolution logic — but we still
# probe `command -v node` and log the resolved binary so operators can
# diagnose "wrong node version" issues without spelunking through
# Console.app. Hard-failing on absent node is NOT necessary: the wrapper
# will surface a clear ENOENT in .data/live-*.log on first spawn.

set -euo pipefail

# shellcheck source=lib/launchd-plist.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/launchd-plist.sh"

# Resolved, never hardcoded. The checked-in plists carry __CODING_REPO__ where this
# belongs and render_plist substitutes it — see scripts/lib/launchd-plist.sh for why a
# baked-in path produced a job that loaded happily and then failed at every run.
REPO_ROOT="$(launchd_repo_root)"

# One scratch dir for every rendered plist, cleaned on any exit including the error
# paths below, so a failed install leaves nothing behind.
RENDER_DIR="$(mktemp -d)"
trap 'rm -rf "${RENDER_DIR}"' EXIT
DEST_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${REPO_ROOT}/.data"
UID_VAL="$(id -u)"

PLISTS=(
  com.coding.sub-agent-sweep
  com.coding.sub-agent-live-claude
  com.coding.sub-agent-live-opencode
  com.coding.sub-agent-live-copilot
  com.coding.measurement-reconciler
)

log() { printf '[install-sub-agent] %s\n' "$*" >&2; }

# 1. Ensure target directories exist (DEST_DIR for plists, LOG_DIR for stderr
#    redirection — the daemons heartbeat-log to stderr every 30s, redirected
#    to .data/live-<agent>.log to keep the user's terminal clean).
mkdir -p "${DEST_DIR}"
mkdir -p "${LOG_DIR}"

# 1a. Plan 51-12 diagnostic: resolve `node` and log the absolute path so an
#     operator running this on Apple Silicon can confirm the wrapper will
#     pick up /opt/homebrew/bin/node (Intel: /usr/local/bin/node). Not a
#     hard gate — the wrapper surfaces a clear ENOENT in .data/live-*.log
#     if node is genuinely missing. See plist header comment for Strategy
#     A rationale.
RESOLVED_NODE="$(command -v node 2>/dev/null || true)"
if [[ -z "${RESOLVED_NODE}" ]]; then
  log "WARN: node not on PATH for installer process — live daemons will fail until node is installed (brew install node or equivalent)"
else
  log "resolved node binary: ${RESOLVED_NODE} (live daemons use /bin/sh -c wrapper + EnvironmentVariables.PATH)"
fi

# 2. Iterate every label.
for LABEL in "${PLISTS[@]}"; do
  SRC_PLIST="${REPO_ROOT}/launchd/${LABEL}.plist"
  DEST_PLIST="${DEST_DIR}/${LABEL}.plist"

  # 2a. Verify source plist exists.
  if [[ ! -f "${SRC_PLIST}" ]]; then
    log "ERROR: source plist not found at ${SRC_PLIST}"
    log "       run this installer from a clean checkout of the coding repo"
    exit 1
  fi

  # 2b. Validate plist syntax before installing.
  # Render the checked-in template for THIS machine, then lint what was
  # rendered — the template is not what launchd reads.
  RENDERED="${RENDER_DIR}/${LABEL}.plist"
  if ! render_plist "${SRC_PLIST}" "${RENDERED}" "${REPO_ROOT}"; then
    log "ERROR: could not render ${SRC_PLIST} for ${REPO_ROOT}"
    exit 1
  fi

  # 2c. Copy plist (idempotent: skip if identical, back up if different).
  if [[ -f "${DEST_PLIST}" ]] && /usr/bin/diff -q "${RENDERED}" "${DEST_PLIST}" >/dev/null 2>&1; then
    log "${LABEL}: plist already up-to-date at ${DEST_PLIST}"
  else
    if [[ -f "${DEST_PLIST}" ]]; then
      BACKUP="${DEST_PLIST}.bak.$(date +%Y%m%d-%H%M%S)"
      cp "${DEST_PLIST}" "${BACKUP}"
      log "${LABEL}: backed up existing plist to ${BACKUP}"
    fi
    cp "${RENDERED}" "${DEST_PLIST}"
    log "installed plist at ${DEST_PLIST}"
  fi

  # 2d. Re-bootstrap the agent. bootout first so re-running is a no-op-then-load
  #     rather than an error.
  log "${LABEL}: boot-out (if loaded)"
  launchctl bootout "gui/${UID_VAL}/${LABEL}" 2>/dev/null || true

  # `bootout` returns as soon as the SIGTERM is delivered, NOT once the process
  # is gone. The live daemons shut down gracefully (drain the in-flight poll,
  # close the writer, checkpoint the cursor), which takes about a second — and
  # bootstrapping a label whose previous instance is still exiting fails with
  # the useless `Bootstrap failed: 5: Input/output error`. Hit exactly this on
  # 2026-09-02: the first label errored, `set -e` aborted the run, and the
  # remaining two plists were left on the old version. Retry rather than sleep
  # blindly — a clean unload is usually done well inside the first backoff.
  log "${LABEL}: bootstrap gui/${UID_VAL}"
  BOOTSTRAPPED=0
  for ATTEMPT in 1 2 3 4 5; do
    if launchctl bootstrap "gui/${UID_VAL}" "${DEST_PLIST}" 2>/dev/null; then
      BOOTSTRAPPED=1
      break
    fi
    log "${LABEL}: bootstrap attempt ${ATTEMPT} failed (previous instance still exiting?) — retrying"
    sleep 1
  done
  if [[ "${BOOTSTRAPPED}" -ne 1 ]]; then
    # Final attempt with stderr shown, so the operator sees launchctl's reason.
    log "ERROR: launchctl bootstrap failed for ${LABEL} after 5 attempts:"
    launchctl bootstrap "gui/${UID_VAL}" "${DEST_PLIST}" || true
    exit 1
  fi

  # 2e. Verify registration. Same asynchrony as the bootstrap above: a label
  #     can be accepted by launchd a beat before `launchctl list` reports it,
  #     so a single check right after bootstrap produces a false FAIL on a job
  #     that is in fact loaded (hit on 2026-09-02 with measurement-reconciler,
  #     which was running under a pid the whole time the installer called it
  #     dead). Poll briefly instead of trusting the first read.
  LOADED=0
  for ATTEMPT in 1 2 3 4 5; do
    if launchctl list | grep -qF "${LABEL}"; then
      LOADED=1
      break
    fi
    sleep 1
  done
  if [[ "${LOADED}" -eq 1 ]]; then
    log "OK: ${LABEL} is loaded"
  else
    log "FAIL: ${LABEL} did not load"
    log "      check Console.app or ${LOG_DIR}/live-*.log for errors"
    exit 1
  fi
done

log "all 4 jobs installed"
log "  sweep cadence: every 1800s (30 min) via StartInterval (no KeepAlive)"
log "  live daemons: KeepAlive=true with ThrottleInterval=60s (anti-tight-loop)"
log "                restart on ANY exit — stop one with 'launchctl bootout', not a kill"
log "  logs:         ${LOG_DIR}/live-*.log (stderr redirected to keep terminal clean)"
log "  follow:       tail -F ${LOG_DIR}/live-claude.log ${LOG_DIR}/live-opencode.log ${LOG_DIR}/live-copilot.log"
log "  kickstart sweep immediately: launchctl kickstart -k gui/${UID_VAL}/com.coding.sub-agent-sweep"
