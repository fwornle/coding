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
  # when the proxy URL was dead (WR-05). BYOK therefore lives ONLY in the health-gated wiring:
  # scripts/launch-agent-common.sh configure_proxy_routing() (runs AFTER this, behind the curl
  # health gate) for launcher-driven launches, and lib/experiments/experiment-runner.mjs
  # configureProxyRoutingEnv() for experiment cells.
  #
  # The gate is the HEALTH CHECK, not a TASK_ID check — that distinction moved on 2026-07-19
  # and this comment did not follow. WR-02 is now closed by two guards downstream instead (the
  # stop-adapter reconcile, and auto-measure-foreground's wire-presence check), which is what
  # made ambient interactive BYOK safe to ship.
  # Defensive unset (WR-05): clear any COPILOT_PROVIDER_* inherited from the environment so a
  # stale/dead proxy URL can NEVER reach copilot and break its fail-soft. This clears only what
  # was INHERITED; it does not decide what the launch ends up using.
  #
  # What it does NOT mean, since the line below used to say otherwise: an interactive launch is
  # no longer copadt-only. configure_proxy_routing() runs AFTER this hook and has the final say
  # (scripts/launch-agent-common.sh:400), and since ambient routing shipped 2026-07-19 its
  # copilot branch re-exports COPILOT_PROVIDER_* for BOTH modes — /v1/copilot/t/<task_id> for a
  # measured span, plain /v1/copilot for an interactive one, with the task id resolved from the
  # reconciler's ambient slot. Both are behind the same curl health gate. The only launch that
  # is still copadt-only is COPILOT_AMBIENT_ROUTE=0, which is an explicit opt-out.
  #
  # Port contract retained for reference (LLM proxy host port 12435, NOT 3033).
  local _copilot_proxy_port="${LLM_CLI_PROXY_PORT:-12435}"
  unset COPILOT_PROVIDER_BASE_URL COPILOT_PROVIDER_TYPE COPILOT_PROVIDER_API_KEY
  export COPILOT_AUTO_UPDATE="false"
  _agent_log "🔌 copilot: cleared inherited COPILOT_PROVIDER_* (proxy port ${_copilot_proxy_port}); BYOK is set by the health-gated wiring in configure_proxy_routing — measured AND ambient interactive (opt out with COPILOT_AMBIENT_ROUTE=0)"

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
