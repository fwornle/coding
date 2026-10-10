## Requirements

- **Node.js ≥ 22.13** — check with `node --version`. glass uses Node's built-in SQLite.
- **Read access** to [AIMAAD/glass](https://bmw.ghe.com/AIMAAD/glass) on bmw.ghe.com.
- **The agents you want to measure**, installed and logged in as usual:
    - `claude` — Claude Code;
    - `copilot` — the npm `@github/copilot` CLI, **version 1.0.93 or newer**. VS Code's
      bundled copilot is older and calls the public Copilot host; put the npm CLI first
      on your `PATH`;
    - `opencode`;
    - `pi`.
- Optional: `tmux` (macOS, Linux, WSL) for the clickable [status line](status-line.md).

## Download

With the GitHub CLI — once: `gh auth login --hostname bmw.ghe.com`:

```sh
gh release download --repo bmw.ghe.com/AIMAAD/glass --pattern 'glass-*.tgz'
```

Without it, download `glass-<version>.tgz` from the
[latest release](https://bmw.ghe.com/AIMAAD/glass/releases/latest) in the browser.

## Install

```sh
npm install -g ./glass-<version>.tgz          # macOS, Linux, WSL
npm install -g .\glass-<version>.tgz          # PowerShell / cmd
```

The tarball contains its two dependencies, so the install needs **no npm registry**,
runs **no install scripts** and needs **no build tools** — it works offline.

## Check the setup

`glass doctor` lists Node, the data directory, the corporate proxy glass will use, every
agent it finds (with its version) and the daemon state. A line with ✗ says what to fix,
for example a copilot that is too old.

![glass doctor](images/terminal-doctor.png)

## Your first measured session

```sh
cd ~/projects/demo-shop
glass claude
```

Work as usual. With tmux installed, the agent runs inside a tmux session with glass's
status line at the bottom; otherwise Claude Code shows the same line as its own status
line. See [Status Line](status-line.md).

When you are done, open the dashboards:

```sh
glass ui
```

`glass status` shows the daemon, live sessions and the latest recorded calls in the
terminal:

![glass status](images/terminal-status.png)

## Update

```sh
glass update            # download the latest release with gh, npm install -g it
glass update --check    # only say whether a newer release exists
```

Your data in `~/.glass` is kept. The download retries a passing server error twice. After
the install, a daemon of the older version is replaced when that costs no running
session — it has none, or it is 0.1.6 or later. With live sessions the new daemon starts
straight away and picks them up, so running agents keep measuring without a gap. A daemon
older than 0.1.6 with live sessions keeps serving them; run `glass stop` once they have
ended.

Without `gh` (or not logged in to `bmw.ghe.com`), `glass update` says so; download and
install the newer tarball by hand as under *Install*.

## Uninstall

```sh
glass uninstall      # stops the daemon, deletes ~/.glass (asks first; --yes skips the question)
npm rm -g glass
```

Nothing is left outside `~/.glass`. CI checks exactly this on Linux and Windows for every
change: install, one measured run per agent, uninstall — then the home directory must be
byte-identical to before.
