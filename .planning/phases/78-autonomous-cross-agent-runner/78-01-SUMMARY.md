---
phase: 78-autonomous-cross-agent-runner
plan: 01
subsystem: experiments
tags: [run-record, measurement-span, schema, RUN-02, RUN-03, RUN-04]
requires:
  - lib/experiments/run-write.mjs writeRun (Phase 71)
  - scripts/measurement-start.mjs buildVariantMeta (Phase 77)
  - scripts/measurement-stop.mjs close orchestrator (Phase 71/76)
provides:
  - "Run.metadata.variant / repeat / terminal_state / skip_reason (null-preserved tags)"
  - "measurement-stop --terminal-state (enum-validated) + --skip-reason flags"
  - "measurement-start --repeat threading into span.meta"
  - "scripts/measurement-stop.mjs pure exports: buildRunTags, parseTerminalState, TERMINAL_STATES"
affects:
  - Phase 78-03 runner engine (reads variant/repeat/terminal_state/skip_reason per cell)
  - lib/experiments/query.mjs readRuns (surfaces the four new fields via ...meta spread)
tech-stack:
  added: []
  patterns:
    - "null-preserved `?? null` tag idiom (never `?? 0`, never conditional-omit)"
    - "conditional-spread with presence check (Number.isFinite) so repeat index 0 survives"
    - "isDirectRun main() gate for importable CLI modules"
    - "enum fast-fail before span archive / proxy import (Tampering mitigation)"
key-files:
  created:
    - tests/experiments/measurement-stop-tags.test.mjs
  modified:
    - lib/experiments/run-write.mjs
    - scripts/measurement-start.mjs
    - scripts/measurement-stop.mjs
    - tests/experiments/run-write.test.mjs
    - tests/experiments/measurement-start-variant.test.mjs
decisions:
  - "buildRunTags extracted as a pure exported helper (behavior-preserving) so the stop-side tags are unit-testable without running the full close pipeline"
  - "measurement-stop main() gated behind isDirectRun (mirrors measurement-start) — enables module import for tests; CLI behavior unchanged"
  - "--terminal-state validated at the TOP of main(), before stopMeasurement/proxy import, so an invalid enum fails fast with no side effects"
metrics:
  tasks: 3
  files_changed: 5
  files_created: 1
  tests_total: 226
  tests_pass: 224
  tests_skipped: 2
  completed: 2026-07-03
requirements: [RUN-02, RUN-03, RUN-04]
---

# Phase 78 Plan 01: Run-Record Persistence Gaps (variant/repeat/terminal_state/skip_reason) Summary

Threaded four first-class, null-preserved Run.metadata tags — `variant`, `repeat`,
`terminal_state`, `skip_reason` — through the SHIPPED measurement seam
(`measurement-start` → `span.meta` → `measurement-stop` tags → `writeRun`), so a single
experiment's cells are distinguishable (variant/repeat) and every terminal outcome
(complete|timeout|abort enum) plus probe-gated skip is recorded rather than dropped.

## What Was Built

- **`writeRun` tag allow-list extended (Task 1).** Four additive `?? null` lines in the
  Run.metadata tag block: `variant`, `repeat`, `terminal_state` (D-04 enum verbatim),
  `skip_reason`. The `?? null` idiom preserves a genuine `repeat` index of 0. The
  `existingId`/`mintEntityId()` idempotency lookup and re-close logic are untouched
  (T-78-01-02 mitigation — Task 1 grep-gated). `readRuns` surfaces all four automatically
  through its existing `...meta` spread (no `query.mjs` change).

- **`--repeat` threading (Task 2, start side).** `buildVariantMeta` parses `--repeat` via
  the existing `parseStrArg` helper, coerces to `Number`, and conditionally spreads it into
  `span.meta` with a `Number.isFinite` presence check (index 0 survives; non-numeric
  dropped) — symmetric with the existing `--variant` idiom (D-10).

- **Stop-side folding + close-outcome flags (Task 2 stop side + Task 3).**
  `buildRunTags` (new pure export) folds `span.meta.variant`/`repeat` and the parsed
  `terminal_state`/`skip_reason` onto the unchanged canonical-attribution tags.
  `parseTerminalState` (new pure export) enum-validates `--terminal-state` against the
  `TERMINAL_STATES` closed set (`complete|timeout|abort`, D-04 verbatim) and throws on an
  out-of-enum value; `main()` validates it FIRST (before span archive / proxy import) and
  fails fast with a `process.stderr.write` diagnostic + `process.exit(1)` (T-78-01-01).
  `--skip-reason` is parsed as a free operator label (T-78-01-03 accepted).

## Verification

- `node --test tests/experiments/run-write.test.mjs` — 18/18 pass (4 new R2/R3/R4 tests).
- `node --test tests/experiments/measurement-start-variant.test.mjs` — 10/10 (2 new repeat tests).
- `node --test tests/experiments/measurement-stop-tags.test.mjs` — 9/9 (new file).
- `node --test "tests/experiments/*.test.mjs"` — 226 tests, 224 pass, 0 fail, 2 skipped
  (EXPERIMENTS_LIVE-gated), confirming no regression from the additive edits.

Acceptance greps all satisfied:
- `run-write.mjs`: all four fields present in the metadata block with `?? null`;
  `mintEntityId`/`existingId` unchanged.
- `measurement-start.mjs`: `--repeat` parsed and spread into span.meta.
- `measurement-stop.mjs`: `variant:`/`repeat:` folded into tags; `--terminal-state`/
  `--skip-reason` parsed, terminal-state enum-validated; no `console.` added.

## Deviations from Plan

### Structural (behavior-preserving, in service of the plan's own test requirements)

**1. [Rule 3 - Testability enabler] Gated `measurement-stop.mjs` `main()` behind `isDirectRun`**
- **Found during:** Task 2 (stop side)
- **Issue:** `measurement-stop.mjs` ran `main()` unconditionally on import, calling
  `process.exit(0)` on the no-active-span path — so the plan's required stop-side unit test
  (`measurement-stop-tags.test.mjs`) could not import the module's helpers without killing
  the test process.
- **Fix:** Added the same `isDirectRun` guard `measurement-start.mjs` already uses. CLI
  behavior is unchanged when the script is executed directly; the module is now importable.
- **Files modified:** scripts/measurement-stop.mjs
- **Commit:** 4c321d393 (separate `refactor` commit to keep it behavior-preserving and isolated)

**2. [Design choice] Extracted `buildRunTags` as a pure exported helper**
- **Found during:** Task 2 (stop side)
- **Issue:** The tags object was inline in `main()`, unreachable without running the full
  close pipeline (real proxy dist + real store).
- **Fix:** Extracted the inline `tags = { ... }` into an exported `buildRunTags({...})`
  that returns the identical tag set plus the four additive fields. `main()` now calls it.
  This is additive/behavior-preserving — existing tags keep their names and order.
- **Files modified:** scripts/measurement-stop.mjs
- **Commit:** 6b6ef4086

No functional deviations otherwise — the plan executed as written.

## Known Stubs

None. All four fields are wired end-to-end (span.meta → tags → Run.metadata → readRuns)
and test-covered.

## Threat Model Compliance

- **T-78-01-01 (Tampering, `--terminal-state`):** mitigated — enum-validated against the
  literal `['complete','timeout','abort']` set; invalid values reject with exit 1 before
  writeRun (and before span archive / proxy import).
- **T-78-01-02 (Tampering, writeRun idempotency):** mitigated — additive tag lines only;
  `existingId`/`mintEntityId` lookup untouched (grep-verified).
- **T-78-01-03 (Info disclosure, `--skip-reason`):** accepted — local operator label to the
  repo-local KB, no external sink.
- **T-78-01-SC (Supply chain):** N/A — no package installs; in-repo `.mjs` edits only.

No new security surface introduced beyond the plan's threat register.

## Commits

- a35f17dd3 — test(78-01): failing tests for the four Run tags (RED)
- 755e06999 — feat(78-01): persist variant/repeat/terminal_state/skip_reason as Run tags (GREEN)
- 4c321d393 — refactor(78-01): gate measurement-stop main() behind isDirectRun
- 65f84a32c — test(78-01): failing tests for --repeat threading + stop-side tags (RED)
- 4fcefe394 — feat(78-01): thread --repeat into span.meta (GREEN)
- 6b6ef4086 — feat(78-01): fold variant/repeat + --terminal-state/--skip-reason into Run tags (GREEN)

## Self-Check: PASSED

All 6 key files (1 created, 5 modified) exist on disk; all 7 commits are present in the
worktree branch history. No plan files left uncommitted.
