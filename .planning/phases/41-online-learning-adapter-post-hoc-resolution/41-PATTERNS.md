# Phase 41: Online Learning Adapter & Post-Hoc Resolution — Pattern Map

**Mapped:** 2026-05-22
**Files analyzed:** 11 new + 2 modified
**Analogs found:** 13 / 13 (all targets matched with strong analogs)

## Scope

Phase 41 ships two cooperating deliverables in `~/Agentic/km-core/`:

1. **INT-01** — Read-only online-learning adapter under `src/adapters/online/` that maps A's SQLite/JSON rows → KM-Core `Entity` instances, plus a library-function `reprojectFromOnlineStore(store, opts)` that mirrors Phase 39's `backfillEntityDataModel` shape.
2. **PIPE-02** — Maintenance ops under `src/maintenance/` exposing top-level `resolveEntities(store, opts)` and `mergeEntities(store, survivorId, duplicateIds, opts)`. Ports OKM `deduplicator.ts:620-720` algorithm into KM-Core.

Plus ontology JSON files, package.json `./maintenance` sub-path export, an `index.ts` barrel append, a `coding/scripts/reproject-online.mjs` per-system migration script, and unit + integration tests.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `km-core/src/adapters/online/index.ts` (NEW) | adapter (barrel) | request-response | `km-core/src/dedup/index.ts` | exact (sub-path barrel) |
| `km-core/src/adapters/online/reader.ts` or `mapper.ts` (NEW) | adapter (mapper) | transform | `coding/src/live-logging/ColdStoreReader.js` (row shape) + `km-core/src/segments/merge.ts` (pure-function shape) | role-match |
| `km-core/src/adapters/online/reprojectFromOnlineStore.ts` (NEW) | library function | batch / streaming | `km-core/src/backfill/index.ts` (`backfillEntityDataModel`) | exact (D-36 precedent) |
| `km-core/src/adapters/online/checkpoint.ts` (NEW, optional) | utility (atomic file I/O) | file-I/O | `km-core/src/backfill/checkpoint.ts` | exact (lift verbatim with rename) |
| `km-core/src/maintenance/index.ts` (NEW) | service (barrel) | request-response | `km-core/src/dedup/index.ts` | exact (sub-path barrel) |
| `km-core/src/maintenance/resolveEntities.ts` (NEW) | service / library function | batch + LLM request-response | OKM `deduplicator.ts:620-720` (`resolveEntities`) + Phase 39 `backfillEntityDataModel` (library-fn shape) | exact (port) |
| `km-core/src/maintenance/mergeEntities.ts` (NEW) | service / library function | batch (atomic multi-write) | `GraphKMStore.putEntity` D-33 supersession closure (`src/store/GraphKMStore.ts:422-484`) + `mergeDescriptionSegment` (`src/segments/merge.ts`) + OKM `migrateEdges` (`deduplicator.ts:910-933`) | hybrid (compose 3 analogs into atomic primitive) |
| `km-core/ontology/learning-artifacts-upper.json` (NEW) | config (ontology) | n/a | `km-core/tests/fixtures/ontology/upper.json` | exact (same `meta` + `classes` schema) |
| `km-core/ontology/learning-artifacts-lower.json` (NEW) | config (ontology) | n/a | `km-core/tests/fixtures/ontology/raas.json` (uses `extends`) | exact |
| `km-core/src/index.ts` (MODIFY) | barrel export | n/a | self (append after Phase 40 block, lines 91-123) | self |
| `km-core/package.json` (MODIFY) | config (exports map) | n/a | self lines 7-24 (`./dedup` precedent, Plan 40-07) | self |
| `coding/scripts/reproject-online.mjs` (NEW) | per-system migration script | batch / file-I/O | `coding/scripts/backfill-raw-observations.mjs` (mjs shape + arg parsing) | role-match |
| `km-core/tests/unit/maintenance/resolveEntities.spec.ts` (NEW) | test | request-response | `km-core/tests/unit/llm-matcher.test.ts` (mock LLMClient) + `km-core/tests/unit/segments-merge.test.ts` (mkEntity helper) | role-match |
| `km-core/tests/unit/maintenance/mergeEntities.spec.ts` (NEW) | test | request-response | `km-core/tests/unit/backfill.test.ts` (real GraphKMStore + tmpdir fixture) | exact (same store-backed shape) |
| `km-core/tests/unit/adapters/online-mapper.spec.ts` (NEW) | test | transform | `km-core/tests/unit/segments-merge.test.ts` (pure-function shape) | exact |
| `km-core/tests/integration/reproject-resolve-merge.test.ts` (NEW) | integration test | end-to-end | `km-core/tests/integration/pipeline-supersession.test.ts` (real store + tmpdir + supersession assertions) | exact |

## Pattern Assignments

### `km-core/src/adapters/online/reprojectFromOnlineStore.ts` (library function, batch)

**Primary analog:** `km-core/src/backfill/index.ts` (D-36 library-function pattern).

**Imports pattern** (lines 41-52, backfill/index.ts):
```typescript
import * as path from 'node:path';
import type {
  Entity,
  ProvenanceStamp,
  EntityProvenance,
} from '../types/entity.js';
import type { GraphKMStore } from '../store/GraphKMStore.js';
import {
  writeCheckpointAtomic,
  readCheckpoint,
  type Checkpoint,
} from './checkpoint.js';
```

**Resolver / Options-bag pattern** (lines 67-92, backfill/index.ts):
```typescript
export interface BackfillResolver {
  (entity: Entity): {
    validFrom: string;
    legacyId?: { system: 'A' | 'B' | 'C'; id: string };
  };
}

export interface BackfillOptions {
  resolver: BackfillResolver;
  legacyProvenance: ProvenanceStamp;
  checkpointPath?: string; // default '.data/backfill-checkpoint.json'
  dryRun?: boolean; // default false
}
```

**Path-traversal guard** (lines 130-138, backfill/index.ts):
```typescript
function resolveCheckpointPath(cp?: string): string {
  const raw = cp ?? DEFAULT_CHECKPOINT_PATH;
  if (raw.split(path.sep).includes('..') || raw.split('/').includes('..')) {
    throw new Error(
      `backfillEntityDataModel: checkpointPath must not contain '..' segments: ${raw}`,
    );
  }
  return path.resolve(raw);
}
```

**Per-row write + atomic checkpoint loop** (lines 187-258, backfill/index.ts):
```typescript
for await (const entity of store.iterate({}, { includeSuperseded: true })) {
  scanned += 1;
  // ... resume-cursor + idempotency skips ...
  if (dryRun) {
    process.stderr.write(`[km-core/backfill] dry-run: would stamp entity ${...}\n`);
    continue;
  }
  // Pre-stamp synthetic EntityProvenance + validFrom + legacyId
  const stampedEntity: Entity = { ...entity, validFrom: resolved.validFrom, legacyId: ..., metadata: { ..., provenance: syntheticProv } };
  await store.putEntity(stampedEntity, { skipOntologyCheck: true });
  stamped += 1;
  lastStampedId = String(entity.id);
  const cp: Checkpoint = { version: 1, runId: ..., lastStampedId, scanned, stamped, skipped, updatedAt: ... };
  await writeCheckpointAtomic(checkpointPath, cp);
}
```

**What to keep:**
- Options-object signature (`store, options`) per CF-D14.
- Top-level free function — **no** `ReprojectionService` class (D-36).
- `legacyProvenance: ProvenanceStamp` required field (operator supplies — reprojected entities have no native provenance).
- `dryRun: true` writes nothing + writes no checkpoint.
- `{ skipOntologyCheck: true }` trusted path on `putEntity` because adapter pre-stamps `EntityProvenance` (the strict path's D-30 throw is what makes pre-stamping mandatory on this path).
- Path-traversal guard on `checkpointPath` (T-39-04-01 mitigation).
- `process.stderr.write` for diagnostics (no `console.*`).
- Per-row write + atomic checkpoint after each write (T-39-04-04 memory bound).
- Resume cursor + idempotency double-guard (`lastStampedId` + `legacyId`-based lookup).

**What to adapt:**
- **Read direction** flips: backfill iterates the store and writes back; reproject reads from A's SQLite/JSON exports and writes into the store. Iteration loop becomes `for (const row of source.readObservations(...))` (similar for digests/insights), where `source` is a `ColdStoreReader` instance or a direct JSON parse of `.data/observation-export/{observations,digests,insights}.json`.
- **Idempotency** key changes: backfill uses `entity.validFrom !== undefined`; reproject uses `metadata.legacyId.id === <sqlite-id>` lookup (per CF-D37). If an entity with the matching `legacyId` already exists in the store, **skip** (idempotency).
- **No supersession concern** on the reproject path — these are fresh net-new entities. If the operator re-runs and source data shifted, the legacyId lookup catches the existing entity and skips; field-level reconciliation is **deferred** (out of scope per CONTEXT.md).
- **Options bag changes:** `{ sources?: { sqlite?: string; jsonExports?: string }; dryRun?: boolean; checkpointPath?: string; chunkSize?: number; legacyProvenance: ProvenanceStamp; onProgress?: (e) => void }` per CONTEXT.md `<specifics>`.
- **Aggregation edges** (Digest → Observation, Insight → Digest) — emit via `store.addRelation({ type: 'aggregates', from: digestId, to: observationId })`. Predicate names are planner's discretion; OKM uses verbs like `MATCHES`/`AFFECTS` (verbatim from `tests/fixtures/ontology/upper.json:13-16`); pick from `aggregates` / `derivedFrom` / `summarizes` per CONTEXT.md.
- **Result shape** is reprojection-specific (count of {observations, digests, insights} reprojected, count of edges written) — extend the `BackfillResult` pattern.

---

### `km-core/src/adapters/online/checkpoint.ts` (utility, file-I/O) — OPTIONAL

**Primary analog:** `km-core/src/backfill/checkpoint.ts` (lift VERBATIM).

**What to keep:**
- Atomic temp-file + rename idiom (`${path}.tmp.${pid}.${ts}` in the SAME directory, then `fs.promises.rename` — POSIX-atomic guarantee).
- `mkdirSync({ recursive: true })` so default `.data/` paths work first-run.
- WR-03 version-mismatch guard on `readCheckpoint`.
- `null` return on ENOENT (= "no prior state — start fresh").

**What to adapt:**
- **Optional file at all:** the planner may decide to either lift `checkpoint.ts` into the adapter module OR factor out a shared `src/utils/checkpoint.ts` that both `backfill/` and `adapters/online/` import. CONTEXT.md leaves this to Claude's discretion.
- If lifted, rename `Checkpoint.lastStampedId` to something neutral (`lastProcessedSourceId`) — the field is no longer about stamping but about source-row cursor position.

---

### `km-core/src/adapters/online/index.ts` (barrel) and `*.ts` mapper module

**Primary analog (barrel):** `km-core/src/dedup/index.ts` (lines 1-26).

**Barrel excerpt:**
```typescript
// Barrel re-exports for the `src/dedup/` module (Phase 40, DEDUP-01).
//
// Consumers needing the layered dedup framework in one import:
//   import { LayeredDeduplicator, JaccardNameMatcher, ... } from '@fwornle/km-core/dedup';

export { LayeredDeduplicator } from './LayeredDeduplicator.js';
export { JaccardNameMatcher } from './JaccardNameMatcher.js';
// ... etc
export type { ExactNameLayer, EmbeddingLayer, LLMSemanticLayer, ... } from './types.js';
```

**Primary analog (mapper / pure function):** `km-core/src/segments/merge.ts` (pure transform function with `.js` import suffix, no class state, `process.stderr.write` for diagnostics).

**Source row shape (A's JSON exports):** `.data/observation-export/observations.json` rows have:
```json
{
  "id": "6e668476-...",
  "summary": "Intent: ...\nApproach: ...\nArtifacts: ...\nResult: ...",
  "agent": "opencode",
  "project": "onboarding-repro",
  "quality": "high",
  "createdAt": "2026-04-07T18:17:49.072Z",
  "digestedAt": "2026-04-23T05:22:05.198Z",
  "llm": null,
  "modifiedFiles": null
}
```

Digests carry: `{ id, date, theme, summary, observationIds[], agents[], filesTouched[], quality }`.
Insights carry: `{ id, topic, summary, confidence, digestIds[] }`.

**Mapper contract** (informative — to be implemented):
- `mapObservationRow(row) → Entity` with `entityType: 'Observation'`, `ontologyClass: 'Observation'`, `name` derived from intent/summary first line, `description: row.summary`, `metadata.legacyId = { system: 'online', id: row.id }`, `createdAt: row.createdAt`, `validFrom: row.createdAt`.
- Equivalent mappers for digest and insight rows.
- The mapper is a **pure function** — no I/O, no store coupling — mirroring `mergeDescriptionSegment`'s pattern.

**What to keep from `mergeDescriptionSegment` shape:**
- Pure-function signature; no class.
- All `.js` suffix on relative imports.
- Module-level constants for thresholds / row tier names.
- Type-only imports for `Entity`, `ProvenanceStamp`.

**What to adapt:**
- The mapper is **read-only** — never invokes `store.putEntity`. The reproject function does that wiring.
- Note from CONTEXT.md G3 / D-48: Observations/Digests/Insights are an **orthogonal** ontology axis (LearningArtifact subclasses) — the mapper must NOT cross into the architectural ontology (Component/Pipeline/etc.).

---

### `km-core/src/maintenance/resolveEntities.ts` (library function, batch + LLM)

**Primary analog:** OKM `_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts:620-720` (the `resolveEntities` body — THE reference shape per CONTEXT.md canonical refs).

**OKM signature & body excerpt** (lines 620-628):
```typescript
async resolveEntities(
  graphStore: GraphStore,
  dryRun = false,
  classes?: string[],
): Promise<{
  merges: Array<{ survivorId: string; survivorName: string; duplicateId: string; duplicateName: string; ontologyClass: string }>;
  synthesizedCount: number;
  errors: string[];
}> {
```

**OKM grouping + concurrency loop** (lines 633-684):
```typescript
const entitiesByClass = new Map<string, Entity[]>();
for (const entity of graphStore.getAllEntities()) {
  const cls = entity.ontologyClass ?? entity.entityType;
  if (classes && !classes.includes(cls)) continue;
  const group = entitiesByClass.get(cls) ?? [];
  group.push(entity);
  entitiesByClass.set(cls, group);
}

const classEntries = Array.from(entitiesByClass.entries())
  .filter(([, entities]) => entities.length >= 2);

const RESOLUTION_CONCURRENCY = 3;
const BATCH_SIZE = 30; // reduced from 50 b/c descriptions inflate prompt size

for (let i = 0; i < classEntries.length; i += RESOLUTION_CONCURRENCY) {
  const wave = classEntries.slice(i, i + RESOLUTION_CONCURRENCY);
  const waveResults = await Promise.allSettled(
    wave.map(async ([ontologyClass, entities]) => {
      const allMatches: Array<{ nameA: string; nameB: string }> = [];
      const entitySummaries = entities.map(e => ({
        name: e.name,
        description: (e.description ?? '').slice(0, 200),
      }));
      for (let batchStart = 0; batchStart < entitySummaries.length; batchStart += BATCH_SIZE) {
        const batch = entitySummaries.slice(batchStart, batchStart + BATCH_SIZE);
        if (batch.length < 2) continue;
        try {
          const matches = await this.batchLLMResolution(batch, ontologyClass);
          allMatches.push(...matches);
        } catch (err) {
          errors.push(`LLM resolution error for class "${ontologyClass}" batch ${batchStart}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return { ontologyClass, entities, matches: allMatches };
    }),
  );
  // ... process settled wave results ...
}
```

**OKM survivor selection by degree** (lines 711-719):
```typescript
const nodeIdA = `${entityA.layer}:${entityA.id}`;
const nodeIdB = `${entityB.layer}:${entityB.id}`;
const degreeA = graphStore.getDegree(nodeIdA);
const degreeB = graphStore.getDegree(nodeIdB);

const [survivor, duplicate, survivorNodeId, duplicateNodeId] =
  degreeA >= degreeB
    ? [entityA, entityB, nodeIdA, nodeIdB]
    : [entityB, entityA, nodeIdB, nodeIdA];
```

**What to keep:**
- Algorithm shape verbatim — concurrency wave + per-class batching + LLM call + degree-based survivor selection.
- Defaults `RESOLUTION_CONCURRENCY=3`, `BATCH_SIZE=30` exposed via opts but defaulted per OKM.
- `dryRun: true` returns the plan without invoking `mergeEntities`.
- `mergedAway` tracking inside a class to avoid double-merging.
- `errors[]` accumulated for visibility, never thrown.
- 200-char description truncation in entity summaries (OKM line 666 — load-bearing for prompt size).

**What to adapt:**
- **Top-level function, not class method** per CF-D36 / D-49. Caller supplies `LLMSemanticLayer` (from `@fwornle/km-core/dedup`) — NOT a custom internal `batchLLMResolution`. This is the major delta from OKM: km-core already ships `LLMSemanticMatcher` (Phase 40 DEDUP-01); `resolveEntities` REUSES it instead of duplicating the 5-stage JSON unwrap.
- **Signature:** `resolveEntities(store, opts)` where `opts: { llmMatcher: LLMSemanticLayer; classes?: string[]; dryRun?: boolean; concurrency?: number; batchSize?: number; log?: (e) => void }`.
- **`store.getAllEntities()` → `store.findByOntologyClass(cls, { includeSuperseded: false })`** per class (CF-D34 active-only default). The OKM grouping loop is replaced by iterating `opts.classes` (default = all subclasses of `LearningArtifact` via the OntologyRegistry's class-walk — see Phase 38 `ResolvedClass`).
- **Degree:** km-core's `GraphKMStore` doesn't expose `getDegree` directly. Either add an internal helper that walks `graph.degree(id)` (Graphology API) OR have `mergeEntities` accept a `survivor` field that the caller resolves via `findRelations`. **Recommend** adding a small helper inside `resolveEntities` that uses `graph.degree()` via a yet-to-be-defined `GraphKMStore.getDegree(id)` method (add to Phase 41 modifications list if planner chooses) OR delegates degree-counting to a callback in opts. CONTEXT.md leaves "survivor-selection heuristic" to Claude's discretion.
- **`console.info(...)` lines** → replace with `process.stderr.write('[km-core/maintenance] ...')` per no-console-log.
- **Each surfaced match invokes `mergeEntities(store, survivorId, [duplicateId], { provenance, ... })`** instead of inlining the merge logic.
- **`ResolveResult` shape:** superset of OKM's `{ merges, synthesizedCount, errors }` per CONTEXT.md `<specifics>`: add `confidence` (LLM matcher provides it via `MatchResult.confidence`) and `dryRun` echo.
- **`synthesizeDescriptions` step (OKM 810-820) is OUT OF SCOPE** for Phase 41 — synthesis is a separate `IngestPipeline` stage; `resolveEntities` returns `synthesizedCount: 0` for now (or omits the field).

---

### `km-core/src/maintenance/mergeEntities.ts` (atomic merge primitive)

**Primary analogs (compose three):**

1. **GraphKMStore D-33 supersession closure** (`src/store/GraphKMStore.ts:422-484`) — the atomic-two-write pattern.
2. **`mergeDescriptionSegment`** (`src/segments/merge.ts:101-160`) — the building block for segment folding (CF-D39).
3. **OKM `migrateEdges`** (`deduplicator.ts:910-933`) — the edge-rewire pattern.

**D-33 atomic two-write excerpt** (`src/store/GraphKMStore.ts:474-477`):
```typescript
await this.batch([
  { type: 'putEntity', entity: closedOld, skipOntologyCheck: true },
  { type: 'putEntity', entity, skipOntologyCheck: true },
]);
// Materialize SUPERSEDED_BY edge for D-35 reverse-walk index
await this.addRelation({ type: 'SUPERSEDED_BY', from: oldId, to: id });
```

**OKM `migrateEdges` excerpt** (`deduplicator.ts:910-933`):
```typescript
private migrateEdges(graphStore: GraphStore, sourceNodeId: string, targetNodeId: string): void {
  const edges = graphStore.getEdges(sourceNodeId);
  for (const edge of edges) {
    const newSource = edge.source === sourceNodeId ? targetNodeId : edge.source;
    const newTarget = edge.target === sourceNodeId ? targetNodeId : edge.target;
    if (newSource === newTarget) {
      graphStore.deleteEdge(edge.key);
      continue;
    }
    graphStore.addEdge(newSource, newTarget, {
      type: edge.attributes.type,
      metadata: edge.attributes.metadata ?? {},
      createdAt: edge.attributes.createdAt,
    });
    graphStore.deleteEdge(edge.key);
  }
}
```

**`mergeDescriptionSegment` invocation pattern** (`src/segments/merge.ts:101-160`):
```typescript
export function mergeDescriptionSegment(
  entity: Entity,
  newSegment: DescriptionSegment,
): Entity {
  // pure — returns a NEW Entity; caller threads through to store.putEntity
}
```

**What to keep:**
- Single-batch atomicity (CF-D17). All four merge steps live inside one `store.batch([...])` call:
  1. `putEntity(closedDuplicate, { skipOntologyCheck: true })` — closes `validUntil`.
  2. `putEntity(survivor, { skipOntologyCheck: true })` — bumped confirmation + new resolutionHistory + folded segments.
  3. `addRelation({ type: 'SUPERSEDED_BY', from: duplicateId, to: survivorId })` — D-33 forward index.
  4. Edge rewires from duplicate → survivor.
- `skipOntologyCheck: true` per-op (CR-01 widening — see `BatchOp.skipOntologyCheck` in `src/store/types.ts:28-36`) so legacy / mid-rewrite ids don't throw on `parseEntityId`.
- Self-loop skip (OKM line 918) — `newSource === newTarget` after rewire means the duplicate had a self-loop or an edge to the survivor; delete only.

**What to adapt:**
- **OKM uses delete-the-duplicate; KM-Core uses supersession** (D-33). The duplicate is NOT deleted; instead its `validUntil` is closed and its supersedes-pointer is set to the survivor (write the supersession the OPPOSITE direction from D-33 — survivor PUT with `supersedes: duplicateId` is the wrong shape because we have many duplicates and one survivor). **The correct pattern:** for each duplicate, write `closedDuplicate = { ...duplicate, validUntil: now }` AND add a `SUPERSEDED_BY` edge from `duplicate.id` to `survivor.id`. The survivor entity itself is also rewritten with bumped `confirmationCount`, `lastConfirmedBy = opts.provenance`, and an appended `resolutionHistory[]` record per OKM line 760-768.
- **`migrateEdges`** must translate to KM-Core's `BatchOp` shapes (`addRelation` + `removeRelation`). Graphology v0.26 has `forEachInEdge`/`forEachOutEdge` — use those to enumerate, then build `removeRelation` + `addRelation` BatchOps with the survivor swapped in. NB: in KM-Core, edges are `Relation` records (typed `{ type, from, to, metadata }`) — preserve `type` and `metadata` verbatim.
- **Segment folding via `mergeDescriptionSegment`** (CF-D39): iterate each duplicate's `metadata.descriptionSegments[]` and fold into the survivor via the existing helper. This is a per-segment loop, NOT a wholesale merge — `mergeDescriptionSegment` provides the D-40 whitespace-normalized identical-text dedup automatically.
- **Confirmation bump:** call `store.putEntity(survivor, { skipOntologyCheck: true })` on the trusted path with pre-stamped `metadata.provenance.confirmationCount = old + duplicateIds.length` and `lastConfirmedBy = opts.provenance`. The store's strict-path D-32 logic doesn't apply on the trusted path; you stamp it yourself (mirrors backfill pattern).
- **Single-successor invariant (WR-02):** the store enforces "at most one SUPERSEDED_BY successor per predecessor" at write time (`GraphKMStore.ts:440-450`). For each duplicate we add ONE SUPERSEDED_BY edge to the survivor; check before merging that none of `duplicateIds` already has a successor, else throw.
- **Signature:** `mergeEntities(store, survivorId, duplicateIds, opts)` where `opts: { provenance: ProvenanceStamp; mergeSegments?: boolean (default true); ... }`. Per D-50: `MergeResult: { survivorId, duplicateIds[], edgesRewired: number, segmentsMerged: number, oldValidUntil: string }`.
- **`resolutionHistory[]` append** (OKM line 758-768) — append a `ResolutionRecord` to `survivor.metadata.resolutionHistory[]` for EACH merged duplicate. The `ResolutionRecord` type is already in `src/types/entity.ts:102-111`.

**Critical gotcha — `BatchOp.skipOntologyCheck` for legacy ids:** Phase 39 REVIEW-FIX commit `44c1e9b` widened per-op `skipOntologyCheck` so the supersession-closure batch can carry non-v7 predecessor ids. `mergeEntities` MUST set `skipOntologyCheck: true` on EVERY op in its batch — both because the merged entities may have legacy ids (reprojected from A's SQLite via `legacyId`) AND because the trusted path is the only one that lets you pre-stamp `EntityProvenance` (the strict path D-30 throws would otherwise fire).

---

### `km-core/src/maintenance/index.ts` (barrel)

**Primary analog:** `km-core/src/dedup/index.ts` (lines 1-26, near-verbatim shape).

**What to keep:** sub-path barrel re-exports both functions + their option/result types. Block-comment lists consumer import path (`@fwornle/km-core/maintenance`).

**What to adapt:** replace dedup re-exports with `resolveEntities`, `mergeEntities`, and their `ResolveResult` / `MergeResult` / `ResolveOptions` / `MergeOptions` types.

---

### `km-core/ontology/learning-artifacts-upper.json` (NEW ontology file)

**Primary analog:** `km-core/tests/fixtures/ontology/upper.json` (lines 1-7 for `meta`, then any class entry like `Component` lines 8-22).

**Excerpt (meta shape):**
```json
{
  "meta": {
    "name": "upper",
    "version": "2.0.0",
    "description": "Upper ontology v2 - streamlined execution and failure model (13 classes, down from 22)"
  },
  "classes": {
    "Component": {
      "defaultLayer": "evidence",
      "description": "...",
      "relationships": { "PART_OF": ["Service"], "DEPENDS_ON": ["Component"], ... },
      "properties": { "componentName": { "type": "string", "required": true }, ... }
    }
  }
}
```

**What to keep:**
- `meta: { name, version, description }` at the top.
- `classes: { <ClassName>: { defaultLayer, description, relationships, properties } }` shape.
- `defaultLayer` is `"evidence"` or `"pattern"`.

**What to adapt:**
- **Drop existing ontology classes.** New file has ONE class only: `LearningArtifact` — abstract upper class declaring shared properties (`id`, `project`, `createdAt`, `validFrom`, `validUntil`, `provenance`, `quality`) per CONTEXT.md D-48. Note: the OntologyRegistry's `extends` resolution (Phase 38 ONTO-02) auto-merges these properties down into the lowers, so the lowers don't repeat them.
- `meta.name: "learning-artifacts-upper"` (or simply `"learning-artifacts"` if the file mixes upper + lowers).
- No `extends` field on `LearningArtifact` (it's the upper).
- The OntologyRegistry auto-discovers `ontology/*.json` (Phase 38 D-26+) but **`~/Agentic/km-core/ontology/` directory does NOT yet exist** — the planner must `mkdir -p` this directory as part of Phase 41. Fixtures live at `tests/fixtures/ontology/` only; the live `ontology/` directory at the package root is new.

---

### `km-core/ontology/learning-artifacts-lower.json` (NEW)

**Primary analog:** `km-core/tests/fixtures/ontology/raas.json` (lines 1-21, uses `extends: "upper"` on `meta` and `extends: "Pipeline"` on classes).

**Excerpt:**
```json
{
  "meta": {
    "name": "raas",
    "version": "1.0.0",
    "extends": "upper",
    "description": "RaaS domain-specific lower ontology - Rendering as a Service concepts"
  },
  "classes": {
    "ArgoWorkflow": {
      "extends": "Pipeline",
      "defaultLayer": "evidence",
      "description": "An Argo-managed workflow orchestrating RaaS processing steps",
      ...
    }
  }
}
```

**What to keep:** `meta.extends` + per-class `extends` shape; Phase 38 ONTO-02 resolves the chain at registry load time.

**What to adapt:**
- Three classes: `Observation`, `Digest`, `Insight`, each `extends: "LearningArtifact"`.
- Each declares tier-specific properties (Observation has `agent`, `quality`, `summary`, `modifiedFiles`; Digest has `date`, `theme`, `observationIds`, `agents`, `filesTouched`; Insight has `topic`, `confidence`, `digestIds`).
- Aggregation relationships are declared on the lower classes: `Digest.relationships.aggregates: ["Observation"]`, `Insight.relationships.aggregates: ["Digest"]`. Predicate name `aggregates` is planner's discretion per CONTEXT.md.
- `meta.extends: "learning-artifacts-upper"` (or whatever the upper file's `meta.name` is).

---

### `km-core/src/index.ts` (MODIFY — barrel append)

**Primary analog:** self — lines 91-123 (Phase 40 block: IngestPipeline + dedup matchers + types). Phase 41 appends a sibling block in the same style.

**Excerpt (Phase 40 precedent, lines 91-123):**
```typescript
// Phase 40 (PIPE-01 + DEDUP-01): 4-stage ingest framework + layered
// deduplication primitives. ...
export { IngestPipeline } from './pipeline/IngestPipeline.js';
export type { ... } from './pipeline/types.js';
export { LayeredDeduplicator, JaccardNameMatcher, ... } from './dedup/...';
export type { ExactNameLayer, ... } from './dedup/types.js';
```

**What to keep:** same block-comment style, type-imports separated, `.js` suffix on all relative imports.

**What to adapt:** append a Phase 41 block:
```typescript
// Phase 41 (INT-01 + PIPE-02): online-learning adapter + post-hoc resolveEntities.
// ...
export { reprojectFromOnlineStore } from './adapters/online/index.js';
export type { ReprojectOptions, ReprojectResult } from './adapters/online/index.js';
export { resolveEntities, mergeEntities } from './maintenance/index.js';
export type { ResolveOptions, ResolveResult, MergeOptions, MergeResult } from './maintenance/index.js';
```

The mapper functions (e.g. `mapObservationRow`) MAY also be re-exported if testing needs them as a public surface — planner's call.

---

### `km-core/package.json` (MODIFY — `exports` map)

**Primary analog:** self — lines 7-24, the existing `exports` map. `./dedup` is the Plan 40-07 precedent.

**Excerpt:**
```json
"exports": {
  ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./ontology": { "types": "./dist/ontology/index.d.ts", "import": "./dist/ontology/index.js" },
  "./pipeline": { "types": "./dist/pipeline/index.d.ts", "import": "./dist/pipeline/index.js" },
  "./dedup": { "types": "./dist/dedup/index.d.ts", "import": "./dist/dedup/index.js" }
}
```

**What to keep:** verbatim shape — `types` + `import` keys, `./dist/<dir>/index.{d.ts,js}` paths.

**What to adapt:** append two new entries:
```json
"./maintenance": { "types": "./dist/maintenance/index.d.ts", "import": "./dist/maintenance/index.js" },
"./adapters/online": { "types": "./dist/adapters/online/index.d.ts", "import": "./dist/adapters/online/index.js" }
```

The adapter sub-path is **optional** — CONTEXT.md says "New TS sub-path / module for the adapter that maps A's SQLite row shapes." The planner may choose to expose the adapter only via the root barrel and skip a dedicated sub-path. If exposed as a sub-path, follow the same shape.

---

### `coding/scripts/reproject-online.mjs` (NEW per-system migration script)

**Primary analog:** `coding/scripts/backfill-raw-observations.mjs` (mjs shape + arg parsing + DB path resolution).

**Imports/CLI args pattern** (lines 1-55):
```javascript
#!/usr/bin/env node
/**
 * Reproject A's online observations/digests/insights into the GraphKMStore.
 *
 * Wraps km-core's `reprojectFromOnlineStore` + constructs the `GraphKMStore`
 * against `.data/knowledge-graph/`. Idempotent (legacyId resolver per CF-D37);
 * resumable via `.data/reproject-online-checkpoint.json` (CF-D38).
 *
 * Usage:
 *   node scripts/reproject-online.mjs                # full reproject
 *   node scripts/reproject-online.mjs --dry-run      # plan only, no writes
 *   node scripts/reproject-online.mjs --resolve      # also run resolveEntities
 *
 * Env:
 *   OBSERVATIONS_DB     default ./.observations/observations.db
 *   KM_GRAPH_DIR        default ./.data/knowledge-graph
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RESOLVE = args.includes('--resolve');
```

**What to keep:**
- ESM `.mjs`, shebang, JSDoc block at top with Usage + Env.
- `import { createRequire }` + `import path from 'node:path'` style.
- Boolean flag parsing via `args.includes(...)`.
- Env-var fallbacks for paths.

**What to adapt:**
- Import `reprojectFromOnlineStore`, `resolveEntities`, `GraphKMStore` from `@fwornle/km-core` (and sub-paths).
- Construct `GraphKMStore({ dbPath: <KM_GRAPH_DIR>/leveldb, exportDir: <KM_GRAPH_DIR>/exports, debounceMs: 100 })`.
- Build a `ProvenanceStamp` for the reprojection (`{ provider: 'reproject-online', model: 'phase-41', runId: <ISO>, timestamp: <ISO> }`).
- If `--resolve`, build an `LLMSemanticMatcher` with a `LLMClient` wired to the local LLM proxy (port 12435 — matches `backfill-raw-observations.mjs:41`).
- Call `await reprojectFromOnlineStore(store, { ... })` then optionally `await resolveEntities(store, { llmMatcher, dryRun: DRY_RUN, ... })`.
- Print `result` to stdout (this IS a one-shot CLI; stdout for the result, stderr for diagnostics per no-console-log).

**Note:** the `no-console-log` rule applies to JS/TS in the *application* path. `coding/scripts/*.mjs` is operator tooling; `process.stdout.write` for results + `process.stderr.write` for diagnostics is the established convention (see `backfill-raw-observations.mjs:140-150` for the pattern).

---

### `km-core/tests/unit/maintenance/resolveEntities.spec.ts` (NEW)

**Primary analogs:**
- `km-core/tests/unit/llm-matcher.test.ts` (lines 1-80) — mock LLMClient + `mkEntity` helper.
- `km-core/tests/unit/backfill.test.ts` (lines 30-95) — `makeStoreCtx` tmpdir fixture + `seedLegacy` helper.

**LLM mock + entity fixture pattern** (`tests/unit/llm-matcher.test.ts:1-50`):
```typescript
import { describe, test, expect, vi } from 'vitest';
import { LLMSemanticMatcher, type LLMClient } from '../../src/dedup/LLMSemanticMatcher.js';
import { mkEntity } from './_helpers/fakes.js';
import { makeMockLLMClient } from './_helpers/fakes-llm.js';

describe('LLMSemanticMatcher', () => {
  test('returns matched: false when candidates is empty', async () => {
    const client = makeMockLLMClient({ matches: [] });
    const matcher = new LLMSemanticMatcher({ client });
    // ...
  });
});
```

**Store-backed fixture pattern** (`tests/unit/backfill.test.ts:30-52`):
```typescript
interface Ctx { store: GraphKMStore; tmpdir: string; checkpointPath: string; }
function makeStoreCtx(): Ctx {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-core-resolve-'));
  const store = new GraphKMStore({
    dbPath: path.join(tmpdir, 'leveldb'),
    exportDir: path.join(tmpdir, 'exports'),
    debounceMs: 0,
  });
  return { store, tmpdir, checkpointPath: path.join(tmpdir, 'cp.json') };
}
async function cleanup(ctx: Ctx): Promise<void> { ... }
```

**What to keep:** vitest describe/test, real GraphKMStore against tmpdir, `mkEntity` helper from `_helpers/fakes.ts`, `makeMockLLMClient` from `_helpers/fakes-llm.ts`, afterEach cleanup.

**What to adapt:**
- Tests for `resolveEntities`: seed 4-6 entities of class `Observation` with near-duplicate names, set up an `LLMSemanticMatcher` with a mock LLMClient that returns a known pair, assert `result.merges.length === 1` and `result.merges[0].ontologyClass === 'Observation'`.
- `dryRun: true` test: same setup, assert `await store.findByOntologyClass('Observation')` still returns 4-6 entities (no merges executed).
- Filter test: pass `classes: ['Digest']`, seed mixed Observation+Digest entities, assert only Digests are scanned (no LLM call for Observation class).
- Active-only test: seed an entity with `validUntil` in the past (i.e. already superseded), assert it's NOT in the candidate pool (CF-D34 default).
- Error accumulation test: mock LLMClient throws; assert `errors[]` populated, no throw bubbles out (matches OKM `deduplicator.ts:677-679`).

---

### `km-core/tests/unit/maintenance/mergeEntities.spec.ts` (NEW)

**Primary analog:** `km-core/tests/unit/backfill.test.ts` (1-120, real-store fixture + entity seeding + per-test cleanup).

**What to keep:** same `makeStoreCtx` / `cleanup` pattern, `vi.restoreAllMocks` in afterEach.

**What to adapt:**
- **Atomic merge happy path:** seed survivor + 2 duplicates (with edges pointing in & out of each), call `mergeEntities(store, survivorId, [dup1Id, dup2Id], { provenance })`, assert:
  - `dup1.validUntil` and `dup2.validUntil` are set (closure).
  - SUPERSEDED_BY edges from each duplicate to survivor exist.
  - All duplicate's in/out edges are now on the survivor (rewire); duplicates have zero edges except SUPERSEDED_BY.
  - `survivor.metadata.descriptionSegments` is the union (D-39 fold).
  - `survivor.metadata.resolutionHistory.length === 2` with correct mergedEntityId for each.
  - `survivor.metadata.provenance.confirmationCount` bumped by 2.
- **Self-loop test:** seed a duplicate with an edge already pointing at the survivor; assert the rewire skips it (would otherwise be a self-loop).
- **Edge-type preservation:** seed edges of various `type` values; assert `type` preserved on rewire.
- **WR-02 single-successor violation:** seed a duplicate that already has a SUPERSEDED_BY successor; assert `mergeEntities` throws.
- **Idempotency note:** running `mergeEntities` twice with the same args should be a no-op on the second call (or throw clearly — planner choice; document the contract in the test).

---

### `km-core/tests/unit/adapters/online-mapper.spec.ts` (NEW)

**Primary analog:** `km-core/tests/unit/segments-merge.test.ts` (lines 1-80, pure-function tests with helper builders).

**What to keep:** describe/test/expect, helper builders for input rows, no store needed.

**What to adapt:**
- Three describe blocks: `mapObservationRow`, `mapDigestRow`, `mapInsightRow`.
- Each: feed a row matching `.data/observation-export/{observations,digests,insights}.json` shape (use fixtures), assert returned `Entity` has correct `entityType`, `ontologyClass`, `name`, `description`, `createdAt`, and `metadata.legacyId = { system: 'online', id: <row.id> }`.
- Null-handling tests: `row.modifiedFiles === null` → empty array on the entity; `row.llm === null` → metadata key absent.

---

### `km-core/tests/integration/reproject-resolve-merge.test.ts` (NEW)

**Primary analog:** `km-core/tests/integration/pipeline-supersession.test.ts` (lines 1-80, real-store + tmpdir + supersession assertions).

**Fixture pattern excerpt:**
```typescript
type Ctx = { store: GraphKMStore; tmpdir: string; };
function makeFixture(): Ctx {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-core-reproject-resolve-'));
  const store = new GraphKMStore({
    dbPath: path.join(tmpdir, 'leveldb'),
    exportDir: path.join(tmpdir, 'exports'),
    debounceMs: 0,
  });
  return { store, tmpdir };
}
```

**What to keep:** real GraphKMStore (not mocked), tmpdir per-test, `beforeEach`/`afterEach` open/close, `vi.restoreAllMocks`.

**What to adapt:**
- Fixture JSON files under `tests/fixtures/online-export/` mirroring `.data/observation-export/*.json` shape (3-5 observations, 1-2 digests, 1 insight, with a deliberately-duplicated pair).
- End-to-end test:
  1. `await reprojectFromOnlineStore(store, { sources: { jsonExports: fixtureDir }, legacyProvenance })`.
  2. `const plan = await resolveEntities(store, { llmMatcher: mockMatcher, dryRun: true })` — assert `plan.merges.length >= 1` and no entities mutated.
  3. `const result = await resolveEntities(store, { llmMatcher: mockMatcher, dryRun: false })` — assert merges executed via `mergeEntities`, duplicate's `validUntil` set, survivor's `confirmationCount` bumped.
- Re-run idempotency: call `reprojectFromOnlineStore` twice; assert entity count is unchanged the second time (legacyId resolver de-duplicates).

---

## Shared Patterns

### Authentication / Authorization
**N/A** — km-core is a library; no auth surface. The per-system migration script (`coding/scripts/reproject-online.mjs`) reads local files only.

### Error Handling
**Source:** `km-core/src/dedup/LLMSemanticMatcher.ts:65-75` (`LLMDedupParseError`) + OKM `deduplicator.ts:677-679` (collect-into-`errors[]` pattern).
**Apply to:** `resolveEntities` (collects errors into `errors[]`; never throws on per-batch LLM failure), `mergeEntities` (throws on WR-02 violation or graph-integrity error — these ARE fatal), `reprojectFromOnlineStore` (logs malformed rows via stderr; skips and continues per `ColdStoreReader` precedent at line 81).

**Excerpt (`LLMSemanticMatcher.ts:65-75`):**
```typescript
export class LLMDedupParseError extends Error {
  readonly raw: string;
  constructor(message: string, opts: { raw: string; cause?: unknown }) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'LLMDedupParseError';
    this.raw = opts.raw.slice(0, 1000);
  }
}
```

### Diagnostic Output (no-console-log)
**Source:** `km-core/src/segments/merge.ts:134-136` + `km-core/src/backfill/index.ts:216-218`.
**Apply to:** ALL new adapter, maintenance, and script code.

**Excerpt:**
```typescript
process.stderr.write(
  `[km-core/segments] entity ${String(entity.id)} segment ${String(matchIndex)} has ${String(match.confirmations.length)} confirmations (>${String(MAX_CONFIRMATIONS_WARN)}, monitoring per D-41)\n`,
);
```

Prefix conventions:
- `[km-core/adapters/online]` for the adapter.
- `[km-core/maintenance]` for resolveEntities + mergeEntities.
- `[reproject-online]` for the coding/scripts/ entry point (shorter; CLI-scoped).

### Options-Object Signature (CF-D14)
**Source:** every existing top-level function in km-core — see `backfillEntityDataModel(store, options)` and `IngestPipeline` constructor.
**Apply to:** ALL new top-level functions.

**Excerpt (`backfill/index.ts:157-160`):**
```typescript
export async function backfillEntityDataModel(
  store: GraphKMStore,
  options: BackfillOptions,
): Promise<BackfillResult> {
```

### Atomic Multi-Write (CF-D17)
**Source:** `km-core/src/store/GraphKMStore.ts:474-477` (D-33 supersession-closure batch).
**Apply to:** `mergeEntities` (one `store.batch([...])` covering all merge ops + edge rewires + segment fold), `reprojectFromOnlineStore` (per-row single op — keep simple, no need for batch).

**Excerpt:**
```typescript
await this.batch([
  { type: 'putEntity', entity: closedOld, skipOntologyCheck: true },
  { type: 'putEntity', entity, skipOntologyCheck: true },
]);
```

### ESM `.js` Suffix on All Relative Imports (CF-D06)
**Source:** every file in `km-core/src/` — see `src/backfill/index.ts:41-52`, `src/segments/merge.ts:33-37`.
**Apply to:** ALL new TS files.

### Trusted-Path Pre-Stamping (CF-D30)
**Source:** `km-core/src/backfill/index.ts:226-245` — the pre-stamp + `{ skipOntologyCheck: true }` pattern.
**Apply to:** `reprojectFromOnlineStore` (every entity gets a synthetic `EntityProvenance` + `legacyId` + `validFrom` BEFORE `store.putEntity`); `mergeEntities` (survivor's bumped provenance pre-stamped before the trusted `putEntity`).

**Excerpt (`backfill/index.ts:230-245`):**
```typescript
const syntheticProv: EntityProvenance = {
  createdBy: options.legacyProvenance,
  lastConfirmedBy: options.legacyProvenance,
  confirmationCount: 1,
};
const stampedEntity: Entity = {
  ...entity,
  validFrom: resolved.validFrom,
  legacyId: resolved.legacyId ?? entity.legacyId,
  metadata: {
    ...(entity.metadata ?? {}),
    provenance: syntheticProv,
  },
};
await store.putEntity(stampedEntity, { skipOntologyCheck: true });
```

### Atomic Checkpoint File (CF-D38)
**Source:** `km-core/src/backfill/checkpoint.ts` (entire file).
**Apply to:** `reprojectFromOnlineStore` — same atomic-temp-rename + WR-03 version guard + ENOENT-as-fresh-start.

### Per-Op `skipOntologyCheck` for Legacy Ids (Phase 39 CR-01)
**Source:** `km-core/src/store/types.ts:28-36` + `GraphKMStore.ts:466-477`.
**Apply to:** `mergeEntities` — every op in the batch sets `skipOntologyCheck: true` because reprojected entities carry `legacyId` from A's SQLite and may have non-v7 ids (depending on UUID-derivation strategy — see CONTEXT.md "Claude's Discretion" on UUIDv5-vs-fresh-v4).

### Read-Only Adapter Invariant
**Source:** `coding/src/live-logging/ColdStoreReader.js:9-12` (Invariant #3) — adapter is read-only; SC#2 enforced by construction.
**Apply to:** All adapter code under `src/adapters/online/`. Never call `store.putEntity` from inside the mapper itself; the reproject function does that wiring. Never open A's `observations.db` for writing.

## Cross-Cutting Notes

### Phase 41 vs Phase 39 D-37 `legacyId` placement (REVISED — supersedes prior recommendation)

**CANONICAL placement (use this; verified against entity.ts:147 and backfill/index.ts:238):**

Phase 39's `Entity.legacyId` is a TYPED TOP-LEVEL field — `legacyId?: { system: 'A' | 'B' | 'C'; id: string }`
declared at `src/types/entity.ts:147`. The Phase 39 backfill stamps it at the TOP LEVEL:
`backfill/index.ts:238` does `legacyId: resolved.legacyId ?? entity.legacyId` inside the entity object
literal, NOT inside `metadata`. This is the canonical CF-D37 pattern.

For A's online subsystem, Phase 41 mappers (Plan 02) and the reproject function (Plan 04) MUST:
  - Stamp `entity.legacyId = { system: 'A', id: <sqlite-id> }` at the TOP LEVEL of the returned Entity
    (NOT under `entity.metadata.legacyId`).
  - Stamp `entity.metadata.subsystem = 'online'` as a SEPARATE metadata bag key (NOT nested inside
    legacyId; not folded into `legacyId.system`).

Idempotency scans (Plan 04 startup, future Phase 42/43 reproject equivalents) hash on the TOP-LEVEL
`entity.legacyId.id` and filter on `entity.legacyId?.system === 'A' && entity.metadata?.subsystem === 'online'`.

**Why this matters:** A previous revision of this note recommended "Option B: system + subsystem on metadata"
which placed `{ system, subsystem }` together inside a metadata bag. That recommendation is WRONG and is
SUPERSEDED by this canonical placement. The `Entity.legacyId.system` union stays narrow (`'A' | 'B' | 'C'`)
— no widening of the type required. The `'online'` discriminator is its own metadata field, kept separate
so the type stays narrow and the canonical CF-D37 placement (entity.ts:147 + backfill/index.ts:238) is
preserved unchanged.

### No `getAllEntities()` in km-core GraphKMStore
OKM's `resolveEntities` uses `graphStore.getAllEntities()` (line 635). KM-Core does NOT expose this method; the closest available API is `store.iterate({}, { includeSuperseded: false })` (active-only async generator) or `store.findByOntologyClass(cls, { ... })` (per-class). Since `resolveEntities` operates **per ontology class**, the planner should iterate `opts.classes` (default = LearningArtifact subclasses) and call `findByOntologyClass` per class — eliminates the need for a `getAllEntities` API addition.

### No `getDegree(id)` in km-core GraphKMStore
OKM uses `graphStore.getDegree(nodeId)` (line 713) to pick the survivor. KM-Core does not expose this. Options:
- Add `GraphKMStore.getDegree(id: EntityId): number` (modifies `GraphKMStore.ts`).
- Use `graph.degree(id)` directly via a closed-over reference — but the graph is private. Not viable.
- Caller supplies a callback in opts: `survivorOf: (a: Entity, b: Entity) => Entity` defaulting to "first" or "richer-description".

CONTEXT.md "Claude's Discretion" notes "Survivor-selection heuristic in resolveEntities — OKM uses 'prefer node with more graph edges' (getDegree); planner may stick with that or tune." If keeping `getDegree`, ADD `GraphKMStore.getDegree(id)` to Phase 41's km-core modifications list — minimal one-line wrapper around Graphology's `degree(node)`.

### Aggregation edge predicates
CONTEXT.md leaves edge predicate names to Claude's discretion. Candidates per `<specifics>`: `aggregates`, `derivedFrom`, `summarizes`. Look at existing edge types in `.data/exports/coding.json` to align with current conventions. Recommend: `aggregates` for the Digest→Observation direction (matches verb in `tests/fixtures/ontology/upper.json`'s `CONTAINS`/`PRODUCED_BY` style) and `derivedFrom` for the reverse direction if both are needed; the simpler choice is one direction only — `aggregates` from parent (Digest) to child (Observation).

### Existing `ontology/` directory does not yet exist
Phase 41 must create the `~/Agentic/km-core/ontology/` directory (currently only `tests/fixtures/ontology/` exists). The OntologyRegistry's default `ontologyDir` looks at this path — the live ontology files need to land HERE, not in fixtures. Confirm with the planner: check `OntologyRegistry` default path in `src/ontology/registry.ts`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| _(none)_ | | | All targets have a direct or hybrid analog in km-core, OKM, or coding/scripts/. |

## Metadata

**Analog search scope:**
- `~/Agentic/km-core/src/` (all subdirs)
- `~/Agentic/km-core/tests/` (unit + integration + fixtures)
- `~/Agentic/km-core/ontology/` (does not exist — fixtures only)
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/`
- `~/Agentic/coding/src/live-logging/`
- `~/Agentic/coding/.data/observation-export/`
- `~/Agentic/coding/scripts/`
- `~/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/` (informative-only — B is not modified)

**Files scanned:** 28 (km-core source + tests + OKM deduplicator/pipeline + A's ColdStoreReader + coding/scripts).

**Pattern extraction date:** 2026-05-22

---

*Phase: 41-online-learning-adapter-post-hoc-resolution*
*Pattern mapping complete — planner can now reference analog patterns in PLAN.md files.*
