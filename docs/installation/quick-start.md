# Quick Start Installation Guide

## Prerequisites

- Git, Node.js, npm, Python 3, and jq installed
- macOS, Linux, or Windows (via WSL/Git Bash)
- Network access for repository cloning

## 30-Second Installation

```bash
# Clone the repository to your preferred location
git clone <repository-url> ~/coding
cd ~/coding

# Run the installer
./install.sh

# Reload your shell
source ~/.bashrc  # or ~/.zshrc on macOS
```

## What Gets Installed

The installation script sets up:

1. **Knowledge Management Tools**
   - `ukb` - Update Knowledge Base command
   - `vkb` - View Knowledge Base command

2. **Memory Visualizer**
   - Web-based knowledge graph visualization
   - Automatically cloned and built

3. **MCP Servers** (optional)
   - Browser automation (Stagehand)
   - Conversation logger

4. **Shell Integration**
   - Global command access from any directory
   - Environment variables

## Platform-Specific Setup

### macOS
```bash
# Install prerequisites (if needed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git node python3 jq

# Clone and install
git clone <repository-url> ~/coding
cd ~/coding
./install.sh
```

### Linux (Ubuntu/Debian)
```bash
# Install prerequisites
sudo apt update
sudo apt install git nodejs npm python3 jq

# Clone and install
git clone <repository-url> ~/coding
cd ~/coding
./install.sh
```

### Windows (Git Bash/WSL)
```bash
# Using Git Bash or WSL Ubuntu
# Install Node.js from nodejs.org
# Install jq from github.com/stedolan/jq/releases

# Clone and install
git clone <repository-url> ~/coding
cd ~/coding
./install.sh
```

## Team Setup

### First-time Team Setup
```bash
# Team lead sets up the repository
git clone <repository-url> ~/coding
cd ~/coding
./install.sh

# Initialize shared knowledge base
ukb --init

# Commit initial setup
git add shared-memory.json
git commit -m "Initialize team knowledge base"
git push
```

### Team Member Setup
```bash
# Clone existing team repository
git clone <repository-url> ~/coding
cd ~/coding
./install.sh

# Knowledge base is automatically available
vkb  # View existing team knowledge
```

## VSCode Extension Setup

### Building and Installing the Extension
```bash
# Navigate to extension directory
cd ~/coding/vscode-km-copilot

# Install dependencies
npm install

# Build the extension
npm run package

# Install in VSCode
code --install-extension km-copilot-bridge-*.vsix
```

### Using Command Palette Commands
After installation, restart VSCode and:

1. **Start fallback services first**:
   ```bash
   coding --copilot
   ```

2. **Use Command Palette** (Ctrl+Shift+P / Cmd+Shift+P):
   - `View Knowledge Base` - Opens knowledge graph in browser
   - `Update Knowledge Base` - Add new patterns interactively

3. **Use in Copilot Chat**:
   - Type `@KM vkb` to view knowledge base
   - Type `@KM ukb Problem: X, Solution: Y` to add patterns

**Note:** The extension requires fallback services running on port 8765. Always start with `coding --copilot` first.

## ✅ Installation Verification

### Step 1: Basic Command Test
```bash
# Test commands are available
ukb --version
vkb --version

# Expected output:
# ukb version 1.0.0
# vkb version 1.0.0
```

### Step 2: Knowledge Base Test
```bash
# Test knowledge base creation and update
ukb "Problem: Testing installation, Solution: Installation successful, Technologies: testing"

# Expected output:
# ✅ Knowledge base updated successfully!
# Entity: InstallationTestPattern
# Significance: 5/10
```

### Step 3: Visualization Test
```bash
# Test knowledge graph viewer
vkb

# Expected behavior:
# - Opens browser to http://localhost:8080
# - Shows interactive knowledge graph
# - Displays the test pattern you just created
```

### Step 4: Git Integration Test
```bash
# Test git integration
git status

# Expected output should include:
# modified: shared-memory.json
```

### Step 5: Full System Test
```bash
# Test auto-analysis mode
cd /path/to/any/git/repo
git log --oneline -5  # Should show recent commits
ukb  # Should analyze recent commits

# Expected output:
# 🔍 Analyzing git commits since last run...
# Found X transferable insights
```

## 🔧 Troubleshooting Failed Installations

### Commands Not Found
```bash
# Check if shell was reloaded
echo $PATH | grep coding

# If missing, reload shell
source ~/.bashrc  # or ~/.zshrc on macOS

# Or start new terminal session
```

### Permission Errors
```bash
# Make scripts executable
cd ~/coding
chmod +x install.sh
chmod +x bin/*
chmod +x knowledge-management/*

# Run installer again
./install.sh
```

### Missing Dependencies
```bash
# Check Node.js
node --version  # Should be v16+ 
npm --version

# Check Python
python3 --version  # Should be 3.8+

# Check jq
jq --version

# Check git
git --version
```

### UKB/VKB Commands Fail
```bash
# Check environment variables
echo $CODING_TOOLS_PATH
echo $CODING_REPO

# If missing, run installer again
./install.sh --update-shell-config

# Check shared-memory.json exists
ls -la shared-memory.json

# If missing, initialize
ukb --init
```

### Knowledge Graph Viewer Issues
```bash
# Check if memory-visualizer was cloned
ls -la memory-visualizer/

# If missing, clone manually
git clone https://github.com/fwornle/memory-visualizer
cd memory-visualizer && npm install && npm run build

# Test viewer launch
vkb --debug
```

### Git Integration Problems
```bash
# Check if in git repository
git status

# If not, initialize
git init
git add .
git commit -m "Initial commit"

# Test ukb again
ukb "Problem: Git test, Solution: Git working"
```

### Network/Proxy Issues
```bash
# Test external connectivity
curl -I https://github.com
curl -I https://npmjs.org

# If behind proxy, configure
git config --global http.proxy http://proxy:8080
npm config set proxy http://proxy:8080

# See network setup guide for details
```

## 🚨 Fixing Corrupt Installations

### Complete Reset
```bash
# Remove all installed components
rm -rf ~/.coding-tools/
rm -rf memory-visualizer/
rm -rf mcp-server-browserbase/

# Remove shell configuration
# Edit ~/.bashrc or ~/.zshrc and remove lines containing:
# - CODING_TOOLS_PATH
# - coding tools path addition

# Reinstall from scratch
./install.sh
source ~/.bashrc  # or ~/.zshrc
```

### Selective Reset
```bash
# Reset only shell configuration
./install.sh --update-shell-config
source ~/.bashrc

# Reset only MCP servers
./install.sh --update-mcp-config

# Reset only memory visualizer
rm -rf memory-visualizer/
./install.sh --update-memory-visualizer
```

### Verify Complete Installation
```bash
# Run comprehensive test & repair script
./scripts/test-coding.sh

# This script will:
# ✓ Test all components and dependencies
# ✓ Detect available AI agents (Claude/Copilot)  
# ✓ Verify VSCode extension installation
# ✓ Automatically repair any issues found
# ✓ Provide detailed status report
```

### Quick Manual Verification
```bash
# Manual verification checklist:
echo "✓ Commands available:" && ukb --version && vkb --version
echo "✓ Knowledge base works:" && ukb "test" && echo "OK"
echo "✓ Git integration:" && git status | grep "shared-memory.json" && echo "OK"
echo "✓ Viewer launches:" && timeout 10 vkb && echo "OK"
echo "✓ Environment:" && echo $CODING_TOOLS_PATH && echo "OK"
```

## Uninstall

If you need to remove the coding tools system:

```bash
# Remove all installed components (preserves your knowledge data)
./uninstall.sh

# This will:
# ✓ Remove shell configuration (PATH, environment variables)
# ✓ Remove installed binaries and dependencies
# ✓ Clean up temporary files and logs
# ✓ PRESERVE shared-memory.json (your knowledge base)
```

**Note:** Your knowledge data in `shared-memory.json` is always preserved during uninstall.

## Next Steps

- **[Network Setup](network-setup.md)** - Configure for corporate networks
- **[MCP Configuration](mcp-configuration.md)** - Set up Claude Code integration
- **[UKB User Guide](../ukb/user-guide.md)** - Learn knowledge management
- **[VSCode Integration](../integrations/vscode-extension.md)** - IDE integration

## Common Issues

### Command not found
```bash
# Reload shell
source ~/.bashrc  # or ~/.zshrc
# Or start new terminal
```

### Permission errors
```bash
# Make scripts executable
chmod +x *.sh
./install.sh
```

### Network issues
See [Network Setup](network-setup.md) for proxy and firewall configuration.