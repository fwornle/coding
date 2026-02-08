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
  _agent_log "✅ opencode CLI detected"
}
