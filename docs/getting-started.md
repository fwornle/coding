# Getting Started with Coding

Complete guide to installing, configuring, and using the unified semantic analysis & knowledge management system.

> **⚠️ IMPORTANT:** The `ukb` command-line tool has been removed. Knowledge base updates are now triggered exclusively through the MCP semantic-analysis server workflow (accessible only via Claude Code agents with MCP access). This prevents confusion caused by the shell command not having access to the MCP server.

## Prerequisites

- **Git** - Version control
- **Node.js 18+** - JavaScript runtime
- **npm** - Package manager
- **jq** - JSON processor
- **tmux** - Terminal multiplexer (required for status bar rendering)
- **macOS, Linux, or Windows** (via WSL/Git Bash)
- **Docker** (optional) - For containerized deployment

### Install Prerequisites

**macOS:**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git node jq tmux
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install git nodejs npm jq tmux
```

**Windows:**
- Install Node.js from [nodejs.org](https://nodejs.org)
- Install Git Bash from [git-scm.com](https://git-scm.com)
- Install jq from [stedolan.github.io/jq](https://stedolan.github.io/jq/)
- Install tmux (available via WSL or MSYS2)

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

### Installation Safety

The installer follows a **non-intrusive installation policy**: it will NEVER modify system tools or configurations outside the coding repository without your explicit consent.

**Confirmation Prompts:**
When the installer detects missing system dependencies (Node.js, Python, jq, etc.), it will:
1. Display what action is requested
2. Show potential risks (e.g., "May upgrade existing packages")
3. Ask for confirmation before proceeding

**Response Options:**
- `y` - Proceed with this specific change
- `N` (default) - Skip this change, continue installation
- `skip-all` - Skip ALL system-level changes for the rest of installation

**Example Prompt:**
```
╔══════════════════════════════════════════════════════════════════════╗
║               SYSTEM MODIFICATION REQUEST                            ║
╠══════════════════════════════════════════════════════════════════════╣
║ Action: Install Node.js via Homebrew                                 ║
║ Risk:   This may upgrade existing packages and break other tools     ║
╚══════════════════════════════════════════════════════════════════════╝
Proceed? [y/N/skip-all]:
```

**Shell Configuration Backup:**
Before modifying your shell configuration (`.bashrc`, `.zshrc`), the installer:
1. Creates a timestamped backup (e.g., `.zshrc.coding-backup.20260110120000`)
2. Asks for confirmation before making changes
3. Uses clear markers (`# === CODING TOOLS START/END ===`) for easy identification
4. Verifies the modified configuration is syntactically valid

This ensures you can always restore your original shell configuration if needed.

### What Gets Installed

1. **Core Commands**
   - `coding` - Launch Claude Code with all integrations
   - `vkb` - View Knowledge Base (web visualization)

2. **Integration Components**
   - MCP Semantic Analysis Server (14 agents)
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

5. **Local LLM Support (Optional)**
   - Docker Model Runner (DMR) - llama.cpp via Docker Desktop
   - Automatic GPU detection (Metal/CUDA/ROCm/CPU)
   - Cross-platform configuration (DMR_HOST for Windows containers)
   - Default model download (`ai/llama3.2`)
   - CLI tool (`llm`) for command-line inference

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

## Docker Deployment (Alternative)

For teams or users who prefer containerized deployments, the coding system supports Docker mode with HTTP/SSE transport for MCP servers.

### Benefits of Docker Mode

- **Persistent Services**: MCP servers run continuously, surviving session restarts
- **Shared Browser Automation**: Multiple Claude sessions share the same browser instance
- **Isolated Databases**: Qdrant, Redis, and Memgraph run in containers
- **Consistent Environment**: Same behavior across different machines

### Docker Prerequisites

```bash
# macOS
brew install --cask docker

# Linux
curl -fsSL https://get.docker.com | sh
```

### Enable Docker Mode

```bash
# Create marker file (one-time setup)
touch .docker-mode

# That's it! Now just launch Claude
coding --claude
```

The `coding --claude` command automatically:
1. Detects Docker mode via the `.docker-mode` marker file
2. Starts all containers via Docker Compose
3. Waits for health checks to pass
4. Launches Claude with the Docker MCP configuration

**Alternative**: You can also set `export CODING_DOCKER_MODE=true` instead of the marker file.

### Verify Health (Optional)

```bash
# Check container status
docker compose -f docker/docker-compose.yml ps

# Check MCP server health endpoints
curl http://localhost:3848/health  # semantic-analysis
curl http://localhost:3847/health  # browser-access
```

### Docker Port Mapping

| Service | Port | Protocol |
|---------|------|----------|
| Browser Access SSE | 3847 | HTTP/SSE |
| Semantic Analysis SSE | 3848 | HTTP/SSE |
| Constraint Monitor SSE | 3849 | HTTP/SSE |
| Code Graph RAG SSE | 3850 | HTTP/SSE |
| VKB Server | 8080 | HTTP |
| Qdrant | 6333/6334 | HTTP/gRPC |
| Redis | 6379 | TCP |
| Memgraph | 7687/3100 | Bolt/HTTP |

### Switch Between Modes

```bash
# Enable Docker mode
touch .docker-mode
coding --claude   # Services start automatically

# Disable Docker mode (return to native)
rm .docker-mode
docker compose -f docker/docker-compose.yml down  # Stop containers
coding --claude   # Now runs in native mode
```

See [Docker Deployment Guide](../docker/README.md) for detailed configuration.

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

# Local models via Docker Model Runner (recommended - auto-configured by installer)
# DMR uses llama.cpp with automatic GPU detection (Metal/CUDA/CPU)
DMR_PORT=12434
DMR_HOST=localhost  # Use host.docker.internal on Windows

# Legacy: llama.cpp fallback (if DMR unavailable)
LOCAL_MODEL_ENDPOINT=http://localhost:11434

# Browser automation (if using browser-access)
LOCAL_CDP_URL=ws://localhost:9222

# Automatically set by installer
CODING_TOOLS_PATH=/Users/<username>/Agentic/coding
CODING_REPO=/Users/<username>/Agentic/coding
```

### Port Configuration

All service ports are centralized in `.env.ports`. This is the **single source of truth** for port assignments:

```bash
# Key ports (see .env.ports for complete list)
VKB_PORT=8080                    # Knowledge visualization
CONSTRAINT_DASHBOARD_PORT=3030   # Constraint monitor UI
CONSTRAINT_API_PORT=3031         # Constraint monitor API
SYSTEM_HEALTH_DASHBOARD_PORT=3032  # Health dashboard UI
SYSTEM_HEALTH_API_PORT=3033      # Health dashboard API
MEMGRAPH_BOLT_PORT=7687          # Memgraph database (Bolt protocol)
MEMGRAPH_LAB_PORT=3100           # Memgraph Lab UI
DMR_PORT=12434                   # Docker Model Runner (local LLM)
```

The startup scripts (`bin/coding`, `scripts/start-services-robust.js`) automatically read these ports. To customize:

1. Edit `.env.ports` with your preferred ports
2. Restart services with `bin/coding`

**Note:** Docker services (Memgraph, Constraint Monitor) receive port configuration via environment variables at startup time, ensuring the submodule docker-compose files don't need modification.

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

The test script operates in three modes for safety:

```bash
# Check-only mode (DEFAULT) - reports issues without making changes
./scripts/test-coding.sh
./scripts/test-coding.sh --check-only

# Interactive mode - prompts before each repair action
./scripts/test-coding.sh --interactive

# Auto-repair mode - fixes coding-internal issues automatically
./scripts/test-coding.sh --auto-repair

# Show help
./scripts/test-coding.sh --help
```

**Mode Descriptions:**
- **`--check-only`** (default): Only reports issues, never modifies anything. Safe to run anytime.
- **`--interactive`**: Asks for confirmation before each repair action.
- **`--auto-repair`**: Automatically repairs coding-internal issues (node_modules, dist folders). Never auto-installs system packages.

**Important**: The test script will NEVER auto-install system packages (Node.js, Python, jq). If these are missing, it will suggest the commands you can run manually.

```bash
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
vkb --version
coding --help

# View the knowledge graph
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

### Knowledge Base Updates

Knowledge base updates are triggered exclusively through the MCP semantic-analysis server (accessible only via Claude Code agents with MCP access).

Within a Claude Code session, use these commands:

```
# Incremental analysis (faster - recent changes only)
"ukb" or "update knowledge base"

# Full analysis (thorough - entire codebase)
"full ukb" or "fully update knowledge base"
```

To view the knowledge graph:
```bash
vkb  # Opens browser to http://localhost:8080
```

### Use Semantic Analysis

Within Claude Code session:

```
# Analyze current codebase
determine_insights {
  "repository": ".",
  "depth": 10
}

# Generate project documentation (full analysis)
execute_workflow {
  "workflow_name": "complete-analysis"
}

# Incremental analysis (faster, recent changes)
execute_workflow {
  "workflow_name": "incremental-analysis"
}
```

---

## Network Setup (Corporate/Proxy)

### Automatic Network Detection

The launcher automatically detects your network environment at startup and configures proxy settings — no manual intervention needed. This ensures `coding` works reliably in all environments:

| Environment | CN Detection | Proxy Config | External Access |
|-------------|-------------|--------------|-----------------|
| Corporate network + proxy | Auto-detected | Auto-configured | Via proxy |
| Corporate network, no proxy | Auto-detected | Warning shown | Limited |
| Public network + proxy set | Skipped | Uses existing | Direct |
| Public network, no proxy | Skipped | None needed | Direct |

### How CN Detection Works

The launcher uses a **3-layer detection strategy** with graceful fallbacks:

1. **Environment override** (instant) — `CODING_FORCE_CN=true|false` skips auto-detection entirely. Useful for testing or when behind VPN.

2. **SSH probe** (5s timeout) — Tests SSH access to the corporate GitHub instance. Case-insensitive response matching handles different server response formats.

3. **HTTPS fallback** (5s timeout) — If SSH fails (e.g. port blocked), tries HTTPS access to the same host. Both methods use strict timeouts to prevent hangs on unreliable networks.

If all methods fail, the system assumes **public network** and proceeds normally.

### Automatic Proxy Configuration

When inside a corporate network, the launcher:

1. **Checks existing proxy** — If `HTTP_PROXY` is already set and working, does nothing
2. **Tests external access** — Tries reaching `https://google.de` to verify connectivity
3. **Auto-detects local proxy** (proxydetox) — Probes `127.0.0.1:3128` for a running proxy service
4. **Configures environment** — Sets `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, `https_proxy`, and `NO_PROXY` (excluding `localhost`, `127.0.0.1`, and internal domains)
5. **Verifies** — Re-tests external access after configuration to confirm the proxy works

If no proxy can be found, the launcher continues with a warning:
```
WARNING: Inside CN but no proxy available
  Docker pulls, npm installs, and external API calls may fail
```

### Manual Proxy Configuration

If auto-detection doesn't suit your environment, configure manually:

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

### Override CN Detection

For testing or non-standard setups:

```bash
# Force CN mode (skip auto-detection)
CODING_FORCE_CN=true coding --claude

# Force public mode (skip auto-detection)
CODING_FORCE_CN=false coding --claude
```

### Internal Mirrors

When inside a corporate network, the installer automatically uses internal mirrors for:
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
# Check knowledge-export files exist
ls -la .data/knowledge-export/*.json

# If missing, the graph database will create them automatically

# Check environment variables
echo $CODING_TOOLS_PATH
echo $CODING_REPO

# Test knowledge base via Claude Code session
# Run "ukb" or "update knowledge base" within Claude Code
```

**Note**: There is no `ukb` shell command. Knowledge base updates are triggered exclusively through the MCP semantic-analysis server within Claude Code sessions.

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

### Docker Mode Issues

```bash
# Check if Docker mode is enabled
ls -la .docker-mode
echo $CODING_DOCKER_MODE

# Check container status
docker compose -f docker/docker-compose.yml ps

# View container logs
docker compose -f docker/docker-compose.yml logs -f coding-services

# Check MCP SSE server health
curl http://localhost:3848/health  # semantic-analysis
curl http://localhost:3847/health  # browser-access
curl http://localhost:3849/health  # constraint-monitor
curl http://localhost:3850/health  # code-graph-rag

# Restart containers
docker compose -f docker/docker-compose.yml restart

# Rebuild containers (after code changes)
docker compose -f docker/docker-compose.yml build --no-cache
docker compose -f docker/docker-compose.yml up -d
```

**Port Conflicts**: If ports 3847-3850 are already in use:
```bash
# Find process using port
lsof -i :3848

# Stop conflicting process or change ports in .env.ports
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
rm -rf .data/knowledge-export/*.json

# Reinstall from scratch
./install.sh
source ~/.bashrc
```

### Restoring Shell Configuration

If your shell configuration was modified and you want to restore it:

```bash
# Find the backup file (created during installation)
ls -la ~/.zshrc.coding-backup.* 2>/dev/null
ls -la ~/.bashrc.coding-backup.* 2>/dev/null

# Restore from backup (replace with your actual backup file)
cp ~/.zshrc.coding-backup.20260110120000 ~/.zshrc

# Or manually remove coding tools section
# Look for markers: # === CODING TOOLS START === and # === CODING TOOLS END ===
```

The uninstall script automatically removes the coding tools section from your shell configuration, but preserves the backup file for safety.

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

# View knowledge graph
vkb

# System verification (check-only mode by default)
./scripts/test-coding.sh

# System verification with repair prompts
./scripts/test-coding.sh --interactive
```

### Knowledge Management (within Claude Code)

```
# Update knowledge base (incremental)
"ukb" or "update knowledge base"

# Full knowledge base update
"full ukb" or "fully update knowledge base"
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
.data/knowledge-export/*.json # Knowledge base data
~/.claude/settings.json       # Hook configuration
claude_desktop_config.json    # MCP configuration
```

---

*For detailed documentation, see [Documentation Hub](README.md)*
