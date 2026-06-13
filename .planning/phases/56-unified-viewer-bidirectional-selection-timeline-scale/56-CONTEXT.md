# Phase 56: Unified Viewer — Bidirectional Selection & Timeline Scale — Context

**Gathered:** 2026-06-13
**Status:** Ready for planning
**Source:** Direct handoff from prior /clear'd session (no /gsd-discuss-phase run)

<domain>
## Phase Boundary

Phase 56 closes two gaps surfaced while exploring the unified-viewer at
`localhost:5173/viewer/coding` after Phase 55 shipped feature parity with VOKB:

1. The **LSL timeline strip** renders ticks but no readable timestamp scale —
   users can't tell *when* a session segment lives in the active range.
2. **Selection is one-way.** Graph → SidePanel works through
   `viewer-store.selectedNodeId`, but clicking a timeline tick, an
   OccurrenceHistorySidebar row, or a HistorySidebar entry doesn't drive the
   graph; and graph selection doesn't highlight the corresponding row(s) in the
   sidebars or the matching timeline tick.

Goal: make the three primary panes (graph, timeline, history-sidebar) sync
through a single shared selection so the user pivots between views without
losing context.

This is a **pure frontend selection-plumbing** phase. No `km-core` API change,
no observation-api change, no Memgraph change.

</domain>

<decisions>
## Implementation Decisions (locked from handoff)

### Shared selection state
- The shared selection state lives in `viewer-store.ts`. `selectedNodeId`
  already exists; extend the store with whatever cross-pane sync fields are
  needed (e.g., `selectionSource`, `selectedSessionId`, `highlightedRowKey`)
  rather than letting any panel keep an independent selection.
- No panel may hold an independent local selection state. All selection
  reads/writes flow through `useViewerStore`.

### Bidirectional flows (all three pairs must work)
1. **Graph → others.** Selecting a node in `D3GraphCanvas`:
   - Highlights matching row(s) in `HistorySidebar` /
     `OccurrenceHistorySidebar`.
   - Highlights the matching timeline tick(s) in `LslTimelineStrip`.
2. **History sidebar → others.** Clicking a row in the history sidebars:
   - Highlights the corresponding node in `D3GraphCanvas` (selection ring +
     ancestry trace + EntityDetailPanel mount). **2026-06-13 spec change:**
     the original wording said "Centers / highlights"; the centering
     clause was retracted per operator second-smoke feedback. The viewport
     is intentionally left untouched on history-driven selection — the
     visual contract is the ring + ancestry trace + sidebar text.
   - Highlights the matching tick in `LslTimelineStrip`.
3. **Timeline → others.** Clicking a tick or session segment in
   `LslTimelineStrip`:
   - Selects the corresponding node(s) in `D3GraphCanvas`.
   - Scrolls / highlights the matching row(s) in the history sidebars.

### Selection scope (both forms supported)
- Entity nodes — `Insight`, `SubComponent`, `Detail`, `Component`,
  `System`, `Project`, etc.
- Aggregate selections — LSL `sessionId` selection, ancestry-path selection
  (Phase 55's 2026-06-11 ancestry feature already lives in
  `selectedNodeId`'s ancestry path).

### Clear-selection contract
- `Esc` and "click empty graph background" clear selection in all three
  panes simultaneously. Implementation must go through the store, not
  per-pane handlers.

### Timeline timestamp scale
- `LslTimelineStrip` shows a readable timestamp scale for the **active
  range** of the strip. Format adapts to the range duration:
  - sub-minute → `HH:MM:SS`
  - sub-day → `HH:MM`
  - multi-day → `MMM DD` + minor `HH:MM` ticks
- Major tick spacing should target ~5–8 labels across the strip at
  default zoom, no overlap.

### Regression guard
- No regression to Phase 55's visual-parity gates (16 UI-SPEC §7 surfaces
  remain green). Phase 55 verification artifact:
  `.planning/phases/55-unified-viewer-feature-parity-with-vokb/55-VERIFICATION.md`.

### Claude's Discretion
- Choice of cross-pane sync primitive (zustand selectors vs. effect-driven
  push) is left to the planner — pick the approach that matches existing
  patterns in `viewer-store.ts`.
- Highlight visual style for the non-selected panes (sidebar row, timeline
  tick) is left to the planner so long as it's visually distinct from
  Phase 55's existing selection style on the graph node.
- D3 vs. CSS-driven highlight in the graph is left to the planner.
- Timestamp-scale rendering implementation (`d3-time-format`,
  `Intl.DateTimeFormat`, or a small hand-rolled formatter) is left to the
  planner.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 55 — parity baseline (don't regress)
- `.planning/phases/55-unified-viewer-feature-parity-with-vokb/55-VERIFICATION.md`
  — 16 UI-SPEC §7 surfaces that must remain green.
- `.planning/phases/55-unified-viewer-feature-parity-with-vokb/55-HUMAN-UAT.md`
  — visual regression smoke list.

### Files in scope
- `integrations/unified-viewer/src/store/viewer-store.ts` — selection state
  (`selectedNodeId`, `setSelectedNode`, ancestry path); EXTEND for cross-pane sync.
- `integrations/unified-viewer/src/panels/SidePanel.tsx` — already subscribes
  to `selectedNodeId`; verify it still works after store extension.
- `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx` —
  timeline + session filter; ADD timestamp scale + tick → store dispatch.
- `integrations/unified-viewer/src/panels/HistorySidebar.tsx` — row →
  store dispatch + highlight rendering.
- `integrations/unified-viewer/src/panels/OccurrenceHistorySidebar.tsx` —
  row → store dispatch + highlight rendering.
- `integrations/unified-viewer/src/App.tsx` — wiring (pass store handlers,
  no per-pane local selection).
- `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx` — graph node
  click already routes through `setSelectedNode`; ADD background-click
  clear and `Esc` handler if not already present.

### Test surfaces
- `integrations/unified-viewer/src/store/viewer-store.test.ts` — extend
  with cross-pane sync coverage.
- `integrations/unified-viewer/src/panels/OccurrenceHistorySidebar.test.tsx`
  — extend with click-to-select coverage.
- Playwright E2E directory: `integrations/unified-viewer/tests/` (verify
  whether E2E exists; if so, add bidirectional-selection scenario).

</canonical_refs>

<specifics>
## Specific Acceptance Criteria (from handoff — every AC MUST be addressed)

| # | Acceptance Criterion |
|---|---|
| 1 | `LslTimelineStrip` shows a readable timestamp scale for the active range — not raw ms / unlabeled ticks. |
| 2 | Selecting a node in the graph highlights its row(s) in the history sidebar AND ticks on the timeline (graph → others). |
| 3 | Selecting a row in the history sidebar highlights the corresponding node in the graph (selection ring + ancestry trace + EntityDetailPanel) AND highlights the matching timeline tick (history → others). **2026-06-13 spec change:** the original wording said "centers/highlights" — the centering clause was retracted per operator second-smoke feedback ("Maybe the zoom is not a good idea and you should just select the chosen node in the main graph (red circle) plus trace to CK plus sidebar text"). Viewport is intentionally untouched on history-driven selection. |
| 4 | Clicking a timeline tick or session-segment selects the corresponding node(s) in the graph AND scrolls/highlights the matching history sidebar row(s) (timeline → others). |
| 5 | Shared selection state lives in `viewer-store.ts`. No panel keeps an independent selection. |
| 6 | Selection works for both entity nodes (Insight/SubComponent/Detail/etc.) AND aggregate selections (LSL session, ancestry path). |
| 7 | `Esc` + click-background clears selection in all three panes simultaneously. |
| 8 | No regression to Phase 55 visual-parity gates (16 UI-SPEC §7 surfaces stay green). |

</specifics>

<deferred>
## Deferred / Out of Scope

- **VOKB legacy viewer.** Phase 55 already cut parity. Don't touch
  `rapid-automations/.../vokb/`.
- **Backend / km-core API changes.** Frontend-only phase. No new
  endpoints, no SQL, no observation-api churn.
- **New visual layouts.** Phase 55's pane layout stays put. This phase
  only changes what the panes *do* on selection.
- **Performance/render-budget rewrites.** If the current
  `LslTimelineStrip` rendering already meets the user's interactive
  expectation, don't refactor for performance. Track separately.

</deferred>

---

*Phase: 56-unified-viewer-bidirectional-selection-timeline-scale*
*Context derived from prior-session handoff on 2026-06-13.*
