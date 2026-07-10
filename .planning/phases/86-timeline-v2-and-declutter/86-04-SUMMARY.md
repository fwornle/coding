---
phase: 86-timeline-v2-and-declutter
plan: 04
subsystem: system-health-dashboard/performance
tags: [difference-viewer, run-align, loop-heuristic, divergence-diff, honest-null, wave-2]
requires:
  - "86-01 run-align.ts (alignRuns/turnSignature — common-prefix + LCS tail, D-07)"
  - "86-01 loop-heuristic.ts (loopFlags/LOOP_WINDOW — windowed fuzzy repeat detector, D-09)"
  - "86-02 context-band.tsx (ContextBand mini variant) + context-cache-explainer scrubSecrets"
  - "86-02 performanceSlice frozen contract (selectContextTurnsFor/fetchContextTurns/selectCompareA/selectCompareB)"
provides:
  - "difference-viewer.tsx — DifferenceViewer: full divergence-point trajectory diff (D-07/D-08). Aligns two runs' ContextTurnRow[] via alignRuns, collapses identical prefix, renders divergent tail side-by-side with per-aligned-pair cumulative token deltas + advisory loop badges, canonical model verbatim."
affects:
  - "Wave-3 Compare-tab wiring mounts <DifferenceViewer/> and passes the selected run pair"
tech-stack:
  added: []
  patterns:
    - "Consumes the pure Wave-1 seams (alignRuns/loopFlags) — zero re-implementation of alignment or loop detection; the component is pure composition over tested modules"
    - "Per-aligned-pair CUMULATIVE token delta (B−A) accreting down the tail via a useMemo scan over align.pairs — decrease→text-status-success, increase/zero→text-muted-foreground (Q5)"
    - "Honest-null header: canonical_model read VERBATIM, null→italic 'unmeasured' (S2/ATTR-02), never a per-surface recompute"
    - "Lightweight inline TurnCell (mini ContextBand + optional loop badge) instead of importing the full Plan-03 TurnRow — avoids a cross-plan file dependency"
key-files:
  created:
    - integrations/system-health-dashboard/src/components/performance/difference-viewer.tsx
  modified:
    - tests/e2e/dashboard/performance-compare.spec.ts
decisions:
  - "TurnCell renders tool name+size (or a scrubSecrets'd ≤120-char preview) rather than raw args — satisfies T-86-04-01 (no secret in a diff-row preview reaches the DOM) while keeping the row compact"
  - "The e2e test (d) is doubly-guarded: the existing <2-runs data skip AND a Wave-3-wiring skip (surface not yet mounted on the Compare tab). Wave-3 mounts <DifferenceViewer/>; until then the test lists/runs cleanly, skipping loudly rather than failing"
  - "turnTokens sums input+output+cache_read+(cache_write??0) for the delta magnitude — cache_write null (OpenAI wire) treated as 0 for the SUM ONLY, never surfaced as a fabricated write figure (the honesty gate stays inside ContextBand)"
metrics:
  duration_min: 2
  tasks: 2
  files: 2
  completed: 2026-07-10
---

# Phase 86 Plan 04: Difference Viewer (D-07/D-08) Summary

Built the user's north-star surface — `difference-viewer.tsx` — a full divergence-point trajectory diff that reads two paired runs' per-request `ContextTurnRow[]` from the store, aligns them with the PURE `run-align.ts` (common-prefix + LCS tail), collapses the identical prefix, renders the divergent tail side-by-side with per-aligned-pair cumulative token deltas, flags looped signatures via the PURE `loop-heuristic.ts`, and reads `canonical_model` verbatim. Extended the compare e2e spec to cover the surface with a data-presence + wiring skip guard.

## What Was Built

- **Task 1 — difference-viewer.tsx (D-07, `DifferenceViewer`).** Reads `aId=selectCompareA`/`bId=selectCompareB`; dispatches `fetchContextTurns` for each; reads `aTurns`/`bTurns` via `selectContextTurnsFor` (NOT the timeline — alignment is on the ContextTurnRow request stream, never timestamps). Computes `{ prefixLen, firstDivergence, pairs } = alignRuns(aTurns, bTurns)` — the pure Wave-1 seam, no network, no re-implementation. Empty states: no aId → "Select a run to compare."; aId but no bId → "Select a second run to compare."; `firstDivergence === null` → the identical-runs empty state ("These two runs are identical — no divergence to show."), NOT a broken diff. Identical prefix `[0, prefixLen)` collapses by default in a Radix `Collapsible` labeled "Show N identical turn(s)" (S5). Divergent tail renders from `pairs`: each `{a,b}` shows the A-side + B-side `TurnCell` (a lightweight inline row: mini `<ContextBand>` + optional advisory loop badge), one-sided pairs (`a:null`/`b:null`) dim the empty column, and a per-pair CUMULATIVE signed token delta (B−A) accretes down the column — decrease → `text-status-success`, increase/zero → `text-muted-foreground`, always explicit +/− (Q5). `loopFlags(aTurns)`/`(bTurns)` mark looped turns per side (advisory outline badge + tooltip); `run.loop_count` is surfaced beside the header as the "hard" strict-adjacent count (null → em-dash, S2). Header reads `run.canonical_model` VERBATIM for both runs — null → italic "unmeasured" — NEVER recomputed (ATTR-02 / T-86-04-02). The `isExperimentCell` guard is carried structurally: alignment is on the per-cell-correct ContextTurnRow stream with no observation time-window join for cells (S4 / Pitfall 4 / T-86-04-03). `scrubSecrets` wraps any preview text a diff row renders (T-86-04-01). `data-testid="difference-viewer"`.

- **Task 2 — performance-compare.spec.ts extension.** New test `(d)` drives the difference-viewer surface after selecting two runs: asserts `data-testid="difference-viewer"` renders, the canonical-model header shows (verbatim value or "unmeasured"), and exactly one of the three diff outcomes materialises (identical-prefix collapse trigger / identical empty-state / divergent tail). Doubly-guarded: the existing `<2 runs` data-presence skip PLUS a Wave-3-wiring skip (the component is built in Wave 2 but mounted on the Compare tab only in Wave 3) — so the spec lists and runs cleanly regardless of seeded data or wiring state. Reuses `navigateToCompare`/`optionIds`/`pick` and the `localhost:3032` baseURL — no hand-rolled browser bootstrap.

## Verification

- **Dashboard build (`npm run build`)** — the only 4 `error TS` are the pre-existing, out-of-scope diagnostics in `node-details-sidebar.tsx` (×2) and `token-usage.tsx` (×2), already noted in the STATE.md 85-06 closeout and the plan's project-notes. ZERO errors reference `difference-viewer.tsx` — the new file typechecks clean.
- **Task 1 ACs all green:** `alignRuns(`=1 (≥1); `selectContextTurnsFor`=3 (≥2) AND forbidden `selectTimelineFor|.ts…sort|align…timestamp`=0; `loopFlags`=3 (≥1); `canonical_model`=4 (≥1) AND `unmeasured`=3 (≥1); `identical`=6 (≥1) AND `firstDivergence`=2 (≥1); `Collapsible|prefixLen`=12 (≥2).
- **Task 2 ACs all green:** diff-surface refs `difference-viewer|Show …identical turns|Compare selected`=5 (≥1); data-presence skip `test.skip|runRowCount`=4 (≥1); `npx playwright test … --list` enumerates test `(d)` with NO load error (5 tests listed).
- **No new npm package** — the diff consumes the hand-rolled LCS in run-align (Plan 01); no diff library added (T-86-04-SC).

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed with their exact acceptance greps green and no auto-fixes required. (The e2e test's Wave-3-wiring skip guard is not a deviation — the plan explicitly scopes tab wiring to Wave 3 and directs the spec to skip, never fail, when the surface isn't mounted; that is the specified resilient behavior.)

## Threat Surface

All plan `<threat_model>` mitigations are honored, no new surface introduced:
- **T-86-04-01** (secret in diff-row preview): `TurnCell` prefers tool name+size and passes any preview text through the exported `scrubSecrets`.
- **T-86-04-02** (per-surface canonical recompute): header reads `run.canonical_model` verbatim, null → "unmeasured" — grep-gated, no recompute.
- **T-86-04-03** (experiment-cell narrative bleed): aligns on ContextTurnRow only, no observation time-window join for cells.
- **T-86-04-04** (XSS): React default escaping, no `dangerouslySetInnerHTML`.
- **T-86-04-SC** (npm installs): no package added.

## Known Stubs

None. `DifferenceViewer` renders from real store `ContextTurnRow` data via the frozen 86-02 selectors and the pure 86-01 alignment/loop modules; it has no mock data source. The component is complete and typechecks. Live browser verification of the mounted surface is deferred to Wave-3 (which wires `<DifferenceViewer/>` onto the Compare tab and passes the selected pair) — the e2e test `(d)` is authored and lists cleanly now, and its Wave-3-wiring skip lifts automatically once the surface is mounted.

## Notes for Downstream Plans (Wave 3)

- Mount `<DifferenceViewer />` on the Compare tab (a sibling surface to `<RunCompare />`). It self-reads `selectCompareA`/`selectCompareB` from the slice — no props needed; selecting the pair in the existing Run A / Run B pickers drives it. Once mounted, the e2e `(d)` Wave-3-wiring skip lifts and the assertions run against the live surface.
- The identical prefix collapses by default; the divergent tail is the primary view (D-07). `run.loop_count` is the strict count; the outline "possible loop" badges are the advisory fuzzy heuristic — keep both distinct in any further UI copy.

## Self-Check: PASSED

- FOUND: integrations/system-health-dashboard/src/components/performance/difference-viewer.tsx
- FOUND: tests/e2e/dashboard/performance-compare.spec.ts (extended)
- FOUND commit 791ce687b (Task 1 difference-viewer)
- FOUND commit 655daca0e (Task 2 e2e spec)
