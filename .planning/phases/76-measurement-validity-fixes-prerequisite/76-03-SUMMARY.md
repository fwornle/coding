---
phase: 76-measurement-validity-fixes-prerequisite
plan: 03
subsystem: experiments
tags: [evidence-harness, measurement-validity, rubric, non-gsd, deterministic, spawnsync, security, esm]

# Dependency graph
requires:
  - phase: 73-judge-score
    provides: "gatherEvidence deterministic on-disk harness + runJudge + writeScore + the 5-dim rubric contract this plan extends"
provides:
  - "deriveNonGsdRubric(evidence): deterministic code_quality (diff) + test_coverage/regressions (fail-soft fixed-argv test run), null-only-when-no-signal"
  - "resolveTestCommand(span, repoRoot): run-metadata test_command first (tokenized to fixed argv, shell-meta rejected), else package.json test as ['npm','run','test']"
  - "gatherEvidence carries testRun alongside diffStat (GSD slots unchanged)"
  - "Gap-fill overlay of the three non-GSD dims onto the judgment before writeScore in BOTH score consumers (live close + recompute)"
affects: [76-04, cross-agent-comparison-runner, experiment-spec-phase-77, straight-vs-gsd-comparison]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fixed-argv spawnSync test-command run mirroring readDiffStat — no shell string, the child_process shell option is never set (T-76-03-EXEC/INJ)"
    - "Shell-metacharacter rejection to null (SHELL_META_RE) instead of executing an unsafe metadata command under a shell"
    - "NODE_TEST_CONTEXT stripped from the child env so a `node --test` command emits its parseable TAP/spec summary instead of the v8-serialized child stream"
    - "Gap-fill overlay: fill a judged dim ONLY when it is null AND the derived value is non-null (never clobber, never overwrite with a derived null)"

key-files:
  created: []
  modified:
    - lib/experiments/evidence-harness.mjs
    - tests/experiments/evidence-harness.test.mjs
    - scripts/measurement-stop.mjs
    - scripts/experiments-recompute-score.mjs

key-decisions:
  - "code_quality-from-diff heuristic (Claude's Discretion, D-08): code_quality = round2(clamp01(0.6*churnScore + 0.4*fileScore)), churnScore = 1 − (ins+del)/1500, fileScore = 1 − (files−1)/20 — deterministic, bounded to [0,1], documented in-source"
  - "test_coverage = pass rate (passed/(passed+failed)); null when no parseable counts (never a guessed 0, D-10). regressions = failed>0 ? 1 : 0 when counts parse, else non-zero-exit → 1; null only when no runnable test at all (D-11)"
  - "The three non-GSD dims are computed by the harness (diff + fail-soft test run) and overlaid, NOT fed to the LLM judge (D-08 security note)"
  - "A pending judgment IS gap-filled (its rubric is all-null); only trivial runs (no rubric) are skipped"

patterns-established:
  - "Deterministic non-LLM rubric derivation with fail-soft fixed-argv exec + null-never-zero calibration"

requirements-completed: [VALID-03]

# Metrics
duration: 20min
completed: 2026-07-03
---

# Phase 76 Plan 03: Non-GSD Rubric Coverage Summary

**When `VERIFICATION.md`/`REVIEW.md` are absent, `evidence-harness.mjs` now derives `code_quality` from the working-tree diff and `test_coverage`/`regressions` from a fail-soft fixed-argv run of the task's test command, and both score consumers gap-fill those three dims onto the judgment before `writeScore` — closing the VALID-03 gap that corrupted the "straight vs GSD" comparison, with null only when genuinely no signal exists and never a guessed 0.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-03
- **Tasks:** 2 (Task 1 TDD: RED + GREEN; Task 2 overlay)
- **Files modified:** 4

## Accomplishments

- **Task 1 (harness derivation, TDD):** Added `deriveNonGsdRubric(evidence)` returning `{code_quality, test_coverage, regressions}` with null-only-when-no-signal semantics (D-08/D-11), plus `resolveTestCommand(span, repoRoot)` (run-metadata `test_command` first, else `package.json` `"test"` → `['npm','run','test']`, D-09) and a fixed-argv fail-soft `runTestCommand` mirroring the existing `readDiffStat` exec idiom (D-10). `gatherEvidence` now carries a `testRun` slot alongside `diffStat` without changing any GSD slot.
- **Task 2 (overlay):** Both `scripts/measurement-stop.mjs` (live close) and `scripts/experiments-recompute-score.mjs` (recompute/backfill) call `deriveNonGsdRubric(evidence)` after `runJudge` and gap-fill the three dims onto `judgment.rubric` — fill only when the judged value is null AND the derived value is non-null; trivial runs skipped; pending judgments gap-filled. No LLM call for these dims.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing tests for deterministic non-GSD rubric derivation** — `fa9c4df4e` (test)
2. **Task 1 (GREEN): derive non-GSD dims from diff + fail-soft test run** — `9692e3d4d` (feat)
3. **Task 2: overlay the deterministic dims onto the judgment in both consumers** — `9437865cd` (feat)

**Plan metadata:** _(this docs commit)_

## Files Created/Modified

- `lib/experiments/evidence-harness.mjs` — New `deriveNonGsdRubric` (exported) + `resolveTestCommand` (exported) + internal `runTestCommand`, `parseTestCounts` (extracted from `parseTestSummary`), `codeQualityFromDiff`/`testCoverageFromRun`/`regressionsFromRun`, and `clamp01`/`round2`/`resolveTestTimeoutMs` helpers. `gatherEvidence` runs the resolved test command fail-soft and returns a new `testRun` field in both return branches. Module header honestly documents the D-08 scoped relaxation (harness now runs the task's test command fail-soft for the non-GSD case). `SHELL_META_RE` rejects shell-needing commands to null; `NODE_TEST_CONTEXT` stripped from the child env.
- `tests/experiments/evidence-harness.test.mjs` — 12 new tests across three describe blocks: `deriveNonGsdRubric` null-only-when-no-signal / never-guessed-0 cases; `resolveTestCommand` metadata-first / package.json fallback / shell-meta rejection / no-command-null; and end-to-end `gatherEvidence` fixed-argv exec (passing node:test fixture, non-zero-exit-no-counts, no-command, and a source-scan acceptance that there is no `shell:true`).
- `scripts/measurement-stop.mjs` — Imports `deriveNonGsdRubric`; new `overlayNonGsdRubric(judgment, evidence)` helper (gap-fill, never clobber, skip trivial); called between `runJudge` and `writeScore`.
- `scripts/experiments-recompute-score.mjs` — Same import + identical `overlayNonGsdRubric` helper wired between the judgment step and `writeScore`, so a backfill scores non-GSD dims too.

## Decisions Made

- **code_quality heuristic:** bounded, deterministic churn/file-count blend (`0.6*churnScore + 0.4*fileScore`, ceilings 1500 churn / 20 files), rounded to 2 dp, documented inline. Non-null whenever a diff exists; null when no diff.
- **test_coverage / regressions:** coverage = pass rate, null when no parseable counts (never a guessed 0); regressions = `failed>0 ? 1 : 0` when counts parse, else exit-status-based (`status !== 0 → 1`), null only when there is no runnable test at all.
- **Security (D-10):** the test command runs via fixed-argv `spawnSync`; a metadata command carrying shell control characters is rejected to null rather than executed under a shell. The `child_process` `shell` option is never set (grep-verified 0 occurrences of `shell: true`).
- **Overlay is gap-fill only:** a genuine judged dim (present when GSD artifacts exist) is never overwritten; pending judgments (all-null rubric) are filled; trivial runs are skipped.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Strip `NODE_TEST_CONTEXT` from the test-command child environment**
- **Found during:** Task 1 GREEN (the passing-fixture integration test failed under `node --test`).
- **Issue:** When the scoring process itself runs under `node --test` (as in the harness test suite), the spawned `node --test <fixture>` child inherited `NODE_TEST_CONTEXT` and emitted the v8-serialized child stream instead of a parseable TAP/spec summary, so `parseTestCounts` returned null.
- **Fix:** `runTestCommand` clones `process.env` and deletes `NODE_TEST_CONTEXT` before `spawnSync`. Harmless in production (the var is unset there); makes the derivation robust when a test-runner is itself running.
- **Files modified:** `lib/experiments/evidence-harness.mjs`
- **Commit:** `9692e3d4d`

**2. [Rule 1 - Bug] `parseTestCounts` recognizes the node:test spec-reporter summary**
- **Found during:** Task 1 GREEN.
- **Issue:** Node v25 defaults to the `spec` reporter on a non-TTY pipe, emitting `ℹ pass N` / `ℹ fail N` rather than the TAP `# pass N` the original parser matched.
- **Fix:** Broadened the count regexes to `^\s*(?:#|ℹ)\s*pass\s+(\d+)` (and the fail variant), keeping the existing mocha `N passing`/`N failing` fallback.
- **Files modified:** `lib/experiments/evidence-harness.mjs`
- **Commit:** `9692e3d4d`

_(Both fixes are within Task 1's TDD GREEN and required to make the mandated behavior work; no scope beyond the harness derivation.)_

## Issues Encountered

None beyond the two auto-fixed items above.

## Verification

- `node --test tests/experiments/evidence-harness.test.mjs` → 21 tests, 21 pass, 0 fail.
- `node --test tests/experiments/judge.test.mjs tests/experiments/score-write.test.mjs` → 11 pass, 0 fail (no regression to the score contract).
- `node --check` passes on `evidence-harness.mjs`, `measurement-stop.mjs`, `experiments-recompute-score.mjs`.
- `grep -c "shell:\s*true\|shell: true" lib/experiments/evidence-harness.mjs` → 0 (fixed-argv only; the source contains no `shell:true` — asserted by a test too).
- `grep -q "deriveNonGsdRubric"` present in both consumer scripts.
- No `console.log` introduced (`process.stderr.write` only, per CLAUDE.md).

## Threat Surface

The test-command run is the one new execution surface; it is spawned with a fixed argv array (never a shell string, the `shell` option is never set) and shell-needing metadata commands fail-soft to null (T-76-03-EXEC / T-76-03-INJ mitigated as planned). No new package installs (pure `node:child_process` + `node:fs`, T-76-03-SC accepted). No surface beyond the plan's `<threat_model>`.

## Next Phase Readiness

- A non-GSD / straight-coding run now persists non-null `code_quality`/`test_coverage`/`regressions` when signal exists, so the Wave-2 regression anchor (76-04) can re-run `experiments-recompute-score.mjs` against the archived `exp-dash-start-control` pilot span and confirm all 5 rubric dims score. VALID-03 discharged for this phase's scope.

## Self-Check: PASSED
- FOUND: lib/experiments/evidence-harness.mjs (modified)
- FOUND: tests/experiments/evidence-harness.test.mjs (modified)
- FOUND: scripts/measurement-stop.mjs (modified)
- FOUND: scripts/experiments-recompute-score.mjs (modified)
- FOUND commit: fa9c4df4e (RED test)
- FOUND commit: 9692e3d4d (GREEN harness)
- FOUND commit: 9437865cd (overlay)

---
*Phase: 76-measurement-validity-fixes-prerequisite*
*Completed: 2026-07-03*
