# Phase 39: Entity Data Model — Pattern Map

**Mapped:** 2026-05-20
**Files analyzed:** 6 (5 source + N tests)
**Analogs found:** 6 / 6 (all in-tree — Phase 37+38 self-analogs except `mergeDescriptionSegment` which lifts from OKM)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `~/Agentic/km-core/src/store/GraphKMStore.ts` | MODIFY — extend `putEntity` signature; add `getSupersessionChain`, supersession closure; default active-only filter | request-response (CRUD) | self — Phase 37 `putEntity` (lines 288-341) + Phase 37 `batch` (lines 438-482) | exact (same file, self-extension) |
| `~/Agentic/km-core/src/store/types.ts` | MODIFY — extend `BatchOp.putEntity` shape OR add a `PutEntityOpts` type | type-only | self — `BatchOp` (lines 15-19) | exact |
| `~/Agentic/km-core/src/types/entity.ts` | MINOR EDIT — JSDoc tightening only (NO new fields; all declared in Phase 37) | type-only | self — existing `Entity`/`EntityProvenance`/`DescriptionSegment` declarations | exact |
| `~/Agentic/km-core/src/backfill/index.ts` | NEW — `backfillEntityDataModel(store, options)` library function | batch / file-I/O (checkpoint) | Phase 37 `Exporter` (`src/store/exporter.ts:216-227` `writeAtomic`) — for the temp+rename idiom (CF-D29) | role-match (atomic-rename + per-iteration progress) |
| `~/Agentic/km-core/src/backfill/checkpoint.ts` | NEW — atomic checkpoint write helper | file-I/O | Phase 37 `Exporter.writeAtomic` (lines 216-227) | exact (same idiom) |
| `~/Agentic/km-core/src/segments/merge.ts` | NEW — pure `mergeDescriptionSegment(entity, newSegment): Entity` helper | transform (pure function) | OKM `_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts:385-416` | role-match (structure verbatim; D-40 normalization delta + return-new-entity delta) |
| `~/Agentic/km-core/src/index.ts` | APPEND — re-export new symbols | barrel | self — Phase 37/38 existing exports (lines 11-68) | exact |
| `~/Agentic/km-core/tests/unit/graph-store.test.ts` | APPEND — 8-12 new tests (do NOT modify existing 13) | test | self — existing tests use `vi.fn()` event-handler pattern (lines 100-122) + `makeStore` ctx helper (lines 34-43) | exact |
| `~/Agentic/km-core/tests/unit/segments-merge.test.ts` | NEW | test | self — `entity.test.ts` (type-only) + `exporter.test.ts` (behavioral) | role-match |
| `~/Agentic/km-core/tests/unit/backfill.test.ts` | NEW | test | self — `exporter.test.ts` (`makeTmp` helper, debounceMs:0 sync pattern, fs-based assertions) | role-match |

---

## Pattern Assignments

### `src/store/GraphKMStore.ts` (MODIFY — writer extension, supersession, active-only filter)

**Analog:** self — existing `putEntity` is the pattern to extend, NOT replace.

**Existing `putEntity` signature + trusted-path branching** (`src/store/GraphKMStore.ts:288-341`):
```typescript
async putEntity(
  e: Partial<Entity> & { name: string; entityType: string },
  opts?: { skipOntologyCheck?: boolean },
): Promise<EntityId> {
  const trusted = opts?.skipOntologyCheck === true;

  // D-19 validation — skipped on the trusted path.
  if (!trusted) {
    this.validator.validate(e.entityType);
  }

  // D-10 stamp-or-keep. On the trusted path we use the caller's id
  // verbatim WITHOUT parseEntityId — round-trip fixtures carry non-v7 ids.
  let id: EntityId;
  if (e.id !== undefined && e.id !== null && e.id !== ('' as EntityId)) {
    if (trusted) { id = e.id as EntityId; }
    else { id = parseEntityId(e.id as unknown as string); }
  } else {
    id = mintEntityId();
  }
  // ... build entity, mergeNode, emit, scheduleExport
}
```

**Phase 39 extension shape (D-30/D-31/D-32)** — extend the `opts` object with `provenance?: ProvenanceStamp`, branch off `trusted` exactly the same way (BC-2 widening preserved):

```typescript
async putEntity(
  e: Partial<Entity> & { name: string; entityType: string },
  opts?: { skipOntologyCheck?: boolean; provenance?: ProvenanceStamp },
): Promise<EntityId> {
  const trusted = opts?.skipOntologyCheck === true;
  // ... existing validation + id resolution unchanged ...

  if (!trusted) {
    // D-30: caller MUST supply provenance on the strict path
    if (!opts?.provenance) {
      throw new Error('putEntity requires opts.provenance (D-30)');
    }
    const now = new Date().toISOString();
    entity.validFrom = entity.validFrom ?? now;  // D-31: writer stamps

    // D-32: create-vs-confirm by graph.hasNode(id)
    const existing = this.graph.hasNode(id)
      ? (this.graph.getNodeAttributes(id) as Entity)
      : undefined;
    const existingProv = existing?.metadata?.provenance as EntityProvenance | undefined;
    const newProv: EntityProvenance = existing
      ? {
          createdBy: existingProv?.createdBy ?? opts.provenance,
          lastConfirmedBy: opts.provenance,
          confirmationCount: (existingProv?.confirmationCount ?? 0) + 1,
        }
      : { createdBy: opts.provenance, lastConfirmedBy: opts.provenance, confirmationCount: 1 };
    entity.metadata = { ...(entity.metadata ?? {}), provenance: newProv };
  }
  // ...
}
```

**Gotcha — preserve `skipOntologyCheck` bypass:** The trusted path skips BOTH ontology validation AND `parseEntityId` (BC-2 widening, locked by `tests/unit/graph-store.test.ts:248-268`). Phase 39 MUST ALSO skip provenance-stamping on the trusted path so backfill writes can use `skipOntologyCheck: true` without needing to wedge a synthetic ProvenanceStamp into every `putEntity` call from `restore()` or fixture-replay. Backfill DOES supply its synthetic stamp, but `restore()` does not — `restore()` calls `tolerantImport`, not `putEntity`, so the bypass is automatic; backfill calls `putEntity({ skipOntologyCheck: true, provenance: legacyProvenance })`. Both paths work.

**Existing `batch` atomic-write pattern (CF-D17)** — Phase 39 supersession closure reuses this (`src/store/GraphKMStore.ts:438-482`):
```typescript
async batch(ops: BatchOp[]): Promise<void> {
  // Phase 1: validate ALL ops. Any throw bubbles BEFORE any mutation.
  for (const op of ops) { /* validation only */ }

  // Phase 2: apply in-memory + emit events.
  for (const op of ops) {
    if (op.type === 'putEntity') { await this.putEntity(op.entity); }
    // ...
  }
  this.exporter.scheduleExport(this.graph.export() as SerializedGraph);
}
```

**Supersession closure (D-33)** — within `putEntity`, when `e.supersedes` is set on a NEW id, defer the actual write to `this.batch([putOld(updated), putNew])`. The batch atomicity covers the "no gap, no overlap" guarantee for free. Reverse-supersedes is materialized as a `SUPERSEDED_BY` Graphology edge (Pattern 2A.1 from RESEARCH §Pattern 2 — preferred over a separate Map).

**Existing `findByOntologyClass` shape to extend (D-34)** (`src/store/GraphKMStore.ts:371-380`):
```typescript
async findByOntologyClass(cls: string): Promise<Entity[]> {
  const matches: Entity[] = [];
  for (const nodeId of this.graph.nodes()) {
    const entity = this.graph.getNodeAttributes(nodeId) as Entity;
    if (entity.entityType === cls || entity.ontologyClass === cls) {
      matches.push(entity);
    }
  }
  return matches;
}
```

**Phase 39 D-34 extension** — add `opts?: { includeSuperseded?: boolean }`, default `false`. Filter using:
```typescript
function isActive(entity: Entity, nowMs: number): boolean {
  if (entity.validUntil === undefined) return true; // Phase 37/38 entities — CRITICAL
  return new Date(entity.validUntil).getTime() > nowMs;
}
```
The `undefined` short-circuit is what keeps the 13 existing tests green (none set `validUntil`).

**Existing `iterate` signature (D-34 extension target)** (`src/store/GraphKMStore.ts:489-496`):
```typescript
async *iterate(filter?: FilterObject): AsyncIterable<Entity> { ... }
```
Extend to `iterate(filter?: FilterObject, opts?: { includeSuperseded?: boolean })`. Two-arg form, both optional — does NOT break the existing `iterate({ entityType: 'Component' })` call site at `graph-store.test.ts:178`.

**Existing event-emission pattern** (`src/store/GraphKMStore.ts:337`):
```typescript
this.emit('entity:put', { entity });
this.exporter.scheduleExport(this.graph.export() as SerializedGraph);
```
Phase 39 supersession's two-write closure fires `entity:put` TWICE — once for the old entity (with new `validUntil`) and once for the new entity. `addRelation` also fires `relation:added` for the `SUPERSEDED_BY` edge. Subscribers see all three. No new event types are needed.

**Existing stderr-warn pattern** (`src/store/exporter.ts:112-114`):
```typescript
process.stderr.write(
  `[km-core/exporter] debounced export failed: ${msg}\n`,
);
```
Phase 39 reuses this `[km-core/<module>] <message>` shape for three new warning sites:
- `[km-core/store] overwriting validUntil for ${oldId}` (D-33 — predecessor already had `validUntil` set)
- `[km-core/segments] entity ${id} has ${n} descriptionSegments (>100, monitoring per D-41)`
- `[km-core/segments] segment in entity ${id} has ${n} confirmations (>50, monitoring per D-41)`

---

### `src/store/types.ts` (MODIFY — option type addition)

**Analog:** self.

**Existing shape** (`src/store/types.ts:15-19`):
```typescript
export type BatchOp =
  | { type: 'putEntity'; entity: Partial<Entity> & { name: string; entityType: string } }
  | { type: 'deleteEntity'; id: EntityId }
  | { type: 'addRelation'; relation: Relation }
  | { type: 'removeRelation'; relation: Relation };
```

**Phase 39 addition** — export a `PutEntityOpts` type that combines `skipOntologyCheck` + `provenance` so the public surface has one named type instead of inline anonymous shapes. Optional refactor; planner's discretion.

```typescript
export interface PutEntityOpts {
  skipOntologyCheck?: boolean;
  provenance?: ProvenanceStamp;
  includeSuperseded?: boolean;  // for find/iterate — OR keep separate; planner picks
}
```

**Gotcha:** `BatchOp` doesn't carry a `provenance` field today. The batch path goes through `putEntity` without an opts arg (line 460: `await this.putEntity(op.entity);`). Phase 39 must decide: (a) attach provenance to each BatchOp variant, or (b) attach a single provenance to the whole batch call. CONTEXT.md doesn't lock this — recommend (b) `batch(ops, { provenance })` for symmetry with `putEntity(entity, { provenance })`.

---

### `src/types/entity.ts` (MINOR EDIT — JSDoc only)

**Analog:** self.

**No new fields.** All temporal + provenance declarations already exist (Phase 37 Plan 02 landed them as documented optional declarations). Phase 39 tightens JSDoc to spell out the writer-side contract:

```typescript
/** ISO timestamp: when this entity became valid (set at creation time).
 *  Phase 39 writer contract: any entity RETURNED FROM `GraphKMStore` has
 *  `validFrom` populated. Callers MAY pass `Entity` with `validFrom`
 *  unset on the strict path; the store stamps it. The trusted path
 *  (`skipOntologyCheck: true`) preserves caller-supplied undefined. */
validFrom?: string;
```

Apply the same tightening to `validUntil`, `supersedes`, and the JSDoc above `EntityProvenance`. No code outside the JSDoc changes.

---

### `src/backfill/index.ts` (NEW — library function with checkpoint)

**Analog:** Phase 37 `Exporter` (`src/store/exporter.ts`) — for the atomic-rename idiom (CF-D29) and the per-domain progress pattern.

**Imports pattern** (mirror `src/store/exporter.ts:48-50`):
```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Entity, ProvenanceStamp } from '../types/entity.js';
import type { GraphKMStore } from '../store/GraphKMStore.js';
```
ESM `.js` import extensions (CF-D06).

**Function-level signature pattern (CF-D14 options object):**
```typescript
export interface BackfillResolver {
  (entity: Entity): { validFrom: string; legacyId?: { system: 'A' | 'B' | 'C'; id: string } };
}

export interface BackfillOptions {
  resolver: BackfillResolver;
  legacyProvenance: ProvenanceStamp;  // provider: 'backfill' convention
  checkpointPath?: string;            // default '.data/backfill-checkpoint.json'
  dryRun?: boolean;                   // default false
}

export interface BackfillResult {
  scanned: number;
  stamped: number;
  skipped: number;
}

export async function backfillEntityDataModel(
  store: GraphKMStore,
  options: BackfillOptions,
): Promise<BackfillResult>
```

**Per-entity-write loop pattern** — iterate via `store.iterate({}, { includeSuperseded: true })` (the Phase 39 NEW opt-in keyword) to see ALL entities including any partial supersession state. For each entity missing `validFrom`:
1. If checkpoint says we've already passed this id, `skipped++` and `continue`.
2. Run `options.resolver(entity)` to compute `validFrom` + optional `legacyId`.
3. If `options.dryRun`: log to stderr what would change, `stamped` stays 0.
4. Else: call `store.putEntity({ ...entity, validFrom, legacyId }, { skipOntologyCheck: true, provenance: options.legacyProvenance })`.
5. Atomic checkpoint write.

**Gotcha — D-37 idempotency:** Entities that already have `validFrom` are skipped without calling the resolver. This makes the function safe to re-run.

**Gotcha — backfill must pass `skipOntologyCheck: true`:** B's legacy ids are nanoid-style, not UUIDv7. `parseEntityId` would reject them. The bypass is the same one used by `restore()` (Phase 37 BC-2). Backfill ALSO supplies `provenance: options.legacyProvenance`, but per the discussion above, the trusted path skips provenance-stamping — so Phase 39 should make backfill stamp provenance EXPLICITLY on the entity object (`entity.metadata.provenance = { createdBy: legacyProvenance, lastConfirmedBy: legacyProvenance, confirmationCount: 1 }`) before calling `putEntity({ skipOntologyCheck: true })`. This sidesteps the bypass cleanly.

---

### `src/backfill/checkpoint.ts` (NEW — atomic-write helper)

**Analog:** Phase 37 `Exporter.writeAtomic` — exact idiom (`src/store/exporter.ts:216-227`):
```typescript
private async writeAtomic(
  filePath: string,
  domainGraph: SerializedGraph,
): Promise<void> {
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.promises.writeFile(
    tempPath,
    JSON.stringify(domainGraph, null, 2),
    'utf-8',
  );
  await fs.promises.rename(tempPath, filePath); // atomic on POSIX
}
```

**Phase 39 checkpoint helper — lift verbatim** with two tiny deltas:
- (a) Helper is module-scope, not a class private method.
- (b) Promise-based; D-38 already says per-entity write so synchronicity isn't required.

```typescript
// src/backfill/checkpoint.ts
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Checkpoint {
  version: 1;
  runId: string;
  lastStampedId: string | null;
  scanned: number;
  stamped: number;
  skipped: number;
  updatedAt: string;
}

export async function writeCheckpointAtomic(
  checkpointPath: string,
  data: Checkpoint,
): Promise<void> {
  const dir = path.dirname(checkpointPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${checkpointPath}.tmp.${process.pid}.${Date.now()}`;
  await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.promises.rename(tempPath, checkpointPath); // atomic on POSIX
}

export async function readCheckpoint(
  checkpointPath: string,
): Promise<Checkpoint | null> {
  try {
    const raw = await fs.promises.readFile(checkpointPath, 'utf-8');
    return JSON.parse(raw) as Checkpoint;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err; // surface real I/O errors
  }
}
```

**Gotcha — `Date.now()` vs `new Date().toISOString()`:** The exporter uses `Date.now()` in the temp-path suffix (uniqueness), and `new Date().toISOString()` in entity timestamps (ordering). Phase 39 backfill follows the same convention: `Date.now()` in the temp-path suffix, `new Date().toISOString()` in `Checkpoint.updatedAt`.

---

### `src/segments/merge.ts` (NEW — pure helper)

**Analog:** OKM `_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts:385-416`.

**OKM verbatim shape (lifted as the starting point):**
```typescript
private mergeDescriptionSegment(
  existingSegments: DescriptionSegment[],
  newText: string,
  context: IngestionContext,
  timestamp: string,
): DescriptionSegment[] {
  // Check for exact-match existing segment
  const match = existingSegments.find((s) => s.text === newText);    // <-- D-40 changes this
  if (match) {
    const confirmation: SegmentConfirmation = {
      runId: context.runId, provider: context.provider, model: context.model, timestamp,
    };
    match.confirmations.push(confirmation);
    return existingSegments;
  }
  // New unique text — append a new segment
  existingSegments.push({
    text: newText, runId: context.runId, provider: context.provider,
    model: context.model, quality: context.quality, timestamp, confirmations: [],
  });
  return existingSegments;
}
```

**Phase 39 deltas from OKM (4 deltas — planner MUST apply ALL):**

1. **D-40 whitespace normalization** — replace the `s.text === newText` exact-equality with normalized comparison:
   ```typescript
   function normalize(t: string): string {
     return t.trim().replace(/\s+/g, ' ');
   }
   // ...
   const targetNorm = normalize(newSegment.text);
   const match = entity.metadata?.descriptionSegments?.find(
     (s) => normalize(s.text) === targetNorm,
   );
   ```
   Case-sensitive (preserves `Code` vs `code`). `\s` matches NBSP + ideographic space — confirmed by Phase 39 RESEARCH §Pattern 4 (g).

2. **D-39 pure function (NOT in-place mutation)** — OKM mutates `existingSegments` in place. Phase 39 returns a NEW `Entity` (deep-copied `descriptionSegments` array + new metadata object). Callers MUST NOT rely on identity.

3. **Signature change** — Phase 39 helper takes the WHOLE entity, not the segments array:
   ```typescript
   export function mergeDescriptionSegment(
     entity: Entity,
     newSegment: DescriptionSegment,
   ): Entity;
   ```
   This pulls the `metadata.descriptionSegments` lookup INSIDE the helper (caller doesn't need to know the key). Returns a new `Entity` ready for `store.putEntity(...)`.

4. **D-41 segment-cap monitoring warnings** — after the merge:
   ```typescript
   if (newSegments.length > 100) {
     process.stderr.write(
       `[km-core/segments] entity ${entity.id} has ${newSegments.length} descriptionSegments (>100, monitoring per D-41)\n`,
     );
   }
   for (const seg of newSegments) {
     if (seg.confirmations.length > 50) {
       process.stderr.write(
         `[km-core/segments] segment in entity ${entity.id} has ${seg.confirmations.length} confirmations (>50, monitoring per D-41)\n`,
       );
     }
   }
   ```
   No hard cap — just warnings. Pruning is deferred.

**Gotcha — newSegment vs context+text:** OKM's helper takes `newText` + `context` separately and assembles the segment inside. Phase 39 D-39 says the caller passes the WHOLE `newSegment: DescriptionSegment`. The caller (ingest pipeline in Phase 40/42) constructs the segment with `runId`, `provider`, `model`, `quality`, `timestamp` and passes it in. Helper just decides "append confirmation" vs "push new segment". This pushes the segment-construction concern OUT of km-core — exactly what D-39 mandates ("pure function, no side effects").

**Gotcha — empty `confirmations[]`:** When the helper pushes a NEW segment (no match found), `newSegment.confirmations` should already be `[]` if the caller followed convention. The helper should NOT silently overwrite a non-empty `confirmations[]` array on a freshly-pushed segment — if the caller passes a segment with confirmations already populated (e.g. from another source), preserve them.

**Gotcha — entity with no `descriptionSegments[]` at all (RESEARCH §Pattern 4 case g):** Phase 37/38 entities have `metadata: {}` with no `descriptionSegments` key. The helper MUST initialize the array (e.g. `const segments = (entity.metadata?.descriptionSegments as DescriptionSegment[]) ?? [];`).

---

### `src/index.ts` (APPEND — re-exports)

**Analog:** self — existing barrel pattern (`src/index.ts:11-68`):
```typescript
export { GraphKMStore } from './store/GraphKMStore.js';
export type { GraphKMStoreOptions } from './store/GraphKMStore.js';
export type { Entity, Relation, ... } from './types/entity.js';
```

**Phase 39 appends (D-36 + D-39):**
```typescript
// Phase 39: backfill + segment merge.
export { backfillEntityDataModel } from './backfill/index.js';
export type {
  BackfillOptions,
  BackfillResolver,
  BackfillResult,
} from './backfill/index.js';
export { mergeDescriptionSegment } from './segments/merge.js';
```

ESM `.js` extensions (CF-D06). Type-only re-exports use `export type {...}`.

---

### `tests/unit/graph-store.test.ts` (APPEND — 8-12 new tests)

**Analog:** self — existing test file (`tests/unit/graph-store.test.ts`). Phase 39 appends after the Phase 38 block (line 269) WITHOUT modifying any of the existing 13 tests.

**Existing `makeStore` ctx helper to reuse (lines 34-43):**
```typescript
function makeStore(extra?: Partial<GraphKMStoreOptions>): Ctx {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-core-test-'));
  const store = new GraphKMStore({
    dbPath: path.join(tmpdir, 'leveldb'),
    exportDir: path.join(tmpdir, 'exports'),
    debounceMs: 0,
    ...extra,
  });
  return { store, tmpdir };
}
```

**Existing event-handler pattern to reuse (lines 100-110):**
```typescript
const handler = vi.fn();
ctx.store.on('entity:put', handler);
const id = await ctx.store.putEntity({ name: 'Evt', entityType: 'Component' });
expect(handler).toHaveBeenCalledTimes(1);
```

**Phase 39 new tests (planner's discretion on exact names; suggested coverage):**
- `putEntity auto-stamps validFrom when missing` (D-31)
- `putEntity sets EntityProvenance from provenance opt on first write` (D-30, D-32)
- `putEntity on existing id increments confirmationCount and preserves createdBy` (D-32)
- `putEntity throws when provenance missing on strict path` (D-30)
- `putEntity with skipOntologyCheck bypasses provenance requirement` (BC-2 widening)
- `putEntity with supersedes closes old entity validUntil atomically` (D-33)
- `putEntity with supersedes writes SUPERSEDED_BY edge` (Pattern 2A.1)
- `putEntity with supersedes warns when old validUntil already set` (D-33 stderr-warn)
- `findByOntologyClass excludes superseded entities by default` (D-34)
- `findByOntologyClass with includeSuperseded: true returns history` (D-34 opt-in)
- `iterate excludes superseded entities by default` (D-34)
- `iterate with includeSuperseded: true returns history` (D-34 opt-in)
- `getSupersessionChain returns ordered chain from origin through tip` (D-35)

**Gotcha — Phase 39 stderr-warn tests:** Use `vi.spyOn(process.stderr, 'write')` to capture, NOT `vi.spyOn(console, 'warn')` — the no-console-log rule means warnings are stderr writes.

---

### `tests/unit/segments-merge.test.ts` (NEW)

**Analog:** Phase 37 `entity.test.ts` for the import-and-describe shape + behavioral test style from `exporter.test.ts`.

**Imports pattern (mirror `tests/unit/exporter.test.ts:1-19`):**
```typescript
import { describe, test, expect } from 'vitest';
import { mergeDescriptionSegment } from '../../src/segments/merge.js';
import type { Entity, DescriptionSegment } from '../../src/index.js';
```

**Phase 39 boundary cases the planner MUST cover (RESEARCH §Pattern 4):**
- (a) Identical text post-normalize → append to `confirmations[]`, do NOT push new segment
- (b) `"hello world"` vs `"hello  world"` (double space) → identical after normalize → confirmation appended
- (c) `"Code"` vs `"code"` → case-sensitive, NOT identical → new segment pushed
- (d) Empty text new segment → planner's call (silently allowed or thrown — recommend silent + match)
- (e) Unicode NBSP (` `) and ideographic space (`　`) → `\s` matches both → confirmation
- (f) Entity with 101 segments → stderr-warn fires (verify with `vi.spyOn(process.stderr, 'write')`)
- (g) Entity with no `descriptionSegments[]` at all → helper initializes array, pushes segment
- (h) **Pure-function contract:** input `entity` reference NOT mutated; returned `entity` is a new object with new `metadata` + new `descriptionSegments`

---

### `tests/unit/backfill.test.ts` (NEW)

**Analog:** `tests/unit/exporter.test.ts` for the tmpdir+fs assertions pattern.

**Existing tmpdir helper (`tests/unit/exporter.test.ts:21-23`):**
```typescript
function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'km-core-exporter-'));
}
```
Phase 39 reuses verbatim (rename prefix to `km-core-backfill-`).

**Phase 39 boundary cases for backfill (RESEARCH §Pattern 5):**
- Idempotency: re-run on partially-stamped store skips entities with `validFrom`
- Resumability: drop in pre-existing checkpoint with `lastStampedId`; backfill skips up to that id
- Dry-run: `{ dryRun: true }` produces `{ scanned: N, stamped: 0, skipped: N }`; store NOT mutated; checkpoint NOT written
- Resolver invocation: only called for entities missing `validFrom`
- `legacyId` propagation: resolver-returned `legacyId` ends up on the persisted entity
- Synthetic `legacyProvenance` lands on `metadata.provenance.createdBy` with `provider: 'backfill'`
- Checkpoint atomic-rename: simulate crash (`SIGKILL` mid-write) — checkpoint file remains parseable as either the prior state OR the new state, never half-written. (Hard to test directly; verify temp-file naming convention via inspection of `*.tmp.*` files.)

---

## Shared Patterns

### Pattern S1: Options-object signature (CF-D14)

**Source:** `src/store/GraphKMStore.ts:143-173` (constructor takes `GraphKMStoreOptions`)
**Apply to:** Every new function/method in Phase 39 — `putEntity(entity, opts)`, `findByOntologyClass(cls, opts)`, `iterate(filter, opts)`, `backfillEntityDataModel(store, options)`, `batch(ops, opts?)`.

```typescript
async putEntity(
  e: Partial<Entity> & { name: string; entityType: string },
  opts?: { skipOntologyCheck?: boolean; provenance?: ProvenanceStamp },
): Promise<EntityId>
```

No positional args after the first business-domain payload. Mirrors Phase 37/38 across the board.

---

### Pattern S2: Writer-side stamping on the strict path only (CF-D10)

**Source:** `src/store/GraphKMStore.ts:299-330` (UUID stamp-or-keep precedent)
**Apply to:** `validFrom` stamping (D-31) + `EntityProvenance` assembly (D-32) — both gated by `if (!trusted)`.

```typescript
if (!trusted) {
  // existing: validator.validate(e.entityType)
  // existing: parseEntityId(e.id) if e.id supplied; else mintEntityId()
  // NEW: stamp validFrom + provenance
}
// then mergeNode, emit, scheduleExport
```

`skipOntologyCheck: true` bypass is preserved — backfill writes use this path with a pre-stamped entity.

---

### Pattern S3: Atomic two-write via existing `batch()` (CF-D17)

**Source:** `src/store/GraphKMStore.ts:438-482` (`batch(ops)` validate-all-first + apply-all)
**Apply to:** Supersession closure (D-33).

```typescript
// Inside putEntity, when supersedes is set on a new id:
await this.batch([
  { type: 'putEntity', entity: { ...old, validUntil: new.validFrom } },
  { type: 'putEntity', entity: newEntity },
]);
```
No new batch primitive needed. `batch()` already provides "all-or-nothing" atomicity.

---

### Pattern S4: Atomic temp+rename file write (CF-D29)

**Source:** `src/store/exporter.ts:216-227` (`writeAtomic(filePath, data)`)
**Apply to:** Backfill checkpoint write (`src/backfill/checkpoint.ts`).

```typescript
const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
await fs.promises.rename(tempPath, filePath); // atomic on POSIX
```

No partial writes survive a crash. Re-runs read the prior good checkpoint.

---

### Pattern S5: `process.stderr.write` warnings (no-console-log)

**Source:** `src/store/exporter.ts:112-114` (debounced-export failure warning)
**Apply to:** Three new warning sites in Phase 39.

```typescript
process.stderr.write(`[km-core/<module>] <human-readable message>\n`);
```

**Phase 39 warning catalog:**
- `[km-core/store] overwriting validUntil for ${oldId}` (D-33)
- `[km-core/segments] entity ${id} has ${n} descriptionSegments (>100, monitoring per D-41)` (D-41)
- `[km-core/segments] segment in entity ${id} has ${n} confirmations (>50, monitoring per D-41)` (D-41)
- `[km-core/backfill] dry-run: would stamp entity ${id} with validFrom=${ts}` (D-38)

Each line ends with `\n`. Format consistent with Phase 37/38 emissions.

---

### Pattern S6: ESM `.js` import suffix (CF-D06)

**Source:** Every Phase 37/38 file (e.g. `src/store/GraphKMStore.ts:63-82`)
**Apply to:** All new Phase 39 files (`src/backfill/index.ts`, `src/backfill/checkpoint.ts`, `src/segments/merge.ts`, test files).

```typescript
import { mintEntityId } from '../ids/mint.js';            // .js NOT .ts
import type { Entity } from '../types/entity.js';
import { GraphKMStore } from '../store/GraphKMStore.js';
```

NodeNext resolution. The TypeScript compiler accepts `.js` for sources that compile to `.js` — this is REQUIRED, not optional, in km-core's `tsconfig` setup.

---

### Pattern S7: ISO timestamp via `new Date().toISOString()` (Phase 37 convention)

**Source:** `src/store/GraphKMStore.ts:320` (`const now = new Date().toISOString()`)
**Apply to:** All Phase 39 timestamps — `validFrom`, `validUntil`, `EntityProvenance.lastConfirmedBy.timestamp`, `SegmentConfirmation.timestamp`, `Checkpoint.updatedAt`.

```typescript
const now = new Date().toISOString();
entity.validFrom = entity.validFrom ?? now;
entity.updatedAt = now;
```

Never use `Date.now()` (epoch ms number) for these — only for temp-file uniqueness suffixes.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every Phase 39 file has either a self-analog inside km-core (Phase 37/38) or a strict-superset analog in OKM. No greenfield surface. |

---

## Metadata

**Analog search scope:**
- `/Users/Q284340/Agentic/km-core/src/**` (Phase 37/38 self-analogs)
- `/Users/Q284340/Agentic/km-core/tests/**` (test patterns)
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/**` (OKM strict-superset baseline)

**Files scanned:** 12 (km-core src + tests + 1 OKM deduplicator file)

**Files read in full:**
- `~/Agentic/km-core/src/types/entity.ts` (151 lines)
- `~/Agentic/km-core/src/index.ts` (68 lines)
- `~/Agentic/km-core/src/store/types.ts` (30 lines)
- `~/Agentic/km-core/src/store/GraphKMStore.ts` (574 lines)
- `~/Agentic/km-core/src/store/exporter.ts` (228 lines)
- `~/Agentic/km-core/tests/unit/graph-store.test.ts` (269 lines)
- `~/Agentic/km-core/tests/unit/entity.test.ts` (68 lines)

**Files read targeted:**
- `~/Agentic/km-core/tests/unit/exporter.test.ts` (lines 1-60 — helper pattern)
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts` (lines 380-416 — `mergeDescriptionSegment`)

**Pattern extraction date:** 2026-05-20
