# Phase 44 — PLAN

## Wave 1 (parallel)
### Plan 01 — km-core: Common REST Router Factory
Add `createKMRouter(store: GraphKMStore, opts?)` to km-core that returns an Express Router
with these endpoints:
- `GET/POST /entities`, `GET/PUT/DELETE /entities/:id`
- `GET/POST /relations`, `DELETE /relations/:key`
- `POST /query` (filter/sort/paginate)
- `GET /search?q=` (full-text across name+description)
- `GET /clusters` (ontology-class grouping with counts)
- `GET /ontology/classes`, `GET /ontology/entity-types`, `GET /ontology/schema/:className`
- `GET /export`, `GET /stats`
- `GET /snapshots`, `GET /snapshots/:hash`, `POST /snapshots` (create), `POST /restore`
- `GET /health`

Files: `lib/km-core/src/api/router.ts`, `lib/km-core/src/api/handlers.ts`,
`lib/km-core/src/snapshots/SnapshotManager.ts`

### Plan 02 — km-core: SnapshotManager
Extract C's snapshot logic into `SnapshotManager`:
- `createSnapshot(exportDir, message?)` → git add + commit → returns `{hash, message, date}`
- `listSnapshots(exportDir)` → git log on export dir
- `restoreSnapshot(exportDir, hash)` → git checkout files
- `diffSnapshot(exportDir, hash)` → git diff --stat

Files: `lib/km-core/src/snapshots/SnapshotManager.ts`

## Wave 2 (parallel — depends on Wave 1)
### Plan 03 — System C: Replace OKM routes with common router
Mount `createKMRouter(adapter.store)` at `/api/` in OKM server. Remove duplicated
entity/relation/search/ontology/snapshot handlers from `routes.ts`. Keep domain-specific
routes (cleanup, RCA, ingest, PII, source-docs, confidence, LLM settings) intact.

### Plan 04 — System A: Mount common router + backward-compat aliases
Mount `createKMRouter(store)` in observations-api-server. Add backward-compat aliases:
- `GET /api/observations` → `/api/entities?ontologyClass=RawObservation`
- `GET /api/digests` → `/api/entities?ontologyClass=Digest`
- `GET /api/insights` → `/api/entities?ontologyClass=Insight`

### Plan 05 — System B: Add REST endpoint to Docker service
Mount `createKMRouter(store)` in the semantic-analysis MCP server (or a sidecar Express
app inside the container). Expose on port 3849 (alongside SSE on 3848).

## Wave 3 (depends on Wave 2)
### Plan 06 — Integration tests + .tgz rebuild + CI verification
- km-core unit tests for router + SnapshotManager
- Rebuild `fwornle-km-core-0.1.0.tgz`
- `npm test` in rapid-automations (System C)
- Verify System A backward-compat aliases
- Verify System B REST endpoints from host

## Verification
- [ ] All three systems respond to `GET /api/entities` with valid JSON
- [ ] `POST /api/snapshots` creates a git commit in each system's export dir
- [ ] System A `/api/observations` still returns observations (backward compat)
- [ ] rapid-automations CI stays green
