#!/bin/sh
# Supervisord command for the graphify code-graph MCP server (inside coding-services).
#   1. Bootstrap a fast, offline code-only extract if no graph.json exists yet.
#      (Runs from the repo CWD so graphify stamps built_at_commit — the dashboard
#      "commits behind" anchor.) Full doc/PDF enrichment happens later via the
#      dashboard "Re-index" button (`graphify update`, routed through the proxy).
#   2. Serve the graph over the Streamable HTTP MCP transport.
set -e

GRAPHIFY_OUT="${GRAPHIFY_OUT:-/coding/.data/graphify/graphify-out}"
GRAPH="${GRAPHIFY_OUT}/graph.json"
DIR="$(dirname "${GRAPHIFY_OUT}")"          # .data/graphify
META="${DIR}/metadata.json"
TARGET="${GRAPHIFY_TARGET:-/workspace/coding}"
PORT="${GRAPHIFY_MCP_PORT:-3851}"
VENV=/coding/integrations/graphify/.venv
export GRAPHIFY_OUT

mkdir -p "${GRAPHIFY_OUT}"

if [ ! -f "${GRAPH}" ]; then
    echo "[graphify] no graph.json — bootstrapping code-only extract of ${TARGET}"
    ( cd "${TARGET}" && "${VENV}/bin/graphify" extract "${TARGET}" --code-only ) \
        || echo "[graphify] bootstrap extract failed — trigger it from the dashboard Re-index button or: docker exec coding-services graphify extract ${TARGET}"
fi

# Ensure the dashboard's tiny metadata sidecar (commit + counts) exists so the
# "commits behind" tile never has to parse the 35 MB graph.json on every poll.
if [ -f "${GRAPH}" ] && [ ! -f "${META}" ]; then
    "${VENV}/bin/python" - "${GRAPH}" "${META}" "${TARGET}" <<'PY' || true
import json, sys, subprocess, datetime
graph, meta, repo = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(graph))
commit = d.get("built_at_commit")
if not commit:
    try:
        commit = subprocess.check_output(["git", "-C", repo, "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        commit = None
json.dump({
    "commit_hash": commit,
    "indexed_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "nodes": len(d.get("nodes", [])),
    "edges": len(d.get("links", d.get("edges", []))),
}, open(meta, "w"))
PY
fi

if [ -f "${GRAPH}" ]; then
    echo "[graphify] serving ${GRAPH} on http://0.0.0.0:${PORT}/mcp (Streamable HTTP MCP)"
    exec "${VENV}/bin/python" -m graphify.serve "${GRAPH}" --transport http --host 0.0.0.0 --port "${PORT}" --path /mcp
else
    echo "[graphify] graph.json still missing — idling so the graph can be built manually"
    exec tail -f /dev/null
fi
