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
# No AGENT_INSTALL_COMMAND — copilot install is org-specific

# Track HTTP adapter PID for cleanup
HTTP_SERVER_PID=""

# Verify copilot CLI and tmux are available
agent_check_requirements() {
  _agent_log "Checking CoPilot requirements..."

  if ! command -v copilot &>/dev/null; then
    _agent_log "Error: copilot CLI is not installed or not in PATH"
    _agent_log "Ensure the 'copilot' command is available"
    return 1
  fi

  if ! command -v tmux &>/dev/null; then
    _agent_log "Error: tmux is not installed (required for session wrapper)"
    _agent_log "Install: brew install tmux"
    return 1
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

  # BYOK measurement env (Phase 82 / Phase-81 verified). Route the Copilot CLI's completions
  # through the local rapid-llm-proxy so token_usage stamps agent='copilot'. copilot cannot set
  # request headers, so the ONLY per-request binding seam is the task-scoped base-URL PATH
  # (/v1/copilot/t/<task_id>, Plan 03); fall back to the unbound /v1/copilot path when no TASK_ID
  # span is active. configure_proxy_routing() in launch-agent-common.sh runs AFTER this and, being
  # health-gated, has the final say — these exports are the inherited defaults. Port per CLAUDE.md
  # contract: LLM proxy host port is 12435 (NOT 3033, the Health API). The API key is a literal
  # non-secret placeholder against the localhost no-auth proxy (T-82-05-01, accepted).
  local _copilot_proxy_port="${LLM_CLI_PROXY_PORT:-12435}"
  if [ -n "${TASK_ID:-}" ]; then
    export COPILOT_PROVIDER_BASE_URL="http://127.0.0.1:${_copilot_proxy_port}/v1/copilot/t/${TASK_ID}"
  else
    export COPILOT_PROVIDER_BASE_URL="http://127.0.0.1:${_copilot_proxy_port}/v1/copilot"
  fi
  export COPILOT_PROVIDER_TYPE="openai"
  export COPILOT_PROVIDER_API_KEY="rapid-proxy-no-auth-placeholder"
  export COPILOT_MODEL="${COPILOT_MODEL:-claude-haiku-4-5}"
  export COPILOT_AUTO_UPDATE="false"
  _agent_log "🔌 copilot BYOK → ${COPILOT_PROVIDER_BASE_URL} (openai; model=${COPILOT_MODEL})"

  # Validate GitHub API connectivity
  validate_agent_connectivity "$AGENT_NAME" || true

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
