#!/usr/bin/env bash
# Idempotent installer for the context-turns age-retention sweeper launchd job.
#
# Installs one job:
#   - com.coding.context-turns-sweeper   StartInterval=3600 + RunAtLoad, no KeepAlive
#
# Reclaims per-request context capture files (`context-turns.jsonl(.gz)` +
# `raw-bodies.jsonl(.gz)`) under `.data/measurements/<task_id>/` once they age
# past CONTEXT_TURNS_RETENTION_DAYS (default 14). See
# scripts/context-turns-sweeper-job.sh for the never-throw age-gate contract.
#
# Pitfall 4 (RESEARCH): a plist file on disk does NOT register the job — this
# installer MUST be run so launchctl bootstraps it into the gui domain.
#
# Mirrors scripts/install-lsl-lock-sweeper-launchd.sh: plutil -lint → copy
# (backup on diff) → bootout-then-bootstrap → verify. Re-running is safe.

set -euo pipefail

REPO_ROOT="/Users/Q284340/Agentic/coding"
DEST_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${REPO_ROOT}/.data"
UID_VAL="$(id -u)"
LABEL="com.coding.context-turns-sweeper"

log() { printf '[install-context-turns-sweeper] %s\n' "$*" >&2; }

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

# Capture `launchctl list` into a variable BEFORE grepping. Piping straight into
# `grep -qF` breaks under `set -o pipefail`: grep -q exits on the first match and
# closes the pipe, so the still-writing `launchctl list` dies with SIGPIPE (141)
# and pipefail propagates that non-zero status as a FALSE "did not load" failure
# (more likely the earlier the label sorts in launchctl's large output).
LAUNCHCTL_LIST="$(launchctl list || true)"
if grep -qF "${LABEL}" <<<"${LAUNCHCTL_LIST}"; then
  log "OK: ${LABEL} is loaded"
else
  log "FAIL: ${LABEL} did not load — check Console.app or ${LOG_DIR}/context-turns-sweeper.log"
  exit 1
fi

log "installed. cadence: every 3600s via StartInterval (+ RunAtLoad sweeps now)"
log "  retention: CONTEXT_TURNS_RETENTION_DAYS days (default 14)"
log "  log:       ${LOG_DIR}/context-turns-sweeper.log"
log "  follow:    tail -F ${LOG_DIR}/context-turns-sweeper.log"
log "  kick now:  launchctl kickstart -k gui/${UID_VAL}/${LABEL}"
