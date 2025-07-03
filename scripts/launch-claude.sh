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

# Load environment configuration
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

if [ -f "$PROJECT_DIR/.env.ports" ]; then
  set -a
  source "$PROJECT_DIR/.env.ports"
  set +a
fi

# Start all services using new lifecycle management
log "Starting coding services for Claude..."

# Check if Node.js is available
if ! command -v node &> /dev/null; then
  log "Error: Node.js is required but not found in PATH"
  exit 1
fi

# Start services using the new lifecycle manager
if ! node "$PROJECT_DIR/lib/services/start-services.js" --agent claude; then
  log "Error: Failed to start services"
  exit 1
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