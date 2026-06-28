---
phase: 73-semantic-route-judge-success-scoring
plan: 03
subsystem: experiments/scoring
tags: [evidence-harness, scoring, fail-soft, D-01, SCORE-01]
requires:
  - "scripts/measurement-stop.mjs locatePlanMd + readArchivedSpan fail-soft idioms"
  - "lib/experiments/goal-sentence.mjs fail-soft on-disk reader style"
provides:
  - "lib/experiments/evidence-harness.mjs::gatherEvidence — structured on-disk evidence object for the 73-04 judge"
affects:
  - "73-04 judge.mjs (consumes gatherEvidence output for the 5-dimension rubric)"
tech-stack:
  added: []
  patterns:
    - "fail-soft phase-artifact locator (ported from measurement-stop.mjs:107-122)"
    - "fixed-argv git spawn (no shell string) for command-injection safety"
    - "strict fail-soft → null (absent evidence is null, never zero/guessed — D-01)"
key-files:
  created:
    - lib/experiments/evidence-harness.mjs
    - tests/experiments/evidence-harness.test.mjs
  modified: []
decisions:
  - "Every evidence slot is fail-soft to null (D-01) — a dimension with no on-disk artifact is null, NOT zero/'' so the rubric is never biased by a guess."
  - "git diff --stat spawned via spawnSync('git', ['diff','--stat']) argv array (not a shell string) — T-73-03-EXEC command injection unreachable."
  - "Harness reads ONLY already-on-disk artifacts; it NEVER runs tests/linters/code-review at scoring time (D-01 lean harness, heavy active harness rejected for v0)."
metrics:
  duration: ~12m
  tasks: 2
  files: 2
  completed: 2026-06-28
---

# Phase 73 Plan 03: Deterministic Evidence Harness Summary

D-01 fail-soft evidence harness (`gatherEvidence`) that reads cheap, already-on-disk phase artifacts (VERIFICATION verdict, REVIEW findings count, PLAN task list, `git diff --stat`, and any existing test-output summary) and returns a structured evidence object for the 73-04 judge — every slot fail-soft to `null`, never running tests/linters/review at scoring time (SCORE-01).

## What Was Built

- **`lib/experiments/evidence-harness.mjs`** — exports `gatherEvidence({ span, phaseArg, repoRoot })` returning `{ verification, reviewFindings, testSummary, diffStat, planTasks }`:
  - `verification` — parses the frontmatter `status:` field or a `**Status:**` header (normalized to an upper-case verdict token); null when absent.
  - `reviewFindings` — prefers the `total:` count line, falls back to summing `critical/warning/info` buckets; null when absent.
  - `testSummary` — parses node:test TAP (`# pass N` / `# fail N`) or mocha (`N passing` / `M failing`) from an EXISTING on-disk artifact; null when no such file (NEVER runs tests).
  - `diffStat` — `spawnSync('git', ['diff','--stat'])` (fixed argv array), fail-soft to null on non-zero/throw.
  - `planTasks` — extracts `<name>…</name>` entries (or bare `<task>…</task>` content) from PLAN.md; null when absent.
  - Phase dir resolved by a ported fail-soft `locatePhaseDir` (measurement-stop.mjs:107-122 idiom).
- **`tests/experiments/evidence-harness.test.mjs`** — 7 tests across 3 cases (node:test + node:assert/strict):
  - Case A (all present): verdict / findings count / task-name list parsed.
  - Case B (all absent): every on-disk slot is `null` (asserted NOT 0, NOT '').
  - Case C: `diffStat` is null-or-string and the harness never throws (incl. a missing-`.planning`-tree case).

## Verification

- `node --check lib/experiments/evidence-harness.mjs` → clean.
- `node --test tests/experiments/evidence-harness.test.mjs` → 7 pass / 0 fail (exit 0).
- Acceptance greps:
  - `grep -q "git diff --stat"` matches (docstring) while the actual spawn uses an argv array — threat-model T-73-03-EXEC mitigated.
  - `! grep -nE "npm (run )?test|jest|playwright test|eslint"` — no test/lint runner invoked.
  - `grep -q "process.stderr.write"` present; `! grep -nE "console\.(log|error|warn)"` — no-console-log clean.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Disposition

- **T-73-03-EXEC (Elevation):** mitigated — `git diff --stat` spawned with a fixed argv array, no shell string, no untrusted-input interpolation; command injection unreachable.
- **T-73-03-GUESS (Integrity):** mitigated — strict fail-soft → null for every slot, asserted by Case B (absent artifacts assert null, never 0/'').

## Commits

- `109d141f3` feat(73-03): add D-01 fail-soft on-disk evidence harness
- `e1a173363` test(73-03): prove evidence-harness fail-soft-to-null + present-artifact parse

## Self-Check: PASSED

- FOUND: lib/experiments/evidence-harness.mjs
- FOUND: tests/experiments/evidence-harness.test.mjs
- FOUND commit: 109d141f3
- FOUND commit: e1a173363
