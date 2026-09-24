# TokenUsageDbWriter

**Type:** Detail

## What It Is

TokenUsageDbWriter is a functional label, not a literal class name, over `lib/lsl/token/token-db.mjs`. The observations are explicit that no class or module literally named "TokenUsageDbWriter" exists; instead the role is fulfilled by a small set of exported functions — `openTokenDb(dbPath)`, `insertTokenRow(db, row)`, `ensureCacheColumns(db)`, and `insertShapeFor(db)` — which together form the sole host-side write path into `.data/llm-proxy/token-usage.db`. The module's own docstring asserts it is "the ONLY host-side file that touches" this database as a second writer alongside the rapid-llm-proxy daemon, making it the designated chokepoint for any non-proxy code that needs to persist token usage rows.

## Architecture and Design

The defining architectural fact is that this writer is a **second writer** coexisting with a primary owner (the rapid-llm-proxy daemon) that controls both the table's schema and its main id sequence. This "second-writer coexistence" pattern shapes nearly every design decision in the file. Because the writer cannot rely on a database-native autoincrement shared safely across processes, it implements **optimistic concurrency with bounded retry**: `NEXT_ID_SQL` computes `MAX(id)+1` scoped per adapter `user_hash` (`cladpt`, `copadt`, `opnadt`), and `insertTokenRow` disambiguates `SQLITE_CONSTRAINT` collisions — a genuine `(user_hash, tool_call_id)` duplicate is treated as intentional dedup, while any other violation triggers up to `INSERT_ID_RETRY_ATTEMPTS = 3` id recomputations.

The writer is also deliberately **schema-defensive** toward a table it doesn't migrate: `insertShapeFor(db)` probes `PRAGMA table_info(token_usage)` (memoised per handle in a `WeakMap`) to decide whether the 7 `ROUTING_COLUMNS` exist before including them in generated INSERTs, and `ensureCacheColumns(db)` idempotently `ALTER TABLE`s in `cache_read_tokens`/`cache_write_tokens` on every `openTokenDb()` call, tolerating "duplicate column" as a no-op. This decouples the writer's lifecycle from the proxy's own migration schedule.

Finally, error handling follows a **best-effort/fail-open** contract (documented as D-08): any failure — locked DB, closed handle, malformed row — is caught, logged to stderr as `[token-adapter] insert failed (non-fatal): <msg>`, and converted to `false` rather than thrown, so telemetry capture can never destabilize the main ingestion path.

## Implementation Details

Row provenance is encoded via distinct `user_hash` adapter namespaces rather than a separate table — cladpt, copadt, opnadt — keeping adapter and proxy rows unified in one schema while avoiding id collisions between writers. A subtler implementation detail is `DIRECT_ROUTING_SOURCE = 'direct'`: because adapter-produced rows never passed through the proxy's router, leaving `routing_source` at its SQL default of `''` silently excluded them from the routing dashboard's "Recent decisions" view (which filters on non-empty `routing_source`). The fix was applied in the writer itself — stamping `'direct'` explicitly — rather than patching the dashboard, illustrating that the writer's column choices directly determine downstream visibility, not just storage correctness.

Coalescing defaults (`?? 0`, `?? ''`) appear on every column, echoing a broader pattern noted in the parent's cold-store backfill work around LSL row schema drift — a structural parallel rather than direct evidence, but consistent with this writer's defensive posture.

## Integration Points

The writer sits downstream of at least one confirmed producer and one plausible one. `lib/lsl/token/opencode-token-rows.mjs`'s `buildOpencodeTokenRows()` — the sibling entity **OpenCodeTokenRowExtractor** — reads OpenCode's own SQLite store and reconstructs `TokenUsageRow`-shaped objects only for `BYPASS_PROVIDERS` (currently `github-copilot`), importing `ADAPTER_USER_HASH_OPENCODE` and `DIRECT_ROUTING_SOURCE` directly from `token-db.mjs`, and stamping `DIRECT_ROUTE_KEY = 'fg-chat/opencode'` under the same "no routing decision occurred" logic. The actual call site invoking `insertTokenRow` isn't shown in the excerpt, so this producer→writer wiring is inferred from shared constants.

The sibling **CopilotLiveSessionScanner**, implemented as `scanForLiveSessions()` in `lib/lsl/live/copilot-events-tail.mjs`, is architecturally adjacent: the same file's `tailEventsFile()` exposes an optional `cfg.onTokenRow` hook fired on `session.shutdown` lines, deliberately isolated from the subagent `onError` path — a plausible second call site into the writer, though again the hook body's actual invocation isn't confirmed in the excerpt. `src/live-logging/ObservationWriter.js` is explicitly not part of this integration surface; it writes Observation/Digest/Insight entities into km-core via `GraphKMStore.putEntity`, a separate LevelDB-backed store with its own `ANCHOR_ROOT`/`ANCHOR_FOR_KIND` scheme unrelated to the SQLite `token_usage` table. Structurally, this reflects an extraction-layer/writer-layer split: producers (OpenCodeTokenRowExtractor, the copilot tail hook) build rows, and `token-db.mjs` alone persists them, under the parent **LslConfigValidator** (via `LSLConfigValidator` in `validate-lsl-config.js`) and the broader **LiveLoggingSystem** containment.

## Usage Guidelines

Any new code needing to write token usage rows must go through `token-db.mjs`'s exported functions — comments in the file explicitly forbid other files from touching `token-usage.db` directly, preserving the single-chokepoint guarantee. Callers should treat `insertTokenRow` as fire-and-forget: it never throws, returns `false` on failure, and logs non-fatally, so it must not be used as a signal for control flow requiring guaranteed persistence. New adapter sources should be assigned their own `user_hash` namespace rather than sharing an existing one, to preserve the per-adapter id-scoping that avoids races with the proxy's in-memory counter. Rows describing bypass/non-routed calls should explicitly set `routing_source` to `DIRECT_ROUTING_SOURCE` (or an equivalent non-empty marker) to remain visible in downstream dashboards — omitting it silently drops rows from dashboard views without raising errors, a known historical bug class this writer already fixed once.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The parent's 'Cold-Store Backfill — Artifacts Field Recovery' work record documents that LSL-produced rows have historically drifted from their expected schema in production and required exact-timestamp-matched repair; `token-db.mjs`'s defensive posture — `?? 0`/`?? ''` coalescing on every column, schema-probing before including routing columns, and a self-healing `ensureCacheColumns` migration — reads as the same category of upstream safeguard applied to the token-usage table, though the work record itself concerns observation rows, not token rows, so this is a structural parallel rather than direct evidence.

## Hierarchy Context

### Parent
- [LslConfigValidator](./LslConfigValidator.md) -- [CGR] LSLConfigValidator (class) in validate-lsl-config.js

### Siblings
- [CopilotLiveSessionScanner](./CopilotLiveSessionScanner.md) -- [LLM] The one function in the supplied files that actually implements a live-session scan is `scanForLiveSessions(sessionStateDir, myUid)` in `lib/lsl/live/copilot-events-tail.mjs`. It reads `sessionStateDir` with `fs.readdirSync(..., { withFileTypes: true })`, keeps only directory entries, and for each calls `isOwnedByMe(sessionDir, myUid)` then `findLiveLockFile(sessionDir)`, collecting `{sessionId, sessionDir}` pairs for sessions that pass both checks. This is the concrete scanning routine that the component name 'CopilotLiveSessionScanner' most plausibly names — unlike the parent-level files, this module is not merely thematically adjacent but directly performs live Copilot session discovery.
- [OpenCodeTokenRowExtractor](./OpenCodeTokenRowExtractor.md) -- [LLM] The code graph supplied for this entity is empty — no class or function named `OpenCodeTokenRowExtractor` (or anything else) appears in `<code_graph>` — so no [LLM+CGR] observation can be grounded here. However, the retrieved file `lib/lsl/token/opencode-token-rows.mjs` is a direct functional match for the entity's name: it exports `buildOpencodeTokenRows(dbPath, ctx)`, the module docstring calls it 'the pure EXTRACTION layer that turns the OpenCode SQLite session store (`~/.local/share/opencode/opencode.db`) into `TokenUsageRow`-shaped objects', and every helper in the file (`ownedDbPath`, `extractTokens`, `summarizeParts`, `activityFor`) exists solely to serve that one exported function. The component is implemented as an exported function within a module rather than as a standalone class — the KG's Detail-level entity name is a description of the module's role, not a literal class identifier, which is why the code graph (which appears to index class/function declarations) has nothing under that exact name.


---

*Generated from 10 observations*
