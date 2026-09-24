# LearningSourceClassifier

**Type:** Detail

## What It Is

`LearningSourceClassifier` is documented in the observations as the module `./learning-source` (expected path `integrations/unified-viewer/src/graph/learning-source.ts`), which is not present in the supplied code. What is visible are two consumers of its exported predicate `isOnlineLearned`: `integrations/unified-viewer/src/graph/color-fallback.ts` (imported at line 1, invoked inside `classColor()`, and referenced in the docstring of the deprecated `isOnlineSource()`) and `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx:29`, which consumes `isOnlineLearned` directly rather than through the deprecated wrapper. The classifier's actual logic — the rules determining what counts as a "digest-shape" fallback or which `subsystem` values qualify — is not present in any supplied file; only its call sites and the predecessor it replaced are visible.

## Architecture and Design

The dominant pattern is a single-source-of-truth predicate: rather than each render path (D3 canvas, legend, filter, history sidebar) independently re-deriving "is this entity online-learned," all of them are described as importing one shared classification function. The `color-fallback.ts` comments document the corrective history behind this: three prior, mutually-diverging schemes (entityType+source logic in D3, ontologyClass+registry logic in buildGraph, and a bare `=== 'auto'` string check in `isOnlineSource()`) each had blind spots, and the classifier was introduced to consolidate them.

A second clear design decision is separation of classification from presentation. `classColor()` calls the classifier, but `nodeFillColor()` — the canonical fill resolver in the same file — deliberately does not; its comment states that the "Hybrid" operator decision keeps fill color source-independent, walking `BATCH_PALETTE` via ontology class/parent chain, and reserves online-learned status for a ring overlay (`ONLINE_RING_COLOR`) applied upstream, conceptually in the territory of the sibling `OnlineProvenanceRingOverlay`. This means the classifier's output currently drives at most two visual channels (legacy fill in `classColor`, ring overlay logic near `D3GraphCanvas.tsx`) and explicitly not the canonical fill resolver — an intentional decoupling of "what is online-learned" from "how it's shown."

A third pattern is the deprecated-wrapper-for-compatibility: `isOnlineSource(source?: string | null)` is retained as a thin, explicitly labeled shim over the classifier for callers that only hold a bare string, even though its own docstring says it "cannot see the subsystem and digest-shape fallbacks that classify the ~138 entities carrying no `source` at all."

## Implementation Details

From the consumer side, the minimal observable input contract is an object shaped like `{ metadata: { source } }`, per the call `isOnlineLearned({ metadata: { source } })` in `classColor()`. The deprecated wrapper's docstring implies the real interface is broader than this — likely including `subsystem` and some digest-shape signal — but neither the shape-fallback rules nor the classifier's function signature are present in the supplied files. The sibling `HierarchyParentDerivation` note is a useful contrast: functions like `nodeFillColor()` and `nodeShapeFor()` consume an already-populated `parent` chain (`reg?.parent`) without computing it; similarly, `color-fallback.ts` consumes `isOnlineLearned`'s verdict without implementing the classification logic itself. Both are downstream readers, not the deciding logic.

## Integration Points

The classifier sits under `OnlineLearning` (parent), alongside siblings `OnlineProvenanceRingOverlay` and `HierarchyParentDerivation`, and is also referenced under `EntityResolutionEngine`, suggesting its logic draws on or affects entity-resolution concerns. Upstream, its input population is shaped by write-path work still in flux: the WaveInsightPersistence dedup integration notes that online-learned insights/observations from the ETM/consolidator flow through an embedding-based near-duplicate detector currently gated behind a dry-run flag, meaning any classifier heuristics are presently tuned against pre-dedup data. Further upstream, the Entity Resolution — Stage 3 investigation concluded Observation and Insight writers should not share a single `LayeredDeduplicator` as-is, leaving open the question of consistent `source`/`subsystem` stamping across writer types — a direct constraint since the classifier must handle inconsistent provenance fields depending on entity origin, consistent with the ~138-entity blind spot cited for `isOnlineSource()`.

## Usage Guidelines

Consumers should call `isOnlineLearned` with as complete an object as available (at minimum `metadata.source`) rather than reaching for the deprecated `isOnlineSource(source)` string check, which is known to miss entities lacking a `source` field entirely. New render paths needing online/batch status should import the shared classifier rather than re-deriving the logic locally, per the pattern that motivated its introduction. Developers should also preserve the classification/presentation separation established in `color-fallback.ts`: fill color logic (`nodeFillColor()`) should remain independent of learning-source status, with such status expressed only via the ring overlay channel. Because the underlying `learning-source.ts` module and the upstream dedup/writer-separation work are both unresolved or absent from current evidence, any tuning of classifier thresholds should be revisited once the ETM dry-run dedup validation and the Observation/Insight writer-separation decision are finalized.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The writeInsight Embedding-Based Dedup Integration record (about WaveInsightPersistence) establishes that the write path producing the entities this classifier later labels — online-learned insights/observations from the ETM/consolidator — is itself mid-validation: embedding-based near-duplicate detection is wired in behind a dry-run flag so live writes are unaffected until latency and precision checks pass. This means the classifier's current input population (source='auto'/'online' entities) reflects a write path that is not yet in its final form, so any threshold or heuristic tuned into the classifier today is tuned against pre-dedup data.
- The Entity Resolution — Stage 3 Shared Deduplicator Investigation record (about KnowledgeManagement) concluded that Observation and Insight writers should NOT share one `LayeredDeduplicator` resolver as-is, with the decision left open. Since the classifier's job is to distinguish online-learned entities regardless of which writer produced them, this unresolved writer-separation is a direct constraint on the classifier: it cannot assume a single upstream resolver stamps `source`/`subsystem` consistently across observation and insight entities, which is consistent with `isOnlineSource()`'s stated failure mode of missing ~138 entities whose provenance shows up in different fields depending on origin.

## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- [LLM] integrations/unified-viewer/src/graph/color-fallback.ts defines `isOnlineSource()` and the canonical `nodeFillColor()` resolver, which together implement the *display* contract for online-learned entities: rather than giving online-learned nodes their own fill color, the code deliberately keeps fill class/hierarchy-based (BATCH_PALETTE walked via parent chain) and reserves `ONLINE_RING_COLOR` ('#f472b6') as a ring overlay applied on top. The inline comment documents this as an explicit 'Hybrid' operator decision reached after two prior schemes (entityType+source in D3, ontologyClass+registry in buildGraph) diverged from the legend. This is evidence of how online-learned provenance is surfaced in the UI, not of how entities come to be marked online-learned in the first place.

### Siblings
- [OnlineProvenanceRingOverlay](./OnlineProvenanceRingOverlay.md) -- [LLM] No file, class, or function named `OnlineProvenanceRingOverlay` appears anywhere in the retrieved code. The nearest artifact is the `ONLINE_RING_COLOR` constant ('#f472b6') exported from `integrations/unified-viewer/src/graph/color-fallback.ts`, which is a bare hex-string value, not a component or rendering routine. Nothing in the supplied excerpts shows a function that appends an SVG ring/circle element, sets a stroke on a node, or otherwise implements 'overlay' behavior — the name appears to describe a UI concept documented in the parent entity's observations rather than a discrete unit of code retrievable here.
- [HierarchyParentDerivation](./HierarchyParentDerivation.md) -- [LLM] The nearest thing to "HierarchyParentDerivation" in the supplied files is `nodeFillColor()` and `nodeShapeFor()` in integrations/unified-viewer/src/graph/color-fallback.ts, which each walk a `ClassRegistryEntry.parent` chain (`cur = reg?.parent ?? undefined`) to resolve a color/shape when a class has no styled entry of its own. Critically, both functions are *consumers* of an already-populated `parent` field on the ontology registry — they read `reg?.parent` but contain no logic that computes, infers, or assigns what an entity's or class's parent should be. If HierarchyParentDerivation is the component that decides an entity's place in the Project→Component→SubComponent→Detail tree, this file is downstream of it, not it.


---

*Generated from 9 observations*
