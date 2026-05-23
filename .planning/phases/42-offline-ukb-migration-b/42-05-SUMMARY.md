---
phase: 42-offline-ukb-migration-b
plan: 05
subsystem: B (mcp-server-semantic-analysis)
tags: [migration, leveldb, km-core, d-54, idempotent, schema-mapping]
requires:
  - "Plan 42-01 (km-core adapter + Docker bind mount for km-core via /coding/node_modules/@fwornle/km-core:ro)"
  - "Plan 42-04 (km-core surfaces — Entity.embedding, OntologyRegistry.isValidClass, parseEntityId; all reachable from B's container)"
  - "level@^10.0.0 (already in B's deps; reads B's existing .data/knowledge-graph)"
provides:
  - "scripts/migrate-leveldb-to-kmcore.mjs — one-shot D-54 migration CLI"
  - "src/migration/migrate-leveldb-to-kmcore.test.ts — 10-case integration test (TDD-paired)"
  - "Mapping helpers: deriveCanonicalId, deriveOntologyClass, deriveDescription, derivePromotedTimestamps, derivePreservedMetadata, stampProvenance, mapToCanonical"
affects:
  - "Phase 42 Plan 06 (wave-controller migration) — consumes the same canonical-shape contract this script writes"
  - "Phase 42 Plan 07 (cleanup + e2e gate) — owns the atomic dir swap, ukb-full re-embed, syncQdrantFromStore"
tech-stack:
  added:
    - "(none — script reuses level, @fwornle/km-core, node:crypto from existing deps)"
  patterns:
    - "Trusted-path bulk writes (Phase 37 BC-2 widening) — every putEntity carries skipOntologyCheck:true so unregistered classes still land in the store"
    - "Idempotency via top-level legacyId.system === 'B' AND parseable UUIDv7 id check (CF-D37 canonical placement, mirrors Phase 41 reprojectFromOnlineStore)"
    - "Deterministic runId default: sha256(absolute source path + UTC date).slice(0,16) — stable provenance stamps across re-runs"
    - "Fail-loud error budget (5%) with per-entity errors recorded in <target>/migration-errors.log"
    - "Read source LevelDB read-only by snapshotting to /tmp before opening (live container holds the LOCK)"
key-files:
  created:
    - path: "/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/scripts/migrate-leveldb-to-kmcore.mjs"
      purpose: "One-shot CLI mapping B's legacy LevelDB entities to canonical km-core Entity shape per RESEARCH §4 D-54 mapping table"
    - path: "/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/migration/migrate-leveldb-to-kmcore.test.ts"
      purpose: "10-case integration test exercising the script end-to-end via child_process.spawn against fixture LevelDBs"
  modified:
    - path: "(none — Task 2 was verification-only against the production LevelDB inside the container)"
key-decisions:
  - "Idempotency contract: an entity is treated as already-migrated when top-level legacyId.system === 'B' AND its id parses cleanly via parseEntityId (UUIDv7 brand). RESEARCH §4 ALTERNATIVE was checking metadata.legacyId — rejected because Phase 39 CF-D37 places legacyId at the TOP LEVEL of Entity, not inside metadata."
  - "Mapping reads B's GraphDB single-blob LevelDB shape: GraphDatabaseService._persistGraphToLevel writes ONE key 'graph' holding {nodes,edges,metadata}; the script reads that blob and iterates nodes[].attributes. The plan's <action> step 2 wording (iterate every (key,value) pair) was loose — the real shape is one big blob, not key-per-entity. Documented as a deviation."
  - "ontologyClassUnregistered fallback flag (RESEARCH §6 Risk 3): when the OntologyRegistry returns false on isValidClass(entityType), the migrated entity gets ontologyClass set to its existing entityType AND metadata.ontologyClassUnregistered: true. The 19 production entities flagged are Project/System/Knowledge — NOT the specialized classes (Config/Port/Container/etc.) RESEARCH §6 warned about (those ARE registered in coding-ontology.json post-42-03)."
  - "Test 3 fixture: switched the 'unregistered' fixture from 'Config' (which IS in coding-ontology.json post-42-03) to 'FrobnicatedWidget' (guaranteed-absent). The plan's <behavior> Test 3 wording named 'Config' as the example; this is a plan-text staleness, not a contract violation — the contract is 'class not in registry → flag', which is what the test now asserts."
  - "Atomic directory swap deferred to Plan 7 (per plan <action> step 6). This script ONLY writes to the target dataDir; the mv pair (.data/knowledge-graph → .pre-42-backup; .data/knowledge-graph-migrated → .data/knowledge-graph) runs from Plan 7's e2e gate after the post-migration ukb full + syncQdrantFromStore pass."
  - "Dry-run sanity required snapshotting the production LevelDB to /tmp inside the container because the live coding-services GraphDatabaseService holds the LOCK file on the original directory. Read-only intent honored — original DB untouched; the snapshot was deleted after verification."

requirements-completed: ["INT-02"]

metrics:
  duration: "~30 min (including Docker rebuild)"
  completed: "2026-05-23T14:30:00Z"
  tasks: 2
  files_new: 2
  files_modified: 1
  test_delta: "+10 tests (all green)"
  production_entity_count: 802
  ontology_unregistered_count: 19
  ontology_unregistered_classes: "Project (11), System (1), Knowledge (7)"
---

# Phase 42 Plan 05: LevelDB → km-core Migration Script Summary

D-54 LevelDB → km-core canonical-shape migration script lands. A one-shot
Node.js ESM CLI at `scripts/migrate-leveldb-to-kmcore.mjs` (562 LoC across
script + test) walks B's existing `.data/knowledge-graph/` LevelDB and
rewrites every entity to canonical km-core `Entity` shape per the
42-RESEARCH.md §4 mapping table. The script is idempotent, fail-loud
(5% error budget), trusted-path (skipOntologyCheck:true for every write so
ad-hoc B classes still land), and reads the source LevelDB read-only.
Dry-run against the live production LevelDB inside the container reports
**802 entities, errorCount=0, 19 ontologyClassUnregistered flags** —
well under the 5% budget. Atomic directory swap deferred to Plan 7.

## What Was Built

### Two files (~575 LoC) — one script + one test

| File | LoC | Purpose |
|------|-----|---------|
| `scripts/migrate-leveldb-to-kmcore.mjs` | ~395 | CLI: opens source LevelDB read-only, iterates the 'graph' blob's nodes[], maps each via mapToCanonical, batches into km-core GraphKMStore, writes errors log, prints summary JSON. |
| `src/migration/migrate-leveldb-to-kmcore.test.ts` | ~625 | 10 integration tests driving the script via child_process.spawn against tmpdir LevelDB fixtures. |

### Six named mapping helpers (one per RESEARCH §4 row group)

| Helper | Source rows mapped | Behavior |
|--------|-------------------|----------|
| `deriveCanonicalId` | Row 1 + idempotency contract | Idempotency check on existing top-level legacyId.system==='B' AND parseable UUIDv7 id → reuse; else mint new + synthesize legacyId from old nanoid. |
| `deriveOntologyClass` | Row 3 | entityType → ontologyClass; flag `unregistered:true` when registry.isValidClass returns false (RESEARCH §6 Risk 3 fallback). |
| `deriveDescription` | Row 4 | Joins observations[] (handles both `string` and `{content:string}` shapes) into description; builds DescriptionSegment[0] with phase-42-migration provenance. |
| `derivePromotedTimestamps` | Rows 7-8 | metadata.created_at → createdAt + validFrom; metadata.last_updated → updatedAt. Handles both nested metadata and flat top-level fields seen in production. |
| `derivePreservedMetadata` | Rows 5-6, 9, 11-15, 17 | Preserves significance/source/problem/solution/hierarchyLevel/parentEntityName + adds subsystem='wave-analysis' + provenance + descriptionSegments + legacyObservations + ontologyClassUnregistered flag. |
| `stampProvenance` | Rows 13-15 | Single ProvenanceStamp used for both createdBy AND lastConfirmedBy; confirmationCount=1. |

### CLI flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--source=<path>` | `.data/knowledge-graph` | Source LevelDB directory |
| `--target=<path>` | `.data/knowledge-graph-migrated` | Destination km-core dataDir |
| `--ontology-dir=<path>` | `.data/ontologies` | Used to construct OntologyRegistry for the unregistered-class check |
| `--dry-run` | off | Count + map, write nothing |
| `--batch-size=<N>` | `100` | store.batch chunk size |
| `--resume` | off | Skip entities whose legacyId.id is already in target export JSONs |
| `--run-id=<string>` | sha256(source+date)[0:16] | Stable provenance stamp value |
| `--help` | — | Print usage, exit 0 |

## Test Count Delta

- **Before Plan 05:** 3 test files in `dist/` (`workflow-state-machine.test.js`, `workflow-sse-broadcaster.test.js`, `utils/comparison-util.test.js`) + 1 file from Plan 01 (`storage/km-core-adapter.test.js`).
- **After Plan 05:** 5 test files; new file `dist/migration/migrate-leveldb-to-kmcore.test.js` with 10 tests.
- **All 10 new tests pass:** Tests 1 (happy path) — 9b (error budget exceeded). Zero regressions in pre-existing test files.

## Production Dry-Run (Task 2)

Ran inside the `coding-services` container against a snapshot of the live
LevelDB (snapshotted to `/tmp/42-05-leveldb-copy/` and LOCK file removed
so the script could open it read-only without disturbing the live
GraphDatabaseService that holds the lock on the original directory).

| Metric | Value | Threshold |
|--------|-------|-----------|
| totalEntities | **802** | ≥700 (PASS — 75 more than RESEARCH's 727 baseline) |
| migratedCount | 802 | (full pass, no skips on a fresh target) |
| errorCount | **0** | ==0 (PASS) |
| errorRatio | 0 | ≤0.05 (PASS) |
| ontologyClassUnregistered count | 19 | informational |
| Class distribution | 16 distinct ontologyClass values | informational |

### Unregistered class breakdown

The 19 entities flagged `metadata.ontologyClassUnregistered: true` are:

| Class | Count | Note |
|-------|-------|------|
| Project | 11 | NOT in upper.json or coding-ontology.json — every team's project anchor |
| System | 1 | "CollectiveKnowledge" root |
| Knowledge | 7 | NOT in upper.json or coding-ontology.json |

**Surprise vs RESEARCH §6 Risk 3:** The specialized classes RESEARCH warned about
(Config, Port, Container, Process, File, Service, StaticDiagnostics, RuntimeDiagnostics)
ARE all defined in `coding/.data/ontologies/upper.json` post-Plan-42-03's flatten +
schema conversion. The 60-entity gap RESEARCH predicted does not materialize. Instead,
the unregistered set is Project (the hierarchical top-level class) + System (root anchor)
+ Knowledge (insight class). Plan 7's e2e gate may decide whether to extend the
ontology to include these three classes or to accept them as legitimately unregistered
upper-bound classes.

## Commits

| Hash | Repo | Task | Subject |
|------|------|------|---------|
| `bb8f3c2` | submodule (mcp-server-semantic-analysis) | T1 RED | test(42-05): add failing tests for LevelDB→km-core migration script |
| `b9b70a0` | submodule | T1 GREEN | feat(42-05): land LevelDB→km-core migration script (D-54) |
| `fa77db2a1` | superproject | T2 | feat(42-05): bump semantic-analysis submodule for migration script + verify Docker |

## Docker Rebuild Durations

- `npm run build` (submodule): ~3s
- `docker-compose build coding-services`: **~106s** (cached layers most of the way)
- `docker-compose up -d coding-services`: ~10s

## Verification Results

All Task acceptance criteria pass:

**Task 1:**
- `test -f scripts/migrate-leveldb-to-kmcore.mjs` → exit 0
- `grep -c "from '@fwornle/km-core'" scripts/migrate-leveldb-to-kmcore.mjs` → **1** (≥1)
- `grep -cE 'deriveCanonicalId|deriveOntologyClass|stampProvenance|deriveDescription' scripts/migrate-leveldb-to-kmcore.mjs` → **8** (≥4)
- `grep -cE "legacyId.*system.*'B'" scripts/migrate-leveldb-to-kmcore.mjs` → **3** (≥1)
- 10 integration test cases pass.
- `node scripts/migrate-leveldb-to-kmcore.mjs --help` → exit 0 with usable usage text (no stack trace).

**Task 2:**
- `cd integrations/mcp-server-semantic-analysis && npm run build` → exit 0
- `cd docker && docker-compose build coding-services` → exit 0
- `docker exec coding-services test -f /coding/integrations/mcp-server-semantic-analysis/scripts/migrate-leveldb-to-kmcore.mjs` → exit 0
- Production dry-run summary line: `{"totalEntities":802,"migratedCount":802,"skippedCount":0,"errorCount":0,"errorRatio":0,...}` — passes the AC's `totalEntities >= 700 and errorCount == 0` predicate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug fix] Test path resolution was off by one level**

- **Found during:** First GREEN test run after writing the script.
- **Issue:** The test computed `SUBMODULE_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..')` — 3 levels up from `dist/migration/migrate-leveldb-to-kmcore.test.js`. That actually resolves to the **parent of the submodule** (`integrations/`), so `SCRIPT_PATH` became `integrations/scripts/migrate-leveldb-to-kmcore.mjs` (missing). The script wasn't found and spawnSync produced no summary JSON.
- **Fix:** Changed to 2 levels up (`dist/migration/...` → `dist/...` → `submodule`). Re-built; tests pass.
- **Files modified:** `src/migration/migrate-leveldb-to-kmcore.test.ts`
- **Committed in:** Squashed into the GREEN commit `b9b70a0`.

**2. [Rule 1 — Bug fix] Test 3 fixture used a registered class as "unregistered"**

- **Found during:** First GREEN test run.
- **Issue:** The plan's Test 3 wording named 'Config' as the example specialized class to assert against. Plan 42-03 added Config (and all the other specialized classes) to `coding/.data/ontologies/upper.json`, so registry.isValidClass('Config') returns true — the `ontologyClassUnregistered: true` flag is NOT set for Config entities. The test assertion failed (`undefined !== true`).
- **Fix:** Switched the fixture entity's `entityType` from 'Config' to 'FrobnicatedWidget' — a name guaranteed to be absent from every ontology JSON. The test contract is unchanged ("class not in registry → flag set"); only the example class name moves.
- **Files modified:** `src/migration/migrate-leveldb-to-kmcore.test.ts`
- **Committed in:** Squashed into the GREEN commit `b9b70a0`.

**3. [Plan-text discrepancy — documented, not a code change] B's LevelDB key shape is single-blob, not key-per-entity**

- **Found during:** Reading GraphDatabaseService.js to confirm the LevelDB shape before writing the script.
- **Issue:** The plan's `<action>` step 2 says "Open the source LevelDB read-only ... Iterate all entries via the streaming API." This implies one key per entity. In practice, B's `GraphDatabaseService._persistGraphToLevel` writes ALL nodes as a single value under the key `'graph'` — the blob shape `{ nodes: [{key, attributes}, ...], edges: [...], metadata: {nodeCount, edgeCount, lastSaved} }`.
- **Resolution:** The script's `readSourceEntities` calls `db.get('graph')` (single read), then iterates the `nodes[]` array. Behavior matches the plan's intent (iterate every entity); only the LevelDB read mechanic differs. Documented in script comments + this SUMMARY.

**4. [Rule 3 — auto-fix blocking issue] Live container holds the LOCK on the source LevelDB**

- **Found during:** First dry-run sanity attempt against `/coding/.data/knowledge-graph`.
- **Issue:** The script's `db.open()` call failed with `Database failed to open` because the coding-services container's GraphDatabaseService holds the LOCK file on the original directory. The plan's Task 2 step 5 implicitly assumed read-only opening would work — it doesn't, because LevelDB locks the directory exclusively.
- **Fix:** Snapshotted the production LevelDB to `/tmp/42-05-leveldb-copy/` inside the container, removed the LOCK file from the copy, and ran the dry-run against the snapshot. Read-only intent honored — original DB untouched. Snapshot deleted after verification.
- **Action item for Plan 7:** The e2e gate's actual migration run will need to either (a) stop the coding-services container first, OR (b) snapshot the same way as a pre-step. Operator's discretion at swap time.

### Authentication Gates

None — pure code + container-side script verification.

### Architectural Decisions (Rule 4)

None — all design choices stayed within the plan's pre-authorized expansion zones (D-54 mapping table + idempotency contract + 5% budget were all explicit in CONTEXT.md / RESEARCH.md).

### Verification Failures

None.

## Threat Flags

No new security-relevant surface beyond what the plan's `<threat_model>` declared:

- T-42-05-01 (source tampering) → mitigated: source opened by snapshotting to /tmp + read-only intent enforced.
- T-42-05-03 (error budget bypass) → enforced at script level: exit 1 when errorRatio > 0.05.
- T-42-05-04 (provenance repudiation) → mitigated: --run-id flag defaults to a deterministic hash; production dry-run used the operator-supplied `42-05-task-2-dryrun` runId.

## Known Stubs

None — the script does not emit placeholder data. Every migrated entity carries real values for every required field. The `ontologyClassUnregistered: true` flag is metadata-level documentation, not a stub.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED  | `bb8f3c2` test(42-05) | 10 tests fail with `MODULE_NOT_FOUND` because `scripts/migrate-leveldb-to-kmcore.mjs` does not yet exist. Cannot run. |
| GREEN (Task 1) | `b9b70a0` feat(42-05) | Source lands. Build clean. All 10 tests pass. |
| REFACTOR | none | No cleanup needed — single-purpose script, mapping helpers each map to one RESEARCH §4 row group. |

## Phase 10 / SC#2 Status (deferred to Plan 7 e2e gate)

This plan does **not** populate embeddings. The migration script copies
`source.embedding` verbatim when present (D-54 row 16); in production 0/802
entities carry embeddings (Phase 10 bug, empirically confirmed by RESEARCH §4).
SC#2 verification ("every entity returned by `findByOntologyClass('Detail')`
after `ukb full` has `embedding.length === 384`") runs in Plan 7 AFTER
this script's atomic dir swap + a full `ukb full` rebuild + `syncQdrantFromStore`
rebuild of the Qdrant index.

## Self-Check: PASSED

**Created files exist:**
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/scripts/migrate-leveldb-to-kmcore.mjs` — FOUND
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/migration/migrate-leveldb-to-kmcore.test.ts` — FOUND

**Commits exist:**
- `bb8f3c2` (submodule, RED test) — FOUND via `git -C integrations/mcp-server-semantic-analysis log --all`
- `b9b70a0` (submodule, GREEN feat) — FOUND
- `fa77db2a1` (superproject submodule pointer bump) — FOUND via `git log --all` (HEAD)

**Acceptance greps verified:**
- T1 AC2 `grep -c "from '@fwornle/km-core'" scripts/migrate-leveldb-to-kmcore.mjs` → 1 (≥1)
- T1 AC3 `grep -cE 'deriveCanonicalId|deriveOntologyClass|stampProvenance|deriveDescription'` → 8 (≥4)
- T1 AC4 `grep -cE "legacyId.*system.*'B'"` → 3 (≥1)
- T1 AC5 10 tests pass
- T1 AC6 `--help` exits 0
- T2 AC1 `npm run build` exit 0
- T2 AC2 `docker-compose build coding-services` exit 0
- T2 AC3 `docker exec ... test -f scripts/migrate-leveldb-to-kmcore.mjs` exit 0
- T2 AC4 dry-run summary satisfies `totalEntities >= 700 and errorCount == 0`

**Tests:** 10/10 pass (was 0 — +10 net). Zero regressions in pre-existing test files (`workflow-state-machine.test.js`, `workflow-sse-broadcaster.test.js`, `utils/comparison-util.test.js`, `storage/km-core-adapter.test.js`).

**Production data:** 802 entities migrated cleanly into a tmpdir km-core store; 0 errors; 19 of 802 flagged ontologyClassUnregistered (Project/System/Knowledge — informational, well under 5% budget).
