# ObservationWriteEventBus

**Type:** Detail

## What It Is

ObservationWriteEventBus is not a standalone file or class — it is a single module-level `_observationEmitter = new EventEmitter()` instance embedded directly in `src/live-logging/ObservationWriter.js`. There is no `ObservationWriteEventBus.js`; the "event bus" is an in-code construct labeled in a comment block as "Phase 55 Plan 06 Task 3 — process-wide observation-write event bus." Its stated purpose is to give the obs-api SSE endpoint `/api/coding/observations/stream` a hook to broadcast each successful observation write to long-poll HTTP listeners, without requiring subscribers to traverse the full writer-init pipeline.

As a child of ObservationWriter, it taps directly into that component's write path — the same path modified by the parent's Attribution Router Module work (deterministic path-based routing via repo-router.mjs) and by sibling AnchorRouting's `ANCHOR_ROOT` / `ANCHOR_FOR_KIND` lookup table. The event bus is agnostic to *how* a row was routed or anchored; it only cares that a write succeeded.

## Architecture and Design

The design follows a classic observer/publish-subscribe pattern, but scoped at module level rather than class level — a deliberate choice that decouples the write hot path from SSE fan-out without introducing a distinct component boundary. This mirrors the low-ceremony style of AnchorRouting, which similarly encodes behavior as data (a lookup table) rather than a class hierarchy.

Two architectural asymmetries stand out. First, error-handling responsibility is inverted: listeners "MUST NOT throw," pushing the try/catch obligation onto the SSE handler consuming events rather than onto `_observationEmitter` or the writer itself. This protects the writer's hot path — including the turn-scoped deduplication and snapshot-promotion logic tracked in ObservationWriter's related session work — from being derailed by a misbehaving subscriber. Second, the listener capacity of 32 (`setMaxListeners(32)`) is a defensive headroom choice, not a scalability provision — the comment explicitly notes production expects ~2 SSE clients, and the bump merely silences Node's default-cap warning during connection churn.

## Implementation Details

The public surface is intentionally narrow. `subscribeObservationWritten(listener)` registers on the single `'written'` event and returns an idempotent unsubscribe closure guarded by an `unsubscribed` boolean, making repeated invocations of the returned function safe no-ops. This shape is tied directly to SSE connection lifecycle: callers are expected to invoke the closure inside `req.on('close')`, releasing a listener slot precisely when an HTTP client disconnects rather than leaking listeners across dropped connections.

Two test-only escape hatches — `_resetObservationEmitterForTests()` and `_emitObservationWrittenForTests(row)` — exist solely to let `/api/coding/observations/stream` be exercised deterministically without running the full LLM/dedup pipeline. Production code never calls the reset function; listener scope is meant to track a single SSE connection's lifetime, released only via the unsubscribe closure. Notably, a subscriber cannot distinguish a synthetic test row from a real promoted/deduplicated row emitted by the writer's turn-scoped dedup logic unless it inspects the row's own metadata.

## Integration Points

The event bus's sole external consumer, per the observations, is the obs-api SSE endpoint `/api/coding/observations/stream`. It sits downstream of ObservationWriter's core write path, meaning any behavior upstream — sibling AttributionRouterModule's deterministic routing, AnchorRouting's kind-based anchor resolution, or LegacyIngestAdapters' `legacyObservationToEntity`/`legacyDigestToEntity`/`legacyInsightToEntity` conversions — is invisible to the bus; it only sees the resulting successful write emission. It has no persistence layer and no dependency on external message infrastructure — it is pure in-process Node `EventEmitter` machinery.

## Usage Guidelines

Subscribers must never throw inside their listener callback, since exceptions would surface in the writer's hot path. Always pair `subscribeObservationWritten` with its returned unsubscribe closure inside connection-teardown handlers (`req.on('close')`) to avoid listener leaks. Never invoke `_resetObservationEmitterForTests` outside test harnesses. Because `_observationEmitter` is entirely process-local and non-persistent, any process restart — including health-coordinator auto-heal kickstarts referenced in ObservationWriter's retry-budget work — silently drops all active SSE subscriptions with no replay mechanism; this is not surfaced as a writer-level retry, so consumers must independently handle reconnection. Finally, do not treat the 32-listener cap as evidence of a designed multi-consumer fan-out architecture; it is warning-suppression headroom for an expected ~2-client production scenario, not a scalability guarantee.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'ObservationWriter — Turn-Scoped Deduplication and Snapshot Promotion' work record describes scoping duplicate-content checks to a single turn via a stable turn key and promoting orphaned mid-turn snapshots to final summaries via content-hash matching — this is downstream of the same write path the event bus taps with its `'written'` emission, meaning a promoted/deduplicated row and a synthetic test row (`_emitObservationWrittenForTests`) are indistinguishable to a subscriber unless the row's own metadata is inspected.
- The 'ObservationWriter Retry Budget' work record notes the writer must tolerate brief service-restart gaps triggered by the health coordinator's auto-heal kickstart mechanism. Because `_observationEmitter` is a process-local, in-memory EventEmitter with no persistence or replay, any restart of the process hosting ObservationWriter drops all active SSE subscriptions along with it — a kickstart-triggered restart silently disconnects every long-poll listener rather than surfacing as a writer-level retry.

## Hierarchy Context

### Parent
- [ObservationWriter](./ObservationWriter.md) -- [SESSION] Attribution Router Module: ObservationWriter now uses deterministic path-based routing (repo-router.mjs) instead of a prior unreliable embedding-similarity voting approach, fixing misattribution of KB observations to owning teams/repos

### Siblings
- [AttributionRouterModule](./AttributionRouterModule.md) -- [SESSION] Attribution Router Module: ObservationWriter now uses deterministic path-based routing (repo-router.mjs) instead of a prior unreliable embedding-similarity voting approach, fixing misattribution of KB observations to owning teams/repos.
- [LegacyIngestAdapters](./LegacyIngestAdapters.md) -- [LLM] The only trace of "legacy-ingest" adapters in the supplied code is a set of import statements in src/live-logging/ObservationWriter.js: `legacyObservationToEntity`, `legacyDigestToEntity`, and `legacyInsightToEntity`, pulled from the package path `@fwornle/km-core/adapters/legacy-ingest`. The module that actually defines these three functions — described in ObservationWriter.js's own header comment as living at `lib/km-core/src/adapters/legacy-ingest.ts` — is not among the files provided, so no observation here can speak to its field-mapping logic, error handling, or adapter-specific behavior.
- [AnchorRouting](./AnchorRouting.md) -- [LLM+CGR] The anchor-routing logic lives directly in src/live-logging/ObservationWriter.js as the `ANCHOR_ROOT` / `ANCHOR_FOR_KIND` constants: every `capturedBy` edge falls back to a single root target (`'LiveLoggingSystem'`) unless the entity's kind has a more specific target — `observation` routes to `'ObservationWriter'`, while both `digest` and `insight` route to `'ObservationConsolidator'`. This is a two-tier resolution function encoded as data (a plain object lookup) rather than a branching function, so adding a new entity kind is a one-line table edit rather than a code change.


---

*Generated from 10 observations*
