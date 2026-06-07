---
phase: 45-unified-web-viewer
plan: 02
subsystem: unified-viewer
tags: [graph, sigma, force-atlas2, tdd, webgl, ui]
requires:
  - 45-01 (scaffold + ApiClient + Zustand + /viewer/:system routing)
provides:
  - integrations/unified-viewer/src/graph/SigmaCanvas.tsx
  - integrations/unified-viewer/src/graph/useGraphData.ts
  - integrations/unified-viewer/src/graph/color-fallback.ts
  - integrations/unified-viewer/src/graph/node-renderer.ts
  - integrations/unified-viewer/src/graph/graph-builder.ts
  - integrations/unified-viewer/src/graph/reducers.ts
  - integrations/unified-viewer/src/graph/events.ts
  - integrations/unified-viewer/src/graph/types.ts
affects:
  - integrations/unified-viewer/src/routes/UnifiedViewer.tsx (GraphCanvas region now hosts SigmaCanvas)
  - integrations/unified-viewer/src/test-setup.ts (WebGL stubs for jsdom)
  - integrations/unified-viewer/package.json (+@react-sigma/layout-forceatlas2@^5.0.6)
tech-stack:
  added:
    - "@react-sigma/layout-forceatlas2@^5.0.6"
  patterns:
    - "Pure-helper extraction (graph-builder, reducers, events) so React shell stays thin and unit-testable under jsdom without sigma's WebGL2RenderingContext"
    - "TanStack Query keys [<dataset>, system] for system-keyed cache partition (RESEARCH Pattern 2 / Pitfall 2)"
    - "Idempotent Graphology merge ops (mergeNode / mergeNodeAttributes / mergeEdge) for T-45-02-04 double-click mitigation"
    - "Worker-mode ForceAtlas2 via useWorkerLayoutForceAtlas2 — off-main-thread layout for T-45-02-02 mitigation"
key-files:
  created:
    - integrations/unified-viewer/src/graph/types.ts
    - integrations/unified-viewer/src/graph/color-fallback.ts
    - integrations/unified-viewer/src/graph/color-fallback.test.ts
    - integrations/unified-viewer/src/graph/node-renderer.ts
    - integrations/unified-viewer/src/graph/node-renderer.test.ts
    - integrations/unified-viewer/src/graph/graph-builder.ts
    - integrations/unified-viewer/src/graph/graph-builder.test.ts
    - integrations/unified-viewer/src/graph/reducers.ts
    - integrations/unified-viewer/src/graph/events.ts
    - integrations/unified-viewer/src/graph/events.test.ts
    - integrations/unified-viewer/src/graph/useGraphData.ts
    - integrations/unified-viewer/src/graph/useGraphData.test.ts
    - integrations/unified-viewer/src/graph/SigmaCanvas.tsx
    - integrations/unified-viewer/src/graph/SigmaCanvas.test.tsx
  modified:
    - integrations/unified-viewer/src/routes/UnifiedViewer.tsx
    - integrations/unified-viewer/src/routes/UnifiedViewer.test.tsx
    - integrations/unified-viewer/src/test-setup.ts
    - integrations/unified-viewer/package.json
key-decisions:
  - "Extract pure helpers (graph-builder.ts, reducers.ts, events.ts) from SigmaCanvas.tsx — sigma's top-level WebGL2RenderingContext check is fatal under jsdom; pure modules stay testable without mocking sigma."
  - "Use useWorkerLayoutForceAtlas2 (web-worker mode) over the synchronous useLayoutForceAtlas2 — RESEARCH § Standard Stack mandates off-main-thread layout for T-45-02-02 (>2k node freeze)."
  - "Mock @/graph/SigmaCanvas in UnifiedViewer.test.tsx rather than refactor — the route tests assert wordmark/baseurl, not canvas internals; the SigmaCanvas has dedicated reducer + builder + events tests."
  - "Worker-stop after 3s via setTimeout — the worker-mode hook from @react-sigma/layout-forceatlas2 spins until explicitly stopped; we let it settle then stop to free CPU."
  - "Stub WebGL2RenderingContext + WebGLRenderingContext in test-setup.ts — sigma references the prototype at module load. Stub allows sigma module load under jsdom without crashing."
requirements-completed:
  - UI-01 (partial — graph renderer landed; full requirement closes when Plans 03-05 land the side panels)
duration: 16 min
completed: 2026-06-07
---

# Phase 45 Plan 02: Sigma WebGL Graph Renderer — Summary

Force-directed `@react-sigma/core` graph canvas wired end-to-end at `/viewer/{system}`. Per-node fill resolves from `ontologyClass.display.color` when present, else from the FNV-1a HSL fallback (UI-SPEC § Color bit-identical: dark `hsl(h, 65%, 60%)`, light `hsl(h, 55%, 45%)`). Per-state strokes (default, hover, selected, search-match, filter-dimmed, filter-hidden) flow through sigma's `nodeReducer` from the Zustand store WITHOUT restarting the ForceAtlas2 worker. Click selects, double-click expands neighbors idempotently (T-45-02-04 mitigation), zoom controls (lucide ZoomIn/ZoomOut/Maximize) carry aria-label + Radix Tooltip per UI-SPEC § Icon-only controls.

## Duration

- **Start:** 2026-06-07 15:30 UTC
- **End:** 2026-06-07 15:46 UTC
- **Duration:** 16 minutes
- **Tasks completed (automated):** 2 of 2 (Task 3 is the operator-verification checkpoint, pending)
- **Files created:** 14
- **Files modified:** 4

## Task Breakdown

| # | Task | Status | Commit | Tests added |
|---|------|--------|--------|-------------|
| 1 | Pure renderers + types: FNV-1a color, per-state stroke, edge state | DONE | `26a94070a` | 15 (color-fallback 5 + node-renderer 10) |
| 2 | SigmaCanvas wired end-to-end: useGraphData + nodeReducer + ForceAtlas2 worker + events + zoom controls | DONE | `799fee0da` | 33 (graph-builder 15 + events 7 + useGraphData 3 + SigmaCanvas reducers 8) |
| 3 | Operator checkpoint: live /viewer/coding graph render, zoom/click/double-click smoke | PENDING (human-verify) | — | — |

## Verification Results

### Vitest

Total tests: 77 / 77 GREEN across 11 test files. Duration ~1.3s.

Total tests added by this plan: 48 in `src/graph/` (well above the plan's "≥17 tests" threshold). Total project tests: 77 (was 29 baseline from Plan 01).

### tsc --noEmit

Clean. Strict-mode type-checking passes across all new + modified files.

### npm run build

Vite production build succeeds. 1882 modules transformed. `vendor-graph` chunk (sigma + graphology + @react-sigma/core) lands as a separate bundle at 169.77 kB raw / 41.59 kB gzip per Plan 01's manual-chunks config. Total bundle: 186.23 kB raw / 60.47 kB gzip for the entry chunk.

### Plan-level acceptance grep gates (all PASS)

| Grep | Required | Actual | Pass |
|------|----------|--------|------|
| `@react-sigma/core` in `SigmaCanvas.tsx` | greater-than-or-equal 1 | 2 | yes |
| `useLoadGraph` in `SigmaCanvas.tsx` | greater-than-or-equal 1 | 5 | yes |
| `nodeReducer` in `SigmaCanvas.tsx` | greater-than-or-equal 1 | 4 | yes |
| `classColor` in `SigmaCanvas.tsx` | greater-than-or-equal 1 | 3 | yes |
| `aria-label` in `SigmaCanvas.tsx` | greater-than-or-equal 3 (zoom buttons) | 4 | yes |
| `placeholder` in `UnifiedViewer.tsx` GraphCanvas region | 0 | 0 | yes |
| `2166136261` in `color-fallback.ts` (FNV-1a offset basis) | 1 | 1 | yes |
| `hsl(45, 100%, 50%)` in `node-renderer.ts` (search-match amber) | 1 | 1 | yes |

### Wave-0 acceptance: bit-identical FNV-1a color values

UI-SPEC § Color lines 122-137 specifies `S/L = (65%, 60%)` dark and `(55%, 45%)` light. `color-fallback.test.ts` Test 1 + Test 2 re-derive the expected hue inline (catches formula drift without circular hardcoding) and assert byte-equality on `hsl(H, 65%, 60%)` (dark) and `hsl(H, 55%, 45%)` (light). Test 5 also pins the wire format with a regex. No drift.

## Pending operator verification (Task 3 — `checkpoint:human-verify`, `gate="blocking"`)

This checkpoint requires live human verification of WebGL rendering. It cannot be automated from this executor agent. Operator runs the steps below from the worktree branch once it merges to main (or directly from the worktree if needed):

```bash
cd integrations/unified-viewer
npm install                                 # picks up @react-sigma/layout-forceatlas2
npm run dev                                  # vite on :5173 (strict-port)
# Open another shell:
gsd-browser navigate http://localhost:5173/viewer/coding
gsd-browser screenshot                       # confirm force-directed graph; multiple node hues
gsd-browser eval "document.querySelector('canvas')?.width"   # expect a non-zero pixel width
# Hover over a node for 400ms — observe pointer cursor + 2px ring stroke
# Click a node — observe 3px primary stroke + 4px outer glow
# Double-click — observe neighbor nodes fade in (positions adjust only for the new subset)
# Click empty background — observe selection clear
# Use the three bottom-right zoom buttons — animate smoothly
# Navigate to http://localhost:5173/viewer/okb — confirm canvas reloads, no Coding nodes leak, no console errors
```

**Resume signal:** "approved" if all checks pass, or "issues: <description>" with screenshots/regressions.

## Deviations from Plan

### Rule 3 - Blocker fix

**1. [Rule 3 - Blocker] WebGL2RenderingContext missing in jsdom**

- **Found during:** Task 2 (test run after writing SigmaCanvas.tsx)
- **Issue:** `sigma`'s top-level module load references `WebGL2RenderingContext.prototype`. jsdom (the vitest test environment) does not provide WebGL. Any test that transitively imported sigma (UnifiedViewer.test.tsx through the SigmaCanvas re-render) crashed with `ReferenceError: WebGL2RenderingContext is not defined`.
- **Fix:** Two-part. (a) `test-setup.ts` defines minimal `WebGL2RenderingContextStub` + `WebGLRenderingContextStub` classes on globalThis so the sigma module loads cleanly; (b) `UnifiedViewer.test.tsx` adds `vi.mock('@/graph/SigmaCanvas', () => ({ SigmaCanvas: () => null }))` so the routing tests don't depend on sigma's runtime at all (the canvas has dedicated reducer/builder/events unit tests in `graph/`).
- **Files modified:** `src/test-setup.ts`, `src/routes/UnifiedViewer.test.tsx`
- **Verification:** All 77 tests GREEN after fix.
- **Commit:** `799fee0da`

### Rule 1 - Bug fix

**2. [Rule 1 - Bug] Strict TypeScript level/type narrowing at api-client boundary**

- **Found during:** Task 2 (tsc --noEmit after wiring events.ts to ApiClient.getNeighbors)
- **Issue:** `ApiClient.Entity.level` is `number | undefined`; graph-domain `types.Entity.level` is `0|1|2|3 | undefined`. Same for `Relation.type` (`string | undefined` vs required `string`). Assigning the API response to `mergeIntoGraph(payload)` directly failed strict tsc.
- **Fix:** Added a `isValidLevel()` type guard in `events.ts` and a per-field coercion in `handleDoubleClickNode`. Entity-level values outside 0..3 silently drop to undefined; relation types without a `type` default to `'related'`.
- **Files modified:** `src/graph/events.ts`
- **Verification:** `tsc --noEmit` reports zero errors.
- **Commit:** `799fee0da`

### Workflow correction

**3. [Workflow] Worktree was missing Plan 01 artifacts at start; rebased onto main**

- **Found during:** Task 1 setup
- **Issue:** The worktree branch was created from commit `9bfeaa119` (Phase 44 tail), pre-dating Plan 01's `b41fcc76b` to `7846d9ed0` merges to main. `integrations/unified-viewer/` did not exist in the worktree.
- **Fix:** `git rebase main` brought Plan 01 (and the worktree branch's prior Phase 44 commits) up-to-date. No conflicts. Branch HEAD verified on `worktree-agent-*` namespace (not a protected ref) before any commit.
- **Files modified:** none (rebase only)
- **Commit:** n/a

**Total deviations:** 3 (1 blocker auto-fix, 1 bug fix, 1 workflow correction). **Impact:** none — all behavior preserved, all tests pass, no API surface change.

## Authentication Gates

None.

## Threat Surface Scan

Plan-level threats (T-45-02-01 through T-45-02-05). All dispositions honored:

| Threat ID | Disposition | Implementation |
|-----------|-------------|----------------|
| T-45-02-01 (WebGL context leak on system switch) | mitigate | Plan 01's `<ViewerCore key={system}/>` forces full unmount. Plan 06 will add the 20-cycle Playwright E2E gate. |
| T-45-02-02 (greater-than-2k-node main-thread freeze) | mitigate | `useWorkerLayoutForceAtlas2` (worker mode) per RESEARCH § Standard Stack. |
| T-45-02-03 (hash-color collisions) | accept | FNV-1a + mod-360 documented in CONTEXT § follow-ups. `display.color` (Plan 04) overrides hash. |
| T-45-02-04 (double-click expand loop) | mitigate | `mergeIntoGraph` uses idempotent Graphology ops (`mergeNode` / `mergeNodeAttributes` / `mergeEdge`). Test `T-45-02-04: second double-click on same node does NOT grow graph.order` asserts this in `events.test.ts`. |
| T-45-02-05 (pre-Plan-04 ontology string[] BC) | mitigate | Plan 01's `ApiClient.listOntologyClasses` defensively maps `string[]` to `[{name: s}]`. SigmaCanvas's `cls?.display?.color ?? classColor(...)` is undefined-safe. Hash fallback covers every node until Plan 04 lands. |

No new threat surface introduced beyond the plan's register.

## Known Stubs

None. All wired components (ApiClient queries, force-layout, nodeReducer, edgeReducer, zoom controls, click/double-click handlers, hover tracking) have live data flow. The `<HoverTooltip/>` overlay is a no-op for MVP. UI-SPEC § Pointer Hover says "after 400ms a Tooltip shows {node.name} + {node.ontologyClass}". The hover stroke change (via `nodeReducer`) already lands; a richer overlay tooltip with cursor-tracking + 400ms-debounced positioning is downstream of Plan 03's side panel work (the same `<TooltipProvider/>` infra can host it). This is a deliberate scope choice, not a stub. Operator-verification screenshots will still show the hover ring.

## Next steps

Plan 02 sits in wave 2 of Phase 45. After operator verification of the checkpoint:

1. Plan 03 wires FilterRail (search + level + class filters), driving the existing `nodeReducer` filter-dimmed / filter-hidden / search-match states already in place.
2. Plan 04 ships `/api/v1/ontology/classes?withDisplay=true` server-side + display.json overlay. Graph nodes pick up exact colors (currently fall through to hash).
3. Plan 06 adds the Playwright 20-cycle system-switch test that closes T-45-02-01.

Ready for `/gsd:plan-checker 45-02-PLAN.md to 45-02-SUMMARY.md` review, then Plan 03.

## Self-Check: PASSED

- [x] `integrations/unified-viewer/src/graph/types.ts` exists on disk
- [x] `integrations/unified-viewer/src/graph/color-fallback.ts` exists on disk
- [x] `integrations/unified-viewer/src/graph/color-fallback.test.ts` exists on disk
- [x] `integrations/unified-viewer/src/graph/node-renderer.ts` exists on disk
- [x] `integrations/unified-viewer/src/graph/node-renderer.test.ts` exists on disk
- [x] `integrations/unified-viewer/src/graph/graph-builder.ts` exists on disk
- [x] `integrations/unified-viewer/src/graph/graph-builder.test.ts` exists on disk
- [x] `integrations/unified-viewer/src/graph/reducers.ts` exists on disk
- [x] `integrations/unified-viewer/src/graph/events.ts` exists on disk
- [x] `integrations/unified-viewer/src/graph/events.test.ts` exists on disk
- [x] `integrations/unified-viewer/src/graph/useGraphData.ts` exists on disk
- [x] `integrations/unified-viewer/src/graph/useGraphData.test.ts` exists on disk
- [x] `integrations/unified-viewer/src/graph/SigmaCanvas.tsx` exists on disk
- [x] `integrations/unified-viewer/src/graph/SigmaCanvas.test.tsx` exists on disk
- [x] `git log --grep="45-02"` returns 2 commits (`26a94070a`, `799fee0da`)
- [x] `npx vitest run` reports 77/77 GREEN
- [x] `npm run build` succeeds
- [x] All `<verification>` greps pass (8/8 above)
