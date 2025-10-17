#!/bin/bash

# Agent-Agnostic Common Setup Functions
# Shared initialization logic for all coding agents (Claude, CoPilot, etc.)
#
# This script must be sourced by agent-specific launchers:
#   source "$(dirname $0)/agent-common-setup.sh"

set -e

# Helper function for logging
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# ==============================================================================
# GITIGNORE VALIDATION
# ==============================================================================
# Ensure .specstory/logs/ is not ignored by gitignore
# This is critical for classification logs from both live logging and batch processing
ensure_specstory_logs_tracked() {
  local project_dir="$1"
  local gitignore_file="$project_dir/.gitignore"

  # Skip if no .gitignore exists
  if [ ! -f "$gitignore_file" ]; then
    return 0
  fi

  # Check if logs/ pattern exists and .specstory/logs/ is not exempted
  if grep -q "^logs/" "$gitignore_file" 2>/dev/null; then
    if ! grep -q "^\!\.specstory/logs/" "$gitignore_file" 2>/dev/null; then
      log "⚠️  .gitignore has 'logs/' pattern that will ignore .specstory/logs/classification/"
      log "🔧 Adding exception '!.specstory/logs/' to .gitignore..."

      # Insert the exception right after the logs/ line
      sed -i.backup '/^logs\//a\
!.specstory/logs/
' "$gitignore_file"

      if [ $? -eq 0 ]; then
        log "✅ Added .specstory/logs/ exception to .gitignore"
      else
        log "❌ Failed to update .gitignore - please manually add: !.specstory/logs/"
      fi
    fi
  fi
}

# ==============================================================================
# SESSION REMINDER
# ==============================================================================
# Show latest session log for continuity
show_session_reminder() {
  local target_project_dir="$1"
  local coding_repo="$2"

  # Check target project directory first
  local target_specstory_dir="$target_project_dir/.specstory/history"
  local coding_specstory_dir="$coding_repo/.specstory/history"

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
    echo "💡 Reminder: Ask the agent to read the session log for continuity"
    echo ""
  fi
}

# ==============================================================================
# TRANSCRIPT MONITORING (LSL)
# ==============================================================================
# Start Global LSL Coordinator for robust transcript monitoring
start_transcript_monitoring() {
  local project_dir="$1"
  local coding_repo="$2"

  log "Using Global LSL Coordinator for robust transcript monitoring: $(basename "$project_dir")"

  # Create .specstory directory if needed
  if [ ! -d "$project_dir/.specstory/history" ]; then
    mkdir -p "$project_dir/.specstory/history"
  fi

  # Ensure .specstory/logs/ is tracked in git
  ensure_specstory_logs_tracked "$project_dir"

  # Use global coordinator to ensure robust LSL
  if node "$coding_repo/scripts/global-lsl-coordinator.js" ensure "$project_dir" $$; then
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

# ==============================================================================
# STATUSLINE HEALTH MONITOR
# ==============================================================================
# Start StatusLine Health Monitor daemon (global monitoring for all sessions)
start_statusline_health_monitor() {
  local coding_repo="$1"

  # Check if health monitor is already running
  if pgrep -f "statusline-health-monitor.js" >/dev/null 2>&1; then
    log "StatusLine Health Monitor already running"
    return 0
  fi

  log "Starting StatusLine Health Monitor daemon..."

  # Start the health monitor daemon in background
  cd "$coding_repo"
  nohup node scripts/statusline-health-monitor.js --daemon > .logs/statusline-health-daemon.log 2>&1 &
  local health_monitor_pid=$!

  # Brief wait to check if it started successfully
  sleep 1
  if kill -0 "$health_monitor_pid" 2>/dev/null; then
    log "✅ StatusLine Health Monitor started (PID: $health_monitor_pid)"
  else
    log "⚠️ StatusLine Health Monitor may have failed to start"
  fi
}

# ==============================================================================
# GLOBAL LSL MONITORING
# ==============================================================================
# Start Global LSL Coordinator monitoring daemon for auto-recovery
start_global_lsl_monitoring() {
  local coding_repo="$1"

  # Check if Global LSL Coordinator monitoring is already running
  if pgrep -f "global-lsl-coordinator.js monitor" >/dev/null 2>&1; then
    log "Global LSL Coordinator monitoring already running"
    return 0
  fi

  log "Starting Global LSL Coordinator monitoring daemon for auto-recovery..."

  # Start the coordinator monitoring daemon in background
  cd "$coding_repo"
  nohup node scripts/global-lsl-coordinator.js monitor > .logs/global-lsl-coordinator-monitor.log 2>&1 &
  local coordinator_pid=$!

  # Brief wait to check if it started successfully
  sleep 1
  if kill -0 "$coordinator_pid" 2>/dev/null; then
    log "✅ Global LSL Coordinator monitoring started (PID: $coordinator_pid)"
  else
    log "⚠️ Global LSL Coordinator monitoring may have failed to start"
  fi
}

# ==============================================================================
# STATUSLINE CONFIG
# ==============================================================================
# Ensure statusLine config is present in target project
# This allows Claude Code to display system health in the status bar
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

# ==============================================================================
# MAIN INITIALIZATION
# ==============================================================================
# Main initialization function called by agent-specific launchers
agent_common_init() {
  local target_project_dir="$1"
  local coding_repo="$2"

  log "Initializing agent-common setup..."
  log "Target project: $target_project_dir"
  log "Coding services from: $coding_repo"

  # Start robust transcript monitoring for target project
  if [ -d "$target_project_dir/.specstory" ] || mkdir -p "$target_project_dir/.specstory/history" 2>/dev/null; then
    start_transcript_monitoring "$target_project_dir" "$coding_repo"
  else
    log "Warning: Could not create .specstory directory for transcript monitoring"
  fi

  # Start the health monitor for global session monitoring
  start_statusline_health_monitor "$coding_repo"

  # Start the Global LSL Coordinator monitoring for auto-recovery
  start_global_lsl_monitoring "$coding_repo"

  # Ensure statusLine config is present (Claude-specific but harmless for others)
  ensure_statusline_config "$target_project_dir" "$coding_repo"

  # Show session summary for continuity
  show_session_reminder "$target_project_dir" "$coding_repo"

  log "Agent-common setup complete"
}

# Export functions for use in agent-specific launchers
export -f log
export -f ensure_specstory_logs_tracked
export -f show_session_reminder
export -f start_transcript_monitoring
export -f start_statusline_health_monitor
export -f start_global_lsl_monitoring
export -f ensure_statusline_config
export -f agent_common_init
