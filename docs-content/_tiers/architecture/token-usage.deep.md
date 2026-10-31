## Overview

The Token Usage page provides real-time visibility into LLM token consumption across every cognitive process in the project. Every call through the LLM Proxy Bridge is logged with provider, model, process attribution, token counts, latency, and a prompt preview. The page makes it possible to spot runaway consumers, see provider mix at a glance, and force a specific service to a specific provider+model when auto-routing picks wrong.

**Dashboard URL:** [http://localhost:3032/token-usage](http://localhost:3032/token-usage)

![Token Usage — Overview tab](../images/health-mon-tokens-usage.png)

---

## Page layout

The page is organized into five tabs sharing a single header bar:

- **Summary cards** (always visible): Total Tokens (Total Cost in the € / $ view), Total Calls, Avg Latency per LLM call, and an Account card (consumption per billed account). Each card's title names the active **time window** — "Total Cost · Last 7 days" — because the Cost tab below follows the calendar month instead, and an unlabelled 24 h figure over a month's figure reads as a contradiction.
- **Tabs:** Overview · Evolution · Cost · Trials · Classes · Recent Calls · Routing.
- **Header actions:** **foreground / background** checkboxes (your agent conversations vs everything that runs on its own; applied server-side, so every figure on the page describes the same rows) · **Tokens · € · $** unit switch (see [Cost and the € / $ view](#cost-and-the-view)) · **Time window** dropdown (`Last 1h · 24h · 48h · 7 days · 30 days · All time`) · **Accounts** (see [Account selection](#account-selection)) · ⚙ Settings (opens the LLM Routing dialog) · ⟳ Refresh.

### Account selection

**Accounts** opens one checkbox per billed account: GitHub Copilot, Claude Max, the on-prem
model server and this laptop's local model, plus any other account with rows. All are on
by default. An unchecked account leaves every view on the machine: the cards, all four
tabs and the status line's cost field. The proxy applies the selection to every
token-usage read, so the dashboard and the status line cannot disagree. While anything is
left out the button reads *Accounts · 1 hidden*, so a filtered page is never mistaken for
the whole picture. The Cost tab's toolbar has the same button.

The selection is saved with the proxy's cost settings (`cost.excludeAccounts` in
`settings.json`). Excluding an account also drops the older spellings its rows carry,
for example `copilot` and `github-copilot` for GitHub Copilot.

### Time window selector

The window dropdown drives `?hours=` on the `/api/token-usage/summary` request. Every metric on the page except the Cost tab — summary cards, treemap, breakdowns, the Evolution chart, Recent Calls — re-aggregates for the chosen window; the Cost tab works in calendar months. The default is `Last 24h`. `All time` aggregates the full retained DB, starting at its first row — so while the DB is younger than 30 days, `Last 30 days` and `All time` show the same figures.

Bucket size for the stacked chart **adapts to the window** so the timeline never balloons past ~500 data points: 2-min buckets for `Last 24h`, 10-min for `48h`, 30-min for `7 days`, 2-hour for `30 days`, 6-hour for `All time`. The active bucket size is shown beneath the Evolution chart's title (e.g. *"Last 7 days · 30-minute buckets"*).

### Overview tab

The header cards plus two side-by-side panels:

![Token Consumption by Process](../images/health-mon-tokens-by-process.png)

- **Token Consumption by Process** — a treemap where larger rectangles mean more tokens, cache included (in the € / $ view, more cost — a different ranking, since a cheap model's big process is a small rectangle). **Hover any box** for a tooltip with process, total tokens, input/output split, call count, and avg latency — including the small boxes that don't fit an inline label. The same payload is also rendered as an SVG `<title>` element so screen readers and native-browser hover work even when the recharts tooltip is unavailable.
- **By Provider** — a donut chart split by billed account (`claude-code-max`, `gh-copilot`, local providers such as `qwen-local`), with a **By Provider / Model** list beneath it.
- **By Model** — the same totals broken down by canonical model name (`claude-haiku-4.5`, `claude-sonnet-5`, `claude-opus-5`). The proxy canonicalizes whatever spelling each upstream returns — `claude-sonnet-4-6` (Claude CLI dash-version), `claude-sonnet-4.6` (Copilot dot-version), `Claude Sonnet 4.6` (Anthropic title-case), bare `sonnet` (CLI fallback when `modelUsage` is empty), `claude-haiku-4-5-20251001` (Copilot dated snapshot) all collapse to the same row. The raw upstream identifier is preserved per call in the `model_raw` column.

### Evolution tab

![Evolution tab — stacked by process](../images/health-mon-tokens-evolution.png)

![Evolution tab — € by provider, month-to-date](../images/health-mon-tokens-evolution-detailed.png)

The Evolution tab answers "**how does my consumption evolve over time, and who are the main consumers?**" It renders an area chart across the selected window, with four controls at the top right of the card:

- **Stacked / Overlap** — bands stacked into a total, or each series drawn from the axis floor.
- **Per bucket / Month-to-date** — the amount per bucket, or each series as a running total that restarts on the 1st (UTC). Month-to-date counts from the 1st even when the window starts later: the run-up from the 1st to the window's left edge comes from a second, hourly summary, so a 24 h window starts at what was already spent this month.
- **Linear / Log** — a log axis reads a 75 K series next to a 400 M one. Log cannot stack (a stack encodes value as band height, which log does not preserve), so it forces Overlap; empty buckets draw as gaps.
- **Grouping** — the dropdown described below.

The second screenshot shows the € view by provider in Month-to-date mode.

#### Stack axis toggle

The dropdown at top-right of the chart card switches what each band represents. Same window, same data, four lenses:

| Mode | One band per | Use when |
|---|---|---|
| **By Process** *(default)* | Cognitive process (`observation-writer`, `wave-analysis-wave1`, `health-coordinator`, …) | Identifying which subsystem is driving consumption |
| **By Model** | Canonical model name (`claude-haiku-4.5`, `claude-sonnet-5`, `claude-opus-5`) | Assessing the model mix and per-model spend |
| **By Provider** | The **account** that gets billed (`claude-code-max`, `gh-copilot`, `anthropic-api`) | Seeing which account is serving the traffic — useful after routing changes, and the only view that separates flat-rate subscription spend from metered API spend |
| **Input / Output / Cache** | Fresh input, output, cache reads and cache writes | Seeing what the volume consists of — cache reads are usually the overwhelming majority of a foreground turn, and each part is priced differently |

![Evolution tab — By Model](../images/health-mon-tokens-evolution-by-model.png)

![Evolution tab — By Provider](../images/health-mon-tokens-by-provider.png)

![Evolution tab — Input / Output / Cache](../images/health-mon-tokens-evolution-by-in_out.png)

#### Design rules

- **Every series is shown.** There is no minimum share: a small series is often the one worth seeing — a local offload target taking on its first work is a fraction of a percent next to the subscription traffic. Pair it with the Log axis to read it.
- **Stable colors per process / model.** Canonical processes (`observation-writer`, `consolidator-digest`, etc.) keep the same color across every chart on the page via `PROCESS_COLORS`. Unmapped processes (e.g. `wave-analysis-wave1/wave2/wave3`) fall through to a deterministic **hash → SAFE_EVOLUTION_PALETTE** mapping — every key gets a stable slot across re-renders, never the all-gray fallback that used to make competing stacks indistinguishable. The same hash logic now drives the Overview Treemap and Recent Calls left-border, so the legend you learn here matches across every panel.
- **Adaptive bucket size.** Driven by the header time window. The bucket-minutes value is echoed in the card subtitle so the reader can sanity-check the granularity.

Below the chart, **Top Consumers** is a compact table showing each visible series's total tokens in the window plus its share bar — same data the chart stacks, but in tabular form so you can read exact totals without hovering through the chart.

### Recent Calls tab

![Recent Calls tab](../images/health-mon-tokens-recent.png)

Latest 50 calls across all processes. Columns: Time · Process · Provider · Model · In · Out · Latency · Preview. The **Preview** column shows the leading characters of the prompt with any XML wrapper tags (`<system-prompt>`, `<task>`, `<inputs>`, etc.) stripped — those wrappers swallowed most of the visible width before the fix and made the column unreadable.

---

## Where routing is actually configured { #llm-routing-settings-the-dialog }

![LLM Routing Settings dialog](../images/health-mon-tokens-config.png)

Routing lives in **two version-controlled YAML files** in the `rapid-llm-proxy` repo —
`config/llm-routing.yaml` (which provider and complexity band serves a given job) and
`config/llm-fallback.yaml` (what happens when that provider cannot). Both hot-reload on save.
[LLM Routing](llm-routing.md) documents the whole mechanism; the ⚙ button on this page opens
its editor.

!!! warning "Per-process pins no longer route anything"

    This section previously described the ⚙ dialog as pinning individual services to a
    provider and model, with those pins acting as a hard override. **That mechanism is dead.**

    The legacy surface is still there and still answers: `GET /api/llm/settings` returns 200,
    and `.data/llm-proxy/llm-settings.json` — note the filename, not `settings.json` — still
    holds 26 `processOverrides` entries. Nothing consults them.

    Demonstrated rather than asserted. The stored pin for `wave-analysis-wave1` is
    `copilot/claude-sonnet-4.6`; asking the proxy what it would actually do gives:

    ```console
    $ curl -s 'localhost:12435/api/llm/routing/resolve?job=bg-wave-analysis-wave1' | jq -r .summary
    bg-wave-analysis-wave1 (step 2) -> gh-copilot/claude-sonnet-5 > claude-code-max/claude-sonnet-5 > …
    ```

    A different provider and a different model, with `matchedKey: bg-wave-analysis-wave1` and
    `complexitySource: "route bg-wave-analysis-wave1"` — the YAML route, not the pin. Left in
    place rather than quietly deleted, because a stale file that still serves over HTTP is
    exactly the kind of thing someone rediscovers and trusts.

**Available providers** at the top of the dialog reflects the proxy's `/health` snapshot. Note
that this legacy endpoint still reports the **old provider spellings** (`claude-code`,
`copilot`, `anthropic`) while `llm-routing.yaml` uses the account names that replaced them
(`claude-code-max`, `gh-copilot`, `anthropic-api`). The two name the same accounts.

---

## Storage and the JSON-export pattern

The Token Usage page reads from a **two-store** setup that mirrors LSL's filesystem convention — git-trackable per-hour JSON files alongside an untracked SQLite WAL DB. Phase 36 moved the export away from a single monolithic JSON to a per-`(date, time-window, user-hash)` layout so multiple users sharing the project via git push their own hourly snapshots without merge conflicts:

| Path | Role | Tracked in git? |
|---|---|---|
| `.data/llm-proxy/token-usage.db` | SQLite WAL DB — authoritative locally | **No** — untracked (`*.db`, `.db-wal`, `.db-shm`, `.db-journal` all gitignored) |
| `.data/llm-proxy-export/YYYY/MM/YYYY-MM-DD_HHMM-HHMM_<hash6>.json` | Per-hour, per-user JSON snapshot | **Yes** — committed |

**Why both?** SQLite WAL files don't merge cleanly across machines; per-hour JSON files do. Teammates share token-usage history via `git pull`. Filename anatomy: the `HHMM-HHMM` time-window is the same one LSL uses (sourced from the health coordinator's `/health/state.lsl_meta.current_window` with a local fallback); the 6-char hex `<hash6>` is the deterministic per-user identifier exported by the proxy wrapper as `LLM_PROXY_USER_HASH` before `exec node`.

**Cross-user merge contract.** On every proxy boot, `hydrateFromExports()` walks `<baseDir>/**/*.json` and inserts every row with `INSERT … ON CONFLICT(user_hash, id) DO NOTHING`. After `git pull` brings down a peer's `..._<other-hash>.json` file, the next proxy kickstart ingests it and the peer's rows appear in your dashboard alongside yours. Cold-start hydration is always-on (no `count > 0 → return` early exit) — the composite unique index supplies idempotency, not skipping.

The schema is one `token_usage` table:

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Monotonic per-instance |
| `user_hash` | TEXT NOT NULL DEFAULT `'unknown'` | 6-char hex hash identifying the contributor. Together with `id` forms `UNIQUE INDEX idx_token_usage_user_id(user_hash, id)` — the cross-user merge key |
| `timestamp` | TEXT | ISO-8601 with ms + Z |
| `provider` | TEXT | The **account** that was billed — not the company. **Not a fixed enum**: the column has accumulated several spellings for the same account over time. A live count on this machine returns `copilot`, `claude-code` and `anthropic` (the older spellings) alongside `gh-copilot`, `claude-code-max`, `github-copilot`, and the local offload targets `qwen-local` / `qwen-laptop`. Normalise before grouping — `normalizeProvider()` in `src/lib/providers.ts` — or the same account appears as three rows. |
| `model` | TEXT | **Canonical** model name (`claude-haiku-4.5`, `claude-sonnet-5`, `claude-opus-5`). The proxy normalizes the upstream-returned spelling at the persistence boundary via `canonicalizeModelName()` so the dashboard's By-Model panel doesn't fragment across 8 spellings of 3 models. |
| `model_raw` | TEXT | The verbatim upstream spelling (`Claude Sonnet 4.6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, bare `sonnet`, etc.) — preserved for forensic debugging. Never used by the UI; queryable via `SELECT model_raw, COUNT(*) FROM token_usage GROUP BY model_raw`. |
| `process` | TEXT | Caller's `process` field; empty rows are labeled `unknown` |
| `subscription` | TEXT | `claude-max`, `github-copilot`, or the API-key tier name |
| `input_tokens` / `output_tokens` | INTEGER | `input_tokens` is **fresh (uncached) prompt tokens** on both wires — `openAIFreshInputTokens()` subtracts `cached_tokens` at the parse boundary so the OpenAI leg agrees with the Anthropic one |
| `total_tokens` | INTEGER | `input + output`. **Cache traffic is NOT included** — see the two columns below, which are additive to this one. Summing `total_tokens` alone understates a cache-heavy session, sometimes by more than two orders of magnitude |
| `cache_read_tokens` / `cache_write_tokens` | INTEGER | Prompt-cache traffic, additive to `total_tokens`. To display consumption, add them back — the dashboard's `allTokens()` helper is the canonical form |
| `reasoning_tokens` | INTEGER | Completion tokens spent thinking before any content is emitted. A reasoning model can show few `output_tokens` for a long, expensive call |
| `latency_ms` | INTEGER | Round-trip from request send to response close |
| `prompt_preview` | TEXT | XML-wrapper-stripped prefix (first ~120 chars) |
| `tokens_estimated` | INTEGER (0/1) | `1` when the proxy estimated tokens from text length because the provider returned 0 |

The table carries roughly thirty columns; the ones above are what the page's charts read.
The rest fall into three groups worth knowing about:

| Group | Columns | Answers |
|---|---|---|
| Attribution | `agent`, `task_id`, `tool_call_id`, `parent_call_id`, `granularity_tier`, `conversation_key`, `turn_index` | which agent, task and turn a call belongs to |
| Routing decision | `route_key`, `route_band`, `route_step`, `band_source`, `offloaded_from`, `chain_position`, `attempt_trail`, `routing_source` | why the call went where it did — see [LLM Routing](llm-routing.md) |
| Timing | `overhead_ms` | proxy-side cost on top of `latency_ms` |

`PRAGMA table_info(token_usage)` is the authoritative list; this page is a reader's selection
of it and will drift.

### Manual queries

```bash
# Total tokens today
sqlite3 .data/llm-proxy/token-usage.db \
  "SELECT SUM(input_tokens), SUM(output_tokens) FROM token_usage \
   WHERE timestamp > datetime('now', '-24 hours')"

# Top processes by token usage
sqlite3 .data/llm-proxy/token-usage.db \
  "SELECT process, SUM(total_tokens) AS total FROM token_usage \
   GROUP BY process ORDER BY total DESC LIMIT 10"

# Provider distribution
sqlite3 .data/llm-proxy/token-usage.db \
  "SELECT provider, COUNT(*), SUM(total_tokens) FROM token_usage GROUP BY provider"
```

---

## Architecture

![Token Usage architecture](../images/token-usage-architecture.png)

### Data flow

1. **Cognitive processes** (observation-writer, consolidator-digest/insight, wave-analysis agents, health-coordinator probes) send completion requests to the LLM Proxy Bridge (`:12435`).
2. Each request includes a **`process`** identifier. If a row in `/api/llm/settings` has a pin for that process, the proxy honors it; otherwise the auto-route runs.
3. The proxy routes to one of the five providers.
4. After completion, the proxy logs the call to the SQLite DB and schedules the debounced JSON export.
5. The Health Dashboard server (`server.js`) reverse-proxies `/api/token-usage/*` and `/api/llm/settings` to the proxy.
6. The frontend (`token-usage.tsx`) renders the four tabs from the aggregated data; the Settings dialog renders the LLM Routing dropdowns from the same source.

### Key files

| File | Role |
|---|---|
| `_work/rapid-llm-proxy/src/token-usage.ts` | DB schema + idempotent `user_hash` / `model_raw` ALTER, `logCall()`, `exportToHourFile()` (per-window debounced), `hydrateFromExports()` (always-on recursive walk), `backfillCanonicalModelNames()` |
| `_work/rapid-llm-proxy/proxy-bridge/server.mjs` | `/api/token-usage/{summary,recent}`, `GET/PUT /api/llm/settings`, `canonicalizeModelName()` + `MODEL_CANONICAL_MAP`, `currentWindow()` (30 s-cached fetch from `/health/state` with local fallback) |
| `_work/rapid-llm-proxy/bin/start-llm-proxy.sh` | Exports `LLM_PROXY_USER_HASH` (from `scripts/user-hash-generator.js`) and `LSL_TIMEZONE` before `exec node` |
| `scripts/health-coordinator.js` | Publishes `lsl_meta.current_window` (HHMM-HHMM, local-time) on `/health/state` — single source of truth for time-window |
| `scripts/migrate-token-usage-export.mjs` | One-shot, `--dry-run`, idempotent. Used once to bucket the legacy monolithic `.data/llm-proxy-export/token-usage.json` into the per-hour layout. |
| `integrations/system-health-dashboard/src/pages/token-usage.tsx` | Frontend page (tabs + Settings dialog); custom `TreemapTooltip` + SVG `<title>` fallback |
| `integrations/system-health-dashboard/server.js` | Reverse-proxy to the proxy |

---

## API endpoints

These are served by the proxy bridge; the dashboard's `server.js` proxies them through `:3033`.

### Summary

```
GET /api/token-usage/summary?hours=24[&bucketMinutes=N][&cells=1]
```

`cells=1` adds `cells` — one row per bucket × process × provider × model with fresh
input, output, cache read and cache write kept apart — and `local_providers`, the
providers that served an offloaded call. The € / $ view prices these (see
[Cost and the € / $ view](#cost-and-the-view)); without the flag the payload is unchanged.

Aggregates the trailing `hours` window. `hours` accepts an integer (e.g. `24`, `168`, `720`) or the literal sentinel `all` — the latter falls back to the full retained DB and clamps the timeline start to the earliest persisted row so wide windows don't emit thousands of empty buckets. `bucketMinutes` is optional; when omitted, the bucket size scales with the window (2 / 10 / 30 / 120 / 360 minutes for 24h / 72h / 7d / 30d / All).

Response shape (snake_case throughout, dashboard reads it directly):

```json
{
  "hours": 168,
  "bucket_minutes": 30,
  "total_calls": 2615,
  "total_input": 3920000,
  "total_output": 336000,
  "total_tokens": 4256000,
  "avg_latency_ms": 5830,
  "by_provider":     [{ "provider": "copilot",     "calls": 2250, "input_tokens": …, "output_tokens": …, "total_tokens": … }],
  "by_process":      [{ "process":  "observation-writer", "calls": 1280, "input_tokens": …, "output_tokens": …, "total_tokens": …, "avg_latency": … }],
  "by_model":        [{ "model":    "claude-sonnet-4.6", "calls": …, "total_tokens": … }],
  "by_subscription": [{ "subscription": "claude-max",    "calls": …, "total_tokens": … }],
  "by_hour":         [{ "hour": "2026-05-15T18:00:00.000Z", "input_tokens": 12400, "output_tokens": 860, "calls": 4 }],

  // Stacked series for the Evolution tab — pivoted so recharts can stack
  // columns directly (one row per bucket, one column per process / model).
  // `process_keys` / `model_keys` give the column order ranked by total
  // tokens descending.
  "process_keys":    ["observation-writer", "consolidator-insight", …],
  "model_keys":      ["claude-sonnet-4.6", "claude-haiku-4.5", …],
  "by_process_hour": [{ "hour": "2026-05-15T18:00:00.000Z", "observation-writer": 12400, "consolidator-insight": 0, … }],
  "by_model_hour":   [{ "hour": "2026-05-15T18:00:00.000Z", "claude-sonnet-4.6": 12400, "claude-haiku-4.5": 0, … }]
}
```

### Recent

```
GET /api/token-usage/recent?limit=50
```

```json
[
  {
    "id": 18342,
    "timestamp": "2026-05-15T19:24:01.412Z",
    "process": "observation-writer",
    "provider": "copilot",
    "model": "claude-sonnet-4.6",
    "input_tokens": 2700,
    "output_tokens": 142,
    "latency_ms": 5100,
    "prompt_preview": "coding # Session Logs (/sl) — Session Continuity Command Load and …"
  }
]
```

### Accounts

```
GET /api/token-usage/accounts
```

```json
{
  "accounts": [{ "account": "gh-copilot", "calls": 282089 }, { "account": "claude-code-max", "calls": 167425 }],
  "excluded": [],
  "writable": true
}
```

```
PUT /api/token-usage/accounts   (Content-Type: application/json)
{ "excluded": ["gh-copilot"] }
```

Saves the selection. `summary`, `recent` and `cost` then leave those accounts out; an
explicit `?exclude=a,b` on a read overrides the saved selection for that request, and
`?exclude=` reads everything.

### LLM routing settings

```
GET /api/llm/settings
```

Returns current pins plus reference data so the dialog can populate dropdowns without a second request:

```json
{
  "settings": {
    "observation-writer": { "provider": "copilot", "model": "claude-sonnet-4.6" }
  },
  "processes": ["observation-writer", "consolidator-digest", "health-coordinator", "..."],
  "availableProviders": ["claude-code", "copilot"],
  "allProviders": ["claude-code", "copilot", "openai", "groq", "anthropic"]
}
```

```
PUT /api/llm/settings   (Content-Type: application/json)
```

Replaces the entire pin map atomically; the proxy persists the document to `.data/llm-proxy/settings.json`.

---

## Cost and the € / $ view

**Tokens · € · $** in the page header switches every view — cards, Overview, Evolution,
Cost, Recent Calls — between tokens and money (remembered per browser). The Cost tab
repeats the € / $ part in its own toolbar, since the header is out of view once the tab is
scrolled; both drive the same setting, and with *Tokens* selected the Cost tab shows €.
Evolution's **Month-to-date** turns each series into a running total that restarts on the
1st (UTC), so a provider's spend reads as a rising line.

![Cost tab — one tile per account, the € / $ switch in the tab's toolbar](../images/health-mon-tokens-cost.png)

**Cost tab.** One tile per account used in the selected month: GitHub Copilot (spend,
month-end projection, budget, foreground / background), the Claude subscription as
*notional* API-equivalent cost, own hardware (this site's local providers and any offload
target) as free with what it saved, any metered API key at list price.

**Cost by month** stacks each calendar month's cost by account or by model. **Linear / Log**
switches the axis; on Log the bars stand side by side, because a stack's band heights mean
nothing on a log scale, and a month under a cent draws no bar. Hovering a month opens a card
listing each series largest first, zeros left out, with the month's total.

![Cost by month — hovering a month](../images/health-mon-tokens-cost-chart.png)

**Pricing.** Each row is priced by the account that served it:

| Account | Rate |
|---|---|
| GitHub Copilot | GitHub's per-model rates — the operator's measured `cost.copilotPrices`, then GitHub's rate card (`lib/cost/copilot-pricing.mjs`); fresh input, cache read and cache write each at their own rate — × the contract discount |
| Claude subscription, metered keys | API list prices (`cost.modelPrices`, family fallback) |
| Own hardware | 0 |

€ = USD ÷ `cost.currency.usdPerEur`; $ skips the FX. A contract discount
(`cost.discount.copilot`, e.g. `0.8` = 20% off), its on-screen name
(`cost.discountLabel.copilot`), measured Copilot rates (`cost.copilotPrices`) and budgets
(`cost.budgets`) are the operator's own and live in the proxy's saved settings
(`PUT /api/llm/settings`, or **Prices & Budgets** on the Cost tab) — the code ships none.

**Billing that changes.** `cost.periods` holds dated rules — a discount from one day to
another, per account, model family (`families`, by id prefix) or model (`models`), Copilot
rates in force then (`prices`), an FX (`usdPerEur`). Each row is priced on its own day (the
Cost tab reads day rows, `/api/token-usage/cost?by=day`); the most specific discount in
force wins, and at equal specificity the later entry. `lib/cost/billing-rules.mjs` is the
one reading of it — shape, precedence and examples in glass's *Token Usage* page,
"Billing that changes over time".

**Calibrating the Copilot rates.** When GitHub changes a rate, fit the rates again from
your itemized usage sheet, covering days this machine's token database also covers:

```bash
node scripts/cost/calibrate-copilot-prices.mjs --sheet=<…_consumption_source.json> [--min-days=5] [--json] [--into=FILE]
```

It reports each model's fitted level and cache-write share against the sheet, and each
month billed vs predicted. `--json` prints the `copilotPrices` block for
`PUT /api/llm/settings`; `--into` merges it into a cost file (with `--until`, as a dated
period). glass takes its cost file from a per-target `private_overlay` (glass's
*Development & Releases* page), so an organisation's billing reaches that target's build
only.

---

## Model trials { #model-trials }

A savings suggestion to move a background process to a cheaper model is a hypothesis, not
a decision: a cheaper model that drops details does not save anything. **Token Usage →
Trials** tests it on the process's real calls before anything switches.

- **Candidates** — the cheaper models the process can move to: every model its own account
  serves (`available_models` in `llm-routing.yaml`) plus own hardware (on-prem / on-device
  accounts), each only while the proxy can reach it. Another metered account is a different
  bill and is not offered. Each is priced on the process's own tokens of the last 7 days
  (mostly cache reads, so list prices would rank them wrongly) and listed cheapest first; a
  price that only resolves by model family is marked *est.*
- **Start** from a suggestion's *Start automatic trial* button, the breakdown table's
  *Trial cheaper*, or the Trials tab's form: process, candidates, share of calls, days and
  pairs per model at most. **Automatic** (the default) tries up to four candidates, leaving
  out any model a finished trial of the process already failed; or pick one model from the
  list (including one Automatic left out).
- **Automatic** — each sampled call goes to EVERY candidate still being tried, so their
  answers to the same request can be compared side by side (one pair per candidate, sharing a
  `requestId`; the request is stored once). That is one extra call per candidate per sampled
  call, and every candidate gets its pairs as fast as a one-model trial (default 3 days). A
  candidate that can no longer pass (more pairs worse than the pass rate allows) drops out;
  one dearer than a candidate that has passed stops. The **winner** is the first candidate,
  cheapest first, that passes. A provider that cannot answer at the moment sits the call out.
- **Side by side** — the pairs table has one row per sampled call and one column per
  candidate (verdict · details kept). An opened pair shows the current model on the left;
  column 2 steps through the candidates that answered the same call (‹ model chips ›), each
  with the judge's two readings.
- **Run** — the proxy answers every call with the current model as before. For the sampled
  share it ALSO sends the same request to the candidate afterwards, off the caller's path,
  and stores both answers (redacted) as a pair. The candidate's tokens are logged as process
  `model-trial-shadow` (route key `trial:<id>`), so a trial's cost is visible and never mixed
  into the process it judges.
- **Judge** — `bg-model-trial-judge` (Opus 5, the high band) reads each pair blind, twice
  with the order swapped, for details kept, nothing invented and specificity. A pair counts
  as equivalent only when both readings agree; a judge that follows position rather than
  content shows up as "disagrees with itself". Structural checks run beside it: the same
  output format, and the answer's units (insight blocks, JSON items, headed sections)
  paired by title or body.
- **Verdict** — per candidate: passes at ≥ 20 judged pairs, at least as good in ≥ 90% of
  them and keeping ≥ 90% of the incumbent's details (all per trial); the trial passes when
  one candidate does. The tab shows each pair
  side by side, unit by unit, with both readings and what each answer misses.
- **Accept** writes the winner (or a chosen candidate) into the process's route in
  `llm-routing.yaml` (`PATCH /api/llm/routing`): its band when it is the provider's band
  model, else a **model pin** (`routes.<key>.model`, which must be in the provider's
  `available_models`, holds only while the call stays on that provider, and is refused on a
  `from-caller` route). A candidate that has not passed needs an explicit confirmation.
  **Reject** leaves the route alone.

API on the proxy: `GET /api/trials`, `GET /api/trials/:id`, `POST /api/trials`
(`{ process, mode?: 'auto' | 'single', candidates: [{ provider, model }], samplePct?, days?,
maxSamples? }` — candidates cheapest first; the older `{ candidateComplexity,
candidateProvider? }` still works), `POST /api/trials/:id/stop | reject | accept`
(`{ candidate?: <index>, force?: true }`; default the winner). Store:
`<data>/llm-proxy/trials/<id>.json` and `<id>.samples.jsonl`; engine:
`rapid-llm-proxy/proxy-bridge/model-trials.mjs`. glass shows the same trials read-only.

The routing is in `llm-routing.yaml` only. The settings dialog's old `processOverrides`
are not read by the request path, which is why the former *Route to Haiku* button reported
"routed" and changed nothing; it is gone.

## Job classes { #job-classes }

**Token Usage → Classes** answers "what kind of job was each of my turns, and what does
each kind cost?" — the step before routing a kind of job to a cheaper model. The whole
mechanism, step by step, is the [job classes deck](../job-classes.md).

- **Labels** — the proxy's shadow tagger (`rapid-llm-proxy/proxy-bridge/job-class.mjs`)
  labels every foreground human turn once, in the background, with a cheap **student**
  model (Haiku 5.5) against a taxonomy: each class has a test, examples and a group
  (programming · operating · communicating). The **teacher**, a strong model (Sonnet 5)
  whose labels count as the right answer, labels a share of turns as well
  (`teacher_sample_pct`; every turn until each class has a gate verdict). Sub-agent and
  utility calls carry no job of their own and are skipped, and so are automated runs: a
  request bound to a task id (benchmark and experiment cells) or sent by headless
  `claude -p` (replays, tool probes). A label routes nothing by itself; see **Routing** below.
- **The tab** — a taxonomy picker (the default `config/job-classes.yaml`, or a team's
  shared one), then:
  - **Taxonomy and coverage**, as a **Tree** (group → class, each with its share of the
    turns) or a **Map** (classes by project, with the gaps the taxonomy cannot place);
  - **Gate** — per class, the student's precision against the teacher: a class passes at
    90 % over at least 20 teacher-checked turns, counted over the whole taxonomy version.
    Only a class that passes may later drive a route;
  - **By class** — turns, tokens and the student's agreement with the teacher per class;
  - **Recently labelled turns**, with the prompt preview (redacted).
- **Replay** — for a turn of a kept class (`job_classes.replay.keep`: `status`, `explain`)
  the tagger records the prompt as sent, the conversation before it and, when the next
  turn arrives, the answer that was read, all redacted, in one shape for every agent
  (`rapid-llm-proxy/proxy-bridge/turn-record.mjs`). At the turn's first call it starts
  `lib/job-classes/turn-capture.mjs`, which snapshots the repo before the turn's tools
  run. `coding job-classes replay candidates | run | report | evidence` re-runs such turns
  in a sandbox, in the agent that ran them, on the current model and on a cheaper
  candidate. Each arm is bound to a `jcr-` task, so it is not labelled, and it is served
  the model it asks for, on the route's own provider only. A blind judge compares the
  answers; ≥ 20 pairs at ≥ 90 % the same core answer pass for that class, agent and
  model, and the maintainer records the verdict as `evidence/<class>.json` in the team
  package.
- **Routing** — the class floor (`rapid-llm-proxy/proxy-bridge/class-floor.mjs`,
  `job_classes.routing` in `llm-routing.yaml`). Once a turn is labelled, its later calls
  (the tool loop and the answer; the first call is what triggers the label) go to the
  evidence's candidate model when all of these hold: the class passes the gate; a verdict
  in `evidence/<class>.json` beside the team's taxonomy still passes the judge's rule
  (≥ 20 pairs, ≥ 90 %, A/A floor not below), is for this agent, and was measured against
  the model the call would otherwise get; and the route's own provider serves the
  candidate in a lower band. The call keeps its provider and is never offloaded, and its
  row's `band_source` is `job-class`. pi, opencode and Copilot CLI only: Claude Code's
  `/v1/messages` is a passthrough and the proxy does not pick its model. Fail open:
  anything missing leaves the call as routed.
- **Teams** — a team may share its own taxonomy from a member's learning repo
  (`coding job-classes init` / `join`); its projects are labelled under it, and members
  grow it with `coding job-classes propose` and the maintainer's `fold`. A class merged
  away keeps its history: its labels count for the class it was merged into. Labels made
  under two different taxonomies are never counted together.

API on the proxy: `GET /api/job-classes` (the tagger's counters, `labelled` / `skipped`,
`replay`: turns pending and awaiting their answer, and `routing`: how often the floor
applied, per class, and why it declined),
`GET /api/job-classes/summary?days=7&taxonomy=<name>-v<n>` (tokens and agreement by class,
joined to `token_usage` on the turn identity), `GET /api/job-classes/coverage`. Store: the
`turn_job_class` table in the token DB. Plan: `.planning/shared-job-classes.md`.

**In glass** (machines without coding) the same tagger and read side run in glass's daemon,
opt-in: the student and teacher are the user's own Copilot account, reached with their `gh`
login; `glass job-classes measure` takes its prompts from the agents' own transcripts
(`lib/job-classes/prompts.mjs`) instead of the session logs, and shares the scoring with
`measure-job-classes.mjs` (`lib/job-classes/measure.mjs`); a team's taxonomy is joined by its
git URL. See glass's Job Classes page.

## Cognitive process reference

| Process ID | System | Description |
|---|---|---|
| `observation-writer` | Online Learning | Classifies and summarizes session events |
| `consolidator-digest` | Online Learning | Synthesizes daily digests from raw observations |
| `consolidator-insight` | Online Learning | Synthesizes insights from digests |
| `insight-generator` | Wave Analysis | Generates entity insight documents |
| `content-validator` | Wave Analysis | Validates and refreshes entity content |
| `wave1-analysis` | Wave Analysis | Batch code analysis agents |
| `reap-test` / `reap-final` / `reap2` / `reap-completes` / `reap-positive` / `reap-test-isolated` | Reaper test harness | Synthetic processes used by the reap-on-disconnect integration tests |
| `constraint-check` | Constraints | Evaluates semantic constraint rules |
| `health-coordinator` | Health Monitor | Liveness probe — minimal token count, high call frequency |
| `test` / `test-process` / `export-test` / `unknown` | — | Diagnostic or untagged callers |

A `process` of `unknown` means the caller did not send a `process` field. These rows are kept (they still consume tokens) but they should be eliminated by patching the caller — `unknown` is not a useful name in the Settings dialog.

---

## Troubleshooting

### No data showing

1. Verify the proxy bridge is up: `curl http://localhost:12435/health | jq`
2. Check the DB exists and has rows: `sqlite3 .data/llm-proxy/token-usage.db 'SELECT COUNT(*) FROM token_usage'`
3. Verify the proxy summary endpoint responds (the frontend hits it directly): `curl 'http://localhost:12435/api/token-usage/summary?hours=1' | jq '{total_calls, total_tokens, bucket_minutes}'`

### Refresh button stays busy

Watch the dashboard server logs: `docker logs coding-services 2>&1 | grep token-usage`. The button uses a fetch promise — if the proxy hangs (long-running CLI subprocess, etc.), the button stays in its busy state until the request times out or the proxy returns.

### "Unknown" rows in the table

Calls showing `process: "unknown"` come from callers that haven't been updated to pass a process identifier. The proxy bridge health checks used to show as `unknown` too — those have been retagged as `health-coordinator`. If you still see `unknown` rows after a fresh window, trace the call site with: `grep -r '"process"' integrations/ scripts/ observations/ | grep -v '\.test'`.

### Token counts showing 0

Some providers (particularly Copilot) don't always return token counts in the response body. The proxy estimates tokens from prompt/response text length (~4 chars per token) and sets `tokens_estimated = 1` so you can tell estimated from authoritative rows in a manual query.

---

## Related documentation

- [LLM Architecture](llm-architecture.md) — provider routing, subscriptions, fallback chains
- [Health Monitoring](health-monitoring.md) — system health dashboard overview
- [LLM CLI Proxy](../integrations/llm-cli-proxy.md) — the consumer-side view of the proxy
- [Observational Memory](../core-systems/observational-memory.md) — online learning pipeline
