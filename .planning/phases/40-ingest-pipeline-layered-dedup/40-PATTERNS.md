# Phase 40: Ingest Pipeline & Layered Dedup - Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 17 (16 new + 1 modified)
**Analogs found:** 17 / 17 — every new file maps to at least one existing analog (km-core has rich precedent from Phases 37/38/39 + OKM is the source-of-truth for the algorithmic ports).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog (km-core) | Algorithmic Source (port) | Match Quality |
|-------------------|------|-----------|--------------------------|---------------------------|---------------|
| `src/pipeline/IngestPipeline.ts` | service (orchestrator class) | request-response, async sequential | `src/store/GraphKMStore.ts` (composition class, options-object ctor, EventEmitter-style observability) + `src/backfill/index.ts` (multi-stage algorithm with stderr-warn) | OKM `pipeline.ts:76-316` (4-stage chain + onPhase) | role-match (orchestrator) + algorithm-port |
| `src/pipeline/types.ts` | model (public type surface) | n/a | `src/store/types.ts` (D-17 `BatchOp` + D-30 `PutEntityOpts`) + `src/types/entity.ts` (canonical type module) | OKM `pipeline.ts:28-68` (`IngestionContext`, `IngestionResult`, `PhaseCallback`) | exact (same shape — public-type module per `src/<dir>/types.ts` convention) |
| `src/pipeline/index.ts` | config (sub-barrel) | n/a | `src/segments/index.ts` (10 lines, header comment + re-exports) + `src/ontology/index.ts` (20 lines) | — | exact |
| `src/dedup/LayeredDeduplicator.ts` | service (orchestrator class) | request-response | `src/store/GraphKMStore.ts` (options-object ctor, short methods returning result objects) | OKM `deduplicator.ts:53-322` (short-circuit chain) | role-match + algorithm-port |
| `src/dedup/JaccardNameMatcher.ts` | service (algorithm impl) | transform (string → score) | `src/segments/merge.ts` (pure function utility, no I/O, single responsibility, deep-clone purity contract) | B `deduplication.ts:436-445` (9-line Jaccard) | role-match + verbatim algorithm port |
| `src/dedup/CosineEmbeddingMatcher.ts` | service (algorithm impl with injected client) | transform + async I/O via client | `src/validation/ontology.ts` (`registryBackedValidator` — caller-injected dependency factory pattern) + `src/segments/merge.ts` (pure-function neighbor) | A `scripts/dedup-insights-by-embedding.js:56-110` (cosine + greedy clustering) | role-match + algorithm-port |
| `src/dedup/LLMSemanticMatcher.ts` | service (algorithm impl with injected client) | request-response + async I/O via client | `src/validation/ontology.ts` (injected-dependency ctor) | OKM `deduplicator.ts:421-475` (batchLLMDedup + 5-stage JSON unwrap) | role-match + algorithm-port |
| `src/dedup/types.ts` | model (public type surface) | n/a | `src/store/types.ts` + `src/types/entity.ts` | OKM `deduplicator.ts:24-36` (`DeduplicationResult`, `DedupMatch`) | exact |
| `src/dedup/index.ts` | config (sub-barrel) | n/a | `src/segments/index.ts` + `src/ontology/index.ts` | — | exact |
| `tests/unit/pipeline.test.ts` | test | request-response | `tests/unit/graph-store.test.ts` (`Ctx` + `makeStore()` factory + `beforeEach/afterEach`) | — | exact (test-fixture pattern shared) |
| `tests/unit/layered-dedup.test.ts` | test | request-response | `tests/unit/segments-merge.test.ts` (`mkEntity()` + `mkSegment()` builder helpers + `vi.restoreAllMocks()`) | — | exact |
| `tests/unit/jaccard-matcher.test.ts` | test | transform | `tests/unit/segments-merge.test.ts` (pure-function test pattern, no store needed) | — | exact |
| `tests/unit/cosine-matcher.test.ts` | test | transform with stubbed client | `tests/unit/ontology-registry.test.ts` (interface-stub `OntologyValidatorStub` + `vi.spyOn`) + `tests/unit/segments-merge.test.ts` (builder helpers) | — | exact |
| `tests/unit/llm-matcher.test.ts` | test | request-response with mocked LLM client | `tests/unit/graph-store.test.ts` (`OntologyValidatorStub` interface-stub at top) + `tests/unit/backfill.test.ts` (resolver-as-function injection) | — | exact |
| `tests/integration/pipeline-supersession.test.ts` | test | end-to-end | `tests/integration/round-trip.test.ts` (full-store integration, path-resolved fixtures, `GraphKMStore` lifecycle) | — | exact |
| `tests/integration/pipeline-candidate-pool.test.ts` | test | end-to-end | `tests/integration/round-trip.test.ts` | — | exact |
| `tests/unit/_helpers/fakes.ts` | test (fixture/fake) | n/a | `tests/unit/backfill.test.ts` (`BackfillResolver` typed-function fake) + `tests/unit/graph-store.test.ts` (`OntologyValidatorStub` interface fake) | — | role-match (no prior `_helpers/` dir; pattern is per-file currently) |
| `src/index.ts` (MODIFIED, append-only) | config (root barrel) | n/a | `src/index.ts` lines 70-89 (Phase 39 append block — exact precedent for how Phase 40 appends) | — | exact |

---

## Pattern Assignments

### `src/pipeline/IngestPipeline.ts` (service, request-response orchestrator)

**Primary analog:** `~/Agentic/km-core/src/store/GraphKMStore.ts` (composition class + options-object ctor + per-method JSDoc citing CONTEXT decisions).
**Algorithm source:** `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/pipeline.ts` lines 76-316 (4-stage chain).

**Imports pattern** (copy from `GraphKMStore.ts:80-83`):
```typescript
import type {
  Entity,
  ProvenanceStamp,
} from '../types/entity.js';
import type { GraphKMStore } from '../store/GraphKMStore.js';
import type {
  Extractor,
  Synthesizer,
  PhaseCallback,
  IngestResult,
  IngestOpts,
  StageName,
  IngestPipelineOpts,
} from './types.js';
import type { LayeredDeduplicator } from '../dedup/LayeredDeduplicator.js';
```
**Critical:** every relative import ends in `.js` (CF-D06 / verified at `GraphKMStore.ts:80-83`, `merge.ts:33-37`).

**Options-object ctor pattern** (copy from `GraphKMStore.ts:325-328` + the `GraphKMStoreOptions` interface at `GraphKMStore.ts:90-122` for the JSDoc style):
```typescript
export interface IngestPipelineOpts {
  extractor: Extractor;
  deduplicator: LayeredDeduplicator;
  synthesizer: Synthesizer;
  onPhase?: PhaseCallback;
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
}
```
**Why this shape:** D-42 + CF-D14 (options-object); positional `store` matches the GraphKMStore ctor precedent where the primary subject is the only positional arg.

**4-stage orchestration pattern** (the `ingest()` method body — port from OKM `pipeline.ts:107-316`, stripping the 6 OKM-specific helpers per RESEARCH.md Pitfall 7):

OKM source — line-by-line port targets:
- `pipeline.ts:111` `onPhase?.({ stage: 'extract', status: 'start' })` → keep verbatim
- `pipeline.ts:113-115` `extractor.extract(text, domain)` → keep
- `pipeline.ts:117-125` `filterPII` + `capExtractionResult` → **DROP** (RESEARCH.md Q3 — defer to Phase 43 caller-side)
- `pipeline.ts:127` `onPhase?.({ stage: 'extract', status: 'done', durationMs: ... })` → keep + add `count` per CONTEXT.md specifics
- `pipeline.ts:130-134` dedup phase callbacks → keep
- `pipeline.ts:138, 275` store phase callbacks → keep
- `pipeline.ts:221` `graphStore.addEntity(entity)` → **replace** with `await this.store.putEntity(entity, { provenance: opts.provenance })` per Phase 39 D-30 + Example 5 in RESEARCH.md line 632-635
- `pipeline.ts:227-238` `createDerivedFromEdges` / `recordPatternOccurrences` / `handleMetricEntities` / `handleSupersession` → **DROP** all four (RESEARCH.md Pitfall 7)
- `pipeline.ts:289-305` synthesis block → keep but swap to caller-supplied `synthesizer.synthesize(survivorIds, { provenance })` per Example 5 RESEARCH.md:647

**Per-entity candidate-pool sourcing** (D-46 — RESEARCH.md Example 5 lines 610-613):
```typescript
for (const entity of entities) {
  const ontologyClass = entity.ontologyClass ?? entity.entityType;
  const candidates = await this.store.findByOntologyClass(ontologyClass); // active-only per Phase 39 D-34
  const dedupResult = await this.deduplicator.dedup(entity, candidates);
  dedupDecisions.push({ entity, survivor: dedupResult.matched ? dedupResult.survivor : undefined });
}
```
Backed by `GraphKMStore.ts:556-570` (the `findByOntologyClass(cls, opts?: { includeSuperseded?: boolean })` signature — active-only default is the Phase 39 D-34 freebie).

**Store-stage supersession pattern** (RESEARCH.md Pitfall 2 + Example 5 lines 628-635):
```typescript
for (const { entity, survivor } of dedupDecisions) {
  if (survivor) {
    await this.store.putEntity(
      { ...entity, supersedes: survivor.id },
      { provenance: opts.provenance },
    ); // Phase 39 D-33 closes the predecessor atomically inside putEntity.
  } else {
    await this.store.putEntity(entity, { provenance: opts.provenance });
  }
  result.storedCount += 1;
}
```
**DO NOT** call `store.batch([...])` to roll your own closure — Phase 39's `putEntity` already handles it (`GraphKMStore.ts:413-476`, including CR-01's per-op `skipOntologyCheck` for legacy ids at lines 475-476).

**Stderr-diagnostic pattern** (mandatory per no-console-log; copy from `merge.ts:134-136`):
```typescript
process.stderr.write(
  `[km-core/pipeline] warning: ${msg}\n`,
);
```
**NEVER** `console.info`/`console.warn` — OKM source has these at `pipeline.ts:119, 124, 159, 269, 282`; all MUST become `process.stderr.write` in the km-core port (CONTEXT.md "no-console-log").

---

### `src/pipeline/types.ts` (model, public type surface)

**Primary analog:** `~/Agentic/km-core/src/store/types.ts` — same role (public type module for a `src/<dir>/` namespace).

**File header comment pattern** (copy structure from `src/store/types.ts:1-8`):
```typescript
// Pipeline-API public types (D-42 IngestPipelineOpts, D-43 IngestOpts + StageName,
// PhaseCallback + IngestResult ported from OKM pipeline.ts:28-68).
//
// All shapes are net-new to KM-Core. The shapes follow CONTEXT decisions
// D-42, D-43, D-46 plus the carry-forward CF-D14 options-object convention.

import type { Entity, ProvenanceStamp } from '../types/entity.js';
```

**Type-shape patterns**:
- `IngestPipelineOpts` — copy the **shape** from RESEARCH.md Example 5 lines 555-560.
- `IngestOpts` — copy from RESEARCH.md Example 5 lines 564-568 (`provenance` REQUIRED, `skipStages?` + `domain?` optional).
- `PhaseCallback` — port verbatim from OKM `pipeline.ts:64-68`, ADD `count?: number` per CONTEXT.md specifics line 139.
- `IngestResult` — port from OKM `pipeline.ts:51-61`, ADD `skippedStages: StageName[]` field per CONTEXT.md specifics line 140. **Field renames** (RESEARCH.md Q2 #9): drop OKM's `entityIds`, `errors`, `orphanNodeIds`, `confirmedCount`; rename `mergedCount` to keep; add `skippedCount`, `droppedCount`, `durations: { extractMs, dedupMs, storeMs, synthesizeMs }`.
- `StageName` — copy from RESEARCH.md Example 5 line 562: `export type StageName = 'extract' | 'dedup' | 'store' | 'synthesize';`
- `Extractor` interface — defined per researcher signature; mirrors OKM `EntityExtractor` (`extractor.ts`) but slim — caller-pluggable. Recommended: `extract(text: string, domain?: string): Promise<Entity[]>`.
- `Synthesizer` interface — `synthesize(survivorIds: EntityId[], opts: { provenance: ProvenanceStamp }): Promise<void>`. (Receives entity IDs not entities — synthesizer reads from store if needed.)

**JSDoc style** (copy from `src/store/types.ts:12-27` for `BatchOp` — header + per-field tag + CR-01-style cross-reference to CONTEXT decisions).

---

### `src/pipeline/index.ts` (config, sub-barrel)

**Primary analog:** `~/Agentic/km-core/src/segments/index.ts` (10 lines).

**Verbatim shape** (copy `src/segments/index.ts:1-11`, swap names):
```typescript
// Barrel re-exports for the `src/pipeline/` module (Phase 40, PIPE-01).
//
// Consumers needing the 4-stage pipeline framework in one import:
//   import { IngestPipeline } from '@fwornle/km-core/pipeline';
//   import type { IngestPipelineOpts, IngestOpts, IngestResult } from '@fwornle/km-core/pipeline';
//
// The sub-path `@fwornle/km-core/pipeline` is wired in package.json `exports`
// (mirrors Phase 38's `./ontology` sub-path precedent). Consumers may also
// reach these symbols through the root barrel (`@fwornle/km-core`) — both
// import paths resolve to the same module.

export { IngestPipeline } from './IngestPipeline.js';
export type {
  IngestPipelineOpts,
  IngestOpts,
  IngestResult,
  PhaseCallback,
  StageName,
  Extractor,
  Synthesizer,
} from './types.js';
```
**Note:** Phase 38 Plan 06's `package.json` `exports`-map addition (referenced in `src/ontology/index.ts:7`) is the precedent for adding `./pipeline` + `./dedup` sub-paths in the Phase 40 plan that modifies `package.json`.

---

### `src/dedup/LayeredDeduplicator.ts` (service, request-response orchestrator)

**Primary analog:** `~/Agentic/km-core/src/store/GraphKMStore.ts` — options-object ctor + class composition.
**Algorithm source:** OKM `deduplicator.ts` lines 53-322 (3-phase short-circuit).

**Verbatim Example 1 from RESEARCH.md lines 282-328** is the planning starting point. Key patterns:

**Imports pattern**:
```typescript
import type { Entity } from '../types/entity.js';
import type {
  ExactNameLayer,
  EmbeddingLayer,
  LLMSemanticLayer,
  DedupResult,
  MatchResult,
} from './types.js';
```

**Options-object ctor with `?? default`** (matches RESEARCH.md Example 1 lines 298-303 AND `GraphKMStore.ts` ctor pattern):
```typescript
constructor(opts: LayeredDeduplicatorOpts) {
  this.exactName = opts.exactName;
  this.embedding = opts.embedding;
  this.llmSemantic = opts.llmSemantic;
  this.shortCircuit = opts.shortCircuit ?? true;
}
```

**Short-circuit chain pattern** (RESEARCH.md Example 1 lines 305-327):
```typescript
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
  const winner = layerResults.find((r) => r.matched);
  return winner
    ? { matched: true, survivor: winner.survivor!, matchedLayer: winner.layer, confidence: winner.confidence, allLayerResults: layerResults }
    : { matched: false, allLayerResults: layerResults };
}
```

**Defensive `ontologyClass` undefined check** (RESEARCH.md Pitfall 1 — required):
```typescript
if (!entity.ontologyClass && !entity.entityType) {
  process.stderr.write(
    `[km-core/dedup] entity ${String(entity.id)} has no ontologyClass/entityType — skipping dedup\n`,
  );
  return { matched: false, allLayerResults: [] };
}
```
Pattern source: `merge.ts:134-136` (stderr-warn for soft-bound monitoring).

---

### `src/dedup/JaccardNameMatcher.ts` (service, pure transform)

**Primary analog:** `~/Agentic/km-core/src/segments/merge.ts` — pure function + small helper + per-class state minimization.
**Algorithm source:** `~/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts:436-445` (verbatim 9-line port).

**File header pattern** (copy structure from `merge.ts:1-31` — SOURCE comment + DELTAS + no-console-log note):
```typescript
// Phase 40 (DEDUP-01): JaccardNameMatcher — exact-name layer impl.
//
// SOURCE: lifted from B
//   integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts
//   lines 436-445 (calculateStringSimilarity)
// with 2 deltas applied:
//
//   1. Implements the ExactNameLayer interface (D-44) — match()
//      returns { matched, survivor?, confidence } instead of a bare number.
//
//   2. Threshold becomes a ctor opt (D-44 per-layer threshold convention)
//      with default 0.85 (matches B's similarityConfig.similarityThreshold).
//
// no-console-log: matcher emits no diagnostics; all logging stays at the
// caller (LayeredDeduplicator / IngestPipeline level).
```

**Verbatim algorithm port** (B's `deduplication.ts:436-445` → as private `jaccard()` helper per RESEARCH.md Example 2 lines 365-372):
```typescript
function jaccard(a: string, b: string): number {
  const words1 = new Set(a.toLowerCase().split(/\s+/));
  const words2 = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return union.size > 0 ? intersection.size / union.size : 0;
}
```

**Class shape** (RESEARCH.md Example 2 lines 343-363):
```typescript
export interface JaccardNameMatcherOpts {
  threshold?: number; // default 0.85
}

export class JaccardNameMatcher implements ExactNameLayer {
  readonly threshold: number;

  constructor(opts: JaccardNameMatcherOpts = {}) {
    this.threshold = opts.threshold ?? 0.85;
  }

  async match(entity: Entity, candidates: Entity[]): Promise<MatchResult> {
    let best: { candidate: Entity; score: number } | null = null;
    for (const candidate of candidates) {
      if (candidate.id === entity.id) continue;
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
```
**Purity contract:** mirror `merge.ts`'s "pure function, no I/O, no `this` state beyond ctor opts" idiom.

---

### `src/dedup/CosineEmbeddingMatcher.ts` (service, transform + injected client)

**Primary analog:** `~/Agentic/km-core/src/validation/ontology.ts` (`registryBackedValidator` — caller-injects a typed dependency) + `~/Agentic/km-core/src/segments/merge.ts` (pure-math neighbor).
**Algorithm source:** `~/Agentic/coding/scripts/dedup-insights-by-embedding.js:56-64` (cosine — 9 lines).

**Caller-injected client interface** (CONTEXT.md Pattern 2; RESEARCH.md Example 3 lines 383-388):
```typescript
export interface EmbeddingClient {
  embed(text: string): Promise<Float32Array | number[]>;
  // search() optional — Phase 41/42 add a fast-path overload.
}
```

**Class shape** (RESEARCH.md Example 3 lines 389-424):
```typescript
export interface CosineEmbeddingMatcherOpts {
  client: EmbeddingClient;
  threshold?: number; // default 0.90 — between A's insight-dedup 0.93 and insight-merge 0.88; tune per surface
  textOf?: (e: Entity) => string; // default: `${e.name}\n\n${e.description}`
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
```

**Verbatim cosine math port** (A's `dedup-insights-by-embedding.js:56-64`):
```typescript
function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
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
**Threshold-default JSDoc** (RESEARCH.md Pitfall 4 — required): document that 0.90 is a single-surface starting point; callers MUST tune per their embedding model + content type.

---

### `src/dedup/LLMSemanticMatcher.ts` (service, request-response + injected client)

**Primary analog:** `~/Agentic/km-core/src/validation/ontology.ts` (injected dependency).
**Algorithm source:** OKM `deduplicator.ts:421-475` (batchLLMDedup prompt + 5-stage JSON unwrap).

**Caller-injected LLMClient interface** (RESEARCH.md Example 4 lines 447-454):
```typescript
export interface LLMClient {
  complete(req: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    taskType?: string;
    responseFormat?: { type: 'json_object' };
    timeout?: number;
  }): Promise<{ content: string }>;
}
```

**Class shape** (RESEARCH.md Example 4 lines 456-508):
```typescript
export interface LLMSemanticMatcherOpts {
  client: LLMClient;
  threshold?: number;       // default 0.70
  timeoutMs?: number;       // default 60_000
  taskType?: string;        // default 'deduplication_matching'
  onError?: 'skip' | 'throw'; // default 'skip'
}

export class LLMSemanticMatcher implements LLMSemanticLayer {
  readonly threshold: number;
  private client: LLMClient;
  private timeoutMs: number;
  private taskType: string;
  private onError: 'skip' | 'throw';
  // ... ctor + match() per RESEARCH.md Example 4 ...
}
```

**Prompt port** — verbatim from OKM `deduplicator.ts:430-444` (RESEARCH.md Example 4 lines 510-523).

**Defensive JSON-unwrap port** — verbatim from OKM `deduplicator.ts:451-472` into `parseDedupResponse()` helper (RESEARCH.md Example 4 lines 526-542). This is the load-bearing 5-stage unwrap: anchored fence → unanchored fence → bare-brace extraction → JSON.parse.

**Error pattern** — `try/catch` with `onError === 'skip'` default + stderr-warn (RESEARCH.md Example 4 lines 502-506):
```typescript
} catch (err) {
  if (this.onError === 'throw') throw err;
  process.stderr.write(
    `[km-core/dedup/llm] match error for "${entity.name}" — skipping: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  return { matched: false, confidence: 0 };
}
```
Stderr pattern source: `merge.ts:134-136`; mirrors OKM's tolerant `try/catch + errors[]` collection.

---

### `src/dedup/types.ts` (model, public type surface)

**Primary analog:** `~/Agentic/km-core/src/store/types.ts` — public-type module per `src/<dir>/types.ts` convention.

**Header comment** (mirror `src/store/types.ts:1-8`):
```typescript
// Dedup-API public types (D-44 three layer interfaces + DedupResult).
//
// All shapes are net-new to KM-Core. The interfaces enforce the D-44
// short-circuit contract: each layer exposes a typed `threshold` plus
// async `match(entity, candidates) => MatchResult`. Layers are independent
// types so per-layer mocking in tests is type-safe.

import type { Entity } from '../types/entity.js';
```

**Three layer interfaces** (D-44 contract — separate names, separate methods):
```typescript
export interface ExactNameLayer {
  readonly threshold: number;
  match(entity: Entity, candidates: Entity[]): Promise<MatchResult>;
}
export interface EmbeddingLayer {
  readonly threshold: number;
  match(entity: Entity, candidates: Entity[]): Promise<MatchResult>;
}
export interface LLMSemanticLayer {
  readonly threshold: number;
  match(entity: Entity, candidates: Entity[]): Promise<MatchResult>;
}
```

**Result types**:
```typescript
export interface MatchResult {
  matched: boolean;
  survivor?: Entity;
  confidence: number;
}

export interface DedupResult {
  matched: boolean;
  survivor?: Entity;
  matchedLayer?: 'exactName' | 'embedding' | 'llmSemantic';
  confidence?: number;
  allLayerResults: Array<{
    layer: string;
    matched: boolean;
    survivor?: Entity;
    confidence: number;
  }>;
}
```

**Client interfaces re-exported here** (Phase 41/42 consumers import from `@fwornle/km-core/dedup`):
```typescript
export type { EmbeddingClient } from './CosineEmbeddingMatcher.js';
export type { LLMClient } from './LLMSemanticMatcher.js';
```

---

### `src/dedup/index.ts` (config, sub-barrel)

**Primary analog:** `~/Agentic/km-core/src/segments/index.ts` (verbatim shape with name swaps).

```typescript
// Barrel re-exports for the `src/dedup/` module (Phase 40, DEDUP-01).
//
// Consumers needing the layered dedup framework in one import:
//   import { LayeredDeduplicator, JaccardNameMatcher,
//            CosineEmbeddingMatcher, LLMSemanticMatcher } from '@fwornle/km-core/dedup';
//   import type { ExactNameLayer, EmbeddingLayer, LLMSemanticLayer,
//                 EmbeddingClient, LLMClient } from '@fwornle/km-core/dedup';

export { LayeredDeduplicator } from './LayeredDeduplicator.js';
export { JaccardNameMatcher } from './JaccardNameMatcher.js';
export { CosineEmbeddingMatcher } from './CosineEmbeddingMatcher.js';
export { LLMSemanticMatcher } from './LLMSemanticMatcher.js';
export type {
  ExactNameLayer,
  EmbeddingLayer,
  LLMSemanticLayer,
  MatchResult,
  DedupResult,
  EmbeddingClient,
  LLMClient,
} from './types.js';
```

---

### `src/index.ts` (modified — append-only root barrel)

**Primary analog:** `src/index.ts` lines 70-89 (the Phase 39 append block — exact precedent for Phase 40's tail append).

**Pattern:** Append AFTER Phase 39's `backfillEntityDataModel` exports (the file's current last block at lines 84-89). DO NOT touch any prior lines.

**Append-block structure** (copy comment style from `src/index.ts:71-76`):
```typescript
// Phase 40 (PIPE-01 + DEDUP-01): 4-stage ingest framework + layered
// deduplication primitives. Caller-pluggable Extractor / Synthesizer /
// EmbeddingClient / LLMClient interfaces — A and B (Phase 41/42) wire
// their own concrete clients. Per-layer thresholds on the layer ctors;
// short-circuit-on-first-match per D-44. Pipeline threads ProvenanceStamp
// through all 4 stages; the store stage uses Phase 39 putEntity which
// handles supersession closure atomically (CR-01 widening covers legacy
// non-v7 predecessor ids).
export { IngestPipeline } from './pipeline/IngestPipeline.js';
export type {
  IngestPipelineOpts,
  IngestOpts,
  IngestResult,
  PhaseCallback,
  StageName,
  Extractor,
  Synthesizer,
} from './pipeline/types.js';

export { LayeredDeduplicator } from './dedup/LayeredDeduplicator.js';
export { JaccardNameMatcher } from './dedup/JaccardNameMatcher.js';
export { CosineEmbeddingMatcher } from './dedup/CosineEmbeddingMatcher.js';
export { LLMSemanticMatcher } from './dedup/LLMSemanticMatcher.js';
export type {
  ExactNameLayer,
  EmbeddingLayer,
  LLMSemanticLayer,
  MatchResult,
  DedupResult,
  EmbeddingClient,
  LLMClient,
} from './dedup/types.js';
```

---

### `tests/unit/pipeline.test.ts` (test, request-response)

**Primary analog:** `~/Agentic/km-core/tests/unit/graph-store.test.ts` — store-lifecycle test pattern.

**Imports + Ctx + makeStore pattern** (copy from `graph-store.test.ts:8-58`):
```typescript
import {
  describe, test, expect, beforeEach, afterEach, vi,
} from 'vitest';
import {
  GraphKMStore, IngestPipeline, LayeredDeduplicator,
  type ProvenanceStamp, type IngestResult, type StageName,
} from '../../src/index.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { makeFakeExtractor, makeFakeSynthesizer, makeFakePipelineFixture } from './_helpers/fakes.js';

const PROV: ProvenanceStamp = {
  provider: 'test',
  model: 'test-model',
  runId: 'pipeline-test',
  timestamp: '2026-05-21T00:00:00.000Z',
};

type Ctx = { store: GraphKMStore; tmpdir: string; pipeline: IngestPipeline };

function makeFixture(): Ctx {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-core-pipeline-'));
  const store = new GraphKMStore({
    dbPath: path.join(tmpdir, 'leveldb'),
    exportDir: path.join(tmpdir, 'exports'),
    debounceMs: 0,
  });
  const pipeline = new IngestPipeline(store, { /* fakes from _helpers */ });
  return { store, tmpdir, pipeline };
}
```

**Lifecycle pattern** (copy from `graph-store.test.ts:60-71`):
```typescript
describe('IngestPipeline', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = makeFixture(); await ctx.store.open(); });
  afterEach(async () => { await ctx.store.close(); fs.rmSync(ctx.tmpdir, { recursive: true, force: true }); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('ingest runs 4 stages in order: extract → dedup → store → synthesize', async () => { /* ... */ });
  test('skipStages: ["synthesize"] runs the other 3 and returns IngestResult.skippedStages = ["synthesize"]', async () => { /* ... */ });
  test('onPhase callback fires for every executed stage with start + done events', async () => { /* ... */ });
  test('skipStages: ["extract"] with non-empty text throws (RESEARCH.md Pitfall 5)', async () => { /* ... */ });
  // ...
});
```

**Stderr-spy pattern** (copy from `segments-merge.test.ts:10-12` + `ontology-registry.test.ts:31` — `vi.spyOn(process.stderr, 'write')`):
```typescript
const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
// ... exercise code that emits stderr-warn ...
expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[km-core/pipeline]'));
```

---

### `tests/unit/layered-dedup.test.ts` (test, request-response)

**Primary analog:** `~/Agentic/km-core/tests/unit/segments-merge.test.ts` — pure-function test pattern with builder helpers.

**Builder-helper pattern** (copy from `segments-merge.test.ts:20-51`):
```typescript
function mkEntity(overrides?: Partial<Entity>): Entity {
  return {
    id: '0192a000-0000-7000-8000-000000000000' as EntityId,
    name: 'TestEntity',
    entityType: 'Component',
    ontologyClass: 'Component',
    layer: 'evidence',
    description: '',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

function mkLayerStub(opts: {
  threshold?: number;
  willMatch?: boolean;
  survivor?: Entity;
  confidence?: number;
}): ExactNameLayer {
  return {
    threshold: opts.threshold ?? 0.9,
    match: vi.fn(async () => opts.willMatch
      ? { matched: true, survivor: opts.survivor!, confidence: opts.confidence ?? 0.95 }
      : { matched: false, confidence: 0 }),
  };
}
```

**Critical test names** (D-44 contracts):
- `'short-circuits on first matched layer when shortCircuit: true (default)'`
- `'shortCircuit: false runs all layers even after match'`
- `'omitted layer slots are skipped'`
- `'runs layers in declared order: exactName → embedding → llmSemantic'`
- `'returns allLayerResults populated even when matched'`
- `'returns matched: false when no layer matches above threshold'`

---

### `tests/unit/jaccard-matcher.test.ts` (test, transform)

**Primary analog:** `~/Agentic/km-core/tests/unit/segments-merge.test.ts` — pure-function test pattern (no store, no I/O).

**Test cases** (B's algorithm + D-44 layer contract):
- `'exact match returns confidence 1.0'`
- `'no shared words returns confidence 0'`
- `'mixed case is normalized (case-insensitive)'`
- `'threshold default 0.85 — confidence 0.84 returns matched: false'`
- `'threshold opt overrides default'`
- `'never matches against entity.id === candidate.id (self-match)'`
- `'picks best candidate when multiple exceed threshold'`

---

### `tests/unit/cosine-matcher.test.ts` (test, transform with stub client)

**Primary analog:** `~/Agentic/km-core/tests/unit/graph-store.test.ts` (interface stub pattern at lines 28-30) + `tests/unit/segments-merge.test.ts` (builder helpers).

**FakeEmbeddingClient pattern** (copy `graph-store.test.ts:28-30` interface-stub idiom):
```typescript
function makeFakeEmbeddingClient(opts?: {
  embeddings?: Map<string, number[]>;
  defaultDim?: number;
}): EmbeddingClient {
  return {
    embed: vi.fn(async (text: string) => {
      if (opts?.embeddings?.has(text)) return opts.embeddings.get(text)!;
      // Deterministic stub: hash text to a fixed-length vector
      return new Array(opts?.defaultDim ?? 384).fill(0).map((_, i) => Math.sin(i * text.length));
    }),
  };
}
```

**Test cases**:
- `'returns matched: false when candidates is empty'`
- `'cosine 1.0 for identical embeddings → matched with confidence 1.0'`
- `'cosine below threshold returns matched: false'`
- `'threshold default 0.90 — score 0.89 returns no-match'`
- `'never matches entity.id === candidate.id (self)'`
- `'picks best candidate when multiple exceed threshold'`
- `'textOf opt overrides default name+description concatenation'`

---

### `tests/unit/llm-matcher.test.ts` (test, request-response with mocked LLM)

**Primary analog:** `~/Agentic/km-core/tests/unit/graph-store.test.ts` (`OntologyValidatorStub` interface stub at lines 28-30) + `~/Agentic/km-core/tests/unit/backfill.test.ts` (resolver-as-function injection lines 61-64).

**MockLLMClient pattern**:
```typescript
function makeMockLLMClient(opts: {
  matches?: Array<{ newName: string; existingName: string }>;
  raw?: string;            // override JSON; useful for unwrap tests
  throwError?: Error;
}): LLMClient {
  return {
    complete: vi.fn(async () => {
      if (opts.throwError) throw opts.throwError;
      const payload = opts.raw ?? JSON.stringify({ matches: opts.matches ?? [] });
      return { content: payload };
    }),
  };
}
```

**Test cases** (cover OKM's 5-stage JSON-unwrap):
- `'returns matched: false when candidates is empty'`
- `'parses bare JSON response'`
- `'unwraps anchored markdown fence ```json\\n{...}\\n``` '`
- `'unwraps unanchored markdown fence (fence in middle of response)'`
- `'extracts bare braces from prose-wrapped response'`
- `'onError: skip (default) — returns no-match + stderr warn on LLM throw'`
- `'onError: throw — re-throws caller-side'`
- `'threshold defaults to 0.70'`
- `'sends correct system + user prompt with ontologyClass + existing names'`

---

### `tests/integration/pipeline-supersession.test.ts` (test, end-to-end)

**Primary analog:** `~/Agentic/km-core/tests/integration/round-trip.test.ts` — real `GraphKMStore` instance, real graph state, full-lifecycle.

**Pattern** (header comment + `path.resolve` security + `GraphKMStore` lifecycle from `round-trip.test.ts:1-30`):
```typescript
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { GraphKMStore, IngestPipeline, LayeredDeduplicator, JaccardNameMatcher,
         type ProvenanceStamp } from '../../src/index.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ... full store + pipeline lifecycle ...
```

**Tests** (verify Phase 39 + Phase 40 integration):
- `'dedup match + non-zero supersedes → predecessor closed atomically (Phase 39 D-33 verified)'`
- `'dedup match against legacy non-v7 id predecessor — CR-01 skipOntologyCheck path works (RESEARCH.md Pitfall 2)'`
- `'no-dedup-match → entity stored as net-new with provenance stamped'`
- `'getSupersessionChain returns predecessor + successor in validFrom order'`

---

### `tests/integration/pipeline-candidate-pool.test.ts` (test, end-to-end)

**Primary analog:** `tests/integration/round-trip.test.ts`.

**Tests** (verify D-46):
- `'candidate pool scoped by ontologyClass — entities of different classes are not compared'`
- `'candidate pool excludes superseded predecessors by default (Phase 39 D-34 inherited)'`
- `'entity with undefined ontologyClass falls back to entityType for pool lookup'`
- `'empty candidate pool — layers receive empty array, dedup short-circuits to no-match'`

---

### `tests/unit/_helpers/fakes.ts` (test fixture/fake)

**Primary analog:** No existing `_helpers/` directory — but `tests/unit/graph-store.test.ts:28-30` (interface-stub pattern) and `tests/unit/backfill.test.ts:61-64` (typed-function fake) are the precedents to consolidate.

**Pattern:** A single barrel of fakes used by all 5+ new test files. Each fake is a `make*()` factory returning a typed object that satisfies the interface in `src/pipeline/types.ts` or `src/dedup/types.ts`.

**Exports**:
```typescript
// Fakes for Phase 40 pipeline + dedup tests.
import { vi } from 'vitest';
import type { Entity, EntityId } from '../../../src/index.js';
import type { Extractor, Synthesizer } from '../../../src/index.js';
import type {
  ExactNameLayer, EmbeddingLayer, LLMSemanticLayer,
  EmbeddingClient, LLMClient,
} from '../../../src/index.js';

export function makeFakeExtractor(entities: Entity[]): Extractor { /* ... */ }
export function makeFakeSynthesizer(): Synthesizer { /* ... */ }
export function makeFakeEmbeddingClient(opts?: { /* ... */ }): EmbeddingClient { /* ... */ }
export function makeMockLLMClient(opts: { /* ... */ }): LLMClient { /* ... */ }
export function makeLayerStub<T extends { threshold: number; match: Function }>(opts: { /* ... */ }): T { /* ... */ }
export function mkEntity(overrides?: Partial<Entity>): Entity { /* mirror segments-merge.test.ts:20-32 */ }
```
**Note for planner:** Since no prior `_helpers/` dir exists, the plan that creates `fakes.ts` is also creating the convention. Pick `_helpers/` (leading underscore = "not a test file"; vitest will skip it from test runs by default because the filename has no `.test.` substring).

---

## Shared Patterns

### Pattern A: Options-Object Ctor (CF-D14, D-42, D-44)

**Source:** `~/Agentic/km-core/src/store/GraphKMStore.ts:325-328` (the canonical `putEntity` opts) + ctor at `GraphKMStore.ts:136` taking `GraphKMStoreOptions` (interface at lines 90-122).

**Apply to:** Every public class ctor and method in Phase 40 (`IngestPipeline`, `LayeredDeduplicator`, `JaccardNameMatcher`, `CosineEmbeddingMatcher`, `LLMSemanticMatcher`, plus their `match()` / `ingest()` / `runStage()` methods).

**Pattern excerpt** (from `GraphKMStore.ts:325-328`):
```typescript
async putEntity(
  e: Partial<Entity> & { name: string; entityType: string },
  opts?: PutEntityOpts,
): Promise<EntityId> { /* ... */ }
```
Phase 40 mirrors: primary subject positional, everything else in `opts`. `opts.foo ?? default` for defaults.

---

### Pattern B: ESM `.js` Suffix on All Relative Imports (CF-D06)

**Source:** Every `.ts` file in `~/Agentic/km-core/src/`. Verified at `merge.ts:33-37`, `GraphKMStore.ts:80-83`, `backfill/index.ts:42-52`.

**Apply to:** All new Phase 40 files. NO exceptions. Example:
```typescript
import type { Entity } from '../types/entity.js';       // ✓ relative with .js
import type { LLMService } from '@rapid/llm-proxy';     // ✗ NEVER — third-party deps
import type { ExactNameLayer } from './types.js';       // ✓ relative with .js
```

---

### Pattern C: `process.stderr.write` for ALL Diagnostics (no-console-log)

**Source:** `~/Agentic/km-core/src/segments/merge.ts:134-136` + `:150-152`. Also `~/Agentic/km-core/src/store/exporter.ts:112` (cited as the project-wide idiom in `merge.ts:31`).

**Apply to:** Every diagnostic emission in pipeline + dedup code. **NEVER** `console.log` / `console.info` / `console.warn`.

**Pattern excerpt** (from `merge.ts:134-137`):
```typescript
process.stderr.write(
  `[km-core/segments] entity ${String(entity.id)} segment ${String(matchIndex)} has ${String(match.confirmations.length)} confirmations (>${String(MAX_CONFIRMATIONS_WARN)}, monitoring per D-41)\n`,
);
```
**Prefix convention:** `[km-core/<module>] <message>`. Phase 40 prefixes: `[km-core/pipeline]`, `[km-core/dedup]`, `[km-core/dedup/llm]`.

**OKM source has 6 violations to remove during port** (RESEARCH.md "Anti-Patterns"):
- `pipeline.ts:119` `console.info(...)` → `process.stderr.write(...)`
- `pipeline.ts:124` same
- `pipeline.ts:159, 269, 282` same
- `deduplicator.ts:183, 214, 525, 547` same (only :183 + :214 are in the LLM-semantic port window)

**Test-side spy pattern** (`segments-merge.test.ts:10-12`):
```typescript
const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
// ... exercise ...
expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[km-core/pipeline]'));
```

---

### Pattern D: Writer-Side Provenance Stamping via `store.putEntity` (CF-D30)

**Source:** `~/Agentic/km-core/src/store/GraphKMStore.ts:325-411` (the full Phase 39 D-30/31/32 stamping path) — pipeline NEVER constructs a `ProvenanceStamp`; it only THREADS the caller-supplied one.

**Apply to:** Pipeline store stage + all writer paths.

**Pattern excerpt** (correct usage from `GraphKMStore.ts:325-341`):
```typescript
// pipeline.ingest body:
await this.store.putEntity(entity, { provenance: opts.provenance });

// Store internally stamps validFrom/createdAt/updatedAt and assembles
// EntityProvenance — pipeline never touches `new Date()` for these.
```
**Anti-pattern (FORBIDDEN):**
```typescript
await this.store.putEntity({
  ...entity,
  validFrom: new Date().toISOString(),       // ✗ NEVER
  metadata: { provenance: { ...stamp } },    // ✗ NEVER
}, { /* ... */ });
```

---

### Pattern E: Atomic Supersession via `store.putEntity` (CF-D17 + CR-01)

**Source:** `~/Agentic/km-core/src/store/GraphKMStore.ts:413-476` (D-33 supersession closure, including the CR-01 per-op `skipOntologyCheck: true` flags at lines 475-476).

**Apply to:** Pipeline store stage when dedup returns a match.

**Pattern excerpt** (correct — RESEARCH.md Example 5 lines 628-635):
```typescript
if (survivor) {
  await this.store.putEntity(
    { ...entity, supersedes: survivor.id },
    { provenance: opts.provenance },
  );
}
```
**Anti-pattern (FORBIDDEN — RESEARCH.md Pitfall 2):**
```typescript
// ✗ NEVER — bypasses Phase 39's atomic closure + CR-01 per-op flags
await this.store.batch([
  { type: 'putEntity', entity: closedSurvivor },
  { type: 'putEntity', entity: newEntity },
]);
```
Rolling your own supersession `batch()` call drops the `skipOntologyCheck` per-op flag and breaks dedup against legacy nanoid / `layer:uuid` predecessors.

---

### Pattern F: SOURCE-Comment Header on Ported Files

**Source:** `~/Agentic/km-core/src/segments/merge.ts:1-31` (the canonical port-header style, used for the OKM `mergeDescriptionSegment` port).

**Apply to:** All 4 algorithm-port files: `IngestPipeline.ts`, `JaccardNameMatcher.ts`, `CosineEmbeddingMatcher.ts`, `LLMSemanticMatcher.ts`.

**Pattern excerpt** (from `merge.ts:1-31`):
```typescript
// Phase 40 (PIPE-01): IngestPipeline — 4-stage ingest framework.
//
// SOURCE: lifted from OKM
//   _work/rapid-automations/integrations/operational-knowledge-management/
//   src/ingestion/pipeline.ts (lines 76-316)
// with N deltas applied (per 40-PATTERNS §"src/pipeline/IngestPipeline.ts"):
//
//   1. D-42 options-object ctor replaces OKM's 4-positional-args.
//   2. D-43 skipStages opt-out added to ingest() signature.
//   3. D-46 candidate-pool sourcing — pipeline pre-loads candidates via
//      store.findByOntologyClass(entity.ontologyClass) before each
//      dedup() call.
//   4. ... (per-file deltas)
//
// no-console-log: ALL diagnostics use process.stderr.write (the 6 OKM
// console.info/warn calls at pipeline.ts:119, 124, 159, 269, 282 are
// removed; pipeline-stage observability is via the onPhase callback).
```

---

### Pattern G: Sub-Barrel + Sub-Path Export (`./pipeline`, `./dedup`)

**Source:** `~/Agentic/km-core/src/ontology/index.ts:1-21` (Phase 38's precedent — `./ontology` sub-path was added to `package.json` `exports` per `index.ts:7` reference to "added in this plan per 38-PLAN-CHECK FLAG-1 option (a)").

**Apply to:** Phase 40's `src/pipeline/index.ts` + `src/dedup/index.ts` plus the `package.json` modification adding two new sub-path entries to `exports`.

**Pattern excerpt** (from `src/ontology/index.ts:1-21`): see file in full — the entire 20-line file IS the template.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every new Phase 40 file maps cleanly to at least one existing analog in km-core (Phases 37/38/39 established the relevant module-shape conventions: composition classes, options-object ctors, public-type modules, sub-barrels, pure-function helpers, integration tests, unit-test builder-helpers). |

---

## Metadata

**Analog search scope:**
- `~/Agentic/km-core/src/**` — full src tree (9 directories: `backfill/`, `events/`, `ids/`, `ontology/`, `segments/`, `store/`, `types/`, `validation/`)
- `~/Agentic/km-core/tests/unit/**` — 8 existing test files
- `~/Agentic/km-core/tests/integration/**` — 1 existing integration test
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/` — OKM source-of-truth (`pipeline.ts`, `deduplicator.ts`, `extractor.ts`)
- `~/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts` — B's Jaccard
- `~/Agentic/coding/scripts/dedup-insights-by-embedding.js` — A's cosine + clustering

**Files scanned:** 17 files read in full or in targeted ranges; ~3,800 LOC across km-core + OKM + B + A sources.

**Key analog files (most heavily referenced):**
1. `~/Agentic/km-core/src/store/GraphKMStore.ts` — composition-class + options-object ctor + EventEmitter + per-method JSDoc + Phase 39 putEntity contract
2. `~/Agentic/km-core/src/segments/merge.ts` — pure-function helper + SOURCE-comment header + stderr-warn + per-PATTERNS-doc structure
3. `~/Agentic/km-core/src/store/types.ts` — public-type module convention
4. `~/Agentic/km-core/src/ontology/index.ts` + `src/segments/index.ts` — sub-barrel + sub-path-export template
5. `~/Agentic/km-core/src/index.ts` — root barrel append-only convention (Phase 39 block at lines 70-89)
6. `~/Agentic/km-core/tests/unit/graph-store.test.ts` — `Ctx` + `makeStore` + lifecycle + interface-stub
7. `~/Agentic/km-core/tests/unit/segments-merge.test.ts` — `mkEntity` + `mkSegment` builder helpers + `vi.spyOn(process.stderr, 'write')` pattern
8. `~/Agentic/km-core/tests/integration/round-trip.test.ts` — end-to-end test pattern with `path.resolve` security

**Pattern extraction date:** 2026-05-21
