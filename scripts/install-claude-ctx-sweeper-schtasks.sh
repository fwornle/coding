#!/usr/bin/env bash
# Register the status-line temp-file sweeper as an hourly Windows Scheduled Task.
#
# WHY WINDOWS ONLY
# ----------------
# The sweep itself runs on every platform from the agent launch path (bin/coding), which
# needs no scheduler and mutates nothing. macOS purges /var/folders and Linux ships
# systemd-tmpfiles for /tmp, so on those two the launch-time sweep plus the OS is enough.
# Windows reclaims %TEMP% never. This task is what closes that gap — it is the only
# system-scope change the sweeper makes anywhere.
#
# The launch-time sweep is still the guarantee. If this task cannot be created — no
# schtasks, no rights, a locked-down host — that is a warning, not a failure: temp files
# are then reclaimed whenever an agent starts, which is the same behaviour every other
# platform gets.
#
# Deliberately NOT modelled on scripts/install-*-launchd.sh beyond its shape. Those
# hardcode REPO_ROOT="/Users/Q284340/Agentic/coding" and so only work on one machine;
# this derives the repo from its own location, because install.sh runs it on any host.
#
# Usage:
#   scripts/install-claude-ctx-sweeper-schtasks.sh [--dry-run] [--uninstall]

set -euo pipefail

TASK_NAME='\coding\claude-ctx-sweeper'
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SWEEPER="${REPO_ROOT}/scripts/claude-ctx-sweeper.mjs"

DRY_RUN=false
UNINSTALL=false
for arg in "$@"; do
    case "$arg" in
        --dry-run)   DRY_RUN=true ;;
        --uninstall) UNINSTALL=true ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

log() { printf '[claude-ctx-sweeper] %s\n' "$*" >&2; }

if ! command -v schtasks.exe >/dev/null 2>&1 && ! command -v schtasks >/dev/null 2>&1; then
    log "schtasks not found — this script is for Windows hosts only."
    log "On every platform the sweep also runs at agent launch, so nothing is lost."
    exit 1
fi
SCHTASKS="$(command -v schtasks.exe 2>/dev/null || command -v schtasks)"

if [[ "$UNINSTALL" == "true" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
        log "would run: ${SCHTASKS} /Delete /F /TN ${TASK_NAME}"
        exit 0
    fi
    # A task that was never created is the expected state on a machine where the user
    # declined it, so "not found" is success, not an error.
    "${SCHTASKS}" /Delete /F /TN "${TASK_NAME}" >/dev/null 2>&1 || true
    log "removed scheduled task ${TASK_NAME} (if it existed)"
    exit 0
fi

if [[ ! -f "${SWEEPER}" ]]; then
    log "ERROR: sweeper not found at ${SWEEPER}"
    exit 1
fi

# schtasks is a native Windows binary and does not understand the MSYS/Git-Bash view of
# the filesystem (/c/Users/...). cygpath is the documented translation; without it the
# task is created successfully and then fails at every run with a path error — the worst
# outcome, because it looks installed.
to_win_path() {
    if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

NODE_BIN="$(command -v node || true)"
if [[ -z "${NODE_BIN}" ]]; then
    log "ERROR: node not found on PATH — cannot build the task command"
    exit 1
fi

WIN_NODE="$(to_win_path "${NODE_BIN}")"
WIN_SWEEPER="$(to_win_path "${SWEEPER}")"
# Inner quotes are part of the command string schtasks stores, so a Windows path with
# spaces ("C:\Program Files\nodejs\node.exe") survives.
TASK_CMD="\"${WIN_NODE}\" \"${WIN_SWEEPER}\" --quiet"

if [[ "$DRY_RUN" == "true" ]]; then
    log "would run: ${SCHTASKS} /Create /F /SC HOURLY /TN ${TASK_NAME} /TR ${TASK_CMD}"
    exit 0
fi

# /F overwrites an existing task, which is what makes re-running this idempotent — the
# same role `launchctl bootout` before `bootstrap` plays in the macOS installers.
if ! "${SCHTASKS}" /Create /F /SC HOURLY /TN "${TASK_NAME}" /TR "${TASK_CMD}"; then
    log "WARN: could not create ${TASK_NAME} (rights, or policy)."
    log "      The sweep still runs at agent launch, so temp files are reclaimed anyway."
    exit 1
fi

if "${SCHTASKS}" /Query /TN "${TASK_NAME}" >/dev/null 2>&1; then
    log "OK: ${TASK_NAME} registered, hourly"
    log "  sweeps:  claude-ctx-*.json, claude-tmux-session-*.json in %TEMP%"
    log "  remove:  $0 --uninstall"
else
    log "WARN: ${TASK_NAME} was created but does not query back — verify by hand"
    exit 1
fi
