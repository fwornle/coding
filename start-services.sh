#!/bin/bash

# Simple reliable service startup script
# This replaces the complex startup system

set -e

echo "🚀 Starting Coding Services..."

# Load environment variables from .env files (for API keys like GROQ_API_KEY)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
    echo "✅ Loaded environment variables from .env"
fi

if [ -f "$SCRIPT_DIR/.env.ports" ]; then
    set -a
    source "$SCRIPT_DIR/.env.ports"
    set +a
fi

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
        
        # Check if docker-compose.yml exists
        if [ -f "docker-compose.yml" ]; then
            echo "   📋 Found docker-compose.yml, using docker-compose..."
            
            # Check if containers are already running
            if docker-compose ps | grep -E "(qdrant|redis)" | grep -q "Up"; then
                echo "✅ Constraint Monitor databases already running (docker-compose)"
                CONSTRAINT_MONITOR_STATUS="✅ FULLY OPERATIONAL"
            else
                echo "   🚀 Starting containers with docker-compose..."
                
                # Pull images if needed (with timeout)
                echo "   📦 Pulling latest images..."
                timeout 120 docker-compose pull || echo "   ⚠️ Image pull timeout, using existing images"
                
                # Start containers with docker-compose
                if timeout 60 docker-compose up -d; then
                    echo "   ⏳ Waiting for containers to be ready..."
                    sleep 5
                    
                    # Wait for health checks
                    for i in {1..12}; do
                        if docker-compose ps | grep -E "(qdrant|redis)" | grep -q "Up.*healthy"; then
                            echo "✅ Constraint Monitor databases started successfully"
                            CONSTRAINT_MONITOR_STATUS="✅ FULLY OPERATIONAL"
                            break
                        elif [ $i -eq 12 ]; then
                            echo "⚠️ Containers started but health checks not passing"
                            CONSTRAINT_MONITOR_STATUS="⚠️ DEGRADED MODE"
                            CONSTRAINT_MONITOR_WARNING="Health checks failing"
                        else
                            echo "   ⏳ Waiting for health checks... ($i/12)"
                            sleep 5
                        fi
                    done
                    
                    # Initialize databases if needed
                    if [ "$CONSTRAINT_MONITOR_STATUS" = "✅ FULLY OPERATIONAL" ] && [ -f "scripts/setup-databases.js" ] && [ ! -f ".initialized" ]; then
                        echo "🔧 Initializing Constraint Monitor databases..."
                        if npm run setup 2>/dev/null; then
                            touch .initialized
                            echo "✅ Databases initialized"
                        else
                            echo "⚠️ Database initialization failed, but continuing..."
                        fi
                    fi
                else
                    echo "⚠️ Failed to start containers with docker-compose"
                    CONSTRAINT_MONITOR_STATUS="⚠️ DEGRADED MODE"
                    CONSTRAINT_MONITOR_WARNING="Docker compose startup failed"
                fi
            fi
        else
            echo "   ⚠️ No docker-compose.yml found, trying manual container startup..."
            
            # Fallback to manual container startup (existing logic)
            qdrant_running=$(docker ps --filter "name=constraint-monitor-qdrant" --format "table {{.Names}}" | grep -c constraint-monitor-qdrant || echo "0")
            redis_running=$(docker ps --filter "name=constraint-monitor-redis" --format "table {{.Names}}" | grep -c constraint-monitor-redis || echo "0")
            
            if [ "$qdrant_running" -gt 0 ] && [ "$redis_running" -gt 0 ]; then
                echo "✅ Constraint Monitor databases already running (manual containers)"
                CONSTRAINT_MONITOR_STATUS="✅ FULLY OPERATIONAL"
            else
                echo "   🚀 Starting containers manually..."
                
                # Start Qdrant container
                if ! docker ps | grep -q constraint-monitor-qdrant; then
                    docker run -d --name constraint-monitor-qdrant \
                        -p 6333:6333 -p 6334:6334 \
                        qdrant/qdrant:v1.15.0 || echo "   ⚠️ Failed to start Qdrant container"
                fi
                
                # Start Redis container
                if ! docker ps | grep -q constraint-monitor-redis; then
                    docker run -d --name constraint-monitor-redis \
                        -p 6379:6379 \
                        redis:7-alpine || echo "   ⚠️ Failed to start Redis container"
                fi
                
                # Check if containers started successfully
                sleep 3
                qdrant_check=$(docker ps --filter "name=constraint-monitor-qdrant" --format "table {{.Names}}" | grep -c constraint-monitor-qdrant || echo "0")
                redis_check=$(docker ps --filter "name=constraint-monitor-redis" --format "table {{.Names}}" | grep -c constraint-monitor-redis || echo "0")
                
                if [ "$qdrant_check" -gt 0 ] && [ "$redis_check" -gt 0 ]; then
                    echo "✅ Constraint Monitor databases started manually"

                    # Start constraint monitor web services
                    echo "🚀 Starting constraint monitor web services..."
                    cd "$CODING_DIR/integrations/mcp-constraint-monitor"

                    # Start dashboard on port 3030 in background
                    PORT=3030 npm run dashboard > /dev/null 2>&1 &
                    dashboard_pid=$!

                    # Start API server on port 3031 in background
                    npm run api > /dev/null 2>&1 &
                    api_pid=$!

                    # Wait for services to start
                    sleep 3

                    # Check if web services are running
                    dashboard_running=$(lsof -ti:3030 | wc -l)
                    api_running=$(lsof -ti:3031 | wc -l)

                    if [ "$dashboard_running" -gt 0 ] && [ "$api_running" -gt 0 ]; then
                        echo "✅ Constraint Monitor web services started (dashboard:3030, api:3031)"
                        CONSTRAINT_MONITOR_STATUS="✅ FULLY OPERATIONAL"
                    else
                        echo "⚠️ Failed to start constraint monitor web services"
                        CONSTRAINT_MONITOR_STATUS="⚠️ DEGRADED MODE"
                        CONSTRAINT_MONITOR_WARNING="Web services startup failed"
                    fi
                else
                    echo "⚠️ Failed to start some containers manually"
                    CONSTRAINT_MONITOR_STATUS="⚠️ DEGRADED MODE"
                    CONSTRAINT_MONITOR_WARNING="Manual container startup failed"
                fi
            fi
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
    echo "   • No semantic analysis (Grok inference engine)"
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

# Start Live Logging System (with proper transcript monitoring)
echo "🟢 Starting Live Logging System..."
cd "$CODING_DIR"

# Check for existing processes before starting (prevent duplicates)
echo "🧹 Checking for existing live-logging processes..."

# Check if enhanced-transcript-monitor is already running
if node scripts/psm-register.js --check transcript-monitor global 2>/dev/null; then
    echo "⚠️  Transcript Monitor already running globally, skipping startup..."
    echo "   (Per-project monitors will be started by global-lsl-coordinator)"
    TRANSCRIPT_PID="already-running"
else
    # Start the transcript monitor (this handles session transitions)
    echo "📋 Starting Transcript Monitor with session transitions..."
    nohup node scripts/enhanced-transcript-monitor.js > transcript-monitor.log 2>&1 &
    TRANSCRIPT_PID=$!
    echo "   Transcript Monitor PID: $TRANSCRIPT_PID"

    # Register with Process State Manager
    if [ "$TRANSCRIPT_PID" != "already-running" ]; then
        node scripts/psm-register.js transcript-monitor $TRANSCRIPT_PID global scripts/enhanced-transcript-monitor.js
    fi
fi

# Check if live-logging coordinator is already running
if node scripts/psm-register.js --check live-logging-coordinator global 2>/dev/null; then
    LIVE_LOGGING_PID="already-running"
    echo "⚠️  Live Logging Coordinator already running, skipping startup..."
else
    # Start the live-logging coordinator (this handles MCP integration)
    echo "🔄 Starting Live Logging Coordinator..."
    nohup node scripts/live-logging-coordinator.js > logs/live-logging.log 2>&1 &
    LIVE_LOGGING_PID=$!
    echo "   Live Logging Coordinator PID: $LIVE_LOGGING_PID"

    # Register with Process State Manager
    if [ "$LIVE_LOGGING_PID" != "already-running" ]; then
        node scripts/psm-register.js live-logging-coordinator $LIVE_LOGGING_PID global scripts/live-logging-coordinator.js
    fi
fi

# Log startup
echo "$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ") - Live Logging System started: Transcript Monitor PID $TRANSCRIPT_PID, Coordinator PID $LIVE_LOGGING_PID" >> logs/live-logging.log

# Start VKB Server (with online knowledge support)
echo "🟢 Starting VKB Server (port 8080) with online knowledge..."
cd "$CODING_DIR"
# Set data source mode to combined (batch + online knowledge)
export VKB_DATA_SOURCE=combined
nohup node lib/vkb-server/cli.js server start --foreground > vkb-server.log 2>&1 &
VKB_PID=$!

# Register with Process State Manager
node scripts/psm-register.js vkb-server $VKB_PID global lib/vkb-server/cli.js

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

# Check Live Logging System
if [ "$TRANSCRIPT_PID" = "already-running" ]; then
    echo "✅ Transcript Monitor running (pre-existing)"
    services_running=$((services_running + 1))
elif ps -p $TRANSCRIPT_PID > /dev/null 2>&1; then
    echo "✅ Transcript Monitor running (PID: $TRANSCRIPT_PID)"
    services_running=$((services_running + 1))
else
    echo "❌ Transcript Monitor NOT running"
fi

if [ "$LIVE_LOGGING_PID" = "already-running" ]; then
    echo "✅ Live Logging Coordinator running (pre-existing)"
    services_running=$((services_running + 1))
elif ps -p $LIVE_LOGGING_PID > /dev/null 2>&1; then
    echo "✅ Live Logging Coordinator running (PID: $LIVE_LOGGING_PID)"
    services_running=$((services_running + 1))
else
    echo "❌ Live Logging Coordinator NOT running"
fi

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

# Check Constraint Monitor web services (if status is FULLY OPERATIONAL)
if [ "$CONSTRAINT_MONITOR_STATUS" = "✅ FULLY OPERATIONAL" ]; then
    if check_port 3030; then
        echo "✅ Constraint Monitor Dashboard running on port 3030"
        services_running=$((services_running + 1))
    else
        echo "❌ Constraint Monitor Dashboard NOT running on port 3030"
    fi

    if check_port 3031; then
        echo "✅ Constraint Monitor API running on port 3031"
        services_running=$((services_running + 1))
    else
        echo "❌ Constraint Monitor API NOT running on port 3031"
    fi
fi

# Process State Manager now handles service tracking
# Query current status
echo "📊 Querying Process State Manager status..."
node scripts/process-state-manager.js status > /dev/null 2>&1 || echo "⚠️  Warning: Process State Manager query failed"

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "📊 SERVICES STATUS SUMMARY"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
# Calculate expected service count based on constraint monitor status
expected_services=4
if [ "$CONSTRAINT_MONITOR_STATUS" = "✅ FULLY OPERATIONAL" ]; then
    expected_services=6  # Core 4 + Dashboard + API
fi

if [ $services_running -ge $expected_services ]; then
    echo "✅ All services started successfully! ($services_running/$expected_services running)"
elif [ $services_running -ge 4 ]; then
    echo "✅ Core services started successfully! ($services_running/$expected_services running)"
else
    echo "⚠️  Some core services not running ($services_running/$expected_services). Check logs for issues."
fi
echo ""
echo "🛡️ CONSTRAINT MONITOR: $CONSTRAINT_MONITOR_STATUS"
if [ -n "$CONSTRAINT_MONITOR_WARNING" ]; then
    echo "   ⚠️ $CONSTRAINT_MONITOR_WARNING"
fi
echo ""
echo "📊 Process State: node scripts/process-state-manager.js status"
echo "📝 Logs: live-logging.log, vkb-server.log, semantic-analysis.log"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "🎉 Startup complete!"