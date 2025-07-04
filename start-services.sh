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
for port in 8080 8081 8082 1883; do
    if check_port $port; then
        kill_port $port
    fi
done

# Start VKB Server
echo "🟢 Starting VKB Server (port 8080)..."
cd /Users/q284340/Agentic/coding
nohup node lib/vkb-server/cli.js server start --foreground > vkb-server.log 2>&1 &
VKB_PID=$!

# Start Semantic Analysis System Infrastructure (MQTT broker, JSON-RPC server only)
echo "🟢 Starting Semantic Analysis Infrastructure (ports 1883, 8081)..."
cd /Users/q284340/Agentic/coding/semantic-analysis-system
nohup node infrastructure-only.js > semantic-analysis.log 2>&1 &
SEMANTIC_PID=$!

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

if check_port 1883; then
    echo "✅ MQTT Broker running on port 1883"
    services_running=$((services_running + 1))
else
    echo "❌ MQTT Broker NOT running on port 1883"
fi

if check_port 8081; then
    echo "✅ JSON-RPC Server running on port 8081"
    services_running=$((services_running + 1))
else
    echo "❌ JSON-RPC Server NOT running on port 8081"
fi

if check_port 8082; then
    echo "✅ MCP Server running on port 8082"
    services_running=$((services_running + 1))
else
    echo "⚠️  MCP Server NOT running on port 8082 (may start later)"
fi

# Update services tracking file
cat > .services-running.json << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")",
  "services": ["vkb-server", "semantic-analysis-infrastructure"],
  "ports": {
    "vkb-server": 8080,
    "mqtt-broker": 1883,
    "json-rpc-server": 8081,
    "mcp-server": 8082
  },
  "pids": {
    "vkb-server": $VKB_PID,
    "semantic-analysis-infrastructure": $SEMANTIC_PID
  },
  "services_running": $services_running,
  "agent": "claude"
}
EOF

if [ $services_running -ge 3 ]; then
    echo "✅ Services started successfully! ($services_running/3 running)"
    echo "📊 Services status: .services-running.json"
    echo "📝 Logs: vkb-server.log, semantic-analysis-system/semantic-analysis.log"
else
    echo "⚠️  Only $services_running/3 services running. Check logs for issues."
fi

echo "🎉 Startup complete!"