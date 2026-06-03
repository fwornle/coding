---
phase: 44-rest-api-git-snapshots
plan: 04
subsystem: api
tags: [snapshots, git, km-core, okb-guard, pre-commit-hook, restore, S-1, S-2, S-3, S-4]

# Dependency graph
requires:
  - phase: 44-01
    provides: "snapshot-roundtrip.test.ts RED stub + okb-guard-snapshot-bypass.sh RED stub"
  - phase: 44-03
    provides: "package.json ./snapshots subpath export pre-declared (avoids Wave 1 file-conflict)"
provides:
  - "lib/km-core/src/snapshots/SnapshotManager.ts (createSnapshot/listSnapshots/restoreSnapshot)"
  - "lib/km-core/src/snapshots/index.ts (sub-barrel re-export)"
  - "scripts/hooks/pre-commit-okb-guard.sh OKB_SNAPSHOT=1 env-var bypass (4 lines added)"
  - "S-1/S-2/S-4 mechanics: git-tag-backed snapshot/restore over .data/exports/"
  - "Pitfall 1 mechanism: env-var bypass paired across SnapshotManager + hook"
affects:
  - "44-06 (REST handler — wraps restoreSnapshot with restartRequired:true)"
  - "44-07 (B-side REST mount — SnapshotManager wired into kmCoreRouter)"
  - "44-08+ (consumer cutover — A/C mounting snapshots/* endpoints)"

# Tech tracking
tech-stack:
  added:
    - "(none — Node 22 stdlib: child_process.execSync, fs, path)"
  patterns:
    - "Framework-agnostic class with submodule-walk gitdir resolution"
    - "Env-var-paired bypass across library and hook (Pitfall 1)"
    - "Path-traversal-safe regex on user-controlled IDs (T-44-04-01)"
    - "Destructive-confirmation gate at library AND handler layer (defense in depth)"

key-files:
  created:
    - "lib/km-core/src/snapshots/SnapshotManager.ts (295 lines)"
    - "lib/km-core/src/snapshots/index.ts (sub-barrel)"
  modified:
    - "scripts/hooks/pre-commit-okb-guard.sh (4-line bypass + traceability comment)"
    - "lib/km-core/tests/integration/snapshot-roundtrip.test.ts (provenance arg added per D-30)"

key-decisions:
  - "Snapshot ID format `snapshot/<label>-<UTC-ts>` is the wire format AND the storage key (S-4); discovery is `git tag -l 'snapshot/*' --sort=-creatordate`."
  - "restoreSnapshot does NOT call process.exit and does NOT wipe LevelDB — Plan 06 HTTP handler is the layer that wraps with restartRequired:true (CONTEXT S-2 revised)."
  - "Bypass mechanism is `OKB_SNAPSHOT=1` env-var, NOT a commit-message prefix-whitelist (pre-commit hooks fire BEFORE the commit message exists — RESEARCH Pitfall 1)."
  - "Manager-level `{ confirmDestructive: true }` gate added to restoreSnapshot (T-44-04-03 defense in depth — Plan 06 handler enforces the same on the POST body)."

patterns-established:
  - "Pattern (SnapshotManager): getGitEnv walks up from exportDir for both plain .git dirs and gitlink files (submodule case for lib/km-core inside coding repo)."
  - "Pattern (execGit): every git invocation sets GIT_DIR/GIT_WORK_TREE/OKB_SNAPSHOT=1 + stdio:'pipe' to suppress git's chatter on the happy path."
  - "Pattern (paired bypass): SnapshotManager.execGit and pre-commit-okb-guard.sh MUST stay in sync on the env-var name — split, half-bypass = silent snapshot-commit failure."

requirements-completed: [API-02]

# Metrics
duration: 6min
completed: 2026-06-03
---

# Phase 44 Plan 04: SnapshotManager + OKB-guard bypass Summary

**Git-tag-backed snapshot/restore for `.data/exports/` (snapshot/<label>-<UTC-ts>) paired with an `OKB_SNAPSHOT=1` env-var bypass in the coding-side pre-commit hook — the matched pair that makes S-1/S-2/S-4 work mechanically.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-03T12:52:17Z
- **Completed:** 2026-06-03T12:58:20Z
- **Tasks:** 2
- **Files created:** 2 (SnapshotManager.ts, snapshots/index.ts)
- **Files modified:** 2 (pre-commit-okb-guard.sh, snapshot-roundtrip.test.ts)

## Accomplishments

- `SnapshotManager` class implements S-1 (whole-dir atomic snapshot), S-2 (hard-reset restore without process termination), and S-4 (git tags as snapshot IDs).
- Every `execGit` call sets `OKB_SNAPSHOT=1` (Pitfall 1 mandatory) — matched by the 4-line hook bypass at the top of `scripts/hooks/pre-commit-okb-guard.sh`.
- Wave 0 RED stub `snapshot-roundtrip.test.ts` flipped 4/4 GREEN.
- Wave 0 RED stub `okb-guard-snapshot-bypass.sh` Case B flipped GREEN — full script now exits 0 (2/2 cases pass).
- Path-traversal regex on snapshot IDs (T-44-04-01), label injection regex on labels (T-44-04-02), and `confirmDestructive:true` gate on restoreSnapshot (T-44-04-03) all landed.

## Task Commits

Each task was committed atomically. Submodule edits in `lib/km-core` are paired with outer-repo pointer-bump commits.

1. **Task 1 (submodule): SnapshotManager.ts + index.ts + test fix** — `7967731` (feat) in `lib/km-core`
2. **Task 1 (outer-repo): submodule pointer bump** — `48d5ad164` (feat) in coding
3. **Task 1 docs (submodule): rephrase process.exit negation in comments** — `534aec4` (docs) in `lib/km-core`
4. **Task 1 docs (outer-repo): submodule pointer bump** — `edea5aa5d` (docs) in coding
5. **Task 2 (outer-repo): OKB_SNAPSHOT=1 bypass in hook** — `fcf0d49a7` (feat) in coding

_Note: the Task 1 docs commit clarifies the contract description ("does NOT terminate the process" rather than "does NOT call process.exit") to keep the acceptance grep clean. Behavior unchanged._

## Files Created/Modified

### Created (in `lib/km-core` submodule)

- `lib/km-core/src/snapshots/SnapshotManager.ts` (295 lines)
  - `class SnapshotManager` with `createSnapshot(label)` returning SnapshotEntry, `listSnapshots()` returning SnapshotEntry array, `restoreSnapshot(id, { confirmDestructive })` returning `{ restored, id, commit_sha }`.
  - `getGitEnv()` walks up from `exportDir` looking for `.git` (directory OR gitlink file — submodule case).
  - `execGit(args, env)` wraps every git invocation with `GIT_DIR`, `GIT_WORK_TREE`, **`OKB_SNAPSHOT: '1'`**, `stdio: 'pipe'`, 15s timeout.
  - `SNAPSHOT_ID_REGEX = /^snapshot\/[a-zA-Z0-9._-]+-\d{4}-\d{2}-\d{2}T[\dTZ.\-]+$/` (path-traversal guard).
  - `LABEL_REGEX = /^[a-zA-Z0-9._-]+$/` (command-injection guard, defense in depth with `JSON.stringify`).
- `lib/km-core/src/snapshots/index.ts` (12 lines) — sub-barrel re-exporting `SnapshotManager` + types for the `@fwornle/km-core/snapshots` sub-path (the export was pre-declared in package.json by Plan 03; this commit creates the source that `npm run build` compiles to `dist/snapshots/index.js`).

### Modified

- `scripts/hooks/pre-commit-okb-guard.sh` — inserted 4-line bypass (5 lines including a traceability comment) between `set -euo pipefail` (line 13) and the existing `KB_PATTERN=` declaration. Net diff is purely additive; the existing KB-guard logic is untouched.
- `lib/km-core/tests/integration/snapshot-roundtrip.test.ts` — added `provenance: ProvenanceStamp` import + `PROV` constant + `{ provenance: PROV, skipOntologyCheck: true }` argument on all 4 `putEntity` calls (D-30 requires this; the Plan 01 RED stub was authored against the pre-D-30 API). Also updated the round-trip test's `restoreSnapshot` call site to pass `{ confirmDestructive: true }`.

## Verification Outputs

### Wave 0 test 1: snapshot-roundtrip.test.ts (km-core)

```
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  14:58:01
   Duration  1.66s
```

Confirmed 4/4 GREEN. The four tests pin: snapshot/<label>-<UTC-ts> ID format + chore(snapshot) commit message; SnapshotEntry shape (id/label/timestamp/commit_sha/domains_present); round-trip (snapshot then mutate then restore restores byte-equal exports); OKB_SNAPSHOT=1 env-var asserted via fixture pre-commit hook.

### Wave 0 test 2: okb-guard-snapshot-bypass.sh (outer-repo)

```
Case A: OKB_SNAPSHOT=0 expecting hook exit != 0
  PASS: hook rejected (exit=1)
Case B: OKB_SNAPSHOT=1 expecting hook exit 0
  PASS: hook bypassed (exit=0)

Summary: PASS=2, FAIL=0
GREEN: OKB_SNAPSHOT bypass contract holds.
```

Exit code 0. Both cases pass: hook still rejects KB-only-file commits without the env-var (Case A, regression check), AND bypasses with `OKB_SNAPSHOT=1` (Case B, the new behavior).

### Literal-grep acceptance proofs (Task 1)

| Check | Expected | Actual |
|-------|----------|--------|
| `wc -l SnapshotManager.ts` | ≥150 | 295 |
| `grep -c "export class SnapshotManager"` | 1 | 1 |
| `grep -c "OKB_SNAPSHOT"` | ≥2 | 3 |
| `grep -c "getGitEnv"` | ≥2 | 4 |
| `grep -cE "(process\.exit|process\.kill)"` | 0 | 0 |
| `grep -c "confirmDestructive"` | ≥2 | 4 |
| `grep -cE "console\.(log|error|warn|info|debug)"` | 0 | 0 |
| Path-traversal regex literal present | ≥1 | 1 (line 68, SNAPSHOT_ID_REGEX) |
| `npm run build` TS errors | 0 | 0 |

### Literal-grep acceptance proofs (Task 2)

| Check | Expected | Actual |
|-------|----------|--------|
| `grep -c "OKB_SNAPSHOT"` | ≥2 | 2 |
| Bypass `if`-line matches plan canonical | 1 | 1 |
| Bypass line number | ≤20 | 16 |
| `set -euo pipefail` line | (exists) | 13 |
| `KB_PATTERN=` line | greater than bypass-line | 22 (16 less than 22) |
| `bash -n` syntax | OK | OK |
| Evolutionary suffix variants of hook | none | none |

### km-core full suite (regression check)

```
 Test Files  1 failed | 32 passed (33)
      Tests  6 failed | 260 passed (266)
```

The 6 failing tests are in `tests/integration/api-router.test.ts` — all pre-existing Wave 0 RED stubs from Plan 44-01 waiting for Plan 44-06 (`createKmCoreRouter` factory). **Not caused by this plan** — they failed identically before and after the SnapshotManager land. The Plan 44-04 deliverables (snapshot-roundtrip.test.ts) flipped from 0/4 RED to 4/4 GREEN with no Phase 37/38/41/42/43 regression.

## Decisions Made

- **Comment rephrase to satisfy literal-grep acceptance:** original SnapshotManager comments used the phrase "does NOT call process.exit" twice (once in the module header, once in the restoreSnapshot JSDoc). The Plan acceptance check `grep -cE "(process\.exit|process\.kill)"` reads any occurrence as a potential call site, even in comments. Rephrased to "does NOT terminate the process" — equally clear, satisfies the literal grep. Committed as a separate `docs(44-04)` commit (`534aec4`) so the originating `feat(44-04)` commit stays clean.
- **Test-stub provenance arg add (D-30 forward-compat):** the Plan 01 snapshot-roundtrip.test.ts RED stub was authored before D-30 made `putEntity({ provenance })` mandatory. The test would have thrown "putEntity requires opts.provenance" before reaching any SnapshotManager assertion. Treated as a Rule 3 blocking-issue fix: added the `PROV` constant and `{ provenance: PROV, skipOntologyCheck: true }` to all 4 putEntity calls — minimal diff, tests now exercise SnapshotManager as intended. Committed together with the SnapshotManager source (`7967731`) so the GREEN-state is one atomic landing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan 01 snapshot-roundtrip.test.ts missing `provenance` arg on putEntity**
- **Found during:** Task 1 verification (first `npx vitest run snapshot-roundtrip.test.ts` after build).
- **Issue:** GraphKMStore.putEntity throws `'putEntity requires opts.provenance (D-30): caller MUST supply ProvenanceStamp source'`. The RED stub authored in Plan 44-01 predates D-30 enforcement. All 4 tests failed at the first putEntity call, never reaching SnapshotManager assertions.
- **Fix:** Imported `ProvenanceStamp` from `../../src/types/entity.js`; added `const PROV: ProvenanceStamp = { provider:'test', model:'test-model', runId:'phase-44-04-snapshot-roundtrip', timestamp:'2026-06-03T12:00:00.000Z' }`; added `{ provenance: PROV, skipOntologyCheck: true }` to all 4 `putEntity` call sites. Pattern lifted verbatim from `tests/unit/entity-layer-field.test.ts`. Also updated the round-trip test's `restoreSnapshot(snap.id)` to `restoreSnapshot(snap.id, { confirmDestructive: true })` to match the new manager-level gate (T-44-04-03).
- **Files modified:** `lib/km-core/tests/integration/snapshot-roundtrip.test.ts`
- **Verification:** 4/4 GREEN. No other test in the km-core suite was affected.
- **Committed in:** `7967731` (km-core), `48d5ad164` (outer-bump) — part of Task 1.

**2. [Rule 3 - Blocking] Acceptance-grep false-positive on "process.exit" in negation comments**
- **Found during:** Task 1 acceptance-criteria verification (after first GREEN test pass).
- **Issue:** Plan acceptance check `grep -cE "(process\.exit|process\.kill)" SnapshotManager.ts` requires the count to be 0, but the original comments used the phrase "does NOT call process.exit" twice as deliberate negation (per CONTEXT S-2 revised). The grep cannot distinguish negation comments from call sites; reported count=2 even though zero call sites exist.
- **Fix:** Rephrased "does NOT call process.exit" to "does NOT terminate the process" in both occurrences (module header and restoreSnapshot JSDoc). Semantically equivalent; satisfies the literal grep. Behavior unchanged; tests still 4/4 GREEN.
- **Files modified:** `lib/km-core/src/snapshots/SnapshotManager.ts`
- **Verification:** Re-ran `grep -cE "(process\.exit|process\.kill)"` then count was 0. Re-ran test then 4/4 GREEN.
- **Committed in:** `534aec4` (km-core docs commit), `edea5aa5d` (outer-bump).

---

**Total deviations:** 2 auto-fixed (both Rule 3 — Blocking).
**Impact on plan:** Both fixes were necessary to land the GREEN state the plan promises. No scope creep — both are minimal-diff corrections to bring the existing test stub forward to D-30 conformance and to satisfy the literal-grep acceptance check on documentation phrasing. Neither changes the SnapshotManager contract or the hook's runtime behavior.

## Issues Encountered

None beyond the deviations above.

## User Setup Required

None — no external service configuration, no new environment variables, no secret rotation. The hook is checked into source under `scripts/hooks/pre-commit-okb-guard.sh`; existing operators who symlinked it into `.git/hooks/pre-commit` pick up the change automatically.

## Next Phase Readiness

- **Plan 44-06 (REST handler):** ready to consume SnapshotManager. The handler should `import { SnapshotManager } from '@fwornle/km-core/snapshots'`, construct one with the system's `exportDir`, and wrap `restoreSnapshot` with `restartRequired: true` in the response envelope (the manager intentionally does NOT do this — per CONTEXT S-2 revised).
- **Wave 0 status going into Wave 2:**
  - `contracts.test.ts` — GREEN (Plan 44-03, prior)
  - `snapshot-roundtrip.test.ts` — GREEN (this plan)
  - `okb-guard-snapshot-bypass.sh` — GREEN (this plan)
  - `api-router.test.ts` — still RED (waits for Plan 44-06)
  - `observation-view.test.ts` — GREEN (Plan 44-05, prior)
- **No blockers** for the next plan; the matched-pair contract holds end-to-end.

## Threat Surface Scan

The plan's `<threat_model>` covered all surfaces introduced. No NEW surfaces beyond those documented (T-44-04-01..05 + T-44-04-SC). No threat flags to add.

## Self-Check: PASSED

- `lib/km-core/src/snapshots/SnapshotManager.ts` — FOUND (295 lines)
- `lib/km-core/src/snapshots/index.ts` — FOUND
- `scripts/hooks/pre-commit-okb-guard.sh` (modified) — FOUND with OKB_SNAPSHOT bypass at line 16
- Submodule commits `7967731`, `534aec4` — both present on `lib/km-core` main
- Outer-repo commits `48d5ad164`, `edea5aa5d`, `fcf0d49a7` — all present on coding main
- Wave 0 tests: snapshot-roundtrip 4/4 GREEN; okb-guard-snapshot-bypass.sh exit 0 (2/2 PASS)

---
*Phase: 44-rest-api-git-snapshots*
*Completed: 2026-06-03*
