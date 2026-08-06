#!/usr/bin/env bash
# Per-backend acceptance gate.
#
#   scripts/backend-smoke.sh <backend> [--full]
#
# The graphify lesson: prove a backend performs BEFORE committing to it, not after.
# graphify needed a fork and two perf fixes, and that only surfaced once it was
# already load-bearing.
#
# Writes .data/<backend>/smoke.json. Thresholds are relative to graphify where a
# comparison exists, because absolutes do not transfer between machines.
#
# Deliberately NOT a correctness benchmark and NOT a token-efficiency measure — token
# efficiency is exactly what kgbench exists to decide, and pre-judging it here would
# bias the thing the gate is meant to feed.
set -uo pipefail

BACKEND="${1:-}"
MODE="${2:-}"
[ -z "$BACKEND" ] && { echo "usage: backend-smoke.sh <backend> [--full]" >&2; exit 2; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${CODING_CONTAINER:-coding-services}"
OUT_DIR="$REPO/.data/code-graph-meta/$BACKEND"
OUT="$OUT_DIR/smoke.json"
mkdir -p "$OUT_DIR"

fail() { echo "  FAIL  $1"; FAILURES="${FAILURES}${1}; "; }
pass() { echo "  ok    $1"; }
FAILURES=""

echo "backend-smoke: $BACKEND"

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
    echo "  container '$CONTAINER' not running — cannot gate a container-side backend" >&2
    exit 1
fi

# --- registry sanity --------------------------------------------------------
if ! node "$REPO/scripts/code-graph-config.mjs" get "$BACKEND" >/dev/null 2>&1; then
    echo "  '$BACKEND' is not in config/code-graph.json" >&2
    exit 2
fi
BIN="$(node -e '
  const {loadRegistry,getBackend}=await import(process.argv[1]+"/lib/code-graph/registry.mjs");
  const b=getBackend(loadRegistry(process.argv[1]),process.argv[2]);
  process.stdout.write(b.mcp.transport==="stdio" ? b.mcp.args[b.mcp.args.length-3] ?? b.id : b.id);
' --input-type=module "$REPO" "$BACKEND" 2>/dev/null || echo "$BACKEND")"

# --- M1: cold index ---------------------------------------------------------
if [ "$MODE" = "--full" ]; then
    echo "  cold index (wiping existing artifact)..."
    docker exec "$CONTAINER" sh -c "rm -rf /coding/.data/$BACKEND/*.db /coding/.data/$BACKEND/*.db-*" 2>/dev/null
    T0=$(date +%s)
    docker exec "$CONTAINER" "${BACKEND}-index.sh" full >/dev/null 2>&1 || fail "cold index failed"
    COLD=$(( $(date +%s) - T0 ))
    pass "cold index ${COLD}s"
else
    COLD=null
    echo "  cold index skipped (pass --full to measure)"
fi

# --- M2: incremental --------------------------------------------------------
T0=$(date +%s)
docker exec "$CONTAINER" "${BACKEND}-index.sh" update >/dev/null 2>&1 || fail "incremental update failed"
INCR=$(( $(date +%s) - T0 ))
pass "incremental update ${INCR}s"

# --- M3: artifact size ------------------------------------------------------
ART_BYTES=$(docker exec "$CONTAINER" sh -c "du -sb /coding/.data/$BACKEND 2>/dev/null | cut -f1" 2>/dev/null || echo 0)
pass "artifact $(( ART_BYTES / 1024 / 1024 )) MB"

# --- M5: MCP cold start -----------------------------------------------------
# Paid on EVERY agent session for a stdio backend, so a slow handshake is a tax on
# every interaction, not a one-off. >5s is disqualifying regardless of query wins.
T0=$(date +%s%3N 2>/dev/null || date +%s000)
HANDSHAKE=$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
    | timeout 30 docker exec -i "$CONTAINER" codegraph serve --mcp 2>/dev/null | head -c 2000)
T1=$(date +%s%3N 2>/dev/null || date +%s000)
MCP_MS=$(( T1 - T0 ))
if echo "$HANDSHAKE" | grep -q '"result"'; then
    pass "MCP handshake ${MCP_MS}ms"
    [ "$MCP_MS" -gt 5000 ] && fail "MCP cold start ${MCP_MS}ms exceeds the 5s per-session budget"
else
    fail "MCP handshake produced no result"
    MCP_MS=null
fi

# --- M9: graceful degradation ----------------------------------------------
# A crashing stdio server takes the agent's whole MCP list red, unlike HTTP which
# fails per call. It must error cleanly when the index is absent.
DEGRADE=$(docker exec "$CONTAINER" sh -c "cd /tmp && printf '%s\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"s\",\"version\":\"0\"}}}' | timeout 20 codegraph serve --mcp 2>&1 | head -c 400" 2>&1)
if echo "$DEGRADE" | grep -qE '"result"|"error"'; then
    pass "degrades cleanly with no index in cwd"
else
    fail "no clean JSON-RPC response when index is absent"
fi

# --- verdict ----------------------------------------------------------------
STATUS="pass"; [ -n "$FAILURES" ] && STATUS="fail"

cat > "$OUT" <<EOF
{
  "backend": "$BACKEND",
  "status": "$STATUS",
  "measured_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "cold_index_s": ${COLD},
  "incremental_s": ${INCR},
  "artifact_bytes": ${ART_BYTES:-0},
  "mcp_cold_start_ms": ${MCP_MS},
  "failures": "$(echo "$FAILURES" | sed 's/"/\\"/g')"
}
EOF

echo
echo "backend-smoke: $BACKEND -> $STATUS  ($OUT)"
[ "$STATUS" = "pass" ] || { echo "  failures: $FAILURES"; exit 1; }
