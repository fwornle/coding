---
phase: 73-semantic-route-judge-success-scoring
plan: 06
subsystem: experiments
tags: [route-judge, success-scoring, km-core, llm-proxy, idempotency, run-close]

# Dependency graph
requires:
  - phase: 73-01
    provides: filterConsequential / isTrivialRun route primitives + computeGoalAlignedRatio
  - phase: 73-02
    provides: writeScore / applyOverride idempotent Score writer (corrected_* carry-forward, D-06)
  - phase: 73-03
    provides: gatherEvidence deterministic on-disk evidence harness
  - phase: 73-04
    provides: runJudge — the ONE Haiku /api/complete judge that quarantines to pending (never throws)
provides:
  - measurement-stop.mjs step (4.5)= evidence → judge (or trivial) → writeScore + scored edge, inside the existing try/finally
  - experiments-recompute-score.mjs — idempotent single-run re-judge CLI (openExperimentStore-only)
  - close summary now prints score=scored|pending|trivial + goal_aligned_ratio
affects: [73 verification, future score-override UI / query CLIs, ROUTE-03, SCORE-01]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scoring path lives INSIDE the existing close try/finally so the same open store is reused and the close never hard-blocks"
    - "Recompute CLI is a near-verbatim clone of experiments-recompute-route.mjs with the heuristics step swapped for judge+writeScore"

key-files:
  created:
    - scripts/experiments-recompute-score.mjs
  modified:
    - scripts/measurement-stop.mjs

key-decisions:
  - "Trivial short-circuit keyed on isTrivialRun(trace) (73-01 contract) so trivial runs skip the proxy (D-04)"
  - "phaseArg for recompute derived best-effort from span.meta.phase ?? run.metadata.phase ?? null; null degrades evidence slots to null (diffStat still read) rather than blocking"
  - "Store opened EXCLUSIVELY via openExperimentStore() in both files — never inline GraphKMStore (CLAUDE.md ontologyDir rule)"

patterns-established:
  - "Pattern 1: judge+score wiring reuses the already-built trace + already-open store rather than re-opening/re-deriving"
  - "Pattern 2: idempotent re-judge preserves human corrected_* overrides while refreshing judged fields (D-06)"

requirements-completed: [ROUTE-03, SCORE-01]

# Metrics
duration: 14min
completed: 2026-06-28
---

# Phase 73 Plan 06: Wire Route-Judge + Success-Scoring Into Run-Close Summary

**Run-close now gathers on-disk evidence, judges the consequential trace (or marks trivial), and writes a Score + `scored` edge — all inside the existing try/finally so a proxy-down judge never hard-blocks — plus an idempotent `experiments-recompute-score.mjs` re-judge CLI that preserves human overrides.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-28T15:01:00Z
- **Completed:** 2026-06-28T15:15:38Z
- **Tasks:** 2
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments
- `measurement-stop.mjs` step (4.5): after `writeRun`, `gatherEvidence` → (`isTrivialRun` short-circuit | `runJudge`) → `writeScore` + `scored` edge, reusing the already-built `trace` and the same open store; the existing `finally` still close()s it.
- The whole scoring path sits inside the existing `try` so a slow/unreachable judge proxy quarantines to `pending` and the close still completes exit 0 (T-73-06-BLOCK).
- Close summary extended: `score=scored|pending|trivial goal_aligned_ratio=<n|null>`.
- `experiments-recompute-score.mjs`: a near-verbatim clone of the route recompute CLI with the heuristics step swapped for judge+writeScore; opens the store only via `openExperimentStore()`; `--dry-run` writes nothing; missing span exits non-zero.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire evidence → judge → writeScore into measurement-stop close path** - `947afa3c` (feat)
2. **Task 2: experiments-recompute-score.mjs — idempotent single-run re-judge CLI** - `d19ebac5` (feat)

## Files Created/Modified
- `scripts/measurement-stop.mjs` - Added the 73-06 imports + step (4.5) evidence/judge/writeScore block inside the existing close try/finally; extended the close summary with the score marker + goal_aligned_ratio.
- `scripts/experiments-recompute-score.mjs` (new, 176 lines) - Idempotent single-run re-judge CLI: arg parse + `--dry-run`, archived-span read, `findRun`, `openExperimentStore()` + try/finally close, agent-seam trace rebuild (`normalizeAgent` + `buildTraceSeam`), gatherEvidence → (trivial | runJudge) → writeScore, entry-point guard.

## Decisions Made
- **Trivial detection via `isTrivialRun(trace)`** (the 73-01 contract) rather than an inline length check — keeps the acceptance grep meaningful and the D-04 short-circuit semantics identical to the judge's own internal guard.
- **`runJudge({ trace: filterConsequential(trace) })`** as specified in 73-PATTERNS.md §measurement-stop: passing the already-filtered consequential events is safe because `filterConsequential` is idempotent and `isTrivialRun` on a non-empty consequential array is false.
- **`phaseArg` for recompute is best-effort** (`span.meta.phase ?? run.metadata.phase ?? null`). `gatherEvidence` is fail-soft on a null `phaseArg` (every on-disk slot null, `diffStat` still read), so a recompute never blocks on missing phase metadata.

## Deviations from Plan

None - plan executed exactly as written. The PATTERNS §measurement-stop 4.5 block was copied as specified; the only refinement (using `isTrivialRun(trace)` for the trivial branch instead of the block's `consequential.length === 0`) is exactly what Task 1's `<action>` and acceptance criteria require, and is behaviorally equivalent (an empty consequential set is precisely the trivial case).

## Issues Encountered
- None affecting the deliverables. (During behavior verification my throwaway test harness initially called a non-existent `store.getRelations`; corrected to the real `store.findRelations({type,from,to})` API — a test-harness fix only, no source change.)

## Verification Performed

All against isolated throwaway `CODING_REPO` + `LLM_PROXY_DATA_DIR` (no mutation of the worktree's real experiment store):

- **Syntax:** `node --check` clean on both files.
- **Acceptance greps (Task 1):** `writeScore`, `gatherEvidence`, `runJudge`, `isTrivialRun` all present; no-console-log clean.
- **Acceptance greps (Task 2):** `openExperimentStore` present, **no inline `new GraphKMStore`** (CLAUDE.md ontologyDir rule); `runJudge`, `writeScore`, `buildTraceSeam`, `normalizeAgent`, `import.meta.url` all present; no-console-log clean; 176 lines (> 110 min).
- **BEHAVIOR — close never hard-blocks (T-73-06-BLOCK):** a headless close against a fixture span with `RAPID_LLM_PROXY_URL=http://127.0.0.1:1` (unreachable) completed **exit 0**, writing a `not_scored:trivial` Score and printing the score marker. A non-trivial trace + unreachable proxy made `runJudge` quarantine to `pending:true` **without throwing**, and `writeScore` persisted it.
- **BEHAVIOR — `--dry-run nonexistent-task-id` exits non-zero:** exit 1, no write.
- **BEHAVIOR — idempotency + D-06 (T-73-06-CLOBBER):** seeded a Run + initial scored judgment, ran the recompute CLI twice → exactly **1 Score node, 1 `scored` edge**. Applied a human override (`code_quality=0.42`, `by=operator-7306`), recomputed once more → still **1 Score, 1 edge**, with `corrected_code_quality=0.42` and `overridden_by=operator-7306` **preserved** across the re-judge while judged fields refreshed.

## Threat Model Outcome
- **T-73-06-BLOCK (DoS):** mitigated — verified the close completes exit 0 with the proxy unreachable (runJudge quarantines; writeScore is a local write inside the existing try/finally).
- **T-73-06-CLOBBER (Integrity):** mitigated — verified `corrected_*` + `overridden_by` survive a re-judge.
- **T-73-06-LOCK (Availability):** mitigated by the transient-open + finally-close pattern (single-owner LevelDB; documented "do not run two experiment CLIs concurrently").
- No new externally-reachable surface; no package installs. No threat flags.

## Next Phase Readiness
- ROUTE-03 + SCORE-01 now reach production at run-close and are re-runnable via `experiments-recompute-score.mjs`.
- A live end-to-end close against the running proxy (port 12435) will exercise the real Haiku path; this plan verified the degradation + idempotency contracts with isolated fixtures (live routing was already confirmed in 73-04).

---
*Phase: 73-semantic-route-judge-success-scoring*
*Completed: 2026-06-28*
