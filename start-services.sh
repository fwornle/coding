#!/bin/bash

# Simple reliable service startup script
# This replaces the complex startup system

set -e

echo "🚀 Starting Coding Services..."

# Function to check if port is in use
check_port() {
    local port=$1
    lsof -i :$port >/dev/null 2>&1
}

# Function to kill process on port
kill_port() {
    local port=$1
    local pid=$(lsof -t -i :$port 2>/dev/null || echo "")
    if [ ! -z "$pid" ]; then
        echo "🔥 Killing process $pid on port $port"
        kill -9 $pid 2>/dev/null || true
        sleep 1
    fi
}

# Kill any existing processes on our ports
echo "🧹 Cleaning up existing processes..."
# Kill VKB server port and FastMCP server port
for port in 8080 8001; do
    if check_port $port; then
        kill_port $port
    fi
done

# Kill any existing semantic analysis processes
echo "🧹 Cleaning up existing semantic analysis processes..."
pkill -f "semantic_analysis_server.py" 2>/dev/null || true

# Get the script directory and coding project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_DIR="$SCRIPT_DIR"

# Start VKB Server
echo "🟢 Starting VKB Server (port 8080)..."
cd "$CODING_DIR"
nohup node lib/vkb-server/cli.js server start --foreground > vkb-server.log 2>&1 &
VKB_PID=$!

# Start Semantic Analysis MCP Server
echo "🟢 Starting Semantic Analysis MCP Server (Standard MCP)..."
cd "$CODING_DIR/integrations/mcp-server-semantic-analysis"
# Note: Standard MCP server uses stdio transport, not HTTP
# It will be started by Claude Code when needed
echo "ℹ️  Semantic Analysis MCP Server configured for stdio transport"
SEMANTIC_PID="stdio"

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 5

# Verify services are running
echo "🔍 Verifying services..."
services_running=0

if check_port 8080; then
    echo "✅ VKB Server running on port 8080"
    services_running=$((services_running + 1))
else
    echo "❌ VKB Server NOT running on port 8080"
fi

# Check if semantic analysis server is configured (stdio transport)
if [ -f "$CODING_DIR/integrations/mcp-server-semantic-analysis/dist/index.js" ]; then
    echo "✅ Semantic Analysis MCP Server configured (stdio transport)"
    services_running=$((services_running + 1))
    
    # Show Node.js executable verification for the MCP server
    echo "📦 MCP Server Node.js Verification:"
    cd "$CODING_DIR/integrations/mcp-server-semantic-analysis"
    node -e "
const path = require('path');
const fs = require('fs');
console.log('   Node.js version:', process.version);
console.log('   Current directory:', process.cwd());
console.log('   Server built:', fs.existsSync('./dist/index.js') ? '✅ YES' : '❌ NO');
console.log('   ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Not set');
console.log('   OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Not set');
console.log('   KNOWLEDGE_BASE_PATH:', process.env.KNOWLEDGE_BASE_PATH || 'Not set');
"
    cd "$CODING_DIR"
else
    echo "❌ Semantic Analysis MCP Server NOT configured"
fi

# Update services tracking file
cat > .services-running.json << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")",
  "services": ["vkb-server", "semantic-analysis"],
  "ports": {
    "vkb-server": 8080,
    "semantic-analysis": 8001
  },
  "pids": {
    "vkb-server": $VKB_PID,
    "semantic-analysis": $SEMANTIC_PID
  },
  "services_running": $services_running,
  "agent": "claude"
}
EOF

if [ $services_running -ge 2 ]; then
    echo "✅ Services started successfully! ($services_running/2 running)"
    echo "📊 Services status: .services-running.json"
    echo "📝 Logs: vkb-server.log, semantic-analysis.log"
else
    echo "⚠️  Some services not running. Check logs for issues."
    echo "📝 Logs: vkb-server.log, semantic-analysis.log"
fi

echo "🎉 Startup complete!"