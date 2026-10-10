## All commands

| Command | Description |
|---|---|
| `glass <agent> [--no-intercept] [--no-tmux] [args…]` | Run `claude`, `copilot`, `opencode` or `pi`, measured. All other arguments go to the agent unchanged. Returns the agent's exit code. |
| `glass ui` | Open the UI (Token Usage, Sessions) in the browser |
| `glass status` | Daemon state, live sessions, the latest recorded calls |
| `glass doctor` | Node version, data home, CA, egress proxy, each agent's path and version, daemon state, and warnings when another local LLM proxy or tmux session overlaps with glass. Exit code 1 when something needs fixing |
| `glass watch [--task <id>]` | A live one-line status bar for the newest session, or the given one |
| `glass statusline [--format plain\|ansi\|tmux] [--task <id>]` | Print the status line once |
| `glass report ctx\|net [--task <id>]` | The context or network report (what a status-line click shows) |
| `glass stop` | Stop the daemon |
| `glass uninstall [--yes]` | Stop the daemon and delete `GLASS_HOME`; asks first unless `--yes` |
| `glass --version`, `glass help` | Version, help |

## Per-run options

| Option | Effect |
|---|---|
| `--no-tmux` | Run the agent in the current terminal, not in a tmux session |
| `--no-intercept` | copilot / opencode / pi: no proxy, no CA; session totals from the agent's own files |

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `GLASS_HOME` | `~/.glass` | Where glass keeps all its data |
| `GLASS_PORT` | `12445` | The daemon's port on 127.0.0.1 |
| `GLASS_NO_TMUX` | — | `1`: same as `--no-tmux` |
| `GLASS_NO_STATUSLINE` | — | `1`: Claude Code does not get glass's status line |
| `GLASS_<AGENT>_BIN` | the agent name on `PATH` | Path of an agent binary, e.g. `GLASS_COPILOT_BIN=/opt/homebrew/bin/copilot` |
| `GLASS_VERBOSE` | — | `1`: print the session id and wiring at start |
| `HTTPS_PROXY`, `NO_PROXY` | your environment | The daemon's route to the model hosts (corporate proxy) |
| `NODE_EXTRA_CA_CERTS` | your environment | Kept: glass adds its CA to yours for the run |

## Configuration file

`~/.glass/config.json` is optional. Its one setting replaces the list of hosts the daemon
decrypts:

```json
{
  "interceptHosts": ["copilot-api.*.ghe.com", "api.githubcopilot.com", "api.openai.com"]
}
```

`*` matches exactly one DNS label. The default list is `copilot-api.*.ghe.com`,
`api.githubcopilot.com`, `api.*.githubcopilot.com`, `api.openai.com`,
`api.anthropic.com`.

## Files

| Path | Content |
|---|---|
| `~/.glass/data/llm-proxy/token-usage.db` | Token rows (SQLite, table `token_usage`) |
| `~/.glass/data/measurements/` | Session records and context captures |
| `~/.glass/ca/` | The interception CA |
| `~/.glass/logs/daemon.log` | Daemon log |
| `~/.glass/daemon.json` | Running daemon's pid and port |

## Read API

The daemon serves JSON on `http://127.0.0.1:12445`: `/health`,
`/api/token-usage/summary`, `/api/token-usage/recent?limit=N`,
`/api/token-usage/cost`, `/api/context-turns?task_id=…`,
`/api/context-breakdown?task_id=…`, `/api/statusline`.
