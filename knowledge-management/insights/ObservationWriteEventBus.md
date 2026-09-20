# ObservationWriteEventBus

**Type:** Detail

# ObservationWriteEventBus — Technical Insight Document

## What It Is

ObservationWriteEventBus is implemented in `src/live-logging/ObservationWriter.js` as a module-level `EventEmitter` instance named `_observationEmitter`. Rather than being a property of the `ObservationWriter` class, it is declared at module scope, making it a process-wide singleton shared by every `ObservationWriter` instance instantiated within the same Node process. Its purpose is narrow and specific: to notify listeners — chiefly SSE (Server-Sent Events) handlers backing `/api/coding/observations/stream` — that an observation has been successfully written, emitting a `'written'` event whose payload mirrors the persisted `obsRow`.

As a logical child of `OperationalLogger` (which also parents `CopilotEventsTailWatcher`, `TokenUsageDbWriter`, and `OpenCodeTokenRowExtractor`), ObservationWriteEventBus fills a distinct niche among its siblings: where `CopilotEventsTailWatcher` polls a file for live session state and `TokenUsageDbWriter`/`OpenCodeTokenRowExtractor` handle token-accounting ledger writes, this component is purely a post-write notification mechanism for observation persistence, decoupled from any polling or ledger-consistency concerns.

## Architecture and Design

The core architectural choice is an Observer/pub-sub pattern built on a plain Node `EventEmitter`, deliberately scoped at the module level instead of the instance level. This is a conscious departure from the file's otherwise consistent `this.*` encapsulation convention — `_writeLock`, `_recentHashes`, and `_kmStore` are all instance properties, but `_observationEmitter` is not. The documented rationale is subscription availability: since `obs-api` constructs the writer lazily, an instance-scoped emitter would force SSE subscribers to wait on writer-initialization ordering before attaching a listener. Module scope trades encapsulation purity for guaranteed subscribability at any point in the module's lifecycle.

The bus is also architecturally independent of the km-core persistence path (`GraphKMStore`) it sits beside in the same file. It only fires after a successful write, functioning as a post-commit hook rather than a pre-write interceptor — it cannot veto or transform writes, and any consumer is inherently eventually-consistent relative to km-core. Because the coupling between the bus and the write path is limited to the shape of `obsRow` at the emit call site, a future storage-backend change would not require touching the event bus contract.

A notable design gap is the "consumer-responsibility error isolation" pattern: the bus's doc comments state a strict "listeners must never throw" contract, but no try/catch wrapping is enforced by the bus itself. This is a leaky abstraction — the safety net exists only because the current SSE handler is disciplined enough to wrap `res.write` in try/catch, not because the bus enforces it.

## Implementation Details

Three functional pieces anchor the implementation. First, the `_observationEmitter` declaration itself, paired with `setMaxListeners(32)` — a deliberately narrow, justified bound (production expects ~2 SSE clients; 32 tolerates transient multi-client overlap) rather than disabling Node's leak-detection warning outright via `0`/`Infinity`. This preserves leak detection as a safety net against genuine subscriber leaks, such as an SSE handler whose `req.on('close')` never fires.

Second, `subscribeObservationWritten(listener)` returns an unsubscribe function guarded by a closure-captured `unsubscribed` boolean, making repeated calls to the unsubscribe function idempotent. This defensive measure is tailored to its intended call site — `req.on('close')` in an SSE handler — where `'close'` could theoretically fire more than once or race against explicit cleanup.

Third, two test-only exports — `_resetObservationEmitterForTests()` and `_emitObservationWrittenForTests(row)` — are shipped unconditionally in the production module. `_emitObservationWrittenForTests` bypasses the entire LLM summarization/dedup pipeline (`_isSemanticallyDuplicate`, `_writeLock`, km-core's `putEntity`) so the SSE integration test can drive the stream deterministically without an LLM round-trip. This is a permanent, unguarded test seam rather than a conditionally-built one.

## Integration Points

The bus's primary consumer is the SSE endpoint `/api/coding/observations/stream`, which subscribes via `subscribeObservationWritten` and is responsible for its own error isolation around `res.write`. Its producer side is the `ObservationWriter` class's write path, which — per the file's Phase 44 Plan 12/13 comments — represents the SQLite→km-core cutover; the bus emits only after a write successfully lands via km-core's `GraphKMStore`/`putEntity`. Within the `OperationalLogger` hierarchy, it is a sibling concern to `TokenUsageDbWriter` and `OpenCodeTokenRowExtractor` (both concerned with token-usage ledger correctness) and `CopilotEventsTailWatcher` (concerned with live session file tailing) — none of these interact directly with the event bus, underscoring its isolated, single-purpose role.

## Usage Guidelines

Any new subscriber attached to `_observationEmitter` must independently wrap its handling logic in try/catch — the bus provides no enforcement, and an unguarded listener would reintroduce the exact hot-path fragility the design intends to avoid, since listener exceptions surface directly in the writer's hot path. Developers should treat the emitter as a process-wide singleton: because it is module-scoped, it is shared across all `ObservationWriter` instances in a process, so tests must call `_resetObservationEmitterForTests()` to avoid cross-test listener leakage. Given that `_emitObservationWrittenForTests` exists unconditionally, developers should be aware this bypass is reachable from any code importing `ObservationWriter.js`, not just test code — care should be taken not to invoke it in production paths. Finally, since the bus is a post-commit-only notification with no transformation or veto capability, it should never be treated as part of the write-validation path; its consumers must accept eventual consistency with km-core's persisted state.


## Hierarchy Context

### Parent
- [OperationalLogger](./OperationalLogger.md) -- Lives in integrations/semantic-analysis/src/logging.ts, the actual hot-path code executed during live sessions as opposed to the validator's preflight checks.

### Siblings
- [CopilotEventsTailWatcher](./CopilotEventsTailWatcher.md) -- [LLM] The core of `lib/lsl/live/copilot-events-tail.mjs` is `tailEventsFile()`, which implements a polling file-tail (`TAIL_POLL_INTERVAL_MS = 200`) over `statSync` on `~/.copilot/session-state/<uuid>/events.jsonl` rather than a filesystem-event watcher (fs.watch/inotify). The function is explicitly forward-looking: on open it captures the current file size into `lastSize` and comments state it deliberately does NOT process pre-existing content, deferring backfill of historical lines to a separate sweep component (Plan 51-04). This creates a hard architectural split between 'live tail' (this file) and 'historical sweep' (elsewhere), each with different consistency guarantees, and means a session that starts before the watcher attaches will have a gap unless the sweep later reconciles it.
- [TokenUsageDbWriter](./TokenUsageDbWriter.md) -- [LLM] The parent entity TokenUsageDbWriter is described as living in integrations/semantic-analysis/src/logging.ts and being the hot-path executed during live sessions, but the actual code files provided (copilot-events-tail.mjs, opencode-token-rows.mjs, token-db.mjs) belong to a distinct lib/lsl/token/ subsystem. This suggests TokenUsageDbWriter is conceptually related to — but architecturally distinct from — the token-usage.db writer implemented in token-db.mjs's insertTokenRow/openTokenDb functions, which is explicitly documented as a 'second writer' to a proxy-owned SQLite database, not the primary session logger.
- [OpenCodeTokenRowExtractor](./OpenCodeTokenRowExtractor.md) -- [LLM] The extractor's central design decision lives in `buildOpencodeTokenRows` (lib/lsl/token/opencode-token-rows.mjs): it only emits a row for a message whose `providerID`/`provider` field is in `BYPASS_PROVIDERS` (currently just `github-copilot`). This is an explicit no-double-count invariant (labeled D-04 in the file's header comment) — proxy-routed OpenCode traffic (provider `anthropic`) is assumed already captured by the rapid-llm-proxy's own wire-level INSERT into `token_usage`, so re-emitting it here would double the ledger. The set is deliberately narrow and documented as something to 'extend deliberately, and only for a provider proven to bypass the proxy', which is a defensive stance against silent double-counting creeping in as new providers are added to OpenCode.


---

*Generated from 9 observations*
