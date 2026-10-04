Step-by-step guide to install coding on your system.

---

## Prerequisites

Before installing, ensure you have these tools:

=== "macOS"

    ```bash
    # Install prerequisites
    brew install git node jq tmux

    # Docker Desktop — learning tiers only
    brew install --cask docker
    ```

=== "Linux (Ubuntu/Debian)"

    ```bash
    # Install prerequisites
    sudo apt update && sudo apt install -y git nodejs npm jq tmux

    # Docker — learning tiers only
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER  # Log out and back in
    ```

=== "Windows (WSL2)"

    1. Install [WSL2](https://docs.microsoft.com/en-us/windows/wsl/install) and enable systemd
       in the distribution (`/etc/wsl.conf`: `[boot]` / `systemd=true`) — the host services
       run as systemd user units
    2. Learning tiers: install [Docker Desktop](https://www.docker.com/products/docker-desktop)
       with WSL integration
    3. In WSL2:
       ```bash
       sudo apt update && sudo apt install -y git nodejs npm jq tmux
       ```

### Version Requirements

Required — the install aborts without these:

| Tool | Minimum Version | Check Command |
|------|----------------|---------------|
| Git | 2.0+ | `git --version` |
| Node.js | 22 LTS+ | `node --version` |
| npm | any | `npm --version` |
| Python | 3.x | `python3 --version` |
| curl | any | `curl --version` |
| Docker | 20+, running — **`learning` tiers and up only** | `docker info` |

Optional — reported, never fatal:

| Tool | Minimum Version | Consequence if absent |
|------|----------------|-----------------------|
| jq | 1.6+ | none — every use has a fallback |
| plantuml | any | installed later in the run, and skippable (a repo-local JAR is used instead) |
| tmux | 3.0+ | install completes fine; needed at **launch** time for status-bar rendering, not by the installer |

---

## Installation

From the `learning` tier up, the knowledge services (semantic analysis, constraint monitor,
code graph, dashboard) run as containers; the launcher, the agent CLI, the health coordinator,
the LLM proxy and obs-api run on the host. The `harness` tier runs no containers at all.

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

1. Print the impact manifest — everything it may touch
2. Ask the **agent scope** (default: only `coding` launches are observed)
3. Ask the **tier** and write `~/.coding/features.yaml`

    ![Which tier](../images/install-tier-menu.png)

4. Check network reachability (DNS, TCP, TLS) and configure a proxy for the install if it finds one
5. Install the tier's parts — the LLM proxy always; Docker images, knowledge store and viewer
   from `learning` up
6. Install the tier's host services (launchd on macOS, systemd user units on Linux / WSL)
7. Add `coding`, `coding-features`, `semantic` and friends to your PATH
8. With a learning tier: set up the coding checkout's own learning repo (`.coding/`)

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
coding-features status            # the installed tier, feature by feature
curl -s localhost:3034/health     # the health coordinator
```

Then open the dashboard at [localhost:3032](http://localhost:3032): it should read
**Healthy**.

![Health dashboard](../images/system-healthy.png)

### Step 5: Start Coding

```bash
cd ~/my-project
coding
```

With a learning tier, the first launch in a repo asks where its learned data goes:

![First launch in a repo](../images/learning-repo-prompt.png)

![Coding Startup](../images/coding-startup-dockerized.png)

---

## What Gets Installed

| Component | Location | Purpose |
|-----------|----------|---------|
| `coding` command | `~/Agentic/coding/bin/` | Launch an agent with every enabled integration |
| `coding-features` | `~/Agentic/coding/bin/` | Show / change the installed tier and features |
| `coding sync` | (part of `coding`) | Commit, pull and push the per-repo learning repos |
| `semantic` | `~/Agentic/coding/bin/` | Knowledge-base workflows (UKB) and ontology |
| Host services | launchd / systemd user units | health coordinator, LLM proxy, obs-api, session capture — only the tier's |
| Containers (`learning`+) | Docker | semantic analysis, constraints, code graph, dashboard, Qdrant, Redis |
| Agent hooks + MCP | supplied per launch by `bin/coding` | written globally only with `--global-agents` |
| Live knowledge store | `~/.coding/data/<scope>/var/` | LevelDB + caches, machine-local |
| Learned data per repo | `<repo>/.coding/` | session logs, observations, insights, KB slice, usage — see [Per-Repo Tenancy](../architecture/tenancy.md) |

### Configuration Files Created

| File | Purpose |
|------|---------|
| `~/.coding/features.yaml` | the chosen tier / features |
| `~/.coding/repos.yaml` | per repo: its learning repo remote, or skip (written on first launch) |
| `~/.coding/teams.yaml` | your teams (written by Dashboard → Teams) |
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
# Check what's using a port (obs-api shown)
lsof -i :12436

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
