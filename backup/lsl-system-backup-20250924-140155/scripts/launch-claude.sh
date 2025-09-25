#!/bin/bash

# Launch Claude Code with MCP configuration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_REPO="$(dirname "$SCRIPT_DIR")"

log() {
  echo "[Claude] $1"
}

ensure_statusline_config() {
  local target_project="$1"
  local coding_repo="$2"
  local claude_dir="$target_project/.claude"
  local settings_file="$claude_dir/settings.local.json"
  
  # Skip if we're in the coding repo itself (already has config)
  if [ "$target_project" = "$coding_repo" ]; then
    return 0
  fi
  
  # Create .claude directory if it doesn't exist
  if [ ! -d "$claude_dir" ]; then
    mkdir -p "$claude_dir"
    log "Created .claude directory in project"
  fi
  
  # Check if settings file exists
  if [ ! -f "$settings_file" ]; then
    # Create minimal settings file with statusLine config
    cat > "$settings_file" << EOF
{
  "permissions": {
    "allow": [
      "CODING_REPO=$coding_repo node $coding_repo/scripts/combined-status-line.js"
    ],
    "additionalDirectories": []
  },
  "statusLine": {
    "type": "command",
    "command": "CODING_REPO=$coding_repo node $coding_repo/scripts/combined-status-line.js"
  }
}
EOF
    log "Created .claude/settings.local.json with statusLine config"
  else
    # Check if statusLine is missing and add it
    if ! grep -q '"statusLine"' "$settings_file" 2>/dev/null; then
      # Use jq to add statusLine config if jq is available
      if command -v jq >/dev/null 2>&1; then
        local temp_file=$(mktemp)
        jq ". + {\"statusLine\": {\"type\": \"command\", \"command\": \"CODING_REPO=$coding_repo node $coding_repo/scripts/combined-status-line.js\"}}" "$settings_file" > "$temp_file"
        mv "$temp_file" "$settings_file"
        log "Added statusLine config to existing settings"
      else
        # Fallback: add statusLine before the closing brace
        sed -i.backup 's/}$/,\n  "statusLine": {\n    "type": "command",\n    "command": "CODING_REPO='"$coding_repo"' node '"$coding_repo"'\/scripts\/combined-status-line.js"\n  }\n}/' "$settings_file"
        log "Added statusLine config to existing settings (fallback method)"
      fi
    fi
    
    # Ensure the permission is present
    if ! grep -q "CODING_REPO.*combined-status-line.js" "$settings_file" 2>/dev/null; then
      log "Warning: statusLine permission may need to be added manually to .claude/settings.local.json"
    fi
  fi
}

# Use target project directory if specified, otherwise use coding repo
if [ -n "$CODING_PROJECT_DIR" ]; then
  TARGET_PROJECT_DIR="$CODING_PROJECT_DIR"
  log "Target project: $TARGET_PROJECT_DIR"
  log "Coding services from: $CODING_REPO"
else
  TARGET_PROJECT_DIR="$CODING_REPO"
  log "Working in coding repository: $TARGET_PROJECT_DIR"
fi

# Ensure statusLine config is present in target project
ensure_statusline_config "$TARGET_PROJECT_DIR" "$CODING_REPO"

show_session_reminder() {
  # Check target project directory first
  local target_specstory_dir="$TARGET_PROJECT_DIR/.specstory/history"
  local coding_specstory_dir="$CODING_REPO/.specstory/history"
  
  local latest_session=""
  local session_location=""
  
  # Look for recent sessions in target project
  if [ -d "$target_specstory_dir" ]; then
    latest_session=$(ls -t "$target_specstory_dir"/*.md 2>/dev/null | head -1)
    if [ -n "$latest_session" ]; then
      session_location="target project"
    fi
  fi
  
  # Also check coding repo for comparison
  if [ -d "$coding_specstory_dir" ]; then
    local coding_session=$(ls -t "$coding_specstory_dir"/*.md 2>/dev/null | head -1)
    if [ -n "$coding_session" ]; then
      # Compare timestamps if both exist
      if [ -n "$latest_session" ]; then
        if [ "$coding_session" -nt "$latest_session" ]; then
          latest_session="$coding_session"
          session_location="coding repo"
        fi
      else
        latest_session="$coding_session"
        session_location="coding repo"
      fi
    fi
  fi
  
  if [ -n "$latest_session" ] && [ -f "$latest_session" ]; then
    local session_file=$(basename "$latest_session")
    echo "📋 Latest session log: $session_file ($session_location)"
    echo "💡 Reminder: Ask Claude to read the session log for continuity"
    echo ""
  fi
}

# Check for MCP sync requirement (always from coding repo)
if [ -f "$CODING_REPO/.mcp-sync/sync-required.json" ]; then
  log "MCP memory sync required, will be handled by Claude on startup"
fi

# Load environment configuration (from coding repo)
if [ -f "$CODING_REPO/.env" ]; then
  set -a
  source "$CODING_REPO/.env"
  set +a
fi

if [ -f "$CODING_REPO/.env.ports" ]; then
  set -a
  source "$CODING_REPO/.env.ports"
  set +a
fi

# Start all services using simple startup script
log "Starting coding services for Claude..."

# Check if Node.js is available
if ! command -v node &> /dev/null; then
  log "Error: Node.js is required but not found in PATH"
  exit 1
fi

# Start services using the simple startup script (from coding repo)
if ! "$CODING_REPO/start-services.sh"; then
  log "Error: Failed to start services"
  exit 1
fi

# Global LSL Coordinator for robust transcript monitoring
start_transcript_monitoring() {
  local project_dir="$1" 
  local coding_repo="$2"
  
  log "Using Global LSL Coordinator for robust transcript monitoring: $(basename "$project_dir")"
  
  # Create .specstory directory if needed
  if [ ! -d "$project_dir/.specstory/history" ]; then
    mkdir -p "$project_dir/.specstory/history"
  fi
  
  # Use global coordinator to ensure robust LSL
  if node "$coding_repo/scripts/global-lsl-coordinator.cjs" ensure "$project_dir" $$; then
    log "Global LSL Coordinator: LSL setup successful"
  else
    log "Warning: Global LSL Coordinator setup failed, falling back to direct monitor"
    
    # Fallback: direct monitor startup (backward compatibility)
    pkill -f "enhanced-transcript-monitor.js.*$(basename "$project_dir")" 2>/dev/null || true
    cd "$project_dir"
    nohup node "$coding_repo/scripts/enhanced-transcript-monitor.js" > transcript-monitor.log 2>&1 &
    local new_pid=$!
    
    sleep 1
    if kill -0 "$new_pid" 2>/dev/null; then
      log "Fallback transcript monitoring started (PID: $new_pid)"
    else
      log "Error: Both coordinator and fallback transcript monitoring failed"
    fi
  fi
}

# Start robust transcript monitoring for target project
if [ -d "$TARGET_PROJECT_DIR/.specstory" ] || mkdir -p "$TARGET_PROJECT_DIR/.specstory/history" 2>/dev/null; then
  start_transcript_monitoring "$TARGET_PROJECT_DIR" "$CODING_REPO"
else
  log "Warning: Could not create .specstory directory for transcript monitoring"
fi

# Show session summary for continuity
show_session_reminder

# Find MCP config (always from coding repo)
MCP_CONFIG=""
if [ -f "$CODING_REPO/claude-code-mcp-processed.json" ]; then
  MCP_CONFIG="$CODING_REPO/claude-code-mcp-processed.json"
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
export CODING_TOOLS_PATH="$CODING_REPO"
export TRANSCRIPT_SOURCE_PROJECT="$TARGET_PROJECT_DIR"

# Change to target project directory before launching Claude
cd "$TARGET_PROJECT_DIR"
log "Changed working directory to: $(pwd)"

# Launch Claude with MCP config
if [ -n "$MCP_CONFIG" ]; then
  log "Using MCP config: $MCP_CONFIG"
  exec "$CODING_REPO/bin/claude-mcp" "$@"
else
  log "Launching Claude without MCP config"
  exec claude "$@"
fi