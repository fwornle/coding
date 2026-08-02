#!/bin/sh
# Entrypoint for the coding-graphify container.
#   1. Ensure a graph.json exists (bootstrap a fast, offline code-only extract on
#      first boot). Full doc/PDF enrichment happens later via `graphify update`
#      (dashboard "Re-index" button / manual), which routes docs through the proxy.
#   2. Serve the graph over the HTTP MCP transport.
# If bootstrap fails (e.g. no repo mounted yet) we keep the container alive so
# `docker exec coding-graphify graphify extract …` can build the graph manually.
set -e

GRAPHIFY_OUT="${GRAPHIFY_OUT:-/coding/.data/graphify/graphify-out}"
GRAPH="${GRAPHIFY_OUT}/graph.json"
TARGET="${GRAPHIFY_TARGET:-/workspace/coding}"
PORT="${GRAPHIFY_MCP_PORT:-3851}"
export GRAPHIFY_OUT

mkdir -p "${GRAPHIFY_OUT}"

if [ ! -f "${GRAPH}" ]; then
    echo "[graphify] no graph.json at ${GRAPH} — bootstrapping code-only extract of ${TARGET}"
    # Run from inside the target repo so graphify's `git rev-parse HEAD` resolves
    # and stamps built_at_commit (the dashboard "commits behind" anchor). Output
    # still goes to the absolute GRAPHIFY_OUT under the writable .data mount.
    ( cd "${TARGET}" && graphify extract "${TARGET}" --code-only ) \
        || echo "[graphify] bootstrap extract failed — start it manually via: docker exec -w ${TARGET} coding-graphify graphify extract ${TARGET}"
fi

if [ -f "${GRAPH}" ]; then
    echo "[graphify] serving ${GRAPH} on http://0.0.0.0:${PORT}/mcp (Streamable HTTP MCP)"
    exec python -m graphify.serve "${GRAPH}" --transport http --host 0.0.0.0 --port "${PORT}" --path /mcp
else
    echo "[graphify] graph.json still missing — container staying up for manual extract"
    exec tail -f /dev/null
fi
