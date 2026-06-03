---
phase: 44-rest-api-git-snapshots
plan: 44-03+06-REFIT
subsystem: km-core / api
type: refit
amends: 44-03, 44-06
trigger: 44-CONTEXT-amendment.md (Plan 44-09 Rule 4 architectural blocker)
tags: [contracts, wire-shape, serializers, louvain-rng, fixture-lock]
status: complete
completed: 2026-06-03T18:02:00Z
duration_minutes: 95
dependency_graph:
  requires:
    - 44-03-SUMMARY.md   # Zod contracts scaffolding (predecessor)
    - 44-06-SUMMARY.md   # createKmCoreRouter keystone (predecessor)
  provides:
    - EntityWireSchema / RelationWireSchema / StatsWireSchema (OKM verbatim)
    - entityToWire / relationToWire / statsToWire (pure adapters)
    - GET /api/v1/search (new handler)
    - DEFAULT_LOUVAIN_SEED = 0x43_06_5E_ED (fixture-lock pin)
    - ClusterResult = {clusters, modularity} from clusterEntities
  affects:
    - 44-09 (now unblocked — fixtures should round-trip byte-equal)
    - 44-11 (verification gate — fixture round-trip assertion ready)
tech_stack:
  added: []
  patterns:
    - Domain/wire shape separation (in-process rich vs HTTP boundary)
    - Pure-function serializers (adapter pattern, mirrors observation-view.ts)
    - Verbatim schema lift from upstream byte-equal contract source
key_files:
  modified:
    - lib/km-core/src/api/contracts.ts (212 → 437 lines; full rewrite)
    - lib/km-core/src/api/index.ts (barrel — domain + wire + aliases)
    - lib/km-core/src/api/handlers/entities.ts (entityToWire wrapping)
    - lib/km-core/src/api/handlers/relations.ts (relationToWire wrapping)
    - lib/km-core/src/api/handlers/query.ts (+search handler, /export + /stats + /graph/connectivity rewrite)
    - lib/km-core/src/api/handlers/ontology.ts (classes = strings; entity-types = objects)
    - lib/km-core/src/api/handlers/clusters.ts (RNG seed pin; wire envelope)
    - lib/km-core/src/intelligence/clustering.ts (returns ClusterResult, uses louvain.detailed())
    - lib/km-core/tests/unit/contracts.test.ts (wire-shape assertions)
    - lib/km-core/tests/integration/api-router.test.ts (wire envelopes + new relation test)
  created:
    - lib/km-core/src/adapters/wire-serializers.ts (3 pure functions)
    - lib/km-core/tests/unit/wire-serializers.test.ts (16 assertions)
decisions:
  - Wire shape is HTTP contract of record; EntitySchema/RelationSchema/StatsSchema unprefixed default to wire (consumers get the contract that crosses the network)
  - EntityDomainSchema/RelationDomainSchema retained as explicit in-process surface
  - OntologyClassSchema (wrong-shape invention) deleted — OKM /ontology/classes returns array of strings
  - DEFAULT_LOUVAIN_SEED = 0x43_06_5E_ED hardcoded in cluster handler (overridable via ?seed=)
metrics:
  test_count_before: 266
  test_count_after: 285
  test_count_delta: +19
  commits_submodule: 5
  commits_outer: 5  # 4 pointer bumps + this SUMMARY commit
---

# Phase 44 Plan 03+06 REFIT: Domain / Wire Shape Separation Summary

OKM wire shape (Phase 43 D-G5.1 byte-equal fixture lock) lifted verbatim into
`@fwornle/km-core/api/contracts`; domain-rich Entity / Relation shapes preserved
under explicit `EntityDomainSchema` / `RelationDomainSchema`; pure adapter
functions (`entityToWire` / `relationToWire` / `statsToWire`) bridge the two
boundaries; all `createKmCoreRouter` handlers now emit OKM-conformant JSON.

## Why this refit

Plan 44-09 (cutover) halted at a Rule 4 architectural checkpoint after the
executor verified concrete shape mismatches between km-core's canonical schemas
and OKM's frozen Phase 43 D-G5.1 fixtures. The audit (committed as
`44-CONTEXT-amendment.md`) traced the drift to Plan 44-03's "verbatim lift"
silently merging the in-process Entity type (Phase 39/41/42 rich fields) with
the OKM wire shape, then calling the result `EntitySchema`. Three wire schemas
(Relation, Stats, Ontology) were rewritten to fit km-core's domain model; five
canonical schemas (Search, Cluster, Export, GraphConnectivity,
OntologyEntityTypes) were omitted entirely.

This refit edits the affected sources **in place** (per
`lib/km-core/CLAUDE.md` no-parallel-versions rule) to split domain types from
wire types and route every handler through the new serializers.

## What changed

### §1 — `contracts.ts` rewritten (Step 1)

Two clearly-labeled sections plus HTTP-default aliases:

| Section            | Symbols                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| §1 Domain          | `EntityDomainSchema`, `RelationDomainSchema`, `ProvenanceStampSchema`            |
| §2 Wire (verbatim) | `EntityWireSchema`, `RelationWireSchema`, `StatsWireSchema`, `EntityProvenanceSchema`, `MetadataSchema`, `SearchResultSchema`, `ClusterSchema`, `RcaConfidence/ChainStep/MatchSchema`, `ExportEndpointResponse`, `OntologyClassesWireResponse`, `OntologyEntityTypesWireResponse`, `GraphConnectivityEndpointResponse`, `RcaLookupEndpointResponse`, `SearchEndpointResponse`, `ClustersEndpointResponse` |
| §3 HTTP defaults   | `EntitySchema = EntityWireSchema`, `RelationSchema = RelationWireSchema`, `StatsSchema = StatsWireSchema` |
| §4 Inferred types  | `Entity`/`Relation`/`Stats` = wire shapes; `EntityDomain`/`RelationDomain` = domain shapes; plus all `*Wire` and `*Domain` aliases |

`OntologyClassSchema` (wrong-shape invention) was **deleted**. Confirmed via grep
that no internal or outer consumer imported it. The two ontology endpoints use
the verbatim-from-OKM `OntologyClassesWireResponse` (array of class name
strings) and `OntologyEntityTypesWireResponse` (array of `{name, description,
source}`).

### §2 — `wire-serializers.ts` created (Step 2)

Three pure-function projectors that bridge domain → wire. Pattern lifted from
`src/adapters/observation-view.ts` (Plan 44-05). No I/O, no async, no
diagnostic emission, type-only imports.

| Function          | Domain → Wire transformation                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `entityToWire`    | Preserves `metadata` bag verbatim (provenance stays in `metadata.provenance` per Phase 39 invariant). Defensively folds top-level `createdBy`/`lastConfirmedBy`/`confirmationCount` into `metadata.provenance` if present. Strips `legacyId`, `embedding`, `validFrom`, `validUntil`, `supersedes` from the wire output. |
| `relationToWire`  | Emits graphology edge envelope `{key, source:r.from, target:r.to, attributes:{type, metadata, createdAt}}`. Synthesizes key as `<from>\|<to>\|<type>` when caller hasn't supplied one.                                                                                                       |
| `statsToWire`     | Graceful defaults — counts → 0, `lastUpdated` → epoch ISO, `activeSnapshot` → null (NEVER undefined; wire is `z.unknown().nullable()` not `z.optional()`).                                                                                                                                  |

### §3 — Handler updates (Step 3)

| Handler          | What changed                                                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entities.ts`    | GET / POST / PUT all wrap output through `entityToWire` before emitting `{success:true, data:…}`.                                                                                                                                              |
| `relations.ts`   | GET / POST emit graphology edge envelope via `relationToWire`. Private `toWireRelation` helper removed (centralized in the serializer adapter).                                                                                                |
| `query.ts`       | POST `/query` returns wire entities via `entityToWire`. New `GET /search` handler (substring over name/description/metadata; wire shape per OKM 142-156). `/export` rewritten to emit `ExportEndpointResponse` shape. `/stats` rewritten to emit the 10-field `StatsWire`. `/graph/connectivity` rewritten to emit `GraphConnectivityEndpointResponse`. `/graph/orphans` returns wire entities. |
| `ontology.ts`    | `/ontology/classes` returns array of class **name strings** (OKM line 257). `/ontology/entity-types` returns array of `{name, description, source}` (OKM 259-267). `/ontology/schema/:className` unchanged.                                  |
| `clusters.ts`    | Emits wire envelope `{clusters: [{id, nodeIds, size}], count, modularity}` per OKM 164-170. Pins `seed` to `0x43_06_5E_ED` when caller omits.                                                                                                  |
| `snapshots.ts`   | Unchanged — already shape-correct per S-2 revised contract.                                                                                                                                                                                    |

### §4 — Louvain RNG pin (Step 4)

| File                                  | Change                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/intelligence/clustering.ts`      | Return type now `ClusterResult = {clusters, modularity}` so the handler can emit the OKM `{clusters, count, modularity}` envelope. Uses `louvain.detailed()` to recover the modularity score from `graphology-communities-louvain`. `seededRng` (mulberry32) unchanged.                                |
| `src/api/handlers/clusters.ts`        | `DEFAULT_LOUVAIN_SEED = 0x43_06_5E_ED` (verbatim from OKM `rest-contract.test.ts:63 RNG_SEED`). Caller can override via `?seed=<int>`. Empty-graph path now emits `{clusters:[], count:0, modularity:0}` shape instead of bare `[]`.                                                                    |

### §5 — Wave 0 test assertion updates (Step 5)

`tests/unit/contracts.test.ts`:

- Removed the "all optional Phase 39 fields" test that asserted on top-level
  `legacyId` / `validUntil` / `confirmationCount` (those fields no longer
  live on `EntitySchema` since it aliases `EntityWireSchema`).
- Added "parse accepts entity with provenance under `metadata.provenance`
  (wire shape)".
- Added "parse REJECTS top-level provenance fields (domain-shape leak)"
  (verifies the open metadata bag accepts arbitrary keys).
- Added "parse REJECTS invalid layer value".

`tests/integration/api-router.test.ts`:

- POST + GET round-trip — added explicit `.toBeUndefined()` assertions for
  `legacyId`, `embedding`, `validFrom`, `validUntil`, `supersedes` on the
  wire response. Strips guaranteed.
- `/stats` — assertions changed from `{entityCount, relationCount}` to the
  10-field `StatsWire` shape. Verifies `activeSnapshot === null` (not
  undefined).
- NEW test: POST `/relations` + GET `/relations` — verifies graphology edge
  envelope shape; verifies domain-style `from`/`to`/`relationType` at top
  level MUST NOT leak.

## Test results

| Metric          | Before | After | Delta |
| --------------- | -----: | ----: | ----: |
| Test files      |     33 |    34 |    +1 |
| Tests passing   |    266 |   285 |   +19 |
| Tests failing   |      0 |     0 |     0 |

`npm run build` clean. Full `npx vitest run` GREEN: 285/285. The four named
Wave 0 tests all GREEN against wire shape (contracts.test.ts, api-router.test.ts,
snapshot-roundtrip.test.ts, observation-view.test.ts).

## Commit hashes

| Step                          | km-core (submodule) | coding (outer pointer bump) |
| ----------------------------- | ------------------- | --------------------------- |
| 1. Contracts split            | `69fe61f`           | `35e798220`                 |
| 2. wire-serializers adapter   | `7be06df`           | `ae0c0cd95`                 |
| 3. Handler wire-shape emit    | `10596bd`           | `5193c8d58` (combined 3+4)  |
| 4. Louvain RNG pin            | `2a64ea2`           | (see above)                 |
| 5. Wave 0 test updates        | `1298b51`           | `53c0c8e3e`                 |

Plus this SUMMARY commit in the outer tree.

## Constraint compliance

- **No file with v2/enhanced/new/fixed/temp/copy suffix created** — all edits
  in place per `lib/km-core/CLAUDE.md` "no parallel versions ever" rule. Single
  new file is `wire-serializers.ts` (canonical name, sibling of
  `observation-view.ts`). Single new test is
  `tests/unit/wire-serializers.test.ts`.
- **No package.json changes** — Plan 03 already added zod + subpath exports.
- **STATE.md / ROADMAP.md untouched** per directive.
- **Phase 39 D-30, Phase 41 D-13, Phase 42 D-52 in-process Entity contracts
  hold unchanged** — the wire serializer bridges them to OKM-conformant JSON
  without modifying the underlying domain type.
- **44-07 (A-side typed views) and 44-08 (B-side mount) source unchanged** —
  both consume `createKmCoreRouter` (the keystone) unchanged; serializers ride
  along inside the handlers automatically.

## Operator follow-up

**Re-dispatch Plan 44-09 (`/gsd:plan-phase --phase=44 --plan=09 --resume`)
after this lands.** Plan 09's cutover should now produce byte-equal fixtures
against OKM `tests/fixtures/pre-migration/api-*.json`:

- `/api/v1/entities` — wire shape with provenance under metadata.provenance ✓
- `/api/v1/relations` — graphology edge envelope ✓
- `/api/v1/stats` — 10-field StatsWire ✓
- `/api/v1/clusters` — fixed-seed partition + modularity ✓
- `/api/v1/search` — wire envelope (handler now exists) ✓
- `/api/v1/export` — ExportEndpointResponse shape ✓
- `/api/v1/ontology/classes` — array of strings ✓
- `/api/v1/ontology/entity-types` — array of objects ✓
- `/api/v1/graph/connectivity` — GraphConnectivityEndpointResponse ✓

Plan 44-09's Pitfall 5 (byte-equal fixtures) is now mechanically achievable.
The OKM `tests/integration/rest-contract.test.ts` test should pass against the
new keystone without re-declaration.

## Deviations from directive

None — all 9 steps executed exactly as specified.

## Self-Check: PASSED

Verification artifacts:

- `lib/km-core/src/api/contracts.ts` exists ✓
- `lib/km-core/src/adapters/wire-serializers.ts` exists ✓
- `lib/km-core/tests/unit/wire-serializers.test.ts` exists ✓
- All commit hashes resolvable in `git log --all` ✓
- `cd lib/km-core && npx vitest run` → 285/285 GREEN ✓
- `cd lib/km-core && npm run build` → clean ✓
- No v2/enhanced/new/fixed-suffix files created ✓
