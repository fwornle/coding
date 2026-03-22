#!/bin/bash
# Agent definition: OpenCode
# Sourced by launch-agent-common.sh
#
# Model selection based on network:
#   Inside VPN → GitHub Copilot Enterprise (corporate subscription, free)
#   Outside VPN → Anthropic direct (personal Claude Max / API key)

AGENT_NAME="opencode"
AGENT_DISPLAY_NAME="OpenCode"
AGENT_COMMAND="opencode"
AGENT_SESSION_PREFIX="opencode"
AGENT_SESSION_VAR="OPENCODE_SESSION_ID"
AGENT_TRANSCRIPT_FMT="opencode"
AGENT_ENABLE_PIPE_CAPTURE=true
AGENT_PROMPT_REGEX='>\s+([^\n\r]+)[\n\r]'
AGENT_REQUIRES_COMMANDS="opencode"

# Verify opencode CLI is available
agent_check_requirements() {
  if ! command -v opencode &>/dev/null; then
    _agent_log "Error: opencode CLI is not installed or not in PATH"
    _agent_log "Install: go install github.com/opencode-ai/opencode@latest"
    exit 1
  fi
  _agent_log "✅ opencode CLI detected ($(opencode --version 2>/dev/null || echo 'unknown'))"
}

# Configure OpenCode model based on network location
# Note: agent_pre_launch runs AFTER detect_network_and_configure_proxy,
# so INSIDE_CN and PROXY_WORKING are already set.
agent_pre_launch() {
  if [ "$INSIDE_CN" = "true" ]; then
    # VPN/Corporate Network: use GitHub Copilot via corporate subscription
    export OPENCODE_CONFIG_CONTENT='{"model":"github-copilot-enterprise/claude-opus-4.6","disabled_providers":["anthropic"]}'
    _agent_log "🏢 VPN → GitHub Copilot Enterprise (claude-opus-4.6)"
  else
    # Outside VPN: use Anthropic directly
    export OPENCODE_CONFIG_CONTENT='{"model":"claude-opus-4-6","disabled_providers":["copilot"]}'
    _agent_log "🌐 Public → Anthropic direct (claude-opus-4.6)"

    if [ -z "$ANTHROPIC_API_KEY" ]; then
      _agent_log "⚠️  ANTHROPIC_API_KEY not set — opencode may prompt for auth"
    fi
  fi

  # Validate connectivity for the chosen provider
  validate_agent_connectivity "$AGENT_NAME"
}
