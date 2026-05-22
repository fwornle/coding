---
phase: 40-ingest-pipeline-layered-dedup
plan: 09
subsystem: layered-dedup-matchers-gap-closure
tags: [dedup, matchers, gap-closure, CR-02, self-id-guard, legacy-id-re-extraction, DEDUP-01]

# Dependency graph
requires:
  - phase: 40-ingest-pipeline-layered-dedup/02
    provides: JaccardNameMatcher — the defect site for CR-02 layer 1/3.
  - phase: 40-ingest-pipeline-layered-dedup/03
    provides: CosineEmbeddingMatcher — the defect site for CR-02 layer 2/3.
  - phase: 40-ingest-pipeline-layered-dedup/04
    provides: LLMSemanticMatcher — the defect site for CR-02 layer 3/3.
  - phase: 40-ingest-pipeline-layered-dedup/07
    provides: barrel exports — surface remains byte-identical (no public API change).

provides:
  - "src/dedup/JaccardNameMatcher.ts (amended) — CR-02 self-id guard removed (was line 53); CR-02 comment block + JSDoc updated."
  - "src/dedup/CosineEmbeddingMatcher.ts (amended) — CR-02 self-id guard removed (was line 123); CR-02 comment block added."
  - "src/dedup/LLMSemanticMatcher.ts (amended) — CR-02 self-id filter removed from existingNames construction (was line 132); CR-02 comment block added."
  - "tests/unit/{jaccard,cosine,llm}-matcher.test.ts (amended) — 1 new CR-02 test per file pinning the legacy-id re-extraction GREEN behavior against future regression; 2 obsolete self-match tests in jaccard + cosine REPLACED (they pinned the now-removed buggy behavior)."
  - "dist/dedup/{JaccardNameMatcher,CosineEmbeddingMatcher,LLMSemanticMatcher}.{js,d.ts} — regenerated; matchers now correctly handle legacy-id re-extraction."

affects:
  - 40-VERIFICATION.md gap #2 (CR-02) — CLOSED.
  - 40-REVIEW.md BLOCKER finding CR-02 — RESOLVED.
  - Phase 41/42/43 consumers — legacy-id re-extraction path now produces the correct dedup verdict across all 3 layers; consumers can safely rely on supersession-stamping instead of silently writing duplicates when extractors re-emit previously-stored entities.
  - 40-10 / 40-11 — remaining gap-closure plans (CR-03 + WR-08; SC#1 example) unaffected.

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Self-write protection is the store's job, not the matcher's — the matchers stay pure (no `this` state beyond ctor opts, no I/O); identity dedup is the store's putEntity supersession path."
    - "D-46 (active-only candidate pool) is load-bearing for CR-02 — because the pipeline pre-filters by ontologyClass + active-only, an exact id collision in the candidate pool means the SAME LOGICAL ENTITY, which IS what dedup must catch (legacy-id re-extraction)."
    - "Legacy-test replace-and-append pattern — when a pre-existing test pins the now-incorrect old behavior, REPLACE it with the new-contract test instead of appending (the obsolete test would otherwise fail forever); net test count delta stays +1 per file."

key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/km-core/src/dedup/JaccardNameMatcher.ts (+7/-3 lines — guard removed + CR-02 comment + JSDoc rewrite)
    - /Users/Q284340/Agentic/km-core/src/dedup/CosineEmbeddingMatcher.ts (+8/-4 lines — guard removed + CR-02 comment + class JSDoc updated)
    - /Users/Q284340/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts (+9/-3 lines — filter removed + CR-02 comment)
    - /Users/Q284340/Agentic/km-core/tests/unit/jaccard-matcher.test.ts (+15/-11 lines — legacy self-match test REPLACED with CR-02 test)
    - /Users/Q284340/Agentic/km-core/tests/unit/cosine-matcher.test.ts (+22/-17 lines — legacy self-match test REPLACED with CR-02 test)
    - /Users/Q284340/Agentic/km-core/tests/unit/llm-matcher.test.ts (+52/-0 lines — appended CR-02 test)

key-decisions:
  - "Legacy self-match tests (jaccard-matcher.test.ts:110-120 + cosine-matcher.test.ts:102-117) directly asserted the now-incorrect self-id guard behavior — they pinned the CR-02 bug. Per Rule 1 (auto-fix bugs), these tests were REPLACED with the new CR-02 legacy-id re-extraction tests instead of appending alongside. The plan's claim 'no test relied on the guard's behavior' was discovered to be incorrect during execution; documented under Deviations."
  - "Net test count delta: jaccard 7→7 (replace), cosine 7→7 (replace), llm 9→10 (append) = +1 net total. The plan's acceptance criteria expected 7→8 + 7→8 + 9→10 = +3 net; the actual outcome is +1 net because the two obsolete tests in jaccard and cosine had to be removed. Plan-acceptance text updated under Deviations; the goal-level success criterion (CR-02 closed + all 24 final matcher tests green) is satisfied."
  - "CR-02 comment block cloned verbatim (same 5 lines) across all 3 matchers — uniform diagnostic for grep-based audits + zero-drift between layers."
  - "JaccardNameMatcher class JSDoc rewritten — the 'Identity guard via candidate.id === entity.id prevents self-match' sentence is gone; replaced with the post-CR-02 contract paragraph."
  - "LLM matcher fix sits OUTSIDE the try/catch block — the existingNames construction is pre-try, so removing the filter doesn't change error-handling semantics. The fix is a 1-line construction change + the comment block."

# Phase-40 close-gate context
gap_closure: true
requirements: [DEDUP-01]

metrics:
  duration: "~8 min wall clock (1 RED test commit + 1 GREEN fix commit + 1 SUMMARY commit)"
  tasks: 3
  files_created: 1   # 40-09-SUMMARY.md
  files_modified: 6  # 3 matchers + 3 test files
  tests_added_net: 1   # +3 CR-02 tests; -2 obsolete legacy self-match tests
  tests_total_after: 146
  completed: "2026-05-22"
---

# Phase 40 Plan 09: CR-02 Gap Closure Summary

**One-liner:** Three surgical edits across `JaccardNameMatcher.ts`, `CosineEmbeddingMatcher.ts`, and `LLMSemanticMatcher.ts` close BLOCKER CR-02 from `40-REVIEW.md` — the dead/wrong `candidate.id === entity.id` self-id guard is removed from all 3 dedup layers, so the legacy-id re-extraction path now produces the correct dedup verdict (matched: true with the colliding candidate as survivor) instead of silently writing duplicates.

## What This Plan Delivered

### km-core commits

| Step | Subject | Hash |
|------|---------|------|
| Task 1 (RED) | `test(40-09): add RED tests pinning CR-02 legacy-id re-extraction across all 3 matchers` | `e35dc00` |
| Task 2 (GREEN) | `fix(40-09): CR-02 remove self-id guards from all 3 matchers` | `849370d` |

### coding/ commit (this SUMMARY)

`docs(40-09): summary — CR-02 closed across all 3 matchers`

## CR-02 — Per-Matcher Diff (verbatim)

### Layer 1/3: JaccardNameMatcher

**Pre-fix (removed line)** — `src/dedup/JaccardNameMatcher.ts:53`:

```typescript
for (const candidate of candidates) {
  if (candidate.id === entity.id) continue; // never match self
  const score = jaccard(entity.name, candidate.name);
  if (score >= this.threshold && (!best || score > best.score)) {
    best = { candidate, score };
  }
}
```

**Post-fix (CR-02 comment block + guard gone)** — `src/dedup/JaccardNameMatcher.ts:50-62`:

```typescript
async match(entity: Entity, candidates: Entity[]): Promise<MatchResult> {
  let best: { candidate: Entity; score: number } | null = null;
  // CR-02 fix (40-REVIEW.md): no self-id guard. By D-46 (active-only
  // candidate pool), an exact id collision means the same logical
  // entity — which IS what dedup is meant to catch (legacy-id
  // re-extraction). Self-write protection is the store's job, not
  // the matcher's. See 40-REVIEW.md CR-02 + 40-VERIFICATION.md gap #2.
  for (const candidate of candidates) {
    const score = jaccard(entity.name, candidate.name);
    if (score >= this.threshold && (!best || score > best.score)) {
      best = { candidate, score };
    }
  }
```

Additional JSDoc rewrite — the class doc-comment's previous "Identity guard via `candidate.id === entity.id` prevents self-match against the entity's own row in the candidate pool." sentence is replaced with: "Per CR-02 (40-REVIEW.md), no self-id guard — exact id collision IS the same logical entity (legacy-id re-extraction path) and IS the match dedup must catch. Self-write protection is the store's job."

### Layer 2/3: CosineEmbeddingMatcher

**Pre-fix (removed line)** — `src/dedup/CosineEmbeddingMatcher.ts:123`:

```typescript
let best: { candidate: Entity; score: number } | null = null;
for (let i = 0; i < candidates.length; i++) {
  if (candidates[i].id === entity.id) continue;
  const score = cosine(entityVec, candidateVecs[i]);
  if (score >= this.threshold && (!best || score > best.score)) {
    best = { candidate: candidates[i], score };
  }
}
```

**Post-fix (CR-02 comment block + guard gone)** — `src/dedup/CosineEmbeddingMatcher.ts:121-133`:

```typescript
let best: { candidate: Entity; score: number } | null = null;
// CR-02 fix (40-REVIEW.md): no self-id guard. By D-46 (active-only
// candidate pool), an exact id collision means the same logical
// entity — which IS what dedup is meant to catch (legacy-id
// re-extraction). Self-write protection is the store's job, not
// the matcher's. See 40-REVIEW.md CR-02 + 40-VERIFICATION.md gap #2.
for (let i = 0; i < candidates.length; i++) {
  const score = cosine(entityVec, candidateVecs[i]);
  if (score >= this.threshold && (!best || score > best.score)) {
    best = { candidate: candidates[i], score };
  }
}
```

Class JSDoc updated — the prior "Self-match guard: skips `candidates[i]` where `id === entity.id`" paragraph replaced with the post-CR-02 contract paragraph (no self-id guard; exact id collision IS the same logical entity).

### Layer 3/3: LLMSemanticMatcher

**Pre-fix (removed filter clause)** — `src/dedup/LLMSemanticMatcher.ts:131-133`:

```typescript
const existingNames = candidates
  .filter((c) => c.id !== entity.id)
  .map((c) => c.name);
```

**Post-fix (CR-02 comment block + filter gone)** — `src/dedup/LLMSemanticMatcher.ts:131-138`:

```typescript
// CR-02 fix (40-REVIEW.md): no self-id filter. By D-46 (active-only
// candidate pool), an exact id collision means the same logical
// entity — which IS what dedup is meant to catch (legacy-id
// re-extraction). Self-write protection is the store's job, not
// the matcher's. See 40-REVIEW.md CR-02 + 40-VERIFICATION.md gap #2.
const existingNames = candidates.map((c) => c.name);
```

## Test Count Delta

| File | Before 40-09 | After 40-09 | Delta | Notes |
|------|--------------|-------------|-------|-------|
| `tests/unit/jaccard-matcher.test.ts` | 7 | 7 | 0 | Legacy self-match test REPLACED with CR-02 test (pinned now-incorrect behavior) |
| `tests/unit/cosine-matcher.test.ts` | 7 | 7 | 0 | Legacy self-match test REPLACED with CR-02 test (pinned now-incorrect behavior) |
| `tests/unit/llm-matcher.test.ts` | 9 | 10 | +1 | CR-02 test APPENDED (no obsolete legacy assertion to replace) |
| **Matcher tests subtotal** | **23** | **24** | **+1** | |
| **Full vitest suite** | 145 (post-40-08) | 146 | +1 | Same delta — all changes are in the 3 matcher test files |

All 24 matcher tests + 146 full-suite tests pass post-fix. `tsc --noEmit` clean. `npm run build` clean.

## Layer Interface Preservation

All 3 layer interfaces from `src/dedup/types.ts` (Plan 40-01 contracts) remain satisfied — verified via grep:

| File | Implements declaration |
|------|------------------------|
| `src/dedup/JaccardNameMatcher.ts` | `class JaccardNameMatcher implements ExactNameLayer` (1 occurrence) |
| `src/dedup/CosineEmbeddingMatcher.ts` | `class CosineEmbeddingMatcher implements EmbeddingLayer` (1 occurrence) |
| `src/dedup/LLMSemanticMatcher.ts` | `class LLMSemanticMatcher implements LLMSemanticLayer` (1 occurrence) |

Zero public-API surface change — the matchers' `match(entity, candidates) => MatchResult` signature, threshold defaults (0.85 / 0.90 / 0.70), and ctor option shapes are byte-identical. Phase 41/42/43 consumers experience only the corrected runtime behavior on the legacy-id re-extraction path.

## Deviations from Plan

### 1. [Rule 1 — Bug] Legacy self-match tests REPLACED instead of preserved

- **Found during:** Task 1 (RED test authoring).
- **Issue:** The plan's `<acceptance_criteria>` for Task 1 specified `grep -c "^  test(" jaccard-matcher.test.ts | grep -q "^8$"` and same for cosine — i.e. test counts must grow from 7 → 8. The plan also said in the `must_haves.truths` block: "Happy-path regression: all pre-existing matcher tests (7 Jaccard + 7 Cosine + 9 LLM = 23 tests) continue to pass with the guard removed (no test relied on the guard's behavior)." However, on reading the test files, two pre-existing tests directly asserted the now-removed buggy behavior:
  - `jaccard-matcher.test.ts:110-120` — `'never matches against entity.id === candidate.id (self-match)'` asserts `result.matched === false` for same-id candidate.
  - `cosine-matcher.test.ts:102-117` — `'never matches entity.id === candidate.id (self)'` asserts the same.
  These tests pinned the CR-02 bug itself. Keeping them would have failed the GREEN gate (`matched: true` after fix vs `matched: false` in the assertion).
- **Fix:** Replaced both obsolete tests in-place with the new CR-02 legacy-id re-extraction test (semantically the inverse assertion against the same input shape — same sharedId, same name, same matcher; only the expected outcome flips). The LLM matcher had no equivalent obsolete test, so its CR-02 test was appended (count grew 9 → 10).
- **Impact:** Net test count delta is **+1**, not +3 as the plan acceptance criteria text specified. The plan's goal-level success criterion ("All 24 matcher tests pass — 7+1 Jaccard, 7+1 Cosine, 9+1 LLM") is satisfied at the **24-test** total figure; the per-file 7→8 grep assertion is not, but the higher-order intent (CR-02 closed + all matcher tests green + GREEN proof via RED→GREEN cycle) IS satisfied.
- **Files modified:** As above.
- **Commits:** `e35dc00` (RED) + `849370d` (GREEN).

No other deviations. No Rule 4 architectural decisions required. No auth gates encountered.

## Auth Gates

None.

## Known Stubs

None. The fix is a pure deletion + comment-block addition; no placeholder values, no TODO markers, no UI-bound empty data sources.

## What's Next

- **CR-02 closed.** Phase 40 BLOCKER #2 fully resolved across all 3 layers.
- **CR-01 + CR-04 closed by Plan 40-08** (commits `1331568` + `851ed8e`).
- **CR-03 + WR-08 are Plan 40-10's scope** (LLM matcher `parseDedupResponse` SyntaxError typing + warning resolution).
- **SC#1 example app is Plan 40-11's scope** (`examples/custom-adapter.ts` for manual SC#1 discharge).
- After 40-10 + 40-11 land, `/gsd:verify-phase 40` re-run should flip `status: gaps_found` → `status: complete` in `40-VERIFICATION.md`.

## Self-Check

- [x] `~/Agentic/km-core/src/dedup/JaccardNameMatcher.ts` exists, guard removed, CR-02 comment present (grep verified).
- [x] `~/Agentic/km-core/src/dedup/CosineEmbeddingMatcher.ts` exists, guard removed, CR-02 comment present (grep verified).
- [x] `~/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts` exists, filter clause removed, CR-02 comment present (grep verified).
- [x] km-core commit `e35dc00` (test 40-09 RED) on `main` — verified via `git log --oneline -5`.
- [x] km-core commit `849370d` (fix 40-09 GREEN) on `main` — verified via `git log --oneline -5`.
- [x] tsc strict-clean (no errors) — verified via `npx tsc --noEmit`.
- [x] 24/24 matcher tests pass — verified via 3-file vitest run.
- [x] 146/146 full vitest suite passes — verified via `npm test`.
- [x] dist/ regenerated — verified via `npm run build`.
- [x] All 3 `implements <Layer>` declarations intact — verified via grep.
- [x] No console.log/info/warn/error/debug in any of the 3 matcher files (stderr-only convention preserved).

## Self-Check: PASSED
