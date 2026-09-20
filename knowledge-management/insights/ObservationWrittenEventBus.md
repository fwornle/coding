# ObservationWrittenEventBus

**Type:** Detail

# ObservationWrittenEventBus

## What It Is

ObservationWrittenEventBus is a module-level publish/subscribe mechanism implemented in `src/live-logging/ObservationWriter.js`, declared as `const _observationEmitter = new EventEmitter();` at import time — outside the boundary of the `ObservationWriter` class itself. This scoping decision is significant enough that the code graph represents `[CGR] ObservationWriter.js (module)` and `[CGR] ObservationWriter (class)` as distinct nodes, capturing a detail that would be invisible if only the class were graphed. The bus exists to give the obs-api SSE route (`/api/coding/observations/stream`) a live fan-out channel for observation writes, decoupled from when or whether an `ObservationWriter` instance has been constructed.

As a child concern of its parent, ObservationWriter — which routes all writes through km-core's `putEntity` via `legacyObservationToEntity`, `legacyDigestToEntity`, and `legacyInsightToEntity` under the Phase 44 hard-cutover policy — this bus is specifically wired to the observation write path only, not the digest or insight paths.

## Architecture and Design

The core pattern is Observer/Publish-Subscribe: because `_observationEmitter` lives at module scope rather than inside the class, `subscribeObservationWritten()` can register listeners before any writer instance exists, fully decoupling writer construction order from subscriber registration. All `ObservationWriter` instances in a process share this single emitter — it is a module-scope singleton, not an instance property.

A second deliberate pattern is the test-seam/surrogate: three functions — `subscribeObservationWritten`, `_resetObservationEmitterForTests`, and `_emitObservationWrittenForTests` — are exported together, letting tests like `ObservationWriter.pre-llm-dedup.test.js`, `ObservationWriter.needs-lsl-resolution.test.js`, and `ObservationWriter.prior-context-lsl.test.js` drive the SSE-facing contract deterministically without invoking `putEntity`/km-core. Notably, these test-only exports ship in the same production module rather than behind a separate test-utilities boundary.

A third pattern is fail-open/best-effort delivery: listener exceptions are explicitly documented as the SSE handler's responsibility, not the emitter's — the bus provides zero isolation between listeners, consistent with the file's broader "never throw, never block the hot path" philosophy also seen in its use of `ConfigurableRedactor` and `resolveLiveTaskIdSafe` as best-effort fallbacks.

## Implementation Details

The unsubscribe mechanic returned by `subscribeObservationWritten` is an idempotent closure — repeated invocation is a no-op — built on `_observationEmitter.on('written', listener)` paired with `_observationEmitter.off('written', listener)`. Test control is handled via `_resetObservationEmitterForTests`, which calls `removeAllListeners('written')`, and `_emitObservationWrittenForTests(row)`, which fires a synthetic event bypassing the entire LLM/dedup pipeline.

Capacity is hard-coded via `_observationEmitter.setMaxListeners(32)`, justified in-source by the estimate that "production has at most ~2 SSE clients" — a defensive magic number chosen to silence Node's default-10 listener warning rather than derived from measured concurrency.

The single event name, `'written'`, carries a payload that "mirrors writeObservation's obsRow object" but is not typed or schema-validated. Cross-referencing the code graph's `Calls: debug` edge and imports (`MentionsClassifier.js`, `ConfigurableRedactor.js`, `window.mjs`/`getLSLWindow`, `task-id.mjs`/`resolveLiveTaskIdSafe`, `repo-router.mjs`/`routeFromArtifacts`) shows the emitted row is the product of an extensive upstream normalization pipeline before reaching `_observationEmitter.emit('written', row)`.

## Integration Points

The bus's primary external consumer is the obs-api SSE route, which relies entirely on `subscribeObservationWritten` for real-time push. Because the payload shape is informal, any SSE consumer is implicitly coupled not just to the emitter's contract but to the entire upstream pipeline that assembles `obsRow`.

Notably, this is the only realtime fan-out mechanism in the file — there is no equivalent bus for digests or insights; `legacyDigestToEntity`/`legacyInsightToEntity` writes appear fire-and-forget with no corresponding emit, an asymmetry worth flagging for future work.

The choice of plain Node `EventEmitter` over the file's existing `ioredis`-based `_redisPub` (used for embedding events) is a deliberate but undocumented boundary: same-process-only "realtime UI push" via EventEmitter versus cross-process "downstream processing signal" via Redis. This mirrors the sibling KmCoreOntologyResolution's defense-in-depth style (its own fallback path resolution "should never fire") — both components layer a primary mechanism with a distinct, narrowly-scoped secondary path rather than unifying them.

## Usage Guidelines

Developers should treat `'written'` payloads as informally typed — validate defensively rather than assuming strict schema parity with `writeObservation`'s `obsRow`. Listener code must handle its own exceptions, since the bus performs no isolation. The `setMaxListeners(32)` ceiling should be revisited if SSE client counts ever exceed low single digits, since it was estimated, not measured. Test-only exports (`_resetObservationEmitterForTests`, `_emitObservationWrittenForTests`) should not be invoked from production code paths despite being co-located with production exports. Finally, if obs-api is ever split across processes, this EventEmitter-based bus will not fan out across process boundaries — any multi-process deployment would require migrating to the existing Redis pub/sub infrastructure or an equivalent cross-process channel.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- The parent-context observation describing `_observationEmitter` as decoupling 'writer construction order from subscriber registration' is directly visible in src/live-logging/ObservationWriter.js: the module-level `EventEmitter` is instantiated at import time (`const _observationEmitter = new EventEmitter();`) rather than inside the `ObservationWriter` class or `init()` method. This means `subscribeObservationWritten()` can be called by the obs-api SSE route (`/api/coding/observations/stream`) before any `ObservationWriter` instance exists, because the emitter's lifecycle is tied to module load, not to writer construction. The code graph's `[CGR] ObservationWriter.js (module)` and `[CGR] ObservationWriter (class)` entries are distinct nodes precisely because this bus lives at module scope, outside the class boundary — a detail that would be invisible if only the class were graphed.

**Relationships:**
- The bus exposes exactly three symbols visible together in ObservationWriter.js: `subscribeObservationWritten` (production API, returns an idempotent unsubscribe closure), `_resetObservationEmitterForTests` (calls `removeAllListeners('written')`), and `_emitObservationWrittenForTests` (fires a synthetic event bypassing the LLM/dedup pipeline). This three-function surface is a deliberate test seam: the code graph's listed test modules — `ObservationWriter.pre-llm-dedup.test.js`, `ObservationWriter.needs-lsl-resolution.test.js`, `ObservationWriter.prior-context-lsl.test.js` — can drive the SSE-facing event contract deterministically without invoking `putEntity`/km-core at all, decoupling bus-behavior tests from the (expensive, stateful) write path.
- The event bus's single event name `'written'` carries a payload shape that is only informally documented ('mirrors writeObservation's obsRow object') rather than typed or validated. Cross-referencing the code graph's `Calls: debug` edge and the `Imports` list (which includes `MentionsClassifier.js`, `ConfigurableRedactor.js`, `window.mjs`/`getLSLWindow`, `task-id.mjs`/`resolveLiveTaskIdSafe`, `repo-router.mjs`/`routeFromArtifacts`) suggests the obsRow payload is assembled from many upstream normalization steps before it ever reaches `_observationEmitter.emit('written', row)` — meaning any consumer of the SSE stream is implicitly coupled to the shape produced by that entire upstream pipeline, not just to the emitter's own contract.

**Other:**
- `_observationEmitter.setMaxListeners(32)` is a hard-coded capacity comment justified in-source as 'production has at most ~2 SSE clients' — this is a magic number chosen defensively against Node's default-10 warning rather than derived from any measured concurrency bound. Given the parent context's note that this same file also integrates `ConfigurableRedactor` and `resolveLiveTaskIdSafe` as best-effort fallbacks, the emitter inherits the file's general 'never throw, never block the hot path' philosophy: listener exceptions are explicitly called out in the comment as the SSE handler's responsibility to catch, not the emitter's — the bus itself provides no isolation between listeners.
- [Code References] src/live-logging/ObservationWriter.js — const _observationEmitter = new EventEmitter(); (module-level bus declaration); src/live-logging/ObservationWriter.js — _observationEmitter.setMaxListeners(32); (capacity override with inline justification comment); src/live-logging/ObservationWriter.js — export function subscribeObservationWritten(listener) { ... _observationEmitter.on('written', listener); return () => { ... _observationEmitter.off('written', listener); }; }; src/live-logging/ObservationWriter.js — export function _resetObservationEmitterForTests() { _observationEmitter.removeAllListeners('written'); }; src/live-logging/ObservationWriter.js — export function _emitObservationWrittenForTests(row) { _observationEmitter.emit('written', row); }; [CGR] ObservationWriter.js (module) in ObservationWriter.js — code-graph node distinguishing module scope from the ObservationWriter class node


## Hierarchy Context

### Parent
- [ObservationWriter](./ObservationWriter.md) -- src/live-logging/ObservationWriter.js routes all three write methods through km-core's putEntity via the legacy-ingest adapter (legacyObservationToEntity, legacyDigestToEntity, legacyInsightToEntity), per the Phase 44 hard-cutover decision (no dual-write, no feature flag).

### Siblings
- [KmCoreOntologyResolution](./KmCoreOntologyResolution.md) -- [LLM] The component's namesake concern — km-core ontology resolution — is implemented entirely inside `resolveKmCoreOntologyDir()` in src/live-logging/ObservationWriter.js, a two-tier fallback: it first calls the package-exported `defaultOntologyDir()` from `@fwornle/km-core`, and only on throw falls back to an `import.<COMPANY_NAME_REDACTED>.resolve`-style manual path walk (`path.dirname(fileURLToPath(import.<COMPANY_NAME_REDACTED>.url))` up through `../../lib/km-core/.data/ontologies`). The function is annotated as enforcing a 'CLAUDE.md mandatory rule' traced to commits 87bc2f567/fd35c5350 — any GraphKMStore construction without `ontologyDir` throws `opts.classes omitted but store has no ontology registry`. This makes ontology-dir resolution a defensive, single-purpose helper rather than a general path-resolution utility, and its fallback branch is explicitly documented as 'should never fire', meaning it exists purely as a defence-in-depth measure against an older/mismatched km-core dist.


---

*Generated from 9 observations*
