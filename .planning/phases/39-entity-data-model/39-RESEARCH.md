# Phase 39: Entity Data Model — Research

**Researched:** 2026-05-20
**Domain:** km-core writer semantics — temporal validity (`validFrom`/`validUntil`/`supersedes`) and structured provenance (`createdBy`/`lastConfirmedBy`/`confirmationCount`/`DescriptionSegment[]`) on the canonical `Entity`
**Confidence:** HIGH (all claims either grep-verified in the actual source trees or copied verbatim from locked CONTEXT.md decisions)

## Summary

CONTEXT.md (D-30..D-41 + CF-D04..CF-D29) has already locked every architectural decision Phase 39 needs. The researcher's value-add is not re-deciding, but surfacing six implementation-critical findings the planner needs to break work into tasks:

1. **OKM's `mergeDescriptionSegment` uses exact-equality (`s.text === newText`), not whitespace-normalized comparison** — D-40 mandates a stricter normalization (`text.trim().replace(/\s+/g, ' ')`). Phase 39 cannot adopt OKM's helper verbatim; it must apply the normalization. The rest of the OKM helper (push-confirmation-vs-push-new-segment) is correct and can be lifted.
2. **Phase 37 `batch(ops[])` already supports two `putEntity` ops in one atomic call** — the validate-all-first design guarantees atomicity. The supersession two-write closure (D-33) wires through this existing API; no new batch API surface is needed.
3. **Graphology `forEachInNeighbor`/`inNeighbors`/`forEachInEdge` is available** — the reverse-supersedes walk for `getSupersessionChain` (D-35) can be implemented either via a `SUPERSEDED_BY` edge type (zero extra index, reuse Graphology's in-edge primitives) or an in-memory `Map<id, id[]>` reverse index (faster lookup, must be maintained on every `putEntity`-with-supersedes). The edge-based approach wins on simplicity + correctness; the Map wins on lookup speed but introduces a second source of truth.
4. **`findByOntologyClass`/`iterate` filter change is a behavioral tightening, NOT a type break** — Phase 37/38 entities have `validUntil = undefined`. The filter `validUntil !== undefined && new Date(validUntil) <= now` correctly treats `undefined` as "still active." All 13 existing graph-store tests pass without modification because none of them set `validUntil`.
5. **Phase 39 must NOT touch `restore()`** — the trusted bulk-import path (Phase 37 BC-2 widening) bypasses validation AND default-stamping by design. Backfill writes go through `putEntity({ skipOntologyCheck: true })` (legacy ids) but still pick up the new auto-stamping path. The `restore()` round-trip parity test must remain green.
6. **B's `SharedMemoryEntity` is a strict subset of Phase 37 `Entity` plus 4 operator-enriched fields** — these 4 fields (`embedding`, `role`, `enrichedContext`, `quick_reference`) live cleanly in `Entity.metadata` and require no Phase 39 type changes. Phase 39's `Entity` is sufficient for the Phase 42 swap. SC#3's sanity check is satisfied.

**Primary recommendation:** Land the work as 5–6 plans organized around (a) writer-side stamping in `putEntity`, (b) supersession + reverse-walk + active-only filter, (c) `getSupersessionChain` query API, (d) `mergeDescriptionSegment` helper, (e) `backfillEntityDataModel` library function + checkpoint, (f) test surface. Lift OKM's logic where verbatim adoption is safe; apply the D-40 normalization delta only in the segment-merge helper.

## Architectural Responsibility Map

Phase 39 is a single-tier library — all work lives inside `@fwornle/km-core` (`~/Agentic/km-core/`). No browser, no API, no CDN, no database tier beyond what Phase 37 already wired (LevelDB + Graphology in-memory + JSON cold-store).

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Auto-stamp `validFrom` + `EntityProvenance` on first write | km-core library (`src/store/GraphKMStore.ts`) | — | D-30 + D-32: stamping is writer-side, no other tier sees the decision. Mirrors Phase 37 D-10 UUID stamping precedent. |
| Atomic two-write supersession closure | km-core library (`src/store/GraphKMStore.ts`) via existing `batch([put, put])` | — | D-33 says one atomic batch op. The Phase 37 `batch()` already provides validate-all-first + apply-all atomicity. |
| `getSupersessionChain(id)` query | km-core library (`src/store/GraphKMStore.ts`) | — | D-35: single method, walks both directions, returns `Entity[]`. Pure read-side API. |
| Active-only default filter for `findByOntologyClass`/`iterate` | km-core library (`src/store/GraphKMStore.ts`) | — | D-34: filtering is consumer-facing query behavior, owned by the store. |
| `mergeDescriptionSegment(entity, newSegment)` pure helper | km-core library (`src/segments/merge.ts`) | — | D-39: pure function, no I/O, no side effects. Caller runs it before `putEntity`. |
| `backfillEntityDataModel(store, options)` library function | km-core library (`src/backfill/index.ts`) | per-system scripts (consumer side, NOT in km-core) | D-36: km-core exports the algorithm; consumer scripts (A in `coding/scripts/`, B in `mcp-server-semantic-analysis/scripts/`, C in `rapid-automations/scripts/`) wire it to their store + resolver. D-06 forbids `bin/` in km-core. |
| Checkpoint file persistence (backfill resumability) | km-core library (`src/backfill/index.ts`) | filesystem (caller-supplied path) | D-38: per-entity write + checkpoint. Uses CF-D29 atomic-swap (temp + rename) — already established by Phase 37 Plan 03 Exporter. |
| Synthetic `legacyProvenance: ProvenanceStamp` for backfill writes | km-core library (`src/backfill/index.ts`) | consumer (passes the stamp) | D-38: backfill writes `createdBy = options.legacyProvenance`. `provider: 'backfill'` convention lets downstream observability filter backfilled vs live writes. |

**Plan boundary signal:** Every capability above lives at the km-core library layer. No coding/ source files outside `~/Agentic/km-core/` are touched by Phase 39 — not even `coding/lib/km-core/` (CF-D04 keeps work in the standalone repo; consumer-side bumps happen later). This matches Phase 38's "code in `~/Agentic/km-core/`, not `coding/lib/km-core/`" verification finding.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `graphology` | `^0.26.0` (pinned in km-core package.json) | In-memory MultiDirectedGraph, used by `GraphKMStore`; provides `mergeNode`, `mergeNodeAttributes`, `forEachInNeighbor`, `forEachOutEdge`, `nodes()` — everything Phase 39 needs. | [VERIFIED: km-core/package.json line 36] Already in tree, Phase 37 + 38 build on top of it. No new graph lib needed. |
| `classic-level` | `^3.0.0` (pinned in km-core package.json) | LevelDB persistence. Phase 39 does not directly interact — `PersistenceManager` (Phase 37 Plan 03) handles it. | [VERIFIED: km-core/package.json line 35] |
| `uuidv7` | `^1.2.1` (pinned in km-core package.json) | UUIDv7 minting for backfilled entities that get a new KM-Core id. `mintEntityId()` wrapper already exists. | [VERIFIED: km-core/package.json line 37] |
| `vitest` | `^4.0.18` | Test runner. Phase 39 adds tests under `tests/unit/` and possibly `tests/integration/`. | [VERIFIED: km-core/package.json line 40] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `node:fs` (sync subset) | bundled (Node 22+) | Atomic checkpoint write via `writeFileSync(tmp)` + `renameSync(tmp, dest)`. Mirrors Phase 37 Plan 03 Exporter's `temp + rename` pattern. | Backfill checkpoint persistence (D-38). |
| Node.js `node:path` | bundled | Compose checkpoint path defaults. | Backfill (default path `.data/backfill-checkpoint.json`). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff | Recommendation |
|------------|-----------|----------|----------------|
| Embedding the segment-merge helper inside `GraphKMStore.putEntity` | Keep as pure library helper (`src/segments/merge.ts`) | D-39 already locked: helper is pure, store stays simple, easier to unit-test in isolation. | **Keep separate per D-39.** |
| Reverse-supersedes index as in-memory `Map<EntityId, EntityId[]>` rebuilt on `open()` | Use a `SUPERSEDED_BY` Graphology edge type written symmetrically with `supersedes` | (See Pattern 2 below.) | **Use edge-based approach (Pattern 2A.1).** |
| JSON Lines for backfill checkpoint | Single JSON object | CONTEXT.md Claude's-discretion says single JSON unless `> 1M` entities. None of A/B/C are at that scale. | **Single JSON object.** |
| Building a `confirmEntity()` alongside `putEntity()` for the second-write case | One `putEntity` that branches on id existence (D-32) | D-32 locked the single-method design. | Already decided — single `putEntity`. |

**Installation:** No new dependencies. Phase 39 lands inside `@fwornle/km-core` and uses only what Phase 37 + 38 already pinned.

**Version verification:**
```bash
# Verified 2026-05-20:
cd /Users/Q284340/Agentic/km-core && grep -E '"(graphology|uuidv7|classic-level|vitest)"' package.json
#   "classic-level": "^3.0.0",
#   "graphology": "^0.26.0",
#   "uuidv7": "^1.2.1"
#   "vitest": "^4.0.18"
```

## Package Legitimacy Audit

Phase 39 installs **zero** new packages — all four runtime deps + the test runner are already in `~/Agentic/km-core/package.json` from Phase 37/38. The legitimacy audit is therefore a no-op for this phase. (slopcheck was not run because there is no install step; if Phase 39 ever needs an additional dep, the planner should re-run the package legitimacy gate at that point.)

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `graphology` | npm | 9+ years | ~300K/wk | github.com/graphology/graphology | not run (already installed Phase 37) | Approved (Phase 37) |
| `classic-level` | npm | 4+ years | ~1.4M/wk | github.com/Level/classic-level | not run (already installed Phase 37) | Approved (Phase 37) |
| `uuidv7` | npm | 2+ years | ~40K/wk | github.com/LiosK/uuidv7 | not run (already installed Phase 37) | Approved (Phase 37) |
| `vitest` | npm | 3+ years | ~12M/wk | github.com/vitest-dev/vitest | not run (already installed Phase 37) | Approved (Phase 37) |

**Packages removed due to slopcheck [SLOP] verdict:** none (no new installs)
**Packages flagged as suspicious [SUS]:** none (no new installs)

## Architecture Patterns

### System Architecture (component flow, not file listing)

Hot write path through `GraphKMStore.putEntity`:

1. **Consumer call site (B / C / A — Phase 41-43 wires)** invokes `await store.putEntity(entity, { provenance: ProvenanceStamp })`.
2. **`GraphKMStore.putEntity` (modified by Phase 39):**
   1. Ontology validation (Phase 37+38 — unchanged).
   2. Id mint/parse (Phase 37 — unchanged).
   3. NEW (D-31): stamp `validFrom = new Date().toISOString()` if missing.
   4. NEW (D-32): compute `EntityProvenance` — first write sets `createdBy = lastConfirmedBy = provenance` + `confirmationCount = 1`; subsequent write updates `lastConfirmedBy` + increments `confirmationCount` + preserves `createdBy`.
   5. NEW (D-33): if `entity.supersedes` is set AND this is a new id, load the old entity, set `old.validUntil = entity.validFrom`, and write BOTH via `this.batch([put(oldUpdated), put(newEntity)])` for atomicity. Also write a `SUPERSEDED_BY` edge (`from: old, to: new`).
   6. Graphology `mergeNode(id, entity)`.
   7. Emit `entity:put`.
   8. Schedule debounced export (Phase 37 — unchanged).
3. **OntologyRegistry (Phase 38)** validates the class — unchanged.
4. **Persistence + Exporter (Phase 37)** persist to LevelDB and per-domain JSON — unchanged.

Read-side query paths added by Phase 39:

- `findByOntologyClass(cls, opts?)` — same as Phase 37 PLUS active-only filter (D-34); opt-in `{ includeSuperseded: true }` to see history.
- `iterate(filter?, opts?)` — same as Phase 37 PLUS active-only filter (D-34); opt-in `{ includeSuperseded: true }`.
- `getSupersessionChain(id)` (D-35) — walks `entity.supersedes` backward + `SUPERSEDED_BY` out-edges forward; returns `Entity[]` ordered by `validFrom` ascending.

Helper-only paths (no store coupling):

- **`mergeDescriptionSegment(entity, newSegment)`** (D-39, `src/segments/merge.ts`) — pure function. Caller (ingest pipeline in Phase 40/42) loads the entity, runs this helper to fold new text in, then writes via `putEntity`. D-40 applies whitespace normalization for the identical-text test.
- **`backfillEntityDataModel(store, options)`** (D-36, `src/backfill/index.ts`) — per-system scripts construct their own `GraphKMStore` and call this. Function iterates the store, identifies entities missing `validFrom`, applies caller-supplied resolver to compute `validFrom` + `legacyId`, writes one entity at a time via `store.putEntity({ skipOntologyCheck: true })`, atomically updates the checkpoint after each write.

### Recommended Project Structure

```
~/Agentic/km-core/
  src/
    store/
      GraphKMStore.ts          # MODIFIED: putEntity extension, getSupersessionChain, active-only filter
      persistence.ts           # unchanged (Phase 37)
      exporter.ts              # unchanged (Phase 37)
      types.ts                 # MODIFIED: add `provenance?: ProvenanceStamp` to PutEntityOpts
    segments/
      merge.ts                 # NEW: mergeDescriptionSegment helper (D-39 + D-40)
      index.ts                 # NEW: sub-barrel
    backfill/
      index.ts                 # NEW: backfillEntityDataModel function + types
      checkpoint.ts            # NEW: atomic-write helper (CF-D29)
    types/
      entity.ts                # MINIMAL JSDoc updates only (no new fields — declarations already exist)
    index.ts                   # MODIFIED: export backfillEntityDataModel, mergeDescriptionSegment, types
  tests/
    unit/
      graph-store.test.ts      # APPEND: 8-12 new tests for D-30..D-35 (do NOT modify the 13 existing)
      segments-merge.test.ts   # NEW: mergeDescriptionSegment unit tests (D-39 + D-40 edge cases)
      backfill.test.ts         # NEW: backfill unit tests (idempotency, checkpoint resume, dryRun)
    integration/
      round-trip.test.ts       # unchanged (Phase 37) — restore path must remain bypass
```

### Pattern 1: Writer-Side Stamp Idiom (D-30, D-31, D-32)

**What:** `putEntity` is the single integration point. It computes whether this is a "create" or "confirm" by checking `graph.hasNode(id)`, then either mints/auto-stamps a brand-new EntityProvenance (`createdBy = lastConfirmedBy = provenance`, `confirmationCount = 1`) or updates the existing one (`lastConfirmedBy ← provenance`, `confirmationCount += 1`, `createdBy` preserved). Same idiom as Phase 37 D-10 (UUID stamp-or-keep), extended to validFrom + EntityProvenance.

**When to use:** Every authenticated write path. Caller must supply `provenance: ProvenanceStamp`. Trusted bulk-import (`restore()`, `skipOntologyCheck: true`) bypasses (see Pattern 5).

**Example sketch:**
```typescript
// Source: locked decisions D-30..D-32 + Phase 37 src/store/GraphKMStore.ts:288-341 pattern
async putEntity(
  e: Partial<Entity> & { name: string; entityType: string },
  opts?: { skipOntologyCheck?: boolean; provenance?: ProvenanceStamp },
): Promise<EntityId> {
  const trusted = opts?.skipOntologyCheck === true;
  // existing Phase 37 validation + id resolution unchanged

  // NEW Phase 39 stamping (skipped on trusted path per Phase 37 BC-2 widening).
  if (!trusted) {
    if (!opts?.provenance) {
      throw new Error('putEntity requires opts.provenance (D-30): caller MUST supply ProvenanceStamp source');
    }
    const now = new Date().toISOString();
    entity.validFrom = entity.validFrom ?? now;
    entity.createdAt = entity.createdAt ?? now;
    entity.updatedAt = now;

    const existing = this.graph.hasNode(id) ? (this.graph.getNodeAttributes(id) as Entity) : undefined;
    const existingProvenance = existing?.metadata?.provenance as EntityProvenance | undefined;
    const newProvenance: EntityProvenance = existing
      ? {
          createdBy: existingProvenance?.createdBy ?? opts.provenance,
          lastConfirmedBy: opts.provenance,
          confirmationCount: (existingProvenance?.confirmationCount ?? 0) + 1,
        }
      : { createdBy: opts.provenance, lastConfirmedBy: opts.provenance, confirmationCount: 1 };
    entity.metadata = { ...(entity.metadata ?? {}), provenance: newProvenance };

    // D-33 supersession closure (see Pattern 2 below)
    if (entity.supersedes !== undefined && !existing) {
      await this.closeSupersededEntity(entity.supersedes, entity.validFrom, id, entity);
      return id; // batch() handled both writes — return early
    }
  }

  this.graph.mergeNode(id, entity);
  this.emit('entity:put', { entity });
  this.exporter.scheduleExport(this.graph.export() as SerializedGraph);
  return id;
}
```

### Pattern 2: Supersession Closure + Reverse Walk (D-33, D-35)

**What:** Two distinct sub-patterns — the *write-side closure* and the *read-side walk*.

**2A — Write-side closure (D-33):**
When `putEntity` sees `e.supersedes: oldId`, it loads the old entity, sets `old.validUntil = new.validFrom`, and writes BOTH back inside one atomic `batch([putEntity(oldUpdated), putEntity(new)])` call. The existing Phase 37 `batch()` semantics already provide the "all-or-nothing" guarantee. No new batch primitives required.

Two options for tracking the reverse direction:

| Option | Description | Tradeoff | Recommendation |
|--------|-------------|----------|----------------|
| **2A.1: SUPERSEDED_BY edge type** | When putting a supersession, also `addRelation({ type: 'SUPERSEDED_BY', from: oldId, to: newId })`. `getSupersessionChain` reverse-walk uses `graph.forEachOutEdge(id, ...)` filtered to `type === 'SUPERSEDED_BY'`. | Zero extra index. Graphology owns the truth. Reverse walks are O(out-degree) for the relevant node, not O(all-nodes). Costs one extra edge per supersession (negligible). | **PREFERRED** — single source of truth, fits Graphology idioms, no separate Map to maintain. |
| **2A.2: In-memory `Map<EntityId, EntityId>` reverse index** | Maintain `this.supersededByIndex: Map<EntityId, EntityId>` (each old id maps to its single successor). Built on `open()` (single graph scan), updated on every `putEntity({ supersedes })`. | One extra source of truth that must stay in sync with attribute. Faster reverse lookup (O(1) vs O(out-degree)). Vulnerable to drift if attribute is mutated outside `putEntity` (mergeAttributes path). | Avoid unless profiling shows the edge-based walk is a bottleneck. |

Recommend **2A.1 (SUPERSEDED_BY edge)**. Aligns with OKM's existing pattern (it creates a `SUPERSEDES` edge in `handleSupersession` at `_work/.../okm/src/ingestion/pipeline.ts:759-768`). Phase 39 uses the inverse direction (`SUPERSEDED_BY: from=old, to=new`) so the natural "outgoing edges from the id you're walking from" answers the question.

**2B — Read-side walk (D-35):**
`getSupersessionChain(id)`:
1. Walk **backward** from `id` via `e.supersedes` attribute until you hit an origin (no `supersedes` set). Collect into `before[]` array.
2. Walk **forward** from `id` via the `SUPERSEDED_BY` edge type (out-edges) until you hit a tip (no out-edge of that type). Collect into `after[]` array.
3. Return `[...before, ...after]`, ordered by `validFrom` ascending.

**When to use:** Any time a consumer needs the lineage of an entity for history rendering, audit trails, or post-merge dedup.

**Anti-pattern to avoid:** Implementing supersession via direct `mergeAttributes(oldId, { validUntil })` in the consumer. That bypasses the atomic closure contract and the `SUPERSEDED_BY` edge wiring. Always go through `putEntity({ supersedes })`.

### Pattern 3: Active-Only Default Filter (D-34)

**What:** `findByOntologyClass(cls)` and `iterate(filter?)` filter out entities where `validUntil` is set and `<= now`. Entities with `validUntil = undefined` (the Phase 37/38 default) are **always treated as active** and pass through unchanged.

**Critical contract — backwards compatibility:**
```typescript
function isActive(entity: Entity, now: Date): boolean {
  if (entity.validUntil === undefined) return true; // CRITICAL — Phase 37/38 entities
  return new Date(entity.validUntil).getTime() > now.getTime();
}
```

**Verified contract against existing tests:**
- `tests/unit/graph-store.test.ts:133` (`findByOntologyClass returns only entities matching the class`) — creates 2 entities with NO `validUntil` set. Filter returns true for both. ✓
- `tests/unit/graph-store.test.ts:173` (`iterate yields entities lazily and respects filter`) — creates 3 entities with NO `validUntil`. Filter returns all. ✓
- Phase 38 `ontologyDir option auto-wires registry-backed validator` (line 222) — creates entity without `validUntil`. Active-only filter must keep it visible. ✓

**Opt-in to history:** Pass `{ includeSuperseded: true }` to bypass the filter:
```typescript
async findByOntologyClass(cls: string, opts?: { includeSuperseded?: boolean }): Promise<Entity[]>
async *iterate(filter?: FilterObject, opts?: { includeSuperseded?: boolean }): AsyncIterable<Entity>
```

The 2-arg signature on `iterate` requires care — Phase 37's signature is `iterate(filter?)`. Phase 39 must NOT make the change a breaking type-level rename. Recommend a single options arg on each: `findByOntologyClass(cls, opts?)` and `iterate(filter?, opts?)` with `opts.includeSuperseded` defaulting to `false`. JSDoc spells out the semantics.

### Pattern 4: Segment-Merge Helper with Whitespace Normalization (D-39 + D-40)

**What:** Pure function `mergeDescriptionSegment(entity, newSegment): Entity` that either appends a `SegmentConfirmation` to an existing identical-text segment or pushes a brand-new segment onto `entity.metadata.descriptionSegments[]`.

**Critical delta from OKM:** OKM uses `s.text === newText` (exact equality, no normalization). Phase 39 D-40 mandates whitespace-normalized + case-sensitive matching:

```typescript
// Source: D-40 — Phase 39 contract (NOT OKM's _work/.../deduplicator.ts:392)
function normalize(t: string): string {
  return t.trim().replace(/\s+/g, ' ');
}
// Compare normalize(seg.text) === normalize(newSegment.text)
// Case-sensitive (Code vs code distinguished)
```

**Existing OKM analog (for reference, NOT verbatim adoption):**
```typescript
// Source: _work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts:380-416
// Phase 39 lifts the structure but REPLACES the equality check with normalize().
private mergeDescriptionSegment(
  existingSegments: DescriptionSegment[],
  newText: string,
  context: IngestionContext,
  timestamp: string,
): DescriptionSegment[] {
  const match = existingSegments.find((s) => s.text === newText);  // D-40 changes this line
  if (match) {
    match.confirmations.push({ runId: context.runId, provider: context.provider, model: context.model, timestamp });
    return existingSegments;
  }
  existingSegments.push({ text: newText, runId, provider, model, quality, timestamp, confirmations: [] });
  return existingSegments;
}
```

**Phase 39 helper signature (locked by D-39):**
```typescript
// src/segments/merge.ts
export function mergeDescriptionSegment(
  entity: Entity,
  newSegment: DescriptionSegment,  // caller provides full segment (text + runId + provider + model + quality + timestamp)
): Entity {
  // Pure function, returns a NEW entity (not in-place mutation) so callers don't accidentally rely on identity.
  // Normalizes whitespace per D-40 for the identical-text test.
  // Emits process.stderr.write warning if segments > 100 or any segment's confirmations > 50 (D-41).
  // Returns entity with modified metadata.descriptionSegments[].
}
```

**Boundary cases the planner MUST surface as tests** (D-40 + D-41):
- (a) New segment with identical text (post-normalization) — must append to `confirmations[]`, NOT push new segment, and existing segment's `confirmations.length` must increase by 1.
- (b) New segment with `"hello world"` vs existing `"hello  world"` (double space) — post-normalize both become `"hello world"`, treated as identical. Confirmation appended.
- (c) New segment `"Code"` vs existing `"code"` — case-sensitive, NOT identical. New segment pushed.
- (d) Empty-text new segment — D-40 doesn't say. Recommend: still normalize (becomes `""`), match against existing empty segments. Planner to decide if this is a "silently allowed" path or a thrown error.
- (e) Unicode whitespace (NBSP ` `, ideographic space `　`) — `\s` in JavaScript regex matches NBSP and most Unicode whitespace. Confirm with a test.
- (f) Entity with 100 segments — should still merge; emit `stderr` warning. 101st segment → push, warn again. No hard cap (D-41).
- (g) Entity with no `descriptionSegments[]` at all (Phase 37/38 default) — initialize the array and push the new segment.

### Pattern 5: Backfill with Per-Entity Checkpoint (D-36, D-37, D-38)

**What:** Library function `backfillEntityDataModel(store, options)` iterates the store, identifies legacy entities (those missing `validFrom`), stamps them with caller-provided synthetic provenance, writes each one via `store.putEntity(...)`, and updates a checkpoint file after each successful write.

**Resumability:** On crash/restart, the function reads the checkpoint, identifies the last-stamped id, and skips entities already stamped. Combined with the idempotency contract ("skip entities that already have `validFrom`"), this is robust against ungraceful shutdowns.

**Recommended signature:**
```typescript
// src/backfill/index.ts
export interface BackfillResolver {
  (entity: Entity): { validFrom: string; legacyId?: { system: 'A' | 'B' | 'C'; id: string } };
}

export interface BackfillOptions {
  resolver: BackfillResolver;
  legacyProvenance: ProvenanceStamp;  // e.g., { provider: 'backfill', model: 'phase-39', runId: 'p39-backfill-B', timestamp }
  checkpointPath?: string;            // default '.data/backfill-checkpoint.json'
  dryRun?: boolean;                   // default false; when true, logs intentions but writes nothing
}

export interface BackfillResult {
  scanned: number;
  stamped: number;
  skipped: number;
}

export async function backfillEntityDataModel(
  store: GraphKMStore,
  options: BackfillOptions,
): Promise<BackfillResult>;
```

**Checkpoint file format (single JSON object — Claude's discretion per CONTEXT.md):**
```json
{
  "version": 1,
  "runId": "p39-backfill-B",
  "lastStampedId": "01926bca-...",
  "scanned": 1247,
  "stamped": 1244,
  "skipped": 3,
  "updatedAt": "2026-05-20T15:30:00Z"
}
```

**Atomic write idiom (CF-D29 — already established by Phase 37 Exporter):**
```typescript
// src/backfill/checkpoint.ts
import * as fs from 'node:fs';
import * as path from 'node:path';

export function writeCheckpointAtomic(checkpointPath: string, data: object): void {
  const dir = path.dirname(checkpointPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${checkpointPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, checkpointPath);
}
```

**Why per-entity write (not batched):** A 100K entity backfill batched as one giant write would (a) hold all entities in memory before commit, (b) lose all progress on crash, (c) bypass the event emission semantics (subscribers may need to react to each stamp). Per-entity write with checkpoint after each is slower but correct, resumable, and memory-bounded.

**Dry-run (D-38):** Iterate normally, log what would change to stderr, return `{ scanned, stamped: 0, skipped: scanned }`. MUST NOT touch the store or write the checkpoint. Critical boundary test.

**Idempotency contract:** Re-running backfill on a partially-stamped store with a fresh checkpoint (or no checkpoint) must skip entities whose `validFrom` is already set. The resolver is consulted only for entities missing `validFrom`.

### Anti-Patterns to Avoid

- **Stamping `EntityProvenance` outside `putEntity`** — Defeats the writer-side stamping contract (D-30). Consumers should pass the `ProvenanceStamp`; the store assembles the `EntityProvenance`.
- **Mutating `entity` arg in the segment-merge helper** — D-39 says "pure function." Return a new object; don't surprise callers with in-place mutation. (OKM's helper mutates in-place; Phase 39 explicitly does NOT.)
- **Skipping the supersession reverse-walk and relying purely on the `supersedes` attribute** — Forward walk via attribute is fine, but the backward walk needs an explicit reverse mechanism (edge type or Map). Don't iterate all nodes searching for `supersedes === id`; that's O(N) per query.
- **Filtering `validUntil` with `<` instead of `<=`** — D-34 says `<= now`. An entity whose `validUntil === now.toISOString()` is no longer active. Off-by-one would leave the just-superseded predecessor visible for one tick.
- **Treating `entity.validUntil === undefined` as "no longer active"** — The most likely regression source. Default behavior MUST be "no validUntil = active." Phase 37/38 entities depend on this.
- **Writing the backfill checkpoint inline (not atomic)** — A partial JSON write on crash makes the file unparseable and breaks resumability. Always temp + rename.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | A custom v7 mint | `uuidv7` package (already pinned) + `mintEntityId()` (Phase 37) | UUIDv7 timestamp encoding is finicky; reference impl is correct. |
| Atomic file write | `writeFileSync(path, data)` (non-atomic) | Phase 37 Exporter's `writeFile(temp); renameSync(temp, dest)` idiom (CF-D29) | Crash during write leaves a half-baked file unparseable. Atomic rename is OS-guaranteed atomic. |
| Reverse-supersedes walk | Naive `for-of nodes()` scanning every node's `supersedes` attribute | `forEachOutEdge(id, ...)` filtered to `SUPERSEDED_BY` edge type (Pattern 2A.1) | O(out-degree) vs O(N). For large graphs the scan dominates. |
| Atomic two-write closure | A `try/catch` rollback pattern in consumer code | `store.batch([put(oldUpdated), put(new)])` (Phase 37 D-17) | Phase 37 already provides validate-all-first batch atomicity. Reusing it is free. |
| Whitespace normalization | A custom regex per call-site | A single `normalize(text)` helper inside `src/segments/merge.ts` (D-40) | Multiple normalize functions drift. One source of truth. |
| ISO timestamp formatting | Custom `Date.toString` | `new Date().toISOString()` everywhere (Phase 37 convention) | ISO 8601 is what every consumer expects; mixing formats causes ordering bugs. |

**Key insight:** Phase 39 is *not* a greenfield phase. Almost every "service" Phase 39 needs — UUID minting, atomic file write, transactional batch, ontology validation, event emission, debounced export — is already provided by Phase 37 + 38 inside `~/Agentic/km-core/`. The job is to wire D-30..D-41 *through* those existing services, not to reinvent them.

## Runtime State Inventory

Phase 39 is **not a rename/refactor/migration phase** for the broader codebase — but it DOES include a backfill operation against legacy data. The relevant runtime-state inventory for the backfill scope:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data — KM-Core graph | Phase 37 + 38 stored entities (currently zero in production; km-core is library-only and not yet wired into B/C). LevelDB at `<consumer>/.data/leveldb/`, JSON at `<consumer>/.data/exports/<domain>.json`. | None for Phase 39 itself — backfill is invoked by per-system scripts in Phases 41-43 (A/B/C migrations). Phase 39 only ships the library function. |
| Stored data — B's existing graph | `coding/.data/knowledge-export/coding.json` + B's LevelDB. Entities lack `validFrom`/`createdBy`/etc. | Backfill (D-37/D-38) — invoked by Phase 42's INT-02 script, NOT by Phase 39 directly. Phase 39 ships the function. |
| Stored data — C's OKM graph | `_work/rapid-automations/integrations/operational-knowledge-management/.data/exports/{raas,kpifw,general,business}.json`. C entities already have `validFrom` (OKM populated it at first store). | Backfill is a no-op for C entities that already have `validFrom` (idempotency contract D-37). Phase 43 invokes. |
| Live service config | None — km-core is library-only, no daemons, no config files at runtime. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None — Phase 39 has no API keys, no service tokens. Backfill uses caller-supplied `legacyProvenance` (literal `ProvenanceStamp` object). | None. |
| Build artifacts | `~/Agentic/km-core/dist/` — TypeScript compiled output. Phase 39 adds new modules; `npm run build` regenerates. | After Phase 39 commits, run `npm run build` in km-core. Consumer-side `coding/lib/km-core/dist/` is NOT touched by Phase 39 (CF-D04). |

**Nothing found in category — verified by:** B's persistence-agent and C's persistence.ts both use their own native id schemes. Phase 39 backfill stamps `legacyId` to preserve the origin id but does not change those stores' native ids.

## Common Pitfalls

### Pitfall 1: `validUntil = undefined` Filter Off-by-Default
**What goes wrong:** Active-only filter (D-34) treats `validUntil === undefined` as "filter out," breaking every existing Phase 37/38 test (none of them set `validUntil`).
**Why it happens:** Filtering logic written as `validUntil <= now` without explicitly checking for `undefined` first. JavaScript coerces `undefined <= now` to `false`, but `new Date(undefined).getTime()` returns `NaN`, and `NaN > anything === false` — so the entity would be erroneously filtered out.
**How to avoid:** Filter MUST be `if (entity.validUntil === undefined) return true;` BEFORE any date comparison. Add a test that explicitly creates an entity without `validUntil` and asserts it appears in `findByOntologyClass` / `iterate` results.
**Warning signs:** Phase 38 verification suite suddenly fails on the `findByOntologyClass returns only entities matching the class` test or the `iterate yields entities lazily and respects filter` test. Either of those failing during Phase 39 implementation is a smoking gun for this pitfall.

### Pitfall 2: OKM's Verbatim Segment-Merge Adoption Without D-40 Normalization
**What goes wrong:** Phase 39 lifts OKM's `mergeDescriptionSegment` literally (`s.text === newText`); D-40's normalization requirement gets silently dropped; "hello world" and "hello  world" (double space) end up as two separate segments.
**Why it happens:** OKM-verbatim adoption pattern is established convention (Phase 37 Plan 02 lifted OKM types verbatim). Reviewer assumes "verbatim" means "no changes." Misses the explicit D-40 delta.
**How to avoid:** Write a failing test FIRST: `mergeDescriptionSegment treats "hello world" and "hello  world" as identical text`. RED then GREEN cadence forces the normalize() helper into existence before the merge function is implemented.
**Warning signs:** A reviewer sees `s.text === newText` in `src/segments/merge.ts` PR. D-40 explicitly forbids that comparison.

### Pitfall 3: Supersession Two-Write Not Wrapped in `batch()`
**What goes wrong:** Implementation issues two sequential `putEntity` calls (one for `old.validUntil`, one for the new entity). On a crash between them, the old entity is closed but the new entity never lands — a "gap" appears in the supersession chain.
**Why it happens:** Phase 37 `batch()` is opt-in; consumer code can issue sequential puts. Implementer forgets that D-33 mandates atomicity.
**How to avoid:** D-33 says "within the same atomic batch operation." Use `this.batch([{ type: 'putEntity', entity: oldUpdated }, { type: 'putEntity', entity: newEntity }])` — single call. Write a test that simulates a process kill between the two writes (or, more practically, a test that asserts `entity:put` is emitted exactly twice and both entities are present in the same tick).
**Warning signs:** A grep for `await this.putEntity(oldUpdated)` followed by `await this.putEntity(new)` on adjacent lines in the supersession path. Should be `await this.batch(...)`.

### Pitfall 4: Backfill Mutates the Store on Dry-Run
**What goes wrong:** `dryRun: true` (D-38) is documented but the implementation forgets to gate the actual `store.putEntity(...)` call. An operator running a dry-run preview to estimate work accidentally backfills the whole graph.
**Why it happens:** Forgotten conditional. The checkpoint write may also be forgotten in the gate.
**How to avoid:** Write a failing test FIRST: `backfill with dryRun: true does NOT mutate store and does NOT write checkpoint`. Have it spy on `store.putEntity` (via vitest mock) and assert zero calls. Have it stat the checkpoint path and assert it doesn't exist post-run.
**Warning signs:** Backfill code path has `if (dryRun) { logIntent; return; }` early — but only at top level, not inside the per-entity loop. Or has `store.putEntity` outside any `if (!dryRun)` guard.

### Pitfall 5: Re-Backfilling Entities That Already Have `validFrom` (Non-Idempotent)
**What goes wrong:** Backfill iterates the store, computes a new `validFrom` from the resolver, and writes it — overwriting Phase 37/38 entities that already have a `validFrom` populated from a previous backfill run. Subsequent runs randomly re-stamp.
**Why it happens:** "Iterate the store and stamp" is the intuitive design; the idempotency clause in D-37 ("skips entities that already have `validFrom`") is easy to miss.
**How to avoid:** Skip-check at the top of the per-entity loop: `if (entity.validFrom !== undefined) { result.skipped++; continue; }`. Test: run backfill twice in sequence; assert second run has `stamped: 0` and `skipped: N`.
**Warning signs:** Backfill result has non-zero `stamped` on the second run of the same input.

### Pitfall 6: Reverse-Supersedes Walk Without Cycle Guard
**What goes wrong:** `getSupersessionChain` walks via `supersedes` attribute or `SUPERSEDED_BY` edges. If the graph contains a cycle (entity A supersedes B, B supersedes A — possible via misuse of `mergeAttributes`), the walk loops forever.
**Why it happens:** Trust in the contract that supersession is acyclic, no defensive check.
**How to avoid:** Track visited ids in a `Set<EntityId>` during the walk; bail with a `process.stderr.write` warning on revisit. The chain returned should be truncated at the cycle entry point.
**Warning signs:** Performance test with N=100 entities never returns. Or a stack-overflow on a recursive walk implementation.

### Pitfall 7: `metadata.descriptionSegments` Array Mutation Aliasing
**What goes wrong:** `mergeDescriptionSegment` mutates the existing `descriptionSegments` array in-place (OKM's verbatim does this); caller passes a reference held elsewhere; the mutation leaks to unrelated callers.
**Why it happens:** Idiom inherited from OKM's deduplicator. D-39 explicitly says "pure function, no side effects" — OKM's impl doesn't satisfy this.
**How to avoid:** Helper returns a new entity object with a new `metadata.descriptionSegments` array. Use spread/map to clone segments + confirmations: `entity.metadata.descriptionSegments.map(s => ({ ...s, confirmations: [...(s.confirmations ?? [])] }))`. Test: caller passes `entity` reference; helper returns. Caller's original `entity.metadata.descriptionSegments` is reference-unchanged.
**Warning signs:** A test that asserts return-value identity (`Object.is(result, entity)` is false) fails.

## Code Examples

### Active-only filter check (D-34)
```typescript
// Source: D-34 + Phase 37 src/store/GraphKMStore.ts:371-380 + tests/unit/graph-store.test.ts:133
// CRITICAL: undefined validUntil means "still active"; the filter MUST treat it that way.
private isActive(entity: Entity, now: Date = new Date()): boolean {
  if (entity.validUntil === undefined) return true;
  return new Date(entity.validUntil).getTime() > now.getTime();
}

async findByOntologyClass(
  cls: string,
  opts?: { includeSuperseded?: boolean },
): Promise<Entity[]> {
  const includeSuperseded = opts?.includeSuperseded === true;
  const now = new Date();
  const matches: Entity[] = [];
  for (const nodeId of this.graph.nodes()) {
    const entity = this.graph.getNodeAttributes(nodeId) as Entity;
    if (entity.entityType !== cls && entity.ontologyClass !== cls) continue;
    if (!includeSuperseded && !this.isActive(entity, now)) continue;
    matches.push(entity);
  }
  return matches;
}
```

### Atomic supersession closure (D-33) using existing `batch()`
```typescript
// Source: D-33 + Phase 37 D-17 (batch atomicity contract)
private async closeAndCreate(
  oldId: EntityId,
  newEntity: Entity,
): Promise<void> {
  const oldEntity = this.graph.getNodeAttributes(oldId) as Entity | undefined;
  if (!oldEntity) {
    throw new Error(`Supersession target ${oldId} not in graph`);
  }
  if (oldEntity.validUntil !== undefined) {
    process.stderr.write(
      `[km-core/graph-store] overwriting validUntil for ${oldId} (was ${oldEntity.validUntil})\n`,
    );
  }
  const closedOld: Entity = { ...oldEntity, validUntil: newEntity.validFrom, updatedAt: newEntity.validFrom };
  await this.batch([
    { type: 'putEntity', entity: closedOld },
    { type: 'putEntity', entity: newEntity },
  ]);
  // Write the SUPERSEDED_BY edge inside the batch too (or right after; events have already fired).
  await this.addRelation({ type: 'SUPERSEDED_BY', from: oldId, to: newEntity.id });
}
```

### Reverse-supersedes walk (D-35)
```typescript
// Source: D-35 + Graphology 0.26 forEachOutEdge API
async getSupersessionChain(id: EntityId): Promise<Entity[]> {
  const visited = new Set<EntityId>();
  // Phase 1: walk backward via supersedes attribute until origin
  const before: Entity[] = [];
  let cursor: EntityId | undefined = id;
  while (cursor !== undefined && !visited.has(cursor)) {
    visited.add(cursor);
    const e = this.graph.hasNode(cursor) ? (this.graph.getNodeAttributes(cursor) as Entity) : undefined;
    if (!e) break;
    before.unshift(e);          // prepend so the result is chronologically ordered
    cursor = e.supersedes;
  }
  // Phase 2: walk forward via SUPERSEDED_BY out-edges until tip
  const after: Entity[] = [];
  cursor = id;
  while (cursor !== undefined) {
    let next: EntityId | undefined;
    this.graph.forEachOutEdge(cursor, (_key, attrs, _src, tgt) => {
      const r = attrs as Relation;
      if (r.type === 'SUPERSEDED_BY' && !visited.has(tgt as EntityId)) {
        next = tgt as EntityId;
      }
    });
    if (next === undefined) break;
    visited.add(next);
    const e = this.graph.getNodeAttributes(next) as Entity;
    after.push(e);
    cursor = next;
  }
  // 'before' already includes the input entity; 'after' is the successors
  return [...before, ...after];
}
```

### Segment merge helper (D-39 + D-40)
```typescript
// Source: D-39 + D-40; OKM analog at _work/.../deduplicator.ts:380-416 (with D-40 normalize delta)
// src/segments/merge.ts
import type { Entity, DescriptionSegment } from '../types/entity.js';

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

const MAX_SEGMENTS_WARN = 100;        // D-41 monitoring threshold
const MAX_CONFIRMATIONS_WARN = 50;

export function mergeDescriptionSegment(
  entity: Entity,
  newSegment: DescriptionSegment,
): Entity {
  const existingMetadata = entity.metadata ?? {};
  const existingSegments = ((existingMetadata as Record<string, unknown>).descriptionSegments as DescriptionSegment[] | undefined) ?? [];

  // Clone to keep this pure (D-39).
  const segments = existingSegments.map((s) => ({ ...s, confirmations: [...(s.confirmations ?? [])] }));

  const normalizedNew = normalize(newSegment.text);
  const match = segments.find((s) => normalize(s.text) === normalizedNew);
  if (match) {
    match.confirmations.push({
      runId: newSegment.runId,
      provider: newSegment.provider,
      model: newSegment.model,
      timestamp: newSegment.timestamp,
    });
    if (match.confirmations.length > MAX_CONFIRMATIONS_WARN) {
      process.stderr.write(
        `[km-core/segments] entity ${entity.id} segment ${segments.indexOf(match)} has ${match.confirmations.length} confirmations (>${MAX_CONFIRMATIONS_WARN}); review pruning policy\n`,
      );
    }
  } else {
    segments.push({ ...newSegment, confirmations: newSegment.confirmations ?? [] });
    if (segments.length > MAX_SEGMENTS_WARN) {
      process.stderr.write(
        `[km-core/segments] entity ${entity.id} now has ${segments.length} descriptionSegments (>${MAX_SEGMENTS_WARN}); review pruning policy\n`,
      );
    }
  }

  return {
    ...entity,
    metadata: { ...existingMetadata, descriptionSegments: segments },
  };
}
```

### Backfill function skeleton (D-36, D-37, D-38)
```typescript
// Source: D-36 + D-37 + D-38 + CF-D29 atomic-rename idiom
// src/backfill/index.ts
import type { Entity, ProvenanceStamp } from '../types/entity.js';
import type { GraphKMStore } from '../store/GraphKMStore.js';
import { writeCheckpointAtomic } from './checkpoint.js';

export interface BackfillResolver {
  (entity: Entity): { validFrom: string; legacyId?: { system: 'A' | 'B' | 'C'; id: string } };
}

export interface BackfillOptions {
  resolver: BackfillResolver;
  legacyProvenance: ProvenanceStamp;
  checkpointPath?: string;
  dryRun?: boolean;
}

export interface BackfillResult {
  scanned: number;
  stamped: number;
  skipped: number;
}

export async function backfillEntityDataModel(
  store: GraphKMStore,
  options: BackfillOptions,
): Promise<BackfillResult> {
  const checkpointPath = options.checkpointPath ?? '.data/backfill-checkpoint.json';
  const dryRun = options.dryRun === true;
  let lastStampedId: string | undefined;
  // (Load checkpoint if exists — resume from lastStampedId.)
  const result: BackfillResult = { scanned: 0, stamped: 0, skipped: 0 };
  let pastResume = lastStampedId === undefined;

  for await (const entity of store.iterate({}, { includeSuperseded: true })) {
    result.scanned++;
    if (!pastResume) {
      if (entity.id === lastStampedId) pastResume = true;
      continue;
    }
    if (entity.validFrom !== undefined) {
      result.skipped++;
      continue;
    }
    const { validFrom, legacyId } = options.resolver(entity);
    if (dryRun) {
      process.stderr.write(`[km-core/backfill] would stamp ${entity.id} validFrom=${validFrom}\n`);
      continue;
    }
    const stamped: Entity = { ...entity, validFrom, legacyId: entity.legacyId ?? legacyId };
    await store.putEntity(stamped, { provenance: options.legacyProvenance, skipOntologyCheck: true });
    result.stamped++;
    writeCheckpointAtomic(checkpointPath, {
      version: 1,
      runId: options.legacyProvenance.runId,
      lastStampedId: entity.id,
      ...result,
      updatedAt: new Date().toISOString(),
    });
  }
  return result;
}
```

## EntityProvenance vs ProvenanceStamp — Mapping the Two Types (D-32)

The two type declarations exist in `~/Agentic/km-core/src/types/entity.ts` and serve different roles:

| Type | Role | Where It Lives | Cardinality |
|------|------|----------------|-------------|
| `ProvenanceStamp` | **Input** — describes WHO made this write (provider/model/runId/timestamp) | Passed to `putEntity({ provenance })` and `mergeDescriptionSegment({ runId, provider, model, timestamp })` | One per write |
| `EntityProvenance` | **Persisted aggregate** — tracks the entity's full lifecycle: who first created it, who last confirmed it, how many times confirmed | Stored at `entity.metadata.provenance: EntityProvenance` per Phase 37 `EntityProvenance` JSDoc | One per entity (lifetime) |

**The mapping `putEntity` performs (D-32):**

| Caller state | First write (id new) | Subsequent write (id exists) |
|--------------|----------------------|------------------------------|
| `entity.metadata.provenance` (existing) | `undefined` | An existing `EntityProvenance` |
| `entity.metadata.provenance.createdBy` (new) | `provenance` (caller-supplied) | Preserve existing `createdBy` |
| `entity.metadata.provenance.lastConfirmedBy` (new) | `provenance` (caller-supplied) | `provenance` (caller-supplied) |
| `entity.metadata.provenance.confirmationCount` (new) | `1` | `existing.confirmationCount + 1` |

This is exactly OKM's pattern at `_work/.../okm/src/ingestion/deduplicator.ts:113-117` + `:264-269` and `_work/.../okm/src/ingestion/pipeline.ts:173-179` + `:421-429`. Phase 39 lifts the algorithm into `putEntity` itself instead of leaving it scattered across the pipeline.

## SharedMemoryEntity Gap Audit (SC#3 Sanity Check)

Read of `coding/integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts:42-65` reveals the following fields on B's current `SharedMemoryEntity`:

| Field | Type | Phase 37 `Entity` covers? | Mapping |
|-------|------|--------------------------|---------|
| `id` | `string` | Yes (`id: EntityId` — branded; Phase 42 swap converts the legacy nanoid via the backfill legacyId mechanism) | `entity.id` (after stamp) + `entity.legacyId = { system: 'B', id: <old nanoid> }` |
| `name` | `string` | Yes | `entity.name` |
| `entityType` | `string` | Yes | `entity.entityType` |
| `significance` | `number` | Yes (metadata) | `entity.metadata.significance` |
| `observations` | `(string \| ObservationObject)[]` | Yes (metadata) | `entity.metadata.observations` |
| `relationships` | `EntityRelationship[]` | NOT on Entity — but B's relationships are first-class via `Relation`; this field should be removed entirely on Phase 42 swap and reconstituted via `store.findRelations(...)`. | (handled at Phase 42, not Phase 39) |
| `metadata: EntityMetadata` | Object with 20+ sub-fields | Yes — `entity.metadata: Record<string, unknown>` accommodates everything | `entity.metadata` (all sub-fields merged in) |
| `quick_reference?: { trigger; action; avoid; check }` | Object | Yes (metadata) | `entity.metadata.quick_reference` |
| `hierarchyLevel?` | `number` | Yes (metadata) | `entity.metadata.hierarchyLevel` |
| `parentEntityName?` | `string` | Yes (metadata, or — once Phase 42 is done — first-class `PARENT_OF` relation) | `entity.metadata.parentEntityName` (or Phase 42's relation refactor) |
| `childEntityNames?` | `string[]` | Same — metadata for now, relation later | `entity.metadata.childEntityNames` |
| `isScaffoldNode?` | `boolean` | Yes (metadata) | `entity.metadata.isScaffoldNode` |
| `embedding?: number[]` | `number[]` (384-dim) | Yes (metadata) | `entity.metadata.embedding` |
| `role?` | `string` | Yes (metadata) | `entity.metadata.role` |
| `enrichedContext?` | `string` | Yes (metadata) | `entity.metadata.enrichedContext` |

**Verdict:** Phase 37 `Entity` is sufficient for Phase 42's swap. The 4 operator-enriched fields (`embedding`, `role`, `enrichedContext`, `quick_reference`) plus the hierarchy fields all fit cleanly under `metadata: Record<string, unknown>`. The `relationships` field is the only structural mismatch — but it's handled by promoting those relationships to first-class `Relation` instances (Phase 42's job, NOT Phase 39's).

**Phase 39 contribution to SC#3:** Confirm the audit above. No type-level changes required.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OKM verbatim segment-merge (exact-equality on `text`) | Whitespace-normalized + case-sensitive (D-40) | Phase 39 (2026-05-20) | Two ingestion runs producing `"foo bar"` and `"foo  bar"` (double space) now correctly confirm a single segment, instead of pushing duplicates. |
| OKM's `console.warn` / `console.info` in pipeline supersession + merge logging | `process.stderr.write` (CF-D27 + CF-CLAUDE.md no-console-log) | Phase 37+38 | Constraint-clean repo; production logging unaffected (stderr is still captured). |
| Phase 37 `findByOntologyClass` returns ALL entities matching class | Active-only by default (D-34), opt-in `{ includeSuperseded: true }` for history | Phase 39 (2026-05-20) | Consumers querying "what is current?" no longer see superseded entities by default. Behavioral tightening, not a type break. |
| OKM `setEntityProvenance` separate method | Single `putEntity` with auto-create-or-confirm decision (D-32) | Phase 37 v0.1 (declared) + Phase 39 (populated) | Smaller API surface; no risk of forgetting to call setEntityProvenance after putEntity. |
| B's persistence-agent dual `type`/`entityType` split | Canonical `Entity.entityType` only (Phase 37) | Phase 37 + Phase 42 swap | Eliminates the "Phase 10 race condition" source (per project memory MEMORY.md "Phase 10 Runtime Issues"). |

**Deprecated/outdated:**
- OKM's in-place `mergeDescriptionSegment` mutation pattern — Phase 39 helper is pure (D-39).
- OKM's `SUPERSEDES` edge type — Phase 39 uses inverse `SUPERSEDED_BY` (`from=old, to=new`) so out-edges of `old` answer "what superseded me." Same information, more natural query direction.

## Assumptions Log

This research has no `[ASSUMED]` claims. Every factual claim is `[VERIFIED]` via grep, file read, or `[CITED]` from a locked CONTEXT.md decision (D-30..D-41) or Phase 37/38 SUMMARY.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | (none) | — | — |

**Empty Assumptions Log:** All claims in this research were verified against the actual source trees or cited from locked CONTEXT.md decisions — no user confirmation needed beyond what discuss-phase already locked.

## Open Questions

1. **Inverse edge direction for `SUPERSEDED_BY`: `old to new` or `new to old`?**
   - What we know: D-35 says "walks backward via `supersedes` and forward via a reverse index built by the store." OKM uses `SUPERSEDES` from `new to old`. The reverse direction `SUPERSEDED_BY: old to new` makes the out-edges of `old` answer "what came after me," which is more natural for the forward walk.
   - What's unclear: Whether to also add the inverse `SUPERSEDES: new to old` edge for compatibility with OKM consumers.
   - Recommendation: Use `SUPERSEDED_BY: old to new` only. The attribute `entity.supersedes` already provides the backward-walk; the edge type provides the forward-walk. One edge, two pieces of information.

2. **Should `getSupersessionChain` accept `{ includeSuperseded: true }`?**
   - What we know: D-35 says the method walks both directions and returns the full chain.
   - What's unclear: Whether the active-only filter (D-34) applies inside `getSupersessionChain`. Almost certainly NOT — the entire point of the method is to surface history.
   - Recommendation: `getSupersessionChain` IGNORES the active-only filter unconditionally. The returned array contains every entity in the lineage regardless of `validUntil`. Document this in the JSDoc.

3. **Backfill checkpoint backwards-compat across schema versions.**
   - What we know: D-38 specifies a checkpoint file. CF-D29 specifies atomic write.
   - What's unclear: If Phase 41/42/43 need to evolve the checkpoint shape later (e.g., add per-domain progress for parallel backfills), how does Phase 39's reader handle a newer-schema checkpoint file?
   - Recommendation: Add a `"version": 1` field to the checkpoint. Phase 39 reader rejects unrecognized versions with a clear error message. Future phases can bump the version and add a migration step. The version field costs ~10 bytes and is worth it.

4. **`putEntity` on existing id with `supersedes` field — error or no-op?**
   - What we know: D-32 says "if the id exists: store updates `lastConfirmedBy`, increments `confirmationCount`, preserves `createdBy`, bumps `updatedAt`." D-33's supersession closure assumes the id is NEW.
   - What's unclear: What if a caller mistakenly passes `supersedes: someOldId` on a confirm-write (same id as existing)?
   - Recommendation: Throw an error: `"putEntity: supersedes can only be set on a NEW entity; ${id} already exists in the graph"`. Confirm writes have no business changing supersession lineage. Add a boundary test for this.

5. **Should the segment-merge helper validate that `newSegment.confirmations.length === 0`?**
   - What we know: D-40 says the helper appends a confirmation to an existing matching segment, or pushes the new segment.
   - What's unclear: A caller might pass a `DescriptionSegment` with pre-populated `confirmations[]`. Should the helper accept that?
   - Recommendation: Accept it silently — `{ ...newSegment, confirmations: newSegment.confirmations ?? [] }`. The caller might be doing a one-shot import. Don't throw on what looks like reasonable input. Note this in JSDoc.

## Environment Availability

Phase 39 has no external dependencies — all code lives inside `~/Agentic/km-core/`, all libraries are already installed (Phase 37 + 38), and no external services are required.

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Building + running km-core tests | Yes | v25.8.1 (`node -v` verified) | — |
| `graphology` | All Phase 39 store work | Yes | 0.26.0 (km-core/package.json) | — |
| `classic-level` | Phase 37 PersistenceManager (no Phase 39 changes) | Yes | 3.0.0 (km-core/package.json) | — |
| `uuidv7` | Phase 37 mint/parse (no Phase 39 changes) | Yes | 1.2.1 (km-core/package.json) | — |
| `vitest` | All Phase 39 tests | Yes | 4.0.18 (km-core/package.json) | — |
| TypeScript (`npx tsc`) | Strict-mode compilation | Yes | Inherited from km-core devDeps | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Project Constraints (from CLAUDE.md)

The repository CLAUDE.md was scanned. Constraints relevant to Phase 39:

- **TypeScript strict**: mandatory. Phase 39 source files (`src/store/GraphKMStore.ts`, `src/segments/merge.ts`, `src/backfill/index.ts`, `src/backfill/checkpoint.ts`) must compile under `tsc --noEmit` with strict mode. Already enforced by km-core's `tsconfig.json` (Phase 37).
- **`no-console-log` constraint**: All diagnostic output uses `process.stderr.write(...)`, never `console.*`. CF from CONTEXT.md repeats this for emphasis — three new warning sites in Phase 39 (validUntil overwrite, segment-cap warning, backfill skip log) must comply.
- **Submodule build pipeline**: km-core is a peer repo at `~/Agentic/km-core/`, NOT a coding/ submodule yet. Phase 39 changes do NOT trigger the submodule build pipeline. (Consumer-side bumps happen post-Phase 39, in Phases 41-43.)
- **Constraint violations equal real issues**: If a constraint fires during Phase 39 implementation (e.g., `no-console-log` on an inline debug print), fix the code, do NOT bypass.

## Sources

### Primary (HIGH confidence)
- `~/Agentic/km-core/src/types/entity.ts` (152 lines) — canonical types declared by Phase 37 Plan 02; provenance subtypes (ProvenanceStamp, EntityProvenance, SegmentConfirmation, DescriptionSegment) already in place, Phase 39 populates against ingestion runs.
- `~/Agentic/km-core/src/store/GraphKMStore.ts` (575 lines) — repository class; Phase 39 modifies `putEntity` (line 288-341), adds `getSupersessionChain`, modifies `findByOntologyClass` (line 371-380) + `iterate` (line 489-496).
- `~/Agentic/km-core/tests/unit/graph-store.test.ts` (269 lines) — 13 existing tests, all must remain green; verified no test sets `validUntil` so the new active-only filter is safe for BC.
- `~/Agentic/km-core/package.json` — dep versions verified.
- `~/Agentic/km-core/node_modules/graphology-types/index.d.ts:1597,1614` — `inNeighbors` and `forEachInNeighbor` API available; `forEachInEdge` at line 959 — confirms reverse-edge primitives.
- `_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts:380-416` — OKM `mergeDescriptionSegment` reference implementation (exact-equality, in-place mutation — both deltas Phase 39 must apply).
- `_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts:99-127, 256-280` — OKM's existing provenance-stamp + segment-merge integration patterns inside dedup; the algorithm Phase 39 lifts into `putEntity`.
- `_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/pipeline.ts:163-219, 736-770` — OKM's `persistEntity` (new-entity provenance creation) + `handleSupersession` (validUntil stamping + SUPERSEDES edge creation).
- `_work/rapid-automations/integrations/operational-knowledge-management/src/types/entity.ts` — confirmed shapes align with km-core types (Phase 37 lifted verbatim, 4 deltas applied).
- `coding/integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts:42-65` — B's `SharedMemoryEntity` declaration; full field audit completed.
- `coding/.planning/phases/39-entity-data-model/39-CONTEXT.md` (140 lines) — locked decisions D-30..D-41 + CF-D04..CF-D29.
- `coding/.planning/phases/37-km-core-foundation/37-04-SUMMARY.md` — GraphKMStore final shape + close-time contract + 7 deltas vs B.
- `coding/.planning/phases/37-km-core-foundation/37-02-SUMMARY.md` — Provenance subtype declarations landed.
- `coding/.planning/phases/38-ontology-registry/38-VERIFICATION.md` — 4 NO-CHANGE invariants Phase 39 must preserve.
- `coding/.planning/ROADMAP.md:319-330` — Phase 39 success criteria (verbatim).
- `coding/.planning/REQUIREMENTS.md:32-34` — DATA-01 + DATA-02 wording.

### Secondary (MEDIUM confidence)
- (none — every claim was traceable to a primary source)

### Tertiary (LOW confidence)
- (none — no WebSearch/WebFetch was needed; all answers are in the repos and locked docs)

## Validation Architecture

Nyquist validation is configured `research_enabled: false` per the orchestrator. Skipping this section to focus the budget on items 1-8.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | All entities carry `validFrom`, `validUntil`, and `supersedes` fields. | D-31 keeps fields optional on the type but contractually populated by the writer (D-30); D-33 wires the supersession side-effect; D-34 makes active-only the default query behavior; D-35 ships `getSupersessionChain` for chain reachability. SC#1 reachable-via-chain query is satisfied by D-35. Source: "Architecture Patterns" Patterns 1, 2, 3 + "Code Examples" Active-only filter / Atomic supersession closure / Reverse-supersedes walk. |
| DATA-02 | Structured provenance fields (`createdBy`, `lastConfirmedBy`, `confirmationCount`, per-segment provenance) are present on every entity. | D-30/D-32 wire `createdBy`/`lastConfirmedBy`/`confirmationCount` into `putEntity`'s auto-stamping path; D-39/D-40 ship the per-segment merge helper with whitespace-normalized identical-text test; D-41 sets the monitoring threshold. SC#2 writer-populated provenance is satisfied by D-30 + D-32. Source: "Architecture Patterns" Patterns 1, 4 + "Code Examples" Pattern 1 sketch + Segment merge helper. |

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — no new deps, all four runtime libs verified at the correct versions in km-core/package.json.
- Architecture patterns: **HIGH** — every pattern traces to a locked CONTEXT.md decision (D-30..D-41) or a Phase 37/38 SUMMARY-documented contract. Code examples sketched against the actual Phase 37 source.
- OKM segment-merge analysis: **HIGH** — OKM source read directly; exact-equality vs D-40 normalization delta identified concretely with line numbers.
- Pitfalls + boundary cases: **HIGH** — each pitfall maps to a specific risk in the locked decisions or an existing Phase 37/38 contract that could regress.
- SharedMemoryEntity audit: **HIGH** — B's persistence-agent read directly, 16 fields catalogued, mapping to `metadata: Record<string, unknown>` verified.
- Backfill design: **HIGH** — D-36/37/38 fully specify the shape; CF-D29 establishes the atomic-write pattern Phase 37 already uses for the Exporter.
- Reverse-index strategy: **HIGH** — Graphology APIs verified in graphology-types/index.d.ts.

**Research date:** 2026-05-20
**Valid until:** 2026-06-19 (30 days — locked decisions are stable; km-core's external dep tree is stable)

---
*Phase: 39-entity-data-model*
*Research completed: 2026-05-20*
