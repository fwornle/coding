---
phase: 40-ingest-pipeline-layered-dedup
plan: 02
subsystem: api
tags: [km-core, dedup, layered-dedup, jaccard, exact-name-layer, dedup-01, layer-port, tdd-red-green]

# Dependency graph
requires:
  - phase: 40-ingest-pipeline-layered-dedup/01
    provides: ExactNameLayer + MatchResult interfaces (src/dedup/types.ts) + mkEntity test builder (tests/unit/_helpers/fakes.ts)
  - phase: 39-entity-data-model/01
    provides: Entity type + EntityId branded id (consumed via src/index.ts / src/types/entity.ts)
provides:
  - "src/dedup/JaccardNameMatcher.ts — JaccardNameMatcher class implementing ExactNameLayer (D-44, layer 1 of 3). Pure transform; threshold default 0.85 (B production value per 40-RESEARCH A1); verbatim port of B's calculateStringSimilarity (deduplication.ts:436-445)."
  - "tests/unit/jaccard-matcher.test.ts — 7 contract-test cases per 40-PATTERNS.md offset 704-715. Exercises D-44 ExactNameLayer surface end-to-end (exact match, no-shared-words, case-normalization, threshold boundary, threshold opt, self-match guard, best-of-multiple)."
affects:
  - 40-05 (LayeredDeduplicator) — composes JaccardNameMatcher as `exactName` layer; the matcher's `readonly threshold` + async `match()` contract are the integration points.
  - 40-06a (IngestPipeline) — does not consume the matcher directly; the LayeredDeduplicator slot inside IngestPipeline pulls it indirectly.
  - 42 (B INT-02) — Phase 42 deletes B's local `calculateStringSimilarity` once B is migrated to consume `JaccardNameMatcher` from km-core. Until then, B keeps its local copy.

# Tech tracking
tech-stack:
  added: []  # pure port, zero new dependencies
  patterns:
    - "Verbatim algo port (40-PATTERNS Pattern F): SOURCE comment cites file + line range, DELTAS enumerated. The 5-line jaccard() core is byte-for-byte identical to B's calculateStringSimilarity body."
    - "Class-wraps-pure-function idiom (mirrors src/segments/merge.ts): the public class holds only ctor opts (threshold); the algorithm is a file-local pure function (`jaccard()`). Zero `this` state beyond the readonly threshold."
    - "ExactNameLayer interface implementation (D-44 layer 1 of 3): per-layer threshold + Promise<MatchResult>. First concrete implementer of the dedup type surface from Plan 40-01."

key-files:
  created:
    - /Users/Q284340/Agentic/km-core/src/dedup/JaccardNameMatcher.ts (77 LOC) — JaccardNameMatcher class + JaccardNameMatcherOpts interface + private `jaccard()` helper. Implements `ExactNameLayer` from src/dedup/types.ts. Threshold default 0.85 (B production value per 40-RESEARCH A1). No `console.*`; all relative imports use `.js` suffix per CF-D06.
    - /Users/Q284340/Agentic/km-core/tests/unit/jaccard-matcher.test.ts (151 LOC) — 7 contract tests covering D-44 ExactNameLayer behavior. Uses mkEntity from `_helpers/fakes.ts` (Plan 40-01). All UUIDv7-shaped EntityIds; deterministic Jaccard scores.
  modified: []  # net-new files only — no existing km-core files touched

key-decisions:
  - "Threshold default 0.85, NOT 0.9 (the 40-CONTEXT starting-point number). Per 40-RESEARCH A1, B's production similarityConfig.similarityThreshold value is 0.85 (deduplication.ts:61); the researcher recommends matching production to avoid Phase 42 migration drift. Plan 40-02-PLAN explicitly directs 0.85."
  - "Test-side numeric assertions for the boundary case use 12-word names (a..l vs a..k+m) yielding Jaccard = 11/13 ≈ 0.846 — just below the 0.85 default, just above a 0.5 override. The plan-author's example (\"one two three four five six\" vs \"one two three four five seven\") in the original RED commit yielded 5/7 ≈ 0.714 (not ~0.84 as the plan's test name implies). Corrected to 12-word pairs in the GREEN commit alongside the implementation. The boundary-test name is kept as documented (\"confidence 0.84\") since 0.846 rounds to 0.85 and the substantive contract — \"matched: false at default threshold\" — is unchanged."
  - "Cross-repo commit pattern (continuing Plan 40-01 convention): all code commits land on `~/Agentic/km-core` main (test(40-02) + feat(40-02)); SUMMARY.md commits in this coding/ worktree as `docs(40-02): summary`. Two separate commits, two separate repos, single plan."

requirements-completed: [DEDUP-01]  # layer 1 of 3 — DEDUP-01 stays open until 40-03 + 40-04 land

# Metrics
duration: 4min
completed: 2026-05-21
---

# Phase 40 Plan 02: JaccardNameMatcher Port Summary

**Layer 1 of 3: `JaccardNameMatcher` ships in km-core as a verbatim port of B's `calculateStringSimilarity` (9-line Jaccard) wrapped in a class implementing the D-44 `ExactNameLayer` interface from Plan 40-01. Threshold defaults to 0.85 (B's production value per RESEARCH A1); pure transform with zero I/O and zero diagnostics. 7 unit tests cover the full D-44 contract surface and pass alongside the 92-test pre-existing suite.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-21T16:43:06Z
- **Completed:** 2026-05-21T16:47:22Z
- **Tasks:** 3 (Task 1 = RED, Task 2 = GREEN, Task 3 = build + regression check)
- **Files created:** 2 in km-core (228 LOC total) + 1 in coding/ (this SUMMARY)
- **Files modified:** 0

## TDD Cycle

- **RED commit** (`b542471`): `test(40-02): add failing jaccard-matcher unit tests (RED)` — created the test file; vitest run reported `Error: Cannot find module '../../src/dedup/JaccardNameMatcher.js'` (logged in `/tmp/40-02-task-1-red.log`).
- **GREEN commit** (`897d20e`): `feat(40-02): implement JaccardNameMatcher (GREEN)` — added the source file; the same vitest invocation now reports `Test Files 1 passed (1) / Tests 7 passed (7)` (logged in `/tmp/40-02-task-2-green.log`). The GREEN commit also includes a small numeric-assertion correction in the test (see Deviations §1).
- **REFACTOR:** none needed — the implementation is the verbatim 5-line Jaccard wrapped in a 30-line class; no refactor opportunity that doesn't sacrifice clarity.

## Accomplishments

- **D-44 layer 1 of 3 lands** — `JaccardNameMatcher` implements `ExactNameLayer` from `src/dedup/types.ts` (Plan 40-01). The `readonly threshold` field is set via ctor opt with default 0.85 per 40-RESEARCH A1. `async match(entity, candidates): Promise<MatchResult>` iterates the ontologyClass-scoped candidate pool (D-46 — pipeline-supplied; layer impl does NOT re-filter), skips self-match (`candidate.id === entity.id`), picks the best-scoring candidate above threshold, and returns the canonical `{ matched, survivor?, confidence }` shape.
- **Verbatim algo port** — the private `jaccard()` helper is byte-for-byte identical to B's `calculateStringSimilarity` body (lines 436-445 of `integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts`):
  ```
  const words1 = new Set(a.toLowerCase().split(/\s+/));
  const words2 = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return union.size > 0 ? intersection.size / union.size : 0;
  ```
- **Threshold default 0.85** — matches B's production `similarityConfig.similarityThreshold` (deduplication.ts:61) per 40-RESEARCH A1. Phase 42 (INT-02) will delete B's local copy once B consumes the km-core matcher; matching production avoids cross-package drift.
- **7 contract tests pass** — covering exact match (confidence 1.0), no-shared-words (confidence 0), case-insensitivity (USER AUTH SERVICE ≡ user auth service), default-threshold boundary (Jaccard 11/13 ≈ 0.846 returns matched: false), threshold opt override (same pair against threshold 0.5 returns matched: true), self-match guard (same id → matched: false even on identical names), and best-of-multiple (Jaccard 0.867 vs 0.933 → 0.933 wins).
- **Build clean** — `npm run build` exits 0 with no `error TS`; `dist/dedup/JaccardNameMatcher.js` + `.d.ts` produced. `node -e "import('./dist/dedup/JaccardNameMatcher.js').then(m => new m.JaccardNameMatcher().threshold)"` returns `0.85` (verification step from PLAN).
- **Zero regression** — 92 pre-existing tests still pass; my 7 Jaccard tests bring the per-Plan-40-02 baseline to **99 tests / 10 test files** (verified via `npx vitest run --exclude 'tests/unit/llm-matcher.test.ts' --exclude 'tests/unit/cosine-matcher.test.ts'`).

## Task Commits

Each task was committed atomically in `~/Agentic/km-core/` on `main`:

1. **Task 1: RED test** — `b542471` (`test(40-02): add failing jaccard-matcher unit tests (RED)`)
2. **Task 2: GREEN implementation** — `897d20e` (`feat(40-02): implement JaccardNameMatcher (GREEN)`)
3. **Task 3: build + regression** — no source change; verification-only step. `npm run build` clean; `dist/dedup/JaccardNameMatcher.{js,d.ts}` produced.

**Plan metadata (this SUMMARY):** committed in this `coding/` worktree via the orchestrator's `git_commit_metadata` step (`docs(40-02): summary`).

## Files Created/Modified

- **`~/Agentic/km-core/src/dedup/JaccardNameMatcher.ts`** (77 LOC, created) — JaccardNameMatcher class + JaccardNameMatcherOpts interface + private `jaccard()` helper. Implements `ExactNameLayer`. Zero `console.*`; all relative imports use `.js` suffix. Threshold default 0.85.
- **`~/Agentic/km-core/tests/unit/jaccard-matcher.test.ts`** (151 LOC, created) — 7 contract tests. UUIDv7-shaped EntityIds differ in the last hex digit for the multi-candidate cases. Pure-function test pattern (no store; no I/O).

## Verification

- **TypeScript:** `cd ~/Agentic/km-core && npx tsc --noEmit` — exit 0, fully clean.
- **Targeted Jaccard tests:** `npx vitest run tests/unit/jaccard-matcher.test.ts` — `Test Files 1 passed (1) / Tests 7 passed (7)`.
- **Build:** `npm run build` — exit 0; `dist/dedup/JaccardNameMatcher.js` and `dist/dedup/JaccardNameMatcher.d.ts` exist.
- **Dist consumer:** `node -e "import('./dist/dedup/JaccardNameMatcher.js').then(m => { const j = new m.JaccardNameMatcher(); process.stdout.write('threshold=' + j.threshold + '\n'); })"` — `threshold=0.85`.
- **Full suite (my plan's scope):** `npx vitest run --exclude 'tests/unit/llm-matcher.test.ts' --exclude 'tests/unit/cosine-matcher.test.ts'` — `Test Files 10 passed (10) / Tests 99 passed (99)` = 92 baseline + 7 Jaccard. Zero regression.
- **All grep acceptance checks pass** for Tasks 1 + 2 (test count = 7; forward-reference import = 1; mkEntity import = 1; `implements ExactNameLayer` = 1; `this.threshold = opts.threshold ?? 0.85` = 1; `split(/\s+/)` = 2 occurrences; self-match guard present; zero `console.*` in non-comment lines; all relative imports use `.js`).

## Decisions Made

See `key-decisions` in frontmatter — three decisions tagged for STATE.md propagation:

1. **Threshold default 0.85** (not 0.9) per 40-RESEARCH A1 — matches B's production value to avoid Phase 42 migration drift.
2. **Test-side numeric assertions corrected** in the GREEN commit (see Deviations §1) — boundary tests use 12-word pairs yielding Jaccard 11/13 ≈ 0.846 instead of the plan-author's 6-word example which yielded 5/7 ≈ 0.714.
3. **Cross-repo commit pattern continued from Plan 40-01** — `feat(40-02)` / `test(40-02)` lands in km-core main; `docs(40-02): summary` lands in this coding/ worktree.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Boundary-test numeric assertions corrected in GREEN commit**

- **Found during:** Task 2 verify step (first `npx vitest run` after the implementation landed).
- **Issue:** The original RED commit (`b542471`) wrote the boundary test using the plan-author's example name pair (`'one two three four five six'` vs `'one two three four five seven'`). I incorrectly assumed the union size was 6 (counting one of the "different" words only); the actual Jaccard score is `5 / 7 ≈ 0.714` (union includes both `six` and `seven` → 7 elements), not `5 / 6 ≈ 0.833` as my `toBeCloseTo(5 / 6, 5)` assertion expected. When the implementation landed, `'threshold opt overrides default'` failed because `result.confidence = 0.714 ≠ 0.833`. The plan's PATTERNS.md explicitly notes in Task 1's action text: "pick names that yield ~0.84" — so the original 6-word example was acknowledged-stale in the plan itself.
- **Fix:** Replaced the 6-word pairs with 12-word pairs (`'a b c d e f g h i j k l'` vs `'a b c d e f g h i j k m'`) — 11 shared words + 1 unique each side → 11/13 ≈ 0.846. This is just below the 0.85 default (satisfies `'threshold default 0.85 — confidence 0.84 returns matched: false'`) and clearly above a 0.5 override (satisfies `'threshold opt overrides default'`). The boundary-test name remains as documented in the plan (`'… confidence 0.84 returns matched: false'`) — 0.846 rounds to 0.85 and the substantive contract (`matched: false` at default threshold) is unchanged.
- **Files modified:** `~/Agentic/km-core/tests/unit/jaccard-matcher.test.ts` — fixed in the GREEN commit alongside the new source file.
- **Verification approach:** ran `npx vitest run tests/unit/jaccard-matcher.test.ts` post-fix — all 7 tests pass.
- **Committed in:** `897d20e` (Task 2 GREEN commit; includes the test math correction).
- **Downstream impact:** none — the test still exercises the same D-44 contract behavior.

**2. [Rule 1 — Doc Bug, non-blocking] Plan acceptance criterion `npx vitest run … -t "score"` matches zero tests**

- **Found during:** Task 2 verify step.
- **Issue:** Plan 40-02 line 196 (`<acceptance_criteria>` for Task 2) includes "All 7 tests pass: `npx vitest run tests/unit/jaccard-matcher.test.ts -t \"score\"` from the Validation Architecture mapping is green." The `-t "score"` filter matches the substring "score" in test names. None of the 7 contract-test names (per 40-PATTERNS.md offset 704-715) contain the word "score" — they use "confidence", "matched", "candidate", "self-match" instead. Running `-t "score"` therefore selects zero tests and reports `Tests 7 skipped (7)`.
- **Fix:** Substantive acceptance is satisfied by `npx vitest run tests/unit/jaccard-matcher.test.ts` (no `-t` filter) reporting `Tests 7 passed (7)`. The `-t "score"` reference appears to be a Validation Architecture mnemonic ("Jaccard score tests") that drifted from the actual test names; no test was renamed to fit the criterion because the names are themselves directly prescribed by 40-PATTERNS.md offset 704-715.
- **Files modified:** none.
- **Downstream impact:** none — 40-VALIDATION.md (which the plan references) should be amended in a follow-up to either drop the `-t "score"` filter or rename a test to include "score". Out of scope for this plan.

### Parallel-Execution Observations (not deviations from my plan)

- **Plan 40-03 + 40-04 are landing on km-core main concurrently.** When I ran `npx vitest run` (full suite) at the start of Task 3, the suite reported `Test Files 1 failed | 11 passed (12) / Tests 106 passed (106)`. The single failed *file* is `tests/unit/llm-matcher.test.ts` — Plan 40-04's RED test, whose forward-referenced source (`src/dedup/LLMSemanticMatcher.ts`) is not yet committed by the 40-04 agent. The failing *test count* is 0 — the file fails to LOAD, no tests run from it. Plan 40-03's `CosineEmbeddingMatcher.ts` is already committed by the 40-03 agent and its 7 cosine tests pass.
- **My plan's scope is zero-regression.** Excluding the parallel agents' in-flight files: `--exclude 'tests/unit/llm-matcher.test.ts' --exclude 'tests/unit/cosine-matcher.test.ts'` → `Test Files 10 passed (10) / Tests 99 passed (99)` = 92 baseline + 7 Jaccard. Exactly the count the plan predicts.
- **No action taken on the parallel files** per the parallel_wave_note ("Their files_modified are DISJOINT from yours"). The 40-04 agent's GREEN commit will resolve the failing-file count to 0 once it lands; the wave-completion orchestrator owns that aggregation.

---

**Total deviations:** 2 auto-fixed Rule 1 (1 test-math bug in my own RED commit, fixed in GREEN; 1 stale `-t "score"` filter in the plan's acceptance criterion, non-blocking).
**Impact on plan:** None — both deviations are documentation-grade. The implementation matches Plan 40-02's spec verbatim (verbatim Jaccard port + ExactNameLayer impl + threshold default 0.85 + self-match guard).

## OKM Type-Shape Deltas

None — Plan 40-02 implements an interface from Plan 40-01 (which already locked the OKM deltas). The Jaccard algorithm itself is a verbatim port from B (no shape change). The class wrapper conforms exactly to D-44's `ExactNameLayer` signature.

## Issues Encountered

None blocking — the test-math bug in my own RED commit was caught at the GREEN verify step and resolved with the same commit that landed the implementation. No checkpoints; no human verification gates.

## Next Phase Readiness

**Plan 40-05 (LayeredDeduplicator) can now consume `JaccardNameMatcher` as the `exactName` layer** alongside 40-03's `CosineEmbeddingMatcher` (already on main) and 40-04's `LLMSemanticMatcher` (landing concurrently). The integration shape is:

```typescript
import { JaccardNameMatcher } from 'km-core/src/dedup/JaccardNameMatcher.js';
const exactName = new JaccardNameMatcher({ threshold: 0.85 }); // or omit opts for default
const result = await exactName.match(entity, candidates);
// result: { matched: boolean, survivor?: Entity, confidence: number }
```

No blockers, no concerns. Wave 1 — Plan 40-02 unblocked.

## Self-Check: PASSED

- Created files exist:
  - `/Users/Q284340/Agentic/km-core/src/dedup/JaccardNameMatcher.ts` — FOUND
  - `/Users/Q284340/Agentic/km-core/tests/unit/jaccard-matcher.test.ts` — FOUND
- Commits exist in `~/Agentic/km-core/` (verified via `git log --oneline | grep '(40-02)'`):
  - `b542471` (`test(40-02): add failing jaccard-matcher unit tests (RED)`) — FOUND
  - `897d20e` (`feat(40-02): implement JaccardNameMatcher (GREEN)`) — FOUND
- `tsc --noEmit` clean: PASSED
- `npx vitest run tests/unit/jaccard-matcher.test.ts`: 7 / 7 passed
- `npx vitest run` (excluding parallel-agent in-flight files): 99 / 10 zero failures — zero regression on my plan's scope
- `dist/dedup/JaccardNameMatcher.{js,d.ts}` exist after `npm run build`: PASSED
- `node -e "import('./dist/dedup/JaccardNameMatcher.js').then(m => new m.JaccardNameMatcher().threshold)"` returns `0.85`: PASSED

---
*Phase: 40-ingest-pipeline-layered-dedup*
*Completed: 2026-05-21*
