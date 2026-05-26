---
phase: 50-lsl-grounded-async-observation-resolver
plan: 02
subsystem: live-logging
tags: [lsl, observation-writer, needs-lsl-resolution, pronoun-detector, plan-2]
dependency_graph:
  requires:
    - lib/lsl/window.mjs (Plan 50-01 — getLSLWindow N-prompt walker)
  provides:
    - src/live-logging/ObservationWriter.js::_buildPriorContext (migrated to N-prompt window)
    - src/live-logging/ObservationWriter.js::_hasUnresolvedPronoun (new detector B heuristic)
    - src/live-logging/ObservationWriter.js::_extractPriorLine (new helper)
    - metadata.needs_lsl_resolution stamp on observations table rows
  affects:
    - upstream Phase 50 Plan 03 (cron / launchd) — sweeps rows with the stamp preferentially
    - downstream Phase 51 — no direct effect, Plan 01's primitive contract preserved
tech-stack:
  added: []  # no new package installs; lib/lsl/window.mjs already shipped in Plan 01
  patterns:
    - Capture-time pre-filter pattern (stamp at write, sweep later) replaces regex re-scan
    - process.stderr forensic line in lieu of console.* (CLAUDE.md constraint)
    - jest.unstable_mockModule with global.fetch swap for end-to-end DB persistence tests
key-files:
  created:
    - tests/live-logging/ObservationWriter.needs-lsl-resolution.test.js (263 lines, 13 tests)
    - tests/live-logging/ObservationWriter.prior-context-lsl.test.js (195 lines, 8 tests)
  modified:
    - src/live-logging/ObservationWriter.js (+125 lines, -8 lines — single source file)
key-decisions:
  - "Stamp persistence path: summarize() returns needs_lsl_resolution alongside summary/llm; processMessages() folds it into enrichedMeta before _serializedWrite. Each of the 4 summarize() return paths propagates the flag so fallback rows (proxy down) still get stamped."
  - "Heuristic regex over LLM classifier: per CONTEXT.md interfaces note, false positives are acceptable (resolver re-evaluates with LLM), false negatives are the failure mode — keep the heuristic lenient. Three patterns: standalone affirmations, canonical verb+pronoun, bare 'the X' without clarifying noun within 40 chars."
  - "_extractPriorLine helper introduced: the LSL-window content is a combined <user>...<assistant>... string; the helper extracts assistant Intent first, then falls back to user's first non-blank line. This differs from the legacy _extractIntent semantics which only consumed prior observation Intents — Task 1's <action> explicitly permits a small helper change."
  - "D-47-Boundary held strictly: image-attachment block at original line ~318 (readFiles + image processing) is byte-identical pre/post; verified via 3-layer grep on the diff."
requirements-completed: []  # Phase 50 has no REQUIREMENTS.md entries
metrics:
  duration: 5min
  completed: 2026-05-26
  tasks: 2 of 2 complete
  files_created: 2
  files_modified: 1
  tests_added: 21 (8 prior-context + 13 detector B)
  tests_passing: 52 of 52 (21 new + 5 retention-floor + 26 Plan 01)
---

# Phase 50 Plan 02: ObservationWriter LSL-Window Integration + Detector B Summary

LSL-grounded `_buildPriorContext` migration (replaces 30-min wall-clock observation-DB window with 3-prompt LSL window from Plan 01) plus the new `_hasUnresolvedPronoun` heuristic that stamps `metadata.needs_lsl_resolution = true` at capture time so Plan 01's resolver picks up ambiguous rows preferentially — closes the inline-tier weakness described in CONTEXT.md lines 82-90.

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-26T14:07:17Z
- **Completed:** 2026-05-26T14:12:32Z
- **Tasks:** 2 of 2 complete
- **Files modified:** 1
- **Files created:** 2 (both test files)

## Accomplishments

- **Should #7 closed:** `_buildPriorContext` no longer uses the 30-min wall-clock SQL window on `observations`; it delegates to `getLSLWindow({maxPrompts: 3, project})` from `lib/lsl/window.mjs`. Both inline and async tiers now agree on what "recent context" means (3 user prompts, interaction-time, not wall-clock).
- **Detector B shipped:** New `_hasUnresolvedPronoun(messages)` heuristic flags rows where the user's last message contains an unresolved pronoun AND `_buildPriorContext` returned empty; `metadata.needs_lsl_resolution = true` persists into the observations table. Plan 01's resolver selects on `json_extract(metadata, '$.needs_lsl_resolution') = 1` (verified end-to-end via DB persistence test).
- **D-47-Boundary preserved:** Image-attachment writer-path stays a Phase 47 concern; verified via 3-layer diff guard (hunk-region check + literal `[Image: source:` grep + readFiles symbol grep — all clean).
- **XML format preserved byte-for-byte:** The `<prior_observations>` wrapper that the line-355 LLM prompt expects is unchanged in shape; only the data source changed.
- **Throw-safety preserved:** `getLSLWindow` errors are caught and silently return `''`, mirroring the original outer-catch semantics. Both inline (`try {} catch {}` around getLSLWindow) and outer fallback (`try {} catch { return ''; }`) are in place.

## Task Commits

Each task was committed atomically (TDD: RED test → GREEN feat):

1. **Task 1 RED: failing prior-context-lsl tests** — `f89814687` (test)
2. **Task 1 GREEN: migrate _buildPriorContext to LSL N-prompt window** — `556257220` (feat)
3. **Task 2 RED: failing needs-lsl-resolution tests** — `e85ea6731` (test)
4. **Task 2 GREEN: detector B capture-time stamp** — `200589ee2` (feat)

No refactor commits needed — both GREEN implementations stayed clean.

## Files Created/Modified

- `src/live-logging/ObservationWriter.js` (modified):
  - Added `import { getLSLWindow } from '../../lib/lsl/window.mjs'` (line 19).
  - Rewrote `_buildPriorContext(metadata)` — now delegates to `getLSLWindow`, preserves the `<prior_observations>` XML wrapper, preserves throw-safety, caps lines at 3 with 200-char truncation. Updated JSDoc to reference Phase 50.
  - Added `_extractPriorLine(content)` helper — extracts the assistant Intent line if the 4-line template is present, else the user's first non-blank line.
  - Added `_hasUnresolvedPronoun(messages)` heuristic — three pattern classes (standalone affirmation / canonical verb+pronoun / bare "the X" without clarifying noun).
  - Modified `summarize(messages, metadata)` — computes `needsLslResolution` after `_buildPriorContext`, emits a `process.stderr` forensic line when set, propagates the flag through all 4 return paths.
  - Modified `processMessages(messages, metadata)` — folds `needs_lsl_resolution: true` into `enrichedMeta` before `_serializedWrite` when the flag is set.
- `tests/live-logging/ObservationWriter.prior-context-lsl.test.js` (created, 195 lines, 8 tests) — Migration coverage for `_buildPriorContext`: empty window, XML wrap, Intent extraction, 200-char truncation, throw-safety, project pass-through, missing-agent guard, missing-project guard.
- `tests/live-logging/ObservationWriter.needs-lsl-resolution.test.js` (created, 263 lines, 13 tests) — Detector B coverage: 8 `_hasUnresolvedPronoun` unit tests (canonical / yes / same again / no pronoun / bare-vs-clarified / last-message scoping), 3 `summarize` integration tests (stamp/no-stamp matrix), 2 `processMessages` end-to-end DB persistence tests.

## Decisions Made

- **Followed plan as specified.** All implementation choices were explicit in PLAN.md `<action>` blocks. Two locally-scoped helper functions (`_extractPriorLine`, `_hasUnresolvedPronoun`) added per the plan; no out-of-plan helpers introduced.
- **Single-source helper `_extractPriorLine`** rather than reusing `_extractIntent` directly — because the LSL window's exchange content combines `<user>...<assistant>...` blocks (per `lib/lsl/window.mjs::renderExchangeContent`), and the user text is needed as fallback when no assistant-template Intent is present. Plan Task 1 explicitly permits this divergence ("the function is migrating from 'extract Intent from prior assistant summary' to 'summarize prior user exchange' so a small helper change is acceptable").
- **needsLslResolution propagated through ALL 4 summarize() return paths** (success + 3 fallback paths) so a row that fails LLM summarization still gets stamped if the heuristic fires. The plan's `<action>` Step 3 covers this implicitly via "the FINAL metadata JSON column in the observations table row MUST contain needs_lsl_resolution: true for matching cases".

## Deviations from Plan

None — plan executed exactly as written.

The `<verification>` Step 4 D-47-Boundary 3-layer guard passes cleanly. The `<done>` criteria for both tasks pass verbatim:

- Task 1 done: `grep -cE "from ['\"]../../lib/lsl/window\.mjs['\"]"` = `1`, `this.db.prepare` inside `_buildPriorContext` = `0`, `-30 minutes` literal inside `_buildPriorContext` = `0`, `<prior_observations>` count = `2` (unchanged), `console.*` inside `_buildPriorContext` = `0`, all 8 new tests pass.
- Task 2 done: `_hasUnresolvedPronoun` count = `2` (definition + call site), all new `console.*` in diff = `0`, all 13 detector B tests pass, all 8 Task 1 tests still pass, all 5 retention-floor regression tests still pass, D-47-Boundary inspection clean.

## Issues Encountered

None.

## D-47-Boundary Verification (closes plan-checker W6)

The plan's `<verification>` Step 4 mandates three independent greps on `git diff src/live-logging/ObservationWriter.js`:

**(a) Hunk-region check** — diff hunk headers must land only in the 4 permitted regions:

```
$ git diff <plan-01-tip>..HEAD -- src/live-logging/ObservationWriter.js | grep -nE '^@@'
5:@@ -16,6 +16,7 @@ import Redis from 'ioredis';                  ← import statement (Step 1 of Task 1)
13:@@ -249,55 +250,166 @@ export class ObservationWriter {        ← _buildPriorContext + _extractPriorLine + _hasUnresolvedPronoun
208:@@ -386,7 +498,7 @@ export class ObservationWriter {          ← summarize return path #2 (fallback after non-ok response)
217:@@ -395,7 +507,7 @@ export class ObservationWriter {          ← summarize return path #1 (success)
226:@@ -406,10 +518,10 @@ export class ObservationWriter {         ← summarize return paths #3 + #4 (after retries / outer catch)
239:@@ -832,10 +944,16 @@ export class ObservationWriter {         ← processMessages metadata-merge
```

All 6 hunks map to permitted regions: 1 import + `_buildPriorContext` body + new `_hasUnresolvedPronoun` (combined hunk because they're adjacent) + 4 lines inside `summarize` body + `processMessages` metadata-merge step. Zero hunks touch the image-attachment region (original lines ~318 of pre-Plan-02 source).

**(b) `[Image: source:` literal check** — must be 0:

```
$ git diff <plan-01-tip>..HEAD -- src/live-logging/ObservationWriter.js | grep -cE '\[Image: source:'
0
```

**(c) Image-handling identifier check** — must be 0:

```
$ git diff <plan-01-tip>..HEAD -- src/live-logging/ObservationWriter.js | grep -cE 'readFiles|image[._-]?attachment|attachments\['
0
```

All three guards pass. Phase 47's image-attachment writer-path fix remains separate per D-47-Boundary.

## Self-Check: PASSED

**File existence:**
- `src/live-logging/ObservationWriter.js` FOUND (modified)
- `tests/live-logging/ObservationWriter.prior-context-lsl.test.js` FOUND
- `tests/live-logging/ObservationWriter.needs-lsl-resolution.test.js` FOUND

**Commits present in git log:**
- `f89814687` (Task 1 RED — test)
- `556257220` (Task 1 GREEN — feat)
- `e85ea6731` (Task 2 RED — test)
- `200589ee2` (Task 2 GREEN — feat)

**Test suite:**

```
$ NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/live-logging/ObservationWriter --no-coverage
Test Suites: 3 passed, 3 total
Tests:       26 passed, 26 total
```

Plan 01's contract unchanged:

```
$ NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/live-logging/lsl-window.test.js --no-coverage
Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```

Full Plan 01 + Plan 02 combined: **52 tests, all passing.**

**Done-criteria greps** (Tasks 1 + 2):

```
grep -cE "from ['\"]\.\./\.\./lib/lsl/window\.mjs['\"]" src/live-logging/ObservationWriter.js  → 1
awk '/_buildPriorContext\(metadata\)/,/^  \}/' ... | grep -c "this\.db\.prepare"               → 0
awk '/_buildPriorContext\(metadata\)/,/^  \}/' ... | grep -c -- "-30 minutes"                  → 0
grep -c "<prior_observations>" ... (must remain 2)                                              → 2
grep -c "_hasUnresolvedPronoun" ...                                                             → 2
git diff <base> -- ... | grep -E "^\+.*console\.(log|error|warn)" | wc -l                       → 0
```

## TDD Gate Compliance

Both tasks followed the RED → GREEN cycle with separate commits:

| Task | RED commit | GREEN commit | Verified |
|------|------------|--------------|----------|
| 1 (`_buildPriorContext` migration) | `f89814687` (test) | `556257220` (feat) | 4 RED-fail → 8 GREEN-pass |
| 2 (detector B stamp) | `e85ea6731` (test) | `200589ee2` (feat) | 10 RED-fail → 13 GREEN-pass |

No refactor commits needed — both GREEN implementations stayed clean.

## Threat Model Mitigations Verified

| Threat ID | Mitigation | Verified by |
|-----------|------------|-------------|
| T-50-02-RD (regex DoS on user content) | Patterns are bounded; longest unanchored span is the 40-char `bareRefMatch` slice. No nested quantifiers, no catastrophic backtracking. | Inspection — 3 regex literals in `_hasUnresolvedPronoun`, all anchored or bounded |
| T-50-02-FP (false-positive flagging) | Accepted per CONTEXT.md interfaces note — false positives only mean an extra LLM call by Plan 01's resolver during sweep | Test 6b verifies clarifying-noun negative path; documented in PLAN |
| T-50-02-LR (forensic stderr info disclosure) | Logs `agent` + `project` + ISO `created_at` only — no message body | Inspection of `process.stderr.write` call in `summarize` |
| T-50-02-RG (`_buildPriorContext` migration tampering) | Throw-safety preserved (inner try/catch around `getLSLWindow` returns `''`; outer catch returns `''`); XML wrapper format unchanged (grep-locked to 2 occurrences) | Test 5 (throw → empty) + grep `<prior_observations>` = 2 |
| T-50-02-SC (supply chain) | No new package installs | `git diff package.json` clean (unchanged) |

## Plan 01 Import Contract — Unchanged

Plan 01's `lib/lsl/window.mjs::getLSLWindow` signature is **imported, not modified**. Phase 51 import contract preserved verbatim:

```javascript
// lib/lsl/window.mjs — UNCHANGED in Plan 02
export function getLSLWindow(observation, {
  maxPrompts = 3,
  maxWallClockMs = 24 * 60 * 60 * 1000,
  maxBytes = 30 * 1024,
  project,
} = {}) { /* returns { exchanges, sourceFile, byteCount, windowSpanMs } */ }
```

The `git diff lib/lsl/window.mjs` is empty.

## Authentication Gates

None encountered. All tests run offline against tmpdir SQLite + mocked `getLSLWindow` + mocked `fetch`.

## Known Stubs

None. The `_hasUnresolvedPronoun` heuristic's clarifying-noun list is a finite enumerated allow-list documented in the function body comment; new domain nouns can be added without rewiring the algorithm. Plan 01's `getLSLWindow` window-size defaults (maxPrompts=3, maxWallClockMs=24h, maxBytes=30KB) flow through unchanged.

## Next Phase Readiness

Plan 50-03 (cron / launchd job) can ship next:

- Plan 03 schedules `scripts/resolve-observations-from-lsl.mjs` (Plan 01) periodically with `--limit 100 --since <last-run>`.
- Plan 03's sweep will preferentially process rows where `json_extract(metadata, '$.needs_lsl_resolution') = 1` (already implemented in Plan 01's resolver — verified via `grep -c "needs_lsl_resolution" scripts/resolve-observations-from-lsl.mjs`).
- Verification path: after some live LSL traffic with pronouns hits the writer, `sqlite3 .observations/observations.db "SELECT COUNT(*) FROM observations WHERE json_extract(metadata, '$.needs_lsl_resolution') = 1"` returns a positive integer, and the cron run resolves them.

No code blockers for Plan 03. Plan 50 acceptance criteria #1 (the three `2026-05-23 07:33` km-core rows) is already satisfied by Plan 01's CLI — Plan 02 reduces future regex-sweep cost; Plan 03 wires the cadence.

---

*Phase: 50 — lsl-grounded-async-observation-resolver*
*Plan: 02 — ObservationWriter LSL-window integration + detector B*
*Completed: 2026-05-26*
