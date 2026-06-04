---
status: resolved
trigger: "Phase 44 typed views bugs: /api/coding/observations throws '.for is not iterable' and /api/v1/entities returns empty despite 1327 migrated entities"
created: 2026-06-04T00:00:00Z
updated: 2026-06-04T00:45:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis_bug1: "`_kmStore.graph` is a private field on GraphKMStore (line 137 of GraphKMStore.ts). The transpiled JS still exposes the slot but in the bundled @fwornle/km-core dist it may be mangled or the `.graph` property is just `undefined`, and `undefined.nodeEntries()` would throw 'Cannot read .nodeEntries of undefined'. The actual error `.for is not iterable` means `for await (const [...] of _kmStore.graph.nodeEntries())` is iterating on `undefined`/non-iterable. Fix: replace `_kmStore.graph.nodeEntries()` with the public `store.findByOntologyClass(cls)` which is the canonical API."
  hypothesis_bug2: "All 2129 nodes in general.json have `validUntil: null` (not undefined). km-core's `isActive(entity, nowMs)` (GraphKMStore.ts:539-542) short-circuits ONLY when `entity.validUntil === undefined`; null falls through to `new Date(null).getTime() > nowMs` which is `0 > now` → false → entity treated as superseded. Both `findByOntologyClass` and `iterate` filter superseded entities out by default (D-34). Hence /api/v1/entities returns []. Fix: relax `isActive` to treat `null` as equivalent to `undefined` (both are 'no expiry'), which is the OKM legacy semantic AND consistent with what JSON round-trips through to disk."
  confirming_evidence:
    - "GraphKMStore.ts line 137: `private graph: MultiDirectedGraph<Entity, Relation>;`"
    - "GraphKMStore.ts line 539-542: `if (entity.validUntil === undefined) return true;` — strict undefined check only"
    - "general.json analysis: 2129/2129 nodes have `validUntil: null`, NOT undefined"
    - "Live curl: /api/v1/entities returns {data:[]}, /api/coding/observations returns 500 with `.for is not iterable`"
    - "obs-api log shows km-core opened successfully and routes mounted"
  falsification_test: "Apply the isActive null-tolerance fix in km-core and a public-API fix in obs-api; rebuild km-core; restart obs-api; expect both endpoints to return 874/2129 entities"
  fix_rationale: "Bug 1 fix uses the canonical public API per the JSDoc (`findByOntologyClass`) which already enforces Pitfall 3 two-field OR-check internally; Bug 2 fix is a one-line BC compatibility patch for the very common JSON serialization pattern where `undefined` becomes `null`"
  blind_spots:
    - "Whether any tests rely on null being treated as superseded — need to grep tests"
    - "Whether the migration should have written `validUntil: undefined` instead (different fix location)"

## Symptoms

expected:
  - /api/v1/entities returns ~2129 entities (or at least 1327 system=A migrated)
  - /api/coding/observations returns 874 observations with total=874
  - /api/coding/digests returns 373 with total=373
  - /api/coding/insights returns 80 with total=80
actual:
  - /api/coding/observations: HTTP 500 with body {"error":"Failed to query observations"} and log ".for is not iterable"
  - /api/v1/entities: {"success":true,"data":[]} (empty)
  - /api/v1/entities?ontologyClass=Observation&includeSuperseded=true: also empty (handler doesn't pass through includeSuperseded)
errors:
  - "[obs-api] /api/coding/observations error: .for is not iterable"
reproduction:
  - "curl http://localhost:12436/api/v1/entities and /api/coding/observations"
started: After Plan 44-06 + 44-03+06-REFIT migration loaded 1327 A-system entities

## Eliminated

## Evidence

- timestamp: 2026-06-04T00:00:00Z
  checked: obs-api process state via launchctl
  found: "com.coding.obs-api running PID 90677"
  implication: server is up; bug is in code path not crash

- timestamp: 2026-06-04T00:00:00Z
  checked: live curl /api/v1/entities (and with ontologyClass=Observation, includeSuperseded=true)
  found: "All return {success:true, data:[]}"
  implication: Bug 2 confirmed — entities loaded but query returns empty

- timestamp: 2026-06-04T00:00:00Z
  checked: live curl /api/coding/observations
  found: "HTTP 500 {error: Failed to query observations}; /tmp/obs-api.log says '.for is not iterable'"
  implication: Bug 1 confirmed — graph.nodeEntries() iterator broken

- timestamp: 2026-06-04T00:00:00Z
  checked: km-core/dist/store/GraphKMStore.d.ts public surface
  found: "`private graph`; public API has findByOntologyClass, iterate, getEntity, etc. but NO .graph accessor"
  implication: `_kmStore.graph.nodeEntries()` is illegal — fix by switching to public API

- timestamp: 2026-06-04T00:00:00Z
  checked: km-core/src/api/handlers/entities.ts (canonical GET /entities)
  found: "uses store.findByOntologyClass(cls) when cls provided, else `for await (const e of store.iterate())`"
  implication: This is the canonical pattern. Bug 1 fix must mirror it.

- timestamp: 2026-06-04T00:00:00Z
  checked: GraphKMStore.ts line 539-542 isActive() and 556-570 findByOntologyClass
  found: "isActive: `if (entity.validUntil === undefined) return true;` THEN `new Date(validUntil).getTime() > nowMs`. findByOntologyClass calls isActive when !includeSuperseded."
  implication: When validUntil=null, falls through to Date check; new Date(null).getTime()=0; 0>now is false; entity treated as superseded.

- timestamp: 2026-06-04T00:00:00Z
  checked: .data/knowledge-graph/exports/general.json — all 2129 node attributes
  found: "Total nodes: 2129. By entityType: System=1, Project=11, Component=7, SubComponent=347, Detail=312, Config=16, Port=6, Container=16, Process=27, File=16, Fault=12, Service=10, Knowledge=7, StaticDiagnostics=11, RuntimeDiagnostics=2, Feature=1, Observation=874, Digest=373, Insight=80. By legacyId.system: B=802, A=1327. validUntil: null=2129, undefined=0, set=0."
  implication: All 2129 nodes have validUntil=null — explains why ALL queries return empty. This is the root cause of Bug 2, including why the 802 'B' system entities (which were working pre-Plan-44) are now also invisible. This is a REGRESSION wider than just Phase 44 migration.

- timestamp: 2026-06-04T00:00:00Z
  checked: Node script verifying isActive math
  found: "null === undefined: false. new Date(null).getTime() = 0. So isActive returns false for ALL entities with validUntil=null."
  implication: One-line km-core fix: `if (entity.validUntil === undefined || entity.validUntil === null) return true;`

- timestamp: 2026-06-04T00:30:00Z
  checked: live curl /api/v1/entities + /api/coding/* after fix + rebuild + kickstart
  found: "/api/v1/entities?limit=5000 returns 2129 entities. /api/coding/observations total=874. /api/coding/digests total=373. /api/coding/insights total=80. Matches expected counts exactly."
  implication: BOTH bugs fully resolved.

- timestamp: 2026-06-04T00:35:00Z
  checked: km-core graph-store.test.ts (all 34 tests)
  found: "34 passed (34) — no regression on the isActive widening"
  implication: Fix is safe; no test relies on null being treated as superseded.

## Resolution

root_cause: |
  Bug 1: scripts/observations-api-server.mjs iterated `_kmStore.graph.nodeEntries()` but `graph` is a private field on GraphKMStore (line 137 of GraphKMStore.ts). The canonical public API is `store.findByOntologyClass(cls)`.

  Bug 2: lib/km-core/src/store/GraphKMStore.ts isActive() short-circuited on `validUntil === undefined` only; Phase 42/44 migrations stamp `validUntil: null`. `new Date(null).getTime() === 0`, which is `<= nowMs`, so every persisted entity was treated as superseded and filtered out by D-34 active-only default in both findByOntologyClass and iterate.

fix: |
  Bug 1: collectByOntologyClass(cls) → returns _kmStore.findByOntologyClass(cls). One-line replacement.

  Bug 2: isActive widens BC short-circuit: `if (entity.validUntil === undefined || entity.validUntil === null) return true;`. JSDoc updated to document JSON-roundtrip rationale.

verification: |
  All 4 endpoints return correct totals: /api/v1/entities=2129; /api/coding/observations total=874; /api/coding/digests total=373; /api/coding/insights total=80. km-core unit tests: 34/34 pass.

files_changed:
  - lib/km-core/src/store/GraphKMStore.ts
  - lib/km-core/dist/store/GraphKMStore.{js,d.ts,js.map,d.ts.map} (regenerated via npm run build)
  - scripts/observations-api-server.mjs
  - .planning/phases/44-rest-api-git-snapshots/44-DEBUG-SUMMARY-typed-views.md (new)
