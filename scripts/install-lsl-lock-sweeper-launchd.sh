#!/usr/bin/env bash
# Idempotent installer for the LSL stale git-lock sweeper launchd job.
#
# Installs one job:
#   - com.coding.lsl-lock-sweeper   StartInterval=60 + RunAtLoad, no KeepAlive
#
# Clears orphaned `.specstory/history/.git/index.lock` files left when a
# committer (project LSL writer OR the SpecStory IDE extension) is killed
# mid-commit. See scripts/lsl-lock-sweeper-job.sh for the safety contract
# (only removes a lock with no live git holder AND mtime older than the
# stale threshold).
#
# Mirrors scripts/install-sub-agent-launchd.sh: plutil -lint → copy (backup on
# diff) → bootout-then-bootstrap → verify. Re-running is safe.

set -euo pipefail

REPO_ROOT="/Users/Q284340/Agentic/coding"
DEST_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${REPO_ROOT}/.data"
UID_VAL="$(id -u)"
LABEL="com.coding.lsl-lock-sweeper"

log() { printf '[install-lsl-lock-sweeper] %s\n' "$*" >&2; }

mkdir -p "${DEST_DIR}" "${LOG_DIR}"

SRC_PLIST="${REPO_ROOT}/launchd/${LABEL}.plist"
DEST_PLIST="${DEST_DIR}/${LABEL}.plist"

if [[ ! -f "${SRC_PLIST}" ]]; then
  log "ERROR: source plist not found at ${SRC_PLIST} — run from a clean checkout"
  exit 1
fi

if ! /usr/bin/plutil -lint "${SRC_PLIST}" >/dev/null; then
  log "ERROR: source plist failed plutil -lint: ${SRC_PLIST}"
  exit 1
fi

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

log "${LABEL}: boot-out (if loaded)"
launchctl bootout "gui/${UID_VAL}/${LABEL}" 2>/dev/null || true

log "${LABEL}: bootstrap gui/${UID_VAL}"
if ! launchctl bootstrap "gui/${UID_VAL}" "${DEST_PLIST}"; then
  log "ERROR: launchctl bootstrap failed for ${LABEL}"
  exit 1
fi

if launchctl list | grep -qF "${LABEL}"; then
  log "OK: ${LABEL} is loaded"
else
  log "FAIL: ${LABEL} did not load — check Console.app or ${LOG_DIR}/lsl-lock-sweeper.log"
  exit 1
fi

log "installed. cadence: every 60s via StartInterval (+ RunAtLoad clears the current lock now)"
log "  log:       ${LOG_DIR}/lsl-lock-sweeper.log"
log "  follow:    tail -F ${LOG_DIR}/lsl-lock-sweeper.log"
log "  kick now:  launchctl kickstart -k gui/${UID_VAL}/${LABEL}"
