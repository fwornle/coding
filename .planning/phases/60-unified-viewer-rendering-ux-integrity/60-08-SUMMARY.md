# Phase 60 Plan 08: UX-Integrity Gap Closure (Gaps C/D/E + F) Summary

**Closes the operator-visible legend↔canvas mismatch (Gap C), selection-count↔halo-count mismatch (Gap D), and one-directional hover (Gap E) in the unified viewer; plus a Gap F focal-node bug found during operator smoke. Viewer-side only (bind-mounted, no km-core API change). ~40 new tests pass, tsc + build clean. Visual smoke on /viewer/coding confirms varied node shapes + hover-pulse CSS live.**

> Close-out note: this plan was implemented and committed (`10e5ef12f`, 2026-06-19) but the SUMMARY was never written, so GSD still flagged the plan incomplete. This SUMMARY was authored at close-out on 2026-06-20 after re-verifying the implementation against the plan (tests, tsc, build, browser smoke) per the execute-phase safe-resume gate. No code was re-executed — the existing commit satisfies all must-haves.

## Accomplishments

### Gap C — Shape rendering (SC#2 follow-up)
New `src/graph/node-shapes.ts` renders one of {circle, square, hexagon, diamond, triangle} per `SHAPE_PALETTE[entity.ontologyClass]`, replacing `D3GraphCanvas`'s unconditional `<circle>`. Class resolved `entityType → ontologyClass` (handles the `CollectiveKnowledge` case). Unknown class falls back to circle (matches the existing colour-fallback defensive pattern). Legend DOMAINS section and the canvas now describe the same world.
- **Browser-verified (2026-06-20):** among 838 rendered `.node-shape` elements the canvas now emits a mix — `rect` (square), `path` (hexagon/diamond/triangle), and `circle` (fallback) — not the previous all-circles.

### Gap D — Selection truth (SC#3 follow-up)
`BucketCardList` "Selected" header now reads `N items · X visible · Y hidden by "Show debug entity types"` via the shared `useVisibleEntityIds` predicate, so the operator sees why the canvas halo count is less than the selected count (the 27/10 example from 2026-06-18). Clean state (`hidden == 0`) shows `N items` with no breakdown noise.

### Gap E — Bidirectional hover
Additive `hoveredNodeId` store slice (`hoveredNodeId: string | null`, `setHoveredNodeId`), non-persistent, Phase 56.1 D-1 multi-selection contract preserved (`selectedNodeIds`/`focalNodeId`/`selectedBucketKeys` untouched). D3 `mouseenter`/`mouseleave` set the slice; CSS `@keyframes` pulse on `.node-shape.is-hovered`. Sidebar rows reciprocate via `data-hovered` + a hidden-state hint when the entity is filtered off-canvas. CSS-only pulse — Phase 56 viewport-stability invariant holds (no pan/zoom/relayout on hover).
- **Browser-verified:** hover-pulse CSS rule present in the live stylesheet.

### Gap F — Focal-node empty-panel bug (found in operator smoke, fixed in-scope)
A single graph-drilled node can carry a non-empty `selectedBucketKeys` (timeline halo), which the old `SidePanel` predicate misread as multi-mode and rendered an empty `BucketCardList` ("0 items / No cards to show") despite the node being focal. `isMultiMode` now matches `BucketCardList`'s own candidate conditions exactly, so single nodes route to `EntityDetailPanel`.

### Build + regression gates
- `npx tsc --noEmit`: clean.
- `npm run build`: clean (`✓ built in ~5s`).
- 60-08 test files: 143/145 pass. The 2 failures (`viewer-store.test.ts > toggleLayer('evidence')`) are **pre-existing and unrelated** — confirmed failing at `10e5ef12f~1` (before this plan: `2 failed | 80 passed`); they concern `selectedLayers=[]` semantics, not the hover slice.

## Task Commits
- `10e5ef12f` feat(viewer): 60-08 Gaps C/D/E — shape rendering, selection breakdown, hover; + Gap F fix
- `b2c4537e7` docs(60-08): draft UX-integrity gap-closure plan (Gaps C/D/E)

## Files Created/Modified
- `src/graph/node-shapes.ts` (new) — `renderNodeShape()`, `SHAPE_RENDERERS`, `HEXAGON_PATH`/`DIAMOND_PATH`/`TRIANGLE_PATH` helpers
- `src/graph/node-shapes.test.ts` (new, 13 tests)
- `src/graph/D3GraphCanvas.tsx` — uses `renderNodeShape()` in enter() chain; emits hover on mouseenter/leave
- `src/graph/D3GraphCanvas.hover.test.tsx` (new)
- `src/panels/BucketCardList.tsx` + `.test.tsx` — selection breakdown header
- `src/panels/SidePanel.tsx` + `.test.tsx` — `isMultiMode` fix (Gap F)
- `src/store/viewer-store.ts` + `.test.ts` — `hoveredNodeId` slice
- `src/index.css` — `.node-shape.is-hovered` pulse keyframes

## Decisions Made
- Hover is a separate, non-persistent store slice (mirrors `showDebugEntityTypes` / D-11) — keeps the Phase 56.1 multi-selection contract untouched.
- Unknown `ontologyClass` → circle fallback (consistent with the existing colour-fallback pattern) rather than throwing.
- Pulse is CSS-only (no canvas redraw) to preserve the Phase 56 viewport-stability invariant.

## Deviations from Plan
- **Gap F added in-scope:** not in the original C/D/E scope; surfaced during operator smoke and fixed in the same commit because it's the same SidePanel predicate touched by Gap D. Documented in the commit body.

## Self-Check: PASSED
All must-have truths verified: shape variety on canvas (browser smoke), selection breakdown header, `hoveredNodeId` slice with reciprocal sidebar hover + hidden hint, viewport stability (CSS-only), 56.1 contract preserved, tsc/build clean.

## Next Phase Readiness
- Phase 60 implementation plans (60-01 … 60-08) are now all complete with SUMMARYs.
- **Remaining for phase closure:** the 60-07 Task 3 `human-verify` operator checkpoint (L0 OntologyFilter anchors render; L1/L2 absent pending the Deviation-3 obs-api registry follow-up), then `/gsd-verify-phase 60`.
- Natural sequels: Phase 56 / 56.1 (viewer bidirectional selection + temporal bridge) build on this hover/selection work.

---
*Phase: 60-unified-viewer-rendering-ux-integrity*
*Implemented: 2026-06-19 (commit 10e5ef12f) · SUMMARY closed out: 2026-06-20*
