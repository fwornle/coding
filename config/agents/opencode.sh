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
AGENT_INSTALL_COMMAND="go install github.com/opencode-ai/opencode@latest"

# Verify opencode CLI is available
agent_check_requirements() {
  if ! command -v opencode &>/dev/null; then
    _agent_log "Error: opencode CLI is not installed or not in PATH"
    return 1
  fi
  _agent_log "✅ opencode CLI detected ($(opencode --version 2>/dev/null || echo 'unknown'))"
}

# Per-launch OpenCode config (OPENCODE_CONFIG_CONTENT): the rapid-proxy band
# variants, the github-copilot provider pointed at the proxy's opencode shim,
# the opt-in anthropic-native tap (OPENCODE_ANTHROPIC_NATIVE=1), the /sl
# command, enabled_providers and — in wrapper scope — the coding plugins. Built
# by lib/agents/proxy-routing.mjs (opencodeConfigContent); see its comments for
# why each piece is there.
agent_pre_launch() {
  _coding_wiring pre-launch opencode

  # Validate connectivity
  validate_agent_connectivity "$AGENT_NAME" || true
}
