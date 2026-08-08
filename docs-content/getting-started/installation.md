# Installation

Step-by-step guide to install coding on your system.

---

## Prerequisites

Before installing, ensure you have these tools:

=== "macOS"

    ```bash
    # Install prerequisites
    brew install git node jq tmux

    # Install Docker Desktop
    brew install --cask docker
    ```

=== "Linux (Ubuntu/Debian)"

    ```bash
    # Install prerequisites
    sudo apt update && sudo apt install -y git nodejs npm jq tmux

    # Install Docker
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER  # Log out and back in
    ```

=== "Windows (WSL2)"

    1. Install [WSL2](https://docs.microsoft.com/en-us/windows/wsl/install)
    2. Install [Docker Desktop](https://www.docker.com/products/docker-desktop)
    3. In WSL2:
       ```bash
       sudo apt update && sudo apt install -y git nodejs npm jq tmux
       ```

### Version Requirements

Required — the install aborts without these:

| Tool | Minimum Version | Check Command |
|------|----------------|---------------|
| Git | 2.0+ | `git --version` |
| Node.js | 18+ | `node --version` |
| npm | any | `npm --version` |
| Python | 3.x | `python3 --version` |
| curl | any | `curl --version` |
| Docker | 20+, running | `docker info` |

Optional — reported, never fatal:

| Tool | Minimum Version | Consequence if absent |
|------|----------------|-----------------------|
| jq | 1.6+ | none — every use has a fallback |
| plantuml | any | installed later in the run, and skippable (a repo-local JAR is used instead) |
| tmux | 3.0+ | install completes fine; needed at **launch** time for status-bar rendering, not by the installer |

---

## Docker Installation

Coding runs in Docker. All services (MCP servers, databases, dashboards) run as containers; only the Claude/Copilot CLI runs natively on the host.

![Docker Architecture](../images/docker-architecture.png)

### Step 1: Clone Repository

```bash
git clone --recurse-submodules https://github.com/fwornle/coding ~/Agentic/coding
cd ~/Agentic/coding
```

!!! tip "Existing Clone?"
    If you already cloned without submodules:
    ```bash
    git submodule update --init --recursive
    ```

### Step 2: Run Installer

```bash
./install.sh
```

The installer will:

1. Check network reachability (DNS, TCP, TLS) and configure a proxy for the install if it finds one
2. Verify Docker is installed and running
3. Build Docker containers
4. Configure MCP servers, hooks and slash commands **for `bin/coding` launches**
5. Initialize the knowledge store
6. Add `coding` and `vkb` commands to your PATH
7. Offer to set up the private session-history repository

### Step 2a: See what it will change first

```bash
./install.sh --dry-run
```

This prints every path the installer may touch, grouped by scope, then exits
without changing anything at all. It is the authoritative list — this page
deliberately does not reproduce it, so it cannot go stale.

!!! info "Bare agents are not affected by default"
    Installing this project does **not** change how bare `claude`, `copilot` or
    `opencode` behave. Hooks, MCP servers and slash commands are supplied per
    launch by `bin/coding`; your shared config files are read, never written.

    The installer asks once whether you want them configured globally too — the
    default is **no**, recorded in `.env` as `CODING_AGENT_SCOPE=wrapper`. Opt in
    with `--global-agents`.

!!! warning "`--yes` does not mean 'yes to everything'"
    `--yes` auto-approves system changes but deliberately does **not** select
    global agent scope, and does not install the login-persistent LLM proxy
    service. Those need `CODING_INSTALL_GLOBAL_AGENTS=1` and
    `CODING_INSTALL_SYSTEM_SERVICES=1`. An unattended run must never silently
    reconfigure agents outside this project.

!!! note "Backups"
    Files the installer modifies are backed up **once**, as `<file>.coding-orig`,
    from before the installer first touched them. `./uninstall.sh` reports these
    rather than deleting them. Run `./install.sh --help` for the full flag and
    environment-variable list.

### Step 3: Reload Shell

```bash
source ~/.bashrc  # or ~/.zshrc for Zsh
```

### Step 4: Verify Installation

```bash
coding --health
```

![Health Check](../images/install-health-check.png)

You should see all services reporting healthy (green).

### Step 5: Start Coding

```bash
coding
```

![Coding Startup](../images/coding-startup-dockerized.png)

---

## What Gets Installed

| Component | Location | Purpose |
|-----------|----------|---------|
| `coding` command | `~/Agentic/coding/bin/` | Launch Claude with all integrations |
| `vkb` command | `~/Agentic/coding/bin/` | View Knowledge Base |
| `ukb` command | `~/Agentic/coding/bin/` | Update Knowledge Base |
| MCP Servers | Docker | Semantic Analysis, Constraints, etc. |
| Claude Hooks | `~/.claude/settings.json` | LSL monitoring, constraint checks |
| Knowledge Store | `.data/knowledge-graph/` | Graph database |
| Session Logs | `.specstory/history/` | LSL files |

### Configuration Files Created

| File | Purpose |
|------|---------|
| `~/.claude/settings.json` | Claude hooks configuration |
| `.env` | API keys and settings |
| `.env.ports` | Port configuration |

---

## Troubleshooting Installation

### Docker Not Found

```bash
# Verify Docker is installed
docker --version

# Verify Docker daemon is running
docker info

# On macOS, ensure Docker Desktop is running
```

### Permission Denied

```bash
# Fix Docker socket permissions (Linux)
sudo usermod -aG docker $USER
# Log out and back in

# Fix directory permissions
chmod -R 755 ~/Agentic/coding
```

### Submodules Missing

```bash
cd ~/Agentic/coding
git submodule update --init --recursive
```

### Port Conflicts

```bash
# Check what's using a port
lsof -i :8080

# Change ports in .env.ports
cat .env.ports
```

### Reinstallation

To completely reinstall:

```bash
cd ~/Agentic/coding

# Stop all services
docker compose -f docker/docker-compose.yml down 2>/dev/null
pkill -f "coding"

# Clean state (preserves knowledge base)
rm -f .transition-in-progress

# Reinstall
./install.sh
```

---

## Next Steps

- [Verify Installation](verify-repair.md) - Detailed verification and repair
- [Configuration](configuration.md) - API keys and provider setup
- [First Usage](index.md#first-usage) - Start using coding

---

## Related Documentation

- [Troubleshooting](../reference/troubleshooting.md) - Common issues and solutions
