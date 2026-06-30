#!/usr/bin/env bash
# Idempotent installer for the ETM (enhanced-transcript-monitor) launchd job.
#
# Installs one job:
#   - com.coding.etm   RunAtLoad + KeepAlive:{SuccessfulExit:false}, ThrottleInterval=15
#
# KeepAlive is {SuccessfulExit:false} (NOT plain true) on purpose: ETM relaunches
# only on an abnormal (non-zero) exit. A clean defer to a healthy singleton holder
# exits 0 → launchd does NOT relaunch it. Under the old KeepAlive:true, every
# legitimate defer (exit 1) was treated as a crash and respawned every 15s, storming
# forever while a healthy holder existed (187 collisions in a day). The idle
# auto-exit uses a non-zero relaunch sentinel (70) so launchd still brings ETM back
# to catch a session resumed after the idle window. See the exit-code contract in
# scripts/enhanced-transcript-monitor.js.
#
# Mirrors scripts/install-lsl-lock-sweeper-launchd.sh: plutil -lint → copy (backup on
# diff) → kill stray instances → bootout-then-bootstrap → verify. Re-running is safe.

set -euo pipefail

REPO_ROOT="/Users/Q284340/Agentic/coding"
DEST_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${REPO_ROOT}/.logs"
UID_VAL="$(id -u)"
LABEL="com.coding.etm"

log() { printf '[install-etm] %s\n' "$*" >&2; }

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

# Kill ALL ETM instances at once so no lingering process holds the singleton lock
# (a fresh heartbeat from a dying holder would make the new instance defer-and-exit,
# leaving nothing running). The next bootstrap then registers cleanly.
if pgrep -f 'enhanced-transcript-monitor\.js' >/dev/null 2>&1; then
  log "${LABEL}: killing stray ETM instance(s) before bootstrap"
  pkill -9 -f 'enhanced-transcript-monitor\.js' 2>/dev/null || true
  sleep 1
fi

log "${LABEL}: bootstrap gui/${UID_VAL}"
if ! launchctl bootstrap "gui/${UID_VAL}" "${DEST_PLIST}"; then
  log "ERROR: launchctl bootstrap failed for ${LABEL}"
  exit 1
fi

# Bootstrap registration can lag a beat — retry the verify a few times.
loaded=0
for _ in 1 2 3 4 5; do
  if launchctl list | grep -qF "${LABEL}"; then loaded=1; break; fi
  sleep 1
done
if [[ "${loaded}" == "1" ]]; then
  log "OK: ${LABEL} is loaded"
else
  log "FAIL: ${LABEL} did not load — check Console.app or ${LOG_DIR}/etm.log"
  exit 1
fi

sleep 3
INSTANCES="$(pgrep -f 'enhanced-transcript-monitor\.js' | wc -l | tr -d ' ')"
log "live ETM instances: ${INSTANCES} (expect 1)"

log "installed. KeepAlive=SuccessfulExit:false (relaunch only on non-zero exit)"
log "  log:       ${LOG_DIR}/etm.log"
log "  follow:    tail -F ${LOG_DIR}/etm.log"
log "  kick now:  launchctl kickstart -k gui/${UID_VAL}/${LABEL}"
