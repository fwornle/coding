---
phase: 40-ingest-pipeline-layered-dedup
plan: 03
subsystem: dedup
tags: [km-core, ingest-pipeline, dedup, layered-dedup, embedding, cosine, dedup-01, qdrant-agnostic, caller-supplied-client]

# Dependency graph
requires:
  - phase: 40-ingest-pipeline-layered-dedup/01
    provides: "src/dedup/types.ts — EmbeddingLayer interface + MatchResult type; tests/unit/_helpers/fakes.ts — universal mkEntity builder"
provides:
  - "src/dedup/CosineEmbeddingMatcher.ts — embedding-cosine dedup layer (D-44 layer 2 of 3) implementing EmbeddingLayer; exports EmbeddingClient caller-supplied dependency interface; default threshold 0.90 per RESEARCH A2 + Pitfall 4"
  - "tests/unit/_helpers/fakes-embedding.ts — co-located fake makeFakeEmbeddingClient factory (Warning #4 fix: lives next to EmbeddingClient interface so Plan 40-01's universal fakes.ts has zero forward references to later waves)"
  - "tests/unit/cosine-matcher.test.ts — 7 unit tests covering empty candidates, cosine 1.0 identity, below-threshold, 0.89/0.91 boundary, self-match guard, best-of-3 candidates, textOf override"
affects:
  - 40-05 (LayeredDeduplicator) — consumes the EmbeddingLayer slot type-safely; can drive CosineEmbeddingMatcher in integration tests via the same makeFakeEmbeddingClient factory
  - 40-07 (root barrel) — appends `CosineEmbeddingMatcher` + `EmbeddingClient` re-exports; src/dedup/types.ts will re-export `EmbeddingClient` once Plan 07 lands (TODO already pinned at the bottom of types.ts)
  - 41 (A INT-01) — A's adapter wires Qdrant into the EmbeddingClient interface; reuses CosineEmbeddingMatcher as the embedding layer for its IngestPipeline
  - 42 (B INT-02) — B's adapter wires its embedding store into EmbeddingClient

# Tech tracking
tech-stack:
  added: []  # zero new dependencies — verbatim cosine math + caller-supplied client
  patterns:
    - "Caller-supplied dependency interface — `EmbeddingClient` is declared and exported in the same file that depends on it, mirroring `OntologyRegistry`/`registryBackedValidator` precedent. km-core takes no Qdrant dependency."
    - "Verbatim algorithm port with SOURCE-comment header — the cosine() helper is the 9-line port from A's scripts/dedup-insights-by-embedding.js:56-64. Header documents source + 5 deltas applied (interface, threshold, client, textOf, no-console-log)."
    - "Co-located test fake — `makeFakeEmbeddingClient` lives in `tests/unit/_helpers/fakes-embedding.ts` (next to the matcher), not in Plan 40-01's universal fakes.ts. Pattern 40-T2 (Co-located Test Fakes per Client Interface) from Plan 40-01 — applied to the EmbeddingClient interface."
    - "Forward-reference test pattern — RED-state tests import from a source file created in the same plan's GREEN task. vitest's `Cannot find module` is the RED signal; the GREEN commit creates the source file and the suite goes green in one run."

key-files:
  created:
    - "~/Agentic/km-core/src/dedup/CosineEmbeddingMatcher.ts (155 LOC) — class implementing EmbeddingLayer; exports EmbeddingClient interface + CosineEmbeddingMatcherOpts; private verbatim cosine() helper"
    - "~/Agentic/km-core/tests/unit/_helpers/fakes-embedding.ts (43 LOC) — co-located makeFakeEmbeddingClient factory; deterministic Math.sin-per-text-length fallback for unkeyed texts"
    - "~/Agentic/km-core/tests/unit/cosine-matcher.test.ts (158 LOC) — 7 tests in one describe-block"
  modified: []  # plan is net-new files only — no existing km-core files touched

key-decisions:
  - "Default threshold 0.90 — between A's insight-dedup 0.93 and insight-merge 0.88 per RESEARCH A2 + Pitfall 4. Single-surface starting point; documented in the threshold field's JSDoc that callers MUST tune per their embedding model + content type (short identifiers cluster higher than paragraph embeddings)."
  - "EmbeddingClient interface is owned by CosineEmbeddingMatcher.ts (not by src/dedup/types.ts). Plan 40-07 (root barrel) will add the re-export `export type { EmbeddingClient } from './CosineEmbeddingMatcher.js'` in src/dedup/types.ts — the TODO marker is already in types.ts at lines 27-31."
  - "Co-located fake makeFakeEmbeddingClient (Warning #4 fix) — lives in tests/unit/_helpers/fakes-embedding.ts, NOT in Plan 40-01's universal fakes.ts. Keeps Plan 40-01's fakes.ts compilable from its own landing commit with no forward references; consistent with Plan 40-04's parallel placement of makeMockLLMClient."
  - "Self-match guard uses `candidates[i].id === entity.id` (id-based, not name-based) — mirrors the JaccardNameMatcher self-match guard (Plan 40-02) and RESEARCH Example 3 line 414. Branded EntityId equality is safe even when two distinct entities accidentally share a `name`."
  - "Parallel embed via Promise.all — entity + every candidate's text are awaited in one batch. v0.1 always round-trips every candidate text through `client.embed()`; D-46 keeps the candidate pool small (ontologyClass-scoped, active-only) so this is acceptable. Phase 41/42 may add an `EmbeddingClient.search()` fast path overload later."

patterns-established:
  - "Pattern 40-T2-applied (Co-located Test Fakes per Client Interface): the EmbeddingClient interface ships its fake in tests/unit/_helpers/fakes-embedding.ts (next to its matcher), not in the universal fakes.ts barrel. Plan 40-04 applies the same pattern for LLMClient → fakes-llm.ts."
  - "Pattern 40-T4 (Forward-Reference RED/GREEN in one plan): a single plan can ship its failing tests (RED commit) AND its source (GREEN commit). The RED state is `Cannot find module ../../src/...` from vitest; the GREEN commit creates the source file and the suite goes green in the same plan."
  - "Pattern 40-T5 (Verbatim Math Port + Class Wrap): when porting a pure math helper from another repo (here A's cosine), keep the math byte-identical in a private file-level function and wrap the class around it. The class implements the framework interface (EmbeddingLayer); the math stays a recognizable mirror of the source so port fidelity is grep-verifiable."

requirements-completed: [DEDUP-01]

# Metrics
duration: 4min
completed: 2026-05-21
---

# Phase 40 Plan 03: CosineEmbeddingMatcher Summary

**Verbatim port of A's 9-line cosine helper (`scripts/dedup-insights-by-embedding.js:56-64`) into a class implementing the D-44 `EmbeddingLayer` interface, with a caller-supplied `EmbeddingClient` dependency so km-core takes no Qdrant dependency. Default threshold 0.90 (between A's insight-dedup 0.93 and insight-merge 0.88 per RESEARCH A2 + Pitfall 4); tune-per-surface guidance pinned in the JSDoc. Co-located fake `makeFakeEmbeddingClient` ships next to the matcher per the Warning #4 fix.**

## Performance

- **Duration:** ~4 min
- **Tasks:** 3 (Task 1 RED, Task 2 GREEN, Task 3 build + regression)
- **Commits:** 2 in `~/Agentic/km-core/` + 1 metadata commit in this coding/ worktree (handled by orchestrator)
- **Files created:** 3 in km-core (~356 LOC total) + 1 in coding/ (this SUMMARY)
- **Files modified:** 0
- **Test count delta:** +7 tests (post-plan baseline: 115 tests / 12 files — includes Wave 1's parallel +9 from 40-02 + 40-04 that landed concurrently)

## Accomplishments

- **EmbeddingLayer impl shipped** — `CosineEmbeddingMatcher` implements the D-44 `EmbeddingLayer` interface from `src/dedup/types.ts`. The class structure follows RESEARCH.md Example 3 (offset 375-437) and PATTERNS.md offset 332-399: ctor takes `{ client, threshold?, textOf? }` (D-14 options-object); `async match(entity, candidates) => MatchResult` returns the framework's structured result type.
- **Verbatim cosine math** — the 9-line `cosine()` helper is a byte-identical port from `/Users/Q284340/Agentic/coding/scripts/dedup-insights-by-embedding.js:56-64`. Pure function, no allocations beyond locals, returns 0 when either vector is zero-length or zero-norm.
- **`EmbeddingClient` interface exported** — caller-supplied dependency. Phase 41 (A INT-01) wires Qdrant; Phase 42 (B INT-02) wires B's embedding store. km-core stays Qdrant-agnostic.
- **Default threshold 0.90, tune-per-surface documented** — the threshold field's JSDoc explains the choice (between A's insight-dedup 0.93 and insight-merge 0.88 per RESEARCH A2) AND mandates per-surface tuning (Pitfall 4 mitigation — short identifiers cluster higher than paragraph embeddings; MiniLM-L6-v2 single-project docs cluster 0.75-0.82 per A's `retrieval-service.js:38-45` commentary).
- **7 unit tests, all green** — covers the 7 cases listed in PATTERNS.md offset 739-747: empty candidates, cosine 1.0 identity, below-threshold, 0.89/0.91 boundary (default 0.90), self-match guard (`id ===` check), best-of-3 candidates, textOf override.
- **Co-located fake ships in the same plan** — `tests/unit/_helpers/fakes-embedding.ts` exports `makeFakeEmbeddingClient(opts?)` with deterministic-vector fallback (`Math.sin(i * text.length)`) for unkeyed texts. Plan 40-05 (LayeredDeduplicator) and Plans 41/42 can reuse this fake for their EmbeddingLayer integration tests.

## Task Commits

Both tasks committed atomically in `~/Agentic/km-core/`:

1. **Task 1 (RED): failing tests + co-located fake** — `1c8f4e1` (`test(40-03): add failing tests + co-located fake EmbeddingClient (RED)`)
2. **Task 2 (GREEN): CosineEmbeddingMatcher impl** — `4804a04` (`feat(40-03): implement CosineEmbeddingMatcher (GREEN)`)
3. **Task 3:** verification-only — no source files touched; build + full suite passed; runtime smoke confirmed `threshold=0.9`.

**Plan metadata (this SUMMARY):** committed in this coding/ worktree via the orchestrator's metadata commit step (`docs(40-03): summary`).

## Files Created/Modified

- `~/Agentic/km-core/src/dedup/CosineEmbeddingMatcher.ts` (155 LOC, created) — `class CosineEmbeddingMatcher implements EmbeddingLayer`, `export interface EmbeddingClient`, `export interface CosineEmbeddingMatcherOpts`, private `cosine()` helper. SOURCE-comment header cites A's `dedup-insights-by-embedding.js:56-64` + 5 deltas (interface, threshold, client, textOf, no-console-log). All relative imports use `.js` suffix. Zero `console.*`.
- `~/Agentic/km-core/tests/unit/_helpers/fakes-embedding.ts` (43 LOC, created) — `export function makeFakeEmbeddingClient(opts?)`. Header documents the Warning #4 motivation + file-name convention. `vi.fn(...)` backing so callers can assert `embed` call args (used by the textOf-override test).
- `~/Agentic/km-core/tests/unit/cosine-matcher.test.ts` (158 LOC, created) — single `describe('CosineEmbeddingMatcher', ...)` block with 7 `test(...)` cases. Imports CosineEmbeddingMatcher + EmbeddingClient from the forward-referenced source file, mkEntity from Plan 40-01's universal fakes.ts, makeFakeEmbeddingClient from this plan's co-located fakes-embedding.ts.

## Verification

### RED→GREEN cycle (Task 1 → Task 2)

- **RED (after Task 1 commit):** `cd ~/Agentic/km-core && npx vitest run tests/unit/cosine-matcher.test.ts` → `Cannot find module '../../src/dedup/CosineEmbeddingMatcher.js'`. Log: `/tmp/40-03-task-1-red.log`.
- **GREEN (after Task 2 commit):** same command → `Test Files 1 passed (1) / Tests 7 passed (7)`. Log: `/tmp/40-03-task-2-green.log`.

### Task 2 acceptance criteria (all pass)

- File `src/dedup/CosineEmbeddingMatcher.ts` exists — YES.
- `implements EmbeddingLayer` count: **1**.
- `export interface EmbeddingClient` count: **1**.
- `this.threshold = opts.threshold ?? 0.90` count: **1**.
- Verbatim cosine present (`Math.sqrt(na * nb)`): **1**.
- Self-match guard (`candidates[i].id === entity.id`): **1**.
- Tune-per-surface JSDoc hits (`tune`/`per surface`/`MiniLM`/`0.75-0.82`): **4** matches (well above ≥1 floor).
- `console.*` count outside comments: **0**.
- Relative imports missing `.js` suffix: **0**.
- All 7 tests pass; the `-t "score"` filter (RESEARCH offset 935) hits one test cleanly.

### Task 3 acceptance criteria

- `npm run build` exit 0 — clean (no `error TS` lines in `/tmp/40-03-task-3-build.log`).
- `dist/dedup/CosineEmbeddingMatcher.js` exists — YES.
- `dist/dedup/CosineEmbeddingMatcher.d.ts` exists — YES.
- `npx vitest run` (full suite) — `Test Files 12 passed (12) / Tests 115 passed (115)`. Log: `/tmp/40-03-task-3-full-suite.log`. (Suite count includes Wave 1's other plans 40-02 + 40-04 which landed concurrently on km-core/main.)
- Runtime smoke per plan's `<verification>` block: `node -e "import('./dist/...').then(m => { const c = new m.CosineEmbeddingMatcher({ client: { embed: async () => [1,0] } }); ... })"` → prints `threshold=0.9` ✓.

## Decisions Made

See `key-decisions` in frontmatter — five decisions:

1. **Threshold default 0.90** — between A's insight-dedup 0.93 and insight-merge 0.88 (RESEARCH A2 + Pitfall 4). Documented as a single-surface starting point with mandatory caller tuning.
2. **EmbeddingClient interface owned by CosineEmbeddingMatcher.ts** — re-exported from `src/dedup/types.ts` by Plan 40-07; TODO marker already in types.ts.
3. **Co-located fake (Warning #4)** — `makeFakeEmbeddingClient` ships in `tests/unit/_helpers/fakes-embedding.ts`, not in Plan 40-01's universal `fakes.ts`. Consistent with Plan 40-04's parallel `fakes-llm.ts`.
4. **Self-match via `id ===`** — branded EntityId equality (not name-based) per RESEARCH Example 3 line 414; mirrors Plan 40-02's JaccardNameMatcher guard.
5. **Parallel embed via Promise.all** — entity + every candidate's text awaited in one batch. v0.1; D-46 keeps candidate pools small; Phase 41/42 may add a `search()` fast-path overload later.

## Deviations from Plan

None — plan executed exactly as written. RED → GREEN → build/regress completed cleanly; all acceptance criteria pass on first attempt.

## EmbeddingClient Re-export (Plan 07 deferred)

The plan's `<output>` requires noting that the EmbeddingClient interface is now exported and ready for re-export from `src/dedup/types.ts` (deferred to Plan 40-07's barrel landing). The TODO marker is already present at the bottom of `src/dedup/types.ts` (Plan 40-01):

```typescript
// Plan 40-07 (root barrel) will add the `EmbeddingClient` + `LLMClient`
// type re-exports here once Plans 40-03 + 40-04 land their matcher files:
//   export type { EmbeddingClient } from './CosineEmbeddingMatcher.js';
//   export type { LLMClient } from './LLMSemanticMatcher.js';
```

Both source files now exist on `km-core/main` (this plan + Plan 40-04 just landed in parallel). Plan 40-07 can resolve the marker.

## Warning #4 Co-location Note

`tests/unit/_helpers/fakes-embedding.ts` ships as part of this plan, not as part of Plan 40-01. This is the Warning #4 fix from 40-01-PLAN's `<objective>`: client-interface fakes ship co-located with their interfaces (in the same plan), keeping Plan 40-01's universal `fakes.ts` compilable end-to-end at its own landing commit with no forward references to Wave 1 source files. Plan 40-04 applies the same pattern with `fakes-llm.ts` + `makeMockLLMClient`. Future client-interface plans should follow this convention.

## Issues Encountered

None. No checkpoints, no auth gates, no architectural deviations. Parallel-wave I/O on `~/Agentic/km-core` (Plans 40-02 and 40-04 writing their files concurrently) was handled by staging only this plan's own files at each commit — no `git add .` / `git add -A` used.

## Next Phase Readiness

**Wave 2 unblocked.** Plan 40-05 (LayeredDeduplicator) can now consume `CosineEmbeddingMatcher` as the `embedding` layer slot; the `makeFakeEmbeddingClient` factory is available for integration tests. Plan 40-07 (root barrel) can re-export `CosineEmbeddingMatcher` + `EmbeddingClient` once the matcher landings of Wave 1 are all confirmed (this plan + 40-02 + 40-04).

- **Plan 40-05 (LayeredDeduplicator):** import `EmbeddingLayer` from `src/dedup/types.ts` for the typed slot; drive integration tests via `makeFakeEmbeddingClient` (this plan's fake) + the universal `makeLayerStub({ kind: 'embedding', ... })` from Plan 40-01's `fakes.ts` for unit-level layer mocking.
- **Plan 40-07 (root barrel):** resolve the TODO marker in `src/dedup/types.ts` (re-export `EmbeddingClient` from `./CosineEmbeddingMatcher.js`); append `export { CosineEmbeddingMatcher }` + `export type { EmbeddingClient }` to `src/index.ts` per PATTERNS.md offset 566-589.

No blockers, no concerns.

## Self-Check: PASSED

- Created files exist:
  - `/Users/Q284340/Agentic/km-core/src/dedup/CosineEmbeddingMatcher.ts` — FOUND
  - `/Users/Q284340/Agentic/km-core/tests/unit/_helpers/fakes-embedding.ts` — FOUND
  - `/Users/Q284340/Agentic/km-core/tests/unit/cosine-matcher.test.ts` — FOUND
- Commits exist in `~/Agentic/km-core/`:
  - `1c8f4e1` (`test(40-03): add failing tests + co-located fake EmbeddingClient (RED)`) — FOUND
  - `4804a04` (`feat(40-03): implement CosineEmbeddingMatcher (GREEN)`) — FOUND
- `tsc --noEmit` clean: PASSED (exit 0)
- `npm run build` clean: PASSED (exit 0)
- `dist/dedup/CosineEmbeddingMatcher.js` + `.d.ts` present: PASSED
- `npx vitest run` full-suite zero-regression: PASSED (12 files / 115 tests)
- Runtime smoke (`threshold=0.9`): PASSED

---
*Phase: 40-ingest-pipeline-layered-dedup*
*Completed: 2026-05-21*
