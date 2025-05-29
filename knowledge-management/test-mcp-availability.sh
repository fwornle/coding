#!/bin/bash

# Test script to check MCP availability
# This script is called by capture-coding-insight.sh to determine if MCP is available

# In Claude Code environment, we can detect MCP by:
# 1. Checking if certain environment variables are set
# 2. Checking if we can successfully call claude mcp list
# 3. Checking for the presence of MCP-related files

# Check for Claude Code specific environment
if [ -n "$CLAUDE_CODE" ] || [ -n "$MCP_SERVER_MEMORY" ]; then
    echo "MCP_AVAILABLE"
    exit 0
fi

# Check if claude command exists and can list MCP servers
if command -v claude >/dev/null 2>&1; then
    if claude mcp list 2>/dev/null | grep -q "memory:"; then
        echo "MCP_AVAILABLE"
        exit 0
    fi
fi

# Check for .claude directory with settings
if [ -f "$HOME/.claude/settings.json" ] || [ -f "$HOME/.claude/settings.local.json" ]; then
    echo "MCP_AVAILABLE"
    exit 0
fi

# Not available
echo "MCP_NOT_AVAILABLE"
exit 1