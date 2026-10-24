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

- **Token Consumption by Process** — one tile per agent, sized by tokens (or by cost in
  the € / $ view). glass names its
  measurements `token-adapter-<agent>` (a name inherited from the measurement code it is
  built from).
- **By Provider** — the account that was billed: `gh-copilot` (GitHub Copilot),
  `claude-code-max` (Claude subscription), `openai`, `anthropic`.
- **By Provider / Model** — tokens per model. Agents make side calls you never see:
  OpenCode, for instance, asks a small model (`gpt-5-mini` above) for a session title.

## Tokens, € or $

**Tokens · € · $** at the top switches the whole page — cards, Overview, Evolution, Cost
and Recent Calls — between tokens and money. Each row is priced by the account that
served it (see [How cost is calculated](#how-cost-is-calculated)), so the € view can rank
differently from the token view: a big process on a cheap model is a small tile.

## Evolution

![Token Usage evolution](images/ui-token-usage-evolution.png)

Tokens (or cost) over time in buckets, and below it the top consumers of the window
(calls, total, latency, share). Above: 30 days in €, stacked by provider, **month-to-date**.
Switch between *Stacked* and lines, linear and log scale, *Per bucket* and
*Month-to-date* — a running total per series that restarts on the 1st of each month, so a
provider's spend reads as a rising line — and grouping by process, model, provider, or
input / output / cache. Click a legend entry to hide it; drag the brush below the chart to
zoom into a time window.

## Cost

![Cost](images/ui-token-usage-cost.png)

One tile per account used in the selected month — at work usually GitHub Copilot alone,
sometimes with your own model server next to it:

- **GitHub Copilot** — spent this month, projected month-end, the budget bar when you set
  one, and the foreground / background split.
- **Claude subscription** — *notional*: what the same tokens would cost at API list
  prices. The subscription is flat, so this is not a bill.
- **Own hardware** (an [offload](offload.md) target) — free per token; the tile says what
  the same calls would have cost on GitHub Copilot.

Below: cost by month (by account or by model) and a breakdown of the month by agent,
model or account. The [status line](status-line.md)'s `GH €` field shows the Copilot tile's
figure and opens this tab.

### How cost is calculated

GitHub bills Copilot in AI credits ($0.01 each) per model and per token kind. glass
prices every recorded row with GitHub's per-model rates — fresh input, cache reads
(~0.1× input) and cache writes (~1.25× input) each at their own rate — built into
glass and refreshed with each release. On the OpenAI wire Copilot speaks, a cache write is
not reported separately; the rates already account for that.

If your organisation buys Copilot through a contract with a discount, or you want euros
at a fixed rate, put them in `~/.glass/cost.json`:

```json
{
  "discount": { "copilot": 0.8 },
  "discountLabel": { "copilot": "contract discount" },
  "currency": { "usdPerEur": 1.18 }
}
```

`discount` multiplies Copilot's token dollars (0.8 = 20% off); `€` divides by `usdPerEur`,
`$` does not. A build of glass can ship the same file as its default
(`config/cost-defaults.json`); yours wins. Without either, Copilot is priced at GitHub's
rates with no discount.

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
