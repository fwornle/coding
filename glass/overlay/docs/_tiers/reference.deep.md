## All commands

| Command | Description |
|---|---|
| `glass <agent> [--no-intercept] [--no-tmux] [args…]` | Run `claude`, `copilot`, `opencode` or `pi`, measured. All other arguments go to the agent unchanged. Returns the agent's exit code. |
| `glass ui` | Open the UI (Token Usage, Sessions) in the browser |
| `glass browser [edge\|chrome\|default]` | The browser glass opens pages in; no argument shows it ([status line](status-line.md)) |
| `glass status` | Daemon state, live sessions, the latest recorded calls |
| `glass doctor` | Node version, data home, CA, egress proxy, each agent's path and version, daemon state, and warnings when another local LLM proxy or tmux session overlaps with glass. Exit code 1 when something needs fixing |
| `glass watch [--task <id>]` | A live one-line status bar for the newest session, or the given one |
| `glass job-classes [status\|on\|off\|measure\|join <url>\|pull\|leave]` | [Job classes](job-classes.md): switch labelling, measure your recent prompts (`--days N`, `--max N`), use a team's taxonomy. Without an argument, `status`: on or off, the Copilot account, then a **labeller** line (the teacher model; every turn until each class has a verdict, then 1 turn in N), a **second pass** line (every turn of a class still collecting checks, else the configured share), a **student** line (scored by `measure` only), the taxonomy, and what was labelled since the daemon started |
| `glass job-classes publish [--no-push]` | Share this machine's gate counts with the team: per class labelled / checked / agreed and the confusions, never a prompt, written to `job-classes/gate/<pseudonym>.json` in the joined team's repo, committed under the pseudonym and pushed with your git credentials (rebased once over a teammate's push). `--no-push` commits only. Needs a joined team and write access to its repo; unchanged counts change nothing ([Pooling the gate](job-classes.md#pooling-the-gate-with-your-team)) |
| `glass ab run\|list\|report` | [A/B experiments](comparing-runs.md): the same agent and prompt on two or more models, interleaved and repeated, checked by your command. `--before-trial "<cmd>"` runs before every trial in its copy (system shell, `GLASS_AB_EXPERIMENT`, `GLASS_AB_VARIANT`, `GLASS_AB_TRIAL`, `GLASS_AB_MODEL` set, output in `before.log`, `--before-trial-timeout` default 60 s); a non-zero exit fails the trial without running the agent or the check ([one server, two weights](comparing-runs.md#one-server-two-weights)). `glass ab help` for the options |
| `glass statusline [--format plain\|ansi\|tmux] [--task <id>]` | Print the status line once |
| `glass report ctx\|net [--task <id>]` | The context or network report (what a status-line click shows) |
| `glass stop` | Stop the daemon; open agent tunnels are closed, so it exits at once |
| `glass update [--check]` | Download the latest release with `gh` and `npm install -g` it, then replace an older daemon when no running session is lost. `--check` only reports. Exit code 1 when `gh` is missing or not logged in, or the download or install fails |
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
| `BROWSER` | Chrome on macOS, the system default elsewhere | `edge` or `chrome`: the browser status-line clicks and `glass ui` open, unless `glass browser` set one. On macOS tabs are re-used in it ([status line](status-line.md)); on WSL a path to a browser `.exe` also works |
| `HTTPS_PROXY`, `NO_PROXY` | your environment | The daemon's route to the model hosts (corporate proxy) |
| `NODE_EXTRA_CA_CERTS` | your environment | Kept: glass adds its CA to yours for the run |

## Configuration file

`~/.glass/config.json` is optional. Every key is:

```json
{
  "interceptHosts": ["copilot-api.*.ghe.com", "api.githubcopilot.com", "api.openai.com"],
  "githubHost": "github.example.com",
  "copilotQuota": true,
  "updateCheck": true,
  "browser": "edge"
}
```

- `interceptHosts` replaces the list of hosts the daemon decrypts. `*` matches exactly one
  DNS label. The default list is `copilot-api.*.ghe.com`, `api.githubcopilot.com`,
  `api.*.githubcopilot.com`, `api.openai.com`, `api.anthropic.com`.
- `githubHost` names the GitHub host whose Copilot quota the Cost tab shows. Without it,
  glass uses `GH_HOST`, then the host of the Copilot traffic it measured, then every host `gh` is logged in to (enterprise hosts before github.com), keeping the first with a metered Copilot account.
- `copilotQuota: false` stops the read of GitHub's own figure
  ([What the Copilot figure covers](token-usage.md#what-the-copilot-figure-covers)).
- `browser` is the browser status-line clicks and `glass ui` open: `edge` or `chrome`.
  `glass browser edge` writes it, `glass browser default` removes it. It wins over
  `BROWSER`.
- `updateCheck: false` stops the daemon asking for the latest release, and with it the
  update offer on the status line and in the UI ([Update](getting-started.md#update)).

## Job classes settings

`~/.glass/job-classes.json` (owner-only) is written by the Classes tab and
`glass job-classes`; you rarely edit it by hand:

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Label my turns |
| `teacherModel` | `claude-sonnet-5` | Labels with: the model that labels each turn, on your Copilot account |
| `studentModel` | `claude-haiku-5.5` | Scored by `glass job-classes measure` only; labels nothing live |
| `teacherSamplePct` | `0.1` | Second pass: the share of turns labelled a second time once a class has its 20 checks (until then every turn of the class). 0 to 1 |
| `reportSampleEvery` | `5` | After the gate: label 1 turn in N, each label counted N times. 1 to 50; 1 labels every turn |
| `team` | `null` | The joined team's repo URL and local clone (`glass job-classes join`) |

## Files

| Path | Content |
|---|---|
| `~/.glass/data/llm-proxy/token-usage.db` | Token rows (SQLite, table `token_usage`) |
| `~/.glass/data/measurements/` | Session records and context captures |
| `~/.glass/ca/` | The interception CA |
| `~/.glass/data/ab/<id>/` | An [A/B experiment](comparing-runs.md): `experiment.json`, and each trial's agent and check output |
| `~/.glass/logs/daemon.log` | Daemon log |
| `~/.glass/daemon.json` | Running daemon's pid and port |
| `~/.glass/run/copilot-quota.json` | GitHub's last month-to-date Copilot figure, and the host it came from |
| `~/.glass/offload.json` | [Offload](offload.md) settings (owner-only) |
| `~/.glass/.env` | the keys, owner-only: `CLUSTER_OPS_KEY` (the [cluster](cluster.md)'s gateways — also offload's, when offload targets a gateway), `CLUSTER_MON_KEY` (the status services), `OFFLOAD_KEY` (an offload endpoint outside the cluster); each optional |
| `~/.glass/cluster.json` | [Cluster](cluster.md) nodes and ports |
| `~/.glass/job-classes.json`, `job-classes/` | [Job classes](job-classes.md) settings (owner-only) and a joined team's taxonomy |
| `~/.glass/cost.json` | Optional: contract discount and FX for the € / $ views ([How cost is calculated](token-usage.md#how-cost-is-calculated)) |

## Read API

The daemon serves JSON on `http://127.0.0.1:12445`: `/health`,
`/api/token-usage/summary`, `/api/token-usage/recent?limit=N`,
`/api/token-usage/cost`, `/api/cost-defaults` (the merged cost settings),
`/api/context-turns?task_id=…`,
`/api/context-breakdown?task_id=…`, `/api/statusline`,
`/api/models?hours=N` and `/api/experiments/runs/<session id>/models` (the model mix, see
[Models & Accounts](models.md)), `/api/calls/unbound`, `/api/ab` and `/api/ab/<id>` ([A/B experiments](comparing-runs.md)), `/api/offload` (see
[Offload Easy Calls](offload.md) for its write calls), `/api/job-classes` and
`/api/job-classes/settings` ([Job classes](job-classes.md)). The job-classes writes —
`PATCH /api/job-classes/settings`, `PUT` / `DELETE /api/job-classes/team`,
`POST /api/job-classes/team/pull` and `POST /api/job-classes/team/publish`
(`{"push": false}` commits only) — are what the Classes tab and `glass job-classes` call.
