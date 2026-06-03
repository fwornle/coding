---
phase: 44-rest-api-git-snapshots
type: context-amendment
amends: 44-CONTEXT.md
date: 2026-06-03
trigger: Plan 44-09 Rule 4 architectural checkpoint
status: locked
---

# 44-CONTEXT amendment — Domain vs Wire shape separation

## Why this amendment exists

Plan 44-09's executor halted before any source edit after verifying concrete shape
mismatches between km-core's canonical schemas and OKM's frozen Phase 43 D-G5.1
fixtures. The 44-09 SUMMARY documents the discovery; the audit performed after
the checkpoint isolates the root cause:

**Plan 44-03's "verbatim lift" was not verbatim.** The executor merged the
in-process `Entity` type (Phase 39/41/42 rich fields) with the OKM wire shape and
called the result "EntitySchema". Three OKM wire schemas (Relation, Stats,
Ontology) were silently rewritten to fit km-core's domain model. Five canonical
schemas (Search, Cluster, Export, GraphConnectivity, OntologyEntityTypes) were
omitted entirely. None of this surfaced as Rule 4 deviations.

44-PATTERNS.md and 44-RESEARCH.md both said "Pattern 2 verbatim, no deviations" —
they accurately described what Plan 44-03 was *supposed* to do. The drift is in
the delivered code, not the upstream artifacts.

## The conceptual fix

Two distinct artifacts were conflated. They MUST be kept separate:

1. **Domain types** (`EntityDomain`, `RelationDomain`) — in-process rich types.
   Optimized for in-memory ergonomics: `legacyId`, `embedding`, `validFrom`,
   `validUntil`, `supersedes`, `createdBy`, `lastConfirmedBy`,
   `confirmationCount` surface at the top level.

2. **Wire types** (`EntityWire`, `RelationWire`, `StatsWire`, etc.) — JSON
   shapes that cross the HTTP boundary. Lifted **verbatim** from OKM
   `tests/integration/rest-contract.test.ts:94-287`. Phase 43 D-G5.1 fixtures
   are the byte-equal lock.

**Wire shape is the contract of record.** Phase 43 locked it; Phase 44 must
serialize *into* it. Phase 45's unified viewer will consume it. There is no
"new canonical shape" — OKM's wire shape IS canonical for Phase 44+.

## What changes (in-place edits — no v2 files, no parallel versions)

### `lib/km-core/src/api/contracts.ts` — full rewrite in place

Replace the current 212-line file with two clearly-labeled sections:

**§ Domain types** (current km-core shape, renamed):
- `EntityDomainSchema` (current `EntitySchema`)
- `RelationDomainSchema` (current `RelationSchema`)
- Domain types remain available for in-process consumers (the Phase 39 D-30
  provenance, Phase 41 D-13 legacyId, Phase 42 D-52 embedding contracts hold
  unchanged on the in-process Entity type).

**§ Wire types** (verbatim lift from OKM lines 94-287):
- `MetadataSchema` = `z.record(z.string(), z.unknown())`
- `EntityProvenanceSchema` = `{createdBy, lastConfirmedBy, confirmationCount}` (provenance lives INSIDE metadata)
- `EntityWireSchema` — OKM lines 109-122 verbatim: 9 top-level fields, provenance under `metadata.provenance`
- `RelationWireSchema` — OKM lines 129-138 verbatim: `{key, source, target, attributes:{type, metadata, createdAt}}` (graphology edge format)
- `SearchResultSchema` + `SearchEndpointResponse` — OKM lines 142-156
- `ClusterSchema` + `ClustersEndpointResponse` — OKM lines 158-170 (modularity, count, clusters)
- `RcaConfidenceSchema` + `RcaChainStepSchema` + `RcaMatchSchema` + `RcaLookupEndpointResponse` — OKM lines 172-214 (OKM-specific surface, mounted under `/api/okm/*` by Plan 44-09; schema lives in km-core for completeness)
- `StatsWireSchema` — OKM lines 216-229 verbatim: 10 fields `{nodes, edges, evidenceCount, patternCount, orphanCount, islandCount, componentCount, connectivity, lastUpdated, activeSnapshot}`
- `ExportEndpointResponse` — OKM lines 231-255
- `OntologyClassesWireResponse` — OKM line 257: `ApiSuccessEnvelope(z.array(z.string()))` (just class names)
- `OntologyEntityTypesWireResponse` — OKM lines 259-267
- `GraphConnectivityEndpointResponse` — OKM lines 269-287

**Export wire envelopes alongside existing names**: `EntitiesEndpointResponse`,
`RelationsEndpointResponse`, etc. — these names already exist in the file but
currently bind to the wrong (domain-typed) schemas. Rebind them to the wire
schemas so consumers importing by these names get the correct contract.

**Backwards-compat shim**: keep `EntitySchema` and `RelationSchema` as exported
aliases pointing to the wire schemas (the wire shape is what HTTP consumers
expect when importing without the `Wire`/`Domain` suffix). The domain shapes
get the explicit `Domain` suffix. This avoids breaking the Wave 0 RED test
`contracts.test.ts` which imports `EntitySchema`; that test asserted on a
domain-shaped Entity, so update the test fixture accordingly (the wire shape is
what the test should have been asserting against from the start — the RED→GREEN
flip in Plan 44-03 was a false positive).

### `lib/km-core/src/adapters/wire-serializers.ts` — NEW file (sibling of observation-view.ts)

Pure functions: `entityToWire(e: EntityDomain): EntityWire`,
`relationToWire(r: RelationDomain): RelationWire`,
`statsToWire(graphStats: GraphStats): StatsWire`.

Pattern lifted from `lib/km-core/src/adapters/observation-view.ts` (Plan 44-05).
`entityToWire` packs provenance into `metadata.provenance`, strips `legacyId` /
`embedding` / `validFrom` / `validUntil` / `supersedes` from the top level (they
do not surface on the OKM wire). `relationToWire` flattens to graphology edge
format with `key`, `source`, `target`, `attributes`.

### `lib/km-core/src/api/handlers/*.ts` — in-place updates

Each handler currently does `res.json({ success:true, data: <domainEntity> })`.
Update to `res.json({ success:true, data: entityToWire(domainEntity) })`. Same
for relations, stats. Search/clusters/export/graph-connectivity handlers need
to be added or extended to emit the OKM wire envelopes.

### `lib/km-core/tests/unit/contracts.test.ts` — update assertions

The Wave 0 RED-then-GREEN test currently asserts on the domain shape. Update to
assert on the wire shape (the contract the HTTP layer is supposed to honor).
Keep the test name and import path — only the field expectations change.

### `lib/km-core/tests/integration/api-router.test.ts` — update expected envelopes

Same as above — assert on wire shape in the response body.

### `lib/km-core/src/intelligence/clustering.ts` — RNG seeding contract

Plan 44-06's Louvain port currently doesn't pin RNG. OKM's fixture lock relies
on `mulberry32(0x43_06_5E_ED)` (`tests/integration/rest-contract.test.ts:63`).
Add an `opts.rngSeed?: number` parameter to the cluster handler and the port,
defaulting to the OKM seed when absent. This is required for /api/clusters
byte-equal fixture round-trip in Plan 44-09.

## Plans affected

| Plan | Action |
|------|--------|
| 44-03 | **REDO in place**: rewrite contracts.ts per § above |
| 44-06 | **REDO in place**: handlers call wire-serializers; add missing canonical handlers |
| 44-07 | **VERIFY only**: A-side typed views use observation-view adapter (insulated from wire shape); no router-path consumer change in 44-07. /api/v1 mount path uses the new serializers automatically since the router is the same `createKmCoreRouter` instance |
| 44-08 | **VERIFY only**: B-side mounts createKmCoreRouter unchanged; serializers ride along inside |
| 44-09 | **UNBLOCKED** after redo: cutover proceeds against the now-OKM-conformant /api/v1 surface; fixtures byte-equal as Pitfall 5 originally promised |
| 44-10 | **UNCHANGED**: SQLite-to-km-core migration target is the domain Entity type, not the wire type |
| 44-11 | **UNCHANGED**: verification gate adds a fixture round-trip assertion to the SC matrix |

## What stays committed (no rollback)

- All 44-01, 44-02, 44-03, 44-04, 44-05, 44-06, 44-07, 44-08 commits stay on main.
- Plan 44-03 and 44-06 get **additional commits** that bring them into compliance
  with this amendment. The earlier commits are not reverted — they delivered the
  scaffolding, just with the wrong wire shape. The fix is a forward-only edit.

## Acceptance for the redo

- [ ] km-core full test suite GREEN (currently 266/266)
- [ ] Updated `contracts.test.ts` and `api-router.test.ts` assert on wire shape, GREEN
- [ ] A new `tests/integration/wire-serializers.test.ts` covers the three new serializer functions (RED→GREEN within the redo)
- [ ] OKM rest-contract.test.ts byte-equal fixtures pass against the new keystone (validated in Plan 44-09)
- [ ] No `EntitySchemaV2`, `EntitySchemaEnhanced`, `EntitySchemaNew` — only `EntitySchema` (= wire) and `EntityDomainSchema` (= in-process)

## Decision log

- **2026-06-03** — operator (fradou7) selected Option D after audit revealed the conceptual conflation. Amendment ratifies the domain/wire split as the way forward.
