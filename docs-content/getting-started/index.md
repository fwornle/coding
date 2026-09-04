# Getting Started

Installation, verification, and your first session — about five minutes if Docker is
already running.

=== "⚡ Quick (~3 min)"

    ## Four commands

    ```bash
    git clone --recurse-submodules https://github.com/fwornle/coding ~/Agentic/coding
    cd ~/Agentic/coding && ./install.sh
    source ~/.zshrc          # or ~/.bashrc
    coding
    ```

    The installer does the rest. It prompts before any system-level change, backs up your shell
    config first, and keeps all its data inside the checkout.

    ## What you need first

    Docker, Node.js 22 LTS or newer, plus `git`, `jq` and `tmux`:

    ```bash
    # macOS
    brew install git node jq tmux && brew install --cask docker

    # Debian / Ubuntu / WSL2
    sudo apt update && sudo apt install -y git nodejs npm jq tmux
    curl -fsSL https://get.docker.com | sh
    ```

    Docker must be **running**, not merely installed — the services are containers.

    ## Check it worked

    ```bash
    coding --health
    ```

    Everything should be green. If it is not, [Verify & Repair](verify-repair.md) diagnoses each
    service in turn; the usual cause is Docker not being up yet.

    Then: [Configuration](configuration.md) to add LLM provider keys, or
    [Core Systems](../core-systems/index.md) to learn what is now running.

=== "📖 Standard (~15 min)"

    ## Installing

    Coding runs its services as Docker containers. Only the agent CLI itself runs natively on the
    host, talking to the containers through lightweight stdio proxies — so the install stays
    contained and `docker compose down` is a complete cleanup.

    ![Docker Architecture](../images/docker-architecture.png)

    Prerequisites, all required:

    | Tool | Purpose |
    |------|---------|
    | Docker | Runs the services (Docker Desktop or Engine) |
    | Node.js 22 LTS+ | The host-side launcher; 18 and 20 are EOL |
    | Git | Clone the repo and its submodules |
    | `jq` | JSON handling throughout the scripts |
    | `tmux` | Session wrapping and the shared status bar |

    Then clone **with submodules** — several integrations are submodules and the install fails
    confusingly without them — and run the installer:

    ```bash
    git clone --recurse-submodules https://github.com/fwornle/coding ~/Agentic/coding
    cd ~/Agentic/coding && ./install.sh
    source ~/.zshrc
    ```

    ## What the installer touches

    It is deliberately non-intrusive: it prompts before any system-level change, writes a
    timestamped backup of your shell config, supports `--skip-all` to decline every system
    change, and otherwise keeps its state inside the checkout.

    What you get:

    | Component | Description |
    |-----------|-------------|
    | `coding` | Launches an agent with every integration wired up |
    | `vkb` | Opens the knowledge viewer at `localhost:8080` |
    | `semantic` | Knowledge-base workflows and ontology management |
    | MCP servers | Semantic Analysis, Constraint Monitor, Graphify |
    | LSL | Live Session Logging |
    | Hooks | PreToolUse for constraints, PostToolUse for logging |

    ## Your first session

    ```bash
    coding                          # current directory
    coding --project ~/my-project   # or somewhere else
    ```

    That opens your agent inside a tmux session carrying the shared status bar, with logging,
    constraints and health monitoring already attached. Launching the agent's own CLI directly
    skips all of that, so prefer `coding`.

    To look at what the system knows, run `vkb`. To rebuild that knowledge from your git history
    and session logs, ask the agent for a "ukb" pass in chat, or run it yourself:

    ```bash
    semantic workflow run wave-analysis --team coding
    semantic workflow status
    ```

    It is asynchronous and takes 10–20 minutes; watch it on the dashboard rather than waiting.

    ## If something is not green

    ```bash
    coding --health                        # which service is unhappy
    ./scripts/test-coding.sh --interactive # guided repair
    ```

    [Verify & Repair](verify-repair.md) covers each service individually. Most first-run failures
    are Docker not being up, or a shell that has not been reloaded since the install.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/getting-started/index.deep.md"
