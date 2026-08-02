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
        "$GRAPHIFY_BIN" update "$REPO"
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

write_progress running "Reloading MCP server"
# Program lives in the mcp-servers group -> must use the group-qualified name.
supervisorctl -c /etc/supervisor/conf.d/supervisord.conf restart mcp-servers:graphify >> "$LOG" 2>&1 || true

write_progress completed "Code graph up to date"
