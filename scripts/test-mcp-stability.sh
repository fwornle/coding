#!/bin/bash
# MCP Stability Testing Script

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧪 MCP Stability Testing Suite${NC}"
echo -e "${BLUE}================================${NC}"

passed_tests=0
total_tests=0

# Test function
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    ((total_tests++))
    echo -e "\n${BLUE}Test $total_tests: $test_name${NC}"
    
    if eval "$test_command"; then
        echo -e "${GREEN}✅ PASSED${NC}"
        ((passed_tests++))
        return 0
    else
        echo -e "${RED}❌ FAILED${NC}"
        return 1
    fi
}

# Test 1: VKB Server Port
run_test "VKB Server Port Listening" \
    "lsof -i :8080 -sTCP:LISTEN >/dev/null 2>&1"

# Test 2: MQTT Broker Port
run_test "MQTT Broker Port Listening" \
    "lsof -i :1883 -sTCP:LISTEN >/dev/null 2>&1"

# Test 3: JSON-RPC Server Port
run_test "JSON-RPC Server Port Listening" \
    "lsof -i :8081 -sTCP:LISTEN >/dev/null 2>&1"

# Test 4: MCP Memory Process
run_test "MCP Memory Server Process" \
    "pgrep -f 'mcp-server-memory' >/dev/null 2>&1"

# Test 5: VKB Server HTTP Response
run_test "VKB Server HTTP Response" \
    "curl -s --max-time 5 http://localhost:8080/ >/dev/null 2>&1"

# Test 6: Health Endpoint (if available)
run_test "VKB Health Endpoint" \
    "curl -s --max-time 5 http://localhost:8080/health | grep -q 'status\\|healthy' || curl -s --max-time 5 http://localhost:8080/health >/dev/null 2>&1"

# Test 7: MCP Configuration File
run_test "MCP Configuration File Exists" \
    "test -f /Users/q284340/Agentic/coding/claude-code-mcp-processed.json"

# Test 8: Semantic Analysis MCP Server Import
run_test "Semantic Analysis MCP Server Import" \
    "cd /Users/q284340/Agentic/coding/semantic-analysis-system && timeout 5s node -e \"import('./mcp-server/index.js').then(() => console.log('OK')).catch(() => process.exit(1))\" 2>/dev/null"

# Test 9: Process Cleanup Check
run_test "No Orphaned MCP Processes" \
    "[ \$(ps aux | grep -E '(mcp-server|semantic-analysis)' | grep -v grep | wc -l) -lt 10 ]"

# Test 10: Launcher Script Validation
run_test "Launcher Script Executable" \
    "test -x /Users/q284340/Agentic/coding/scripts/claude-mcp-launcher.sh"

# Results Summary
echo -e "\n${BLUE}📊 Test Results Summary${NC}"
echo -e "${BLUE}========================${NC}"

if [ $passed_tests -eq $total_tests ]; then
    echo -e "${GREEN}🎉 All tests passed! ($passed_tests/$total_tests)${NC}"
    echo -e "${GREEN}✅ MCP system is stable and ready${NC}"
    exit 0
else
    failed_tests=$((total_tests - passed_tests))
    echo -e "${RED}❌ $failed_tests tests failed ($passed_tests/$total_tests passed)${NC}"
    echo -e "${YELLOW}💡 System may have stability issues${NC}"
    exit 1
fi