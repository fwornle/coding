---
phase: 35-observation-digest-retention-with-json-cold-store-fallback
plan: 01
subsystem: live-logging
tags: [observations, retention, config, invariant-guard]

# Dependency graph
requires:
  - phase: 35-observation-digest-retention-with-json-cold-store-fallback
    provides: "phase plan + CONTEXT.md L4 invariant statement"
provides:
  - "defaults.observation.retentionDays: 7 in .observations/config.json"
  - "this.retentionDays on every ObservationWriter instance (defaulted to 7 when missing/non-finite)"
  - "Constructor-time throw when retentionDays < 1 (CONTEXT.md L4 dedup-floor invariant)"
affects:
  - 35-02-observation-pruner          # imports ObservationWriter for the invariant error-message string in test assertion
  - 35-04-obs-api-wiring              # reads this.retentionDays to compute the retention boundary

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "constructor-time invariant guard: refuse to construct when a misconfiguration would silently break a downstream contract (dedup window)"

key-files:
  created:
    - "tests/live-logging/ObservationWriter.retention-floor.test.js — 5 Jest cases covering: floor accepted (1), below-floor rejected (0, 0.5), missing-key default (7), non-finite default (string '3')"
    - "test/setup.js — empty file required by jest.config.js setupFilesAfterEach (was missing)"
  modified:
    - ".observations/config.json — added defaults.observation.retentionDays: 7"
    - "src/live-logging/ObservationWriter.js — loadConfig() fallback updated; constructor reads retentionDays + invariant guard + this.retentionDays accessor"

key-decisions:
  - "Throw, do not warn-and-clamp, on retentionDays < 1. Silently clamping would mask operator misconfiguration and trip the 35-04 pruner at runtime instead of surfacing the bug at boot."
  - "Default 7 days when retentionDays is missing/non-finite (matches dashboard date-picker spread and CONTEXT.md L1)."

patterns-established:
  - "Pattern: dedup-floor invariant. retentionDays must always be >= 1 day; the 4h dedup window in _isSemanticallyDuplicate (ObservationWriter.js:629) cannot be undercut."

requirements-completed:
  - "35-01: introduce retentionDays default of 7 under defaults.observation; expose via ObservationWriter; enforce >4h floor at config-load time"

# Metrics
duration: ~6min (executor before quota hit)
completed: 2026-05-15
---

# Phase 35 Plan 01: retentionDays config + ObservationWriter plumbing + dedup-floor invariant guard

**Added `defaults.observation.retentionDays: 7` to `.observations/config.json`, plumbed it into `ObservationWriter` as `this.retentionDays`, and added a constructor-time throw when the value would collapse the 4h dedup window in `_isSemanticallyDuplicate` (`ObservationWriter.js:629`). Downstream plans 35-02 and 35-04 will read `this.retentionDays` to compute the retention boundary.**

## Performance

- **Duration:** ~6 min before original executor hit Anthropic quota; ~3 min orchestrator close-out the following session
- **Completed:** 2026-05-15
- **Tasks:** 2/2 (feat + test)
- **Files modified:** 2
- **Files created:** 2
- **Tests added:** 5 Jest cases, all passing

## Accomplishments

- `.observations/config.json`: added `defaults.observation.retentionDays: 7` (one new key, schema otherwise unchanged)
- `src/live-logging/ObservationWriter.js`:
  - `loadConfig()` fallback now includes `retentionDays: 7` so the writer is fully self-contained when the config file is missing
  - Constructor reads `config.defaults?.observation?.retentionDays`, coerces non-finite values to `7`, **throws** when the result is `< 1` with an explicit `[ObservationWriter]` error referencing CONTEXT.md L4
  - Stores `this.retentionDays` on the instance for downstream consumers (35-02 pruner, 35-04 obs-api merge boundary)
- `tests/live-logging/ObservationWriter.retention-floor.test.js`: 5 Jest cases asserting accept-at-floor, reject-below-floor, default-on-missing, default-on-non-finite
- `test/setup.js`: created as the empty file required by `jest.config.js` `setupFilesAfterEach` (was missing — would have broken any future test run for an unrelated reason)

## Task Commits

1. **Task 1: Plumb retentionDays through config + writer with invariant guard** — `c470b8c05` (feat)
2. **Task 2: Add retention-floor Jest invariant guard** — `b16f5ca2a` (test)

## Files Created/Modified

- `.observations/config.json` — `defaults.observation.retentionDays: 7` added
- `src/live-logging/ObservationWriter.js` — constructor + `loadConfig()` fallback updated; new `this.retentionDays` accessor
- `tests/live-logging/ObservationWriter.retention-floor.test.js` — new (5 test cases)
- `test/setup.js` — new (empty stub for jest.config setupFilesAfterEach)

## Decisions Made

- **Throw, don't clamp.** A `retentionDays < 1` value is a configuration bug, not a value to silently round up. Throwing at construction surfaces the misconfiguration at boot rather than as a mysterious correctness failure when the 35-04 pruner deletes rows the writer was about to dedup against.
- **Default to 7.** Matches CONTEXT.md L1 (dashboard's default date-picker spread) and the on-disk config default written in this same commit. Mirroring the default inside `loadConfig()` fallback means a missing config file is not a runtime hazard.

## Verification Performed

All must_haves from the plan frontmatter verified:

1. **`.observations/config.json` has `defaults.observation.retentionDays: 7`.** ✅ confirmed via `git show c470b8c05 -- .observations/config.json`.
2. **A new ObservationWriter instance exposes `this.retentionDays`.** ✅ asserted in test case 1 (`accepts retentionDays = 1`) — reads `writer.retentionDays` and matches the config value.
3. **Passing retentionDays = 0 (or any <= 4h-equivalent value) makes ObservationWriter throw at init time.** ✅ test case 2 (`rejects retentionDays = 0`) and case 3 (`rejects retentionDays = 0.5`) both assert the explicit error message `retentionDays must be >= 1`.
4. **Existing ObservationWriter constructor + init() behavior is unchanged for callers that don't read retentionDays.** ✅ all other constructor logic (provider, batchSize, messageTokenLimit, db, hashes) is untouched; the only insertion is between `messageTokenLimit` assignment and `this.db = null`.

Test run:

```
NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/live-logging/ObservationWriter.retention-floor.test.js --no-coverage

PASS tests/live-logging/ObservationWriter.retention-floor.test.js
  ObservationWriter retentionDays invariant
    ✓ accepts retentionDays = 1 (at the floor) (6 ms)
    ✓ rejects retentionDays = 0 with a clear error (6 ms)
    ✓ rejects retentionDays = 0.5 (below the 1-day floor) (7 ms)
    ✓ defaults to 7 when retentionDays is missing from config (4 ms)
    ✓ defaults to 7 when retentionDays is a non-finite value (string "3") (3 ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Time:        0.551 s
```

## Notes / Operator-Relevant Caveats

- The original executor hit the Anthropic quota mid-plan and never wrote this SUMMARY.md. On orchestrator resumption, the 2 commits and the test file were validated as already-good (test passes when invoked with the project's standard `NODE_OPTIONS='--experimental-vm-modules --no-warnings'` per `package.json:scripts.test`). No code change was applied during close-out.
- This plan is **infrastructure for 35-02 and 35-04** — there is no runtime behavior change yet. `this.retentionDays` is exposed but unused until the pruner (35-02) and the obs-api merge boundary (35-04) consume it.
- The created `test/setup.js` is intentionally empty — `jest.config.js` declares it via `setupFilesAfterEach` but no global hooks are needed at this time. A future plan adding global mocks/timers can populate this file without further config changes.
