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

#### Billing that changes over time

A contract discount starts and ends, a promotion covers one model or a model family for a
few months, GitHub changes a model's rate, the FX you book at moves. Each of these is a
dated entry under `periods` in the same file:

```json
{
  "discount": { "copilot": 0.8 },
  "currency": { "usdPerEur": 1.18 },
  "copilotPrices": { "claude-sonnet-5": { "in": 2.5, "out": 10, "cacheRead": 0.2, "cacheWrite": 2.5 } },
  "periods": [
    { "from": "2026-03", "to": "2026-06", "discount": 0.9, "note": "before the contract" },
    { "from": "2026-05-01", "to": "2026-05-31", "families": { "claude-opus": 0.5 }, "note": "Opus promotion" },
    { "from": "2026-07-01", "models": { "gpt-5-mini": 1 } },
    { "to": "2026-09-30", "prices": { "gpt-5.4": { "in": 6, "out": 30, "cacheRead": 0.6, "cacheWrite": 6 } } },
    { "from": "2026-01-01", "to": "2026-03-31", "usdPerEur": 1.1 }
  ]
}
```

| Key | Meaning |
|---|---|
| `from`, `to` | first and last day, both included, UTC — `YYYY-MM-DD`, or `YYYY-MM` for a whole month; leave one out for open-ended |
| `account` | whose discount the entry sets: `copilot` (the default), `claude-max`, … |
| `discount` | the factor for every model of that account |
| `families` | a factor per model family, by id prefix: `claude-opus` covers `claude-opus-5` and `claude-opus-4.8` |
| `models` | a factor per model id |
| `prices` | GitHub Copilot's rates in force then, USD per 1M tokens (per token kind) |
| `usdPerEur` | the FX in force then, for every account |
| `note` | free text, shown in coding's Prices & Budgets dialog |

`copilotPrices` (outside `periods`) are standing Copilot rates — the ones fitted from your
own usage sheet; a model without one prices at GitHub's rate card.

Every row is priced on its own day. For its discount the **most specific** rule in force
wins: a `models` entry, then the longest `families` prefix, then an entry's `discount`, then
the standing `discount`. A factor replaces the broader one rather than multiplying it: for a
20% promotion on top of a 20% contract, write `0.64`. Where two entries of the same kind
overlap, the one listed later wins; `~/.glass/cost.json`'s entries come after the build's.
A Copilot rate comes from the latest entry with `prices` for the model, then
`copilotPrices`, then GitHub's rate card; the FX from the latest entry with `usdPerEur`,
then `currency`.

A mistyped entry is skipped rather than guessed, so prices fall back to the standing values:
`glass doctor` lists every entry it cannot read. The Cost tab's header names the discount
and FX in force for the month shown and how many dated rules there are.

### What the Copilot figure covers

![Agents started with glass and coding's background jobs pass glass call by call, VS Code's Copilot Chat is read from its history afterwards; glass prices them and sets them next to GitHub's own month-to-date count for the account, which also covers agents started without glass, other machines and github.com.](images/glass-copilot-coverage.png)

| Copilot usage | How glass sees it |
|---|---|
| Copilot CLI, OpenCode or pi started as `glass <agent>`, in any terminal (VS Code's integrated terminal too) | every call, on the wire |
| coding's background jobs, where coding is installed and its figures are included ([Accounts and sources](#accounts-and-sources)) | every call, as **background** |
| VS Code's Copilot Chat (chat, agent mode) on this machine | read from VS Code's chat history — **estimated** |
| The same agents started without `glass` in front, other machines, github.com | only in GitHub's total |

**VS Code.** glass stays out of VS Code's way: no proxy, no certificate, no extension. While
the daemon runs it reads the chat sessions VS Code keeps
(`…/Code/User/workspaceStorage/*/chatSessions`) every 15 minutes. They record each
request's model and prompt and output size, not the cache split and not every tool-call
round, so glass estimates: what the prompt grew by since the previous request is fresh
input, the rest a cache read. Checked against what Copilot charged for eight requests,
the estimate came out 21% low. These rows count as foreground, agent `vscode`.

**GitHub's own figure.** The Copilot tile also shows what GitHub itself counts for the
account this month — the number behind "Credits n% used" in VS Code's Copilot menu,
every client included — and the difference to what glass measured: the part glass did not
see. glass asks `gh api /copilot_internal/user` (the endpoint VS Code calls) every 15
minutes while the daemon runs; `gh` sends its own login, glass never reads a token. It
needs `gh` logged in to your GitHub host. glass finds the host by itself: from the Copilot
traffic it measures, else by trying each host `gh` is logged in to (enterprise hosts first)
until one has a metered Copilot account. `{ "githubHost": "<host>" }` in
`~/.glass/config.json` names it outright, and `{ "copilotQuota": false }` switches the read off. The endpoint is
internal to GitHub, so it may change; then the tile says the figure is unavailable.
Without `gh`, or without a login, glass measures and prices exactly as before — only this
line and `glass update` are missing. `glass doctor` says which: whether `gh` is there,
which hosts it is logged in to, and what became of the last read.

When measured comes out **above** GitHub's figure, the per-model rates run high for your
mix of models; the tile says so instead of showing a negative remainder.

## Recent Calls

![Recent calls](images/ui-token-usage-recent.png)

The last 50 calls: time, agent, provider, model, fresh input, output, latency and a short
preview of the prompt. Previews are **redacted** before they are stored (keys, tokens,
e-mail addresses — see [Privacy & Data](privacy.md)).

## Filters

- **Time range** — last hour, 24 hours, 48 hours, 7 days, 30 days.
- **foreground / background** — glass measures your interactive agent sessions
  (foreground). Background is for processes that run without you: empty with glass
  alone, coding's own jobs when its figures are included (see below).
- **Refresh** — the page also refreshes by itself.

## Accounts and sources

**Accounts** at the top (and in the Cost tab) opens one checkbox per account, all on by
default. An unchecked account leaves every view: cards, charts, Cost, Recent Calls, the
Models tab and the status line's `GH €` field, which disappears with GitHub Copilot
unchecked. The button reads *Accounts · 1 hidden* while anything is left out. The
choice is saved in `~/.glass/cost.json` as `"excludeAccounts": ["gh-copilot"]`.

**Sources** in the same dialog lists the figures glass can add to its own, each where it
exists on the machine:

- *coding's figures*, where [coding](https://github.com/fwornle/coding) is installed too.
  coding's proxy records the machine's other LLM traffic, such as its own background work
  and agents started without glass, so glass's figures alone read low next to the
  account's bill. Checked (the default), the usage views add coding's calls. A call glass
  forwards through coding's proxy is recorded by both tools; it is counted once.
  Unchecking it saves `"includeCoding": false`.
- *VS Code's Copilot Chat*, once glass has read a request from VS Code's chat history.
  Those rows are estimates (see [What the Copilot figure covers](#what-the-copilot-figure-covers)),
  not calls measured on the wire. Checked (the default), they count; unchecking it saves
  `"includeVscode": false` and leaves them out of the same views.

The Cost tab names what is counted, e.g. *glass + coding + VS Code chat*, or *glass
sessions* with both unchecked.
The Sessions tab and the status line's session fields always show glass's own sessions.

glass finds coding's token database under `~/.coding/data/` and only reads it; the
`GLASS_CODING_TOKEN_DB` environment variable of the daemon names another file.

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
