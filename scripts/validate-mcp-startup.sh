#!/bin/bash
# MCP Services Startup Validation Script

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Derive coding directory from script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_DIR="${CODING_TOOLS_PATH:-${CODING_REPO:-$(dirname "$SCRIPT_DIR")}}"

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

# Which services must be up?
#
# This used to gate the whole launch on VKB Server listening on :8080. That
# server is retired and the port is no longer published, so the gate could never
# pass: `claude-mcp` waited the full 30s and exited 1 with the container sitting
# there healthy. Check the container services the enabled features actually
# need instead, so the gate cannot outlive the thing it checks.
if [ -f "$CODING_DIR/.env.ports" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$CODING_DIR/.env.ports"
    set +a
fi

# An absent snapshot means "everything on" — the same convention the container
# entrypoint uses — so a stale or missing file never silently skips a check.
FEATURES_SNAPSHOT="$CODING_DIR/.coding/runtime/features.json"
feature_enabled() {
    [ -f "$FEATURES_SNAPSHOT" ] || return 0
    node -e '
        const snap = require(process.argv[1]);
        const on = Array.isArray(snap.enabled) ? snap.enabled : null;
        process.exit(!on || on.includes(process.argv[2]) ? 0 : 1);
    ' "$FEATURES_SNAPSHOT" "$1" 2>/dev/null
}

# name|port|url|mode   (mode: health = needs 2xx, listen = any HTTP reply)
REQUIRED_SERVICES=""
feature_enabled knowledge && REQUIRED_SERVICES="$REQUIRED_SERVICES
Semantic Analysis|${SEMANTIC_ANALYSIS_SSE_PORT:-3848}|http://localhost:${SEMANTIC_ANALYSIS_SSE_PORT:-3848}/health|health"
feature_enabled constraints && REQUIRED_SERVICES="$REQUIRED_SERVICES
Constraint Monitor|${CONSTRAINT_MONITOR_SSE_PORT:-3849}|http://localhost:${CONSTRAINT_MONITOR_SSE_PORT:-3849}/health|health"
# graphify speaks MCP only and has no /health route: a bare GET is rejected at
# the JSON-RPC layer (400), which still proves the server is listening.
feature_enabled codegraph && REQUIRED_SERVICES="$REQUIRED_SERVICES
Graphify MCP|${GRAPHIFY_MCP_PORT:-3851}|http://localhost:${GRAPHIFY_MCP_PORT:-3851}/mcp|listen"

REQUIRED_SERVICES="$(printf '%s\n' "$REQUIRED_SERVICES" | sed '/^$/d')"

if [ -z "$REQUIRED_SERVICES" ]; then
    echo -e "${GREEN}✅ No container-backed features enabled - nothing to validate${NC}"
    exit 0
fi

check_service() {
    local url=$1 mode=$2
    if [ "$mode" = "listen" ]; then
        curl -s --max-time 5 -o /dev/null "$url" >/dev/null 2>&1
    else
        curl -sf --max-time 5 "$url" >/dev/null 2>&1
    fi
}

# Wait for services to start up
echo -e "${YELLOW}⏳ Waiting for services to start (timeout: ${TIMEOUT}s)...${NC}"

start_time=$(date +%s)
all_ready=false
check_count=0

while [ $(($(date +%s) - start_time)) -lt $TIMEOUT ]; do
    elapsed=$(($(date +%s) - start_time))
    remaining=$((TIMEOUT - elapsed))
    check_count=$((check_count + 1))

    echo -e "\n${BLUE}📊 Service Status Check #${check_count} (${remaining}s remaining)${NC}"

    services_ok=0
    total_services=0
    while IFS='|' read -r name port url mode; do
        [ -n "$name" ] || continue
        total_services=$((total_services + 1))
        if check_service "$url" "$mode"; then
            echo -e "${GREEN}✅ $name (port $port): Ready${NC}"
            services_ok=$((services_ok + 1))
        else
            echo -e "${RED}❌ $name (port $port): Not ready${NC}"
        fi
    done <<EOF
$REQUIRED_SERVICES
EOF

    # MCP servers run via stdio, not as separate processes
    echo -e "${YELLOW}⚠️  MCP servers run via stdio (not as separate processes)${NC}"

    if [ "$services_ok" -eq "$total_services" ]; then
        all_ready=true
        break
    fi

    echo -e "${YELLOW}⏳ $services_ok/$total_services services ready, retrying in ${RETRY_INTERVAL}s... (${remaining}s left)${NC}"
    sleep $RETRY_INTERVAL
done

echo -e "\n${BLUE}📋 Final Status Report:${NC}"

if [ "$all_ready" = true ]; then
    echo -e "${GREEN}🎉 Core MCP services are running!${NC}"
    echo -e "${GREEN}✅ System ready for Claude Code session${NC}"
    exit 0
else
    echo -e "${RED}❌ Critical services failed to start within ${TIMEOUT} seconds${NC}"
    echo -e "${YELLOW}💡 Troubleshooting tips:${NC}"
    echo "   1. Check container state: docker ps --filter name=coding-services"
    echo "   2. Check container logs: docker compose -f ${CODING_DIR}/docker/docker-compose.yml logs coding-services"
    echo "   3. Restart services: docker compose -f ${CODING_DIR}/docker/docker-compose.yml restart coding-services"
    echo "   4. Check which features are enabled: coding-features list"
    exit 1
fi
