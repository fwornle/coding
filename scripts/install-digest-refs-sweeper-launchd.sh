#!/usr/bin/env bash
# Idempotent installer for the dangling-digest-refs sweeper launchd job.
#
# Installs one job:
#   - com.coding.digest-refs-sweeper   StartInterval=21600 (6h) + RunAtLoad, no KeepAlive
#
# Periodically runs scripts/prune-dangling-digest-refs.mjs --apply to filter each
# cold-store digest's `observationIds` down to ids that still resolve to an
# existing observation (retention continuously prunes observations, so refs
# dangle over time). See scripts/digest-refs-sweeper-job.sh for the never-throw
# contract and the single-owner self-healing-race note.
#
# Pitfall: a plist file on disk does NOT register the job — this installer MUST
# be run so launchctl bootstraps it into the gui domain.
#
# Mirrors scripts/install-context-turns-sweeper-launchd.sh: plutil -lint → copy
# (backup on diff) → bootout-then-bootstrap → verify. Re-running is safe.

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
LABEL="com.coding.digest-refs-sweeper"

log() { printf '[install-digest-refs-sweeper] %s\n' "$*" >&2; }

mkdir -p "${DEST_DIR}" "${LOG_DIR}"

SRC_PLIST="${REPO_ROOT}/launchd/${LABEL}.plist"
DEST_PLIST="${DEST_DIR}/${LABEL}.plist"

if [[ ! -f "${SRC_PLIST}" ]]; then
  log "ERROR: source plist not found at ${SRC_PLIST} — run from a clean checkout"
  exit 1
fi

# Render the checked-in template for THIS machine, then lint what was
# rendered — the template is not what launchd reads.
RENDERED="${RENDER_DIR}/${LABEL}.plist"
if ! render_plist "${SRC_PLIST}" "${RENDERED}" "${REPO_ROOT}"; then
  log "ERROR: could not render ${SRC_PLIST} for ${REPO_ROOT}"
  exit 1
fi

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

log "${LABEL}: boot-out (if loaded)"
launchctl bootout "gui/${UID_VAL}/${LABEL}" 2>/dev/null || true

log "${LABEL}: bootstrap gui/${UID_VAL}"
if ! launchctl bootstrap "gui/${UID_VAL}" "${DEST_PLIST}"; then
  log "ERROR: launchctl bootstrap failed for ${LABEL}"
  exit 1
fi

# Capture `launchctl list` into a variable BEFORE grepping — piping straight into
# `grep -qF` breaks under `set -o pipefail` (grep closes the pipe on first match,
# launchctl dies with SIGPIPE 141, pipefail reports a false "did not load").
LAUNCHCTL_LIST="$(launchctl list || true)"
if grep -qF "${LABEL}" <<<"${LAUNCHCTL_LIST}"; then
  log "OK: ${LABEL} is loaded"
else
  log "FAIL: ${LABEL} did not load — check Console.app or ${LOG_DIR}/digest-refs-sweeper.log"
  exit 1
fi

log "installed. cadence: every 21600s (6h) via StartInterval (+ RunAtLoad sweeps now)"
log "  log:      ${LOG_DIR}/digest-refs-sweeper.log"
log "  follow:   tail -F ${LOG_DIR}/digest-refs-sweeper.log"
log "  kick now: launchctl kickstart -k gui/${UID_VAL}/${LABEL}"
