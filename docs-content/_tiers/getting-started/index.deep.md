## How the pieces fit

![Agent launched by coding](../images/coding-startup-dockerized.png)

`coding` is a launcher. It resolves which features are on (`~/.coding/features.yaml`, written
by the installer), starts or reuses what those features need, prepares the repo's learning
checkout, and opens the agent CLI inside a tmux session carrying the shared status bar.

| Runs on the host | Runs in Docker (`learning` tiers and up) |
|---|---|
| the launcher, the agent CLI | `coding-services` — semantic analysis (UKB), constraint monitor, code graph, dashboard |
| health coordinator `:3034`, LLM proxy `:12435`, obs-api `:12436` | Qdrant (vectors), Redis |
| session loggers, sub-agent capture, sweepers (launchd / systemd user units) | |

With only `harness` features on, the launcher never starts Docker.

![Docker Architecture](../images/docker-architecture.png)

---

## Prerequisites

| Tool | Required | Purpose |
|------|----------|---------|
| **Node.js 22 LTS+** | yes | the launcher and every host service (18/20 are EOL) |
| **Git** | yes | the repo, submodules, learning repos |
| **jq** | yes | JSON processing in scripts |
| **tmux** | yes | session wrapping and the status bar |
| **Docker** | `learning` and up | container runtime (Docker Desktop or Engine), running |
| **gh** | optional | creates private `<repo>-history` repos on first launch |

=== "macOS"

    ```bash
    brew install git node jq tmux gh
    brew install --cask docker        # learning tiers only
    ```

=== "Linux (Ubuntu/Debian)"

    ```bash
    sudo apt update && sudo apt install -y git nodejs npm jq tmux gh
    curl -fsSL https://get.docker.com | sh   # learning tiers only
    ```

    Host services run as systemd **user** units; `loginctl enable-linger $USER` keeps them
    running after logout.

=== "Windows (WSL2)"

    Install inside a WSL2 distribution with systemd enabled (`/etc/wsl.conf`:
    `[boot]` `systemd=true`), then as on Linux. Docker Desktop's WSL integration provides
    Docker for the learning tiers. There is no native Windows installer.

---

## Install

```bash
git clone --recurse-submodules https://github.com/fwornle/coding ~/Agentic/coding
cd ~/Agentic/coding
./install.sh            # asks: agent scope, tier
source ~/.zshrc         # or ~/.bashrc
```

![Which tier](../images/install-tier-menu.png)

| Flag | Effect |
|---|---|
| `--dry-run` | print the impact manifest and stop — nothing changes |
| `--features=<tier>` | choose the tier without asking (`harness`, `learning`, `learning-perf`, `everything`, or a feature list) |
| `--yes` | unattended; take the defaults |
| `--global-agents` | also observe bare `claude` / `copilot` / `opencode` (writes their global configs) |

Everything is reversible with `./uninstall.sh`. The full flow, with every prompt, is on
[Installation](installation.md).

---

## What each tier installs

| Feature | `harness` | `learning` | `learning-perf` | `everything` |
|---|:-:|:-:|:-:|:-:|
| launcher, status line, health monitoring | ✓ | ✓ | ✓ | ✓ |
| LLM proxy + token measurement | ✓ | ✓ | ✓ | ✓ |
| live session logging (LSL) | | ✓ | ✓ | ✓ |
| observations → digests → insights, UKB, knowledge viewer | | ✓ | ✓ | ✓ |
| performance measurement, experiments, kgbench | | | ✓ | ✓ |
| constraints, code graph | | | | ✓ |

Switch later with `coding-features profile <tier>`, one feature with
`coding-features set <feature> on|off`, or in **Dashboard → Features**.

---

## Verification

![Health dashboard](../images/system-healthy.png)

- **Status line** — `[🏥●]` green = healthy; each other badge belongs to one feature and is
  absent when that feature is off.
- **Dashboard** — [localhost:3032](http://localhost:3032), **Run Verification** for an
  on-demand pass.
- **Shell** — `coding-features status`, `curl -s localhost:3034/health`.

[Full Verification Guide](verify-repair.md){ .md-button }

---

## First usage

### Start a session

```bash
cd ~/my-project
coding                     # best available agent
coding --claude            # or --copilot, --opencode, --pi
coding --project DIR       # another directory
coding --dry-run           # resolve everything, launch nothing
```

### The learning repo

With a learning tier, the first launch in a repo asks where its learned data goes:

![First launch in a repo](../images/learning-repo-prompt.png)

Enter creates a private `<repo>-history` (via `gh`), a teammate's URL clones and shares
theirs, `skip` keeps the data local and untracked. Never asked again for that repo. See
[Per-Repo Tenancy](../architecture/tenancy.md).

### Look at what was learned

- **Dashboard** — Observations, Digests and Insights tabs at
  [localhost:3032](http://localhost:3032).
- **Knowledge viewer** — the graph, filtered by your active teams. Start it with
  `npm --prefix ~/Agentic/coding/integrations/unified-viewer run dev` and open
  [127.0.0.1:5173/viewer/coding](http://127.0.0.1:5173/viewer/coding).

### Update the knowledge base

Within a session, ask for it in chat:

```
"ukb"         # incremental analysis (recent changes)
"ukb full"    # the entire history
"ukb debug"   # single-stepping
```

Or from a shell: `semantic workflow run wave-analysis --team coding`. It runs in the
background for 10–20 minutes; follow it on the dashboard.

### Share with your team

```bash
coding sync               # what each learning repo has to push / pull
coding sync --push        # asks, then pushes
```

[Teams & Shared Learning](../guides/teams.md){ .md-button }

---

## Next steps

<div class="grid cards" markdown>

-   :material-cog:{ .lg .middle } **Configuration**

    ---

    Set up API keys for LLM providers

    [:octicons-arrow-right-24: Configure](configuration.md)

-   :material-wrench:{ .lg .middle } **Verify & Repair**

    ---

    Troubleshoot installation issues

    [:octicons-arrow-right-24: Verify](verify-repair.md)

-   :material-account-group:{ .lg .middle } **Per-Repo Tenancy**

    ---

    Where learned data lives and how teams share it

    [:octicons-arrow-right-24: Read](../architecture/tenancy.md)

</div>
