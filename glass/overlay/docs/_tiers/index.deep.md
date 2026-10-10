## Why measure

A coding agent re-sends its whole context on every turn: system prompt, tool definitions,
the conversation so far. Most of the tokens you pay for are that context, not your
question. glass makes this visible per call, so you can see

- which agent, model and session used how many tokens;
- how large the context window was on each turn, and what filled it;
- how much of each prompt the provider served from its cache (cheaper, faster) and how
  much it had to process fresh;
- how two agents or models compare on the same task.

## How you use it

Prefix the agent with `glass`. Arguments pass through unchanged; the agent keeps its own
login, model choice and configuration.

```sh
glass claude
glass copilot -p "explain this repo"
glass opencode run "add a test for cart.js"
glass pi --model github-copilot/claude-haiku-4.5
```

The first command starts a small background process — the glass daemon — on
127.0.0.1. It records each model call and serves the dashboards (`glass ui`) and the
[status line](status-line.md). It stops by itself after 30 minutes without use.

| Page | What it shows |
|---|---|
| [Token Usage](token-usage.md) | Totals, trends and every call, by agent, provider and model |
| [Context Window](context-window.md) | Per session: each turn, what filled the window, cache reuse |
| [Comparing Runs (A/B)](comparing-runs.md) | Two runs of the same task, side by side |
| [Status Line](status-line.md) | Context gauge and session tokens in your terminal |

## What glass is not

- **Not a proxy you configure.** Nothing is changed in your shell, agent configuration
  or system settings; glass sets environment variables for the one agent run it starts.
- **Not a cloud service.** No telemetry, no account. Data lives in `~/.glass`.
- **No automated experiment runner.** glass measures runs you start; comparing them is
  described in [Comparing Runs](comparing-runs.md).

## Supported platforms

macOS, Linux, WSL and native Windows, with Node.js ≥ 22.13. No Docker, no build tools.
Linux and Windows are tested in CI on every change, including a full install → measure →
uninstall check; macOS is tested locally.

## Agents

| Agent | How glass measures it |
|---|---|
| Claude Code | `ANTHROPIC_BASE_URL` points it at the daemon |
| GitHub Copilot CLI (≥ 1.0.93) | Local TLS interception of the Copilot model host |
| OpenCode | Local TLS interception of its model hosts |
| pi | Local TLS interception of its model hosts |

[How It Works](architecture.md) explains both paths; [Privacy & Data](privacy.md) lists
what is stored.
