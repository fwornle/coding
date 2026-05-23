---
phase: 42-offline-ukb-migration-b
plan: 04
subsystem: shared (km-core)
tags: [km-core, embedding, qdrant, fastembed, schema-extension, cross-repo, d-52, d-52a, d-52c]
requires:
  - "@fwornle/km-core Phase 37 (GraphKMStore.iterate / putEntity / mergeAttributes / open / close)"
  - "@fwornle/km-core Phase 40 (EmbeddingClient interface in src/dedup/CosineEmbeddingMatcher.ts)"
  - "@fwornle/km-core Phase 41 (./maintenance sub-path precedent; resolveEntities/mergeEntities sibling ops)"
  - "fastembed@^2.1.0 npm package (same version pinned in coding repo for B's existing src/embedding/embedding-service.ts)"
provides:
  - "@fwornle/km-core Entity.embedding?: number[] schema extension (D-52)"
  - "@fwornle/km-core/maintenance — syncQdrantFromStore (D-52a) + QdrantClient/SyncQdrantOptions/SyncQdrantResult/SyncQdrantEvent types"
  - "@fwornle/km-core/embeddings — FastembedEmbeddingClient default (D-52c) + FastembedEmbeddingClientOpts/FastembedQueryable/FlagEmbeddingInit types"
  - "Root barrel re-exports of all three Phase 42 surfaces (dual sub-path + root availability per Phase 38/40/41 precedent)"
affects:
  - "Phase 42 Plan 05 (wave-controller migration) — will consume Entity.embedding + FastembedEmbeddingClient"
  - "Phase 42 Plan 07 (cleanup + e2e) — will invoke syncQdrantFromStore for Qdrant rebuild"
  - "Phase 43 (C migration) — same FastembedEmbeddingClient is the default for C's re-embed pass"
tech-stack:
  added:
    - "fastembed@^2.1.0 (runtime dependency in km-core)"
  patterns:
    - "Caller-supplied client (D-52a follows Phase 40 LLMClient pattern — km-core stays Qdrant-agnostic at the type level)"
    - "Lazy-init with retry-safe _initPromise reset (Phase 28 memory note carried to FastembedEmbeddingClient)"
    - "Dual availability: sub-path (@fwornle/km-core/embeddings, @fwornle/km-core/maintenance) AND root barrel (@fwornle/km-core)"
    - "Stub injection via opts.initializer hook keeps tests fast (no ~80MB ONNX download)"
key-files:
  created:
    - path: "/Users/Q284340/Agentic/km-core/src/maintenance/syncQdrantFromStore.ts"
      purpose: "Post-hoc Qdrant index rebuild from km-core canonical entity store (D-52a) — minimal structural QdrantClient interface defined locally"
    - path: "/Users/Q284340/Agentic/km-core/src/embeddings/FastembedEmbeddingClient.ts"
      purpose: "Default EmbeddingClient impl wrapping fastembed AllMiniLML6V2 (D-52c) — lazy-init, stub-injectable, retry-safe"
    - path: "/Users/Q284340/Agentic/km-core/src/embeddings/index.ts"
      purpose: "Sub-barrel for the new ./embeddings sub-path"
    - path: "/Users/Q284340/Agentic/km-core/tests/unit/types/entity-embedding.test.ts"
      purpose: "4 tests covering Entity.embedding type + round-trip + mergeAttributes"
    - path: "/Users/Q284340/Agentic/km-core/tests/unit/maintenance/syncQdrantFromStore.test.ts"
      purpose: "8 tests covering syncQdrantFromStore behavior contract (batching, errors, payload shape, idempotency)"
    - path: "/Users/Q284340/Agentic/km-core/tests/unit/embeddings/FastembedEmbeddingClient.test.ts"
      purpose: "6 tests covering default model selection, lazy-init, EmbeddingClient conformance, dual-barrel availability"
  modified:
    - path: "/Users/Q284340/Agentic/km-core/src/types/entity.ts"
      change: "Added optional embedding?: number[] field after legacyId? with 4-point JSDoc (D-52 origin, optional rationale, store pass-through, dimension convention)"
    - path: "/Users/Q284340/Agentic/km-core/src/maintenance/index.ts"
      change: "Sub-barrel now exports syncQdrantFromStore + QdrantClient/SyncQdrantOptions/SyncQdrantResult/SyncQdrantEvent types"
    - path: "/Users/Q284340/Agentic/km-core/src/index.ts"
      change: "Root barrel now re-exports FastembedEmbeddingClient + syncQdrantFromStore + their type surfaces (Phase 42 INT-02 block)"
    - path: "/Users/Q284340/Agentic/km-core/package.json"
      change: "Added ./embeddings sub-path to exports map (alphabetical, between ./dedup and ./maintenance); added fastembed@^2.1.0 dependency"
key-decisions:
  - "Real EmbeddingClient interface is single-text (embed(text: string) → Promise<Float32Array | number[]>), not batch as the plan's <interfaces> block claimed; FastembedEmbeddingClient implements the real single-text shape and exposes a separate embedBatch() method for batch ergonomics — preserves CosineEmbeddingMatcher contract."
  - "QdrantClient is a structural interface defined inside syncQdrantFromStore.ts (not pulled from @qdrant/* SDK). Callers wrap their concrete client to match the upsert(collection, points) shape; km-core stays Qdrant-agnostic at the type level (mirrors Phase 40 LLMClient pattern)."
  - "Point id contract: legacyId.id when present, else entity.id. Plan 7's Qdrant rebuild stays stable across re-syncs even after canonical Entity.id changes."
  - "Default cacheDir for fastembed is package-local (.fastembed-cache) rather than the host-specific <projectRoot>/local_cache the plan-text suggested — keeps the default portable; callers override via opts.cacheDir."
  - "Stub injection via constructor opts.initializer keeps tests fast — no ~80MB ONNX download in CI. Production callers do NOT override the initializer (the default IS the D-52c contract)."
  - "EmbeddingModel type narrowed to Exclude<EmbeddingModel, CUSTOM>; CUSTOM paths need extra modelAbsoluteDirPath/modelName plumbing the default client deliberately does not surface (D-52c pins AllMiniLML6V2)."
  - "Dual availability: every Phase 42 surface (syncQdrantFromStore, FastembedEmbeddingClient) re-exports from both its sub-path AND the root barrel (Phase 38/40/41 precedent); reaches consumers regardless of their import style."

patterns-established:
  - "Pattern P42-04-1: Stub-injectable initializer hook for slow lazy-loaded clients — applies whenever a km-core default client wraps a heavy native dependency (ONNX, GPU, etc.)"
  - "Pattern P42-04-2: Structural caller-supplied client interface for vendor SDKs km-core wishes to remain agnostic of — defined locally in the consuming maintenance op rather than imported (extends Phase 40's LLMClient precedent to Qdrant)"
  - "Pattern P42-04-3: Per-batch try/catch in maintenance sweeps — failing batch records every entity id into errors[] with the caught message, then continues to the next batch (mirrors Phase 41 resolveEntities resilience)"

requirements-completed: ["INT-02"]

# Metrics
duration: 12m
completed: 2026-05-23T13:27:40Z
---

# Phase 42 Plan 04: km-core Embedding/Qdrant/Fastembed Surfaces Summary

**Three additive km-core surfaces landed on the host repo — `Entity.embedding?: number[]` (D-52), `syncQdrantFromStore` maintenance op (D-52a), and `FastembedEmbeddingClient` default (D-52c) — that Plans 5 and 7 of Phase 42 will consume. All changes land in `/Users/Q284340/Agentic/km-core/`; zero coding-repo source files touched. Full km-core test suite green at 242/242 (baseline 224, +18).**

## Performance

- **Duration:** ~12 min (TDD: 6 commits across 3 tasks)
- **Started:** 2026-05-23T13:15Z
- **Completed:** 2026-05-23T13:27:40Z
- **Tasks:** 4 (Task 4 = cross-repo commit verification)
- **Files created (km-core):** 6 (3 source + 3 test)
- **Files modified (km-core):** 4 (entity.ts + maintenance/index.ts + index.ts + package.json + package-lock.json)
- **Files modified (coding):** 0 (cross-repo plan — only this SUMMARY commit lands in coding)

## Accomplishments

1. **Entity.embedding?: number[] (D-52).** Phase 39 schema extended with an optional top-level embedding field. A-side stays a no-op (no embeddings computed); B-side wave-controller (Plan 05) and C-side migration (Phase 43) will now write embeddings through the canonical type rather than fishing them through metadata casts.
2. **syncQdrantFromStore (D-52a).** Caller-supplied-client maintenance op under `@fwornle/km-core/maintenance` rebuilds Qdrant from the canonical km-core store. Idempotent (overwrite by point id); per-batch try/catch records failures into `errors[]` without aborting the sweep. Plan 07 will invoke this once after the in-place LevelDB migration to populate the search index from a single source of truth.
3. **FastembedEmbeddingClient default (D-52c).** Drop-in `EmbeddingClient` implementation under a NEW `@fwornle/km-core/embeddings` sub-path. Lazy-init, retry-safe, stub-injectable. Plan 05's wave-controller embedding-operator becomes a thin pass-through to this client.

## Task Commits

All commits land in the sibling km-core repo via `git -C /Users/Q284340/Agentic/km-core`. The TDD gate produced a RED+GREEN pair per task (the plan asked for 3 task-level commits; TDD strict mode requires the RED test commit to land before the source — surfaced as expected per the executor's TDD rules).

| # | Hash | Phase | Subject |
|---|------|-------|---------|
| 1 | `a16c6d9` | T1 RED  | test(42-04): add failing tests for Entity.embedding (D-52 schema extension) |
| 2 | `23d68d7` | T1 GREEN | feat(42-04): add optional embedding field to canonical Entity (D-52) |
| 3 | `669136a` | T2 RED  | test(42-04): add failing tests for syncQdrantFromStore (D-52a) |
| 4 | `b5a9652` | T2 GREEN | feat(42-04): syncQdrantFromStore maintenance op (D-52a) |
| 5 | `7435518` | T3 RED  | test(42-04): add failing tests for FastembedEmbeddingClient (D-52c) |
| 6 | `e423c46` | T3 GREEN | feat(42-04): FastembedEmbeddingClient default + ./embeddings sub-path (D-52c) |

Verification:
```
git -C /Users/Q284340/Agentic/km-core log --oneline | grep -c '42-04'    # → 6
git -C /Users/Q284340/Agentic/km-core diff HEAD~6 HEAD --stat | grep -cE 'embedding|syncQdrant|Fastembed'   # → 6 (≥3 AC met)
```

**Coding-repo metadata commit:** Records this SUMMARY + STATE.md + ROADMAP.md update.

## Files Created/Modified

### km-core (cross-repo)

| Path | Change | LoC |
|------|--------|-----|
| `src/types/entity.ts` | Added `embedding?: number[]` field with 4-point JSDoc | +25 |
| `src/maintenance/syncQdrantFromStore.ts` | NEW — maintenance op + QdrantClient structural type | 217 |
| `src/maintenance/index.ts` | Sub-barrel re-exports new op + types | +11 |
| `src/embeddings/FastembedEmbeddingClient.ts` | NEW — default EmbeddingClient impl | 221 |
| `src/embeddings/index.ts` | NEW — sub-barrel | 17 |
| `src/index.ts` | Root barrel re-exports Phase 42 INT-02 block | +35 |
| `package.json` | Added `./embeddings` exports entry + fastembed@^2.1.0 dep | +5 |
| `package-lock.json` | npm install fastembed | +637 |
| `tests/unit/types/entity-embedding.test.ts` | NEW — 4 tests | 189 |
| `tests/unit/maintenance/syncQdrantFromStore.test.ts` | NEW — 8 tests | 322 |
| `tests/unit/embeddings/FastembedEmbeddingClient.test.ts` | NEW — 6 tests | 195 |

Total: 11 km-core files (6 created + 5 modified), 1,874 line insertions across all 6 commits.

### Coding repo

Only this SUMMARY.md + STATE.md / ROADMAP.md / REQUIREMENTS.md updates land here.

## Test Count Delta

| Stage | km-core test count |
|-------|---------------------|
| Baseline (pre-Plan-04) | 224 across 25 files |
| After Task 1 (Entity.embedding) | 228 (+4) |
| After Task 2 (syncQdrantFromStore) | 236 (+8) |
| After Task 3 (FastembedEmbeddingClient) | 242 (+6) |
| **Final** | **242 across 28 files (+18 net)** |

`cd /Users/Q284340/Agentic/km-core && npm test` exits 0. Zero Phase 37/38/39/40/41 regression.

## Container-side Verification (carry-forward from Plan 01)

Plan 01 bind-mounts `${HOME}/Agentic/km-core` into `coding-services` at `/coding/node_modules/@fwornle/km-core:ro`. The bind-mount picks up new code immediately when `npm run build` runs on the host — no Docker rebuild needed.

```
$ docker exec coding-services node -e "
    import('@fwornle/km-core').then(m => {
      console.log('FastembedEmbeddingClient:', typeof m.FastembedEmbeddingClient);
      console.log('syncQdrantFromStore:', typeof m.syncQdrantFromStore);
      console.log('GraphKMStore:', typeof m.GraphKMStore);
    })"
FastembedEmbeddingClient: function
syncQdrantFromStore: function
GraphKMStore: function
```

All three new symbols resolve inside the container via the bind mount. Phase 42 Plan 05 will consume these from `wave-controller.ts` / `persistence-agent.ts`.

## Decisions Made

See `key-decisions` in the frontmatter. Two design choices deserve narrative:

### 1. Why a structural `QdrantClient` interface instead of `@qdrant/js-client-rest` import

Phase 40 established the precedent that km-core defines minimal **structural** interfaces for vendor SDKs (`LLMClient`, `EmbeddingClient`) rather than depending on the concrete packages. The caller wraps their actual client (`@qdrant/js-client-rest`, `qdrant-client`, etc.) to match the structural shape. Benefits:

- Zero vendor lock-in in the km-core type surface.
- Vendor SDK upgrades inside the consumer (B in Phase 42, C in Phase 43) don't ripple into km-core's package.json.
- Tests use `vi.fn()` stubs against the structural type — no need to mock a real SDK.

The wrapper is a 3-line adapter:

```ts
const qdrantClient: QdrantClient = {
  upsert: async (collection, points) =>
    void (await realClient.upsert(collection, { points })),
};
```

### 2. Why a separate `embedBatch()` method instead of overloading `embed()`

The actual `EmbeddingClient` interface in `src/dedup/CosineEmbeddingMatcher.ts` takes a single text. Overloading `embed()` to also accept `string[]` would either (a) require an awkward `string | string[]` union with conditional return type that breaks the interface contract, or (b) shadow the interface with a class-only batch overload that wouldn't satisfy `EmbeddingClient` consumers (`CosineEmbeddingMatcher`, `LayeredDeduplicator`).

Splitting batch into a separate `embedBatch()` method mirrors B's existing pattern (`src/embedding/embedding-service.ts` has both `embedOne` and `embedBatch`) and keeps the EmbeddingClient interface clean. Plan 05's wave-controller can call either:

- `client.embed(text)` for per-entity embed (interface-conformant; the path CosineEmbeddingMatcher uses)
- `client.embedBatch(texts, 64)` for bulk operator pass (no interface conformance needed; the path the wave embedding-operator uses)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug fix] Plan's claimed `EmbeddingClient.embed` signature was wrong**

- **Found during:** Task 3 (write FastembedEmbeddingClient against the existing `EmbeddingClient` interface)
- **Issue:** The plan's `<interfaces>` block (lines 110-113) cited the existing km-core `EmbeddingClient` interface as `embed(texts: string[]): Promise<number[][]>`. The ACTUAL interface in `src/dedup/CosineEmbeddingMatcher.ts:56-58` is `embed(text: string): Promise<Float32Array | number[]>` (single text → single vector). Implementing the plan's claimed batch shape would have BROKEN the existing `CosineEmbeddingMatcher` contract (it calls `client.embed(text)` with a single string at lines 118-120).
- **Fix:** Implement `embed(text: string): Promise<number[]>` per the REAL interface; expose a separate `embedBatch(texts: string[]): Promise<number[][]>` for batch ergonomics. The plan's Test 2 (which called `client.embed(['hello', 'foo'])`) was adapted to call `client.embedBatch(...)` instead. Documented in source header (`src/embeddings/FastembedEmbeddingClient.ts:30-50`) and the Task 3 RED-test commit message.
- **Verification:** Test 4 in `FastembedEmbeddingClient.test.ts` constructs a `CosineEmbeddingMatcher` with the new client — compiles and runs cleanly, proving the structural interface contract is honored.
- **Committed in:** Task 3 RED `7435518` (test re-shape) + GREEN `e423c46` (impl)

**2. [Rule 1 — Bug fix] fastembed `init()` `model` type is narrower than `EmbeddingModel`**

- **Found during:** Task 3 GREEN (first tsc build attempt)
- **Issue:** `FlagEmbedding.init({ model, cacheDir })` requires `model: Exclude<EmbeddingModel, CUSTOM>` for the standard (non-custom) init path. Passing a generic `EmbeddingModel` triggers TS2769 "No overload matches this call".
- **Fix:** Narrowed `FastembedEmbeddingClientOpts.model`, `FlagEmbeddingInit.model`, and the private `model` field to `Exclude<EmbeddingModel, EmbeddingModel.CUSTOM>`. CUSTOM paths require additional `modelAbsoluteDirPath`/`modelName` plumbing the default client deliberately does not surface (D-52c pins AllMiniLML6V2). Source comment documents the rationale.
- **Verification:** `npm run build` exits 0 after the narrowing.
- **Committed in:** Task 3 GREEN `e423c46`

**3. [Rule 2 — auto-add critical functionality] fastembed dependency added to km-core**

- **Found during:** Task 3 GREEN (resolving `import { FlagEmbedding } from 'fastembed'`)
- **Issue:** km-core's `package.json` did NOT carry `fastembed` before this plan. The plan's RESEARCH §6 Open Question 4 flagged this as "needs verification": "is fastembed a dependency of B today (so km-core just adopts the same pinned version)?" Answer: it's a dependency of the **coding repo** (host project, version `^2.1.0`), but **NOT** of km-core. km-core had to acquire it to make FastembedEmbeddingClient functional.
- **Fix:** `npm install --save fastembed@^2.1.0` — matches the version already pinned in `/Users/Q284340/Agentic/coding/package.json`. Same package both repos use.
- **Verification:** `package.json` and `package-lock.json` updated; `npm run build` passes; container-side `import('@fwornle/km-core')` resolves the new symbols.
- **Committed in:** Task 3 GREEN `e423c46`
- **Threat-model note:** Plan's `<threat_model>` row `T-42-04-SC` flagged "fastembed already in B's package.json; ASSUMED — verify via npmjs.com/package/fastembed package-legitimacy check". `fastembed@2.1.0` is published by `Anush008` (https://www.npmjs.com/package/fastembed) — a well-known maintainer with a multi-year history; the same package the coding repo already trusted. Legitimate.

**4. [Plan-text discrepancy — documented, not a code change] Plan called for 3 task-level commits; TDD produced 6**

- **Found during:** Task 4 verification (`grep -c '42-04'` returned 6, not the 3 the plan's done criterion stated).
- **Issue:** The plan's task table (Task 4 action step 2) says "3 commits, one per task — preserves blast radius separation". The executor's TDD gate requires a RED test commit BEFORE the GREEN source commit per task. Strict TDD = 2 commits per `tdd="true"` task = 6 total for the 3 TDD tasks.
- **Resolution:** The 6 commits IS the canonical TDD shape and is preserved verbatim. The plan's Task 4 AC `grep -c '42-04'` returns 6 (≥3 satisfied). The plan's AC `git diff HEAD~3 HEAD --stat` was loosened to `HEAD~6 HEAD` in this verification, producing the same content — 6 files matching `embedding|syncQdrant|Fastembed`. AC intent met.
- **Action item:** None. Plan 7's e2e gate may want to re-flatten the 6 commits via squash before publication, OR leave the RED/GREEN audit trail intact for review purposes — operator's discretion.

### Authentication Gates

None.

### Architectural Decisions (Rule 4)

None — all design choices stayed within the plan's pre-authorized expansion zones (D-52/D-52a/D-52c locked the shape; the deviations above are all bug-fixes or auto-additions within the plan's scope).

### Verification Failures

None. All 6 tests in Task 3 + 8 tests in Task 2 + 4 tests in Task 1 pass on first GREEN. Full km-core suite 242/242. Container-side resolution verified.

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` declared. T-42-04-SC (supply-chain) mitigation: fastembed@2.1.0 verified as the same legitimate package already trusted by the coding repo.

## Known Stubs

None. The source files contain no placeholder data sources, no hardcoded empty arrays flowing to consumers, no "TODO" markers in business logic. The `_sourceId: string` field on the internal `PointWithSourceId` type in `syncQdrantFromStore.ts` is documented as "Source entity id used ONLY for error-row attribution" — internal plumbing, not a stub.

## TDD Gate Compliance

| Task | RED commit | GREEN commit | REFACTOR commit | Status |
|------|------------|--------------|-----------------|--------|
| T1 — Entity.embedding | `a16c6d9` | `23d68d7` | none needed | PASS |
| T2 — syncQdrantFromStore | `669136a` | `b5a9652` | none needed | PASS |
| T3 — FastembedEmbeddingClient | `7435518` | `e423c46` | none needed | PASS |

RED commits compile-failed (TS2353 / module-not-found) before any source landed. GREEN commits land + all tests pass + full suite green + tsc clean. No REFACTOR commits needed — each task's source is single-purpose, focused, no duplication introduced.

## Phase 10 Verification (deferred)

Plan 04 does not advance the Phase 10 embedding fix end-to-end — it provides the **typed embedding field** that Plan 05's wave-controller migration will write through, and the **Qdrant rebuild op** that Plan 07's e2e gate will invoke after the in-place LevelDB migration. SC#2 ("every entity returned by `findByOntologyClass('Detail')` after a `ukb full` run has `embedding.length === 384`") is verified in Plan 07.

## Self-Check: PASSED

**Created files exist (km-core):**
- `/Users/Q284340/Agentic/km-core/src/maintenance/syncQdrantFromStore.ts` — FOUND
- `/Users/Q284340/Agentic/km-core/src/embeddings/FastembedEmbeddingClient.ts` — FOUND
- `/Users/Q284340/Agentic/km-core/src/embeddings/index.ts` — FOUND
- `/Users/Q284340/Agentic/km-core/tests/unit/types/entity-embedding.test.ts` — FOUND
- `/Users/Q284340/Agentic/km-core/tests/unit/maintenance/syncQdrantFromStore.test.ts` — FOUND
- `/Users/Q284340/Agentic/km-core/tests/unit/embeddings/FastembedEmbeddingClient.test.ts` — FOUND

**Commits exist (km-core git log):**
- `a16c6d9` (T1 RED) — FOUND
- `23d68d7` (T1 GREEN) — FOUND
- `669136a` (T2 RED) — FOUND
- `b5a9652` (T2 GREEN) — FOUND
- `7435518` (T3 RED) — FOUND
- `e423c46` (T3 GREEN) — FOUND

**Acceptance greps verified (all return >= expected):**
- T1 `grep -c 'embedding?: number\[\]' entity.ts` → 1 (≥1)
- T2 `test -f syncQdrantFromStore.ts` → exit 0
- T2 `grep -c 'syncQdrantFromStore' maintenance/index.ts` → 3 (≥1)
- T2 `grep -c 'export interface QdrantClient' syncQdrantFromStore.ts` → 1 (≥1)
- T3 `test -f FastembedEmbeddingClient.ts && test -f embeddings/index.ts` → exit 0
- T3 `grep -c 'implements EmbeddingClient' FastembedEmbeddingClient.ts` → 1 (≥1)
- T3 `grep -c '"./embeddings"' package.json` → 1 (≥1)
- T3 `grep -c 'FastembedEmbeddingClient' src/index.ts` → 6 (≥1)
- T4 `git log --oneline | grep -c '42-04'` → 6 (≥3)
- T4 `git status --short` (in km-core, excluding untracked `.data/`, `.specstory/`, `tests/fixtures/`) → clean

**Tests:** 242/242 pass (was 224 baseline, +18 net = 4+8+6 = exactly as planned).

**Container-side verification:** `docker exec coding-services node -e "import('@fwornle/km-core')..."` resolves `FastembedEmbeddingClient`, `syncQdrantFromStore`, AND the still-working Plan 01 surfaces (`GraphKMStore` etc.) — bind mount picks up the new code with no Docker rebuild.

**Phase 10 status:** typed embedding surface and Qdrant rebuild op landed; e2e verification deferred to Plan 07 SC#2 (per the cascading-deferral pattern from Plans 01/02/03).
