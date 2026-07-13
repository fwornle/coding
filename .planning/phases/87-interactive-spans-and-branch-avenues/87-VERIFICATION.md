---
phase: 87-interactive-spans-and-branch-avenues
verified: 2026-07-13T00:00:00Z
status: human_needed
score: 9/9 must-haves verified (AVN-01 through AVN-09); 1 residual documented limitation flagged for human acknowledgement
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/9
  gaps_closed:
    - "CR-01: runMatrix now forwards avenue/originSpanId/commitAvenue into the runCell call (experiment-runner.mjs:783); scripts/experiment-run.mjs parses --avenue/--origin-span-id; run-launch.mjs buildRunArgv emits both flags"
    - "CR-02: handleExperimentRun (api-routes.js) now reads origin_span_id + forkAxes, resolves the origin Run, maps forkAxes→variants, calls synthesizeAvenueSpec + synthesizeToYamlFile, and folds origin_span_id/avenue:true into the forwarded coordinator overrides"
    - "CR-02/CR-03 client: experiment-launcher.tsx now sends forkAxes/sweep in the launch payload; previewCellCount in fork mode is sourced from the new server-side POST /api/experiments/fork-preview round-trip, never selectedSpec.variantCount"
    - "CR-03: a real live fork (verified independently by querying the main-tree LevelDB) produced 2 Runs with non-null origin_span_id, proving selectAvenuesByOrigin has real data to group"
    - "Two Blocker-severity misleading code comments (performanceSlice.ts:975-979, experiment-launcher.tsx:156-161) corrected to describe the real post-87-07 wiring; aspirational 'shape WHAT is forked' text removed"
    - "REQUIREMENTS.md traceability gap closed: AVN-01..09 section + 9 traceability rows added"
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
human_verification:
  - test: "Fork a NON-trivial completed span (one whose judge/rubric assigns a real numeric score, not not_scored='trivial') and confirm the Avenues panel Outcome column renders a real formatted score (v.toFixed(2)) instead of the em-dash, and that best-first ranking visibly reorders rows by that score."
    expected: "The Outcome column shows a numeric score (not '—') for at least one avenue row, and the row with the highest score is ordered first (or carries the left success-accent border per avenue-panel.tsx's isBest logic)."
    why_human: "The only live fork exercised so far (87-08) forked a trivial fizzbuzz task; both produced avenue Runs scored not_scored='trivial', so avenueOutcomeScore() returned null for both and fmtScore() rendered the em-dash by design (honest null-handling, not a bug — confirmed by source read: fmtScore returns v.toFixed(2) for a real number). This is a data-availability gap in the one live test performed, not a wiring defect, but the numeric-score rendering path has not been visually exercised with a non-null value. Recommend one additional live fork of a scored (non-trivial) span before closing this residual, or explicit acceptance that the code-level guarantee (verified via source + unit-level formatting logic) is sufficient without a further live screenshot."
---

# Phase 87: Interactive Spans & Branch Avenues Verification Report

**Phase Goal:** A measurement span started from the main interactive agent captures origin snapshot + initial prompt; completed spans fork into "avenues" — headless re-runs of the initial prompt with modified agent/model/framework, each on a persistent `avenue/<task_id>` git branch — grouped by origin, compared in the dashboard, merge-status tracked; measurement data survives across branches (main-`.data` stores).

**Verified:** 2026-07-13
**Status:** human_needed
**Re-verification:** Yes — after gap-closure plans 87-07 (fork-launch thread) and 87-08 (comment hygiene + REQUIREMENTS ledger + live verification)

## Goal Achievement

### Observable Truths

| # | Truth (mapped to AVN-ID) | Status | Evidence |
|---|---------|--------|----------|
| 1 | AVN-01: An avenue span's Run record carries `origin_span_id`, threaded from the fork request through to persistence | ✓ VERIFIED | Independently queried the main-tree `.data/experiments/leveldb` (not trusting SUMMARY): `readRuns` returns 2 rows with non-null `origin_span_id="compare-fizzbuzz-v9-rmrbyrzjh--claude-sonnet-straight-default--r0"` — `exp-d4164dca2e74--claude-opus-straight-kb-on--r0` (terminal_state=complete) and `exp-d4164dca2e74--opencode-opus-straight-kb-on--r0` (terminal_state=abort). `runMatrix` now forwards `avenue, originSpanId, commitAvenue` into the `runCell({...})` call (experiment-runner.mjs:783, confirmed via grep + read). `tests/experiments/avenue-fork-thread.test.mjs` passes 4/4 against the REAL runMatrix/runCell/run-write code. |
| 2 | AVN-02: Dashboard "Fork into avenues" launch is a thin wrapper over the existing `launchExperiment` → vkb-server → coordinator bridge, and the payload now includes origin_span_id + fork axes | ✓ VERIFIED | `handleExperimentRun` (api-routes.js:962) destructures `{ spec, overrides, rerun_of, origin_span_id, forkAxes }`; resolves the origin Run, maps axes→variants, calls `synthesizeAvenueSpec`/`synthesizeToYamlFile`, folds `origin_span_id`+`avenue:true` into the coordinator overrides (api-routes.js:1105). Coordinator forwards `overrides` whole (health-coordinator.js:2762). Live proof: the 2 Runs above were produced via the real launch path (host CLI D-01 seam, sanctioned by 87-07 plan, used because the container's `config/experiments/` mount is read-only — documented, not a workaround of the seam itself). |
| 3 | AVN-03: 4-axis picker (agent/model/framework/injection) is curated-default with a sweep toggle and a SERVER-resolved count/cost preview before launch | ✓ VERIFIED | New `POST /api/experiments/fork-preview` (api-routes.js:1166, `handleExperimentForkPreview`) synthesizes-and-counts without persisting/launching, reusing the same `_resolveOriginRun`/`_mapForkAxesToVariants` as the launch path so counts can't diverge. Client: `experiment-launcher.tsx` `previewCellCount` in fork mode reads `forkPreviewCount` (server round-trip via `previewForkCount` thunk) — confirmed by source read that the fork branch does NOT fall back to `selectedSpec.variantCount`. Live: SUMMARY records fork-preview returned `{"cellCount":2}` matching the 2 cells actually launched. |
| 4 | AVN-04: Knowledge-injection toggle is a per-avenue axis, threading `CODING_KNOWLEDGE_INJECTION=0` into spawned agent env without affecting the interactive session | ✓ VERIFIED | No regression — `launch-agent-common.sh:345-351` guard confirmed unchanged and present. |
| 5 | AVN-05: Avenue branches are named `avenue/<task_id>` worktrees (not detached); prune removes worktree+branch; measurement data survives; detached default preserved when avenue mode not requested | ✓ VERIFIED | `tests/experiments/avenue-branch.test.mjs` re-run independently: 5/5 pass (createAvenueBranch named-worktree, pruneAvenueBranch removal+idempotency, task_id sanitization, commitAvenueWorktree). Live: `git branch -a` shows the two real branches `avenue/exp-d4164dca2e74--claude-opus-straight-kb-on--r0` and `avenue/exp-d4164dca2e74--opencode-opus-straight-kb-on--r0` actually exist in the repo, produced by the live 87-08 fork. |
| 6 | AVN-06: Avenue span writes to MAIN `.data` (not the branch worktree), with no double-count across branches | ✓ VERIFIED | No regression — structural guarantee unchanged; confirmed by the fact that the 2 live avenue Runs are readable from the MAIN-tree `.data/experiments/leveldb` (queried directly), not from a branch-worktree-local store. |
| 7 | AVN-07: Origin-grouped, outcome-ranked N-way avenue panel (best-first, git-computed merge badges) | ✓ VERIFIED (grouping/badges/actions) — 1 residual item routed to human_verification | `selectAvenuesByOrigin`/`rankAvenues` confirmed correct by source read (null-safe, honest — never fabricates a score, sorts unmeasured last). Live gsd-browser screenshots (`11-avenues-merge-dark.png`, `12-avenues-merge-light.png`, viewed directly by this verifier, not just described) show: header "Avenues of compare-fizzbuzz-v9-...-r0 (2)" (real origin-grouped card), 2 avenue rows with agent/model labels, a real git-computed "⚠ conflicts" merge badge on both rows, in BOTH dark and light themes. Outcome column shows em-dash for both rows — confirmed this is because both live-forked Runs scored `not_scored='trivial'` (`avenueOutcomeScore()` correctly returns null, `fmtScore()` correctly renders the em-dash for null and `v.toFixed(2)` for a real number, per source read) — not a wiring defect, but the numeric-score render path was not visually exercised with a real value. Routed to human_verification below. |
| 8 | AVN-08: Merge-status computed from git without mutating main; promote blocked on conflicts | ✓ VERIFIED | No regression — `avenue-branch.test.mjs`/`avenue-merge.test.mjs` primitives green. Live: both avenue rows show a real git-computed "conflicts" badge (ahead=1, behind=119, conflicts=2 per SUMMARY, plausible given a live 2-day-old origin branch); `avenue-panel.tsx` `hasConflicts` correctly disables the Promote button (source-confirmed at :127-146) — matches the screenshot's disabled/tooltip state. |
| 9 | AVN-09: Prune removes worktree+branch via the coordinator seam (never the container); reachable via vkb-server→coordinator routes | ✓ VERIFIED | No regression — coordinator `/experiments/avenue-prune` + vkb-server `handleAvenuePrune` proxy unchanged and still wired (confirmed present in api-routes.js/health-coordinator.js). Live: Prune button rendered enabled on both avenue rows in the screenshots. |

**Score:** 9/9 truths VERIFIED at the code + live-data level. 1 truth (AVN-07) has a documented, honestly-disclosed residual — the outcome-score numeric-render path was not visually exercised with a non-null value in the live test (both forked runs were trivial-scored) — routed to human_verification rather than counted as a gap, because (a) the rendering code (`fmtScore`) is source-verified correct for both null and non-null cases, and (b) the grouping/ranking/merge-badge/actions machinery — the actual novel wiring this phase built — IS live-proven.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/experiments/experiment-runner.mjs` (runMatrix) | Threads avenue/originSpanId/commitAvenue from opts into runCell | ✓ VERIFIED | `avenue = false, originSpanId, commitAvenue` destructured at opts (~684), forwarded at runCell call site (line 783); non-avenue path stays byte-identical (avenue defaults false) |
| `scripts/experiment-run.mjs` | `--avenue` / `--origin-span-id` CLI flags | ✓ VERIFIED | `args.includes('--avenue')` (line 178), `parseStrArg(args, '--origin-span-id')` (line 179), both threaded into runMatrix opts |
| `lib/experiments/run-launch.mjs` (buildRunArgv) | Emits `--origin-span-id`/`--avenue` from overrides | ✓ VERIFIED | valueFlags entry `['origin_span_id', '--origin-span-id']` (line 83); boolean push on `overrides.avenue === true` (lines 112-113) |
| `lib/vkb-server/api-routes.js` (handleExperimentRun) | Reads origin_span_id + forkAxes, calls synthesizeAvenueSpec | ✓ VERIFIED | Body destructure includes both (line 962); `synthesizeAvenueSpec`/`synthesizeToYamlFile` imported+called (lines 1042-1050); origin_span_id+avenue folded into forwarded overrides (line 1105) |
| `lib/vkb-server/api-routes.js` (handleExperimentForkPreview) | NEW axes-aware preview endpoint | ✓ VERIFIED | Route registered (`POST /api/experiments/fork-preview`, line 121); handler synthesizes+counts without persist/launch (lines 1166-1190); shares `_resolveOriginRun`/`_mapForkAxesToVariants` with the launch path |
| `integrations/system-health-dashboard/.../experiment-launcher.tsx` | forkAxes/sweep in launch payload; axes-aware server-resolved previewCellCount | ✓ VERIFIED | `forkAxes, sweep` included in `launchExperiment(...)` dispatch (line 276) only in fork mode; `previewCellCount` fork branch reads `forkPreviewCount` (line 180), non-fork branch unchanged |
| `integrations/system-health-dashboard/.../performanceSlice.ts` | launchExperiment carries forkAxes/sweep; previewForkCount thunk added | ✓ VERIFIED | Thunk type extended (line 966), POST body includes both (lines 991-993); new `previewForkCount` thunk (line 1010) |
| `.planning/REQUIREMENTS.md` | AVN-01..09 section + traceability | ✓ VERIFIED | 9 `- [x] **AVN-0N:**` bullets (lines 58-66) + 9 traceability rows (lines 88-96), all mapped to Phase 87 plans |
| `tests/experiments/avenue-fork-thread.test.mjs` | Integration test proving the real thread end-to-end | ✓ VERIFIED | Created; 4/4 pass independently re-run; asserts the measurement-start seam receives `--origin-span-id` and a Run round-trips with non-null origin_span_id (and null for a non-avenue run) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `runMatrix` opts | `runCell({ ..., avenue, originSpanId, commitAvenue })` | opts destructure + call-site passthrough | ✓ WIRED | Confirmed at experiment-runner.mjs:783 |
| `experiment-run.mjs` CLI | `runMatrix opts.avenue / opts.originSpanId` | `--avenue` / `--origin-span-id` flag parse | ✓ WIRED | Confirmed lines 178-179, 314 |
| `run-launch buildRunArgv` | `--avenue` / `--origin-span-id` argv | `overrides.avenue` / `overrides.origin_span_id` passthrough | ✓ WIRED | Confirmed lines 83, 112-113 |
| `handleExperimentRun` body | `synthesizeAvenueSpec(originRun, forkAxes)` → `synthesizeToYamlFile` → coordinator `/experiments/run` | origin_span_id + forkAxes read + spec synthesis | ✓ WIRED | Confirmed lines 962, 1023-1052, 1105 |
| coordinator `/experiments/run` | `runExperiment overrides.origin_span_id / overrides.avenue` | request body destructure, whole-overrides forward | ✓ WIRED | Confirmed health-coordinator.js:2762 (overrides forwarded whole, no filter) |
| `experiment-launcher.tsx` forkAxes state | `launchExperiment` dispatch payload | `buildOverrides()` / dispatch spread | ✓ WIRED | Confirmed line 276, fork-mode-only spread |
| `experiment-launcher.tsx` previewCellCount | `previewForkCount` server round-trip | dispatch on axes/sweep/repeats change | ✓ WIRED | Confirmed lines 148, 180 |
| avenue Run | `selectAvenuesByOrigin` grouping | non-null `origin_span_id` on the Run record | ✓ WIRED (real data) | Independently queried: 2 real Runs in main `.data` carry the predicate; `selectAvenuesByOrigin` groups by exactly that field (performanceSlice.ts ~1917-1926) |
| `avenue-panel.tsx` | `MergeStatusBadge` + `AvenueRowActions` (Promote/Prune) | component composition | ✓ WIRED (live) | Screenshots confirm real "⚠ conflicts" badges + correctly-disabled Promote + enabled Prune |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `avenue-panel.tsx` | `avenuesByOrigin` (via `selectAvenuesByOrigin`) | `fetchRuns` → Run[] filtered by non-null `origin_span_id` | Yes — independently confirmed 2 real Runs in main-tree LevelDB carry non-null origin_span_id | ✓ FLOWING |
| `experiment-launcher.tsx` | `previewCellCount` (fork mode) | `previewForkCount` thunk → `POST /api/experiments/fork-preview` → server-synthesized count | Yes — SUMMARY-recorded `{"cellCount":2}` matches the 2 cells actually launched | ✓ FLOWING |
| `merge-status-badge.tsx` | `mergeStatusByTaskId[taskId]` | `fetchMergeStatus` thunk → coordinator `avenueMergeStatus` (real git query) | Yes — screenshots show real ahead/behind/conflicts values, not a placeholder | ✓ FLOWING |
| `avenue-panel.tsx` Outcome column | `avenueOutcomeScore(run)` | `run.score.corrected_goal_achieved` / `goal_achieved` | Partial — both live Runs are `not_scored='trivial'` so this returns null by design (honest); rendering logic for a real value is source-verified but not live-exercised | ⚠️ NOT YET LIVE-EXERCISED (not a defect — see human_verification) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| AVN-01 | 87-03, 87-07 | Run record carries origin_span_id via the real launch path | ✓ SATISFIED | Live data + tests |
| AVN-02 | 87-05, 87-07 | Dashboard Fork = thin wrapper, payload reaches server with origin_span_id + axes | ✓ SATISFIED | Live launch via the real bridge; server reads + acts on both fields |
| AVN-03 | 87-02, 87-05, 87-07 | Curated 4-axis picker + sweep + server-resolved preview | ✓ SATISFIED | New fork-preview endpoint; client sources count from it |
| AVN-04 | 87-02 | Knowledge-injection per-avenue axis | ✓ SATISFIED | No regression |
| AVN-05 | 87-01 | avenue/<task_id> worktree branch; prune; data survival | ✓ SATISFIED | No regression + live branches exist |
| AVN-06 | 87-03 | Cross-branch: avenue span writes MAIN .data, no double-count | ✓ SATISFIED | No regression + live data confirms MAIN-store write |
| AVN-07 | 87-06, 87-07 | Origin-grouped, outcome-ranked N-way panel | ✓ SATISFIED (grouping/badges/actions); residual noted (score render not live-exercised) | Screenshots + source read |
| AVN-08 | 87-04 | Merge status computed from git, no main mutation | ✓ SATISFIED | Live conflicts badge + blocked Promote |
| AVN-09 | 87-04, 87-01, 87-06 | Prune via coordinator seam only | ✓ SATISFIED | No regression + live Prune button enabled |

REQUIREMENTS.md now contains all 9 AVN entries (bullets + traceability rows) — the prior traceability gap is closed. No orphaned requirements found: every AVN ID referenced in ROADMAP.md and all 8 PLAN.md frontmatter blocks has a corresponding REQUIREMENTS.md entry.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER found in any phase-87-modified file (grepped all 9 files across 87-07/87-08 file lists) | — | None |
| `integrations/system-health-dashboard/src/pages/token-usage.tsx` | 675 | Pre-existing TS2322 typecheck error (unrelated file, Phase 66 code) | ℹ️ Info | Does not block `npm run build` (project's own `tsc --noEmit 2>/dev/null; vite build` convention suppresses tsc failures from gating vite); not a phase-87 regression — confirmed via `git log` the error line predates Phase 87 (introduced in commit `66a52bd6e`, Phase 66) |

The two previously-flagged Blocker-severity misleading comments (performanceSlice.ts:975-979, experiment-launcher.tsx:156-161) are CONFIRMED CORRECTED — both now describe the real post-87-07 wiring, explicitly noting what was true before 87-07 and what changed. No aspirational/false-completeness comments remain in the reviewed files.

### Human Verification Required

### 1. Live fork of a non-trivial (scored) span — Outcome column numeric render

**Test:** Fork a completed span whose task is non-trivial enough that the judge assigns a real numeric score (not `not_scored='trivial'`). Confirm the Avenues panel's Outcome column renders a formatted number (e.g. `0.85`) rather than the em-dash, and that best-first ranking visibly reflects that score (left success-accent border on the top-ranked row).

**Expected:** At least one avenue row shows a real numeric Outcome value; rows are ordered best-score-first.

**Why human:** The one live fork performed (87-08) used a trivial fizzbuzz task; both resulting avenue Runs scored `not_scored='trivial'`, so `avenueOutcomeScore()` correctly returned null and the panel correctly rendered the em-dash (verified via source read of `fmtScore`/`avenueOutcomeScore` — this is honest null-handling, not a defect). The numeric-render code path (`v.toFixed(2)`) has not yet been exercised with a live non-null value. This is a residual data-coverage gap in testing, not a code gap — but visual confirmation with a real score would fully close AVN-07's live-verification story.

## Gaps Summary

No blocking gaps remain. All three previously-confirmed causal breaks (CR-01 runner threading, CR-02 server fork synthesis, CR-03 dashboard grouping data) are closed and independently re-verified against the actual codebase and live `.data` store — not merely re-stated from the SUMMARY narrative:

- **CR-01 (runner):** Verified by direct grep/read of `experiment-runner.mjs:783`, `experiment-run.mjs:178-179/314`, and `run-launch.mjs:83/112-113` — the three fields are threaded through every layer.
- **CR-02 (server):** Verified by direct grep/read of `api-routes.js` — `handleExperimentRun` reads `origin_span_id`/`forkAxes`, synthesizes+persists the avenue spec, folds provenance into the coordinator overrides; the coordinator forwards `overrides` whole (confirmed, not just claimed).
- **CR-03 (dashboard data):** Verified by directly querying the main-tree `.data/experiments/leveldb` — 2 real Run records carry non-null `origin_span_id`, independently reproducing the SUMMARY's claim rather than trusting it.

The full experiments test suite was independently re-run (not trusted from the SUMMARY): 398 pass / 0 fail / 2 skip, matching the claimed count. The `avenue-fork-thread.test.mjs` and `run-endpoint.test.mjs` suites were also re-run individually and pass. The dashboard build was independently re-run; it succeeds (the one pre-existing TS error in an unrelated Phase-66 file does not gate the build per the project's own `tsc --noEmit 2>/dev/null; vite build` convention).

The two live screenshots (`11-avenues-merge-dark.png`, `12-avenues-merge-light.png`) were viewed directly by this verifier (not just described) and confirm the origin-grouped panel, both avenue rows, real merge-conflict badges, and correct Promote/Prune button states in both themes.

The one residual — the Outcome score column showing em-dash because both live-forked Runs were trivially-scored — is correctly classified as a documented, honest limitation of the one test performed, not a wiring defect: the rendering code (`fmtScore`) is source-verified to render a real number when one exists, and the ranking/grouping/badge/action machinery (the actual novel deliverable of this phase) is live-proven. This is routed to human_verification rather than blocking phase closure, per the guidance in the verification brief to distinguish "wiring + grouping + merge-badge + actions verified live" from "outcome-score column rendered with a real score."

**Status is `human_needed`** (not `passed`) solely because of the one human-verification item above — all 9 AVN truths are otherwise fully VERIFIED at code and live-data level, with zero blocking gaps.

---

_Verified: 2026-07-13_
_Verifier: Claude (gsd-verifier)_
