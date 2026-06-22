# Phase 69: Claude + Copilot Token Adapters — Research

**Researched:** 2026-06-22
**Domain:** Host-side token-spend ingestion from agent session logs (Claude Code JSONL, Copilot CLI events.jsonl) into the proxy-owned `token_usage` SQLite store, on the Phase-68 cross-agent contract.
**Confidence:** HIGH (all critical claims verified against live code + live daemon + live session logs in this session)

## Summary

Phase 69 writes Claude Code and Copilot CLI token spend into `.data/llm-proxy/token-usage.db` on the Phase-68 row contract (verified PASSED, 5/5). The storage surface, the single span reader, and the timestamp-join backfill all exist and are proven; this phase is a **new emission layer on top of locked Phase-51 parsers and Phase-68 readers** — not a new parsing or storage stack.

Three "Claude's Discretion" items were delegated to research with guardrails. All three are now resolved with concrete, reproducible evidence:

1. **Row write path → DIRECT `better-sqlite3` INSERT.** [VERIFIED: live concurrency test] The DB is in WAL mode (`journal_mode=wal`, confirmed on the live file) with `busy_timeout` defaulting to 5000ms per connection. I ran 50 concurrent INSERTs from a second process **alongside the running proxy daemon (PID 85655)** and got `ok=50 busy=0 err=0` in 6ms, read them back, and cleaned up. WAL explicitly permits one writer + many readers, and second-writer serialization is handled by `busy_timeout`. A new ingest endpoint is unnecessary and would add a network dependency to a best-effort local write. The reproducible test becomes a plan acceptance criterion (see Validation Architecture).

2. **Daemon packaging → EXTEND the Phase-51 supervisors** (emit token rows from the same JSONL pass), with the failure-isolation caveat documented below. The live watchers already tail the exact files, parse them, and have heartbeat/error-budget/SIGTERM lifecycle. A token-row emission callback is a small additive hook on the existing `onMessage`/`onSubagentEnded` paths. Dedicated daemons would re-walk the same files twice and double the launchd surface for no isolation benefit that a try/catch around the token write doesn't already provide.

3. **Copilot probe timing → ONE-TIME investigation baked into the adapter, re-probed on CLI version change.** [VERIFIED: live events.jsonl] The installed Copilot CLI is **v1.0.63** (not the v1.0.48 in CONTEXT.md). The newer CLI added `assistant.turn_start/message/turn_end` events, but **they still carry no per-turn token usage** — only `reasoningOpaque` (an encrypted blob). The ONLY token totals live in `session.shutdown.modelMetrics.<model>.usage`. So `per-session-aggregate` (D-04) remains the only viable tier even on the upgraded CLI. A runtime per-session probe would add complexity for an upgrade path that the data shows does not yet exist.

**Primary recommendation:** Build two thin token-emission modules (`lib/lsl/token/claude-token-rows.mjs`, `lib/lsl/token/copilot-token-rows.mjs`) that reuse the Phase-51 parsers for structure and the Phase-68 `dist/measurement-span.js` reader for `task_id`, INSERT directly via `better-sqlite3` with `busy_timeout` set, and wire them as additive hooks into the existing live watchers + sweep dispatcher. **Surface the Claude reasoning-token gap (below) to the user before locking D-01's per-reasoning-step row design** — it is the single highest-risk assumption in the phase.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Emit a **per-turn** row PLUS **distinct per-reasoning-step rows** for extended-thinking blocks. Reasoning rows carry `reasoning_tokens` **separate from** input/output, with `granularity_tier = 'per-reasoning-step'` (turn rows use `'per-turn'`). Matches ADAPT-01 literally — do NOT fold reasoning into the turn row.
- **D-02:** Sub-agent rows link to their parent turn via `parent_call_id`, derived from the existing `parent_session_id` linkage already computed by `lib/lsl/adapters/claude-jsonl-tree.mjs` (reuse its tree resolution, including the `isSidechain` first-record gate). Do not re-implement parent resolution.
- **D-03:** Live-tailed rows stamp `task_id` from the single `getActiveMeasurement()` reader at write time (in-window → span.task_id; out-of-window / no span → `''`). Completed-session sweep backfills `task_id` by timestamp-join against archived `.data/measurements/<task_id>.json` spans — reuse the join from `scripts/backfill-task-id-by-timestamp.mjs`. Read failures must never break ingestion (best-effort).
- **D-04:** Default/fallback granularity is `per-session-aggregate`, sourced from `session.shutdown.modelMetrics`. Per-turn rows are an *upgrade*, not the baseline. The adapter MUST enumerate the distinct event `type:` values and confirm whether per-turn usage payloads exist (the Phase-1 vocabulary check is a deliverable).

### Claude's Discretion (delegated to research/planning with guardrails — RESOLVED below)

- **Row write path** — direct `better-sqlite3` INSERT vs proxy ingest endpoint. **Guardrail:** validate SQLite single-writer/WAL concurrency against the live daemon; capture a WAL/concurrency test as acceptance criterion. → **RESOLVED: direct INSERT (test passed).**
- **Daemon packaging** — extend Phase-51 supervisors vs dedicated token-adapter daemons. **Guardrail:** parsing reuse is locked regardless; note the failure-isolation trade-off. → **RESOLVED: extend supervisors.**
- **Copilot probe timing** — one-time bake-in vs runtime per-session probe. **Guardrail:** D-04 aggregate fallback + vocabulary enumeration hold either way. → **RESOLVED: one-time bake-in, re-probe on CLI version change.**

### Deferred Ideas (OUT OF SCOPE)

- OpenCode proxy-route logging + Mastra instrumentation adapter → Phase 70 (ADAPT-03/04).
- Any per-turn Copilot upgrade work beyond confirming feasibility — bounded by what the installed CLI persists; if no per-turn payloads exist, per-turn is a documented upgrade path, not Phase-69 scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADAPT-01 | Claude Code token rows ingested from session JSONL `usage` blocks at `per-turn` granularity (plus `per-reasoning-step` rows for extended thinking), sub-agents linked via `parent_call_id`; live-tail + sweep. | `usage` block shape verified (below); `claude-jsonl-tree.mjs` supplies `parent_session_id` → `parent_call_id`; live watcher `claude-fs-watch.mjs` + sweep dispatcher are the two paths. **OPEN RISK:** Claude JSONL carries NO native reasoning-token field — see Open Question 1. |
| ADAPT-02 | Copilot CLI token rows ingested from `events.jsonl` at `per-session-aggregate`, with Phase-1 event-vocabulary check that upgrades to `per-turn` if per-turn usage payloads exist. | `session.shutdown.modelMetrics.<model>.usage` verified to carry `inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens`. Vocabulary check done in-session (below): per-turn events exist but carry NO usage → per-session-aggregate confirmed as the only tier. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Parse Claude session/sub-agent JSONL structure | Phase-51 parsers (`claude-jsonl-tree.mjs`) | — | Locked reuse target (D-02). Tree resolution already computes parent linkage. |
| Extract `usage` blocks → token counts | New Phase-69 emission module (host) | — | The Phase-51 parsers extract *exchanges/observations*, not token usage. New thin layer over the same files. |
| Resolve `task_id` (live) | Phase-68 `getActiveMeasurement()` via `dist/measurement-span.js` | — | Single reader (D-03). Importable host-side (proven by Phase-68 operator CLIs). |
| Resolve `task_id` (completed) | Phase-68 `backfill-task-id-by-timestamp.mjs` join | — | Single join (D-03). |
| Write token rows | Direct `better-sqlite3` INSERT (host, second writer) | — | WAL concurrency verified safe alongside proxy daemon. |
| Daemon lifecycle | Phase-51 launchd supervisors (extended) | sweep job (`sub-agent-sweep-job.sh`) | Live tier + completed-session sweep already wired to launchd. |
| Copilot aggregate extraction | New Phase-69 module reading `session.shutdown.modelMetrics` | — | The only place Copilot persists token totals. |

## Standard Stack

### Core (all already present — zero new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | `^11.7.0` (coding repo) / `^12.10.0` (proxy) | Synchronous SQLite writes from host scripts | [VERIFIED: package.json] Already the DB driver for `token-usage.db`; the Phase-68 backfill opens the DB with it directly. |
| Node `fs` / `readline` | stdlib | JSONL streaming | [VERIFIED: code] Phase-51 parsers use only stdlib for file reads. |
| `@rapid/llm-proxy` (local submodule, `dist/measurement-span.js`) | local | `getActiveMeasurement` / `resolveLiveTaskId` | [VERIFIED: dist exists + Phase-68 CLIs import it] Single span reader, importable host-side via `pathToFileURL` dynamic import. |
| Phase-51 parsers (`claude-jsonl-tree.mjs`, `copilot-events.mjs`) | local | JSONL structure + parent linkage | [VERIFIED: code] Locked reuse (D-02 / CONTEXT). |

### Supporting (existing infrastructure to extend)

| Asset | Purpose | When to Use |
|-------|---------|-------------|
| `lib/lsl/live/claude-fs-watch.mjs` | Live-tail of in-progress Claude sub-agent JSONLs | Add a token-emission hook on first-message read of each turn. |
| `lib/lsl/live/copilot-events-tail.mjs` | Live-tail of in-progress Copilot `events.jsonl` | Add a `session.shutdown` handler to emit the aggregate row. |
| `scripts/sub-agent-live-{claude,copilot}.mjs` | launchd supervisors (heartbeat + error budget) | Wire the token modules here, same as the ObservationWriter wiring. |
| `scripts/sweep-sub-agents.mjs` + `sub-agent-sweep-job.sh` | Completed-session sweep (30-min launchd interval) | Emit token rows for completed sessions during the same sweep pass. |
| `scripts/backfill-task-id-by-timestamp.mjs` | Host-side `better-sqlite3` open pattern + timestamp join | Copy the DB-open pattern; reuse the join for completed-session `task_id`. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct `better-sqlite3` INSERT | New proxy `/api/ingest-token-row` endpoint | Adds a network round-trip + proxy-coupling to a best-effort local write; the proxy is already the DB owner but WAL makes a second *local* writer safe. Rejected (test proves direct is safe). |
| Extend Phase-51 supervisors | Dedicated `token-adapter-{claude,copilot}` daemons | Better fault isolation (a token bug can't crash the LSL daemon) but doubles launchd jobs and re-walks the same files. Mitigation: wrap every token write in try/catch so a token failure never propagates into the LSL path. Rejected as default; revisit only if token writes prove flaky. |
| One-time Copilot probe | Runtime per-session capability probe | Auto-upgrade to per-turn if payloads appear — but live data (v1.0.63) shows per-turn events carry no usage, so the runtime probe would never fire. Rejected for now; the version-keyed re-probe covers a future CLI that adds per-turn usage. |

**Installation:**
```bash
# NONE — all dependencies already present (better-sqlite3, Node stdlib, local proxy dist).
```

**Version verification:** [VERIFIED: live] `better-sqlite3@^11.7.0` (coding `package.json`), `@^12.10.0` (proxy). Copilot CLI `1.0.63` (`copilot --version`). No new packages required.

## Package Legitimacy Audit

> Phase 69 installs **no external packages**. All dependencies (`better-sqlite3`, Node stdlib, the local `@rapid/llm-proxy` submodule dist) are already present and in use by Phase 68. Slopcheck N/A — nothing to install.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | — | No installs in this phase |

## The Phase-68 `token_usage` Contract (what adapters MUST populate)

[VERIFIED: live DB `PRAGMA table_info` + `src/token-usage.ts`]

Live column inventory (21 columns, in order):
```
id, timestamp, provider, model, process, subscription,
input_tokens, output_tokens, total_tokens, latency_ms,
prompt_preview, tokens_estimated, user_hash, model_raw, overhead_ms,
agent, task_id, tool_call_id, parent_call_id, granularity_tier, reasoning_tokens
```

The Phase-68 additive columns and their defaults (`token-usage.ts:551-556`):

| Column | Type | Default | Phase-69 value |
|--------|------|---------|----------------|
| `agent` | TEXT NOT NULL | `''` | `'claude'` or `'copilot'` |
| `task_id` | TEXT NOT NULL | `''` | live: `resolveLiveTaskId()`; completed: backfill join (D-03) |
| `tool_call_id` | TEXT NOT NULL | `''` | Claude: per-turn `requestId`/`uuid`; Copilot: `toolCallId` or model name |
| `parent_call_id` | TEXT NOT NULL | `''` | Claude sub-agent: parent turn's id derived from `parent_session_id` (D-02) |
| `granularity_tier` | TEXT NOT NULL | `''` | `'per-turn'` / `'per-reasoning-step'` / `'per-session-aggregate'` |
| `reasoning_tokens` | INTEGER NOT NULL | `0` | Claude: **NO native source** (see Open Question 1); Copilot: `modelMetrics.<model>.usage.reasoningTokens` |

**Composite PRIMARY KEY `(user_hash, id)`** — there is no AUTOINCREMENT. A host-side writer MUST supply `id` explicitly. The proxy does this via `handle.nextLocalId()` (a per-`user_hash` JS counter seeded from `MAX(id)+1`). A second-process writer must replicate the same `id` allocation: `SELECT COALESCE(MAX(id),0)+1 FROM token_usage WHERE user_hash = ?`, then increment locally per insert. **This is a real concurrency hazard** — two writers can pick the same `id`. See Pitfall 2 for the recommended mitigation (a distinct `user_hash` for adapter rows, e.g. `'cladpt'`/`'copadt'`, so the adapter's id-space never collides with the proxy's).

The existing fields the adapter must also populate sensibly: `timestamp` (ISO-8601 UTC), `provider` (`'claude-code'`/`'copilot'`), `model`, `process` (e.g. `'token-adapter-claude'`), `input_tokens`/`output_tokens`/`total_tokens`, `latency_ms` (0 if unknown), `prompt_preview` (''), `tokens_estimated` (0 for real usage payloads), `user_hash`, `model_raw`, `overhead_ms` (NULL).

### The single span reader (D-03)

[VERIFIED: `measurement-span.ts` + `dist/measurement-span.js` exists + Phase-68 operator CLIs import it]

- `resolveLiveTaskId(overrideDataDir?)` → returns `span.task_id` when a span is open, `''` otherwise. **Never throws.** This is the live-write resolver — call it once per row build.
- `getActiveMeasurement()` is the ONLY JSON parser of `active-measurement.json`. Do NOT add a second parser.
- Import pattern (copy from `scripts/measurement-start.mjs`): dynamic `import(pathToFileURL('<proxy>/dist/measurement-span.js'))`.
- `LLM_PROXY_DATA_DIR` resolves the data dir (default `/Users/Q284340/Agentic/coding/.data`); the span file is `<dataDir>/active-measurement.json`; archives are `<dataDir>/measurements/<task_id>.json`.

### The completed-session backfill (D-03)

[VERIFIED: `backfill-task-id-by-timestamp.mjs`]

- Opens the DB with `new Database(dbPath, { readonly, fileMustExist: true })`.
- `runSweep` issues `UPDATE token_usage SET task_id = ? WHERE task_id = '' AND timestamp >= ? AND timestamp <= ?` — lexical ISO-8601 comparison is chronologically correct.
- **Never overwrites** a live-stamped value (`WHERE task_id = ''`). Idempotent. Has a `--self-test` node:test fixture.
- **Reuse, do not re-implement:** after the sweep emits completed-session adapter rows with `task_id=''`, run this exact backfill (or import its `runSweep`) to stamp them.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
   Claude Code           │  Phase-69 token emission layer (NEW, host)  │
   writes session   ───► │                                             │
   JSONL (usage blocks)  │  claude-token-rows.mjs                       │
                         │   ├─ reuse claude-jsonl-tree.mjs (parent     │
   ~/.claude/projects/   │   │   linkage, isSidechain gate) [D-02]      │
     <cwd>/<uuid>.jsonl  │   ├─ extract usage{} per assistant turn      │
     .../subagents/...   │   ├─ build per-turn row (granularity=turn)   │
                         │   └─ [per-reasoning-step rows — SEE OQ-1]    │
                         │                                              │
   Copilot CLI           │  copilot-token-rows.mjs                      │
   writes events.jsonl   │   ├─ reuse copilot-events.mjs primitives     │
   ~/.copilot/           │   ├─ read session.shutdown.modelMetrics      │
     session-state/      │   └─ build per-session-aggregate row(s)      │
       <uuid>/           │       (one per model) [D-04]                 │
        events.jsonl     │                                              │
                         │            │                                 │
                         │            ▼                                 │
                         │  task_id resolution                          │
                         │   live    → resolveLiveTaskId() [single rdr] │
                         │   complete→ '' then backfill timestamp-join  │
                         │            │                                 │
                         │            ▼                                 │
                         │  direct better-sqlite3 INSERT                │
                         │   (busy_timeout=5000, distinct user_hash)    │
                         └────────────┬────────────────────────────────┘
                                      ▼
                  ┌──────────────────────────────────────┐
   proxy daemon   │  .data/llm-proxy/token-usage.db (WAL) │ ◄── proxy
   (writer #1) ──►│  token_usage  (21-col Phase-68 shape) │     writes
                  └──────────────────────────────────────┘     here too
                                      ▲
            ┌─────────────────────────┴──────────────────────┐
   LIVE path: extend claude-fs-watch / copilot-events-tail    │
   COMPLETED path: extend sweep-sub-agents.mjs (30-min job)   │
   wired via existing launchd supervisors (Phase-51)          │
```

A reader can trace: a Claude turn writes a `usage` block to JSONL → the live watcher's tail reads the new line → the token module extracts tokens + resolves `task_id` via the single span reader → INSERTs a `per-turn` row into the WAL DB the proxy also writes to.

### Component Responsibilities

| File (new or extended) | Responsibility |
|------------------------|----------------|
| `lib/lsl/token/claude-token-rows.mjs` (NEW) | Given a Claude JSONL path (or a tailed line batch), extract per-turn `usage` → `TokenUsageRow`-shaped objects; derive `parent_call_id` from `claude-jsonl-tree.mjs` tree for sub-agents. |
| `lib/lsl/token/copilot-token-rows.mjs` (NEW) | Given a Copilot `events.jsonl` path, find `session.shutdown.modelMetrics`, emit one `per-session-aggregate` row per model; run the vocabulary check. |
| `lib/lsl/token/token-db.mjs` (NEW) | Thin host-side `better-sqlite3` open + INSERT helper (busy_timeout, distinct user_hash, explicit id allocation, best-effort try/catch). Single place that touches the DB. |
| `lib/lsl/live/claude-fs-watch.mjs` (EXTEND) | Add optional `onTokenRow` callback alongside `onMessage`. |
| `lib/lsl/live/copilot-events-tail.mjs` (EXTEND) | Add a `session.shutdown` handler that emits the aggregate row. |
| `scripts/sub-agent-live-{claude,copilot}.mjs` (EXTEND) | Wire the token module + token-db into the supervisor, same as ObservationWriter. |
| `scripts/sweep-sub-agents.mjs` (EXTEND) | Emit completed-session token rows during the sweep pass; run the backfill join after. |

### Pattern 1: Best-effort host-side INSERT (mirror the proxy's `logCall`)

```javascript
// Source: derived from src/token-usage.ts:788-824 (logCall) + backfill open pattern
// lib/lsl/token/token-db.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ADAPTER_USER_HASH = 'cladpt'; // distinct id-space — see Pitfall 2

export function openTokenDb(dbPath) {
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma('busy_timeout = 5000');   // second writer MUST set its own
  // journal_mode is already WAL (proxy set it); harmless to re-assert
  return db;
}

export function insertTokenRow(db, row) {
  try {
    const next = db.prepare(
      `SELECT COALESCE(MAX(id),0)+1 AS n FROM token_usage WHERE user_hash = ?`
    ).get(ADAPTER_USER_HASH).n;
    db.prepare(`INSERT INTO token_usage (
      id, timestamp, provider, model, process, subscription,
      input_tokens, output_tokens, total_tokens, latency_ms,
      prompt_preview, tokens_estimated, user_hash, model_raw, overhead_ms,
      agent, task_id, tool_call_id, parent_call_id, granularity_tier, reasoning_tokens
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      next, row.timestamp, row.provider, row.model, row.process ?? 'token-adapter',
      row.subscription ?? 'unknown', row.input_tokens ?? 0, row.output_tokens ?? 0,
      row.total_tokens ?? 0, row.latency_ms ?? 0, row.prompt_preview ?? '',
      row.tokens_estimated ?? 0, ADAPTER_USER_HASH, row.model_raw ?? row.model, null,
      row.agent, row.task_id ?? '', row.tool_call_id ?? '', row.parent_call_id ?? '',
      row.granularity_tier ?? '', row.reasoning_tokens ?? 0
    );
  } catch (err) {
    process.stderr.write(`[token-adapter] insert failed (non-fatal): ${err.message}\n`);
  }
}
```
**What:** A single, best-effort, never-throws INSERT helper. **When to use:** every adapter row. **Why:** matches the proxy's own best-effort `logCall` discipline (D-03 — read/write failures never break ingestion).

### Pattern 2: Live `task_id` resolution via the single reader

```javascript
// Source: scripts/measurement-start.mjs import pattern + measurement-span.ts:256
import { pathToFileURL } from 'node:url';
const spanMod = await import(pathToFileURL(
  '/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist/measurement-span.js'
).href);
const task_id = spanMod.resolveLiveTaskId(); // '' when no open span; never throws
```

### Pattern 3: Copilot aggregate extraction (D-04)

```javascript
// Source: VERIFIED live events.jsonl — session.shutdown.data.modelMetrics
// One row per model. reasoningTokens present per-model (may be 0 or absent).
function rowsFromShutdown(evt /* parseCopilot'd session.shutdown */, ctx) {
  const mm = evt?.data?.modelMetrics || {};
  return Object.entries(mm).map(([model, m]) => ({
    agent: 'copilot', provider: 'copilot', model,
    input_tokens: m.usage?.inputTokens ?? 0,
    output_tokens: m.usage?.outputTokens ?? 0,
    total_tokens: (m.usage?.inputTokens ?? 0) + (m.usage?.outputTokens ?? 0),
    reasoning_tokens: m.usage?.reasoningTokens ?? 0,
    granularity_tier: 'per-session-aggregate',
    tool_call_id: model, // no per-turn id available at aggregate tier
    timestamp: evt.timestamp || new Date().toISOString(),
    ...ctx,
  }));
}
```

### Anti-Patterns to Avoid

- **Adding a second JSON parser for the active span.** D-03 + Phase-68 SC-4 mandate `getActiveMeasurement()` is the only parser. Import it; never re-read `active-measurement.json`.
- **Re-implementing parent resolution.** D-02 mandates reusing `claude-jsonl-tree.mjs`'s `parent_session_id` / `isSidechain` tree. Do not re-walk the subagents directory with new logic.
- **Sharing the proxy's `user_hash` id-space.** The proxy's `nextLocalId()` is an in-memory counter on the daemon; a host writer using the same `user_hash` races it. Use a distinct adapter `user_hash`.
- **Folding reasoning into the turn row for Claude.** D-01 forbids it. But note Claude has no reasoning-token source at all (OQ-1) — surface this rather than silently emitting `reasoning_tokens=0` rows.
- **Throwing out of the token write.** Best-effort only; a token-write failure must never break the LSL observation path (the failure-isolation caveat of extending the supervisors).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Claude parent/sub-agent linkage | New subagents-dir walker | `claude-jsonl-tree.mjs` (`parent_session_id`, `sub_index`, `isSidechain` gate) | D-02 locked; landmines #3/#8 already solved there. |
| `active-measurement.json` parsing | A second JSON reader | `resolveLiveTaskId()` / `getActiveMeasurement()` from `dist/measurement-span.js` | D-03 + Phase-68 SC-4: single reader, never-throws. |
| Completed-session `task_id` join | A new timestamp-window query | `backfill-task-id-by-timestamp.mjs` `runSweep` | D-03; idempotent, never-clobber, self-tested. |
| Copilot `events.jsonl` line parsing | A new JSONL parser | `parseCopilot` (TranscriptNormalizer) via `copilot-events.mjs` primitives | Locked reuse; handles the v1.0.x event shapes. |
| WAL concurrency / locking | A file-lock or mutex | `better-sqlite3` `busy_timeout` + WAL (already on) | Verified: 50 concurrent writes, 0 BUSY. SQLite handles writer serialization. |
| Daemon lifecycle (heartbeat, error budget, SIGTERM) | New daemon scaffolding | Extend `sub-agent-live-{claude,copilot}.mjs` | All lifecycle plumbing exists. |

**Key insight:** Phase 69 is an *emission layer*. Almost every hard problem (parsing, parent linkage, span reading, the join, concurrency, daemon lifecycle) is already solved and locked. The genuinely new code is small: extract token counts from already-parsed structures, allocate an id in a non-colliding namespace, and INSERT best-effort.

## Runtime State Inventory

> This is a new-feature phase (token-row emission), not a rename/refactor. No strings are being renamed and no stored data is being re-keyed. The one piece of *runtime state* that matters is the existing live DB and the running proxy daemon:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `token_usage.db` has 123,863 existing rows, ALL with `agent=''`, `granularity_tier=''` (proxy-internal rows). Adapters ADD new rows; they do NOT migrate existing ones. | None — additive only. |
| Live service config | Proxy daemon `com.coding.llm-cli-proxy` (PID 85655) is the established DB writer #1; it holds the DB in WAL mode. | Adapter is writer #2 — verified safe (concurrency test). |
| OS-registered state | launchd jobs `com.coding.sub-agent-live-{claude,copilot}`, `com.coding.sub-agent-sweep` exist and run. Extending them needs NO plist change if the token module is wired into the existing `.mjs` entry points; a plist edit is only needed if a NEW daemon is added (rejected approach). | If extending (recommended): no plist change. Re-`launchctl kickstart` after code change. |
| Secrets/env vars | `LLM_PROXY_DATA_DIR` (data dir), `LSL_CLAUDE_PROJECTS_DIR`, `LSL_COPILOT_SESSIONS_DIR` — all already set/defaulted. | None new. |
| Build artifacts | The proxy `dist/measurement-span.js` must be present (it is). If the proxy submodule is rebuilt, `dist/` regenerates — the adapter imports the same dist the daemon loads. | Verify `dist/measurement-span.js` exists before wiring (it does). |

## Common Pitfalls

### Pitfall 1: Claude has no reasoning-token field — D-01's per-reasoning-step rows have no data source
**What goes wrong:** D-01 mandates `per-reasoning-step` rows carrying `reasoning_tokens` separate from output. But [VERIFIED across 8 recent sessions, 999 usage records, 290 thinking blocks] the Claude session JSONL `usage` block contains ONLY: `input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cache_creation, server_tool_use, service_tier, iterations, speed, inference_geo`. There is **no `reasoning_tokens` / `thinking_tokens` field**. Thinking blocks have keys `["type","thinking","signature"]` — no token count. Reasoning tokens are folded into `output_tokens` by Anthropic and not separately reported.
**Why it happens:** Anthropic's API does not return a separate reasoning-token count for Claude (unlike OpenAI's `reasoning_tokens`). Copilot's wrapper *does* surface `reasoningTokens` (in `modelMetrics`), creating an asymmetry.
**How to avoid:** Surface this to the user BEFORE locking the per-reasoning-step row design (see Open Question 1). Options: (a) emit a `per-reasoning-step` row per thinking block with `reasoning_tokens=0` and `output_tokens` carrying an estimate, (b) drop per-reasoning-step rows for Claude and document the gap, (c) estimate reasoning tokens from thinking-block character count (`tokens_estimated=1`). This is a real decision the data forces — not a discretionary detail.
**Warning signs:** A plan that asserts "extract reasoning_tokens from the usage block" — there is nothing to extract.

### Pitfall 2: id collision between the proxy writer and the adapter writer
**What goes wrong:** The composite PK `(user_hash, id)` has no AUTOINCREMENT. The proxy allocates `id` via an in-memory `nextLocalId()` counter seeded from `MAX(id)+1` for its `user_hash`. A host writer using the same `user_hash` and re-reading `MAX(id)+1` can pick an id the proxy is about to use → `UNIQUE constraint` failure or a lost row.
**Why it happens:** Two independent writers, one counter each, same key space.
**How to avoid:** Give adapter rows a DISTINCT `user_hash` (e.g. `'cladpt'` / `'copadt'`, matching the `/^[a-z][a-z0-9]{5}$/` validation in `token-usage.ts:47`). Then the adapter's `MAX(id)+1 WHERE user_hash='cladpt'` never overlaps the proxy's `user_hash` space. Dashboards already group by `user_hash` for cross-peer merge, so a distinct hash is consistent with the schema's design. **Confirm the chosen `user_hash` with the user** (it affects how adapter rows appear in the existing Token dashboard).
**Warning signs:** Intermittent `SQLITE_CONSTRAINT_PRIMARYKEY` errors under concurrent load.

### Pitfall 3: Copilot CLI version drift invalidates the baked-in probe verdict
**What goes wrong:** The one-time probe verdict (v1.0.63 → no per-turn usage) is baked into the adapter. A CLI upgrade could add per-turn usage payloads, and a stale verdict would keep emitting only aggregate rows.
**Why it happens:** CONTEXT.md itself was already stale (said v1.0.48; live is v1.0.63).
**How to avoid:** Key the verdict on the CLI version string (`copilot --version` → `1.0.63`). On a version change, re-run the vocabulary check. Store the probed version + verdict in a small state file so the daemon logs a warning when the installed version differs.
**Warning signs:** `copilot --version` returns a version newer than the one the adapter last probed.

### Pitfall 4: Live-tail double-counting vs the sweep
**What goes wrong:** A session is partially captured live, then the completed-session sweep re-reads the whole file and re-emits the same turns → duplicate rows.
**Why it happens:** Two paths (live + sweep) over the same file, exactly as Phase-51's two-fix-paths design.
**How to avoid:** Dedup on a stable per-turn key. For Claude, the assistant record's `requestId` (e.g. `req_011Cc...`) or `uuid` is unique per turn — use it as `tool_call_id` and skip insert if a row with that `(agent, tool_call_id)` already exists. For Copilot aggregate, the session uuid + model is the natural key. The sweep should `INSERT ... WHERE NOT EXISTS` or check-then-insert.
**Warning signs:** Token totals roughly double after a sweep runs over a live-captured session.

### Pitfall 5: Copilot `modelMetrics` shape varies by model
**What goes wrong:** [VERIFIED live] Some `modelMetrics.<model>.usage` objects include `reasoningTokens`, others omit it entirely (e.g. `claude-sonnet-4.6` had no `reasoningTokens` key; `claude-sonnet-4.5` had `reasoningTokens:0`). Cache fields (`cacheReadTokens`, `cacheWriteTokens`) are present.
**How to avoid:** Default-coalesce every field (`m.usage?.reasoningTokens ?? 0`). Never assume a key exists.

## Code Examples

### Verified Claude `usage` block (per-turn source for ADAPT-01)
```jsonc
// Source: VERIFIED live ~/.claude/projects/.../c9b2882e-...jsonl assistant record
{
  "type": "assistant",
  "model": "claude-opus-4-8",
  "usage": {
    "input_tokens": 10895,
    "cache_creation_input_tokens": 14854,
    "cache_read_input_tokens": 15576,
    "output_tokens": 119,          // ← thinking tokens folded in here; NO separate field
    "service_tier": "standard",
    "iterations": [ /* per-iteration breakdown, same fields */ ]
  },
  "requestId": "req_011CcJ2a78f2BrXw29M2ZF9R",  // ← unique per turn → tool_call_id + dedup key
  "uuid": "ffd91946-...",
  "parentUuid": "b5f4f0c8-...",   // ← turn-level parent (within a session)
  "isSidechain": false             // ← sub-agent gate (D-02)
}
```

### Verified Copilot aggregate source (per-session-aggregate for ADAPT-02)
```jsonc
// Source: VERIFIED live ~/.copilot/session-state/.../events.jsonl
{
  "type": "session.shutdown",
  "data": {
    "shutdownType": "routine",
    "modelMetrics": {
      "claude-opus-4.6": {
        "requests": { "count": 8, "cost": 3 },
        "usage": {
          "inputTokens": 232866, "outputTokens": 1282,
          "cacheReadTokens": 203106, "cacheWriteTokens": 29750,
          "reasoningTokens": 115          // ← Copilot DOES surface this (Claude does not)
        }
      }
    }
  }
}
```

### Verified Copilot event vocabulary (the Phase-1 check, D-04)
```
// Source: VERIFIED live — distinct `type:` values across 3 recent sessions (CLI v1.0.63):
session.start, session.model_change, system.message, user.message,
assistant.turn_start, assistant.message, assistant.turn_end,
tool.execution_start, tool.execution_complete,
hook.start, hook.end, session.shutdown, abort
```
`assistant.message` carries `reasoningOpaque` (encrypted blob) + `toolRequests` but **NO token counts**. `assistant.turn_end` carries only `{turnId}`. → Per-turn token usage does NOT exist in v1.0.63. `per-session-aggregate` confirmed as the only viable tier.

## State of the Art

| Old Approach (CONTEXT.md assumption) | Current Reality (verified this session) | Impact |
|--------------------------------------|------------------------------------------|--------|
| Copilot CLI v1.0.48, lifecycle bookends only | Installed CLI is **v1.0.63** with `assistant.turn_*` + `tool.execution_*` events | Vocabulary richer, but still NO per-turn token usage → D-04 baseline unchanged. |
| Implied: Claude `usage` carries reasoning tokens | Claude `usage` has NO reasoning-token field; thinking folded into `output_tokens` | D-01 per-reasoning-step rows have no native data source (OQ-1). |
| Implied: a second writer needs a proxy endpoint | WAL + `busy_timeout` makes direct second-writer INSERT safe (50/50, 0 BUSY) | Direct INSERT approved. |

**Deprecated/outdated:**
- The v1.0.48 limitation note in `copilot-events.mjs` docstrings is stale (now v1.0.63) — the *conclusion* (no inner reasoning persisted at the sub-agent level; aggregate-only token data) still holds, but the version string and event list should be refreshed when touching that file.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Distinct adapter `user_hash` (`'cladpt'`/`'copadt'`) is the right id-collision fix and is acceptable in the dashboard's `user_hash` grouping | Pitfall 2 | If the dashboard treats unknown `user_hash` specially, adapter rows could be mis-grouped. Needs user confirmation. |
| A2 | `requestId`/`uuid` is a stable, unique per-turn dedup key across live+sweep | Pitfall 4 | If not unique, dedup fails → double-count. Verify against a multi-turn session before locking. |
| A3 | The chosen resolution for Claude's missing reasoning tokens (estimate / zero / drop) is a user decision, not researcher's call | OQ-1 / Pitfall 1 | Picking wrong → ADAPT-01 acceptance ("per-reasoning-step rows carrying reasoning_tokens") is unsatisfiable as literally written. |
| A4 | `process` value `'token-adapter-{claude,copilot}'` is acceptable (it appears in the Token dashboard's by-process breakdown) | Contract section | Cosmetic; low risk. |

**These are the decisions the planner/discuss-phase should surface to the user before execution.** A1–A3 are non-trivial.

## Open Questions

1. **Claude reasoning-token source for D-01's per-reasoning-step rows.** [HIGH IMPORTANCE]
   - What we know: Claude session JSONL `usage` blocks carry NO reasoning/thinking token count (verified across 8 sessions). Thinking blocks have no token field. `output_tokens` includes thinking. Copilot, by contrast, surfaces `reasoningTokens` in `modelMetrics`.
   - What's unclear: How to satisfy "per-reasoning-step rows carrying `reasoning_tokens` separate from input/output" (ADAPT-01 / D-01) when Claude provides no such number.
   - Recommendation: **Surface to the user.** Likely resolution: for Claude, emit per-reasoning-step rows with `reasoning_tokens` ESTIMATED from thinking-block content length and `tokens_estimated=1`, OR document that Claude per-reasoning-step rows carry `reasoning_tokens=0` (structural marker only) until Anthropic exposes the count. For Copilot, `reasoningTokens` is real but only at the aggregate tier — a per-reasoning-step row is not possible there either. The phase should NOT silently emit zero-token reasoning rows without an explicit user decision.

2. **Adapter `user_hash` choice and dashboard impact.** Does the user want adapter rows under a distinct `user_hash` (clean id-space, Pitfall 2) and how should they appear in the existing Token dashboard? (Confirm before locking the INSERT helper.)

3. **Live vs sweep dedup key.** Confirm `requestId` is present and unique on every Claude assistant turn (a quick multi-turn verification before the dedup design is locked).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `token-usage.db` (WAL) | All token writes | ✓ | 42 MB, WAL on | — |
| Proxy daemon (`com.coding.llm-cli-proxy`) | Writer #1 (coexistence) | ✓ | PID 85655 :12435 | — |
| `dist/measurement-span.js` | `task_id` resolution | ✓ | built | — |
| `better-sqlite3` | Host INSERT | ✓ | ^11.7.0 / ^12.10.0 | — |
| Copilot CLI | Vocabulary probe / version key | ✓ | 1.0.63 | — |
| `~/.claude/projects/<cwd>/` | Claude JSONL source | ✓ | live | — |
| `~/.copilot/session-state/` | Copilot events source | ✓ | live | — |
| launchd jobs (sub-agent-live-{claude,copilot}, sweep) | Daemon hosting | ✓ | loaded | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None — all infrastructure present.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (coding repo: `NODE_OPTIONS='--experimental-vm-modules' jest`); proxy repo: Jest. Also Node `node:test` for CLI self-tests (per `backfill-task-id-by-timestamp.mjs --self-test`). |
| Config file | coding `package.json` jest block; existing tests under `tests/live-logging/`. |
| Quick run command | `npx jest tests/live-logging/<file>.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| (guardrail) | **WAL concurrency: second-process INSERT alongside proxy → 0 BUSY** | integration | `node tests/token-adapters/wal-concurrency.test.mjs` (node:test) | ❌ Wave 0 |
| ADAPT-01 | Claude `usage` block → `per-turn` row with correct token counts | unit | `npx jest tests/token-adapters/claude-token-rows.test.js` | ❌ Wave 0 |
| ADAPT-01 | Sub-agent row gets `parent_call_id` from `claude-jsonl-tree.mjs` tree | unit | `npx jest tests/token-adapters/claude-parent-linkage.test.js` | ❌ Wave 0 |
| ADAPT-01 | Live `task_id` stamped from `resolveLiveTaskId()`; '' when no span | integration | `npx jest tests/token-adapters/claude-taskid.test.js` | ❌ Wave 0 |
| ADAPT-01 | Live+sweep dedup: same `requestId` not double-inserted | integration | `npx jest tests/token-adapters/dedup.test.js` | ❌ Wave 0 |
| ADAPT-02 | `session.shutdown.modelMetrics` → one `per-session-aggregate` row per model | unit | `npx jest tests/token-adapters/copilot-token-rows.test.js` | ❌ Wave 0 |
| ADAPT-02 | Vocabulary check enumerates event `type:` set; verdict keyed on CLI version | unit | `npx jest tests/token-adapters/copilot-vocab.test.js` | ❌ Wave 0 |
| ADAPT-01/02 | Best-effort: a corrupt span / locked DB never throws out of ingestion | unit | `npx jest tests/token-adapters/best-effort.test.js` | ❌ Wave 0 |

### The WAL/Concurrency Acceptance Test (guardrail → reproducible criterion)

This is the test the CONTEXT.md guardrail demands. It was prototyped in-session and passed (`ok=50 busy=0 err=0`). Make it a permanent fixture:

```javascript
// tests/token-adapters/wal-concurrency.test.mjs (node:test)
// Acceptance: a second-process writer INSERTs N rows alongside the live proxy
// daemon with ZERO SQLITE_BUSY, reads them back, and cleans up.
// Uses a sentinel agent='__waltest__' + distinct user_hash so it never
// pollutes real adapter rows. Open with busy_timeout=5000.
// PASS condition: ok===N && busy===0 && rowsReadBack===N && cleanup===N.
```
Run it against the real `.data/llm-proxy/token-usage.db` while `com.coding.llm-cli-proxy` is up (a true coexistence test), AND against a temp DB for CI portability.

### Sampling Rate
- **Per task commit:** `npx jest tests/token-adapters/<the-touched-file>.test.js`
- **Per wave merge:** `npx jest tests/token-adapters/` (whole adapter suite)
- **Phase gate:** full `npm test` green + the WAL coexistence test passing against the live DB before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/token-adapters/wal-concurrency.test.mjs` — the guardrail acceptance test (node:test) — covers the write-path discretion decision.
- [ ] `tests/token-adapters/claude-token-rows.test.js` — covers ADAPT-01 per-turn extraction.
- [ ] `tests/token-adapters/copilot-token-rows.test.js` — covers ADAPT-02 aggregate extraction.
- [ ] `tests/token-adapters/dedup.test.js` — covers live+sweep double-count guard.
- [ ] Shared fixtures: a sample Claude session JSONL with `usage` blocks + a sample Copilot `events.jsonl` with `session.shutdown.modelMetrics` (copy/redact real files captured this session).
- [ ] No framework install needed — Jest + node:test already present.

## Security Domain

> `security_enforcement` not explicitly disabled — included. This phase reads local agent session logs and writes a local SQLite DB; no network surface, no auth, no untrusted input beyond filesystem content.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface (local files + local DB). |
| V3 Session Management | no | N/A. |
| V4 Access Control | yes | Reuse the Phase-51 **uid-check gate** (`st.uid === process.getuid()`) before reading any session file — prevents traversal into another user's `~/.claude` / `~/.copilot`. Already implemented in the parsers; the token modules must honor the same gate (read only owned files). |
| V5 Input Validation | yes | JSONL lines are untrusted on-disk content — every `JSON.parse` must be try/caught and skipped on failure (the parsers already do this). Numeric token fields must be coalesced (`?? 0`) — a malformed `usage` must not write `NaN`/`null` into a NOT-NULL column. |
| V6 Cryptography | no | None. (Copilot `reasoningOpaque` is an opaque blob — never decode it; ignore it.) |

### Known Threat Patterns for {host-side SQLite writer reading local logs}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via log-derived strings (model name, task_id) | Tampering | **Parameterized statements only** (`?` placeholders) — never interpolate. The proxy + backfill already enforce this; the adapter MUST too. `task_id` is additionally charset-validated by `sanitizeTaskId` upstream. |
| Path traversal into another user's session dir | Information disclosure | uid-check gate + project-name allowlist (`/^[a-z0-9-]+$/`) — both inherited from the Phase-51 parsers. |
| Malformed JSONL crashing the daemon | DoS | try/catch around every parse + best-effort write; one bad line/file never aborts the pass (Phase-51 + backfill discipline). |
| id collision corrupting the shared DB | Tampering (integrity) | Distinct adapter `user_hash` (Pitfall 2) + composite-PK INSERT in a try/catch. |
| Writing `NaN`/`null` into NOT-NULL token columns | Tampering | Coalesce every numeric to a default; validate before INSERT. |

## Sources

### Primary (HIGH confidence — verified this session)
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts` — full `TokenUsageRow`, `insertStmt`, `logCall`, composite-PK + 6 attribution-column migrations.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/measurement-span.ts` + `dist/measurement-span.js` — `getActiveMeasurement`/`resolveLiveTaskId` single reader; barrel export confirmed importable host-side.
- `/Users/Q284340/Agentic/coding/scripts/backfill-task-id-by-timestamp.mjs` — host-side DB open + timestamp join + self-test.
- `lib/lsl/adapters/claude-jsonl-tree.mjs`, `lib/lsl/adapters/copilot-events.mjs`, `lib/lsl/live/{claude-fs-watch,copilot-events-tail}.mjs`, `scripts/sub-agent-live-{claude,copilot}.mjs`, `scripts/sub-agent-sweep-job.sh`, `lib/lsl/adapters/README.md`.
- `.planning/phases/68-foundational-token-attribution-storage/68-VERIFICATION.md` — Phase-68 contract (PASSED 5/5).
- **Live DB probe:** `PRAGMA journal_mode=wal`, `busy_timeout=5000`, 21-column schema, 123,863 rows all `agent=''`.
- **Live WAL concurrency test:** 50 concurrent second-process INSERTs alongside proxy PID 85655 → `ok=50 busy=0 err=0`, read back 50, cleaned up 50.
- **Live Claude JSONL probe:** 8 sessions, 999 usage records, 290 thinking blocks — NO reasoning-token field; `requestId`/`uuid`/`isSidechain` present.
- **Live Copilot probe:** CLI v1.0.63; event vocabulary enumerated; `session.shutdown.modelMetrics.<model>.usage.reasoningTokens` confirmed (sometimes 0/absent).

### Secondary (MEDIUM)
- launchd `launchctl list | grep com.coding` — daemon inventory; plist for `sub-agent-live-claude`.

### Tertiary (LOW)
- None — every load-bearing claim was tool-verified this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all assets read directly.
- Architecture / write path: HIGH — WAL concurrency empirically tested against the live daemon.
- Contract / column shape: HIGH — live `PRAGMA table_info` + source.
- Copilot tier: HIGH — live events.jsonl on the installed CLI (v1.0.63).
- Claude reasoning-token gap: HIGH (the *absence* is verified across 8 sessions); the *resolution* is an open user decision (OQ-1).
- Pitfalls: HIGH — id-collision and dedup derived directly from the verified schema + file shapes.

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 for the stack; ~7 days for the Copilot vocabulary claim (CLI auto-updates — re-probe `copilot --version` at plan time).
