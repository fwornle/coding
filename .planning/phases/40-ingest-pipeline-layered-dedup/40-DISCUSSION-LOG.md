# Phase 40: Ingest Pipeline & Layered Dedup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21
**Phase:** 40-ingest-pipeline-layered-dedup
**Areas discussed:** Pipeline integration shape, Stage execution & cadence control, Dedup layer plug-in shape, A/B legacy-code coupling strategy, Candidate pool sourcing

---

## Pipeline Integration Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Options-object composition (Recommended) | `new IngestPipeline(store, { extractor, deduplicator, synthesizer })`. Matches Phase 37/39 D-14 throughout km-core. Each system constructs the pipeline with its own 4 stage impls. Type-checked, easy to mock per stage. OKM ports cleanly with one rename. | ✓ |
| Class inheritance | Each system extends an abstract `IngestPipeline` and overrides 4 methods. OO-traditional but introduces inheritance hierarchy hard to mix-and-match. Phase 39 deliberately avoided base classes. | |
| Plugin registry — `registerStage()` | `pipeline.registerStage('extract', impl)` then `pipeline.ingest(text)`. Dynamic but uses string keys (loses TS type-safety), order matters. Overkill for 3 known consumers. | |

**User's choice:** Options-object composition
**Notes:** Composition + options-object is the dominant km-core pattern (D-14). Each system imports the framework, constructs the pipeline with its own stage impls. Captured as D-42.

---

## Stage Execution & Cadence Control

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: auto-chain + per-stage skip flags (Recommended) | `pipeline.ingest(text, { provenance, skipStages?: ['synthesize'] })` auto-runs all 4 stages; caller can skip individual stages. Plus public `pipeline.runStage(name, input)` for cron paths. Simple default, explicit opt-out, framework still enforces stage order when chained. | ✓ |
| Always-chain: single `ingest()`, no skip | Always runs all 4 stages. Cron-based synthesis becomes a no-op stage impl that defers work. Pushes complexity into A's synthesizer (stateful, painful to test). | |
| Stage-by-stage caller-driven | No `ingest()` chain — only `pipeline.runStage()`. Maximally flexible but every caller has to remember stage order. Framework no longer enforces SC#3's four-stage order. | |

**User's choice:** Hybrid (auto-chain + skipStages)
**Notes:** A runs synthesize on daily cron (via `runStage`), B and C use the auto-chain `ingest()` for per-ingest/per-wave paths. Framework still owns stage-order enforcement when `ingest()` is called. Captured as D-43.

---

## Dedup Layer Plug-in Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Three named layers + short-circuit (Recommended) | `new LayeredDeduplicator({ exactName, embedding, llmSemantic })` with separate type-checked interfaces per layer. Pipeline runs in fixed order; first-match wins (short-circuit). Each layer optional (omit and pipeline skips). | ✓ |
| Ordered strategy list | Generic `DedupStrategy` interface; configure as array of strategies. Flexible (add 4th layer later) but loses semantic labels and observability per-layer. | |
| All-three-always-run, then aggregate | All 3 layers fire in parallel and vote. Most rigorous but expensive — LLM layer always fires even when exact-name was 1.0 match. Wasted tokens. | |

**User's choice:** Three named layers + short-circuit
**Notes:** First-match wins. Each layer impl owns its own threshold (Jaccard 0.9 / cosine 0.85 / LLM 0.7 are starting points; planner can tune). Layers are optional — omit a slot and that layer is skipped entirely. Captured as D-44.

---

## A/B Legacy-Code Coupling Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Co-exist: framework only, A/B migrations deferred (Recommended) | Phase 40 ships framework + layer impls in km-core. A's ObservationConsolidator + B's WaveController untouched. Phase 41 migrates A; Phase 42 migrates B. Smallest blast radius. SC#4 fully true only after Phase 42 (acknowledged nuance). | ✓ |
| Wrap-and-adapt: thin shims in Phase 40 | Phase 40 also touches A and B. Adapter classes wrap the framework. Both legacy paths still work but every new call routes through the framework. Medium blast radius. | |
| Migrate-and-replace: rewrite A and B in Phase 40 | Phase 40 ships framework AND rewrites both A and B. Largest blast radius. Risks breaking B's live wave-analysis pipeline and A's daily-digest cron. Violates PROJECT.md "B and C migrate per-system, not coupled." | |

**User's choice:** Co-exist (framework only)
**Notes:** Phase 40's blast radius is one repo (km-core). Phase 41 + 42 migrations own the duplicate-code deletion that SC#4 requires. CONTEXT.md notes that SC#4 is partially true at end of Phase 40 (canonical impl exists) and fully true at end of Phase 42 (duplicates deleted). Captured as D-45.

---

## Candidate Pool Sourcing (follow-up after D-44)

| Option | Description | Selected |
|--------|-------------|----------|
| ontologyClass-scoped via `store.findByOntologyClass` (Recommended) | Pipeline pre-loads candidates per incoming entity. Matches OKM's current behavior + inherits Phase 39 D-34 active-only filter automatically. Same-class scope is the only one with semantic meaning. | ✓ |
| Caller-supplied candidate pool | Each system passes candidates explicitly via ingest opts. Maximally flexible but pushes "which candidates" out of the framework. Risk: caller forgets to scope and dedups the whole graph. | |
| Whole-graph scan | Every layer's match() runs against every entity. Semantically rigorous but computationally awful (1000 × 10000 = 10M comparisons per ingest). Nobody does this today. | |

**User's choice:** ontologyClass-scoped (via store.findByOntologyClass)
**Notes:** Pipeline (not the layer) pre-loads the candidate pool. Inherits Phase 39 D-34's active-only filter for free. One implication: no cross-class merging in v0.1 — even if two entities of different classes share a name, they don't dedup. Matches OKM's current behavior. Captured as D-46.

---

## Claude's Discretion

- Internal stage interface signature details (exact arg/return shapes).
- File layout under `src/pipeline/` and `src/dedup/`.
- Stage failure semantics (abort-on-throw vs. skip-and-continue with checkpoint) — recommended default: abort, mirroring CF-D17 batch atomicity.
- Whether `runStage('store', ...)` shares code with `ingest({ skipStages: ['extract','dedup','synthesize'] })` or is a distinct entry point — must produce identical results either way.
- Exact threshold defaults per layer (Jaccard 0.9 / cosine 0.85 / LLM 0.7 are starting points only).

## Deferred Ideas

- A's `ObservationConsolidator` migration → Phase 41 (INT-01).
- B's `WaveController` migration → Phase 42 (INT-02).
- C's OKM → KM-Core port → Phase 43 (INT-03).
- Post-hoc `resolveEntities()` graph-maintenance op → Phase 41 (PIPE-02).
- Cross-batch state for embedding layer (Qdrant integration) → caller-supplied dependency.
- PII filter + governance hooks (OKM's `pii-filter.ts`, `governance.ts`) → planner decides.
- Voting / aggregation across dedup layers → not needed today; reopen if real-world tuning shows otherwise.
- Cross-class entity merging → future phase if real use case emerges.
- Stage failure semantics formalization → recommended default noted; revisit if real-world experience demands.
