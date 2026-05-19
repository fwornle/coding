# Phase 37: KM-Core Foundation — Pattern Map

**Mapped:** 2026-05-19
**Files analyzed:** 28 new/modified files
**Analogs found:** 21 / 28 (7 net-new — bootstrap scaffolding with no direct analog)

Phase 37 is, per RESEARCH.md, **almost pure extraction**. The vast majority of patterns are lifted from two canonical sources:
1. `_work/rapid-automations/integrations/operational-knowledge-management/` (C / OKM) — the type shape, persistence layer, vitest harness, tsconfig
2. `coding/integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` (B) — the repository-class shape, async API surface, mergeAttributes pattern
3. `coding/src/knowledge-management/GraphKnowledgeExporter.js` (B) — the per-team debounced exporter pattern (5s timer, Map of pending timers)

The planner should treat OKM as the **strict superset** baseline (D-13/CORE-01 rationale): adopt C's shape verbatim, then layer in B's missing pieces (event names, mergeAttributes hot path, dbPath/team constructor signature).

## File Classification

### Source code (new repo `~/Agentic/km-core/src/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/types/entity.ts` | model (type) | n/a | `_work/.../okm/src/types/entity.ts` | EXACT (adopt verbatim + add `EntityId` brand + `legacyId`) |
| `src/types/index.ts` | barrel | n/a | (any barrel; trivial) | EXACT |
| `src/ids/branded.ts` | utility (type) | n/a | (no analog — net-new) | NONE |
| `src/ids/mint.ts` | utility | request-response | `uuidv7` npm README | EXACT (wrap one call) |
| `src/ids/parse.ts` | utility (validator) | request-response | `uuidv7` `UUID.parse()` | EXACT |
| `src/store/persistence.ts` | service | file-I/O + CRUD | `_work/.../okm/src/store/persistence.ts` | EXACT (adopt verbatim, parametrize domains) |
| `src/store/exporter.ts` | service | event-driven + file-I/O | `_work/.../okm/src/store/persistence.ts:97-161` + `coding/src/knowledge-management/GraphKnowledgeExporter.js:35-123` | composite |
| `src/store/GraphKMStore.ts` | service (repository) | CRUD + event-driven | `coding/integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` + `_work/.../okm/src/store/graph-store.ts` | role-match (compose B's adapter API + C's GraphStore body) |
| `src/store/types.ts` | model (type) | n/a | (net-new — `BatchOp`, `FilterObject`) | NONE |
| `src/events/types.ts` | model (type) | n/a | (net-new) | NONE |
| `src/validation/ontology.ts` | service (interface) | request-response | (Phase 38 detail — v0.1 ships no-op) | NONE |
| `src/index.ts` | barrel | n/a | (any barrel) | EXACT |

### Repo bootstrap (new repo root)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `package.json` | config | n/a | `_work/.../okm/package.json` | EXACT (mirror deps + scripts; rename + license + type:module) |
| `tsconfig.json` | config | n/a | `_work/.../okm/tsconfig.json` | EXACT (adopt verbatim) |
| `vitest.config.ts` | config | n/a | `_work/.../okm/vitest.config.ts` | EXACT (adopt verbatim) |
| `.github/workflows/ci.yml` | config (CI) | n/a | `_work/rapid-automations/.github/workflows/ci.yml` (shape only — Python → Node swap) | role-match |
| `.github/workflows/publish.yml` | config (CI) | n/a | (net-new — `workflow_dispatch` `npm pack`) | NONE |
| `README.md` | docs | n/a | (net-new — see RESEARCH §Pitfall 7 re: Mermaid only) | NONE |
| `LICENSE` (MIT) | docs | n/a | standard MIT text | EXACT |
| `CONTRIBUTING.md` | docs | n/a | (net-new) | NONE |
| `.gitignore` | config | n/a | `_work/.../okm/.gitignore` mental model — `node_modules/`, `dist/`, `coverage/`, `*.tgz` | role-match |

### Coding-side integration (this repo)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `coding/lib/km-core/` (submodule mount) | config (submodule) | n/a | existing `integrations/<name>/` submodule entries in `coding/.gitmodules` | role-match (new location, same mechanism) |
| `coding/Dockerfile.coding-services` (modify L106-126) | config (build) | n/a | existing `RUN cd lib/llm && npm install ...` at L106 + L126 | EXACT pattern to mirror |
| `coding/docker-compose.yml` (modify L91-130) | config (deploy) | n/a | existing `lib/vkb-server` mount at L130 + `system-health-dashboard/dist` at L96 | EXACT pattern to mirror |
| `coding/.gitmodules` (append) | config | n/a | existing 5 entries in the same file | EXACT |
| `coding/.data/knowledge-export/coding.json` (file → symlink) | runtime state | n/a | (no analog — net-new migration) | NONE |
| `coding/.data/observation-export/*.json` (file → symlink) | runtime state | n/a | (no analog — defer to Phase 41 per RESEARCH §Pattern 7) | NONE — out of Phase 37 scope |
| `coding/scripts/migrate-exports-to-symlinks.mjs` | utility (one-shot script) | file-I/O | other `coding/scripts/*.mjs` (Phase 36 backfill scripts) | role-match |

## Pattern Assignments

---

### `src/types/entity.ts` (model, type)

**Analog:** `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/types/entity.ts` (full file, 108 lines — adopt VERBATIM with two deltas listed below)

**Type-shape excerpt** (lines 70-94 of analog):

```typescript
export type Layer = 'evidence' | 'pattern';

export interface Entity {
  id: string;                       // → DELTA: change to EntityId
  name: string;
  entityType: string;
  ontologyClass?: string;
  layer: Layer;
  description: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  validFrom?: string;
  validUntil?: string;
}

export interface Edge {            // → DELTA: rename to Relation per CONTEXT D-14
  type: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  validFrom?: string;
  validUntil?: string;
}
```

**Provenance subtypes** (lines 1-68 of analog) — adopt verbatim. Includes `ProvenanceStamp`, `EntityProvenance`, `SegmentConfirmation`, `DescriptionSegment`, `ResolutionRecord`. These exist in C already; Phase 39 will populate them but they must be declared now.

**SerializedGraph** (lines 96-107 of analog) — adopt verbatim; this is exactly what `MultiDirectedGraph.export()` returns and what `import()` consumes.

**DELTAS the executor must apply:**

1. **Brand the `id` field:** `import type { EntityId } from '../ids/branded.js';` then change `id: string` → `id: EntityId`. Same for `supersedes?: EntityId`.
2. **Rename `Edge` → `Relation`** with `from: EntityId; to: EntityId` fields added (C's `Edge` is `addEdge(source, target, edge)` so source/target live outside the type; KM-Core moves them inside per D-14's `addRelation(r: Relation)` signature).
3. **Add `legacyId` field** per D-13: `legacyId?: { system: 'A' | 'B' | 'C'; id: string };`
4. **Drop the `bin: { "okb": "./bin/okb.ts" }` related types** if any — KM-Core is library-only, no CLI.

---

### `src/ids/branded.ts` (utility, type — NET-NEW)

No analog. RESEARCH §Pattern 5 gives the canonical form:

```typescript
// Source: RESEARCH.md §Pattern 5 + D-11
export type EntityId = string & { readonly __brand: 'EntityId' };
```

That's the entire file. Five lines including imports/comment. Zero runtime cost.

---

### `src/ids/mint.ts` (utility, request-response)

**Analog:** `uuidv7` npm package README (Context7 `/liosk/uuidv7`) + RESEARCH §Pattern 4 (lines 412-423 of `37-RESEARCH.md`).

**Full excerpt to use:**

```typescript
// Source: composite of RESEARCH §Pattern 4 + context7.com/liosk/uuidv7
import { uuidv7 } from 'uuidv7';
import type { EntityId } from './branded.js';

export function mintEntityId(): EntityId {
  return uuidv7() as EntityId;
}
```

**DELTAS:** none — this is the canonical form. `mintEntityId` is the ONLY way to mint a fresh ID (D-11).

---

### `src/ids/parse.ts` (utility, validator)

**Analog:** RESEARCH §Pattern 4 (line 420 of `37-RESEARCH.md`) + `uuidv7` package's `UUID.parse(s)` (throws `SyntaxError` on invalid input).

**Excerpt:**

```typescript
// Source: RESEARCH §Pattern 4 + uuidv7 README
import { UUID } from 'uuidv7';
import type { EntityId } from './branded.js';

/**
 * Validate a string is a well-formed UUIDv7. Throws SyntaxError on invalid input.
 * NOTE: does NOT check that the variant is v7 specifically — uuidv7 package
 * parses any RFC 9562 UUID. Use this only where the source is trusted to be v7.
 */
export function parseEntityId(s: string): EntityId {
  UUID.parse(s);             // throws SyntaxError if invalid format
  return s as EntityId;
}
```

**DELTAS:** Optional — also assert `s.charAt(14) === '7'` to reject non-v7 UUIDs explicitly (RESEARCH §Pitfall 2 warns about this). Recommend adding the check; planner decides.

---

### `src/store/persistence.ts` (service, file-I/O + CRUD)

**Analog:** `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/persistence.ts` (full file, 166 lines — adopt VERBATIM with parameterization below)

**Constructor + LevelDB setup** (lines 1-18 of analog):

```typescript
import { ClassicLevel } from 'classic-level';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SerializedGraph } from '../types/entity.js';

export class PersistenceManager {
  private db: ClassicLevel<string, string>;
  private exportDir: string;
  private writing = false;

  constructor(dbPath: string, exportDir: string) {
    fs.mkdirSync(dbPath, { recursive: true });
    fs.mkdirSync(exportDir, { recursive: true });
    this.db = new ClassicLevel(dbPath, { valueEncoding: 'utf8' });
    this.exportDir = exportDir;
  }
```

**LevelDB-first + JSON-fallback hydrate** (lines 20-90 of analog) — adopt VERBATIM. This is the key pattern: try LevelDB first, fall back to per-domain JSON merge if LEVEL_NOT_FOUND. The error narrowing on lines 32-40 is non-trivial — copy exactly:

```typescript
async hydrate(): Promise<SerializedGraph | null> {
  try {
    await this.db.open();
    const data = await this.db.get('graph:state');
    if (data !== undefined && data !== null) {
      return JSON.parse(data) as SerializedGraph;
    }
  } catch (err: unknown) {
    if (
      !(err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'LEVEL_NOT_FOUND')
    ) {
      throw err;
    }
  }
  return this.hydrateFromJsonExports();
}
```

**DELTAS the executor must apply:**

1. **Parametrize the domain list.** Lines 61 and 113 of analog hard-code `['raas', 'kpifw', 'general']` (C's domains). KM-Core must accept domains in the constructor:
   ```typescript
   constructor(dbPath: string, exportDir: string, opts?: { domains?: readonly string[] }) {
     this.domains = opts?.domains ?? ['general'];   // sane default; consumers supply their list
   }
   ```
   Replace both hard-coded arrays with `this.domains`.

2. **Replace `console.info` on line 84** with a configurable logger or `process.stderr.write()` (CLAUDE.md `no-console-log` constraint).

3. **NO change** to the `writing` re-entry guard on line 9 (CONTEXT D-22 requires this exact behavior).

4. **NO change** to the atomic write — C does `fs.promises.writeFile(filePath, JSON.stringify(...))` at line 153. **However**, RESEARCH §Pattern 3 (lines 391-396 of `37-RESEARCH.md`) says KM-Core MUST upgrade this to a true temp-file + rename for atomicity:
   ```typescript
   // REPLACE line 152-154 of analog with:
   const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
   await fs.promises.writeFile(tempPath, JSON.stringify(domainGraph, null, 2), 'utf-8');
   await fs.promises.rename(tempPath, filePath);   // atomic on POSIX
   ```
   This is the OKB-baseline-guard safety guarantee (RESEARCH §Pattern 3, footnote).

---

### `src/store/exporter.ts` (service, event-driven + file-I/O)

**Analogs (composite):**
1. `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/persistence.ts:97-161` — per-domain bucketing logic
2. `/Users/Q284340/Agentic/coding/src/knowledge-management/GraphKnowledgeExporter.js:35-123` — debounce-timer-per-team pattern

**Per-domain bucketing pattern** (C's persistence.ts:101-110):

```typescript
const STANDARD_DOMAINS = new Set(['raas', 'kpifw', 'general']);
const domainNodes = new Map<string, typeof data.nodes>();
for (const node of data.nodes) {
  const rawDomain = (node.attributes?.metadata?.domain as string) || 'general';
  const domain = STANDARD_DOMAINS.has(rawDomain) ? rawDomain : 'general';
  if (!domainNodes.has(domain)) domainNodes.set(domain, []);
  domainNodes.get(domain)!.push(node);
}
```

**Debounce-timer pattern** (B's GraphKnowledgeExporter.js:100-123 — adapt the Map<team, Timer> pattern to a single timer since KM-Core exports the whole graph each tick):

```javascript
// Source: coding/src/knowledge-management/GraphKnowledgeExporter.js:100-123
_scheduleExport(team) {
  if (!team || team === 'undefined') {
    console.warn('[GraphKnowledgeExporter] Skipping export for undefined team');
    return;
  }
  if (this.exportTimers.has(team)) {
    clearTimeout(this.exportTimers.get(team));
  }
  const timer = setTimeout(async () => {
    try {
      await this.exportTeam(team);
      this.exportTimers.delete(team);
    } catch (error) {
      console.error(`Failed to auto-export team "${team}":`, error.message);
    }
  }, this.debounceMs);
  this.exportTimers.set(team, timer);
}
```

**Event-subscription pattern** (B's GraphKnowledgeExporter.js:66-80):

```javascript
this.graphService.on('entity:stored', (event) => {
  this._scheduleExport(event.team);
});
this.graphService.on('entity:deleted', (event) => {
  this._scheduleExport(event.team);
});
this.graphService.on('relationship:stored', (event) => {
  this._scheduleExport(event.team);
});
this.graphService.on('relationship:deleted', (event) => {
  this._scheduleExport(event.team);
});
```

**DELTAS the executor must apply:**

1. **TS conversion:** rewrite B's `.js` patterns as strict TS with explicit types.
2. **Single-timer design:** KM-Core exports the whole graph per tick (not per team). One `private exportTimer: NodeJS.Timeout | null = null` field, one debounce window. Per-domain bucketing happens INSIDE the export call, not via separate timers.
3. **Event names match D-16:** KM-Core's events are `entity:put`, `entity:delete`, `relation:added`, `relation:removed` (NOT B's `entity:stored`/`relationship:stored`). Rewire `on()` calls accordingly.
4. **Default debounce 5000 ms** per D-22 (B uses 5s, OKM uses sync — KM-Core ships 5s).
5. **Replace all `console.log`/`console.warn`/`console.error`** with `process.stderr.write()` or accept a logger via constructor (CLAUDE.md constraint).
6. **Upgrade naive `fs.writeFile` to temp+rename** as in `persistence.ts` deltas above.

---

### `src/store/GraphKMStore.ts` (service, repository class, CRUD + event-driven)

**Analogs (composite):**
1. `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` — API surface: `initialize()`, `storeEntity()`, `queryEntities()`, `exportToJSON()`, `mergeAttributes()`, `deleteEntity()`, `close()`. Use the **shape** but not the VKB-API/direct-access fork — KM-Core has no VKB.
2. `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/graph-store.ts` — In-memory Graphology operations: `addEntity()` (line 69), `getEntity()` (80), `updateEntity()` (85), `deleteEntity()` (135), `addEdge()` (141), `getEdges()` (217), `filterByLayer()` (256), `export()` (328), `import()` (332). Adopt these for the in-memory layer.

**Class skeleton** (RESEARCH §Pattern 2, lines 314-360 of `37-RESEARCH.md`):

```typescript
import { MultiDirectedGraph } from 'graphology';
import { ClassicLevel } from 'classic-level';
import { EventEmitter } from 'node:events';
import { mintEntityId, parseEntityId } from '../ids/mint.js';
import type { Entity, Relation, EntityId, SerializedGraph } from '../types/entity.js';

export interface GraphKMStoreOptions {
  dbPath: string;
  exportDir: string;
  debounceMs?: number;
  ontologyValidator?: OntologyValidator;
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
  async close(): Promise<void> { /* flush, await pending export, db.close() */ }
}
```

**`putEntity` semantics — stamp-or-keep** (RESEARCH §Pattern 4 + D-10/D-19):

```typescript
async putEntity(
  e: Partial<Entity> & { name: string; entityType: string },
  opts?: { skipOntologyCheck?: boolean }
): Promise<EntityId> {
  // 1. D-19 validation
  if (!opts?.skipOntologyCheck) {
    this.validator?.validate(e.entityType);   // throws on invalid class
  }
  // 2. D-10 stamp-or-keep
  let id: EntityId;
  if (e.id) {
    id = parseEntityId(e.id as string);       // throws SyntaxError on invalid
  } else {
    id = mintEntityId();
  }
  // 3. Graphology merge — see OKM graph-store.ts:71
  const now = new Date().toISOString();
  const entity: Entity = {
    ...e, id,
    createdAt: e.createdAt ?? now,
    updatedAt: now,
    layer: e.layer ?? 'evidence',
    description: e.description ?? '',
    metadata: e.metadata ?? {},
  } as Entity;
  this.graph.mergeNode(id, entity);
  // 4. LevelDB durable write
  await this.db.put(`entity:${id}`, JSON.stringify(entity));
  // 5. emit
  this.emit('entity:put', { entity });
  // 6. debounced export
  this._scheduleExport();
  return id;
}
```

**`mergeAttributes` hot path** (from B's adapter line 343-347 — preserve this for operator-enriched updates):

```typescript
// Source: graph-database-adapter.ts:343-347
async mergeAttributes(nodeId: EntityId, attributes: Partial<Entity>): Promise<void> {
  if (!this.graph.hasNode(nodeId)) {
    throw new Error(`Node ${nodeId} not found in graph`);
  }
  this.graph.mergeNodeAttributes(nodeId, attributes);
  this.emit('entity:put', { entity: this.graph.getNodeAttributes(nodeId) as Entity });
  this._scheduleExport();
}
```

**Batch (D-17)** — atomic LevelDB batch + validate-all-then-apply Graphology:

```typescript
// Source: RESEARCH §Pattern 2 + context7 /level/classic-level batch docs
async batch(ops: BatchOp[]): Promise<void> {
  // Validate ALL first (D-17 all-or-nothing)
  for (const op of ops) {
    if (op.type === 'putEntity') {
      if (op.entity.id) parseEntityId(op.entity.id);
    }
  }
  // Build LevelDB batch
  const dbOps = ops.map(op => this.toLevelBatchOp(op));
  await this.db.batch(dbOps);
  // Apply in-memory after DB commit succeeds
  for (const op of ops) { this.applyInMemory(op); }
  // Emit events + schedule export
  for (const op of ops) { this.emitFor(op); }
  this._scheduleExport();
}
```

**AsyncIterator (D-18):**

```typescript
// Source: D-18 + RESEARCH §Pattern 2
async *iterate(filter?: Partial<Entity>): AsyncIterable<Entity> {
  for (const nodeId of this.graph.nodes()) {
    const entity = this.graph.getNodeAttributes(nodeId) as Entity;
    if (this.matches(entity, filter)) {
      yield entity;
    }
  }
}
```

**DELTAS the executor must apply:**

1. **Strip the VKB-API fork from B's adapter.** B's `useApi`/`apiClient` branches (graph-database-adapter.ts:55-93, 259-275, 309-322, 337-341, 373-378) are coding-specific — KM-Core has no VKB. Use only the "direct" path.
2. **Switch event names** from B's `entity:stored`/`relationship:stored` → KM-Core's `entity:put`/`entity:delete`/`relation:added`/`relation:removed` (D-16).
3. **Use composite nodeId scheme — DECIDE BEFORE WRITE.** C uses `${layer}:${id}` keys (graph-store.ts:70). RESEARCH Open Question #2 says: **plain UUIDv7 as nodeId**, NOT `layer:uuid` prefixing. Layer is a separate field. C's migration in Phase 43 strips the prefix.
4. **Extend `EventEmitter`** (Node's built-in). Do NOT use Redis pub/sub — D-16 says in-process emitter; the bridge is a consumer responsibility.
5. **NO `setEntityProvenance` / `setProvenance` methods in v0.1** — Phase 39 adds those; v0.1 just declares the types.
6. **Constructor takes `GraphKMStoreOptions` object, NOT `(dbPath, team)` positional**. B's positional signature was a historical accident; D-14 says repository pattern with typed methods → options object.
7. **The `team` field is GONE.** KM-Core has no concept of "team" — that's a coding-specific abstraction. Domain bucketing in the exporter replaces it.

---

### `src/store/types.ts` (model, type — NET-NEW)

No analog. Net-new types for the store API surface:

```typescript
// Net-new — see CONTEXT D-14, D-17, D-18 for shape
import type { Entity, Relation, EntityId } from '../types/entity.js';

export type BatchOp =
  | { type: 'putEntity'; entity: Partial<Entity> & { name: string; entityType: string } }
  | { type: 'deleteEntity'; id: EntityId }
  | { type: 'addRelation'; relation: Relation }
  | { type: 'removeRelation'; relation: Relation };

export interface FilterObject {
  entityType?: string;
  ontologyClass?: string;
  layer?: 'evidence' | 'pattern';
  // Phase 38 may extend with metadata-key predicates
}
```

---

### `src/events/types.ts` (model, type — NET-NEW)

No direct analog. Per D-16:

```typescript
import type { Entity, Relation } from '../types/entity.js';

export interface EntityPutEvent  { entity: Entity }
export interface EntityDeleteEvent { id: string }
export interface RelationAddedEvent   { relation: Relation }
export interface RelationRemovedEvent { relation: Relation }
```

---

### `src/index.ts` (barrel)

```typescript
export type { Entity, Relation, Layer, EntityId, SerializedGraph } from './types/entity.js';
export type { BatchOp, FilterObject } from './store/types.js';
export type {
  EntityPutEvent, EntityDeleteEvent,
  RelationAddedEvent, RelationRemovedEvent
} from './events/types.js';
export { mintEntityId } from './ids/mint.js';
export { parseEntityId } from './ids/parse.js';
export { GraphKMStore } from './store/GraphKMStore.js';
export type { GraphKMStoreOptions } from './store/GraphKMStore.js';
```

---

### `package.json` (config)

**Analog:** `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/package.json` (42 lines — mirror EXACTLY for dep shape; rename + license + omit unused deps)

**OKM excerpt to adapt (lines 1-41):**

```json
{
  "name": "okb-server",
  "version": "0.1.0",
  "type": "module",
  "description": "Operational Knowledge Base - Graph store and HTTP API",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "license": "UNLICENSED",
  "dependencies": {
    "classic-level": "^3.0.0",
    "graphology": "^0.26.0",
    "graphology-types": "^0.24.8"
  },
  "devDependencies": {
    "@types/node": "^25.4.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  }
}
```

**DELTAS the executor must apply:**

1. `"name": "okb-server"` → `"name": "@fwornle/km-core"` (D-03)
2. `"description"` → `"Shared KM core: canonical Entity/Relation types, GraphKMStore (Graphology + LevelDB + JSON export), UUIDv7 stamping"`
3. `"license": "UNLICENSED"` → `"license": "MIT"` (D-05)
4. **Drop** `dev` script (KM-Core has no entry-point dev mode — it's a library, not a server)
5. **Drop** `start` script and the `bin` field if present (library, not CLI)
6. **Drop** `@rapid/llm-proxy`, `cors`, `express`, `graphology-communities-louvain`, `graphology-traversal`, `yaml`, `zod` deps (server-only).
7. **Drop** `@types/cors`, `@types/express`, `@types/supertest`, `supertest` devDeps.
8. **Add** `"uuidv7": "^1.2.1"` to dependencies (D-09).
9. **Add** `"repository": { "type": "git", "url": "https://github.com/fwornle/km-core.git" }` per D-01.
10. **Add** `"engines": { "node": ">=22" }` per RESEARCH §Standard Stack.
11. **Add** `"exports"` field for ESM resolution:
    ```json
    "exports": {
      ".": {
        "types": "./dist/index.d.ts",
        "import": "./dist/index.js"
      }
    },
    "files": ["dist", "README.md", "LICENSE"]
    ```
12. **Add** `"prepublishOnly": "npm run build"` to scripts (defends against accidental publish without build).

---

### `tsconfig.json` (config)

**Analog:** `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tsconfig.json` (20 lines — adopt VERBATIM, no deltas)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**DELTAS:** none. RESEARCH "Claude's Discretion" allows opting in to `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Recommend **DEFER both** to v0.2 — they'd force speculative changes to the type signatures imported from OKM, increasing extraction risk.

---

### `vitest.config.ts` (config)

**Analog:** `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/vitest.config.ts` (12 lines — adopt VERBATIM)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
```

**DELTAS:** none.

---

### `.github/workflows/ci.yml` (config, CI)

**Analog:** `/Users/Q284340/Agentic/_work/rapid-automations/.github/workflows/ci.yml` (shape only — that file is Python; KM-Core is Node)

**Recommended shape (composite from rapid-automations CI + standard Node CI):**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    name: Test + Lint + Build
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: ['22.x']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm test
```

**DELTAS:** none — this is the canonical minimal Node CI. No lint step in v0.1 (RESEARCH doesn't mandate one); add ESLint in v0.2 if desired.

---

### `.github/workflows/publish.yml` (config, CI — NET-NEW)

No analog. D-07 + RESEARCH Open Question #3: manual-trigger `workflow_dispatch` that runs `npm pack` and uploads a `.tgz` artifact. NO `npm publish` to public registry in v7.1.

```yaml
name: Publish (manual)

on:
  workflow_dispatch:

jobs:
  pack:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm pack
      - uses: actions/upload-artifact@v4
        with:
          name: km-core-tgz
          path: '*.tgz'
```

---

### `README.md` (docs — NET-NEW)

No analog (cannot copy verbatim — needs project-specific content). CONSTRAINTS:

1. **No ASCII art** (RESEARCH §Pitfall 7) — use Mermaid fenced blocks only.
2. **Invoke `documentation-style` skill** (CLAUDE.md mandate) before authoring.
3. Architecture diagram in Mermaid (markdown-native; no PlantUML toolchain needed for v0.1).

Reference RESEARCH §"System Architecture Diagram (Mermaid)" (lines 162-178 of `37-RESEARCH.md`) for the diagram to embed.

---

### `LICENSE` (docs)

Standard MIT text. Use the exact form at https://opensource.org/licenses/MIT with `Copyright (c) 2026 Frank Wörnle`.

---

### `CONTRIBUTING.md` (docs — NET-NEW)

No analog. Minimum content: dev setup (`npm install`, `npm run build`, `npm test`), submodule-consumer note ("changes here are consumed via git submodule by coding/ and rapid-automations/, so `npm run build` must be committed and the consumer must `git submodule update --remote`"), code of conduct stub.

---

### `.gitignore`

Standard Node + TS lib ignore:
```
node_modules/
dist/
coverage/
*.tgz
.DS_Store
```

Net-new (not deep enough to merit analog excerpt).

---

### `coding/Dockerfile.coding-services` (modify L106-126)

**Analog:** SAME FILE — existing `lib/llm` pattern at L106 and L126.

**Existing pattern to mirror** (Dockerfile.coding-services lines 102-128):

```dockerfile
# Install VKB server dependencies
RUN cd lib/vkb-server && npm install --ignore-scripts 2>/dev/null || true

# Install LLM service dependencies
RUN cd lib/llm && npm install --ignore-scripts 2>/dev/null || true

# ... (lines 108-122 — integration installs, native rebuilds)

# Rebuild native bindings for the container's architecture
RUN npm rebuild better-sqlite3 classic-level 2>/dev/null || true

# Build TypeScript projects (run build in each directory)
RUN cd lib/llm && npm run build 2>/dev/null || true
```

**Edits to apply** (per RESEARCH §Pattern 6 + Pitfall 1):

1. **After line 106**, add:
   ```dockerfile
   # Install KM-Core dependencies (Phase 37)
   RUN cd lib/km-core && npm install --ignore-scripts --production 2>/dev/null || true
   ```
2. **After line 123** (existing `npm rebuild ... classic-level`), the rebuild already covers km-core's classic-level via npm dedupe. No new line needed. **But** Pitfall 1 says: if dedupe fails, add explicit rebuild:
   ```dockerfile
   RUN cd lib/km-core && npm rebuild classic-level 2>/dev/null || true
   ```
   Recommend adding this defensively.
3. **After line 126** (existing `cd lib/llm && npm run build`), add:
   ```dockerfile
   RUN cd lib/km-core && npm run build 2>/dev/null || true
   ```

---

### `coding/docker-compose.yml` (modify L91-130)

**Analog:** SAME FILE — existing bind-mounts at L92 (`mcp-server-semantic-analysis/dist`), L96 (`system-health-dashboard/dist`), L130 (`lib/vkb-server`).

**Existing pattern to mirror** (docker-compose.yml lines 91-96, 129-130):

```yaml
      # Semantic analysis dist (live-mounted to avoid Docker rebuild for TS changes)
      - ${CODING_REPO:-.}/integrations/mcp-server-semantic-analysis/dist:/coding/integrations/mcp-server-semantic-analysis/dist:ro
      # ...
      # Dashboard build (live-mounted for development)
      - ${CODING_REPO:-.}/integrations/system-health-dashboard/dist:/coding/integrations/system-health-dashboard/dist:ro
      # ...
      # VKB server source (live-mounted to avoid Docker rebuild for JS changes)
      - ${CODING_REPO:-.}/lib/vkb-server:/coding/lib/vkb-server:ro
```

**Edit to apply** — append a new mount near L130 (RESEARCH §Pattern 6 step 5):

```yaml
      # KM-Core dist (live-mounted to avoid Docker rebuild for TS changes — Phase 37)
      - ${CODING_REPO:-.}/lib/km-core/dist:/coding/lib/km-core/dist:ro
```

**DELTAS:** mount `dist/` only (Pitfall 5 — never mount the full submodule source, container has no `tsc`).

---

### `coding/.gitmodules` (append)

**Analog:** SAME FILE — existing 5 entries (`mcp-constraint-monitor`, `memory-visualizer`, `mcp-server-semantic-analysis`, `serena`, `code-graph-rag`).

**Existing pattern** (`.gitmodules` lines 7-9 for mcp-server-semantic-analysis):

```
[submodule "integrations/mcp-server-semantic-analysis"]
	path = integrations/mcp-server-semantic-analysis
	url = git@github.com:fwornle/mcp-server-semantic-analysis.git
```

**Edit to apply** — append:

```
[submodule "lib/km-core"]
	path = lib/km-core
	url = git@github.com:fwornle/km-core.git
```

**DELTAS:**
1. **Path is `lib/km-core` NOT `integrations/km-core`** — D-04 explicitly introduces this new convention.
2. **URL uses SSH** (`git@github.com:` not `https://github.com/`) to match every other fwornle submodule. RESEARCH does NOT flag this as a problem — only `bmw.ghe.com` requires HTTPS (MEMORY.md `feedback_bmw_ghe_https.md`).
3. **No `branch =` line** — every other fwornle submodule tracks the default branch. Only `code-graph-rag` pins a branch (`semantic-enhancements`), which is the exception.

---

### `coding/scripts/migrate-exports-to-symlinks.mjs` (utility, one-shot — NET-NEW)

No direct analog. RESEARCH §Pattern 7 (lines 533-541 of `37-RESEARCH.md`) gives the spec:

1. Backup existing `.data/knowledge-export/coding.json` to `.data/exports/coding.json.bak.<timestamp>` if it exists and has content.
2. Move canonical content to `.data/exports/coding.json`.
3. Replace `.data/knowledge-export/coding.json` with a symlink (relative path `../exports/coding.json`).
4. **Idempotent**: check `fs.lstat(legacyPath).isSymbolicLink()` BEFORE touching anything (Pitfall 3 protection).
5. **Phase 37 scope:** only `coding.json`. Observation-export symlinking is Phase 41 work (RESEARCH §Pattern 7 final note).

**Pattern fragments to use:**

```javascript
// Source: composite of RESEARCH §Pattern 7 + Pitfall 3
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.env.CODING_REPO || process.cwd();
const LEGACY = path.join(REPO_ROOT, '.data/knowledge-export/coding.json');
const CANONICAL = path.join(REPO_ROOT, '.data/exports/coding.json');

function isAlreadyDone() {
  if (!fs.existsSync(LEGACY)) return false;
  const stat = fs.lstatSync(LEGACY);
  if (!stat.isSymbolicLink()) return false;
  const target = fs.readlinkSync(LEGACY);
  return target === '../exports/coding.json';
}

if (isAlreadyDone()) {
  process.stderr.write('[migrate] symlink already in place — no-op\n');
  process.exit(0);
}
// ... rest of migration ...
```

**DELTAS:** Use `process.stderr.write()` not `console.log` (CLAUDE.md `no-console-log`).

---

## Shared Patterns

### Atomic temp+rename for ALL `.data/exports/*.json` writes
**Source:** Composite — `_work/.../okm/src/store/persistence.ts:152-154` (the simple writeFile) UPGRADED PER RESEARCH §Pattern 3
**Apply to:** `src/store/persistence.ts`, `src/store/exporter.ts`, `scripts/migrate-exports-to-symlinks.mjs`

```typescript
const tempPath = `${finalPath}.tmp.${process.pid}.${Date.now()}`;
await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
await fs.promises.rename(tempPath, finalPath);   // atomic on POSIX
```

Justification: the pre-commit OKB-baseline-guard hook reads `.data/exports/*.json` from staged files. A torn write makes the staged file unparseable.

### Logging — `process.stderr.write` not `console.*`
**Source:** CLAUDE.md `no-console-log` constraint + MEMORY.md "Constraint Violations = Real Issues"
**Apply to:** ALL `.ts` and `.mjs` files KM-Core ships, plus the coding-side migration script.

```typescript
// INSTEAD of console.info(...) or console.error(...)
process.stderr.write(`[km-core] ${msg}\n`);
```

Note OKM's existing code (analog source) uses `console.info` at `persistence.ts:84` — the executor MUST replace these during extraction. Don't carry the violation forward.

### Re-entry guard on async export writers
**Source:** `_work/.../okm/src/store/persistence.ts:9` + `:98-99`
**Apply to:** `src/store/persistence.ts`, `src/store/exporter.ts`

```typescript
private writing = false;

async exportJson(...): Promise<void> {
  if (this.writing) return;
  this.writing = true;
  try {
    // ... write logic ...
  } finally {
    this.writing = false;
  }
}
```

D-22 (5s debounce) does NOT prevent overlap on its own — a slow disk + a 2nd `_scheduleExport()` mid-write would overlap without this guard.

### LEVEL_NOT_FOUND error narrowing for LevelDB hydrate fallback
**Source:** `_work/.../okm/src/store/persistence.ts:32-40`
**Apply to:** `src/store/persistence.ts` (only — hot path)

Adopt the exact error-narrowing pattern verbatim:

```typescript
catch (err: unknown) {
  if (
    !(err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'LEVEL_NOT_FOUND')
  ) {
    throw err;
  }
}
```

`classic-level` does NOT export typed error classes — duck-typing on `err.code` is the canonical pattern.

### EventEmitter base class for hot-write notification
**Source:** D-16 + RESEARCH §Pattern 2 (line 314 of `37-RESEARCH.md`)
**Apply to:** `src/store/GraphKMStore.ts`

```typescript
import { EventEmitter } from 'node:events';
export class GraphKMStore extends EventEmitter { /* ... */ }
```

Use Node's built-in `EventEmitter` — no `eventemitter3` or other userland alternatives. Type-safe wrapper is a v0.2 concern.

---

## No Analog Found

Files with no close match in the codebase (planner should reference RESEARCH.md patterns directly):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/ids/branded.ts` | utility (type) | n/a | UUIDv7 + branded type pattern is net-new to this repo |
| `src/store/types.ts` | model (type) | n/a | `BatchOp` + `FilterObject` are KM-Core public API novel to v7.1 |
| `src/events/types.ts` | model (type) | n/a | Event payload types are new (the OKM/B stores don't expose typed events) |
| `src/validation/ontology.ts` | service interface | n/a | Phase 38 owns the validator; v0.1 ships a no-op default |
| `.github/workflows/publish.yml` | config (CI) | n/a | `workflow_dispatch` `npm pack` is net-new shape |
| `README.md` | docs | n/a | Project-specific narrative; see RESEARCH §System Architecture Diagram for the Mermaid block to embed |
| `CONTRIBUTING.md` | docs | n/a | Net-new; the only standard guidance is "use Mermaid not ASCII" (Pitfall 7) |
| `coding/scripts/migrate-exports-to-symlinks.mjs` | utility | file-I/O | One-shot script; spec in RESEARCH §Pattern 7 |
| `coding/.data/knowledge-export/coding.json` (file → symlink) | runtime state | n/a | Net-new migration; no prior precedent in the repo |

## Metadata

**Analog search scope:**
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/` (full read of `src/types/entity.ts`, `src/store/persistence.ts`, `src/store/graph-store.ts`, `tsconfig.json`, `vitest.config.ts`, `package.json`)
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` (lines 1-130 + 240-420)
- `/Users/Q284340/Agentic/coding/src/knowledge-management/GraphKnowledgeExporter.js` (lines 1-140)
- `/Users/Q284340/Agentic/coding/docker/Dockerfile.coding-services` (lines 90-140)
- `/Users/Q284340/Agentic/coding/docker/docker-compose.yml` (lines 70-140)
- `/Users/Q284340/Agentic/coding/.gitmodules` (full file)
- `/Users/Q284340/Agentic/_work/rapid-automations/.github/workflows/ci.yml` (shape reference; full file)

**Files scanned:** 8 source files + 4 config files = 12 distinct read operations, all with non-overlapping ranges.

**Pattern extraction date:** 2026-05-19
