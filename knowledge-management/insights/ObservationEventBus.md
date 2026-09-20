# ObservationEventBus

**Type:** Detail

[LLM+CGR] ObservationWriter.js implements a module-level `_observationEmitter` (a plain Node `EventEmitter`, `setMaxListeners(32)`) alongside exported `subscribeObservationWritten`, `_resetObservationEmitterForTests`, and `_emitObservationWrittenForTests` functions — this is the ObservationEventBus itself. The code graph's parent context confirms this is a deliberate Phase 55 Plan 06 Task 3 decision: rather than an instance-scoped emitter tied to the `ObservationWriter` class's lifecycle (which is constructed lazily by obs-api per the `_ensureObservationWriter` method noted in the parent CGR entities), a process-wide singleton lets the `/api/coding/observations/stream` SSE endpoint subscribe independently of when/whether a writer instance exists yet. The trade-off is explicit in the source comment: encapsulation purity is sacrificed for lifecycle simplicity.

# ObservationEventBus — Technical Insight Document

## What It Is

The ObservationEventBus is implemented in `src/live-logging/ObservationWriter.js` as a module-level Node `EventEmitter` (`_observationEmitter`), not an instance property of the `ObservationWriter` class. It is exported through a small, deliberate public surface: `subscribeObservationWritten` for consumers to register listeners, plus two test-only backdoors, `_resetObservationEmitterForTests` and `_emitObservationWrittenForTests`. Functionally, it is the mechanism by which the `/api/coding/observations/stream` SSE endpoint learns that a new observation row has been persisted, without needing any direct reference to a live `ObservationWriter` instance. As a child concept of its parent `ObservationWriter`, the bus is a narrowly scoped notification channel bolted onto the writer's write path rather than a general-purpose messaging layer.

## Architecture and Design

The core architectural decision — explicitly called out in the source comment and confirmed by the parent code-graph context — is to use a **process-wide singleton emitter** instead of an emitter scoped to each `ObservationWriter` instance. This matters because `ObservationWriter` is lazily constructed by obs-api via `_ensureObservationWriter`; an instance-scoped emitter would force the SSE endpoint to wait on or coordinate with that lazy construction. The module-level singleton sidesteps init-ordering entirely, letting subscribers attach before a writer even exists. This is a textbook Observer/Pub-Sub pattern, but the notable trade-off — stated directly in-source — is that encapsulation purity is sacrificed for lifecycle simplicity.

A second architectural property is temporal placement within the write pipeline. The bus only fires on `'written'`, downstream of the fan-in pipeline described in the parent context (`routeFromArtifacts`, `resolveLiveTaskIdSafe`, `getLSLWindow`, `ConfigurableRedactor`, culminating in a km-core `putEntity` call). Because the emit happens only after redaction, routing, and dedup succeed, SSE subscribers structurally cannot observe raw or unredacted transcript content — a security property that emerges from pipeline ordering rather than from any validation inside the bus itself.

Sibling components in the same file illustrate a shared design philosophy of pragmatic, comment-driven safety nets rather than hard enforcement: `AckPhraseGate`'s dual-condition whitelist check and `KmCoreOntologyResolver`'s "should never fire" fallback both mirror the bus's own reliance on documented convention (e.g., "listeners MUST NOT throw") over structural guarantees.

## Implementation Details

The emitter is configured with `setMaxListeners(32)`, a heuristic ceiling justified in-comment as 16x headroom over an expected real-world load of roughly two SSE clients (a dev server plus one browser tab). This number is not derived from load testing — it is a judgment call to suppress Node's default max-listener warning during transient multi-client conditions.

`subscribeObservationWritten(listener)` returns an unsubscribe handle guarded by an `unsubscribed` boolean, making repeated calls to unsubscribe idempotent. This is designed for exactly the kind of cleanup ambiguity SSE connections introduce — an HTTP `req.on('close')` handler may fire more than once or race with other teardown code, and the guard makes that safe without relying on `EventEmitter.off`'s own idempotence.

Error handling is asymmetric: the bus documents a listener contract ("handlers MUST NOT throw") but does not itself wrap the `.emit('written', obsRow)` call in try/catch. Enforcement instead lives entirely on the consumer side, where the SSE handler wraps `res.write` defensively. This means a listener exception would propagate synchronously back into `writeObservation`'s call stack — a latent fragility that only holds up because there is currently a single, disciplined listener.

Finally, the two test-only exports exist because the singleton's global mutable state is otherwise untestable in isolation: `_resetObservationEmitterForTests()` clears accumulated listeners between test cases, and `_emitObservationWrittenForTests(row)` synthesizes events without running the full write pipeline. Because Node module caching means every importer shares the same `_observationEmitter` instance for the process lifetime, omitting the reset call risks listener leakage or false-positive event delivery across unrelated test files.

## Integration Points

The bus's principal upstream integration is with the write path inside `ObservationWriter` itself — the `emit('written', obsRow)` call site sits after the full redaction/routing/dedup pipeline, making the bus implicitly dependent on that pipeline's correctness for its security guarantees. Downstream, its primary consumer is the `/api/coding/observations/stream` SSE endpoint, which subscribes via `subscribeObservationWritten` and must independently guard its own `res.write` calls against errors. Within the same file, it coexists with unrelated concerns like the constructor's anchor-edge cache (`_anchorId`, `_anchorResolveAttempted`), the `AckPhraseGate`'s `_ACK_PHRASES` triviality check, and `KmCoreOntologyResolver`'s ontology-directory resolution — all siblings under `ObservationWriter` but architecturally independent of the event bus.

## Usage Guidelines

Any new listener registered via `subscribeObservationWritten` must never throw, since the bus provides no isolation between listener failures and the writer's hot path — this is a hard requirement rather than a suggestion, given the absence of try/catch around `.emit()`. Unsubscribe handles are safe to call multiple times or from multiple cleanup paths due to the idempotent guard, so consumers should not add their own duplicate-call protection. Test authors importing `ObservationWriter.js` must call `_resetObservationEmitterForTests()` between test cases to avoid cross-test listener leakage, since the emitter is a shared, process-lifetime singleton. If future work introduces genuinely multi-tenant or multi-tab SSE usage, the hardcoded `setMaxListeners(32)` ceiling should be revisited — it currently exists to silence Node's warning under a single-operator assumption and could mask a real listener leak if that assumption stops holding.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- ObservationWriter.js implements a module-level `_observationEmitter` (a plain Node `EventEmitter`, `setMaxListeners(32)`) alongside exported `subscribeObservationWritten`, `_resetObservationEmitterForTests`, and `_emitObservationWrittenForTests` functions — this is the ObservationEventBus itself. The code graph's parent context confirms this is a deliberate Phase 55 Plan 06 Task 3 decision: rather than an instance-scoped emitter tied to the `ObservationWriter` class's lifecycle (which is constructed lazily by obs-api per the `_ensureObservationWriter` method noted in the parent CGR entities), a process-wide singleton lets the `/api/coding/observations/stream` SSE endpoint subscribe independently of when/whether a writer instance exists yet. The trade-off is explicit in the source comment: encapsulation purity is sacrificed for lifecycle simplicity.
- The unsubscribe function returned by `subscribeObservationWritten` is explicitly idempotent (`if (unsubscribed) return;`), a defensive pattern suited to the SSE use case referenced in the parent context's health/observability discussion: an HTTP client's `req.on('close')` handler could fire multiple times or race with other cleanup paths, and a non-idempotent `.off()` call is harmless anyway, so the guard is more about documenting intent (call this exactly once, safely, from anywhere) than preventing an actual bug in `EventEmitter.off`. This mirrors the same 'externally monitored, pull-based observability' philosophy the parent context describes for `fetchLastObservationWriterCallAge` in health-coordinator.js — both patterns decouple a consumer's lifecycle from the writer's internal state via a narrow, dedicated interface rather than deep coupling.
- Architecturally, the ObservationEventBus sits downstream of the fan-in write pipeline the parent context describes (`routeFromArtifacts`, `resolveLiveTaskIdSafe`, `getLSLWindow`, `ConfigurableRedactor` all converging before a single km-core `putEntity` call) — it only fires on `'written'`, i.e., after all upstream redaction, routing, and dedup logic has already succeeded. This means the event bus's payload (`the observation row that was persisted`) is guaranteed post-redaction and post-anchor-resolution, so SSE subscribers never see raw or unredacted transcript content, an implicit security property that follows from where in the pipeline the `.emit()` call is placed rather than from any check inside the bus itself.


## Hierarchy Context

### Parent
- [ObservationWriter](./ObservationWriter.md) -- [CGR] ObservationWriter (class) in ObservationWriter.js

### Siblings
- [AckPhraseGate](./AckPhraseGate.md) -- [LLM] The `_ACK_PHRASES` set in `src/live-logging/ObservationWriter.js` (class `ObservationWriter`, static field around the constructor) is a curated, length-capped whitelist of 40-ish whole-message acknowledgements ('y', 'ok', 'lgtm', 'thanks', 'go ahead', etc.) used as a pre-LLM triviality gate. The comment explicitly ties correctness to two conditions: the phrase must match the WHOLE message (not a substring) and the turn must have touched no files — this dual-condition design is what prevents a legitimately short request like 'go' (meaning 'go to line 40') from being misclassified as a filler acknowledgement, since the file-touch check acts as a corroborating signal beyond lexical matching alone.
- [KmCoreOntologyResolver](./KmCoreOntologyResolver.md) -- [LLM] The `resolveKmCoreOntologyDir()` function in `src/live-logging/ObservationWriter.js` implements a two-tier fallback strategy for locating the km-core ontology directory: it first tries the package-exported `defaultOntologyDir()` helper (imported from `@fwornle/km-core`), and only on failure falls back to a hand-rolled `import.<COMPANY_NAME_REDACTED>.resolve`-style walk-up that computes `path.resolve(here, '..', '..', 'lib', 'km-core', '.data', 'ontologies')` from `fileURLToPath(import.<COMPANY_NAME_REDACTED>.url)`. The comment explicitly labels this fallback path as one that 'should never fire' — an optimistic assumption that deserves scrutiny given the function's own docstring cites a CLAUDE.md mandatory rule (Phase 41 lesson, commits 87bc2f567/fd35c5350) stating that ANY host-side process constructing `GraphKMStore` MUST pass `ontologyDir`, since omitting it throws `opts.classes omitted but store has no ontology registry`.


---

*Generated from 9 observations*
