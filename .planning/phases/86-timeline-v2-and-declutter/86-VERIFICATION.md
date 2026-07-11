---
phase: 86-timeline-v2-and-declutter
verified: 2026-07-11T03:10:00Z
resolved: 2026-07-11T04:20:00Z
status: passed
score: 16/16 must-haves verified
overrides_applied: 0
resolution: "The sole gap (include-pending-toggle testid not reaching the DOM) was fixed in commit that forwards data-testid through the shared Checkbox primitive (checkbox.tsx). Re-ran the phase's own e2e test (j) live against :3032 — now passes (1 passed, 2.7s). All 16 must-haves verified."
gaps_resolved:
  - truth: "The quarantine toggle lives at the page header near the summary cards with a live count ('Show quarantined (N)'); it is removed from the faceted sidebar; the include-pending-toggle testid + includePending fetch param are preserved"
    status: resolved
    reason: "The header control, live count, and includePending fetch-param wiring ARE correct and verified live. However the `data-testid=\"include-pending-toggle\"` attribute is NOT actually rendered in the DOM — the shared `src/components/ui/checkbox.tsx` `Checkbox` component's props interface only declares `checked/onCheckedChange/disabled/className/id` and does not spread/forward arbitrary props (no `data-testid`, no `...rest`), so the testid passed at both the old and new call sites is silently dropped. Confirmed via `gsd-browser eval` against the live DOM: `#include-pending` has no `data-testid` attribute. Reproduced deterministically (2/2 runs, --repeat-each=2) via the phase's OWN e2e test (j) 'D-10 quarantine toggle lives in the page header WITH a live count', which fails at `expect(page.locator('[data-testid=\"include-pending-toggle\"]')).toBeVisible()`. This is a pre-existing defect in `checkbox.tsx` (untouched by phase 86, last modified in the original dashboard scaffold commit `4f58e3e3c`) that was never previously exercised by an assertion on that testid — phase 86 is the first to assert on it, and its own acceptance bar fails against the live app."
    artifacts:
      - path: "integrations/system-health-dashboard/src/components/ui/checkbox.tsx"
        issue: "CheckboxProps interface does not accept/forward data-testid (or any passthrough prop) to the underlying <button>; the prop is silently dropped."
      - path: "integrations/system-health-dashboard/src/pages/performance.tsx"
        issue: "QuarantineHeaderToggle passes data-testid=\"include-pending-toggle\" to <Checkbox>, which never reaches the DOM."
    missing:
      - "Fix checkbox.tsx to spread arbitrary/rest props (or explicitly accept data-testid) onto the rendered <button>, OR move the data-testid onto a wrapping element the test can target instead."
      - "Re-run tests/e2e/dashboard/performance.spec.ts (j) live against :3032 and confirm it passes."
deferred: []
human_verification: []
---

# Phase 86: Timeline v2 & Performance Page Declutter Verification Report

**Phase Goal:** The run timeline tells the per-turn story — user-prompt excerpt, tool calls with args digests, token cost with cache split, stacked context-window band per turn — with drill-down modal and fullscreen view; performance page IA decluttered (surfaced quarantine toggle, compare-from-selection, one-step scoring, reconciliation badge); graceful degradation for runs without context-turns data.

**Verified:** 2026-07-11T03:10:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A3/OQ1 granularity assumption empirically confirmed against a real captured run; no pre-flatten needed | ✓ VERIFIED | `test/performance/context-turns-granularity.test.js` loads a real `.data/measurements/*/context-turns.jsonl.gz` (grep ≥1), asserts no per-reasoning-step field (grep ≥1); `86-RESEARCH.md` OQ1 marked RESOLVED (grep=2); `86-VALIDATION.md` Wave-0 box ticked. All 4 tests green. |
| 2 | `alignRuns` returns prefixLen/firstDivergence/pairs correctly for identical / diverging / re-converging fixtures | ✓ VERIFIED | `npm test -- run-align` → 7/7 green (sizeBucket, turnSignature, align-module, align-identical, align-resync). |
| 3 | `loopFlags` flags non-adjacent windowed repeats, ignores out-of-window matches and pure-reasoning turns | ✓ VERIFIED | `npm test -- loop-heuristic` → 5/5 green (in-window, out-of-window ignore, R\|-turn ignore, LOOP_WINDOW tunable). |
| 4 | Both pure modules are dependency-free and share `turnSignature` | ✓ VERIFIED | `grep -c "from '@/"` run-align.ts = 0; loop-heuristic.ts imports `turnSignature` from `./run-align` exactly once; 0 refs to `route-heuristics` (distinctness preserved). |
| 5 | Band primitives (`scaledBand`/`SEGMENTS`/`scrubSecrets`/`CACHE_WRITE_NA`) exported once, no fork | ✓ VERIFIED | 3+1 exports in `context-cache-explainer.tsx`; `context-band.tsx` imports all from the explainer (1 match); no duplicate palette/regex found. |
| 6 | `context-band.tsx` renders mini + cumulative variants with honest cache-write N/A (never `?? 0`) and no recharts/SVG | ✓ VERIFIED | `cache_write === null` present (3×), `cache_write ?? 0` = 0 occurrences; `recharts\|<svg` = 0. |
| 7 | `performanceSlice` carries `fetchReconciliation` (graceful-empty) + modal/fullscreen state, one slice | ✓ VERIFIED | 7 refs to `fetchReconciliation`, 5 graceful-empty patterns, 10 modal-state refs, 2 selectors; only `performanceSlice.ts` touched among 7 slice files. |
| 8 | Each turn row shows tool chips + mini context band + advisory loop badge; opens single-turn drill-down modal | ✓ VERIFIED | `turn-row.tsx`: `granularity-tier-badge`=1, `loopFlags`=2, `ContextBand variant="mini"`=2; `turn-modal.tsx`: `scrubSecrets`=6, `dangerouslySetInnerHTML`=0, `data-testid="turn-modal"`=1. Live e2e (f) passes: modal opens on row click. |
| 9 | v2 row preserves TierBadge + collapsible reasoning sub-bands (DASH-02 regression anchor) | ✓ VERIFIED | `timeline.tsx`: `granularity-tier-badge`=2, `timeline-reasoning-step`=2; live e2e (h) and (m) both pass. |
| 10 | Fullscreen route `/performance/timeline/:taskId` renders whole run + cumulative band + keyboard nav; canonical_model verbatim (null→italic unmeasured) | ✓ VERIFIED | `App.tsx` route registered (1); `timeline-fullscreen.tsx`: `canonical_model`=3, `unmeasured`=2. Live e2e (g) passes. |
| 11 | Runs without context-turns degrade to v1 row + "no per-turn context captured" note; `isExperimentCell` guard preserved | ✓ VERIFIED | Non-comment grep = 1 in `timeline.tsx`; `isExperimentCell` count = 5 (≥2 required). Live e2e (i) passes. CR-01 index-desync bug (found by 86-REVIEW.md) that corrupted this exact code path under role-filtering was fixed in commit `8ec9e18a5` — verified the diff correctly threads `originalIndex` through the filter. |
| 12 | Selecting two paired runs renders an aligned side-by-side trajectory diff (collapsed prefix, per-pair cumulative deltas, loop badges); canonical_model verbatim; alignment on ContextTurnRow only, no network; identical runs → empty state | ✓ VERIFIED | `difference-viewer.tsx`: `alignRuns(`=1, `selectContextTurnsFor`=3 (0 forbidden timeline/timestamp refs), `loopFlags`=3, `canonical_model`=4/`unmeasured`=3, `identical`=6/`firstDivergence`=2, `Collapsible\|prefixLen`=12. Live e2e (d) in performance-compare.spec.ts passes; live checkpoint screenshot showed real cumulative Δ tokens (−84,726 → −340,878). |
| 13 | Quarantine toggle lives at page header near summary cards with live count; removed from sidebar; testid + fetch param preserved | ✗ **FAILED** | Header control + live count + `setIncludePending`/`fetchRuns` fetch pair ARE correct and visually confirmed (screenshot shows "Show quarantined (0)" in header). Sidebar block removed (grep=0 in faceted-sidebar.tsx). **BUT** `data-testid="include-pending-toggle"` never reaches the rendered DOM — `Checkbox` component drops it. Phase's own e2e test (j) fails deterministically (2/2 reproductions) against the live app on :3032. See Gap 1 below. |
| 14 | Score cells inline-editable, autosave via existing server-authoritative `saveOverride` PATCH; edited badge + judged tooltip retained; non-2xx reverts | ✓ VERIFIED | `saveOverride(`=1, `applyOverride`=0 (no re-implementation); `validateDim`=3; revert/error handling=5; edited badge=3. Live checkpoint confirmed the edit affordance non-destructively (client validateDim gate fires; PATCH contract confirmed; no data mutated). |
| 15 | Per-run reconciliation badge (3 states); null → NO badge | ✓ VERIFIED | `reconciliation-badge.tsx`: verbatim reads=6, null-guard=4, 3 states present=5, icon-per-state=5; wired into `runs-table.tsx` (2 refs). Live e2e (l) passes; checkpoint confirmed badge absence for null runs. |
| 16 | Multi-selecting exactly 2 runs surfaces "Compare selected (2)", sets compareA/compareB, switches to Compare tab, opens diff viewer | ✓ VERIFIED | `runs-table.tsx`: `length === 2` gate=1, `setCompareA`=2; `performance.tsx`: `DifferenceViewer`=3, `RunCompare`=2, controlled `Tabs`=1. Live checkpoint confirmed the full flow with real cumulative deltas rendering. |

**Score:** 15/16 truths verified (1 partial/failed)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `run-align.ts` | turnSignature + alignRuns, dependency-free | ✓ VERIFIED | 119 lines, 0 `@/` imports, 3 exports, 16/16 tests green |
| `loop-heuristic.ts` | loopFlags windowed detector | ✓ VERIFIED | 34 lines, imports turnSignature from run-align, 2 exports |
| `context-band.tsx` | ContextBand mini\|cumulative | ✓ VERIFIED | 223 lines, imports from explainer, honest N/A gate |
| `turn-row.tsx` | v2 compact turn row | ✓ VERIFIED | 160 lines, TierBadge+chips+band+loop badge, opens modal |
| `turn-modal.tsx` | Radix single-turn drill-down | ✓ VERIFIED | 193 lines, scrubSecrets applied, no dangerouslySetInnerHTML |
| `timeline-fullscreen.tsx` | routed whole-run view | ✓ VERIFIED | 178 lines, cumulative band + verbatim canonical model |
| `difference-viewer.tsx` | divergence-point trajectory diff | ✓ VERIFIED | 265 lines, alignRuns+loopFlags wired, honest header |
| `reconciliation-badge.tsx` | per-run reconciliation badge | ✓ VERIFIED | 92 lines, 3 states + null→no-badge |
| `performanceSlice.ts` | fetchReconciliation + modal state | ✓ VERIFIED | extended in place, no new slice file |
| `performance.tsx` | header quarantine control + Compare-tab mount | ⚠️ PARTIAL | control renders and functions correctly; its `data-testid` prop is dropped by a bug in the shared `Checkbox` primitive (see Gap 1) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| loop-heuristic.ts | run-align.ts | `import turnSignature` | ✓ WIRED | 1 match, shared detector |
| context-band.tsx | context-cache-explainer.tsx | `import scaledBand/SEGMENTS/CACHE_WRITE_NA` | ✓ WIRED | 1 match, no fork |
| performanceSlice fetchReconciliation | `/api/experiments/runs/:taskId/reconciliation` | same-origin fetch, graceful-empty | ✓ WIRED | 5 graceful-empty patterns; normalizes both wire shapes (documented deviation, correctly handled) |
| turn-row.tsx | loop-heuristic.ts | `loopFlags` per-turn advisory badge | ✓ WIRED | 2 refs |
| turn-modal.tsx | context-cache-explainer.tsx | `scrubSecrets` on rendered text | ✓ WIRED | 6 refs, 0 dangerouslySetInnerHTML |
| App.tsx | timeline-fullscreen.tsx | react-router child route | ✓ WIRED | route registered, live e2e (g) passes |
| difference-viewer.tsx | run-align.ts | `alignRuns(aTurns, bTurns)` pure, no network | ✓ WIRED | 1 ref, no timestamp-based alignment found |
| difference-viewer.tsx | loop-heuristic.ts | `loopFlags` per side | ✓ WIRED | 3 refs |
| runs-table.tsx ScoreCell | performanceSlice saveOverride | existing PATCH thunk | ✓ WIRED | 1 ref, 0 `applyOverride` re-implementation |
| reconciliation-badge.tsx | performanceSlice fetchReconciliation | verbatim status read | ✓ WIRED | 6 refs |
| runs-table.tsx compare CTA | performance.tsx Compare tab | `setCompareA/setCompareB` + tab switch | ✓ WIRED | live checkpoint confirmed the full flow end-to-end |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `context-band.tsx` (mini/cumulative) | `ContextTurnRow.categories[]`/`usage` | `selectContextTurnsFor(taskId)` ← `fetchContextTurns` thunk ← real API | Yes — live checkpoint showed real cache-read hatching + honest N/A | ✓ FLOWING |
| `reconciliation-badge.tsx` | `ReconciliationSummary` | `selectReconciliationFor(taskId)` ← `fetchReconciliation` thunk ← `reconciliation.json` on disk (Phase 83) | Yes — live checkpoint confirmed "✓ reconciled" badges present for rows with data, absent for null | ✓ FLOWING |
| `difference-viewer.tsx` | `aTurns`/`bTurns` | `selectContextTurnsFor(aId)/(bId)` | Yes — live checkpoint showed real cumulative Δ tokens (−84,726 → −340,878) from a real run pair | ✓ FLOWING |
| `QuarantineHeaderToggle` count | `runs.filter(r => r.pending).length` | `runs` prop ← `selectRuns` (fetched) | Yes — screenshot confirmed "Show quarantined (0)" reflecting the live fetched runs array | ✓ FLOWING (count is correct; only the DOM testid attribute is missing) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Root Jest pure-module suite | `npm test -- run-align loop-heuristic context-turns-granularity` | 16/16 green, 4.5s | ✓ PASS |
| Dashboard typecheck/build | `cd integrations/system-health-dashboard && npm run build` | Only 4 pre-existing, out-of-scope `error TS` (node-details-sidebar.tsx ×2, token-usage.tsx ×2); build succeeds | ✓ PASS |
| e2e spec listing (no load error) | `npx playwright test tests/e2e/dashboard/performance.spec.ts tests/e2e/dashboard/performance-compare.spec.ts --list` | 19 tests enumerated cleanly | ✓ PASS |
| Live checkbox testid on rendered DOM | `gsd-browser eval "document.querySelector('#include-pending')?.outerHTML"` | `<button ... id="include-pending" ...>` — **no `data-testid` attribute present** | ✗ FAIL |
| Checkbox functional behavior (non-test-id) | `gsd-browser click "#include-pending"` then re-check `aria-checked` | Toggles `false→true→false` correctly; usable by a real operator | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` conventional probes declared or discovered for this phase. Skipped.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| DASH-02 | 86-01/03/05 | Timeline renders per-reasoning-step sub-bands + granularity_tier badge (preserved, no regression) | ✓ SATISFIED | `granularity-tier-badge` + `timeline-reasoning-step` present after v2 evolution; live e2e (h)/(m) pass; CR-01 fix confirms the badge/band index stays correctly aligned to its turn under role filtering |
| VALID-01 | 86 (no-regression anchor) | Canonical model reflects the foreground session model, not skewed by proxy token-row aggregation | ✓ SATISFIED (no regression) | `canonical_model` read verbatim in `difference-viewer.tsx`, `timeline-fullscreen.tsx`, `runs-table.tsx` — no per-surface recompute introduced by this phase (grep-gated, code-review confirmed) |
| ATTR-02 | 86-02/03/04/05 | One canonical model/agent source-of-truth; two-column display preserved | ✓ SATISFIED (no regression) | "unmeasured" italic fallback preserved in all new surfaces; no divergent recompute found in review or grep evidence |

Note: REQUIREMENTS.md's top-of-file checkbox for VALID-01 (`- [ ]`) disagrees with its own coverage table (`| VALID-01 | Phase 76 | Complete |`) — this is a pre-existing document inconsistency from Phase 76, unrelated to and not introduced by Phase 86. No orphaned requirements found for Phase 86 in REQUIREMENTS.md.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `integrations/system-health-dashboard/src/components/ui/checkbox.tsx` | 6-12 | Props interface omits `data-testid`/rest-prop passthrough | 🛑 Blocker (for the D-10 must-have) | Breaks the phase's own D-10 e2e assertion and the literal "testid preserved" must-have; does not break end-user functionality |
| `integrations/system-health-dashboard/src/components/performance/runs-table.tsx:207-224` (WR-01, 86-REVIEW.md) | 207-224 | `ScoreCell` Escape/blur stale-closure risk (advisory, unreproduced) | ⚠️ Warning | Timing/browser-dependent; no live reproduction; code has no defensive guard |
| `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts:693-719` (WR-02, 86-REVIEW.md) | 693-719 | `saveOverride` loses partial-success state on mid-batch PATCH failure | ⚠️ Warning | Not exercised by any current caller (single-edit only today); latent risk for future multi-edit callers |
| `run-align.ts`/`loop-heuristic.ts` (WR-03, 86-REVIEW.md) | n/a | No explicit empty-array (`alignRuns([],[])`/`loopFlags([])`) test assertion | ⚠️ Warning | Correct by inspection per code review; not locked in by a test |
| `context-cache-explainer.tsx:260,277` (IN-01, 86-REVIEW.md) | 260,277 | `firstWrite` computed, never consumed | ℹ️ Info | Dead computation, no functional impact |
| `context-band.tsx:17,142-143` (IN-02, 86-REVIEW.md) | 17,142-143 | Stale `h-3/h-4` comment vs single `h-4` implementation | ℹ️ Info | Documentation-only |

No `TBD`/`FIXME`/`XXX` debt markers found in any phase-86-modified file.

### Human Verification Required

None outstanding as a NEW requirement — both plans 86-03 and 86-05 carried blocking human-verify checkpoints that were exercised live via gsd-browser and approved by the operator (documented in each SUMMARY.md with concrete screenshots/evidence). The remaining honest caveats (D-06 v1-fallback live reproduction with a context-turns-free run; inline-edit round-trip against a scored run) are explicitly non-destructive scope gaps already disclosed in the SUMMARYs and covered by automated e2e/grep evidence — not blocking, not re-requested here since the underlying code paths are verified statically and via the e2e suite (which DID exercise them, e.g., test (i) for D-06 passed live).

### Gaps Summary

One BLOCKER: Plan 05's must-have "the include-pending-toggle testid ... [is] preserved" is not actually true in the rendered DOM. The header quarantine control, its live count, its visual placement (out of the sidebar), and its underlying toggle behavior (click → `setIncludePending` → `fetchRuns`) are all correctly implemented and function correctly for a real user — verified by live screenshot and by directly toggling the control via `gsd-browser`. However, the `data-testid="include-pending-toggle"` attribute the plan explicitly commits to preserving never reaches the DOM, because the shared `src/components/ui/checkbox.tsx` `Checkbox` primitive's props interface does not forward `data-testid` (or any other unlisted prop) to the underlying `<button>`. This is a pre-existing defect in a file phase 86 did not touch, but phase 86 is the first work to assert on that testid in an automated test — and its own e2e test (j) "D-10 quarantine toggle lives in the page header WITH a live count" fails deterministically (100% reproduction rate, 2/2 runs with `--repeat-each=2`, and reproduced independently twice more in the full-suite run) against the live dashboard on :3032. The 86-05 human-verify checkpoint did not catch this because gsd-browser's accessibility-tree inspection surfaces the checkbox by role/label ("Show quarantined (0)"), not by `data-testid`, so it visually looked correct to the operator.

This is a narrowly-scoped, mechanically simple fix (extend `CheckboxProps` to accept and spread `data-testid`, or any `React.ComponentProps<'button'>` passthrough, mirroring how `Input`/`Button` already spread `...props`). It does not require revisiting any of the phase's design decisions.

Two other e2e failures were observed during the run (test (a) "h1 reads Performance" and test (e) "Save report") but both are flaky/pre-existing, unrelated to phase 86: (e) is a Phase-74 test (git blame: `ae54475671`, dated 2026-06-28, untouched by phase 86) whose "poll for report count increase" assertion is sensitive to accumulated state across repeated suite runs against a live shared instance; it passed on a subsequent run. (a) failed only once across three full-suite executions and is a generic hydration-timing flake unrelated to any phase-86 code path. Neither is included as a phase-86 gap.

---

_Verified: 2026-07-11T03:10:00Z_
_Verifier: Claude (gsd-verifier)_
