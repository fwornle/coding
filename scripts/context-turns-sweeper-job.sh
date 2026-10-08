#!/usr/bin/env bash
set -uo pipefail

# Launchd-side age-based retention sweeper for per-turn capture files.
#
# Driven by ~/Library/LaunchAgents/com.coding.context-turns-sweeper.plist
# (StartInterval=3600 + RunAtLoad). Reclaims two independent families of per-turn
# capture file once they age past the retention window:
#
#   1. `context-turns.jsonl(.gz)` + `raw-bodies.jsonl(.gz)` under
#      `<LLM_PROXY_DATA_DIR>/measurements/<task_id>/` — the request-body context capture.
#   2. `<task_id>.jsonl` (+ superseded legacy `<task_id>.json`) in the FLAT
#      `.data/retrieval-captures/` dir — the per-turn KB injection capture
#      (what was retrieved, what was dropped, and at which stage).
#
# Both carry user prompt text, so both get the same bounded retention.
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
#   CODING_REPO                   repo root (default the script's own checkout)
#   LLM_PROXY_DATA_DIR            data root the proxy writes to (default
#                                 proxyDataDir() — `<dataHome>/var`, resolved the
#                                 same way the writer does; the old `<CODING_REPO>/
#                                 .data` default swept an empty directory).
#   CONTEXT_TURNS_RETENTION_DAYS  retention window in days before a file is
#                                 eligible for deletion (default 14)
#
# The sweep itself is lib/measurement/context-turns-retention.mjs (shared with glass,
# which runs it from an in-process timer); this script stays the launchd entry point.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "${SCRIPT_DIR}/../lib/measurement/context-turns-retention.mjs" \
  || printf '[context-turns-sweeper] WARN node sweep failed (exit %s)\n' "$?" >&2
exit 0
