---
id: v73-token-attribution-contract
created: 2026-06-05
status: ready-for-milestone-planning
tags: [v7.3, performance, token-attribution, adapter-contract, design-note]
feeds_into: /gsd-new-milestone v7.3
---

# v7.3 — Cross-agent token-attribution adapter contract

> Companion to [v73-perf-measurement-exploration](v73-perf-measurement-exploration.md).
> This note captures the architectural shape the milestone commits to so phase
> planning can act on it without re-deriving the design.

## Why a contract

The user requirement (per
[feedback-perf-measurement-requirements](../../.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_perf_measurement_requirements.md))
is per-step time-series token attribution covering all four supported agents
AND the proxy-routed background services, all on one timeline, all attributable
to a single task.

Without a contract, each per-agent adapter ends up inventing its own row
shape and the cross-agent query story breaks. The contract specifies one
row shape, one storage location, and one measurement-span convention that
all writers honour.

## Storage contract

**Persistence target:** `.observations/token-usage.db` SQLite (existing).

**Schema extension** — additive columns, no rename or type change:

```sql
ALTER TABLE token_usage ADD COLUMN agent             TEXT NOT NULL DEFAULT '';
ALTER TABLE token_usage ADD COLUMN task_id           TEXT NOT NULL DEFAULT '';
ALTER TABLE token_usage ADD COLUMN tool_call_id      TEXT NOT NULL DEFAULT '';
ALTER TABLE token_usage ADD COLUMN parent_call_id    TEXT NOT NULL DEFAULT '';
ALTER TABLE token_usage ADD COLUMN granularity_tier  TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_token_usage_task_id    ON token_usage(task_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_agent      ON token_usage(agent);
```

**Migration runs idempotently at service startup.** Pattern: query
`PRAGMA table_info(token_usage)`, skip any `ALTER` whose target column
already exists. Existing rows backfill to empty-string defaults — no
historical writers break.

**Granularity tier values** (controlled vocabulary):
- `per-session-aggregate` — one row covers the whole CA session
- `per-turn` — one row per assistant turn
- `per-llm-call` — one row per LLM API call (sub-agents and CA main calls both)
- `per-tool-call` — one row per tool invocation, with non-LLM tools carrying 0 tokens for route visualisation
- `per-reasoning-step` — one row per extended-thinking reasoning block, carrying `reasoning_tokens` separate from `input_tokens` / `output_tokens`. Applies to Claude extended-thinking models and any other agent that surfaces reasoning tokens as a distinct provider field. A run can mix `per-reasoning-step` rows (for thinking blocks) with `per-turn` rows (for non-thinking turns); the row's tier tags which kind.

**Reasoning-token column.** To carry the extended-thinking signal cleanly, the schema extension adds one more column alongside the others:

```sql
ALTER TABLE token_usage ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0;
```

Rows of tier `per-reasoning-step` populate this column with the provider's reasoning-token count; rows of other tiers leave it at `0`. Existing aggregate columns (`input_tokens`, `output_tokens`, `total_tokens`) retain their semantics — `total_tokens` does NOT auto-include `reasoning_tokens` to avoid double-counting in legacy queries; sum it explicitly when needed.

**Existing column semantics preserved:**
- `process` keeps its existing role (the service / agent name visible in the
  Tokens-tab Evolution chart). For CA adapters, `process` is the CA name
  (`"claude"`, `"copilot"`, `"opencode"`, `"mastra"`).

## Measurement-span contract

**Persistence target:** `.data/active-measurement.json` (single file, atomic
write via rename-from-tmp).

**Shape:**

```json
{
  "task_id":         "<uuid-v4>",
  "goal_sentence":   "<one-sentence outcome statement>",
  "started_at":      "<ISO 8601>",
  "ended_at":        "<ISO 8601 | null>",
  "snapshot_id":     "<RunSnapshot id from D1 infrastructure>",
  "agent_under_test": "claude | copilot | opencode | mastra",
  "framework":       "gsd-quick | gsd-full | freeform | null",
  "spec_level":      "one-liner | spec-md | spec-md-plus-adr | null"
}
```

**Lifecycle:**
- "Start measurement" writes the file (replaces any prior content).
- "Stop measurement" updates `ended_at` and renames the file to
  `.data/measurements/<task_id>.json` for archival.
- Crash recovery: if `ended_at` stays `null` for >24h, dashboard surfaces
  a "stale measurement span" warning and offers manual close.

**Reader SDK function:**

```ts
function getActiveMeasurement(): ActiveMeasurement | null;
```

Single source of truth; lives near `token-usage-logger.ts`. Callers do not
parse the JSON themselves.

## Per-agent adapter contract

Every adapter emits rows shaped:

```
{
  timestamp:         <ISO 8601, UTC>,
  provider:          <string — see per-agent provider tag below>,
  model:             <string>,
  process:           <agent_name — same as `agent` column>,
  agent:             "claude" | "copilot" | "opencode" | "mastra",
  task_id:           <getActiveMeasurement().task_id, or "" if outside span>,
  tool_call_id:      <agent-specific identifier, see below>,
  parent_call_id:    <parent session UUID + sub_hash + sub_index, see below>,
  granularity_tier:  <per-agent tier — see Granularity tier per agent>,
  input_tokens:      <number>,
  output_tokens:     <number>,
  total_tokens:      <number>,
  latency_ms:        <number>,
  subscription:      <optional, auto-derived from existing patterns>,
  prompt_preview:    <optional, truncated to 200 chars>
}
```

### Adapter sources per agent

- **Claude JSONL adapter** (`lib/lsl/adapters/claude-token-usage.mjs`,
  new). Reads `~/.claude/projects/<project-slug>/<session-uuid>.jsonl`.
  Extracts the `usage` block from each assistant message. Emits one row
  per assistant turn. Sub-agent JSONLs under `subagents/agent-<hex>.jsonl`
  emit their own rows linked via `parent_call_id`. Live-tail in-progress
  sessions; sweep completed sessions on adapter startup.
- **Copilot CLI adapter** — extends
  `lib/lsl/adapters/copilot-events.mjs`. Sweeps
  `~/.copilot/session-state/<uuid>/events.jsonl` for `session.shutdown`
  events; extracts `modelMetrics`; emits one row per model per session.
  Phase 1 verification check: if per-turn usage payloads are confirmed
  inside `model.request` (or similar) events, the adapter emits per-turn
  rows instead.
- **OpenCode proxy-route adapter** — does not parse OpenCode's local
  data directly. Instead, OpenCode is configured to route LLM calls
  through the proxy at `host.docker.internal:12435`. The proxy's existing
  `attachTokenLogger(llmService, "opencode")` records each call. The
  adapter work is the OpenCode-side configuration plus passing `task_id`
  via the proxy request envelope.
- **Mastra adapter** — Phase 1 read of `.opencode/mastra.json` identifies
  the instrumentation hook. Subsequent adapter design picks between
  per-step middleware, observer pattern, or framework-callback paths.

### Per-agent identifier conventions

| Agent | `tool_call_id` source | `parent_call_id` source |
|---|---|---|
| Claude | The assistant message UUID + ordinal of any `tool_use` block within it | Parent message UUID (`parentUuid`) chain |
| Copilot | `toolCallId` (stripped of `toolu_vrtx_` prefix) per `lib/lsl/adapters/copilot-events.mjs:104` | Parent session UUID + `sub_hash` (first 7 chars) + `sub_index` |
| OpenCode | Proxy request UUID | Parent OpenCode session.id + `sub_index` from `lib/lsl/adapters/opencode-sqlite.mjs:318-319` |
| Mastra | TBD (Phase 1) | TBD (Phase 1) |

These conventions mirror the existing Phase 51 LSL adapters so cross-agent
sub-agent linkage is consistent with prior work.

### Provider tag

- Claude: `provider = "anthropic"`, `model` from `usage`-adjacent metadata
- Copilot: `provider = "github-copilot"`, `model` from
  `session.shutdown.modelMetrics` key
- OpenCode (via proxy): `provider = "github-copilot"` (since the API
  endpoint is Copilot); `model` from OpenCode's config or response
- Mastra: TBD

## task_id resolution rules

- **Active span, in-window row** — adapter stamps the row with
  `task_id = activeMeasurement.task_id`.
- **Active span, out-of-window row** — adapter stamps `task_id = ""`.
  Background-noise; visible in the Tokens-tab Evolution chart but not in
  the Performance tab's task-anchored view.
- **No active span** — adapter stamps `task_id = ""`.
- **Span opens AFTER a row is written** (e.g., the adapter sweeps an
  already-completed Copilot session) — backfill via timestamp join at
  sweep time. The adapter compares the row's `timestamp` to all
  `.data/measurements/*.json` and stamps the matching `task_id` if the
  row falls inside `[started_at, ended_at]`.
- **Span closes mid-call** — the row is stamped with the
  `task_id` active at the moment the LLM call completed (not started).

## Sub-agent linkage

`parent_call_id` is the canonical cross-agent linkage. Format:

```
<parent_session_uuid>:<sub_hash>:<sub_index>
```

- `parent_session_uuid` — the top-level CA session UUID.
- `sub_hash` — first 7 chars of the sub-agent identifier (matches Phase 51
  conventions across all four agent adapters).
- `sub_index` — ordinal among siblings within the parent session.

For root-level (non-sub-agent) calls, `parent_call_id = ""`.

A query like:

```sql
SELECT * FROM token_usage
WHERE task_id = ?
ORDER BY timestamp ASC;
```

returns the complete task trace — main conversation rows, sub-agent rows,
and background-service rows — in execution order, with `parent_call_id`
allowing tree reconstruction.

## Granularity tier per agent (initial)

- **Claude**: `per-turn` (verified by JSONL `usage` block per assistant
  message). When extended thinking is enabled and the JSONL carries a
  distinct reasoning-tokens field, the adapter also emits `per-reasoning-step`
  rows linked to the parent turn via `parent_call_id`.
- **Copilot**: `per-session-aggregate` (verified). Upgrade to `per-turn`
  is conditional on the Phase 1 events.jsonl event-vocabulary check.
- **OpenCode**: `per-llm-call` (via proxy interception). When OpenCode
  routes through a reasoning-capable model, the proxy emits a `per-reasoning-step`
  row for any response carrying reasoning-token metadata.
- **Mastra**: TBD (Phase 1).

Comparison queries that need apples-to-apples granularity filter on
`granularity_tier`. The dashboard's Performance tab shows the tier of each
run as a badge so users do not over-interpret cross-tier averages. Rows
of tier `per-reasoning-step` are surfaced as a stacked sub-band under the
parent turn in the timeline view so the reasoning cost is visible without
inflating the turn-level totals.

## Out of scope for this contract

- Token-attribution-row deletion / TTL policies. Existing `token_usage`
  store retains indefinitely; the milestone preserves that behaviour.
- Cost-in-currency conversion. Tokens stay as token counts; currency
  conversion belongs to the policy work in v7.3.
- Cross-task aggregation reports beyond saved `Report` queries. Phase 9
  workflow handles that.

## Cross-refs

- [Note: v73-perf-measurement-exploration](v73-perf-measurement-exploration.md) — D6 documents the per-agent ingestion path table
- [Memory: feedback-perf-measurement-requirements](../../.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_perf_measurement_requirements.md) — source of the per-step time-series requirement
- [Spike: copilot-proxy-interception](../spikes/copilot-proxy-interception.md) — survey evidence
- `integrations/mcp-server-semantic-analysis/src/utils/token-usage-logger.ts` — store + write path to extend
- `lib/lsl/adapters/{claude-jsonl-tree,copilot-events,opencode-sqlite,mastra-ndjson}.mjs` — Phase 51 adapter patterns; sub-agent identifier conventions to reuse
- `~/.config/opencode/opencode.json` — OpenCode model + provider config; evidence for OpenCode-via-Copilot path
- `.opencode/mastra.json` — Mastra integration entry point
