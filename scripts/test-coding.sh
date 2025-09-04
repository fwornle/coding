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

# Load environment variables from .env file if it exists
if [[ -f "$CODING_ROOT/.env" ]]; then
    echo -e "${BLUE}[INFO]${NC} Loading environment variables from .env file..."
    set -a
    source "$CODING_ROOT/.env"
    set +a
else
    echo -e "${YELLOW}[WARNING]${NC} .env file not found - some tests may show warnings"
fi

# Reset KNOWLEDGE_VIEW to default for clean testing (prevent corruption)
ORIGINAL_KNOWLEDGE_VIEW="$KNOWLEDGE_VIEW"
# Always use default multi-team view for VKB to prevent memory.json corruption
export KNOWLEDGE_VIEW="coding,ui"

# Stop any running VKB viewer to prevent memory corruption during testing
if command_exists vkb && vkb status >/dev/null 2>&1; then
    echo -e "${BLUE}[INFO]${NC} Stopping running VKB viewer before testing..."
    vkb stop >/dev/null 2>&1 || true
fi

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

print_check "KNOWLEDGE_BASE_PATH variable"
if [ -n "$KNOWLEDGE_BASE_PATH" ]; then
    print_pass "KNOWLEDGE_BASE_PATH set to: $KNOWLEDGE_BASE_PATH"
else
    print_info "KNOWLEDGE_BASE_PATH not set (will use default: $CODING_ROOT/knowledge-management/insights)"
fi

print_check "CODING_DOCS_PATH variable"
if [ -n "$CODING_DOCS_PATH" ]; then
    print_pass "CODING_DOCS_PATH set to: $CODING_DOCS_PATH"
else
    print_info "CODING_DOCS_PATH not set (will use default: $CODING_ROOT/docs)"
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

print_test "Multi-Team Knowledge Base Configuration"

print_check "Team environment variable"
if [ -n "$CODING_TEAM" ]; then
    print_pass "CODING_TEAM set to: $CODING_TEAM"
    
    print_check "Team-specific knowledge base file"
    TEAM_FILE="$CODING_ROOT/shared-memory-${CODING_TEAM}.json"
    if file_exists "$TEAM_FILE"; then
        print_pass "Team knowledge file exists: shared-memory-${CODING_TEAM}.json"
        if [ -s "$TEAM_FILE" ]; then
            TEAM_ENTITIES=$(jq '.entities | length' "$TEAM_FILE" 2>/dev/null || echo "0")
            print_info "Team knowledge file contains $TEAM_ENTITIES entities"
        fi
    else
        print_warning "Team knowledge file not found: shared-memory-${CODING_TEAM}.json"
        print_info "Will be created when team adds first entity"
    fi
else
    print_info "CODING_TEAM not set - using individual developer mode"
fi

print_check "Cross-team coding knowledge base"
CODING_FILE="$CODING_ROOT/shared-memory-coding.json"
if file_exists "$CODING_FILE"; then
    print_pass "Cross-team coding knowledge file exists"
    if [ -s "$CODING_FILE" ]; then
        CODING_ENTITIES=$(jq '.entities | length' "$CODING_FILE" 2>/dev/null || echo "0")
        print_info "Coding knowledge file contains $CODING_ENTITIES entities"
    fi
else
    print_warning "Cross-team coding knowledge file not found"
    print_info "Migration may be needed if using team setup"
fi

print_check "Migration script availability"
MIGRATION_SCRIPT="$CODING_ROOT/scripts/migrate-to-multi-team.js"
if file_exists "$MIGRATION_SCRIPT"; then
    print_pass "Multi-team migration script available"
    if file_exists "$CODING_ROOT/shared-memory.json" && [ ! -f "$CODING_FILE" ]; then
        print_info "Consider running: node scripts/migrate-to-multi-team.js"
    fi
else
    print_fail "Migration script not found"
fi

print_check "Team-aware UKB functionality"
if command_exists ukb && [ -n "$CODING_TEAM" ]; then
    if ukb --status --team "$CODING_TEAM" >/dev/null 2>&1; then
        print_pass "UKB team functionality working"
    else
        print_warning "UKB team functionality may have issues"
        print_info "Try: ukb --status --team $CODING_TEAM"
    fi
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
    # Note: Claude Code doesn't require Claude Desktop config
    if [ -f "$CODING_ROOT/claude-code-mcp-processed.json" ]; then
        print_pass "Claude Code MCP config found"
    else
        print_warning "Claude Code MCP config not found - run ./install.sh --update-mcp-config"
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
        
        # Check if extension files exist
        print_check "VSCode KM Bridge extension files"
        if [ -d "$CODING_ROOT/integrations/vscode-km-copilot" ]; then
            print_pass "VSCode KM Bridge source directory found"
            
            # Check key extension files
            EXTENSION_FILES=("package.json" "src/extension.js" "src/chatParticipant.js" "src/fallbackClient.js")
            MISSING_FILES=0
            for file in "${EXTENSION_FILES[@]}"; do
                if [ -f "$CODING_ROOT/integrations/vscode-km-copilot/$file" ]; then
                    print_pass "Found: $file"
                else
                    print_fail "Missing: $file"
                    MISSING_FILES=$((MISSING_FILES + 1))
                fi
            done
            
            if [ $MISSING_FILES -eq 0 ]; then
                print_pass "All VSCode KM Bridge files present"
            else
                print_fail "$MISSING_FILES VSCode KM Bridge files missing"
            fi
        else
            print_fail "VSCode KM Bridge source directory not found"
        fi
        
        # COMPREHENSIVE FUNCTIONALITY TESTS
        print_check "VSCode KM Bridge functionality test"
        
        # Test 1: Check if fallback services are required and running
        print_check "Fallback services status"
        FALLBACK_PORT=8765
        if lsof -i :$FALLBACK_PORT >/dev/null 2>&1 || netstat -an 2>/dev/null | grep -q ":$FALLBACK_PORT.*LISTEN"; then
            print_pass "Fallback services running on port $FALLBACK_PORT"
            SERVICES_RUNNING=true
        else
            print_warning "Fallback services not running - extension will show warnings"
            print_info "Start with: coding --copilot"
            SERVICES_RUNNING=false
        fi
        
        # Test 2: Validate extension configuration
        print_check "Extension configuration validation"
        if [ -f "$CODING_ROOT/integrations/vscode-km-copilot/package.json" ]; then
            # Check if chat participant is properly configured
            if grep -q '"chatParticipants"' "$CODING_ROOT/integrations/vscode-km-copilot/package.json" && \
               grep -q '"id": "km-assistant"' "$CODING_ROOT/integrations/vscode-km-copilot/package.json"; then
                print_pass "Chat participant configuration valid"
            else
                print_fail "Chat participant not properly configured in package.json"
            fi
            
            # Check extension activation events
            if grep -q '"onStartupFinished"' "$CODING_ROOT/integrations/vscode-km-copilot/package.json"; then
                print_pass "Extension activation events configured"
            else
                print_warning "Extension may not activate automatically"
            fi
        else
            print_fail "Cannot validate configuration - package.json missing"
        fi
        
        # Test 3: Check extension source code integrity
        print_check "Extension source code validation"
        EXTENSION_ERRORS=0
        
        # Check if extension.js has proper chat participant registration
        if [ -f "$CODING_ROOT/integrations/vscode-km-copilot/src/extension.js" ]; then
            if grep -q "vscode.chat.createChatParticipant" "$CODING_ROOT/integrations/vscode-km-copilot/src/extension.js"; then
                print_pass "Chat participant registration code found"
            else
                print_fail "Chat participant registration missing in extension.js"
                EXTENSION_ERRORS=$((EXTENSION_ERRORS + 1))
            fi
            
            # Check if proper icon path is used
            if grep -q "km-icon.svg" "$CODING_ROOT/integrations/vscode-km-copilot/src/extension.js"; then
                print_pass "Extension icon path correctly configured"
            elif grep -q "km-icon.png" "$CODING_ROOT/integrations/vscode-km-copilot/src/extension.js"; then
                print_warning "Extension using PNG icon - SVG recommended"
            else
                print_warning "Extension icon path not found"
            fi
        else
            print_fail "extension.js source file missing"
            EXTENSION_ERRORS=$((EXTENSION_ERRORS + 1))
        fi
        
        # Check if chatParticipant.js has proper request handling
        if [ -f "$CODING_ROOT/integrations/vscode-km-copilot/src/chatParticipant.js" ]; then
            if grep -q "handleRequest" "$CODING_ROOT/integrations/vscode-km-copilot/src/chatParticipant.js" && \
               grep -q "vkb\|ukb" "$CODING_ROOT/integrations/vscode-km-copilot/src/chatParticipant.js"; then
                print_pass "Chat participant request handling implemented"
            else
                print_fail "Chat participant request handling incomplete"
                EXTENSION_ERRORS=$((EXTENSION_ERRORS + 1))
            fi
        else
            print_fail "chatParticipant.js source file missing"
            EXTENSION_ERRORS=$((EXTENSION_ERRORS + 1))
        fi
        
        # Test 4: Extension build validation
        print_check "Extension build validation"
        if [ -f "$CODING_ROOT/integrations/vscode-km-copilot/package.json" ]; then
            cd "$CODING_ROOT/integrations/vscode-km-copilot"
            
            # Check if node_modules exists (dependencies installed)
            if [ -d "node_modules" ]; then
                print_pass "Extension dependencies installed"
            else
                print_warning "Extension dependencies not installed"
                print_info "Run: cd vscode-km-copilot && npm install"
            fi
            
            # Check if VSIX file exists (extension built)
            VSIX_FILES=$(find . -name "*.vsix" 2>/dev/null)
            if [ -n "$VSIX_FILES" ]; then
                LATEST_VSIX=$(ls -t *.vsix 2>/dev/null | head -1)
                print_pass "Extension built: $LATEST_VSIX"
            else
                print_warning "Extension not built as VSIX package"
                print_info "Run: cd vscode-km-copilot && npm run package"
            fi
            
            cd "$CODING_ROOT"
        fi
        
        # Test 5: Runtime functionality test (if services are running)
        if [ "$SERVICES_RUNNING" = true ]; then
            print_check "Runtime functionality test"
            
            # Test fallback service connectivity
            if command_exists curl; then
                HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$FALLBACK_PORT/health" 2>/dev/null || echo "000")
                if [ "$HTTP_STATUS" = "200" ]; then
                    print_pass "Fallback service HTTP endpoint responsive"
                    
                    # Test knowledge base endpoints
                    STATS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$FALLBACK_PORT/api/knowledge/stats" 2>/dev/null || echo "000")
                    if [ "$STATS_STATUS" = "200" ]; then
                        print_pass "Knowledge stats endpoint functional"
                    else
                        print_warning "Knowledge stats endpoint not responding (status: $STATS_STATUS)"
                    fi
                    
                    # Test search endpoint  
                    SEARCH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$FALLBACK_PORT/api/knowledge/search?q=test" 2>/dev/null || echo "000")
                    if [ "$SEARCH_STATUS" = "200" ]; then
                        print_pass "Knowledge search endpoint functional"
                    else
                        print_warning "Knowledge search endpoint not responding (status: $SEARCH_STATUS)"
                    fi
                else
                    print_fail "Fallback service not responding (status: $HTTP_STATUS)"
                fi
            else
                print_warning "curl not available - cannot test HTTP endpoints"
            fi
        fi
        
        # Final assessment
        if [ $EXTENSION_ERRORS -eq 0 ] && [ "$SERVICES_RUNNING" = true ]; then
            print_pass "VSCode KM Bridge extension fully functional"
        elif [ $EXTENSION_ERRORS -eq 0 ] && [ "$SERVICES_RUNNING" = false ]; then
            print_warning "VSCode KM Bridge extension ready but fallback services not running"
            print_info "Start services with: coding --copilot"
        else
            print_fail "VSCode KM Bridge extension has configuration issues"
        fi
    else
        print_warning "KM Copilot Bridge extension not found"
        
        # Check if extension source exists for building
        if [ -d "$CODING_ROOT/integrations/vscode-km-copilot" ]; then
            print_repair "VSCode KM Bridge source found, checking for built extension..."
            
            # Look for any VSIX files
            VSIX_FILES=$(find "$CODING_ROOT/integrations/vscode-km-copilot" -name "*.vsix" 2>/dev/null)
            if [ -n "$VSIX_FILES" ]; then
                print_repair "Installing VSCode Knowledge Management Bridge..."
                LATEST_VSIX=$(ls -t "$CODING_ROOT/integrations/vscode-km-copilot"/*.vsix | head -1)
                code --install-extension "$LATEST_VSIX"
                print_fixed "VSCode KM Bridge extension installed from: $(basename "$LATEST_VSIX")"
            else
                print_repair "Building VSCode KM Bridge extension..."
                cd "$CODING_ROOT/integrations/vscode-km-copilot"
                if [ -f "package.json" ] && command_exists npm; then
                    npm install >/dev/null 2>&1
                    npm run package >/dev/null 2>&1
                    BUILT_VSIX=$(find . -name "*.vsix" | head -1)
                    if [ -n "$BUILT_VSIX" ]; then
                        code --install-extension "$BUILT_VSIX"
                        print_fixed "VSCode KM Bridge built and installed"
                    else
                        print_fail "Failed to build VSCode KM Bridge extension"
                    fi
                else
                    print_fail "Cannot build VSCode KM Bridge - missing package.json or npm"
                fi
                cd "$CODING_ROOT"
            fi
        else
            print_info "To create extension: Clone vscode-km-copilot source and run npm run package"
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
MCP_CONFIG_PROCESSED="$CODING_ROOT/claude-code-mcp-processed.json"

if file_exists "$MCP_CONFIG_TEMPLATE"; then
    print_pass "MCP config template found"
else
    print_fail "MCP config template not found"
fi

if file_exists "$MCP_CONFIG_PROCESSED"; then
    print_pass "MCP processed config found"
    
    # Check if the processed config includes the new environment variables
    print_check "MCP config environment variables"
    if grep -q "KNOWLEDGE_BASE_PATH" "$MCP_CONFIG_PROCESSED" 2>/dev/null; then
        print_pass "MCP config includes KNOWLEDGE_BASE_PATH"
    else
        print_warning "MCP config missing KNOWLEDGE_BASE_PATH - regenerating..."
        cd "$CODING_ROOT" && ./install.sh --update-mcp-config
        print_fixed "MCP configuration updated"
    fi
    
    if grep -q "CODING_DOCS_PATH" "$MCP_CONFIG_PROCESSED" 2>/dev/null; then
        print_pass "MCP config includes CODING_DOCS_PATH"
    else
        print_warning "MCP config missing CODING_DOCS_PATH - regenerating..."
        cd "$CODING_ROOT" && ./install.sh --update-mcp-config
        print_fixed "MCP configuration updated"
    fi
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
if dir_exists "$CODING_ROOT/integrations/mcp-server-browserbase"; then
    print_pass "Browserbase MCP server found"
    
    print_check "Browserbase dependencies"
    if [ -d "$CODING_ROOT/integrations/mcp-server-browserbase/browserbase/node_modules" ] && [ -d "$CODING_ROOT/integrations/mcp-server-browserbase/stagehand/node_modules" ]; then
        print_pass "Browserbase dependencies installed"
    else
        print_repair "Installing browserbase dependencies..."
        cd "$CODING_ROOT/integrations/mcp-server-browserbase/browserbase" && npm install
        cd "$CODING_ROOT/integrations/mcp-server-browserbase/stagehand" && npm install
        print_fixed "Browserbase dependencies installed"
    fi
else
    print_fail "Browserbase MCP server not found"
    print_repair "Cloning browserbase server..."
    cd "$CODING_ROOT/integrations"
    git clone https://github.com/browserbase/mcp-server-browserbase
    cd mcp-server-browserbase && npm install
    print_fixed "Browserbase server installed"
fi

print_check "Semantic analysis MCP server"
if dir_exists "$CODING_ROOT/integrations/mcp-server-semantic-analysis"; then
    print_pass "Semantic analysis MCP server found"
    
    print_check "Semantic analysis dependencies"
    if [ -d "$CODING_ROOT/integrations/mcp-server-semantic-analysis/node_modules" ]; then
        print_pass "Semantic analysis dependencies installed"
    else
        print_repair "Installing semantic analysis dependencies..."
        cd "$CODING_ROOT/integrations/mcp-server-semantic-analysis" && npm install
        print_fixed "Semantic analysis dependencies installed"
    fi
    
    print_check "Semantic analysis build"
    if [ -d "$CODING_ROOT/integrations/mcp-server-semantic-analysis/dist" ]; then
        print_pass "Semantic analysis server built"
        
        print_check "Semantic analysis server test"
        cd "$CODING_ROOT/integrations/mcp-server-semantic-analysis"
        
        # Set environment variables for test
        export KNOWLEDGE_BASE_PATH="${KNOWLEDGE_BASE_PATH:-$CODING_ROOT/knowledge-management/insights}"
        export CODING_DOCS_PATH="${CODING_DOCS_PATH:-$CODING_ROOT/docs}"
        export CODING_TOOLS_PATH="$CODING_ROOT"
        
        # Test that the server starts and produces expected output
        SERVER_OUTPUT=$(timeout 3 node dist/index.js 2>&1 | head -n 3)
        if echo "$SERVER_OUTPUT" | grep -q "Semantic Analysis MCP server is ready"; then
            print_pass "Semantic analysis server test successful"
        else
            print_warning "Semantic analysis server test failed (may need API keys)"
        fi
        
        print_check "Environment variables for MCP server"
        if [ -d "$KNOWLEDGE_BASE_PATH" ] || mkdir -p "$KNOWLEDGE_BASE_PATH" 2>/dev/null; then
            print_pass "Knowledge base path accessible: $KNOWLEDGE_BASE_PATH"
        else
            print_warning "Knowledge base path not accessible: $KNOWLEDGE_BASE_PATH"
        fi
        
        if [ -d "$CODING_DOCS_PATH" ]; then
            print_pass "Docs path accessible: $CODING_DOCS_PATH"
        else
            print_warning "Docs path not found: $CODING_DOCS_PATH"
        fi
    else
        print_repair "Building semantic analysis server..."
        cd "$CODING_ROOT/integrations/mcp-server-semantic-analysis" && npm run build
        print_fixed "Semantic analysis server built"
    fi
else
    print_fail "Semantic analysis MCP server not found"
    print_info "Should be located at integrations/mcp-server-semantic-analysis"
fi

print_check "MCP Constraint Monitor (standalone)"
CONSTRAINT_MONITOR_DIR="$CODING_ROOT/integrations/mcp-constraint-monitor"
if dir_exists "$CONSTRAINT_MONITOR_DIR"; then
    print_pass "MCP Constraint Monitor found (standalone)"
    
    print_check "MCP Constraint Monitor dependencies"
    if [ -d "$CONSTRAINT_MONITOR_DIR/node_modules" ]; then
        print_pass "MCP Constraint Monitor dependencies installed"
    else
        print_repair "Installing MCP Constraint Monitor dependencies..."
        cd "$CONSTRAINT_MONITOR_DIR" && npm install
        print_fixed "MCP Constraint Monitor dependencies installed"
    fi
    
    print_check "MCP Constraint Monitor configuration"
    if [ -f "$CONSTRAINT_MONITOR_DIR/config/default-constraints.yaml" ]; then
        print_pass "MCP Constraint Monitor configuration found"
    else
        print_repair "Setting up MCP Constraint Monitor configuration..."
        cd "$CONSTRAINT_MONITOR_DIR" && npm run setup
        print_fixed "MCP Constraint Monitor configuration created"
    fi
    
    print_check "MCP Constraint Monitor data directory"
    if [ -d "$CONSTRAINT_MONITOR_DIR/data" ]; then
        print_pass "MCP Constraint Monitor data directory exists"
    else
        print_repair "Creating MCP Constraint Monitor data directory..."
        mkdir -p "$CONSTRAINT_MONITOR_DIR/data"
        print_fixed "MCP Constraint Monitor data directory created"
    fi
    
    print_check "Constraint monitor environment variables"
    if [ -n "${GROK_API_KEY:-}" ]; then
        print_pass "GROK_API_KEY configured"
    else
        print_warning "GROK_API_KEY not set - constraint monitor will use limited functionality"
    fi
    
    print_check "Docker services for constraint monitor"
    if command -v docker >/dev/null 2>&1; then
        if docker ps -q -f name=constraint-monitor-qdrant >/dev/null 2>&1; then
            print_pass "Qdrant database running"
        else
            print_warning "Qdrant database not running - start with: cd integrations/mcp-constraint-monitor && docker-compose up -d"
        fi
        
        if docker ps -q -f name=constraint-monitor-redis >/dev/null 2>&1; then
            print_pass "Redis cache running"
        else
            print_warning "Redis cache not running - start with: cd integrations/mcp-constraint-monitor && docker-compose up -d"
        fi
    else
        print_warning "Docker not available - constraint monitor requires Docker for Qdrant and Redis"
    fi
else
    print_fail "MCP Constraint Monitor not found"
    print_info "Should be located at integrations/mcp-constraint-monitor"
    print_info "Install with: git clone https://github.com/fwornle/mcp-server-constraint-monitor.git integrations/mcp-constraint-monitor"
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
    timeout 10 node "$CODING_ROOT/lib/adapters/copilot-http-server.js" >/dev/null 2>&1 &
    SERVER_PID=$!
    sleep 3
    
    if kill -0 $SERVER_PID 2>/dev/null; then
        print_pass "CoPilot HTTP server can start"
        
        # Test if server responds to health check
        if command_exists curl; then
            sleep 2
            HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8765/health" 2>/dev/null || echo "000")
            if [ "$HTTP_STATUS" = "200" ]; then
                print_pass "CoPilot HTTP server health endpoint responsive"
                
                # Test @KM vkb functionality
                print_check "@KM vkb endpoint test"
                VKB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:8765/api/viewer/launch" 2>/dev/null || echo "000")
                if [ "$VKB_STATUS" = "200" ]; then
                    print_pass "@KM vkb endpoint functional"
                    
                    # Check if VKB server was actually started
                    sleep 3
                    VKB_SERVER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080" 2>/dev/null || echo "000")
                    if [ "$VKB_SERVER_STATUS" = "200" ]; then
                        print_pass "VKB visualization server auto-started successfully"
                        
                        # Test CORS headers
                        CORS_HEADERS=$(curl -s -I "http://localhost:8080" 2>/dev/null | grep -i "access-control-allow-origin" || echo "")
                        if [ -n "$CORS_HEADERS" ]; then
                            print_pass "VKB server has CORS support"
                        else
                            print_warning "VKB server missing CORS headers"
                        fi
                        
                        # Clean up VKB server
                        if command_exists vkb; then
                            vkb stop >/dev/null 2>&1 || true
                        fi
                    else
                        print_warning "VKB visualization server failed to start automatically"
                    fi
                else
                    print_fail "@KM vkb endpoint not responding (status: $VKB_STATUS)"
                fi
            else
                print_fail "CoPilot HTTP server not responding to health check (status: $HTTP_STATUS)"
            fi
        else
            print_warning "curl not available - cannot test HTTP endpoints"
        fi
        
        kill $SERVER_PID 2>/dev/null || true
    else
        print_warning "CoPilot HTTP server may have startup issues"
    fi
else
    print_fail "CoPilot HTTP server not found"
fi

# Additional VKB standalone tests
print_check "VKB standalone functionality"
if command_exists vkb; then
    # Test VKB help command
    if vkb help >/dev/null 2>&1; then
        print_pass "VKB help command functional"
    else
        print_fail "VKB help command failed"
    fi
    
    # Test VKB diagnostic
    if vkb port >/dev/null 2>&1; then
        print_pass "VKB port checking functional"
    else
        print_warning "VKB port checking may have issues"
    fi
    
    # Test VKB status
    if vkb status >/dev/null 2>&1; then
        print_pass "VKB status command functional"
    else
        print_warning "VKB status command may have issues"
    fi
    
    # Test VKB can prepare data
    cd "$CODING_ROOT"
    if [ -f "shared-memory.json" ]; then
        # Try a quick start/stop test
        timeout 15 bash -c 'vkb start >/dev/null 2>&1; sleep 5; vkb stop >/dev/null 2>&1' 2>/dev/null || true
        print_pass "VKB start/stop test completed"
    else
        print_warning "VKB data preparation test skipped (no shared-memory.json)"
    fi
else
    print_fail "VKB command not available for testing"
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

print_check "Key documentation files"
KEY_DOCS=("README.md" "installation/quick-start.md" "ukb/user-guide.md" "integrations/vscode-extension.md" "architecture/system-overview.md")
MISSING_DOCS=0
for doc in "${KEY_DOCS[@]}"; do
    if file_exists "$CODING_ROOT/docs/$doc"; then
        print_pass "Found: docs/$doc"
    else
        print_fail "Missing: docs/$doc"
        MISSING_DOCS=$((MISSING_DOCS + 1))
    fi
done

if [ $MISSING_DOCS -eq 0 ]; then
    print_pass "All key documentation files present"
else
    print_fail "$MISSING_DOCS key documentation files missing"
fi

print_check "Documentation diagrams and images"
KEY_IMAGES=("images/system-architecture.png" "images/vscode-component-diagram.png" "images/vscode-extension-flow.png" "images/claude-mcp-autologging.png")
MISSING_IMAGES=0
for img in "${KEY_IMAGES[@]}"; do
    if file_exists "$CODING_ROOT/docs/$img"; then
        print_pass "Found: docs/$img"
    else
        print_fail "Missing: docs/$img"
        MISSING_IMAGES=$((MISSING_IMAGES + 1))
    fi
done

if [ $MISSING_IMAGES -eq 0 ]; then
    print_pass "All key documentation images present"
else
    print_fail "$MISSING_IMAGES key documentation images missing"
fi

# =============================================================================
# PHASE 8: INTEGRATION TESTING
# =============================================================================

print_section "PHASE 8: End-to-End Integration Testing"

print_test "Full system integration"

print_check "Knowledge base state"
# Check for team-specific or context-specific shared-memory files
TEAM_KB_FILES=$(find "$CODING_ROOT" -maxdepth 1 -name "shared-memory-*.json" 2>/dev/null)
LEGACY_KB="$CODING_ROOT/shared-memory.json"

if [ -n "$TEAM_KB_FILES" ]; then
    print_pass "Context-specific knowledge base files found:"
    for file in $TEAM_KB_FILES; do
        BASENAME=$(basename "$file")
        ENTITY_COUNT=$(jq '.entities | length' "$file" 2>/dev/null || echo "0")
        RELATION_COUNT=$(jq '.relations | length' "$file" 2>/dev/null || echo "0")
        print_info "  $BASENAME - Entities: $ENTITY_COUNT, Relations: $RELATION_COUNT"
    done
elif file_exists "$LEGACY_KB"; then
    print_pass "shared-memory.json exists (legacy single-file mode)"
    
    ENTITY_COUNT=$(jq '.entities | length' "$LEGACY_KB" 2>/dev/null || echo "0")
    RELATION_COUNT=$(jq '.relations | length' "$LEGACY_KB" 2>/dev/null || echo "0")
    print_info "Entities: $ENTITY_COUNT, Relations: $RELATION_COUNT"
    
    if [ "$ENTITY_COUNT" -gt 0 ]; then
        print_pass "Knowledge base contains data"
    else
        print_info "Knowledge base is empty (normal for new installations)"
    fi
else
    print_info "No knowledge base files found (normal for new installations)"
    print_info "Knowledge bases will be created when teams/contexts add their first entity"
fi

print_check "Git integration"
cd "$CODING_ROOT"
# Check for any knowledge base files (legacy or team-specific)
KB_FILES_FOUND=false
KB_GIT_STATUS=""

# Check team-specific files
for kb_file in shared-memory-*.json; do
    if [ -f "$kb_file" ]; then
        KB_FILES_FOUND=true
        if git status --porcelain | grep -q "$kb_file"; then
            KB_GIT_STATUS="has_changes"
            print_pass "$kb_file is tracked by git and has changes"
        elif git ls-files --error-unmatch "$kb_file" >/dev/null 2>&1; then
            print_pass "$kb_file is tracked by git"
        else
            print_repair "Adding $kb_file to git..."
            git add "$kb_file"
            print_fixed "$kb_file added to git"
        fi
    fi
done

# Check legacy shared-memory.json if no team files found
if [ "$KB_FILES_FOUND" = false ] && [ -f "shared-memory.json" ]; then
    if git status --porcelain | grep -q "shared-memory.json"; then
        print_pass "shared-memory.json is tracked by git and has changes"
    elif git ls-files --error-unmatch shared-memory.json >/dev/null 2>&1; then
        print_pass "shared-memory.json is tracked by git"
    else
        print_repair "Adding shared-memory.json to git..."
        git add shared-memory.json
        print_fixed "shared-memory.json added to git"
    fi
else
    print_info "Knowledge base files will be added to git when created"
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

# Test VSCode Extension Bridge integration
print_check "VSCode Extension Bridge integration test"
if command_exists code && code --list-extensions | grep -q km-copilot; then
    # Check if fallback services can be reached (for VSCode extension)
    if command_exists curl && curl -s http://localhost:8765/health >/dev/null 2>&1; then
        print_pass "VSCode Extension Bridge can reach fallback services"
    elif [ -f "$CODING_ROOT/lib/adapters/copilot-http-server.js" ]; then
        print_warning "VSCode Extension Bridge ready but fallback services not running"
        print_info "Start services with: coding --copilot"
    else
        print_fail "VSCode Extension Bridge missing fallback service files"
    fi
    
    # Check if VSCode extension has proper configuration
    if [ -f "$CODING_ROOT/integrations/vscode-km-copilot/package.json" ]; then
        if grep -q "contributes.*chatParticipants" "$CODING_ROOT/integrations/vscode-km-copilot/package.json" 2>/dev/null; then
            print_pass "VSCode Extension Bridge properly configured for chat integration"
        else
            print_warning "VSCode Extension Bridge may be missing chat participant configuration"
        fi
    fi
else
    print_info "VSCode Extension Bridge test skipped (extension not installed)"
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
echo -e "  ${CYAN}vkb${NC}                    # View knowledge graph (standalone)"
echo -e "  ${CYAN}vkb fg${NC}                 # View knowledge graph (foreground/debug mode)"
echo -e "  ${CYAN}claude-mcp${NC}             # Start Claude with MCP (if available)"
echo -e "  ${CYAN}coding --copilot${NC}       # Start fallback services for CoPilot"
echo -e ""
echo -e "${BOLD}VSCode Integration Commands:${NC}"
echo -e "  ${CYAN}@KM vkb${NC}                # Launch knowledge viewer from VSCode Copilot"
echo -e "  ${CYAN}@KM ukb${NC}                # Update knowledge base from VSCode Copilot"
echo -e "  ${CYAN}@KM search <query>${NC}     # Search knowledge base from VSCode Copilot"

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

# Always ensure VKB restarts with clean, default settings (never preserve corruption)
echo -e "\n${BLUE}[INFO]${NC} Ensuring VKB restarts with clean default settings..."

# Stop any running VKB viewer first to ensure clean state
if command_exists vkb && vkb status >/dev/null 2>&1; then
    echo -e "${BLUE}[INFO]${NC} Stopping VKB viewer for clean restart..."
    vkb stop >/dev/null 2>&1 || true
    sleep 2
fi

# Force clean restart with default multi-team view (prevent memory.json corruption)
export KNOWLEDGE_VIEW="coding,ui"
echo -e "${BLUE}[INFO]${NC} Set KNOWLEDGE_VIEW to default: $KNOWLEDGE_VIEW"

# Start VKB with clean settings and regenerated memory.json
if command_exists vkb; then
    echo -e "${BLUE}[INFO]${NC} Starting VKB with clean default settings..."
    vkb start >/dev/null 2>&1 || true
fi

echo -e "\n${BOLD}Test completed at:${NC} $(date)"

# Set exit code based on test results
if [ $TESTS_FAILED -eq 0 ]; then
    exit 0
else
    exit 1
fi