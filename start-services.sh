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

# Function to check if Docker is running
check_docker() {
    docker info >/dev/null 2>&1
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

# Check and setup Constraint Monitor
CONSTRAINT_MONITOR_STATUS="❌ NOT RUNNING"
CONSTRAINT_MONITOR_WARNING=""

# Check if mcp-constraint-monitor exists in integrations, if not clone it
if [ ! -d "$CODING_DIR/integrations/mcp-constraint-monitor" ]; then
    echo "📦 Installing MCP Constraint Monitor..."
    cd "$CODING_DIR/integrations"
    
    # Check if we have local development version to copy
    if [ -d "$CODING_DIR/mcp-constraint-monitor" ]; then
        echo "   📁 Copying local development version..."
        cp -r "$CODING_DIR/mcp-constraint-monitor" "./mcp-constraint-monitor"
        cd mcp-constraint-monitor
        echo "   📦 Installing dependencies..."
        npm install --production 2>/dev/null || echo "   ⚠️ npm install failed, continuing..."
        echo "   ✅ Local MCP Constraint Monitor installed"
    else
        echo "   🌐 Cloning from repository..."
        if git clone https://github.com/fwornle/mcp-server-constraint-monitor.git mcp-constraint-monitor 2>/dev/null; then
            cd mcp-constraint-monitor
            echo "   📦 Installing dependencies..."
            npm install --production 2>/dev/null || echo "   ⚠️ npm install failed, continuing..."
            echo "   ✅ MCP Constraint Monitor installed from GitHub"
        else
            echo "   ⚠️ Failed to clone repository"
            echo "   💡 Ensure internet connection and GitHub access"
            echo "   💡 Manual install: git clone https://github.com/fwornle/mcp-server-constraint-monitor.git mcp-constraint-monitor"
        fi
    fi
    cd "$CODING_DIR"
fi

if check_docker; then
    echo "🐳 Docker is running. Starting Constraint Monitor databases..."
    
    # Use constraint monitor in integrations directory
    CONSTRAINT_DIR="$CODING_DIR/integrations/mcp-constraint-monitor"
    
    if [ -d "$CONSTRAINT_DIR" ]; then
        cd "$CONSTRAINT_DIR"
        
        # Start databases with docker-compose
        echo "   Starting Docker containers (this may take a while on first run)..."
        
        # Check if images need to be pulled
        images_exist=$(docker images -q qdrant/qdrant:v1.7.0 redis:7-alpine 2>/dev/null | wc -l)
        
        if [ "$images_exist" -lt 2 ]; then
            echo "   📦 First-time setup: Downloading Docker images..."
            echo "   This may take a few minutes. Please wait..."
            timeout 300 docker-compose pull 2>&1 | grep -E "(Pulling|Downloading|Pull complete)" || true
        fi
        
        # Now start the containers
        if timeout 30 docker-compose up -d >/dev/null 2>&1; then
            echo "✅ Constraint Monitor databases started (Qdrant on 6333, Redis on 6379)"
            CONSTRAINT_MONITOR_STATUS="✅ FULLY OPERATIONAL"
            
            # Wait for databases to be ready
            echo "⏳ Waiting for databases to be ready..."
            sleep 3
            
            # Initialize databases if needed
            if [ -f "scripts/setup-databases.js" ] && [ ! -f ".initialized" ]; then
                echo "🔧 Initializing Constraint Monitor databases..."
                if npm run setup 2>/dev/null; then
                    touch .initialized
                    echo "✅ Databases initialized"
                else
                    echo "⚠️ Database initialization failed, but continuing..."
                fi
            fi
        else
            echo "⚠️ Failed to start Constraint Monitor databases"
            CONSTRAINT_MONITOR_STATUS="⚠️ DEGRADED MODE"  
            CONSTRAINT_MONITOR_WARNING="Docker containers failed to start"
        fi
        cd "$CODING_DIR"
    else
        echo "⚠️ MCP Constraint Monitor not found"
        CONSTRAINT_MONITOR_STATUS="⚠️ DEGRADED MODE"
        CONSTRAINT_MONITOR_WARNING="MCP Constraint Monitor not installed"
    fi
else
    echo ""
    echo "═══════════════════════════════════════════════════════════════════════"
    echo "⚠️  DOCKER NOT RUNNING - CONSTRAINT MONITOR IN DEGRADED MODE"
    echo "═══════════════════════════════════════════════════════════════════════"
    echo ""
    echo "The Live Guardrails system requires Docker for full functionality:"
    echo ""
    echo "❌ DISABLED FEATURES (Degraded Mode):"
    echo "   • No semantic analysis (Groq inference engine)"
    echo "   • No pattern learning from violations"
    echo "   • No cross-session knowledge persistence"
    echo "   • No predictive risk assessment"
    echo "   • No vector similarity search for constraints"
    echo "   • No analytical queries for trend detection"
    echo ""
    echo "✅ STILL WORKING (Basic Mode):"
    echo "   • Basic pattern matching (regex-based)"
    echo "   • Simple constraint violation detection"
    echo "   • MCP server connectivity"
    echo "   • Basic warning messages"
    echo ""
    echo "🔧 TO ENABLE FULL FUNCTIONALITY:"
    echo "   1. Start Docker Desktop"
    echo "   2. Wait for Docker to fully start"
    echo "   3. Run: coding --restart"
    echo "   4. Or manually: cd integrations/constraint-monitor && docker-compose up -d"
    echo ""
    echo "═══════════════════════════════════════════════════════════════════════"
    echo ""
    CONSTRAINT_MONITOR_STATUS="⚠️ DEGRADED MODE"
    CONSTRAINT_MONITOR_WARNING="Docker not running - no learning/persistence"
fi

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
  "services": ["vkb-server", "semantic-analysis", "constraint-monitor"],
  "ports": {
    "vkb-server": 8080,
    "semantic-analysis": 8001,
    "qdrant": 6333,
    "redis": 6379
  },
  "pids": {
    "vkb-server": $VKB_PID,
    "semantic-analysis": "$SEMANTIC_PID"
  },
  "constraint_monitor": {
    "status": "$CONSTRAINT_MONITOR_STATUS",
    "warning": "$CONSTRAINT_MONITOR_WARNING"
  },
  "services_running": $services_running,
  "agent": "claude"
}
EOF

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "📊 SERVICES STATUS SUMMARY"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
if [ $services_running -ge 2 ]; then
    echo "✅ Core services started successfully! ($services_running/2 running)"
else
    echo "⚠️  Some core services not running. Check logs for issues."
fi
echo ""
echo "🛡️ CONSTRAINT MONITOR: $CONSTRAINT_MONITOR_STATUS"
if [ -n "$CONSTRAINT_MONITOR_WARNING" ]; then
    echo "   ⚠️ $CONSTRAINT_MONITOR_WARNING"
fi
echo ""
echo "📊 Full status: .services-running.json"
echo "📝 Logs: vkb-server.log, semantic-analysis.log"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "🎉 Startup complete!"