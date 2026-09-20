# TokenUsageDbWriter

**Type:** Detail

[Architecture Notes] Distinct write pipelines exist for normalized transcript data (ObservationWriter → km-core) versus raw batched session/token logs (implied TokenUsageDbWriter/logging.ts, token-db.mjs); Multiple independent token-usage writers exist (proxy daemon, Claude/Copilot/OpenCode adapters) coordinated via distinct user_hash namespaces to avoid id collisions; Config/schema drift risk is a recurring theme: writers depend on externally-owned configs (lsl-config.json) or schemas (proxy's token_usage table) they do not control; No direct evidence in code files of OperationalLogger/EnhancedOperationalLogger classes referenced in code graph — parent's CGR links are external to the inspected file set

# TokenUsageDbWriter — Technical Insight Document

## What It Is

TokenUsageDbWriter is declared to live in `integrations/semantic-analysis/src/logging.ts`, as part of its parent component **OperationalLogger**, and is characterized as the hot-path writer executed during live sessions — as opposed to preflight/validation logic elsewhere in the logger. Critically, none of the code files actually inspected (`copilot-events-tail.mjs`, `opencode-token-rows.mjs`, `token-db.mjs`) correspond directly to this file path. Instead, these files implement a conceptually related but architecturally distinct subsystem under `lib/lsl/token/` and `lib/lsl/live/`, most notably `token-db.mjs`'s `insertTokenRow`/`openTokenDb`, which is explicitly documented as a "second writer" into a proxy-owned `token_usage` SQLite table. TokenUsageDbWriter should therefore be understood as the canonical hot-path token-logging component whose design philosophy is *mirrored* — not directly implemented — by the `lib/lsl/token/` writers inspected here.

## Architecture and Design

The dominant architectural theme is a best-effort, never-throw write philosophy (labeled D-08 in `token-db.mjs`), where write failures are decoupled from the hot path — a principle attributed to TokenUsageDbWriter's own buffering/rotation strategy and echoed in `insertTokenRow`'s retry loop (`INSERT_ID_RETRY_ATTEMPTS=3`) with `SQLITE_CONSTRAINT` disambiguation via `tool_call_id` duplicate checks. This concurrency-safety logic exists because `token-db.mjs` must coexist with a live proxy daemon (writer #1) inserting into the same table — a multi-writer coordination problem not typically seen in simple logging writers.

Sibling component **CopilotEventsTailWatcher** (`copilot-events-tail.mjs`'s `tailEventsFile`) reflects the same batching/threshold-driven write pattern via `TAIL_POLL_INTERVAL_MS` (200ms) polling with incremental buffer reads (`lastSize` tracking), rather than synchronous per-event flushing — directly paralleling the parent's I/O-pressure-reducing rotation strategy. Notably, this watcher is explicitly forward-only, deferring historical backfill to a separate sweep component (Plan 51-04), producing a hard split between live-tail and historical-sweep consistency guarantees.

Sibling **OpenCodeTokenRowExtractor** (`buildOpencodeTokenRows`) inverts the hot-path model entirely: it is a reconstruction/backfill adapter that derives `TokenUsageRow`-shaped records after the fact from `opencode.db`, gated by `BYPASS_PROVIDERS` (currently only `github-copilot`) to enforce a no-double-count invariant (D-04) against the proxy's own wire-level inserts. This demonstrates that not all token-usage writers in the system are live; some are deliberately batch/backfill in nature.

Finally, **ObservationWriteEventBus** and `ObservationWriter.js` establish a dual-path architecture: normalized transcript-exchange writes (via `GraphKMStore`/km-core) are explicitly separated from raw session/token log writes (the TokenUsageDbWriter path), each with distinct durability and shape guarantees.

## Implementation Details

`token-db.mjs` implements defensive schema handling via `insertShapeFor` and a `PRAGMA table_info`-based existence check for `ROUTING_COLUMNS`, tolerating drift in a table it does not own — paralleling TokenUsageDbWriter's own documented sensitivity to drift in field-name/default assumptions relative to `lsl-config.json`. Both components must degrade gracefully against externally-owned schemas/configs rather than fail hard.

`copilot-events-tail.mjs`'s `tailEventsFile` and `findLiveLockFile` implement polling-based tailing with stale-lock handling, capturing `lastSize` at attach time and explicitly avoiding retroactive processing of pre-existing file content.

`opencode-token-rows.mjs`'s `buildOpencodeTokenRows` uses `ownedDbPath`/`isOwnedByMe` for uid-ownership gating, a defense-in-depth security measure ensuring reconstruction only occurs against databases owned by the invoking user.

`ObservationWriter.js` uses a module-level singleton `EventEmitter` (`_observationEmitter`) rather than instance-scoped state (unlike `_writeLock`, `_recentHashes`, `_kmStore`), trading encapsulation for subscriber availability independent of writer-instantiation ordering — relevant context distinguishing it from TokenUsageDbWriter's own write-path lifecycle.

## Integration Points

TokenUsageDbWriter is nested under **OperationalLogger** per the code graph, alongside siblings CopilotEventsTailWatcher, OpenCodeTokenRowExtractor, and ObservationWriteEventBus. However, the supplied code-graph entities (`OperationalLogger`, `EnhancedOperationalLogger`, `initializeOperationalLogger`, `validateOperationalLogger`) do not appear in any inspected file, leaving an evidentiary gap between declared call-graph relationships and observed implementation. Multiple independent token-usage writers (proxy daemon, Claude/Copilot/OpenCode adapters) are coordinated via distinct `user_hash` namespaces to avoid ID collisions across writers sharing the same underlying table.

## Usage Guidelines

Treat TokenUsageDbWriter and the `lib/lsl/token/` writers as conceptually unified but not interchangeable — verify actual file location before attributing behavior. When extending `BYPASS_PROVIDERS`, do so only for providers proven to bypass the proxy, to avoid double-counting. Any new writer touching shared schemas (`token_usage`, `lsl-config.json`) should adopt the schema-probing, degrade-gracefully pattern rather than assuming fixed shape. Given the CGR/code gap noted above, treat call-graph-derived relationships to `OperationalLogger` as provisional pending direct source verification.


## Hierarchy Context

### Parent
- [OperationalLogger](./OperationalLogger.md) -- Lives in integrations/semantic-analysis/src/logging.ts, the actual hot-path code executed during live sessions as opposed to the validator's preflight checks.

### Siblings
- [CopilotEventsTailWatcher](./CopilotEventsTailWatcher.md) -- [LLM] The core of `lib/lsl/live/copilot-events-tail.mjs` is `tailEventsFile()`, which implements a polling file-tail (`TAIL_POLL_INTERVAL_MS = 200`) over `statSync` on `~/.copilot/session-state/<uuid>/events.jsonl` rather than a filesystem-event watcher (fs.watch/inotify). The function is explicitly forward-looking: on open it captures the current file size into `lastSize` and comments state it deliberately does NOT process pre-existing content, deferring backfill of historical lines to a separate sweep component (Plan 51-04). This creates a hard architectural split between 'live tail' (this file) and 'historical sweep' (elsewhere), each with different consistency guarantees, and means a session that starts before the watcher attaches will have a gap unless the sweep later reconciles it.
- [OpenCodeTokenRowExtractor](./OpenCodeTokenRowExtractor.md) -- [LLM] The extractor's central design decision lives in `buildOpencodeTokenRows` (lib/lsl/token/opencode-token-rows.mjs): it only emits a row for a message whose `providerID`/`provider` field is in `BYPASS_PROVIDERS` (currently just `github-copilot`). This is an explicit no-double-count invariant (labeled D-04 in the file's header comment) — proxy-routed OpenCode traffic (provider `anthropic`) is assumed already captured by the rapid-llm-proxy's own wire-level INSERT into `token_usage`, so re-emitting it here would double the ledger. The set is deliberately narrow and documented as something to 'extend deliberately, and only for a provider proven to bypass the proxy', which is a defensive stance against silent double-counting creeping in as new providers are added to OpenCode.
- [ObservationWriteEventBus](./ObservationWriteEventBus.md) -- [LLM] The event bus is a single module-level `EventEmitter` (`_observationEmitter` in src/live-logging/ObservationWriter.js) rather than a class instance property, which means it is a process-wide singleton shared by every `ObservationWriter` instance in the same Node process. This is a deliberate departure from the instance-scoped pattern used elsewhere in the file (e.g. `_writeLock`, `_recentHashes`, `_kmStore` are all `this.*`): the comment at the emitter's declaration explains that obs-api constructs the writer lazily, so an instance-local emitter would force SSE subscribers to wait on writer-init ordering before they could attach a listener. Choosing module scope over instance scope trades encapsulation for subscription availability at any point in the module's lifecycle.


---

*Generated from 10 observations*
