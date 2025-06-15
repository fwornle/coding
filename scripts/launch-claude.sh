#!/bin/bash

# Launch Claude Code with MCP configuration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

log() {
  echo "[Claude] $1"
}

# Check for MCP sync requirement
if [ -f "$PROJECT_DIR/.mcp-sync/sync-required.json" ]; then
  log "MCP memory sync required, will be handled by Claude on startup"
fi

# Find MCP config
MCP_CONFIG=""
if [ -f "$PROJECT_DIR/claude-code-mcp-processed.json" ]; then
  MCP_CONFIG="$PROJECT_DIR/claude-code-mcp-processed.json"
elif [ -f "$HOME/.config/claude/claude_desktop_config.json" ]; then
  MCP_CONFIG="$HOME/.config/claude/claude_desktop_config.json"
elif [ -f "$HOME/Library/Application Support/Claude/claude_desktop_config.json" ]; then
  MCP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
fi

if [ -z "$MCP_CONFIG" ]; then
  log "Warning: No MCP configuration found. Some features may not work."
  log "Run './install.sh' to configure MCP servers."
fi

# Set environment variables
export CODING_AGENT="claude"
export CODING_TOOLS_PATH="$PROJECT_DIR"

# Launch Claude with MCP config
if [ -n "$MCP_CONFIG" ]; then
  log "Using MCP config: $MCP_CONFIG"
  exec claude-mcp "$@"
else
  log "Launching Claude without MCP config"
  exec claude "$@"
fi