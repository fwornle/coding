# TokenDbInsertShape

**Type:** Detail

[Architectural Patterns] Second-writer pattern: token-db.mjs writes into a SQLite database owned and primarily written by a separate daemon (rapid-llm-proxy), using namespaced identity (user_hash) and defensive schema probing to avoid conflicting with the owner's writes; Fail-closed ownership/security gate: identical uid-check-and-bail pattern (isOwnedByMe / ownedDbPath) applied independently to two different external file stores to prevent reading another user's session state; No-double-count provenance gating: BYPASS_PROVIDERS set (opencode-token-rows.mjs) and analogous logic implied for Copilot restrict adapter row reconstruction to only the traffic provably not already captured by the primary capture path (the proxy); Best-effort/never-throw write boundary: insertTokenRow() and ensureCacheColumns() catch all failures internally and degrade to a stderr diagnostic plus a boolean/no-op return, isolating adapter failures from the ingestion/LSL hot path; Schema-probe memoization: insertShapeFor(db) uses a WeakMap keyed by db handle to cache a one-time PRAGMA table_info probe result, trading schema-drift staleness for per-insert performance; Idempotent self-migration: ensureCacheColumns() unilaterally ALTER TABLEs a database it does not own, guarded by swallowed 'duplicate column' errors on every open; Hard-cutover / no-dual-write discipline: ObservationWriter.js explicitly forbids a feature-flag/dual-write compromise when migrating its own write path from SQLite to km-core, architecturally paralleling (but structurally separate from) the token adapters' single-source discipline

# TokenDbInsertShape — Technical Insight Document

## What It Is

TokenDbInsertShape refers to the schema-adaptive INSERT mechanism implemented in `lib/lsl/token/token-db.mjs`, centered on two cooperating functions: `insertShapeFor(db)` and `insertTokenRow()`. This mechanism determines, at runtime, which of two possible SQL INSERT shapes to use against the `token_usage` table — a 23-column `BASE_COLUMNS` form or an extended 30-column form that adds `ROUTING_COLUMNS` (7 additional columns) — depending on what schema is actually present in the target database. It is a child concept within the `TokenUsageAdapters` component, sitting alongside sibling adapters `CopilotEventsTail` and `OpencodeTokenRows`, all of which reconstruct or supplement token/observation data from third-party-owned stores rather than owning their own database.

## Architecture and Design

The defining architectural fact about TokenDbInsertShape is that `token_usage` is a database owned by an external process — the rapid-llm-proxy daemon — not by the adapter itself. `insertShapeFor(db)` handles this by probing `PRAGMA table_info(token_usage)` once per database handle, memoizing the result in a WeakMap keyed by the handle. This is a deliberate performance/staleness trade-off: probing schema on every insert would be prohibitively expensive on what is effectively a hot path (every token-consuming LLM call), but the WeakMap memoization means a schema migration performed by the proxy mid-process will not be observed until the adapter reopens the database. The design explicitly accepts this staleness window in exchange for avoiding a per-insert schema probe.

This "externally-owned, drifting contract" model is the opposite of how `ObservationWriter.js` treats its own km-core store (via `resolveKmCoreOntologyDir`), where the writer fully owns and constructs its schema. TokenDbInsertShape instead treats the schema as something that can silently degrade — the same adapter code will transparently fall back from 30 to 23 columns on an older or rolled-back proxy schema, with no migration or version check on the adapter side.

Compounding this, `ensureCacheColumns(db)` performs an idempotent self-migration on every `openTokenDb()` call, issuing `ALTER TABLE token_usage ADD COLUMN ... DEFAULT 0` statements wrapped in try/catch to swallow duplicate-column errors. This is an ownership inversion: a non-owning second writer unilaterally extends a shared table's schema. It works only because SQLite's ADD COLUMN with a DEFAULT is non-locking and backward-compatible with the proxy's own INSERTs — a pattern that would break under other schema-change types (renames, NOT NULL without default).

## Implementation Details

`insertTokenRow()` wraps the actual write in a bounded retry loop (`INSERT_ID_RETRY_ATTEMPTS=3`) around a non-atomic MAX(id)+1-then-INSERT sequence. Per the "WR-05 (re-review)" comment block, this retry logic is a regression fix replacing a prior version that silently dropped rows on constraint violations. The critical implementation detail is disambiguation: on a SQLITE_CONSTRAINT error, the code runs `SELECT 1 FROM token_usage WHERE user_hash = ? AND tool_call_id = ?` to determine whether the conflict is a legitimate dedup hit (same tool_call_id already recorded for that user_hash — drop silently, return false) or a lost id-allocation race against a concurrent writer (retry the seed-then-insert cycle). This works because `tool_call_id` provides an independent semantic signal that the raw SQLite error code cannot distinguish on its own.

A related implementation detail is the `DIRECT_ROUTING_SOURCE='direct'` sentinel. Previously, routing columns were left at SQL DEFAULT `''`, which caused opencode-on-github-copilot traffic to appear in dashboard aggregate totals but vanish from the "Recent decisions" table, since that UI filters on non-empty `routing_source`. The fix stamps an explicit non-empty sentinel rather than altering the UI filter, which also incidentally prevents rapid-llm-proxy's separate `backfill-routing-decisions.mjs` (which selects `WHERE routing_source = ''`) from mislabeling these rows as backfill candidates.

`BASE_COLUMNS` and `ROUTING_COLUMNS` are exported constants specifically so tests can assert against the canonical column list rather than a duplicated copy — an explicit anti-drift measure documented in code comments.

## Integration Points

TokenDbInsertShape is invoked by the sibling adapters within `TokenUsageAdapters`: `OpencodeTokenRows` (via `buildOpencodeTokenRows` in `opencode-token-rows.mjs`) and `CopilotEventsTail` both ultimately feed reconstructed rows through this insert path. `CopilotEventsTail`'s `tailEventsFile()` exposes an `onTokenRow` callback (added in a later "Phase 69 Plan 69-06 Task 1" addendum) that is structurally isolated from the pre-existing `onError`/`onSubagentStarted`/`onSubagentEnded` chain per the "D-08 failure isolation" rule — a token-write failure only produces a `[copilot-events-tail] onTokenRow threw (non-fatal)` stderr line, never crashing the older, more critical LSL capture path that is this module's parent concern.

Namespaced `user_hash` constants (cladpt, copadt, opnadt) tag rows by originating adapter, avoiding ID collisions with the proxy's own counter while doubling as provenance/audit markers. The no-double-count invariant (D-04) is enforced upstream in `OpencodeTokenRows` via the `BYPASS_PROVIDERS` gate, ensuring only traffic not already captured by the proxy reaches the insert shape at all.

## Usage Guidelines

Developers modifying `token_usage` schema-dependent code must remember that `insertShapeFor`'s WeakMap cache is per-process-per-handle — schema changes on the proxy side require reopening the database to be observed. Any new column additions should follow the `ensureCacheColumns` pattern (ADD COLUMN with DEFAULT) since it's the only migration style proven safe against the proxy's own concurrent writes; renames or NOT NULL constraints must not be added this way. Failure handling throughout this subsystem is "never-throw": both `insertTokenRow()` and `ensureCacheColumns()` degrade to stderr diagnostics and boolean/no-op returns rather than propagating exceptions, consistent with the isolation discipline seen in `CopilotEventsTail`'s D-08 rule. When adding new dashboard-visible fields, remember the `DIRECT_ROUTING_SOURCE` lesson: downstream UI filter semantics (e.g., non-empty checks) constitute an implicit contract on writers, and defaults should be chosen with that in mind rather than patching the UI later.


## Hierarchy Context

### Parent
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] copilot-events-tail.mjs implements a poll-based file tail (tailEventsFile, TAIL_POLL_INTERVAL_MS=200) over Copilot's `~/.copilot/session-state/<uuid>/events.jsonl` rather than an fs.watch()-based approach, explicitly choosing statSync polling per RESEARCH-copilot.md Option A1. The module's own comments flag a hard architectural limitation: Copilot CLI persists only `subagent.started`/`subagent.completed`/`subagent.failed` lifecycle bookends to disk, never the sub-agent's actual messages or reasoning — so buildStubObservation() synthesizes a 2-message user/assistant exchange from spawn metadata alone, and every resulting observation is stamped `lsl_incomplete: true` with a locked note (COPILOT_LSL_INCOMPLETE_NOTE), a deliberately accepted, permanent data-loss gap rather than a bug to fix.

### Siblings
- [CopilotEventsTail](./CopilotEventsTail.md) -- [LLM] copilot-events-tail.mjs's tailEventsFile() enforces a strictly forward-looking read model: on startup it captures fs.statSync(eventsPath).size as lastSize and explicitly documents that it will NOT process pre-existing content, deferring backfill entirely to a separate sweep module (Plan 51-04's scan-and-convert.mjs). This creates a hard architectural seam between two writers targeting the same observation store — the live tailer only sees bytes appended after its own startup, while historical content is someone else's job — and the module's comment explicitly calls this out as a deliberate D-Reuse boundary rather than an oversight, meaning a session that starts and completes entirely before the tailer's poll loop is even registered would be invisible to Path A and rely wholly on the sweep.
- [OpencodeTokenRows](./OpencodeTokenRows.md) -- [CGR] buildOpencodeTokenRows (function) in opencode-token-rows.mjs


---

*Generated from 10 observations*
