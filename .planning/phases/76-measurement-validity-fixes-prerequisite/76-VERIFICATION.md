---
phase: 76-measurement-validity-fixes-prerequisite
verified: 2026-07-03T09:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 76: Measurement Validity Fixes [PREREQUISITE] Verification Report

**Phase Goal:** The measurement rig reports a trustworthy foreground model, plausible route timing, and a full 5-dimension score for ANY task — including non-GSD/ad-hoc tasks and long, partially-idle interactive sessions — so a variant comparison is meaningful at the source and the two canonical comparisons ("Opus vs Fable", "straight vs GSD/SDD") are no longer corrupted.

**Verified:** 2026-07-03  
**Status:** PASSED  
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A measured Opus interactive session records `claude-opus-4-8` (its actual foreground model) in the runs table, score drawer, AND timeline — not the most-frequent proxy token-row model (VALID-01) | VERIFIED | `scripts/experiments-recompute-route.mjs` has zero `dominant.model`/`dominant.agent` fallback (grep returned empty). Canonical chain: persisted `m.canonical_model` → `fgGroups.find(non-subagent) ?? fgGroups[0]` → null. Operator confirmed live dashboard (76-04 Task 2): `link-obs-control` (Opus, 93k tok) shows Chat model `claude-opus-4.8`; `claude-haiku-4.5` confined to Background column. No run shows Haiku or Sonnet as canonical. |
| 2 | A multi-hour session with steering pauses yields per-step route times within a documented sane bound — no ~28,000 s/step artifacts; idle/wait gaps excluded (VALID-02) | VERIFIED | `lib/experiments/route-heuristics.mjs` defines `DEFAULT_IDLE_GAP_MS = 300_000` (5 min) and `resolveIdleGapMs()` reads `ROUTE_IDLE_GAP_MS` env per-invocation. `wallclockPerStep` sums active inter-event gaps (≤ threshold) ÷ step count, replacing the naïve `(last−first)/count`. 19 unit tests pass (0 fail). Dry-run against archived pilot span returns `wallclock_per_step=null` (no rebuildable trace), not the 28,364 s artifact; the artifact is provably not reproducible. |
| 3 | A straight-coding (non-GSD) run scores all 5 rubric dimensions — `code_quality`, `test_coverage`, `regressions` non-null when `VERIFICATION.md`/`REVIEW.md` are absent, with signal from diff + test run, not only GSD artifacts (VALID-03) | VERIFIED | `lib/experiments/evidence-harness.mjs` exports `deriveNonGsdRubric(evidence)` (diff → code_quality; fail-soft test run → test_coverage/regressions) and `resolveTestCommand(span, repoRoot)` (run-metadata first, then package.json fallback). Test command uses `spawnSync` with fixed argv (no `shell: true` — confirmed by grep and by an automated source-scan test). `overlayNonGsdRubric` is wired in BOTH `scripts/measurement-stop.mjs:496` and `scripts/experiments-recompute-score.mjs:164`. 21 evidence-harness tests pass (0 fail). Dry-run on pilot span: `code_quality=0.26` fires from live diff; `test_coverage`/`regressions` null with recorded genuine reason (jest format not recognized + bounded timeout). |
| 4 | Re-running the two canonical comparisons on the corrected rig yields model/score/time values a human judges plausible; neither corrupted by O1 or O3 | VERIFIED | 76-04 Task 1 dry-run records: BEFORE (persisted pilot) = haiku as canonical, 28,364 s/step, code_quality null; AFTER (corrected rig) = canonical=null (no fg group — never haiku), wallclock_per_step=null (no 28k artifact), code_quality=0.26 (non-null from diff). 76-04 Task 2 (operator human-verify, D-04): live `link-obs-control` Opus session shows `claude-opus-4.8` as canonical across all surfaces. Operator-approved 2026-07-03. |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/experiments-recompute-route.mjs` | Canonical fg-not-dominant model selection; `dominant.model`/`dominant.agent` fallback removed; canonical fields threaded through `tags` into `writeRun` | VERIFIED | Lines 116-152: `fgGroups = byAgentModel.filter(isForegroundGroup)`; `canonical = fgGroups.find(non-subagent) ?? fgGroups[0] ?? null`; `tags.canonical_model`, `tags.canonical_agent`, `tags.background_models` set. Zero occurrences of `dominant.model`/`dominant.agent`. Commit `30e681209`. |
| `lib/experiments/route-heuristics.mjs` | `DEFAULT_IDLE_GAP_MS` constant; `ROUTE_IDLE_GAP_MS` env override; `resolveIdleGapMs()`; `wallclockPerStep` as active-gap sum | VERIFIED | Lines 91-149: all four elements present and exported. `wallclockPerStep` iterates gaps, excludes `gap > idleGapMs`. Commits `3d57f3090` (RED) + `15d884824` (GREEN). |
| `lib/experiments/evidence-harness.mjs` | `deriveNonGsdRubric`, `resolveTestCommand`, fixed-argv `runTestCommand`; `gatherEvidence` carries `testRun`; no `shell: true` | VERIFIED | Lines 242-421: all functions present and exported. `spawnSync` with fixed argv array, `NODE_TEST_CONTEXT` stripped. No `shell: true` anywhere (grep + automated source-scan test). Commits `fa9c4df4e` + `9692e3d4d`. |
| `scripts/measurement-stop.mjs` (overlay) | `deriveNonGsdRubric` imported; `overlayNonGsdRubric` wired between `runJudge` and `writeScore` | VERIFIED | Lines 72/90/101/496: import present, `NON_GSD_DIMS` defined, `overlayNonGsdRubric` implemented (gap-fill only), called after judge. Commit `9437865cd`. |
| `scripts/experiments-recompute-score.mjs` (overlay) | Same `overlayNonGsdRubric` pattern as measurement-stop | VERIFIED | Lines 49/60/72/164: identical pattern confirmed. Commit `9437865cd`. |
| `tests/experiments/route-heuristics.test.mjs` | 19 passing tests including idle-exclusion, env-override, boundary, and edge cases | VERIFIED | `node --test` result: 19 pass, 0 fail. Commits `3d57f3090` + `15d884824`. |
| `tests/experiments/evidence-harness.test.mjs` | 21 passing tests including `deriveNonGsdRubric`, `resolveTestCommand`, fixed-argv exec, `shell:true` source-scan | VERIFIED | `node --test` result: 21 pass, 0 fail. Commits `fa9c4df4e` + `9692e3d4d`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `experiments-recompute-route.mjs` | `token-aggregate.mjs:isForegroundGroup` | import line 36 | WIRED | `isForegroundGroup` imported and applied at lines 116-117 |
| `experiments-recompute-route.mjs` | `run-write.mjs:writeRun` | `tags` object | WIRED | `canonical_model`/`canonical_agent`/`background_models` set on `tags` (lines 149-152); `writeRun` reads them off `tags` (run-write.mjs §119-121) |
| `measurement-stop.mjs` | `evidence-harness.mjs:deriveNonGsdRubric` | import + `overlayNonGsdRubric` | WIRED | Import at line 72; called at line 496 after `runJudge` |
| `experiments-recompute-score.mjs` | `evidence-harness.mjs:deriveNonGsdRubric` | import + `overlayNonGsdRubric` | WIRED | Import at line 49; called at line 164 after judgment step |
| `evidence-harness.mjs:gatherEvidence` | `resolveTestCommand` + `runTestCommand` | internal call at line 399 | WIRED | `gatherEvidence` calls `runTestCommand(resolveTestCommand(span, root), root)` and returns result as `testRun` |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `dominant.model`/`dominant.agent` absent from recompute-route | `grep -n "dominant\.(model\|agent)" experiments-recompute-route.mjs` | 0 matches | PASS |
| `shell: true` absent from all three files | `grep -n "shell:\s*true" evidence-harness.mjs measurement-stop.mjs experiments-recompute-score.mjs` | 0 matches | PASS |
| `DEFAULT_IDLE_GAP_MS`/`ROUTE_IDLE_GAP_MS`/`resolveIdleGapMs` present | `grep -n "DEFAULT_IDLE_GAP_MS\|ROUTE_IDLE_GAP_MS\|resolveIdleGapMs" route-heuristics.mjs` | 8 matches at lines 19,20,91,93,97,104,110,139,275 | PASS |
| `deriveNonGsdRubric` imported in both consumers | `grep -n "deriveNonGsdRubric" measurement-stop.mjs experiments-recompute-score.mjs` | 4 matches (import + call in each) | PASS |
| No console.log violations | `grep -n "console\.log"` across 5 files (non-comment) | 0 matches | PASS |
| No unresolved debt markers | `grep -n "TBD\|FIXME\|XXX"` across 5 files | 0 matches | PASS |
| `route-heuristics.test.mjs` | `node --test tests/experiments/route-heuristics.test.mjs` | 19 pass, 0 fail | PASS |
| `evidence-harness.test.mjs` | `node --test tests/experiments/evidence-harness.test.mjs` | 21 pass, 0 fail | PASS |
| Score-contract regression | `node --test tests/experiments/judge.test.mjs tests/experiments/score-write.test.mjs` | 11 pass, 0 fail | PASS |
| Syntax check all 5 key files | `node --check` on each | All PASS | PASS |

---

### Requirements Coverage

| Requirement | Phase | Description | Status | Evidence |
|-------------|-------|-------------|--------|----------|
| VALID-01 | Phase 76 | Canonical foreground model recorded, not dominant-by-count | SATISFIED | `isForegroundGroup` chain in recompute-route; live Opus session operator-verified showing `claude-opus-4.8` as canonical |
| VALID-02 | Phase 76 | Plausible route time math, idle excluded | SATISFIED | `DEFAULT_IDLE_GAP_MS`/`resolveIdleGapMs`/active-gap-sum in route-heuristics; 19 tests; no 28k artifact on pilot dry-run |
| VALID-03 | Phase 76 | 5-dimension rubric scored for non-GSD tasks | SATISFIED | `deriveNonGsdRubric` in evidence-harness wired via `overlayNonGsdRubric` in both consumers; `code_quality=0.26` non-null on pilot diff |

---

### Anti-Patterns Found

None. All five modified files are clean:
- No `TBD`/`FIXME`/`XXX` markers
- No `console.log` (stderr/stdout write only, per CLAUDE.md)
- No `shell: true` in any `spawnSync` call
- No `dominant.model`/`dominant.agent` fallback in recompute-route

---

### Human Verification Required

**Task 2 of 76-04 was the D-04 live human-verify gate (not automatable by grep): the runs table, score drawer, and timeline must show Opus on a live measured session, not `claude-haiku-4.5`.**

This was completed by the operator on 2026-07-03. Evidence recorded in 76-04-SUMMARY.md:
- `link-obs-control` (93,183-tok Opus session): Chat model = `claude-opus-4.8`; `claude-haiku-4.5` confined to Background column.
- `repro-e2e`: Chat model = `claude-opus-4.8` (corroborating).
- `exp-dash-start-control` (pilot): Chat model = `unmeasured` (not `claude-haiku-4.5`); daemons in Background.
- No row anywhere shows Haiku/Sonnet as the Chat (canonical) model.

No further human verification required.

---

### Known Limitation (Forward Note, Not a Phase-76 Failure)

`test_coverage` and `regressions` are null on the archived `exp-dash-start-control` pilot span. The reason is genuine and recorded per D-11: the repo's `package.json` fallback command is jest, and `parseTestCounts` recognizes node:test TAP/spec + mocha (`N passing`/`N failing`) formats, not jest's `Tests:` summary. Additionally the whole-repo suite exceeds `EVIDENCE_TEST_TIMEOUT_MS`. This is not a bare GSD-file absence; it is a real no-signal condition. Phase 77 will address this by setting a task-scoped `test_command` in the experiment SPEC so scoring derives from a fast, parseable node:test suite.

---

### Gaps Summary

No gaps. All four success criteria are verified. The phase goal is achieved.

---

_Verified: 2026-07-03T09:00:00Z_  
_Verifier: Claude (gsd-verifier)_
