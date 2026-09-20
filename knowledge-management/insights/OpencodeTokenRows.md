# OpencodeTokenRows

**Type:** Detail

[LLM] Database access in opencode-token-rows.mjs is read-only and heavily bounded: `new Database(resolved, { readonly: true, timeout: 5000 })` opens the OpenCode SQLite store defensively, and the message query is capped via `ORDER BY rowid DESC LIMIT ?` with MESSAGE_SCAN_LIMIT=4000 rather than a time-range WHERE clause — the actual time-window filtering is deferred to a downstream `withinSpanWindow` (referenced in comments but not present in the truncated excerpt), meaning this function intentionally over-fetches a bounded set and lets the caller narrow it, trading a fixed worst-case scan cost for query simplicity. The `partStmt` prepared statement for per-message tool-call summaries is wrapped in its own try/catch so an OpenCode store predating the `part` table (schema drift) degrades to empty summaries rather than crashing the whole adapter — the same defensive-against-schema-drift posture noted in token-db.mjs's `insertShapeFor`.

# OpencodeTokenRows — Technical Insight Document

## What It Is

OpencodeTokenRows is implemented in `lib/lsl/token/opencode-token-rows.mjs`, centered on the function `buildOpencodeTokenRows`. It is a read-only extraction adapter that reconstructs token-usage rows by reading directly from OpenCode's own SQLite persistence store (`opencode.db`) rather than intercepting network traffic. As a member of the `TokenUsageAdapters` component, it exists to compensate for a structural gap: the rapid-llm-proxy at :12435 is the authoritative writer of `token_usage.db`, but OpenCode (like Claude Code and Copilot CLI) has execution paths that bypass the proxy entirely. OpencodeTokenRows is the "second writer" for OpenCode specifically, sitting alongside sibling adapters `TokenDbWriter` (token-db.mjs) and `CopilotEventsTailWatcher` (copilot-events-tail.mjs) under `TokenUsageAdapters`, and it is also referenced from `LiveTranscriptWatchers`.

## Architecture and Design

The dominant pattern is a **best-effort, never-throw extraction pipeline**. The call graph shows `buildOpencodeTokenRows` fanning out to exactly five narrow helpers — `summarizeParts`, `ownedDbPath`, `extractTokens`, `snip`, and `num` — each of which fails closed rather than propagating errors: `ownedDbPath` returns `''` on a stat error or uid mismatch, `extractTokens` returns `null` on malformed token data, and `num`/`snip` coalesce bad inputs instead of throwing. This degrade-row-by-row philosophy mirrors the defensive posture in sibling `TokenDbWriter`'s `insertShapeFor` and `CopilotEventsTailWatcher`'s liveness heuristics — none of these adapters are permitted to abort a batch over one bad record, because they are patching a gap in an otherwise-authoritative pipeline.

A second key pattern is **provider-allowlist-as-invariant**: `BYPASS_PROVIDERS` (`Object.freeze(new Set(['github-copilot']))`) inverts the usual allowlist-of-safe-things convention into an allowlist-of-known-bypasses. Only providers in this set get rows emitted; everything else (notably 'anthropic', assumed proxy-routed) is silently skipped. This is a conscious no-double-count invariant, trading under-counting risk for correctness against duplication — a conservative but data-lossy default for any future unrecognized provider.

Third, the module performs a **bounded reverse-scan** rather than a time-windowed query: `ORDER BY rowid DESC LIMIT ?` with `MESSAGE_SCAN_LIMIT = 4000`, deferring actual time-range filtering to a downstream `withinSpanWindow`. This trades query simplicity for a fixed worst-case scan cost, over-fetching and letting the caller narrow the result.

Finally, the module manufactures **synthetic provenance** — stamping reconstructed rows with `routing_source: 'direct'` via `DIRECT_ROUTE_KEY = 'fg-chat/opencode'` and `DIRECT_ROUTING_SOURCE` (imported from token-db.mjs) — a downstream-consumer-aware design decision so the routing dashboard's "Recent decisions" table (which filters on non-empty `routing_source`) doesn't silently drop these rows.

## Implementation Details

`buildOpencodeTokenRows` opens the OpenCode SQLite store defensively: `new Database(resolved, { readonly: true, timeout: 5000 })`, read-only and time-boxed. Before opening the DB, it calls `ownedDbPath` to enforce a uid-ownership security gate; on failure it returns `[]` before touching the database at all. It then queries recent assistant messages bounded by `MESSAGE_SCAN_LIMIT`, and per row calls `extractTokens` to parse the `data.tokens` shape (returning `null` on absence), applies the `BYPASS_PROVIDERS` filter against `d.providerID || d.provider`, and runs a **zero-token placeholder filter** (`total === 0 && reasoning === 0 && cacheRead === 0 && cacheWrite === 0 → continue`) to skip OpenCode's streaming-stub rows written before a response completes — a fragile, tool-specific assumption about SQLite writer timing that could start emitting duplicate/partial rows if OpenCode's internal streaming behavior changes.

`summarizeParts`, though called directly from the main function, is architecturally distinct: it walks parsed `part` JSON blobs to build human-readable "lead text + tool actions" summaries (using `snip` for truncation) consumed by the Performance-tab timeline UI. Its `partStmt` prepared statement is wrapped in its own try/catch, so a store predating the `part` table degrades gracefully to empty summaries — the same schema-drift-defensive posture seen in `TokenDbWriter`'s `insertShapeFor` probing `ROUTING_COLUMNS`.

## Integration Points

OpencodeTokenRows is purely a read/reconstruction layer — it performs no writes; persistence is delegated elsewhere to `token-db.mjs`'s `insertTokenRow`, called by a separate caller. Rows are written into the `ADAPTER_USER_HASH_OPENCODE` ('opnadt') id-space partition. It imports `DIRECT_ROUTING_SOURCE` from token-db.mjs to stamp provenance, tying its output format to the routing dashboard's filtering logic. It duplicates a uid-ownership security check (`ownedDbPath`) that also exists independently as `isOwnedByMe()` in `copilot-events-tail.mjs` (`CopilotEventsTailWatcher`) — both compare `st.uid !== process.getuid()`, but with different return-type contracts (empty string vs. boolean), making consolidation non-trivial despite identical intent. Notably, the module uses native ESM `import Database from 'better-sqlite3'`, whereas token-db.mjs uses `createRequire()`-based CommonJS for the same dependency — an inconsistency across the same logical resource within `TokenUsageAdapters`.

## Usage Guidelines

Maintainers should treat `BYPASS_PROVIDERS` as a manually-curated invariant requiring active upkeep: adding a new non-proxied provider to OpenCode requires updating this set, or its usage will be silently under-counted rather than erroring visibly. The zero-token placeholder filter is coupled to OpenCode's undocumented internal streaming/persistence timing and should be revisited if OpenCode's writer behavior changes. Because `summarizeParts` couples this data-integrity module to a UI rendering concern (Performance-tab timeline text), any change to that display format requires touching this extraction file — a seam worth isolating in future refactors. Developers should also be aware that the `ownedDbPath`/`isOwnedByMe` duplication is a known, documented consolidation opportunity, but any shared extraction must reconcile differing return-type conventions between call sites.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- buildOpencodeTokenRows (function) in opencode-token-rows.mjs

**Relationships:**
- Calls: summarizeParts, ownedDbPath, extractTokens
- summarizeParts — one of the five direct calls from buildOpencodeTokenRows — is a UI-facing enrichment function, not a core token-accounting one: it walks parsed `part` JSON blobs per assistant message to build a human-readable 'lead text + tool actions' summary (via the `snip` helper for truncation) that the Performance-tab timeline renders. This couples a token-accounting reconstruction module to a display-formatting concern; if the Performance tab's expected summary format changes, this file — whose primary job is SQLite extraction and no-double-count correctness — must also change, an architectural seam where a display-layer requirement leaked into a data-integrity-focused adapter.

**Other:**
- Call chain: OpencodeTokenRows -> summarizeParts
- Call chain: OpencodeTokenRows -> ownedDbPath
- Call chain: OpencodeTokenRows -> extractTokens
- Call chain: OpencodeTokenRows -> snip
- Call chain: OpencodeTokenRows -> num
- The call graph shows buildOpencodeTokenRows (opencode-token-rows.mjs) fanning out to exactly five helpers — summarizeParts, ownedDbPath, extractTokens, snip, and num — each a narrow, single-purpose pure function with its own try/catch or coalescing guard. This is a deliberate 'never throw' composition: ownedDbPath fails closed on a stat error or uid mismatch (returning ''), extractTokens returns null on a missing/malformed tokens object, and num/snip coalesce non-numeric/non-string inputs rather than propagating type errors. The orchestrator function itself wraps the whole SQLite pass in an outer try/catch (implied by the truncated code's per-query try/catch blocks around `db.prepare(...).all(...)`), so a single malformed row, missing `part` table, or transient lock never aborts the batch — it degrades row-by-row instead of failing the whole extraction.


## Hierarchy Context

### Parent
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] The TokenUsageAdapters component solves a specific asymmetry in the Coding project's LLM accounting: the rapid-llm-proxy at :12435 is the primary source of truth for token_usage.db, but three foreground agents (Claude Code, Copilot CLI, OpenCode) each have paths where calls bypass the proxy entirely. lib/lsl/token/copilot-events-tail.mjs, lib/lsl/token/opencode-token-rows.mjs, and lib/lsl/token/token-db.mjs form a 'second writer' subsystem that reconstructs token rows after the fact from each agent's own persistence layer (Copilot's events.jsonl, OpenCode's SQLite opencode.db) rather than intercepting the network call. This is an inherently lossy, best-effort compensation strategy rather than a clean instrumentation point — the code repeatedly documents (in token-db.mjs's insertTokenRow docstring) that failures must never propagate, since the adapters are patching a gap in an otherwise-authoritative pipeline.

### Siblings
- [TokenDbWriter](./TokenDbWriter.md) -- [LLM] token-db.mjs's insertTokenRow() implements a retry loop (INSERT_ID_RETRY_ATTEMPTS = 3) around a non-atomic 'SELECT MAX(id)+1 THEN INSERT' sequence (NEXT_ID_SQL, recomputed on every attempt inside the for-loop). The code's own comment (WR-05 re-review) acknowledges this is racy: a concurrent writer into the same adapter's user_hash space between the SELECT and INSERT throws SQLITE_CONSTRAINT on the composite (user_hash, id) primary key. Rather than surfacing that as a hard failure, the catch block runs a secondary disambiguation query (`SELECT 1 FROM token_usage WHERE user_hash = ? AND tool_call_id = ? LIMIT 1`) to decide whether the constraint violation represents a genuine duplicate (return false, drop) or a lost id race (loop again with a freshly recomputed id). This conflates two distinct failure semantics — idempotent dedup vs. optimistic-concurrency retry — into a single exception branch keyed off SQLITE_CONSTRAINT's error code prefix, which is brittle if a future schema change (e.g. adding another unique index) changes what 'constraint violation' means at that call site.
- [CopilotEventsTailWatcher](./CopilotEventsTailWatcher.md) -- [LLM] The `findLiveLockFile()` function in copilot-events-tail.mjs implements a time-boxed liveness heuristic that treats a filesystem lock file's mtime as a proxy for process aliveness: it globs `inuse.<pid>.lock` entries in a session directory and accepts any whose `mtimeMs` is within `LOCK_STALE_GRACE_MS` (10 minutes). This is a soft, racy substitute for an actual `kill(pid, 0)` liveness check — the code comments acknowledge this directly as 'landmine #5' from RESEARCH-copilot.md, where a hard-crashed Copilot session leaves an orphaned lock that could be mistaken for a live one for up to 10 minutes, or conversely a legitimately long-idle-but-alive session could be treated as dead if it never touches the lock file's mtime.


---

*Generated from 17 observations*
