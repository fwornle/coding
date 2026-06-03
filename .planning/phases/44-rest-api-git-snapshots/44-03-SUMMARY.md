---
phase: 44-rest-api-git-snapshots
plan: 03
subsystem: api
tags: [zod, schemas, rest-api, km-core, contracts, typescript, esm]

# Dependency graph
requires:
  - phase: 44-01
    provides: Wave 0 RED stubs (tests/unit/contracts.test.ts + tests/integration/{api-router,snapshot-roundtrip,observation-view}.test.ts) — flipped one to GREEN here
  - phase: 39
    provides: Entity field shape (validFrom/validUntil/supersedes/createdBy/lastConfirmedBy/confirmationCount + ProvenanceStamp)
  - phase: 41
    provides: legacyId origin-system bridge ({system:'A'|'B'|'C', id:string})
  - phase: 42
    provides: optional embedding number[] on Entity (D-52)
  - phase: 38
    provides: OntologyRegistry/ResolvedClass surface (input shape for OntologyClassSchema)
provides:
  - "Zod schemas codifying OKM-verbatim REST wire format under @fwornle/km-core/api/contracts"
  - "EntitySchema, RelationSchema, OntologyClassSchema, StatsSchema + ApiSuccessEnvelope factory + pre-composed response envelopes"
  - "z.infer<typeof ...> types (Entity, Relation, ProvenanceStamp, OntologyClass, Stats) exported alongside schemas"
  - "Sub-barrel @fwornle/km-core/api re-exports the full contracts surface"
  - "package.json subpath exports: ./api, ./api/contracts, ./snapshots (./snapshots pre-added for Plan 44-04)"
  - "zod ^3.25.76 in km-core dependencies"
affects: [44-04, 44-05, 44-06, 44-07, 44-08, 44-09, 45]

# Tech tracking
tech-stack:
  added: [zod@3.25.76]
  patterns:
    - "Zod-as-shipped-contract — schemas published under subpath import, not test-only declaration"
    - "ApiSuccessEnvelope(data) factory — { success:z.literal(true), data } wrapper"
    - "z.infer<typeof Schema> aliases for free TS types on consumer side"
    - "Subpath exports map mirrors src/api/ directory shape (./api + ./api/contracts both resolve)"
    - "Pre-declare not-yet-built subpath (./snapshots) in package.json to avoid Wave file-conflict — declaration is dormant until Plan 04 lands the dist file"

key-files:
  created:
    - "lib/km-core/src/api/contracts.ts"
    - "lib/km-core/src/api/index.ts"
  modified:
    - "lib/km-core/package.json"
    - "lib/km-core/package-lock.json"

key-decisions:
  - "Lifted OKM rest-contract Zod block VERBATIM per CONTEXT C-2 — no deviations from 44-RESEARCH § Pattern 2 lines 207-251"
  - "Added RelationSchema, OntologyClassSchema, StatsSchema beyond OKM's lift — Plan 06 router needs them per CONTEXT C-2 canonical contract; declaring now avoids parallel-schema risk in Plan 06"
  - "Pre-composed response envelopes (EntityResponse, EntitiesEndpointResponse, RelationResponse, etc.) so Plan 06/09 can import-by-name; suffixed inferred types with T (EntityResponseT) to avoid name collision with schema-exported envelopes"
  - "Owned ALL Phase 44 package.json edits in Plan 03 (./api + ./api/contracts + ./snapshots subpaths + zod dep) so Plan 44-04 only adds source files — no Wave 1 file-contention"
  - "./snapshots subpath dist target intentionally non-existent at end of plan; Plan 44-04 lands the source, build regenerates dist. Subpath is not consumed by any caller until Plan 06's barrel re-export, so the dangling declaration is harmless"

patterns-established:
  - "Zod sub-path published contract: km-core ships schemas as code, consumers import for runtime validation + free TS types"
  - "Two-step build verification: npm install (deps) -> npm run build (tsc) -> npx vitest run <specific-test> (RED -> GREEN confirmation)"

requirements-completed: [API-01]

# Metrics
duration: 9min
completed: 2026-06-03
---

# Phase 44 Plan 03: Zod Contracts Layer Summary

**Zod schemas for the canonical /api/v1 REST surface shipped under `@fwornle/km-core/api/contracts` — EntitySchema (Phase 39 full shape + Phase 41 legacyId + Phase 42 embedding), RelationSchema, OntologyClassSchema, StatsSchema, ApiSuccessEnvelope factory + pre-composed response envelopes; consumers get TS types for free via z.infer aliases.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-03T14:35:00Z (approx)
- **Completed:** 2026-06-03T14:43:30Z
- **Tasks:** 2/2
- **Files modified:** 4 in km-core submodule (2 created, 2 edited); 2 outer-repo pointer bumps

## Accomplishments

- Wave 0 test `lib/km-core/tests/unit/contracts.test.ts` flips **RED → GREEN** (6/6 pass)
- 5 canonical Zod schemas shipped: `ProvenanceStampSchema`, `EntitySchema`, `RelationSchema`, `OntologyClassSchema`, `StatsSchema`
- `ApiSuccessEnvelope(data)` factory + 7 pre-composed response envelopes (`EntityResponse`, `EntitiesEndpointResponse`, `RelationResponse`, `RelationsEndpointResponse`, `OntologyClassResponse`, `OntologyClassesEndpointResponse`, `StatsResponse`)
- 13 `z.infer<typeof …>` TS-type aliases exported alongside (consumers get types for free)
- `@fwornle/km-core/api` sub-barrel created and resolves at consumer side
- `@fwornle/km-core/api/contracts` deep subpath created and resolves at consumer side
- `@fwornle/km-core/snapshots` subpath declared in `package.json` (dormant — Plan 44-04 lands the source)
- `zod ^3.25.76` landed in km-core dependencies (alphabetical position after `uuidv7`)
- km-core full suite: **30/33 test files passing, 251/257 tests passing** — no regression; the 3 failing files are the **expected Wave 0 RED stubs** that Plans 44-04/05/06 will green

## Wave 0 Test Progress

| Test file                                              | Before Plan 03 | After Plan 03 | Greened by    |
| ------------------------------------------------------ | -------------- | ------------- | ------------- |
| `tests/unit/contracts.test.ts`                         | RED            | **GREEN**     | **44-03 (this plan)** |
| `tests/integration/api-router.test.ts`                 | RED            | RED (expected) | 44-06         |
| `tests/integration/snapshot-roundtrip.test.ts`         | RED            | RED (expected) | 44-04         |
| `tests/integration/observation-view.test.ts`           | RED            | RED (expected) | 44-05         |

Vitest output proving the flip:

```
$ cd lib/km-core && npx vitest run tests/unit/contracts.test.ts
RUN  v4.1.6 /Users/Q284340/Agentic/coding/lib/km-core
Test Files  1 passed (1)
     Tests  6 passed (6)
```

(Before Plan 03 ran, this test failed with `Cannot find module '../../src/api/contracts.js'`.)

## Task Commits

Each task was committed atomically inside the `lib/km-core` submodule, followed by an outer-repo pointer bump:

1. **Task 1: Author `src/api/contracts.ts` + `src/api/index.ts` (Zod schemas + inferred types)**
   - Submodule: `ecb4edb` (`feat(44-03): land Zod contracts.ts + ./api sub-barrel (contracts.test.ts GREEN)`)
   - Outer pointer bump: `9359ca3ab` (`feat(44-03): bump km-core to ecb4edb — Zod contracts + ./api sub-barrel`)

2. **Task 2: Wire `./api`, `./api/contracts`, `./snapshots` subpath exports in `package.json`**
   - Submodule: `d0bca0d` (`feat(44-03): add ./api, ./api/contracts, ./snapshots subpath exports`)
   - Outer pointer bump: `c5d76adbc` (`feat(44-03): bump km-core to d0bca0d — add ./api + ./snapshots subpath exports`)

3. **Plan metadata (this SUMMARY):** committed in the outer repo after this file is written.

## Files Created/Modified

**Created (km-core submodule):**

- `lib/km-core/src/api/contracts.ts` (212 lines) — Zod schemas + `ApiSuccessEnvelope` factory + response envelopes + `z.infer` types
- `lib/km-core/src/api/index.ts` (48 lines) — sub-barrel re-exporting all schemas and inferred types from `./contracts.js`

**Modified (km-core submodule):**

- `lib/km-core/package.json` — added `zod` dep; added `./api`, `./api/contracts`, `./snapshots` subpath exports in alphabetical order
- `lib/km-core/package-lock.json` — npm-managed (zod + transitive deps)

**Modified (outer repo):**

- Submodule pointer `lib/km-core` advanced from `a6f2f7b` → `ecb4edb` → `d0bca0d` (two commits)

## Final `exports` map (`lib/km-core/package.json`)

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./adapters/online": {
    "types": "./dist/adapters/online/index.d.ts",
    "import": "./dist/adapters/online/index.js"
  },
  "./api": {
    "types": "./dist/api/index.d.ts",
    "import": "./dist/api/index.js"
  },
  "./api/contracts": {
    "types": "./dist/api/contracts.d.ts",
    "import": "./dist/api/contracts.js"
  },
  "./dedup": {
    "types": "./dist/dedup/index.d.ts",
    "import": "./dist/dedup/index.js"
  },
  "./embeddings": {
    "types": "./dist/embeddings/index.d.ts",
    "import": "./dist/embeddings/index.js"
  },
  "./maintenance": {
    "types": "./dist/maintenance/index.d.ts",
    "import": "./dist/maintenance/index.js"
  },
  "./ontology": {
    "types": "./dist/ontology/index.d.ts",
    "import": "./dist/ontology/index.js"
  },
  "./pipeline": {
    "types": "./dist/pipeline/index.d.ts",
    "import": "./dist/pipeline/index.js"
  },
  "./snapshots": {
    "types": "./dist/snapshots/index.d.ts",
    "import": "./dist/snapshots/index.js"
  }
}
```

All subpaths in alphabetical order. `./snapshots` declaration is dormant — Plan 44-04 will land `src/snapshots/index.ts` + `src/snapshots/SnapshotManager.ts` and the build will populate the dist target. No caller imports `@fwornle/km-core/snapshots` until Plan 44-06 wires the root barrel, so the dangling declaration is harmless.

## Subpath resolution smoke output

```
$ cd lib/km-core && node -e "import('@fwornle/km-core/api/contracts').then(m => { ... })"
ALL_OK: ApiSuccessEnvelope,EntitiesEndpointResponse,EntityResponse,EntitySchema,OntologyClassResponse,OntologyClassSchema,OntologyClassesEndpointResponse,ProvenanceStampSchema,RelationResponse,RelationSchema,RelationsEndpointResponse,StatsResponse,StatsSchema

$ cd lib/km-core && node -e "import('@fwornle/km-core/api').then(m => { ... })"
API_BARREL_OK
```

Both the deep subpath and the sub-barrel resolve cleanly; the 13 schema/envelope exports are reachable through `@fwornle/km-core/api/contracts`.

## Decisions Made

- **Verbatim lift from OKM rest-contract.test.ts:94-167** — followed CONTEXT C-2 and 44-RESEARCH § Pattern 2 exactly. No deviation from the source schemas; only additions (RelationSchema, OntologyClassSchema, StatsSchema, response envelopes, z.infer types) — those additions are explicitly required by the plan's `<action>` block (Plan 06 router needs them, Plan 09 fixtures validate against them).
- **Pre-composed response envelopes named without `Schema` suffix** (`EntityResponse`, `EntitiesEndpointResponse`, …) — matches the OKM source's naming. The Zod object is on the export name; the corresponding inferred TS type carries a `T` suffix (`EntityResponseT`) to avoid name collision in consumer imports.
- **Owned ALL Phase 44 `package.json` edits in this plan**, including `./snapshots` — per the plan's Wave-1 file-conflict-avoidance directive. Plan 44-04 will only touch `src/snapshots/**`; the manifest is already declared.
- **`zod ^3.25.76` matches OKM's pin exactly** (44-RESEARCH § Standard Stack) — no version drift between km-core and the OKM consumer that will validate against the shipped schemas.

## Deviations from Plan

None - plan executed exactly as written. The plan's `<action>` block was followed verbatim:

- Schemas lifted from 44-RESEARCH § Pattern 2 lines 207-251 (Phase 39 fields + ApiSuccessEnvelope)
- Additional canonical schemas added per the explicit `<action>` directive (RelationSchema, OntologyClassSchema, StatsSchema + response envelopes)
- `z.infer<typeof ...>` types exported alongside (Entity, Relation, ProvenanceStamp, OntologyClass, Stats)
- `src/api/index.ts` written as a thin re-export from `./contracts.js` with a top-of-file comment noting Plan 06 will add `createKmCoreRouter`
- `.js` import suffix used (km-core ESM/NodeNext convention — `tsconfig.json` line 5 confirms `module: NodeNext`)
- All file names exactly as listed in `<files>`; no evolutionary suffixes (`-v2`, `-enhanced`, etc.)
- `package.json` `exports` entries placed in alphabetical order (`./adapters/online` → `./api` → `./api/contracts` → `./dedup` → … → `./pipeline` → `./snapshots`)
- `zod ^3.25.76` placed in `dependencies` after `uuidv7` (alphabetical)
- `no-console-log` rule honored: contracts.ts and index.ts are pure schema / re-export modules with zero diagnostic emission

## Issues Encountered

- **Stale dist artifacts from prior abandoned Phase 44 draft** (`lib/km-core/dist/api/router.{js,d.ts}` and `lib/km-core/dist/snapshots/SnapshotManager.{js,d.ts}` — May 29 timestamps, no corresponding `src/` files). These are the orphan drafts called out in 44-RESEARCH § Finding 1 ("A half-finished Phase 44 attempt already exists"). They are NOT referenced by any TS source file after Plan 03's changes; tsc only emits build artifacts for files present in `src/`. Leaving them in place is correct — Plan 44-04 will land `src/snapshots/**` (overwriting `dist/snapshots/SnapshotManager.*`) and Plan 44-06 will land `src/api/router.ts` (overwriting `dist/api/router.*`). No action taken in this plan.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 44-04 (SnapshotManager)** can begin: `package.json` already declares the `./snapshots` subpath, so Plan 04 only touches `src/snapshots/**` and `tests/integration/snapshot-roundtrip.test.ts` (no `package.json` contention).
- **Plan 44-05 (observation-view adapter)** can begin: Plan 03 introduces no surface that conflicts.
- **Plan 44-06 (createKmCoreRouter)** can begin once 04+05 land: the router will import schemas from `./contracts.js` (or `./contracts.ts` source) and use `ApiSuccessEnvelope(EntitySchema)` as the success-response shape per the Plan 06 contract.
- **Plan 44-09 (OKM rest-contract.test.ts rewrite)**: can rewrite its imports to pull from `@fwornle/km-core/api/contracts` instead of re-declaring the schemas locally. The package.json subpath is live now.
- No blockers, no concerns. zod 3.25.76 matches OKM's pin exactly — no version-drift risk when Plan 09 imports the schemas in OKM tests.

## Threat Flags

None — no new security-relevant surface introduced beyond what the plan's `<threat_model>` already enumerated (T-44-03-01 / T-44-03-02 / T-44-03-SC, all `mitigate` disposition, mitigations applied per 44-RESEARCH § V5/V7 controls + zod's HIGH-trust audit).

## Self-Check: PASSED

- File existence: `lib/km-core/src/api/contracts.ts` ✓; `lib/km-core/src/api/index.ts` ✓
- Submodule commits found in `lib/km-core` git log: `ecb4edb` ✓; `d0bca0d` ✓
- Outer commits found in coding git log: `9359ca3ab` ✓; `c5d76adbc` ✓
- Wave 0 contracts.test.ts GREEN: 6/6 ✓
- Subpath resolution at consumer side: `@fwornle/km-core/api/contracts` → 13 exports ✓; `@fwornle/km-core/api` → barrel ✓
- `zod` in `package.json` dependencies at `^3.25.76` ✓
- All three subpaths (`./api`, `./api/contracts`, `./snapshots`) in `exports` map ✓
- No regression in existing km-core tests (30/33 test files pass; 3 RED are expected Wave 0 stubs) ✓
- No `STATE.md` / `ROADMAP.md` writes (orchestrator owns those) ✓
- No evolutionary file names introduced ✓

---
*Phase: 44-rest-api-git-snapshots*
*Plan: 03*
*Completed: 2026-06-03*
