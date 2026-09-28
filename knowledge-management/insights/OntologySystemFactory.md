# OntologySystemFactory

**Type:** Detail

## What It Is

`OntologySystemFactory` refers to the factory logic implemented in `src/ontology/index.ts`, specifically the exported async function `createOntologySystem(config, inferenceEngine, adapter)`. It is the sole implementation among the retrieved files that behaves as a factory: it validates required collaborators, constructs the ontology subsystem's core objects, and returns them bundled together as an `OntologySystem`. The same file also exports a structurally unrelated function, `validateOntologyConfig(config)`, which checks `OntologyConfig` shape but is never invoked by the factory itself.

## Architecture and Design

The dominant pattern is a straightforward **factory function**: `createOntologySystem` assembles an `OntologyValidator(adapter)`, a heuristic classifier via `createHeuristicClassifier()`, and an `OntologyClassifier(adapter, validator, heuristicClassifier, inferenceEngine)`, returning them together with `config` as an `OntologySystem` object (`{ontology, validator, classifier, config}`). Layered onto this is an **adapter pattern**: `LegacyOntologyAdapter` wraps km-core's `OntologyRegistry`, letting `OntologyValidator`/`OntologyClassifier` keep an interface shape that predates Phase-42-03, so existing call paths in `persistence-agent.ts` don't need to change. Crucially, the factory does not construct the adapter itself — that responsibility, and the km-core coupling it implies, is pushed onto the caller, keeping `src/ontology/index.ts` free of km-core imports. This is a deliberate boundary decision documented directly in JSDoc, not an incidental omission.

The factory also applies **fail-fast dependency injection**: both `inferenceEngine` and `adapter` are required, with explicit throws ('createOntologySystem requires an inferenceEngine... No mock fallback is provided' and '...requires a LegacyOntologyAdapter') rather than silent defaults or mocks. Finally, there's a clear **separation of validation from construction** — `validateOntologyConfig` exists as an independent pure function and is architecturally decoupled from `createOntologySystem`'s call path.

## Implementation Details

`createOntologySystem` performs two hard-throw checks before doing any construction work, ensuring no partially-wired system is ever returned. Once inputs are confirmed, it wires together three collaborators in sequence: the validator (which depends only on the adapter), a heuristic classifier (parameterless), and the full classifier (which depends on adapter, validator, heuristic classifier, and inference engine). The resulting `OntologySystem` interface bundles these plus the original `config` for downstream consumers.

Separately, `validateOntologyConfig(config)` checks structural rules — e.g., `upperOntologyPath` is required when `enabled` is true, `lowerOntologyPath` is required when `team` is set — and returns `{valid, errors}`. Because this function is not called from inside the factory, a caller can successfully build an `OntologySystem` from a config that is structurally invalid (e.g., missing `upperOntologyPath`); config validation is opt-in for callers, not enforced by construction.

## Integration Points

The factory's only enforced dependencies are `inferenceEngine` and a pre-built `LegacyOntologyAdapter`; it has no direct dependency on km-core's `OntologyRegistry` — that coupling exists one level up, in whatever constructs the adapter. This has a live consequence: the Pipeline's CodingLowerOntologySource Emission Bug shows the pipeline emitting a `CodingLowerOntologySource` reference into `coding.lower.json`, feeding the same `OntologyRegistry` that `LegacyOntologyAdapter` wraps — meaning a system built via this factory could be operating over an adapter whose underlying registry already violates its documented source-type contract, without the factory having any visibility into that.

Within the entity hierarchy, Pipeline, Ontology, OntologyClassificationAgent, and SemanticAnalysisAgent all "contain" `OntologySystemFactory`, reflecting that it's shared assembly logic rather than owned by a single agent. The parent context notes SemanticAnalysisAgent's Taxonomy Stability Validation work (validating intent-derived taxonomies via disjoint-sample re-derivation), and per that context OntologyClassificationAgent and SemanticAnalysisAgent are sibling agents sharing this ontology plumbing — but no supplied file actually shows SemanticAnalysisAgent calling `createOntologySystem`; that link is inferential, not observed.

Four other retrieved files — `batch-progress.tsx`, `scripts/health-coordinator.js`, `scripts/repair-writer-ontology-class.mjs`, and `tests/integration/health-coordinator-etm-expected.test.mjs` — form no dependency edge to `src/ontology/index.ts`; they were matched by filename/keyword proximity only. Notably, `repair-writer-ontology-class.mjs` operates on an `ontologyClass` metadata field over obs-api entities via HTTP, using its own `loadParentMap()`/`ARTIFACT_CLASSES` logic — a data-repair concern entirely separate from the classifier/validator wiring this factory produces.

## Usage Guidelines

Callers must construct the `OntologyRegistry` and its `LegacyOntologyAdapter` wrapper themselves before invoking `createOntologySystem` — the factory will throw rather than default if `adapter` or `inferenceEngine` is missing, and it deliberately provides no mock fallback for `inferenceEngine`, even in test/dev contexts. Callers concerned with config correctness should explicitly invoke `validateOntologyConfig(config)` beforehand, since the factory performs no such structural checking and will happily construct a system from an incomplete `OntologyConfig` (e.g., one missing `upperOntologyPath`). Given the unresolved `CodingLowerOntologySource` emission bug affecting the underlying `OntologyRegistry`, consumers should be aware that adapter-level data may not conform to documented contracts even though the factory's own wiring is correct — this is a gap outside the factory's control. Finally, do not assume the four thematically adjacent files (health coordinator, repair script, dashboard UI, ETM test) participate in this factory's object graph; they were retrieved by naming coincidence and carry no actual coupling to `src/ontology/index.ts`.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Pipeline CodingLowerOntologySource Emission Bug work record documents a live, unresolved discrepancy: the pipeline emits a `CodingLowerOntologySource` reference despite documentation stating this source type should never be produced. The bug is scoped to the emission path downstream of the L2 refinement source model — `coding.lower.json` feeding km-core's `OntologyRegistry` — which is the same registry that `LegacyOntologyAdapter` wraps before being passed as the required `adapter` argument to `createOntologySystem`. The record treats this as a genuine implementation gap, not a doc error, meaning a system built via this factory could be operating on an adapter whose underlying registry already violates the documented source-type contract.
- The Taxonomy Stability Validation via Disjoint Sample Re-derivation record, associated with SemanticAnalysisAgent, establishes that an intent-derived taxonomy is validated by independently re-deriving it from disjoint data samples and measuring agreement, treating stability as an empirically measured property rather than an assumption baked into clustering. Per the parent context, SemanticAnalysisAgent and OntologyClassificationAgent are sibling agents sharing the ontology plumbing this factory assembles, but no supplied file shows SemanticAnalysisAgent invoking `createOntologySystem` — the connection between this taxonomy-validation work and the factory's classifier/validator output is inferred from agent descriptions, not observed in code.

## Hierarchy Context

### Parent
- [SemanticAnalysisAgent](./SemanticAnalysisAgent.md) -- [SESSION] Taxonomy Stability Validation via Disjoint Sample Re-derivation validates that an intent-derived taxonomy is stable enough to serve as a fixed spine by re-deriving it independently from disjoint data samples and measuring agreement.


---

*Generated from 9 observations*
