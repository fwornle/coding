---
phase: 86-timeline-v2-and-declutter
plan: 02
subsystem: system-health-dashboard/performance
tags: [context-band, redux-slice, frozen-contract, honest-null, wave-1]
requires:
  - "Phase 84 ContextTurnRow shape (categories[].bytes, usage.cache_write:null discriminator, wire)"
  - "Phase 83 reconciliation.json per-span summary (matched/flagged counts)"
provides:
  - "context-cache-explainer.tsx exports scaledBand/SEGMENTS/scrubSecrets/CACHE_WRITE_NA (+ Segment) — one definition, no fork"
  - "context-band.tsx — ContextBand (variant mini|cumulative) + ContextBandLegend; hatched cache-read overlay + honest N/A cache-write path (D-04/D-05)"
  - "performanceSlice: fetchReconciliation thunk (graceful-empty, verbatim) + reconciliationByTaskId + selectReconciliationFor (D-12/D-13)"
  - "performanceSlice: modalTaskId/modalTurnIndex state + openTurnModal/closeTurnModal + selectModalTurn (D-01/D-02) — FROZEN contract for Waves 2/3"
affects:
  - "Wave 2 turn-modal.tsx (imports ContextBand mini + openTurnModal/selectModalTurn)"
  - "Wave 2/3 difference-viewer + reconciliation-badge (import fetchReconciliation/selectReconciliationFor + ContextBand cumulative)"
tech-stack:
  added: []
  patterns:
    - "Additive `export` on existing file-local functions (zero behavior change) so both surfaces share ONE palette/byte-math/honesty-string (D-05)"
    - "Thunk mirror: fetchReconciliation is a byte-for-byte structural clone of fetchContextTurns (same-origin, graceful-empty, keyed-by-taskId reducer, curried selector)"
    - "Honest-null render: branch on `usage.cache_write === null`, never `?? 0` — hatched cache-read overlay via CSS repeating-linear-gradient, no recharts/SVG"
    - "Wire-shape normalisation in the thunk (both {reconciliation:{summary}} and verbatim {summary}) so consumers read one ReconciliationSummary|null type"
key-files:
  created:
    - integrations/system-health-dashboard/src/components/performance/context-band.tsx
  modified:
    - integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx
    - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
decisions:
  - "The reconciliation route serves reconciliation.json VERBATIM with a TOP-LEVEL `summary` object (not the {reconciliation:{summary}} wrapper the plan's interfaces block sketched); ENOENT → {reconciliation:null}. fetchReconciliation normalises BOTH shapes to ReconciliationSummary|null so Waves 2/3 read one type regardless of which wire shape the file has"
  - "Exported the `Segment` interface too (additive) so context-band.tsx types its band-view against the shared shape rather than re-declaring it"
  - "Cache-read overlay renders as a single hatched band spanning the leftmost readFrac of the whole band (the re-read prefix), averaged across turns for the cumulative variant so one warm turn doesn't imply the whole run was cache-read"
metrics:
  duration_min: 6
  tasks: 2
  files: 3
  completed: 2026-07-10
---

# Phase 86 Plan 02: Band Primitives, Context-Band & Slice Contract Summary

Concentrated the frozen Redux + shared-primitive contract for Timeline v2: exported the band-rendering primitives from `context-cache-explainer.tsx` (additive `export`, zero behavior change), built the shared `context-band.tsx` (mini + cumulative variants with a hatched cache-read overlay and an honest `CACHE_WRITE_NA` path, D-04/D-05), and landed the `fetchReconciliation` thunk (D-12/D-13) plus the modal open-state (D-01/D-02) so Waves 2/3 read a stable slice surface and never touch the explainer internals or the slice in parallel.

## What Was Built

- **Task 1 — Export primitives + build context-band.tsx (D-04/D-05).** Added `export` to the file-local `SEGMENTS`, `scaledBand`, `scrubSecrets`, `CACHE_WRITE_NA` (and the `Segment` interface) in `context-cache-explainer.tsx` — purely additive; the explainer keeps using them internally, so its render is byte-identical. New `context-band.tsx` exports `ContextBand` (`variant: 'mini' | 'cumulative'`) and `ContextBandLegend`. It imports `scaledBand`/`SEGMENTS`/`CACHE_WRITE_NA` from the explainer (the phase key_link — never a fork). **Mini** feeds one `ContextTurnRow.categories[]` → `{key:bytes}` → `scaledBand` → a flex row of width-`%` `<div>`s at `h-2` (byte-share WITHIN the turn). **Cumulative** sums per-turn category bytes run-wide (history accreting), scaled to 100 via the same `scaledBand`, at `h-4`. Cached overlay (D-05): the `usage.cache_read` share renders as a 45° `repeating-linear-gradient` hatch (~4px pitch) at ~0.55 opacity over the fill; solid = fresh. Honesty gate: branches on `usage.cache_write === null` (the OpenAI-wire discriminator) → renders the verbatim `CACHE_WRITE_NA` note, NEVER `?? 0`, never an amber write segment. No recharts, no SVG.

- **Task 2 — Slice extensions (D-01/D-02/D-07/D-12).** Extended `performanceSlice.ts` (one slice, no new slice — UI-SPEC Q2). (a) `fetchReconciliation` createAsyncThunk mirroring `fetchContextTurns` exactly: same-origin `GET /api/experiments/runs/:taskId/reconciliation`, graceful-empty (never throws on ENOENT), storing into `reconciliationByTaskId: Record<string, ReconciliationSummary | null>`. The new `ReconciliationSummary` type is defined from the api-routes shape (`matched`/`unmatched_wire`/`unmatched_transcript`/`fallback`/`aggregateDeltas`/`flaggedCount`); the summary is served VERBATIM, never client-recomputed (T-86-02-03). (b) `modalTaskId`/`modalTurnIndex` state + `openTurnModal({taskId,index})`/`closeTurnModal()` reducers mirroring `setExplainTaskId`. (c) Curried `selectReconciliationFor(taskId)` + `selectModalTurn` selectors. Existing `saveOverride`/`setCompareA`/`setCompareB`/`toggleRunSelected`/`selectContextTurnsFor` were left untouched and are reused as-is by later plans.

## Verification

- **Dashboard build passes** (`npm run build`) — no `error TS` referencing `context-band.tsx`, `context-cache-explainer.tsx`, or `performanceSlice.ts`. The only 4 `error TS` are pre-existing, out-of-scope diagnostics in `src/components/workflow/node-details-sidebar.tsx` and `src/pages/token-usage.tsx` (the latter is the deferred `token-usage.tsx` diagnostic already noted in STATE.md 85-06 closeout).
- **Task 1 ACs all green:** explainer func/const exports = 3, `CACHE_WRITE_NA` export = 1; band imports scaledBand/SEGMENTS/CACHE_WRITE_NA from explainer (1); `cache_write === null` present (3), `cache_write ... ?? 0` = 0; `recharts|<svg` = 0.
- **Task 2 ACs all green:** `fetchReconciliation` = 7 (≥3); graceful-empty pattern = 5 (≥1); `openTurnModal|closeTurnModal|modalTaskId` = 10 (≥3); only `performanceSlice.ts` touched among slice files (6 sibling slices untouched); `selectReconciliationFor|selectModalTurn` = 2.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reconciliation wire shape differs from the plan's sketch**
- **Found during:** Task 2.
- **Issue:** The plan's `<interfaces>` block sketched the reconciliation response as `{ reconciliation: {summary:{...}} | null }`. The real route (`lib/vkb-server/api-routes.js:623`) serves `reconciliation.json` VERBATIM — which has a TOP-LEVEL `summary` object (`{schemaVersion, span, summary, perRequest}`), not a `reconciliation` wrapper — and only the ENOENT graceful-empty path returns `{reconciliation:null}`. A thunk keyed solely on `data.reconciliation.summary` would silently store `null` for every real run.
- **Fix:** `fetchReconciliation` normalises BOTH wire shapes: `data?.reconciliation?.summary ?? data?.summary ?? null`. Consumers read one `ReconciliationSummary | null` type regardless.
- **Files modified:** `performanceSlice.ts`.
- **Commit:** d82c8538d.

**2. [Rule 3 - blocking] Task 1 AC grep `recharts` matched a code comment**
- **Found during:** Task 1 verification.
- **Issue:** The AC `grep -Ec "recharts|<svg"` must return 0, but the component's header comment named `recharts` (explaining why it is NOT used), returning 1.
- **Fix:** Reworded the comment to "a charting library / vector graphic" — the no-recharts/no-SVG contract is preserved in behavior (the band is pure `<div>`s).
- **Files modified:** `context-band.tsx`.
- **Commit:** 34f4fe319.

## Notes for Downstream Plans (Frozen Contract)

- **Turn modal (Wave 2):** dispatch `openTurnModal({taskId, index})` / `closeTurnModal()`; read `selectModalTurn` → `{taskId, index, open}`. Mount the modal once in `performance.tsx`, mirroring the `explainTaskId` pattern.
- **Reconciliation badge / diff header:** dispatch `fetchReconciliation(taskId)`; read `selectReconciliationFor(taskId)` → `ReconciliationSummary | null`. Render the counts VERBATIM — do NOT recompute matched/flagged client-side (T-86-02-03).
- **Bands:** `<ContextBand variant="mini" turn={row} />` for the per-turn row (`h-2`); `<ContextBand variant="cumulative" turns={rows} />` for the modal/fullscreen accreting band (`h-4`). Pair with `<ContextBandLegend />`. Never fork `scaledBand`/`SEGMENTS`/`CACHE_WRITE_NA` — import from `./context-cache-explainer`.
- **Secret scrub (T-86-02-01):** `scrubSecrets` is now exported — apply it to ANY preview text a consumer renders in the modal (the band itself renders only numeric byte shares + category labels, no free text).

## Known Stubs

None. Both deliverables are complete and self-contained: `context-band.tsx` renders both variants from real `ContextTurnRow` data with a wired honest-N/A path, and the slice surface is fully typed and typechecks. Downstream UI consumption is Waves 2/3 by design (this plan deliberately concentrates the frozen contract).

## Self-Check: PASSED

- FOUND: integrations/system-health-dashboard/src/components/performance/context-band.tsx
- FOUND: integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx
- FOUND: integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
- FOUND: .planning/phases/86-timeline-v2-and-declutter/86-02-SUMMARY.md
- FOUND commit 34f4fe319 (Task 1), d82c8538d (Task 2)
