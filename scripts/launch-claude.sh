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

# Auto-start semantic-analysis agent system if needed
SEMANTIC_ANALYSIS_DIR="$PROJECT_DIR/semantic-analysis-system"
if [ -d "$SEMANTIC_ANALYSIS_DIR" ]; then
  # Check if agents are already running
  if ! pgrep -f "semantic-analysis-system/index.js" > /dev/null; then
    log "Starting semantic-analysis agent system..."
    
    # Check for API keys
    # First source main project .env if available
    if [ -f "$PROJECT_DIR/.env" ]; then
      source "$PROJECT_DIR/.env"
    fi
    
    # Then source semantic-analysis .env (allows override)
    if [ -f "$SEMANTIC_ANALYSIS_DIR/.env" ]; then
      source "$SEMANTIC_ANALYSIS_DIR/.env"
      
      # Check if at least one API key is configured
      if [ "$ANTHROPIC_API_KEY" = "your-anthropic-api-key" ] && [ "$OPENAI_API_KEY" = "your-openai-api-key" ]; then
        log "Warning: No API keys configured for semantic-analysis system"
        log "Please set ANTHROPIC_API_KEY and/or OPENAI_API_KEY in $SEMANTIC_ANALYSIS_DIR/.env"
      else
        # Start the agent system in background
        cd "$SEMANTIC_ANALYSIS_DIR"
        nohup npm run start:agents > "$SEMANTIC_ANALYSIS_DIR/logs/agents.log" 2>&1 &
        AGENT_PID=$!
        log "Agent system started with PID: $AGENT_PID"
        
        # Wait a moment for agents to initialize
        sleep 3
        
        # Store PID for cleanup
        echo $AGENT_PID > "$SEMANTIC_ANALYSIS_DIR/.agent.pid"
      fi
    else
      log "Warning: No .env file found for semantic-analysis system"
    fi
  else
    log "Agent system already running"
  fi
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