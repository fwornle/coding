# TokenDbWriter

**Type:** Detail

[Architecture Notes] token-db.mjs is documented as 'the ONLY host-side file that touches the proxy-owned .data/llm-proxy/token-usage.db' — a single choke point for all second-writer access to that database, consumed by both copilot-events-tail.mjs and opencode-token-rows.mjs; Ownership boundary is enforced by convention (fileMustExist: true, never creating the DB, not re-asserting journal_mode) rather than by a shared contract or schema-version check between the proxy process and the adapter module; Failure isolation is a repeated top-level design decision (D-08 in token-db.mjs; D-08 again in copilot-events-tail.mjs's onTokenRow callback) — token/accounting code is architecturally subordinate to, and walled off from, the primary LSL/observation pipeline it instruments; Column-list drift is guarded against by exporting ROUTING_COLUMNS from token-db.mjs so tests assert against the live list rather than a copy, an explicit anti-duplication decision called out in the module's own comments; opencode-token-rows.mjs depends directly on token-db.mjs's exported constants (ADAPTER_USER_HASH_OPENCODE, DIRECT_ROUTING_SOURCE), making token-db.mjs a shared foundation module rather than a leaf consumer within the second-writer subsystem

# TokenDbWriter — Technical Insight Document

## What It Is

TokenDbWriter is implemented in `lib/lsl/token/token-db.mjs`, and it is documented as "the ONLY host-side file that touches the proxy-owned `.data/llm-proxy/token-usage.db`" — a single choke point through which all second-writer access to that SQLite database must pass. It sits underneath its parent component, **TokenUsageAdapters**, providing the low-level write mechanics (row insertion, schema discovery, connection opening) that the adapter subsystem needs to reconstruct token-accounting rows for calls that bypassed the primary rapid-llm-proxy pipeline. Both sibling components, **CopilotEventsTailWatcher** (`copilot-events-tail.mjs`) and **OpencodeTokenRows** (`opencode-token-rows.mjs`), depend directly on TokenDbWriter's exports — including `ADAPTER_USER_HASH_OPENCODE` and `DIRECT_ROUTING_SOURCE` — making it a shared foundation module rather than a leaf consumer within the second-writer subsystem.

## Architecture and Design

The dominant architectural pattern is **second-writer / compensating-write**: rather than intercepting network calls, TokenDbWriter patches gaps in an otherwise-authoritative pipeline after the fact. This is inherently lossy and best-effort, and the code repeatedly treats failure isolation as a first-class design decision (D-08), ensuring token/accounting concerns never propagate errors into the primary observation pipeline.

Several other patterns compound this core design: **runtime schema discovery** via `insertShapeFor()`, which probes `PRAGMA table_info(token_usage)` and memoizes the result per-database-handle in a WeakMap to decide between the base 23-column INSERT and an extended 30-column INSERT with `ROUTING_COLUMNS`; **optimistic concurrency with disambiguated retry** in `insertTokenRow()`, which loops up to `INSERT_ID_RETRY_ATTEMPTS` (3) times around a non-atomic `SELECT MAX(id)+1` then `INSERT`; **idempotent additive migration** via `ensureCacheColumns()`, which unconditionally runs `ALTER TABLE ADD COLUMN` on every `openTokenDb()` call; **sentinel-value attribution** via `DIRECT_ROUTING_SOURCE`; and **namespace partitioning via synthetic keys** (`ADAPTER_USER_HASH_CLAUDE`/`COPILOT`/`OPENCODE`) that isolate id spaces per writer within one shared table.

Underlying all of this is a deliberate ownership boundary: TokenDbWriter opens the database with `fileMustExist: true` (never creating the DB itself) and sets only a per-connection `busy_timeout = 5000`, explicitly declining to re-assert `journal_mode = wal` because "the proxy owns the global pragma." This is a pattern of minimal, additive intervention rather than exclusive control — the module behaves as a well-mannered guest on a resource it does not own.

## Implementation Details

`insertTokenRow()` is the most structurally interesting function: its retry loop recomputes `NEXT_ID_SQL` on every attempt, and its own WR-05 re-review comment acknowledges the race — a concurrent writer into the same `user_hash` space between SELECT and INSERT triggers `SQLITE_CONSTRAINT` on the composite `(user_hash, id)` primary key. Rather than failing hard, the catch block runs a secondary disambiguation query (`SELECT 1 FROM token_usage WHERE user_hash = ? AND tool_call_id = ? LIMIT 1`) to distinguish a genuine duplicate (return false, drop) from a lost-id race (retry with a fresh id). This conflates two distinct failure semantics into one exception branch keyed off the SQLITE_CONSTRAINT error-code prefix — brittle if a future schema change adds another unique index.

`insertShapeFor()` memoizes its PRAGMA probe per better-sqlite3 Database handle and decides whether to emit `BASE_COLUMNS` alone or `BASE_COLUMNS` plus `ROUTING_COLUMNS` (route_key, route_band, route_step, offloaded_from, chain_position, attempt_trail, routing_source). This schema-drift-defensive coding exists because TokenDbWriter does not own the schema it writes into — that belongs to the proxy process (`_work/rapid-llm-proxy/src/token-usage.ts`).

`DIRECT_ROUTING_SOURCE` ('direct') is a deliberately invented sentinel, distinct from the proxy's own `'live'`/`'backfill'` values, fixing a traced bug where the routing dashboard's "Recent decisions" view filtered on non-empty `routing_source`, silently hiding adapter-written rows left at the schema default `''`.

`ensureCacheColumns()` runs two `ALTER TABLE ... ADD COLUMN` statements wrapped individually in try/catch on every `openTokenDb()` call, swallowing "duplicate column" errors so repeated execution is a no-op — making the adapter co-responsible for migrating a schema it doesn't own.

Notably, the module's `require('better-sqlite3')` via `createRequire(import.<COMPANY_NAME_REDACTED>.url)` is an explicit ESM-in-CJS workaround, inconsistent with `opencode-token-rows.mjs`'s plain `import Database from 'better-sqlite3'` — a residue of the two files being authored in different phases (69 vs. 85) that was never reconciled.

## Integration Points

TokenDbWriter is consumed by both `copilot-events-tail.mjs` and `opencode-token-rows.mjs`, which import its constants directly rather than duplicating them — an explicit anti-duplication decision, also reflected in `ROUTING_COLUMNS` being exported so tests assert against the live list. The `user_hash` partitioning scheme (`cladpt`/`copadt`/`opnadt`) is enforced purely by caller convention: `baseValues()` never coalesces `userHash`, and there is no runtime assertion inside the module that callers pass one of the three sanctioned constants. Isolation between writers is thus a discipline maintained by callers, not a module-boundary guarantee.

## Usage Guidelines

Developers extending this subsystem should treat TokenDbWriter as the sole entry point to the proxy database and must never bypass it to open `token-usage.db` directly. New adapter user_hash values should reuse the exported constants rather than inventing raw strings, since nothing enforces the `/^[a-z][a-z0-9]{5}$/` contract at runtime. When adding schema-dependent logic, prefer extending `ROUTING_COLUMNS`/`insertShapeFor()` over asserting a fixed schema version, since this component discovers rather than dictates the proxy's schema. Any second-writer column addition should be accompanied by consideration of downstream consumers (like the routing dashboard) that may treat schema defaults as meaningful, per the `DIRECT_ROUTING_SOURCE` precedent. Finally, failure handling here must remain best-effort and non-propagating — this is accounting/instrumentation code that is architecturally subordinate to the primary LSL pipeline, and its own reliability should never risk destabilizing it.


## Hierarchy Context

### Parent
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] The TokenUsageAdapters component solves a specific asymmetry in the Coding project's LLM accounting: the rapid-llm-proxy at :12435 is the primary source of truth for token_usage.db, but three foreground agents (Claude Code, Copilot CLI, OpenCode) each have paths where calls bypass the proxy entirely. lib/lsl/token/copilot-events-tail.mjs, lib/lsl/token/opencode-token-rows.mjs, and lib/lsl/token/token-db.mjs form a 'second writer' subsystem that reconstructs token rows after the fact from each agent's own persistence layer (Copilot's events.jsonl, OpenCode's SQLite opencode.db) rather than intercepting the network call. This is an inherently lossy, best-effort compensation strategy rather than a clean instrumentation point — the code repeatedly documents (in token-db.mjs's insertTokenRow docstring) that failures must never propagate, since the adapters are patching a gap in an otherwise-authoritative pipeline.

### Siblings
- [OpencodeTokenRows](./OpencodeTokenRows.md) -- [CGR] buildOpencodeTokenRows (function) in opencode-token-rows.mjs
- [CopilotEventsTailWatcher](./CopilotEventsTailWatcher.md) -- [LLM] The `findLiveLockFile()` function in copilot-events-tail.mjs implements a time-boxed liveness heuristic that treats a filesystem lock file's mtime as a proxy for process aliveness: it globs `inuse.<pid>.lock` entries in a session directory and accepts any whose `mtimeMs` is within `LOCK_STALE_GRACE_MS` (10 minutes). This is a soft, racy substitute for an actual `kill(pid, 0)` liveness check — the code comments acknowledge this directly as 'landmine #5' from RESEARCH-copilot.md, where a hard-crashed Copilot session leaves an orphaned lock that could be mistaken for a live one for up to 10 minutes, or conversely a legitimately long-idle-but-alive session could be treated as dead if it never touches the lock file's mtime.


---

*Generated from 10 observations*
