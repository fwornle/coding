# Phase 44: REST API and Git Snapshots - Research

**Researched:** 2026-06-03
**Domain:** Shared REST contract over a TypeScript graph store + git-backed snapshot/restore across three Node services (host A, container B, separate-repo C)
**Confidence:** HIGH on locked stack and existing surfaces; MEDIUM on snapshot/atomicity edge cases; LOW on a few B-side specifics noted in Open Questions

## Summary

Phase 44 is mostly a plumbing + cleanup phase, not a research-heavy one. The locked decisions in `44-CONTEXT.md` (R-1..R-4, C-1..C-4, A-1..A-4, S-1..S-4) settle ~90% of the design surface. What's left for research is concrete mechanics: existing OKM handlers to lift, Zod export shape, B's mount strategy, the snapshot/git command sequence, and the OKB-baseline-guard hook edit.

Two surprising findings shape the plan:

1. **A half-finished Phase 44 attempt already exists.** `lib/km-core/dist/api/router.js` + `dist/snapshots/SnapshotManager.js` are present with no corresponding `src/` files [VERIFIED: `ls lib/km-core/src/` shows no `api/` or `snapshots/` dir]. They are a stranded draft from an earlier aborted Phase 44 pass that got partly reverted by Phase 43 D-G2.4. The plan must treat these as prior-art reference, not authoritative. Write fresh TS under `src/api/` and `src/snapshots/` based on the locked C-1 contract, then rebuild `dist/`. The existing draft has the right shape (framework-agnostic route descriptors + Express convenience wrapper) but predates Phase 43's wire-format lock and the C-1 endpoint set.

2. **Express version asymmetry: A=4.21, B=4.21, C=5.2.** [VERIFIED: package.json grep across all three]. The framework-agnostic pattern in the existing draft (km-core exports route descriptors; consumers pass their own `Router()`) sidesteps the peer-dep version problem cleanly. Recommendation: keep that pattern even though CONTEXT R-2 says "Express as peerDependency." Document it as peerDep-via-duck-typing. Consumers pass their own Router, km-core never imports Express, no version pin needed.

**Primary recommendation:** Write `src/api/router.ts` + `src/api/contracts.ts` + `src/snapshots/SnapshotManager.ts` in km-core that mirror the existing dist/ shape but match OKM's actual handler set (extracted from `routes.ts:450-527`). Mount on each system. Regenerate Phase 43 fixtures under `/api/v1/`. Extend the OKB guard hook to recognize `chore(snapshot|restore)` via env-var (the hook does not see commit messages; see Pitfall 1).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Canonical REST route handlers (~15 endpoints) | km-core library (`src/api/router.ts`) | nil | C-1 / R-1: single source of truth, consumers mount the router |
| Zod response schemas | km-core library (`src/api/contracts.ts`) | exported subpath `@fwornle/km-core/api/contracts` | C-2: schemas ship as code, consumers import to validate |
| HTTP server / Express app lifecycle | Per-system server process (A: `scripts/observations-api-server.mjs`, B: `src/sse-server.ts`, C: `src/api/server.ts`) | nil | km-core stays framework-agnostic; each system owns its port + middleware stack |
| Snapshot git operations | km-core library (`src/snapshots/SnapshotManager.ts`) | per-system snapshot dir config | S-1/S-2/S-4: one shared impl, each system passes its own export path |
| OKB-baseline guard / commit hygiene | Per-repo git hook (coding `.git/hooks/pre-commit`, OKM `.git/modules/.../hooks/pre-commit`) | nil | S-3: hooks are repo-scoped, identical logic copy-pasted to each |
| A's typed views (`/api/coding/observations|digests|insights`) | A's server (`observations-api-server.mjs`) using `km-core/src/adapters/observation-view.ts` | km-core adapter for reshape | A-4: A owns the legacy URL surface; km-core ships the pure reshape function |
| OKM-specific operations (PII, ingest, RCA, source-docs) | OKM `src/api/routes.ts` mounted at `/api/okm/*` | nil | C-4: not part of canonical contract; OKM keeps these |
| B's SSE workflow surface (`/sse`, `/messages`, `/workflow-events`) | B's `src/sse-server.ts` | nil | unchanged; new REST mount is additive |
| Cluster detection (Louvain) | OKM `src/intelligence/clustering.ts` invoked via km-core handler | nil | C-3: lift the pure function into km-core or import it from OKM as a dep (see Open Question 3) |
| Snapshot ID format (git tags) | km-core SnapshotManager | nil | S-4: `git tag -l 'snapshot/*'` is the source of truth |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | A: ^4.21.0, B: ^4.21.0, C: ^5.2.1 [VERIFIED: package.json grep] | HTTP server / Router on each system | Already present in all three; no migration needed |
| zod | ^3.25.76 (OKM) [VERIFIED: OKM package.json]; new dep for km-core | Response schema codification (C-2) | Already used in OKM's `rest-contract.test.ts`; TypeScript-first inference via `z.infer<>` [CITED: zod docs via Context7 `/colinhacks/zod`] |
| graphology | ^0.26.0 [VERIFIED: km-core package.json] | In-memory graph backing the route handlers | Already the km-core storage primitive |
| `@fwornle/km-core` | 0.1.0 (gains new sub-path exports in this phase) [VERIFIED: lib/km-core/package.json] | Shared router factory + Zod contracts + SnapshotManager | The whole point of Phase 44 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:child_process.execSync` | Node 22 builtin | Git CLI invocation in SnapshotManager | Phase 43 OKM uses this pattern verbatim (`routes.ts:2120-2134`); proven on this codebase |
| `cors` | ^2.8.5 [VERIFIED: coding root + OKM] | CORS middleware on each system's Express app | Existing pattern; no change |
| `supertest` | dev-dep in OKM tests | In-process HTTP testing for fixtures-diff | Already used by `rest-contract.test.ts`; reuse for B/A verification tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Express Router pattern | Fastify | All three already on Express; switching is pure cost |
| Zod | io-ts / valibot / TypeBox | Zod already in OKM; switching is pure cost; v3 is mature enough for this phase |
| `execSync('git ...')` | `simple-git` npm package | Adds a dep; OKM's `routes.ts:2120` pattern works fine with stdlib |
| `git tag` as snapshot IDs (S-4) | Parallel metadata JSON | S-4 explicitly chose git tags; no parallel index to keep consistent |
| In-package Express peerDep | Framework-agnostic route descriptors | Recommended over the locked R-2. See Open Question 1 |

**Installation (km-core side):**
```bash
cd lib/km-core
npm install --save zod@^3.25
# express stays UNINSTALLED; consumers pass their own Router instance
npm run build
```

**Version verification (run before locking the plan):**
```bash
npm view zod version              # confirm 3.25.x still current
npm view express version          # confirm 4.x and 5.x both still maintained
npm view supertest version        # for test dev-dep
```

**[ASSUMED] zod 3.25.x is the right pin.** Reason: OKM already uses `^3.25.76`. Zod 4.x exists [CITED: Context7 zod docs showing v4 packages] but switching would force OKM to migrate. Keep on 3.x for this phase.

## Package Legitimacy Audit

This phase does NOT install new external packages on the consumer side (A/B/C). Only km-core gains a new internal dep on `zod`, which is already in OKM's tree. Per the protocol's graceful-degradation rule, slopcheck was not run because no new package names are being introduced; all referenced packages are already proven in the codebase.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| zod | npm | 8 yrs | ~30M/wk | github.com/colinhacks/zod | not-run (already in OKM) | Approved [VERIFIED: OKM package.json uses it] |
| express | npm | 14 yrs | ~80M/wk | github.com/expressjs/express | not-run (already in all 3 systems) | Approved [VERIFIED: package.json grep] |
| cors | npm | 11 yrs | ~13M/wk | github.com/expressjs/cors | not-run (already in OKM + coding root) | Approved [VERIFIED] |
| supertest | npm | 13 yrs | ~6M/wk | github.com/ladjs/supertest | not-run (already in OKM test deps) | Approved [VERIFIED] |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture (textual)

**Tier 1: Clients.** Three consumer classes drive the canonical surface:
(a) the VOKB viewer (C-side React app),
(b) the system-health dashboard at port 3032 (A-side React app, which forwards to A's obs-api),
(c) ad-hoc curl/script consumers,
(d) the future Phase 45 unified viewer.

**Tier 2: Per-system HTTP servers.** Each system runs an Express app on its own port:
A = `scripts/observations-api-server.mjs` on port 12436 (host);
B = `integrations/mcp-server-semantic-analysis/src/sse-server.ts` on port 3848 (container);
C = `_work/.../okm/src/api/server.ts` on port 3002 (container).
Each calls `app.use('/api/v1', createKmCoreRouter(kmStore, opts))` to mount the canonical surface, and `app.use('/api/<system>/', ...)` for per-system operations (A: legacy typed views; C: PII/ingest/RCA; B: nothing for now).

**Tier 3: km-core library (`@fwornle/km-core`).** The single source of truth lives in this submodule. New Phase 44 modules: `src/api/router.ts` (handlers for ~15 canonical endpoints), `src/api/contracts.ts` (Zod schemas exported for consumer import), `src/snapshots/SnapshotManager.ts` (git add/commit/tag/checkout for `.data/exports/`), `src/adapters/observation-view.ts` (entity-to-legacy-shape reshape for A-4). Existing modules unchanged: `GraphKMStore`, `OntologyRegistry`, `resolveEntities`/`mergeEntities`.

**Tier 4: Storage.** `GraphKMStore` (Graphology in-memory + LevelDB durable + per-domain JSON exports debounced at 5s) is the primary store. Per-domain JSON exports under `.data/exports/<domain>.json` are the snapshot atom for S-1.

**Tier 5: Git repo + pre-commit hook.** Each system's host repo contains `.data/exports/` (per CLAUDE.md and Phase 37 D-21). The pre-commit hook (`scripts/hooks/pre-commit-okb-guard.sh` on coding side, `_work/.../okm/scripts/pre-commit-hook.sh` on OKM side) blocks mixed commits unless the env-var bypass is set (S-3).

**Data flow for `GET /api/v1/entities?ontologyClass=Component`:**
1. HTTP request arrives at A/B/C Express app.
2. `app.use('/api/v1', router)` routes to km-core handler.
3. Handler calls `await store.findByOntologyClass('Component')` [VERIFIED: GraphKMStore.ts:556].
4. Result is shaped per `EntityResponseSchema` (Zod schema in `contracts.ts`).
5. Handler responds with `{ success: true, data: [...] }` (matches OKM's existing `ApiSuccessEnvelope` [VERIFIED: rest-contract.test.ts:124]).

**Data flow for `POST /api/v1/snapshots`:**
1. Handler calls `await store.exportJson()` to flush pending debounced writes [CITED: existing dist/api/router.js:606 + GraphKMStore close-time contract].
2. `SnapshotManager.createSnapshot({ label })` runs `git add -A .data/exports/`, then `git commit -m "chore(snapshot): <label>"`, then `git tag snapshot/<label>-<UTC-ts>` [pattern from dist/snapshots/SnapshotManager.js:24].
3. Returns `{ id: 'snapshot/<label>-<ts>', hash, message, date }`.

### Recommended Project Structure (km-core deliverables)

```
lib/km-core/src/
  api/                       (NEW Phase 44)
    router.ts                createKmCoreRouter factory
    contracts.ts             Zod schemas exported for consumers
    handlers/                one file per endpoint group
      entities.ts
      relations.ts
      query.ts
      ontology.ts
      clusters.ts
      snapshots.ts
    index.ts                 barrel for createKmCoreRouter + Zod schemas
  adapters/
    online/                  existing (Phase 41)
    observation-view.ts      NEW Phase 44; A-4 typed-view reshape
  snapshots/                 NEW Phase 44
    SnapshotManager.ts       git-backed snapshot/restore
    index.ts
  (existing dirs unchanged)
```

### Pattern 1: Framework-Agnostic Router Factory (recommended)

**What:** km-core exports route descriptors and a thin Express-mounting helper. Consumers pass their own `Router()` instance; km-core never imports Express.
**When to use:** Phase 44 deliverable. Sidesteps Express 4 vs 5 peer-dep version split.
**Example:** mirror the existing dist/ shape but generalize to v1 contract.

```typescript
// Source: lib/km-core/dist/api/router.d.ts (existing draft, refine)
// km-core stays Express-free. Consumer wires the bridge.

// km-core side (src/api/router.ts)
export interface KmCoreRouterOptions {
  ontologyRegistry?: OntologyRegistry;
  snapshotDir?: string;
  enableSnapshots?: boolean;
  readOnly?: boolean;
}

export interface ExpressLikeRouter {
  get: (path: string, ...h: any[]) => void;
  post: (path: string, ...h: any[]) => void;
  put: (path: string, ...h: any[]) => void;
  delete: (path: string, ...h: any[]) => void;
}

export function createKmCoreRouter(
  store: GraphKMStore,
  router: ExpressLikeRouter,
  opts: KmCoreRouterOptions = {},
): ExpressLikeRouter {
  // Internally builds route descriptors then attaches them to `router`.
  // Same pattern as existing dist/api/router.js createKMRouter.
  return router;
}
```

```typescript
// Consumer side (A/B/C each do this).
// Source: scripts/observations-api-server.mjs:1176-1190 (existing A pattern)
import express, { Router } from 'express';
import { createKmCoreRouter } from '@fwornle/km-core';

const app = express();
app.use(express.json());

const kmRouter = Router();
createKmCoreRouter(kmStore, kmRouter, {
  ontologyRegistry: kmStore.getOntologyRegistry(),
  snapshotDir: '.data/exports',
});
app.use('/api/v1', kmRouter);
```

### Pattern 2: Zod-as-Shipped-Contract

**What:** Zod schemas defined in `km-core/src/api/contracts.ts` and exported via package.json `exports` sub-path so consumers can `import` them.
**When to use:** validating responses match the canonical shape in tests; deriving TS types via `z.infer<>` [CITED: Context7 zod docs].

```typescript
// Source: extracted from OKM tests/integration/rest-contract.test.ts:94-167
// (these schemas currently live in OKM tests; Phase 44 LIFTS them into km-core)
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
  // Phase 39 fields:
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

export const EntitiesEndpointResponse = ApiSuccessEnvelope(z.array(EntitySchema));

// Derive TS types for consumers:
export type Entity = z.infer<typeof EntitySchema>;
export type EntityResponse = z.infer<typeof EntitiesEndpointResponse>;
```

**Sub-path export wiring (km-core `package.json`):**
```json
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
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
  }
}
```

This follows the established Phase 41/42 pattern in km-core (existing `./adapters/online`, `./maintenance`, `./embeddings` sub-paths) [VERIFIED: lib/km-core/package.json:8-35].

### Pattern 3: Typed View Adapter (A-4)

**What:** Pure reshape function turns a km-core Entity into A's legacy observation shape. No store side-effects.
**When to use:** `GET /api/coding/observations` handler iterates km-core entities with `ontologyClass='Observation'`, then maps each via `observationToLegacy()`.

```typescript
// km-core/src/adapters/observation-view.ts (NEW, A-4 deliverable)
// Source: mirrors existing src/adapters/online/index.ts pattern, reversed direction.
// Phase 41 already maps SQLite to km-core; this maps the other way.

import type { Entity } from '../types/entity.js';

export interface LegacyObservation {
  id: string;
  agent: string;
  project: string;
  content: string;     // = summary in SQLite
  artifacts: string[]; // parsed from metadata.artifacts
  timestamp: string;   // = createdAt
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

export function digestToLegacy(entity: Entity): LegacyDigest { /* mirror */ }
export function insightToLegacy(entity: Entity): LegacyInsight { /* mirror */ }
```

**Query side (A server consumer):**
```typescript
// scripts/observations-api-server.mjs (modified handler)
app.get('/api/coding/observations', async (req, res) => {
  const store = await ensureKMStore();
  if (!store) return res.status(503).json({ error: 'KG not ready' });

  const all = [];
  for await (const entity of store.iterate({ ontologyClass: 'Observation' })) {
    all.push(observationToLegacy(entity));
  }
  // Apply existing filters (agent, project, from, to, q, quality, limit, offset)
  // exactly as the SQLite-backed handler does; query-string contract unchanged.
  const filtered = applyLegacyFilters(all, req.query);
  res.json(filtered);
});
```

**Performance for SC-3:** 804 observations of small JSON objects equals about a few hundred KB serialized. `kmStore.iterate()` is async-iter [VERIFIED: GraphKMStore.ts:804], so streamable. Linear-time filter is fine; the SQLite handler already does about the same. No pagination changes needed for 804 rows.

### Pattern 4: SnapshotManager Git-Backed Atomic Snapshot

**What:** shell out to git via `child_process.execSync` with explicit `GIT_DIR` / `GIT_WORK_TREE` to support both standalone repos and submodules. Pattern lifted from OKM `routes.ts:2076-2134`.
**When to use:** S-1 / S-2 / S-4 implementation.

```typescript
// km-core/src/snapshots/SnapshotManager.ts (NEW)
// Source: lifted from _work/.../okm/src/api/routes.ts:2076-2310 (getGitEnv +
// execGit + listSnapshots + restoreSnapshot) AND from existing
// lib/km-core/dist/snapshots/SnapshotManager.js (Phase 44 draft).

import { execSync } from 'node:child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export interface SnapshotEntry {
  id: string;        // 'snapshot/<label>-<UTC-ts>' (S-4)
  label: string;
  timestamp: string;
  commit_sha: string;
  message: string;
  domains_present: string[];
}

export interface SnapshotManagerOptions {
  exportDir: string;  // absolute path
}

export class SnapshotManager {
  constructor(private opts: SnapshotManagerOptions) {}

  private getGitEnv(): { gitDir: string; workTree: string; exportsRel: string } {
    // Walk up from exportDir to find .git (dir or gitlink file for submodules).
    // Pattern lifted from OKM routes.ts:2081-2117; handles BOTH cases.
    let dir = path.resolve(this.opts.exportDir, '..');
    for (let i = 0; i < 10; i++) {
      const dotGit = path.join(dir, '.git');
      if (existsSync(dotGit)) {
        const stat = statSync(dotGit);
        let gitDir: string;
        if (stat.isDirectory()) {
          gitDir = dotGit;
        } else {
          // gitlink file: "gitdir: <path>"
          const content = readFileSync(dotGit, 'utf-8').trim();
          const match = content.match(/^gitdir:\s*(.+)$/);
          if (!match) throw new Error(`Malformed .git file at ${dotGit}`);
          gitDir = path.resolve(dir, match[1]);
        }
        return {
          gitDir,
          workTree: dir,
          exportsRel: path.relative(dir, this.opts.exportDir),
        };
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`No .git found walking up from ${this.opts.exportDir}`);
  }

  private execGit(args: string, env: { gitDir: string; workTree: string }): string {
    return execSync(`git ${args}`, {
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_DIR: env.gitDir,
        GIT_WORK_TREE: env.workTree,
        OKB_SNAPSHOT: '1', // Pitfall 1: bypass the OKB-baseline guard
      },
    }).trim();
  }

  async createSnapshot(label: string): Promise<SnapshotEntry> {
    const env = this.getGitEnv();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const tagName = `snapshot/${label}-${ts}`;
    const commitMsg = `chore(snapshot): ${label}`;

    this.execGit(`add -A -- "${env.exportsRel}/"`, env);
    this.execGit(`commit -m ${JSON.stringify(commitMsg)} --allow-empty`, env);
    this.execGit(`tag ${JSON.stringify(tagName)}`, env);

    const hash = this.execGit('rev-parse HEAD', env);
    const date = this.execGit('log -1 --format=%aI HEAD', env);

    const lsTree = this.execGit(`ls-tree --name-only HEAD -- "${env.exportsRel}/"`, env);
    const domains = lsTree.split('\n')
      .map(p => path.basename(p, '.json'))
      .filter(d => d && !d.startsWith('.'));

    return { id: tagName, label, timestamp: ts, commit_sha: hash, message: commitMsg, domains_present: domains };
  }

  async listSnapshots(): Promise<SnapshotEntry[]> {
    const env = this.getGitEnv();
    // S-4: git tag is the source of truth
    const tags = this.execGit(`tag -l 'snapshot/*' --sort=-creatordate`, env);
    if (!tags) return [];
    return tags.split('\n').map(tag => {
      const hash = this.execGit(`rev-list -n 1 ${JSON.stringify(tag)}`, env);
      const date = this.execGit(`log -1 --format=%aI ${JSON.stringify(tag)}`, env);
      const msg = this.execGit(`log -1 --format=%s ${JSON.stringify(tag)}`, env);
      const m = tag.match(/^snapshot\/(.+?)-(\d{4}-\d{2}-\d{2}T.+)$/);
      const label = m?.[1] ?? tag;
      const timestamp = m?.[2] ?? date;
      const lsTree = this.execGit(`ls-tree --name-only ${JSON.stringify(tag)} -- "${env.exportsRel}/"`, env);
      const domains = lsTree.split('\n')
        .map(p => path.basename(p, '.json'))
        .filter(d => d && !d.startsWith('.'));
      return { id: tag, label, timestamp, commit_sha: hash, message: msg, domains_present: domains };
    });
  }

  async restoreSnapshot(snapshotId: string): Promise<{ restored: boolean; id: string; commit_sha: string }> {
    const env = this.getGitEnv();
    const hash = this.execGit(`rev-list -n 1 ${JSON.stringify(snapshotId)}`, env);
    // S-2: hard reset on the exports dir only.
    this.execGit(`checkout ${JSON.stringify(snapshotId)} -- "${env.exportsRel}/"`, env);
    // Caller is responsible for: (a) wiping the LevelDB dir to force JSON-fallback
    // hydration (Phase 37 D-22), (b) restarting the server, (c) committing the
    // restore with `chore(restore): <id>` message.
    return { restored: true, id: snapshotId, commit_sha: hash };
  }
}
```

**Critical:** the LevelDB wipe + server restart is NOT done by `restoreSnapshot()`. Returning control to the caller is intentional; each system handles its own process lifecycle.

### Anti-Patterns to Avoid

- **Importing `express` from km-core.** Breaks the framework-agnostic boundary; forces a peer-dep version choice that A (4.x) and C (5.x) disagree on. Pass `Router` instances in.
- **Re-deriving Zod schemas in each system's tests.** Defeats C-2; the schemas must be exported from km-core and imported by every test suite (OKM's `rest-contract.test.ts` becomes a re-import, not a re-declaration).
- **Adding a `/snapshots/:id/restore` POST handler that ALSO wipes LevelDB and restarts.** Coupling control-plane (restore) with process lifecycle (restart) inside one HTTP handler is brittle. Either succeed atomically or split. Recommend handler returns 200 with a `restartRequired: true` field so the operator runs a follow-up `systemctl restart` / `launchctl kickstart` / `docker restart`.
- **Mixing `/api/km/` from the dist/ draft with `/api/v1/` from R-3.** Pick `/api/v1/` for the canonical mount, delete the `/api/km/` references in `scripts/observations-api-server.mjs:1185` as part of the cutover plan.
- **Using `git checkout <hash> -- .` from process cwd.** OKM's pattern wisely scopes the checkout to `exportsRel` via GIT_DIR/WORK_TREE; doing it without the scoping can blow away unrelated working-tree files. The provided SnapshotManager uses the scoped form.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP routing | Custom router | Express `Router()` (already in all 3 systems) | Already there; consistent with the codebase |
| Response schema validation | Hand-written guards | Zod `.parse()` / `z.infer<>` | OKM already uses this in `rest-contract.test.ts`; gives free TS types |
| Git operations from Node | nodegit / isomorphic-git | `execSync('git ...')` with GIT_DIR/WORK_TREE | OKM's `routes.ts:2120` proves this works; native git binary handles submodules cleanly |
| Snapshot indexing | A separate `snapshots.json` registry | `git tag -l 'snapshot/*'` (S-4) | Single source of truth; no consistency to manage |
| Louvain clustering | New implementation | OKM `src/intelligence/clustering.ts` (graphology-communities-louvain wrapper) | Already proven via Phase 43 fixtures; deterministic given a seed |
| Per-system observation-shape conversion | Custom per-handler reshape | `km-core/src/adapters/observation-view.ts` shared module | One reshape, three consumers possible (only A needs it today, but future symmetry preserved) |
| SQLite to km-core migration | Bespoke script | Mirror `scripts/migrate-okm-json-to-kmcore.mjs` (Phase 43 Plan 07) [VERIFIED] | Pattern proven: `--dry-run`, `--resume`, `--batch-size`, `--run-id` flags + structured stdout summary |

**Key insight:** Phase 43's `migrate-okm-json-to-kmcore.mjs` is a near-perfect template for A's `migrate-sqlite-to-kmcore.mjs`. It already covers idempotency (`legacyId` match means skip), batching, dry-run, error budget, structured summary. The only change is the source (SQLite rows via `better-sqlite3` rather than JSON files) [CITED: scripts/migrate-okm-json-to-kmcore.mjs:1-100].

## Runtime State Inventory

> Phase 44 is a refactor/cutover phase; runtime state must be inventoried explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | A's SQLite at `.observations/observations.db`: 804 observations + 265 digests + 77 insights [VERIFIED: sqlite3 COUNT(*)]. After A-2 migration, tables `observations`, `digests`, `insights` are dropped (A-3); km-core LevelDB at `.data/knowledge-graph/leveldb/` becomes authoritative for these record kinds. Tables `budget_events`, `session_metrics`, `embedding_cache` SURVIVE (A-3 explicit). B's km-core LevelDB at `.data/knowledge-graph/` (Phase 42 cutover, already canonical). C's km-core LevelDB at `.data/leveldb/` inside OKM (Phase 43 cutover, already canonical). | Data migration: run `scripts/migrate-sqlite-to-kmcore.mjs` ONCE per A install; then DROP TABLE for the three legacy tables. No data migration needed for B or C; they are already on km-core. |
| Live service config | No dashboards, n8n workflows, or external service configs reference the canonical surface yet [VERIFIED: grep for `/api/entities` finds only OKM internals + the VOKB viewer client]. VOKB viewer at `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/api/okbClient.ts` has hardcoded `/api/*` paths (lines 225, 271, 282, 291, 299, 317, 326, 335, 349, 359, 383, 400, 415, 425, 468, 475, 480, 485, 497, 508, 519) [VERIFIED via grep]. | Code edit (single file): rewrite `okbClient.ts` paths from `/api/` to `/api/v1/` for the canonical 15 endpoints, keep `/api/` for OKM-specific (RCA, source-documents, snapshots-legacy-shape, etc.). Document explicit mapping in the cutover plan. |
| OS-registered state | launchd plists in `~/Library/LaunchAgents/`; `com.coding.obs-api` runs `observations-api-server.mjs`. After the script mounts `/api/v1/`, no plist change needed (port + script path unchanged) [VERIFIED: launchctl-managed daemons listed in CLAUDE.md]. No Windows Task Scheduler entries (macOS dev environment). No pm2 in coding repo. | None for OS-level registrations. Standard service restart picks up the new code. |
| Secrets / env vars | No new env vars introduced. Existing: `OBSERVATIONS_DB_PATH`, `OBSERVATIONS_API_PORT`, `QDRANT_URL`, `LLM_CLI_PROXY_URL`. S-3 OKB-baseline guard may need `OKB_SNAPSHOT=1` env var bypass (the OKM hook already uses this; coding-side hook does NOT; see Pitfall 1). | Possible code edit to coding-side hook: add `chore(snapshot|restore)` env-var-bypass mechanism. NO secret rotation. |
| Build artifacts | km-core `lib/km-core/dist/` has the orphan Phase 44 draft (`dist/api/router.js`, `dist/snapshots/SnapshotManager.js`) with NO TS source [VERIFIED: ls src/]. `fwornle-km-core-0.1.0.tgz` in lib/km-core (vendored tarball for OKM consumer). OKM `lib/km-core/` submodule (D-G1.2) consumes the .tgz; bump version on release. A's import path `'../lib/km-core/dist/store/GraphKMStore.js'` is a deep-import to dist/ [VERIFIED: scripts/observations-api-server.mjs:40-41]; works because km-core's `files` field includes dist, but a barrel `@fwornle/km-core` import would be cleaner. | Build sequence (CRITICAL, per CLAUDE.md): (1) edit `lib/km-core/src/api/**` (new dir), (2) `cd lib/km-core && npm run build` (regenerates `dist/api/*` from source, OVERWRITING the orphan draft), (3) `npm pack` to refresh `fwornle-km-core-0.1.0.tgz`, (4) on coding side, restart `obs-api` (launchd kickstart), (5) on B side, `cd integrations/mcp-server-semantic-analysis && npm run build && docker-compose restart coding-services`, (6) on OKM side, copy new .tgz into `lib/km-core/vendor/` + bump `package.json` km-core version. |

**Nothing found in category:** all categories have findings. No nullable cells.

## Common Pitfalls

### Pitfall 1: OKB Pre-Commit Hook Cannot See Commit Messages

**What goes wrong:** S-3 says "hook recognizes `chore(snapshot)` / `chore(restore)` prefixes as exempt." But the `pre-commit` hook fires BEFORE the commit message is finalized; `git diff --cached --name-only` is available, the message is not.

**Why it happens:** `pre-commit` runs against staged files; `commit-msg` runs against the message. They are different hooks [VERIFIED: standard git hook semantics; `.git/hooks/pre-commit` body shows it only inspects `git diff --cached --name-only`].

**How to avoid:** two viable approaches.
1. Env-var bypass (matches OKM's existing pattern in `_work/.../okm/scripts/pre-commit-hook.sh`): the snapshot/restore endpoint runs `OKB_SNAPSHOT=1 git commit -m "chore(snapshot): ..."`. Hook checks `${OKB_SNAPSHOT:-0}` and exits 0 if set. Concrete diff to `.git/hooks/pre-commit`: add four lines:
   ```bash
   if [ "${OKB_SNAPSHOT:-0}" = "1" ]; then
       exit 0
   fi
   ```
2. Add a sibling `commit-msg` hook that lets `chore(snapshot)` / `chore(restore)` prefixes through even if pre-commit blocked. More invasive; requires changing the hook architecture.

**Recommendation:** approach 1. SnapshotManager wraps `git commit` with `OKB_SNAPSHOT=1` env-var (already embedded in the code example above). Hook gets a 4-line diff. OKM hook already supports it [VERIFIED]; only coding-side hook needs the edit. The `.git/hooks/pre-commit` is NOT git-tracked; canonical source is `scripts/hooks/pre-commit-okb-guard.sh` (per the script's existence and the coding repo's hook installation convention).

**Warning signs:** snapshot commits failing pre-commit with "Mixed commit: KB files + other files"; that means SnapshotManager did not set the env var or the hook was not updated.

### Pitfall 2: A's Dashboard at :3032 Reads Legacy Endpoint Shapes; Field-Drift Breaks UI

**What goes wrong:** dashboard renders observations from `/api/observations` expecting exact field names (`agent`, `project`, `content`, `artifacts`, `timestamp`). If `observationToLegacy` reshape misses a field or renames one, the dashboard silently displays empty cells.

**Why it happens:** A's dashboard at port 3032 forwards `GET /api/observations` to A's obs-api at port 12436 (host) [VERIFIED: dashboard server.js:4538-4549]. The legacy endpoint contract is brittle; not Zod-validated on the dashboard side.

**How to avoid:**
1. Lock the legacy shape with a Zod schema in km-core (`LegacyObservationSchema`); derive it from current SQLite SELECT shape.
2. Add a unit test that round-trips: SQLite row equals km-core entity equals `observationToLegacy` output.
3. Add a Playwright smoke test that loads the dashboard and verifies non-empty cells.
4. Run dashboard smoke during phase verification.

**Warning signs:** dashboard shows agent / project columns as `undefined` or blank; observation count drops from ~800 to 0 after cutover.

### Pitfall 3: GraphKMStore.iterate() Filter Mismatch (`entityType` vs `ontologyClass`)

**What goes wrong:** `GraphKMStore.findByOntologyClass(cls)` checks BOTH `entity.entityType` AND `entity.ontologyClass` [VERIFIED: GraphKMStore.ts:566; condition `if (entity.entityType !== cls && entity.ontologyClass !== cls) continue`]. The migrated A observations must set ONE of those two to `'Observation'`. If A's migration script only sets one but the typed-view filter uses the other, results equal 0.

**Why it happens:** Phase 42 lesson: B's `KGEntity` had `type` while persistence used `entityType`; two-field disconnect lost work. Same trap here.

**How to avoid:** migration script MUST set BOTH `entity.entityType = 'Observation'` AND `entity.ontologyClass = 'Observation'`. Add a post-migration grep / store-iterate test confirming all migrated entities have both fields set.

**Warning signs:** `/api/coding/observations` returns `[]` after cutover despite migration script reporting `entitiesMigrated: 804`.

### Pitfall 4: Restore Without Server Restart Equals LevelDB Lock + Stale In-Memory Graph

**What goes wrong:** `POST /api/v1/snapshots/:id/restore` checks out new JSONs into `.data/exports/`, but the running server still has the old graph in memory + open LevelDB. The next mutation will write the OLD state back, undoing the restore.

**Why it happens:** Phase 37 D-22 LevelDB-empty-to-JSON-fallback only fires on a fresh process boot. A live process will not re-hydrate from JSON.

**How to avoid:** the handler MUST return a "restart required" signal; the operator (or a watchdog) restarts the server before issuing further mutations. Concrete options:
- Handler returns 200 with `{ restored: true, restartRequired: true }`.
- A separate `POST /api/v1/snapshots/:id/restore` step is exposed in the launchd plist or supervisor (e.g., a wrapper script that does restore plus `systemctl restart`).
- A simpler hack: handler calls `process.exit(0)` after sending the response so launchd respawns. Risky if other requests are in-flight; document loudly.

**Warning signs:** after restore, entity counts have not changed; subsequent writes silently overwrite the snapshot state.

### Pitfall 5: Phase 43 Fixtures Become Stale After Path Change

**What goes wrong:** `tests/fixtures/pre-migration/*.json` were recorded against `/api/entities`. The R-4 cutover changes them to `/api/v1/entities`. The recorded responses should be byte-identical regardless of URL (the responses do not include the URL), but the recorder script must change.

**Why it happens:** `record-rest-fixtures.mjs` hardcodes endpoint paths in the `ENDPOINTS` array [VERIFIED: scripts/record-rest-fixtures.mjs:95+]. The fixture FILES are byte-snapshots of response bodies and stay valid; only the recorder + the contract test's request URLs change.

**How to avoid:**
1. Patch the recorder's `ENDPOINTS` array: change `/api/entities` to `/api/v1/entities` etc.
2. Patch `rest-contract.test.ts` request URLs to match.
3. Re-run the recorder ONCE to confirm zero diff against the existing fixture JSON files (because response bodies do not depend on URL).
4. Commit the recorder + test changes; fixture files stay unchanged.

**Warning signs:** recorder regenerates fixtures with diffs vs old ones equals some response field DOES depend on URL (unexpected). Investigate before locking.

## Code Examples

### Example 1: createKmCoreRouter Skeleton with 3 Representative Handlers

```typescript
// lib/km-core/src/api/router.ts (NEW Phase 44 deliverable)
// Source pattern: lib/km-core/dist/api/router.js (existing draft, refined)

import type { GraphKMStore } from '../store/GraphKMStore.js';
import type { OntologyRegistry } from '../ontology/registry.js';
import { SnapshotManager } from '../snapshots/SnapshotManager.js';
import { mintEntityId } from '../ids/mint.js';

export interface KmCoreRouterOptions {
  ontologyRegistry?: OntologyRegistry;
  snapshotDir?: string;
  enableSnapshots?: boolean;
  readOnly?: boolean;
}

interface RouterLike {
  get: (path: string, handler: (req: any, res: any) => any) => void;
  post: (path: string, handler: (req: any, res: any) => any) => void;
  put: (path: string, handler: (req: any, res: any) => any) => void;
  delete: (path: string, handler: (req: any, res: any) => any) => void;
}

export function createKmCoreRouter(
  store: GraphKMStore,
  router: RouterLike,
  opts: KmCoreRouterOptions = {},
): RouterLike {
  const readOnly = opts.readOnly === true;
  const snap = opts.enableSnapshots !== false && opts.snapshotDir
    ? new SnapshotManager({ exportDir: opts.snapshotDir })
    : undefined;

  // GET /entities — list with filter
  router.get('/entities', async (req, res) => {
    try {
      const cls = req.query?.ontologyClass as string | undefined;
      const limit = parseInt(req.query?.limit ?? '0', 10) || 0;
      const offset = parseInt(req.query?.offset ?? '0', 10) || 0;
      const all: any[] = [];
      if (cls) {
        const matches = await store.findByOntologyClass(cls);
        all.push(...matches);
      } else {
        for await (const e of store.iterate()) {
          all.push(e);
        }
      }
      const sliced = limit > 0 ? all.slice(offset, offset + limit) : all;
      res.json({ success: true, data: sliced });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // POST /entities — create
  if (!readOnly) {
    router.post('/entities', async (req, res) => {
      try {
        const body = req.body ?? {};
        const entity = {
          id: body.id ?? mintEntityId(),
          name: body.name,
          entityType: body.entityType ?? body.ontologyClass ?? 'Unclassified',
          ontologyClass: body.ontologyClass,
          layer: body.layer ?? 'evidence',
          description: body.description ?? '',
          metadata: body.metadata ?? {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          validFrom: new Date().toISOString(),
          validUntil: null,
          ...body,
        };
        await store.putEntity(entity);
        res.status(201).json({ success: true, data: entity });
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });
  }

  // POST /snapshots — create snapshot
  if (snap && !readOnly) {
    router.post('/snapshots', async (req, res) => {
      try {
        const label = (req.body?.label ?? 'manual') as string;
        await store.exportJson(); // flush pending debounced writes first
        const entry = await snap.createSnapshot(label);
        res.status(201).json({ success: true, data: entry });
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    router.get('/snapshots', async (_req, res) => {
      try {
        const list = await snap.listSnapshots();
        res.json({ success: true, data: list });
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    router.post('/snapshots/:id/restore', async (req, res) => {
      try {
        const id = req.params.id;
        const result = await snap.restoreSnapshot(id);
        res.json({
          success: true,
          data: { ...result, restartRequired: true }, // Pitfall 4 signal
        });
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });
  }

  // Remaining 12+ handlers: GET/PUT/DELETE /entities/:id, /relations CRUD,
  // /query, /export, /stats, /ontology/{classes,entity-types,schema/:className},
  // /graph/{connectivity,orphans}, /cleanup/{resolve-entities,deduplicate-edges,
  // orphans,relations-by-type}, /clusters.
  // Source: extract OKM routes.ts:450-527 handler bodies and inline them here.

  return router;
}
```

### Example 2: OKM-Handler-to-km-core Endpoint Map (C-1)

| Canonical endpoint (km-core) | OKM handler to lift | OKM file:line | Notes |
|------------------------------|---------------------|---------------|-------|
| `GET /entities` | `listEntities` | routes.ts:451 | Lift verbatim; replace `this.graphStore.getAllEntities()` with `store.iterate()` |
| `POST /entities` | `createEntity` | routes.ts:450 | Lift; replace OKM-specific layer-prefix code with bare EntityId |
| `GET /entities/:id` | `getEntity` | routes.ts:452 | Lift |
| `PUT /entities/:id` | `updateEntity` | routes.ts:453 | Lift |
| `DELETE /entities/:id` | `deleteEntity` | routes.ts:454 | Lift |
| `POST /relations` | `createRelation` | routes.ts:457 | Lift |
| `GET /relations` | `listRelations` | routes.ts:458 | Lift |
| `DELETE /relations/:key` | `deleteRelation` | routes.ts:459 | Lift |
| `POST /query` | `queryGraph` | routes.ts:462 | Lift |
| `GET /export` | `exportGraph` | routes.ts:465 | Lift |
| `GET /stats` | `getStats` | routes.ts:466 | Lift |
| `POST /cleanup/relations-by-type` | `cleanupRelationsByType` | routes.ts:469 | Lift |
| `POST /cleanup/deduplicate-edges` | `deduplicateEdges` | routes.ts:470 | Lift |
| `POST /cleanup/resolve-entities` | `resolveEntities` (already routes through km-core's `kmCoreResolveEntities`) | routes.ts:471, 998-1040 | km-core call already centralized; the wrapper stays OKM-side (OKM-specific synth + nodeId reshape) at `/api/okm/cleanup/resolve-entities`. Add a thin canonical handler at `/api/v1/cleanup/resolve-entities` that calls km-core directly without the OKM wrapper. |
| `DELETE /cleanup/orphans` | `deleteOrphans` | routes.ts:479 | Lift |
| `GET /graph/connectivity` | `getConnectivityReport` | routes.ts:477 | Lift |
| `GET /graph/orphans` | `getOrphans` | routes.ts:478 | Lift |
| `GET /ontology/classes` | `getOntologyClasses` | routes.ts:482 | Lift; reads `opts.ontologyRegistry` directly |
| `GET /ontology/entity-types` | `getOntologyEntityTypes` | routes.ts:483 | Lift |
| `GET /ontology/schema/:className` | `getOntologySchema` | routes.ts:484 | Lift |
| `GET /clusters` | `handleClusters` | routes.ts:497 | Lift; calls OKM `clusterEntities` (see Open Question 3) |
| `GET /search` | `handleSearch` | routes.ts:496 | Lift (canonical contract benefits from a search endpoint) |
| `POST /snapshots` | NEW (Phase 44) | nil | Uses `SnapshotManager.createSnapshot` |
| `GET /snapshots` | repurpose `listSnapshots` (routes.ts:513); different semantics | routes.ts:513-2155 | Old OKM logic returned commit-hash-per-export-touch; S-4 returns `git tag -l 'snapshot/*'`. Diverges; do NOT lift verbatim; write fresh. |
| `POST /snapshots/:id/restore` | repurpose `restoreSnapshot` (routes.ts:515) | routes.ts:515-2403 | Old OKM logic restored from a commit hash; S-2 restores from a tag. Diverges. Write fresh. |

**OKM-specific (stays at `/api/okm/*`, NOT canonical):**
`GET /cleanup/pii-scan`, `DELETE /cleanup/pii-entities`, `DELETE /purge`, `POST /ingest`, `POST /ingest/batch`, `POST /synthesize`, `GET/PUT /llm/settings`, `GET /llm/metrics`, `GET /llm/history`, `GET /ingest/progress` (SSE), `POST /rca/ingest`, `POST /rca/lookup`, `GET /rca/dirs`, `GET /rca/status`, `GET /source-documents/:runId`, `GET /source-documents`, `GET /api/patterns/trending`, `POST /api/analyze/correlations`, `GET /api/confidence/*`, `GET /api/proxy/raas-job/:uuid`. Approximately 15+ OKM-specific endpoints kept at `/api/okm/*` per C-4.

### Example 3: B's REST Mount Strategy (Same-Port Recommended)

```typescript
// integrations/mcp-server-semantic-analysis/src/sse-server.ts (modified)
// Source: existing file, sse-server.ts:21-170

import express, { Router } from 'express';
import { createKmCoreRouter } from '@fwornle/km-core';
import { GraphKMStore } from '@fwornle/km-core';
// ... existing imports ...

const app = express();
app.use(express.json());

// --- EXISTING SSE / workflow routes (UNCHANGED) ---
app.get('/health', /* ... */);
app.get('/workflow-events', /* ... */);
app.get('/sse', /* ... */);
app.post('/messages', /* ... */);

// --- NEW: km-core canonical REST mount ---
const kmStore = new GraphKMStore({
  dbPath: '/coding/.data/knowledge-graph/leveldb',
  exportDir: '/coding/.data/knowledge-graph/exports',
  ontologyDir: '/coding/.data/ontologies',
  domains: ['coding'],
});
await kmStore.open();

const kmRouter = Router();
createKmCoreRouter(kmStore, kmRouter, {
  ontologyRegistry: kmStore.getOntologyRegistry(),
  snapshotDir: '/coding/.data/knowledge-graph/exports',
});
app.use('/api/v1', kmRouter);

// (no /api/sem/* surface today; none of B's MCP tools have parallel REST needs)

app.listen(PORT, () => {
  log(`Semantic Analysis SSE+REST Server listening on port ${PORT}`, 'info');
});
```

**Rationale for same-port:**
- One fewer port to register in launchd / docker-compose / health-coordinator (`com.coding.semantic-analysis` already manages 3848).
- Smaller diff to plumb out.
- The SSE concerns (long-lived connections) and REST concerns (short request/response) do not fight on the same Express app; both are stateless w.r.t. each other.
- Operationally: `curl http://localhost:3848/api/v1/entities` works alongside `curl http://localhost:3848/health`.

**Tradeoffs:**
- Mixes concerns architecturally; if Phase 45 expects a separate "API service" it would want its own port.
- A bug in REST handlers (e.g., a request that throws and kills the event loop) could take down SSE.

**Recommended port strategy:** same port (3848) for Phase 44. Mark "split to dedicated port" as a deferred Phase 45 candidate if the unified viewer requires explicit per-service URLs.

### Example 4: A's SQLite to km-core Migration Script Skeleton

```javascript
// scripts/migrate-sqlite-to-kmcore.mjs (NEW Phase 44 A-2 deliverable)
// Source: mirrors _work/.../okm/scripts/migrate-okm-json-to-kmcore.mjs (Phase 43 Plan 07)

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

async function resolveOntologyDir() {
  // Lifted verbatim from migrate-okm-json-to-kmcore.mjs:110-130.
  // import.meta.resolve walks up to km-core package root, then ontology subdir.
  const kmCoreEntry = import.meta.resolve('@fwornle/km-core');
  const kmCorePath = fileURLToPath(kmCoreEntry);
  let kmCoreRoot = path.dirname(kmCorePath);
  while (kmCoreRoot !== '/') {
    try { await fsp.access(path.join(kmCoreRoot, 'package.json')); break; }
    catch { kmCoreRoot = path.dirname(kmCoreRoot); }
  }
  return path.join(kmCoreRoot, 'config', 'ontology');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { /* usage */ return; }
  const runId = args.runId ?? `a-mig-${Date.now()}`;

  const db = new Database(args.source, { readonly: true });
  const store = new GraphKMStore({
    dbPath: args.target,
    exportDir: path.join(path.dirname(args.target), 'exports'),
    ontologyDir: await resolveOntologyDir(),
    domains: ['coding'],
  });
  await store.open();

  // Idempotency: build legacyId-seen set from current store state
  const seen = new Set();
  if (args.resume) {
    for await (const e of store.iterate()) {
      if (e.legacyId?.system === 'A') seen.add(e.legacyId.id);
    }
  }

  let migrated = 0, skipped = 0, errors = 0;

  // OBSERVATIONS
  // SQLite schema [VERIFIED]:
  //   id TEXT PK, summary TEXT, messages TEXT, agent TEXT, session_id TEXT,
  //   source_file TEXT, created_at TEXT, metadata TEXT, content_hash TEXT,
  //   quality TEXT, digested_at TEXT
  const obsRows = db.prepare(`
    SELECT id, summary, messages, agent, session_id, source_file,
           created_at, metadata, content_hash, quality, digested_at
    FROM observations
  `).all();

  for (const row of obsRows) {
    if (seen.has(row.id)) { skipped++; continue; }
    const meta = row.metadata ? JSON.parse(row.metadata) : {};
    const entity = {
      id: undefined, // let km-core mint a UUIDv7
      name: row.summary?.slice(0, 80) ?? '(no summary)',
      entityType: 'Observation',
      ontologyClass: 'Observation',  // Pitfall 3: set BOTH
      layer: 'evidence',
      description: row.summary ?? '',
      metadata: {
        ...meta,
        agent: row.agent,
        project: meta.project ?? null,
        session_id: row.session_id,
        source_file: row.source_file,
        content_hash: row.content_hash,
        quality: row.quality,
        digested_at: row.digested_at,
        messages: row.messages,
      },
      legacyId: { system: 'A', id: row.id },
      createdAt: row.created_at,
      updatedAt: row.created_at,
      validFrom: row.created_at,
      validUntil: null,
      createdBy: {
        provider: 'phase-44-migration', model: 'a-sqlite-to-kmcore',
        runId, timestamp: new Date().toISOString(),
      },
    };
    if (!args.dryRun) {
      try { await store.putEntity(entity); migrated++; }
      catch (err) { errors++; process.stderr.write(`obs ${row.id}: ${err.message}\n`); }
    } else { migrated++; }
  }

  // DIGESTS (similar; fields: date, theme, summary, observation_ids, agents, files_touched, project)
  // INSIGHTS (similar; fields: topic, summary, confidence, digest_ids, last_updated, project)
  // ... (same pattern)

  await store.close();
  db.close();

  const summary = { status: errors === 0 ? 'ok' : 'partial', runId,
    totalSourceRows: obsRows.length, migrated, skipped, errors,
    targetDir: args.target };
  process.stdout.write(JSON.stringify(summary) + '\n');
  process.exit(errors > obsRows.length * 0.05 ? 1 : 0);
}

main().catch(err => { process.stderr.write(`fatal: ${err.message}\n`); process.exit(2); });
```

**Edge cases to test:**
- Orphan digest refs: `digests.observation_ids` JSON array may reference observations that do not exist (per `2026-05-23-orphan-digest-observation-refs.md`). Migration skips the relation but stores the digest entity; relation-creation step (separate) logs orphan IDs.
- NULL columns: `agent`, `project`, `session_id` may be NULL; entity stores them as `null` in metadata, does not fail.
- Multi-line content with special chars: `summary` and `messages` are arbitrary text; SQLite TEXT to JSON serialize handles this. Test with an observation containing backticks + newlines.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Three diverged REST surfaces (A: domain-specific, B: none, C: full ~30 endpoints) | One canonical 15-endpoint surface in km-core, mounted by each system | Phase 44 (this phase) | Phase 45 viewer can target any backend identically |
| OKM's own resolve-entities loop | km-core `resolveEntities` maintenance op | Phase 43 D-G2.3 | Single impl; OKM-specific wrap stays at `/api/okm/cleanup/resolve-entities` |
| OKM's commit-touched-exports snapshot model | Git-tag-based snapshot IDs | Phase 44 S-4 | Operator can `git tag -l 'snapshot/*'`; no parallel index |
| Express 4 everywhere | Mixed 4/5 (A=4.21, B=4.21, C=5.2) | Phase 43 OKM upgrade | km-core stays Express-free (consumer passes Router) |
| Zod schemas only in OKM tests | Zod schemas exported from km-core | Phase 44 C-2 | Consumers import; tests equal compliance proofs |

**Deprecated/outdated:**
- `lib/km-core/dist/api/router.js` (orphan draft with no src/): replace by writing fresh `src/api/router.ts` aligned to C-1.
- `lib/km-core/dist/snapshots/SnapshotManager.js` (orphan draft): replace by writing fresh `src/snapshots/SnapshotManager.ts` matching S-1..S-4 semantics (git-tag-based, not bare-commit-based).
- `/api/km/` mount in `scripts/observations-api-server.mjs:1185`; left over from the aborted Phase 44 attempt. Remove during cutover; replace with `/api/v1/`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Zod 3.25.x is the right pin (not 4.x) | Standard Stack | LOW; only a major-bump cost if 4.x picked later. OKM already on 3.x. |
| A2 | A's dashboard never reads `metadata.subsystem` or other newly-added km-core fields | Pitfall 2 | MEDIUM; if it does, Pitfall 2 widens. Mitigated by Playwright smoke test in verification. |
| A3 | The orphan `lib/km-core/dist/api/router.js` was indeed from an aborted Phase 44 attempt (not active live code) | Architecture Patterns | LOW; verified by `grep createKMRouter` showing only A's `scripts/observations-api-server.mjs:1186` uses it, no other consumers. Removing it is safe. |
| A4 | km-core can `import 'zod'` without breaking the existing build (no peerDep conflict with consumer Zod versions) | Standard Stack | LOW; Zod is bundled as a regular dep, not peerDep; consumers can have their own version side-by-side. |
| A5 | OKM `clusterEntities` (Louvain) can be lifted into km-core verbatim | C-3 / Open Question 3 | MEDIUM; if it depends on OKM-specific types or imports, lifting requires refactoring. May warrant making OKM the dep direction-flipper (km-core depends on a graphology Louvain wrapper directly, not on OKM). |
| A6 | `process.exit(0)` after restore is acceptable for launchd-managed services (relies on respawn) | Pitfall 4 | MEDIUM; abrupt termination may cut SSE streams. Prefer `restartRequired: true` signal to caller. |
| A7 | The OKB-baseline-guard hooks across both repos can be updated with identical 4-line `OKB_SNAPSHOT=1` diffs | Pitfall 1 / S-3 | LOW; OKM hook already has the pattern, coding-side hook needs it added. |
| A8 | A's typed-view performance (804 obs iterate-all) will not degrade dashboard load time | Pattern 3 | LOW; SQLite handler does about the same; LevelDB iterate is similarly fast for this size. Confirm in verification. |

## Open Questions

1. **Express peerDep vs framework-agnostic; which wins?**
   - What we know: CONTEXT R-2 says "Express as peerDependency in km-core." But Express 4 vs 5 splits A/B (4.21) from C (5.2). The existing dist/ draft uses framework-agnostic route descriptors.
   - What is unclear: is R-2 a hard lock or an early-stage assumption? The framework-agnostic pattern provides the same DX with less coupling.
   - Recommendation: plan for framework-agnostic (Pattern 1). If the user explicitly wants `peerDependencies: { "express": "^4 || ^5" }`, that ALSO works; just add Express to peerDeps but do not `import` it in km-core source. Either way the source code looks identical.

2. **`/api/v1/snapshots/:id/restore`; sync restart or async signal?**
   - What we know: handler must trigger a server restart for the restored JSONs to take effect.
   - What is unclear: does the user want the handler to block on restart, return immediately, or signal the caller?
   - Recommendation: return immediately with `restartRequired: true`. Operator decides when to restart. For A's launchd-managed obs-api, a simple `launchctl kickstart -k gui/$(id -u) com.coding.obs-api` is documented in CLAUDE.md and works.

3. **`/api/v1/clusters`; lift OKM Louvain into km-core, or have km-core re-import from OKM?**
   - What we know: OKM `src/intelligence/clustering.ts` is the proven implementation; Phase 43 fixtures lock its output.
   - What is unclear: lifting it requires understanding its OKM-specific dependencies (`graphology-communities-louvain` direct usage? OKM types?). The dependency direction matters; km-core should NOT depend on OKM.
   - Recommendation: lift the pure function into km-core, dropping any OKM-specific types. Verify by reading `clustering.ts` line-by-line before plan execution.

4. **A-3 SQLite table-drop timing; pre-cutover or post-verification?**
   - What we know: A-3 drops `observations`, `digests`, `insights` tables after A-2 migration.
   - What is unclear: if verification fails mid-cutover, can we roll back? Once tables are dropped, only the migrated km-core entities remain.
   - Recommendation: drop in a separate plan after fixtures + dashboard smoke pass. Keep a `.observations/observations.db.backup-pre-phase-44` copy for safety; document the rollback procedure (restore the backup + restart A's obs-api with a `USE_SQLITE_LEGACY=1` env flag).

5. **B's `/api/v1` mount; gate behind store-ready?**
   - What we know: A's existing pattern (line 1178-1183 of `observations-api-server.mjs`) uses a middleware gate that returns 503 if `_kmStoreReady === false`.
   - What is unclear: does B's `kmStore.open()` complete fast enough that the gate is unnecessary?
   - Recommendation: use the same gate pattern as A for symmetry; cost is minimal, prevents request races during cold boot.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All three systems | yes | 22.x (per STACK.md; docker container is node:22-bookworm) | nil |
| `git` binary | SnapshotManager (S-1..S-4) | yes (host) yes (coding-services container per Dockerfile) | system git | None; required. Document in plan. |
| `npm` | km-core build + tarball repack | yes | nil | nil |
| `better-sqlite3` | A's migration script | yes (already in coding root for `ObservationWriter`) | nil | nil |
| `@fwornle/km-core` | All systems consume it | yes A via deep `lib/km-core/dist/...`, yes B via path, yes C via vendored .tgz | 0.1.0 | nil |
| `zod` | km-core (new) + OKM (existing) | yes in OKM | ^3.25.76 | nil |
| `express` | A 4.21, B 4.21, C 5.2 | yes all three | various | nil |
| Docker | B's container rebuild | yes | per CLAUDE.md | nil |
| `launchctl` | Coding-host service restart (post-restore Pitfall 4 mitigation) | yes (macOS) | nil | systemd on Linux deployments |
| `OKB_SNAPSHOT` env-var bypass in coding pre-commit hook | S-3 implementation | NO (only OKM hook has it) | nil | Add it (4-line diff) (see Pitfall 1) |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** `OKB_SNAPSHOT` env-var support in coding-side hook; add it during the S-3 plan.

## Validation Architecture

> `workflow.nyquist_validation` is NOT set in `.planning/config.json` (only `research`, `plan_check`, `verifier` are listed under `workflow`). Treating as enabled (default).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 (km-core, OKM) + Jest 29.7 (coding root) |
| Config file | `lib/km-core/vitest.config.ts`, `_work/.../okm/vitest.config.ts`, `package.json` jest config (coding) |
| Quick run command (km-core) | `cd lib/km-core && npx vitest run tests/integration/api-router.test.ts -t '<name>'` |
| Quick run command (OKM) | `cd _work/.../okm && npx vitest run tests/integration/rest-contract.test.ts -t '<name>'` |
| Full suite (km-core) | `cd lib/km-core && npm test` |
| Full suite (OKM) | `cd _work/.../okm && npm test` |
| Full suite (coding) | `cd /Users/Q284340/Agentic/coding && npm test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| API-01 | Common REST contract returns shape-identical responses on A, B, C | integration (fixtures-diff) | `cd _work/.../okm && npx vitest run tests/integration/rest-contract.test.ts` (regenerated under `/api/v1/`) | yes; needs URL rewrite |
| API-01 | km-core router factory mounts on Express-like router and serves all 15 endpoints | unit | `cd lib/km-core && npx vitest run tests/integration/api-router.test.ts` | no; Wave 0 |
| API-01 | Zod schemas in km-core parse OKM fixtures byte-for-byte | unit | `cd lib/km-core && npx vitest run tests/unit/contracts.test.ts` | no; Wave 0 |
| API-01 | A's typed views return legacy-shaped observations from km-core entities | integration | `cd /Users/Q284340/Agentic/coding && npm test -- typed-views.test.js` | no; Wave 0 |
| API-01 (SC-3) | Dashboard renders observations correctly after A-2 migration | manual + Playwright smoke | `gsd-browser navigate http://localhost:3032 && screenshot` | manual; wrap in Playwright spec under `tests/e2e/dashboard-observations.spec.ts`; no; Wave 0 |
| API-02 | Snapshot creation produces `chore(snapshot): <label>` commit + tag | integration (km-core) | `cd lib/km-core && npx vitest run tests/integration/snapshot-roundtrip.test.ts` | no; Wave 0 |
| API-02 | Snapshot restore produces graph matching pre-mutation state | integration (km-core round-trip) | same file as above | no; Wave 0 |
| API-02 | OKB-baseline guard allows snapshot commits with `OKB_SNAPSHOT=1` | shell test | `bash tests/integration/okb-guard-snapshot-bypass.sh` | no; Wave 0 |
| API-02 | Cross-system parity: same request body returns same JSON on A, B, C | integration | `node tests/integration/cross-system-parity.mjs` (drives `supertest` against all three) | no; Wave 0 |

### Sampling Rate
- Per task commit: the touched test file (`npx vitest run <file>`); under 30s for unit tests, ~60s for integration.
- Per wave merge: km-core full suite (`cd lib/km-core && npm test`) + the touching system's suite.
- Phase gate: all three systems' full suites green + cross-system parity test + dashboard Playwright smoke.

### Wave 0 Gaps
- [ ] `lib/km-core/tests/integration/api-router.test.ts`; verifies `createKmCoreRouter` mounts 15 endpoints; supertest-driven.
- [ ] `lib/km-core/tests/unit/contracts.test.ts`; Zod schemas accept-good + reject-bad payloads.
- [ ] `lib/km-core/tests/integration/snapshot-roundtrip.test.ts`; create then mutate then restore then assert equal.
- [ ] `lib/km-core/tests/integration/observation-view.test.ts`; `observationToLegacy` round-trip.
- [ ] `tests/integration/cross-system-parity.mjs`; drives all three running services with supertest, normalizes timestamps/IDs, diff JSON.
- [ ] `tests/integration/typed-views.test.js` (coding side); A's `/api/coding/observations` shape lock.
- [ ] `tests/e2e/dashboard-observations.spec.ts` (Playwright); dashboard smoke.
- [ ] `tests/integration/okb-guard-snapshot-bypass.sh`; bash test for hook bypass.
- [ ] OKM `tests/integration/rest-contract.test.ts`; patch request URLs `/api/` to `/api/v1/`; re-import Zod schemas from `@fwornle/km-core/api/contracts`.
- [ ] OKM `scripts/record-rest-fixtures.mjs`; patch `ENDPOINTS` array URLs to `/api/v1/`.

## Security Domain

`.planning/config.json` does not set `security_enforcement`. Treating as enabled per protocol default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | NO | Internal-only stance preserved per CONTEXT out-of-scope ("Auth/AuthN; current internal-only stance preserved") |
| V3 Session Management | NO | Stateless REST; no sessions |
| V4 Access Control | NO | Internal-only |
| V5 Input Validation | YES | Zod schemas in `km-core/src/api/contracts.ts` validate every request body + query param. Critical for path parameters. |
| V6 Cryptography | NO | No new crypto introduced |
| V7 Error Handling | YES | Handlers must NOT leak stack traces in production responses; use `{ success: false, error: <safe-message> }` |
| V8 Data Protection | YES (light) | Snapshot tags are public-readable; do not include secrets in `label`. |
| V10 Malicious Code | YES | `execSync('git ...')` with user input MUST shell-escape. SnapshotManager uses `JSON.stringify()` on tag names; adequate for the limited input surface but reviewer should confirm. |
| V12 File and Resources | YES | `restoreSnapshot(id)` accepts an id from the URL; validate format strictly (must match `/^snapshot\/[a-zA-Z0-9._-]+-\d{4}-\d{2}-\d{2}T[\d.-]+Z?$/`). OKM does this for commit hashes via `/^[0-9a-f]{7,40}$/` at routes.ts:2229. |
| V13 API and Web Services | YES | All responses use `{ success, data }` envelope (consistent error model). CORS is already configured in all three Express apps. |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via snapshot ID | Tampering | Validate `id` against tag regex before passing to `execGit`; reject `..`, `/`, leading `-` |
| Command injection via snapshot label | Tampering | `JSON.stringify(label)` quotes shell-special chars; combined with `--allow-empty` ensures git treats whole thing as message text |
| DoS via `iterate()` on large graph | Denial of Service | Default LIMIT on `/entities` (existing OKM handler has it); paginated list response |
| Information disclosure in error responses | Information Disclosure | Return `{ success: false, error: <message> }`; NEVER include stack traces |
| Race condition: snapshot mid-write to `.data/exports/` | Tampering | `await store.exportJson()` BEFORE snapshot, NOT during. Locks via the exporter's debounced flush. Document the order. |
| Restoring a malicious snapshot from an attacker who can push tags | Spoofing | Out of scope: internal-only network. If externalized later, sign tags + verify. |

## Sources

### Primary (HIGH confidence)
- `lib/km-core/src/store/GraphKMStore.ts`; store API surface [VERIFIED via direct read]
- `lib/km-core/src/index.ts`; current barrel exports [VERIFIED]
- `lib/km-core/package.json`; exports map + dep tree [VERIFIED]
- `lib/km-core/dist/api/router.js` and `dist/api/router.d.ts`; orphan Phase 44 draft (prior-art reference) [VERIFIED]
- `lib/km-core/dist/snapshots/SnapshotManager.js`; orphan SnapshotManager draft (prior-art reference) [VERIFIED]
- `_work/.../okm/src/api/routes.ts`; 30+ OKM route handlers + git-snapshot impl at lines 2076-2403 [VERIFIED]
- `_work/.../okm/src/api/server.ts`; `createServer()` Express app construction [VERIFIED]
- `_work/.../okm/tests/integration/rest-contract.test.ts`; existing Zod schemas at lines 94-167 [VERIFIED]
- `_work/.../okm/scripts/migrate-okm-json-to-kmcore.mjs`; Phase 43 migration script template [VERIFIED]
- `_work/.../okm/scripts/record-rest-fixtures.mjs`; fixture recorder pattern [VERIFIED]
- `_work/.../okm/scripts/pre-commit-hook.sh`; OKB hook with `OKB_SNAPSHOT=1` bypass [VERIFIED]
- `_work/.../okm/viewer/src/api/okbClient.ts`; VOKB API URL constants (all in one file) [VERIFIED]
- `scripts/observations-api-server.mjs`; A's HTTP gateway + existing `/api/km/` mount attempt [VERIFIED]
- `scripts/hooks/pre-commit-okb-guard.sh` and `.git/hooks/pre-commit`; coding-side hook [VERIFIED]
- `integrations/mcp-server-semantic-analysis/src/sse-server.ts`; B's Express+SSE server [VERIFIED]
- `.observations/observations.db`; actual SQLite schema for observations/digests/insights [VERIFIED via sqlite3]
- `.planning/phases/{37,41,42,43}/*-CONTEXT.md`; carry-forward decisions [VERIFIED]
- Context7 `/expressjs/express`; Router factory pattern, v5 changes [CITED]
- Context7 `/colinhacks/zod`; `z.infer<>`, subpath exports [CITED]

### Secondary (MEDIUM confidence)
- npm registry version data for express/zod/cors/supertest (popularity numbers approximate; confirm exact at plan time via `npm view`).
- WebSearch for Express 5 release info [CITED: expressjs.com/2024/10/15/v5-release.html]; confirms 5.x stable since Oct 2024.

### Tertiary (LOW confidence)
- A8 assumption that 804-row iterate is fast enough; based on B's known LevelDB perf, not measured for A specifically. Mitigate by adding a perf assertion in the typed-view test (response under 200ms).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH; all libraries already present in the codebase; versions verified via grep.
- Architecture (createKmCoreRouter factory + SnapshotManager + Zod contracts): HIGH; pattern proven in the orphan draft + OKM's working impl; only need to write fresh TS source.
- Pitfalls: HIGH for Pitfalls 1-3 (verified hooks + schema split + iterate semantics); MEDIUM for Pitfall 4 (restore restart is genuinely an open coordination question).
- Migration mechanics: HIGH; Phase 43 template is well-documented and tested.
- B's mount strategy: MEDIUM; recommended same-port but tradeoffs are real; planner should confirm with user before locking.

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (30 days; stable internal codebase, no fast-moving deps)
