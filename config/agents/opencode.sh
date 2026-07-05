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

  # OPT-IN (Phase 82, default OFF): anthropic-native provider entry that routes opencode's
  # @ai-sdk/anthropic path through the local rapid-llm-proxy /v1/messages, restoring prompt-cache
  # fidelity AND stamping token_usage agent='opencode' via the x-agent header (else the tap
  # mis-stamps opencode rows as cladpt). Kept OPT-IN this phase (CONTEXT §Deferred): making it the
  # default requires live verification that opencode actually emits cache_control breakpoints on this
  # path. When OPENCODE_ANTHROPIC_NATIVE is unset the OPENCODE_CONFIG_CONTENT above is byte-identical
  # to today. Discretion (CONTEXT §Discretion): chose config-rewrite via env-interpolated string
  # splice over a separate config file — lower risk (single source of truth on the existing
  # OPENCODE_CONFIG_CONTENT seam; byte-identical default guaranteed by only splicing under the flag).
  # baseURL is the proxy /v1 root — the @ai-sdk/anthropic client appends /messages → /v1/messages.
  # Port per CLAUDE.md contract: LLM proxy host port is 12435 (NOT 3033, the Health API).
  if [ "${OPENCODE_ANTHROPIC_NATIVE:-0}" = "1" ]; then
    local _oc_proxy_port="${LLM_CLI_PROXY_PORT:-12435}"
    local _oc_provider="\"provider\":{\"anthropic\":{\"options\":{\"baseURL\":\"http://127.0.0.1:${_oc_proxy_port}/v1\",\"headers\":{\"x-task-id\":\"${TASK_ID:-}\",\"x-agent\":\"opencode\"}}}}"
    # Splice the provider block in after the leading '{' of the chosen config JSON.
    OPENCODE_CONFIG_CONTENT="{${_oc_provider},${OPENCODE_CONFIG_CONTENT#\{}"
    export OPENCODE_CONFIG_CONTENT
    _agent_log "🧪 opencode ANTHROPIC-NATIVE (opt-in) → proxy http://127.0.0.1:${_oc_proxy_port}/v1/messages (x-agent=opencode; x-task-id=${TASK_ID:-<ambient>})"
  fi

  # Validate connectivity for the chosen provider (warn only, don't abort)
  validate_agent_connectivity "$AGENT_NAME" || true
}
