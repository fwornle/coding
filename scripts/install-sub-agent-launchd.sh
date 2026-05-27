#!/usr/bin/env bash
# Idempotent installer for the Phase 51 sub-agent launchd jobs.
#
# Installs four jobs:
#   - com.coding.sub-agent-sweep         StartInterval=1800 (30 min), no KeepAlive
#   - com.coding.sub-agent-live-claude   KeepAlive=true (restart on crash)
#   - com.coding.sub-agent-live-opencode KeepAlive=true (restart on crash)
#   - com.coding.sub-agent-live-copilot  KeepAlive=true (restart on crash)
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

set -euo pipefail

REPO_ROOT="/Users/Q284340/Agentic/coding"
DEST_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${REPO_ROOT}/.data"
UID_VAL="$(id -u)"

PLISTS=(
  com.coding.sub-agent-sweep
  com.coding.sub-agent-live-claude
  com.coding.sub-agent-live-opencode
  com.coding.sub-agent-live-copilot
)

log() { printf '[install-sub-agent] %s\n' "$*" >&2; }

# 1. Ensure target directories exist (DEST_DIR for plists, LOG_DIR for stderr
#    redirection — the daemons heartbeat-log to stderr every 30s, redirected
#    to .data/live-<agent>.log to keep the user's terminal clean).
mkdir -p "${DEST_DIR}"
mkdir -p "${LOG_DIR}"

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
  if ! /usr/bin/plutil -lint "${SRC_PLIST}" >/dev/null; then
    log "ERROR: source plist failed plutil -lint: ${SRC_PLIST}"
    exit 1
  fi

  # 2c. Copy plist (idempotent: skip if identical, back up if different).
  if [[ -f "${DEST_PLIST}" ]] && /usr/bin/diff -q "${SRC_PLIST}" "${DEST_PLIST}" >/dev/null 2>&1; then
    log "${LABEL}: plist already up-to-date at ${DEST_PLIST}"
  else
    if [[ -f "${DEST_PLIST}" ]]; then
      BACKUP="${DEST_PLIST}.bak.$(date +%Y%m%d-%H%M%S)"
      cp "${DEST_PLIST}" "${BACKUP}"
      log "${LABEL}: backed up existing plist to ${BACKUP}"
    fi
    cp "${SRC_PLIST}" "${DEST_PLIST}"
    log "installed plist at ${DEST_PLIST}"
  fi

  # 2d. Re-bootstrap the agent. bootout first so re-running is a no-op-then-load
  #     rather than an error.
  log "${LABEL}: boot-out (if loaded)"
  launchctl bootout "gui/${UID_VAL}/${LABEL}" 2>/dev/null || true

  log "${LABEL}: bootstrap gui/${UID_VAL}"
  if ! launchctl bootstrap "gui/${UID_VAL}" "${DEST_PLIST}"; then
    log "ERROR: launchctl bootstrap failed for ${LABEL}"
    exit 1
  fi

  # 2e. Verify registration.
  if launchctl list | grep -qF "${LABEL}"; then
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
log "  logs:         ${LOG_DIR}/live-*.log (stderr redirected to keep terminal clean)"
log "  follow:       tail -F ${LOG_DIR}/live-claude.log ${LOG_DIR}/live-opencode.log ${LOG_DIR}/live-copilot.log"
log "  kickstart sweep immediately: launchctl kickstart -k gui/${UID_VAL}/com.coding.sub-agent-sweep"
