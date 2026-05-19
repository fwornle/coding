# Phase 37: KM-Core Foundation — Research

**Researched:** 2026-05-19
**Domain:** TypeScript library bootstrap; Graphology + LevelDB persistence; UUIDv7 stamping; cross-repo submodule consumption
**Confidence:** HIGH (sources verified against B's actual code, C's actual code, official package docs via Context7, and slopcheck `[OK]` on all 4 deps)

## Summary

Phase 37 ships `@fwornle/km-core` v0.1 as a standalone public ESM-only TypeScript library — a typed wrapper over the **same** Graphology + LevelDB + per-domain JSON export stack already running in B (`coding/integrations/mcp-server-semantic-analysis`) and C (`_work/rapid-automations/integrations/operational-knowledge-management`). The phase is **almost pure extraction**: B's `GraphDatabaseAdapter` already has the right async surface, and C's `PersistenceManager` already implements the LevelDB-first / per-domain-JSON-fallback pattern with the 5s debounced + atomic-rename writes that D-22 mandates. The novel work is: (1) merging B's and C's slightly different shapes into one canonical entity type, (2) introducing UUIDv7-stamped `EntityId` as the cross-system primary key, (3) bootstrapping a public repo at `github.com/fwornle/km-core` mounted as a submodule at `coding/lib/km-core/`, and (4) wiring the existing legacy export paths (`.data/knowledge-export/coding.json`, `.data/observation-export/*.json`) as **symlinks** that point to the canonical `.data/exports/{domain}.json` so the pre-commit OKB-baseline-guard hook keeps firing unchanged.

The parity-test strategy is the single most important design decision: prove Success Criterion 2 (parity with B's and C's existing stores) by **vendoring frozen JSON snapshots** taken now from both `.data/knowledge-export/coding.json` and `_work/rapid-automations/.data/exports/{raas,kpifw,general}.json` into the `km-core/tests/fixtures/` directory, then running an in-process Graphology comparison: import the frozen fixture into a new `GraphKMStore`, write it out via `exportJson()`, and assert byte-equality after a canonical key-sort. This makes the test reproducible without any B/C runtime dependency.

**Primary recommendation:** Vendor B's `GraphDatabaseAdapter` + C's `PersistenceManager` into a single `GraphKMStore` class. Adopt **C's `Entity` shape verbatim** (`coding/integrations/operational-knowledge-management/src/types/entity.ts`) as the canonical type — it already covers everything B has plus the temporal/provenance fields Phase 39 adds, so Phase 39 only has to populate fields that the type already declares. Use `vitest` (matches C; ESM-native; OKM already runs it green). Pin dependencies to **OKM's versions exactly** (graphology 0.26.0, classic-level 3.0.0, graphology-types 0.24.8) — B is on older pins (graphology 0.25.4, level 10.0.0) and will catch up during Phase 42 migration.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Canonical `Entity`/`Relation` types | **KM-Core (library, type layer)** | — | These are pure TS interfaces — no runtime tier. Owned by the library so B and C import the same definition. |
| Graphology in-memory graph manipulation | **KM-Core (library)** | — | Generic graph ops belong in the library; per-system logic stays in consumers. |
| LevelDB durable persistence | **KM-Core (library)** | — | The library owns when/how to flush LevelDB; consumers don't open `.data/knowledge-graph/` directly. |
| Per-domain JSON export (`.data/exports/{domain}.json`) | **KM-Core (library)** | Filesystem (host) | Library writes atomically (temp-rename); host filesystem stores the result for git tracking. |
| UUIDv7 stamping on `putEntity` | **KM-Core (library)** | — | Stamp must be writer-side to enforce the contract; library cannot trust callers to mint IDs. |
| Event emission (`entity:put`, etc.) | **KM-Core (library)** | Consumer process (Redis pub/sub bridge) | Library emits in-process; coding's existing Redis bridge subscribes and republishes — no IoC imposed by the library. |
| Ontology validation on `putEntity` | **KM-Core (library)** | Ontology Registry (Phase 38) | Validation logic lives in the library; the registry it consults is Phase 38's responsibility. KM-Core v0.1 accepts an injected validator interface. |
| Pre-commit OKB-baseline-guard | **Host (coding repo)** | — | D-23 locks this — KM-Core stays git-policy-unaware; the hook at `scripts/hooks/pre-commit-okb-guard.sh` keeps the policy. |
| Symlink/alias from legacy export paths | **Host filesystem** | Migration script (one-shot) | Symlinks are filesystem state; created once during Phase 37 cutover by an idempotent script — not by the library at write time. |
| Docker bind-mount of `coding/lib/km-core/dist` | **Coding docker-compose** | — | Same pattern as `lib/llm` and `lib/vkb-server` — consumed inside the container at runtime; bind-mount at the `dist/` level avoids container rebuild on TS changes. |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-01 | KM-Core package exports canonical Entity and Relation TypeScript types consumed by all three systems | Standard Stack pins `graphology-types ^0.24.8` so consumer projects get matching upstream types; Pattern 1 (Canonical Entity Type) shows the exact shape to copy from C and the `as const` discriminants needed for both B and C to compile against it; Pattern 5 (Branded `EntityId` ergonomics) shows how `EntityId` flows through `Entity.id` and `Relation.{from,to}` cleanly |
| CORE-02 | GraphKMStore adapter (Graphology + LevelDB + git-tracked JSON export) consumed by B and C without code duplication | Pattern 2 (GraphKMStore architecture) shows the class skeleton extracted from B's `GraphDatabaseAdapter`; Pattern 3 (Per-domain JSON export with atomic rename) shows the write cadence pulled from C's `PersistenceManager`; Validation Architecture defines the parity-test strategy (frozen-fixture round-trip) that proves no behavioral drift from B's and C's current stores |
| CORE-03 | All cross-system entity references use a stable UUID-keyed identifier scheme | Pattern 4 (UUIDv7 stamping semantics) specifies that `putEntity` stamps only if `entity.id` is missing, that caller-supplied IDs are kept verbatim (idempotency requirement), and that `legacyId: { system, id }` is a *sibling* field — the modern `id` is always UUIDv7 once Phase 39's backfill runs; Validation Architecture tests UUID survival across `exportJson()` → `import()` round-trips |

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 through D-23 — copy verbatim from CONTEXT.md)

**Repo & Package Layout:**
- D-01: Standalone public repo at `github.com/fwornle/km-core`
- D-02: Local working tree at `~/Agentic/km-core/`
- D-03: Consumed via git submodule, NOT npm. `package.json` name is `@fwornle/km-core` (future-proof but no publish in v7.1)
- D-04: Submodule mounts at `coding/lib/km-core/`. New convention: `lib/` accepts both in-repo dirs and submodules
- D-05: License: **MIT**
- D-06: ESM-only (`type: module`)
- D-07: v0.1 = full bootstrap (package.json, README, tsconfig, src/ stubs, GitHub Actions for test/lint/build, manual-trigger publish workflow, CONTRIBUTING.md, ISSUE_TEMPLATE/)

**UUID Scheme & Migration:**
- D-08: UUIDv7 (RFC 9562)
- D-09: `uuidv7` npm package (NOT broader `uuid`)
- D-10: Stamping is writer-side on first store. `putEntity` stamps if entity has no UUID; callers may supply their own for idempotency
- D-11: `type EntityId = string & { readonly __brand: 'EntityId' }`. Factory: `mintEntityId()`
- D-12: Migration is one-shot backfill in Phase 39
- D-13: `legacyId: { system: 'A' | 'B' | 'C', id: string }` — explicit origin

**GraphKMStore API Surface:**
- D-14: Repository pattern with typed methods (`getEntity`, `putEntity`, `deleteEntity`, `findByOntologyClass`, `addRelation`, `findRelations`, `batch`, `exportJson`, etc.)
- D-15: Async-only — every method returns a Promise
- D-16: Built-in EventEmitter (`entity:put`, `entity:delete`, `relation:added`, `relation:removed`)
- D-17: `batch(ops[])` atomic transactions — maps to LevelDB atomic batches
- D-18: AsyncIterator + filter object iteration (`for await (const e of store.iterate({ ontologyClass: 'Component' }))`)
- D-19: Strict ontology validation on write, opt-out flag `{ skipOntologyCheck: true }`

**Export Format & Backwards-Compat:**
- D-20: Per-domain export at `.data/exports/{domain}.json`
- D-21: Legacy paths (`.data/knowledge-export/coding.json`, `.data/observation-export/*.json`) become symlinks/aliases
- D-22: 5s debounced + event-driven writes, atomic temp-file rename
- D-23: Pre-commit OKB-baseline-guard hook stays the SoT — KM-Core is policy-unaware

### Claude's Discretion
- Test framework selection (Jest established per STACK.md; vitest is a reasonable alternative for ESM-only TS lib) — planner picks
- Specific Graphology version pin — planner reads existing pins in B/C and matches
- TSConfig strictness levels (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — planner picks based on what compiles cleanly

### Deferred Ideas (OUT OF SCOPE)
- npm publish workflow (manual only in v0.1)
- Cross-language KM-Core (Python, Rust)
- Multi-instance / sharded KM-Core
- Query DSL beyond filter objects (no Gremlin/Cypher)
- Built-in Qdrant / vector index — KM-Core stays storage-only
- OKM submodule mount point and packaging strategy — deferred to Phase 43's discuss

## Project Constraints (from CLAUDE.md)

- **TypeScript mandatory** with strict type checking (forces `tsconfig.json` to enable `strict: true`; OKM uses `NodeNext` module resolution which is the right modern choice for ESM-only)
- **Documentation skill** — invoke `documentation-style` skill before creating/modifying PlantUML, Mermaid, or doc artifacts (applies if Phase 37 ships an architecture diagram in the README)
- **PlantUML** — use `plantuml` CLI command, NEVER `java -jar plantuml.jar`
- **API design** — never modify working APIs for TS compliance; fix types instead (applies when KM-Core's types need to absorb B's `KGEntity` and C's `Entity` without forcing either system to break its existing call sites)
- **Submodule build pipeline** (CRITICAL recurring issue from CLAUDE.md "Rebuilding After Code Changes"): code changes to a submodule do NOT take effect until BOTH `npm run build` inside the submodule AND a Docker rebuild of `coding-services` run. KM-Core at `coding/lib/km-core/` joins this list because its TS dist is consumed by code running in the `coding-services` container.
- **Constraint Violations = Real Issues** (MEMORY.md mandatory rule): if `no-console-log` fires during implementation, fix the violation — never restructure to dodge the checker. Use `process.stderr.write()` or the file's logger.
- **No ASCII art in docs** (constraint `no-ascii-art-in-docs`, encountered during this research): use Mermaid or PlantUML diagrams. KM-Core README and any architecture docs MUST use Mermaid (markdown-native, no toolchain needed) or PlantUML (`docs/puml/` + `docs/images/` placement).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `graphology` | ^0.26.0 [VERIFIED: npm registry; matches OKM pin] | In-memory graph object (`MultiDirectedGraph`, nodes+edges with attributes) | Same library B and C already use; published `export()`/`import()` methods give us round-trip serialization for free [CITED: context7.com/graphology/graphology] |
| `graphology-types` | ^0.24.8 [VERIFIED: npm registry; matches OKM pin] | TypeScript declarations for graphology | Required for typed graph operations — OKM uses this; B doesn't yet (B is .ts but uses `any` casts at the graph boundary) |
| `classic-level` | ^3.0.0 [VERIFIED: npm registry; matches OKM pin] | LevelDB binding for Node.js (durable key-value store, atomic batch writes) | OKM uses this directly; B uses umbrella `level` (10.0.0) which auto-resolves to `classic-level` in Node. Direct dep is one less hop. Atomic `batch(ops[])` maps to D-17. [CITED: context7.com/level/classic-level] |
| `uuidv7` | ^1.2.1 [VERIFIED: npm registry; LiosK author] | RFC 9562 UUIDv7 generator (~3KB) | Time-ordered IDs give LevelDB iteration roughly chronological order. `uuidv7()` returns the standard hyphenated string; no extra parsing needed. `UUID.parse()` available for validation. [CITED: context7.com/liosk/uuidv7] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `typescript` | ^5.9.3 [VERIFIED: matches OKM; B is on 5.8.3 — newer is fine] | TS compiler | Build-time only. `tsconfig.json` uses `module: NodeNext` for native ESM. |
| `vitest` | ^4.0.18 [VERIFIED: matches OKM] | Test framework (ESM-native, no `NODE_OPTIONS` dance) | Recommended over Jest (which STACK.md prefers for the larger coding tree) because: (1) this is a brand-new ESM-only lib with no Jest baggage, (2) OKM (C, the other consumer) already runs vitest, (3) vitest needs zero ESM workarounds. STACK.md's Jest pin governs the coding tree, not standalone subrepos. |
| `tsx` | ^4.21.0 [VERIFIED: matches OKM] | Dev runner (for CLI tools if any) | Optional in v0.1 — only needed if the library ships a CLI entry. The submodule + bind-mount pattern means library users import compiled dist; tsx is just for local dev. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `classic-level` (direct) | `level` umbrella (B's current choice) | `level` auto-picks `classic-level` in Node — same runtime. Direct dep saves one hop and matches what C already does. Recommend `classic-level` for clarity. |
| `uuidv7` package | `crypto.randomUUID()` native | Native produces v4 (random, NOT k-sortable). D-08/D-09 locked v7 specifically for LevelDB iteration locality. No native v7 in Node 22 yet. |
| `vitest` | Jest | Jest is established per STACK.md for the coding tree, but the coding tree has the `NODE_OPTIONS='--experimental-vm-modules --no-warnings'` boilerplate to make it ESM-compatible. A standalone ESM-only lib with no such legacy is better served by vitest. |
| MIT license | Apache-2.0 | MIT is what D-05 locks. Note: `uuidv7` is Apache-2.0 — compatible. graphology and classic-level are MIT — clean. |

**Installation:**
```bash
# v0.1 dependencies (at ~/Agentic/km-core/)
npm install graphology@^0.26.0 graphology-types@^0.24.8 classic-level@^3.0.0 uuidv7@^1.2.1
npm install --save-dev typescript@^5.9.3 vitest@^4.0.18 @types/node@^22.0.0 tsx@^4.21.0
```

**Version verification (run 2026-05-19):**
- `npm view uuidv7 version` → `1.2.1` (published 2024)
- `npm view graphology version` → `0.26.0`
- `npm view classic-level version` → `3.0.0`
- `npm view graphology-types version` → `0.24.8`

All four versions match what OKM (C) is already running in production — minimizes Phase 43 churn.

## Package Legitimacy Audit

Run via `~/Library/Python/3.9/bin/slopcheck install <pkgs>` on 2026-05-19. All four packages cleared `[OK]`.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `uuidv7` | npm | ~2 yrs | high (~600k/wk) | github.com/LiosK/uuidv7 | [OK] | Approved |
| `graphology` | npm | ~6 yrs | high (~330k/wk) | github.com/graphology/graphology | [OK] | Approved |
| `classic-level` | npm | ~3 yrs (LevelDB heritage ~10 yrs) | very high (~7M/wk via `level`) | github.com/Level/classic-level | [OK] | Approved — note `install: node-gyp-build` native binding (see Pitfall 5) |
| `graphology-types` | npm | ~6 yrs (same org as graphology) | tracks graphology | github.com/graphology/graphology | [OK] | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**Cross-ecosystem confusion check:**
- `pip3 show uuidv7` → `Package(s) not found`. There IS a `uuid7` PyPI package (different name) but no cross-ecosystem name collision risk.

**Postinstall scripts audited:**
- `uuidv7.scripts.prepare = 'npm run build && npm run doc && npm run test'` — runs during the package author's own publish, not on consumer install. Safe.
- `graphology.scripts.prepare = 'npm run build'` — same pattern. Safe.
- `classic-level.scripts.install = 'node-gyp-build'` — runs `node-gyp-build` on install to fetch a prebuilt native binding. **Expected behavior** (it's the LevelDB binding). However, Phase 37 must accommodate this in the Docker build pipeline (see Pitfall 5 + Pattern 6).

## Architecture Patterns

### System Architecture Diagram (Mermaid)

```mermaid
flowchart TB
  consumer["KM-Core consumer (B or C)<br/><code>import { GraphKMStore, mintEntityId } from '@fwornle/km-core'</code>"]
  consumer -- "async API (D-15)" --> store
  subgraph KM-Core
    store["GraphKMStore<br/>(extends Node EventEmitter)<br/>putEntity / getEntity / addRelation /<br/>batch(ops) / iterate(filter) / exportJson"]
    stamp{{"D-10: stamp UUIDv7<br/>if id missing"}}
    store -- internally calls --> stamp
  end
  store --> graph["Graphology<br/>MultiDirectedGraph<br/>(in-memory)"]
  store --> level["classic-level<br/>(LevelDB binding)<br/>durable storage"]
  graph --> export["per-domain JSON export<br/>5s debounce, atomic rename<br/>.data/exports/{domain}.json"]
  level --> export
  store -.->|emit 'entity:put'| consumer
  export --> symlink["Legacy-path symlinks (D-21)<br/>.data/knowledge-export/coding.json -> ../exports/coding.json<br/>.data/observation-export/*.json -> ../exports/*.json"]
  symlink --> downstream["Existing readers (unchanged):<br/>pre-commit OKB-guard,<br/>VKB API, dashboards, prompt-injection retrieval"]
```

### Component Responsibilities

| File (in km-core/src/) | Responsibility | Source it extracts from |
|------------------------|----------------|--------------------------|
| `types/entity.ts` | `Entity`, `Relation`, `EntityId`, `Layer`, `Provenance` types | C's `src/types/entity.ts` verbatim (the canonical) |
| `types/index.ts` | Re-export public surface | new |
| `store/GraphKMStore.ts` | Repository class: `putEntity`/`getEntity`/`deleteEntity`/`findByOntologyClass`/`addRelation`/`findRelations`/`batch`/`iterate`/`exportJson`. Extends `EventEmitter`. | B's `GraphDatabaseAdapter` (storeEntity, queryEntities, exportToJSON, mergeAttributes, deleteEntity, close) |
| `store/persistence.ts` | LevelDB read/write, hydrate-from-JSON fallback, atomic rename | C's `src/store/persistence.ts` verbatim with a `Map<windowKey, Timer>`-style debounce |
| `store/exporter.ts` | Per-domain JSON bucketing + atomic write | C's `exportJson()` method extracted |
| `ids/mint.ts` | `mintEntityId()` wrapper over `uuidv7()`; `parseEntityId()` validator | new (thin) |
| `ids/branded.ts` | `EntityId` branded-string type definition | new (thin) |
| `events/types.ts` | Event payload types (`EntityPutEvent`, `RelationAddedEvent`, ...) | new |
| `validation/ontology.ts` | Pluggable validator interface; v0.1 ships a no-op default | new (Phase 38 wires the real registry) |
| `index.ts` | Public API surface | new |

### Recommended Project Structure

```text
km-core/                                    # ~/Agentic/km-core/ (repo root)
.github/
  workflows/
    ci.yml                                  # test + lint + build on push/PR
    publish.yml                             # manual workflow_dispatch trigger (D-07)
.gitignore                                  # node_modules/, dist/, coverage/, *.tgz
CONTRIBUTING.md
ISSUE_TEMPLATE/
  bug_report.md
  feature_request.md
LICENSE                                     # MIT (D-05)
README.md
package.json                                # @fwornle/km-core, type:module
tsconfig.json                               # strict, NodeNext, ES2022
vitest.config.ts
src/
  index.ts                                  # public API barrel
  types/
    entity.ts                               # Entity, Relation, Layer
    index.ts
  ids/
    branded.ts                              # EntityId branded type
    mint.ts                                 # mintEntityId, parseEntityId
  store/
    GraphKMStore.ts                         # main class
    persistence.ts                          # LevelDB I/O + hydrate
    exporter.ts                             # per-domain JSON writer
  events/
    types.ts
  validation/
    ontology.ts                             # interface only; no-op default
tests/
  unit/
    ids.test.ts                             # UUIDv7 stamping + branded types
    entity.test.ts                          # type-level + runtime invariants
    graph-store.test.ts                     # CRUD, batch, iterate
    persistence.test.ts                     # LevelDB round-trip
    exporter.test.ts                        # atomic rename + debounce
  integration/
    round-trip.test.ts                      # putEntity then exportJson then re-import
  fixtures/
    b-coding-snapshot.json                  # frozen from coding/.data/knowledge-export/coding.json
    c-raas-snapshot.json                    # frozen from rapid-automations exports
    c-kpifw-snapshot.json
    c-general-snapshot.json
dist/                                       # tsc output (gitignored)
```

### Pattern 1: Canonical Entity Type (CORE-01)

**What:** A single `Entity` interface that satisfies B's `KGEntity`/`SharedMemoryEntity` *and* C's `Entity`. Adopt C's shape — it is the strict superset.

**When to use:** All B and C consumers import this type. B's existing `entity.type` (kg-operators) and `entity.entityType` (persistence-agent) collapse to a single `entityType: string` field. Phase 39 adds `validFrom`/`validUntil`/`supersedes` and provenance.

```typescript
// Source: extracted from _work/rapid-automations/integrations/operational-knowledge-management/src/types/entity.ts
// (C's canonical, already in production)

export type Layer = 'evidence' | 'pattern';

export interface Entity {
  id: EntityId;                           // UUIDv7-stamped, branded (D-11)
  name: string;
  entityType: string;                     // ontology class name; kills B's type/entityType split
  ontologyClass?: string;                 // alias kept for v0.1 BC; phase 38 may consolidate
  layer: Layer;
  description: string;
  createdAt: string;                      // ISO-8601
  updatedAt: string;
  metadata: Record<string, unknown>;
  // Phase 39 fields (declared now, populated later — Phase 39 only fills, never re-types):
  validFrom?: string;
  validUntil?: string;
  supersedes?: EntityId;
  // Migration aid (Phase 39 backfill):
  legacyId?: { system: 'A' | 'B' | 'C'; id: string };     // D-13
}

export interface Relation {
  type: string;
  from: EntityId;
  to: EntityId;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  validFrom?: string;
  validUntil?: string;
}
```

**Note on `ontologyClass` vs `entityType`:** C's current code uses BOTH (line 73-74 of entity.ts). Recommend keeping both fields in v0.1 (`ontologyClass?: string`) for OKM BC, with `entityType` as the authoritative one. Phase 38 (ontology registry) decides whether to deprecate `ontologyClass` outright.

### Pattern 2: GraphKMStore architecture (CORE-02)

**What:** A class wrapping `Graphology.MultiDirectedGraph` + `classic-level` ClassicLevel instance, extending Node's `EventEmitter`.

**Skeleton (extract from B's `GraphDatabaseAdapter` + C's `PersistenceManager`):**

```typescript
// Source: composite of
//   coding/integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts (B)
//   _work/rapid-automations/integrations/operational-knowledge-management/src/store/persistence.ts (C)
//   _work/rapid-automations/integrations/operational-knowledge-management/src/store/graph-store.ts (C)

import { MultiDirectedGraph } from 'graphology';
import { ClassicLevel } from 'classic-level';
import { EventEmitter } from 'node:events';
import { uuidv7 } from 'uuidv7';
import type { Entity, Relation, EntityId } from '../types/entity.js';

export interface GraphKMStoreOptions {
  dbPath: string;                         // LevelDB directory
  exportDir: string;                      // .data/exports/
  debounceMs?: number;                    // default 5000 (D-22)
  ontologyValidator?: OntologyValidator;  // Phase 38 wires; v0.1 no-op default
}

export class GraphKMStore extends EventEmitter {
  private graph: MultiDirectedGraph<Entity, Relation>;
  private db: ClassicLevel<string, string>;
  private exportDir: string;
  private debounceMs: number;
  private exportTimer: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor(opts: GraphKMStoreOptions) { /* ... */ }

  async open(): Promise<void> { /* hydrate from LevelDB, fallback to JSON */ }

  async putEntity(e: Partial<Entity> & { name: string; entityType: string },
                   opts?: { skipOntologyCheck?: boolean }): Promise<EntityId> {
    // 1. D-19 validation (unless skip flag)
    // 2. D-10 UUID stamp: if (!e.id) e.id = mintEntityId();
    // 3. Graphology mergeNode / mergeNodeAttributes
    // 4. LevelDB put 'entity:' + e.id
    // 5. emit 'entity:put' { entity }
    // 6. _scheduleExport()
    return e.id as EntityId;
  }

  async getEntity(id: EntityId): Promise<Entity | null> { /* ... */ }
  async deleteEntity(id: EntityId): Promise<boolean> { /* ... */ }
  async findByOntologyClass(cls: string): Promise<Entity[]> { /* ... */ }
  async addRelation(r: Relation): Promise<void> { /* ... */ }
  async findRelations(filter: Partial<Relation>): Promise<Relation[]> { /* ... */ }

  async batch(ops: BatchOp[]): Promise<void> {
    // D-17: maps to classic-level db.batch([{type:'put',key,value},...])
    // also applies in-memory Graphology mutations transactionally —
    // build operations list, validate ALL, then apply all-or-nothing
  }

  async *iterate(filter?: Partial<Entity>): AsyncIterable<Entity> {
    // D-18: lazy Graphology forEachNode with filter object
  }

  async exportJson(): Promise<void> {
    // D-20: bucket nodes by domain (entity.metadata.domain ?? 'general'),
    //       write per-domain file with atomic temp+rename
    // implementation: copy verbatim from C's persistence.exportJson() at line 97
  }

  async close(): Promise<void> { /* flush, await pending export, db.close() */ }
}
```

**Critical behaviors copied verbatim from existing code:**
- LevelDB hydrate-first / JSON-export-fallback flow (C's `hydrate()` at line 24)
- The `writing` reentry guard in `exportJson()` (C's persistence.ts line 9)
- The per-domain bucketing with `STANDARD_DOMAINS` allowlist (C's persistence.ts line 103)
- The `mergeNodeAttributes` direct path for operator-enriched fields (B's adapter line 343)

### Pattern 3: Per-domain JSON export with atomic rename (D-20, D-22)

```typescript
// Atomic temp-file + rename: fs.promises.writeFile + fs.promises.rename
// Source: composite — coding GraphKnowledgeExporter (debounce per team) + OKM persistence.exportJson (per-domain bucketing)

private _scheduleExport(): void {
  if (this.exportTimer) clearTimeout(this.exportTimer);
  this.exportTimer = setTimeout(() => {
    this.exportJson().catch(err => this.emit('error', err));
  }, this.debounceMs);
}

async exportJson(): Promise<void> {
  if (this.writing) return;            // re-entry guard (C's pattern)
  this.writing = true;
  try {
    const serialized = this.graph.export();
    // Bucket nodes by domain — see C persistence.ts L103
    const domainGraphs = this.bucketByDomain(serialized);

    // Atomic write per domain — temp file then rename
    await Promise.all(Array.from(domainGraphs.entries()).map(async ([domain, g]) => {
      const finalPath = path.join(this.exportDir, `${domain}.json`);
      const tempPath = `${finalPath}.tmp.${process.pid}.${Date.now()}`;
      await fs.promises.writeFile(tempPath, JSON.stringify(g, null, 2), 'utf-8');
      await fs.promises.rename(tempPath, finalPath);   // atomic on POSIX
    }));

    this.emit('export:complete', { domains: Array.from(domainGraphs.keys()) });
  } finally {
    this.writing = false;
  }
}
```

**Why atomic rename matters:** the pre-commit OKB-baseline-guard runs `git diff --cached --name-only | grep -E '...exports/.*\.json$'`. A torn write (partial JSON) would make the staged file unparseable by downstream readers. `rename(2)` is atomic on the same POSIX filesystem.

### Pattern 4: UUIDv7 stamping semantics (CORE-03)

```typescript
// Source: composite of context7.com/liosk/uuidv7 + D-10/D-11

import { uuidv7, UUID } from 'uuidv7';

export type EntityId = string & { readonly __brand: 'EntityId' };

export function mintEntityId(): EntityId {
  return uuidv7() as EntityId;
}

export function parseEntityId(s: string): EntityId {
  UUID.parse(s);                              // throws SyntaxError if invalid
  return s as EntityId;
}

// Inside GraphKMStore.putEntity:
async putEntity(e: Partial<Entity> & { name: string; entityType: string }): Promise<EntityId> {
  let id: EntityId;
  if (e.id) {
    // D-10: caller supplied — keep verbatim (idempotency, dedup short-circuit).
    //       Validate format only — don't replace.
    id = parseEntityId(e.id as string);
  } else {
    // D-10: writer-side stamp.
    id = mintEntityId();
  }
  const entity: Entity = { ...e, id, /* ... defaults ... */ };
  // ...
  return id;
}
```

**Stamp-vs-keep decision logic:**

| Input | Behavior | Why |
|-------|----------|-----|
| `putEntity({ name, entityType })` — no `id` | Stamp fresh UUIDv7 | Default path; ID is library-assigned |
| `putEntity({ id: validUuidV7, name, entityType })` — caller supplied | Keep verbatim | Idempotency: re-applying the same logical entity from a retry must hit the same key |
| `putEntity({ id: legacy-string-not-a-uuid, name, entityType })` | Throws `SyntaxError` from `parseEntityId` | Forces callers to pass `legacyId` *separately* — never confuse legacy IDs with KM-Core IDs |
| Phase 39 backfill: `{ id: mintEntityId(), legacyId: { system: 'B', id: 'CodingProject' }, ... }` | Both kept; modern `id` is primary key | `legacyId` is a sibling for debuggability/cross-ref — NOT a replacement for `id`. The structured shape (D-13) avoids ambiguity. |

**Round-trip safety:** UUIDv7 strings round-trip cleanly through JSON (`exportJson()` writes them as plain strings in `node.attributes.id`; `import()` reads them back unchanged). The branded-type cast happens at the type layer only — it has zero runtime cost (CONTEXT.md D-11).

### Pattern 5: Branded `EntityId` ergonomics

**What:** Zero-runtime-cost compile-time tagging. The brand exists only in TypeScript's structural type system.

```typescript
// branded.ts
export type EntityId = string & { readonly __brand: 'EntityId' };

// Factory (the only way to produce one without an explicit cast):
import { uuidv7 } from 'uuidv7';
export const mintEntityId = (): EntityId => uuidv7() as EntityId;

// Consumer pattern at module boundary (B, C):
import type { EntityId, Entity } from '@fwornle/km-core';

// B's internal SharedMemoryEntity (line 583 of persistence-agent.ts) shrinks to:
type SharedMemoryEntity = Entity;     // gone — was duplicating KM-Core's shape

// Consumer-side narrowing helper (when accepting wide strings from external APIs):
function asEntityId(s: string): EntityId {
  // Caller has already validated externally — single cast site
  return s as EntityId;
}
```

**Ergonomic trap:** the branded-string pattern requires that *every public boundary* either (a) accepts wide `string` and casts internally with a validator, or (b) accepts `EntityId` already. Mixing the two on the same method signature leads to confusing user errors. Recommend: **library always accepts `EntityId`**, with `parseEntityId()` as the public narrowing helper.

### Pattern 6: Submodule integration into coding (D-04)

**Three-layer build flow** when KM-Core is consumed at `coding/lib/km-core/`:

1. **Author edits** at `~/Agentic/km-core/src/` (D-02)
2. **Author runs** `cd ~/Agentic/km-core && npm run build` — produces `dist/`
3. **Submodule update at coding:** `cd ~/Agentic/coding/lib/km-core && git fetch && git checkout <sha>`
4. **Docker build:** the `Dockerfile.coding-services` line 96 `COPY lib/ ./lib/` already includes `lib/km-core/dist/`. Add a parallel install + build step:

```dockerfile
# In Dockerfile.coding-services after line 106 (lib/llm install):
RUN cd lib/km-core && npm install --ignore-scripts --production 2>/dev/null || true

# Native binding rebuild — line 123 already does this for classic-level via
# `npm rebuild better-sqlite3 classic-level` — IF km-core's dep tree dedupes
# correctly with B's existing classic-level, this is a no-op for the new lib.
# Otherwise, add: `cd lib/km-core && npm rebuild classic-level`.
```

5. **Bind-mount for dev** (matches `lib/llm/dist` pattern at docker-compose.yml line 91):

```yaml
# docker-compose.yml — add inside coding-services.volumes:
- ${CODING_REPO:-.}/lib/km-core/dist:/coding/lib/km-core/dist:ro
```

This means the dev iteration loop is `npm run build` in `~/Agentic/km-core` → no Docker rebuild needed because `dist/` is bind-mounted (same trick as system-health-dashboard).

**During pre-publish (before the public repo exists at github.com/fwornle/km-core):**
The submodule URL won't resolve. Two options:
- **Option A (recommended):** Develop locally first as `coding/lib/km-core/` *without* git-submodule wiring; once the repo is created on GitHub and pushed, do `git submodule add` to convert. Avoids chicken-and-egg.
- **Option B:** Create the empty public repo first, then `git submodule add`. Author both at `~/Agentic/km-core/` (the working tree) and via the submodule at `coding/lib/km-core/`.

### Pattern 7: Symlink/alias mechanism for legacy paths (D-21)

**The pre-commit hook inspects:** `git diff --cached --name-only | grep -E '\.data/(knowledge-export|exports)/.*\.json$'` (from `scripts/hooks/pre-commit-okb-guard.sh` line 16).

Both legacy and canonical patterns are already in the regex (`knowledge-export|exports`). The hook fires on the **path that git sees** (the symlink path, not the target). So:

**Recommended mechanism:** git-tracked symlinks via `git update-index --add --cacheinfo 120000,<blob>,<path>`. Alternative: simple POSIX symlinks created at first KM-Core startup by an idempotent migration script.

**Concrete plan:**
- `.data/exports/coding.json` is canonical (the file)
- `.data/knowledge-export/coding.json` is a symlink to `../exports/coding.json` (relative)
- `.data/observation-export/observations.json` is a symlink to `../exports/observations.json`
- `.data/observation-export/digests.json` is a symlink to `../exports/digests.json`
- `.data/observation-export/insights.json` is a symlink to `../exports/insights.json`

**Why relative symlinks:** absolute paths break across machines; relative `..` traversal stays correct under any clone.

**Why NOT a hardlink:** hardlinks can confuse git (inode-level tracking), and POSIX hardlinks cannot cross filesystems. Symlinks are safer.

**Why NOT an in-process rewrite shim:** D-22 mandates atomic-rename writes; a shim adds a path-rewrite layer that complicates the atomic-rename invariant.

**Recommended migration step:** Phase 37 ships a one-shot Node script `scripts/migrate-km-core-symlinks.mjs` that:
1. Backs up `.data/knowledge-export/coding.json` to `.data/exports/coding.json.bak.<timestamp>` if it exists and has content.
2. Moves canonical content to `.data/exports/coding.json`.
3. Replaces `.data/knowledge-export/coding.json` with a symlink.
4. Repeats for observation-export files (when Phase 41 wires A — *not* Phase 37, since A is not consuming KM-Core yet).
5. Idempotent: re-running detects existing symlinks and no-ops.

**Phase 37 scope clarification:** Phase 37 only needs to symlink `coding.json` (B's path). Observation-export symlinking happens during Phase 41 when A's adapter ships. Document this clearly so the planner doesn't pull Phase 41 work forward.

### Anti-Patterns to Avoid

- **Hand-rolling LevelDB encoding/decoding** — use `valueEncoding: 'json'` (classic-level option) or pre-serialize entities consistently. Mixing modes corrupts the DB silently. [CITED: context7.com/level/classic-level]
- **Caller-supplied IDs without validation** — D-10 says callers MAY supply IDs (for idempotency). But blindly trusting them lets a caller poison the DB with non-UUIDv7 strings, breaking sortability and downstream UUID validators. ALWAYS run `UUID.parse(s)` on caller-supplied IDs.
- **Mutating exported JSON in place** — `exporter.ts` builds a fresh `SerializedGraph` object each call. Never mutate the result of `graph.export()` — Graphology returns a reference-shared object in some versions.
- **Subscribing to in-process EventEmitter from another process** — D-16 says the emitter is in-process. The Redis pub/sub bridge runs in the same process and subscribes locally; *another* process talking to KM-Core does so via the host application's HTTP layer (VKB API in coding, REST in OKM), not by trying to attach to the emitter.
- **`fs.writeFile` without atomic rename** — partial writes during git operations look like commit-staged JSON corruption to the OKB guard. Always temp-file + `rename(2)`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUIDv7 generation | a custom RFC-9562 implementation | `uuidv7` npm package (~3KB) | LiosK's implementation handles clock rollback gracefully, has 75 code snippets in Context7, well-tested. [CITED: context7.com/liosk/uuidv7] |
| Graph storage | a custom Map<id, Entity> with manual edge tracking | Graphology `MultiDirectedGraph` | Already in use by B and C; supports `export()`/`import()`/`mergeNodeAttributes` out of the box. |
| LevelDB binding | manual `node-gyp` setup | `classic-level` | Prebuilt binaries via `node-gyp-build`; supports atomic batch writes natively. [CITED: context7.com/level/classic-level] |
| JSON debouncing | a custom timer manager | reuse C's `Map<windowKey, Timer>` pattern from token-usage rewrite (memory: phase 36-03) | Battle-tested in production; handles concurrent debounce windows. |
| Branded-type runtime check | a brand-validation runtime layer | trust the compiler + a single `parseEntityId(s)` boundary validator | Brands are zero-cost at runtime; runtime validation is the validator's job. |
| Atomic file writes | `fs.writeFile` with manual unlink/retry | `fs.promises.writeFile` + `fs.promises.rename` | POSIX guarantees rename is atomic; widely used pattern in C and B already. |
| Path resolution | hand-coded `path.resolve` and `process.cwd()` games | accept `dbPath` and `exportDir` from constructor opts; let the consumer resolve | Same pattern as B's `GraphDatabaseAdapter(dbPath, team)`. Avoids env-var spelunking. |

**Key insight:** *Almost nothing in Phase 37 is novel implementation.* B and C have already solved the hard problems (LevelDB lifecycle, Graphology serialization, debounced exports, atomic rename). Phase 37 is **extraction + unification + type-tightening**. Plans that read like "implement LevelDB integration from scratch" are red flags — they should read like "copy method X from file Y, replace `entity.type ?? entity.entityType` with `entity.entityType`, add `EntityId` typing."

## Runtime State Inventory

> Phase 37 is a *brand-new library bootstrap*, not a rename/refactor. There is no pre-existing KM-Core runtime to migrate. However, Phase 37 introduces **one runtime-state change**: legacy export paths become symlinks. Document that change here so the planner can audit.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing `.data/knowledge-graph/` LevelDB (B's). Owned by `GraphDatabaseService.js`. KM-Core v0.1 must NOT take this over — B's existing service keeps writing to it during the gap between Phase 37 (KM-Core ships) and Phase 42 (B migrates). KM-Core's own LevelDB instance starts empty; Phase 42 writes the migration script. | None for Phase 37. Phase 42 handles the actual data migration. |
| Live service config | `coding/docker-compose.yml` bind-mount strategy for `lib/` — needs ONE new line: `- ${CODING_REPO:-.}/lib/km-core/dist:/coding/lib/km-core/dist:ro`. `Dockerfile.coding-services` needs ONE new RUN: `cd lib/km-core && npm install --ignore-scripts --production`. | Code edit during Phase 37. |
| OS-registered state | None — KM-Core has no launchd/systemd/Task Scheduler integration. Pure library. | None — verified by inspection of CLAUDE.md (no relevant services listed). |
| Secrets / env vars | None — KM-Core is config-driven (paths passed via constructor). No secrets, no env vars in v0.1. | None — verified by D-06/D-07 scope (skeleton only). |
| Build artifacts | NEW: `~/Agentic/km-core/dist/` will exist after first build. NEW: `coding/lib/km-core/dist/` will exist (via submodule). Existing `.data/knowledge-export/coding.json` (B's auto-export) keeps writing until B migrates in Phase 42. | Phase 37 introduces dist/ artifacts; Phase 42 stops B from writing `.data/knowledge-export/coding.json` directly. |
| Filesystem aliases / symlinks | NEW: `.data/knowledge-export/coding.json` is a symlink to `.data/exports/coding.json`. Created by one-shot migration script (Pattern 7). | Run migration script during Phase 37 cutover. |

**The canonical question:** *After every file in coding/lib/km-core/ is built, what runtime systems still depend on the old path?*
- Pre-commit OKB-baseline-guard: continues to work — regex covers both `knowledge-export` and `exports` (verified by reading `scripts/hooks/pre-commit-okb-guard.sh` line 16).
- VKB API readers: read via `.data/knowledge-export/coding.json` path — symlink keeps this working.
- Dashboard readers, prompt-injection retrieval client: read via the legacy path — symlink keeps this working.
- B's `GraphKnowledgeExporter.js`: still writes to `.data/knowledge-export/coding.json` until Phase 42 migrates it. The symlink target is `../exports/coding.json` — **after Phase 37, B's exporter is writing through the symlink to the canonical location**. This means readers and the auto-exporter agree on the file content from day 1, even before B is fully migrated.

## Common Pitfalls

### Pitfall 1: classic-level native-binding mismatch between dev (macOS) and container (Linux)
**What goes wrong:** `npm install` on macOS produces darwin-arm64 prebuilds in `node_modules/classic-level/prebuilds/`. The Docker build copies `lib/km-core/node_modules/` (if not gitignored properly) and runtime fails with `Error: Could not load the "classic-level" addon`.
**Why it happens:** `classic-level` ships per-platform prebuilt native bindings via `node-gyp-build`. The host's binding doesn't load on the container's libc.
**How to avoid:**
  - `.gitignore` MUST exclude `node_modules/` at the km-core repo root.
  - `Dockerfile.coding-services` line 123 already does `npm rebuild ... classic-level` — add `cd lib/km-core && npm install --ignore-scripts` BEFORE the rebuild line so km-core's classic-level gets its container-side binding.
**Warning signs:** ENOENT or "could not load addon" at container startup.

### Pitfall 2: `entity.id` collisions when caller supplies wide strings
**What goes wrong:** Caller passes `putEntity({ id: 'CodingProject', name: 'CodingProject', entityType: 'Project' })`. Library stores `entity:CodingProject` (legacy B-style key). Next caller passes proper UUID. Now the DB has two entities for the same logical thing.
**Why it happens:** D-10 lets callers supply IDs. If the validator (Pattern 4) isn't run, garbage gets through.
**How to avoid:** Pattern 4's `parseEntityId(s)` ALWAYS validates with `UUID.parse(s)`. Legacy IDs go in `legacyId` (D-13), never in `id`. Phase 39's backfill is the ONLY path that creates entities with both `id` (fresh UUIDv7) and `legacyId` (old B/C string).
**Warning signs:** LevelDB keys that don't match the `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` regex.

### Pitfall 3: Symlink overwrites the canonical file
**What goes wrong:** Migration script (Pattern 7) is run twice without idempotency. Second run reads the symlink (which points to the canonical), sees content, "backs it up" then overwrites the symlink with itself — possible data loss.
**Why it happens:** Naïve "move then symlink" doesn't handle the symlink-already-exists case.
**How to avoid:** Script checks `fs.lstat(legacyPath).isSymbolicLink()` BEFORE doing anything. If already a symlink to the canonical, no-op. Pattern 7 step 5 explicitly states this.
**Warning signs:** Two timestamps in `.bak.*` files after a single run.

### Pitfall 4: Pre-commit hook fires on auto-export before commit
**What goes wrong:** Developer runs `git add .` after KM-Core's debounced writer just fired. `.data/exports/coding.json` is staged. Hook blocks the commit with the "OKB BASELINE GUARD" message even though developer is committing unrelated source.
**Why it happens:** This is the *intended* behavior of the hook (it prevents accidental KB commits). But during the v7.1 migration window the hook fires more often because we're touching `.data/` paths via tests.
**How to avoid:** Add `.data/exports/` to `.gitignore` UNTIL the explicit KB-update commit is being made. Pattern from CLAUDE.md "commit hygiene" — `git add -p` for source-only commits, separate commit for `.data/exports/`. Tests that touch `.data/exports/` must use a tempdir (`fs.mkdtempSync(os.tmpdir(), 'km-core-test-')`), NEVER the real repo path.
**Warning signs:** Test runs leave KB files staged in `git status`.

### Pitfall 5: `npm install --production` strips dev TS deps needed by `tsc`
**What goes wrong:** Dockerfile uses `npm install --production` to skip dev deps. But if KM-Core is delivered as **source** and built inside the container (the way `lib/llm` works at Dockerfile.coding-services line 126), `tsc` won't be available.
**Why it happens:** Confusion between "library is built" vs "library is shipped as TS source built in the image."
**How to avoid:** Ship the **built dist/** to the container, NOT the source. Mirror the system-health-dashboard pattern: author builds `dist/` on the host (`npm run build`), Docker bind-mounts `dist/` only (see Pattern 6, step 5). Dockerfile's COPY of `lib/km-core/` then only includes `dist/`, `package.json`, and minimal runtime files — no `tsc` needed in the container.
**Warning signs:** `Cannot find module 'typescript'` during container build.

### Pitfall 6: Graphology version skew between km-core and B (during Phase 42 transition)
**What goes wrong:** km-core ships `graphology@^0.26.0` (matches OKM/C). B is still on `graphology@^0.25.4` until Phase 42 migrates it. During the Phase 37 to 42 gap, B's `package.json` pulls 0.25.4 but km-core's `node_modules/graphology` is 0.26.0 — npm's flat node_modules resolution may serve B 0.26.0, breaking its existing 0.25.4 call sites silently.
**Why it happens:** node_modules deduping when one version satisfies both.
**How to avoid:** During Phase 37, **DO NOT** modify B's `package.json` graphology pin. Let npm dedupe. The breaking changes between 0.25 and 0.26 in graphology are minor (verified: both support `export()`/`import()`/`MultiDirectedGraph`). If B breaks, Phase 42 (B's migration) bumps B's pin to ^0.26.0 then.
**Warning signs:** B's existing tests start failing after `npm install` runs in coding/.

### Pitfall 7: ASCII line art in README / architecture docs
**What goes wrong:** Constraint `no-ascii-art-in-docs` blocks document writes when ASCII line-drawing chars are present.
**Why it happens:** Project policy (constraint monitor at port 3030); ASCII diagrams diverge from rendered Mermaid/PlantUML standard.
**How to avoid:** Use Mermaid fenced code blocks (`mermaid` language) for inline diagrams — markdown-native, no toolchain needed. For richer diagrams use PlantUML per CLAUDE.md (`docs/puml/` source, `docs/images/` output). The architecture diagram in this RESEARCH.md uses Mermaid for that reason.
**Warning signs:** Constraint violation message when writing markdown.

## Code Examples

### Example 1: Round-trip an Entity through GraphKMStore

```typescript
// Source: composite of patterns above; reference C's tests/unit/persistence.test.ts:30-58 for shape

import { GraphKMStore, mintEntityId } from '@fwornle/km-core';

const store = new GraphKMStore({
  dbPath: '/tmp/km-test/leveldb',
  exportDir: '/tmp/km-test/exports',
  debounceMs: 0,                          // synchronous flush for tests
});

await store.open();

const id = await store.putEntity({
  name: 'CodingProject',
  entityType: 'Project',
  layer: 'evidence',
  description: 'Root project node',
  createdAt: '2026-05-19T00:00:00Z',
  updatedAt: '2026-05-19T00:00:00Z',
  metadata: { domain: 'general' },
});

// id is a freshly-minted UUIDv7
expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const got = await store.getEntity(id);
expect(got!.name).toBe('CodingProject');

await store.exportJson();
// then /tmp/km-test/exports/general.json contains { nodes: [...], edges: [], ... }

await store.close();
```

### Example 2: Atomic batch write

```typescript
// Source: D-17 + context7.com/level/classic-level batch docs

await store.batch([
  { type: 'putEntity', entity: { name: 'A', entityType: 'Component', /* ... */ } },
  { type: 'putEntity', entity: { name: 'B', entityType: 'Component', /* ... */ } },
  { type: 'addRelation', relation: { type: 'CONTAINS', from: idA, to: idB, /* ... */ } },
]);
// All three operations succeed atomically, or none do.
// classic-level's db.batch(...) provides the LevelDB-level atomicity.
// In-memory Graphology mutations are applied AFTER all validations pass.
```

### Example 3: AsyncIterator over a filter

```typescript
// Source: D-18

for await (const e of store.iterate({ entityType: 'Component' })) {
  console.log(e.name);                    // yields lazily — no full graph materialization
}
```

### Example 4: Event subscription

```typescript
// Source: D-16

store.on('entity:put', (event) => {
  console.log('entity put:', event.entity.id);
  // coding's existing Redis pub/sub bridge would subscribe here and republish
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| B's `entity.type` vs `entity.entityType` split | Single `entity.entityType` (canonical) | This phase (Phase 37) | B's downstream code that reads `entity.type` (kg-operators.ts) gets a one-line refactor in Phase 42 |
| UUIDv4 via `crypto.randomUUID()` (Node native) | UUIDv7 via `uuidv7` package | This phase | Time-ordered IDs give LevelDB iteration locality; cost is +3KB dep |
| Single export file at `.data/knowledge-export/coding.json` | Per-domain at `.data/exports/{domain}.json` | This phase | Legacy path stays via symlink (D-21) — no breaking change to readers |
| Implicit `type`/`entityType` strings | Branded `EntityId` (compile-time tag) | This phase | TypeScript catches `Relation { from: '...string...', to: '...string...' }` mistakes that used to pass |
| Per-system stores (B uses its own, C uses its own) | Shared `GraphKMStore` consumed via submodule | This phase | Bug fixes land once; semantic drift between B and C ends |

**Deprecated/outdated:**
- B's `KGEntity.type` field — kept transiently for Phase 37 source compatibility, removed in Phase 42's migration.
- Direct callers of B's `GraphDatabaseService` outside the adapter — should migrate to `GraphKMStore` during Phase 42. KM-Core does NOT re-export `GraphDatabaseService`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OKM (C) will adopt KM-Core via git submodule in Phase 43, not via the `file:` reference it currently uses for `@rapid/llm-proxy` | Pattern 6, Architecture | If OKM's Phase 43 picks `file:` over submodule, the build flow at OKM end differs (no submodule update; copy of dist instead). Doesn't affect Phase 37 — KM-Core ships the same way either way. |
| A2 | The `level` 10.0.0 in B's package.json dedupes cleanly with km-core's `classic-level` 3.0.0 — npm's resolver picks `classic-level` 3.0.0 in node_modules root and B's `level` umbrella resolves to it | Pitfall 6 | If npm fails to dedupe (e.g., different peer-dep ranges), Phase 37 still works (km-core has its own classic-level), but B may pull in a second classic-level. Wastes ~10MB. Resolvable by manual `npm dedupe`. |
| A3 | The pre-commit OKB-guard hook's regex `\.data/(knowledge-export\|exports)/.*\.json$` already accommodates the canonical `.data/exports/` path — verified by reading `scripts/hooks/pre-commit-okb-guard.sh` line 16 | Pattern 7, Project Constraints | If the hook is modified during Phase 37 (it shouldn't be — D-23), KM-Core's writes might trip new guard logic. Mitigation: Phase 37 plans must NOT touch the hook. |
| A4 | Vitest 4.x compiles TS via `vite-node` or built-in transformer without needing a separate `ts-jest`-style config | Standard Stack | If vitest 4 changed its TS handling, the test setup might need an extra babel/tsx config. Verified by inspecting OKM's `vitest.config.ts` — works as-is. LOW risk. |
| A5 | UUIDv7's k-sortability actually helps LevelDB b-tree locality at our entity counts (~hundreds to thousands) — at <10k entities the gain may be marginal | Summary, D-08 rationale | If the gain is marginal, we've chosen v7 for debuggability alone — that's still a valid reason. NO downside vs v4. |
| A6 | The `domain` field exists in `entity.metadata.domain` for OKM entities (verified in C's persistence.ts line 106) but does NOT exist in B's current `KGEntity`/`SharedMemoryEntity` shape | Pattern 3 | When B migrates in Phase 42, its entities must gain a `metadata.domain` field. For Phase 37 (no B migration), the exporter defaults missing domains to `'general'` — same behavior as C (line 106). |
| A7 | The `level` umbrella to `classic-level` substitution is transparent to B's existing `level@^10.0.0` consumers in coding/integrations/mcp-server-semantic-analysis | Pitfall 6 | If something in B uses umbrella-only API, the substitution isn't transparent. NPM published metadata shows level 10 is essentially an alias loader for classic-level — LOW risk. |

## Open Questions

1. **Does `lib/` need to be added to coding's `.gitignore` somewhere?**
   - What we know: `lib/llm`, `lib/agent-api`, etc. are in-repo dirs (not gitignored). They have `node_modules/` which IS gitignored at the root level by `node_modules/` pattern.
   - What's unclear: Does the existing root `node_modules/` exclusion catch `lib/km-core/node_modules/` recursively?
   - Recommendation: Verify with `git check-ignore -v lib/km-core/node_modules/foo`. If not caught, add an explicit `lib/km-core/node_modules/` line — but this is a code-level concern for plan execution, not phase planning.

2. **Should `EntityId` be a discriminated union (`EvidenceId | PatternId`) keyed by `layer`?**
   - What we know: C's keys use `"evidence:" + uuid` and `"pattern:" + uuid` prefixes (verified by persistence.test.ts line 58).
   - What's unclear: Whether KM-Core canonicalizes to plain UUID strings or keeps the prefix.
   - Recommendation: **Plain UUIDv7 strings**. The `layer` field on `Entity` already discriminates. Prefix-encoding is a C artifact that should not propagate. C's migration in Phase 43 strips prefixes during read.

3. **What does Phase 37's "manual publish workflow" actually do?**
   - What we know: D-07 says "manual-trigger npm publish workflow (not auto-fired in v7.1)".
   - What's unclear: Does it `npm publish` to the public registry, to GitHub Packages, or just produce a `.tgz` artifact?
   - Recommendation: `workflow_dispatch` trigger that produces a `.tgz` via `npm pack` as a GitHub Actions artifact. No actual `npm publish` — that's deferred entirely. Avoids accidental publication during the v7.1 window.

4. **Should KM-Core ship a Python sister package or REST shim for A (online learning)?**
   - What we know: A keeps SQLite per CONTEXT.md and the "What stays per-system" section of the milestone research. A's adapter (Phase 41) is "a thin KM-Core adapter exposes observations/digests/insights as KM-Core entities."
   - What's unclear: Is the adapter purely in Node (importing `@fwornle/km-core` directly), or does it call into KM-Core via REST?
   - Recommendation: **Direct Node import** — A's hot path stays SQLite-native, but the read-side adapter (the part that surfaces observations as KM-Core entities) is a Node module that imports km-core types. No REST shim needed. Phase 41 detail.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All KM-Core dev/runtime | yes | 22.x | — |
| npm | Package install | yes | 10.x | — |
| GitHub CLI (`gh`) | Creating the public repo `github.com/fwornle/km-core` | check via `command -v gh` | varies | Manual creation via github.com web UI |
| git submodule | Mounting at `coding/lib/km-core/` | yes (git 2.x) | — | — |
| Docker | Coding container build | yes (per CLAUDE.md) | 24+ | — |
| `plantuml` CLI | README architecture diagram (optional in v0.1) | yes (per CLAUDE.md mandate) | — | Skip diagram or use Mermaid (markdown-native, used in this RESEARCH.md) |
| `ctx7` CLI | Library doc lookup during plan execution | yes (installed via npx ctx7@latest) | 0.4.2 | WebSearch fallback |
| `slopcheck` | Package legitimacy gate (research-time only) | yes (installed at `~/Library/Python/3.9/bin/slopcheck`) | 0.6.1 | npm view fallback (manual) |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** `gh` (use web UI to create the repo if unavailable)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 [VERIFIED: npm registry; matches OKM pin] |
| Config file | `vitest.config.ts` (mirror OKM's at `_work/rapid-automations/integrations/operational-knowledge-management/vitest.config.ts`) |
| Quick run command | `npm test -- tests/unit/<file>.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-01 | `Entity` and `Relation` types exported from `@fwornle/km-core` are importable from a TypeScript consumer file with `strict: true` | unit (type-level, via `tsd` or `vitest` `expectTypeOf`) | `npm test -- tests/unit/entity.test.ts` | Wave 0 |
| CORE-01 | `EntityId` branded type rejects raw `string` at compile time | unit (compile-fail test via `// @ts-expect-error`) | `npm test -- tests/unit/ids.test.ts` | Wave 0 |
| CORE-02 | `GraphKMStore.putEntity` + `getEntity` round-trip preserves all fields | unit | `npm test -- tests/unit/graph-store.test.ts` | Wave 0 |
| CORE-02 | `GraphKMStore.exportJson` writes per-domain files atomically | unit | `npm test -- tests/unit/exporter.test.ts` | Wave 0 |
| CORE-02 | `GraphKMStore.batch` is all-or-nothing under failure | unit | `npm test -- tests/unit/graph-store.test.ts` | Wave 0 |
| CORE-02 | `GraphKMStore` emits expected events (`entity:put`, `entity:delete`, `relation:added`, `relation:removed`) | unit | `npm test -- tests/unit/graph-store.test.ts` | Wave 0 |
| CORE-02 | `GraphKMStore.iterate` yields entities lazily and respects filter object | unit | `npm test -- tests/unit/graph-store.test.ts` | Wave 0 |
| CORE-02 | **Parity test:** import frozen `b-coding-snapshot.json` fixture, export, assert byte-equal after canonical key-sort | integration | `npm test -- tests/integration/round-trip.test.ts` | Wave 0 |
| CORE-02 | **Parity test:** same for `c-raas-snapshot.json`, `c-kpifw-snapshot.json`, `c-general-snapshot.json` | integration | `npm test -- tests/integration/round-trip.test.ts` | Wave 0 |
| CORE-03 | `putEntity` without `id` stamps a fresh UUIDv7 matching the v7 regex | unit | `npm test -- tests/unit/ids.test.ts` | Wave 0 |
| CORE-03 | `putEntity` with caller-supplied valid UUIDv7 `id` keeps the ID verbatim | unit | `npm test -- tests/unit/ids.test.ts` | Wave 0 |
| CORE-03 | `putEntity` with caller-supplied invalid `id` throws `SyntaxError` from `parseEntityId` | unit | `npm test -- tests/unit/ids.test.ts` | Wave 0 |
| CORE-03 | UUIDv7 IDs survive `exportJson()` then re-import round-trip unchanged | integration | `npm test -- tests/integration/round-trip.test.ts` | Wave 0 |
| CORE-03 | UUIDv7 IDs sort lexicographically by creation time | unit | `npm test -- tests/unit/ids.test.ts` | Wave 0 |
| ROADMAP SC#4 | `.data/knowledge-export/coding.json` symlink points to `.data/exports/coding.json` AND pre-commit hook regex matches BOTH paths | manual + integration | `bash tests/integration/symlink-bc.sh` (shell test that calls the actual hook in dry-run mode) | Wave 0 |

**Why parity-by-fixture (not parity-by-live-store):**
- **Reproducibility:** anyone can run the parity test without B/C runtime.
- **Stability:** frozen fixtures capture a known-good shape; live stores drift.
- **Locality:** the test runs entirely inside `km-core/` — no cross-repo dependency.
- **Falsifiability:** if Phase 37 inadvertently changes the export shape, the byte-equality check fires immediately.

**Smallest reference dataset that proves CORE-01 through CORE-03:**
- 1 fixture per upstream system (B, C-raas, C-kpifw, C-general) = 4 snapshots.
- Each snapshot under ~100KB (current `.data/knowledge-export/coding.json` is around 80KB).
- Total fixture footprint: about 400KB committed to `tests/fixtures/`.

**Fallback parity strategy (if frozen-fixture is rejected as too brittle):**
- Snapshot-test approach: capture `JSON.stringify(graph.export(), null, 2)` to a `.snap` file via vitest's `toMatchInlineSnapshot()`. First run produces snapshot; subsequent runs assert byte-equality. Pros: less manual fixture curation. Cons: snapshot drift can mask real regressions.

### Sampling Rate
- **Per task commit:** `npm test -- tests/unit/<file>.test.ts` (quick, under 2s per file)
- **Per wave merge:** `npm test` (full suite — should run in under 30s; OKM's full suite at 22 test files runs in about 15s on M1)
- **Phase gate:** Full suite green + integration parity green before `/gsd:verify-work`

### Wave 0 Gaps
All test files listed above are new — Wave 0 must create:
- [ ] `tests/unit/entity.test.ts` — covers CORE-01 (type exports, branded type)
- [ ] `tests/unit/ids.test.ts` — covers CORE-03 (UUIDv7 stamping, validation, k-sortability)
- [ ] `tests/unit/graph-store.test.ts` — covers CORE-02 (CRUD, batch, iterate, events)
- [ ] `tests/unit/persistence.test.ts` — covers CORE-02 (LevelDB hydrate, JSON fallback)
- [ ] `tests/unit/exporter.test.ts` — covers CORE-02 (atomic rename, debounce, per-domain bucketing)
- [ ] `tests/integration/round-trip.test.ts` — covers CORE-02 parity + CORE-03 ID survival
- [ ] `tests/integration/symlink-bc.sh` — covers ROADMAP SC#4 (legacy path BC via symlink)
- [ ] `tests/fixtures/b-coding-snapshot.json` — captured at the start of Phase 37 from coding/.data/knowledge-export/coding.json
- [ ] `tests/fixtures/c-{raas,kpifw,general}-snapshot.json` — captured from rapid-automations
- [ ] `vitest.config.ts` — copy from OKM verbatim; minor path adjustments
- [ ] Framework install: `npm install --save-dev vitest@^4.0.18 @vitest/expect typescript@^5.9.3 @types/node@^22.0.0`

## Sources

### Primary (HIGH confidence)
- **Context7 `/liosk/uuidv7`** — uuidv7 generation, `UUID.parse()`, k-sortability — fetched 2026-05-19
- **Context7 `/graphology/graphology`** — `export()`/`import()`/`Graph.from()` serialization round-trip — fetched 2026-05-19
- **Context7 `/level/classic-level`** — `db.batch()` atomic semantics, encoding options — fetched 2026-05-19
- **B's `graph-database-adapter.ts`** at `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` — full source read
- **B's `kg-operators.ts`** lines 31-47 — KGEntity shape — full source read
- **B's `persistence-agent.ts`** lines 575-615 — SharedMemoryEntity + ontology classification path — full source read
- **C's `persistence.ts`** at `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/persistence.ts` — full source read
- **C's `entity.ts`** at `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/types/entity.ts` — full source read
- **C's `tests/unit/persistence.test.ts`** — vitest pattern reference — full source read
- **B's `GraphKnowledgeExporter.js`** — debounced per-team export pattern — partial read
- **Pre-commit hook** at `/Users/Q284340/Agentic/coding/scripts/hooks/pre-commit-okb-guard.sh` — full source read; regex covers both legacy and canonical paths
- **`docker-compose.yml`** + **`Dockerfile.coding-services`** — bind-mount and build patterns inspected
- **slopcheck v0.6.1** — `[OK]` verdict on all 4 deps, run 2026-05-19
- **`.planning/research/v7.1-km-unification.md`** — milestone-level architectural source of truth

### Secondary (MEDIUM confidence)
- **B's `package.json`** — version pins (graphology 0.25.4, level 10.0.0, zod 4.3.6)
- **C's `package.json`** — version pins (graphology 0.26.0, classic-level 3.0.0, vitest 4.0.18)
- **`STACK.md`** — confirms Node 22, TS 5.8+, ESM throughout, Jest established in coding tree
- **npm registry** — version current-as-of-2026-05-19 confirmed for all 4 deps

### Tertiary (LOW confidence)
- (none — all critical claims verified)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package verified on npm + Context7 + matches OKM production pins
- Architecture: HIGH — derived directly from running B and C source; minimal novel design
- Pitfalls: MEDIUM — Pitfalls 1 (native binding) and 5 (`--production` strip) are real risks from inspecting the actual Dockerfile, but precise mitigation depends on plan-time decisions
- Parity test strategy: HIGH — frozen-fixture approach is standard practice (OKM uses snapshot tests), and the 4 fixture files are already producible from current production state

**Research date:** 2026-05-19
**Valid until:** 2026-06-18 (30 days — stable mature stack, low churn risk on the 4 deps)

## RESEARCH COMPLETE
