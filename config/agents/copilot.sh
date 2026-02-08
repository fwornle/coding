#!/bin/bash
# Agent definition: GitHub CoPilot
# Sourced by launch-agent-common.sh

AGENT_NAME="copilot"
AGENT_DISPLAY_NAME="CoPilot"
AGENT_COMMAND="copilot"
AGENT_SESSION_PREFIX="copilot"
AGENT_SESSION_VAR="COPILOT_SESSION_ID"
AGENT_TRANSCRIPT_FMT="copilot"
AGENT_ENABLE_PIPE_CAPTURE=true
AGENT_PROMPT_REGEX='❯\s+([^\n\r]+)[\n\r]'
AGENT_REQUIRES_COMMANDS="copilot"

# Track HTTP adapter PID for cleanup
HTTP_SERVER_PID=""

# Verify copilot CLI and tmux are available
agent_check_requirements() {
  _agent_log "Checking CoPilot requirements..."

  if ! command -v copilot &>/dev/null; then
    _agent_log "Error: copilot CLI is not installed or not in PATH"
    _agent_log "Ensure the 'copilot' command is available"
    exit 1
  fi

  if ! command -v tmux &>/dev/null; then
    _agent_log "Error: tmux is not installed (required for session wrapper)"
    _agent_log "Install: brew install tmux"
    exit 1
  fi

  _agent_log "✅ copilot CLI and tmux detected"
}

# Start CoPilot HTTP adapter server and set log dir
agent_pre_launch() {
  # Set copi log directory
  export COPI_LOG_DIR="$CODING_REPO/.logs/copi"
  mkdir -p "$COPI_LOG_DIR"

  _agent_log "Starting CoPilot HTTP adapter server..."

  if [ ! -f "$CODING_REPO/lib/adapters/copilot-http-server.js" ]; then
    _agent_log "Warning: CoPilot HTTP adapter not found, some features may not work"
    return 0
  fi

  cd "$CODING_REPO"
  nohup node lib/adapters/copilot-http-server.js > .logs/copilot-http-adapter.log 2>&1 &
  HTTP_SERVER_PID=$!

  sleep 2
  if kill -0 "$HTTP_SERVER_PID" 2>/dev/null; then
    _agent_log "✅ HTTP adapter server started (PID: $HTTP_SERVER_PID)"
    export COPILOT_HTTP_ADAPTER_PID="$HTTP_SERVER_PID"
  else
    _agent_log "⚠️ HTTP adapter server may have failed to start"
    HTTP_SERVER_PID=""
  fi

  _agent_log "📚 CoPilot features available:"
  _agent_log "   • Copilot CLI in tmux session with I/O capture"
  _agent_log "   • Session logging (JSON Lines format)"
  _agent_log "   • Memory/Knowledge management (fallback services)"
  _agent_log "   • Browser automation (Playwright fallback)"
  _agent_log "   • LSL system integration"
}

# Stop CoPilot-specific services on exit
agent_cleanup() {
  if [ -n "$HTTP_SERVER_PID" ] && kill -0 "$HTTP_SERVER_PID" 2>/dev/null; then
    _agent_log "Stopping HTTP adapter server (PID: $HTTP_SERVER_PID)"
    kill "$HTTP_SERVER_PID" 2>/dev/null || true
  fi
}
