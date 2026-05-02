# Getting Started

Get coding running in under 5 minutes.

![Coding Startup](../images/coding-startup-dockerized.png)

---

## Installation

Coding runs in Docker. All services (MCP servers, databases, dashboards) run as containers; only the Claude/Copilot CLI runs natively on the host and connects via lightweight stdio proxies.

![Docker Architecture](../images/docker-architecture.png)

**Benefits**:

- Isolated services in containers
- Persistent state survives restarts
- Consistent behavior across machines
- Easy cleanup (just stop containers)

[Install with Docker](installation.md#docker-installation){ .md-button .md-button--primary }

---

## Prerequisites

| Tool | Required | Purpose |
|------|----------|---------|
| **Docker** | Yes | Container runtime (Docker Desktop or Docker Engine) |
| **Node.js 18+** | Yes | Runtime for the host-side launcher |
| **Git** | Yes | Clone repository, submodules |
| **jq** | Yes | JSON processing in scripts |
| **tmux** | Yes | Unified agent session wrapping and status bar |

### Quick Install

=== "macOS"

    ```bash
    brew install git node jq tmux
    brew install --cask docker
    ```

=== "Linux (Ubuntu/Debian)"

    ```bash
    sudo apt update && sudo apt install -y git nodejs npm jq tmux
    curl -fsSL https://get.docker.com | sh
    ```

=== "Windows (WSL2)"

    Install [Docker Desktop](https://www.docker.com/products/docker-desktop), then in WSL2:
    ```bash
    sudo apt update && sudo apt install -y git nodejs npm jq tmux
    ```

---

## Quick Start

```bash
# 1. Clone repository with submodules
git clone --recurse-submodules https://github.com/fwornle/coding ~/Agentic/coding
cd ~/Agentic/coding

# 2. Run installer
./install.sh

# 3. Reload shell
source ~/.bashrc  # or ~/.zshrc

# 4. Start coding
coding
```

That's it! The installer handles everything automatically.

---

## What Gets Installed

| Component | Description |
|-----------|-------------|
| **`coding`** | Launch Claude Code with all integrations |
| **`vkb`** | View Knowledge Base (web visualization) |
| **`ukb`** | Update Knowledge Base (knowledge extraction) |
| **MCP Servers** | Semantic Analysis, Constraint Monitor, Code Graph |
| **LSL** | Live Session Logging with 4-layer monitoring |
| **Hooks** | PreToolUse (constraints) and PostToolUse (logging) |

### Installation Safety

The installer follows a **non-intrusive policy**:

- Prompts before any system-level changes
- Creates timestamped backups of shell config
- Supports `--skip-all` to decline all system changes
- All data stays in `~/Agentic/coding/`

---

## Verification

After installation, verify everything is working:

```bash
coding --health
```

![Health Check](../images/system-healthy.png)

All services should show green. If you see issues, run:

```bash
./scripts/test-coding.sh --interactive
```

[Full Verification Guide](verify-repair.md){ .md-button }

---

## First Usage

### Start a Session

```bash
# Launch Claude Code with all systems
coding

# Or specify a project directory
coding --project ~/my-project
```

![Session Loading](../images/coding-session-log-loading.png)

### View Knowledge Graph

```bash
vkb  # Opens browser to http://localhost:8080
```

### Update Knowledge Base

Within a Claude Code session:

```
# Incremental analysis (recent changes)
"ukb" or "update knowledge base"

# Full analysis (entire codebase history)
"ukb full" or "fully update knowledge base"

# Debug mode (single-stepping)
"ukb debug"
```

---

## Next Steps

<div class="grid cards" markdown>

-   :material-cog:{ .lg .middle } **Configuration**

    ---

    Set up API keys for LLM providers

    [:octicons-arrow-right-24: Configure](configuration.md)

-   :material-wrench:{ .lg .middle } **Verify & Repair**

    ---

    Troubleshoot installation issues

    [:octicons-arrow-right-24: Verify](verify-repair.md)

-   :material-book-open:{ .lg .middle } **Core Systems**

    ---

    Learn about LSL, UKB/VKB, Constraints

    [:octicons-arrow-right-24: Explore](../core-systems/index.md)

</div>
