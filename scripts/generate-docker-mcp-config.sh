#!/bin/bash

# Generate Docker MCP Configuration
# Creates claude-code-mcp-docker.json with stdio proxies pointing to containerized SSE servers
#
# The code-graph server entry is NOT hardcoded here: it comes from config/code-graph.json
# via scripts/code-graph-config.mjs, so switching backends is a config change rather than
# an edit to this script. If the registry or node is unavailable the generator falls back
# to the literal graphify block — a broken registry must never leave agents with no MCP
# config at all.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_REPO="$(dirname "$SCRIPT_DIR")"

OUTPUT_FILE="$CODING_REPO/claude-code-mcp-docker.json"

log() {
  echo "[Docker MCP Config] $1"
}

log "Generating Docker MCP configuration..."

# Read the base config to preserve non-Docker servers
BASE_CONFIG="$CODING_REPO/claude-code-mcp-processed.json"
if [ ! -f "$BASE_CONFIG" ]; then
  BASE_CONFIG="$CODING_REPO/claude-code-mcp.json"
fi

# Port configuration
SEMANTIC_ANALYSIS_PORT="${SEMANTIC_ANALYSIS_PORT:-3848}"
CONSTRAINT_MONITOR_PORT="${CONSTRAINT_MONITOR_PORT:-3849}"
GRAPHIFY_MCP_PORT="${GRAPHIFY_MCP_PORT:-3851}"

# Resolve the active code-graph backend's MCP entry, as {"<serverName>": {...}}.
CODE_GRAPH_ENTRY=""
CODE_GRAPH_BACKEND_ID="(fallback)"
if command -v node >/dev/null 2>&1 && [ -f "$CODING_REPO/config/code-graph.json" ]; then
  if CODE_GRAPH_ENTRY="$(node "$SCRIPT_DIR/code-graph-config.mjs" mcp-entry --agent claude --flavor claude --named 2>/dev/null)"; then
    CODE_GRAPH_BACKEND_ID="$(node "$SCRIPT_DIR/code-graph-config.mjs" active --agent claude 2>/dev/null || echo unknown)"
  else
    CODE_GRAPH_ENTRY=""
  fi
fi

if [ -z "$CODE_GRAPH_ENTRY" ]; then
  log "WARNING: code-graph registry unavailable — falling back to the literal graphify entry"
  CODE_GRAPH_ENTRY="{\"graphify\": {\"type\": \"http\", \"url\": \"http://localhost:$GRAPHIFY_MCP_PORT/mcp\"}}"
fi

# Generate the Docker MCP configuration. The two stdio proxies are static; the
# code-graph entry is merged in from the registry.
cat > "$OUTPUT_FILE" << EOF
{
  "mcpServers": {
    "semantic-analysis": {
      "command": "node",
      "args": ["$CODING_REPO/integrations/mcp-server-semantic-analysis/dist/stdio-proxy.js"],
      "env": {
        "SEMANTIC_ANALYSIS_SSE_URL": "http://localhost:$SEMANTIC_ANALYSIS_PORT",
        "CODING_REPO": "$CODING_REPO"
      }
    },
    "constraint-monitor": {
      "command": "node",
      "args": ["$CODING_REPO/integrations/mcp-constraint-monitor/src/stdio-proxy.js"],
      "env": {
        "CONSTRAINT_MONITOR_SSE_URL": "http://localhost:$CONSTRAINT_MONITOR_PORT",
        "CODING_REPO": "$CODING_REPO"
      }
    }
  }
}
EOF

# Splice the code-graph entry in. Done as a merge rather than string interpolation so a
# stdio backend (command + args array) renders as valid JSON just like an http one.
if command -v node >/dev/null 2>&1; then
  CODE_GRAPH_ENTRY="$CODE_GRAPH_ENTRY" node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    Object.assign(cfg.mcpServers, JSON.parse(process.env.CODE_GRAPH_ENTRY));
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  ' "$OUTPUT_FILE"
else
  log "WARNING: node not found — code-graph server omitted from $OUTPUT_FILE"
fi

log "Generated Docker MCP config: $OUTPUT_FILE"
log "Services configured:"
log "  - semantic-analysis -> http://localhost:$SEMANTIC_ANALYSIS_PORT"
log "  - constraint-monitor -> http://localhost:$CONSTRAINT_MONITOR_PORT"
log "  - code-graph backend: $CODE_GRAPH_BACKEND_ID"
