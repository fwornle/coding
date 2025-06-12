# Team Knowledge Management Setup

> **📚 For complete documentation, see [docs/documentation.md](docs/documentation.md)**

## 🚀 Installation

### Prerequisites
- Git, Node.js, npm, Python 3, and jq installed
- macOS, Linux, or Windows (via WSL/Git Bash)
- SSH access to cc-github.bmwgroup.net (when inside Corporate Network)
- SSH access to github.com (when outside Corporate Network)

### Network-Aware Installation

The installer automatically detects your network location and selects appropriate repositories:

**🏢 Inside Corporate Network (CN):**
- **Detection:** Tests SSH/HTTPS access to `cc-github.bmwgroup.net`
- **memory-visualizer:** Uses CN mirror with team modifications
- **browserbase:** Uses public repo with proxy detection and graceful fallback

**🌍 Outside Corporate Network:**
- **Detection:** `cc-github.bmwgroup.net` not accessible
- **memory-visualizer:** Uses public fork (`github.com/fwornle/memory-visualizer`)
- **browserbase:** Uses public repo (`github.com/browserbase/mcp-server-browserbase`)

![Installation Flow](docs/imag/installation-flow.png)

### Corporate Network Handling

**🔍 Proxy Detection:**
When inside CN, the installer tests external connectivity using `curl google.de` to determine if proxy access is available.

**📦 Repository Strategy:**
- **Mirrored repos** (memory-visualizer): Always use CN mirror when inside CN
- **Non-mirrored repos** (browserbase): Intelligent handling based on proxy status

**⚡ Graceful Degradation:**
- **Repository exists + No proxy:** Skip updates, continue with existing version
- **Repository missing + No proxy:** Report failure with helpful hints
- **Repository exists + Proxy working:** Update successfully
- **Repository missing + Proxy working:** Clone successfully

**📊 Installation Status:**
- **🟢 Success:** All components installed successfully
- **🟡 Warnings:** Some updates skipped due to network restrictions
- **🔴 Failures:** Some components missing and couldn't be installed

### Setup Process

1. **Clone the repository** (if not already done):
   ```bash
   git clone <repository-url> ~/coding
   cd ~/coding
   ```

2. **Configure environment variables**:
   ```bash
   # Copy the example environment file
   cp .env.example .env
   
   # Edit .env to add your API keys (optional, for MCP servers)
   nano .env  # or use your preferred editor
   ```

3. **Run the installer**:
   ```bash
   ./install.sh
   ```

   The installer will:
   - ✅ Check for required dependencies
   - ✅ Install/update memory-visualizer from team repository (if not present)
   - ✅ Install/update mcp-server-browserbase (if not present)
   - ✅ Build MCP servers (browser-access, claude-logger)
   - ✅ Create command wrappers (ukb, vkb)
   - ✅ Configure your shell environment
   - ✅ Process MCP configuration with correct paths
   - ✅ Install MCP config to Claude application directory

4. **Reload your shell**:
   ```bash
   source ~/.zshrc  # macOS
   # or
   source ~/.bashrc  # Linux/Windows
   ```

## Quick Start

After installation, the knowledge management system is ready to use:

```bash
# Update knowledge base (capture session insights)
ukb

# View knowledge base (start visualization server)
vkb
```

## Commands

### ukb (Update Knowledge Base)
- **Purpose**: One-stop shop for capturing session insights
- **Usage**: `ukb` (always runs in auto mode)
- **What it does**:
  - Analyzes git commits from current session
  - Extracts insights and classifies them
  - Creates entities and relationships
  - Links everything to the current project
  - Updates shared memory (`shared-memory.json`)

### vkb (View Knowledge Base) 
- **Purpose**: Visualization server management
- **Usage**: 
  - `vkb` or `vkb start` - Start server
  - `vkb stop` - Stop server
  - `vkb restart` - Restart server
  - `vkb status` - Check status
  - `vkb logs` - View logs
- **What it does**:
  - Checks if visualization server is already running
  - Converts shared memory to visualization format
  - Starts HTTP server on localhost:8080
  - Opens browser automatically
  - Runs in background

## Architecture

### Shared Memory (`shared-memory.json`)
- Central knowledge repository for the team
- Git-tracked and shared across all team members
- Contains entities, relations, and metadata
- Automatically updated by `ukb` command

### Entity Types
- **Project**: Software projects (timeline, knowledge-management, etc.)
- **CodingInsight**: Insights extracted from commits
- **Component**: React/software components
- **Architecture**: Architectural patterns and decisions
- **Feature**: Application features and capabilities

### Classification Rules
- `fix:` commits → bug-fix category
- `feat:` commits → feature category  
- `perf:` commits → performance category
- `refactor:` commits → refactoring category
- `test:` commits → testing category
- `docs:` commits → documentation category

### Relationships
- All insights automatically linked to their project
- Components linked to projects they belong to
- Architectural patterns linked to projects that use them
- No orphaned nodes - everything connects to project hierarchy

## Directory Structure
```
coding/
├── README.md                      # Main documentation entry point
├── docs/team-knowledge-setup.md  # This quick setup guide
├── docs/                          # Complete documentation
│   ├── documentation.md           # Comprehensive system docs
│   └── imag/                      # Architecture diagrams
├── shared-memory.json             # Shared knowledge base
└── knowledge-management/
    ├── ukb                        # Update Knowledge Base
    ├── vkb                        # View Knowledge Base
    ├── browser                    # Browser integration
    └── dist/                      # Visualization files
```

## Team Workflow

1. **Daily Development**: Just work normally with git commits
2. **End of Session**: Run `ukb` to capture insights
3. **Knowledge Review**: Run `vkb` to visualize and explore
4. **Team Sync**: Git push/pull shares knowledge automatically

## Environment Variables

The `.env` file supports the following variables:

| Variable | Purpose | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | For browser-access MCP server | Optional |
| `BROWSERBASE_API_KEY` | For Browserbase integration | Optional |
| `BROWSERBASE_PROJECT_ID` | Browserbase project identifier | Optional |
| `LOCAL_CDP_URL` | Chrome DevTools Protocol URL | Optional (default: ws://localhost:9222) |

**Note**: API keys are only required if you plan to use the MCP servers for browser automation. The core knowledge management system (ukb/vkb) works without any API keys.

## Troubleshooting

### Installation Issues

**General Issues:**

- **Missing dependencies**: The installer will list any missing dependencies and provide installation commands
- **Permission denied**: Run `chmod +x install.sh` before running the installer
- **Path not updated**: Manually source your shell config file or restart your terminal

**Corporate Network Issues:**

- **External repos fail to clone**: Check proxy configuration or run installer outside CN
- **Updates fail inside CN**: Normal behavior when proxy blocks external access - uses existing versions
- **SSH access fails**: Ensure your SSH keys are configured for both `cc-github.bmwgroup.net` and `github.com`

**Repository Selection Issues:**

- **Wrong repository used**: Installer auto-detects network location - verify you're on intended network
- **CN mirror outdated**: Manual update required if CN mirror is behind public version
- **Public fork outdated**: Update your public fork from upstream if needed

### Server Issues

```bash
vkb stop    # Stop any stuck servers
vkb start   # Start fresh
```

### Memory Issues  
- Shared memory is in git - just pull latest
- If corrupted, check git history for last good version

### Missing Dependencies
- Requires: `jq`, `python3`, `curl`, `lsof`
- Install via package manager (brew, apt, etc.)
