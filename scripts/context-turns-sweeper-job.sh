#!/usr/bin/env bash
set -uo pipefail

# Launchd-side age-based retention sweeper for per-turn context-turns capture.
#
# Driven by ~/Library/LaunchAgents/com.coding.context-turns-sweeper.plist
# (StartInterval=3600 + RunAtLoad). Reclaims per-request context capture files
# (`context-turns.jsonl(.gz)` + `raw-bodies.jsonl(.gz)`) under
# `.data/measurements/<task_id>/` once they age past the retention window.
#
# WHY this exists (Phase 84, D-01/D-02): the per-turn context capture writes
# potentially large (and secrets-bearing, pre-redaction) request bodies. Cleanup
# tied to span close is not enough — an abandoned or never-closed span would
# leave its files forever. This sweeper is DECOUPLED from span close and reclaims
# by AGE alone, so honest, bounded retention holds regardless of span lifecycle.
#
# SAFETY / never-throw: a bad or missing measurements dir, or an unreadable file,
# must never abort the run or crash the daemon. `set -uo pipefail` + per-file
# best-effort delete + `exit 0` always (T-84-03-01 mitigation).
#
# Per-file mtime is independent (D-05 intent): a stale `raw-bodies.jsonl.gz`
# (secrets-bearing) can be reclaimed on schedule even while a companion
# `context-turns.jsonl` digest is still fresh, and vice-versa.
#
# Env overrides (tests + hand-driving):
#   CODING_REPO                   repo root (default /Users/Q284340/Agentic/coding)
#   CONTEXT_TURNS_RETENTION_DAYS  retention window in days before a file is
#                                 eligible for deletion (default 14)
#
# Mirrors scripts/lsl-lock-sweeper-job.sh conventions (Phase 54 LSL hardening).

REPO_ROOT="${CODING_REPO:-/Users/Q284340/Agentic/coding}"
RETENTION_DAYS="${CONTEXT_TURNS_RETENTION_DAYS:-14}"
STALE_SECS=$((RETENTION_DAYS * 86400))
MEASUREMENTS_DIR="${REPO_ROOT}/.data/measurements"

# Per-task capture files we reclaim by age. Each is independent.
TARGET_NAMES=(
  "context-turns.jsonl"
  "context-turns.jsonl.gz"
  "raw-bodies.jsonl"
  "raw-bodies.jsonl.gz"
)

log() { printf '[context-turns-sweeper][%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }

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

NOW="$(date -u +%s)"
removed=0
checked=0

if [[ ! -d "${MEASUREMENTS_DIR}" ]]; then
  log "measurements dir absent (${MEASUREMENTS_DIR}) — nothing to sweep"
  exit 0
fi

# Walk each per-task subdir; age-gate each target file independently.
for task_dir in "${MEASUREMENTS_DIR}"/*/; do
  [[ -d "${task_dir}" ]] || continue    # glob-nomatch or non-dir → skip
  for name in "${TARGET_NAMES[@]}"; do
    file="${task_dir}${name}"
    [[ -e "${file}" ]] || continue
    checked=$((checked + 1))

    mtime="$(file_mtime "${file}")"
    age=$((NOW - mtime))
    if (( age < STALE_SECS )); then
      log "SKIP ${file} — only ${age}s old (< ${STALE_SECS}s retention)"
      continue
    fi

    if rm -f "${file}" 2>/dev/null; then
      removed=$((removed + 1))
      log "REMOVED aged file ${file} (age ${age}s >= ${STALE_SECS}s)"
    else
      log "WARN failed to remove ${file} (age ${age}s) — permissions?"
    fi
  done
done

log "sweep complete — retention ${RETENTION_DAYS}d, checked ${checked}, removed ${removed}"
exit 0
