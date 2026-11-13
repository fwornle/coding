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

In WSL, install with WSL's own Node: `which node npm` must show Linux paths, not
`/mnt/c/…`. Otherwise Windows' npm installs a Windows glass. The agents must be installed
inside WSL too.

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

Pages open in Chrome on macOS and in the system default browser elsewhere. To use
Microsoft Edge, run once:

```sh
glass browser edge
```

The UI and every status-line click open in Edge from then on; on macOS a click re-uses
the glass tab that is already open. `glass browser` shows the choice, `glass browser
default` undoes it.

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

### When a new release is out

The daemon asks for the latest release with `gh` when it starts and every 6 hours. While
a newer one is out, glass offers it in three places:

- **Status line:** a `[⬆ 0.1.76]` field after `[glass ●]`. Click it and `glass update`
  runs in a tmux popup; press a key to close it when it is done.
- **UI:** an **Update to 0.1.76** button in the header. Click it and glass installs the
  release, replaces the daemon and reloads the page. When the running daemon is older
  than 0.1.6 and has live sessions, the button says the new version takes over when they end. If the
  install fails, the button turns into **Update failed — retry**; its tooltip holds the
  end of the output.
- **Terminal:** `glass <agent>` prints a line naming the release before the agent starts.

Without `gh` or its login nothing is offered; `glass update` says why.
`{ "updateCheck": false }` in `~/.glass/config.json` stops the check.

## Uninstall

```sh
glass uninstall      # stops the daemon, deletes ~/.glass (asks first; --yes skips the question)
npm rm -g glass
```

Nothing is left outside `~/.glass`. CI checks exactly this on Linux and Windows for every
change: install, one measured run per agent, uninstall — then the home directory must be
byte-identical to before.
