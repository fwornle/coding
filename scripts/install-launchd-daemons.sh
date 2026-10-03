#!/usr/bin/env bash
# Install coding's host daemons as launchd agents (macOS).
#
#   scripts/install-launchd-daemons.sh <daemon-id>...
#   scripts/install-launchd-daemons.sh obs-api health-coordinator
#
# A daemon id is the label without its prefix: `obs-api` installs
# launchd/com.coding.obs-api.plist as com.coding.obs-api. Which ids a feature
# owns is lib/features/daemons.mjs's DAEMONS; install.sh asks it, so this script
# takes ids and never decides on its own what to install.
#
# This replaces five per-daemon installers that were the same steps copied, and
# only one of which (the sub-agent installer) had the retry below. Per id:
#
#   1. render the checked-in template for THIS checkout (scripts/lib/launchd-plist.sh)
#   2. installed copy identical and loaded  -> nothing to do; a running job is
#                                              not restarted just because the
#                                              installer ran again
#      identical but not loaded             -> load it
#      different or absent                  -> back up the old copy, install,
#                                              reload
#   3. poll until launchd lists the label
#
# Every id is attempted even when an earlier one fails; the exit status is
# non-zero if any did. On Linux/Windows it does nothing and says so — these
# daemons are launchd agents, and the other platforms' installers live in
# install.sh beside each feature.
set -euo pipefail

# shellcheck source=scripts/lib/launchd-plist.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/launchd-plist.sh"

log() { printf '[install-launchd-daemons] %s\n' "$*" >&2; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  log "not macOS — launchd daemons are not installed here: $*"
  exit 0
fi
if [[ $# -eq 0 ]]; then
  log "usage: $0 <daemon-id>...   (e.g. obs-api health-coordinator)"
  exit 2
fi

REPO_ROOT="$(launchd_repo_root)"
RENDER_DIR="$(mktemp -d)"
trap 'rm -rf "${RENDER_DIR}"' EXIT
DEST_DIR="${HOME}/Library/LaunchAgents"
UID_VAL="$(id -u)"
# The templates log under both: the sub-agent daemons and sweepers to .data/,
# the long-running services to .logs/. launchd will not create either.
mkdir -p "${DEST_DIR}" "${REPO_ROOT}/.data" "${REPO_ROOT}/.logs"

if ! command -v node >/dev/null 2>&1; then
  log "WARN: node not on PATH — the daemons start node via PATH and will fail until it is installed"
fi

# Read the list first, then match. `launchctl list | grep -q` under pipefail
# reports a LOADED job as missing: grep -q exits at the first match, launchctl
# dies of SIGPIPE, and the pipeline's status is launchctl's.
is_loaded() {
  local listing
  listing="$(launchctl list 2>/dev/null || true)"
  grep -qF "$1" <<<"${listing}"
}

install_one() {
  local id="$1"
  local label="com.coding.${id}"
  local src="${REPO_ROOT}/launchd/${label}.plist"
  local dest="${DEST_DIR}/${label}.plist"
  local rendered="${RENDER_DIR}/${label}.plist"

  if [[ ! -f "${src}" ]]; then
    log "${id}: no template at ${src}"
    return 1
  fi
  if ! render_plist "${src}" "${rendered}" "${REPO_ROOT}"; then
    log "${id}: could not render ${src} for ${REPO_ROOT}"
    return 1
  fi

  if [[ -f "${dest}" ]] && /usr/bin/diff -q "${rendered}" "${dest}" >/dev/null 2>&1; then
    if is_loaded "${label}"; then
      log "${id}: up to date and running"
      return 0
    fi
    log "${id}: up to date, not loaded — loading"
  else
    if [[ -f "${dest}" ]]; then
      local backup
      backup="${dest}.bak.$(date +%Y%m%d-%H%M%S)"
      cp "${dest}" "${backup}"
      log "${id}: replacing a different installed copy (backup: ${backup})"
    fi
    cp "${rendered}" "${dest}"
    launchctl bootout "gui/${UID_VAL}/${label}" 2>/dev/null || true
  fi

  # `bootout` returns once the SIGTERM is delivered, not once the process is
  # gone, and bootstrapping a label whose previous instance is still exiting
  # fails with `Bootstrap failed: 5: Input/output error` (2026-09-02: the first
  # label errored, set -e aborted, the rest stayed on the old version). Retry
  # instead of sleeping blindly.
  local attempt
  for attempt in 1 2 3 4 5; do
    if launchctl bootstrap "gui/${UID_VAL}" "${dest}" 2>/dev/null; then
      break
    fi
    if [[ "${attempt}" -eq 5 ]]; then
      log "${id}: launchctl bootstrap failed after 5 attempts:"
      launchctl bootstrap "gui/${UID_VAL}" "${dest}" || true
      return 1
    fi
    sleep 1
  done

  # A label can be accepted a beat before `launchctl list` reports it; one
  # check right after bootstrap called a running job dead (2026-09-02).
  for attempt in 1 2 3 4 5; do
    if is_loaded "${label}"; then
      log "${id}: loaded"
      return 0
    fi
    sleep 1
  done
  log "${id}: did not load — see Console.app or the log path in ${dest}"
  return 1
}

failed=()
for id in "$@"; do
  id="${id#com.coding.}"
  install_one "${id}" || failed+=("${id}")
done

if [[ ${#failed[@]} -gt 0 ]]; then
  log "FAILED: ${failed[*]}"
  exit 1
fi
log "installed: $*"
