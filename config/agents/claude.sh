#!/bin/bash
# Agent definition: Claude Code
# Sourced by launch-agent-common.sh

AGENT_NAME="claude"
AGENT_DISPLAY_NAME="Claude"
AGENT_COMMAND="$CODING_REPO/bin/claude-mcp"
AGENT_SESSION_PREFIX="claude"
AGENT_SESSION_VAR="CLAUDE_SESSION_ID"
AGENT_TRANSCRIPT_FMT="claude"
AGENT_ENABLE_PIPE_CAPTURE=false
AGENT_REQUIRES_COMMANDS="claude"

# Check for MCP config generation requirement
agent_check_requirements() {
  if [ -f "$CODING_REPO/.mcp-sync/sync-required.json" ]; then
    _agent_log "MCP memory sync required, will be handled by Claude on startup"
  fi
}

# Pre-launch: generate Docker MCP config, log mode info
agent_pre_launch() {
  # MCP config is now selected by claude-mcp-launcher.sh based on CODING_DOCKER_MODE
  if [ "$DOCKER_MODE" = true ]; then
    _agent_log "Docker mode: MCP servers will use stdio-proxy → SSE connections to Docker"
  else
    _agent_log "Native mode: MCP servers will run as local processes"
  fi
}
