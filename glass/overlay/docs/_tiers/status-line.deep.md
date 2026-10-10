## Where it appears

**With tmux** (macOS, Linux, WSL — tmux is optional, glass never installs it):
`glass <agent>` runs the agent in a tmux session of its own with glass's status bar.
Inside an existing tmux session, glass sets the bar on that session for the run and
restores it afterwards.

![Status line in tmux](images/terminal-statusline-tmux.png)

**Without tmux** — native Windows, or `--no-tmux` / `GLASS_NO_TMUX=1`:

- **Claude Code** shows glass's line as its own status line. glass passes a temporary
  settings file (`--settings`) for that run only and deletes it afterwards. The fields
  are clickable links in Windows Terminal, iTerm2 and VS Code's terminal.

    ![Claude Code status line](images/terminal-statusline-claude.png)

- **Any agent** — run `glass watch` in a split pane (`wt split-pane` in Windows
  Terminal) for a live one-line bar of the newest session (`--task <id>` for another).

`GLASS_NO_STATUSLINE=1` turns Claude Code's glass status line off.

## The fields

| Field | Example | Meaning |
|---|---|---|
| health | `glass ●` | The daemon answers. `glass ✗ down` when it does not. |
| context | `ctx ▋ 9%` | Prompt size of the session's latest main-loop turn (fresh + cache read + cache write) as a share of the model's context window. Side calls (titles, summaries) are skipped so the gauge does not drop to zero. |
| tokens | `↑258.6K ↓233 ⚡66%` | Tokens sent (prompt) and received (output) in this session; ⚡ is the share of the latest prompt served from cache. |
| network | `N:CN P:ON` | The same badge as coding's status line, from the same probes. **N** — where the machine is: `CN` (corporate network, on-site), `VPN`, `OPEN` (home / public), `??` (not probed yet). **P** — the local proxy (proxydetox on `:3128`): `ON` (forwarding, `px` toggle on), `AUTO` (forwarding, toggle off), `OFF` (not listening or not forwarding). Click for the details and the daemon's own egress. `¬tap` when the run uses `--no-intercept`. |

## Clicks

| Field | tmux click | In Claude Code / `glass watch` |
|---|---|---|
| health | opens the UI | link to the UI |
| context | popup with the context report | link to the context explainer |
| tokens | opens this session in the UI | link to the session |
| network | popup with the egress report | — |

The context report as it appears in the popup:

![Context report](images/terminal-report-ctx.png)

The same reports are available on the command line: `glass report ctx`, `glass report net`.

## Refresh

The tmux bar refreshes every 5 seconds; Claude Code refreshes its status line after
each turn.
