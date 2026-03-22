#!/bin/bash
# Agent definition: OpenCode
# Proof-of-concept: adding a new agent requires only this config file.
# Sourced by launch-agent-common.sh

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
  _agent_log "✅ opencode CLI detected ($(opencode --version 2>/dev/null || echo 'unknown version'))"
}

# Configure OpenCode model based on network location
# - Inside VPN (corporate network): use GitHub Copilot Enterprise (free via corp subscription)
# - Outside VPN: use Anthropic directly (personal Claude Max subscription)
agent_pre_launch() {
  # detect_corporate_network is already available via detect-network.sh
  # (sourced by agent-common-setup.sh which runs before agent_pre_launch)
  # INSIDE_CN is set by _detect_docker_mode → detect_network_and_configure_proxy chain
  # But agent_pre_launch runs BEFORE agent_common_init, so detect manually here.

  local inside_vpn=false
  if timeout 3 curl -s --connect-timeout 2 https://cc-github.bmwgroup.net >/dev/null 2>&1; then
    inside_vpn=true
  fi

  if [ "$inside_vpn" = "true" ]; then
    # VPN/Corporate Network: use GitHub Copilot via corporate subscription
    # The corporate proxy (proxydetox on 127.0.0.1:3128) handles routing
    export OPENCODE_CONFIG_CONTENT='{"model":"github-copilot-enterprise/claude-opus-4.6","disabled_providers":["anthropic"]}'
    _agent_log "🏢 VPN detected → GitHub Copilot Enterprise (claude-opus-4.6)"

    # Ensure GitHub Copilot API endpoints bypass NO_PROXY exclusions
    # (they need the corporate proxy to reach the internet)
  else
    # Outside VPN: use Anthropic directly with personal API key
    # Clear proxy vars so Anthropic API calls go direct
    unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
    export NO_PROXY="*"
    export no_proxy="*"

    if [ -n "$ANTHROPIC_API_KEY" ]; then
      export OPENCODE_CONFIG_CONTENT='{"model":"claude-opus-4-6","disabled_providers":["copilot"]}'
      _agent_log "🌐 No VPN → Anthropic direct (claude-opus-4.6, personal key)"
    else
      # Fallback: let opencode use its default config
      _agent_log "🌐 No VPN, no ANTHROPIC_API_KEY → using opencode defaults"
    fi
  fi
}
