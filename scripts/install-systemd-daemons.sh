#!/usr/bin/env bash
# Install coding's host daemons as systemd user units (Linux, WSL with systemd).
#
#   scripts/install-systemd-daemons.sh <daemon-id>...
#   scripts/install-systemd-daemons.sh obs-api health-coordinator
#
# The Linux twin of scripts/install-launchd-daemons.sh: same ids (lib/features/
# daemons.mjs's DAEMONS, asked by install.sh), templates in systemd/ instead of
# launchd/. Per id:
#
#   1. render systemd/<id>.service (and systemd/<id>.timer, for an interval job)
#      for THIS checkout and THIS node (scripts/lib/systemd-unit.sh)
#   2. installed copy identical and active -> nothing to do; a running daemon is
#                                             not restarted because the installer
#                                             ran again
#      different or absent                 -> install, daemon-reload, restart
#   3. enable --now the timer (interval jobs) or the service (long-running ones),
#      then poll until systemd reports it active
#
# Every id is attempted even when an earlier one fails; the exit status is
# non-zero if any did. Exit 3 means "no user service manager here" (WSL without
# systemd, a login without one) — install.sh turns that into a warning with the
# fix, rather than a failure of each daemon in turn.
set -euo pipefail

# shellcheck source=scripts/lib/systemd-unit.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/systemd-unit.sh"

log() { printf '[install-systemd-daemons] %s\n' "$*" >&2; }

if [[ "$(uname -s)" != "Linux" ]]; then
  log "not Linux — systemd units are not installed here: $*"
  exit 0
fi
if [[ $# -eq 0 ]]; then
  log "usage: $0 <daemon-id>...   (e.g. obs-api health-coordinator)"
  exit 2
fi
if ! systemd_user_available; then
  log "no systemd user manager — daemons NOT installed: $*"
  systemd_user_unavailable_hint >&2
  exit 3
fi

REPO_ROOT="${CODING_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
NODE_DIR=""
if command -v node >/dev/null 2>&1; then
  NODE_DIR="$(dirname "$(command -v node)")"
else
  log "node is not on PATH — the daemons run node and cannot start without it"
  exit 1
fi
RENDER_DIR="$(mktemp -d)"
trap 'rm -rf "${RENDER_DIR}"' EXIT
DEST_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
# The units log under both, like the plists; systemd's append: does not create
# the directory.
mkdir -p "${DEST_DIR}" "${REPO_ROOT}/.data" "${REPO_ROOT}/.logs"

# Render one unit file into RENDER_DIR. Prints "changed" when the installed copy
# differs (or is absent), nothing otherwise.
stage() {
  local file="$1"
  if ! render_unit "${REPO_ROOT}/systemd/${file}" "${RENDER_DIR}/${file}" "${REPO_ROOT}" "${NODE_DIR}"; then
    return 1
  fi
  if ! cmp -s "${RENDER_DIR}/${file}" "${DEST_DIR}/${file}"; then
    echo changed
  fi
}

# Phase 1: render and copy everything, so ONE daemon-reload covers all of it.
declare -A CHANGED=()
failed=()
ids=()
for id in "$@"; do
  id="${id#com.coding.}"
  if [[ ! -f "${REPO_ROOT}/systemd/${id}.service" ]]; then
    log "${id}: no template at ${REPO_ROOT}/systemd/${id}.service"
    failed+=("${id}")
    continue
  fi
  files=("${id}.service")
  [[ -f "${REPO_ROOT}/systemd/${id}.timer" ]] && files+=("${id}.timer")
  ok=1
  for f in "${files[@]}"; do
    if ! state="$(stage "$f")"; then ok=0; break; fi
    [[ "$state" == changed ]] && CHANGED[$id]=1
  done
  if [[ "$ok" -eq 0 ]]; then
    log "${id}: could not render its unit for ${REPO_ROOT}"
    failed+=("${id}")
    continue
  fi
  if [[ -n "${CHANGED[$id]:-}" ]]; then
    for f in "${files[@]}"; do cp "${RENDER_DIR}/${f}" "${DEST_DIR}/${f}"; done
  fi
  ids+=("${id}")
done

if [[ ${#CHANGED[@]} -gt 0 ]]; then
  systemctl --user daemon-reload
fi

# Phase 2: enable and (re)start.
for id in ${ids[@]+"${ids[@]}"}; do
  unit="${id}.service"
  [[ -f "${DEST_DIR}/${id}.timer" ]] && unit="${id}.timer"

  if [[ -z "${CHANGED[$id]:-}" ]] && systemctl --user is-active --quiet "${unit}"; then
    log "${id}: up to date and running"
    continue
  fi
  if ! out="$(systemctl --user enable "${unit}" 2>&1)"; then
    log "${id}: systemctl --user enable ${unit} failed: ${out}"
    failed+=("${id}")
    continue
  fi
  # restart, not start: a changed unit must replace the running instance, and
  # restart starts one that is not running.
  if ! out="$(systemctl --user restart "${unit}" 2>&1)"; then
    log "${id}: systemctl --user restart ${unit} failed: ${out}"
    log "${id}: why: journalctl --user -u ${id}.service -n 50"
    failed+=("${id}")
    continue
  fi
  active=""
  for _ in 1 2 3 4 5; do
    if systemctl --user is-active --quiet "${unit}"; then active=1; break; fi
    sleep 1
  done
  if [[ -n "${active}" ]]; then
    log "${id}: active (${unit})"
  else
    log "${id}: ${unit} did not become active — journalctl --user -u ${id}.service -n 50"
    failed+=("${id}")
  fi
done

# A user manager without lingering stops every unit at logout. Said once, not
# changed: enabling it is a machine-level setting that needs sudo.
if command -v loginctl >/dev/null 2>&1 \
   && [[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" == "no" ]]; then
  log "note: lingering is off for $(id -un), so these daemons stop when you log out."
  log "      To keep them running: sudo loginctl enable-linger $(id -un)"
fi

if [[ ${#failed[@]} -gt 0 ]]; then
  log "FAILED: ${failed[*]}"
  exit 1
fi
log "installed: $*"
