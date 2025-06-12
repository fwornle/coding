#!/bin/bash
# Claude Knowledge Management System - Universal Installation Script
# Supports: macOS, Linux, Windows (via WSL/Git Bash)
# Version: 1.0.0

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
MEMORY_VISUALIZER_DIR="$CLAUDE_REPO/memory-visualizer"

BROWSERBASE_REPO_SSH=""
BROWSERBASE_REPO_HTTPS=""
BROWSERBASE_DIR="$CLAUDE_REPO/mcp-server-browserbase"

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
        BROWSERBASE_REPO_SSH="$BROWSERBASE_SSH"
        BROWSERBASE_REPO_HTTPS="$BROWSERBASE_HTTPS"
    fi
    
    # Log selected repositories
    info "Selected repositories:"
    info "  Memory Visualizer: $(echo "$MEMORY_VISUALIZER_REPO_SSH" | sed 's/git@//' | sed 's/.git$//')"
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
                echo "  - Then run: brew install git node python3 jq"
                ;;
            linux)
                echo "  - Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y git nodejs npm python3 python3-pip jq"
                echo "  - RHEL/CentOS: sudo yum install -y git nodejs npm python3 python3-pip jq"
                echo "  - Arch: sudo pacman -S git nodejs npm python python-pip jq"
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

# Install memory-visualizer
install_memory_visualizer() {
    echo -e "\n${CYAN}📊 Installing memory-visualizer...${NC}"
    
    if [[ -d "$MEMORY_VISUALIZER_DIR" ]]; then
        info "Memory visualizer already exists, updating..."
        cd "$MEMORY_VISUALIZER_DIR"
        
        # Simple update - no remote manipulation
        info "Updating from current remote: $(git remote get-url origin 2>/dev/null || echo 'unknown')"
        if timeout 10s git pull origin main 2>/dev/null; then
            success "Memory visualizer updated"
        else
            warning "Could not update memory-visualizer, using existing version"
        fi
    else
        info "Cloning memory-visualizer repository..."
        clone_repository "$MEMORY_VISUALIZER_REPO_SSH" "$MEMORY_VISUALIZER_REPO_HTTPS" "$MEMORY_VISUALIZER_DIR"
    fi
    
    cd "$MEMORY_VISUALIZER_DIR"
    
    # Install dependencies
    info "Installing memory-visualizer dependencies..."
    npm install || error_exit "Failed to install memory-visualizer dependencies"
    
    # Build the visualizer
    info "Building memory-visualizer..."
    npm run build || error_exit "Failed to build memory-visualizer"
    
    # Update vkb script to use local memory-visualizer
    sed -i "s|VISUALIZER_DIR=.*|VISUALIZER_DIR=\"$MEMORY_VISUALIZER_DIR\"|" "$CLAUDE_REPO/knowledge-management/vkb"
    
    success "Memory visualizer installed successfully"
}

# Install mcp-server-browserbase
install_browserbase() {
    echo -e "\n${CYAN}🌐 Installing mcp-server-browserbase...${NC}"
    
    # Handle differently based on network location
    if [[ "$INSIDE_CN" == true ]]; then
        # Inside CN - use special handling for non-mirrored repo
        handle_non_mirrored_repo_cn "mcp-server-browserbase" "$BROWSERBASE_REPO_SSH" "$BROWSERBASE_REPO_HTTPS" "$BROWSERBASE_DIR"
        local clone_result=$?
    else
        # Outside CN - normal clone/update
        if [[ -d "$BROWSERBASE_DIR" ]]; then
            info "mcp-server-browserbase already exists, updating..."
            cd "$BROWSERBASE_DIR"
            if timeout 10s git pull origin main 2>/dev/null; then
                success "mcp-server-browserbase updated"
            else
                warning "Could not update mcp-server-browserbase"
            fi
        else
            info "Cloning mcp-server-browserbase repository..."
            clone_repository "$BROWSERBASE_REPO_SSH" "$BROWSERBASE_REPO_HTTPS" "$BROWSERBASE_DIR"
            local clone_result=$?
        fi
    fi
    
    # Only proceed with build if we have the repository
    if [[ -d "$BROWSERBASE_DIR/stagehand" ]]; then
        info "Installing stagehand dependencies..."
        cd "$BROWSERBASE_DIR/stagehand"
        npm install || warning "Failed to install stagehand dependencies"
        npm run build || warning "Failed to build stagehand"
        success "Stagehand (browserbase) installed successfully"
    else
        warning "Browserbase repository not available - skipping stagehand build"
    fi
    
    cd "$CLAUDE_REPO"
}

# Install MCP servers
install_mcp_servers() {
    echo -e "\n${CYAN}🔌 Installing MCP servers...${NC}"
    
    # Install browser-access (Stagehand)
    if [[ -d "$CLAUDE_REPO/browser-access" ]]; then
        info "Installing browser-access MCP server..."
        cd "$CLAUDE_REPO/browser-access"
        npm install || error_exit "Failed to install browser-access dependencies"
        npm run build || error_exit "Failed to build browser-access"
        chmod +x dist/index.js 2>/dev/null || true
        success "Browser-access MCP server installed"
    else
        warning "browser-access directory not found, skipping..."
    fi
    
    # Install claude-logger MCP server
    if [[ -d "$CLAUDE_REPO/claude-logger-mcp" ]]; then
        info "Installing claude-logger MCP server..."
        cd "$CLAUDE_REPO/claude-logger-mcp"
        npm install || error_exit "Failed to install claude-logger dependencies"
        npm run build || error_exit "Failed to build claude-logger"
        success "Claude-logger MCP server installed"
    else
        warning "claude-logger-mcp directory not found, skipping..."
    fi
}

# Create universal command wrappers
create_command_wrappers() {
    echo -e "\n${CYAN}🔧 Creating command wrappers...${NC}"
    
    local bin_dir="$CLAUDE_REPO/bin"
    mkdir -p "$bin_dir"
    
    # Create ukb wrapper
    cat > "$bin_dir/ukb" << 'EOF'
#!/bin/bash
# Universal ukb wrapper
CLAUDE_REPO="$(cd "$(dirname "$(dirname "${BASH_SOURCE[0]}")")" && pwd)"
exec "$CLAUDE_REPO/knowledge-management/ukb" "$@"
EOF
    chmod +x "$bin_dir/ukb"
    
    # Create vkb wrapper
    cat > "$bin_dir/vkb" << 'EOF'
#!/bin/bash
# Universal vkb wrapper
CLAUDE_REPO="$(cd "$(dirname "$(dirname "${BASH_SOURCE[0]}")")" && pwd)"
exec "$CLAUDE_REPO/knowledge-management/vkb" "$@"
EOF
    chmod +x "$bin_dir/vkb"
    
    # Note: Original scripts now use dynamic repo detection, no need to update paths
    
    success "Command wrappers created"
}

# Configure shell environment
configure_shell_environment() {
    echo -e "\n${CYAN}🐚 Configuring shell environment...${NC}"
    
    local claude_path_export="export PATH=\"$CLAUDE_REPO/bin:\$PATH\""
    local claude_repo_export="export CLAUDE_REPO=\"$CLAUDE_REPO\""
    
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
            # Remove old CLAUDE_REPO exports
            sed -i.bak '/CLAUDE_REPO.*Claude/d' "$config_file" 2>/dev/null || true
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
exec $CLAUDE_REPO/knowledge-management/$script_name "\$@"
EOF
            chmod +x "$wrapper"
        fi
    done
    
    # Check if already configured
    if grep -q "CLAUDE_REPO.*$CLAUDE_REPO" "$SHELL_RC" 2>/dev/null; then
        info "Shell already configured with correct paths"
    else
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
        if ! grep -q "CLAUDE_REPO.*$CLAUDE_REPO" "$HOME/.bash_profile" 2>/dev/null; then
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
    cat > "$CLAUDE_REPO/.cleanup-aliases.sh" << 'EOF'
#!/bin/bash
# Cleanup aliases from current shell session
unalias ukb 2>/dev/null || true
unalias vkb 2>/dev/null || true
unalias claude-mcp 2>/dev/null || true
unset -f ukb 2>/dev/null || true
unset -f vkb 2>/dev/null || true
unset -f claude-mcp 2>/dev/null || true
EOF
    chmod +x "$CLAUDE_REPO/.cleanup-aliases.sh"
    
    success "Shell environment configured and old aliases removed"
    info "If you still see old aliases, run: source $CLAUDE_REPO/.cleanup-aliases.sh"
}

# Setup MCP configuration
setup_mcp_config() {
    echo -e "\n${CYAN}⚙️  Setting up MCP configuration...${NC}"
    
    # Check if template file exists
    if [[ ! -f "$CLAUDE_REPO/claude-code-mcp.json" ]]; then
        warning "claude-code-mcp.json template not found, skipping MCP configuration..."
        return
    fi
    
    # Check if .env file exists and source it
    if [[ -f "$CLAUDE_REPO/.env" ]]; then
        info "Loading environment variables from .env file..."
        set -a
        source "$CLAUDE_REPO/.env"
        set +a
    else
        warning ".env file not found. Using empty API keys - please configure them later."
    fi
    
    # Note: Original template is preserved as claude-code-mcp.json
    
    # Replace placeholders in the template
    local temp_file=$(mktemp)
    cp "$CLAUDE_REPO/claude-code-mcp.json" "$temp_file"
    
    # Replace environment variables - use the actual CLAUDE_REPO path
    sed -i.bak "s|{{CLAUDE_PROJECT_PATH}}|$CLAUDE_REPO|g" "$temp_file"
    sed -i.bak "s|{{LOCAL_CDP_URL}}|${LOCAL_CDP_URL:-ws://localhost:9222}|g" "$temp_file"
    sed -i.bak "s|{{ANTHROPIC_API_KEY}}|${ANTHROPIC_API_KEY:-}|g" "$temp_file"
    
    # Save the processed version locally
    cp "$temp_file" "$CLAUDE_REPO/claude-code-mcp-processed.json"
    info "Processed configuration saved to: claude-code-mcp-processed.json"
    
    # Copy to user's Claude configuration directory
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
        success "MCP configuration installed to Claude app at: $claude_config_dir/claude-code-mcp.json"
    else
        warning "Claude configuration directory not found at: $claude_config_dir"
        warning "Please manually copy claude-code-mcp-processed.json to your Claude configuration directory."
    fi
    
    # Clean up
    rm -f "$temp_file"
    
    success "MCP configuration setup completed"
}

# Initialize shared memory
initialize_shared_memory() {
    echo -e "\n${CYAN}📝 Initializing shared memory...${NC}"
    
    if [[ ! -f "$CLAUDE_REPO/shared-memory.json" ]]; then
        info "Creating initial shared-memory.json..."
        cat > "$CLAUDE_REPO/shared-memory.json" << 'EOF'
{
  "entities": [],
  "relations": [],
  "metadata": {
    "version": "1.0.0",
    "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "contributors": [],
    "total_entities": 0,
    "total_relations": 0
  }
}
EOF
        success "Shared memory initialized"
    else
        info "Shared memory already exists"
    fi
    
    # Ensure proper permissions
    chmod 644 "$CLAUDE_REPO/shared-memory.json"
}

# Create example configuration files
create_example_configs() {
    echo -e "\n${CYAN}📄 Creating example configuration files...${NC}"
    
    # Create .env.example for MCP servers
    cat > "$CLAUDE_REPO/.env.example" << 'EOF'
# Claude Knowledge Management System - Environment Variables

# For browser-access MCP server (optional)
ANTHROPIC_API_KEY=your-anthropic-api-key
BROWSERBASE_API_KEY=your-browserbase-api-key
BROWSERBASE_PROJECT_ID=your-project-id
LOCAL_CDP_URL=ws://localhost:9222

# Project path - will be set automatically by installer
CLAUDE_PROJECT_PATH=/path/to/coding/repo

# For claude-logger MCP server
# No specific environment variables required

# Custom paths (optional)
# CLAUDE_REPO=/path/to/coding/repo
# MEMORY_VISUALIZER_DIR=/path/to/memory-visualizer
EOF
    
    success "Example configuration files created"
}

# Verify installation
verify_installation() {
    echo -e "\n${CYAN}🔍 Verifying installation...${NC}"
    
    local errors=0
    
    # Check ukb and vkb commands
    if [[ -x "$CLAUDE_REPO/bin/ukb" ]]; then
        success "ukb command is available"
    else
        error_exit "ukb command not found or not executable"
        ((errors++))
    fi
    
    if [[ -x "$CLAUDE_REPO/bin/vkb" ]]; then
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
    if [[ -f "$CLAUDE_REPO/browser-access/dist/index.js" ]]; then
        success "Browser-access MCP server is built"
    else
        warning "Browser-access MCP server not built"
    fi
    
    if [[ -f "$CLAUDE_REPO/claude-logger-mcp/dist/index.js" ]]; then
        success "Claude-logger MCP server is built"
    else
        warning "Claude-logger MCP server not built"
    fi
    
    if [[ $errors -eq 0 ]]; then
        success "Installation verification passed!"
    else
        warning "Installation completed with warnings. Some features may not work correctly."
    fi
}

# Main installation flow
main() {
    echo -e "${PURPLE}🚀 Claude Knowledge Management System - Universal Installer${NC}"
    echo -e "${PURPLE}==========================================================${NC}"
    echo ""
    
    # Initialize log
    echo "Installation started at $(date)" > "$INSTALL_LOG"
    log "Platform: $(uname -s)"
    log "Claude repo: $CLAUDE_REPO"
    
    # Detect platform
    detect_platform
    info "Detected platform: $PLATFORM"
    info "Shell config file: $SHELL_RC"
    
    # Run installation steps
    check_dependencies
    detect_network_and_set_repos
    test_proxy_connectivity
    install_memory_visualizer
    install_browserbase
    install_mcp_servers
    create_command_wrappers
    configure_shell_environment
    initialize_shared_memory
    create_example_configs
    setup_mcp_config
    verify_installation
    
    # Create activation script for immediate use
    cat > "$CLAUDE_REPO/.activate" << EOF
#!/bin/bash
# Activate Claude Knowledge Management environment
export CLAUDE_REPO="$CLAUDE_REPO"
export PATH="$CLAUDE_REPO/bin:\$PATH"
echo "✅ Claude Knowledge Management environment activated!"
echo "Commands 'ukb' and 'vkb' are now available."
EOF
    chmod +x "$CLAUDE_REPO/.activate"
    
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

# Run main function
main "$@"