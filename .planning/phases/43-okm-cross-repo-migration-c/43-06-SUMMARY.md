---
phase: 43-okm-cross-repo-migration-c
plan: 06
subsystem: tests
tags: [okm, rest-contract, fixtures, zod, determinism, d-g5.1]

requires:
  - phase: 43-okm-cross-repo-migration-c
    provides: Plan 02 lib/km-core submodule (km-core OntologyRegistry available); Plan 05 verifies createServer signature stable
  - phase: 38-ontology-registry
    provides: OntologyRegistry on the km-core sub-path used by /api/ontology/*

provides:
  - 10 byte-equal REST fixtures locked at the pre-cutover baseline
  - Per-endpoint Zod shape lock + byte-equal toEqual lock in tests/integration/rest-contract.test.ts
  - Operator-runnable, idempotent recorder script — re-record fingerprint matches across consecutive runs
  - Plan 10 verification spine: same tests + fixtures will run post-cutover; byte-equal pass = D-G5.1 SC#3 satisfied

affects: [43-08-storage-cutover, 43-10-post-cutover-verification]

tech-stack:
  added:
    - "zod v3 schemas for REST contract enforcement (zod was already a dep — no new package)"
  patterns:
    - "Triple-determinism for fixture recording: (a) freeze Date globally so server-side new Date() returns FROZEN_ISO, (b) seed Math.random with mulberry32(const) so Louvain's RNG is stable, (c) regex-normalize graphology's auto-generated edge keys (geid_<instance>_<idx> → seed-edge-<idx>) before writing fixture JSON"
    - "Recorder + test mirror byte-for-byte: the test file recreates the same Date freeze + Math.random seed + edge-key normalization + seed-from-disk that the recorder uses, so the live server response can be byte-equal-compared to the recorded fixture without any post-processing rules diverging"
    - "Seed via low-level store API (graphStore.addEntity / graphStore.addEdge) rather than HTTP ingest. Bypasses the LLM-driven extractor + dedup, preserves caller-supplied fixed UUIDs verbatim, and produces deterministic entity ordering. (HTTP POST /api/entities works for fixed UUIDs too, but timestamps would still leak — the Date-freeze handles that, but skipping HTTP also skips IngestionPipeline + EntityExtractor which are LLM-coupled.)"

key-files:
  created:
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/.gitkeep
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/seed-dataset.json (249 lines — 7 entities + 5 relations + _meta)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-entities.json (201 lines)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-relations.json (65 lines)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-search.json (24 lines)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-clusters.json (34 lines)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-rca-lookup.json (230 lines)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-stats.json (15 lines)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-export.json (292 lines)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-ontology-classes.json (34 lines, 29 classes)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-ontology-entity-types.json (150 lines, OKM extra)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration/api-graph-connectivity.json (42 lines, OKM extra)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/rest-contract.test.ts (430 lines — Zod schemas + per-endpoint shape+byte-equal locks)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/scripts/record-rest-fixtures.mjs (232 lines, +x — idempotent recorder)
  modified: []

key-decisions:
  - "Seed the graph via direct store.addEntity / store.addEdge instead of POST /api/entities + POST /api/relations. Both approaches preserve fixed UUIDs (the HTTP createEntity handler accepts a body `id` field), but the direct-store path avoids triggering any code with LLM dependencies (IngestionPipeline isn't even constructed) and avoids the cost of HTTP round-trips for 7 entities + 5 edges. SUMMARY documents the choice so a future operator who wants to test the ingest path knows it's available but deliberately bypassed for fixture recording."
  - "Override graphology's auto-generated edge keys via JSON post-processing (regex `geid_\\d+_(\\d+)` → `seed-edge-$1`) rather than passing explicit keys through graphStore.addEdge. Reason: GraphStore.addEdge always delegates to graphology's auto-key path (no addEdgeWithKey wrapper), and modifying GraphStore is out of plan scope ('zero source changes to src/'). The post-processing approach normalizes the keys at the boundary (fixture-write + test-read) symmetrically, so byte-equal comparisons hold; the per-graph insertion-order index (\\d+ after the underscore) IS deterministic and that's what we keep."
  - "Pin Math.random globally with mulberry32(0x43_06_5E_ED) rather than passing an explicit rng option through clusterEntities. Reason: clusterEntities is in src/ and the plan bans src changes. graphology-communities-louvain uses Math.random when no rng option is passed; overriding Math.random at the recorder/test process level pins Louvain at the source. The seed constant is plan-stable (0x43_06_5E_ED ≈ 'PHASE-43-PLAN-06-SEED') so different plans/tests can re-use the same convention or pick distinct seeds."
  - "Include 2 OKM-specific extras (ontology/entity-types, graph/connectivity) beyond the D-G5.1 minimum 8. The plan explicitly invites this ('D-G5.1's list is the minimum, not an exhaustive cap'). Both are read-only with stable response shapes; locking them now broadens the post-cutover diff surface at no cost."

patterns-established:
  - "When a downstream library uses Math.random for nondeterministic ordering (Louvain, hash-based set ordering, jitter), a process-wide mulberry32 override is the simplest single-point determinism fix — IFF the library exposes no rng option AND modifying the wrapping function is out of scope."
  - "Edge-key regex-normalization at the fixture-write/read boundary is preferable to fork-and-patch (graphology) or src wrapper changes when the auto-key counter is the only non-determinism source. The pattern `geid_<X>_<Y>` → `seed-edge-<Y>` preserves the deterministic insertion-order part while erasing the process-counter part. Same regex must appear in recorder AND test."

requirements-completed: [INT-03]

duration: 60min
completed: 2026-05-31
---

# Phase 43 Plan 06: pre-cutover REST contract baseline

**10 byte-equal fixtures + 10 Zod+toEqual contract tests + 1 idempotent recorder script. REST API surface frozen before Plan 08's storage cutover; Plan 10 byte-diffs post-cutover responses against the same fixtures.**

## Performance

- **Duration:** ~60 min (15 min endpoint enumeration + design, 15 min seed/recorder authoring, 10 min two determinism iterations after the first idempotence check failed, 10 min test authoring, 10 min commits/SUMMARY)
- **Completed:** 2026-05-31T13:05Z
- **Tasks:** 3 explicit (split Task 1 into 1a/1b internally for tracking)
- **Files created in OKM:** 14 (1 seed + 10 fixtures + 1 test + 1 recorder + 1 .gitkeep)
- **Net LoC:** +1999 (additive only; no src changes per plan)

## Endpoint List (10 locked)

D-G5.1 minimum 8:
1. `GET  /api/entities` → api-entities.json
2. `GET  /api/relations` → api-relations.json
3. `GET  /api/search?q=Redis` → api-search.json
4. `GET  /api/clusters` → api-clusters.json
5. `POST /api/rca/lookup` (body `{query:"memory leak"}`) → api-rca-lookup.json
6. `GET  /api/stats` → api-stats.json
7. `GET  /api/export` → api-export.json
8. `GET  /api/ontology/classes` → api-ontology-classes.json

OKM extras (read-only, stable):
9. `GET  /api/ontology/entity-types` → api-ontology-entity-types.json
10. `GET  /api/graph/connectivity` → api-graph-connectivity.json

**D-G5.1 deviation note:** The plan listed `GET /api/rca-lookup?entityId=<id>`. The actual OKM router has `POST /api/rca/lookup` with body `{query, ...}` (semantic match by text, not by entity id). Locked the actual handler; fixture body is `{query: "memory leak"}` which produces a stable multi-match response.

## Seed Statistics

- **Entities:** 7 — 5 evidence + 2 pattern, 3 distinct entityType values (Incident, Component, Pattern) all matching ontology classes
- **Relations:** 5 — CAUSED_BY (×2 forming the RCA chain), CO_OCCURS (×1 forming the cluster pair), TRIGGERS (×1 chain step), RELATED_TO (×1 lateral)
- **RCA chain:** Batch Processor → Memory Spike → Memory Leak Anti-pattern (2 TRIGGERS + 1 CAUSED_BY)
- **Cluster pair:** Redis Cache Eviction ↔ Redis Timeout (CO_OCCURS edge)
- **Orphan entity:** Cache Configuration Pattern (intentional — exercises `orphanCount: 1` in stats + appears in graph/orphans)
- **Domain coverage:** infrastructure (×3), compute (×2), patterns (×2)
- **Ontology classes touched** (matches ontology/upper.json + sub-classes): Incident, Component, Pattern

All UUIDs hard-coded with semantic prefixes (`f1f000XX` = "evidence-XX", `1a7000XX` = "pattern-XX") + numeric suffix matching insertion order.

## Zod Schema Highlights

Per-endpoint schemas locked at module scope inside the test file (will move to a shared module if Phase 44 surfaces a unified REST contract):

- **EntitySchema** — id, name, entityType, ontologyClass (optional), layer enum ('evidence'|'pattern'), description, createdAt, updatedAt, metadata (intersection of `{domain?, provenance?}` and `Record<string, unknown>` to allow extra metadata fields without breaking the contract)
- **EntityProvenanceSchema** — createdBy + lastConfirmedBy (both ProvenanceStamp: `{provider, model, runId, timestamp}`) + confirmationCount
- **RelationSchema** — key, source, target, attributes (`{type, metadata, createdAt}`)
- **ClusterSchema** — id, nodeIds (string[]), size
- **RcaMatchSchema** — nodeId, entity (id, name, entityType, ontologyClass?, layer, description, domain?), relevanceScore, confidence (`{score, label, factors}`), combinedScore, causalChain (array of {nodeId, name, relationship, direction enum, depth, description}), knownFixes, evidenceLinks
- **StatsEndpointResponse** — nodes, edges, evidenceCount, patternCount, orphanCount, islandCount, componentCount, connectivity, lastUpdated, activeSnapshot (nullable)
- **ExportEndpointResponse** — options, attributes, nodes (with embedded EntitySchema), edges (with embedded relation attributes shape)
- **ApiSuccessEnvelope** — generic wrapper `{success: literal(true), data: T}` used by every endpoint

41 distinct Zod combinators in the file (`z.object`, `z.array`, `z.enum`), 13 fixture-path mentions, 10 test cases — comfortably above the gates (≥8 each).

## Determinism Stack (THE story of this plan)

Without these three layers, fixture re-recording produced byte-different output across consecutive runs:

| Layer | Source of non-determinism | Fix |
|-------|----------------------------|-----|
| Time | `new Date().toISOString()` inside GraphStore.addEntity/addEdge + `/api/stats.lastUpdated` | Pin `globalThis.Date` to a FrozenDate subclass returning FROZEN_MS for `now()` + `new Date()` |
| RNG | `graphology-communities-louvain` falls back to `Math.random` for tie-breaking when no `rng` option supplied → cluster partition differs each run | Pin `Math.random = makeMulberry32(0x43_06_5E_ED)` at script top |
| Edge keys | graphology's `geid_<process-instance-counter>_<insertion-idx>` — the process-instance-counter varies between recorder invocations because subgraph clones inside intelligence helpers (analyzeConnectivity, clusterEntities) bump it differently each time | Regex-normalize `/geid_\\d+_(\\d+)/g` → `seed-edge-$1` at JSON-write time |

**Both the recorder and the test apply ALL THREE fixes identically**, so the live server response in tests matches the recorded fixture byte-for-byte.

## Corruption-Test Evidence

Acceptance gate from Task 2: deliberately corrupt one fixture, run the test, confirm it FAILS with a clear diff.

```bash
# Corrupt:
echo '{"success":true,"data":{"nodes":999}}' > tests/fixtures/pre-migration/api-stats.json

# Run the test:
npm test -- tests/integration/rest-contract.test.ts
# Result: 1 failed | 9 passed (10). Failed test: "GET /api/stats matches frozen
# contract + byte-equal fixture". The Zod schema parse succeeded on the response
# (the corrupted fixture wasn't compared against the schema; only the live
# response is) — the corrupt fixture surfaced via toEqual's structural diff
# showing the missing fields the live response has and the fixture lacks
# (evidenceCount, patternCount, orphanCount, etc).

# Restore:
git checkout tests/fixtures/pre-migration/api-stats.json
npm test -- tests/integration/rest-contract.test.ts
# Result: 10/10 passed. Lock fires as designed.
```

**Conclusion: the byte-equal lock detects any fixture mutation; combined with the Zod schema (which fires on the live-response shape side), both server-side AND fixture-side drift are caught.**

## Task Commits

**OKM inner repo** (`bmw.ghe.com/.../operational-knowledge-management`):

1. **`6be0114`** — `test(contract): pre-cutover REST fixtures + Zod contract tests (Phase 43 D-G5.1 part 1)`
   - 14 files changed, 1999 insertions / 0 deletions (additive only)

**Outer rapid-automations** (`bmw.ghe.com/.../rapid-automations`):

2. **`89940a3`** — `chore: bump OKM submodule — Phase 43 Plan 06 (REST contract baseline)`
   - 1 file changed (gitlink bump `0f08980 → 6be0114`)

## Test Pass Count

- **rest-contract.test.ts in isolation:** 10/10 passed.
- **Full OKM suite:** 503 / 505 passed (= Plan 05 baseline 493/495 + 10 new tests). 2 failures + 7 file-load errors are pre-existing (reference `src/llm/providers/` which doesn't exist in OKM). No regression introduced by Plan 06.

## Deviations from Plan

**1. Three iterations to reach idempotence.**
- **Found during:** First idempotence check (Task 1 acceptance gate `diff -r run1/ run2/`) revealed two bytes of drift in api-clusters.json (cluster count + modularity differed) and the auto-generated `geid_<N>_<idx>` edge keys differed across api-relations / api-export.
- **Issues:** (a) Louvain falls back to Math.random for tie-breaking when no rng option is supplied; (b) graphology's auto-edge-key counter is process-wide and varies between recorder runs based on sub-graph clone count in intelligence helpers.
- **Fix:** Added mulberry32(0x43_06_5E_ED) Math.random pin + regex edge-key normalization at JSON-write boundary. Both fixes mirrored byte-for-byte in the contract test so byte-equal still holds.
- **Impact on plan:** Determinism setup is now a 3-layer stack instead of just the Date freeze the plan envisioned. SUMMARY documents the full stack as a pattern for future contract-locking plans.

**2. `POST /api/rca/lookup` body instead of `GET /api/rca-lookup?entityId=...`.**
- **Found during:** Task 1 step 1 (endpoint enumeration via grep on routes.ts).
- **Discovery:** The actual OKM router has `POST /api/rca/lookup` with body `{query, domain?, limit?, includeChains?, maxChainDepth?, layer?, includeExpired?}`. There is no `GET /api/rca-lookup`. The plan's stated query-string spec (`?entityId=<id>`) doesn't match OKM's reality.
- **Fix:** Locked the actual `POST /api/rca/lookup` with body `{query: "memory leak"}`. Produces a stable 4-match response (Memory Leak Anti-pattern + Memory Spike + Batch Processor + Cache Configuration Pattern) with causal chains.
- **Impact on plan:** Plan's D-G5.1 endpoint list needs an erratum noting OKM's actual signature. The fixture filename (api-rca-lookup.json) matches the plan's expectation, so file-path references in must_haves and downstream Plan 10 stay aligned.

**3. Seed via direct store API rather than POST /api/entities.**
- **Found during:** Task 1 step 2 design phase.
- **Issue:** POST /api/entities works for fixed UUIDs (the createEntity handler honors body `id`), but the GraphStore.addEntity layer ALWAYS overrides `updatedAt` with `new Date().toISOString()`. So fixed-timestamp fixtures still need the Date freeze. Given the freeze is needed anyway, the question was whether to also incur HTTP round-trip cost for 7 entities + 5 relations.
- **Fix:** Direct store API call (graphStore.addEntity + graphStore.addEdge), no HTTP. The Date freeze still pins server-side `new Date()` for endpoints that touch it (stats.lastUpdated).
- **Impact on plan:** Slightly faster recorder (no HTTP server-side overhead for seeding); slightly less coverage of the create endpoints (which we're not locking anyway since they're POSTs not GETs). SUMMARY documents the choice.

**4. 10 endpoints recorded instead of the D-G5.1 minimum 8.**
- **Found during:** Plan's explicit invitation ("D-G5.1's list is the minimum, not an exhaustive cap").
- **Fix:** Added 2 OKM extras: `GET /api/ontology/entity-types` (sibling to /api/ontology/classes, stable shape) + `GET /api/graph/connectivity` (read-only, stable). Both broaden the post-cutover diff surface at zero cost.
- **Impact on plan:** None — all acceptance gates use `>=` thresholds. Plan 10's post-cutover verification will gain these two extra anchors.

**Total deviations:** 4 — 1 substantive (3-layer determinism vs 1-layer), 1 erratum (RCA POST vs GET), 1 architectural choice (direct store seeding), 1 additive (OKM extras). All documented.

## Issues Encountered

- **graphology auto-edge-key non-determinism is process-global, not per-instance.** Each recorder invocation is a fresh Node process, so the counter resets — but sub-graph clones inside intelligence helpers (analyzeConnectivity, Louvain's internal copy) bump the counter unpredictably before our explicit `addEdge` calls. Without normalization the first 5 edges had keys like `geid_135_0..4` in one run and `geid_120_0..4` in another. The `<idx>` suffix IS deterministic (per-graph insertion order); regex-normalizing the prefix while keeping the suffix preserves the deterministic part.

- **Louvain non-determinism via Math.random.** Library docs document an `rng` option but `clusterEntities` (in src/intelligence/clustering.ts) doesn't pass one. Since src changes were out of plan scope, the process-level Math.random override is the surgical fix. Same seed in recorder + test → same partition → byte-equal /api/clusters response.

- **No test currently asserts on `/api/cleanup/resolve-entities`.** Confirmed in Plan 05 SUMMARY too. This plan doesn't add one either — that endpoint isn't in D-G5.1's lock list (it's a mutation endpoint, not a read; fixtures-lock targets read endpoints for post-cutover verification). Plan 10 may want to add resolve-entities to its checklist once Plan 08's storage cutover is done.

## User Setup Required

None — Plan 06 is fixtures + tests only. Operator can sanity-check end-to-end:

```bash
cd /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management
npm run build
node scripts/record-rest-fixtures.mjs   # idempotent — re-run produces zero diff
git status -s tests/fixtures/pre-migration/   # expected: empty
npm test -- tests/integration/rest-contract.test.ts   # expected: 10/10 pass
```

## Next Phase Readiness

**Plan 43-07 (JSON replay)** has no dependency on Plan 06's deliverables — separate scope.

**Plan 43-08 (storage cutover)** is the consumer that Plan 06 unblocks:
- After Plan 08 cuts over IGraphStore → GraphKMStore (the underlying storage backend changes), Plan 10's verification re-runs the SAME `rest-contract.test.ts` AND the SAME `record-rest-fixtures.mjs`.
- **Pass criterion:** the re-recorded fixtures are byte-equal to the Plan-06-locked fixtures. The Zod schemas haven't changed. The test still passes.
- **Fail criteria:** Plan 8's cutover changed the REST surface (different field name, different ordering, different value computation). Plan 10 fails loudly with a Zod / toEqual diff pointing at the exact endpoint and field.

**Plan 10 verification spine = same tests + same fixtures + post-cutover server.** This plan's whole purpose is delivered when Plan 10 runs.

**Recorder is the operator escape valve:** if the SEED changes (someone adds an entity/relation), running `node scripts/record-rest-fixtures.mjs` regenerates the fixtures in-place. The Zod schemas in the test still apply (shape lock); only the byte-equal locks need re-recording. Plan 10 should re-record after any seed change AND after the cutover, then compare to the Plan-06 baseline.

---
*Phase: 43-okm-cross-repo-migration-c*
*Plan: 06 (Wave 2)*
*Completed: 2026-05-31*
