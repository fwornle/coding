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

# Platform detection
PLATFORM=""
SHELL_RC=""
detect_platform() {
    case "$(uname -s)" in
        Darwin*)
            PLATFORM="macos"
            SHELL_RC="$HOME/.zshrc"
            ;;
        Linux*)
            PLATFORM="linux"
            SHELL_RC="$HOME/.bashrc"
            ;;
        MINGW*|CYGWIN*|MSYS*)
            PLATFORM="windows"
            SHELL_RC="$HOME/.bashrc"
            ;;
        *)
            echo -e "${RED}Unsupported platform: $(uname -s)${NC}"
            exit 1
            ;;
    esac
    
    # Check for alternative shell configs
    if [[ -f "$HOME/.bash_profile" ]] && [[ ! -f "$SHELL_RC" ]]; then
        SHELL_RC="$HOME/.bash_profile"
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
            error_exit "Failed to install uv. Serena MCP server will not be available."
        fi
    else
        success "uv is already installed"
    fi
    
    # Platform-specific checks
    if [[ "$PLATFORM" == "macos" ]]; then
        if ! command -v brew >/dev/null 2>&1; then
            warning "Homebrew not found. Some installations may require manual setup."
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

    if [[ -d "$MEMORY_VISUALIZER_DIR/.git" ]]; then
        info "Memory visualizer submodule already exists, updating..."
        cd "$MEMORY_VISUALIZER_DIR"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "Memory visualizer updated"
        else
            warning "Could not update memory-visualizer, using existing version"
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
    info "Installing browserbase dependencies (includes stagehand)..."
    npm install --ignore-scripts || error_exit "Failed to install browserbase dependencies"

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

    if [[ -d "$SEMANTIC_ANALYSIS_DIR/.git" ]]; then
        info "mcp-server-semantic-analysis submodule already exists, updating..."
        cd "$SEMANTIC_ANALYSIS_DIR"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "mcp-server-semantic-analysis updated"
        else
            warning "Could not update mcp-server-semantic-analysis, using existing version"
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

    # Install or update Serena submodule
    if [[ -d "$serena_dir/.git" ]]; then
        info "Serena submodule already exists, updating..."
        cd "$serena_dir"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "Serena updated from repository"
        else
            warning "Could not update Serena, using existing version"
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

    # Initialize or update submodule
    if [[ -d "$constraint_monitor_dir/.git" ]]; then
        info "mcp-constraint-monitor submodule already exists, updating..."
        cd "$constraint_monitor_dir"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "mcp-constraint-monitor updated"
        else
            warning "Could not update mcp-constraint-monitor, using existing version"
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
    
    # Install browser-access (Stagehand)
    if [[ -d "$CODING_REPO/integrations/browser-access" ]]; then
        info "Installing browser-access MCP server..."
        cd "$CODING_REPO/integrations/browser-access"
        npm install || error_exit "Failed to install browser-access dependencies"
        npm run build || error_exit "Failed to build browser-access"
        chmod +x dist/index.js 2>/dev/null || true
        success "Browser-access MCP server installed"
    else
        warning "browser-access directory not found, skipping..."
    fi
}

# Create universal command wrappers
create_command_wrappers() {
    echo -e "\n${CYAN}🔧 Creating command wrappers...${NC}"
    
    local bin_dir="$CODING_REPO/bin"
    mkdir -p "$bin_dir"
    
    # Create ukb wrapper
    cat > "$bin_dir/ukb" << 'EOF'
#!/bin/bash
# Universal ukb wrapper
CODING_REPO="$(cd "$(dirname "$(dirname "${BASH_SOURCE[0]}")")" && pwd)"
export CODING_REPO
exec "$CODING_REPO/knowledge-management/ukb" "$@"
EOF
    chmod +x "$bin_dir/ukb"
    
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
            sed -i.bak '/alias ukb=/d' "$config_file" 2>/dev/null || true
            sed -i.bak '/alias vkb=/d' "$config_file" 2>/dev/null || true
            sed -i.bak '/alias claude-mcp=/d' "$config_file" 2>/dev/null || true
            sed -i.bak '/unalias ukb/d' "$config_file" 2>/dev/null || true
            sed -i.bak '/unalias vkb/d' "$config_file" 2>/dev/null || true
            # Remove old CODING_REPO/CLAUDE_REPO exports
            sed -i.bak '/CLAUDE_REPO.*Claude/d' "$config_file" 2>/dev/null || true
            sed -i.bak '/CODING_REPO.*coding/d' "$config_file" 2>/dev/null || true
        fi
    done
    
    # Clean up old wrapper scripts in ~/bin that point to wrong paths
    local wrapper_scripts=("$HOME/bin/ukb" "$HOME/bin/vkb" "$HOME/bin/claude-mcp")
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
    
    # Check if already configured
    if grep -q "CODING_REPO.*$CODING_REPO" "$SHELL_RC" 2>/dev/null && grep -q "PATH.*$CODING_REPO/bin" "$SHELL_RC" 2>/dev/null; then
        info "Shell already configured with correct paths"
    else
        # Remove any existing Claude configurations to prevent duplicates
        if [[ -f "$SHELL_RC.bak" ]]; then
            rm -f "$SHELL_RC.bak"
        fi
        # Remove existing Claude sections
        sed -i.bak '/# Claude Knowledge Management System/,/^$/d' "$SHELL_RC" 2>/dev/null || true
        
        # Add configuration
        {
            echo ""
            echo "# Claude Knowledge Management System"
            echo "$claude_repo_export"
            echo "$claude_path_export"
            echo ""
        } >> "$SHELL_RC"
    fi
    
    # Also update .bash_profile on macOS since it's commonly used
    if [[ "$PLATFORM" == "macos" ]] && [[ -f "$HOME/.bash_profile" ]]; then
        if ! grep -q "CODING_REPO.*$CODING_REPO" "$HOME/.bash_profile" 2>/dev/null || ! grep -q "PATH.*$CODING_REPO/bin" "$HOME/.bash_profile" 2>/dev/null; then
            # Remove existing Claude sections from .bash_profile too
            sed -i.bak '/# Claude Knowledge Management System/,/^$/d' "$HOME/.bash_profile" 2>/dev/null || true
            {
                echo ""
                echo "# Claude Knowledge Management System"
                echo "$claude_repo_export"
                echo "$claude_path_export"
                echo ""
            } >> "$HOME/.bash_profile"
        fi
    fi
    
    # Create a cleanup script for the current shell session
    mkdir -p "$CODING_REPO/scripts"
    cat > "$CODING_REPO/scripts/cleanup-aliases.sh" << 'EOF'
#!/bin/bash
# Cleanup aliases from current shell session
unalias ukb 2>/dev/null || true
unalias vkb 2>/dev/null || true
unalias claude-mcp 2>/dev/null || true
unset -f ukb 2>/dev/null || true
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
    sed -i.bak "s|{{KNOWLEDGE_BASE_PATH}}|${KNOWLEDGE_BASE_PATH:-$CODING_REPO/knowledge-management/insights}|g" "$temp_file"
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

# Initialize shared memory - DEPRECATED (v2.0+)
# Knowledge is now managed by GraphDB (Graphology + LevelDB) with exports to .data/knowledge-export/
# This function is kept for backward compatibility but does nothing
initialize_shared_memory() {
    echo -e "\n${CYAN}📝 Initializing knowledge management...${NC}"

    # The initialize-knowledge-system.js script already initializes GraphDB
    # and creates .data/knowledge-export/*.json files
    info "Knowledge management is handled by GraphDB (see .data/knowledge-graph/)"
    info "Team-specific exports available at .data/knowledge-export/*.json"
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
    fi
    
    success "Example configuration files created"
}

# Verify installation
verify_installation() {
    echo -e "\n${CYAN}🔍 Verifying installation...${NC}"
    
    local errors=0
    
    # Check ukb and vkb commands
    if [[ -x "$CODING_REPO/bin/ukb" ]]; then
        success "ukb command is available"
    else
        error_exit "ukb command not found or not executable"
        ((errors++))
    fi
    
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

    # Add to shell environment (only if not already configured)
    if grep -q "export CODING_TEAM=" "$SHELL_RC" 2>/dev/null; then
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
    
    case "$PLATFORM" in
        macos)
            if command -v brew >/dev/null 2>&1; then
                info "Installing PlantUML via Homebrew..."
                if brew install plantuml; then
                    success "✓ PlantUML installed via Homebrew"
                else
                    warning "Failed to install PlantUML via Homebrew, trying JAR fallback..."
                    install_plantuml_jar
                fi
            else
                warning "Homebrew not found, trying JAR fallback..."
                install_plantuml_jar
            fi
            ;;
        linux)
            # Try package managers in order of preference
            if command -v apt-get >/dev/null 2>&1; then
                info "Installing PlantUML via apt-get..."
                if sudo apt-get update && sudo apt-get install -y plantuml; then
                    success "✓ PlantUML installed via apt-get"
                else
                    warning "Failed to install PlantUML via apt-get, trying JAR fallback..."
                    install_plantuml_jar
                fi
            elif command -v yum >/dev/null 2>&1; then
                info "Installing PlantUML via yum..."
                if sudo yum install -y plantuml; then
                    success "✓ PlantUML installed via yum"
                else
                    warning "Failed to install PlantUML via yum, trying JAR fallback..."
                    install_plantuml_jar
                fi
            elif command -v pacman >/dev/null 2>&1; then
                info "Installing PlantUML via pacman..."
                if sudo pacman -S --noconfirm plantuml; then
                    success "✓ PlantUML installed via pacman"
                else
                    warning "Failed to install PlantUML via pacman, trying JAR fallback..."
                    install_plantuml_jar
                fi
            else
                warning "No supported package manager found, trying JAR fallback..."
                install_plantuml_jar
            fi
            ;;
        windows)
            warning "Windows detected, trying JAR fallback..."
            install_plantuml_jar
            ;;
        *)
            warning "Unknown platform, trying JAR fallback..."
            install_plantuml_jar
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
    
    # Run installation steps
    check_dependencies
    detect_agents
    configure_team_setup
    install_node_dependencies
    initialize_knowledge_databases
    install_plantuml
    detect_network_and_set_repos
    test_proxy_connectivity
    install_memory_visualizer
    install_browserbase
    install_semantic_analysis
    install_serena
    install_constraint_monitor
    install_shadcn_mcp
    install_mcp_servers
    create_command_wrappers
    setup_unified_launcher
    configure_shell_environment
    initialize_shared_memory
    create_example_configs
    setup_mcp_config
    setup_vscode_extension
    install_enhanced_lsl
    install_constraint_monitor_hooks
    verify_installation
    
    # Create activation script for immediate use
    cat > "$CODING_REPO/.activate" << EOF
#!/bin/bash
# Activate Agent-Agnostic Coding Tools environment
export CODING_REPO="$CODING_REPO"
export PATH="$CODING_REPO/bin:\$PATH"
echo "✅ Agent-Agnostic Coding Tools environment activated!"
echo "Commands 'ukb', 'vkb', and 'coding' are now available."
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
    echo -e "   ${CYAN}📖 Commands available:${NC} ukb (Update Knowledge Base), vkb (View Knowledge Base)"
    
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

# Install constraint monitor hooks and LSL logging hooks
install_constraint_monitor_hooks() {
    echo -e "\n${CYAN}🔗 Installing Hooks (Constraints + LSL)...${NC}"

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
