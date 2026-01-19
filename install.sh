#!/bin/bash
# Agent-Agnostic Coding Tools - Universal Installation Script
# Supports: Claude Code (with MCP) and GitHub CoPilot (with fallbacks)
# Platforms: macOS, Linux, Windows (via WSL/Git Bash)
# Version: 2.0.0

# Check if script is being sourced or executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Script is being executed directly
    SCRIPT_EXECUTED=true
    set -euo pipefail
else
    # Script is being sourced
    SCRIPT_EXECUTED=false
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Installation configuration
# Save original CODING_REPO before overwriting (for sandbox detection)
ORIGINAL_CODING_REPO="${CODING_REPO:-}"
CODING_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_LOG="$CODING_REPO/install.log"

# Repository URLs - will be set based on CN/VPN detection
MEMORY_VISUALIZER_REPO_SSH=""
MEMORY_VISUALIZER_REPO_HTTPS=""
MEMORY_VISUALIZER_DIR="$CODING_REPO/integrations/memory-visualizer"

BROWSERBASE_REPO_SSH=""
BROWSERBASE_REPO_HTTPS=""
BROWSERBASE_DIR="$CODING_REPO/integrations/mcp-server-browserbase"
SEMANTIC_ANALYSIS_DIR="$CODING_REPO/integrations/mcp-server-semantic-analysis"

# Installation status tracking
INSIDE_CN=false
PROXY_WORKING=false
INSTALLATION_WARNINGS=()
INSTALLATION_FAILURES=()
SANDBOX_MODE=false
SKIP_ALL_SYSTEM_CHANGES=false
SKIPPED_SYSTEM_DEPS=()

# Safety: Confirm before any system-level modification
# Usage: confirm_system_change "action description" "risk warning"
# Returns: 0 if approved, 1 if declined
confirm_system_change() {
    local action="$1"
    local risk="$2"

    # Skip if user already chose to skip all
    if [[ "$SKIP_ALL_SYSTEM_CHANGES" == "true" ]]; then
        return 1
    fi

    echo ""
    echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║               SYSTEM MODIFICATION REQUEST                            ║${NC}"
    echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}Action:${NC} $action"
    echo ""
    echo -e "${RED}Risk:${NC} $risk"
    echo ""
    echo -e "${BLUE}Options:${NC}"
    echo -e "  ${GREEN}y${NC} = Proceed with this action"
    echo -e "  ${YELLOW}n${NC} = Skip this action (installation continues)"
    echo -e "  ${PURPLE}skip-all${NC} = Skip ALL remaining system modifications"
    echo ""
    read -p "$(echo -e ${CYAN}Your choice [y/N/skip-all]: ${NC})" response

    case "$response" in
        [yY]|[yY][eE][sS])
            return 0
            ;;
        skip-all|SKIP-ALL|Skip-all)
            SKIP_ALL_SYSTEM_CHANGES=true
            info "Skipping all remaining system modifications"
            return 1
            ;;
        *)
            return 1
            ;;
    esac
}

# Repository URLs by network location
# Only memory-visualizer has a CN mirror, others always use public repos

# Memory Visualizer (HAS CN MIRROR)
MEMORY_VISUALIZER_CN_SSH="git@cc-github.bmwgroup.net:frankwoernle/memory-visualizer.git"
MEMORY_VISUALIZER_CN_HTTPS="https://cc-github.bmwgroup.net/frankwoernle/memory-visualizer.git"
MEMORY_VISUALIZER_PUBLIC_SSH="git@github.com:fwornle/memory-visualizer.git"
MEMORY_VISUALIZER_PUBLIC_HTTPS="https://github.com/fwornle/memory-visualizer.git"

# Browserbase (NO CN MIRROR - always use public)
BROWSERBASE_SSH="git@github.com:browserbase/mcp-server-browserbase.git"
BROWSERBASE_HTTPS="https://github.com/browserbase/mcp-server-browserbase.git"

# Semantic Analysis MCP Server (HAS CN MIRROR)
SEMANTIC_ANALYSIS_CN_SSH="git@cc-github.bmwgroup.net:frankwoernle/mcp-server-semantic-analysis.git"
SEMANTIC_ANALYSIS_CN_HTTPS="https://cc-github.bmwgroup.net/frankwoernle/mcp-server-semantic-analysis.git"
SEMANTIC_ANALYSIS_PUBLIC_SSH="git@github.com:fwornle/mcp-server-semantic-analysis.git"
SEMANTIC_ANALYSIS_PUBLIC_HTTPS="https://github.com/fwornle/mcp-server-semantic-analysis.git"

# Code Graph RAG (forked with semantic enhancements)
CODE_GRAPH_RAG_SSH="git@github.com:fwornle/code-graph-rag.git"
CODE_GRAPH_RAG_HTTPS="https://github.com/fwornle/code-graph-rag.git"
CODE_GRAPH_RAG_BRANCH="semantic-enhancements"
CODE_GRAPH_RAG_DIR="$CODING_REPO/integrations/code-graph-rag"

# Platform detection
PLATFORM=""
SHELL_RC=""
detect_platform() {
    case "$(uname -s)" in
        Darwin*)
            PLATFORM="macos"
            ;;
        Linux*)
            PLATFORM="linux"
            ;;
        MINGW*|CYGWIN*|MSYS*)
            PLATFORM="windows"
            ;;
        *)
            echo -e "${RED}Unsupported platform: $(uname -s)${NC}"
            exit 1
            ;;
    esac

    # Detect actual shell in use (prefer accuracy over platform defaults)
    if [[ -n "$SHELL" ]]; then
        case "$SHELL" in
            */zsh)
                SHELL_RC="$HOME/.zshrc"
                ;;
            */bash)
                # Check which bash config exists and is used
                if [[ -f "$HOME/.bash_profile" ]]; then
                    SHELL_RC="$HOME/.bash_profile"
                elif [[ -f "$HOME/.bashrc" ]]; then
                    SHELL_RC="$HOME/.bashrc"
                else
                    SHELL_RC="$HOME/.bash_profile"  # Create if needed
                fi
                ;;
            *)
                # Fallback to platform default
                if [[ "$PLATFORM" == "macos" ]]; then
                    SHELL_RC="$HOME/.zshrc"
                else
                    SHELL_RC="$HOME/.bashrc"
                fi
                ;;
        esac
    else
        # No $SHELL set, use platform default
        if [[ "$PLATFORM" == "macos" ]]; then
            SHELL_RC="$HOME/.zshrc"
        else
            SHELL_RC="$HOME/.bashrc"
        fi
    fi
}

# Detect if we should run in sandbox mode
detect_sandbox_mode() {
    # Check if ORIGINAL_CODING_REPO is already set and points to a valid coding installation
    if [[ -n "$ORIGINAL_CODING_REPO" ]] && [[ -d "$ORIGINAL_CODING_REPO" ]] && [[ -f "$ORIGINAL_CODING_REPO/bin/coding" ]]; then
        local current_install="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

        # If ORIGINAL_CODING_REPO points to a different installation, use sandbox mode
        if [[ "$ORIGINAL_CODING_REPO" != "$current_install" ]]; then
            SANDBOX_MODE=true

            echo ""
            echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════════════╗${NC}"
            echo -e "${YELLOW}║                                                                      ║${NC}"
            echo -e "${YELLOW}║                      ${RED}SANDBOX MODE DETECTED${YELLOW}                          ║${NC}"
            echo -e "${YELLOW}║                                                                      ║${NC}"
            echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════════════╝${NC}"
            echo ""
            echo -e "${CYAN}A coding installation is already configured at:${NC}"
            echo -e "  ${GREEN}$ORIGINAL_CODING_REPO${NC}"
            echo ""
            echo -e "${CYAN}You are attempting to install to:${NC}"
            echo -e "  ${BLUE}$current_install${NC}"
            echo ""
            echo -e "${YELLOW}Installing in SANDBOX MODE to prevent conflicts.${NC}"
            echo ""
            echo -e "${CYAN}Sandbox mode will:${NC}"
            echo -e "  ${GREEN}✓${NC} NOT modify global shell configs (.zshrc, .bash_profile)"
            echo -e "  ${GREEN}✓${NC} Create local .activate file for manual sourcing"
            echo -e "  ${GREEN}✓${NC} Allow testing install.sh without pollution"
            echo ""
            echo -e "${CYAN}To use this installation after install completes:${NC}"
            echo -e "  ${BLUE}source $current_install/.activate${NC}"
            echo ""

            read -p "$(echo -e ${YELLOW}Continue with sandbox installation? [y/N]: ${NC})" response
            case "$response" in
                [yY][eE][sS]|[yY])
                    info "Proceeding with sandbox installation..."
                    echo ""
                    ;;
                *)
                    info "Installation cancelled by user"
                    exit 0
                    ;;
            esac
        fi
    fi
}

# Logging functions
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$INSTALL_LOG"
}

error_exit() {
    echo -e "${RED}ERROR: $1${NC}" >&2
    log "ERROR: $1"
    exit 1
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
    log "SUCCESS: $1"
}

info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
    log "INFO: $1"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
    log "WARNING: $1"
}

# Detect network location and set repository URLs
detect_network_and_set_repos() {
    info "Detecting network location (CN vs Public)..."
    
    local inside_cn=false
    local cn_ssh_ok=false
    local public_ssh_ok=false
    
    # Test BMW GitHub accessibility to determine if inside CN
    info "Testing cc-github.bmwgroup.net accessibility..."
    local bmw_response=$(timeout 5s ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no -T git@cc-github.bmwgroup.net 2>&1 || true)
    if echo "$bmw_response" | grep -q -iE "(successfully authenticated|Welcome to GitLab|You've successfully authenticated)"; then
        success "Inside Corporate Network - SSH access to cc-github.bmwgroup.net works"
        inside_cn=true
        cn_ssh_ok=true
    else
        # Try HTTPS to CN to double-check
        if timeout 5s curl -s --connect-timeout 5 https://cc-github.bmwgroup.net >/dev/null 2>&1; then
            info "Inside Corporate Network - cc-github.bmwgroup.net accessible via HTTPS"
            inside_cn=true
        else
            info "Outside Corporate Network - cc-github.bmwgroup.net not accessible"
            inside_cn=false
        fi
    fi
    
    if [[ "$inside_cn" == true ]]; then
        info "🏢 Corporate Network detected - using selective CN mirrors"
        INSIDE_CN=true
        # Memory Visualizer: Use CN mirror (has modifications)
        MEMORY_VISUALIZER_REPO_SSH="$MEMORY_VISUALIZER_CN_SSH"
        MEMORY_VISUALIZER_REPO_HTTPS="$MEMORY_VISUALIZER_CN_HTTPS"
        # Semantic Analysis: Use CN mirror (has corporate modifications)
        SEMANTIC_ANALYSIS_REPO_SSH="$SEMANTIC_ANALYSIS_CN_SSH"
        SEMANTIC_ANALYSIS_REPO_HTTPS="$SEMANTIC_ANALYSIS_CN_HTTPS"
        # Browserbase: Use public repo (no CN mirror)
        BROWSERBASE_REPO_SSH="$BROWSERBASE_SSH"
        BROWSERBASE_REPO_HTTPS="$BROWSERBASE_HTTPS"
    else
        info "🌍 Public network detected - using public repositories"
        # Test public GitHub SSH
        info "Testing github.com SSH access..."
        local github_response=$(timeout 5s ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no -T git@github.com 2>&1 || true)
        if echo "$github_response" | grep -q -i "successfully authenticated"; then
            success "SSH access to github.com works"
            public_ssh_ok=true
        fi
        
        # All repositories: Use public repos
        MEMORY_VISUALIZER_REPO_SSH="$MEMORY_VISUALIZER_PUBLIC_SSH"
        MEMORY_VISUALIZER_REPO_HTTPS="$MEMORY_VISUALIZER_PUBLIC_HTTPS"
        SEMANTIC_ANALYSIS_REPO_SSH="$SEMANTIC_ANALYSIS_PUBLIC_SSH"
        SEMANTIC_ANALYSIS_REPO_HTTPS="$SEMANTIC_ANALYSIS_PUBLIC_HTTPS"
        BROWSERBASE_REPO_SSH="$BROWSERBASE_SSH"
        BROWSERBASE_REPO_HTTPS="$BROWSERBASE_HTTPS"
    fi
    
    # Log selected repositories
    info "Selected repositories:"
    info "  Memory Visualizer: $(echo "$MEMORY_VISUALIZER_REPO_SSH" | sed 's/git@//' | sed 's/.git$//')"
    info "  Semantic Analysis: $(echo "$SEMANTIC_ANALYSIS_REPO_SSH" | sed 's/git@//' | sed 's/.git$//')"
    info "  Browserbase: $(echo "$BROWSERBASE_REPO_SSH" | sed 's/git@//' | sed 's/.git$//')"
    
    return 0
}

# Test proxy connectivity for external repos
test_proxy_connectivity() {
    if [[ "$INSIDE_CN" == false ]]; then
        PROXY_WORKING=true  # Outside CN, assume direct access works
        return 0
    fi
    
    info "Testing proxy connectivity for external repositories..."
    if timeout 5s curl -s --connect-timeout 5 https://google.de >/dev/null 2>&1; then
        success "Proxy is working - external repositories accessible"
        PROXY_WORKING=true
    else
        warning "Proxy not working or external access blocked"
        PROXY_WORKING=false
    fi
}

# Check for required dependencies
check_dependencies() {
    echo -e "${CYAN}🔍 Checking dependencies...${NC}"
    
    local missing_deps=()
    
    # Core dependencies
    if ! command -v git >/dev/null 2>&1; then
        missing_deps+=("git")
    fi
    
    if ! command -v node >/dev/null 2>&1; then
        missing_deps+=("node")
    else
        # Node.js exists - verify it actually works (catches library issues like simdjson mismatch)
        local node_health_output
        if ! node_health_output=$(node -e "console.log('ok')" 2>&1); then
            echo ""
            echo -e "${RED}╔══════════════════════════════════════════════════════════════════════╗${NC}"
            echo -e "${RED}║                                                                      ║${NC}"
            echo -e "${RED}║              ⚠️  NODE.JS IS BROKEN ⚠️                                  ║${NC}"
            echo -e "${RED}║                                                                      ║${NC}"
            echo -e "${RED}╚══════════════════════════════════════════════════════════════════════╝${NC}"
            echo ""
            echo -e "${YELLOW}Node.js is installed but fails to execute. This is commonly caused by${NC}"
            echo -e "${YELLOW}Homebrew library version mismatches (e.g., libsimdjson, libuv).${NC}"
            echo ""
            echo -e "${CYAN}Error:${NC}"
            echo "$node_health_output" | head -5
            echo ""
            echo -e "${CYAN}Common causes and fixes:${NC}"
            echo -e "  ${GREEN}1.${NC} Library mismatch after Homebrew update - try: brew upgrade"
            echo -e "  ${GREEN}2.${NC} Use nvm for isolated Node management: nvm install --lts && nvm use --lts"
            echo -e "  ${GREEN}3.${NC} Check if libsimdjson needs linking: brew link simdjson"
            echo ""
            echo -e "${RED}IMPORTANT:${NC} This installer will NOT attempt to fix your Node installation."
            echo -e "           Please resolve this issue manually before proceeding."
            echo ""
            error_exit "Node.js is broken. Please fix it before running this installer."
        fi
    fi

    if ! command -v npm >/dev/null 2>&1; then
        missing_deps+=("npm")
    fi
    
    if ! command -v python3 >/dev/null 2>&1; then
        missing_deps+=("python3")
    fi
    
    if ! command -v jq >/dev/null 2>&1; then
        missing_deps+=("jq")
    fi
    
    if ! command -v plantuml >/dev/null 2>&1; then
        missing_deps+=("plantuml")
    fi
    
    # Install uv if missing (required for Serena MCP server)
    if ! command -v uv >/dev/null 2>&1; then
        if confirm_system_change \
            "Install uv (Python package installer) via curl | sh" \
            "This downloads and executes an installer script from astral.sh. Required for Serena MCP."; then
            info "Installing uv (Python package installer, required for Serena MCP)..."
            if curl -LsSf https://astral.sh/uv/install.sh | sh; then
                # Source shell config to update PATH
                export PATH="$HOME/.local/bin:$PATH"
                if command -v uv >/dev/null 2>&1; then
                    success "uv installed successfully"
                else
                    warning "uv installed but not in PATH. You may need to restart your shell."
                    info "Add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\""
                fi
            else
                warning "Failed to install uv. Serena MCP server may not be available."
                SKIPPED_SYSTEM_DEPS+=("uv")
            fi
        else
            warning "Skipped uv installation. Serena MCP server may not be available."
            SKIPPED_SYSTEM_DEPS+=("uv")
            info "To install manually: curl -LsSf https://astral.sh/uv/install.sh | sh"
        fi
    else
        success "uv is already installed"
    fi
    
    # Platform-specific checks
    if [[ "$PLATFORM" == "macos" ]]; then
        if ! command -v brew >/dev/null 2>&1; then
            warning "Homebrew not found. Some installations may require manual setup."
        else
            # Check for GNU coreutils (provides timeout command needed by test scripts)
            if ! command -v timeout >/dev/null 2>&1; then
                if confirm_system_change \
                    "Install GNU coreutils via Homebrew (brew install coreutils)" \
                    "Provides the 'timeout' command needed for test scripts. Safe to install."; then
                    info "Installing GNU coreutils (for timeout command)..."
                    if brew install coreutils; then
                        # Add gnubin to PATH for this session
                        export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
                        success "GNU coreutils installed successfully"
                        info "Adding gnubin to PATH in shell config..."
                        # Add to shell config if not already there
                        if ! grep -q "coreutils/libexec/gnubin" "$SHELL_RC" 2>/dev/null; then
                            echo '' >> "$SHELL_RC"
                            echo '# GNU coreutils (provides timeout, etc.)' >> "$SHELL_RC"
                            echo 'export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"' >> "$SHELL_RC"
                        fi
                    else
                        warning "Failed to install GNU coreutils. Some test scripts may not work."
                        SKIPPED_SYSTEM_DEPS+=("coreutils")
                    fi
                else
                    warning "Skipped coreutils installation. timeout command may not be available."
                    SKIPPED_SYSTEM_DEPS+=("coreutils")
                    info "To install manually: brew install coreutils"
                fi
            else
                success "GNU coreutils (timeout) is already available"
            fi
        fi
    fi
    
# Clone repository with SSH first, fallback to HTTPS
clone_repository() {
    local ssh_url="$1"
    local https_url="$2"
    local target_dir="$3"
    local repo_name=$(basename "$target_dir")
    
    # Determine if this is a BMW repository
    local is_bmw_repo=false
    if [[ "$ssh_url" == *"bmwgroup.net"* ]]; then
        is_bmw_repo=true
    fi
    
    info "Attempting to clone $repo_name..."
    
    # Try SSH first
    if git clone "$ssh_url" "$target_dir" 2>/dev/null; then
        success "Successfully cloned $repo_name using SSH"
        return 0
    else
        if [[ "$is_bmw_repo" == true ]]; then
            warning "SSH clone failed (may be outside VPN), trying HTTPS..."
        else
            warning "SSH clone failed (may be inside VPN), trying HTTPS..."
        fi
        
        if git clone "$https_url" "$target_dir" 2>/dev/null; then
            success "Successfully cloned $repo_name using HTTPS"
            return 0
        else
            # For external repos, if HTTPS fails inside VPN, provide helpful message
            if [[ "$is_bmw_repo" == false ]]; then
                error_exit "Failed to clone $repo_name. If you're inside the corporate VPN, external GitHub access may be blocked."
            else
                error_exit "Failed to clone $repo_name. Please check your network connection and credentials."
            fi
            return 1
        fi
    fi
}

# Handle non-mirrored repository inside CN (with proxy detection)
handle_non_mirrored_repo_cn() {
    local repo_name="$1"
    local ssh_url="$2"
    local https_url="$3"
    local target_dir="$4"
    
    if [[ -d "$target_dir" ]]; then
        info "$repo_name already exists, attempting update..."
        cd "$target_dir"
        
        if [[ "$PROXY_WORKING" == true ]]; then
            info "Proxy working - attempting update from external repo"
            if timeout 5s git pull origin main 2>/dev/null; then
                success "$repo_name updated successfully"
                return 0
            else
                warning "Could not update $repo_name (network/proxy issue)"
                INSTALLATION_WARNINGS+=("$repo_name: Could not update from external repo")
                return 0  # Continue - we have existing code
            fi
        else
            warning "Proxy not working - skipping update of $repo_name"
            INSTALLATION_WARNINGS+=("$repo_name: Skipped update due to proxy/network issues")
            return 0  # Continue - we have existing code
        fi
    else
        # Repository doesn't exist - try to clone
        if [[ "$PROXY_WORKING" == true ]]; then
            info "Proxy working - attempting to clone $repo_name"
            if clone_repository "$ssh_url" "$https_url" "$target_dir" 2>/dev/null; then
                success "$repo_name cloned successfully"
                return 0
            else
                warning "Failed to clone $repo_name despite working proxy"
                INSTALLATION_FAILURES+=("$repo_name: Failed to clone external repository")
                return 1
            fi
        else
            warning "Cannot clone $repo_name - proxy not working and no existing copy"
            INSTALLATION_FAILURES+=("$repo_name: Cannot clone - no proxy access and repository missing")
            return 1
        fi
    fi
}

    if [[ ${#missing_deps[@]} -ne 0 ]]; then
        echo -e "${RED}Missing required dependencies: ${missing_deps[*]}${NC}"
        echo -e "${YELLOW}Please install the missing dependencies and run the installer again.${NC}"
        
        # Provide installation hints
        echo -e "\n${CYAN}Installation hints:${NC}"
        case "$PLATFORM" in
            macos)
                echo "  - Install Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
                echo "  - Then run: brew install git node python3 jq plantuml"
                ;;
            linux)
                echo "  - Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y git nodejs npm python3 python3-pip jq plantuml"
                echo "  - RHEL/CentOS: sudo yum install -y git nodejs npm python3 python3-pip jq plantuml"
                echo "  - Arch: sudo pacman -S git nodejs npm python python-pip jq plantuml"
                ;;
            windows)
                echo "  - Install Git Bash: https://git-scm.com/downloads"
                echo "  - Install Node.js: https://nodejs.org/"
                echo "  - Install Python: https://www.python.org/downloads/"
                echo "  - Install jq: https://stedolan.github.io/jq/download/"
                ;;
        esac
        exit 1
    fi
    
    success "All required dependencies are installed"
}

# Install memory-visualizer (git submodule)
install_memory_visualizer() {
    echo -e "\n${CYAN}📊 Installing memory-visualizer (git submodule)...${NC}"

    cd "$CODING_REPO"

    # Check for both .git directory and .git file (for submodules)
    if [[ -d "$MEMORY_VISUALIZER_DIR/.git" ]] || [[ -f "$MEMORY_VISUALIZER_DIR/.git" ]]; then
        info "Memory visualizer submodule already exists, updating..."
        cd "$MEMORY_VISUALIZER_DIR"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "Memory visualizer updated"
        else
            info "Could not update memory-visualizer (may be on specific commit)"
        fi
    else
        info "Initializing memory-visualizer submodule..."
        git submodule update --init --recursive integrations/memory-visualizer || error_exit "Failed to initialize memory-visualizer submodule"
    fi

    cd "$MEMORY_VISUALIZER_DIR"

    # Install dependencies
    info "Installing memory-visualizer dependencies..."
    npm install || error_exit "Failed to install memory-visualizer dependencies"

    # Build the visualizer
    info "Building memory-visualizer..."
    npm run build || error_exit "Failed to build memory-visualizer"

    # Update browserslist database to suppress warnings
    info "Updating browserslist database..."
    npx update-browserslist-db@latest 2>/dev/null || warning "Could not update browserslist database"

    # Update vkb script to use local memory-visualizer
    if [[ "$PLATFORM" == "macos" ]]; then
        sed -i '' "s|VISUALIZER_DIR=.*|VISUALIZER_DIR=\"$MEMORY_VISUALIZER_DIR\"|" "$CODING_REPO/knowledge-management/vkb"
    else
        sed -i "s|VISUALIZER_DIR=.*|VISUALIZER_DIR=\"$MEMORY_VISUALIZER_DIR\"|" "$CODING_REPO/knowledge-management/vkb"
    fi

    success "Memory visualizer installed successfully"
}

# Install mcp-server-browserbase (regular git clone)
install_browserbase() {
    echo -e "\n${CYAN}🌐 Installing mcp-server-browserbase (public repo)...${NC}"

    cd "$CODING_REPO"

    if [[ -d "$BROWSERBASE_DIR/.git" ]]; then
        info "mcp-server-browserbase already exists, updating..."
        cd "$BROWSERBASE_DIR"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "mcp-server-browserbase updated"
        else
            warning "Could not update mcp-server-browserbase, using existing version"
        fi
    else
        info "Cloning mcp-server-browserbase from GitHub..."
        if git clone "$BROWSERBASE_HTTPS" "$BROWSERBASE_DIR" 2>/dev/null; then
            success "mcp-server-browserbase cloned successfully"
        else
            # Try SSH if HTTPS fails
            warning "HTTPS clone failed, trying SSH..."
            git clone "$BROWSERBASE_SSH" "$BROWSERBASE_DIR" || error_exit "Failed to clone browserbase repository"
        fi
    fi

    cd "$BROWSERBASE_DIR"

    # Install dependencies (skip postinstall scripts to avoid mcpvals build issues)
    # Use --legacy-peer-deps to handle stagehand/zod peer dependency conflicts
    info "Installing browserbase dependencies (includes stagehand)..."
    npm install --ignore-scripts --legacy-peer-deps || error_exit "Failed to install browserbase dependencies"

    # Fix TypeScript compatibility with newer MCP SDK (@modelcontextprotocol/sdk v1.22+)
    # The McpServer constructor API changed from single object to two parameters
    info "Fixing TypeScript compatibility..."
    if grep -q "description:" src/index.ts 2>/dev/null; then
        cat > /tmp/fix-mcp-server.js << 'EOF'
const fs = require('fs');
const content = fs.readFileSync('src/index.ts', 'utf8');
// Replace old single-param constructor with new two-param form
const fixed = content.replace(
  /const server = new McpServer\(\{\s*name: "([^"]+)",\s*version: "([^"]+)",\s*description:\s*"[^"]*",\s*capabilities: \{/s,
  'const server = new McpServer(\n    {\n      name: "$1",\n      version: "$2",\n    },\n    {\n      capabilities: {'
);
fs.writeFileSync('src/index.ts', fixed, 'utf8');
EOF
        node /tmp/fix-mcp-server.js || warning "Could not auto-fix TypeScript compatibility"
        rm -f /tmp/fix-mcp-server.js
    fi

    info "Building browserbase..."
    npm run build || error_exit "Failed to build browserbase"

    success "Browserbase with Stagehand installed successfully"

    cd "$CODING_REPO"
}

# Install semantic analysis MCP server (git submodule)
install_semantic_analysis() {
    echo -e "\n${CYAN}🧠 Installing semantic analysis MCP server (git submodule)...${NC}"

    cd "$CODING_REPO"

    # Check for both .git directory and .git file (for submodules)
    if [[ -d "$SEMANTIC_ANALYSIS_DIR/.git" ]] || [[ -f "$SEMANTIC_ANALYSIS_DIR/.git" ]]; then
        info "mcp-server-semantic-analysis submodule already exists, updating..."
        cd "$SEMANTIC_ANALYSIS_DIR"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "mcp-server-semantic-analysis updated"
        else
            info "Could not update mcp-server-semantic-analysis (may be on specific commit)"
        fi
    else
        info "Initializing mcp-server-semantic-analysis submodule..."
        git submodule update --init --recursive integrations/mcp-server-semantic-analysis || error_exit "Failed to initialize semantic-analysis submodule"
    fi

    # Only proceed with build if we have the repository
    if [[ -d "$SEMANTIC_ANALYSIS_DIR" && -f "$SEMANTIC_ANALYSIS_DIR/package.json" ]]; then
        info "Installing semantic analysis dependencies..."
        cd "$SEMANTIC_ANALYSIS_DIR"

        # Check for Node.js
        if ! command -v node &> /dev/null; then
            warning "Node.js not found. Please install Node.js 18+ to use semantic analysis."
            return 1
        fi

        # Install dependencies and build
        npm install || warning "Failed to install semantic analysis dependencies"
        npm run build || warning "Failed to build semantic analysis server"

        # Make built server executable
        if [[ -f "dist/index.js" ]]; then
            chmod +x dist/index.js
        fi

        success "Semantic analysis MCP server installed successfully"
    else
        warning "Semantic analysis repository not available - skipping build"
    fi

    cd "$CODING_REPO"
}

# Install Serena MCP server for AST-based code analysis (git submodule)
install_serena() {
    echo -e "\n${CYAN}🔍 Installing Serena MCP server (git submodule)...${NC}"

    local serena_dir="$CODING_REPO/integrations/serena"

    cd "$CODING_REPO"

    # Check if uv is available
    if ! command -v uv >/dev/null 2>&1; then
        warning "uv not found. Serena requires uv for installation."
        info "Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh"
        INSTALLATION_WARNINGS+=("Serena: uv package manager required but not found")
        return 1
    fi

    # Install or update Serena submodule (check for both .git directory and .git file)
    if [[ -d "$serena_dir/.git" ]] || [[ -f "$serena_dir/.git" ]]; then
        info "Serena submodule already exists, updating..."
        cd "$serena_dir"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "Serena updated from repository"
        else
            info "Could not update Serena (may be on specific commit)"
        fi
    else
        info "Initializing Serena submodule..."
        git submodule update --init --recursive integrations/serena || error_exit "Failed to initialize Serena submodule"
    fi

    cd "$serena_dir"

    # Verify pyproject.toml exists before running uv sync
    if [[ ! -f "pyproject.toml" ]]; then
        warning "pyproject.toml not found in $serena_dir"
        INSTALLATION_WARNINGS+=("Serena: pyproject.toml missing")
        cd "$CODING_REPO"
        return 1
    fi

    # Install/Update dependencies
    info "Installing Serena dependencies..."
    if uv sync; then
        success "Serena dependencies installed"
    else
        warning "Failed to install Serena dependencies"
        INSTALLATION_WARNINGS+=("Serena: Failed to install dependencies")
    fi

    cd "$CODING_REPO"

    # Verify installation
    if [[ -f "$serena_dir/pyproject.toml" ]]; then
        success "Serena MCP server installed successfully"
        info "Serena provides AST-based code indexing and semantic retrieval"
    else
        warning "Serena installation verification failed"
        INSTALLATION_WARNINGS+=("Serena: Installation verification failed")
    fi
    
    cd "$CODING_REPO"
}

# Install MCP Constraint Monitor with Professional Dashboard (git submodule)
install_constraint_monitor() {
    echo -e "\n${CYAN}🚦 Installing MCP Constraint Monitor with Professional Dashboard (git submodule)...${NC}"

    cd "$CODING_REPO"

    local constraint_monitor_dir="$CODING_REPO/integrations/mcp-constraint-monitor"

    # Initialize or update submodule (check for both .git directory and .git file)
    if [[ -d "$constraint_monitor_dir/.git" ]] || [[ -f "$constraint_monitor_dir/.git" ]]; then
        info "mcp-constraint-monitor submodule already exists, updating..."
        cd "$constraint_monitor_dir"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "mcp-constraint-monitor updated"
        else
            info "Could not update mcp-constraint-monitor (may be on specific commit)"
        fi
    else
        info "Initializing mcp-constraint-monitor submodule..."
        git submodule update --init --recursive integrations/mcp-constraint-monitor || {
            warning "Failed to initialize mcp-constraint-monitor submodule"
            info "You can manually clone: git clone https://github.com/fwornle/mcp-constraint-monitor.git integrations/mcp-constraint-monitor"
            INSTALLATION_WARNINGS+=("mcp-constraint-monitor: Failed to initialize submodule")
            return 1
        }
    fi

    # Install constraint monitor dependencies
    if [[ -d "$constraint_monitor_dir" && -f "$constraint_monitor_dir/package.json" ]]; then
        cd "$constraint_monitor_dir"

        # Run the constraint monitor's own install script (skip hooks - we handle those in main install)
        if [[ -f "install.sh" ]]; then
            info "Running constraint monitor installation (dependencies only)..."
            bash install.sh --skip-hooks || warning "Constraint monitor installation had issues"
        else
            # Fallback to manual installation if install.sh doesn't exist
            info "Installing constraint monitor dependencies..."
            npm install || warning "Failed to install constraint monitor dependencies"
        fi

        # Install professional dashboard dependencies
        if [[ -d "dashboard" ]]; then
            info "Installing professional dashboard dependencies..."
            cd dashboard

            # Prefer pnpm if available (Next.js works better with pnpm)
            if command -v pnpm >/dev/null 2>&1; then
                pnpm install || npm install || warning "Failed to install dashboard dependencies"
            else
                npm install || warning "Failed to install dashboard dependencies"
            fi

            cd ..
            success "Professional Dashboard dependencies installed"
            info "Dashboard runs on port 3030 with shadcn/ui components"
        else
            warning "Dashboard directory not found in constraint monitor"
        fi

        success "MCP Constraint Monitor with Professional Dashboard installed"
        info "Global monitoring supports multi-project constraint tracking"
        info "Hooks will be configured in the main installation process"
    else
        warning "Constraint monitor package.json not found"
        INSTALLATION_WARNINGS+=("mcp-constraint-monitor: Missing package.json")
    fi

    cd "$CODING_REPO"
}

# Install System Health Dashboard
install_system_health_dashboard() {
    echo -e "\n${CYAN}🏥 Installing System Health Dashboard...${NC}"

    if [[ ! -d "$CODING_REPO/integrations/system-health-dashboard" ]]; then
        warning "System Health Dashboard directory not found"
        return 1
    fi

    cd "$CODING_REPO/integrations/system-health-dashboard"

    if [[ ! -f "package.json" ]]; then
        warning "System Health Dashboard package.json not found"
        cd "$CODING_REPO"
        return 1
    fi

    info "Installing System Health Dashboard dependencies..."
    npm install || warning "Failed to install System Health Dashboard dependencies"

    success "System Health Dashboard dependencies installed"
    info "Dashboard will run on port 3032 (frontend) and 3033 (API)"
    info "Access at: http://localhost:3032"

    cd "$CODING_REPO"
}

# Install shadcn/ui MCP server for professional dashboard components
install_shadcn_mcp() {
    echo -e "\n${CYAN}🎨 Installing shadcn/ui MCP server for professional dashboard components...${NC}"
    
    # Check if pnpm is available (preferred for shadcn)
    local package_manager="npm"
    if command -v pnpm >/dev/null 2>&1; then
        package_manager="pnpm"
        info "Using pnpm for shadcn installation"
    else
        info "Using npm for shadcn installation (consider installing pnpm for better performance)"
    fi
    
    # Create shadcn MCP directory if it doesn't exist
    local shadcn_dir="$CODING_REPO/integrations/shadcn-mcp"
    
    if [[ ! -d "$shadcn_dir" ]]; then
        info "Creating shadcn MCP integration directory..."
        mkdir -p "$shadcn_dir"
        cd "$shadcn_dir"
        
        # Initialize shadcn MCP server
        info "Initializing shadcn MCP server..."
        if command -v pnpm >/dev/null 2>&1; then
            pnpm dlx shadcn@latest mcp init --client claude || {
                warning "pnpm shadcn init failed, trying npm"
                npx shadcn@latest mcp init --client claude || {
                    warning "Failed to initialize shadcn MCP server"
                    INSTALLATION_WARNINGS+=("shadcn MCP: Failed to initialize server")
                    return 1
                }
            }
        else
            npx shadcn@latest mcp init --client claude || {
                warning "Failed to initialize shadcn MCP server"
                INSTALLATION_WARNINGS+=("shadcn MCP: Failed to initialize server")
                return 1
            }
        fi

        success "shadcn/ui MCP server initialized"

        # Install dependencies after initialization
        info "Installing shadcn MCP dependencies..."
        if [[ "$package_manager" == "pnpm" ]]; then
            pnpm install || {
                warning "pnpm install failed, trying npm"
                npm install || warning "Failed to install shadcn dependencies"
            }
        else
            npm install || warning "Failed to install shadcn dependencies"
        fi
    else
        info "shadcn MCP directory already exists, updating..."
        cd "$shadcn_dir"
        
        # Update dependencies if package.json exists
        if [[ -f "package.json" ]]; then
            info "Updating shadcn MCP dependencies..."
            if [[ "$package_manager" == "pnpm" ]]; then
                pnpm update || warning "Failed to update shadcn dependencies"
            else
                npm update || warning "Failed to update shadcn dependencies"
            fi
        fi
    fi
    
    # Install additional shadcn components commonly used in dashboards
    if [[ -f "package.json" ]]; then
        info "Installing commonly used shadcn components..."
        local components=("button" "card" "table" "badge" "select" "accordion" "progress" "alert" "separator")
        
        for component in "${components[@]}"; do
            info "Adding $component component..."
            if command -v pnpm >/dev/null 2>&1; then
                pnpm dlx shadcn@latest add "$component" --yes 2>/dev/null || true
            else
                npx shadcn@latest add "$component" --yes 2>/dev/null || true
            fi
        done
        
        success "shadcn/ui components installed"
    fi
    
    # Build if build script exists
    if [[ -f "package.json" ]] && jq -e '.scripts.build' package.json >/dev/null 2>&1; then
        info "Building shadcn MCP server..."
        if [[ "$package_manager" == "pnpm" ]]; then
            pnpm run build || warning "Failed to build shadcn MCP server"
        else
            npm run build || warning "Failed to build shadcn MCP server"
        fi
    fi
    
    success "shadcn/ui MCP server installed successfully"
    info "Provides professional UI components for dashboard development"
    
    cd "$CODING_REPO"
}

# Install MCP servers
install_mcp_servers() {
    echo -e "\n${CYAN}🔌 Installing MCP servers...${NC}"
    
    # Install browser-access (Stagehand with SSE architecture)
    if [[ -d "$CODING_REPO/integrations/browser-access" ]]; then
        info "Installing browser-access MCP server (SSE architecture)..."
        cd "$CODING_REPO/integrations/browser-access"
        npm install || error_exit "Failed to install browser-access dependencies"
        npm run build || error_exit "Failed to build browser-access"
        chmod +x dist/index.js dist/sse-server.js dist/stdio-proxy.js browser-access-server 2>/dev/null || true

        # Ensure logs directory exists for SSE server
        mkdir -p "$CODING_REPO/integrations/browser-access/logs"

        success "Browser-access MCP server installed (SSE + proxy architecture)"
        info "  - SSE server: dist/sse-server.js (shared, port 3847)"
        info "  - Stdio proxy: dist/stdio-proxy.js (per-session)"
        info "  - Management: ./browser-access-server {start|stop|status}"
    else
        warning "browser-access directory not found, skipping..."
    fi
}

# Install code-graph-rag MCP server (AST-based code knowledge graph)
install_code_graph_rag() {
    echo -e "\n${CYAN}🔗 Installing code-graph-rag MCP server...${NC}"

    cd "$CODING_REPO"

    # Check for uv package manager
    if ! command -v uv >/dev/null 2>&1; then
        warning "uv not found - code-graph-rag requires uv package manager"
        info "Install with: curl -LsSf https://astral.sh/uv/install.sh | sh"
        INSTALLATION_WARNINGS+=("code-graph-rag: uv not installed")
        return 1
    fi

    # Clone or update repository (check for both .git directory and .git file for submodules)
    if [[ -d "$CODE_GRAPH_RAG_DIR/.git" ]] || [[ -f "$CODE_GRAPH_RAG_DIR/.git" ]]; then
        info "code-graph-rag exists (submodule), updating..."
        cd "$CODE_GRAPH_RAG_DIR"
        timeout 30s git pull origin "$CODE_GRAPH_RAG_BRANCH" 2>/dev/null || info "Could not update code-graph-rag (may be on specific commit)"
    else
        info "Cloning code-graph-rag (branch: $CODE_GRAPH_RAG_BRANCH)..."
        if git clone -b "$CODE_GRAPH_RAG_BRANCH" "$CODE_GRAPH_RAG_HTTPS" "$CODE_GRAPH_RAG_DIR" 2>/dev/null; then
            success "Cloned code-graph-rag"
        elif git clone -b "$CODE_GRAPH_RAG_BRANCH" "$CODE_GRAPH_RAG_SSH" "$CODE_GRAPH_RAG_DIR" 2>/dev/null; then
            success "Cloned code-graph-rag via SSH"
        else
            warning "Failed to clone code-graph-rag"
            INSTALLATION_WARNINGS+=("code-graph-rag: Failed to clone")
            return 1
        fi
    fi

    cd "$CODE_GRAPH_RAG_DIR"

    # Install dependencies with uv
    info "Installing dependencies with uv..."
    if uv sync --extra treesitter-full 2>/dev/null; then
        success "code-graph-rag dependencies installed"
    else
        warning "Failed to install code-graph-rag dependencies"
        INSTALLATION_WARNINGS+=("code-graph-rag: uv sync failed")
        cd "$CODING_REPO"
        return 1
    fi

    # Create .env if not exists
    if [[ ! -f "$CODE_GRAPH_RAG_DIR/.env" ]]; then
        # Source main .env to get API keys
        if [[ -f "$CODING_REPO/.env" ]]; then
            source "$CODING_REPO/.env"
        fi

        # Use Groq as default (OpenAI quota issues are common)
        # Fall back to OpenAI if no Groq key available
        if [[ -n "$GROQ_API_KEY" ]]; then
            cat > "$CODE_GRAPH_RAG_DIR/.env" << ENVEOF
# code-graph-rag configuration
MEMGRAPH_HOST=localhost
MEMGRAPH_PORT=7687
MEMGRAPH_BATCH_SIZE=1000

# Using Groq via OpenAI-compatible API (faster, no quota issues)
CYPHER_PROVIDER=openai
CYPHER_MODEL=llama-3.3-70b-versatile
CYPHER_ENDPOINT=https://api.groq.com/openai/v1
CYPHER_API_KEY=$GROQ_API_KEY
ENVEOF
            info "Created .env with Groq configuration"
        else
            cat > "$CODE_GRAPH_RAG_DIR/.env" << 'ENVEOF'
# code-graph-rag configuration
MEMGRAPH_HOST=localhost
MEMGRAPH_PORT=7687
MEMGRAPH_BATCH_SIZE=1000

# Using OpenAI (set CYPHER_API_KEY or OPENAI_API_KEY)
CYPHER_PROVIDER=openai
CYPHER_MODEL=gpt-4o-mini
ENVEOF
            info "Created .env with OpenAI configuration (set GROQ_API_KEY in main .env for better performance)"
        fi
    else
        # Update existing .env if GROQ_API_KEY is available but not configured
        if [[ -f "$CODING_REPO/.env" ]]; then
            source "$CODING_REPO/.env"
        fi
        if [[ -n "$GROQ_API_KEY" ]] && ! grep -q "CYPHER_API_KEY" "$CODE_GRAPH_RAG_DIR/.env"; then
            info "Adding Groq API key to existing code-graph-rag .env..."
            echo "" >> "$CODE_GRAPH_RAG_DIR/.env"
            echo "# Groq API key added by installer" >> "$CODE_GRAPH_RAG_DIR/.env"
            echo "CYPHER_ENDPOINT=https://api.groq.com/openai/v1" >> "$CODE_GRAPH_RAG_DIR/.env"
            echo "CYPHER_API_KEY=$GROQ_API_KEY" >> "$CODE_GRAPH_RAG_DIR/.env"
        fi
    fi

    # Create docker-compose.yaml for Memgraph if not exists
    if [[ ! -f "$CODE_GRAPH_RAG_DIR/docker-compose.yaml" ]]; then
        cat > "$CODE_GRAPH_RAG_DIR/docker-compose.yaml" << 'DCEOF'
# Memgraph database for code-graph-rag
version: '3.8'
services:
  memgraph:
    image: memgraph/memgraph-platform
    container_name: code-graph-memgraph
    ports:
      - "7687:7687"   # Bolt protocol
      - "7444:7444"   # HTTPS
      - "3100:3000"   # Memgraph Lab (UI)
    volumes:
      - memgraph_data:/var/lib/memgraph
    restart: unless-stopped
    environment:
      - MEMGRAPH_TELEMETRY_ENABLED=false

volumes:
  memgraph_data:
DCEOF
        info "Created docker-compose.yaml for Memgraph"
    fi

    # Download pre-built cache from GitHub Release (if available)
    download_cgr_cache() {
        local cache_url="https://github.com/fwornle/code-graph-rag/releases/download/v1.0.0-cache-coding/cgr-cache-coding.tar.gz"
        local cache_dir="$CODE_GRAPH_RAG_DIR/shared-data"

        info "Checking for pre-built code-graph-rag cache..."

        # Skip if cache already exists with metadata
        if [[ -f "$cache_dir/cache-metadata.json" ]]; then
            info "Cache already exists, skipping download"
            return 0
        fi

        # Try to download cache
        if curl -fsSL --head "$cache_url" >/dev/null 2>&1; then
            info "Downloading pre-built cache (saves ~20 min indexing)..."
            local tmp_file="/tmp/cgr-cache-$$.tar.gz"
            if curl -fsSL "$cache_url" -o "$tmp_file" 2>/dev/null; then
                mkdir -p "$cache_dir"
                tar -xzf "$tmp_file" -C "$CODE_GRAPH_RAG_DIR" 2>/dev/null && \
                    success "Pre-built cache downloaded and extracted" || \
                    warning "Failed to extract cache - will need to index on first run"
                rm -f "$tmp_file"
            else
                warning "Cache download failed - will need to index on first run"
            fi
        else
            info "No pre-built cache available yet - will need to index on first run"
            info "  Run: cd integrations/code-graph-rag && uv run graph-code load-index /path/to/repo"
        fi
    }

    download_cgr_cache

    success "code-graph-rag installed"
    info "  - Start Memgraph: cd integrations/code-graph-rag && docker-compose up -d"
    info "  - Memgraph Lab: http://localhost:3100"
    info "  - MCP server: uv run graph-code mcp-server"

    cd "$CODING_REPO"
}

# Create universal command wrappers
create_command_wrappers() {
    echo -e "\n${CYAN}🔧 Creating command wrappers...${NC}"
    
    local bin_dir="$CODING_REPO/bin"
    mkdir -p "$bin_dir"
    
    # ukb command removed - use MCP server workflow instead

    # Create vkb wrapper
    cat > "$bin_dir/vkb" << 'EOF'
#!/bin/bash
# Universal vkb wrapper
CODING_REPO="$(cd "$(dirname "$(dirname "${BASH_SOURCE[0]}")")" && pwd)"
export CODING_REPO
exec "$CODING_REPO/knowledge-management/vkb" "$@"
EOF
    chmod +x "$bin_dir/vkb"
    
    
    # Note: Original scripts now use dynamic repo detection, no need to update paths
    
    success "Command wrappers created"
}

# Configure shell environment
configure_shell_environment() {
    echo -e "\n${CYAN}🐚 Configuring shell environment...${NC}"
    
    local claude_path_export="export PATH=\"$CODING_REPO/bin:\$PATH\""
    local claude_repo_export="export CODING_REPO=\"$CODING_REPO\""
    
    # Clean up old aliases from all shell config files
    local config_files=("$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.zshrc" "$HOME/.zprofile")
    
    for config_file in "${config_files[@]}"; do
        if [[ -f "$config_file" ]]; then
            info "Cleaning up old configurations in $config_file..."
            # Remove old alias blocks and exports
            sed -i.bak '/# ===============================================/,/💡 Master commands/d' "$config_file" 2>/dev/null || true
            sed -i.bak '/Enhanced Knowledge Management Aliases/,/💡 Master commands/d' "$config_file" 2>/dev/null || true
            sed -i.bak '/alias vkb=/d' "$config_file" 2>/dev/null || true
            sed -i.bak '/alias claude-mcp=/d' "$config_file" 2>/dev/null || true
            sed -i.bak '/unalias vkb/d' "$config_file" 2>/dev/null || true
            # Remove old CODING_REPO/CLAUDE_REPO exports
            sed -i.bak '/CLAUDE_REPO.*Claude/d' "$config_file" 2>/dev/null || true
            sed -i.bak '/CODING_REPO.*coding/d' "$config_file" 2>/dev/null || true
        fi
    done
    
    # Clean up old wrapper scripts in ~/bin that point to wrong paths
    local wrapper_scripts=("$HOME/bin/vkb" "$HOME/bin/claude-mcp")
    for wrapper in "${wrapper_scripts[@]}"; do
        if [[ -f "$wrapper" ]] && grep -q "/Users/q284340/Claude/" "$wrapper" 2>/dev/null; then
            info "Updating old wrapper script: $wrapper"
            # Update wrapper to point to new location
            local script_name=$(basename "$wrapper")
            cat > "$wrapper" << EOF
#!/bin/bash
# Updated wrapper for $script_name command
exec $CODING_REPO/knowledge-management/$script_name "\$@"
EOF
            chmod +x "$wrapper"
        fi
    done
    
    # SANDBOX MODE: Only create local .activate file
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        cat > "$CODING_REPO/.activate" << EOF
# Coding Tools - Sandbox Activation
# Source this file to activate this installation in your current shell:
#   source $CODING_REPO/.activate

export CODING_REPO="$CODING_REPO"
export PATH="$CODING_REPO/bin:\$PATH"
EOF
        chmod +x "$CODING_REPO/.activate"

        warning "SANDBOX MODE: Global shell configs NOT modified"
        info "To activate this installation:"
        info "  source $CODING_REPO/.activate"
        return
    fi

    # NORMAL MODE: Modify shell config (ONLY ONE FILE based on detected shell)
    if grep -q "CODING_REPO.*$CODING_REPO" "$SHELL_RC" 2>/dev/null && grep -q "PATH.*$CODING_REPO/bin" "$SHELL_RC" 2>/dev/null; then
        info "Shell already configured with correct paths in $SHELL_RC"
    else
        # Ask for confirmation before modifying shell config
        if ! confirm_system_change \
            "Modify shell configuration file: $SHELL_RC" \
            "This adds CODING_REPO and PATH exports. Changes can be reversed by uninstall.sh."; then
            warning "Skipped shell configuration modification"
            info "You can manually add these to your shell config:"
            info "  $claude_repo_export"
            info "  $claude_path_export"
            SKIPPED_SYSTEM_DEPS+=("shell-config")
        else
            # Create timestamped backup before modification
            local backup_file="${SHELL_RC}.coding-backup.$(date +%Y%m%d%H%M%S)"
            cp "$SHELL_RC" "$backup_file"
            info "Created backup: $backup_file"

            # Remove any existing Claude configurations to prevent duplicates
            if [[ -f "$SHELL_RC.bak" ]]; then
                rm -f "$SHELL_RC.bak"
            fi
            # Remove existing Claude sections
            sed -i.bak '/# Claude Knowledge Management System/,/^$/d' "$SHELL_RC" 2>/dev/null || true

            # Add configuration to SINGLE shell config file with markers
            {
                echo ""
                echo "# === CODING TOOLS START (installed: $(date +%Y-%m-%d)) ==="
                echo "$claude_repo_export"
                echo "$claude_path_export"
                echo "# === CODING TOOLS END ==="
                echo ""
            } >> "$SHELL_RC"

            # Verify the modification didn't break the shell config
            if bash -n "$SHELL_RC" 2>/dev/null || zsh -n "$SHELL_RC" 2>/dev/null; then
                success "Configuration added to $SHELL_RC"
                info "Backup saved: $backup_file"
            else
                warning "Shell config may have issues - restoring backup"
                cp "$backup_file" "$SHELL_RC"
                INSTALLATION_WARNINGS+=("Shell config: Restored from backup due to syntax issues")
            fi
        fi
    fi
    
    # Create a cleanup script for the current shell session
    mkdir -p "$CODING_REPO/scripts"
    cat > "$CODING_REPO/scripts/cleanup-aliases.sh" << 'EOF'
#!/bin/bash
# Cleanup aliases from current shell session
unalias vkb 2>/dev/null || true
unalias claude-mcp 2>/dev/null || true
unset -f vkb 2>/dev/null || true
unset -f claude-mcp 2>/dev/null || true
EOF
    chmod +x "$CODING_REPO/scripts/cleanup-aliases.sh"
    
    success "Shell environment configured and old aliases removed"
    info "If you still see old aliases, run: source $CODING_REPO/scripts/cleanup-aliases.sh"
}

# Setup MCP configuration
setup_mcp_config() {
    echo -e "\n${CYAN}⚙️  Setting up MCP configuration...${NC}"
    
    # Check if template file exists
    if [[ ! -f "$CODING_REPO/claude-code-mcp.json" ]]; then
        warning "claude-code-mcp.json template not found, skipping MCP configuration..."
        return
    fi
    
    # Check if .env file exists and source it
    if [[ -f "$CODING_REPO/.env" ]]; then
        info "Loading environment variables from .env file..."
        set -a
        source "$CODING_REPO/.env"
        set +a
    else
        warning ".env file not found. Using empty API keys - please configure them later."
    fi
    
    # Note: Original template is preserved as claude-code-mcp.json
    
    # Replace placeholders in the template
    local temp_file=$(mktemp)
    cp "$CODING_REPO/claude-code-mcp.json" "$temp_file"
    
    # Replace environment variables - use the actual CODING_REPO path
    sed -i.bak "s|{{CODING_TOOLS_PATH}}|$CODING_REPO|g" "$temp_file"
    sed -i.bak "s|{{PARENT_DIR}}|$(dirname "$CODING_REPO")|g" "$temp_file"
    sed -i.bak "s|{{LOCAL_CDP_URL}}|${LOCAL_CDP_URL:-ws://localhost:9222}|g" "$temp_file"
    sed -i.bak "s|{{ANTHROPIC_API_KEY}}|${ANTHROPIC_API_KEY:-}|g" "$temp_file"
    sed -i.bak "s|{{OPENAI_API_KEY}}|${OPENAI_API_KEY:-}|g" "$temp_file"
    sed -i.bak "s|{{XAI_API_KEY}}|${XAI_API_KEY:-}|g" "$temp_file"
    sed -i.bak "s|{{OPENAI_BASE_URL}}|${OPENAI_BASE_URL:-}|g" "$temp_file"
    sed -i.bak "s|{{KNOWLEDGE_BASE_PATH}}|${KNOWLEDGE_BASE_PATH:-$CODING_REPO}|g" "$temp_file"
    sed -i.bak "s|{{CODING_DOCS_PATH}}|${CODING_DOCS_PATH:-$CODING_REPO/docs}|g" "$temp_file"
    
    # Save the processed version locally
    cp "$temp_file" "$CODING_REPO/claude-code-mcp-processed.json"
    
    # Fix common JSON syntax errors (trailing commas)
    if command -v python3 >/dev/null 2>&1; then
        python3 -c "
import json
import sys
try:
    with open('$CODING_REPO/claude-code-mcp-processed.json', 'r') as f:
        data = json.load(f)
    with open('$CODING_REPO/claude-code-mcp-processed.json', 'w') as f:
        json.dump(data, f, indent=2)
    print('JSON syntax validated and fixed')
except Exception as e:
    print(f'JSON validation failed: {e}', file=sys.stderr)
" || warning "JSON validation failed, but continuing..."
    fi
    
    info "Processed configuration saved to: claude-code-mcp-processed.json"
    
    # Setup USER-LEVEL cross-project configuration
    setup_user_level_mcp_config "$temp_file"
    
    # Setup project-level configuration (legacy support)
    setup_project_level_mcp_config "$temp_file"
    
    # Clean up
    rm -f "$temp_file"
    
    success "MCP configuration setup completed"
}

# Setup user-level MCP configuration for cross-project use
setup_user_level_mcp_config() {
    local temp_file="$1"

    # SANDBOX MODE: Skip global config modifications
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        warning "SANDBOX MODE: Skipping user-level MCP configuration (~/.claude.json)"
        info "To use MCP servers, manually source: $CODING_REPO/claude-code-mcp-processed.json"
        return 0
    fi

    echo -e "\n${CYAN}📋 Setting up user-level MCP configuration (cross-project)...${NC}"

    # Read existing user configuration if it exists
    local user_config="$HOME/.claude.json"
    local user_config_backup=""
    
    if [[ -f "$user_config" ]]; then
        # Create backup
        user_config_backup="$user_config.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$user_config" "$user_config_backup"
        info "Backed up existing configuration to: $user_config_backup"
        
        # Merge with existing configuration
        local merged_config=$(mktemp)
        
        # Use jq to merge configurations, giving priority to new MCP servers
        if command -v jq >/dev/null 2>&1; then
            jq -s '.[0] * .[1]' "$user_config" "$temp_file" > "$merged_config"
            cp "$merged_config" "$user_config"
            rm -f "$merged_config"
            success "Merged MCP configuration with existing user config"
        else
            # Fallback: overwrite mcpServers section only
            warning "jq not found, using simple merge (may overwrite existing MCP servers)"
            cp "$temp_file" "$user_config"
        fi
    else
        # No existing config, just copy
        cp "$temp_file" "$user_config"
        success "Created new user-level configuration"
    fi
    
    info "User-level MCP configuration: $user_config"
    echo -e "${GREEN}✅ This configuration will work in ALL your projects${NC}"
}

# Setup project-level MCP configuration (legacy support)
setup_project_level_mcp_config() {
    local temp_file="$1"
    
    echo -e "\n${CYAN}📁 Setting up project-level MCP configuration...${NC}"
    
    # Copy to user's Claude configuration directory (legacy app-specific config)
    local claude_config_dir=""
    case "$PLATFORM" in
        macos)
            claude_config_dir="$HOME/Library/Application Support/Claude"
            ;;
        linux)
            claude_config_dir="$HOME/.config/Claude"
            ;;
        windows)
            claude_config_dir="$APPDATA/Claude"
            if [[ -z "$claude_config_dir" ]]; then
                claude_config_dir="$HOME/AppData/Roaming/Claude"
            fi
            ;;
    esac
    
    if [[ -n "$claude_config_dir" ]] && [[ -d "$claude_config_dir" ]]; then
        cp "$temp_file" "$claude_config_dir/claude-code-mcp.json"
        info "Also installed to Claude app directory: $claude_config_dir/claude-code-mcp.json"
    else
        info "Claude app directory not found (this is normal for CLI-only usage)"
    fi
}

# Initialize knowledge management system
# Imports knowledge from git-tracked JSON exports into GraphDB (LevelDB)
# This is critical for fresh installs where LevelDB is empty but JSON exports exist
initialize_shared_memory() {
    echo -e "\n${CYAN}📝 Initializing knowledge management...${NC}"

    info "Knowledge management is handled by GraphDB (see .data/knowledge-graph/)"
    info "Team-specific exports available at .data/knowledge-export/*.json"

    # Check if JSON exports exist but LevelDB is empty (fresh install scenario)
    local json_exports_exist=false
    local leveldb_empty=true

    # Check for ANY JSON exports (coding.json, ui.json, resi.json, etc.)
    local json_count=0
    if [[ -d "$CODING_REPO/.data/knowledge-export" ]]; then
        json_count=$(find "$CODING_REPO/.data/knowledge-export" -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')
        if [[ "$json_count" -gt 0 ]]; then
            json_exports_exist=true
            info "Found $json_count JSON export file(s) to import"
        fi
    fi

    # Check if LevelDB has data (look for .ldb files with content or non-empty .log files)
    if [[ -d "$CODING_REPO/.data/knowledge-graph" ]]; then
        local log_size=0
        for log_file in "$CODING_REPO/.data/knowledge-graph"/*.log; do
            if [[ -f "$log_file" ]]; then
                local size=$(stat -f%z "$log_file" 2>/dev/null || stat -c%s "$log_file" 2>/dev/null || echo "0")
                if [[ "$size" -gt 100 ]]; then
                    leveldb_empty=false
                    break
                fi
            fi
        done
    fi

    # Import from JSON if exports exist and LevelDB is empty
    if [[ "$json_exports_exist" == "true" && "$leveldb_empty" == "true" ]]; then
        info "Importing knowledge from JSON exports into GraphDB..."

        # Ensure bin directory is in PATH for graph-sync
        export PATH="$CODING_REPO/bin:$PATH"

        # Run graph-sync import (without file watchers using a simple timeout)
        if command -v node >/dev/null 2>&1; then
            cd "$CODING_REPO"
            # Run import and capture output
            if timeout 60 node bin/graph-sync import 2>&1 | grep -E "^✓|entities|relations" | head -10; then
                success "Knowledge imported from JSON exports to GraphDB"
            else
                warn "Knowledge import encountered issues (non-fatal)"
            fi
            cd - > /dev/null
        else
            warn "Node.js not available - skipping knowledge import"
        fi
    elif [[ "$json_exports_exist" == "true" ]]; then
        info "GraphDB already has data, skipping JSON import"
    else
        info "No JSON exports found - knowledge will be created as you work"
    fi

    success "Knowledge management system ready"
}

# Create example configuration files
create_example_configs() {
    echo -e "\n${CYAN}📄 Creating example configuration files...${NC}"
    
    # Create .env.example for MCP servers (only if it doesn't exist)
    if [[ ! -f "$CODING_REPO/.env.example" ]]; then
        info "Creating .env.example file..."
        cat > "$CODING_REPO/.env.example" << 'EOF'
# Claude Knowledge Management System - Environment Variables

# For browser-access MCP server (optional)
ANTHROPIC_API_KEY=your-anthropic-api-key
BROWSERBASE_API_KEY=your-browserbase-api-key
BROWSERBASE_PROJECT_ID=your-project-id
LOCAL_CDP_URL=ws://localhost:9222

# Primary coding tools path (set automatically by installer)
# This is the main path used throughout the system
CODING_TOOLS_PATH=/path/to/coding/repo

# For claude-logger MCP server
# No specific environment variables required

# For constraint-monitor system
XAI_API_KEY=your-xai-api-key
OPENAI_API_KEY=your-openai-api-key

# Admin API keys for real-time usage/billing data in status line
# These are DIFFERENT from regular API keys - they have org-level permissions
# Anthropic: Create at console.anthropic.com -> Settings -> Admin API Keys (format: sk-ant-admin-...)
ANTHROPIC_ADMIN_API_KEY=your-anthropic-admin-api-key
# OpenAI: Create at platform.openai.com/settings/organization/admin-keys
OPENAI_ADMIN_API_KEY=your-openai-admin-api-key

# Custom paths (optional)
# CODING_REPO=/path/to/coding/repo (legacy, now uses CODING_TOOLS_PATH)
# MEMORY_VISUALIZER_DIR=/path/to/memory-visualizer

# Knowledge Base path - where .data/knowledge-graph/ and .data/knowledge-export/ are located
# Default: same directory as the coding project
# Can be set to a different path for centralized knowledge management
CODING_KB_PATH=/path/to/coding/repo

# Default knowledge views to display in VKB viewer
# Comma-separated list of views (e.g., "coding,ui,resi")
KNOWLEDGE_VIEW=coding,ui
EOF
    else
        info ".env.example already exists, skipping creation"
    fi
    
    # Create actual .env file if it doesn't exist
    if [[ ! -f "$CODING_REPO/.env" ]]; then
        info "Creating .env file with default settings..."
        cat > "$CODING_REPO/.env" << EOF
# Claude Knowledge Management System - Environment Variables

# For browser-access MCP server (optional)
ANTHROPIC_API_KEY=
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=
LOCAL_CDP_URL=ws://localhost:9222

# Project path - automatically set by installer
CLAUDE_PROJECT_PATH=$CODING_REPO

# Knowledge Base path - where .data/knowledge-graph/ and .data/knowledge-export/ are located
# Default: same directory as the coding project
CODING_KB_PATH=$CODING_REPO

# For constraint-monitor system
GROK_API_KEY=
OPENAI_API_KEY=

# Admin API keys for real-time usage/billing data in status line
# These are DIFFERENT from regular API keys - they have org-level permissions
# Anthropic: Create at console.anthropic.com -> Settings -> Admin API Keys (format: sk-ant-admin-...)
ANTHROPIC_ADMIN_API_KEY=
# OpenAI: Create at platform.openai.com/settings/organization/admin-keys
OPENAI_ADMIN_API_KEY=

# Default knowledge views to display in VKB viewer
KNOWLEDGE_VIEW=coding,ui
EOF
        success ".env file created with project paths"
    else
        # Update existing .env file to add CODING_KB_PATH if missing
        if ! grep -q "CODING_KB_PATH" "$CODING_REPO/.env"; then
            info "Adding CODING_KB_PATH to existing .env file..."
            echo "" >> "$CODING_REPO/.env"
            echo "# Knowledge Base path - where .data/knowledge-graph/ and .data/knowledge-export/ are located" >> "$CODING_REPO/.env"
            echo "# Default: same directory as the coding project" >> "$CODING_REPO/.env"
            echo "CODING_KB_PATH=$CODING_REPO" >> "$CODING_REPO/.env"
        fi
        
        # Update existing .env file to add KNOWLEDGE_VIEW if missing
        if ! grep -q "KNOWLEDGE_VIEW" "$CODING_REPO/.env"; then
            info "Adding KNOWLEDGE_VIEW to existing .env file..."
            echo "" >> "$CODING_REPO/.env"
            echo "# Default knowledge views to display in VKB viewer" >> "$CODING_REPO/.env"
            echo "KNOWLEDGE_VIEW=coding,ui" >> "$CODING_REPO/.env"
        fi

        # Update existing .env file to add Admin API keys if missing
        if ! grep -q "ANTHROPIC_ADMIN_API_KEY" "$CODING_REPO/.env"; then
            info "Adding Admin API keys to existing .env file..."
            echo "" >> "$CODING_REPO/.env"
            echo "# Admin API keys for real-time usage/billing data in status line" >> "$CODING_REPO/.env"
            echo "# These are DIFFERENT from regular API keys - they have org-level permissions" >> "$CODING_REPO/.env"
            echo "# Anthropic: Create at console.anthropic.com -> Settings -> Admin API Keys (format: sk-ant-admin-...)" >> "$CODING_REPO/.env"
            echo "ANTHROPIC_ADMIN_API_KEY=" >> "$CODING_REPO/.env"
            echo "# OpenAI: Create at platform.openai.com/settings/organization/admin-keys" >> "$CODING_REPO/.env"
            echo "OPENAI_ADMIN_API_KEY=" >> "$CODING_REPO/.env"
        fi
    fi
    
    success "Example configuration files created"
}

# Verify installation
verify_installation() {
    echo -e "\n${CYAN}🔍 Verifying installation...${NC}"
    
    local errors=0
    
    # Check vkb command (ukb removed - use MCP server workflow)
    if [[ -x "$CODING_REPO/bin/vkb" ]]; then
        success "vkb command is available"
    else
        error_exit "vkb command not found or not executable"
        ((errors++))
    fi
    
    # Check memory visualizer
    if [[ -d "$MEMORY_VISUALIZER_DIR/dist" ]]; then
        success "Memory visualizer is built"
    else
        warning "Memory visualizer dist directory not found"
        ((errors++))
    fi
    
    # Check MCP servers
    if [[ -f "$CODING_REPO/integrations/browser-access/dist/index.js" ]]; then
        success "Browser-access MCP server is built"
    else
        warning "Browser-access MCP server not built"
    fi

    # Check Constraint Monitor with Professional Dashboard
    if [[ -d "$CODING_REPO/integrations/mcp-constraint-monitor" ]]; then
        success "MCP Constraint Monitor (standalone) configured"
        if [[ -d "$CODING_REPO/integrations/mcp-constraint-monitor/dashboard" ]]; then
            success "Professional Dashboard (port 3030) installed"
        else
            warning "Professional Dashboard not found"
        fi
    else
        warning "Constraint monitor system not installed"
    fi

    # Check System Health Dashboard
    if [[ -d "$CODING_REPO/integrations/system-health-dashboard" ]]; then
        if [[ -d "$CODING_REPO/integrations/system-health-dashboard/node_modules" ]]; then
            success "System Health Dashboard (ports 3032/3033) installed"
        else
            warning "System Health Dashboard dependencies not installed"
        fi
    else
        warning "System Health Dashboard not found"
    fi
    
    # Check Semantic Analysis MCP server
    if [[ -f "$CODING_REPO/integrations/mcp-server-semantic-analysis/dist/index.js" ]]; then
        success "Semantic Analysis MCP server is built"
    else
        warning "Semantic Analysis MCP server not built"
    fi

    # Check Browserbase MCP server
    if [[ -f "$CODING_REPO/integrations/mcp-server-browserbase/dist/index.js" ]]; then
        success "Browserbase MCP server is built"
    else
        warning "Browserbase MCP server not built"
    fi

    # Check Serena MCP server
    if [[ -f "$CODING_REPO/integrations/serena/pyproject.toml" ]]; then
        success "Serena MCP server is installed"
    else
        warning "Serena MCP server not installed"
    fi

    # Check shadcn/ui MCP server
    if [[ -d "$CODING_REPO/integrations/shadcn-mcp" ]]; then
        success "shadcn/ui MCP server is installed"
    else
        warning "shadcn/ui MCP server not installed"
    fi
    
    
    if [[ $errors -eq 0 ]]; then
        success "Installation verification passed!"
    else
        warning "Installation completed with warnings. Some features may not work correctly."
    fi
}

# Detect available coding agents
detect_agents() {
    info "Detecting available coding agents..."
    
    local agents_found=()
    
    # Check for Claude Code
    if command -v claude >/dev/null 2>&1; then
        agents_found+=("claude")
        success "✓ Claude Code detected"
    else
        warning "Claude Code not found"
    fi
    
    # Check for GitHub CoPilot
    if command -v gh >/dev/null 2>&1; then
        if gh extension list 2>/dev/null | grep -q copilot; then
            agents_found+=("copilot")
            success "✓ GitHub CoPilot detected"
        else
            warning "GitHub CLI found but CoPilot extension not installed"
            info "  Install with: gh extension install github/gh-copilot"
        fi
    else
        warning "GitHub CLI not found"
        info "  Install from: https://cli.github.com/"
    fi
    
    if [ ${#agents_found[@]} -eq 0 ]; then
        error_exit "No supported coding agents found. Please install Claude Code or GitHub CoPilot."
        return 1
    fi
    
    info "Found agents: ${agents_found[*]}"
    return 0
}

# Configure team-based knowledge management
configure_team_setup() {
    echo ""
    echo -e "${PURPLE}🏢 Multi-Team Knowledge Base Configuration${NC}"
    echo -e "${PURPLE}=========================================${NC}"
    echo ""
    
    # Set default team configuration
    export CODING_TEAM="coding ui"
    
    info "Team configuration automatically set to: coding and ui"
    info ""
    info "ℹ️  To change the team configuration, modify the CODING_TEAM environment variable"
    info "   Available teams:"
    echo "     • coding - General coding patterns and knowledge"
    echo "     • ui     - UI/Frontend development (React, TypeScript, etc.)"
    echo "     • resi   - Reprocessing/Simulation development (C++, systems, performance)"
    echo "     • raas   - RaaS development (Java, DevOps, microservices)"
    echo "     • custom - Any custom team name"
    echo ""
    info "   Example: export CODING_TEAM=\"resi raas\" for multiple teams"
    info "   Example: export CODING_TEAM=\"myteam\" for a custom team"

    # Add to shell environment (only if not already configured and NOT in sandbox mode)
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        warning "SANDBOX MODE: Skipping CODING_TEAM configuration in $SHELL_RC"
        info "To use CODING_TEAM, export it manually: export CODING_TEAM=\"coding ui\""
    elif grep -q "export CODING_TEAM=" "$SHELL_RC" 2>/dev/null; then
        info "CODING_TEAM already configured in $SHELL_RC"
    else
        echo "" >> "$SHELL_RC"
        echo "# Coding Tools - Team Configuration" >> "$SHELL_RC"
        echo "# Modify this variable to change team scope (e.g., \"resi raas\" for multiple teams)" >> "$SHELL_RC"
        echo "export CODING_TEAM=\"$CODING_TEAM\"" >> "$SHELL_RC"
        success "Team configuration added to $SHELL_RC"
    fi

    info "Your configuration will use these knowledge exports:"
    echo "  • .data/knowledge-export/coding.json (general coding patterns)"
    echo "  • .data/knowledge-export/ui.json (UI/frontend specific knowledge)"
    info "Knowledge is managed by GraphDB at .data/knowledge-graph/ (auto-persisted)"
}

# Install PlantUML for diagram generation
install_plantuml() {
    info "Installing PlantUML for diagram generation..."

    # Check if already installed
    if command -v plantuml >/dev/null 2>&1; then
        success "✓ PlantUML already installed"
        return 0
    fi

    # Offer choice: system package manager or self-contained JAR
    echo ""
    echo -e "${CYAN}PlantUML is not installed. Choose installation method:${NC}"
    echo -e "  ${GREEN}1${NC} = Self-contained JAR in coding repo ${YELLOW}(Recommended - no system changes)${NC}"
    echo -e "  ${GREEN}2${NC} = System package manager (brew/apt-get)"
    echo -e "  ${GREEN}3${NC} = Skip PlantUML (diagram generation won't work)"
    echo ""
    read -p "$(echo -e ${CYAN}Your choice [1/2/3]: ${NC})" plantuml_choice

    case "$plantuml_choice" in
        1)
            # Self-contained JAR - no system changes
            install_plantuml_jar
            ;;
        2)
            # System package manager - requires confirmation
            case "$PLATFORM" in
                macos)
                    if command -v brew >/dev/null 2>&1; then
                        if confirm_system_change \
                            "Install PlantUML via Homebrew (brew install plantuml)" \
                            "Homebrew may update other packages as dependencies. This can affect other tools."; then
                            info "Installing PlantUML via Homebrew..."
                            if brew install plantuml; then
                                success "✓ PlantUML installed via Homebrew"
                            else
                                warning "Failed to install PlantUML via Homebrew, trying JAR fallback..."
                                install_plantuml_jar
                            fi
                        else
                            info "Using JAR fallback instead..."
                            install_plantuml_jar
                        fi
                    else
                        warning "Homebrew not found, using JAR fallback..."
                        install_plantuml_jar
                    fi
                    ;;
                linux)
                    if command -v apt-get >/dev/null 2>&1; then
                        if confirm_system_change \
                            "Install PlantUML via apt-get (sudo apt-get install plantuml)" \
                            "Requires sudo privileges. May install additional dependencies."; then
                            info "Installing PlantUML via apt-get..."
                            if sudo apt-get update && sudo apt-get install -y plantuml; then
                                success "✓ PlantUML installed via apt-get"
                            else
                                warning "Failed to install PlantUML via apt-get, trying JAR fallback..."
                                install_plantuml_jar
                            fi
                        else
                            info "Using JAR fallback instead..."
                            install_plantuml_jar
                        fi
                    elif command -v yum >/dev/null 2>&1; then
                        if confirm_system_change \
                            "Install PlantUML via yum (sudo yum install plantuml)" \
                            "Requires sudo privileges. May install additional dependencies."; then
                            info "Installing PlantUML via yum..."
                            if sudo yum install -y plantuml; then
                                success "✓ PlantUML installed via yum"
                            else
                                warning "Failed to install PlantUML via yum, trying JAR fallback..."
                                install_plantuml_jar
                            fi
                        else
                            info "Using JAR fallback instead..."
                            install_plantuml_jar
                        fi
                    elif command -v pacman >/dev/null 2>&1; then
                        if confirm_system_change \
                            "Install PlantUML via pacman (sudo pacman -S plantuml)" \
                            "Requires sudo privileges. May install additional dependencies."; then
                            info "Installing PlantUML via pacman..."
                            if sudo pacman -S --noconfirm plantuml; then
                                success "✓ PlantUML installed via pacman"
                            else
                                warning "Failed to install PlantUML via pacman, trying JAR fallback..."
                                install_plantuml_jar
                            fi
                        else
                            info "Using JAR fallback instead..."
                            install_plantuml_jar
                        fi
                    else
                        warning "No supported package manager found, using JAR fallback..."
                        install_plantuml_jar
                    fi
                    ;;
                *)
                    warning "Unknown platform, using JAR fallback..."
                    install_plantuml_jar
                    ;;
            esac
            ;;
        3|*)
            warning "Skipping PlantUML installation. Diagram generation will not work."
            SKIPPED_SYSTEM_DEPS+=("plantuml")
            ;;
    esac
}

# Fallback installation using PlantUML JAR
install_plantuml_jar() {
    info "Installing PlantUML JAR fallback..."
    
    # Check if Java is available
    if ! command -v java >/dev/null 2>&1; then
        warning "Java not found. PlantUML JAR requires Java to run."
        INSTALLATION_WARNINGS+=("PlantUML: Java required but not found")
        return 1
    fi
    
    # Create local bin directory
    local bin_dir="$CODING_REPO/bin"
    mkdir -p "$bin_dir"
    
    # Download PlantUML JAR
    local plantuml_jar="$bin_dir/plantuml.jar"
    info "Downloading PlantUML JAR..."
    
    if curl -L -o "$plantuml_jar" "https://github.com/plantuml/plantuml/releases/download/v1.2023.12/plantuml-1.2023.12.jar"; then
        # Create wrapper script
        local plantuml_script="$bin_dir/plantuml"
        cat > "$plantuml_script" << 'EOF'
#!/bin/bash
java -jar "$(dirname "$0")/plantuml.jar" "$@"
EOF
        chmod +x "$plantuml_script"
        
        # Add to PATH in .activate if not already there
        if [ -f "$CODING_REPO/.activate" ] && ! grep -q "$bin_dir" "$CODING_REPO/.activate"; then
            echo "export PATH=\"$bin_dir:\$PATH\"" >> "$CODING_REPO/.activate"
        fi
        
        success "✓ PlantUML JAR installed to $bin_dir"
        info "Note: PlantUML added to PATH via .activate script"
    else
        warning "Failed to download PlantUML JAR"
        INSTALLATION_WARNINGS+=("PlantUML: Failed to download JAR")
        return 1
    fi
}

# Install Ollama for local LLM inference (fallback when cloud APIs fail)
install_ollama() {
    info "Checking Ollama for local LLM inference (optional)..."

    # Check if already installed
    if command -v ollama >/dev/null 2>&1; then
        success "✓ Ollama already installed"
        # Ensure llama3.2:latest model is available
        ensure_ollama_model
        return 0
    fi

    # Ollama is optional - ask if user wants to install
    echo ""
    echo -e "${CYAN}Ollama is not installed (optional - for local LLM fallback).${NC}"
    echo -e "  ${GREEN}y${NC} = Install Ollama"
    echo -e "  ${GREEN}n${NC} = Skip (coding tools will work without it)"
    echo ""
    read -p "$(echo -e ${CYAN}Install Ollama? [y/N]: ${NC})" install_ollama_choice

    case "$install_ollama_choice" in
        [yY]|[yY][eE][sS])
            # Proceed with installation
            ;;
        *)
            info "Skipping Ollama installation (optional component)"
            SKIPPED_SYSTEM_DEPS+=("ollama")
            return 0
            ;;
    esac

    case "$PLATFORM" in
        macos)
            if command -v brew >/dev/null 2>&1; then
                if confirm_system_change \
                    "Install Ollama via Homebrew (brew install ollama)" \
                    "Homebrew may update dependencies. This is a ~500MB+ download."; then
                    info "Installing Ollama via Homebrew..."
                    if brew install ollama; then
                        success "✓ Ollama installed via Homebrew"
                        ensure_ollama_model
                    else
                        warning "Failed to install Ollama via Homebrew"
                        INSTALLATION_WARNINGS+=("Ollama: Failed to install via Homebrew")
                        return 1
                    fi
                else
                    info "Skipping Ollama installation"
                    SKIPPED_SYSTEM_DEPS+=("ollama")
                    return 0
                fi
            else
                if confirm_system_change \
                    "Install Ollama via official script (curl | sh)" \
                    "This downloads and executes an installer script from ollama.com."; then
                    info "Installing Ollama via official script..."
                    if curl -fsSL https://ollama.com/install.sh | sh; then
                        success "✓ Ollama installed via official script"
                        ensure_ollama_model
                    else
                        warning "Failed to install Ollama"
                        INSTALLATION_WARNINGS+=("Ollama: Installation failed")
                        return 1
                    fi
                else
                    info "Skipping Ollama installation"
                    SKIPPED_SYSTEM_DEPS+=("ollama")
                    return 0
                fi
            fi
            ;;
        linux)
            if confirm_system_change \
                "Install Ollama via official script (curl | sh)" \
                "This downloads and executes an installer script from ollama.com."; then
                info "Installing Ollama via official script..."
                if curl -fsSL https://ollama.com/install.sh | sh; then
                    success "✓ Ollama installed"
                    ensure_ollama_model
                else
                    warning "Failed to install Ollama"
                    INSTALLATION_WARNINGS+=("Ollama: Installation failed")
                    return 1
                fi
            else
                info "Skipping Ollama installation"
                SKIPPED_SYSTEM_DEPS+=("ollama")
                return 0
            fi
            ;;
        windows)
            info "Windows: Ollama requires manual installation from https://ollama.com/download"
            SKIPPED_SYSTEM_DEPS+=("ollama")
            return 0
            ;;
        *)
            info "Unknown platform: install Ollama manually from https://ollama.com if needed"
            SKIPPED_SYSTEM_DEPS+=("ollama")
            return 0
            ;;
    esac
}

# Ensure Ollama has the required model downloaded
ensure_ollama_model() {
    local model="llama3.2:latest"
    info "Ensuring Ollama model '$model' is available..."

    # Start ollama service if not running (needed for model operations)
    if ! pgrep -x "ollama" >/dev/null 2>&1; then
        info "Starting Ollama service..."
        ollama serve >/dev/null 2>&1 &
        sleep 2  # Give it time to start
    fi

    # Check if model exists
    if ollama list 2>/dev/null | grep -q "llama3.2"; then
        success "✓ Model '$model' already available"
        return 0
    fi

    # Pull the model
    info "Downloading model '$model' (this may take a few minutes)..."
    if ollama pull "$model"; then
        success "✓ Model '$model' downloaded successfully"
    else
        warning "Failed to download model '$model'"
        warning "You can download it later with: ollama pull $model"
        INSTALLATION_WARNINGS+=("Ollama: Model download failed, run 'ollama pull $model' manually")
    fi
}

# Install Node.js dependencies for agent-agnostic functionality
install_node_dependencies() {
    info "Installing Node.js dependencies for agent-agnostic functionality..."

    if [ ! -f "$CODING_REPO/package.json" ]; then
        error_exit "package.json not found. This is required for agent-agnostic functionality."
        return 1
    fi

    cd "$CODING_REPO"

    if npm install; then
        success "✓ Node.js dependencies installed (including better-sqlite3 for knowledge databases)"

        # Rebuild better-sqlite3 to ensure native bindings are compiled
        # This is necessary because pnpm (used by shadcn) may block build scripts
        info "Rebuilding better-sqlite3 native bindings..."
        if npm rebuild better-sqlite3 2>&1 | grep -q "rebuilt dependencies successfully"; then
            success "✓ better-sqlite3 native bindings rebuilt"
        else
            warning "better-sqlite3 rebuild may have issues, but installation will continue"
            INSTALLATION_WARNINGS+=("better-sqlite3 rebuild had warnings")
        fi
    else
        error_exit "Failed to install Node.js dependencies"
        return 1
    fi

    # Install Playwright browsers
    info "Installing Playwright browsers for browser automation fallback..."
    if npx playwright install chromium; then
        success "✓ Playwright browsers installed"
    else
        warning "Failed to install Playwright browsers. Browser automation may not work."
        INSTALLATION_WARNINGS+=("Playwright browsers not installed")
    fi

    # Install vkb-server dependencies
    info "Installing vkb-server dependencies..."
    if [ -d "$CODING_REPO/lib/vkb-server" ]; then
        cd "$CODING_REPO/lib/vkb-server"
        if npm install; then
            success "✓ vkb-server dependencies installed"
        else
            warning "Failed to install vkb-server dependencies"
            INSTALLATION_WARNINGS+=("vkb-server dependencies failed")
        fi
        cd "$CODING_REPO"
    fi
}

# Initialize knowledge management databases (Qdrant + SQLite)
initialize_knowledge_databases() {
    echo -e "\n${CYAN}📊 Initializing Continuous Learning Knowledge Databases...${NC}"

    cd "$CODING_REPO"

    # Create .data directory for knowledge databases
    local data_dir="$CODING_REPO/.data"
    if [[ ! -d "$data_dir" ]]; then
        info "Creating .data directory for knowledge databases..."
        mkdir -p "$data_dir"
        success ".data directory created"
    else
        info ".data directory already exists"
    fi

    # Check if Qdrant is available (optional)
    local qdrant_available=false
    info "Checking Qdrant availability (optional for vector search)..."
    if timeout 3s curl -s http://localhost:6333/health >/dev/null 2>&1; then
        qdrant_available=true
        success "✓ Qdrant is running on localhost:6333"
    else
        info "Qdrant not running (optional - vector search features will be disabled)"
        info "To enable Qdrant: docker run -d -p 6333:6333 qdrant/qdrant"
    fi

    # Check if VKB server is running (which locks LevelDB)
    local vkb_running=false
    if pgrep -f "vkb-server" >/dev/null 2>&1 || lsof -i :8080 2>/dev/null | grep -q node; then
        vkb_running=true
        info "VKB server detected - Graph database will be skipped (this is OK)"
        info "LevelDB is locked by VKB server, SQLite/Qdrant initialization will proceed"
    fi

    # Initialize knowledge management system (databases + config)
    info "Initializing knowledge management system..."
    if node scripts/initialize-knowledge-system.js --project-path "$CODING_REPO"; then
        success "✓ Knowledge management system initialized"
        info "  • Configuration: .specstory/config/knowledge-system.json"
        if [[ "$qdrant_available" == true ]]; then
            info "  • Qdrant collections: knowledge_patterns, trajectory_analysis, session_memory"
        fi
        info "  • SQLite database: $data_dir/knowledge.db"
        info "  • Knowledge extraction: enabled"
    else
        warning "Knowledge system initialization had issues"
        INSTALLATION_WARNINGS+=("Knowledge system: Initialization had warnings")
    fi

    # Add environment variables for database paths if not already in .env
    if [[ -f "$CODING_REPO/.env" ]]; then
        if ! grep -q "QDRANT_URL" "$CODING_REPO/.env"; then
            echo "" >> "$CODING_REPO/.env"
            echo "# Continuous Learning Knowledge System - Database Configuration" >> "$CODING_REPO/.env"
            echo "QDRANT_URL=http://localhost:6333" >> "$CODING_REPO/.env"
            echo "SQLITE_PATH=$data_dir/knowledge.db" >> "$CODING_REPO/.env"
        fi
    fi

    success "Knowledge databases ready for use"
}


# Create unified launcher
setup_unified_launcher() {
    info "Setting up unified launcher..."

    # SANDBOX MODE: Skip global launcher installation
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        warning "SANDBOX MODE: Skipping unified launcher installation (~/.bin)"
        info "To use 'coding' command, add to PATH: export PATH=\"$CODING_REPO/bin:\$PATH\""
        return 0
    fi

    local bin_dir="$HOME/bin"
    mkdir -p "$bin_dir"

    # Create symlink to coding
    if [ -f "$CODING_REPO/bin/coding" ]; then
        ln -sf "$CODING_REPO/bin/coding" "$bin_dir/coding"
        success "✓ coding launcher created in $bin_dir"

        # Add to PATH if not already there
        if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
            info "Adding $bin_dir to PATH in $SHELL_RC"
            echo "export PATH=\"$bin_dir:\$PATH\"" >> "$SHELL_RC"
        fi
    else
        error_exit "coding script not found"
        return 1
    fi
}

# Setup VSCode extension for knowledge management
setup_vscode_extension() {
    info "Setting up VSCode extension for knowledge management..."
    
    local vscode_ext_dir="$CODING_REPO/integrations/vscode-km-copilot"
    
    if [ ! -d "$vscode_ext_dir" ]; then
        warning "VSCode extension directory not found at $vscode_ext_dir - skipping VSCode extension setup"
        INSTALLATION_WARNINGS+=("VSCode extension directory not found - skipped VSCode extension setup")
        return 0
    fi
    
    # Install extension dependencies
    cd "$vscode_ext_dir"
    
    info "Installing VSCode extension dependencies..."
    if npm install; then
        success "✓ VSCode extension dependencies installed"
    else
        warning "Failed to install VSCode extension dependencies"
        INSTALLATION_WARNINGS+=("VSCode extension dependencies failed")
        return 1
    fi
    
    # Build the extension
    info "Building VSCode extension..."
    if npm run package; then
        local vsix_file=$(find . -name "*.vsix" | head -1)
        if [ -n "$vsix_file" ]; then
            success "✓ VSCode extension built: $vsix_file"
            
            # Check if VSCode is available
            if command -v code >/dev/null 2>&1; then
                info "Installing VSCode extension..."
                if code --install-extension "$vsix_file" --force; then
                    success "✓ VSCode extension installed successfully"
                else
                    warning "Failed to install VSCode extension automatically"
                    info "  Manual installation: Open VSCode → Extensions → '...' → Install from VSIX → Select: $vsix_file"
                fi
            else
                info "VSCode CLI not available. Manual installation required:"
                info "  1. Open VSCode"
                info "  2. Go to Extensions view (Ctrl+Shift+X)"
                info "  3. Click '...' menu → 'Install from VSIX...'"
                info "  4. Select: $vscode_ext_dir/$vsix_file"
            fi
        else
            error_exit "VSIX file not found after build"
            return 1
        fi
    else
        warning "Failed to build VSCode extension"
        INSTALLATION_WARNINGS+=("VSCode extension build failed")
        return 1
    fi
    
    # Return to original directory
    cd "$CODING_REPO"
    
    return 0
}

# Main installation flow
main() {
    echo -e "${PURPLE}🚀 Agent-Agnostic Coding Tools - Universal Installer${NC}"
    echo -e "${PURPLE}=====================================================${NC}"
    echo ""

    # Initialize log
    echo "Installation started at $(date)" > "$INSTALL_LOG"
    log "Platform: $(uname -s)"
    log "Coding repo: $CODING_REPO"

    # Detect platform
    detect_platform
    info "Detected platform: $PLATFORM"
    info "Shell config file: $SHELL_RC"

    # Detect if sandbox mode should be used
    detect_sandbox_mode
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        log "Running in SANDBOX MODE"
    fi
    
    # Run installation steps
    check_dependencies
    detect_agents
    configure_team_setup
    install_node_dependencies
    initialize_knowledge_databases
    install_plantuml
    install_ollama
    detect_network_and_set_repos
    test_proxy_connectivity
    install_memory_visualizer
    install_browserbase
    install_semantic_analysis
    install_serena
    install_constraint_monitor
    install_system_health_dashboard
    install_shadcn_mcp
    install_mcp_servers
    install_code_graph_rag
    create_command_wrappers
    setup_unified_launcher
    configure_shell_environment
    initialize_shared_memory
    create_example_configs
    setup_mcp_config
    setup_vscode_extension
    install_enhanced_lsl
    install_slash_commands
    create_project_local_settings
    install_constraint_monitor_hooks
    verify_installation
    
    # Create activation script for immediate use
    cat > "$CODING_REPO/.activate" << EOF
#!/bin/bash
# Activate Agent-Agnostic Coding Tools environment
export CODING_REPO="$CODING_REPO"
export PATH="$CODING_REPO/bin:\$PATH"
echo "✅ Agent-Agnostic Coding Tools environment activated!"
echo "Commands 'vkb' and 'coding' are now available."
echo ""
echo "Usage:"
echo "  coding           # Use best available agent"
echo "  coding --copilot # Force CoPilot"
echo "  coding --claude  # Force Claude Code"
EOF
    chmod +x "$CODING_REPO/.activate"
    
    # Installation status report
    show_installation_status
    
    log "Installation completed"
}

# Show comprehensive installation status
show_installation_status() {
    echo ""
    echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if [[ ${#INSTALLATION_FAILURES[@]} -eq 0 && ${#INSTALLATION_WARNINGS[@]} -eq 0 ]]; then
        echo -e "${GREEN}🎉 Installation completed successfully!${NC}"
    elif [[ ${#INSTALLATION_FAILURES[@]} -eq 0 ]]; then
        echo -e "${YELLOW}⚠️  Installation completed with warnings${NC}"
    else
        echo -e "${RED}❌ Installation completed with some failures${NC}"
    fi

    echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Show skipped system changes (important safety info)
    if [[ ${#SKIPPED_SYSTEM_DEPS[@]} -gt 0 ]]; then
        echo -e "\n${BLUE}ℹ️  Skipped system changes (at your request):${NC}"
        for skipped in "${SKIPPED_SYSTEM_DEPS[@]}"; do
            echo -e "  ${BLUE}•${NC} $skipped"
        done
        echo -e "  ${CYAN}These can be installed manually later if needed.${NC}"
    fi

    # Show warnings
    if [[ ${#INSTALLATION_WARNINGS[@]} -gt 0 ]]; then
        echo -e "\n${YELLOW}⚠️  Warnings:${NC}"
        for warning in "${INSTALLATION_WARNINGS[@]}"; do
            echo -e "  ${YELLOW}•${NC} $warning"
        done
    fi

    # Show failures
    if [[ ${#INSTALLATION_FAILURES[@]} -gt 0 ]]; then
        echo -e "\n${RED}❌ Failures:${NC}"
        for failure in "${INSTALLATION_FAILURES[@]}"; do
            echo -e "  ${RED}•${NC} $failure"
        done
        echo ""
        echo -e "${RED}⚠️  IMPORTANT: Some components failed to install!${NC}"
        echo -e "${RED}   The system may not work fully until these issues are resolved.${NC}"
        if [[ "$INSIDE_CN" == true && "$PROXY_WORKING" == false ]]; then
            echo -e "${YELLOW}   Hint: External repository access is blocked. Try:${NC}"
            echo -e "${YELLOW}   1. Configure your proxy settings${NC}"
            echo -e "${YELLOW}   2. Run installer from outside corporate network${NC}"
        fi
    fi

    echo ""
    echo -e "${CYAN}📋 Next steps:${NC}"
    echo -e "   ${CYAN}⚡ To start using commands immediately:${NC} source .activate"
    echo -e "   ${CYAN}📖 Commands available:${NC} vkb (View Knowledge Base)"

    if [[ ${#INSTALLATION_FAILURES[@]} -eq 0 ]]; then
        echo ""
        echo -e "${GREEN}Happy knowledge capturing! 🧠${NC}"
    fi
}

# Install Enhanced Live Session Logging system
install_enhanced_lsl() {
    echo -e "\n${CYAN}📝 Installing Enhanced LSL system...${NC}"

    # Run LSL deployment script
    if [[ -x "$CODING_REPO/scripts/deploy-enhanced-lsl.sh" ]]; then
        info "Running Enhanced LSL deployment..."
        "$CODING_REPO/scripts/deploy-enhanced-lsl.sh" --skip-tests || warning "Enhanced LSL installation had warnings"
        success "Enhanced LSL system installed"
    else
        warning "Enhanced LSL deployment script not found or not executable"
    fi
}

# Install slash commands from .specstory/commands to global Claude commands folder
install_slash_commands() {
    echo -e "\n${CYAN}📝 Installing Claude slash commands...${NC}"

    local commands_source="$CODING_REPO/.specstory/commands"
    local commands_target="$HOME/.claude/commands"

    # Create global commands directory if it doesn't exist
    mkdir -p "$commands_target"

    # Check if source directory exists and has commands
    if [[ -d "$commands_source" ]]; then
        local command_count=0
        for cmd_file in "$commands_source"/*.md; do
            if [[ -f "$cmd_file" ]]; then
                local cmd_name=$(basename "$cmd_file")
                cp "$cmd_file" "$commands_target/$cmd_name"
                ((command_count++))
                info "Installed slash command: /${cmd_name%.md}"
            fi
        done

        if [[ $command_count -gt 0 ]]; then
            success "Installed $command_count slash command(s) to $commands_target"
        else
            info "No slash commands found in $commands_source"
        fi
    else
        info "No .specstory/commands directory found (skipping slash commands)"
    fi
}

# Create project-local settings for the coding repo itself
create_project_local_settings() {
    echo -e "\n${CYAN}📝 Creating Project-Local Settings...${NC}"

    local project_settings_dir="$CODING_REPO/.claude"
    local project_settings_file="$project_settings_dir/settings.local.json"

    # Create .claude directory if needed
    mkdir -p "$project_settings_dir"

    # Create settings.local.json with platform-specific paths
    cat > "$project_settings_file" << 'EOF'
{
  "permissions": {
    "allow": [
      "Bash(npm run api:*)",
      "mcp__serena__find_symbol",
      "mcp__serena__search_for_pattern",
      "Bash(TRANSCRIPT_DEBUG=true node scripts/enhanced-transcript-monitor.js --test)",
      "Bash(node:*)",
      "Bash(plantuml:*)",
      "mcp__serena__check_onboarding_performed",
      "Bash(bin/coding:*)",
      "Bash(cp:*)",
      "mcp__serena__find_file",
      "mcp__serena__replace_symbol_body",
      "mcp__serena__activate_project",
      "mcp__serena__get_symbols_overview",
      "Bash(cat:*)",
      "Bash(timeout:*)",
      "Bash(watch:*)",
      "mcp__serena__list_dir",
      "mcp__serena__insert_after_symbol",
      "Bash(find:*)",
      "Bash(CODING_REPO=CODING_REPO_PLACEHOLDER node CODING_REPO_PLACEHOLDER/scripts/combined-status-line.js)",
      "Bash(kill:*)",
      "Bash(pkill:*)",
      "Bash(grep:*)",
      "Bash(lsof:*)",
      "Bash(curl:*)",
      "Bash(PORT=3030 npm run dev)",
      "mcp__serena__insert_before_symbol",
      "mcp__constraint-monitor__check_constraints",
      "Bash(npm start)",
      "Bash(git rm:*)",
      "Bash(npm run:*)",
      "Bash(chmod:*)",
      "Bash(./test-individual-constraints.sh:*)",
      "Bash(docker stop:*)",
      "Bash(docker rm:*)",
      "Bash(docker-compose up:*)",
      "Bash(docker logs:*)",
      "Bash(docker restart:*)",
      "Bash(PORT=3031 npm run api)",
      "Bash(git checkout:*)",
      "Bash(xargs kill:*)",
      "mcp__mcp-git-ingest__git_directory_structure",
      "mcp__mcp-git-ingest__git_read_important_files",
      "WebSearch",
      "Bash(git remote get-url:*)",
      "Bash(basename:*)",
      "mcp__spec-workflow__spec-workflow-guide",
      "mcp__spec-workflow__approvals",
      "Bash(PORT=3030 npm run dashboard)",
      "Bash(sort:*)",
      "mcp__serena__think_about_task_adherence",
      "Bash(awk:*)",
      "Bash(PORT=3031 node src/dashboard-server.js)",
      "mcp__serena__onboarding",
      "mcp__serena__write_memory",
      "Bash(jq:*)",
      "mcp__serena__think_about_collected_information",
      "mcp__serena__get_current_config",
      "Bash(npm install:*)",
      "Read(//USER_HOME_PLACEHOLDER/.claude/**)",
      "WebFetch(domain:console.groq.com)",
      "Read(//private/tmp/**)",
      "Bash(./collect-test-results.js)",
      "WebFetch(domain:github.com)",
      "Bash(sqlite3 .data/knowledge.db \"SELECT source, COUNT(*) as count FROM knowledge_extractions GROUP BY source\")",
      "Bash(sqlite3 .data/knowledge.db \"PRAGMA table_info(knowledge_extractions)\")",
      "Bash(vkb restart:*)",
      "Bash(bin/vkb restart:*)",
      "Bash(ps:*)",
      "Bash(git submodule:*)",
      "mcp__serena__find_referencing_symbols",
      "Bash(git config:*)",
      "Bash(git restore:*)",
      "Bash(git diff:*)",
      "Bash(xargs -I {} git restore --source=HEAD {})",
      "WebFetch(domain:claude.ai)",
      "mcp__constraint-monitor__get_constraint_status",
      "Bash(for coll in ontology-coding ontology-raas ontology-resi ontology-agentic ontology-ui)",
      "Bash(do echo -n \"$coll: \")",
      "Bash(done)",
      "Bash(npm test:*)",
      "Bash(docker info:*)",
      "Bash(bin/vkb:*)",
      "Bash(SYSTEM_HEALTH_API_PORT=3033 pnpm api:*)",
      "mcp__serena__initial_instructions",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(rm:*)",
      "Bash(npm view:*)",
      "Bash(while read name)",
      "Bash(do [ ! -f \"docs/presentation/images/$name.png\" ])",
      "Bash(echo:*)",
      "Bash(git fetch:*)"
    ],
    "deny": [],
    "ask": []
  },
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node CODING_REPO_PLACEHOLDER/integrations/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node CODING_REPO_PLACEHOLDER/integrations/mcp-constraint-monitor/src/hooks/pre-tool-hook-wrapper.js"
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "CODING_REPO=CODING_REPO_PLACEHOLDER node CODING_REPO_PLACEHOLDER/scripts/combined-status-line.js"
  }
}
EOF

    # Replace placeholders with actual paths
    sed -i.bak "s|CODING_REPO_PLACEHOLDER|$CODING_REPO|g" "$project_settings_file"
    sed -i.bak "s|USER_HOME_PLACEHOLDER|$HOME|g" "$project_settings_file"
    rm -f "$project_settings_file.bak"

    success "Created .claude/settings.local.json with platform-specific paths"
}

# Install constraint monitor hooks and LSL logging hooks
install_constraint_monitor_hooks() {
    echo -e "\n${CYAN}🔗 Installing Hooks (Constraints + LSL)...${NC}"

    # SANDBOX MODE: Skip global hooks installation
    if [[ "$SANDBOX_MODE" == "true" ]]; then
        warning "SANDBOX MODE: Skipping global hooks installation (~/.claude/settings.json)"
        info "Hooks will NOT be active in sandbox mode"
        info "To use hooks, install from the primary coding installation"
        return 0
    fi

    # NODE.JS HEALTH CHECK: Verify Node.js works before installing hooks
    # This prevents broken hooks from crashing Claude if Node.js has library issues
    # (e.g., Homebrew simdjson/libuv version mismatch)
    info "Verifying Node.js health before hook installation..."
    local node_test_output
    if ! node_test_output=$(node -e "console.log('ok')" 2>&1); then
        echo ""
        echo -e "${RED}╔══════════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║                                                                      ║${NC}"
        echo -e "${RED}║              ⚠️  NODE.JS HEALTH CHECK FAILED ⚠️                       ║${NC}"
        echo -e "${RED}║                                                                      ║${NC}"
        echo -e "${RED}╚══════════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${YELLOW}Node.js failed to execute. This is often caused by Homebrew library${NC}"
        echo -e "${YELLOW}version mismatches (e.g., simdjson, libuv).${NC}"
        echo ""
        echo -e "${CYAN}Error output:${NC}"
        echo "$node_test_output" | head -5
        echo ""
        echo -e "${CYAN}Common causes and fixes:${NC}"
        echo -e "  ${GREEN}1.${NC} Library mismatch after Homebrew update - try: brew upgrade"
        echo -e "  ${GREEN}2.${NC} Use nvm for isolated Node management: nvm install --lts && nvm use --lts"
        echo -e "  ${GREEN}3.${NC} Check if libsimdjson needs linking: brew link simdjson"
        echo ""
        echo -e "${RED}IMPORTANT:${NC} This installer will NOT attempt to fix your Node installation."
        echo ""
        warning "SKIPPING hook installation to prevent Claude from crashing"
        warning "Please fix Node.js manually, then re-run: ./install.sh"
        INSTALLATION_WARNINGS+=("Hooks: Skipped - Node.js health check failed")
        return 1
    fi
    success "Node.js health check passed"

    local settings_file="$HOME/.claude/settings.json"
    local pre_hook_cmd="node $CODING_REPO/integrations/mcp-constraint-monitor/src/hooks/pre-tool-hook-wrapper.js"
    local post_hook_cmd="node $CODING_REPO/scripts/tool-interaction-hook-wrapper.js"
    local prompt_hook_cmd="node $CODING_REPO/scripts/health-prompt-hook.js"
    local status_line_cmd="node $CODING_REPO/scripts/combined-status-line-wrapper.js"

    # Create .claude directory if it doesn't exist
    mkdir -p "$HOME/.claude"

    # Check if jq is available for JSON manipulation
    if ! command -v jq >/dev/null 2>&1; then
        warning "jq not found - attempting manual JSON configuration"

        # Create settings file if it doesn't exist
        if [[ ! -f "$settings_file" ]]; then
            cat > "$settings_file" << EOF
{
  "\$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "$pre_hook_cmd"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "$post_hook_cmd"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$prompt_hook_cmd",
            "timeout": 5
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "$status_line_cmd"
  }
}
EOF
            success "Created new settings file with hooks and status line"
            return 0
        else
            warning "Cannot merge hooks without jq - please install jq and run installer again"
            INSTALLATION_WARNINGS+=("Hooks: Not installed - jq required for merge")
            return 1
        fi
    fi

    # Backup existing settings
    if [[ -f "$settings_file" ]]; then
        local backup_file="${settings_file}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$settings_file" "$backup_file"
        info "Backed up existing settings to: $backup_file"
    else
        # Create new settings file
        echo '{"$schema": "https://json.schemastore.org/claude-code-settings.json"}' > "$settings_file"
    fi

    # Use jq to add or update hooks
    local temp_file=$(mktemp)

    # Check if EXACT hooks already exist with correct paths
    local pre_exists=$(jq -e --arg cmd "$pre_hook_cmd" '.hooks.PreToolUse[]? | select(.hooks[]?.command == $cmd)' "$settings_file" 2>/dev/null && echo "yes" || echo "no")
    local post_exists=$(jq -e --arg cmd "$post_hook_cmd" '.hooks.PostToolUse[]? | select(.hooks[]?.command == $cmd)' "$settings_file" 2>/dev/null && echo "yes" || echo "no")

    if [[ "$pre_exists" == "yes" ]] && [[ "$post_exists" == "yes" ]]; then
        info "Both PreToolUse and PostToolUse hooks already installed with correct paths"
        return 0
    fi

    # IMPORTANT: Remove any old hook entries (duplicates or wrong paths) before adding new ones
    # This ensures clean state and prevents accumulation of stale hooks
    jq --arg pre_cmd "$pre_hook_cmd" --arg post_cmd "$post_hook_cmd" --arg prompt_cmd "$prompt_hook_cmd" --arg status_line_cmd "$status_line_cmd" '
        # Remove ALL existing PreToolUse hooks that match the wrapper script (regardless of path)
        .hooks.PreToolUse = (
            if .hooks.PreToolUse then
                [.hooks.PreToolUse[] | select(.hooks[]?.command | contains("pre-tool-hook-wrapper.js") | not)]
            else
                []
            end
        ) |
        # Remove ALL existing PostToolUse hooks that match the wrapper script (regardless of path)
        .hooks.PostToolUse = (
            if .hooks.PostToolUse then
                [.hooks.PostToolUse[] | select(.hooks[]?.command | contains("tool-interaction-hook-wrapper.js") | not)]
            else
                []
            end
        ) |
        # Remove ALL existing UserPromptSubmit hooks that match health-prompt-hook (regardless of path)
        .hooks.UserPromptSubmit = (
            if .hooks.UserPromptSubmit then
                [.hooks.UserPromptSubmit[] | select(.hooks[]?.command | contains("health-prompt-hook.js") | not)]
            else
                []
            end
        ) |
        # Add the new hooks with correct paths (only ONE instance of each)
        .hooks.PreToolUse += [{
            "matcher": "*",
            "hooks": [{
                "type": "command",
                "command": $pre_cmd
            }]
        }] |
        .hooks.PostToolUse += [{
            "matcher": "*",
            "hooks": [{
                "type": "command",
                "command": $post_cmd
            }]
        }] |
        .hooks.UserPromptSubmit += [{
            "hooks": [{
                "type": "command",
                "command": $prompt_cmd,
                "timeout": 5
            }]
        }] |
        # Set up status line (replaces any existing statusLine)
        .statusLine = {
            "type": "command",
            "command": $status_line_cmd
        }
    ' "$settings_file" > "$temp_file"

    # Validate JSON
    if jq empty "$temp_file" 2>/dev/null; then
        mv "$temp_file" "$settings_file"
        success "Hooks and status line installed to ~/.claude/settings.json"
        info "  - PreToolUse: Constraint monitoring (blocks violations)"
        info "  - PostToolUse: LSL logging (captures interactions)"
        info "  - UserPromptSubmit: System health verification"
        info "  - StatusLine: Real-time system status display"
    else
        rm -f "$temp_file"
        warning "Failed to update settings file - JSON validation failed"
        INSTALLATION_WARNINGS+=("Hooks: Installation failed - JSON error")
        return 1
    fi
}

# Run main function
main "$@"
