#!/usr/bin/env bash
set -uo pipefail

# Launchd-side stale git-lock sweeper for the LSL history repo.
#
# Driven by ~/Library/LaunchAgents/com.coding.lsl-lock-sweeper.plist
# (StartInterval=60 + RunAtLoad). Clears orphaned `index.lock` files left in
# `.specstory/history/.git/` when a committer is killed mid-commit.
#
# WHY this exists: the nested `.specstory/history` repo is committed by MULTIPLE
# independent writers — the project's own live-logging/ETM committer AND the
# SpecStory IDE extension (`git -c user.useConfigOnly=true commit
# --allow-empty-message --file -`). When any is killed mid-commit (obs-api/ETM
# die on SIGTERM; VS Code reload), the index.lock orphans and every subsequent
# commit fails with "Unable to create '.../index.lock': File exists". A git hook
# can't fix this (the lock is held by the commit process itself), so an external
# periodic sweeper is the correct mechanism.
#
# SAFETY — a lock is removed ONLY when BOTH hold:
#   1. No LIVE git process holds it (lsof shows no `git` holder). A real commit
#      is sub-second; a git holder means an in-flight op — never touch it.
#   2. Its mtime is older than LSL_LOCK_STALE_SECS (default 90s). No legitimate
#      commit holds the index lock for 90s, so age alone proves orphanhood; the
#      lsof check is belt-and-suspenders against a hung git process.
# A non-git holder (e.g. Spotlight/mdworker reading the file) does NOT block
# removal — that was the exact observed state of the orphaned lock.
#
# Env overrides (tests + hand-driving):
#   LSL_LOCK_PATHS        space-separated lock files to sweep
#                         (default: <repo>/.specstory/history/.git/index.lock)
#   LSL_LOCK_STALE_SECS   min age in seconds before a lock is eligible (default 90)
#
# Mirrors scripts/sub-agent-sweep-job.sh conventions (Phase 54 LSL hardening).

REPO_ROOT="${CODING_REPO:-/Users/Q284340/Agentic/coding}"
STALE_SECS="${LSL_LOCK_STALE_SECS:-90}"
DEFAULT_LOCK="${REPO_ROOT}/.specstory/history/.git/index.lock"
LOCK_PATHS="${LSL_LOCK_PATHS:-${DEFAULT_LOCK}}"

log() { printf '[lsl-lock-sweeper][%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }

# Portable mtime-in-epoch-seconds. This host may carry EITHER BSD stat OR GNU
# coreutils stat (homebrew puts /opt/homebrew/bin first, and the plist PATH does
# too). The two use different flags AND fail dirtily: GNU `stat -f %m` does NOT
# error — it prints filesystem info and returns 0 — so a naive `A || B` captures
# garbage. Try each form and accept ONLY a numeric result.
file_mtime() {
  local m
  m="$(stat -c %Y "$1" 2>/dev/null)"        # GNU / coreutils
  if [[ "${m}" =~ ^[0-9]+$ ]]; then echo "${m}"; return; fi
  m="$(stat -f %m "$1" 2>/dev/null)"        # BSD
  if [[ "${m}" =~ ^[0-9]+$ ]]; then echo "${m}"; return; fi
  echo 0
}

# Is the file currently open by a LIVE `git` process? Returns 0 (yes) / 1 (no).
held_by_git() {
  local lock="$1" pid cmd
  # lsof -t lists holder PIDs; absent lsof or no holders → not held.
  for pid in $(lsof -t -- "${lock}" 2>/dev/null); do
    cmd="$(ps -p "${pid}" -o comm= 2>/dev/null)"
    cmd="${cmd##*/}" # basename
    case "${cmd}" in
      git|git-*) return 0 ;;
    esac
  done
  return 1
}

NOW="$(date -u +%s)"
removed=0
checked=0

for lock in ${LOCK_PATHS}; do
  checked=$((checked + 1))
  if [[ ! -e "${lock}" ]]; then
    continue # nothing to sweep
  fi

  if held_by_git "${lock}"; then
    log "SKIP ${lock} — held by a live git process (in-flight commit)"
    continue
  fi

  mtime="$(file_mtime "${lock}")"
  age=$((NOW - mtime))
  if (( age < STALE_SECS )); then
    log "SKIP ${lock} — only ${age}s old (< ${STALE_SECS}s); may be an in-flight commit"
    continue
  fi

  if rm -f "${lock}" 2>/dev/null; then
    removed=$((removed + 1))
    log "REMOVED stale lock ${lock} (age ${age}s, no git holder)"
  else
    log "WARN failed to remove ${lock} (age ${age}s) — permissions?"
  fi
done

log "sweep complete — checked ${checked}, removed ${removed}"
exit 0
