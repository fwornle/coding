# Installation

Prerequisites, the install itself, and what it puts on your machine.

=== "⚡ Quick (~3 min)"

    ## Install

    ```bash
    git clone --recurse-submodules https://github.com/fwornle/coding ~/Agentic/coding
    cd ~/Agentic/coding && ./install.sh
    source ~/.zshrc          # or ~/.bashrc
    coding --health
    ```

    `--recurse-submodules` is not optional — several integrations are submodules and the install
    fails confusingly without them.

    ## What you need

    Docker (**running**, not just installed), Node.js 22 LTS or newer, plus `git`, `jq` and
    `tmux`.

    === "macOS"

        ```bash
        brew install git node jq tmux && brew install --cask docker
        ```

    === "Linux / WSL2"

        ```bash
        sudo apt update && sudo apt install -y git nodejs npm jq tmux
        curl -fsSL https://get.docker.com | sh
        ```

    ## What it does to your machine

    Prompts before any system-level change, backs up your shell config with a timestamp, and
    supports `--skip-all` to decline every system change. Its own state stays in the checkout.

    ## If it fails

    Most first-run failures are Docker not running, or a shell not reloaded since the install.
    [Verify & Repair](verify-repair.md) works through the rest.

=== "📖 Standard (~15 min)"

    ## Before you start

    | Tool | Why |
    |------|-----|
    | Docker | The services are containers — it must be **running**, not merely installed |
    | Node.js 22 LTS+ | The host-side launcher; 18 and 20 are EOL |
    | Git | Clone the repository and its submodules |
    | `jq` | JSON handling throughout the scripts |
    | `tmux` | Session wrapping and the shared status bar |

    ## Installing

    ```bash
    git clone --recurse-submodules https://github.com/fwornle/coding ~/Agentic/coding
    cd ~/Agentic/coding && ./install.sh
    source ~/.zshrc
    ```

    The services run as Docker containers with only the agent CLI native on the host, talking to
    them through stdio proxies. That is what keeps the install contained and makes removal a
    matter of stopping containers.

    ## What the installer is careful about

    It is deliberately non-intrusive, and each of these is a decision rather than an accident: it
    **prompts before any system-level change**, writes a **timestamped backup** of your shell
    config before touching it, honours **`--skip-all`** to decline every system change, and keeps
    its data inside the checkout rather than scattering it through your home directory.

    ## What you end up with

    | Component | Does |
    |-----------|------|
    | `coding` | Launches an agent with every integration attached |
    | `vkb` | Opens the knowledge viewer |
    | `semantic` | Knowledge-base workflows and ontology management |
    | MCP servers | Graphify, and the containerised services behind it |
    | Session logging | Automatic transcript capture |
    | Hooks | PreToolUse for constraints, PostToolUse for logging |

    ## When it does not work

    Work in this order, because the failures nest:

    1. **Is Docker running?** Not installed — running. This is the most common first-run failure.
    2. **Has the shell been reloaded?** `source ~/.zshrc`, or open a new terminal.
    3. **Did the submodules come down?** `git submodule update --init --recursive` if the clone
       omitted `--recurse-submodules`.
    4. **Then** `coding --health` and [Verify & Repair](verify-repair.md) for anything remaining.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/getting-started/installation.deep.md"
