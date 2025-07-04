#!/bin/bash
# MCP Services Startup Validation Script

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

TIMEOUT=30
RETRY_INTERVAL=2

echo -e "${BLUE}🔍 Validating MCP Services Startup...${NC}"

# Function to check if a port is listening
check_port() {
    local port=$1
    local service_name=$2
    
    if lsof -i :$port -sTCP:LISTEN >/dev/null 2>&1; then
        echo -e "${GREEN}✅ $service_name (port $port): Running${NC}"
        return 0
    else
        echo -e "${RED}❌ $service_name (port $port): Not running${NC}"
        return 1
    fi
}

# Function to check health endpoint
check_health() {
    local url=$1
    local service_name=$2
    
    if curl -s --max-time 5 "$url" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ $service_name health check: OK${NC}"
        return 0
    else
        echo -e "${RED}❌ $service_name health check: Failed${NC}"
        return 1
    fi
}

# Function to check MCP process
check_mcp_process() {
    local pattern=$1
    local service_name=$2
    
    if pgrep -f "$pattern" >/dev/null 2>&1; then
        local pid=$(pgrep -f "$pattern")
        echo -e "${GREEN}✅ $service_name process: Running (PID: $pid)${NC}"
        return 0
    else
        echo -e "${RED}❌ $service_name process: Not running${NC}"
        return 1
    fi
}

# Wait for services to start up
echo -e "${YELLOW}⏳ Waiting for services to start (timeout: ${TIMEOUT}s)...${NC}"

start_time=$(date +%s)
all_ready=false

while [ $(($(date +%s) - start_time)) -lt $TIMEOUT ]; do
    echo -e "\n${BLUE}📊 Service Status Check:${NC}"
    
    services_ok=0
    total_services=4
    
    # Check VKB Server (port 8080)
    if check_port 8080 "VKB Server"; then
        ((services_ok++))
    fi
    
    # Check VKB Health Endpoint
    if check_health "http://localhost:8080/health" "VKB Server"; then
        ((services_ok++))
    fi
    
    # Check MQTT Broker (port 1883)
    if check_port 1883 "MQTT Broker"; then
        ((services_ok++))
    fi
    
    # Check JSON-RPC Server (port 8081)
    if check_port 8081 "JSON-RPC Server"; then
        ((services_ok++))
    fi
    
    # MCP servers run via stdio, not as separate processes
    # We can only verify they're configured correctly, not running independently
    echo -e "${YELLOW}⚠️  MCP servers run via stdio (not as separate processes)${NC}"
    
    if [ $services_ok -eq $total_services ]; then
        all_ready=true
        break
    fi
    
    echo -e "${YELLOW}⏳ $services_ok/$total_services services ready, waiting...${NC}"
    sleep $RETRY_INTERVAL
done

echo -e "\n${BLUE}📋 Final Status Report:${NC}"

if [ "$all_ready" = true ]; then
    echo -e "${GREEN}🎉 All MCP services are running and healthy!${NC}"
    echo -e "${GREEN}✅ System ready for Claude Code session${NC}"
    exit 0
else
    echo -e "${RED}❌ Some services failed to start within ${TIMEOUT} seconds${NC}"
    echo -e "${YELLOW}💡 Troubleshooting tips:${NC}"
    echo "   1. Check if ports 8080, 1883, 8081 are free: lsof -i :8080,:1883,:8081"
    echo "   2. Restart services: ./start-services.sh"
    echo "   3. Check logs: tail -f vkb-server.log"
    echo "   4. Install missing dependencies: brew install mosquitto"
    exit 1
fi