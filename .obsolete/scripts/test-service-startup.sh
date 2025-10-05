#!/bin/bash
#
# Service Startup Validation Test
# Tests that start-services.sh correctly starts all required services
#
# Usage: ./scripts/test-service-startup.sh

set +e  # Don't exit on errors - we want to report them

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_ROOT="$(dirname "$SCRIPT_DIR")"

# Utility functions
print_header() {
    echo -e "\n${BOLD}${BLUE}============================================${NC}"
    echo -e "${BOLD}${BLUE} $1${NC}"
    echo -e "${BOLD}${BLUE}============================================${NC}\n"
}

print_section() {
    echo -e "\n${BOLD}${PURPLE}>>> $1${NC}\n"
}

print_test() {
    echo -e "${CYAN}[TEST] $1${NC}"
}

print_check() {
    echo -e "  ${BLUE}[CHECK]${NC} $1"
}

print_pass() {
    echo -e "  ${GREEN}[PASS]${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

print_fail() {
    echo -e "  ${RED}[FAIL]${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

print_info() {
    echo -e "  ${BLUE}[INFO]${NC} $1"
}

print_warning() {
    echo -e "  ${YELLOW}[WARNING]${NC} $1"
}

# Helper functions
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

check_port() {
    local port=$1
    lsof -i :$port >/dev/null 2>&1
}

print_header "SERVICE STARTUP VALIDATION TEST"

echo -e "${BOLD}Test started at:${NC} $(date)"
echo -e "${BOLD}Coding root:${NC} $CODING_ROOT"
echo -e "${BOLD}Current directory:${NC} $(pwd)"

# =============================================================================
# PHASE 1: PRE-FLIGHT CHECKS
# =============================================================================

print_section "PHASE 1: Pre-Flight Checks"

print_test "Required scripts existence"

print_check "start-services.sh exists"
if [ -f "$CODING_ROOT/start-services.sh" ]; then
    print_pass "start-services.sh found"
else
    print_fail "start-services.sh not found"
    exit 1
fi

print_check "stop-services.sh exists"
if [ -f "$CODING_ROOT/stop-services.sh" ]; then
    print_pass "stop-services.sh found"
else
    print_fail "stop-services.sh not found"
    exit 1
fi

# =============================================================================
# PHASE 2: STOP EXISTING SERVICES
# =============================================================================

print_section "PHASE 2: Clean Slate - Stop Existing Services"

print_test "Stopping any running services"
print_check "Executing stop-services.sh"
cd "$CODING_ROOT"
if ./stop-services.sh >/dev/null 2>&1; then
    print_pass "stop-services.sh executed successfully"
else
    print_warning "stop-services.sh had issues (may be expected if nothing running)"
fi

# Wait for graceful shutdown
sleep 3

# Verify no services running
print_check "Verifying clean state"
STRAY_PROCESSES=0

if ps aux | grep -q "[e]nhanced-transcript-monitor.js"; then
    print_warning "Enhanced transcript monitor still running"
    STRAY_PROCESSES=$((STRAY_PROCESSES + 1))
fi

if ps aux | grep -q "[l]ive-logging-coordinator.js"; then
    print_warning "Live logging coordinator still running"
    STRAY_PROCESSES=$((STRAY_PROCESSES + 1))
fi

if check_port 8080; then
    print_warning "Port 8080 still in use"
    STRAY_PROCESSES=$((STRAY_PROCESSES + 1))
fi

if [ $STRAY_PROCESSES -eq 0 ]; then
    print_pass "Clean slate achieved - no stray processes"
else
    print_warning "Found $STRAY_PROCESSES stray processes (will be cleaned up by start script)"
fi

# =============================================================================
# PHASE 3: START SERVICES
# =============================================================================

print_section "PHASE 3: Service Startup"

print_test "Starting services with start-services.sh"
print_check "Executing start-services.sh"

if ./start-services.sh >/dev/null 2>&1; then
    print_pass "start-services.sh executed without errors"
else
    print_fail "start-services.sh failed with exit code $?"
    print_info "Check start-services.sh output for errors"
fi

# Wait for services to stabilize
print_info "Waiting 5 seconds for services to stabilize..."
sleep 5

# =============================================================================
# PHASE 4: VERIFY SERVICE TRACKING
# =============================================================================

print_section "PHASE 4: Service Tracking Verification"

print_test "Service tracking file creation"
print_check ".services-running.json existence"
if [ -f "$CODING_ROOT/.services-running.json" ]; then
    print_pass ".services-running.json created"

    # Validate JSON structure
    print_check "JSON structure validation"
    if command_exists jq; then
        if jq empty "$CODING_ROOT/.services-running.json" 2>/dev/null; then
            print_pass "Valid JSON structure"

            # Extract service count
            SERVICE_COUNT=$(jq '.services_running' "$CODING_ROOT/.services-running.json" 2>/dev/null || echo "0")
            print_info "Services running: $SERVICE_COUNT"

            if [ "$SERVICE_COUNT" -ge 4 ]; then
                print_pass "Core services started ($SERVICE_COUNT/4+)"
            else
                print_fail "Insufficient services running ($SERVICE_COUNT/4+)"
            fi

            # Check timestamp
            TIMESTAMP=$(jq -r '.timestamp' "$CODING_ROOT/.services-running.json" 2>/dev/null)
            print_info "Service start timestamp: $TIMESTAMP"

        else
            print_fail "Invalid JSON structure in .services-running.json"
        fi
    else
        print_warning "jq not available - skipping JSON validation"
    fi
else
    print_fail ".services-running.json not created"
fi

# =============================================================================
# PHASE 5: VERIFY INDIVIDUAL SERVICES
# =============================================================================

print_section "PHASE 5: Individual Service Verification"

print_test "Enhanced Transcript Monitor"
print_check "Process running"
if ps aux | grep -q "[e]nhanced-transcript-monitor.js"; then
    MONITOR_PID=$(ps aux | grep "[e]nhanced-transcript-monitor.js" | awk '{print $2}' | head -1)
    print_pass "Enhanced Transcript Monitor running (PID: $MONITOR_PID)"
else
    print_fail "Enhanced Transcript Monitor not running"
fi

print_test "Live Logging Coordinator"
print_check "Process running"
if ps aux | grep -q "[l]ive-logging-coordinator.js"; then
    COORD_PID=$(ps aux | grep "[l]ive-logging-coordinator.js" | awk '{print $2}' | head -1)
    print_pass "Live Logging Coordinator running (PID: $COORD_PID)"
else
    print_fail "Live Logging Coordinator not running"
fi

print_test "VKB Server"
print_check "Port 8080 listening"
if check_port 8080; then
    VKB_PID=$(lsof -t -i :8080 2>/dev/null | head -1)
    print_pass "VKB Server listening on port 8080 (PID: $VKB_PID)"
else
    print_fail "VKB Server not listening on port 8080"
fi

print_test "Semantic Analysis MCP Server"
print_check "Configuration"
if [ -f "$CODING_ROOT/integrations/mcp-server-semantic-analysis/dist/index.js" ]; then
    print_pass "Semantic Analysis MCP Server built and ready (stdio transport)"
else
    print_fail "Semantic Analysis MCP Server not built"
fi

# =============================================================================
# PHASE 6: GLOBAL LSL COORDINATOR INTEGRATION
# =============================================================================

print_section "PHASE 6: Global LSL Coordinator Integration"

print_test "Global LSL Coordinator availability"
print_check "Script existence"
if [ -f "$CODING_ROOT/scripts/global-lsl-coordinator.js" ]; then
    print_pass "global-lsl-coordinator.js found"

    # Test coordinator status command
    print_check "Coordinator status command"
    if timeout 5s node "$CODING_ROOT/scripts/global-lsl-coordinator.js" status >/dev/null 2>&1; then
        print_pass "Coordinator status command functional"
    else
        print_warning "Coordinator status command failed (may need active sessions)"
    fi
else
    print_fail "global-lsl-coordinator.js not found"
fi

# =============================================================================
# PHASE 7: MONITORING VERIFIER SYSTEM
# =============================================================================

print_section "PHASE 7: Monitoring Verification System"

print_test "Monitoring verifier script"
print_check "Script existence"
if [ -f "$CODING_ROOT/scripts/monitoring-verifier.js" ]; then
    print_pass "monitoring-verifier.js found"

    # Test monitoring verification (may fail if services just started)
    print_check "Monitoring verification check"
    if timeout 10s node "$CODING_ROOT/scripts/monitoring-verifier.js" --project "$CODING_ROOT" >/dev/null 2>&1; then
        print_pass "Monitoring verification passed"
    else
        print_warning "Monitoring verification failed (expected if services just started)"
    fi
else
    print_fail "monitoring-verifier.js not found"
fi

# =============================================================================
# PHASE 8: CONSTRAINT MONITOR SYSTEM
# =============================================================================

print_section "PHASE 8: Constraint Monitor System (Optional)"

print_test "Constraint Monitor status"

# Check if Docker is running
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    print_info "Docker is running"

    # Check if constraint monitor databases are running
    print_check "Constraint Monitor databases"
    QDRANT_RUNNING=$(docker ps --filter "name=qdrant" --format "table {{.Names}}" | grep -c qdrant || echo "0")
    REDIS_RUNNING=$(docker ps --filter "name=redis" --format "table {{.Names}}" | grep -c redis || echo "0")

    if [ "$QDRANT_RUNNING" -gt 0 ] && [ "$REDIS_RUNNING" -gt 0 ]; then
        print_pass "Constraint Monitor databases running (Qdrant + Redis)"

        # Check web services
        print_check "Constraint Monitor web services"
        if check_port 3030 && check_port 3031; then
            print_pass "Dashboard (3030) and API (3031) running"
        else
            print_warning "Web services not fully available"
        fi
    else
        print_info "Constraint Monitor databases not running (optional feature)"
    fi
else
    print_info "Docker not running - Constraint Monitor in degraded mode (optional)"
fi

# =============================================================================
# PHASE 9: CLEANUP
# =============================================================================

print_section "PHASE 9: Cleanup After Testing"

print_test "Service cleanup"
print_check "Executing stop-services.sh"
if ./stop-services.sh >/dev/null 2>&1; then
    print_pass "Services stopped cleanly"
else
    print_warning "stop-services.sh had issues during cleanup"
fi

# =============================================================================
# FINAL REPORT
# =============================================================================

print_header "TEST SUMMARY"

TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))

echo -e "${BOLD}Total Tests:${NC} $TOTAL_TESTS"
echo -e "${GREEN}Tests Passed:${NC} $TESTS_PASSED"
echo -e "${RED}Tests Failed:${NC} $TESTS_FAILED"
echo ""

if [ $TOTAL_TESTS -gt 0 ]; then
    SUCCESS_RATE=$(( (TESTS_PASSED * 100) / TOTAL_TESTS ))
    echo -e "${BOLD}Success Rate:${NC} $SUCCESS_RATE%"
    echo ""
fi

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${BOLD}${GREEN}✅ ALL TESTS PASSED${NC}"
    echo -e "${GREEN}Service startup system is working correctly!${NC}"
    exit 0
else
    echo -e "${BOLD}${RED}❌ SOME TESTS FAILED${NC}"
    echo -e "${RED}Please review the failures above and fix any issues.${NC}"
    exit 1
fi
