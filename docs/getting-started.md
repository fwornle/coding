# Getting Started with Coding

Complete guide to installing, configuring, and using the unified semantic analysis & knowledge management system.

## Prerequisites

- **Git** - Version control
- **Node.js 18+** - JavaScript runtime
- **npm** - Package manager
- **jq** - JSON processor
- **macOS, Linux, or Windows** (via WSL/Git Bash)

### Install Prerequisites

**macOS:**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git node jq
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install git nodejs npm jq
```

**Windows:**
- Install Node.js from [nodejs.org](https://nodejs.org)
- Install Git Bash from [git-scm.com](https://git-scm.com)
- Install jq from [stedolan.github.io/jq](https://stedolan.github.io/jq/)

---

## Installation

### 30-Second Quick Install

```bash
# Clone the repository with submodules
git clone --recurse-submodules <repository-url> ~/Agentic/coding
cd ~/Agentic/coding

# Run the installer
./install.sh

# Reload your shell
source ~/.bashrc  # or ~/.zshrc on macOS
```

**Note**: The repository uses git submodules for integration components (memory-visualizer, semantic-analysis, browserbase, serena, constraint-monitor). The `--recurse-submodules` flag ensures all submodules are initialized during clone.

### What Gets Installed

1. **Core Commands**
   - `coding` - Launch Claude Code with all integrations
   - `ukb` - Update Knowledge Base
   - `vkb` - View Knowledge Base (web visualization)

2. **Integration Components**
   - MCP Semantic Analysis Server (10 agents)
   - MCP Constraint Monitor
   - Serena AST Analysis (MCP)
   - Browser Access (Stagehand)
   - Memory Visualizer (web UI)

3. **Shell Integration**
   - Global commands accessible from any directory
   - Environment variables (`CODING_TOOLS_PATH`, `CODING_REPO`)
   - Claude Code MCP configuration

4. **Monitoring Systems**
   - Live Session Logging (LSL)
   - Constraint enforcement hooks
   - 4-layer health monitoring

### Managing Git Submodules

The repository uses git submodules for integration components. Here's how to manage them:

**Update All Submodules:**
```bash
# Update all submodules to latest versions
git submodule update --remote

# Or update a specific submodule
git submodule update --remote integrations/memory-visualizer
```

**Initialize Missing Submodules:**
```bash
# If you cloned without --recurse-submodules
git submodule update --init --recursive

# Or initialize a specific submodule
git submodule update --init integrations/serena
```

**Submodule Structure:**
- `integrations/mcp-constraint-monitor` (Own repo - SSH)
- `integrations/memory-visualizer` (Own repo - SSH)
- `integrations/mcp-server-semantic-analysis` (Own repo - SSH)
- `integrations/serena` (Third-party - HTTPS)
- `integrations/mcp-server-browserbase` (Third-party - HTTPS)

---

## Configuration

### API Keys Setup

Create `.env` file with your API keys:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# LLM Provider (configure at least ONE - the system is provider-agnostic!)
# Groq (recommended - fastest and cheapest)
GROK_API_KEY=your-groq-key-here

# Anthropic (high quality)
ANTHROPIC_API_KEY=sk-ant-your-key-here

# OpenAI (GPT-4, GPT-3.5)
OPENAI_API_KEY=sk-your-openai-key-here

# Google Gemini
GOOGLE_API_KEY=your-google-key-here

# Local models (Ollama/vLLM - privacy-first, free)
LOCAL_MODEL_ENDPOINT=http://localhost:11434

# Browser automation (if using browser-access)
LOCAL_CDP_URL=ws://localhost:9222

# Automatically set by installer
CODING_TOOLS_PATH=/Users/<username>/Agentic/coding
CODING_REPO=/Users/<username>/Agentic/coding
```

**Note:** The system works with ANY coding agent (Claude Code, GitHub CoPilot, Cursor, etc.) and ANY LLM provider. Provider SDKs are installed as optional dependencies - only install what you need:

```bash
# Install only providers you'll use
npm install groq-sdk              # For Groq
npm install @anthropic-ai/sdk     # For Anthropic
npm install openai                # For OpenAI or local models
npm install @google/generative-ai # For Gemini
```

See [provider-configuration.md](provider-configuration.md) for detailed provider setup.

### MCP Configuration

The installer automatically configures Claude Code MCP settings. Manual configuration location:

**macOS:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Linux:**
```
~/.config/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%/Claude/claude_desktop_config.json
```

---

## Verification

### Test Installation

```bash
# Run comprehensive test
./scripts/test-coding.sh

# This verifies:
# ✓ All commands available
# ✓ MCP servers configured
# ✓ Knowledge base working
# ✓ Integration components installed
# ✓ Claude Code integration
```

### Manual Verification

```bash
# Test commands
ukb --version
vkb --version
coding --help

# Test knowledge base
ukb "Problem: Testing, Solution: Works, Technologies: testing"
vkb  # Should open browser to http://localhost:8080

# Test Claude Code integration
coding  # Launches Claude Code with all MCPs
```

---

## First Usage

### Start Claude Code with Integrations

```bash
# Launch Claude Code with all systems
coding

# Or specify project
coding --project ~/Agentic/my-project

# Force specific AI agent
coding --claude    # Claude Code (default)
coding --copilot   # GitHub CoPilot
```

### Capture Your First Knowledge

```bash
# Simple insight capture
ukb "Problem: Authentication bug, Solution: Fixed JWT validation, Technologies: Node.js,JWT"

# View the knowledge graph
vkb

# Update from git history (automatic analysis)
cd /path/to/your/project
ukb  # Analyzes recent git commits
```

### Use Semantic Analysis

Within Claude Code session:

```
# Analyze current codebase
determine_insights {
  "repository": ".",
  "depth": 10
}

# Generate project documentation
execute_workflow {
  "workflow_name": "complete-analysis"
}
```

---

## Network Setup (Corporate/Proxy)

### Behind Corporate Firewall

The installer automatically detects network restrictions and configures appropriate repository mirrors.

**Test Network Access:**
```bash
# Test external connectivity
curl -I https://github.com
curl -I https://npmjs.org
```

**Configure Proxy:**
```bash
# Set git proxy
git config --global http.proxy http://proxy:8080
git config --global https.proxy http://proxy:8080

# Set npm proxy
npm config set proxy http://proxy:8080
npm config set https-proxy http://proxy:8080

# Set environment variables
export HTTP_PROXY=http://proxy:8080
export HTTPS_PROXY=http://proxy:8080
```

**Use Internal Mirrors:**

If inside corporate network, installer automatically uses internal mirrors for:
- memory-visualizer (CN mirror with team modifications)
- Other components (graceful fallback to public repos)

---

## Troubleshooting

### Commands Not Found

```bash
# Reload shell configuration
source ~/.bashrc  # or ~/.zshrc on macOS

# Or start new terminal session

# Verify PATH
echo $PATH | grep coding

# If missing, reinstall
./install.sh --update-shell-config
```

### Permission Errors

```bash
# Make scripts executable
chmod +x install.sh
chmod +x bin/*

# Run installer
./install.sh
```

### MCP Servers Not Loading

```bash
# Check MCP configuration
cat ~/.config/Claude/claude_desktop_config.json

# Reinstall MCP config
./install.sh --update-mcp-config

# Check server logs
ls ~/.claude/logs/mcp*.log
```

### Knowledge Base Issues

```bash
# Check shared-memory files exist
ls -la shared-memory*.json

# If missing, initialize
ukb --init

# Test with simple entry
ukb "test"

# Check environment variables
echo $CODING_TOOLS_PATH
echo $CODING_REPO
```

### Memory Visualizer Won't Start

```bash
# Check if installed
ls -la integrations/memory-visualizer/

# If missing, initialize submodule
git submodule update --init --recursive integrations/memory-visualizer
cd integrations/memory-visualizer
npm install && npm run build

# Test viewer
vkb --debug
```

### Network/Connectivity Issues

```bash
# Test connectivity
curl -I https://github.com
ping 8.8.8.8

# Check DNS resolution
nslookup github.com

# Test with proxy (if behind firewall)
curl -x http://proxy:8080 -I https://github.com

# See network setup section above
```

---

## Complete Reset

If installation is corrupted:

```bash
# Uninstall completely
./uninstall.sh

# Remove all data (WARNING: loses knowledge base)
rm -rf ~/.coding-tools/
rm -rf integrations/memory-visualizer/node_modules integrations/memory-visualizer/dist
rm shared-memory*.json

# Reinstall from scratch
./install.sh
source ~/.bashrc
```

---

## Next Steps

- **[System Overview](system-overview.md)** - Understand what coding provides
- **[Live Session Logging](lsl/README.md)** - Learn about LSL system
- **[Constraint Monitoring](constraints/README.md)** - Real-time code quality
- **[Knowledge Management](knowledge-management/README.md)** - UKB/VKB workflows
- **[Integration Components](integrations/README.md)** - External component documentation
- **[Troubleshooting](../troubleshooting.md)** - Detailed troubleshooting guide

---

## Quick Reference

### Essential Commands

```bash
# Launch Claude Code with all systems
coding

# Knowledge management
ukb "insight text"     # Add insight
vkb                    # View knowledge graph

# Project analysis
ukb                    # Auto-analyze git history (in project dir)

# System verification
./scripts/test-coding.sh
```

### Key Directories

```
~/Agentic/coding/              # Main repository
~/.coding-tools/               # Installed binaries
~/.claude/                     # Claude Code configs
~/Agentic/coding/integrations/ # Integration components
```

### Important Files

```
.env                          # API keys and configuration
shared-memory*.json           # Knowledge base data
~/.claude/settings.json       # Hook configuration
claude_desktop_config.json    # MCP configuration
```

---

*For detailed documentation, see [Documentation Hub](README.md)*
