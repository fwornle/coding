---
phase: 86-timeline-v2-and-declutter
plan: 05
subsystem: ui
tags: [react, redux, dashboard, playwright, performance, declutter, reconciliation]

# Dependency graph
requires:
  - phase: 86-02
    provides: fetchReconciliation thunk + selectReconciliationFor(taskId) + ReconciliationSummary type + setCompareA/setCompareB slice actions
  - phase: 86-04
    provides: DifferenceViewer (aligned side-by-side trajectory diff with cumulative token deltas + loop badges) mounted in the Compare tab
provides:
  - per-run reconciliation badge (reconciliation-badge.tsx, ReconciliationBadge) — three states (✓ reconciled / ⚠ Δ discrepancy / transcript-fallback) from verbatim summary, icon-per-state, absent (no placeholder) when reconciliation === null
  - inline-editable score cells (runs-table.tsx) — click/focus → numeric inline-score-input, autosave via the EXISTING server-authoritative saveOverride PATCH, client validateDim range mirror, optimistic-revert on non-2xx, retained edited yellow badge + judged tooltip
  - compare-from-selection CTA (runs-table.tsx) — "Compare selected (2)" gated to exactly 2 selected runs, sets compareA/compareB, signals the page to switch to the Compare tab
  - page-header quarantine control (performance.tsx) — "Show quarantined (N)" with a live count, re-homed out of the faceted sidebar; include-pending-toggle testid + includePending fetch param preserved
  - Compare-tab difference viewer mount (performance.tsx) — DifferenceViewer mounted beside RunCompare, reachable from the compare CTA via controlled Tabs
  - extended e2e coverage (performance.spec.ts + performance-compare.spec.ts) — header quarantine control, inline score edit, reconciliation badge presence/absence, DASH-02 regression anchor, compare-from-selection flow (86-04 skip lifted)
affects: [timeline, performance-dashboard, declutter]

# Tech tracking
tech-stack:
  added: []  # no new packages — shadcn Input/Button/Tooltip/Badge already present (T-86-05-SC honored)
  patterns:
    - "Inline ScoreCell edits dispatch the EXISTING saveOverride PATCH (server re-validates + writes corrected_*); client validateDim mirror is UX-only, never authoritative; no client applyOverride re-implementation"
    - "Reconciliation badge reads the summary verbatim via fetchReconciliation/selectReconciliationFor; null → no badge (D-06 honesty), never a fabricated status"
    - "Compare CTA gated to selectedRunIds.length === 2 → setCompareA/setCompareB + controlled Tabs switch to the Compare tab"
    - "Quarantine control re-homed to the page header with a client-side runs.filter(r=>r.pending).length count; setIncludePending + fetchRuns fetch pair unchanged"

key-files:
  created:
    - integrations/system-health-dashboard/src/components/performance/reconciliation-badge.tsx
  modified:
    - integrations/system-health-dashboard/src/components/performance/runs-table.tsx
    - integrations/system-health-dashboard/src/components/performance/faceted-sidebar.tsx
    - integrations/system-health-dashboard/src/pages/performance.tsx
    - tests/e2e/dashboard/performance.spec.ts
    - tests/e2e/dashboard/performance-compare.spec.ts

key-decisions:
  - "Inline score edits reuse the server-authoritative saveOverride PATCH thunk (server re-validates ranges + writes corrected_*); the client validateDim range check blocks obviously-bad values but is UX-only. A non-2xx PATCH reverts the optimistic value (400 → inline server message, 404 → 'score changed on the server — reopen'). No client applyOverride re-implementation (grep-gate green) — closes threat T-86-05-01."
  - "Reconciliation badge reads status verbatim via fetchReconciliation/selectReconciliationFor; reconciliation === null renders NO badge (D-06 honesty, never a fabricated status) — closes threat T-86-05-02."
  - "Quarantine control moved out of the faceted sidebar to the page header with a live count 'Show quarantined (N)' (N = runs.filter(r=>r.pending).length — there is no run.quarantined field); the include-pending-toggle testid and the setIncludePending + fetchRuns fetch pair are preserved unchanged."
  - "DifferenceViewer mounted BESIDE RunCompare in the Compare tab (metric compare stays, UI-SPEC Q1); the compare CTA switches to the Compare tab via a controlled Tabs value."
  - "No packages installed — shadcn Input/Button/Tooltip/Badge already present (threat T-86-05-SC honored)."

patterns-established:
  - "Pattern 1: inline ScoreCell = focus→numeric Input→saveOverride PATCH→optimistic-revert, edited badge + judged tooltip retained, stopPropagation so the cell doesn't bubble to the row's setSelectedTaskId"
  - "Pattern 2: reconciliation badge = verbatim summary → status-* token + lucide icon per state, null → no render"
  - "Pattern 3: page-header quarantine control with a client-side pending count, sidebar toggle removed, fetch param preserved"

requirements-completed: [VALID-01, ATTR-02, DASH-02]

# Metrics
duration: ~20min
completed: 2026-07-11
---

# Phase 86 Plan 05: Declutter IA (Reconciliation Badge, Inline Scores, Header Quarantine, Compare-from-Selection) Summary

**Declutter IA for the Performance page: a page-header "Show quarantined (N)" control with a live count (out of the sidebar), inline-editable score cells that autosave through the existing server-authoritative `saveOverride` PATCH with optimistic-revert, per-run reconciliation badges (✓/⚠/transcript-fallback, absent when no data), and "Compare selected (2)" → the Plan-04 difference viewer in the Compare tab.**

## Performance

- **Duration:** ~20 min (autonomous Tasks 1-3 + checkpoint verification + finalization)
- **Tasks:** 4 (3 autonomous + 1 blocking human-verify checkpoint)
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- **Reconciliation badge** (`reconciliation-badge.tsx`, `ReconciliationBadge({ taskId })`, +92) — on mount dispatches `fetchReconciliation(taskId)` (Plan 02) and reads `selectReconciliationFor(taskId)`; maps the verbatim summary to the UI-SPEC-pinned vocabulary with a lucide icon per state (never colour alone): `flaggedCount>0` → `status-warning` `AlertTriangle` "⚠ Δ discrepancy"; `fallback>0` → `status-neutral` `FileText` "transcript-fallback"; `matched>0` → `status-success` `Check` "✓ reconciled"; `reconciliation === null` → returns null (NO badge, D-06 honesty). Tooltip holds the detail summary read verbatim. Wired as `<ReconciliationBadge taskId={run.task_id} />` (`data-testid="reconciliation-badge"`) into the runs-table row.
- **Inline score cells** (`runs-table.tsx`, D-11) — `ScoreCell` edits in place: click/focus renders a numeric shadcn `Input` (`inline-score-input`); on blur/Enter it dispatches the EXISTING `saveOverride({taskId, edits:[{dimension,value}], overridden_by: DEFAULT_OVERRIDDEN_BY})` PATCH (server re-validates + writes corrected_*, no client `applyOverride`). Client `validateDim` mirrors the range check (UX-only). Optimistic value shown, REVERTED on a non-2xx PATCH — 400 surfaces the server message inline (`text-status-error`), 404 → "score changed on the server — reopen". The "edited" yellow badge + judged tooltip are retained; the cell `stopPropagation`s so editing doesn't trigger the row's `setSelectedTaskId`.
- **Compare-from-selection CTA** (`runs-table.tsx`, D-08) — a "Compare selected (2)" primary `Button` (`data-testid="compare-selected"`) in the bulk toolbar, enabled ONLY when `selectedRunIds.length === 2`; dispatches `setCompareA(ids[0])` + `setCompareB(ids[1])` and signals the page to switch to the Compare tab. Disabled tooltip: "Select two runs to compare."
- **Page-header quarantine control** (`performance.tsx`, D-10) — the include-pending control re-homed from the faceted sidebar to the page header near the summary cards: the same `Checkbox` + label WITH a live count "Show quarantined ({N})" where `N = runs.filter(r => r.pending).length`. The `data-testid="include-pending-toggle"` and the `setIncludePending(next)` + `fetchRuns(next)` dispatch pair are preserved unchanged. The sidebar block was removed from `faceted-sidebar.tsx`.
- **Compare-tab difference viewer mount** (`performance.tsx`) — `<DifferenceViewer/>` (Plan 04) mounted BESIDE the existing `<RunCompare/>` in `<TabsContent value="compare">` (metric compare stays, UI-SPEC Q1); a controlled `Tabs value`/`onValueChange` lets the runs-table CTA switch to the Compare tab.
- **Extended e2e** (`performance.spec.ts` +82, `performance-compare.spec.ts` net −4) — asserts (a) the quarantine toggle now lives in the header with a count and still carries `include-pending-toggle`; (b) inline score edit affordance; (c) the reconciliation badge renders one of the three states OR is absent; (d) DASH-02 `granularity-tier-badge` + `timeline-reasoning-step` regression anchor; and the compare-from-selection flow — the 86-04 Wave-3-wiring skip is lifted.

## Task Commits

Each autonomous task was committed atomically:

1. **Task 1: reconciliation-badge.tsx + runs-table row badge (D-12)** — `394777f88` (feat)
2. **Task 2: Inline score cells (D-11) + compare-from-selection (D-08) in runs-table** — `c11d4327c` (feat)
3. **Task 3: Quarantine → page header (D-10) + Compare-tab diff mount + e2e** — `acebed864` (feat)
4. **Task 4: Human-verify declutter IA on :3032** — blocking human-verify checkpoint, **approved** (no code change)

**Plan metadata:** this docs commit (SUMMARY + STATE + ROADMAP + REQUIREMENTS).

## Files Created/Modified

- `integrations/system-health-dashboard/src/components/performance/reconciliation-badge.tsx` (created, 92 lines) — per-run reconciliation badge, three verbatim states, null → no badge (D-12)
- `integrations/system-health-dashboard/src/components/performance/runs-table.tsx` (modified, +184/-23 across two commits) — row reconciliation badge cell + inline-editable score cells (server-authoritative saveOverride, optimistic-revert) + gated "Compare selected (2)" CTA (D-08/D-11/D-12)
- `integrations/system-health-dashboard/src/components/performance/faceted-sidebar.tsx` (modified, +3/-24) — include-pending block removed
- `integrations/system-health-dashboard/src/pages/performance.tsx` (modified, +58/-6) — page-header "Show quarantined (N)" control + Compare-tab DifferenceViewer mount + controlled Tabs (D-10)
- `tests/e2e/dashboard/performance.spec.ts` (modified, +82) — header quarantine control, inline score edit, reconciliation badge presence/absence, DASH-02 anchor
- `tests/e2e/dashboard/performance-compare.spec.ts` (modified, +6/-10) — compare-from-selection flow; 86-04 Wave-3-wiring skip lifted

## Checkpoint: Human-Verify Approval (Task 4)

**Type:** checkpoint:human-verify (gate="blocking"). **Operator response: "approved".**

Live visual verification was performed on `:3032` via gsd-browser (frontend rebuilt + `web-services:health-dashboard-frontend` restarted per CLAUDE.md VirtioFS caching). All confirmed:

- **D-10** — the "Show quarantined (N)" control is in the page header (out of the sidebar) with a live count; DOM-ordered before the runs table.
- **D-11** — clicking/focusing a score cell opens the `inline-score-input` (aria "Edit code_quality score…", `inputmode` decimal); the existing server-authoritative `saveOverride` PATCH contract is used (identical payload); the client `validateDim` gates out-of-range before the round-trip. Verified NON-DESTRUCTIVELY (no value committed; cell still "—" after reload — no data mutated).
- **D-12** — the "✓ reconciled" reconciliation badge renders in rows with data and is ABSENT (no placeholder) when `reconciliation === null`.
- **D-08** — selecting exactly 2 runs → "Compare selected (2)" → switches to the Compare tab → the Plan-04 DifferenceViewer renders, aligned from the first divergence with cumulative Δ tokens (e.g. −84,726 → −340,878). The 86-04 Wave-3-wiring e2e skip is lifted.
- **ATTR-02 preserved** — italic "unmeasured" for null `canonical_model` (never recomputed).
- **Build** — vite build clean, no new TS errors.

## Decisions Made

- **Inline edits reuse the server-authoritative `saveOverride` PATCH.** The client `validateDim` range mirror is UX-only; the server re-validates ranges and writes `corrected_*`. A non-2xx PATCH reverts the optimistic value. There is no client `applyOverride` re-implementation (grep-gate green) — this closes threat T-86-05-01 (client-forged override becoming source of truth).
- **Reconciliation badge reads status verbatim.** `fetchReconciliation`/`selectReconciliationFor` feed the badge; `reconciliation === null` renders NO badge (never a fabricated status) — closes threat T-86-05-02.
- **Quarantine control moved to the page header with a live count.** `N = runs.filter(r=>r.pending).length` (there is no `run.quarantined` field, Q4 default); the `include-pending-toggle` testid and the `setIncludePending + fetchRuns` fetch pair are preserved unchanged.
- **DifferenceViewer mounted beside RunCompare** (metric compare stays, UI-SPEC Q1); the compare CTA drives a controlled `Tabs value` to switch to the Compare tab.
- **No packages installed** — shadcn Input/Button/Tooltip/Badge already present (threat T-86-05-SC honored).

## Deviations from Plan

None — plan executed exactly as written. No packages installed (T-86-05-SC honored); inline edits go through the existing server-authoritative `saveOverride` PATCH (no client `applyOverride`, T-86-05-01); reconciliation status read verbatim with null → no badge (T-86-05-02); status/error strings rendered as escaped text, no `dangerouslySetInnerHTML` (T-86-05-04).

## Issues Encountered

None during planned work.

## Deferred / Honest Caveat

**Inline-edit autosave round-trip against a scored run — not exercised live.** The current dataset had **0 scored runs**, so a full inline-edit autosave round-trip (edit a real score → PATCH → corrected value persists → survives reload) was NOT exercised during the checkpoint, to avoid mutating user data. What WAS verified live: the edit affordance opens (`inline-score-input`), the client `validateDim` range gate fires before the round-trip, and the existing `saveOverride` PATCH contract/payload is the one dispatched (confirmed non-destructively — the cell reverted to "—" after reload, nothing was mutated). The autosave round-trip itself is covered by the extended e2e spec. Live visual confirmation of a committed inline edit is deferred until a scored run is available in the dataset. This does not block the plan — the edit path, client validation, server-authoritative PATCH wiring, and automated coverage are all in place; only the on-screen persist-and-survive reproduction against real scored data is outstanding.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The declutter IA (D-08/D-10/D-11/D-12) is shipped and human-verified on :3032; VALID-01/ATTR-02/DASH-02 anchors preserved.
- **Phase 86 execution is complete (5/5 plans).** The Compare tab now hosts both metric compare (RunCompare) and the Plan-04 trajectory DifferenceViewer, reachable from the runs-table compare CTA.
- Outstanding (non-blocking): live visual confirmation of a committed inline score edit once a scored run exists in the dataset.

## Self-Check: PASSED

Created file verified present on disk:
- `integrations/system-health-dashboard/src/components/performance/reconciliation-badge.tsx` — FOUND

Modified files verified present:
- `integrations/system-health-dashboard/src/components/performance/runs-table.tsx` — FOUND
- `integrations/system-health-dashboard/src/components/performance/faceted-sidebar.tsx` — FOUND
- `integrations/system-health-dashboard/src/pages/performance.tsx` — FOUND
- `tests/e2e/dashboard/performance.spec.ts` — FOUND
- `tests/e2e/dashboard/performance-compare.spec.ts` — FOUND

Commits verified in git log:
- `394777f88` (Task 1) — FOUND
- `c11d4327c` (Task 2) — FOUND
- `acebed864` (Task 3) — FOUND

---
*Phase: 86-timeline-v2-and-declutter*
*Completed: 2026-07-11*
