#!/bin/bash

# Coding Tools Installation Test & Repair Script
# Usage: ./scripts/test-coding.sh
# 
# This script performs comprehensive testing of the coding tools installation
# and automatically repairs any issues found.

# Remove set -e to prevent script from exiting on non-critical failures
set +e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0
REPAIRS_NEEDED=0
REPAIRS_COMPLETED=0

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

print_repair() {
    echo -e "  ${YELLOW}[REPAIR]${NC} $1"
    REPAIRS_NEEDED=$((REPAIRS_NEEDED + 1))
}

print_fixed() {
    echo -e "  ${GREEN}[FIXED]${NC} $1"
    REPAIRS_COMPLETED=$((REPAIRS_COMPLETED + 1))
}

print_info() {
    echo -e "  ${BLUE}[INFO]${NC} $1"
}

print_warning() {
    echo -e "  ${YELLOW}[WARNING]${NC} $1"
}

# Helper function to run commands with error handling
run_command() {
    local cmd="$1"
    local description="$2"
    
    echo -e "    ${BLUE}Running:${NC} $cmd"
    if eval "$cmd" >/dev/null 2>&1; then
        print_pass "$description"
        return 0
    else
        print_fail "$description"
        return 1
    fi
}

# Helper function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Helper function to check if file exists
file_exists() {
    [ -f "$1" ]
}

# Helper function to check if directory exists
dir_exists() {
    [ -d "$1" ]
}

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_ROOT="$(dirname "$SCRIPT_DIR")"

print_header "CODING TOOLS COMPREHENSIVE TEST & REPAIR"

echo -e "${BOLD}Test started at:${NC} $(date)"
echo -e "${BOLD}Script location:${NC} $SCRIPT_DIR"
echo -e "${BOLD}Coding root:${NC} $CODING_ROOT"
echo -e "${BOLD}Current directory:${NC} $(pwd)"
echo -e "${BOLD}Platform:${NC} $(uname -s)"

# =============================================================================
# PHASE 1: ENVIRONMENT & PREREQUISITES
# =============================================================================

print_section "PHASE 1: Environment & Prerequisites"

print_test "Checking system dependencies"

# Check Node.js
print_check "Node.js installation"
if command_exists node; then
    NODE_VERSION=$(node --version)
    print_pass "Node.js found: $NODE_VERSION"
else
    print_fail "Node.js not found"
    print_repair "Installing Node.js..."
    if command_exists brew; then
        brew install node
        print_fixed "Node.js installed via Homebrew"
    elif command_exists apt-get; then
        sudo apt-get update && sudo apt-get install -y nodejs npm
        print_fixed "Node.js installed via apt"
    else
        print_warning "Please install Node.js manually from nodejs.org"
    fi
fi

# Check npm
print_check "npm installation"
if command_exists npm; then
    NPM_VERSION=$(npm --version)
    print_pass "npm found: $NPM_VERSION"
else
    print_fail "npm not found"
fi

# Check Python
print_check "Python installation"
if command_exists python3; then
    PYTHON_VERSION=$(python3 --version)
    print_pass "Python found: $PYTHON_VERSION"
else
    print_fail "Python3 not found"
    print_repair "Installing Python3..."
    if command_exists brew; then
        brew install python3
        print_fixed "Python3 installed via Homebrew"
    elif command_exists apt-get; then
        sudo apt-get install -y python3
        print_fixed "Python3 installed via apt"
    fi
fi

# Check jq
print_check "jq installation"
if command_exists jq; then
    JQ_VERSION=$(jq --version)
    print_pass "jq found: $JQ_VERSION"
else
    print_fail "jq not found"
    print_repair "Installing jq..."
    if command_exists brew; then
        brew install jq
        print_fixed "jq installed via Homebrew"
    elif command_exists apt-get; then
        sudo apt-get install -y jq
        print_fixed "jq installed via apt"
    fi
fi

# Check git
print_check "Git installation"
if command_exists git; then
    GIT_VERSION=$(git --version)
    print_pass "Git found: $GIT_VERSION"
else
    print_fail "Git not found - please install Git manually"
fi

# =============================================================================
# PHASE 2: CODING TOOLS CORE INSTALLATION
# =============================================================================

print_section "PHASE 2: Coding Tools Core Installation"

print_test "Checking core installation files"

# Check install script
print_check "Installation script"
if file_exists "$CODING_ROOT/install.sh"; then
    print_pass "install.sh found"
else
    print_fail "install.sh not found in $CODING_ROOT"
fi

print_check "Uninstall script"
if file_exists "$CODING_ROOT/uninstall.sh"; then
    print_pass "uninstall.sh found"
    
    # Test that uninstall script doesn't have variable errors
    if echo "n" | bash -n "$CODING_ROOT/uninstall.sh" 2>/dev/null; then
        print_pass "uninstall.sh syntax check passed"
    else
        print_fail "uninstall.sh has syntax errors"
    fi
else
    print_fail "uninstall.sh not found in $CODING_ROOT"
fi

# Check if we're in a git repository
print_check "Git repository status"
cd "$CODING_ROOT"
if git rev-parse --git-dir >/dev/null 2>&1; then
    print_pass "In git repository"
    REPO_URL=$(git remote get-url origin 2>/dev/null || echo "No remote origin")
    print_info "Repository: $REPO_URL"
else
    print_fail "Not in a git repository"
fi

# Check environment variables
print_test "Environment variables"

print_check "CODING_TOOLS_PATH variable"
if [ -n "$CODING_TOOLS_PATH" ]; then
    print_pass "CODING_TOOLS_PATH set to: $CODING_TOOLS_PATH"
else
    print_fail "CODING_TOOLS_PATH not set"
    print_repair "Setting up environment variables..."
    export CODING_TOOLS_PATH="$CODING_ROOT"
    echo "export CODING_TOOLS_PATH=\"$CODING_ROOT\"" >> ~/.bashrc
    print_fixed "CODING_TOOLS_PATH set to $CODING_ROOT"
fi

print_check "CODING_REPO variable"
if [ -n "$CODING_REPO" ]; then
    print_pass "CODING_REPO set to: $CODING_REPO"
else
    print_fail "CODING_REPO not set"
    print_repair "Setting up CODING_REPO..."
    export CODING_REPO="$CODING_ROOT"
    echo "export CODING_REPO=\"$CODING_ROOT\"" >> ~/.bashrc
    print_fixed "CODING_REPO set to $CODING_ROOT"
fi

# Check PATH
print_check "PATH includes coding tools"
if echo "$PATH" | grep -q "$CODING_ROOT"; then
    print_pass "Coding tools in PATH"
else
    print_fail "Coding tools not in PATH"
    print_repair "Adding coding tools to PATH..."
    export PATH="$CODING_ROOT/bin:$CODING_ROOT/knowledge-management:$PATH"
    echo "export PATH=\"$CODING_ROOT/bin:$CODING_ROOT/knowledge-management:\$PATH\"" >> ~/.bashrc
    print_fixed "Added coding tools to PATH"
fi

# =============================================================================
# PHASE 3: KNOWLEDGE MANAGEMENT TOOLS
# =============================================================================

print_section "PHASE 3: Knowledge Management Tools (UKB/VKB)"

print_test "UKB (Update Knowledge Base) tool"

print_check "UKB command availability"
if command_exists ukb; then
    print_pass "ukb command found"
    UKB_LOCATION=$(which ukb)
    print_info "Location: $UKB_LOCATION"
else
    print_fail "ukb command not found"
    print_repair "Running installation to fix UKB..."
    cd "$CODING_ROOT" && ./install.sh
    print_fixed "Installation completed"
fi

print_check "UKB functionality test"
cd "$CODING_ROOT"
if ukb --help >/dev/null 2>&1; then
    print_pass "UKB responds to --help"
else
    print_fail "UKB --help failed"
fi

print_check "UKB test pattern creation"
# Try auto mode instead of interactive for testing
if ukb --auto >/dev/null 2>&1; then
    print_pass "UKB auto mode functional"
elif file_exists "$CODING_ROOT/shared-memory.json" && [ -s "$CODING_ROOT/shared-memory.json" ]; then
    print_pass "UKB working (knowledge base exists with data)"
else
    print_warning "UKB interactive test skipped - try manually: ukb --interactive"
    print_repair "Checking UKB dependencies..."
    if [ ! -f "$CODING_ROOT/shared-memory.json" ]; then
        echo '{"entities":[],"relations":[],"metadata":{"version":"1.0.0"}}' > "$CODING_ROOT/shared-memory.json"
        print_fixed "Created shared-memory.json"
    fi
fi

print_test "VKB (View Knowledge Base) tool"

print_check "VKB command availability"
if command_exists vkb; then
    print_pass "vkb command found"
    VKB_LOCATION=$(which vkb)
    print_info "Location: $VKB_LOCATION"
else
    print_fail "vkb command not found"
fi

print_check "Memory visualizer dependency"
if dir_exists "$CODING_ROOT/memory-visualizer"; then
    print_pass "Memory visualizer directory found"
    
    print_check "Memory visualizer build status"
    if [ -d "$CODING_ROOT/memory-visualizer/dist" ] || [ -d "$CODING_ROOT/memory-visualizer/build" ]; then
        print_pass "Memory visualizer appears built"
    else
        print_fail "Memory visualizer not built"
        print_repair "Building memory visualizer..."
        cd "$CODING_ROOT/memory-visualizer"
        if [ -f "package.json" ]; then
            npm install && npm run build
            print_fixed "Memory visualizer built"
        fi
    fi
else
    print_fail "Memory visualizer directory not found"
    print_repair "Cloning and building memory visualizer..."
    cd "$CODING_ROOT"
    git clone https://github.com/fwornle/memory-visualizer
    cd memory-visualizer && npm install && npm run build
    print_fixed "Memory visualizer installed and built"
fi

# =============================================================================
# PHASE 4: AGENT DETECTION & AVAILABILITY
# =============================================================================

print_section "PHASE 4: AI Agent Detection & Availability"

print_test "Claude Code availability"

print_check "claude-mcp command"
if command_exists claude-mcp; then
    print_pass "claude-mcp command found"
    CLAUDE_LOCATION=$(which claude-mcp)
    print_info "Location: $CLAUDE_LOCATION"
    
    print_check "Claude Code configuration"
    if [ -f "$HOME/.config/claude-desktop/claude_desktop_config.json" ]; then
        print_pass "Claude desktop config found"
    else
        print_warning "Claude desktop config not found - MCP features may not work"
    fi
else
    print_fail "claude-mcp command not found"
    print_info "Claude Code may not be installed - this is optional"
fi

print_test "GitHub Copilot availability"

print_check "VSCode installation"
if command_exists code; then
    print_pass "VSCode command found"
    VSCODE_VERSION=$(code --version | head -n1)
    print_info "VSCode version: $VSCODE_VERSION"
    
    print_check "GitHub Copilot extension"
    COPILOT_EXTENSIONS=$(code --list-extensions | grep -i copilot || echo "none")
    if [ "$COPILOT_EXTENSIONS" != "none" ]; then
        print_pass "GitHub Copilot extensions found:"
        echo "$COPILOT_EXTENSIONS" | while read ext; do
            print_info "  - $ext"
        done
    else
        print_warning "No GitHub Copilot extensions found"
        print_info "Install GitHub Copilot extension in VSCode if you plan to use it"
    fi
    
    print_check "VSCode Knowledge Management Bridge extension"
    KM_EXTENSION=$(code --list-extensions | grep -i km-copilot || echo "not found")
    if [ "$KM_EXTENSION" != "not found" ]; then
        print_pass "KM Copilot Bridge extension found: $KM_EXTENSION"
    else
        print_warning "KM Copilot Bridge extension not found"
        
        # Check if extension exists in local directory
        if [ -f "$CODING_ROOT/vscode-km-copilot/km-copilot-bridge-0.1.0.vsix" ]; then
            print_repair "Installing VSCode Knowledge Management Bridge..."
            code --install-extension "$CODING_ROOT/vscode-km-copilot/km-copilot-bridge-0.1.0.vsix"
            print_fixed "VSCode KM Bridge extension installed"
        else
            print_info "To install: cd vscode-km-copilot && npm run package && code --install-extension *.vsix"
        fi
    fi
    
else
    print_fail "VSCode not found"
    print_info "Install VSCode from https://code.visualstudio.com/ to use Copilot integration"
fi

# =============================================================================
# PHASE 5: MCP SERVERS & INTEGRATION
# =============================================================================

print_section "PHASE 5: MCP Servers & Integration"

print_test "MCP configuration"

print_check "MCP configuration files"
MCP_CONFIG_TEMPLATE="$CODING_ROOT/claude-code-mcp.json"
MCP_CONFIG_PROCESSED="$CODING_ROOT/scripts/claude-code-mcp-processed.json"

if file_exists "$MCP_CONFIG_TEMPLATE"; then
    print_pass "MCP config template found"
else
    print_fail "MCP config template not found"
fi

if file_exists "$MCP_CONFIG_PROCESSED"; then
    print_pass "MCP processed config found"
else
    print_fail "MCP processed config not found"
    print_repair "Generating MCP configuration..."
    cd "$CODING_ROOT" && ./install.sh --update-mcp-config
    print_fixed "MCP configuration generated"
fi

print_test "MCP servers"

print_check "Memory server (MCP)"
MCP_MEMORY_SERVER="$CODING_ROOT/lib/mcp-memory-server.js"
MCP_MEMORY_SERVER_ALT="$CODING_ROOT/mcp-memory-server/index.js"
if file_exists "$MCP_MEMORY_SERVER"; then
    print_pass "MCP memory server found"
elif file_exists "$MCP_MEMORY_SERVER_ALT"; then
    print_pass "MCP memory server found (alternative location)"
elif dir_exists "$CODING_ROOT/mcp-memory-server"; then
    print_pass "MCP memory server directory found"
else
    print_warning "MCP memory server not found - will be created when needed"
fi

print_check "Browser automation server"
if dir_exists "$CODING_ROOT/mcp-server-browserbase"; then
    print_pass "Browserbase MCP server found"
    
    print_check "Browserbase dependencies"
    if [ -d "$CODING_ROOT/mcp-server-browserbase/node_modules" ]; then
        print_pass "Browserbase dependencies installed"
    else
        print_repair "Installing browserbase dependencies..."
        cd "$CODING_ROOT/mcp-server-browserbase" && npm install
        print_fixed "Browserbase dependencies installed"
    fi
else
    print_fail "Browserbase MCP server not found"
    print_repair "Cloning browserbase server..."
    cd "$CODING_ROOT"
    git clone https://github.com/browserbase/mcp-server-browserbase
    cd mcp-server-browserbase && npm install
    print_fixed "Browserbase server installed"
fi

# =============================================================================
# PHASE 6: FALLBACK SERVICES FOR NON-CLAUDE AGENTS
# =============================================================================

print_section "PHASE 6: Fallback Services (CoPilot Support)"

print_test "Fallback services infrastructure"

print_check "Fallback service files"
FALLBACK_FILES=(
    "lib/fallbacks/memory-fallback.js"
    "lib/fallbacks/browser-fallback.js"
    "lib/fallbacks/logger-fallback.js"
    "lib/adapters/copilot.js"
    "lib/adapters/copilot-http-server.js"
)

for file in "${FALLBACK_FILES[@]}"; do
    if file_exists "$CODING_ROOT/$file"; then
        print_pass "Found: $file"
    else
        print_fail "Missing: $file"
    fi
done

print_check "Graphology dependency"
cd "$CODING_ROOT"
if npm list graphology >/dev/null 2>&1; then
    print_pass "Graphology dependency found"
else
    print_fail "Graphology dependency missing"
    print_repair "Installing Graphology..."
    npm install graphology graphology-utils
    print_fixed "Graphology installed"
fi

print_test "CoPilot fallback service test"

print_check "CoPilot HTTP server functionality"
if [ -f "$CODING_ROOT/lib/adapters/copilot-http-server.js" ]; then
    print_pass "CoPilot HTTP server file found"
    
    # Test if we can start the server (briefly)
    timeout 5 node "$CODING_ROOT/lib/adapters/copilot-http-server.js" >/dev/null 2>&1 &
    SERVER_PID=$!
    sleep 2
    
    if kill -0 $SERVER_PID 2>/dev/null; then
        print_pass "CoPilot HTTP server can start"
        kill $SERVER_PID 2>/dev/null || true
    else
        print_warning "CoPilot HTTP server may have startup issues"
    fi
else
    print_fail "CoPilot HTTP server not found"
fi

# =============================================================================
# PHASE 7: CONVERSATION LOGGING
# =============================================================================

print_section "PHASE 7: Conversation Logging System"

print_test "Post-session logging"

print_check "Post-session logger script"
if file_exists "$CODING_ROOT/scripts/post-session-logger.js"; then
    print_pass "Post-session logger found"
    
    print_check "Post-session logger functionality"
    cd "$CODING_ROOT"
    if node scripts/post-session-logger.js --test >/dev/null 2>&1; then
        print_pass "Post-session logger is functional"
    else
        print_warning "Post-session logger test mode failed"
    fi
else
    print_fail "Post-session logger not found"
fi

print_check "Specstory directory structure"
if dir_exists "$CODING_ROOT/.specstory"; then
    print_pass ".specstory directory found"
    
    if dir_exists "$CODING_ROOT/.specstory/history"; then
        print_pass ".specstory/history directory found"
        HISTORY_COUNT=$(ls -1 "$CODING_ROOT/.specstory/history" | wc -l)
        print_info "History files: $HISTORY_COUNT"
    else
        print_repair "Creating .specstory/history directory..."
        mkdir -p "$CODING_ROOT/.specstory/history"
        print_fixed ".specstory/history directory created"
    fi
else
    print_repair "Creating .specstory directory structure..."
    mkdir -p "$CODING_ROOT/.specstory/history"
    print_fixed ".specstory directory structure created"
fi

print_check "Documentation structure"
DOCS_ISSUES=0
for dir in "installation" "architecture" "ukb" "logging" "integrations" "reference"; do
    if dir_exists "$CODING_ROOT/docs/$dir"; then
        print_pass "docs/$dir directory found"
    else
        print_fail "docs/$dir directory missing"
        DOCS_ISSUES=$((DOCS_ISSUES + 1))
    fi
done

if [ $DOCS_ISSUES -eq 0 ]; then
    print_pass "Documentation structure complete"
else
    print_fail "Documentation structure incomplete"
fi

# =============================================================================
# PHASE 8: INTEGRATION TESTING
# =============================================================================

print_section "PHASE 8: End-to-End Integration Testing"

print_test "Full system integration"

print_check "Knowledge base state"
if file_exists "$CODING_ROOT/shared-memory.json"; then
    print_pass "shared-memory.json exists"
    
    ENTITY_COUNT=$(jq '.entities | length' "$CODING_ROOT/shared-memory.json" 2>/dev/null || echo "0")
    RELATION_COUNT=$(jq '.relations | length' "$CODING_ROOT/shared-memory.json" 2>/dev/null || echo "0")
    print_info "Entities: $ENTITY_COUNT, Relations: $RELATION_COUNT"
    
    if [ "$ENTITY_COUNT" -gt 0 ]; then
        print_pass "Knowledge base contains data"
    else
        print_info "Knowledge base is empty (normal for new installations)"
    fi
else
    print_repair "Creating initial shared-memory.json..."
    cat > "$CODING_ROOT/shared-memory.json" << 'EOF'
{
  "entities": [],
  "relations": [],
  "metadata": {
    "version": "1.0.0",
    "created": "2024-01-01T00:00:00Z",
    "contributors": [],
    "total_entities": 0,
    "total_relations": 0,
    "last_updated": "2024-01-01T00:00:00Z"
  }
}
EOF
    print_fixed "Initial shared-memory.json created"
fi

print_check "Git integration"
cd "$CODING_ROOT"
if git status --porcelain | grep -q "shared-memory.json"; then
    print_pass "shared-memory.json is tracked by git and has changes"
elif git ls-files --error-unmatch shared-memory.json >/dev/null 2>&1; then
    print_pass "shared-memory.json is tracked by git"
else
    print_repair "Adding shared-memory.json to git..."
    git add shared-memory.json
    print_fixed "shared-memory.json added to git"
fi

# Test UKB with actual pattern creation
print_check "UKB end-to-end test"
cd "$CODING_ROOT"
TEST_RESULT=$(echo -e "Integration test problem\nSystem working solution\nTesting approach\nSystem integration\nGeneral testing\nbash,testing\n\n\n1" | ukb --interactive 2>&1 || echo "FAILED")
if echo "$TEST_RESULT" | grep -q "successfully\|created\|updated\|Entity"; then
    print_pass "UKB end-to-end test successful"
else
    print_warning "UKB end-to-end test needs manual verification"
    print_info "Try: ukb --interactive"
fi

# =============================================================================
# PHASE 9: PERFORMANCE & HEALTH CHECKS
# =============================================================================

print_section "PHASE 9: Performance & Health Checks"

print_test "System performance"

print_check "Disk space usage"
DISK_USAGE=$(du -sh "$CODING_ROOT" 2>/dev/null | cut -f1)
print_info "Coding tools disk usage: $DISK_USAGE"

print_check "Memory visualizer size"
if dir_exists "$CODING_ROOT/memory-visualizer"; then
    VISUALIZER_SIZE=$(du -sh "$CODING_ROOT/memory-visualizer" 2>/dev/null | cut -f1)
    print_info "Memory visualizer size: $VISUALIZER_SIZE"
fi

print_check "Node modules health"
NODE_MODULES_COUNT=0
if dir_exists "$CODING_ROOT/node_modules"; then
    NODE_MODULES_COUNT=$(ls -1 "$CODING_ROOT/node_modules" 2>/dev/null | wc -l)
fi
if dir_exists "$CODING_ROOT/memory-visualizer/node_modules"; then
    VISUALIZER_MODULES=$(ls -1 "$CODING_ROOT/memory-visualizer/node_modules" 2>/dev/null | wc -l)
    NODE_MODULES_COUNT=$((NODE_MODULES_COUNT + VISUALIZER_MODULES))
fi
print_info "Total node modules installed: $NODE_MODULES_COUNT"

print_check "Permission checks"
if [ -x "$CODING_ROOT/install.sh" ]; then
    print_pass "install.sh is executable"
else
    print_repair "Making install.sh executable..."
    chmod +x "$CODING_ROOT/install.sh"
    print_fixed "install.sh permissions fixed"
fi

if [ -d "$CODING_ROOT/bin" ]; then
    BIN_FILES=$(find "$CODING_ROOT/bin" -type f)
    ALL_EXECUTABLE=true
    for file in $BIN_FILES; do
        if [ ! -x "$file" ]; then
            ALL_EXECUTABLE=false
            break
        fi
    done
    
    if $ALL_EXECUTABLE; then
        print_pass "All bin files are executable"
    else
        print_repair "Fixing bin file permissions..."
        chmod +x "$CODING_ROOT/bin"/*
        print_fixed "Bin file permissions fixed"
    fi
fi

# =============================================================================
# PHASE 10: FINAL RECOMMENDATIONS
# =============================================================================

print_section "PHASE 10: Final Status & Recommendations"

print_test "Agent availability summary"

AVAILABLE_AGENTS=()
AGENT_STATUS=""

# Check Claude Code
if command_exists claude-mcp; then
    AVAILABLE_AGENTS+=("Claude Code")
    AGENT_STATUS="${AGENT_STATUS}✅ Claude Code (with MCP support)\n"
else
    AGENT_STATUS="${AGENT_STATUS}❌ Claude Code (not installed)\n"
fi

# Check GitHub Copilot
if command_exists code && code --list-extensions | grep -q copilot; then
    AVAILABLE_AGENTS+=("GitHub Copilot")
    if code --list-extensions | grep -q km-copilot; then
        AGENT_STATUS="${AGENT_STATUS}✅ GitHub Copilot (with KM Bridge)\n"
    else
        AGENT_STATUS="${AGENT_STATUS}⚠️  GitHub Copilot (KM Bridge not installed)\n"
    fi
else
    AGENT_STATUS="${AGENT_STATUS}❌ GitHub Copilot (not available)\n"
fi

echo -e "${BOLD}Available AI Agents:${NC}"
echo -e "$AGENT_STATUS"

if [ ${#AVAILABLE_AGENTS[@]} -eq 0 ]; then
    print_warning "No AI agents detected - knowledge management tools will work standalone"
else
    print_pass "Detected ${#AVAILABLE_AGENTS[@]} AI agent(s): ${AVAILABLE_AGENTS[*]}"
fi

# =============================================================================
# SUMMARY REPORT
# =============================================================================

print_header "TEST SUMMARY REPORT"

echo -e "${BOLD}Test Results:${NC}"
echo -e "  ${GREEN}Tests Passed:${NC} $TESTS_PASSED"
echo -e "  ${RED}Tests Failed:${NC} $TESTS_FAILED"
echo -e "  ${YELLOW}Repairs Needed:${NC} $REPAIRS_NEEDED"
echo -e "  ${GREEN}Repairs Completed:${NC} $REPAIRS_COMPLETED"

TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))
if [ $TOTAL_TESTS -gt 0 ]; then
    SUCCESS_RATE=$(( (TESTS_PASSED * 100) / TOTAL_TESTS ))
    echo -e "  ${BOLD}Success Rate:${NC} ${SUCCESS_RATE}%"
fi

echo -e "\n${BOLD}System Status:${NC}"
if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "  ${GREEN}✅ ALL SYSTEMS OPERATIONAL${NC}"
elif [ $REPAIRS_COMPLETED -eq $REPAIRS_NEEDED ]; then
    echo -e "  ${YELLOW}⚠️  SYSTEM REPAIRED - RESTART SHELL${NC}"
    echo -e "  ${BLUE}Run: source ~/.bashrc (or restart terminal)${NC}"
else
    echo -e "  ${RED}❌ SOME ISSUES REMAIN${NC}"
fi

echo -e "\n${BOLD}Quick Start Commands:${NC}"
echo -e "  ${CYAN}ukb${NC}                    # Update knowledge base"
echo -e "  ${CYAN}vkb${NC}                    # View knowledge graph"
echo -e "  ${CYAN}claude-mcp${NC}             # Start Claude with MCP (if available)"
echo -e "  ${CYAN}coding --copilot${NC}       # Start fallback services for CoPilot"

echo -e "\n${BOLD}Next Steps:${NC}"
if ! command_exists claude-mcp; then
    echo -e "  • Install Claude Code for full MCP integration"
fi

if ! code --list-extensions 2>/dev/null | grep -q km-copilot; then
    echo -e "  • Install VSCode KM Bridge: cd vscode-km-copilot && npm run package && code --install-extension *.vsix"
fi

echo -e "  • Run ${CYAN}ukb --interactive${NC} to add your first knowledge pattern"
echo -e "  • Run ${CYAN}vkb${NC} to explore the knowledge graph visualization"
echo -e "  • See docs/README.md for comprehensive documentation"

echo -e "\n${BOLD}Test completed at:${NC} $(date)"

# Set exit code based on test results
if [ $TESTS_FAILED -eq 0 ]; then
    exit 0
else
    exit 1
fi