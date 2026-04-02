#!/bin/bash
# Agent definition: Mastracode
# Sourced by launch-agent-common.sh
#
# Mastracode is a standalone coding agent TUI (npm: mastracode).
# All LLM calls route through the coding LLM proxy (per D-07).
#
# Model selection based on network:
#   Inside VPN -> GitHub Copilot Enterprise (corporate subscription, free)
#   Outside VPN -> Anthropic direct (personal Claude Max / API key)

AGENT_NAME="mastra"
AGENT_DISPLAY_NAME="Mastracode"
AGENT_COMMAND="mastracode"
AGENT_SESSION_PREFIX="mastra"
AGENT_SESSION_VAR="MASTRA_SESSION_ID"
AGENT_TRANSCRIPT_FMT="mastra"
AGENT_ENABLE_PIPE_CAPTURE=false
AGENT_REQUIRES_COMMANDS="mastracode"

# Verify mastracode CLI is available
agent_check_requirements() {
  if ! command -v mastracode &>/dev/null; then
    _agent_log "Error: mastracode CLI is not installed or not in PATH"
    _agent_log "Install: npm install -g mastracode"
    exit 1
  fi
  _agent_log "mastracode CLI detected ($(mastracode --version 2>/dev/null || echo 'unknown'))"
}

# Configure Mastracode and validate environment
# Note: agent_pre_launch runs AFTER detect_network_and_configure_proxy,
# so INSIDE_CN and PROXY_WORKING are already set.
agent_pre_launch() {
  # D-07: All LLM calls route through coding LLM proxy
  # D-15: Check LLM proxy reachability (warn only, do not block)
  if curl -sf http://localhost:8089/health &>/dev/null; then
    _agent_log "LLM proxy reachable on port 8089"
  else
    _agent_log "WARNING: LLM proxy not reachable on port 8089 -- mastracode may not have LLM access"
  fi

  # Network-adaptive model selection (same pattern as opencode.sh)
  if [ "$INSIDE_CN" = "true" ]; then
    # VPN/Corporate Network: use GitHub Copilot via corporate subscription
    export MASTRA_MODEL="github-copilot-enterprise/claude-opus-4.6"
    _agent_log "VPN -> GitHub Copilot Enterprise (claude-opus-4.6)"
  else
    # Outside VPN: use Anthropic directly
    export MASTRA_MODEL="claude-opus-4-6"
    _agent_log "Public -> Anthropic direct (claude-opus-4.6)"

    if [ -z "$ANTHROPIC_API_KEY" ]; then
      _agent_log "WARNING: ANTHROPIC_API_KEY not set -- mastracode may prompt for auth"
    fi
  fi

  # D-08: Ensure .mastracode/hooks.json exists for transcript capture via lifecycle hooks
  local hooks_dir="$HOME/.mastracode"
  local hooks_file="$hooks_dir/hooks.json"
  if [ ! -f "$hooks_file" ]; then
    _agent_log "Creating default hooks config at $hooks_file"
    mkdir -p "$hooks_dir"
    cat > "$hooks_file" << 'HOOKS_EOF'
{
  "version": 1,
  "hooks": {
    "onSessionStart": [],
    "onSessionEnd": [],
    "onMessage": []
  }
}
HOOKS_EOF
  fi

  # D-06: Validate connectivity for the chosen provider (warn only, don't abort)
  validate_agent_connectivity "$AGENT_NAME" || true
}
