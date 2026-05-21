# Phase 40: Ingest Pipeline & Layered Dedup - Research

**Researched:** 2026-05-21
**Domain:** TypeScript library design — ingest framework + layered deduplication abstraction inside `@fwornle/km-core`
**Confidence:** HIGH

## Summary

Phase 40 is fundamentally a **lift-and-shape** exercise, not an algorithm-design exercise. OKM already ships a working 4-stage `extract → dedup → store → synthesize` pipeline (`pipeline.ts`, 771 lines) and a 3-phase layered dedup (`deduplicator.ts`, 952 lines) that B and A both want to use. The framework decisions (D-42..D-46 in CONTEXT.md) are locked. The job is to port the *shape* into km-core as composable, system-agnostic primitives — not to redesign anything.

Three concrete algorithms get ported into named layer classes: B's `calculateStringSimilarity` (Jaccard, threshold 0.85 in production) becomes `JaccardNameMatcher`; A's `cosine()` + greedy pairwise clustering becomes `CosineEmbeddingMatcher` (A's threshold is 0.93 for insights, 0.97 for digests, 0.88 for paragraph-cosine merge inside `ObservationConsolidator`); OKM's `batchLLMDedup()` prompt + retry + JSON-repair logic becomes `LLMSemanticMatcher`. None of these need to be reinvented — the algorithms are battle-tested in production today. What's new is the **interface** that lets all three implementations plug into one `LayeredDeduplicator` without the layered logic knowing which concrete impl is behind each slot.

**Primary recommendation:** Land `src/pipeline/{IngestPipeline.ts, types.ts, index.ts}` and `src/dedup/{LayeredDeduplicator.ts, JaccardNameMatcher.ts, CosineEmbeddingMatcher.ts, LLMSemanticMatcher.ts, types.ts, index.ts}` exactly mirroring the file-per-concern convention Phase 37/38/39 already use. Port OKM's `IngestionPipeline` class (rename `IngestionPipeline → IngestPipeline`, ctor → options-object per D-42, retain `onPhase` and the 4-stage sequence verbatim). Defer PII filter + governance hooks to Phase 43 (C's migration owns its own wrapping). Each layer takes a `threshold` ctor opt and a layer-specific dependency (Jaccard: nothing extra; Cosine: an embedding client interface; LLM: an LLM client interface) — keep the layer pure, the wiring at the call site.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 4-stage pipeline orchestration | KM-Core (library) | — | Shared framework, system-agnostic — the entire point of Phase 40 |
| Stage 1 entity extraction | Caller-supplied `Extractor` impl | KM-Core defines interface | Domain-specific (transcript parsing for A, git log parsing for B, RCA learn-block parsing for C) — never standardize |
| Stage 2 dedup orchestration | KM-Core (`LayeredDeduplicator`) | — | Short-circuit logic + candidate pool sourcing is shared |
| Stage 2 layer matching | KM-Core (3 concrete impls) | Caller plugs in alternates | Algorithms ported once; per-system threshold tuning happens at ctor |
| Stage 3 storage | KM-Core (`GraphKMStore.putEntity`/`batch`) | — | Already shipped Phase 37/39 — pipeline only invokes |
| Stage 4 synthesis | Caller-supplied `Synthesizer` impl | KM-Core defines interface | A folds digests differently than B folds wave outputs — kept caller-side |
| Embedding generation | Caller-supplied `EmbeddingClient` | KM-Core defines interface | Qdrant glue is per-system (A wires Qdrant in Phase 41, B in Phase 42) — Phase 40 ships the matcher only |
| LLM calls (semantic dedup, synthesis) | Caller-supplied `LLMClient` | KM-Core defines interface | LLM provider config is per-system (rapid-llm-proxy for OKM, groq/haiku for A, varies for B) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.9.3 (pinned in km-core) | Mandatory strict mode per CLAUDE.md + CF-D06 | [VERIFIED: km-core/package.json] — already pinned, Phase 40 does NOT bump |
| vitest | 4.0.18 (pinned in km-core) | Unit test framework (matches Phase 37/38/39) | [VERIFIED: km-core/package.json] — 8 test files already in `tests/unit/` use this; Phase 40 adds 2 more |
| graphology | 0.26.0 | Underlying graph — NOT touched by Phase 40 (calls go through `GraphKMStore`) | [VERIFIED: km-core/package.json] — already pinned |

**No new dependencies.** Phase 40 is a pure-TypeScript shape-port; every algorithm dependency (embedding client, LLM client) is injected as an interface that the *caller* satisfies. The km-core repo stays at its current 4-dep footprint (`classic-level`, `graphology`, `graphology-types`, `uuidv7`).

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | — | — | — |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Caller-injected `EmbeddingClient` interface | Hard-coded Qdrant client | Locks km-core to Qdrant — rejected per CONTEXT.md "Cross-batch state for embedding layer" |
| Inheritance (`extends IngestPipeline`) | Composition (D-42) | Composition is locked — composition keeps OKM's port shape verbatim |
| Voting / aggregation across dedup layers | Short-circuit on first match (D-44) | First-match-wins is locked — OKM's production data shows agreement is high enough that voting overhead isn't justified |
| Cross-class candidate pool | Same-class only (D-46) | Locked — matches OKM behavior; cross-class merge is a future-phase change |

**Installation:** Nothing to install — Phase 40 ships pure source.

**Version verification:** No new packages — Phase 40 uses only the 4 dependencies already pinned in `~/Agentic/km-core/package.json` (verified 2026-05-21). [VERIFIED: filesystem read]

## Package Legitimacy Audit

> **Not applicable.** Phase 40 installs **zero** new packages. The slopcheck gate is a no-op for this phase. All recommended imports resolve to packages already vetted and pinned during Phase 37 (`classic-level`, `graphology`, `graphology-types`, `uuidv7`) plus the standard dev deps (`vitest`, `typescript`, `tsx`, `@types/node`). [VERIFIED: km-core/package.json]

**Packages removed due to slopcheck [SLOP] verdict:** none — no new packages introduced.
**Packages flagged as suspicious [SUS]:** none — no new packages introduced.

## Architecture Patterns

### System Architecture (data flow narrative)

The Phase 40 system has two composed classes that flow data top-down through 4 named stages. Caller code wires up the pipeline with three pluggable stage implementations plus an optional observability callback, then drives ingestion with a single `ingest()` call that returns timing + count results.

**Top-level entry point:** caller constructs `new IngestPipeline(store, { extractor, deduplicator, synthesizer, onPhase? })`, then calls `await pipeline.ingest(text, { provenance, skipStages? })`.

**Stage 1 — extract.** Pipeline calls `extractor.extract(text, domain)` (caller-supplied impl). Returns an array of `Entity` values. The `onPhase` callback fires `{ stage: 'extract', status: 'start' }` before and `{ stage: 'extract', status: 'done', count: N, durationMs: T }` after.

**Stage 2 — dedup.** For each extracted entity, the pipeline pre-loads candidates via `store.findByOntologyClass(entity.ontologyClass)` (per D-46; active-only filter inherited from Phase 39 D-34). The candidates plus the entity are passed to `deduplicator.dedup(entity, candidates)`. Inside `LayeredDeduplicator.dedup()`:

- Iterates layers in declared order: `exactName` first, then `embedding`, then `llmSemantic`. Any slot may be omitted, in which case that layer is skipped.
- Each layer is asked `match(entity, candidates)` and returns `{ matched, survivor?, confidence }`.
- When `shortCircuit: true` (default per D-44), the first layer that returns `matched: true` with `confidence >= layer.threshold` wins; downstream layers are not called.
- The result is `{ matched, survivor?, matchedLayer, confidence, allLayerResults }`.

**Stage 3 — store.** For each dedup decision: if a survivor was matched, the new entity is stored with `supersedes: survivor.id` set. This triggers Phase 39 D-33's atomic predecessor-closure batch inside `putEntity` — the pipeline does not need to manage the closure manually. If the survivor has a legacy non-v7 id (B's nanoid or C's `layer:uuid`), Phase 39's CR-01 fix (commit `44c1e9b`) handles it via per-op `BatchOp.skipOntologyCheck`. If no survivor, the entity is stored as net-new.

**Stage 4 — synthesize.** Pipeline calls `synthesizer.synthesize(survivorIds, { provenance })` (caller-supplied impl). A's daily-cron path commonly invokes only this stage via `pipeline.runStage('synthesize', ...)` per D-43.

**Observability:** `onPhase` fires for every executed stage. Skipped stages (per `skipStages`) emit no `onPhase` events and are recorded in the returned `IngestResult.skippedStages`. The returned `IngestResult` carries `{ extractedCount, mergedCount, storedCount, skippedCount, droppedCount, durations: {...}, skippedStages }`.

**File-to-implementation mapping** is in the next table.

### Component Responsibilities

| File | Class / Function | Responsibility |
|------|------------------|----------------|
| `src/pipeline/IngestPipeline.ts` | `IngestPipeline` class | Owns 4-stage orchestration; threads `provenance` through stages; emits `onPhase` callbacks; honors `skipStages`; exposes `ingest()` + `runStage()` |
| `src/pipeline/types.ts` | `Extractor`, `Synthesizer`, `PhaseCallback`, `IngestResult`, `IngestOpts`, `StageName`, `IngestPipelineOpts` | Public type surface for callers |
| `src/pipeline/index.ts` | (barrel) | Re-exports the pipeline module |
| `src/dedup/LayeredDeduplicator.ts` | `LayeredDeduplicator` class | Wraps 3 layer slots; short-circuit logic; aggregates `MatchResult` from each layer |
| `src/dedup/JaccardNameMatcher.ts` | `JaccardNameMatcher` class | Implements `ExactNameLayer`; ports B's `calculateStringSimilarity` (Jaccard over word sets) |
| `src/dedup/CosineEmbeddingMatcher.ts` | `CosineEmbeddingMatcher` class | Implements `EmbeddingLayer`; ports A's pure `cosine()` math; consumes caller-supplied `EmbeddingClient` |
| `src/dedup/LLMSemanticMatcher.ts` | `LLMSemanticMatcher` class | Implements `LLMSemanticLayer`; ports OKM's batchLLMDedup prompt + 5-stage JSON-unwrap; consumes caller-supplied `LLMClient` |
| `src/dedup/types.ts` | `ExactNameLayer`, `EmbeddingLayer`, `LLMSemanticLayer`, `MatchResult`, `DedupResult`, `LLMClient`, `EmbeddingClient` | Public type surface for layers |
| `src/dedup/index.ts` | (barrel) | Re-exports the dedup module |
| `src/index.ts` (modified) | (root barrel) | Append Phase 40 exports AFTER Phase 39's `mergeDescriptionSegment` + `backfillEntityDataModel` |
| `package.json` (modified) | `exports` map | Add `./pipeline` + `./dedup` sub-path entries (matches Phase 38's `./ontology` precedent) |

### Recommended Project Structure

The km-core source tree adds two new directories:

- `src/pipeline/IngestPipeline.ts` — main pipeline class (estimated ~250 lines with JSDoc)
- `src/pipeline/types.ts` — pipeline type surface (~80 lines)
- `src/pipeline/index.ts` — sub-barrel (~15 lines)
- `src/dedup/LayeredDeduplicator.ts` — orchestrator class (~80 lines)
- `src/dedup/JaccardNameMatcher.ts` — exact-name layer impl (~40 lines)
- `src/dedup/CosineEmbeddingMatcher.ts` — embedding layer impl (~60 lines)
- `src/dedup/LLMSemanticMatcher.ts` — LLM-semantic layer impl (~120 lines)
- `src/dedup/types.ts` — dedup type surface (~80 lines)
- `src/dedup/index.ts` — sub-barrel (~15 lines)

**Why this shape:** Mirrors Phase 37/38/39 conventions exactly:
- One file per concern (Phase 37 split `src/ids/{branded,mint,parse}.ts`; Phase 38 split `src/ontology/{registry,loader,types}.ts`; Phase 39 added `src/segments/merge.ts` + `src/backfill/index.ts`).
- Sub-barrel `index.ts` per directory re-exports the public surface (Phase 38 added `package.json` `exports` map for `./ontology` sub-path — Phase 40 likely wants `./pipeline` and `./dedup` sub-path exports too, mirroring the precedent).
- Root barrel `src/index.ts` is append-only.

### Pattern 1: Options-Object Composition (D-42, CF-D14)
**What:** Every public ctor and method takes an options bag for non-primary args.
**When to use:** Always — Phase 37/38/39 are unanimous.
**Example:**
```typescript
// Source: km-core convention — Phase 37 D-14, Phase 38 D-28, Phase 39 D-30
new IngestPipeline(store, {
  extractor,
  deduplicator,
  synthesizer,
  onPhase: (e) => process.stderr.write(`[pipeline] ${e.stage} ${e.status}\n`),
});

await pipeline.ingest(text, { provenance, skipStages: ['synthesize'] });
```

### Pattern 2: Caller-Supplied Dependency Interfaces (CF-D04 / Cross-batch state deferred)
**What:** Layers don't import concrete clients — they accept a typed interface in their ctor opts.
**When to use:** Any layer that talks to external services (embedding, LLM).
**Example:**
```typescript
// Source: km-core CONTEXT.md deferred-ideas "Cross-batch state for embedding layer"
export interface EmbeddingClient {
  embed(text: string): Promise<Float32Array>;
  search(opts: { vector: Float32Array; limit: number; threshold?: number;
                 filter?: Record<string, unknown> }): Promise<EmbeddingHit[]>;
}

new CosineEmbeddingMatcher({
  client: callerSuppliedQdrantAdapter,
  threshold: 0.85,
});
```

This is the path that A and B will wire differently in Phase 41/42 — A points the client at the `insights` Qdrant collection, B points it at the codebase-embedding collection. The matcher does not care.

### Pattern 3: Atomic Supersession via Phase 39 batch() (CF-D17 + CR-01)
**What:** When dedup decides a match warrants supersession (not just confirm), the new entity is written with `supersedes: oldId`. Phase 39's `GraphKMStore.putEntity` internally fires the closure batch (`closedOld` + `entity`, both with `skipOntologyCheck: true`).
**When to use:** Pipeline's store stage. The pipeline does NOT need to write the closure — Phase 39 already does it transparently inside `putEntity` when `supersedes` is set.
**Example:**
```typescript
// Source: ~/Agentic/km-core/src/store/GraphKMStore.ts line 474 (Phase 39 D-33)
await store.putEntity(
  { ...newEntity, supersedes: matchedSurvivor.id },
  { provenance },
); // Triggers the atomic predecessor-closure batch internally.
```

**Important pitfall surfaced by 39-REVIEW-FIX CR-01:** if `matchedSurvivor.id` is a legacy non-v7 id (e.g., B's nanoid or C's `layer:uuid` prefix), the closure batch uses `BatchOp.skipOntologyCheck = true` per op (commit `44c1e9b`). This is already in Phase 39's code — Phase 40 must not regress by writing supersession bypassing `putEntity` (e.g., issuing its own raw `batch()` call without the per-op flag).

### Anti-Patterns to Avoid
- **Calling `console.log` / `console.warn` / `console.info` anywhere in pipeline or dedup code.** OKM's source is full of `console.info` / `console.warn` lines (`pipeline.ts:119, 124, 159, 269, 282`; `deduplicator.ts:183, 214, 525, 547`). EVERY one of these MUST become `process.stderr.write(...)` in the km-core port. The constraint-monitor enforces this — leaving them in will block the commit.
- **Reaching into Graphology directly from pipeline/dedup code.** All graph access goes through `GraphKMStore` methods (`putEntity`, `findByOntologyClass`, `getEntity`, `batch`, `getSupersessionChain`). Phase 37 D-15 made the store async; pipeline code mirrors that.
- **Inventing a `ProvenanceStamp` inside the pipeline.** Phase 39 D-30 locked this: the caller of `pipeline.ingest()` supplies provenance, the pipeline THREADS it to `store.putEntity`. Never construct a stamp from `new Date()` inside the pipeline.
- **Re-importing OKM's `EntityDeduplicator` class wholesale into km-core.** The class mixes (a) the 3-phase dedup algorithm, (b) `synthesizeDescriptions` (LLM-based merge rewrite), (c) `resolveEntities` (post-hoc cross-graph LLM dedup — Phase 41 PIPE-02), (d) `mergeEvidenceMetadata` (OKM-specific sourceRefs/sourceDocuments coupling). Phase 40 ports the **algorithm** of the LLM dedup branch into `LLMSemanticMatcher` — NOT the whole class. (c) and (d) are Phase 41 / out-of-scope.
- **Designing a stage-failure retry policy.** CONTEXT.md Claude's Discretion: "Recommended default: abort on throw, mirroring CF-D17 batch atomicity, with the caller responsible for retry orchestration." Don't add resume-on-failure logic; mirror OKM's `try/catch + errors[]` collection pattern instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stage timing / observability | Custom timer loop | OKM's `onPhase` callback pattern (verbatim port) | Already proven; matches CONTEXT.md specifics |
| LLM JSON parse | `JSON.parse(response.content)` | OKM's `parseJsonWithRepair` + `stripMarkdownFences` + `repairTruncatedJson` helpers (`extractor.ts:27-183`) | LLM responses arrive truncated, fence-wrapped, with trailing commas — OKM hit every edge case in production |
| Embedding cosine math | Reimplement | Port A's `cosine()` (`scripts/dedup-insights-by-embedding.js:56-64`) — 9 lines | Empirically tuned for MiniLM-L6-v2, used in production today |
| Name string similarity | Reimplement | Port B's `calculateStringSimilarity()` (`deduplication.ts:436-445`) — 9 lines | Jaccard over `.toLowerCase().split(/\s+/)` word sets — battle-tested |
| Greedy pairwise clustering | Reimplement | Port A's `clusterByCosine()` (`scripts/dedup-insights-by-embedding.js:78-110`) | Avoids the single-linkage chaining problem A discovered the hard way |
| Stage execution ordering | DAG library | Sequential `await` chain in `ingest()` body | OKM's pattern; only 4 stages, no parallelism needed at the pipeline layer |
| LLM concurrency control | Custom semaphore | OKM's wave-of-3 pattern (`deduplicator.ts:200-227` `Promise.allSettled`) | DEDUP_CONCURRENCY = 3 — empirically tuned to not overwhelm CLI proxy |

**Key insight:** Every Phase 40 algorithm exists in production code today. The phase's value is in **structural unification** — putting the algorithms behind common interfaces so A's `ObservationConsolidator` rewrite (Phase 41), B's `WaveController` rewrite (Phase 42), and C's pipeline-import swap (Phase 43) can all replace their direct calls with `IngestPipeline.ingest()`. The algorithms themselves are unchanged.

## Runtime State Inventory

> Phase 40 is **greenfield** within km-core — no existing pipeline or dedup state exists at `~/Agentic/km-core/` to migrate. This section is included for completeness; no runtime state actions required.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 40 adds new modules; no schema changes to `Entity`/`Relation`; no new persistent state in km-core. Existing OKM/A/B data remains untouched (their pipelines are still in place per D-45). | None |
| Live service config | None — km-core ships no services. A/B/C continue running their own existing pipelines until Phases 41/42/43 swap them. | None |
| OS-registered state | None — no launchd/cron/systemd touched. The semantic-analysis MCP, transcript monitors, and llm-proxy all stay on their current pipelines until later phases. | None |
| Secrets/env vars | None — pipeline ctor takes no env vars (CF-D14 + D-28 — no env-var pickup in km-core). Caller wires any env at the call site. | None |
| Build artifacts | km-core has `dist/` (from Phase 37 `tsc`); `npm run build` will recompile after Phase 40 adds new files. Submodule mount at `coding/lib/km-core/` (from Phase 37 Plan 05) automatically picks up the new dist on next consumer build. | `npm run build` inside km-core after each Phase 40 plan completes |

**Nothing in any category requires migration.** Phase 40 is purely additive — new files under `src/pipeline/` and `src/dedup/`, append-only `src/index.ts` updates, append-only `package.json` `exports` map entries.

## Common Pitfalls

### Pitfall 1: `entity.ontologyClass` may be undefined on D-46 candidate-pool lookup
**What goes wrong:** D-46 says "pre-load candidates via `store.findByOntologyClass(entity.ontologyClass)`." But the canonical `Entity` type declares `ontologyClass?: string` (optional — `src/types/entity.ts:119`). If an extractor emits an entity without `ontologyClass`, the lookup string is `undefined` and the candidate pool is empty (no dedup possible).
**Why it happens:** OKM's `pipeline.ts:158` does `if (!this.ontologyRegistry.isValidClass(extractedEntity.ontologyClass))` advisory-warn-and-continue. Phase 38 D-19 tightens this to strict-validation-by-default; with Phase 38 wiring, an entity without `ontologyClass` will throw at `store.putEntity` strict validation.
**How to avoid:** In `LayeredDeduplicator.dedup`, if `entity.ontologyClass` is undefined: emit a `process.stderr.write` warning, return `{ matched: false }`. The entity will then fail downstream at `putEntity` if the ontology registry doesn't have an entry for whatever `entityType` it has — that's the correct place to surface the error.
**Warning signs:** Empty `candidates` array passed to every layer's `match()`. Add a defensive log in the pipeline pre-lookup.

### Pitfall 2: Phase 39 CR-01 BatchOp.skipOntologyCheck must survive supersession
**What goes wrong:** Pipeline writes new entity with `supersedes: legacyId`. Phase 39's putEntity internally fires `batch([{closedOld, skipOntologyCheck: true}, {entity, skipOntologyCheck: true}])`. If a future refactor of Phase 40's plan creates its own supersession batch directly (e.g., to also write a custom `RESOLVED_TO` relation in the same atomic op), the per-op flag must be preserved on both ops or the legacy predecessor will fail Phase 1 validation.
**Why it happens:** Phase 39's review caught this exact pattern (39-REVIEW-FIX CR-01, commit `44c1e9b`). Easy to lose if Phase 40 plan adds "supersession + relation" custom batch handling.
**How to avoid:** Phase 40 should call `store.putEntity(entity, { provenance })` with `supersedes` set and let Phase 39's internal closure handle atomicity. Do NOT bypass `putEntity` with a raw `batch()` call.
**Warning signs:** `Error: Invalid entity id format` thrown from `parseEntityId` during a dedup match against a B-imported entity.

### Pitfall 3: LLM JSON parse failures in `LLMSemanticMatcher`
**What goes wrong:** OKM's `batchLLMDedup` (`deduplicator.ts:421-475`) does **5 layers of defensive JSON unwrapping** because Copilot/Claude responses arrive in unpredictable shapes: anchored fence, unanchored fence, partial fence with leading text, raw JSON, or just `{ ... }` buried inside a paragraph. Same problem hits `extractor.ts:130-146` with `parseJsonWithRepair` for truncation mid-array.
**Why it happens:** CLI-proxied LLMs (Copilot CLI, claude-code) wrap JSON inconsistently; `max_tokens` truncates responses mid-element; `responseFormat: { type: 'json_object' }` is honored unevenly by providers.
**How to avoid:** Port OKM's defensive parsers verbatim into a shared internal helper in `src/dedup/`. Specifically:
- `stripMarkdownFences` from `extractor.ts:156-183` (28 lines)
- `repairTruncatedJson` + `closeUnclosedBrackets` from `extractor.ts:27-124` (97 lines)
- The inline 5-stage unwrap from `deduplicator.ts:451-472`

Do NOT roll your own — OKM has hit every edge case in production.
**Warning signs:** `SyntaxError: Unexpected token in JSON at position N` from `LLMSemanticMatcher.match()`. Confidence rating drops to 0 when this fires — log the raw response prefix to stderr (first 200 chars) for debugging.

### Pitfall 4: Embedding-cosine threshold confusion (A uses three different thresholds)
**What goes wrong:** A's codebase has **three** embedding-cosine thresholds, all calibrated to MiniLM-L6-v2 but for different surfaces:
- `0.97` for digest dedup (`ObservationConsolidator.js:73` `DIGEST_DEDUP_THRESHOLD`)
- `0.93` for insight dedup (`scripts/dedup-insights-by-embedding.js:39`)
- `0.88` for insight merge gating (`ObservationConsolidator.js:36` `INSIGHT_DEDUP_THRESHOLD`)
- `0.83` for facet linking (`ObservationConsolidator.js:44` `INSIGHT_FACET_THRESHOLD`)
- `0.70` for retrieval recall (`src/retrieval/retrieval-service.js:38` `scoreThreshold` — different use case entirely)

CONTEXT.md specifics says "cosine 0.85 is a starting point only." If the planner picks the wrong A threshold to port as the matcher default, A's Phase 41 migration will show unexpected merge/no-merge behavior.
**Why it happens:** A's commentary (`retrieval-service.js:38-45`) explains: "MiniLM-L6-v2 cosine similarities cluster 0.75-0.82 for single-project docs." The right threshold for any given Cosine matcher depends on whether the embedded text is short identifiers (high baseline) or paragraph descriptions (lower baseline).
**How to avoid:** Make `CosineEmbeddingMatcher`'s threshold a ctor opt with a documented default (e.g., 0.90 — between A's insight-dedup and insight-merge thresholds). Document in the JSDoc that **the caller is expected to tune per surface**. Don't try to be clever; surface the tradeoff.
**Warning signs:** Phase 41 review finds A's insight rate changed significantly post-migration — that's a threshold-mismatch tell, not a bug in the matcher.

### Pitfall 5: `skipStages` ambiguity — what does skipping 'extract' even mean?
**What goes wrong:** D-43 says `skipStages?: ('extract'|'dedup'|'store'|'synthesize')[]`. But what does `ingest(text, { skipStages: ['extract'] })` actually do? The caller passes `text`, but skipping extract means there's nothing to feed into dedup. The pipeline either (a) silently no-ops, (b) throws, or (c) interprets `text` as pre-extracted entities (semantically wrong).
**Why it happens:** D-43 was specced from the use case angle (A's cron runs only `synthesize`), but the interplay between skipped earlier stages and the `text` payload wasn't pinned.
**How to avoid:** Recommend the planner treat `skipStages` as **forward-skip only**: skipping a stage is valid only if the input data for the NEXT stage is supplied directly. For "run only synthesize," use `pipeline.runStage('synthesize', todaysEntities, { provenance })` per D-43 — that's the cleaner public API for off-pipeline stage invocation. `skipStages` should be reserved for skipping `synthesize` at the END of `ingest()` (A's daily cron case — extract+dedup+store now, synthesize once at end of day). Throwing on `skipStages: ['extract']` with `text !== ''` is safer than silently no-op'ing.
**Warning signs:** Plan-checker flags "ambiguity in skipStages contract." Address in the planner phase by writing 2 contract tests: (a) `skipStages: ['synthesize']` runs the other 3 and returns `IngestResult.skippedStages = ['synthesize']`; (b) `skipStages: ['extract']` with text payload throws or behaves spec-defined.

### Pitfall 6: Forgetting to rebuild km-core after src/ changes
**What goes wrong:** CLAUDE.md highlights the submodule build pipeline as a recurring issue. km-core compiles TS to `dist/`; coding-side consumers (via `coding/lib/km-core/` submodule from Phase 37 Plan 05) import from `dist/`. If Phase 40 lands new exports but `npm run build` is skipped, no consumer sees them.
**Why it happens:** Per CLAUDE.md "Common failure mode: Source files get committed but `npm run build` is forgotten → `dist/` stays stale."
**How to avoid:** Every Phase 40 plan that modifies `src/` MUST end with `cd ~/Agentic/km-core && npm run build` AND `npm test` (vitest runs against `src/`, so test green doesn't prove dist is fresh). The plan-checker should flag any plan that touches `src/` without a build step.
**Warning signs:** Phase 41/42/43 import `IngestPipeline` and get a "module has no exported member" error — that's a stale-dist tell.

### Pitfall 7: OKM pipeline includes things km-core MUST NOT port
**What goes wrong:** Reading OKM's `pipeline.ts` end-to-end (771 lines), several blocks are **OKM-specific** and should not land in km-core:
- `populateEvidenceMetadata` (lines 568-602) — OKM-specific `SourceDocumentStore`/`EvidenceLink`/`SourceRef` coupling
- `createDerivedFromEdges` (lines 653-677) — OKM-specific `DERIVED_FROM` edge from pattern entities to evidence entities (A and B don't have that taxonomy)
- `handleMetricEntities` (lines 683-728) — auto-create `Component` entities referenced by metrics; OKM-domain-specific (TimeWindow + Component)
- `handleSupersession` (lines 736-769) — duplicates Phase 39's D-33 supersession closure (km-core's `putEntity` handles this); only OKM's `SUPERSEDES` edge creation is custom (and the canonical equivalent is Phase 39's `SUPERSEDED_BY` reverse edge — DO NOT add a parallel `SUPERSEDES` edge)
- `recordPatternOccurrences` (lines 609-647) — calls OKM's `recordOccurrence` from `intelligence/temporal.js`; OKM-specific
- `extractOnly` + `deduplicateAndStore` + `synthesizeAll` + `resolveEntities` (lines 325-367) — OKM's split-mode entry points; the km-core equivalent is D-43's `runStage()` for `extractOnly` use; `resolveEntities` is **Phase 41 PIPE-02**, NOT Phase 40

**Why it happens:** A literal port of `pipeline.ts` drags in 6 OKM-domain coupling sites. The planner needs to know which is which up-front.
**How to avoid:** Port ONLY the 4-stage main `ingest()` flow + `onPhase` + `IngestResult`. Leave every helper method out. Phase 43 (C's OKM migration) re-wires these helpers OUTSIDE km-core — they become callbacks/hooks at the OKM caller side, not framework concerns.
**Warning signs:** km-core's pipeline.ts shows imports from `SourceDocumentStore`, `recordOccurrence`, `ArtifactRef`, or `SourceAuthority` — all of those are OKM-domain types, none belong in km-core.

## Code Examples

Verified patterns from official + production sources. All TypeScript, strict mode, ESM, `.js` import suffix on relative imports.

### Example 1: `LayeredDeduplicator.dedup()` — Short-circuit on first match
```typescript
// Inspired by OKM deduplicator.ts:53-322 + D-44 short-circuit contract.
// Sources:
//   - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts:58-138
//   - .planning/phases/40-ingest-pipeline-layered-dedup/40-CONTEXT.md D-44

import type { Entity } from '../types/entity.js';
import type { ExactNameLayer, EmbeddingLayer, LLMSemanticLayer, DedupResult } from './types.js';

export interface LayeredDeduplicatorOpts {
  exactName?: ExactNameLayer;
  embedding?: EmbeddingLayer;
  llmSemantic?: LLMSemanticLayer;
  shortCircuit?: boolean; // default true
}

export class LayeredDeduplicator {
  private exactName?: ExactNameLayer;
  private embedding?: EmbeddingLayer;
  private llmSemantic?: LLMSemanticLayer;
  private shortCircuit: boolean;

  constructor(opts: LayeredDeduplicatorOpts) {
    this.exactName = opts.exactName;
    this.embedding = opts.embedding;
    this.llmSemantic = opts.llmSemantic;
    this.shortCircuit = opts.shortCircuit ?? true;
  }

  async dedup(entity: Entity, candidates: Entity[]): Promise<DedupResult> {
    const layers = [
      { name: 'exactName', layer: this.exactName },
      { name: 'embedding', layer: this.embedding },
      { name: 'llmSemantic', layer: this.llmSemantic },
    ] as const;

    const layerResults: Array<{ layer: string; matched: boolean; survivor?: Entity; confidence: number }> = [];

    for (const { name, layer } of layers) {
      if (!layer) continue;
      const result = await layer.match(entity, candidates);
      layerResults.push({ layer: name, ...result });
      if (this.shortCircuit && result.matched && result.confidence >= layer.threshold) {
        return { matched: true, survivor: result.survivor!, matchedLayer: name, confidence: result.confidence, allLayerResults: layerResults };
      }
    }
    // No short-circuit match — return the best matched layer or no-match.
    const winner = layerResults.find((r) => r.matched);
    return winner
      ? { matched: true, survivor: winner.survivor!, matchedLayer: winner.layer, confidence: winner.confidence, allLayerResults: layerResults }
      : { matched: false, allLayerResults: layerResults };
  }
}
```

### Example 2: `JaccardNameMatcher` — Port from B
```typescript
// Source: /Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts:436-445
// Phase 40 ports the Jaccard scoring ONLY; B's merge side effects (mergeEntityGroup at :556) stay in B until Phase 42 deletes them.

import type { Entity } from '../types/entity.js';
import type { ExactNameLayer, MatchResult } from './types.js';

export interface JaccardNameMatcherOpts {
  threshold?: number; // default 0.85 — matches B's similarityConfig.similarityThreshold
}

export class JaccardNameMatcher implements ExactNameLayer {
  readonly threshold: number;

  constructor(opts: JaccardNameMatcherOpts = {}) {
    this.threshold = opts.threshold ?? 0.85;
  }

  async match(entity: Entity, candidates: Entity[]): Promise<MatchResult> {
    let best: { candidate: Entity; score: number } | null = null;
    for (const candidate of candidates) {
      if (candidate.id === entity.id) continue; // never match self
      const score = jaccard(entity.name, candidate.name);
      if (score >= this.threshold && (!best || score > best.score)) {
        best = { candidate, score };
      }
    }
    return best
      ? { matched: true, survivor: best.candidate, confidence: best.score }
      : { matched: false, confidence: 0 };
  }
}

function jaccard(a: string, b: string): number {
  // Verbatim port of B's calculateStringSimilarity (deduplication.ts:436-445)
  const words1 = new Set(a.toLowerCase().split(/\s+/));
  const words2 = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return union.size > 0 ? intersection.size / union.size : 0;
}
```

### Example 3: `CosineEmbeddingMatcher` — Port from A with caller-injected client
```typescript
// Cosine math sourced from: /Users/Q284340/Agentic/coding/scripts/dedup-insights-by-embedding.js:56-64
// Caller-supplied EmbeddingClient pattern per CONTEXT.md deferred-ideas "Cross-batch state for embedding layer"

import type { Entity } from '../types/entity.js';
import type { EmbeddingLayer, MatchResult } from './types.js';

export interface EmbeddingClient {
  embed(text: string): Promise<Float32Array | number[]>;
  // search() optional — matcher can also just embed all candidates inline (slow path).
  // Phase 41/42 wire their concrete clients here.
}

export interface CosineEmbeddingMatcherOpts {
  client: EmbeddingClient;
  threshold?: number; // default 0.90 — between A's insight-dedup 0.93 and insight-merge 0.88; tune per surface
  textOf?: (e: Entity) => string; // default: `${e.name}\n\n${e.description}` (matches A's ObservationConsolidator.js:243)
}

export class CosineEmbeddingMatcher implements EmbeddingLayer {
  readonly threshold: number;
  private client: EmbeddingClient;
  private textOf: (e: Entity) => string;

  constructor(opts: CosineEmbeddingMatcherOpts) {
    this.client = opts.client;
    this.threshold = opts.threshold ?? 0.90;
    this.textOf = opts.textOf ?? ((e) => `${e.name}\n\n${e.description ?? ''}`.trim());
  }

  async match(entity: Entity, candidates: Entity[]): Promise<MatchResult> {
    if (candidates.length === 0) return { matched: false, confidence: 0 };
    const [entityVec, ...candidateVecs] = await Promise.all([
      this.client.embed(this.textOf(entity)),
      ...candidates.map((c) => this.client.embed(this.textOf(c))),
    ]);
    let best: { candidate: Entity; score: number } | null = null;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].id === entity.id) continue;
      const score = cosine(entityVec, candidateVecs[i]);
      if (score >= this.threshold && (!best || score > best.score)) {
        best = { candidate: candidates[i], score };
      }
    }
    return best
      ? { matched: true, survivor: best.candidate, confidence: best.score }
      : { matched: false, confidence: 0 };
  }
}

function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  // Verbatim port of A's cosine() (scripts/dedup-insights-by-embedding.js:56-64)
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
```

### Example 4: `LLMSemanticMatcher` — Port OKM's prompt + JSON repair
```typescript
// Prompt sourced verbatim from: /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts:421-475
// Caller-supplied LLMClient pattern (matches OKM's @rapid/llm-proxy injection)

import type { Entity } from '../types/entity.js';
import type { LLMSemanticLayer, MatchResult } from './types.js';

export interface LLMClient {
  complete(req: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    taskType?: string;
    responseFormat?: { type: 'json_object' };
    timeout?: number;
  }): Promise<{ content: string }>;
}

export interface LLMSemanticMatcherOpts {
  client: LLMClient;
  threshold?: number; // default 0.70 — OKM's implicit threshold (matches return any matches)
  timeoutMs?: number; // default 60_000 — OKM's batchLLMDedup timeout
  taskType?: string;  // default 'deduplication_matching' — OKM's task tier
  onError?: 'skip' | 'throw'; // default 'skip' — match OKM's try/catch pattern (deduplicator.ts:213-218)
}

export class LLMSemanticMatcher implements LLMSemanticLayer {
  readonly threshold: number;
  private client: LLMClient;
  private timeoutMs: number;
  private taskType: string;
  private onError: 'skip' | 'throw';

  constructor(opts: LLMSemanticMatcherOpts) {
    this.client = opts.client;
    this.threshold = opts.threshold ?? 0.70;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.taskType = opts.taskType ?? 'deduplication_matching';
    this.onError = opts.onError ?? 'skip';
  }

  async match(entity: Entity, candidates: Entity[]): Promise<MatchResult> {
    if (candidates.length === 0) return { matched: false, confidence: 0 };
    const ontologyClass = entity.ontologyClass ?? entity.entityType;
    const existingNames = candidates.filter((c) => c.id !== entity.id).map((c) => c.name);
    if (existingNames.length === 0) return { matched: false, confidence: 0 };

    try {
      const response = await this.client.complete({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT(ontologyClass) },
          { role: 'user', content: USER_PROMPT(ontologyClass, [entity.name], existingNames) },
        ],
        taskType: this.taskType,
        responseFormat: { type: 'json_object' },
        timeout: this.timeoutMs,
      });
      const parsed = parseDedupResponse(response.content);
      const match = parsed.matches?.find((m) => m.newName === entity.name);
      if (!match) return { matched: false, confidence: 0 };
      const survivor = candidates.find((c) => c.name === match.existingName);
      return survivor
        ? { matched: true, survivor, confidence: this.threshold }
        : { matched: false, confidence: 0 };
    } catch (err) {
      if (this.onError === 'throw') throw err;
      process.stderr.write(`[km-core/dedup/llm] match error for "${entity.name}" — skipping: ${err instanceof Error ? err.message : String(err)}\n`);
      return { matched: false, confidence: 0 };
    }
  }
}

const SYSTEM_PROMPT = (ontologyClass: string) =>
  `You are an entity deduplication assistant. Given a list of new entity names and existing entity names (all of ontology class "${ontologyClass}"), identify which new entities are semantic duplicates of existing ones.

Return a JSON object with a "matches" array. Each match has "newName" (the new entity name) and "existingName" (the existing entity name it duplicates).

Only include matches where you are confident the entities refer to the same real-world concept (e.g., "OOM" and "Out of Memory" are the same). If no duplicates exist, return {"matches": []}.`;

const USER_PROMPT = (ontologyClass: string, newNames: string[], existingNames: string[]) =>
  `Ontology class: ${ontologyClass}

New entities: ${JSON.stringify(newNames)}
Existing entities: ${JSON.stringify(existingNames)}

Identify semantic duplicates.`;

// Port OKM's 5-stage JSON unwrap (deduplicator.ts:451-472)
function parseDedupResponse(raw: string): { matches?: Array<{ newName: string; existingName: string }> } {
  let s = raw.trim();
  let fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/);
  if (fenceMatch) s = fenceMatch[1].trim();
  else {
    const unanchored = s.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
    if (unanchored) s = unanchored[1].trim();
    else if (!s.startsWith('{') && !s.startsWith('[')) {
      const firstBrace = s.indexOf('{');
      if (firstBrace >= 0) {
        const lastBrace = s.lastIndexOf('}');
        if (lastBrace > firstBrace) s = s.slice(firstBrace, lastBrace + 1);
      }
    }
  }
  return JSON.parse(s);
}
```

### Example 5: `IngestPipeline.ingest()` — 4-stage chain with skipStages
```typescript
// Port shape from: /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/pipeline.ts:107-316
// Adapted per D-42 (options-object), D-43 (skipStages), D-46 (class-scoped candidate pool), CF-D30 (caller provides provenance).

import type { GraphKMStore } from '../store/GraphKMStore.js';
import type { Entity, ProvenanceStamp } from '../types/entity.js';
import type { LayeredDeduplicator } from '../dedup/LayeredDeduplicator.js';
import type { Extractor, Synthesizer, PhaseCallback, IngestResult } from './types.js';

export interface IngestPipelineOpts {
  extractor: Extractor;
  deduplicator: LayeredDeduplicator;
  synthesizer: Synthesizer;
  onPhase?: PhaseCallback;
}

export type StageName = 'extract' | 'dedup' | 'store' | 'synthesize';

export interface IngestOpts {
  provenance: ProvenanceStamp;          // required per CF-D30
  skipStages?: StageName[];             // D-43
  domain?: string;                      // optional; passes through to extractor
}

export class IngestPipeline {
  private store: GraphKMStore;
  private extractor: Extractor;
  private deduplicator: LayeredDeduplicator;
  private synthesizer: Synthesizer;
  private onPhase?: PhaseCallback;

  constructor(store: GraphKMStore, opts: IngestPipelineOpts) {
    this.store = store;
    this.extractor = opts.extractor;
    this.deduplicator = opts.deduplicator;
    this.synthesizer = opts.synthesizer;
    this.onPhase = opts.onPhase;
  }

  async ingest(text: string, opts: IngestOpts): Promise<IngestResult> {
    const skip = new Set<StageName>(opts.skipStages ?? []);
    const durations: Record<string, number> = {};
    const result: IngestResult = {
      extractedCount: 0, mergedCount: 0, storedCount: 0, skippedCount: 0, droppedCount: 0,
      durations: { extractMs: 0, dedupMs: 0, storeMs: 0, synthesizeMs: 0 },
      skippedStages: [...skip],
    };

    // Stage 1: extract
    let entities: Entity[] = [];
    if (!skip.has('extract')) {
      this.onPhase?.({ stage: 'extract', status: 'start' });
      const t0 = Date.now();
      entities = await this.extractor.extract(text, opts.domain);
      durations.extractMs = Date.now() - t0;
      result.extractedCount = entities.length;
      this.onPhase?.({ stage: 'extract', status: 'done', count: entities.length, durationMs: durations.extractMs });
    }

    // Stage 2: dedup (per-entity, candidate pool scoped per D-46)
    const dedupDecisions: Array<{ entity: Entity; survivor?: Entity }> = [];
    if (!skip.has('dedup')) {
      this.onPhase?.({ stage: 'dedup', status: 'start' });
      const t0 = Date.now();
      for (const entity of entities) {
        const ontologyClass = entity.ontologyClass ?? entity.entityType;
        const candidates = await this.store.findByOntologyClass(ontologyClass); // active-only per Phase 39 D-34
        const dedupResult = await this.deduplicator.dedup(entity, candidates);
        dedupDecisions.push({ entity, survivor: dedupResult.matched ? dedupResult.survivor : undefined });
      }
      durations.dedupMs = Date.now() - t0;
      result.mergedCount = dedupDecisions.filter((d) => d.survivor).length;
      this.onPhase?.({ stage: 'dedup', status: 'done', count: result.mergedCount, durationMs: durations.dedupMs });
    } else {
      // skipped — every extracted entity flows through as net-new
      for (const entity of entities) dedupDecisions.push({ entity });
    }

    // Stage 3: store (Phase 39's putEntity handles supersession atomically if `supersedes` set)
    if (!skip.has('store')) {
      this.onPhase?.({ stage: 'store', status: 'start' });
      const t0 = Date.now();
      for (const { entity, survivor } of dedupDecisions) {
        if (survivor) {
          // Match found — write new with supersedes pointing at survivor. Phase 39 D-33 closes the predecessor atomically;
          // CR-01's per-op skipOntologyCheck on the closure batch handles legacy non-v7 ids.
          await this.store.putEntity({ ...entity, supersedes: survivor.id }, { provenance: opts.provenance });
        } else {
          await this.store.putEntity(entity, { provenance: opts.provenance });
        }
        result.storedCount += 1;
      }
      durations.storeMs = Date.now() - t0;
      this.onPhase?.({ stage: 'store', status: 'done', count: result.storedCount, durationMs: durations.storeMs });
    }

    // Stage 4: synthesize (caller-pluggable — kept opaque to the pipeline)
    if (!skip.has('synthesize')) {
      this.onPhase?.({ stage: 'synthesize', status: 'start' });
      const t0 = Date.now();
      const survivorIds = dedupDecisions.filter((d) => d.survivor).map((d) => d.survivor!.id);
      await this.synthesizer.synthesize(survivorIds, { provenance: opts.provenance });
      durations.synthesizeMs = Date.now() - t0;
      this.onPhase?.({ stage: 'synthesize', status: 'done', durationMs: durations.synthesizeMs });
    }

    result.durations = {
      extractMs: durations.extractMs ?? 0,
      dedupMs: durations.dedupMs ?? 0,
      storeMs: durations.storeMs ?? 0,
      synthesizeMs: durations.synthesizeMs ?? 0,
    };
    return result;
  }

  async runStage<T = unknown>(name: StageName, input: T, opts: IngestOpts): Promise<unknown> {
    // Public out-of-band stage invocation for cron paths (A's daily synthesize).
    // Skeleton — planner picks the exact signature per Claude's Discretion in D-43.
    throw new Error('runStage: implementation in plan');
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| A: `ObservationConsolidator` runs cosine-dedup standalone, no shared abstraction | Pluggable `CosineEmbeddingMatcher` behind `LayeredDeduplicator` | Phase 41 (INT-01) — Phase 40 only ships the matcher | A's custom merge/facet verdict logic stays — only the cosine candidacy query moves into the matcher |
| B: `DeduplicationAgent` mixes name-Jaccard, embedding-via-OpenAI, and merge side effects | Pluggable `JaccardNameMatcher` + `CosineEmbeddingMatcher`; merge stays per-system | Phase 42 (INT-02) — Phase 40 only ships the matchers | Confirms SC#4: no duplicated dedup *algorithm*, but per-system merge policy survives |
| OKM: Monolithic `IngestionPipeline` class with PII filter, governance, metric-entity handling | Pure 4-stage `IngestPipeline` + 3 layer abstractions; OKM-specific helpers stay in OKM caller code | Phase 43 (INT-03) — Phase 40 ships the framework | OKM rewires `populateEvidenceMetadata`, `createDerivedFromEdges`, `handleMetricEntities`, `recordPatternOccurrences` as wrapping logic outside the pipeline (likely callbacks or pre/post hooks at the call site) |

**Deprecated/outdated:**
- **B's `calculateSimilarity` blended scoring** (`deduplication.ts:405-434` — Name x 0.4 + Type x 0.2 + Content x 0.4) is **not** the algorithm being ported. Only the pure Jaccard helper (`calculateStringSimilarity` at :436-445) ports as the exact-name layer. B's blended approach is per-system policy and stays in B until Phase 42 retires it.
- **OKM's `pipeline.resolveEntities()`** (`pipeline.ts:354-367` + `deduplicator.ts:595-952`) — post-hoc cross-graph LLM dedup. Per CONTEXT.md "Post-hoc resolveEntities()" this is **Phase 41 PIPE-02**. Phase 40 does NOT port `resolveEntities`. The planner must enforce this boundary — it's easy to drag the method along when porting `deduplicator.ts`.

## User Constraints (from CONTEXT.md)

> CONTEXT.md exists for Phase 40 — its locked decisions D-42 through D-46 constrain this research.

### Locked Decisions
- **D-42:** Options-object composition for pipeline ctor. `new IngestPipeline(store, { extractor, deduplicator, synthesizer, onPhase? })`. No abstract base class; no inheritance. OKM's class ports with one rename. `onPhase?: (e: { stage, status, count? }) => void` ported verbatim.
- **D-43:** Hybrid auto-chain + per-stage skip flags. `pipeline.ingest(text, { provenance, skipStages? })` auto-runs 4 stages, honoring `skipStages`. Also exposes `pipeline.runStage(name, input, opts)` for out-of-band stage calls. Stage order enforced via `ingest()`; `runStage()` caller controls order. `skipStages` is opt-out, not reorder.
- **D-44:** Three named layer interfaces + short-circuit on first match. `LayeredDeduplicator({ exactName, embedding, llmSemantic, shortCircuit? })`. Each layer is its own type. Layers are optional — omit a slot, that layer is skipped. Pipeline runs in declared order. `shortCircuit: true` default. Per-layer threshold on the layer impl. Starting points: Jaccard 0.9 / cosine 0.85 / LLM 0.7 (tunable). Layers cannot vote; first-match wins.
- **D-45:** Co-exist mode — framework only, A/B migrations deferred. Phase 40 ports algorithms into km-core but does NOT modify A's `ObservationConsolidator` or B's `WaveController`. Phase 41 migrates A; Phase 42 migrates B. SC#4 fully discharged end of Phase 42.
- **D-46:** ontologyClass-scoped candidate pool via `store.findByOntologyClass(entity.ontologyClass)`. Pipeline (not the layer) pre-loads candidates. Inherits Phase 39 D-34 active-only-by-default filter. No cross-class merge in v0.1.

### Carry-Forward (Phase 37 + 38 + 39 locked)
- **CF-D04:** Code in `~/Agentic/km-core/`. Phase 40 adds `src/pipeline/`, `src/dedup/`; modifies `src/index.ts`.
- **CF-D06:** ESM-only, `type: module`, NodeNext. All new relative imports use `.js` suffix.
- **CF-D14:** Options-object pattern. Every public API takes `{ ... }` for opts.
- **CF-D17:** `batch([...])` atomic. Multi-write inside dedup uses single batch op.
- **CF-D30/31/32:** Writer-side stamping is the store's job. Pipeline threads `ProvenanceStamp` through stages; only `putEntity` in store stage stamps.
- **CF-D34:** `findByOntologyClass` defaults to active-only.
- **CF-D33 + CR-01 fix:** Supersession atomic-closure path requires `BatchOp.skipOntologyCheck` per-op widening (commit `44c1e9b`) when predecessor has legacy non-v7 id. Phase 40's pipeline uses `putEntity` (not raw `batch()`) so Phase 39's internal closure handles this — DO NOT bypass.
- **no-console-log:** All diagnostic output uses `process.stderr.write(...)`.

### Claude's Discretion
- Internal stage interface signature details (exact arg shape, return shape). Recommended: port OKM's `IngestResult` + `PhaseCallback` shapes byte-equivalent.
- File layout under `src/pipeline/` and `src/dedup/` — planner picks. (Researcher recommends one-file-per-concern; see Recommended Project Structure above.)
- Stage failure semantics (abort-on-throw vs. skip-and-continue with checkpoint) — planner picks. Researcher endorses CONTEXT.md's "abort on throw" recommendation.
- Whether `runStage('store', entities, opts)` is the same code path as `pipeline.ingest({ skipStages: [...] })` or distinct — planner picks; public contracts must produce identical results either way.
- Exact threshold defaults for the 3 layers. Researcher recommendations after surveying production thresholds: **Jaccard 0.85** (B's default), **cosine 0.90** (between A's insight-dedup 0.93 and merge-gate 0.88; tune-per-surface documented), **LLM 0.70** (CONTEXT default; OKM's implicit threshold — any match returned by the LLM is taken).

### Deferred Ideas (OUT OF SCOPE)
- A's `ObservationConsolidator` migration → Phase 41 (INT-01).
- B's `WaveController` migration → Phase 42 (INT-02).
- C's existing OKM → KM-Core port → Phase 43 (INT-03).
- Post-hoc `resolveEntities()` graph-maintenance op → Phase 41 (PIPE-02).
- Cross-batch state for embedding layer (Qdrant integration).
- PII filter + governance hooks (OKM's `pii-filter.ts`, `governance.ts`). *Researcher recommendation below: NO — recommend deferring to Phase 43 caller-side wrapping.*
- Voting / aggregation across layers.
- Cross-class entity merging.
- Stage failure semantics formalization.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PIPE-01 | 4-stage ingest-time consolidation pipeline (extract → dedup → store → synthesize) defined in KM-Core; A's daily-digest/weekly-insight roll-up and B's wave-agents both implement against it | OKM's `pipeline.ts:107-316` ported as `IngestPipeline.ingest()` (Example 5 above); 4-stage sequential `await` chain + per-stage `onPhase` callback + `IngestResult` shape verbatim from OKM with `skippedStages` addition for D-43 |
| DEDUP-01 | Layered dedup pipeline (exact name → embedding cosine → LLM semantic) defined in KM-Core; A, B, and C each plug system-specific implementations into the shared stages | `LayeredDeduplicator` (Example 1) wraps 3 layer interfaces, runs in declared order with D-44 short-circuit. Three concrete layer impls: `JaccardNameMatcher` (Example 2 — ported from B's `deduplication.ts:436-445`), `CosineEmbeddingMatcher` (Example 3 — ported from A's `scripts/dedup-insights-by-embedding.js:56-64` + 78-110 clustering), `LLMSemanticMatcher` (Example 4 — ported from OKM's `deduplicator.ts:421-475` prompt + JSON-repair) |

## Critical Research Questions Answered

### Q1: A's cosine embedding logic — exact source file and line range

**Answer:** `/Users/Q284340/Agentic/coding/scripts/dedup-insights-by-embedding.js` (223 lines total). NOT in `qdrant-sync.ts` (that file doesn't exist in B). NOT in v6.0 retrieval service code (`src/retrieval/retrieval-service.js` does cosine via Qdrant's server-side `score_threshold`, NOT a pure JS implementation that can be ported).

**Specific extractions:**
- **Pure `cosine(a, b)` function:** lines 56-64 (9 lines). Plain JS, no deps. Operates on `Float32Array | number[]`.
- **`clusterByCosine(points, threshold)` greedy pairwise clustering:** lines 78-110 (33 lines). Solves the single-linkage chaining problem A discovered (commented at lines 70-77).
- **Threshold:** `0.93` (line 39) — empirically tuned for MiniLM-L6-v2. Commentary at lines 34-39 explains the baseline.

**Additional cosine surfaces in A** (NOT canonical for Phase 40 but useful context):
- `src/live-logging/ObservationConsolidator.js:36` — `INSIGHT_DEDUP_THRESHOLD = 0.88` (insight merge gate)
- `src/live-logging/ObservationConsolidator.js:44` — `INSIGHT_FACET_THRESHOLD = 0.83` (insight facet link gate)
- `src/live-logging/ObservationConsolidator.js:73` — `DIGEST_DEDUP_THRESHOLD = 0.97` (digest dedup gate)
- `src/retrieval/retrieval-service.js:38` — `scoreThreshold = 0.70` (retrieval recall threshold — different use case)

A consumes Qdrant via `tools.qdrant.search()` (`ObservationConsolidator.js:261`) — that's the **client interface** `CosineEmbeddingMatcher` accepts as ctor dep per D-44 + deferred-ideas "Cross-batch state."

**Client interface to require:** `{ embed(text): Promise<Float32Array>; search?(opts): Promise<Hit[]> }` — the matcher can either embed-on-demand (slow, ports A's script logic verbatim) OR call `search()` if the client supports it (matches A's `ObservationConsolidator` use pattern). Recommend Phase 40 ships **embed-only mode** (Example 3 above), and Phase 41 adds a fast-path search overload when wiring A's adapter.

**Confidence:** HIGH — read every line of the relevant files.

### Q2: OKM's pipeline.ts caveats for the port

**Answer:** Read entire `pipeline.ts` (771 lines). The following blocks are **OKM-specific** and should NOT port verbatim:

1. **PII filter call** (lines 117-120, 329-334, 377-385): wraps extract with `filterPII` + `capExtractionResult` from `pii-filter.ts` + `governance.ts`. *See Q3 recommendation — keep these out of km-core.*

2. **`populateEvidenceMetadata`** (lines 568-602, 35 lines): OKM-specific coupling to `SourceDocumentStore`, `EvidenceLink`, `SourceDocumentRef`, `SourceRef`. Drops trivially — neither A nor B has this concept.

3. **`createDerivedFromEdges`** (lines 653-677, 25 lines): pattern + evidence DERIVED_FROM edges. OKM-specific layer taxonomy. Drop.

4. **`handleMetricEntities`** (lines 683-728, 46 lines): auto-creates `Component` entities referenced by metrics, adds MEASURES_ON edges. OKM-domain (TimeWindow / Service / Infrastructure ontology). Drop.

5. **`handleSupersession`** (lines 736-770, 35 lines): finds entity by name/id, sets `validUntil`, creates SUPERSEDES edges. **Already covered by Phase 39 D-33 + D-35** via `putEntity` with `supersedes` set. Phase 40 should NOT port this — it would duplicate Phase 39's atomic closure logic with a slightly different `SUPERSEDES` edge name (Phase 39 uses `SUPERSEDED_BY` reverse edge). DROP entirely.

6. **`recordPatternOccurrences`** (lines 609-647, 39 lines): calls `recordOccurrence` from `intelligence/temporal.js`. OKM-specific. Drop.

7. **`extractOnly`** (lines 325-334): split-mode entry. Maps to D-43's `runStage('extract', text, opts)`. Don't expose as a separate method — use `runStage`.

8. **`deduplicateAndStore`** (lines 373-558): split-mode entry. Maps to `runStage`. Drop the duplicated body.

9. **`synthesizeAll`** (lines 343-351): one-time-migration helper. Out of scope for Phase 40 (it's a maintenance op, like `resolveEntities`).

10. **`resolveEntities`** (lines 361-367): **Phase 41 PIPE-02**, NOT Phase 40. The deduplicator's `resolveEntities` method (`deduplicator.ts:620-952`, 332 lines) is the implementation — also Phase 41.

**What DOES port verbatim:**
- `IngestionContext` shape (lines 28-49) — slim down to `{ provider, model, runId, ... }`; the optional fields (`evidenceLinks`, `artifactRefs`, `businessFacts`, `sourceAuthority`) are OKM-specific and stay caller-side. Recommend km-core's equivalent is just `ProvenanceStamp` (already in `entity.ts`) plus an optional `domain?: string`.
- `IngestionResult` shape (lines 51-61) — port as `IngestResult` with the addition of `skippedStages` (per CONTEXT.md specifics).
- `PhaseCallback` type (lines 64-68) — port verbatim, add `count?: number` per CONTEXT.md.
- Main 4-stage flow (lines 110-275) — port skeleton verbatim, strip the 6 OKM-specific helper calls listed above.

**Confidence:** HIGH — read all 771 lines.

### Q3: PII filter + governance hooks recommendation

**Answer:** **NO — do not port to km-core in Phase 40.** Defer to Phase 43 caller-side wrapping.

**Reasoning:**

(a) **Does C depend on them in production?** YES — OKM's `pipeline.ingest()` calls both `filterPII` and `capExtractionResult` on every ingest. C cannot ship without equivalent functionality. BUT this only means C needs to call them; it does NOT mean they must live in km-core.

(b) **Can the framework remain agnostic?** YES — both are pure-functional over `ExtractionResult`:
- `filterPII(extracted) -> { filtered, removedEntities }` (`pii-filter.ts:301`)
- `capExtractionResult(extracted) -> { result, droppedEntities, warnings }` (`governance.ts:182`)

Both can be invoked at the **caller side** as pre-extract or post-extract transforms. Phase 43 (C's migration) wraps `pipeline.ingest()` — either at the call site or, more cleanly, inside the OKM `Extractor` impl that wraps its own extraction:
```typescript
class OkmExtractor implements Extractor {
  async extract(text: string, domain?: string): Promise<Entity[]> {
    const raw = await this.llmExtract(text, domain);
    const { filtered } = filterPII(raw);          // OKM-specific
    const { result } = capExtractionResult(filtered); // OKM-specific
    return result.entities.map(toEntity);
  }
}
```

(c) **Why not port?** Two strong reasons:
- **`pii-filter.ts` is 658 lines** with HMAC-SHA256 hashing, an HMAC key env var (`OKB_PII_HMAC_KEY`), 6 detection regex categories (email, BMW Q-numbers, phones, VINs, IPs, person-name heuristics), and a metadata recursive scrubber. Porting it makes km-core PII-aware — a domain concern A and B don't share.
- **`governance.ts` has 236 lines** with `IngestionLimits` config (defaults: maxTextLength 200_000, maxBatchSize 50, maxEntitiesPerExtraction 100, etc.). Different systems want different caps; centralizing in km-core means every consumer fights over defaults.

**Both hooks are entangled with extract internals?** NO — they operate on `ExtractionResult`, which is the **output** of extract. Extract internals never see them. This makes them perfect candidates for caller-side wrapping.

**Recommendation to planner:** Document in Phase 40's `IngestPipeline` JSDoc that callers wishing PII filtering or governance caps should apply them inside their `Extractor.extract()` implementation (or wrap `pipeline.ingest()`). Add a one-paragraph "PII / Governance" section to the km-core README pointing OKM at this pattern. No port; no shared code.

**Confidence:** HIGH — read both files end-to-end and traced their integration points in `pipeline.ts`.

### Q4: B's Jaccard algorithm — extractable into a pure function?

**Answer:** YES, cleanly. Three relevant locations in `integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts`:

1. **`calculateStringSimilarity` (lines 436-445, 10 lines):** the pure Jaccard scoring function. Word-set similarity, `.toLowerCase().split(/\s+/)`, returns 0..1. Zero dependencies. Verbatim-portable.

2. **`calculateSimilarity` (lines 405-434, 30 lines):** B's blended-score function (Name x 0.4 + Type x 0.2 + Content x 0.4). **NOT what Phase 40 ports.** Per CONTEXT.md canonical-refs "Phase 40 ports the Jaccard scoring into `JaccardNameMatcher`" — only the *name* Jaccard, not the blended scoring with type/content.

3. **`deduplicateEntities` + `findDuplicatesInBatch` + `createDuplicateGroup` + `mergeEntityGroup`:** lines 314-565. These are B's full dedup orchestration with batching, threshold (`similarityConfig.similarityThreshold = 0.85` at line 61), merge side effects (`mergeEntityGroup` at :556 mutates entities, picks `keepMostSignificant: true`, etc.). **All of this is per-system policy and stays in B until Phase 42 deletes it.** Phase 40 does NOT port any of this — only `calculateStringSimilarity`.

**Confirm `JaccardNameMatcher.match(entity, candidate) -> { matched, confidence }` is implementable without B's side effects:** YES — see Example 2 above. The matcher takes one entity + a candidate pool, returns the best match by Jaccard score. No mutation, no merge. Threshold defaults to **0.85** (matches B's `similarityConfig.similarityThreshold`).

**B's current threshold:** `0.85` (`deduplication.ts:61`). The CONTEXT.md decisions mentioned "Jaccard 0.9" as a starting point — researcher recommends the planner override that to **0.85** to match B's production default. Phase 42 then either keeps 0.85 (no behavioral drift) or tunes after observing the migration.

**Confidence:** HIGH — read the relevant code spans.

### Q5: OKM's LLM-semantic dedup — prompt shape, model selection, error-handling

**Answer:** Source: `deduplicator.ts:421-475` (the `batchLLMDedup` private method).

**Prompt structure (port verbatim):**
- **System prompt** (`deduplicator.ts:430-434`): "You are an entity deduplication assistant. Given a list of new entity names and existing entity names (all of ontology class \"${ontologyClass}\"), identify which new entities are semantic duplicates of existing ones. Return a JSON object with a \"matches\" array. Each match has \"newName\" (the new entity name) and \"existingName\" (the existing entity name it duplicates). Only include matches where you are confident the entities refer to the same real-world concept (e.g., \"OOM\" and \"Out of Memory\" are the same). If no duplicates exist, return {\"matches\": []}."
- **User prompt** (`deduplicator.ts:437-443`): "Ontology class: ${ontologyClass}\n\nNew entities: ${JSON.stringify(newNames)}\nExisting entities: ${JSON.stringify(existingNames)}\n\nIdentify semantic duplicates."

**Model selection:** OKM does NOT hard-code a model. It uses `this.llmService.complete({ taskType: 'deduplication_matching' })` — task-type-based routing happens inside `@rapid/llm-proxy` (OKM's proxy library) which consults `config/llm-providers.yaml` per task tier (`entity_extraction`, `deduplication_matching`, `description_synthesis` -> fast tier). Phase 40's `LLMSemanticMatcher` MUST expose this as a ctor opt (`taskType: string`, default `'deduplication_matching'`) — see Example 4. Callers wire their own LLM client; the matcher only specifies the task tier as a request hint.

**Timeout:** `60_000` ms (60 seconds) — `deduplicator.ts:448`. Comment: "dedup prompts grow with existing entity count." Phase 40 ships this as default; callers override per ctor opt.

**Error handling:** OKM does `try/catch` around `batchLLMDedup` and falls back to **no matches** (`deduplicator.ts:213-218`):
```typescript
try {
  const matches = await this.batchLLMDedup(...);
  return { ontologyClass, newEntities, existingEntities, matches };
} catch (err) {
  console.warn(`[deduplicator] LLM dedup error for class "${ontologyClass}": ...`);
  return { ontologyClass, newEntities, existingEntities, matches: [] as DedupMatch[] };
}
```
So LLM failure does **NOT block ingest** — it skips the LLM-semantic layer and the entity flows through as net-new (likely later caught by post-hoc `resolveEntities()` in Phase 41 PIPE-02).

**Recommend for `LLMSemanticMatcher`:** `onError: 'skip' | 'throw'` ctor opt, default `'skip'` (matches OKM behavior). On `'skip'`, the matcher returns `{ matched: false, confidence: 0 }` and emits a `process.stderr.write` warning. On `'throw'`, the error propagates to `pipeline.ingest()` which aborts per the recommended "abort on throw" stage-failure semantics.

**Output parsing format:** 5 stages of defensive JSON unwrap (`deduplicator.ts:451-472`):
1. Try anchored fence (`^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$`)
2. Try unanchored fence (`/```(?:json)?\s*\n([\s\S]*?)\n\s*```/`)
3. Try first-`{` to last-`}` extraction
4. `JSON.parse()` the result
5. Return `parsed.matches ?? []`

For pure parse-error robustness, also consider porting `repairTruncatedJson` from `extractor.ts:27-124` (OKM uses this for extractor responses, not dedup responses, but the same `max_tokens` truncation problem can hit large candidate lists).

**Confidence:** HIGH — read all the relevant code spans.

### Q6: Validation architecture (Nyquist coverage) — see dedicated section below

See `## Validation Architecture` section below — it covers stage boundaries, layer boundaries, dedup-induced supersession path crossing Phase 39 CR-01 fix, and synthetic-batch design for SC#2.

### Q7: Quick scope verification — directory shape

**Answer:** Recommended directory shape (also captured in `### Recommended Project Structure` above):

- `src/pipeline/IngestPipeline.ts` — ~250 lines including JSDoc; matches Phase 39 size precedent
- `src/pipeline/types.ts` — ~80 lines for Extractor, Synthesizer, PhaseCallback, IngestResult, StageInput, IngestOpts, IngestPipelineOpts
- `src/pipeline/index.ts` — ~15 lines barrel
- `src/dedup/LayeredDeduplicator.ts` — ~80 lines
- `src/dedup/JaccardNameMatcher.ts` — ~40 lines (pure port of B's algo + wrapping)
- `src/dedup/CosineEmbeddingMatcher.ts` — ~60 lines (port of A's algo + EmbeddingClient interface)
- `src/dedup/LLMSemanticMatcher.ts` — ~120 lines (port of OKM's prompt + JSON-repair + error policy)
- `src/dedup/types.ts` — ~80 lines for ExactNameLayer, EmbeddingLayer, LLMSemanticLayer, MatchResult, DedupResult, LLMClient, EmbeddingClient
- `src/dedup/index.ts` — ~15 lines barrel

**Why this shape:** Mirrors Phase 38's `src/ontology/{registry,loader,types}.ts` and Phase 39's separate-helper-file convention. **One file per public class** keeps test files trivially symmetric (one `tests/unit/<class>.test.ts` per source file — matches the 8 existing test files in `tests/unit/`). Sub-barrel pattern matches Phase 38's `./ontology` sub-path export — Phase 40 will likely want `./pipeline` and `./dedup` sub-path entries in `package.json` `exports` for callers that want to import only one half of the surface.

**Confidence:** HIGH — verified against existing km-core file layout.

## Project Constraints (from CLAUDE.md)

| Directive | Source | Phase 40 Implication |
|-----------|--------|----------------------|
| TypeScript mandatory with strict type checking | CLAUDE.md "Mandatory Rules" | `tsconfig.json` already enforces; all Phase 40 code MUST compile under `tsc --strict` |
| Never modify working APIs for TypeScript compliance; fix types instead | CLAUDE.md "Mandatory Rules" | Phase 37/38/39 APIs (`putEntity`, `findByOntologyClass`, etc.) are STABLE — Phase 40 calls them, never modifies them |
| Submodule build pipeline: `npm run build` inside the submodule (compiles TS to `dist/`) | CLAUDE.md "Rebuilding After Code Changes" | Every Phase 40 plan modifying `src/` MUST `cd ~/Agentic/km-core && npm run build` AND `npm test` at the end. Otherwise consumer-side imports (Phase 41/42/43) get stale `dist/` |
| Constraint Violations = Real Issues — `no-console-log` applies to Edit/Write on .js/.ts files; use `process.stderr.write()` | MEMORY.md (CRITICAL) | Every diagnostic site (LLM error skip, candidate-pool-empty warning, stage-debug emission) MUST use `process.stderr.write(...)`. OKM source has ~10 `console.info` + `console.warn` calls — DROP all of them during port |
| PlantUML diagrams use `plantuml` CLI, NEVER `java -jar plantuml.jar` | CLAUDE.md | No diagrams needed for Phase 40 (architecture narrative above is prose + tables); skip |
| Phase 40 ships in `~/Agentic/km-core/`, not this repo | Additional context | All file paths in plans must be absolute paths under `~/Agentic/km-core/`. NO edits to `coding/` or `rapid-automations/` from Phase 40 plans (per D-45 co-exist mode) |
| Test framework: vitest, not jest | km-core/package.json | Phase 40 test files use `vitest` imports (matches Phase 37/38/39) |
| ESM only, `type: module`, NodeNext | CF-D06 | `.js` suffix on every relative import; no `require()`; no CommonJS interop |
| No ASCII / line art in documentation | `no-ascii-art-in-docs` constraint | This research doc uses prose + tables for the architecture map; PlantUML would be the alternative if diagrams were needed |

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` — treated as enabled. This section is therefore required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 (already in `~/Agentic/km-core/package.json`) |
| Config file | `~/Agentic/km-core/vitest.config.ts` (already exists) |
| Quick run command | `cd ~/Agentic/km-core && npx vitest run tests/unit/pipeline.test.ts` (per-file) |
| Full suite command | `cd ~/Agentic/km-core && npm test` (runs all 8 existing + 2 new) |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPE-01 | 4 stages run in order extract -> dedup -> store -> synthesize | unit | `npx vitest run tests/unit/pipeline.test.ts -t "stage order"` | ❌ Wave 0 |
| PIPE-01 | `onPhase` callback fires for each stage with `start` + `done` | unit | `npx vitest run tests/unit/pipeline.test.ts -t "onPhase observability"` | ❌ Wave 0 |
| PIPE-01 | `skipStages: ['synthesize']` runs the other 3, records in `IngestResult.skippedStages` | unit | `npx vitest run tests/unit/pipeline.test.ts -t "skipStages synthesize"` | ❌ Wave 0 |
| PIPE-01 | `skipStages: ['extract']` either throws or behaves spec-defined (Pitfall 5) | unit | `npx vitest run tests/unit/pipeline.test.ts -t "skipStages extract contract"` | ❌ Wave 0 |
| PIPE-01 | `runStage('synthesize', entities, opts)` runs synthesize standalone | unit | `npx vitest run tests/unit/pipeline.test.ts -t "runStage synthesize"` | ❌ Wave 0 |
| PIPE-01 | Pipeline threads caller's `provenance` to `store.putEntity` (never invents one) | unit | `npx vitest run tests/unit/pipeline.test.ts -t "provenance threading"` | ❌ Wave 0 |
| PIPE-01 | `IngestResult` shape matches `{ extractedCount, mergedCount, storedCount, durations: {...}, skippedStages }` | unit | `npx vitest run tests/unit/pipeline.test.ts -t "IngestResult shape"` | ❌ Wave 0 |
| DEDUP-01 | Synthetic batch: known exact-name collision -> caught by `exactName` layer first | unit | `npx vitest run tests/unit/layered-dedup.test.ts -t "exact-name layer catches"` | ❌ Wave 0 |
| DEDUP-01 | Synthetic batch: known cosine collision (no exact name match) -> caught by `embedding` layer | unit | `npx vitest run tests/unit/layered-dedup.test.ts -t "embedding layer catches"` | ❌ Wave 0 |
| DEDUP-01 | Synthetic batch: known semantic (no exact, no cosine) -> caught by `llmSemantic` layer | unit | `npx vitest run tests/unit/layered-dedup.test.ts -t "llm-semantic layer catches"` | ❌ Wave 0 |
| DEDUP-01 | Short-circuit: first-layer match prevents downstream layers from being called | unit | `npx vitest run tests/unit/layered-dedup.test.ts -t "short-circuit on first match"` | ❌ Wave 0 |
| DEDUP-01 | `shortCircuit: false`: all layers run; best match across layers wins | unit | `npx vitest run tests/unit/layered-dedup.test.ts -t "no-short-circuit aggregates"` | ❌ Wave 0 |
| DEDUP-01 | Omitting a layer slot skips that layer cleanly (no null deref) | unit | `npx vitest run tests/unit/layered-dedup.test.ts -t "omitted layer"` | ❌ Wave 0 |
| DEDUP-01 | `JaccardNameMatcher.match()` returns expected scores for known fixture pairs | unit | `npx vitest run tests/unit/jaccard-matcher.test.ts -t "score"` | ❌ Wave 0 |
| DEDUP-01 | `CosineEmbeddingMatcher.match()` with fake `EmbeddingClient` returns expected scores | unit | `npx vitest run tests/unit/cosine-matcher.test.ts -t "score"` | ❌ Wave 0 |
| DEDUP-01 | `LLMSemanticMatcher.match()` with mock `LLMClient` parses fenced + raw JSON responses | unit | `npx vitest run tests/unit/llm-matcher.test.ts -t "json unwrap"` | ❌ Wave 0 |
| DEDUP-01 | `LLMSemanticMatcher` `onError: 'skip'` returns `{ matched: false }` on client throw | unit | `npx vitest run tests/unit/llm-matcher.test.ts -t "onError skip"` | ❌ Wave 0 |
| **Boundary** | Pipeline's `store` stage triggers Phase 39 D-33 supersession when survivor matched (active path) | integration | `npx vitest run tests/integration/pipeline-supersession.test.ts -t "supersedes via matched survivor"` | ❌ Wave 0 |
| **Boundary** | Pipeline supersession of a legacy-id predecessor uses Phase 39 CR-01 per-op skipOntologyCheck (does NOT throw) | integration | `npx vitest run tests/integration/pipeline-supersession.test.ts -t "CR-01 legacy predecessor"` | ❌ Wave 0 |
| **Boundary** | Pipeline's `store` stage uses Phase 39 D-34 active-only filter when pre-loading candidates (D-46) | integration | `npx vitest run tests/integration/pipeline-candidate-pool.test.ts -t "active-only candidates"` | ❌ Wave 0 |
| **Boundary** | Pipeline never invents a ProvenanceStamp; throws if caller omits `provenance` opt | unit | `npx vitest run tests/unit/pipeline.test.ts -t "provenance required"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd ~/Agentic/km-core && npx vitest run tests/unit/<file>.test.ts` for the file the task touched. ~3-5 seconds each.
- **Per wave merge:** `cd ~/Agentic/km-core && npm test` — full suite. Currently ~92 tests passing (90 from Phase 39 + 2 net new from CR-01/WR-04 regression tests). Phase 40 adds an estimated 20-25 unit + 3 integration tests; expect ~115-120 tests post-Phase-40. Suite still <30 seconds based on Phase 39 baseline.
- **Phase gate:** Full suite green + `cd ~/Agentic/km-core && npm run build` clean (tsc strict) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `~/Agentic/km-core/tests/unit/pipeline.test.ts` — covers PIPE-01 (7 contract tests + 1 provenance-required throw test)
- [ ] `~/Agentic/km-core/tests/unit/layered-dedup.test.ts` — covers DEDUP-01 orchestration (6 tests: 3 layers catch in order, short-circuit, no-short-circuit, omitted slot)
- [ ] `~/Agentic/km-core/tests/unit/jaccard-matcher.test.ts` — covers `JaccardNameMatcher` (3 tests: known-match-score fixture, no-match, self-skip)
- [ ] `~/Agentic/km-core/tests/unit/cosine-matcher.test.ts` — covers `CosineEmbeddingMatcher` (3 tests: known-match-score with fake EmbeddingClient, no-match, threshold cutoff)
- [ ] `~/Agentic/km-core/tests/unit/llm-matcher.test.ts` — covers `LLMSemanticMatcher` (4 tests: anchored fence, unanchored fence, raw JSON, onError skip)
- [ ] `~/Agentic/km-core/tests/integration/pipeline-supersession.test.ts` — Phase 39 D-33 + CR-01 integration (2 tests)
- [ ] `~/Agentic/km-core/tests/integration/pipeline-candidate-pool.test.ts` — D-46 + Phase 39 D-34 integration (1 test)
- [ ] Shared test helpers: `~/Agentic/km-core/tests/unit/_helpers/fakes.ts` — `FakeEmbeddingClient`, `MockLLMClient`, `BuildPipelineFixture` factory. Existing `~/Agentic/km-core/tests/unit/graph-store.test.ts` already establishes a fixture pattern (e.g., `setupStore()`); Phase 40 helpers extend that style.

**Framework install:** None — vitest already present.

**Synthetic-batch design for SC#2 (Q6 deep-dive):**

The canonical SC#2 test is `tests/integration/layered-dedup-collision-catch.test.ts` (integration because it composes all 3 layers + store + ontology registry):

1. **Seed graph** with 3 entities of `ontologyClass: 'Component'`:
   - `{ name: 'UserAuthService', description: 'Handles login flow' }` — for exact-name collision
   - `{ name: 'CartCheckoutService', description: 'Handles cart-to-payment transition' }` — for cosine collision
   - `{ name: 'PaymentProcessor', description: 'Adapter for Stripe + Braintree' }` — for LLM-semantic collision (semantically equivalent to "BillingService" via LLM knowledge, NOT via name or embedding)

2. **Construct batch input** (3 new entities):
   - `{ name: 'UserAuthService', ontologyClass: 'Component' }` — should match candidate 1 via `exactName` (Jaccard ~1.0)
   - `{ name: 'CartCheckoutFlow', ontologyClass: 'Component' }` — should NOT match by name (Jaccard ~0.5 < 0.85), should match by cosine (`FakeEmbeddingClient` returns score 0.93 for these specific texts)
   - `{ name: 'BillingService', ontologyClass: 'Component' }` — should NOT match by name (Jaccard ~0), should NOT match by cosine (`FakeEmbeddingClient` returns 0.4), should match by LLM (`MockLLMClient` returns `{ matches: [{ newName: 'BillingService', existingName: 'PaymentProcessor' }] }`)

3. **Assert** for each input: `IngestResult.mergedCount === 3`; via `onPhase` capture, `dedup` stage fired once per entity; via inspecting `DedupResult.matchedLayer` (exposed in `allLayerResults`), each match was caught by the expected layer; `FakeEmbeddingClient.calls.length === 2` (called only for the 2nd and 3rd entities, NOT the first — proves short-circuit); `MockLLMClient.calls.length === 1` (called only for the 3rd entity — proves short-circuit across layers).

**Reverse-supersession path test:** Re-use the above seeded graph, but assert that after the 3-batch ingest, `await store.getSupersessionChain(newEntity.id)` returns `[seedEntity, newEntity]` for each survivor — proving Phase 39 D-33 atomic closure fired automatically through `putEntity({ supersedes: survivor.id }, ...)`.

**Phase 39 CR-01 path test:** Seed a legacy-id entity using `store.batch([{type: 'putEntity', entity: { id: 'legacy-nanoid-xyz' as EntityId, ... }, skipOntologyCheck: true }])`. Run pipeline with a new entity that dedup matches against the legacy survivor. Assert: pipeline does NOT throw at the supersession closure (proves CR-01 fix is still in the integration path); `store.getEntity('legacy-nanoid-xyz' as EntityId).validUntil` is set to `newEntity.validFrom`.

## Environment Availability

> Phase 40 has **zero external runtime dependencies** beyond the existing km-core toolchain.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | All km-core code | ✓ | v22+ (km-core engines pin) | — |
| TypeScript (`tsc`) | Build | ✓ | 5.9.3 (km-core devDep) | — |
| vitest | Tests | ✓ | 4.0.18 (km-core devDep) | — |
| graphology | Indirect via `GraphKMStore` | ✓ | 0.26.0 (km-core dep) | — |
| LLM provider | LLMSemanticMatcher TESTS | ✗ | n/a | Use `MockLLMClient` in unit tests (zero network) — see Validation Architecture |
| Qdrant / embedding service | CosineEmbeddingMatcher TESTS | ✗ | n/a | Use `FakeEmbeddingClient` in unit tests (returns deterministic vectors) |

**Missing dependencies with no fallback:** none — all test paths use mocks/fakes.
**Missing dependencies with fallback:** LLM provider, embedding service — both replaced by test doubles (this is the standard km-core test pattern; existing 92 tests use the same approach for ontology fixtures, store mocks, etc.).

## Security Domain

> `security_enforcement` is not set in `.planning/config.json` — treated as enabled. Phase 40 is a pure-library framework with no network ingress, no credentials, no user input handling. Most ASVS categories don't apply; the relevant ones are V5 + V6.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | km-core has no auth surface — callers (A/B/C MCP servers, REST APIs) handle auth |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | km-core has no multi-tenant access boundaries |
| V5 Input Validation | yes | LLM response parsing (`LLMSemanticMatcher`); extractor output validation (caller-side) |
| V6 Cryptography | yes (delegated) | Phase 40 generates no crypto; relies on Phase 37's UUIDv7 via `mintEntityId` — never roll cryptography |
| V7 Error Handling & Logging | yes | All errors via `process.stderr.write`; never include LLM-response raw content in logs (may contain user data from prior extract step) |

### Known Threat Patterns for {TS library, LLM-integrated dedup}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LLM prompt injection via extracted entity name | Tampering | `LLMSemanticMatcher` only sends entity names through `JSON.stringify` — JSON injection mitigated by the response parsing layer (5-stage unwrap rejects malformed responses). Risk: a malicious entity name could try to break out of the JSON if the LLM echoes it verbatim into a faked response. Mitigation: the parsed result is structurally validated (`parsed.matches` must be an array of `{newName, existingName}` strings; mismatches are dropped). |
| LLM response untrusted JSON parse | Tampering | The 5-stage unwrap from OKM (`deduplicator.ts:451-472`) handles malformed responses; final `JSON.parse` throws on bad input -> caught by the matcher's `onError` policy (default `'skip'`). |
| Supply-chain risk from new deps | Tampering | NO new deps — see "Standard Stack." Phase 40 uses only Phase 37's pinned deps. |
| Provenance forgery via WR-04-style injection | Tampering | Phase 39 WR-04 already mitigated for `mergeDescriptionSegment` (drops caller-supplied `confirmations[]` on miss). Phase 40 must NOT bypass this — when synthesizer impls produce new `DescriptionSegment`, route them through `mergeDescriptionSegment` per Phase 39 contract. |
| Excessive LLM cost / DoS via large candidate pool | Denial of Service | `LLMSemanticMatcher` timeout default 60s + caller controls candidate-pool size via `findByOntologyClass` (which respects D-34 active-only filter, naturally limiting the pool). No additional rate-limiting at the matcher level. |
| Log injection via LLM response in stderr trace | Tampering / Confidentiality | When logging LLM errors, log only the error message + first 200 chars of raw response. NEVER log full `response.content` (may contain user data from the prior extract stage). |

## Assumptions Log

> Claims tagged `[ASSUMED]` need user confirmation before becoming locked decisions.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recommended **Jaccard default 0.85** (vs CONTEXT.md "starting point 0.9") matches B's production threshold | Standard Stack: Alternatives Considered + "Exact threshold defaults"; Claude's Discretion | If B was actually running at 0.9 in production and 0.85 changes match rates, Phase 42's migration will show drift. Mitigation: Phase 42 verifies B's actual `.observations` config / `agent-tuning.json` for the live threshold |
| A2 | Recommended **cosine default 0.90** (between A's insight-dedup 0.93 and insight-merge 0.88) | Pitfall 4 + Claude's Discretion | If neither calibration is right for the matcher's general-purpose use, callers will need to override; mitigated by surfacing as ctor opt with documented per-surface tuning |
| A3 | Recommended **LLM default 0.70** matches OKM's implicit "any match returned by LLM is taken" | Claude's Discretion | OKM doesn't actually USE a threshold for LLM matches; it trusts the LLM's verdict. If the planner adopts 0.70 as a hard cutoff, ambiguous LLM matches get filtered. Mitigation: treat threshold as "minimum confidence to record"; with LLM returning matches at all = 0.70 default makes sense |
| A4 | OKM's `pii-filter.ts` + `governance.ts` should stay caller-side (Q3 recommendation) — C will wrap them in its `Extractor` impl during Phase 43 | Q3 answer | If C's migration discovers these hooks have deeper coupling than this research surfaced (e.g., they fire ON entities returned by store, not on extract output), they may need to land in km-core after all. Mitigation: planner adds a "Phase 43 may revisit" note in the IngestPipeline JSDoc |
| A5 | The `recordOccurrence` + `intelligence/temporal.js` coupling in OKM's pipeline (lines 609-647) is OKM-specific and not needed by A or B | Q2 answer | Phase 41 (A) might want a similar "record pattern occurrences" mechanism for insights. Mitigation: if it emerges, add a synthesize-stage post-hook in Phase 41, not a framework concern |
| A6 | The `runStage('store', entities, opts)` and `pipeline.ingest({ skipStages: ['extract','dedup','synthesize'] })` are public contracts that MUST produce identical results | Claude's Discretion | If the planner decides one of them shells out to a subtly different code path (e.g., `runStage` runs synchronously without `onPhase` callbacks), divergence emerges. Mitigation: contract test that asserts identical IngestResult for both invocations |
| A7 | Phase 40 plan-checker should flag any plan that touches `src/` without a `cd ~/Agentic/km-core && npm run build` step | Pitfall 6 + Project Constraints | If the planner forgets, Phase 41/42/43 hit stale-dist errors. Mitigation: research surfaces this explicitly; planner should add as a per-plan post-step |

**If CONTEXT.md deferred-ideas PII + governance + cross-batch state are respected, the assumed claims above shrink to A1, A2, A3 — purely numeric tuning defaults that the planner can survey production configs to confirm.**

## Open Questions (RESOLVED)

> All 4 questions locked 2026-05-21 to the researcher's recommendations. These RESOLVED choices are load-bearing for Plan 40-06 in particular (Q2 → `runStage` shape).

1. **A's `ObservationConsolidator` uses an `INSIGHT_FACET_THRESHOLD` (0.83) for "facet linking" — different from "merge."** Phase 40's `LayeredDeduplicator` only has `matched: true | false`; no facet-link verdict.
   - What we know: A's facet vs merge distinction is per-system policy. The matcher can return `confidence` and let the caller decide thresholds for facet vs merge.
   - What's unclear: should `MatchResult` carry an optional `verdict: 'merge' | 'facet' | undefined` field to support A's pattern, or is that strictly Phase 41 caller-side logic?
   - **RESOLVED:** Keep `MatchResult` minimal: `{ matched: boolean, survivor?: Entity, confidence: number }`. NO `verdict` field. Phase 41 (A's migration) interprets `confidence` against `INSIGHT_FACET_THRESHOLD` caller-side. Phase 40 stays facet-agnostic.

2. **D-43 `runStage(name, input, opts)` signature.** The CONTEXT example says A's daily cron calls `runStage('synthesize', todaysEntities, { provenance })`. But what's the `input` type for each stage?
   - What we know: `extract`'s input is `string`; `dedup`'s input is `Entity` + candidates; `store`'s input is `Entity[]`; `synthesize`'s input is entity IDs or entities.
   - What's unclear: does `runStage` take a union type (`string | Entity[] | EntityId[]`), or a generic `runStage<T>(name, input: T, opts)`, or 4 overloads?
   - **RESOLVED:** **4 typed TypeScript function overloads** (cost: more declaration lines; benefit: IDE autocomplete picks the right input type per stage name). Plan 40-06 Task 1 MUST implement this as overloads, NOT as a generic `runStage<T>` (which would defeat the type-discoverability point). Signatures (locked):
     - `runStage(name: 'extract', input: string, opts: { provenance: ProvenanceStamp }): Promise<Entity[]>`
     - `runStage(name: 'dedup', input: Entity, opts: { candidates: Entity[] }): Promise<DedupDecision>`
     - `runStage(name: 'store', input: Entity[], opts: { provenance: ProvenanceStamp; supersedes?: Map<EntityId, EntityId> }): Promise<Entity[]>`
     - `runStage(name: 'synthesize', input: EntityId[], opts: { provenance: ProvenanceStamp }): Promise<void>`

3. **`onPhase` callback shape — should it carry `IngestResult` partial?** OKM emits only `{ stage, status, durationMs }`. CONTEXT.md adds `count?: number`. Should it also expose intermediate `IngestResult` (e.g., `extractedCount` after extract done)?
   - What we know: OKM doesn't — minimalism wins.
   - What's unclear: callers may want progress reporting (e.g., "extracted 50 entities, deduping now..."). Without intermediate counts, callers must wait for `IngestResult` at the end.
   - **RESOLVED:** Match OKM verbatim: `(arg: { stage: 'extract'|'dedup'|'store'|'synthesize'; status: 'start'|'end'; count?: number; durationMs?: number }) => void`. NO intermediate `IngestResult`. Phase 41/42 can wrap with richer telemetry caller-side.

4. **Layer order — locked or configurable?** D-44 says "Pipeline runs layers in declared order (`exactName -> embedding -> llmSemantic`)." But layers are passed as named slots in `LayeredDeduplicatorOpts`. The "declared order" is currently implicit (Jaccard first, then embedding, then LLM by cost ascending).
   - What we know: 3 named slots, run in cost-ascending order.
   - What's unclear: if a future use case wants embedding-first (e.g., paragraph-level semantic dedup where Jaccard would false-positive on shared technical vocabulary), is the order reconfigurable?
   - **RESOLVED:** **Order is hard-coded** in Phase 40: `exactName → embedding → llmSemantic` (cost-ascending). NO `order` ctor opt, NO runtime reordering. If a real use case for embedding-first emerges, reopen via a follow-on phase. Premature flexibility = bug factory.

## Sources

### Primary (HIGH confidence)
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/pipeline.ts` (771 lines) — full read; canonical reference for 4-stage framework
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts` (952 lines) — read 1-500 and key sections of 500-952; LLM dedup prompt + JSON repair source
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/extractor.ts` (450 lines) — read 1-230; JSON-repair helpers source
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/pii-filter.ts` (658 lines) — sampled; confirms PII coupling and HMAC key dependency
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/governance.ts` (236 lines) — sampled; confirms ingestion-limits config
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts` (907 lines) — read 1-500 + threshold survey; B's Jaccard source
- `/Users/Q284340/Agentic/coding/scripts/dedup-insights-by-embedding.js` (223 lines) — full read; A's cosine source
- `/Users/Q284340/Agentic/coding/src/live-logging/ObservationConsolidator.js` (excerpts 1-300) — A's threshold landscape
- `/Users/Q284340/Agentic/km-core/src/store/GraphKMStore.ts` (914 lines) — sampled key methods; integration surface for Phase 40
- `/Users/Q284340/Agentic/km-core/src/types/entity.ts` (184 lines) — full read; canonical Entity shape
- `/Users/Q284340/Agentic/km-core/src/store/types.ts` (72 lines) — full read; BatchOp + PutEntityOpts CR-01 widening
- `/Users/Q284340/Agentic/km-core/src/index.ts` — full read; barrel append pattern
- `/Users/Q284340/Agentic/km-core/package.json` — full read; dep pins + exports map convention
- `.planning/phases/40-ingest-pipeline-layered-dedup/40-CONTEXT.md` — locked decisions D-42..D-46
- `.planning/phases/37-km-core-foundation/37-CONTEXT.md` — Phase 37 carry-forward decisions
- `.planning/phases/38-ontology-registry/38-CONTEXT.md` — Phase 38 carry-forward decisions
- `.planning/phases/39-entity-data-model/39-CONTEXT.md` — Phase 39 carry-forward decisions
- `.planning/phases/39-entity-data-model/39-REVIEW-FIX.md` — CR-01 BatchOp widening (commit 44c1e9b) — critical for Phase 40 supersession path

### Secondary (MEDIUM confidence)
- `~/.claude/projects/-Users-Q284340-Agentic-coding/memory/MEMORY.md` (208 lines) — submodule build pipeline + no-console-log enforcement
- `/Users/Q284340/Agentic/coding/CLAUDE.md` (full read) — project constraints
- `/Users/Q284340/Agentic/coding/.planning/research/v7.1-km-unification.md` — 3-system comparison

### Tertiary (LOW confidence)
- None — all critical claims sourced from primary code reads.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified zero new deps; existing pins read from km-core package.json
- Architecture: HIGH — every pattern sourced from existing km-core files (Phase 37/38/39 precedent) + production OKM/A/B code
- Pitfalls: HIGH — every pitfall traced to a specific source-file line range or a documented Phase 39 review finding
- Q1 (A's cosine): HIGH — pinned to `scripts/dedup-insights-by-embedding.js` lines 56-64 + 78-110
- Q2 (OKM pipeline.ts caveats): HIGH — read all 771 lines, listed 10 non-portable blocks with line ranges
- Q3 (PII + governance recommendation): HIGH — confirmed both are pure-functional over ExtractionResult, viable as caller-side wrappers
- Q4 (B's Jaccard extractability): HIGH — `calculateStringSimilarity` is 10 self-contained lines, zero side effects
- Q5 (OKM LLM-semantic): HIGH — extracted prompts verbatim, error policy verified
- Q6 (Validation architecture): HIGH — drafted concrete test surfaces with command lines
- Q7 (Directory shape): HIGH — verified against existing 8 test files + 5 src/ subdirectories in km-core

**Research date:** 2026-05-21
**Valid until:** 2026-06-20 (30 days; km-core moves slowly, OKM source is stable)
