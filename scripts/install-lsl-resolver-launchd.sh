#!/usr/bin/env bash
# Idempotent installer for the com.coding.lsl-resolver launchd job.
#
# - Validates that the source-controlled plist exists under launchd/.
# - Copies it into ~/Library/LaunchAgents/ (backing up any prior copy that
#   differs in content).
# - Re-bootstraps the agent via `launchctl bootout` + `launchctl bootstrap`
#   (idempotent — works whether the job was previously loaded or not).
# - Verifies registration via `launchctl list`.
#
# Re-running this script is safe: identical plists short-circuit the copy,
# and bootout-before-bootstrap means a previously loaded agent is replaced
# cleanly rather than producing a "service already loaded" error.
#
# Phase 50, Plan 03 (Task 1).

set -euo pipefail

REPO_ROOT="/Users/Q284340/Agentic/coding"
PLIST_NAME="com.coding.lsl-resolver.plist"
SRC_PLIST="${REPO_ROOT}/launchd/${PLIST_NAME}"
DEST_DIR="${HOME}/Library/LaunchAgents"
DEST_PLIST="${DEST_DIR}/${PLIST_NAME}"
LOG_DIR="${REPO_ROOT}/.logs"
LOG_FILE="${LOG_DIR}/lsl-resolver.log"
SERVICE_LABEL="com.coding.lsl-resolver"

log() { printf '[install-lsl-resolver] %s\n' "$*" >&2; }

# 1. Verify source plist exists.
if [[ ! -f "${SRC_PLIST}" ]]; then
  log "ERROR: source plist not found at ${SRC_PLIST}"
  log "       run this installer from a clean checkout of the coding repo"
  exit 1
fi

# Validate plist syntax before installing.
if ! /usr/bin/plutil -lint "${SRC_PLIST}" >/dev/null; then
  log "ERROR: source plist failed plutil -lint"
  exit 1
fi

# 2. Ensure target directories exist.
mkdir -p "${DEST_DIR}"
mkdir -p "${LOG_DIR}"

# 3. Copy plist (idempotent: skip if identical, back up if different).
if [[ -f "${DEST_PLIST}" ]] && /usr/bin/diff -q "${SRC_PLIST}" "${DEST_PLIST}" >/dev/null 2>&1; then
  log "plist already up-to-date at ${DEST_PLIST}"
else
  if [[ -f "${DEST_PLIST}" ]]; then
    BACKUP="${DEST_PLIST}.bak.$(date +%Y%m%d-%H%M%S)"
    cp "${DEST_PLIST}" "${BACKUP}"
    log "backed up existing plist to ${BACKUP}"
  fi
  cp "${SRC_PLIST}" "${DEST_PLIST}"
  log "installed plist at ${DEST_PLIST}"
fi

# 4. Re-bootstrap the agent. bootout first so re-running is a no-op-then-load
#    rather than an error.
UID_VAL="$(id -u)"
log "boot-out (if loaded): launchctl bootout gui/${UID_VAL}/${SERVICE_LABEL}"
launchctl bootout "gui/${UID_VAL}/${SERVICE_LABEL}" 2>/dev/null || true

log "bootstrap: launchctl bootstrap gui/${UID_VAL} ${DEST_PLIST}"
if ! launchctl bootstrap "gui/${UID_VAL}" "${DEST_PLIST}"; then
  log "ERROR: launchctl bootstrap failed"
  exit 1
fi

# 5. Verify registration.
if ! launchctl list | grep -q "${SERVICE_LABEL}"; then
  log "ERROR: ${SERVICE_LABEL} not visible in 'launchctl list' after bootstrap"
  log "       check Console.app or ${LOG_FILE} for errors"
  exit 1
fi

# 6. Success notice.
log "OK: ${SERVICE_LABEL} is loaded."
log "    schedule: every 1800s (30 min) via StartInterval (no KeepAlive)"
log "    log file: ${LOG_FILE}"
log "    follow:   tail -F ${LOG_FILE}"
log "    kickstart immediately: launchctl kickstart -k gui/${UID_VAL}/${SERVICE_LABEL}"
