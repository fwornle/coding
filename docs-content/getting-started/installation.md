# Installation

Step-by-step guide to install coding on your system.

---

## Prerequisites

Before installing, ensure you have these tools:

=== "macOS"

    ```bash
    # Install prerequisites
    brew install git node jq tmux

    # Install Docker Desktop (for recommended Docker mode)
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

| Tool | Minimum Version | Check Command |
|------|----------------|---------------|
| Node.js | 18+ | `node --version` |
| Git | 2.0+ | `git --version` |
| tmux | 3.0+ | `tmux -V` |
| Docker | 20+ | `docker --version` |
| jq | 1.6+ | `jq --version` |

---

## Docker Installation (Recommended)

Docker mode provides the best experience with isolated services, persistent state, and easy management.

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

1. Detect Docker availability
2. Create `.docker-mode` marker (enables Docker mode)
3. Build Docker containers
4. Configure Claude MCP servers for SSE/HTTP communication
5. Set up Claude hooks (LSL, constraints)
6. Initialize knowledge store
7. Add `coding` and `vkb` commands to your PATH

!!! info "Non-Intrusive Installation"
    The installer prompts before any system changes and creates timestamped backups of your shell configuration. Use `--skip-all` to decline all system-level changes.

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

## Native Installation

Native mode runs MCP servers as direct Node.js processes. Use this if you prefer not to use Docker or need lower resource usage.

### Installation Steps

```bash
# Clone repository
git clone --recurse-submodules https://github.com/fwornle/coding ~/Agentic/coding
cd ~/Agentic/coding

# Remove Docker mode marker (ensures native mode)
rm -f .docker-mode

# Run installer
./install.sh

# Reload shell
source ~/.bashrc  # or ~/.zshrc
```

### Native vs Docker Comparison

| Aspect | Docker Mode | Native Mode |
|--------|-------------|-------------|
| **Isolation** | Full container isolation | Runs in your environment |
| **Persistence** | Services survive restarts | Restarted each session |
| **Resources** | Higher (Docker overhead) | Lower |
| **Setup** | Requires Docker | Node.js only |
| **Browser sharing** | Multiple sessions share browser | Per-session browser |
| **Debugging** | Container logs | Direct process logs |

---

## Switching Modes

You can switch between Docker and Native modes at any time.

### Docker to Native

```bash
coding --switch-to-native
```

Or manually:

```bash
rm -f .docker-mode
docker compose -f docker/docker-compose.yml down
```

### Native to Docker

```bash
coding --switch-to-docker
```

Or manually:

```bash
touch .docker-mode
./install.sh  # Rebuilds Docker config
```

![Mode Transition](../images/docker-mode-state-machine.png)

For detailed transition documentation, see [Docker Mode Setup Guide](../guides/docker-mode-setup.md).

---

## What Gets Installed

| Component | Location | Purpose |
|-----------|----------|---------|
| `coding` command | `~/Agentic/coding/bin/` | Launch Claude with all integrations |
| `vkb` command | `~/Agentic/coding/bin/` | View Knowledge Base |
| `ukb` command | `~/Agentic/coding/bin/` | Update Knowledge Base |
| MCP Servers | Docker or native | Semantic Analysis, Constraints, etc. |
| Claude Hooks | `~/.claude/settings.json` | LSL monitoring, constraint checks |
| Knowledge Store | `.data/knowledge-graph/` | Graph database |
| Session Logs | `.specstory/history/` | LSL files |

### Configuration Files Created

| File | Purpose |
|------|---------|
| `~/.claude/settings.json` | Claude hooks configuration |
| `.env` | API keys and settings |
| `.env.ports` | Port configuration |
| `.docker-mode` | Docker mode marker (if Docker) |

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
rm -f .docker-mode .transition-in-progress

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

- [Docker Mode Details](docker-mode.md) - In-depth Docker configuration
- [Docker Mode Setup Guide](../guides/docker-mode-setup.md) - Advanced transition scenarios
- [Troubleshooting](../reference/troubleshooting.md) - Common issues and solutions
