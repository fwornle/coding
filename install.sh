#!/bin/bash
# Claude Knowledge Management System - Universal Installation Script
# Supports: macOS, Linux, Windows (via WSL/Git Bash)
# Version: 1.0.0

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Installation configuration
CLAUDE_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_LOG="$CLAUDE_REPO/install.log"
MEMORY_VISUALIZER_REPO="https://github.com/modelcontextprotocol/memory-visualizer.git"
MEMORY_VISUALIZER_DIR="$CLAUDE_REPO/memory-visualizer"

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
        git pull origin main || warning "Could not update memory-visualizer"
    else
        info "Cloning memory-visualizer repository..."
        git clone "$MEMORY_VISUALIZER_REPO" "$MEMORY_VISUALIZER_DIR" || error_exit "Failed to clone memory-visualizer"
    fi
    
    cd "$MEMORY_VISUALIZER_DIR"
    
    # Install dependencies
    info "Installing memory-visualizer dependencies..."
    npm install || error_exit "Failed to install memory-visualizer dependencies"
    
    # Build the visualizer
    info "Building memory-visualizer..."
    npm run build || error_exit "Failed to build memory-visualizer"
    
    # Update vkb script to use local memory-visualizer
    sed -i.bak "s|VISUALIZER_DIR=.*|VISUALIZER_DIR=\"$MEMORY_VISUALIZER_DIR\"|" "$CLAUDE_REPO/knowledge-management/vkb"
    
    success "Memory visualizer installed successfully"
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
    
    # Update paths in the original scripts
    sed -i.bak "s|CLAUDE_REPO=.*|CLAUDE_REPO=\"$CLAUDE_REPO\"|" "$CLAUDE_REPO/knowledge-management/ukb"
    sed -i.bak "s|CLAUDE_REPO=.*|CLAUDE_REPO=\"$CLAUDE_REPO\"|" "$CLAUDE_REPO/knowledge-management/vkb"
    
    success "Command wrappers created"
}

# Configure shell environment
configure_shell_environment() {
    echo -e "\n${CYAN}🐚 Configuring shell environment...${NC}"
    
    local claude_path_export="export PATH=\"$CLAUDE_REPO/bin:\$PATH\""
    local claude_repo_export="export CLAUDE_REPO=\"$CLAUDE_REPO\""
    
    # Check if already configured
    if grep -q "CLAUDE_REPO" "$SHELL_RC" 2>/dev/null; then
        info "Shell already configured, updating paths..."
        # Update existing configuration
        sed -i.bak "/CLAUDE_REPO/d" "$SHELL_RC"
        sed -i.bak "/claude.*bin/d" "$SHELL_RC"
    fi
    
    # Add configuration
    {
        echo ""
        echo "# Claude Knowledge Management System"
        echo "$claude_repo_export"
        echo "$claude_path_export"
        echo ""
    } >> "$SHELL_RC"
    
    # For Windows, also update .bash_profile if it exists
    if [[ "$PLATFORM" == "windows" ]] && [[ -f "$HOME/.bash_profile" ]]; then
        if ! grep -q "CLAUDE_REPO" "$HOME/.bash_profile" 2>/dev/null; then
            {
                echo ""
                echo "# Claude Knowledge Management System"
                echo "$claude_repo_export"
                echo "$claude_path_export"
                echo ""
            } >> "$HOME/.bash_profile"
        fi
    fi
    
    success "Shell environment configured"
}

# Setup MCP configuration
setup_mcp_config() {
    echo -e "\n${CYAN}⚙️  Setting up MCP configuration...${NC}"
    
    # Check if .env file exists
    if [[ ! -f "$CLAUDE_REPO/.env" ]]; then
        warning ".env file not found. Please copy .env.example to .env and configure your API keys."
        return
    fi
    
    # Source the .env file
    set -a
    source "$CLAUDE_REPO/.env"
    set +a
    
    # Check if template file exists
    if [[ ! -f "$CLAUDE_REPO/claude-code-mcp.json" ]]; then
        warning "claude-code-mcp.json template not found, skipping MCP configuration..."
        return
    fi
    
    # Create a backup of the original template
    cp "$CLAUDE_REPO/claude-code-mcp.json" "$CLAUDE_REPO/claude-code-mcp.json.template"
    
    # Replace placeholders in the template
    local temp_file=$(mktemp)
    cp "$CLAUDE_REPO/claude-code-mcp.json" "$temp_file"
    
    # Replace environment variables
    sed -i.bak "s|{{CLAUDE_PROJECT_PATH}}|${CLAUDE_PROJECT_PATH:-$CLAUDE_REPO}|g" "$temp_file"
    sed -i.bak "s|{{LOCAL_CDP_URL}}|${LOCAL_CDP_URL:-ws://localhost:9222}|g" "$temp_file"
    sed -i.bak "s|{{ANTHROPIC_API_KEY}}|${ANTHROPIC_API_KEY}|g" "$temp_file"
    
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
        success "MCP configuration installed to Claude app"
    else
        warning "Claude configuration directory not found. Please manually copy claude-code-mcp.json to your Claude configuration directory."
    fi
    
    # Clean up
    rm -f "$temp_file" "$temp_file.bak"
    
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
CLAUDE_PROJECT_PATH=/path/to/claude/repo

# For claude-logger MCP server
# No specific environment variables required

# Custom paths (optional)
# CLAUDE_REPO=/path/to/claude/repo
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
    install_memory_visualizer
    install_mcp_servers
    create_command_wrappers
    configure_shell_environment
    initialize_shared_memory
    create_example_configs
    setup_mcp_config
    verify_installation
    
    # Final instructions
    echo ""
    echo -e "${GREEN}🎉 Installation completed successfully!${NC}"
    echo ""
    echo -e "${CYAN}📋 Next steps:${NC}"
    echo "1. Reload your shell configuration:"
    echo "   source $SHELL_RC"
    echo ""
    echo "2. Test the commands:"
    echo "   ukb --help    # Update Knowledge Base"
    echo "   vkb           # View Knowledge Base"
    echo ""
    echo "3. Configure MCP servers (optional):"
    echo "   - Copy .env.example to .env and fill in your API keys"
    echo "   - Add MCP server configurations to Claude Code settings"
    echo ""
    echo "4. Start capturing knowledge:"
    echo "   - Run 'ukb' after coding sessions to capture insights"
    echo "   - Run 'vkb' to visualize your knowledge graph"
    echo ""
    echo -e "${BLUE}📚 Documentation:${NC}"
    echo "   - README.md: General documentation"
    echo "   - docs/: Detailed documentation"
    echo "   - TEAM_KNOWLEDGE_SETUP.md: Team setup guide"
    echo ""
    echo -e "${GREEN}Happy knowledge capturing! 🧠${NC}"
    
    log "Installation completed successfully"
}

# Run main function
main "$@"