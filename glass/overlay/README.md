# glass

> 📖 **Documentation: [aimaad-glass.pages.bmw.ghe.com](https://aimaad-glass.pages.bmw.ghe.com/)** — what glass does, with screenshots, architecture and reference.

Token measurement and context-window insight for coding agents — GitHub Copilot CLI,
OpenCode, pi and Claude Code. Put `glass` in front of the agent; it records every model
call's tokens (input, output, cache read / write) and what filled the context window
(system prompt, tools, history), and shows both in a local UI and a status line.

Everything stays on your machine. Nothing is sent anywhere except the agent's own
model calls, which go exactly where they went before.

## Requirements

- **Node.js ≥ 22.13** (`node --version`). No build tools, no Docker.
- Read access to [AIMAAD/glass](https://bmw.ghe.com/AIMAAD/glass) on bmw.ghe.com.
- The agents you want to measure, already logged in as usual: `claude`, `copilot`
  (the npm `@github/copilot` CLI, **≥ 1.0.93** — older builds, such as VS Code's bundled
  one, call the public Copilot host), `opencode`, `pi`.
- Optional: `tmux` (macOS, Linux, WSL) for the clickable status line.

## Install

With the GitHub CLI (once: `gh auth login --hostname bmw.ghe.com`):

```sh
gh release download --repo bmw.ghe.com/AIMAAD/glass --pattern 'glass-*.tgz'
npm install -g ./glass-*.tgz
glass doctor
```

Without it: download `glass-<version>.tgz` from the
[latest release](https://bmw.ghe.com/AIMAAD/glass/releases/latest) in the browser, then
`npm install -g ./glass-<version>.tgz`. In PowerShell or cmd, name the file:
`npm install -g .\glass-<version>.tgz`.

The tarball contains its two dependencies, so the install needs no npm registry and runs
no install scripts.

`glass doctor` lists the agents it found, the data directory, the corporate proxy it will
use and whether the daemon is running. A ✗ line says what to fix.

To update: `glass update` downloads the latest release with `gh` and installs it the same
way; `glass update --check` only says whether there is one. Your data is kept. A daemon
of the older version is replaced at once when that costs no running session (from 0.1.6
on, sessions survive the restart); running agents carry on with the new daemon. Without `gh`, install the newer tarball by hand as above.

## Use

```sh
glass claude                 # any agent, with any of its own arguments
glass copilot -p "explain this repo"
glass opencode
glass pi
```

The first run starts a small background daemon (it stops by itself after 30 minutes
without use). If the daemon cannot start, glass prints one warning and runs the agent
unmeasured — it never blocks your agent.

| Command | |
|---|---|
| `glass ui` | open the UI: Token Usage (overview, evolution, recent calls) and Sessions (per-session timeline, context explainer) |
| `glass status` | daemon, live sessions, latest rows |
| `glass watch` | a live one-line status bar for the newest session — for a split pane |
| `glass doctor` | check the setup |
| `glass stop` | stop the daemon; agents still running keep their sessions, which the next daemon picks up |
| `glass update [--check]` | install the latest release (needs `gh`); `--check` only reports |
| `glass help` | all commands and options |

**Status line.** With tmux installed, `glass <agent>` runs the agent in a tmux session
with glass's status bar: context gauge, tokens of this session, daemon state. Click a
field for details or to open the UI. `--no-tmux` (or `GLASS_NO_TMUX=1`) runs it in the
current terminal instead. Without tmux — native Windows, for instance — Claude Code
shows glass's line as its own status line (fields are clickable in Windows Terminal,
iTerm2 and VS Code); for the other agents run `glass watch` in a split pane
(`wt split-pane` in Windows Terminal).

## How it measures

- **claude** is pointed at the daemon with `ANTHROPIC_BASE_URL`; the daemon forwards to
  api.anthropic.com (or the base URL you had set) and records the usage.
- **copilot, opencode, pi** keep their own logins and endpoints. glass gives them
  `HTTPS_PROXY` = the local daemon and `NODE_EXTRA_CA_CERTS` = glass's own CA. The daemon
  decrypts only the model hosts (`copilot-api.*.ghe.com`, `api.githubcopilot.com`,
  `api.*.githubcopilot.com`, `api.openai.com`, `api.anthropic.com`), records the usage,
  and forwards the call unchanged. Every other connection is tunnelled untouched.
- **opencode providers on plain HTTP** (a local model server, another tool's proxy) never
  go through `HTTPS_PROXY`; for the run, glass points them at the daemon, which forwards
  each call to the original URL and records it.
- All of this is set **for that one run only**, through environment variables: no agent
  configuration, shell profile or system setting is changed.
- glass's CA is created on first use in `~/.glass/ca` and is **never added to any system
  trust store** — only the agent processes glass starts trust it.
- If your policy does not allow local TLS interception, use
  `glass <agent> --no-intercept`: copilot / opencode / pi then run unwired, and glass
  fills in what the agent's own session files report (fewer details than per call).
- **Corporate proxy:** the daemon reaches the model hosts through `HTTPS_PROXY` /
  `NO_PROXY` from your environment, as the agent would have. `glass doctor` shows which.

## Privacy and data

Everything glass stores is under `~/.glass` (`GLASS_HOME` to move it). The daemon
listens on 127.0.0.1 only. There is no telemetry.

| What | Where | Kept |
|---|---|---|
| One row per model call: time, agent, model, token counts, latency, session id, project name (the git checkout's folder name) and a short, redacted preview of the prompt | `data/llm-proxy/token-usage.db` | until uninstall |
| Session records: session id, agent, start / end, working directory | `data/measurements/<session>.json` | until uninstall |
| Context captures: per call, the size of each part of the context window plus redacted previews of the system prompt, tool descriptions and messages (up to 2 KB each) | `data/measurements/<session>/context-turns.jsonl`, `data/llm-proxy/context-breakdown/` | 7 days |
| glass's CA and its private key | `ca/` | until uninstall |
| Daemon log | `logs/daemon.log` | until uninstall |

- **Redaction** runs before anything is written: API keys (Anthropic, OpenAI, xAI, Groq,
  AWS, generic), bearer tokens, JWTs, credentials in URLs, e-mail addresses and
  corporate user ids are replaced by markers such as `<SECRET_REDACTED>`. It is pattern
  based — a secret in an unusual format can get through; do not paste secrets into
  prompts.
- **Credentials in transit:** the agents' own tokens pass through the daemon on their
  way to the model host. They are forwarded, never stored.
- Full request / response bodies are not stored.

## Uninstall

```sh
glass uninstall      # stops the daemon, deletes ~/.glass (asks first; --yes skips the question)
npm rm -g glass
```

Nothing is left outside `~/.glass`: CI checks exactly this on Linux and Windows
(`tests/install-check.mjs` — install, one measured run per agent, uninstall, then the
home directory must be byte-identical to before).

## Troubleshooting

- **`glass doctor` first.** It names a copilot that is too old, a missing agent, an
  unexpected proxy.
- **"daemon not reachable … running unmeasured":** see `~/.glass/logs/daemon.log`. Port
  12445 taken by something else → set `GLASS_PORT` to a free port.
- **An agent reports a certificate error:** run it with `--no-intercept` to confirm,
  then send the daemon log to the maintainers. If you already set `NODE_EXTRA_CA_CERTS`,
  glass adds its CA to yours for that run.
- **Next to another local LLM proxy** (coding, for instance): start glass from a
  terminal that tool's launcher did not set up. opencode providers on plain HTTP are
  relayed through glass and measured; if pi defaults to that proxy, add
  `--model <provider>/<model>` with one of pi's own providers. `glass doctor` warns
  about each.
- **No rows for copilot:** check `copilot --version` (≥ 1.0.93) and that `which copilot`
  (`where copilot` on Windows) is the npm CLI, not VS Code's bundled one.

## This repository is generated

Do not edit it by hand. Its content is extracted from `coding` and `rapid-llm-proxy` by
`scripts/glass/extract.mjs` (manifest: `glass/manifest.yaml` in coding).
`EXTRACTED.json` names the source commits and the checksum of every file, and CI fails
when the tree differs from it (`tests/provenance.test.mjs`). Changes go into coding or
the proxy, then a new extraction. A merge to `main` with a new version in `package.json`
publishes a release.
