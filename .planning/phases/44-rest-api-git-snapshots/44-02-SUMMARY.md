---
phase: 44-rest-api-git-snapshots
plan: 02
subsystem: testing
tags: [node-test, jest, playwright, bash-test, red-stubs, cross-system, typed-views, okb-guard, phase-44-wave-0]

# Dependency graph
requires:
  - phase: 37-km-core-foundation
    provides: D-21 two-commit pattern + OKB-baseline guard contract that this plan's bash test exercises
  - phase: 43-okm-cross-repo-migration-c
    provides: Pitfall 2 typed-view shape lock that typed-views.test.js asserts (legacy /api/coding/* envelope { data, total, limit, offset } + agent/project/content/artifacts/timestamp keys)
  - phase: 44-rest-api-git-snapshots/01
    provides: Wave 0 RED test scaffolding convention -- every Wave 0 stub fails with a deterministic, message-bearing diagnostic naming the missing service / file / endpoint
provides:
  - tests/integration/cross-system-parity.mjs (RED stub for Plans 44-07/08/09 -- /api/v1 mount cutover)
  - tests/integration/typed-views.test.js (RED stub for Plan 44-07 -- A typed-view mount + Plan 44-10 SQLite-to-km-core migration)
  - tests/integration/okb-guard-snapshot-bypass.sh (RED stub for Plan 44-04 -- OKB_SNAPSHOT=1 hook bypass)
  - tests/e2e/dashboard-observations.spec.ts (RED stub for Plans 44-07/10/11 -- dashboard render after typed-view cutover)
  - .gitignore entry for tests/e2e/_artifacts/ (T-44-02-02 mitigation -- playwright audit-trail screenshots stay local)
affects: [44-04-okb-hook-bypass, 44-07-a-typed-views-mount, 44-08-b-mount, 44-09-c-cutover, 44-10-sqlite-migration, 44-11-verification]

# Tech tracking
tech-stack:
  added:
    - "node:test runner used for the .mjs cross-system test (Node 25 built-in; chosen over Jest because cross-system-parity.mjs needs built-in `fetch` and Jest is configured for *.test.js)"
    - "Bash + git init + mktemp pattern for the OKB-guard env-var round-trip (no existing local bash-test template, per 44-PATTERNS.md)"
    - "Playwright @playwright/test spec mirroring tests/e2e/dashboard/workflow-graph-colors.spec.ts conventions (no inline chromium.launch -- `prefer-gsd-browser` constraint)"
  patterns:
    - "RED stub failure mode: every coding-side Wave 0 test names the missing service / file / endpoint in its assertion message (e.g. 'Service A /entities?limit=1 returned HTTP 404 -- /api/v1 not mounted (expected RED until Plans 07/08/09)'). Downstream plans grep these literals to confirm landing."
    - "Cross-system parity uses normalize() to strip volatile keys (timestamp/createdAt/updatedAt/id/commit_sha/runId) + shapeOf() to compare top-level/nested key shape WITHOUT comparing array contents -- each system has different data."
    - "Pitfall 2 envelope assertion lifted into a reusable assertEnvelopeShape() helper for typed-views.test.js (shared by /observations, /digests, /insights tests)."
    - "Shell test isolates state via mkdtemp + trap-on-EXIT rm-rf (T-44-02-01 mitigation)."

key-files:
  created:
    - tests/integration/cross-system-parity.mjs (143 lines, 7 test blocks -- 3 smoke + 3 shape parity + 1 module-level normalize/shapeOf coverage; runs via `node --test`)
    - tests/integration/typed-views.test.js (159 lines, 4 test blocks; Jest 29; uses built-in fetch from Node 25)
    - tests/integration/okb-guard-snapshot-bypass.sh (98 lines, executable, 2 test cases: OKB_SNAPSHOT=0 reject + OKB_SNAPSHOT=1 bypass)
    - tests/e2e/dashboard-observations.spec.ts (96 lines, 3 test blocks; @playwright/test)
  modified:
    - .gitignore (added tests/e2e/_artifacts/ entry -- Phase 44 T-44-02-02 mitigation)

key-decisions:
  - "Cross-system parity test uses node:test (not Jest) because Jest is configured for *.test.js with experimental-vm-modules and the file needs ESM-native built-in fetch; node-fetch is not a coding-repo dependency (verified via grep). The .mjs extension makes the runner choice explicit."
  - "Cross-system parity compares shape skeletons (top-level + nested key shape via shapeOf()) NOT array contents -- each system holds different data so length-equality cannot be asserted. Volatile fields are stripped via normalize() before shape extraction."
  - "Typed-views test asserts the Pitfall 2 envelope shape { data, total, limit, offset } as the FIRST contract, then row-key presence, then per-key type. assertEnvelopeShape() is reusable across the 3 endpoint tests."
  - "Server-side filter test (Test 4) asserts filtered.length <= all.length AND every filtered row matches the filter -- defends against client-side post-filter bugs that would superficially look correct."
  - "Shell test uses set +e / set -e bracketing around the hook invocation so the script can capture the non-zero exit code without aborting (the script itself is set -euo pipefail at the top)."
  - "Playwright spec follows CLAUDE.md `gsd-browser` rule explicitly -- uses @playwright/test framework + Page API (NO hand-rolled chromium.launch). Inline reference to the rule is in the leading comment so future readers know why."
  - ".gitignore added tests/e2e/_artifacts/ instead of putting the spec in a different directory -- keeps the spec colocated with other tests/e2e/* specs while preventing screenshot churn from polluting commits."

patterns-established:
  - "Deterministic-RED failure message convention: every Wave 0 stub's primary assertion failure names the future-plan ID that will land the GREEN behavior (e.g. 'Plan 44-04 not yet applied'). Future plan executors / verifiers can grep these strings."
  - "Cross-system shape normalization: normalize() (drop volatile fields) then shapeOf() (extract key skeleton) then deepStrictEqual on the skeleton. Defends against UUID + timestamp + commit-sha drift while still catching real shape divergence."
  - "Bash test pattern for env-var bypass: mkdtemp + git init + git config user.email/name + stage matching file + invoke hook with env var. Reusable for any future hook-bypass guard."

requirements-completed: []  # API-01 + API-02 are not COMPLETED by this plan -- Wave 0 stubs are intentionally RED. Listed in PLAN frontmatter as the requirements the plan SERVES (not closes).

# Metrics
duration: ~25 min
completed: 2026-06-03
---

# Phase 44 Plan 02: Coding-repo Wave 0 RED Test Stubs Summary

**4 deterministic RED stubs in tests/integration/ + tests/e2e/ locking cross-system /api/v1 shape parity, A-side typed-view envelope (Pitfall 2), OKB_SNAPSHOT=1 hook bypass, and dashboard observations panel render-after-migration -- each fails today with a message-bearing diagnostic naming the missing service/endpoint/plan that will land its GREEN.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-03T~12:08Z
- **Completed:** 2026-06-03T12:33Z
- **Tasks:** 2 (both `tdd="true"`, both committed as `test(44-02): ...`)
- **Files created:** 4 (3 tests + 1 .gitignore modification)

## Wave 0 Coverage

| Wave 0 Stub | Owner Plan | Status |
|-------------|------------|--------|
| `lib/km-core/tests/integration/api-router.test.ts` | Plan 44-01 | RED (landed in 44-01) |
| `lib/km-core/tests/unit/contracts.test.ts` | Plan 44-01 | RED (landed in 44-01) |
| `lib/km-core/tests/integration/snapshot-roundtrip.test.ts` | Plan 44-01 | RED (landed in 44-01) |
| `lib/km-core/tests/integration/observation-view.test.ts` | Plan 44-01 | RED (landed in 44-01) |
| `tests/integration/cross-system-parity.mjs` | **Plan 44-02** | **RED (landed here)** |
| `tests/integration/typed-views.test.js` | **Plan 44-02** | **RED (landed here)** |
| `tests/integration/okb-guard-snapshot-bypass.sh` | **Plan 44-02** | **RED (landed here)** |
| `tests/e2e/dashboard-observations.spec.ts` | **Plan 44-02** | **RED (landed here)** |

**Running Wave 0 count: 8 / 8** -- the full Wave 0 set defined in `44-VALIDATION.md` is now in place. Phase 44 is unblocked to begin Wave 1.

## Accomplishments

- 4 coding-side Wave 0 stubs landed with exact filenames (no evolutionary suffixes).
- Each test fails with a deterministic, message-bearing diagnostic naming what's missing AND the plan that will land it.
- All file names match the canonical list from PLAN.md frontmatter character-for-character.
- `.gitignore` extended to keep `tests/e2e/_artifacts/` out of source control (T-44-02-02).

## Task Commits

Each task was committed atomically:

1. **Task 1: Author cross-system-parity.mjs + typed-views.test.js (RED)** -- `255a1f934` (test)
2. **Task 2: Author okb-guard-snapshot-bypass.sh + dashboard-observations.spec.ts (RED)** -- `8e8132100` (test)

**Plan metadata commit:** _appended after this SUMMARY._

## Files Created/Modified

- `tests/integration/cross-system-parity.mjs` (NEW, 143 lines) -- drives A=12436 / B=3848 / C=3002 against `/api/v1/{entities,stats,ontology/classes}`; normalize() + shapeOf() for portable shape diff; honest fail mode on non-JSON content-type
- `tests/integration/typed-views.test.js` (NEW, 159 lines) -- Pitfall 2 envelope + row-shape lock for `/api/coding/{observations,digests,insights}`; server-side filter contract test
- `tests/integration/okb-guard-snapshot-bypass.sh` (NEW, 98 lines, executable) -- tmpdir-isolated round-trip for OKB_SNAPSHOT bypass; PASS/FAIL summary
- `tests/e2e/dashboard-observations.spec.ts` (NEW, 96 lines) -- @playwright/test spec for `[data-testid="observations-table"]` + populated agent/project cells + audit screenshot
- `.gitignore` (MODIFIED, +5 lines) -- added `tests/e2e/_artifacts/` entry per T-44-02-02

## Observed RED Failure Messages (literal)

These are the literal failure strings the stubs emit today (captured during pre-commit verification):

**cross-system-parity.mjs (node --test):**

- `Service A /entities?limit=1 returned HTTP 404 -- /api/v1 not mounted (expected RED until Plans 07/08/09)`
- `Service B /ontology/classes returned HTTP 404 -- /api/v1 not mounted (expected RED until Plans 07/08/09)`
- `Service C /entities?limit=1 returned non-JSON content-type 'text/html; charset=utf-8' -- /api/v1 not mounted (expected RED until Plans 07/08/09)`
- 6 failing tests / 6 total

**typed-views.test.js (Jest 29):**

- `Typed view /api/coding/observations?limit=1 returned HTTP 404 -- /api/coding/* not yet mounted (expected RED until Plan 44-07)` (4 tests)
- `Test Suites: 1 failed, 1 total; Tests: 4 failed, 4 total`

**okb-guard-snapshot-bypass.sh (bash):**

- Case A: `OKB_SNAPSHOT=0 expecting hook exit != 0` -> `PASS: hook rejected (exit=1)`
- Case B: `OKB_SNAPSHOT=1 expecting hook exit 0` -> `FAIL: hook should have bypassed with OKB_SNAPSHOT=1 (got exit=1) -- Plan 44-04 not yet applied`
- `Summary: PASS=1, FAIL=1`
- Script exit code: 1

**dashboard-observations.spec.ts:** Not run in this plan (requires the dashboard at :3032 + a Playwright config; verification runs in Plan 44-11). Expected RED until that plan because (a) `[data-testid="observations-table"]` doesn't exist on the panel today and (b) the agent/project cells depend on Plan 44-10 migration.

## Decisions Made

- **node:test (not Jest) for cross-system-parity.mjs** -- Jest needs experimental-vm-modules + a `*.test.js` filename and the file genuinely needs built-in `fetch` (no `node-fetch` dep in coding repo). `.mjs` extension + `node --test` keeps the runner choice explicit.
- **shapeOf() over deep-equal of normalized objects** -- each system holds different data, so array length cannot be asserted equal. shapeOf() compares top-level + nested key skeletons WITHOUT comparing array contents.
- **`.gitignore` `tests/e2e/_artifacts/`** -- Phase 44 T-44-02-02 mitigation. Keeps the playwright audit-trail screenshots out of source control while letting the spec stay colocated with other tests/e2e/* specs.

## Deviations from Plan

None -- plan executed exactly as written. Both tasks landed the files named in the PLAN frontmatter at the line counts the acceptance criteria demanded, with RED behavior verified before commit.

## Issues Encountered

- **First draft of cross-system-parity.mjs let `res.json()` throw `Unexpected token '<'` when C's :3002 returned an HTML 404.** Re-read the requirement "Honest fail mode: if any service is down, log which one to stderr and fail the test with a clear message (not a generic timeout)" -- added a content-type check before `res.json()` so the test surfaces `non-JSON content-type 'text/html; charset=utf-8' -- /api/v1 not mounted` instead of letting `JSON.parse` blow up. This was an in-task refinement, not a Rule-1 deviation (the original draft was syntactically RED but with the wrong fail message; correcting the message keeps the spec faithful to the plan).

## Threat Flags

None -- no new security-relevant surface introduced beyond what the threat model already enumerated (T-44-02-01 tmpdir cleanup mitigated by trap-on-EXIT; T-44-02-02 screenshot artifacts mitigated by `.gitignore` entry).

## Self-Check: PASSED

- `[ -f tests/integration/cross-system-parity.mjs ]` -> FOUND
- `[ -f tests/integration/typed-views.test.js ]` -> FOUND
- `[ -x tests/integration/okb-guard-snapshot-bypass.sh ]` -> FOUND (executable)
- `[ -f tests/e2e/dashboard-observations.spec.ts ]` -> FOUND
- `git log --oneline | grep 255a1f934` -> FOUND (Task 1)
- `git log --oneline | grep 8e8132100` -> FOUND (Task 2)
- All acceptance-criteria greps from PLAN.md returned the required counts (manual run, captured above).

## TDD Gate Compliance

Both tasks are `tdd="true"` and committed as `test(44-02): ...` -- RED commits. These are the intentional RED gate of the plan; GREEN commits land in Plans 44-04 (hook bypass), 44-07 (A typed views), 44-08 (B mount), 44-09 (C cutover), 44-10 (SQLite migration), and 44-11 (verification + dashboard testids).

## Next Plan Readiness

- Wave 0 is closed. Wave 1 plans (44-03 contracts, 44-04 hook bypass, 44-05 observation-view adapter) can begin.
- The dashboard spec's `data-testid` selectors are the authoritative target Plan 44-11 must satisfy (or Plan 44-11 must update this spec via an in-plan deviation).
- No blockers introduced.

---
*Phase: 44-rest-api-git-snapshots*
*Plan: 02*
*Completed: 2026-06-03*
