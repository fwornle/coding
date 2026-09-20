# OpenCodeTokenRowExtractor

**Type:** Detail

# OpenCodeTokenRowExtractor — Technical Insight Document

## What It Is

OpenCodeTokenRowExtractor is implemented in `lib/lsl/token/opencode-token-rows.mjs`, centered on the `buildOpencodeTokenRows` function. It reads OpenCode's own SQLite database directly (`~/.local/share/opencode/opencode.db`, resolved via `DEFAULT_OPENCODE_DB`) to reconstruct token-usage rows at per-message (per-turn) granularity, since OpenCode natively records token usage on each assistant message. Although it is nested conceptually under the OperationalLogger hierarchy in the parent's grouping, the observations are explicit that it shares no actual call-graph relationship with `OperationalLogger`/`EnhancedOperationalLogger`/`live-logging-coordinator.js` — it is a standalone extraction utility, likely invoked from a stop-adapter/registry that marks `opencode` as `stamp-only`. This is an important structural note: the parent-child relationship here reflects directory/purpose grouping rather than a runtime dependency.

## Architecture and Design

The defining architectural decision is the **provider allow-list gate**: `BYPASS_PROVIDERS` (currently only `github-copilot`) determines which messages get emitted at all. This is labeled D-04 in the file's header and exists to prevent double-counting — proxy-routed OpenCode traffic (provider `anthropic`) is assumed already captured by rapid-llm-proxy's wire-level INSERT into `token_usage`, so re-emitting it here would duplicate the ledger. The set is deliberately narrow, with an explicit directive to "extend deliberately, and only for a provider proven to bypass the proxy" — a defensive stance against silent invariant erosion as OpenCode adds providers.

This positions the extractor as one of two coexisting token-capture strategies in the system: per-message SQLite extraction here versus per-session `events.jsonl` tailing in its sibling, CopilotEventsTailWatcher (`lib/lsl/live/copilot-events-tail.mjs`). The divergence is driven entirely by what each upstream CLI persists — OpenCode gives fine-grained per-turn token data, while Copilot only exposes coarse lifecycle events (`subagent.started/completed/failed`), forcing CopilotEventsTailWatcher to synthesize a two-message stub via `buildStubObservation`. The header comment explicitly frames this as a "per-turn" versus "per-session aggregate" architectural split.

The extractor also embodies a **read-only secondary reader over a live writer's database** pattern, opening the connection `{ readonly: true, timeout: 5000 }` so it can never corrupt OpenCode's own writer process — conceptually mirroring the "second writer" design in `token-db.mjs`, though here the roles are inverted (reader vs. writer) since it's OpenCode's own database.

## Implementation Details

Three layers of defensive access precede any row being trusted. First, `ownedDbPath` performs a uid-check via `process.getuid()`, comparing file ownership to the current process and failing closed with a `[token-adapter-opencode]` stderr message rather than throwing. Second, the SQLite connection itself is opened read-only with a 5-second timeout. Third, the message scan is bounded via `MESSAGE_SCAN_LIMIT = 4000` using `ORDER BY rowid DESC LIMIT ?`, with actual time-window filtering deferred downstream to `withinSpanWindow`.

Parsing is wrapped at every JSON boundary: the outer `db.prepare(...).all()` call is try/caught (returning `[]` on failure), each row's `JSON.parse(rec.data)` is individually try/caught inside the loop (`continue` skips malformed rows without aborting the pass), and `extractTokens` returns `null` if `d.tokens` isn't a proper object. This "never throw, always degrade" philosophy is described as consistent with `token-db.mjs`'s `insertTokenRow` (documented internally as D-08, "best-effort... NEVER throws").

A secondary responsibility is `summarizeParts`, which builds a human-readable `prompt_preview` by lazily querying each message's `part` blobs through a prepared statement (`partStmt`), producing a lead text snippet plus up to 8 `tool(argument)` invocation summaries capped at 240 characters. This presentation logic tolerates a missing `part` table (older OpenCode schema) by falling back to an empty summary — evidence of known schema-migration risk around the `part_message_id_id_idx` index and `time_created` ordering.

Finally, rows are tagged with `routing_source: 'direct'` (imported as `DIRECT_ROUTING_SOURCE` from `token-db.mjs`) and a synthetic route key `fg-chat/opencode`, deliberately omitting a `route_band` — an intentional honesty decision to avoid misrepresenting an agent-chosen provider as a routed one.

## Integration Points

The extractor depends on `token-db.mjs` only for shared constants — `ADAPTER_USER_HASH_OPENCODE` (`'opnadt'`), `DIRECT_ROUTING_SOURCE`, and `ROUTING_COLUMNS` — not for database access; it manages its own independent `better-sqlite3` connection to `opencode.db`, distinct from `token-usage.db`. This is a notable contrast with sibling TokenUsageDbWriter, which is conceptually related to but architecturally distinct from the actual `insertTokenRow`/`openTokenDb` writer logic in `token-db.mjs`.

The `routing_source`/`ROUTING_COLUMNS` connection also ties into dashboard visibility: both `opencode-token-rows.mjs` and `token-db.mjs` were updated together to fix a gap where the routing dashboard's "Recent decisions" table silently excluded bypass rows because `routing_source` defaulted to `''`.

Structurally, it sits alongside CopilotEventsTailWatcher, TokenUsageDbWriter, and ObservationWriteEventBus under the OperationalLogger parent, but — unlike ObservationWriteEventBus's tight, singleton-based integration with `ObservationWriter` — OpenCodeTokenRowExtractor's integration is loose, constants-only, and file-system-boundary based.

## Usage Guidelines

Developers extending `BYPASS_PROVIDERS` must first prove a given provider actually bypasses rapid-llm-proxy before adding it, since the set is the sole mechanism preventing double-counted tokens across two independent capture paths. Any code touching `opencode.db` should preserve the read-only/timeout/uid-check triple; these are load-bearing safety measures against corrupting a live external writer. When handling malformed or schema-mismatched data (e.g., missing `part` table), follow the established pattern of degrading gracefully rather than throwing, consistent with the rest of the `lib/lsl/token/` subsystem's best-effort philosophy. Finally, do not assume routing dashboards or downstream consumers can be updated independently — the `ROUTING_COLUMNS`/`routing_source` coupling with `token-db.mjs` showed that presentation-layer assumptions about bypass rows must be co-maintained across both files.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- The parent-entity's code graph evidence lists `OperationalLogger`/`EnhancedOperationalLogger`/`live-logging-coordinator.js` observations, but none of these classes or files appear anywhere in the OpenCodeTokenRowExtractor's own source (opencode-token-rows.mjs, token-db.mjs) — indicating this Detail component is NOT wired into the operational-logging class hierarchy the parent's CGR evidence describes. It is a standalone module invoked as a data-extraction utility (likely from a stop-adapter/registry per the header's reference to 'the stop-adapter-registry marked `opencode` as `stamp-only`'), not a consumer of `OperationalLogger.log()`.


## Hierarchy Context

### Parent
- [OperationalLogger](./OperationalLogger.md) -- Lives in integrations/semantic-analysis/src/logging.ts, the actual hot-path code executed during live sessions as opposed to the validator's preflight checks.

### Siblings
- [CopilotEventsTailWatcher](./CopilotEventsTailWatcher.md) -- [LLM] The core of `lib/lsl/live/copilot-events-tail.mjs` is `tailEventsFile()`, which implements a polling file-tail (`TAIL_POLL_INTERVAL_MS = 200`) over `statSync` on `~/.copilot/session-state/<uuid>/events.jsonl` rather than a filesystem-event watcher (fs.watch/inotify). The function is explicitly forward-looking: on open it captures the current file size into `lastSize` and comments state it deliberately does NOT process pre-existing content, deferring backfill of historical lines to a separate sweep component (Plan 51-04). This creates a hard architectural split between 'live tail' (this file) and 'historical sweep' (elsewhere), each with different consistency guarantees, and means a session that starts before the watcher attaches will have a gap unless the sweep later reconciles it.
- [TokenUsageDbWriter](./TokenUsageDbWriter.md) -- [LLM] The parent entity TokenUsageDbWriter is described as living in integrations/semantic-analysis/src/logging.ts and being the hot-path executed during live sessions, but the actual code files provided (copilot-events-tail.mjs, opencode-token-rows.mjs, token-db.mjs) belong to a distinct lib/lsl/token/ subsystem. This suggests TokenUsageDbWriter is conceptually related to — but architecturally distinct from — the token-usage.db writer implemented in token-db.mjs's insertTokenRow/openTokenDb functions, which is explicitly documented as a 'second writer' to a proxy-owned SQLite database, not the primary session logger.
- [ObservationWriteEventBus](./ObservationWriteEventBus.md) -- [LLM] The event bus is a single module-level `EventEmitter` (`_observationEmitter` in src/live-logging/ObservationWriter.js) rather than a class instance property, which means it is a process-wide singleton shared by every `ObservationWriter` instance in the same Node process. This is a deliberate departure from the instance-scoped pattern used elsewhere in the file (e.g. `_writeLock`, `_recentHashes`, `_kmStore` are all `this.*`): the comment at the emitter's declaration explains that obs-api constructs the writer lazily, so an instance-local emitter would force SSE subscribers to wait on writer-init ordering before they could attach a listener. Choosing module scope over instance scope trades encapsulation for subscription availability at any point in the module's lifecycle.


---

*Generated from 10 observations*
