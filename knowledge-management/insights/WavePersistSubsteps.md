# WavePersistSubsteps

**Type:** Detail

[Architecture Notes] Persistence is modeled as three UI-declared, LLM-free sub-steps (w1/w2/w3) whose semantics (e.g. w3's merge behavior) are encoded only in free-text techNote strings, not structured, type-checked fields — a latent drift risk if persistence logic changes.; ukbSlice.ts's WaveGroup/StepInfo types carry both current and legacy telemetry shapes simultaneously via optional fields, meaning every UI consumer must defensively handle undefined itemsCompleted/itemsTotal.; ETA computation (ukb-workflow-modal.tsx) is entirely a client-side statistical reconstruction from raw per-step durations; the persistence agent itself surfaces no progress signal, pushing all forecasting complexity into calculateDynamicEta.; D3GraphCanvas.tsx exhibits a dual source-of-truth resolution pattern (store pathToSelected vs inline BFS) explicitly introduced to fix a prior 'duplicated source-of-truth' audit finding (S3), indicating the graph rendering layer was previously inconsistent across two rendering engines (D3 and Sigma).; color-fallback.ts contains two independently-evolved color resolution functions (classColor vs nodeFillColor) with different provenance semantics (fill-encodes-source vs ring-encodes-source) — the file's own comments flag this as an intentional but overlapping transition, not a clean single API.

# WavePersistSubsteps — Technical Insight Document

## What It Is

WavePersistSubsteps refers to the three concrete UI-declared sub-steps — **w1**, **w2**, and **w3** — that implement the parent entity WaveInsightPersistence within `AGENT_SUBSTEPS['persistence']` in `integrations/system-health-dashboard/src/components/workflow/multi-agent-graph.tsx`. These sub-steps represent the sequential, wave-scoped commit points where already-synthesized entities (L0 Project/L1 Component in w1, L2 SubComponent in w2, L3 Detail + operator-refined fields/embeddings in w3) are written to storage. All three declare `llmUsage: 'none'` and a `techNote` of `'GraphDB + LevelDB storage'`, with w3 uniquely appending `'direct attribute merge'` — the only textual signal in the entire structure that Wave 3 performs reconciliation against pre-existing entities rather than pure insertion.

## Architecture and Design

The design pattern here is **sequential sub-step decomposition with static per-step metadata**: each wave's work is flattened into a fixed array of sub-steps carried by the `SubStep` interface, with `llmUsage` and `techNote` as declarative, UI-facing fields rather than runtime-derived signals. This makes persistence the single agent in AGENT_SUBSTEPS that is entirely LLM-free across all sub-steps, in contrast to siblings like `kg_operators` or `insight_generation`, which mix `'none'` with `'fast'/'standard'/'premium'`. The trade-off is clear: simplicity and static predictability for the UI, at the cost of no runtime verification — nothing prevents w3 from later gaining an actual LLM-backed reconciliation step without the type system forcing an `llmUsage` update.

A second architectural layer sits in `ukbSlice.ts`, where `WaveGroup` groups `StepInfo` entries by `waveNumber` and pairs them with `TraceEntityFlow` (produced/passedQA/persisted/rejectedReasons). The optional `itemsCompleted`/`itemsTotal` fields (documented via a "Phase 52 D-15" comment) implement **schema evolution via optional fields**, explicitly preserving compatibility with legacy telemetry that lacked per-item emission.

A third layer, `calculateDynamicEta` in `ukb-workflow-modal.tsx`, treats w1/w2/w3 durations (folded into `batchIterations[].steps`) as opaque blobs, applying a **learn-then-clamp** ETA strategy bounded to `[linearEtaMs * 0.3, linearEtaMs * 2.0]`.

## Implementation Details

Each sub-step is a `SubStep` object with `llmUsage: 'none'` and a technote string — no boolean or enum captures merge semantics; w3's "direct attribute merge" language is purely descriptive text, unconsumed by any structured API. `TraceEntityFlow` in ukbSlice.ts is the only structured channel available to downstream consumers wanting to know what happened during persistence, but it cannot express *how* w3 differs from w1/w2 at a semantic level — any code wanting that distinction must hard-code or string-match against w3.

`calculateDynamicEta` sums `step.duration` into `learnedAvgBatchMs` only once `batch.steps.every(s => s.status === 'completed' || s.status === 'skipped')`, applying a 1.2x conservative multiplier when `completedBatchCount < 2`. This compensates for persistence never emitting its own progress/ETA signal mid-write — all forecasting is reconstructed after the fact from completed batches.

## Integration Points

WavePersistSubsteps sits downstream of the LLM-driven agents (kg_operators, semantic_analysis, insight_generation) — persistence's job is purely committal, never synthesis. Its outputs feed `WaveGroup`/`TraceEntityFlow` in ukbSlice.ts, consumed by history/detail views in `ukb-workflow-modal.tsx`, and indirectly inform ETA computation via `calculateDynamicEta`. On the graph-rendering side, entities persisted through w3's merge step eventually surface in `D3GraphCanvas.tsx` (`deriveAncestryFromStorePath`, `buildRehomeEdges`) and `color-fallback.ts` (`nodeFillColor`, `classColor`), where provenance (batch vs. online-learned) is rendered via fill vs. ring — a distinction conceptually adjacent to, but not derived from, the w1/w2/w3 techNote metadata.

## Usage Guidelines

Developers extending w3's merge behavior must manually update `llmUsage` in `AGENT_SUBSTEPS['persistence']` if any inference is introduced — the type system will not catch drift. Any code needing to distinguish w3's "merge" semantics from w1/w2's pure inserts should avoid ad hoc string-matching on `techNote` and instead consider promoting this to a typed field (e.g., `mergesExisting: boolean`) on `SubStep`. Consumers of `WaveGroup` must guard against undefined `itemsCompleted`/`itemsTotal` given the deliberate legacy-compatibility design. Finally, since persistence emits no native progress signal, any UI relying on ETA must treat `calculateDynamicEta`'s output as a statistical approximation, especially unreliable during the first one or two batches.


## Hierarchy Context

### Parent
- [WaveInsightPersistence](./WaveInsightPersistence.md) -- [LLM] The 'persistence' entry in AGENT_SUBSTEPS (integrations/system-health-dashboard/src/components/workflow/multi-agent-graph.tsx) models WaveInsightPersistence as three explicit, sequential sub-steps — w1 ('Wave 1 Persist', L0 Project + L1 Component entities), w2 ('Wave 2 Persist', L2 SubComponent entities), and w3 ('Wave 3 Persist', L3 Detail entities plus operator-refined fields and embeddings). All three declare llmUsage: 'none' and techNote: 'GraphDB + LevelDB storage', confirming that persistence itself is a pure storage operation with no LLM calls — the LLM work (pattern discovery, entity extraction, classification) happens upstream in kg_operators/semantic_analysis/insight_generation, and persistence's job is purely to commit already-synthesized entities. Notably w3's techNote uniquely adds 'direct attribute merge', implying Wave 3 does not simply insert new nodes but merges operator-enriched fields (e.g. embeddings) onto entities that may already exist from earlier waves — a detail not present in w1/w2, suggesting Wave 3 is where duplicate-entity reconciliation actually happens rather than at insight-generation time.


---

*Generated from 9 observations*
