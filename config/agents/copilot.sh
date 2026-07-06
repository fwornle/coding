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

  # copilot BYOK measurement env is INTENTIONALLY NOT exported here (D-03 / WR-02 / WR-05).
  # agent_pre_launch runs for EVERY copilot launch, including interactive sessions with no
  # measured span. Exporting COPILOT_PROVIDER_* unconditionally made interactive copilot
  # (a) DOUBLE-WRITE tokens (proxy wire + copadt transcript, WR-02) and (b) BREAK fail-soft
  # when the proxy URL was dead (WR-05). BYOK now lives ONLY in the health-gated MEASURED
  # wiring: scripts/launch-agent-common.sh configure_proxy_routing() (runs AFTER this, behind
  # the curl health gate + a TASK_ID measured-span check) for launcher-driven measured spans,
  # and lib/experiments/experiment-runner.mjs configureProxyRoutingEnv() for experiment cells.
  # Defensive unset (WR-05): clear any COPILOT_PROVIDER_* inherited from the environment so a
  # stale/dead proxy URL can NEVER reach an interactive copilot and break its fail-soft. The
  # measured wiring re-exports these when — and only when — the proxy is healthy and the launch
  # is measured. Port contract retained for reference (LLM proxy host port 12435, NOT 3033).
  local _copilot_proxy_port="${LLM_CLI_PROXY_PORT:-12435}"
  unset COPILOT_PROVIDER_BASE_URL COPILOT_PROVIDER_TYPE COPILOT_PROVIDER_API_KEY
  export COPILOT_AUTO_UPDATE="false"
  _agent_log "🔌 copilot BYOK deferred to health-gated measured wiring (proxy port ${_copilot_proxy_port}); interactive copilot is copadt-only (COPILOT_PROVIDER_* unset)"

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
