#!/bin/bash

# Generate Docker MCP Configuration
# Creates claude-code-mcp-docker.json with stdio proxies pointing to containerized SSE servers

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
CODE_GRAPH_RAG_PORT="${CODE_GRAPH_RAG_PORT:-3850}"

# Generate the Docker MCP configuration
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
    },
    "code-graph-rag": {
      "command": "$CODING_REPO/integrations/code-graph-rag/.venv/bin/python",
      "args": ["-m", "codebase_rag.mcp.stdio_proxy"],
      "env": {
        "CODE_GRAPH_RAG_SSE_URL": "http://localhost:$CODE_GRAPH_RAG_PORT"
      }
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/context7-mcp@latest"],
      "env": {}
    }
  }
}
EOF

log "Generated Docker MCP config: $OUTPUT_FILE"
log "Services configured:"
log "  - semantic-analysis -> http://localhost:$SEMANTIC_ANALYSIS_PORT"
log "  - constraint-monitor -> http://localhost:$CONSTRAINT_MONITOR_PORT"
log "  - code-graph-rag -> http://localhost:$CODE_GRAPH_RAG_PORT"
