# OpenCodeTokenRowExtractor

**Type:** Detail

## What It Is

`OpenCodeTokenRowExtractor` is implemented in `lib/lsl/token/opencode-token-rows.mjs`, centered on the exported function `buildOpencodeTokenRows(dbPath, ctx)`. Despite the KG-level Detail entity name suggesting a class, the actual code shape is a function-exporting module with no class definition — the module's docstring describes it as "the pure EXTRACTION layer that turns the OpenCode SQLite session store (`~/.local/share/opencode/opencode.db`) into `TokenUsageRow`-shaped objects." All supporting helpers (`ownedDbPath`, `extractTokens`, `summarizeParts`, `activityFor`) exist solely in service of this single exported function. This naming mismatch between ontology label and code structure is itself a notable insight: the "extractor" is a role played by a module, not an instantiable class.

It sits beneath `LslConfigValidator` in the hierarchy (as `LSLConfigValidator` class in `validate-lsl-config.js`), alongside siblings `CopilotLiveSessionScanner` and `TokenUsageDbWriter`, forming a family of adapter/extraction utilities feeding the shared LSL token-usage subsystem.

## Architecture and Design

The core architectural idea is a **provider-gated, no-double-count extraction gate**. OpenCode normally routes through `rapid-llm-proxy` via `ANTHROPIC_BASE_URL`, so the proxy already records token usage for most providers. This extractor exists only to patch the gap where OpenCode's backend talks directly to a provider like GitHub Copilot, bypassing the proxy. The `BYPASS_PROVIDERS` set (currently only `github-copilot`, opencode-token-rows.mjs:76-82) and the `if (!BYPASS_PROVIDERS.has(provider)) continue;` gate enforce the "NO-DOUBLE-COUNT INVARIANT (D-04, provider-gated)" — the module reconstructs only what is provably invisible to the proxy, never re-deriving data the proxy already wrote.

A second pattern is the **second-writer-into-shared-table** design: emitted rows go into the same `token_usage` table owned by the proxy, via `token-db.mjs`'s `insertTokenRow`, but under a dedicated `ADAPTER_USER_HASH_OPENCODE = 'opnadt'` id-space to avoid collisions with the proxy's own writer — mirroring the sibling Copilot adapter's `copadt` pattern and the id-allocation strategy documented in `TokenUsageDbWriter`.

Defensive, fail-soft design pervades the module: read-only, foreign-owned database access guarded by a uid-ownership check (`ownedDbPath()`), bounded/indexed SQLite scans rather than full scans, and per-record try/catch parsing so no single malformed row aborts the batch — consistent with the "never throws" (D-08) posture also documented in sibling `token-db.mjs`.

## Implementation Details

`ownedDbPath()` performs `fs.statSync` + `process.getuid()` checks before allowing any open, logging a `[token-adapter-opencode]` stderr line and refusing (not throwing) on mismatch. The SQLite connection is opened via `better-sqlite3` with `{ readonly: true, timeout: 5000 }`, and the message scan is capped at `MESSAGE_SCAN_LIMIT = 4000` rows ordered `rowid DESC`, deferring exact time-window filtering to a downstream `withinSpanWindow` check.

`extractTokens(d)` reads `data.tokens` fields (`input`, `output`, `reasoning`, `cacheRead`, `cacheWrite`). Rows are skipped when `role !== 'assistant'` or when all token counts are zero (a guard against emitting placeholder rows for in-flight streaming stubs). Timestamps are derived from `d.time.created`, falling back to `new Date().toISOString()` if non-finite. This yields per-turn granularity, explicitly contrasted in the module header with the Copilot adapter's per-session aggregation.

`activityFor(messageId)` uses a prepared statement against the `part` table (`ORDER BY time_created ASC`), built once per DB open; if the table doesn't exist (older OpenCode schema), `partStmt` is set to `null` and summaries are silently disabled rather than failing. `summarizeParts()` builds a bounded (~240-char) `prompt_preview` string from the first text snippet plus up to 8 truncated tool invocations, explicitly intended to feed the Performance-tab timeline.

Provenance is stamped deliberately: `DIRECT_ROUTE_KEY = 'fg-chat/opencode'` groups bypassed calls under the fg-chat/opencode job/agent pairing, and `routing_source: 'direct'` (via `DIRECT_ROUTING_SOURCE` from `token-db.mjs`) records that the provider was agent-chosen, not router-chosen — with `route_band` left empty rather than fabricated.

## Integration Points

This extractor depends on `./token-db.mjs` for `DIRECT_ROUTING_SOURCE`, `ADAPTER_USER_HASH_OPENCODE`, and `insertTokenRow` — the same integration seam used by `TokenUsageDbWriter`, which documents itself as the sole host-side writer touching the proxy-owned token-usage database. It writes into the identical `token_usage` table the rapid-llm-proxy daemon owns, distinguished only by adapter user_hash, avoiding the id-race problem `TokenUsageDbWriter` solves via per-adapter `MAX(id)+1` allocation.

Structurally, it lives under the `LslConfigValidator` component tree and is a peer to `CopilotLiveSessionScanner` (which performs analogous foreign-store discovery over Copilot session directories using ownership checks) — both share the pattern of treating externally-owned filesystem/DB state cautiously before extracting data from it.

## Usage Guidelines

Developers extending `BYPASS_PROVIDERS` should only add providers that are proven not to be captured by the proxy's route — expanding this set carelessly would violate the no-double-count invariant and cause duplicate token accounting. Any schema assumptions about the `part` table must remain optional/backward-compatible, following the existing pattern of disabling summaries rather than throwing. Because the module intentionally never throws, callers should not expect exceptions for malformed or ownership-mismatched databases — check logs (`[token-adapter-opencode]`) and empty results instead. When modifying row emission, preserve the `routing_source: 'direct'` / empty `route_band` convention rather than inventing routing decisions that never occurred, since downstream dashboards depend on this attribution being accurate rather than inferred.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- [LLM] The code graph supplied for this entity is empty — no class or function named `OpenCodeTokenRowExtractor` (or anything else) appears in `<code_graph>` — so no [LLM+CGR] observation can be grounded here. However, the retrieved file `lib/lsl/token/opencode-token-rows.mjs` is a direct functional match for the entity's name: it exports `buildOpencodeTokenRows(dbPath, ctx)`, the module docstring calls it 'the pure EXTRACTION layer that turns the OpenCode SQLite session store (`~/.local/share/opencode/opencode.db`) into `TokenUsageRow`-shaped objects', and every helper in the file (`ownedDbPath`, `extractTokens`, `summarizeParts`, `activityFor`) exists solely to serve that one exported function. The component is implemented as an exported function within a module rather than as a standalone class — the KG's Detail-level entity name is a description of the module's role, not a literal class identifier, which is why the code graph (which appears to index class/function declarations) has nothing under that exact name.


## Hierarchy Context

### Parent
- [LslConfigValidator](./LslConfigValidator.md) -- [CGR] LSLConfigValidator (class) in validate-lsl-config.js

### Siblings
- [CopilotLiveSessionScanner](./CopilotLiveSessionScanner.md) -- [LLM] The one function in the supplied files that actually implements a live-session scan is `scanForLiveSessions(sessionStateDir, myUid)` in `lib/lsl/live/copilot-events-tail.mjs`. It reads `sessionStateDir` with `fs.readdirSync(..., { withFileTypes: true })`, keeps only directory entries, and for each calls `isOwnedByMe(sessionDir, myUid)` then `findLiveLockFile(sessionDir)`, collecting `{sessionId, sessionDir}` pairs for sessions that pass both checks. This is the concrete scanning routine that the component name 'CopilotLiveSessionScanner' most plausibly names — unlike the parent-level files, this module is not merely thematically adjacent but directly performs live Copilot session discovery.
- [TokenUsageDbWriter](./TokenUsageDbWriter.md) -- [LLM] `lib/lsl/token/token-db.mjs` is, functionally, the TokenUsageDbWriter: `insertTokenRow(db, row)` is the sole write path into the proxy-owned `.data/llm-proxy/token-usage.db`, and its docstring is explicit that this file is 'the ONLY host-side file that touches' that database as a second writer alongside the rapid-llm-proxy daemon. The id-allocation strategy (`NEXT_ID_SQL = 'SELECT COALESCE(MAX(id), 0) + 1 ... WHERE user_hash = ?'`) is scoped per adapter `user_hash` (`cladpt`, `copadt`, `opnadt`) specifically so this writer's own `MAX(id)+1` never races the proxy daemon's in-memory id counter — a concurrency design built around NOT owning the table's primary writer role.


---

*Generated from 9 observations*
