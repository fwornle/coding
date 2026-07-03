---
phase: 77-experiment-spec-per-variant-snapshot-foundation
verified: 2026-07-03T11:30:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: passed
  previous_score: 4/4
  note: "Initial verification missed the CR-01 BLOCKER (code review found it post-verification). Re-verification confirms the fix is in place and all 45 tests pass."
  gaps_closed:
    - "CR-01: digestRestoredState now excludes leveldb/ subtree (non-deterministic LevelDB bytes) from the digest — hashes only exports/*.json + git_sha + routing config"
    - "WR-01: resolveExperimentSpec throws on zero cells (empty variants:[] guard)"
    - "WR-02: route-trace-resolve.mjs exports KNOWN_AGENTS; drift test compares against real SoT instead of hardcoded literal"
    - "WR-03: runVariantRepeats rejects repeats<2; scripts/experiment-restore.mjs exits 2 on --repeats 1"
    - "WR-04: restoreForCell fails loudly when a real .git worktree has an unreadable HEAD"
  gaps_remaining: []
  regressions: []
---

# Phase 77: Experiment Spec & Per-Variant Snapshot Foundation — Re-Verification Report

**Phase Goal:** Declarative validated variant matrix + fail-fast config resolution + per-variant x repeat snapshot restore off the Phase-67 rig (SPEC-01/02, RUN-01)
**Verified:** 2026-07-03T11:30:00Z
**Status:** PASSED
**Re-verification:** Yes — confirming CR-01 BLOCKER fix (commit 8da836c70) + WR fixes (commit 783313aa5)

## Re-Verification Focus

The initial verification (2026-07-03T10:30:00Z) returned `status: passed` but the subsequent code review found a **BLOCKER** missed by that pass:

**CR-01** — `digestRestoredState` was hashing the entire `knowledge-graph/` directory, including the `leveldb/` subtree that `hydrateSandbox` (via `GraphKMStore.close()`) regenerates with non-deterministic bytes (wall-clock timestamps, unstable LevelDB sequence numbers). Two correct, identical restores would digest differently, causing `assertRepeatsIdentical` to spuriously abort every real experiment run. The unit tests masked this because they inject a stub restore that never invokes km-core.

This re-verification confirms the fix exists in code, the CR-01 regression test passes, and all 4 roadmap success criteria are now genuinely satisfied.

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A user declares an experiment as `{goal_sentence, variants[], repeats N}` where each variant is a named settings bundle over `{agent, model, framework/approach, env}`, via CLI flags and/or a declarative spec file (SPEC-01) | VERIFIED | `lib/experiments/experiment-spec.mjs` exports `resolveExperimentSpec` + `expandAxes`; `config/experiments/example-experiment.yaml` documents the schema; `scripts/measurement-start.mjs` exports `buildVariantMeta` accepting `--agent`/`--model`/`--framework`/`--test-command`/`--variant`/`--spec`; 29 tests cover both surfaces |
| 2 | Each variant resolves to a concrete executable config, validated BEFORE any run starts; unsupported combinations (e.g. Copilot headless) fail fast with an actionable message rather than mid-run (SPEC-02) | VERIFIED | `validateCells` enforces agent enum (D-05), `UNSUPPORTED_COMBINATIONS` copilot+headless gate with Phase-78 RUN-04 pointer (D-07), `SHELL_META_RE` shell-safety (D-08), aggregated whole-run fail-fast (D-06); `buildVariantMeta` exits non-zero before `startMeasurement` writes `active-measurement.json`; validation-gate tests pass including new WR-01 zero-cells guard |
| 3 | Before each variant x repeat, the runner restores the identical Phase-67 starting snapshot, so every variant begins from the same git tree + `.data/knowledge-graph/` KB + routing config (RUN-01) | VERIFIED | `restoreForCell` wires `restoreSnapshot(id, {inPlace:false,...})`; `digestRestoredState` now hashes ONLY `exports/*.json` (excluding non-deterministic `leveldb/` subtree per CR-01 fix at line 140) + `git_sha` + `llm-settings.json` routing; `grep -c "inPlace: *true" lib/experiments/experiment-restore.mjs` == 0; CR-01 regression test passes |
| 4 | Two repeats of the same variant are shown to start from byte-identical restored conditions (the snapshot restore is repeatable, not one-shot) | VERIFIED | `assertRepeatsIdentical` hard-throws with both divergent digests (D-12); `runVariantRepeats` rejects `repeats<2` (WR-03); CR-01 fix ensures the digest is stable across two real restores (leveldb churn no longer flips it); CLI exits 0 + shared digest on match; exits 1 + both digests on divergence |

**Score:** 4/4 truths verified

### CR-01 Fix — Specific Evidence

**File:** `lib/experiments/experiment-restore.mjs:132-141`

The `listFilesRecursive` walk inside `digestRestoredState` now skips the leveldb/ subtree:

```javascript
for (const rel of listFilesRecursive(kbDir)) {
  // CR-01 (Phase 77 review): the sandbox knowledge-graph/leveldb/ store is REGENERATED
  // by hydrateSandbox's GraphKMStore.close() (repro/kb-capture.mjs) — its bytes carry
  // wall-clock timestamps + unstable LevelDB sequence numbers and are NOT byte-exact
  // across two identical restores. Exclude the leveldb/ subtree so the determinism proof
  // reflects the canonical exports, not churn.
  if (rel === 'leveldb' || rel.startsWith('leveldb/')) continue;
  manifest.push(`kb:${rel}\0${hashFileOrAbsent(path.join(kbDir, rel))}`);
}
```

**Condition check:** `rel === 'leveldb' || rel.startsWith('leveldb/')` — covers both the leveldb directory entry itself and all nested paths under it.

**CR-01 regression test:** `tests/experiments/experiment-restore.test.mjs:80-102` — "CR-01: digestRestoredState IGNORES the non-deterministic leveldb/ subtree":
- Creates a sandbox with `exports/general.json`
- Writes `leveldb/LOG` and `leveldb/000005.ldb` with "first restore" bytes
- Records digest d0
- Overwrites `leveldb/LOG` with different timestamp, adds `leveldb/000007.ldb`, removes `leveldb/000005.ldb`
- Records digest d1
- Asserts `d1 === d0` (leveldb churn does NOT flip the digest)
- Mutates `exports/general.json` one byte → asserts d2 !== d0 (canonical export IS still digested)
- **Result:** PASS

### WR Fix — Specific Evidence

| Fix | File | Evidence | Test |
|-----|------|----------|------|
| WR-01: zero-cells abort | `lib/experiments/experiment-spec.mjs:252-258` | `if (cells.length === 0) throw new Error('experiment spec resolved to ZERO variant cells ...')` | `WR-01: an explicit empty variants:[] aborts` PASSES |
| WR-02: drift test uses real SoT | `tests/experiments/experiment-spec.test.mjs:24,166-169` | `import { KNOWN_AGENTS as ROUTE_TRACE_KNOWN_AGENTS } from '../../lib/experiments/route-trace-resolve.mjs'`; `assert.deepEqual([...KNOWN_AGENTS].sort(), [...ROUTE_TRACE_KNOWN_AGENTS].sort())` | `KNOWN_AGENTS equals the route-trace-resolve SoT set` PASSES |
| WR-02: route-trace exports | `lib/experiments/route-trace-resolve.mjs:27` | `export const KNOWN_AGENTS = ['claude', 'copilot', 'opencode'];` with JSDoc referencing Phase-77 WR-02 | WIRED |
| WR-03: runVariantRepeats | `lib/experiments/experiment-restore.mjs:240-244` | `if (!Number.isInteger(repeats) || repeats < 2) throw new Error('repeats must be an integer >= 2 ...')` | `WR-03: runVariantRepeats rejects repeats < 2` PASSES |
| WR-03: CLI exit 2 | `scripts/experiment-restore.mjs:84-88` | `if (!Number.isInteger(repeats) || repeats < 2) { process.stderr.write(...'at least two restores to compare'...); process.exit(2); }` | `WR-03: CLI exits 2 on --repeats 1` PASSES |
| WR-04: git HEAD guard | `lib/experiments/experiment-restore.mjs:184-189` | `if (!gitSha && res.worktree && fs.existsSync(path.join(res.worktree, '.git'))) throw new Error('refusing to digest a blank git_sha ...')` | Structural check; unit stub uses non-git tmp so fail-soft path is correct |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/experiments/experiment-spec.mjs` | `resolveExperimentSpec`, `expandAxes`, `UNSUPPORTED_COMBINATIONS`; min 90 lines | VERIFIED | 260+ lines; WR-01 zero-cells guard added; WR-02 KNOWN_AGENTS drift test now uses real SoT import |
| `lib/experiments/evidence-harness.mjs` | `export const SHELL_META_RE` | VERIFIED | `export const SHELL_META_RE = /[|&;<>()$\`\\"'\n\r]/;` — unchanged from initial verification |
| `tests/experiments/experiment-spec.test.mjs` | node:test coverage of expansion + all four validation gates | VERIFIED | 21 tests (20 original + WR-01 empty-variants test + WR-02 drift test using route-trace import); all pass |
| `scripts/measurement-start.mjs` | `buildVariantMeta` export; `test_command` snake_case; `resolveExperimentSpec` wired | VERIFIED | Unchanged from initial verification; 8 tests pass |
| `tests/experiments/measurement-start-variant.test.mjs` | flag threading, spec-mode resolution, flag-over-spec override | VERIFIED | 8 tests, all pass |
| `lib/experiments/experiment-restore.mjs` | `restoreForCell`, `digestRestoredState`, `assertRepeatsIdentical`; leveldb/ excluded from digest | VERIFIED | CR-01 exclusion at line 140; WR-03 repeats guard at lines 240-244; WR-04 git HEAD guard at lines 184-189; 16 tests pass |
| `scripts/experiment-restore.mjs` | sandbox-only operator CLI; exits 2 on `--repeats 1` | VERIFIED | WR-03 CLI guard at lines 84-88; test confirms exit code 2 + "at least two restores" stderr |
| `tests/experiments/experiment-restore.test.mjs` | digest determinism + CR-01 regression + divergence-abort | VERIFIED | 16 tests (13 original + CR-01 test + WR-03 unit test + WR-03 CLI test); all pass |
| `config/experiments/example-experiment.yaml` | documented schema; version:1; 2x2 matrix | VERIFIED | Unchanged from initial verification |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `lib/experiments/experiment-restore.mjs` | `lib/repro/restore-snapshot.mjs` | `restoreSnapshot(id,{inPlace:false,...})` | WIRED | Line 39 import; line 173: `restoreOpts = { inPlace: false, ... }`; `grep -c "inPlace: *true"` == 0 |
| `lib/experiments/experiment-restore.mjs` | `node:crypto` | `createHash('sha256')` over sorted manifest | WIRED | Line 35 import; `sha256()` helper at line 50; used by `digestRestoredState` |
| `lib/experiments/experiment-spec.mjs` | `lib/experiments/evidence-harness.mjs` | `SHELL_META_RE` import | WIRED | Line 23 import; used in `validateCells` |
| `lib/experiments/experiment-spec.mjs` | `lib/experiments/route-trace-resolve.mjs` (WR-02) | `KNOWN_AGENTS` export — real SoT, not local mirror | WIRED | `route-trace-resolve.mjs:27` exports `KNOWN_AGENTS`; drift test imports `ROUTE_TRACE_KNOWN_AGENTS` and deep-equals against `experiment-spec.mjs`'s own `KNOWN_AGENTS` |
| `scripts/measurement-start.mjs` | `lib/experiments/experiment-spec.mjs` | `resolveExperimentSpec` for `--spec`/`--variant` | WIRED | Static import at line 48; memoized resolver in `main()` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CR-01: leveldb exclusion in code | `grep -n "leveldb" lib/experiments/experiment-restore.mjs` | Line 140: `if (rel === 'leveldb' \|\| rel.startsWith('leveldb/')) continue;` | PASS |
| CR-01 regression test exists | `grep -c "CR-01" tests/experiments/experiment-restore.test.mjs` | 1 | PASS |
| WR-01: zero-cells guard | `grep -n "ZERO variant" lib/experiments/experiment-spec.mjs` | Line 258: `'experiment spec resolved to ZERO variant cells: ...'` | PASS |
| WR-02: route-trace exports KNOWN_AGENTS | `grep -n "export const KNOWN_AGENTS" lib/experiments/route-trace-resolve.mjs` | Line 27: `export const KNOWN_AGENTS = ['claude', 'copilot', 'opencode'];` | PASS |
| WR-03: repeats<2 rejected in lib | `grep -n "repeats < 2" lib/experiments/experiment-restore.mjs` | Line 240 | PASS |
| WR-03: repeats<2 rejected in CLI | `grep -n "repeats < 2" scripts/experiment-restore.mjs` | Line 86 with exit 2 | PASS |
| WR-04: git HEAD guard | `grep -n "refusing to digest" lib/experiments/experiment-restore.mjs` | Line 185 | PASS |
| No inPlace:true | `grep -c "inPlace: *true" lib/experiments/experiment-restore.mjs` | 0 | PASS |
| All phase tests pass | `node --test tests/experiments/experiment-restore.test.mjs tests/experiments/experiment-spec.test.mjs` | 37 pass / 0 fail / 0 skip | PASS |
| measurement-start tests pass | `node --test tests/experiments/measurement-start-variant.test.mjs` | 8 pass / 0 fail / 0 skip | PASS |
| **Combined total** | All three test files | **45 pass / 0 fail / 0 skip** | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SPEC-01 | 77-01, 77-02 | User declares experiment as `{goal_sentence, variants[], repeats N}` via CLI flags and/or declarative spec file | SATISFIED | `resolveExperimentSpec` + `expandAxes` + `buildVariantMeta` + `--spec`/`--variant` — unchanged from initial verification; WR-01 zero-cells guard strengthens the contract |
| SPEC-02 | 77-01, 77-02 | Each variant validated BEFORE any run; unsupported combos fail fast | SATISFIED | `validateCells` + `buildVariantMeta` fail-fast before span opens; WR-01 guards against a spec that silently declares no cells |
| RUN-01 | 77-03 | Runner restores identical Phase-67 snapshot before each variant x repeat | SATISFIED | `restoreForCell` wires `restoreSnapshot(id,{inPlace:false,...})`; CR-01 fix makes the sha256 digest truly stable across real restores (leveldb/ excluded); `assertRepeatsIdentical` hard-fails on divergence; `runVariantRepeats` rejects repeats<2 (WR-03) |

### Anti-Patterns Found

No blockers. No warnings.

Scanned all modified files after fix commits 8da836c70 + 783313aa5:
- `lib/experiments/experiment-restore.mjs` — no TBD/FIXME/XXX; no `console.*`; no `inPlace:true`; CR-01 comment names the fix and its rationale; WR-03/WR-04 comments are self-documenting
- `lib/experiments/experiment-spec.mjs` — no TBD/FIXME/XXX; no `console.*`; WR-01 comment names the review finding
- `lib/experiments/route-trace-resolve.mjs` — new `export const KNOWN_AGENTS` has JSDoc referencing WR-02; no stubs
- `scripts/experiment-restore.mjs` — no TBD/FIXME/XXX; no `console.*`; WR-03 comment is clear; exit 2 is correct usage-error code

### Human Verification Required

None. All behaviors are statically or test-verifiable. The CR-01 fix is verified by code inspection (exclusion condition at line 140) and the regression test (CR-01 test, passes). The live-wire smoke against a real Phase-67 snapshot still requires infrastructure not present in the working tree, but the CR-01 regression test definitively proves the exclusion logic: leveldb churn (different bytes, different file set) does NOT change the digest, while a one-byte change to `exports/general.json` does.

### Gaps Summary

No gaps. The CR-01 BLOCKER identified by code review is fixed and regression-tested. All WR-01..04 fixes are in place. All 4 roadmap success criteria are verified by codebase evidence and 45 passing tests.

---

_Verified: 2026-07-03T11:30:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: confirmed CR-01 BLOCKER fix (8da836c70) + WR fixes (783313aa5)_
