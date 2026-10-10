## Reading the numbers

Every model call is one row with four token counts:

| Count | Meaning | Cost (relative) |
|---|---|---|
| **in** (fresh input) | Prompt tokens the provider processed from scratch | 1× |
| **cache read** | Prompt tokens served from the provider's prompt cache | ~0.1× |
| **cache write** | Prompt tokens written into the cache this turn | ~1.25× (Anthropic) |
| **out** | Generated tokens | highest per token |

The full prompt of a call is *fresh + cache read + cache write*. The header card's
"cached" figure is the cache reads; a high share means the agent re-used its context
cheaply.

## Overview

![Token Usage overview](images/ui-token-usage-overview.png)

- **Token Consumption by Process** — one tile per agent, sized by tokens. glass names its
  measurements `token-adapter-<agent>` (a name inherited from the measurement code it is
  built from).
- **By Provider** — the account that was billed: `gh-copilot` (GitHub Copilot),
  `claude-code-max` (Claude subscription), `openai`, `anthropic`.
- **By Provider / Model** — tokens per model. Agents make side calls you never see:
  OpenCode, for instance, asks a small model (`gpt-5-mini` above) for a session title.

## Evolution

![Token Usage evolution](images/ui-token-usage-evolution.png)

Tokens over time in buckets — above, an hour and a half of agents stacked by model, with
the tooltip on one bucket, and below it the top consumers of the window (calls, tokens,
latency, share). Switch between *Stacked* and lines,
linear and log scale, and grouping by process, model, provider, or input / output / cache. Click a legend entry to hide it;
drag the brush below the chart to zoom into a time window.

## Recent Calls

![Recent calls](images/ui-token-usage-recent.png)

The last 50 calls: time, agent, provider, model, fresh input, output, latency and a short
preview of the prompt. Previews are **redacted** before they are stored (keys, tokens,
e-mail addresses — see [Privacy & Data](privacy.md)).

## Filters

- **Time range** — last hour, 24 hours, 48 hours, 7 days, 30 days.
- **foreground / background** — glass measures your interactive agent sessions
  (foreground). Background is for processes that run without you; with glass it is
  normally empty.
- **Refresh** — the page also refreshes by itself.

## The same numbers elsewhere

- `glass status` prints the latest calls in the terminal.
- The [status line](status-line.md) shows the current session's totals.
- The token database is a SQLite file, `~/.glass/data/llm-proxy/token-usage.db`
  (table `token_usage`), if you want to query it yourself.

## Accuracy

glass reads the usage numbers from the provider's own response, so they are the numbers
you are billed on. Checked against each agent's own report:

| Agent | glass | Agent's own report |
|---|---|---|
| copilot | prompt 57,868 (cache read 28,572 · written 29,290) · out 438 | "↑ 57.9k (28.6k cached, 29.3k written) • ↓ 438" |
| pi | in 2,823 · out 43 | `--mode json` usage: input 2823, output 43 |
