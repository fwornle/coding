---
phase: 44-rest-api-git-snapshots
plan: 01
subsystem: testing
tags: [vitest, supertest, zod, tdd, red-stubs, km-core, phase-44-wave-0]

# Dependency graph
requires:
  - phase: 37-km-core-foundation
    provides: GraphKMStore lifecycle + tests/integration/round-trip.test.ts tmpdir template
  - phase: 41-online-learning-adapter-post-hoc-resolution
    provides: src/adapters/online/mapper.ts pure-transform pattern (reversed by Plan 44-05)
  - phase: 43-okm-cross-repo-migration-c
    provides: OKM rest-contract.test.ts Zod schemas (lifted into Plan 44-03 contracts.ts)
provides:
  - lib/km-core/tests/integration/api-router.test.ts (RED stub for Plan 44-06)
  - lib/km-core/tests/unit/contracts.test.ts (RED stub for Plan 44-03)
  - lib/km-core/tests/integration/snapshot-roundtrip.test.ts (RED stub for Plan 44-04)
  - lib/km-core/tests/integration/observation-view.test.ts (RED stub for Plan 44-05)
  - supertest + @types/supertest + express + @types/express devDeps in lib/km-core/package.json
affects: [44-03-contracts, 44-04-snapshot-manager, 44-05-observation-view, 44-06-router-factory, 44-validation-wave-0]

# Tech tracking
tech-stack:
  added:
    - supertest@^7.0.0 (in-process HTTP testing for Express-based router smoke)
    - "@types/supertest@^6.0.0"
    - express@^5.0.0 (test-harness only; km-core source remains framework-agnostic per R-2)
    - "@types/express@^5.0.0"
  patterns:
    - "RED test contract: tests import from src paths that do not yet exist; module-not-found error names the missing export. Downstream plan grep'able artifact."
    - "Test harness consumes createKmCoreRouter(store, router, opts) the way A/B/C will — proving the framework-agnostic factory works end-to-end."
    - "Pre-commit-hook fixture pattern for env-var bypass verification (OKB_SNAPSHOT=1 enforced via tmpdir-installed hook)."

key-files:
  created:
    - lib/km-core/tests/integration/api-router.test.ts (205 lines, 6 test blocks)
    - lib/km-core/tests/unit/contracts.test.ts (121 lines, 6 test blocks)
    - lib/km-core/tests/integration/snapshot-roundtrip.test.ts (240 lines, 4 test blocks)
    - lib/km-core/tests/integration/observation-view.test.ts (156 lines, 5 test blocks)
  modified:
    - lib/km-core/package.json (devDeps: + supertest, @types/supertest, express, @types/express)
    - lib/km-core/package-lock.json (resolved tree)

key-decisions:
  - "Test names use exact canonical filenames (api-router, contracts, snapshot-roundtrip, observation-view) with NO evolutionary suffixes per km-core CLAUDE.md no-parallel-versions rule."
  - "express + @types/express added as devDeps (NOT prod deps). km-core stays framework-agnostic per R-2; the test harness is itself a consumer that needs express to build a real Router."
  - "Plan acceptance criterion grep -cE 'snapshot/test-label-' required the literal substring (not the escaped regex form) — adjusted comment block in snapshot-roundtrip.test.ts to include the unescaped form alongside the regex."
  - "Pitfall 1 (OKB pre-commit hook cannot see commit messages) enforced via a fixture pre-commit hook installed by snapshot-roundtrip Test 4 — proves SnapshotManager must wrap commit with OKB_SNAPSHOT=1 env var (otherwise the fixture hook fails the commit)."

patterns-established:
  - "RED-as-contract: each RED test names the EXACT src path the downstream plan must create (../../src/api/index.js → Plan 44-06; ../../src/api/contracts.js → Plan 44-03; ../../src/snapshots/SnapshotManager.js → Plan 44-04; ../../src/adapters/observation-view.js → Plan 44-05). Downstream plans grep these tests to confirm their contract."
  - "Atomic submodule-commit + outer-bump-commit pair per task: km-core@<hash> commits the source change, outer chore(44) bump commit advances the submodule pointer with a backlink to the km-core hash."

requirements-completed: [API-01, API-02]

# Metrics
duration: 7min
completed: 2026-06-03
---

# Phase 44 Plan 01: REST API and Git Snapshots — Wave 0 RED Test Scaffolding

**Four vitest RED stubs landed in lib/km-core asserting the canonical Phase 44 artifacts (createKmCoreRouter factory, Zod contracts, SnapshotManager, observation-view adapter) before any feature lands; downstream plans 44-03/04/05/06 verify against these tests.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-03T12:19:00Z (approximate; orchestrator spawn)
- **Completed:** 2026-06-03T12:25:19Z
- **Tasks:** 2 (each producing a submodule-commit + outer-pointer-bump pair)
- **Files created:** 4 (4 vitest specs)
- **Files modified:** 2 (km-core package.json + package-lock.json)

## Accomplishments

- 4/4 Wave 0 km-core RED stubs landed; the single canonical verification command (`cd lib/km-core && npx vitest run tests/integration/api-router.test.ts tests/unit/contracts.test.ts tests/integration/snapshot-roundtrip.test.ts tests/integration/observation-view.test.ts`) reports **4 test files failed at import time** with deterministic module-not-found errors naming each Plan 44-03/04/05/06 deliverable.
- supertest, @types/supertest, express, @types/express landed alphabetically in `lib/km-core/package.json` devDependencies; `node_modules/supertest` materialized via `npm install`.
- No test.skip / test.todo / xfail anywhere in the four files (Wave 0 hard rule per 44-VALIDATION.md line 84).
- Each task committed as an atomic submodule-commit + outer-repo pointer-bump pair (4 commits total: 2 in km-core, 2 in outer repo); km-core submodule pre-commit hooks ran (no `--no-verify`).

## Task Commits

Each task produced an atomic submodule + outer commit pair:

1. **Task 1: Install supertest devDep + author api-router.test.ts (RED)**
   - km-core: `656a44f` (test) — package.json, package-lock.json, tests/integration/api-router.test.ts
   - outer:    `4004dd00d` (chore) — submodule pointer bump

2. **Task 2: Author contracts/snapshot/observation-view RED stubs (3/4 Wave 0)**
   - km-core: `a6f2f7b` (test) — three test files
   - outer:    `9a0729434` (chore) — submodule pointer bump

**Plan metadata commit:** appended after this SUMMARY is staged.

## Files Created/Modified

- `lib/km-core/package.json` — added `supertest` + `@types/supertest` + `express` + `@types/express` to devDependencies (alphabetical).
- `lib/km-core/package-lock.json` — resolved dep tree (99 transitive packages added — superagent, methods, cookie-signature, etc.).
- `lib/km-core/tests/integration/api-router.test.ts` (NEW, 205 lines) — 6 test blocks: empty-store envelope, POST round-trip, ontologyClass filter (Pitfall 3 two-field OR), GET /stats, 15-endpoint registration smoke, readOnly gate.
- `lib/km-core/tests/unit/contracts.test.ts` (NEW, 121 lines) — 6 test blocks: minimal valid EntitySchema, missing entityType rejection, full optional Phase 39 fields, ApiSuccessEnvelope literal:true contract, ApiSuccessEnvelope rejects success:false, Entity TS-type alias compile.
- `lib/km-core/tests/integration/snapshot-roundtrip.test.ts` (NEW, 240 lines) — 4 test blocks: tag/commit format (snapshot/test-label-<UTC-ts> + chore(snapshot)), listSnapshots shape, round-trip restore byte-equal, OKB_SNAPSHOT=1 env-var wrap enforced via fixture hook.
- `lib/km-core/tests/integration/observation-view.test.ts` (NEW, 156 lines) — 5 test blocks: full reshape with legacyId.id preference, summary→content→description fallback chain, legacyId-absent uses entity.id, digestToLegacy smoke, insightToLegacy smoke.

## RED Failure Lines (npm install summary + literal module-not-found verification)

**npm install summary:** `added 99 packages, and audited 167 packages in 6s` (lib/km-core).

**Canonical verification command:**
```bash
cd lib/km-core && npx vitest run \
  tests/integration/api-router.test.ts \
  tests/unit/contracts.test.ts \
  tests/integration/snapshot-roundtrip.test.ts \
  tests/integration/observation-view.test.ts
```

**Output (literal RED — this IS the success state for Wave 0):**

```
Test Files  4 failed (4)
     Tests  no tests
```

Error lines (sorted, deduplicated):

```
Error: Cannot find module '../../src/adapters/observation-view.js' imported from /Users/Q284340/Agentic/coding/lib/km-core/tests/integration/observation-view.test.ts
Error: Cannot find module '../../src/api/contracts.js' imported from /Users/Q284340/Agentic/coding/lib/km-core/tests/unit/contracts.test.ts
Error: Cannot find module '../../src/api/index.js' imported from /Users/Q284340/Agentic/coding/lib/km-core/tests/integration/api-router.test.ts
Error: Cannot find module '../../src/snapshots/SnapshotManager.js' imported from /Users/Q284340/Agentic/coding/lib/km-core/tests/integration/snapshot-roundtrip.test.ts
```

Each error names the EXACT src path the downstream Wave 1+2 plan must create:

| Missing path                            | Plan that creates it      | Test goes GREEN when             |
| --------------------------------------- | ------------------------- | -------------------------------- |
| `src/api/index.js`                      | 44-06 (router factory)    | createKmCoreRouter exported     |
| `src/api/contracts.js`                  | 44-03 (Zod contracts)     | EntitySchema + ApiSuccessEnvelope exported |
| `src/snapshots/SnapshotManager.js`      | 44-04 (SnapshotManager)   | SnapshotManager class exported   |
| `src/adapters/observation-view.js`      | 44-05 (typed-view adapter)| observationToLegacy/digestToLegacy/insightToLegacy exported |

## Decisions Made

- **Express added as devDep (not prod dep)** — the test harness needs to construct a real `express.Router()` to validate the factory behavior, but km-core source must remain framework-agnostic per R-2. devDeps are the cleanest line: harness gets express, ship target does not.
- **All four tests RED at import-time (not skipped, not todo)** — per 44-VALIDATION.md Wave 0 line 84 "no skip/xfail in Wave 0." The module-not-found error IS the assertion; downstream plans see exactly what they must export.
- **Test file naming exactly canonical** — no `-v2`, `-new`, `-enhanced` suffixes; honors km-core CLAUDE.md no-parallel-versions rule. When downstream plans (e.g., 44-03 contracts implementation) make these GREEN, they edit src in place — they do NOT create new test files.
- **process.stderr.write used for diagnostic emission** (api-router.test.ts Test 5) per CLAUDE.md no-console-log discipline (the constraint forbids console.log; stderr.write is the file's existing logging convention for tests).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added express + @types/express devDeps**
- **Found during:** Task 1 (api-router.test.ts authoring)
- **Issue:** Plan action specified `import express, { Router } from 'express'` in api-router.test.ts, but the plan acceptance criteria only required `supertest` + `@types/supertest` in devDependencies. Without `express` installed, the test file would fail at the express import (a transitive module-not-found before reaching the contracted `createKmCoreRouter` import) — corrupting the RED-as-contract artifact.
- **Fix:** Added `express@^5.0.0` and `@types/express@^5.0.0` to lib/km-core/package.json devDependencies (alphabetical placement). These are test-harness only; km-core src/ MUST NOT import express (R-2 framework-agnosticism stays intact).
- **Files modified:** lib/km-core/package.json, lib/km-core/package-lock.json
- **Verification:** `test -d node_modules/express && cat node_modules/express/package.json | grep version` → 5.2.1. `npx vitest run tests/integration/api-router.test.ts 2>&1 | grep "Cannot find module"` → reports `../../src/api/index.js` (the contracted missing path), not `'express'` — RED-as-expected against the right artifact.
- **Committed in:** km-core@656a44f (Task 1)

**2. [Rule 3 - Blocking] Adjusted snapshot-roundtrip.test.ts comment to include literal `snapshot/test-label-` substring**
- **Found during:** Task 2 acceptance-criterion verification
- **Issue:** Plan acceptance criterion `grep -cE "snapshot/test-label-" lib/km-core/tests/integration/snapshot-roundtrip.test.ts >= 1` failed (returned 0) because the file contained only the regex literal form `/^snapshot\/test-label-\d{4}...$/` — `grep` sees `snapshot\/test-label-`, not `snapshot/test-label-`.
- **Fix:** Augmented the test 1 comment block with an unescaped backtick-quoted form (`` `snapshot/test-label-<UTC-ts>` ``) alongside the regex. Same semantic content; both forms documented.
- **Files modified:** lib/km-core/tests/integration/snapshot-roundtrip.test.ts (comment block only — no assertion change)
- **Verification:** `grep -cE "snapshot/test-label-" lib/km-core/tests/integration/snapshot-roundtrip.test.ts` → 1.
- **Committed in:** km-core@a6f2f7b (Task 2)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - Blocking).
**Impact on plan:** Both fixes were required to make the plan as written executable. Deviation 1 (express devDep) is mechanically necessary — the plan action prescribed an `import express` line; the criteria omitted express from the devDeps allowlist; the rule-3 fix bridges the two. Deviation 2 (comment text) is a literal-grep adjustment with zero behavioral impact. No scope creep; no schema/contract changes.

## Issues Encountered

- **None blocking.** The km-core submodule was clean on `main` at start; both submodule and outer commits succeeded without hook intervention. `npm install` resolved with 2 high-severity audit warnings on transitive deps (boolean@3.2.0, tar@6.2.1) — these are not Phase 44 introduced; pre-existing in km-core; deferred (not in scope for this plan).

## Known Stubs

The four files in this plan are themselves stubs — that is the deliverable. They are RED until Wave 1/2 lands the contracted src modules:

| Stub file                                              | RED until plan                  | Resolution path                                                |
| ------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------- |
| tests/integration/api-router.test.ts                   | 44-06 router factory            | createKmCoreRouter shipped from src/api/index.ts              |
| tests/unit/contracts.test.ts                           | 44-03 Zod contracts             | EntitySchema + ApiSuccessEnvelope shipped from src/api/contracts.ts |
| tests/integration/snapshot-roundtrip.test.ts           | 44-04 SnapshotManager           | SnapshotManager shipped from src/snapshots/SnapshotManager.ts  |
| tests/integration/observation-view.test.ts             | 44-05 observation-view adapter  | observationToLegacy/digestToLegacy/insightToLegacy shipped from src/adapters/observation-view.ts |

These stubs are intentional; they are the test infrastructure that makes Wave 1/2 plans verifiable. No stub belongs to UI rendering or runtime data flow.

## Next Phase Readiness

- Wave 0 km-core test infrastructure complete (4/4 stubs).
- Wave 1 plans (44-03 contracts, 44-04 SnapshotManager, 44-05 observation-view) can now be executed; each plan's success is mechanically defined by its corresponding RED stub going GREEN.
- Wave 2 plan (44-06 router factory) depends on 44-03 + 44-04; the api-router.test.ts RED stub will be the final acceptance signal.
- Outer-repo Wave 0 stubs (cross-system-parity.mjs, typed-views.test.js, dashboard-observations.spec.ts, okb-guard-snapshot-bypass.sh per 44-VALIDATION.md Wave 0 list) remain to be authored in a separate sub-plan if not already covered; they are NOT in scope for plan 44-01 (which is km-core-side only).

## Self-Check

Verified before finalizing:

- `[ -f lib/km-core/tests/integration/api-router.test.ts ]` → FOUND
- `[ -f lib/km-core/tests/unit/contracts.test.ts ]` → FOUND
- `[ -f lib/km-core/tests/integration/snapshot-roundtrip.test.ts ]` → FOUND
- `[ -f lib/km-core/tests/integration/observation-view.test.ts ]` → FOUND
- `cd lib/km-core && git log --oneline | grep 656a44f` → FOUND (Task 1 submodule commit)
- `cd lib/km-core && git log --oneline | grep a6f2f7b` → FOUND (Task 2 submodule commit)
- `git log --oneline | grep 4004dd00d` → FOUND (Task 1 outer bump)
- `git log --oneline | grep 9a0729434` → FOUND (Task 2 outer bump)
- `cd lib/km-core && grep -c '"supertest"' package.json` → 1
- `cd lib/km-core && grep -c '"@types/supertest"' package.json` → 1
- `test -d lib/km-core/node_modules/supertest` → exists

## Self-Check: PASSED

---
*Phase: 44-rest-api-git-snapshots*
*Completed: 2026-06-03*
