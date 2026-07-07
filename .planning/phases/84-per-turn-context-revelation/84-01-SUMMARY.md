---
phase: 84-per-turn-context-revelation
plan: 01
subsystem: testing
tags: [node-test, fixtures, context-turns, jsonl, redaction, observations, wave-0]

# Dependency graph
requires: []
provides:
  - "tests/context-turns/_helpers.mjs — shared harness (mkTmpMeasurementsDir/loadFixture/readJsonl)"
  - "Three recorded fixtures: anthropic /v1/messages body, openai /api/complete body, observations slice"
  - "Nine skipped stub tests, one per RESEARCH test-map behavior, each naming its downstream plan"
affects: [84-02, 84-03, 84-04, 84-05, 84-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "node:test + node:assert/strict house style for the context-turns suite (matches tests/experiments/)"
    - "Wave-0 skipped stubs whose skip reason names the downstream plan that un-skips them"

key-files:
  created:
    - tests/context-turns/_helpers.mjs
    - tests/fixtures/context-turns/anthropic-messages-body.json
    - tests/fixtures/context-turns/openai-complete-body.json
    - tests/fixtures/context-turns/observations-slice.json
    - tests/context-turns/write-line.test.mjs
    - tests/context-turns/cache-split.test.mjs
    - tests/context-turns/openai-wire.test.mjs
    - tests/context-turns/digest.test.mjs
    - tests/context-turns/close-gzip.test.mjs
    - tests/context-turns/correlate.test.mjs
    - tests/context-turns/sweeper.test.mjs
    - tests/vkb/context-turns-route.test.mjs
    - tests/redaction/config-load.test.mjs
  modified: []

key-decisions:
  - "Anthropic fixture uses exactly 2 cache_control ephemeral blocks (system + first user message) to guarantee non-empty cache-breakpoint indices for the cache-split test."
  - "Observations fixture mirrors the VERIFIED real export keys (id/summary/agent/project/quality/createdAt/digestedAt/llm/modifiedFiles) with ZERO task_id, and includes one out-of-window 2026-07-06 record so 84-05 can prove nearest-by-createdAt filtering."
  - "Node 25.8.1 broke the bare-directory `node --test <dir>` form (it resolves the dir as a module and fails); the portable verify command is the shell-glob form `node --test tests/context-turns/*.test.mjs ...`."

patterns-established:
  - "Wave-0 stub: each behavior gets a skipped node:test whose skip reason names the plan (84-0X) that will un-skip and fill it; stubs load a fixture at module-eval to prove the harness is wired."

requirements-completed: []

# Metrics
duration: 12min
completed: 2026-07-07
---

# Phase 84 Plan 01: Wave-0 Test Scaffold & Fixtures Summary

**Wave-0 scaffold for the per-turn-context-revelation phase: a shared node:test harness, three secret-free recorded request-body/observation fixtures, and nine skipped stub tests — one per RESEARCH test-map behavior — each pointing at the downstream plan that implements it.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-07-07
- **Tasks:** 2
- **Files created:** 13

## Accomplishments
- Three offline fixtures recorded under `tests/fixtures/context-turns/`: a realistic Anthropic `/v1/messages` body (2 ephemeral cache_control blocks + tool_use + tool_result), an OpenAI `/api/complete` internalBody (messages + tools + `agent:'copilot'` + `task_id`), and a 4-record observations slice mirroring the VERIFIED export keys with zero `task_id`.
- Shared harness `tests/context-turns/_helpers.mjs` exporting `mkTmpMeasurementsDir()` (own-uid temp dir + `withTaskId(id)` + `cleanup()`), `loadFixture(name)`, and `readJsonl(path)`.
- Nine skipped stub tests covering all eleven RESEARCH test-map unit behaviors (the two non-unit rows — the gsd-browser explainer e2e and the live golden run — are phase-gate items, not Wave-0 stub files), each skip reason naming its downstream plan (84-02/03/04/05/07).

## Task Commits

1. **Task 1: Record request-body + observation fixtures** — `961e8d632` (test)
2. **Task 2: Shared harness + skipped stubs for every behavior** — `15498d849` (test)

## Files Created/Modified
- `tests/fixtures/context-turns/anthropic-messages-body.json` — /v1/messages body with cache_control + tool_use/tool_result
- `tests/fixtures/context-turns/openai-complete-body.json` — /api/complete internalBody with messages/tools/agent/task_id
- `tests/fixtures/context-turns/observations-slice.json` — 4 observation records, no task_id, createdAt straddling a span window
- `tests/context-turns/_helpers.mjs` — shared harness (3 exported helpers)
- `tests/context-turns/{write-line,cache-split,openai-wire,digest,close-gzip,correlate,sweeper}.test.mjs` — 7 skipped behavior stubs
- `tests/vkb/context-turns-route.test.mjs` — read-API stub (→ 84-07)
- `tests/redaction/config-load.test.mjs` — redaction applier stub (→ 84-02)

## Decisions Made
- Kept the Anthropic fixture at exactly 2 cache_control blocks (the acceptance minimum) to keep it small while still driving non-empty cache breakpoints.
- Added a deliberately out-of-window observation record (2026-07-06) so the future correlation test can prove the span-window + nearest-by-createdAt filter, not just a trivial match.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adjusted the verify command from bare-directory to shell-glob form**
- **Found during:** Task 2 (running the plan's `<automated>` verify command)
- **Issue:** The plan's verify command `node --test tests/context-turns/ ...` fails on the installed Node **v25.8.1** — passing a directory argument makes Node try to resolve the directory as a CommonJS module (`Error: Cannot find module '/…/tests/context-turns'`), which node reports as a failing test. Confirmed to be a global Node-version behavior (the same failure occurs for the pre-existing `tests/experiments` dir), NOT a defect in the scaffold.
- **Fix:** Ran the equivalent portable form `node --test tests/context-turns/*.test.mjs tests/vkb/context-turns-route.test.mjs tests/redaction/config-load.test.mjs`, which discovers all nine stubs → **9 tests, 0 failures, 9 skipped, exit 0**.
- **Files modified:** none (invocation change only)
- **Verification:** glob form reports `pass 0 / fail 0 / skipped 9`, exit 0.
- **Committed in:** n/a (no file change) — recorded here and in the note below for downstream plans.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope change. Downstream plans (84-02..84-07) should invoke their per-module tests with the shell-glob form on this Node version. The scaffold content is exactly as specified.

## Issues Encountered
- None beyond the Node 25 directory-arg incompatibility documented above.

## Threat Surface
- T-84-01-01 (Information Disclosure via recorded fixtures) mitigated: `grep -RniE 'sk-|bearer |eyJ'` over `tests/fixtures/context-turns/` returns no matches; all fixtures are hand-authored, not copied from live traffic.
- T-84-01-SC (npm install tampering) N/A: no packages installed (pure Node stdlib).

## Next Phase Readiness
- Every downstream Phase-84 task now has a concrete `<automated>` command to satisfy (Nyquist rule closed for the unit behaviors).
- 84-02 (redaction config-load), 84-03 (sweeper), 84-04 (write-line/cache-split/openai-wire/digest), 84-05 (close-gzip/correlate), 84-07 (context-turns-route) each un-skip their named stub and fill the production assertions.

---
*Phase: 84-per-turn-context-revelation*
*Completed: 2026-07-07*

## Self-Check: PASSED
- All 13 created files verified present on disk.
- Both task commits (`961e8d632`, `15498d849`) verified in git log.
