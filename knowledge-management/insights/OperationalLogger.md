# OperationalLogger

**Type:** SubComponent

Distinct from ObservationWriter (src/live-logging/ObservationWriter.js), which is the km-core write path for normalized transcript exchanges rather than raw batched log writes.

# OperationalLogger: Technical Insight Document

## What It Is

OperationalLogger is the runtime-facing operational logging subsystem of the LiveLoggingSystem, implemented in `integrations/semantic-analysis/src/logging.ts` — described explicitly as "the actual hot-path code executed during live sessions." This distinguishes it sharply from preflight/validation tooling: it is not a schema checker but the code path that runs during every live session, writing operational logs as sessions proceed. The class-level implementation surfaces as `OperationalLogger` (class, in `OperationalLogger.js`), with an enhanced variant `EnhancedOperationalLogger` appearing in both `enhanced-operational-logger.js` and `live-logging-coordinator.js`, the latter also hosting the `initializeOperationalLogger` initialization method.

Architecturally, OperationalLogger sits as a child of LiveLoggingSystem alongside siblings LSLConfigValidator, MultiUserFileManager, RedactionEngine, CopilotLiveTail, TokenUsageAdapters, and ObservationWriter — but it is functionally distinct from ObservationWriter, which handles normalized transcript exchange writes (km-core write path) rather than OperationalLogger's raw, batched log writes.

## Architecture and Design

The defining architectural decision is the decoupling of the runtime logging layer from its validation layer. As the parent LiveLoggingSystem context notes, `scripts/validate-lsl-config.js` (LSLConfigValidator) performs preflight/health-check validation independently of `logging.ts`'s hot-path execution — a deliberate separation meaning bugs in one layer won't crash the other, but the two must stay in sync on schema assumptions (field names, defaults) sourced from `lsl-config.json`, or silent runtime misbehavior can result.

Within its own boundary, OperationalLogger applies a buffering/batching pattern: session log writes are buffered and threshold-driven, combining batching with rotation to decouple write frequency from individual log events, reducing I/O pressure during live sessions. This is a classic throughput-over-latency trade-off appropriate for a hot-path logger.

![OperationalLogger — Architecture](images/operational-logger-architecture.png)

OperationalLogger also acts as a composition root for several specialized children: CopilotEventsTailWatcher, TokenUsageDbWriter, OpenCodeTokenRowExtractor, and ObservationWriteEventBus. Each encapsulates a narrow, independently-reasoned concern rather than being folded into a monolithic logger.

## Implementation Details

The `log` method call is the core traced interaction (`Calls: log`), consistent with a class-based logger exposing a primary write API. Configuration is read from `lsl-config.json` at runtime, with OperationalLogger relying on its defaults; any drift between this schema and the validator's expectations can degrade silently rather than fail loudly.

Its children implement distinct mechanics: CopilotEventsTailWatcher performs polling-based file tailing (`tailEventsFile`, 200ms interval) over Copilot's `events.jsonl`, deliberately forward-only (capturing `lastSize` at open, deferring backfill to a separate sweep). TokenUsageDbWriter is conceptually linked to the "second writer" in `token-db.mjs` (`insertTokenRow`/`openTokenDb`) that writes to a proxy-owned SQLite database, distinct from the primary session logger despite living in the same subsystem area. OpenCodeTokenRowExtractor implements a no-double-count invariant (D-04) in `buildOpencodeTokenRows`, only emitting rows for providers in `BYPASS_PROVIDERS` (currently just `github-copilot`) to avoid double-ledgering traffic already captured by the proxy. ObservationWriteEventBus is a module-level `EventEmitter` singleton, chosen over instance-scoping specifically so SSE subscribers aren't forced to wait on writer-initialization ordering.

![OperationalLogger — Relationship](images/operational-logger-relationship.png)

## Integration Points

OperationalLogger integrates upward with LiveLoggingSystem as its container, and laterally depends on configuration (`lsl-config.json`) whose schema is independently validated by sibling LSLConfigValidator — a soft, convention-based coupling rather than a direct code dependency. It is tested via `OperationalLoggerTests` (in `full-system-validation.test.js`), `OperationalLoggerTest` (in `operational-logger.test.js`), and validated operationally through `validateOperationalLogger` in `simplified-system-validation.js`, indicating multiple layers of test coverage (unit, system, and simplified validation scripts).

Downstream, its child components bridge to other subsystems: CopilotEventsTailWatcher connects to Copilot CLI's session-state files, TokenUsageDbWriter connects to a token-usage SQLite store shared with a proxy, and ObservationWriteEventBus provides an SSE-consumable event surface for observation writes.

## Usage Guidelines

Developers modifying `logging.ts` should verify configuration assumptions against the validator's schema in `validate-lsl-config.js`, since the two are architecturally decoupled and won't cross-fail on mismatch. When extending token-related children, follow OpenCodeTokenRowExtractor's documented discipline: only add providers to `BYPASS_PROVIDERS` when proven to bypass the proxy, to avoid double-counting. When touching ObservationWriteEventBus, preserve its module-scoped singleton pattern rather than reverting to instance-scoping, since this specifically supports lazy-constructed writers and early SSE subscription. Finally, remember OperationalLogger is not ObservationWriter — raw batched operational logs versus normalized transcript writes are separate concerns and should not be conflated when debugging write-path issues.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- OperationalLogger (class) in OperationalLogger.js
- EnhancedOperationalLogger (class) in enhanced-operational-logger.js
- EnhancedOperationalLogger (class) in live-logging-coordinator.js
- initializeOperationalLogger (method) in live-logging-coordinator.js
- OperationalLoggerTests (class) in full-system-validation.test.js
- OperationalLoggerTest (class) in operational-logger.test.js
- validateOperationalLogger (function) in simplified-system-validation.js

**Relationships:**
- Calls: log

**Other:**
- OperationalLogger.js (module) in OperationalLogger.js


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The LiveLoggingSystem's validation layer (scripts/validate-lsl-config.js, LSLConfigValidator class) is architecturally decoupled from the runtime logging layer (integrations/semantic-analysis/src/logging.ts). This separation means a developer touching one file should be aware the other exists independently: the validator is a preflight/health-check tool invoked separately (likely via CLI or CI) to sanity-check `.specstory/config/lsl-config.json` and `redaction-config.yaml` before or during operation, while logging.ts is the actual hot-path code executed during live sessions. Bugs in schema validation won't crash live logging and vice versa, but a misconfigured lsl-config.json that passes validation with wrong runtime assumptions could still cause silent misbehavior in logging.ts if the two ever drift out of sync in their assumptions about field names or defaults.

### Children
- [CopilotEventsTailWatcher](./CopilotEventsTailWatcher.md) -- [LLM] The core of `lib/lsl/live/copilot-events-tail.mjs` is `tailEventsFile()`, which implements a polling file-tail (`TAIL_POLL_INTERVAL_MS = 200`) over `statSync` on `~/.copilot/session-state/<uuid>/events.jsonl` rather than a filesystem-event watcher (fs.watch/inotify). The function is explicitly forward-looking: on open it captures the current file size into `lastSize` and comments state it deliberately does NOT process pre-existing content, deferring backfill of historical lines to a separate sweep component (Plan 51-04). This creates a hard architectural split between 'live tail' (this file) and 'historical sweep' (elsewhere), each with different consistency guarantees, and means a session that starts before the watcher attaches will have a gap unless the sweep later reconciles it.
- [TokenUsageDbWriter](./TokenUsageDbWriter.md) -- [LLM] The parent entity TokenUsageDbWriter is described as living in integrations/semantic-analysis/src/logging.ts and being the hot-path executed during live sessions, but the actual code files provided (copilot-events-tail.mjs, opencode-token-rows.mjs, token-db.mjs) belong to a distinct lib/lsl/token/ subsystem. This suggests TokenUsageDbWriter is conceptually related to — but architecturally distinct from — the token-usage.db writer implemented in token-db.mjs's insertTokenRow/openTokenDb functions, which is explicitly documented as a 'second writer' to a proxy-owned SQLite database, not the primary session logger.
- [OpenCodeTokenRowExtractor](./OpenCodeTokenRowExtractor.md) -- [LLM] The extractor's central design decision lives in `buildOpencodeTokenRows` (lib/lsl/token/opencode-token-rows.mjs): it only emits a row for a message whose `providerID`/`provider` field is in `BYPASS_PROVIDERS` (currently just `github-copilot`). This is an explicit no-double-count invariant (labeled D-04 in the file's header comment) — proxy-routed OpenCode traffic (provider `anthropic`) is assumed already captured by the rapid-llm-proxy's own wire-level INSERT into `token_usage`, so re-emitting it here would double the ledger. The set is deliberately narrow and documented as something to 'extend deliberately, and only for a provider proven to bypass the proxy', which is a defensive stance against silent double-counting creeping in as new providers are added to OpenCode.
- [ObservationWriteEventBus](./ObservationWriteEventBus.md) -- [LLM] The event bus is a single module-level `EventEmitter` (`_observationEmitter` in src/live-logging/ObservationWriter.js) rather than a class instance property, which means it is a process-wide singleton shared by every `ObservationWriter` instance in the same Node process. This is a deliberate departure from the instance-scoped pattern used elsewhere in the file (e.g. `_writeLock`, `_recentHashes`, `_kmStore` are all `this.*`): the comment at the emitter's declaration explains that obs-api constructs the writer lazily, so an instance-local emitter would force SSE subscribers to wait on writer-init ordering before they could attach a listener. Choosing module scope over instance scope trades encapsulation for subscription availability at any point in the module's lifecycle.

### Siblings
- [LSLConfigValidator](./LSLConfigValidator.md) -- [CGR] LSLConfigValidator (class) in validate-lsl-config.js
- [MultiUserFileManager](./MultiUserFileManager.md) -- [LLM] No file or class literally named `MultiUserFileManager` appears anywhere in the evidence provided (the code graph is empty and none of the four supplied files declare such a class). The responsibility implied by that name — routing file/database access safely across multiple OS users — is instead DISTRIBUTED across several independent guards: `validateUserEnvironment()` (referenced in the parent LiveLoggingSystem observations) derives a per-user hash to namespace session files, `isOwnedByMe()` in lib/lsl/live/copilot-events-tail.mjs checks file uid ownership before tailing another user's Copilot session directory, and `ownedDbPath()` in lib/lsl/token/opencode-token-rows.mjs performs the identical uid-check pattern before opening `opencode.db`. This SubComponent is therefore best understood as a cross-cutting concern realized by convention across the codebase rather than a single class — a developer looking for 'the multi-user file manager' would need to know to search for the `isOwnedByMe`/`ownedDbPath` idiom, not a single module.
- [RedactionEngine](./RedactionEngine.md) -- [LLM] None of the code excerpts supplied for this analysis (lib/lsl/live/copilot-events-tail.mjs, lib/lsl/token/opencode-token-rows.mjs, lib/lsl/token/token-db.mjs, src/live-logging/ObservationWriter.js, tests/agents/copilot-session-command.test.mjs) contain the RedactionEngine's own implementation — no class or module literally named RedactionEngine appears. The only concrete evidence of a redaction component is the import `import ConfigurableRedactor from './ConfigurableRedactor.js';` at src/live-logging/ObservationWriter.js:19 and the constructor comment noting `this.dbPath` is retained specifically 'as a path string used to derive `projectRoot` for the redactor' (ObservationWriter.js, Phase 44 Plan 13 comment block). This means the redaction subsystem is consumed, not defined, inside the files under review — any deeper architectural claim about RedactionEngine's internals (rule sets, regex patterns, PII categories) cannot be grounded in this evidence set and should be treated as external to what was reviewed.
- [CopilotLiveTail](./CopilotLiveTail.md) -- [LLM] The component's central architectural decision is a permanent, documented data-loss boundary rather than a bug to be fixed: copilot-events-tail.mjs states in its header that 'Copilot CLI emits ONLY subagent.started/subagent.completed/subagent.failed lifecycle events on disk' and that inner reasoning/tool calls are 'NEVER persisted to events.jsonl' — meaning 'The inner reasoning is FOREVER LOST — no live mitigation possible.' The code operationalizes this acceptance by stamping every observation with `lsl_incomplete: true` (constant `COPILOT_LSL_INCOMPLETE_REASON`) and building a synthetic two-message stub via `buildStubObservation()` instead of a real transcript, and by exposing the gap externally through a `lsl_incomplete_marker_present` heartbeat field referenced in the file's own comments. This is a deliberate degraded-parity contract, not an oversight, and any future 'fix' attempt should be redirected toward the heartbeat/health surface rather than toward trying to recover data that structurally does not exist on disk.
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] copilot-events-tail.mjs implements a poll-based file tail (tailEventsFile, TAIL_POLL_INTERVAL_MS=200) over Copilot's `~/.copilot/session-state/<uuid>/events.jsonl` rather than an fs.watch()-based approach, explicitly choosing statSync polling per RESEARCH-copilot.md Option A1. The module's own comments flag a hard architectural limitation: Copilot CLI persists only `subagent.started`/`subagent.completed`/`subagent.failed` lifecycle bookends to disk, never the sub-agent's actual messages or reasoning — so buildStubObservation() synthesizes a 2-message user/assistant exchange from spawn metadata alone, and every resulting observation is stamped `lsl_incomplete: true` with a locked note (COPILOT_LSL_INCOMPLETE_NOTE), a deliberately accepted, permanent data-loss gap rather than a bug to fix.
- [ObservationWriter](./ObservationWriter.md) -- src/live-logging/ObservationWriter.js routes all three write methods through km-core's putEntity via the legacy-ingest adapter (legacyObservationToEntity, legacyDigestToEntity, legacyInsightToEntity), per the Phase 44 hard-cutover decision (no dual-write, no feature flag).


---

*Generated from 13 observations*
