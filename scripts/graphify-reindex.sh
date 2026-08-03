#!/bin/bash
# Rebuild the graphify code graph, write progress + metadata, then reload the MCP
# server. Runs INSIDE coding-services (spawned by the dashboard "Re-index" button),
# so it calls the in-image graphify venv directly — no cross-container hop.
#
# Usage: graphify-reindex.sh [REPO_PATH] [MODE]
#   REPO_PATH  default /workspace/coding
#   MODE       "update" (incremental AST, default, fast) | "full" (code+docs via proxy)
set -uo pipefail

REPO="${1:-/workspace/coding}"
MODE="${2:-update}"
OUT="${GRAPHIFY_OUT:-/coding/.data/graphify/graphify-out}"
DIR="$(dirname "$OUT")"                 # .data/graphify
PROGRESS="$DIR/progress.json"
META="$DIR/metadata.json"
LOG="$DIR/reindex.log"
GRAPHIFY_BIN=/coding/integrations/graphify/.venv/bin/graphify
PYBIN=/coding/integrations/graphify/.venv/bin/python

mkdir -p "$OUT"

write_progress() {
    # $1=status $2=phase
    printf '{"status":"%s","phase":"%s","updatedAt":"%s"}\n' \
        "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PROGRESS"
}

write_progress running "Extracting code graph (${MODE})"
{
    echo "=== graphify-reindex $(date -u +%FT%TZ) mode=$MODE repo=$REPO ==="
    cd "$REPO" || exit 1
    if [ "$MODE" = "full" ]; then
        "$GRAPHIFY_BIN" extract "$REPO"
    else
        # Fast incremental — re-extract ONLY the files changed since the graph was
        # built (git diff against graph.json's built_at_commit + working tree),
        # preserving unchanged nodes. This is the same `_rebuild_code(changed_paths=…)`
        # path the graphify git-hook uses. It sidesteps the full-corpus re-parse:
        # JS/TS/Vue/Svelte bypass the per-file AST cache BY DESIGN (cross-file symbol
        # resolution over the live workspace), so a plain `graphify update` re-parses
        # ALL ~1300+ of them every run regardless of how little changed. Scoping to the
        # changed set makes it seconds instead of ~90s. Falls back to a full `update`
        # when there is no usable git baseline or the change set is large (>500).
        # Viz is skipped either way (GRAPHIFY_VIZ_NODE_LIMIT=0); clustering/communities
        # are kept intact.
        # Read the graph's built_at_commit. Retry once — right after a container
        # (re)start the 61MB graph.json read can transiently fail over the bind
        # mount, and an empty baseline needlessly falls back to a slow full scan.
        BUILT=""
        for _try in 1 2 3; do
            BUILT=$("$PYBIN" -c "import json;print(json.load(open('$OUT/graph.json')).get('built_at_commit') or '')" 2>>"$LOG" || true)
            [ -n "$BUILT" ] && break
            sleep 1
        done
        CHANGED=""
        if [ -n "$BUILT" ] && git cat-file -e "${BUILT}^{commit}" 2>/dev/null; then
            CHANGED=$( { git diff --name-only "$BUILT" HEAD; git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null | sort -u | sed '/^$/d' )
        fi
        NCHANGED=$(printf '%s' "$CHANGED" | grep -c . || true)
        if [ -n "$BUILT" ] && [ "${NCHANGED:-0}" -gt 0 ] && [ "${NCHANGED:-0}" -le 500 ]; then
            echo "Incremental (changed-files): ${NCHANGED} file(s) changed since ${BUILT} — re-extracting only those."
            GRAPHIFY_VIZ_NODE_LIMIT=0 GRAPHIFY_OUT="$OUT" GRAPHIFY_CHANGED="$CHANGED" "$PYBIN" - <<'PY'
import os
from pathlib import Path
from graphify.watch import _rebuild_code
changed = [Path(f.strip()) for f in os.environ.get('GRAPHIFY_CHANGED', '').splitlines() if f.strip()]
if not changed:
    raise SystemExit(0)
root = Path('.')
saved = Path(os.environ.get('GRAPHIFY_OUT', 'graphify-out')) / '.graphify_root'
if saved.exists():
    t = saved.read_text(encoding='utf-8').strip()
    if t:
        root = Path(t)
ok = _rebuild_code(root, changed_paths=changed, block_on_lock=True)
raise SystemExit(0 if ok else 1)
PY
        else
            echo "Incremental fallback -> full update (baseline='${BUILT}' changed=${NCHANGED:-0})."
            GRAPHIFY_VIZ_NODE_LIMIT=0 "$GRAPHIFY_BIN" update "$REPO"
        fi
    fi
} >> "$LOG" 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then
    write_progress failed "graphify ${MODE} exited ${rc} (see reindex.log)"
    exit "$rc"
fi

write_progress running "Writing metadata"
"$PYBIN" - "$OUT/graph.json" "$META" "$REPO" >> "$LOG" 2>&1 <<'PY'
import json, sys, subprocess, datetime
graph, meta, repo = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(graph))
commit = d.get("built_at_commit")
if not commit:
    try:
        commit = subprocess.check_output(["git", "-C", repo, "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        commit = None
nodes = len(d.get("nodes", []))
edges = len(d.get("links", d.get("edges", [])))
json.dump({
    "commit_hash": commit,
    "indexed_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "nodes": nodes,
    "edges": edges,
}, open(meta, "w"))
PY

# No MCP server restart needed: graphify's serve.py hot-reloads graph.json when
# its (mtime_ns, size) changes (serve.py:141,281), so the freshly-written graph
# is picked up on the next query with zero downtime. Restarting here was pure
# overhead (and the visible "graphify: stopped/started" churn).
write_progress completed "Code graph up to date"
