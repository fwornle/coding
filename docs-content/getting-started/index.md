# Getting Started

Complete guide to installing and configuring the coding infrastructure.

## Prerequisites

- **Node.js 18+**
- **Git**
- **jq** (JSON processor)
- **Docker** (required for default deployment mode)

=== "macOS"

    ```bash
    brew install git node jq
    ```

=== "Linux (Ubuntu/Debian)"

    ```bash
    sudo apt update && sudo apt install git nodejs npm jq
    ```

=== "Windows"

    Install via package managers or direct downloads from:

    - [nodejs.org](https://nodejs.org)
    - [git-scm.com](https://git-scm.com)
    - [stedolan.github.io/jq](https://stedolan.github.io/jq/)

## Installation

```bash
# Clone with submodules
git clone --recurse-submodules https://github.com/fwornle/coding ~/Agentic/coding
cd ~/Agentic/coding

# Run installer (Docker mode is default)
./install.sh

# Reload shell
source ~/.bashrc  # or ~/.zshrc
```

### What Gets Installed

| Component | Description |
|-----------|-------------|
| `coding` | Launch Claude Code with all integrations |
| `vkb` | View Knowledge Base (web visualization) |
| MCP Servers | Semantic Analysis, Constraint Monitor, Browser Access |
| LSL | Live Session Logging with 4-layer monitoring |
| Hooks | PreToolUse (constraints) and PostToolUse (logging) |

### Installation Safety

The installer follows a **non-intrusive policy**:

- Prompts before any system-level changes
- Creates timestamped backups of shell config
- Supports `skip-all` to decline all system changes

## Verification

```bash
# Run test suite (check-only by default)
./scripts/test-coding.sh

# Interactive repair mode
./scripts/test-coding.sh --interactive

# Manual verification
vkb --version
coding --help
```

## First Usage

```bash
# Launch Claude Code with all systems (--claude is default)
coding

# Or specify project
coding --project ~/my-project

# View knowledge graph
vkb  # Opens browser to http://localhost:8080
```

### Knowledge Base Updates

Within a Claude Code session:

```
# Incremental analysis (recent changes)
"ukb" or "update knowledge base"

# Full analysis (entire codebase)
"full ukb" or "fully update knowledge base"
```

## Next Steps

- [Configuration](configuration.md) - API keys and port setup
- [Docker Mode](docker-mode.md) - Containerized deployment
- [Core Systems](../core-systems/index.md) - LSL, UKB/VKB, Constraints
