# Phase 44: REST API and Git Snapshots - Pattern Map

**Mapped:** 2026-06-03
**Files analyzed:** 24 (13 new + 11 modified)
**Analogs found:** 22 / 24 (2 have only structural analogs — Wave 0 fixtures)

> Read CONTEXT.md (`<canonical_refs>`) and RESEARCH.md (Examples 1/2/3/4 + Pattern 1/2/3/4 + Endpoint Map table) BEFORE this file. Concrete handler line-numbers and the OKM-handler-to-canonical-endpoint mapping live there; this file extracts the LOCAL analog code planners will copy from. OKM (`_work/rapid-automations/integrations/operational-knowledge-management/`) is NOT checked out at this workstation — RESEARCH.md's line citations (`routes.ts:450-527`, `:2076-2403`) are the authoritative reference for the OKM-side handler bodies and SnapshotManager prior-art. **Do not duplicate** the RESEARCH.md OKM-handler-map here.

## File Classification

### km-core deliverables (NEW)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `lib/km-core/src/api/router.ts` | router/factory | request-response | `lib/km-core/dist/api/router.js` (orphan draft to REPLACE in-place) + OKM `routes.ts:450-527` (handler bodies per RESEARCH Example 2) | exact (structural) + exact (semantic via OKM) |
| `lib/km-core/src/api/contracts.ts` | schema/contract | data-validation | OKM `tests/integration/rest-contract.test.ts:94-167` (Zod block to LIFT — per RESEARCH Pattern 2) | exact |
| `lib/km-core/src/api/handlers/entities.ts` | route-handler | CRUD | `lib/km-core/dist/api/router.js:50-134` (entities CRUD block in orphan draft) | exact (structural) |
| `lib/km-core/src/api/handlers/relations.ts` | route-handler | CRUD | `dist/api/router.js:135-192` | exact (structural) |
| `lib/km-core/src/api/handlers/query.ts` | route-handler | request-response | `dist/api/router.js:214-261` | exact (structural) |
| `lib/km-core/src/api/handlers/ontology.ts` | route-handler | request-response | `dist/api/router.js:279-332` | exact (structural) |
| `lib/km-core/src/api/handlers/clusters.ts` | route-handler | request-response | `dist/api/router.js:262-278` (placeholder; real Louvain lifted from OKM `src/intelligence/clustering.ts` per RESEARCH Open Q3) | partial — placeholder is structural, real impl is a port |
| `lib/km-core/src/api/handlers/snapshots.ts` | route-handler | request-response | `dist/api/router.js:367-402` + OKM `routes.ts:2076-2403` (S-4 git-tag semantics — fresh write, not lift) | partial — draft uses commit-hash, S-4 needs git-tag rewrite |
| `lib/km-core/src/api/index.ts` | barrel | nil | `lib/km-core/src/maintenance/index.ts` (sub-barrel template) | exact |
| `lib/km-core/src/snapshots/SnapshotManager.ts` | service | file-I/O + process | `lib/km-core/dist/snapshots/SnapshotManager.js` (orphan draft) + OKM `routes.ts:2076-2134` getGitEnv pattern (per RESEARCH Pattern 4) | partial — draft missing submodule gitlink walk + GIT_DIR/WORK_TREE |
| `lib/km-core/src/snapshots/index.ts` | barrel | nil | `lib/km-core/src/maintenance/index.ts` | exact |
| `lib/km-core/src/adapters/observation-view.ts` | adapter/transform | transform | `lib/km-core/src/adapters/online/mapper.ts:39-100` (Phase 41 pure-row mapper — REVERSE direction) | role-match (mirror-image transform) |

### km-core tests (NEW, Wave 0)

| Test File | Role | Data Flow | Closest Analog | Match Quality |
|-----------|------|-----------|----------------|---------------|
| `lib/km-core/tests/integration/api-router.test.ts` | integration test | supertest over router | `lib/km-core/tests/integration/round-trip.test.ts:60-90` (vitest + GraphKMStore tmpdir lifecycle) | role-match |
| `lib/km-core/tests/unit/contracts.test.ts` | unit test | zod schema parse/reject | `lib/km-core/tests/unit/entity.test.ts` (vitest pattern, type-shape assertions) | role-match |
| `lib/km-core/tests/integration/snapshot-roundtrip.test.ts` | integration test | git command + tmpdir + GraphKMStore | `lib/km-core/tests/integration/round-trip.test.ts:60-90` + `tests/unit/persistence.test.ts:20-45` (tmpdir lifecycle) | role-match |
| `lib/km-core/tests/integration/observation-view.test.ts` | unit test | pure transform round-trip | `lib/km-core/src/adapters/online/mapper.ts` test (`tests/unit/adapters/...`) | role-match |

### A-side (coding repo) MODIFIED

| Modified File | Role | Data Flow | Closest Analog (in same file) | Match Quality |
|---------------|------|-----------|------|---------------|
| `scripts/observations-api-server.mjs` | controller/server | mount + remove + typed-views | self — lines 1172-1191 (existing `/api/km/` mount to REMOVE) + lines 466-549, 689-703, 705-751 (handlers to convert to typed views) | exact (in-file refactor) |
| `lib/km-core/package.json` | config | nil | self — existing `exports` block at lines 7-36 (add `./api`, `./api/contracts`, `./snapshots` sub-paths) + `dependencies` (add `zod`) | exact |
| `lib/km-core/src/index.ts` | barrel | nil | self — existing Phase 42 export block at lines 196-208 (template for new exports) | exact |
| `scripts/hooks/pre-commit-okb-guard.sh` | git-hook | shell + env var | self — 4-line diff at top per RESEARCH Pitfall 1 | exact (in-file edit) |

### A-side (coding repo) NEW

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `scripts/migrate-sqlite-to-kmcore.mjs` | migration script | SQLite read → km-core write | OKM `scripts/migrate-okm-json-to-kmcore.mjs` (Phase 43 Plan 07 template per RESEARCH `Don't Hand-Roll`) + RESEARCH Example 4 (full skeleton ready to copy) | exact (template) |
| `tests/integration/cross-system-parity.mjs` | integration test | supertest → 3 services | `tests/integration/http-api.test.js:19-78` (jest + node-fetch pattern, single-service) | role-match |
| `tests/integration/typed-views.test.js` | integration test | A-side `/api/coding/observations` shape lock | `tests/integration/http-api.test.js` (jest + fetch) | role-match |
| `tests/integration/okb-guard-snapshot-bypass.sh` | shell test | env-var bypass round-trip | none — bash test, no local template | none |
| `tests/e2e/dashboard-observations.spec.ts` | e2e test | playwright | `tests/e2e/dashboard/workflow-graph-colors.spec.ts:1-90` (playwright dashboard pattern; same selector + `gsd-browser` approach) | exact (structural) |

### B-side (mcp-server-semantic-analysis) MODIFIED

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|------|---------------|
| `integrations/mcp-server-semantic-analysis/src/sse-server.ts` | controller/server | add REST mount alongside SSE | A's `scripts/observations-api-server.mjs:1172-1191` (existing km-core mount pattern) + RESEARCH Example 3 | exact (cross-file pattern lift) |

### C-side (OKM, separate git repo on bmw.ghe.com) MODIFIED

> OKM is NOT locally checked out. All citations resolve via RESEARCH.md and OKM repo when work is done in-place; planner must clone OKM to work on these. Per `memory/feedback_bmw_ghe_https.md`: use HTTPS-token auth.

| Modified File | Role | Data Flow | Reference |
|---------------|------|-----------|-----------|
| `_work/.../okm/src/api/routes.ts` | controller | replace ~15 handlers with router mount | RESEARCH Example 2 endpoint map; lines 450-527 |
| `_work/.../okm/src/api/server.ts` | bootstrap | simplify createServer | RESEARCH Architecture Map |
| `_work/.../okm/tests/integration/rest-contract.test.ts` | integration test | re-import Zod from km-core | RESEARCH Pitfall 5 |
| `_work/.../okm/tests/fixtures/pre-migration/*.json` | test fixture | regenerate under `/api/v1/` | RESEARCH Pitfall 5 |
| `_work/.../okm/scripts/record-rest-fixtures.mjs` | script | URL constant rewrite | RESEARCH Pitfall 5 |
| `_work/.../okm/viewer/src/api/okbClient.ts` | client | 20 URL rewrites (lines 225, 271, 282, 291, 299, 317, 326, 335, 349, 359, 383, 400, 415, 425, 468, 475, 480, 485, 497, 508, 519 per RESEARCH Runtime State Inventory) | RESEARCH R-4 |
| `_work/.../okm/scripts/verify-post-migration.mjs` | script | URL rewrite | RESEARCH R-4 |
| `_work/.../okm/scripts/pre-commit-hook.sh` | git-hook | already has `OKB_SNAPSHOT=1` bypass per RESEARCH; no change needed | RESEARCH Pitfall 1 |

---

## Pattern Assignments

### `lib/km-core/src/api/router.ts` (router-factory, request-response)

**Analog 1:** `lib/km-core/dist/api/router.js` (orphan draft — TS source replaces .js in place, dist is then regenerated by `npm run build`)
**Analog 2:** OKM `_work/.../okm/src/api/routes.ts:450-527` (handler bodies; see RESEARCH Example 2 map for the canonical 15-endpoint extraction list)
**Pattern deviations the planner must apply:**

1. **Rename `createKMRouter` → `createKmCoreRouter`** to match CONTEXT R-1.
2. **Mount path is `/api/v1/`** at the consumer side, not `/api/km/` (the draft's marketing prefix).
3. **Snapshot route shape changes:** draft uses `POST /restore { hash }`; CONTEXT S-2/S-4 require `POST /snapshots/:id/restore` returning `{ restartRequired: true }`.
4. **Cluster handler is a placeholder** in the draft (groups by entityType); per CONTEXT C-3 + RESEARCH Open Q3, lift OKM's `src/intelligence/clustering.ts` Louvain into km-core (pure function port, no OKM types).
5. **Response envelope unification:** draft returns bare arrays (`res.json(entities)`); OKM uses `{ success: true, data: [...] }` per RESEARCH §Data Flow + `ApiSuccessEnvelope`. CONTEXT C-2 says "OKM response shapes verbatim" — adopt the envelope. **Breaking change vs draft.**

**Imports pattern** (extract from draft lines 1-14):
```javascript
// lib/km-core/dist/api/router.js:1-14
// km-core stays Express-free. Consumer wires the bridge.
import { SnapshotManager } from '../snapshots/SnapshotManager.js';
// NEW additions for src/ rewrite:
// import type { GraphKMStore } from '../store/GraphKMStore.js';
// import type { OntologyRegistry } from '../ontology/registry.js';
// import { mintEntityId } from '../ids/mint.js';
```

**Framework-agnostic factory pattern** (lines 25-49 — keep verbatim, rename + adjust signature for opts):
```javascript
// lib/km-core/dist/api/router.js:25-49
export function createKMRoutes(store, opts = {}) {
    const readOnly = opts.readOnly === true;
    const enableSnapshots = opts.enableSnapshots !== false;
    const snapshotMgr = enableSnapshots && opts.snapshotDir
        ? new SnapshotManager(opts.snapshotDir)
        : undefined;
    const graph = store.graph;
    const routes = [];
    routes.push({
        method: 'get',
        path: '/health',
        handler: (_req, res) => {
            res.json({
                status: 'ok',
                entityCount: graph.order,
                edgeCount: graph.size,
                uptime: Math.floor((Date.now() - startTime) / 1000),
            });
        },
    });
```

**Express convenience wrapper with error-handling** (lines 419-436 — preserve verbatim, rename):
```javascript
// lib/km-core/dist/api/router.js:419-436
export function createKMRouter(store, router, opts) {
    const prefix = opts?.prefix ?? '';
    const routes = createKMRoutes(store, opts);
    for (const route of routes) {
        const fullPath = prefix + route.path;
        const wrappedHandler = async (req, res) => {
            try {
                await route.handler(req, res);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                res.status(500).json({ error: message });
            }
        };
        router[route.method](fullPath, wrappedHandler);
    }
    return router;
}
```

**ontologyClass filter contract** (lines 60-65 — preserve; pairs with `findByOntologyClass` two-field check in GraphKMStore.ts:565, see Pitfall 3):
```javascript
// lib/km-core/dist/api/router.js:60-65
graph.forEachNode((_id, attrs) => {
    const e = attrs;
    if (ontologyClass && e.entityType !== ontologyClass && e.ontologyClass !== ontologyClass)
        return;
    entities.push(e);
});
```

---

### `lib/km-core/src/api/contracts.ts` (schema, data-validation)

**Analog:** RESEARCH Pattern 2 (`44-RESEARCH.md` lines 207-251) — the Zod block LIFTED from OKM `tests/integration/rest-contract.test.ts:94-167`.
**Pattern deviations:** None. Adopt RESEARCH Pattern 2 verbatim. Export `z.infer<>` types for consumer convenience.

**Schema-as-contract pattern** (from RESEARCH Example, ready to write):
```typescript
// lib/km-core/src/api/contracts.ts (NEW)
import { z } from 'zod';

export const ProvenanceStampSchema = z.object({
  provider: z.string(),
  model: z.string(),
  runId: z.string(),
  timestamp: z.string(),
});

export const EntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  entityType: z.string(),
  ontologyClass: z.string().optional(),
  layer: z.enum(['evidence', 'pattern']),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  validFrom: z.string().optional(),
  validUntil: z.string().nullable().optional(),
  supersedes: z.array(z.string()).optional(),
  createdBy: ProvenanceStampSchema.optional(),
  lastConfirmedBy: ProvenanceStampSchema.optional(),
  confirmationCount: z.number().int().nonnegative().optional(),
  legacyId: z.object({
    system: z.enum(['A', 'B', 'C']),
    id: z.string(),
  }).optional(),
  embedding: z.array(z.number()).optional(),
});

export const ApiSuccessEnvelope = (data: z.ZodTypeAny) =>
  z.object({ success: z.literal(true), data });

export type Entity = z.infer<typeof EntitySchema>;
```

---

### `lib/km-core/src/snapshots/SnapshotManager.ts` (service, file-I/O + git CLI)

**Analog 1:** `lib/km-core/dist/snapshots/SnapshotManager.js` (orphan draft — REPLACED in place by TS source)
**Analog 2:** RESEARCH Pattern 4 (full TS skeleton in `44-RESEARCH.md` lines 343-466) covering the `getGitEnv` submodule-gitlink walk lifted from OKM `routes.ts:2081-2117`.

**Pattern deviations from existing draft:**

1. **Add `getGitEnv()` helper** — draft uses `cwd: exportDir` but OKM's pattern with `GIT_DIR`/`GIT_WORK_TREE` is needed for both standalone repos AND submodules (the coding repo nests `.git` files for `lib/km-core/`). Use RESEARCH Pattern 4 lines 368-397 verbatim.
2. **Add `OKB_SNAPSHOT=1` env var** in every `execGit` call (RESEARCH Pitfall 1).
3. **Switch snapshot ID from commit-hash to git tag** (`snapshot/<label>-<UTC-ts>`) per S-4 — write fresh `listSnapshots()` / `restoreSnapshot()`, do NOT lift the draft's commit-history-walk versions.
4. **`restoreSnapshot()` returns `{ restored, id, commit_sha }`** — caller (handler) wraps with `restartRequired: true` (Pitfall 4).

**Existing draft excerpt to REPLACE** (lines 18-35 — commit-hash-based; replace with tag-based):
```javascript
// lib/km-core/dist/snapshots/SnapshotManager.js:18-35  (DELETE — wrong model)
async createSnapshot(message) {
    const msg = message ?? `snapshot ${new Date().toISOString()}`;
    const dir = this.exportDir;
    if (!existsSync(dir)) {
        throw new Error(`Export directory does not exist: ${dir}`);
    }
    execSync(`git add -A .`, { cwd: dir, stdio: 'pipe' });
    execSync(`git commit -m ${JSON.stringify(`snapshot: ${msg}`)} --allow-empty`, {
        cwd: dir,
        stdio: 'pipe',
    });
    const out = execSync(`git log -1 --format="%H|%s|%aI"`, {
        cwd: dir,
        encoding: 'utf-8',
    }).trim();
    const [hash, subject, date] = out.split('|');
    return { hash, message: subject, date };
}
```

**Use RESEARCH Pattern 4 createSnapshot instead** (`44-RESEARCH.md` lines 413-432):
```typescript
async createSnapshot(label: string): Promise<SnapshotEntry> {
    const env = this.getGitEnv();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const tagName = `snapshot/${label}-${ts}`;
    const commitMsg = `chore(snapshot): ${label}`;
    this.execGit(`add -A -- "${env.exportsRel}/"`, env);
    this.execGit(`commit -m ${JSON.stringify(commitMsg)} --allow-empty`, env);
    this.execGit(`tag ${JSON.stringify(tagName)}`, env);
    const hash = this.execGit('rev-parse HEAD', env);
    // ... etc per RESEARCH lines 413-432
}
```

---

### `lib/km-core/src/adapters/observation-view.ts` (adapter, pure transform)

**Analog:** `lib/km-core/src/adapters/online/mapper.ts` (Phase 41 — same file structure, REVERSE direction).
**Pattern deviations:** This module does Entity → LegacyShape (Phase 41 does LegacyShape → Entity). Mirror the file layout exactly; use the same import-style and `no-console-log` discipline (pure functions, no diagnostic emission — diagnostic emission lives in the calling handler).

**File-layout + naming pattern** (Phase 41 mapper.ts:1-50):
```typescript
// lib/km-core/src/adapters/online/mapper.ts:1-50  (template — mirror structure)
// SOURCE: shape mirrors src/segments/merge.ts (pure-function transform, no I/O,
// .js relative imports, type-only Entity import). The mapper module is the
// READ-ONLY adapter half of INT-01 — Plan 04 (reproject) consumes these
// mappers and is the only path that touches the store.
//
// CRITICAL — canonical legacyId placement (CF-D37, entity.ts:147, ...):
//   * entity.legacyId = { system: 'A', id: <row.id> }  ← TOP-LEVEL Entity field
//   * entity.metadata.subsystem = 'online'              ← SEPARATE metadata key
//
// no-console-log: mappers are pure — no diagnostic emission.

import type { Entity } from '../../types/entity.js';

const NAME_MAX_LENGTH = 120;
const EMPTY_NAME_PLACEHOLDER = '(empty)';

export interface ObservationRow {
  id: string;
  summary: string;
  agent: string;
  project: string;
  // ...
}
```

**Reverse-direction reshape (write fresh per RESEARCH Pattern 3, lines 282-315):**
```typescript
// lib/km-core/src/adapters/observation-view.ts (NEW)
import type { Entity } from '../types/entity.js';

export interface LegacyObservation {
  id: string;
  agent: string;
  project: string;
  content: string;
  artifacts: string[];
  timestamp: string;
  session_id?: string;
  quality?: string;
}

export function observationToLegacy(entity: Entity): LegacyObservation {
  const m = (entity.metadata ?? {}) as Record<string, any>;
  return {
    id: entity.legacyId?.id ?? entity.id,
    agent: m.agent ?? 'unknown',
    project: m.project ?? 'unknown',
    content: m.summary ?? m.content ?? entity.description ?? '',
    artifacts: Array.isArray(m.artifacts) ? m.artifacts : [],
    timestamp: m.createdAt ?? entity.validFrom ?? '',
    session_id: m.session_id,
    quality: m.quality ?? 'normal',
  };
}
// digestToLegacy / insightToLegacy follow the same pattern; field names from
// scripts/observations-api-server.mjs:670-744 (SQLite SELECT shape)
```

---

### `scripts/migrate-sqlite-to-kmcore.mjs` (migration script, SQLite → km-core)

**Analog:** OKM `scripts/migrate-okm-json-to-kmcore.mjs` (Phase 43 Plan 07, NOT locally checked out — see RESEARCH §Don't Hand-Roll). RESEARCH Example 4 (`44-RESEARCH.md` lines 800-927) provides a near-complete TS skeleton ready to copy.
**Local supplementary analog:** `scripts/observations-api-server.mjs:466-549` for the SQLite SELECT shape of `observations` (use the SELECT projection to know which columns exist; `digests` at lines 670-687; `insights` at lines 705-751).

**Imports + CLI pattern** (from RESEARCH Example 4, ready to write):
```javascript
// scripts/migrate-sqlite-to-kmcore.mjs (NEW; RESEARCH Example 4 lines 800-825)
import Database from 'better-sqlite3';
import { GraphKMStore } from '@fwornle/km-core';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const args = {
    source: '.observations/observations.db',
    target: '.data/knowledge-graph/leveldb',
    batchSize: 100, dryRun: false, resume: false, runId: null, help: false,
  };
  for (const a of argv) {
    if (a === '--help') args.help = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--resume') args.resume = true;
    else if (a.startsWith('--source=')) args.source = a.slice(9);
    else if (a.startsWith('--target=')) args.target = a.slice(9);
    else if (a.startsWith('--batch-size=')) args.batchSize = parseInt(a.slice(13), 10);
    else if (a.startsWith('--run-id=')) args.runId = a.slice(9);
  }
  return args;
}
```

**ontologyDir resolution pattern** (RESEARCH Example 4 lines 827-838 — REQUIRED per CLAUDE.md mandatory rule):
```javascript
// CRITICAL — without ontologyDir the GraphKMStore default-class resolution throws
// 'opts.classes omitted but store has no ontology registry' (CLAUDE.md mandatory rule)
async function resolveOntologyDir() {
  const kmCoreEntry = import.meta.resolve('@fwornle/km-core');
  const kmCorePath = fileURLToPath(kmCoreEntry);
  let kmCoreRoot = path.dirname(kmCorePath);
  while (kmCoreRoot !== '/') {
    try { await fsp.access(path.join(kmCoreRoot, 'package.json')); break; }
    catch { kmCoreRoot = path.dirname(kmCoreRoot); }
  }
  return path.join(kmCoreRoot, 'config', 'ontology');
}
```

**Pitfall 3 — set BOTH fields** (RESEARCH Example 4 lines 880-905):
```javascript
const entity = {
  // ...
  entityType: 'Observation',
  ontologyClass: 'Observation',  // Pitfall 3: set BOTH (mirrors GraphKMStore.ts:565 OR-check)
  // ...
  legacyId: { system: 'A', id: row.id },
};
```

---

### `scripts/observations-api-server.mjs` (MODIFIED — controller refactor)

**Analog:** Self. The file already mounts a km-core router (lines 1172-1191) — this is the orphan Phase 44 attempt to REMOVE and REWRITE under `/api/v1/`.

**Existing mount to DELETE** (lines 39-41, 1172-1191):
```javascript
// scripts/observations-api-server.mjs:39-41  (DELETE — old /api/km/ mount)
// Phase 44 plan 04 — km-core common REST router mounted at /api/km/
import { GraphKMStore } from '../lib/km-core/dist/store/GraphKMStore.js';
import { createKMRouter } from '../lib/km-core/dist/api/router.js';
```
```javascript
// scripts/observations-api-server.mjs:1172-1191  (DELETE — replace with /api/v1/ mount)
// Mount km-core router at /api/km/ — deferred until store is ready.
import { Router } from 'express';
const kmSubRouter = Router();
kmSubRouter.use((_req, res, next) => {
  if (!_kmStoreReady || !_kmStore) {
    return res.status(503).json({ error: 'Knowledge graph store not ready' });
  }
  next();
});
app.use('/api/km', kmSubRouter);
function mountKMRoutes(store) {
  createKMRouter(store, kmSubRouter, { readOnly: false });
  process.stderr.write(`[obs-api] km-core REST routes mounted at /api/km/\n`);
}
```

**Replacement pattern** (write at the same location; RESEARCH Pattern 1 lines 186-200):
```javascript
import { Router } from 'express';
import { createKmCoreRouter } from '@fwornle/km-core';
// Hydration gate stays — same 503 pattern as the old code
const kmRouter = Router();
kmRouter.use((_req, res, next) => {
  if (!_kmStoreReady || !_kmStore) {
    return res.status(503).json({ error: 'Knowledge graph store not ready' });
  }
  next();
});
createKmCoreRouter(_kmStore, kmRouter, {
  ontologyRegistry: _kmStore.getOntologyRegistry(),
  snapshotDir: path.join(REPO_ROOT, '.data', 'knowledge-graph', 'exports'),
});
app.use('/api/v1', kmRouter);
```

**Typed-view replacement for `/api/observations`** (current SQLite handler at lines 466-549 is the lift; reshape via `observationToLegacy`):
```javascript
// scripts/observations-api-server.mjs:466 (current — SQLite-backed handler to REPLACE under /api/coding/observations)
app.get('/api/observations', (req, res) => {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Observations database unavailable' });
    let { agent, from, to, project, q, limit: limitStr, offset: offsetStr } = req.query;
    // ... SQLite WHERE-builder ...
    // NEW SHAPE per A-4: replace SQL SELECT with kmStore.findByOntologyClass('Observation')
    // + apply same filters in JS + map via observationToLegacy
});
```
**Pattern deviation:** preserve the **exact** query-string contract (`agent`, `from`, `to`, `project`, `q`, `quality`, `limit`, `offset`) and the **exact** response shape (`{ data, total, limit, offset, _metadata }`) — A's dashboard at :3032 is brittle to changes (Pitfall 2). Same for `/api/digests` (lines 689-703) and `/api/insights` (lines 705-751).

**A-3 SQLite table drop** (separate plan after fixtures + dashboard smoke pass per RESEARCH Open Q4):
```sql
-- Run AFTER typed-view dashboard smoke passes; keep observations.db.backup-pre-phase-44
DROP TABLE observations;
DROP TABLE digests;
DROP TABLE insights;
-- KEEP: budget_events, session_metrics, embedding_cache  (A-3 explicit)
```

---

### `integrations/mcp-server-semantic-analysis/src/sse-server.ts` (MODIFIED — add REST mount)

**Analog 1 (in-file):** the existing Express app setup at lines 9-22 (express + body-parser + heartbeat patterns).
**Analog 2 (cross-file):** A's mount pattern from `scripts/observations-api-server.mjs:1172-1191` (apply identical hydration-gate, change prefix to `/api/v1`).
**Pattern source:** RESEARCH Example 3 (full skeleton in `44-RESEARCH.md` lines 745-783).

**Add after line 22 (after `app.use(express.json())`)**:
```typescript
// integrations/mcp-server-semantic-analysis/src/sse-server.ts (NEW BLOCK)
// Source: RESEARCH Example 3 + A's mount pattern at observations-api-server.mjs:1172-1191
import { Router } from 'express';
import { createKmCoreRouter, GraphKMStore } from '@fwornle/km-core';

const kmStore = new GraphKMStore({
  dbPath: '/coding/.data/knowledge-graph/leveldb',
  exportDir: '/coding/.data/knowledge-graph/exports',
  ontologyDir: '/coding/.data/ontologies',
  domains: ['coding'],
});
await kmStore.open();

const kmRouter = Router();
// Same hydration-gate pattern as A — RESEARCH Open Q5 recommends gating
kmRouter.use((_req, res, next) => {
  if (!kmStore.isReady?.()) {
    return res.status(503).json({ error: 'Knowledge graph store not ready' });
  }
  next();
});
createKmCoreRouter(kmStore, kmRouter, {
  ontologyRegistry: kmStore.getOntologyRegistry(),
  snapshotDir: '/coding/.data/knowledge-graph/exports',
});
app.use('/api/v1', kmRouter);
```

**Same-port strategy** (RESEARCH Example 3 + Open Q5) — mount on port 3848 alongside SSE; existing `app.listen(PORT, ...)` at line 169 stays unchanged. Verify `kmStore.open()` order vs `app.listen()` — open store FIRST.

---

### `lib/km-core/package.json` (MODIFIED — config)

**Analog:** Self. The existing `exports` block at lines 7-36 is the template — copy the `./adapters/online` sub-path entry verbatim.

**Add to `exports`** (after line 35, before closing `}`):
```json
"./api": {
  "types": "./dist/api/index.d.ts",
  "import": "./dist/api/index.js"
},
"./api/contracts": {
  "types": "./dist/api/contracts.d.ts",
  "import": "./dist/api/contracts.js"
},
"./snapshots": {
  "types": "./dist/snapshots/index.d.ts",
  "import": "./dist/snapshots/index.js"
}
```

**Add to `dependencies`** (insert alphabetically between `classic-level` line 64 and `fastembed` line 65):
```json
"zod": "^3.25.76",
```

**No new `peerDependencies` block needed** per CONTEXT R-2 corrected wording — km-core does NOT import express. Consumer passes `Router` instance.

---

### `lib/km-core/src/index.ts` (MODIFIED — barrel)

**Analog:** Self. The Phase 42 export block at lines 196-208 is the in-file template.

**Add at end of file** (after line 208):
```typescript
// Phase 44 (API-01 + API-02): common REST router + Zod contracts + git-snapshot manager.
//
// API-01 — Plan 44-XX: `createKmCoreRouter(store, router, opts)` factory ships
//          the canonical ~15-endpoint surface (entities CRUD, relations CRUD,
//          query, export, stats, ontology/*, graph/*, cleanup/*, clusters,
//          snapshots/*). km-core stays framework-agnostic — consumer passes
//          their own express.Router(). Mount at `/api/v1/` on A/B/C.
//
// API-02 — Plan 44-XX: `SnapshotManager` git-backed snapshot/restore over
//          `.data/exports/`. Snapshot IDs = git tags (`snapshot/<label>-<ts>`).
//          Restore = `git checkout <tag> -- exportsRel/` + caller wipes LevelDB
//          and restarts (S-2 hard-reset).
//
// Sub-paths:
//   import { createKmCoreRouter } from '@fwornle/km-core/api';
//   import { EntitySchema } from '@fwornle/km-core/api/contracts';
//   import { SnapshotManager } from '@fwornle/km-core/snapshots';
// Or via the root barrel (this file).
export { createKmCoreRouter } from './api/index.js';
export type { KmCoreRouterOptions, ExpressLikeRouter } from './api/index.js';
export { SnapshotManager } from './snapshots/SnapshotManager.js';
export type { SnapshotEntry, SnapshotManagerOptions } from './snapshots/SnapshotManager.js';
export { observationToLegacy, digestToLegacy, insightToLegacy } from './adapters/observation-view.js';
export type { LegacyObservation, LegacyDigest, LegacyInsight } from './adapters/observation-view.js';
```

---

### `scripts/hooks/pre-commit-okb-guard.sh` (MODIFIED — git-hook)

**Analog:** Self. Per RESEARCH Pitfall 1, OKM's hook already implements `OKB_SNAPSHOT=1` bypass; coding-side needs the matching 4-line diff.

**Current state to keep** (lines 1-22 — env initialization + KB pattern + early-exit-if-no-KB-staged):
```bash
# scripts/hooks/pre-commit-okb-guard.sh:1-22  (KEEP AS-IS)
#!/usr/bin/env bash
set -euo pipefail
KB_PATTERN='\.data/(knowledge-export|exports)/.*\.json$'
staged_kb_files=$(git diff --cached --name-only | grep -E "$KB_PATTERN" || true)
if [ -z "$staged_kb_files" ]; then
    exit 0
fi
```

**Insertion point** — RIGHT AFTER `set -euo pipefail` (line 13), BEFORE the `KB_PATTERN=` line:
```bash
# Phase 44 S-3: snapshot/restore bypass (SnapshotManager sets OKB_SNAPSHOT=1)
if [ "${OKB_SNAPSHOT:-0}" = "1" ]; then
    exit 0
fi
```

**Why this works:** SnapshotManager invokes `git commit` with `env: { OKB_SNAPSHOT: '1', ... }` (see SnapshotManager pattern from RESEARCH Pattern 4 line 408). The hook short-circuits before checking the staged-file list. **Zero touching of the message-inspection branch** which is git-mechanically impossible per Pitfall 1.

---

### `tests/e2e/dashboard-observations.spec.ts` (NEW — playwright e2e)

**Analog:** `tests/e2e/dashboard/workflow-graph-colors.spec.ts:1-90` (existing playwright + dashboard pattern in this repo).
**Pattern deviations:** different selectors (observations table, not workflow nodes); navigate to `http://localhost:3032` then locate the observations panel; assert non-empty cells per Pitfall 2.

**Imports + Page typing** (lines 13-23):
```typescript
// tests/e2e/dashboard/workflow-graph-colors.spec.ts:13-23  (template)
import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename2 = fileURLToPath(import.meta.url)
const __dirname2 = dirname(__filename2)
const CODING_ROOT = join(__dirname2, '..', '..', '..')
```

**Navigation pattern** (lines 65-74 — adapt selectors):
```typescript
// tests/e2e/dashboard/workflow-graph-colors.spec.ts:65-74  (template — change card title)
async function navigateToObservations(page: Page) {
  await page.goto('http://localhost:3032')
  // Locate the observations panel (specific selector to be determined during plan execution)
  await page.waitForSelector('[data-testid="observations-table"]', { timeout: 15_000 })
  await page.waitForTimeout(2000)  // polling settle
}
```

**Per Pitfall 2 — assert non-empty agent + project columns:**
```typescript
test('dashboard observations show populated agent/project after A-2 migration', async ({ page }) => {
  await navigateToObservations(page)
  const firstRow = page.locator('[data-testid^="observation-row-"]').first()
  await expect(firstRow.locator('[data-testid="cell-agent"]')).not.toHaveText('')
  await expect(firstRow.locator('[data-testid="cell-project"]')).not.toHaveText('')
})
```

**Note:** Per CLAUDE.md mandatory rule, run via `gsd-browser` for ad-hoc smokes (`gsd-browser navigate http://localhost:3032 && screenshot`); use the playwright spec for the structured E2E test.

---

### `lib/km-core/tests/integration/api-router.test.ts` (NEW — router integration)

**Analog:** `lib/km-core/tests/integration/round-trip.test.ts:60-90` (vitest + GraphKMStore tmpdir lifecycle).
**Pattern deviation:** add `supertest` devDep + spin up an `express()` instance per test; `npm install --save-dev supertest @types/supertest` in `lib/km-core/`.

**vitest + tmpdir lifecycle pattern** (lines 60-77):
```typescript
// lib/km-core/tests/integration/round-trip.test.ts:60-77  (template)
describe('round-trip parity', () => {
  let tmpdir: string;
  let store: GraphKMStore;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-core-roundtrip-'));
    store = new GraphKMStore({
      dbPath: path.join(tmpdir, 'leveldb'),
      exportDir: path.join(tmpdir, 'exports'),
      debounceMs: 0,
    });
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });
```

**Adapt for router smoke:**
```typescript
// lib/km-core/tests/integration/api-router.test.ts (NEW — adapted)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import { GraphKMStore, createKmCoreRouter } from '../../src/index.js';
// ... use the round-trip tmpdir pattern above ...

let app: express.Express;
beforeEach(() => {
  // tmpdir + store setup as in round-trip.test.ts
  app = express();
  app.use(express.json());
  const kmRouter = Router();
  createKmCoreRouter(store, kmRouter, { snapshotDir: path.join(tmpdir, 'exports') });
  app.use('/api/v1', kmRouter);
});

test('GET /api/v1/entities returns empty array on empty store', async () => {
  await store.open();
  const res = await request(app).get('/api/v1/entities');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: [] });
});
```

---

### `tests/integration/cross-system-parity.mjs` (NEW — coding-side cross-system test)

**Analog:** `tests/integration/http-api.test.js:1-78` (jest + node-fetch single-service pattern).
**Pattern deviations:** drive all three services concurrently; normalize timestamps + UUIDs before deep-diff (drivers are at A=12436, B=3848, C=3002).

**Setup pattern** (lines 19-37):
```javascript
// tests/integration/http-api.test.js:19-37  (template — single-service)
describe('VKB HTTP API Integration', () => {
  let dbManager;
  let apiServer;

  beforeAll(async () => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DB_PATH, { recursive: true });
    // ... single-service setup ...
  });
```

**Adapt for tri-service parity:**
```javascript
// tests/integration/cross-system-parity.mjs (NEW)
import fetch from 'node-fetch';

const SERVICES = [
  { name: 'A', url: 'http://localhost:12436/api/v1' },
  { name: 'B', url: 'http://localhost:3848/api/v1' },
  { name: 'C', url: 'http://localhost:3002/api/v1' },
];

function normalize(obj) {
  // strip volatile fields (timestamps, UUIDs) before deep-diff
  // ...
}

describe('cross-system REST parity', () => {
  for (const ep of ['/entities', '/stats', '/ontology/classes']) {
    test(`${ep} returns same shape on A, B, C`, async () => {
      const responses = await Promise.all(
        SERVICES.map(s => fetch(s.url + ep).then(r => r.json()))
      );
      const [a, b, c] = responses.map(normalize);
      expect(a).toEqual(b);
      expect(b).toEqual(c);
    });
  }
});
```

---

## Shared Patterns

### Pattern: Hydration-Gate Middleware (503-until-ready)

**Source:** `scripts/observations-api-server.mjs:1178-1183`
**Apply to:** A's `/api/v1` mount, B's `/api/v1` mount, C's `/api/v1` mount (RESEARCH Open Q5 recommends symmetry).

```javascript
// scripts/observations-api-server.mjs:1178-1183
kmSubRouter.use((_req, res, next) => {
  if (!_kmStoreReady || !_kmStore) {
    return res.status(503).json({ error: 'Knowledge graph store not ready' });
  }
  next();
});
```

### Pattern: Response Envelope `{ success: true, data }`

**Source:** OKM `tests/integration/rest-contract.test.ts:124` (`ApiSuccessEnvelope`) per RESEARCH §Data Flow + C-2 verbatim-shape rule.
**Apply to:** ALL `/api/v1/*` handlers in `createKmCoreRouter` (entities, relations, query, ontology, clusters, snapshots). NOT applied to legacy `/api/coding/*` typed views — they MUST preserve the legacy bare-array / `{data, total, limit, offset, _metadata}` shape (Pitfall 2).

```typescript
// km-core src/api/handlers/*.ts
res.json({ success: true, data: result });
// error path:
res.status(500).json({ success: false, error: err.message });
```

### Pattern: Error Handling Wrapper

**Source:** `lib/km-core/dist/api/router.js:424-431` (existing createKMRouter wrapper).
**Apply to:** Every route registered by `createKmCoreRouter`.

```javascript
const wrappedHandler = async (req, res) => {
    try {
        await route.handler(req, res);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ success: false, error: message }); // adapt envelope per above
    }
};
```

### Pattern: Logging via `process.stderr.write` (no `console.log`)

**Source:** `scripts/observations-api-server.mjs:460, 1163, 1166, 1190` (existing codebase convention) + CLAUDE.md mandatory rule (`no-console-log` constraint).
**Apply to:** ALL new code in km-core source and coding `scripts/`. NEVER use `console.log` in `.ts`/`.js` files (constraint will fire on Edit/Write). For migration scripts, follow Phase 41/43 convention: prefer structured stdout (`process.stdout.write(JSON.stringify(summary) + '\n')`) for results, stderr for diagnostics.

```javascript
// scripts/observations-api-server.mjs:1163
process.stderr.write(`[obs-api] km-core GraphKMStore ready\n`);
```

### Pattern: km-core Build Propagation

**Source:** CLAUDE.md (Submodules & Build Pipeline section — mandatory chain).
**Apply to:** Every plan that edits `lib/km-core/src/**`.

After any source edit:
```bash
cd /Users/Q284340/Agentic/coding/lib/km-core && npm run build
# For A (host-side): launchd respawn picks up new dist/
launchctl kickstart -k gui/$(id -u) com.coding.obs-api
# For B (container): rebuild required
cd /Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis && npm run build
cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services
# For C (OKM): repack .tgz + bump vendored copy in OKM's lib/km-core/vendor/
cd /Users/Q284340/Agentic/coding/lib/km-core && npm pack
# Then (in OKM repo) copy lib/km-core/fwornle-km-core-0.1.0.tgz → OKM lib/km-core/vendor/
```

### Pattern: `ontologyDir` Required (CLAUDE.md mandatory rule)

**Source:** CLAUDE.md `km-core scripts` mandatory rule (Phase 41 lesson, commits `87bc2f567` / `fd35c5350`).
**Apply to:** EVERY GraphKMStore construction in scripts (`scripts/migrate-sqlite-to-kmcore.mjs`), tests (router integration test), and consumer mount points (A/B/C).

Without `ontologyDir`, default-class resolution throws `opts.classes omitted but store has no ontology registry`. The pattern is the `import.meta.resolve('@fwornle/km-core')` walk-up shown in RESEARCH Example 4 lines 827-838 (already excerpted above under `migrate-sqlite-to-kmcore.mjs`).

### Pattern: Snapshot Commit Bypass via `OKB_SNAPSHOT=1`

**Source:** RESEARCH Pitfall 1 + Pattern 4 line 408.
**Apply to:** EVERY `execGit` call in `SnapshotManager.ts`. The 4-line hook bypass MUST be at the top of `scripts/hooks/pre-commit-okb-guard.sh` (between `set -euo pipefail` and `KB_PATTERN=`).

```typescript
// km-core src/snapshots/SnapshotManager.ts
execSync(`git ${args}`, {
  env: { ...process.env, GIT_DIR: env.gitDir, GIT_WORK_TREE: env.workTree,
         OKB_SNAPSHOT: '1' /* Pitfall 1 — required */ },
});
```

### Pattern: Strangler-then-Delete (R-4 hard cutover)

**Source:** Phase 42 D-51 / Phase 43 D-G3.1 (carry-forward, see CONTEXT line 78).
**Apply to:** The 3 cutover plans — A's `/api/km/` → `/api/v1/`, OKM's `/api/` → `/api/v1/` for the 15 canonical endpoints, and OKM viewer's 20 URL rewrites in `okbClient.ts`. Final-cleanup plan deletes the legacy code (no dual-mount).

---

## No Analog Found

Files with no close match in the LOCAL checkout (planner uses RESEARCH.md / OKM remote-clone instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tests/integration/okb-guard-snapshot-bypass.sh` | shell test | env-var bypass round-trip | No bash test template exists in this repo; structure the test as: (1) `OKB_SNAPSHOT=0` + stage `.data/exports/foo.json` → expect hook exit 1; (2) `OKB_SNAPSHOT=1` + same staging → expect hook exit 0. |
| `lib/km-core/tests/integration/observation-view.test.ts` | unit test | pure transform round-trip | Phase 41 mapper has unit tests under `tests/unit/adapters/` (not read here); the file structure mirrors `tests/unit/entity.test.ts`. Write fresh fixture-based round-trip: SQLite row → km-core entity (via Phase 41 mapper) → `observationToLegacy` → original SQLite row shape. |

All other entries have at least one local analog OR a complete RESEARCH.md code excerpt ready to copy.

---

## Cross-Repo Note (CLAUDE.md compliance)

OKM (`_work/rapid-automations/integrations/operational-knowledge-management/`) is a **separate git repo on bmw.ghe.com** and is NOT checked out at this workstation. Per `memory/feedback_bmw_ghe_https.md`, use HTTPS-token auth (`gh` CLI) when cloning/pushing. The planner must:

1. Clone OKM via HTTPS for the C-side modifications.
2. Apply per-repo CLAUDE.md Submodules & Build Pipeline rules (km-core build → repack `.tgz` → vendor into OKM → OKM rebuild).
3. Per `memory/feedback_worktree_verification.md`, verify "complete" claims against `main`, NOT worktree branches — applies to both repos.
4. Phase 43 OKM commit `8457dd56c` removed hallucinated `.planning/` docs from OKM — do NOT re-introduce planning docs in OKM; canonical planning stays in coding repo.

---

## Metadata

**Analog search scope (LOCAL):**
- `/Users/Q284340/Agentic/coding/lib/km-core/{src,dist,tests}/**`
- `/Users/Q284340/Agentic/coding/scripts/**`
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/**`
- `/Users/Q284340/Agentic/coding/tests/{integration,e2e}/**`

**OKM analog scope (REMOTE — via RESEARCH.md citations only):**
- `_work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts` lines 450-527 (handler bodies), 2076-2403 (snapshot impl), 998-1040 (resolveEntities wrapper)
- `_work/.../okm/tests/integration/rest-contract.test.ts` lines 94-167 (Zod schemas)
- `_work/.../okm/scripts/migrate-okm-json-to-kmcore.mjs` (migration template)
- `_work/.../okm/scripts/pre-commit-hook.sh` (OKB_SNAPSHOT=1 reference impl)
- `_work/.../okm/viewer/src/api/okbClient.ts` lines 225-519 (20 URL constants to rewrite)

**Files scanned locally:** ~25
**Pattern extraction date:** 2026-06-03
