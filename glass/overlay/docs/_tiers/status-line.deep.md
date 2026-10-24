## Where it appears

**With tmux** (macOS, Linux, WSL — tmux is optional, glass never installs it):
`glass <agent>` runs the agent in a tmux session of its own with glass's status bar.
Inside an existing tmux session, glass sets the bar on that session for the run and
restores it afterwards.

![Status line in tmux, with the popup a click on ctx opens](images/terminal-statusline-tmux.png)

**Without tmux** — native Windows, or `--no-tmux` / `GLASS_NO_TMUX=1`:

- **Claude Code** shows glass's line as its own status line. glass passes a temporary
  settings file (`--settings`) for that run only and deletes it afterwards. The fields
  are clickable links in Windows Terminal, iTerm2 and VS Code's terminal.

    ![Claude Code status line](images/terminal-statusline-claude.png)

- **Any agent** — run `glass watch` in a split pane (`wt split-pane` or Alt+Shift+D in
  Windows Terminal) for a live one-line bar of the newest session (`--task <id>` for
  another). Copilot, opencode and pi have no status line of their own to put glass's
  in, so on native Windows this is their only bar; `glass <agent>` says so when it
  starts.

`GLASS_NO_STATUSLINE=1` turns Claude Code's glass status line off.

## The fields

| Field | Example | Meaning |
|---|---|---|
| health | `glass ●` | The daemon answers. `glass ✗ down` when it does not. |
| context | `ctx ▋ 9%` | Prompt size of the session's latest main-loop turn (fresh + cache read + cache write) as a share of the model's context window. Side calls (titles, summaries) are skipped so the gauge does not drop to zero. |
| tokens | `↑258.6K ↓233 ⚡66%` | Tokens sent (prompt) and received (output) in this session; ⚡ is the share of the latest prompt served from cache. |
| cost | `GH €24.59` | What GitHub Copilot cost this calendar month (UTC), across all sessions — the account's bill, not this run's. Priced at GitHub's per-model rates and your contract settings, the same way as the [Cost tab](token-usage.md#cost). `≥` in front when a model's rate is unknown, so the figure is a floor. Hidden until the month has a Copilot call. |
| offload | `D:2` `L:5` | Only while [offload](offload.md) is on for the session's agent, each hidden at 0. **L** — calls your endpoint answered (a call that fell back to the agent's provider is not one). **D** — calls the classifier judged easier than their model. |
| network | `N:CN P:ON` | The same badge as coding's status line, from the same probes. **N** — where the machine is: `CN` (corporate network, on-site), `VPN`, `OPEN` (home / public), `??` (not probed yet). **P** — the local proxy (proxydetox on `:3128`): `ON` (forwarding, `px` toggle on), `AUTO` (forwarding, toggle off), `OFF` (not listening, or cannot open a tunnel to a host the corporate proxy has to carry). **K:NO** — on `CN` / `VPN` only: no Kerberos ticket, so the corporate proxy will refuse tunnels; the popup says how to renew it and shows the last tunnel it refused. Click for the details and the daemon's own egress. `¬tap` when the run uses `--no-intercept`. |

## Clicks

| Field | tmux click | In Claude Code / `glass watch` |
|---|---|---|
| health | opens the UI | link to the UI |
| context | popup with the context report | link to the context explainer |
| tokens | opens this session in the UI | link to the session |
| cost | opens Token Usage → Cost | link to the Cost tab |
| offload | opens Models, where the switch is | link to Models |
| network | popup with the egress report | link to the same report, as a page |

A terminal hyperlink can only open a URL, so without tmux each field opens a page:
the context explainer in the UI stands in for the context popup, and the daemon's
`/report/net` page for the network popup.

**Which browser tab opens.** On macOS with Chrome, a click re-uses an open glass tab:
it is focused, and navigated only when it shows another page. Everywhere else —
other browsers, Linux, Windows (Edge included) — every click opens a new tab. Without
tmux the links are plain terminal hyperlinks the terminal hands to the default
browser, and glass has no way to reach a tab that is already open.

The context report as it appears in the popup:

![Context report](images/terminal-report-ctx.png)

The same reports are available on the command line: `glass report ctx`, `glass report net`.

## Refresh

The tmux bar refreshes every 5 seconds; Claude Code refreshes its status line after
each turn.
