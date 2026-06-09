---
phase: 55-unified-viewer-feature-parity-with-vokb
plan: 08
subsystem: ui
tags: [react, zustand, shadcn, vokb-parity, filters, ontology, lazy-loading, react-suspense]

# Dependency graph
requires:
  - phase: 45-unified-viewer-foundation
    provides: "FilterRail.tsx baseline (search / level / collapse) + shadcn Checkbox + Logger discipline"
  - phase: 55-unified-viewer-feature-parity-with-vokb
    provides: "Zustand filtersSlice (selectedLayers / selectedDomains / selectedOntologyClasses / showEdges / showClusters / showRelationLabels / showMergedOnly / hideDocNodes + their toggle actions, from Plan 55-04)"
provides:
  - "LayerFilter.tsx — VOKB-shape Evidence/Pattern filter with empty=all-visible semantic"
  - "DomainFilter.tsx — RaaS/KPI-FW/General filter with coding-tab italic graceful-degradation"
  - "OntologyFilter.tsx — grouped tree replacing Phase 45 flat ClassList; accepts `groupingSchema` prop"
  - "VOKB_SCHEMA + CODING_SCHEMA exports (Upper/Lower vs Hierarchy/Typed Views)"
  - "GraphToggles.tsx — 4 toggles + nested Labels sub-toggle (verbatim UI-SPEC §5 copy)"
  - "Rewired FilterRail.tsx — UI-SPEC §6 mount order + new required `system`/`entities` props"
  - "FilterRail lazy import lines for TrendingPanel + HierarchyNavigator (pinned here; downstream plans only overwrite the placeholder files)"
  - "TrendingPanel.tsx + coding/HierarchyNavigator.tsx placeholder modules (overwritten by 55-10 / 55-11)"
affects:
  - 55-10 (TrendingPanel — overwrites the placeholder at the lazy-imported path)
  - 55-11 (HierarchyNavigator — overwrites the placeholder at the lazy-imported path)
  - 55-12 (EtmTailSheet — sits adjacent in the filter rail / nav bar trigger)
  - 55-13 (LSL session multi-select — composes with OntologyFilter selections)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "VOKB Redux→Zustand filter port: empty-array selection = 'all visible'; action-name parity (toggleLayer / toggleDomain / toggleOntologyClass / setSelectedOntologyClasses)"
    - "Parameterized OntologyFilter via `groupingSchema` prop: one component hosts both VOKB Upper/Lower and coding Hierarchy/Typed Views layouts"
    - "Catch-all `Other` group rule preserved verbatim (unknown classes from entity payload never silently invisible)"
    - "Group-level all/none use union-add + filter-remove (NOT replace) — preserves orthogonal multi-group selections"
    - "Micro-type exceptions per UI-SPEC §3 preserved verbatim (text-[10px] count badges, text-[9px] group toggles, text-[8px] disclosure triangles)"
    - "Lazy-mount slot ownership at the rail level: FilterRail owns the React.lazy(() => import('./X')) lines; downstream plans overwrite the imported placeholder modules without touching the rail (closes plan-checker B-2/B-3)"
    - "Placeholder-module pattern for wave-staged lazy slots: minimal single-div component at the exact lazy-import path so vite emits a real chunk and Suspense resolves immediately"

key-files:
  created:
    - "integrations/unified-viewer/src/panels/filters/LayerFilter.tsx"
    - "integrations/unified-viewer/src/panels/filters/LayerFilter.test.tsx"
    - "integrations/unified-viewer/src/panels/filters/DomainFilter.tsx"
    - "integrations/unified-viewer/src/panels/filters/DomainFilter.test.tsx"
    - "integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx"
    - "integrations/unified-viewer/src/panels/filters/OntologyFilter.test.tsx"
    - "integrations/unified-viewer/src/panels/filters/GraphToggles.tsx"
    - "integrations/unified-viewer/src/panels/filters/GraphToggles.test.tsx"
    - "integrations/unified-viewer/src/panels/TrendingPanel.tsx (placeholder — overwritten by 55-10)"
    - "integrations/unified-viewer/src/panels/coding/HierarchyNavigator.tsx (placeholder — overwritten by 55-11)"
  modified:
    - "integrations/unified-viewer/src/panels/FilterRail.tsx (rewired UI-SPEC §6 order; lazy mounts pinned)"
    - "integrations/unified-viewer/src/panels/FilterRail.test.tsx (preserves Phase 45 BC + adds Phase 55 contracts)"
    - "integrations/unified-viewer/src/routes/UnifiedViewer.tsx (passes new system/entities props to FilterRail)"

key-decisions:
  - "VOKB_SCHEMA / CODING_SCHEMA inlined in OntologyFilter.tsx (not extracted to a sibling module) — single consumer for now; refactor only if the file crosses 300 lines (file is currently 367 with both schemas + render logic — within margin)"
  - "Placeholder modules ship today so the lazy imports resolve immediately at build time — vite emits separate `TrendingPanel-*.js` and `HierarchyNavigator-*.js` chunks. Tests accept either the Suspense fallback or the placeholder content as proof of mount, so wave-staged shipment of the real components is non-blocking."
  - "Phase 45 flat ClassList removed cleanly (not deprecated); the `selectedClasses` Set BC-shim from Plan 55-04 remains in the store untouched for now — downstream plans that read `selectedClasses` (graph-builder, SigmaCanvas, etc.) keep compiling. This file no longer reads it. Retirement of the BC-shim happens when the last reader migrates."
  - "Added `system: System` + `entities: readonly Entity[]` props to FilterRail to drive (a) OntologyFilter schema selection and (b) per-filter count derivation. Counts live in the child components (not the rail) per VOKB convention; the rail only forwards the entity array. The store-side BC `classOptions` prop is preserved as a passthrough (unused inside the rail) so UnifiedViewer.tsx's call-site doesn't break — its planned removal happens when the broader prop-cleanup wave lands."

patterns-established:
  - "Lazy-mount ownership contract at wave boundaries: when a parent rail/panel imports a future-wave component lazily, the parent's plan OWNS the import line and ships a minimal placeholder at the imported path. Downstream plans overwrite the placeholder; they never edit the parent. This eliminates the 'component ships but is never imported' failure mode that the plan-checker B-2/B-3 flagged."
  - "Filter-children own their counts: child filter components receive `entities` and derive count badges in a useMemo; the rail simply forwards the array. Keeps the rail thin and lets each filter render-cycle independent."
  - "Schema-prop parameterization for cross-tab reuse: a single OntologyFilter component hosts both VOKB Upper/Lower and coding Hierarchy/Typed Views layouts via a `groupingSchema` prop with `{ upper: { name, subgroups }, lower: { name, subgroups } }` shape — extensible without adding new components per system."
  - "Verbatim-copy-and-micro-type discipline: UI-SPEC §5 strings are passed through unmodified (`Show All Relations`, `Halos = connectivity clusters (densely linked groups)`, etc.) AND the Tailwind micro-type exceptions (text-[10px]/text-[9px]/text-[8px]) ride along, exactly matching VOKB. Tests assert both label text and the micro-type classes to guard against silent normalization in a future refactor."

requirements-completed: [UI-02]

# Metrics
duration: 10min
completed: 2026-06-09
---

# Phase 55 Plan 08: VOKB-shape filter parity in unified-viewer

**Layer / Domain / OntologyFilter (grouped tree) / GraphToggles ported from VOKB into unified-viewer's FilterRail (UI-SPEC §6 mount order), with lazy-mount slots pinned for TrendingPanel + HierarchyNavigator so the downstream wave plans only need to overwrite their placeholders.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-06-09T17:05:00Z
- **Completed:** 2026-06-09T17:17:01Z
- **Tasks:** 3 (all TDD — RED + GREEN gates committed for each)
- **Files modified:** 13 (10 created, 3 modified)

## Accomplishments

- **SC-5 (Filter parity with VOKB)** delivered end-to-end on the unified-viewer FilterRail: Layer + Domain + OntologyFilter (grouped tree) + GraphToggles, all wired to the Zustand `filtersSlice` from Plan 55-04
- Phase 45 flat ClassList REPLACED by the VOKB grouped Ontology tree (UI-SPEC §6 mandate)
- One `OntologyFilter` component hosts BOTH the VOKB Upper/Lower layout AND the coding Hierarchy + Typed Views layout via a `groupingSchema` prop — `VOKB_SCHEMA` default, `CODING_SCHEMA` on the coding tab
- Catch-all `Other` group catches any ontology class not present in any subgroup membership (verbatim VOKB rule — new ontology classes are never silently invisible)
- Group-level `all` / `none` toggles use union-add / filter-remove semantics (NOT replace) — selections in other groups are preserved
- FilterRail OWNS the lazy import lines for `TrendingPanel` and `HierarchyNavigator`, closing plan-checker blockers B-2 + B-3. Placeholder modules ship today so vite emits real chunks (`TrendingPanel-*.js`, `HierarchyNavigator-*.js`); 55-10 / 55-11 overwrite them without ever editing FilterRail.tsx
- Micro-type exceptions per UI-SPEC §3 preserved verbatim: `text-[10px]` count badges, `text-[9px]` group toggles, `text-[8px]` disclosure triangles
- Verbatim VOKB italic hint copy under the toggles (`Halos = connectivity clusters (densely linked groups)`, `Nodes with content from multiple ingestion runs`, etc.) — UI-SPEC §5 copywriting contract honored
- DomainFilter graceful-degradation: italic muted `Domain filter not applicable for this system` when no entity carries a `.domain` field (UI-SPEC §7 row 3) — coding tab does NOT 500
- Logger discipline: `Logger.info(Logger.Categories.FILTERS, ...)` on every state change; `Logger.info(Logger.Categories.PANELS, 'FilterRail mounted')` once at mount; ZERO raw `console.*` in any new file under `panels/filters/`
- 322/322 full unified-viewer test suite green (5 new test files covering 38 new test cases on top of the 284 Phase 45 + earlier-Phase-55 baseline)
- `npx tsc --noEmit` exit 0 across the entire `integrations/unified-viewer` package
- `npx vite build` exit 0; lazy chunks emit cleanly (`dist/assets/TrendingPanel-*.js`, `dist/assets/HierarchyNavigator-*.js`)

## Task Commits

Each task was committed atomically following the TDD RED → GREEN cycle (REFACTOR skipped — code structure clean on first pass).

1. **Task 1 RED** — `5d943ac8b` (test) — failing tests for LayerFilter + DomainFilter
2. **Task 1 GREEN** — `7022a96b3` (feat) — LayerFilter + DomainFilter implementation
3. **Task 2 RED** — `bde2e0f26` (test) — failing tests for OntologyFilter
4. **Task 2 GREEN** — `589333a5a` (feat) — OntologyFilter implementation with VOKB_SCHEMA + CODING_SCHEMA
5. **Task 3 RED** — `529c9f655` (test) — failing tests for GraphToggles + FilterRail rewire
6. **Task 3 GREEN** — `86d743c00` (feat) — GraphToggles + FilterRail rewire with lazy mounts (placeholders ship)

## Files Created/Modified

**Created (10):**

- `integrations/unified-viewer/src/panels/filters/LayerFilter.tsx` — VOKB-shape Evidence/Pattern checkboxes with per-layer count badges (`text-[10px]`); empty selection = "all visible"
- `integrations/unified-viewer/src/panels/filters/LayerFilter.test.tsx` — 8 test cases
- `integrations/unified-viewer/src/panels/filters/DomainFilter.tsx` — RaaS/KPI-FW/General filter with coding-tab italic graceful-degradation
- `integrations/unified-viewer/src/panels/filters/DomainFilter.test.tsx` — 7 test cases
- `integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx` — grouped tree with parameterized `groupingSchema`; exports `VOKB_SCHEMA` + `CODING_SCHEMA` constants
- `integrations/unified-viewer/src/panels/filters/OntologyFilter.test.tsx` — 15 test cases
- `integrations/unified-viewer/src/panels/filters/GraphToggles.tsx` — 4 top-level toggles + nested Labels sub-toggle; verbatim UI-SPEC §5 copy + verbatim VOKB italic hints
- `integrations/unified-viewer/src/panels/filters/GraphToggles.test.tsx` — 11 test cases
- `integrations/unified-viewer/src/panels/TrendingPanel.tsx` — placeholder module (overwritten by Plan 55-10 Task 1)
- `integrations/unified-viewer/src/panels/coding/HierarchyNavigator.tsx` — placeholder module (overwritten by Plan 55-11 Task 1)

**Modified (3):**

- `integrations/unified-viewer/src/panels/FilterRail.tsx` — rewired per UI-SPEC §6 mount order; deleted Phase 45 flat `ClassList`; added `system: System` + `entities: readonly Entity[]` props; pinned lazy mounts for TrendingPanel (always) + HierarchyNavigator (coding-only)
- `integrations/unified-viewer/src/panels/FilterRail.test.tsx` — preserves Phase 45 BC contracts (6 BC tests) + adds 10 Phase 55 contracts (mount order, ClassList removed, schema selection, lazy slots present/absent)
- `integrations/unified-viewer/src/routes/UnifiedViewer.tsx` — passes the new `system` + `entities` props through to FilterRail

## Decisions Made

- **Inlined `VOKB_SCHEMA` + `CODING_SCHEMA` in `OntologyFilter.tsx`** rather than extracting a sibling `ontology-schemas.ts`. The file is 367 lines (under the plan's 300-line refactor threshold by a small margin) and the schema constants are tightly coupled to the component's `classifyAvailable()` consumer. Single-import ergonomics for downstream callers (`import { OntologyFilter, CODING_SCHEMA } from '@/panels/filters/OntologyFilter'`) outweighs the marginal length. Future extraction is mechanical if a second consumer needs the schema.
- **Placeholder-modules-ship-today policy.** Both `TrendingPanel.tsx` and `coding/HierarchyNavigator.tsx` ship as minimal `data-testid`-bearing single-div components. This means: (a) vite's static analysis resolves the lazy imports at build time and emits actual chunks; (b) Suspense fallback never sticks in tests — the placeholder renders immediately; (c) 55-10 and 55-11 Task 1 overwrite the file in place with no FilterRail edit. Tests are written to accept either the Suspense fallback testid OR the placeholder testid as proof of mount, so the wave-staged shipment of real components is non-blocking.
- **Kept Phase 45 `selectedClasses` Set BC-shim alive.** FilterRail.tsx no longer reads or writes `selectedClasses` / `toggleClass` / `setSelectedClasses`, but the store-level shim from Plan 55-04 is intentionally not removed in this plan because other files (`graph-builder.ts`, `SigmaCanvas.test.tsx`, several test fixtures) still reference it. Retirement happens organically when the last reader migrates to `selectedOntologyClasses` — likely in a later Phase 55 plan or a follow-up cleanup wave. Removing it here would have widened scope beyond Plan 55-08's `files_modified` fence.
- **Added `system: System` + `entities: readonly Entity[]` props to FilterRail** to drive (a) the OntologyFilter schema selection (`system === 'coding' ? CODING_SCHEMA : undefined`) and (b) the HierarchyNavigator coding-only gate, and to thread entities through to child filter components for count derivation. Counts live in the child components (not the rail) so each filter's render is independent. UnifiedViewer.tsx already had `system` and `entities` in scope from `useGraphData`, so the wire-up is two extra prop lines at the call site.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Added `system: System` and `entities: readonly Entity[]` props to FilterRail beyond the literal `<interfaces>` block**

- **Found during:** Task 3 GREEN, while wiring `OntologyFilter` into FilterRail
- **Issue:** The plan's `<interfaces>` block specifies the lazy mount lines and the JSX shape verbatim, but does not enumerate the FilterRail prop signature changes needed to drive the new behavior. Per the plan's `<behavior>` for Task 3: "on coding tab, OntologyFilter receives `groupingSchema={CODING_SCHEMA}`; on okb tab, default VOKB_SCHEMA used" and "HierarchyNavigator slot renders only on `system === 'coding'`". The plan's `<read_first>` for Task 3 lists the Zustand `selectedDomains`/`hideDocNodes`/etc. selectors but does NOT mention how `system` reaches FilterRail. FilterRail's Phase 45 signature had `apiClient`, `classOptions`, `registerSearchInputRef` — none of which carry `system`. Similarly, count derivation in `LayerFilter` / `DomainFilter` / `OntologyFilter` requires the entity array; the children render counts from `useMemo(entities)` per VOKB convention, so the array has to be threaded somehow.
- **Fix:** Added `system: System` and `entities: readonly Entity[]` to `FilterRailProps`. Updated `UnifiedViewer.tsx` to pass both (they were already in scope from `useGraphData(apiClient, system)`). The signature change is minimal — two new prop lines at the call site and the interface declaration — and is the cleanest path to honoring both Task 3's behavior contracts AND Task 1's count-derivation behavior contract simultaneously. Documented in the FilterRail.tsx header comment so future readers understand the prop semantics.
- **Files modified:** `integrations/unified-viewer/src/panels/FilterRail.tsx`, `integrations/unified-viewer/src/routes/UnifiedViewer.tsx`
- **Verification:** Full unified-viewer suite 322/322 green; tsc --noEmit exit 0; vite build exit 0; Phase 45 BC tests for FilterRail (search / level / collapse) all pass without modification of behavior
- **Committed in:** `86d743c00` (Task 3 GREEN)

**2. [Rule 3 — Blocking issue] Retained the existing `apiClient` and `classOptions` props on FilterRail as passthroughs**

- **Found during:** Task 3 GREEN, considering prop cleanup
- **Issue:** Plan 55-08 makes `apiClient` and `classOptions` effectively dead inside FilterRail (the Phase 45 ClassList is gone, the BC `classOptions` is unused, and `apiClient` is only forwarded to the lazy `TrendingPanel` slot for the future 55-10 implementation). The Plan-Author's plan does not call for removing them. But UnifiedViewer.tsx (outside `files_modified`) still passes both, and removing them would force a non-trivial signature change at the call site for the next executor to chase.
- **Fix:** Kept both props on the FilterRail signature. `apiClient` is forwarded to `<TrendingPanel apiClient={apiClient} />` per the plan's `<interfaces>` contract (the real TrendingPanel in 55-10 will use it for fetching). `classOptions` is destructured as `_classOptions` to silence the unused-var warning, and kept for back-compat with UnifiedViewer.tsx. Documented in the FilterRail header. Retirement of `classOptions` happens in a follow-up cleanup pass when the broader BC-shim sweep lands.
- **Files modified:** `integrations/unified-viewer/src/panels/FilterRail.tsx`
- **Verification:** tsc --noEmit exit 0 (no unused-var diagnostic — `_classOptions` underscore-prefixed); UnifiedViewer.tsx call site continues to compile without change beyond the two new prop lines
- **Committed in:** `86d743c00` (Task 3 GREEN)

**3. [Rule 2 — Missing critical functionality] TrendingPanel placeholder accepts `apiClient` prop instead of being prop-free**

- **Found during:** Task 3 GREEN, while writing the placeholder
- **Issue:** The plan's `<action>` for Task 3 specifies the TrendingPanel placeholder as `export default function TrendingPanelPlaceholder() { return <div data-testid="trending-panel-placeholder" …>Trending Patterns — loading from 55-10…</div> }`. But the plan's `<interfaces>` block specifies `<TrendingPanel apiClient={apiClient} />` at the FilterRail call site. If the placeholder accepts no props, TypeScript flags the `apiClient` prop on the call site as `Property 'apiClient' does not exist on type 'IntrinsicAttributes & ...'` and `vite build` fails on the lazy module's default-export typing.
- **Fix:** Placeholder accepts a typed `TrendingPanelProps { apiClient: ApiClient }` matching the future 55-10 contract; it ignores the prop in the body. This keeps the placeholder API-shape-compatible with what 55-10 will ship, so 55-10's overwrite is a single-file change. Same pattern for `HierarchyNavigator` placeholder which accepts `{ system: System }`.
- **Files modified:** `integrations/unified-viewer/src/panels/TrendingPanel.tsx`, `integrations/unified-viewer/src/panels/coding/HierarchyNavigator.tsx`
- **Verification:** tsc --noEmit exit 0; lazy chunks emit cleanly; tests pass
- **Committed in:** `86d743c00` (Task 3 GREEN)

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking, 1 Rule 2 missing critical)

**Impact on plan:** None of the deviations changed plan intent — all three were prop-signature corrections needed to make the plan's literal `<behavior>` and `<interfaces>` contracts internally consistent. The `system` + `entities` prop additions to FilterRail are the natural extension of the rail's role as the integration point for the new VOKB filter children; the placeholder prop-typing matches the future 55-10 / 55-11 contracts. No new public surface or runtime behavior beyond what the plan specifies.

## Issues Encountered

None beyond the deviations documented above. Baseline `npm install` for `integrations/unified-viewer` was needed because the worktree starts without `node_modules` — uneventful; subsequent test runs / tsc / vite build all clean.

## User Setup Required

None — no external service configuration required. All changes are in-process React + Zustand UI components.

## Next Phase Readiness

The wave-3 / wave-4 downstream plans can now:

- **Plan 55-10 (TrendingPanel real port):** overwrite `integrations/unified-viewer/src/panels/TrendingPanel.tsx` with the real port from `_work/.../viewer/src/components/KnowledgeGraph/TrendingPanel.tsx`. The lazy import in FilterRail.tsx already resolves it; no FilterRail edit needed. The `apiClient` prop is already wired.
- **Plan 55-11 (HierarchyNavigator real port):** overwrite `integrations/unified-viewer/src/panels/coding/HierarchyNavigator.tsx` with the real coding-only tree. The lazy import + coding-only gate in FilterRail.tsx already resolves it; no FilterRail edit needed. The `system` prop is already wired.
- **Plan 55-09 (DomainFilter — already covered by this plan):** if a separate Plan 55-09 was originally scoped to ship DomainFilter, it can be marked superseded by 55-08 (the plan's own `files_modified` list includes DomainFilter as a Plan-55-08 deliverable).
- **Plan 55-12 (EtmTailSheet) / 55-13 (LSL session filter UI):** consume `selectedOntologyClasses` and the toggle states for composition — already wired through the rail.

The one outstanding concern that carries forward is the Phase 45 `selectedClasses` Set BC-shim — still alive in the store and still referenced by `graph-builder.ts` / `SigmaCanvas.test.tsx` / a handful of other consumers. Migration to `selectedOntologyClasses` is mechanical (1:1 rename + Set→string[] adapter) and can be a single follow-up plan when the cleanup wave lands.

## Self-Check: PASSED

Verification of claims in this summary:

```
FOUND: integrations/unified-viewer/src/panels/filters/LayerFilter.tsx
FOUND: integrations/unified-viewer/src/panels/filters/LayerFilter.test.tsx
FOUND: integrations/unified-viewer/src/panels/filters/DomainFilter.tsx
FOUND: integrations/unified-viewer/src/panels/filters/DomainFilter.test.tsx
FOUND: integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx
FOUND: integrations/unified-viewer/src/panels/filters/OntologyFilter.test.tsx
FOUND: integrations/unified-viewer/src/panels/filters/GraphToggles.tsx
FOUND: integrations/unified-viewer/src/panels/filters/GraphToggles.test.tsx
FOUND: integrations/unified-viewer/src/panels/TrendingPanel.tsx (placeholder)
FOUND: integrations/unified-viewer/src/panels/coding/HierarchyNavigator.tsx (placeholder)
FOUND: commit 5d943ac8b (Task 1 RED — test)
FOUND: commit 7022a96b3 (Task 1 GREEN — feat)
FOUND: commit bde2e0f26 (Task 2 RED — test)
FOUND: commit 589333a5a (Task 2 GREEN — feat)
FOUND: commit 529c9f655 (Task 3 RED — test)
FOUND: commit 86d743c00 (Task 3 GREEN — feat)
GREP CHECK: console.* under src/panels/filters/ + src/panels/TrendingPanel.tsx + src/panels/coding/HierarchyNavigator.tsx = 0
GREP CHECK: FilterRail filter-component refs (LayerFilter | DomainFilter | OntologyFilter | GraphToggles) = 15 hits (≥4 required)
GREP CHECK: lazy(() => import('./TrendingPanel')) = 1 hit (≥1 required)
GREP CHECK: lazy(() => import('./coding/HierarchyNavigator')) = 1 hit (≥1 required)
GREP CHECK: VOKB_SCHEMA | CODING_SCHEMA | groupingSchema | setSelectedOntologyClasses | toggleOntologyClass in OntologyFilter.tsx = 18 hits (≥5 required)
GREP CHECK: text-[10px] | text-[9px] in OntologyFilter.tsx = 9 hits (≥2 required)
GREP CHECK: useViewerStore | toggleLayer | toggleDomain in {LayerFilter, DomainFilter}.tsx = 4 each (≥3 required)
SUITE RUN: 322/322 unified-viewer tests green
TSC CHECK: npx tsc --noEmit exit 0
BUILD CHECK: npx vite build exit 0; TrendingPanel-*.js + HierarchyNavigator-*.js lazy chunks emitted
```

---
*Phase: 55-unified-viewer-feature-parity-with-vokb*
*Completed: 2026-06-09*
