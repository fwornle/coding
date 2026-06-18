---
title: OntologyFilter L1→L2 runtime routing gap (Phase 60 follow-up)
created: 2026-06-17
priority: medium
resolves_phase: null
context:
  - .planning/phases/60-unified-viewer-rendering-ux-integrity/60-07-PLAN.md
  - .planning/phases/60-unified-viewer-rendering-ux-integrity/60-07-SUMMARY.md
  - .planning/phases/60-unified-viewer-rendering-ux-integrity/60-VERIFICATION.md
---

# OntologyFilter L1→L2 hierarchy — two runtime routing gaps

Phase 60-07 shipped the data + handler correctness for the OntologyFilter L1→L2 hierarchy:

- `.data/ontologies/coding-ontology.json` Component/SubComponent/Detail carry top-level `level: 1`
- `.data/ontologies/coding.lower.json` 10 Phase-57 L2 classes carry `level: 2` + explicit `parent`
- `lib/km-core/src/api/handlers/ontology.ts` synthesizes L0 anchors (System, Project) from HIERARCHY_ROOTS and derives `parent` from `extends` when absent
- All 16 new vitest tests pass + 401/401 full km-core suite green
- Live API at `http://localhost:12436/api/v1/ontology/classes?withDisplay=true` returns the L0 entries: `["System", "Project"]` confirmed via curl

But two runtime sourcing gaps block the viewer from rendering the L1→L2 hierarchy.

## Gap A — obs-api GraphKMStore ontologyDir not pointing at host data

`scripts/observations-api-server.mjs:1336` constructs `GraphKMStore` with `ontologyDir: defaultOntologyDir()`, which resolves to the **bundled** `lib/km-core/ontology/`:

```
lib/km-core/ontology/upper.json          → 1 class (LearningArtifact)
lib/km-core/ontology/learning-artifacts.json → 3 classes (Observation, Digest, Insight)
```

The host `.data/ontologies/` (where coding-ontology.json + coding.lower.json + the Phase-57 lower files live) is never reached. Net effect: the handler synthesizes L0 correctly, but L1 (Component/SubComponent/Detail) and L2 (LiveLoggingSystem etc.) classes don't exist in the registry → enriched response carries no `level: 1` / `level: 2` entries for the coding system.

**Why this is non-trivial:** swapping the one-liner is tempting but breaks obs-api writer-side validation. The bundled `learning-artifacts.json` is the source of truth for the `LearningArtifact`/`Observation`/`Digest`/`Insight` classes the writer uses to classify observation/digest/insight writes. The host `.data/ontologies/upper.json` has 14 root classes (File, Service, Feature, Project, Contract, ...) but does NOT carry `LearningArtifact`.

**Resolution options** (need design decision):

1. **Copy bundled `learning-artifacts.json` to host** — then swap line 1336 to `.data/ontologies/`. Single follow-up commit. Risk: makes the host data directory the sole source of truth for classes the writer depends on, requiring careful sync if anyone updates the bundled file.

2. **Multi-path ontologyDir support in GraphKMStore** — patch km-core to accept an array of dirs and merge. Cleanest long-term; biggest km-core lift.

3. **Compose-then-resolve** — leave bundled dir as obs-api's primary, but ALSO load `.data/ontologies/` as an overlay so reads see both. Requires a registry feature for composable sources.

Option 1 is the recommended fast path if a follow-up phase is desired; option 2 is the structurally correct one.

## Gap B — Vite dev server doesn't proxy `/api/v1/*` to obs-api

From inside the dev viewer at `localhost:5173`:

```bash
gsd-browser eval 'fetch("/api/v1/ontology/classes?withDisplay=true").then(r => r.headers.get("content-type"))'
# → "text/html"
```

The viewer's apiClient call falls through to Vite's SPA index fallback. The unified-viewer's `vite.config.ts` doesn't have a proxy entry routing `/api/v1` → `http://localhost:12436`.

**Resolution:** add a Vite proxy entry in `integrations/unified-viewer/vite.config.ts`:

```ts
server: {
  proxy: {
    '/api/v1': {
      target: 'http://localhost:12436',
      changeOrigin: true,
    },
  },
},
```

Trivial fix. May already work in production (when the unified-viewer dist is served from the dashboard / coding-services bundle on a path that DOES reach the API). Confirm prod path before deciding whether this is dev-only.

## Status under Phase 60-07

- 60-07 closed as partial-PASS per operator decision
- L0 anchors (System, Project) lit up in the API at `/api/v1/ontology/classes?withDisplay=true` via the handler-side HIERARCHY_ROOTS synthesis
- L1 group headers + L2 children remain absent in both API response and viewer rendering pending Gap A resolution
- Viewer L0 render also pending Gap B (Vite dev proxy)
- 60-VERIFICATION.md frontmatter: `status: gaps_found`, `sc_passed: 4`, `sc_partial: 1` (SC#5 partial with materially different cause now), `gaps_open: 2`

## Recommended next phase scope

Phase 60.1 (or next-milestone phase if Phase 60 is closing for v7.2 ship): "obs-api ontology source consolidation + Vite proxy wire-up — bring L1/L2 hierarchy through to /viewer/coding OntologyFilter". Scoped to the two gaps above; uses the obs-api writer-smoke pattern from Phase 44 / Phase 51 to confirm Observation/Digest/Insight writes still classify correctly post-swap.

## Additional UX-integrity gaps discovered during Phase 60 visual smoke (2026-06-18)

These were surfaced operator-side after the 60-VERIFICATION.md was written. All same family — UI elements describing data the rendered graph doesn't actually reflect.

### Gap C — Legend shapes vs. D3 renderer disagreement (SC#2 follow-up)

`LegendPanel.tsx` (post-60-02) renders the canonical shape from `SHAPE_PALETTE` for each ontology class: `Project`/`System` → hexagon, `Component`/`SubComponent` → square, `Detail` → circle, `Insight`/`Digest` → diamond.

But `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx` (mounted for `/viewer/coding` per `UnifiedViewer.tsx:372`) only ever does `node.append('circle')` (lines 836, 844-845). No `path`/`polygon` shape variation — every node is a circle regardless of `ontologyClass`. `SigmaCanvas` (mounted for `/viewer/okb`) may render shapes correctly; coding tab does not.

The Legend declares shapes the D3 renderer can't draw — directly contradicting Phase 60 SC#2's "stop lying about what's on screen" mandate.

**Fix paths:**
- (preferred) Make `D3GraphCanvas` read `SHAPE_PALETTE[entity.ontologyClass]` and append a matching SVG `<path>` for hexagon/square/diamond instead of `<circle>` for every node. Real shapes on canvas; Legend stays accurate.
- (fallback) Hardcode `(circle)` in the LegendPanel DOMAINS section when the active renderer is `D3GraphCanvas`, hide the shape glyph when it can't be drawn.

### Gap D — Selection sidebar count vs. visible halo count (SC#3 follow-up)

When a timeline tick is selected (e.g., `c197ef · 2026-06-15 21:00 → 22:00 · 27 obs · 27 entities`), the Entity sidebar lists all 27 items but the canvas only halos ~10 of them. The remaining 17 are `Observation` entityType nodes that `visibility-predicate.ts:46-47` filters out by default (Plan 60-03's hard-exclusion shield, gated on the `showDebugEntityTypes` toggle).

By-design behavior, but the UI gives zero signal that filtering is why counts don't match. Operator sees "27 selected" but can only act on the 10 visible halos.

**Fix path:** change the sidebar's `27 items` header to a breakdown, e.g.

```
Selected
27 items · 10 visible · 17 hidden by "Show debug entity types"
```

Toggling the debug switch ON should bring the canvas count up to 27 halos and the sidebar header to `27 items · 27 visible · 0 hidden`. Implementation: SidePanel reads `selectedNodeIds` + the same `useVisibleEntityIds` predicate the canvas uses, computes intersection, renders the breakdown.

### Gap E — Bidirectional hover (sidebar ↔ graph)

Currently selection is bidirectional (timeline tick → sidebar list + graph halo set) but hover is not. Operator hovering a graph node gets no signal in the sidebar; hovering a sidebar row gives no signal on the canvas.

**Fix path:**
- Add `hoveredNodeId: string | null` to `viewer-store.ts` (Phase 56.1 multi-selection store contract preserved — write through a dedicated `setHoveredNodeId` action).
- `D3GraphCanvas`: on node `mouseenter`/`mouseleave`, call `setHoveredNodeId`. CSS keyframe pulse on `.node-circle[data-node-id="${hoveredNodeId}"]` when the store value matches.
- `SidePanel`: on row `mouseenter`/`mouseleave`, call `setHoveredNodeId`. Row gets a highlight class when its ID matches the store value.
- Visual indicator on a sidebar row whose `hoveredNodeId` is in the filtered-out set ("hidden — toggle Show debug entity types to reveal") so users learn why their hover signal isn't reciprocated on canvas.

Gaps A–E together make a coherent Phase 60.1 scope. All five are about Phase 60's "stop lying / stop hiding what's on screen" mandate, just at different surfaces (filter rail / canvas shapes / selection sidebar / hover affordance / API surface).
