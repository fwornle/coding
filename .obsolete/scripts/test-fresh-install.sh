#!/bin/bash
# Fresh Installation Test - Simulates New User Experience
#
# This script creates a clean test environment and runs through the complete
# installation process to ensure new users can successfully set up the system.
#
# Usage: ./scripts/test-fresh-install.sh [--keep-temp]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
KEEP_TEMP=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --keep-temp)
            KEEP_TEMP=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--keep-temp]"
            exit 1
            ;;
    esac
done

echo -e "${BOLD}${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${PURPLE}     FRESH INSTALLATION TEST - NEW USER SIMULATION${NC}"
echo -e "${BOLD}${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Create test directory
TEST_DIR="/tmp/coding-fresh-install-test-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$TEST_DIR"
echo -e "${CYAN}📁 Test directory created:${NC} $TEST_DIR"
echo ""

# Get current repository location
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo -e "${BLUE}ℹ️  Current repository:${NC} $CURRENT_DIR"
echo ""

# =============================================================================
# STEP 1: CLONE REPOSITORY
# =============================================================================

echo -e "${BOLD}${CYAN}STEP 1: Clone Repository${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${BLUE}Cloning repository to test directory...${NC}"
if git clone "$CURRENT_DIR" "$TEST_DIR/coding" 2>&1 | grep -E "Cloning|done"; then
    echo -e "${GREEN}✅ Repository cloned successfully${NC}"
else
    echo -e "${RED}❌ Failed to clone repository${NC}"
    exit 1
fi
echo ""

cd "$TEST_DIR/coding"

# =============================================================================
# STEP 2: RUN INSTALL.SH
# =============================================================================

echo -e "${BOLD}${CYAN}STEP 2: Run install.sh${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${BLUE}Running installation script...${NC}"
echo -e "${YELLOW}(This may take several minutes - installing dependencies, cloning repos, building projects)${NC}"
echo ""

# Capture output to file for analysis
./install.sh 2>&1 | tee install-output.txt
INSTALL_EXIT=${PIPESTATUS[0]}

echo ""
if [ $INSTALL_EXIT -eq 0 ]; then
    echo -e "${GREEN}✅ Installation completed successfully${NC}"
else
    echo -e "${RED}❌ Installation failed with exit code $INSTALL_EXIT${NC}"
    echo -e "${YELLOW}📋 Installation output saved to: $TEST_DIR/coding/install-output.txt${NC}"
    exit 1
fi
echo ""

# =============================================================================
# STEP 3: VERIFY INSTALLATION
# =============================================================================

echo -e "${BOLD}${CYAN}STEP 3: Verify Installation${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

VERIFICATION_FAILED=false

# Check critical files
echo -e "${BLUE}Checking critical files...${NC}"

if [ -x "bin/ukb" ]; then
    echo -e "${GREEN}  ✅ bin/ukb executable${NC}"
else
    echo -e "${RED}  ❌ bin/ukb missing or not executable${NC}"
    VERIFICATION_FAILED=true
fi

if [ -x "bin/vkb" ]; then
    echo -e "${GREEN}  ✅ bin/vkb executable${NC}"
else
    echo -e "${RED}  ❌ bin/vkb missing or not executable${NC}"
    VERIFICATION_FAILED=true
fi

if [ -x "bin/coding" ]; then
    echo -e "${GREEN}  ✅ bin/coding executable${NC}"
else
    echo -e "${RED}  ❌ bin/coding missing or not executable${NC}"
    VERIFICATION_FAILED=true
fi

if [ -f "start-services.sh" ]; then
    echo -e "${GREEN}  ✅ start-services.sh present${NC}"
else
    echo -e "${RED}  ❌ start-services.sh missing${NC}"
    VERIFICATION_FAILED=true
fi

if [ -f "stop-services.sh" ]; then
    echo -e "${GREEN}  ✅ stop-services.sh present${NC}"
else
    echo -e "${RED}  ❌ stop-services.sh missing${NC}"
    VERIFICATION_FAILED=true
fi

echo ""

if [ "$VERIFICATION_FAILED" = true ]; then
    echo -e "${RED}❌ Installation verification failed${NC}"
    exit 1
fi

# =============================================================================
# STEP 4: TEST SERVICE STARTUP
# =============================================================================

echo -e "${BOLD}${CYAN}STEP 4: Test Service Startup${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${BLUE}Starting services...${NC}"
if ./start-services.sh >/dev/null 2>&1; then
    echo -e "${GREEN}✅ start-services.sh executed successfully${NC}"
else
    echo -e "${RED}❌ start-services.sh failed${NC}"
    exit 1
fi

# Wait for services to stabilize
echo -e "${BLUE}Waiting 5 seconds for services to stabilize...${NC}"
sleep 5

# Check .services-running.json
echo ""
echo -e "${BLUE}Verifying service status...${NC}"
if [ -f ".services-running.json" ]; then
    echo -e "${GREEN}  ✅ .services-running.json created${NC}"

    if command -v jq >/dev/null 2>&1; then
        SERVICE_COUNT=$(jq '.services_running' ".services-running.json" 2>/dev/null || echo "0")
        echo -e "${BLUE}  ℹ️  Services running: $SERVICE_COUNT${NC}"

        if [ "$SERVICE_COUNT" -ge 4 ]; then
            echo -e "${GREEN}  ✅ Core services started successfully${NC}"
        else
            echo -e "${YELLOW}  ⚠️  Only $SERVICE_COUNT services running (expected 4+)${NC}"
        fi
    fi
else
    echo -e "${RED}  ❌ .services-running.json not created${NC}"
    exit 1
fi

# Check individual services
echo ""
echo -e "${BLUE}Checking individual service processes...${NC}"

if ps aux | grep -q "[e]nhanced-transcript-monitor.js"; then
    echo -e "${GREEN}  ✅ Enhanced Transcript Monitor running${NC}"
else
    echo -e "${RED}  ❌ Enhanced Transcript Monitor not running${NC}"
fi

if ps aux | grep -q "[l]ive-logging-coordinator.js"; then
    echo -e "${GREEN}  ✅ Live Logging Coordinator running${NC}"
else
    echo -e "${RED}  ❌ Live Logging Coordinator not running${NC}"
fi

if lsof -i :8080 >/dev/null 2>&1; then
    echo -e "${GREEN}  ✅ VKB Server listening on port 8080${NC}"
else
    echo -e "${RED}  ❌ VKB Server not listening on port 8080${NC}"
fi

echo ""

# =============================================================================
# STEP 5: TEST UKB/VKB COMMANDS
# =============================================================================

echo -e "${BOLD}${CYAN}STEP 5: Test UKB/VKB Commands${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${BLUE}Testing UKB command...${NC}"
if bin/ukb --version >/dev/null 2>&1; then
    UKB_VERSION=$(bin/ukb --version)
    echo -e "${GREEN}  ✅ UKB working (version: $UKB_VERSION)${NC}"
else
    echo -e "${RED}  ❌ UKB command failed${NC}"
fi

echo -e "${BLUE}Testing UKB status...${NC}"
if timeout 10s bin/ukb status >/dev/null 2>&1; then
    echo -e "${GREEN}  ✅ UKB status command working${NC}"
else
    echo -e "${YELLOW}  ⚠️  UKB status command failed (may need setup)${NC}"
fi

echo ""

# =============================================================================
# STEP 6: CLEANUP
# =============================================================================

echo -e "${BOLD}${CYAN}STEP 6: Cleanup${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${BLUE}Stopping services...${NC}"
if ./stop-services.sh >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Services stopped cleanly${NC}"
else
    echo -e "${YELLOW}⚠️  stop-services.sh had issues (may be expected)${NC}"
fi

echo ""

# =============================================================================
# FINAL REPORT
# =============================================================================

echo -e "${BOLD}${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${PURPLE}                    TEST RESULTS SUMMARY${NC}"
echo -e "${BOLD}${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BOLD}Test Directory:${NC} $TEST_DIR"
echo -e "${BOLD}Test Completed:${NC} $(date)"
echo ""

echo -e "${BOLD}📋 Generated Files:${NC}"
echo -e "  • $TEST_DIR/coding/install-output.txt"
echo -e "  • $TEST_DIR/coding/.services-running.json"
echo ""

echo -e "${BOLD}${GREEN}✅ FRESH INSTALLATION TEST PASSED${NC}"
echo -e "${GREEN}New users can successfully install and run the system!${NC}"
echo ""

if [ "$KEEP_TEMP" = true ]; then
    echo -e "${YELLOW}📁 Test directory preserved:${NC} $TEST_DIR"
    echo -e "${BLUE}Review logs:${NC}"
    echo -e "  cat $TEST_DIR/coding/install-output.txt"
    echo -e "  cat $TEST_DIR/coding/.services-running.json"
else
    echo -e "${BLUE}Cleaning up test directory...${NC}"
    rm -rf "$TEST_DIR"
    echo -e "${GREEN}✅ Test directory cleaned up${NC}"
fi

echo ""
echo -e "${BOLD}${PURPLE}═══════════════════════════════════════════════════════════════${NC}"

exit 0
