---
phase: 60-unified-viewer-rendering-ux-integrity
plan: 02
subsystem: unified-viewer
tags: [vkb, legend, prop-driven, vkbui-02, no-okb-bleed]
requires:
  - Plan 60-01 (deriveLayer helper at graph/layer.ts)
provides:
  - "LegendPanel: prop-driven Domains/Layers/Source/Relationships from entities+relations (D-05..D-08)"
  - "color-fallback.ts: SHAPE_PALETTE exported so consumers can detect registered classes without literal re-listing"
affects:
  - integrations/unified-viewer/src/panels/LegendPanel.tsx
  - integrations/unified-viewer/src/panels/LegendPanel.test.tsx
  - integrations/unified-viewer/src/routes/UnifiedViewer.tsx
  - integrations/unified-viewer/src/graph/color-fallback.ts
tech-stack:
  added: []
  patterns:
    - "Prop-driven panel pattern (canvas + side-panel agree on the same post-filter set)"
    - "Memoized derivation (useMemo per section keyed on entities/relations reference)"
    - "Defensive fallback (unknown class → gray circle + tooltip; unknown relation type → gray line)"
key-files:
  modified:
    - integrations/unified-viewer/src/panels/LegendPanel.tsx
    - integrations/unified-viewer/src/panels/LegendPanel.test.tsx
    - integrations/unified-viewer/src/routes/UnifiedViewer.tsx
    - integrations/unified-viewer/src/graph/color-fallback.ts
decisions:
  - "LegendPanel consumes graph/types.{Entity,Relation} (canvas-pipeline shape), not ApiClient.{Entity,Relation} — useGraphData normalizes wire shape at the boundary, so the panel that reads the same set as the canvas must use the post-normalization flavor"
  - "Local Section + ShapeIcon kept private in LegendPanel.tsx (D-22 — no external consumer found in grep)"
  - "Source row label is the plain literal (entity.metadata.source value verbatim); no stroke/dasharray encoding (that was OKB-VOKB visual encoding and doesn't translate to the dynamic SOURCE section)"
  - "Detect registered class via SHAPE_PALETTE export, not a duplicated local Set — avoids re-introducing literal OKB tokens like 'RuntimeDiagnostics' that the rewrite's acceptance grep forbids"
metrics:
  duration: ~7 min
  tasks: 2
  files_modified: 4
  tests_added: 12 (replaces 4 static tests)
  completed: 2026-06-17
---

# Phase 60 Plan 02: Legend Panel Dynamic Derivation Summary

VKBUI-02 closed: `LegendPanel.tsx` is now fully prop-driven. The DOMAINS,
LAYERS, SOURCE, and RELATIONSHIPS sections derive from the currently-rendered
`entities` + `relations` that the canvas paints. The four static seed
arrays (`SHAPE_SWATCHES`, `LAYER_BADGE_CLASS`-derived legend rows,
`SOURCE_SAMPLES`, `RELATIONSHIP_SAMPLES`) that bled OKB-only labels like
`RuntimeDiagnostics` / `Official doc` / `Automated RCA` / `CORRELATED_WITH` /
`RELATES_TO` into the VKB tab regardless of what was on screen are gone.

## Tasks

### Task 1: Rewrite LegendPanel.tsx to derive all sections from props (TDD)

End-to-end rewrite of `integrations/unified-viewer/src/panels/LegendPanel.tsx`:

- **Props (D-05):** `LegendPanelProps = { entities: readonly Entity[]; relations: readonly Relation[]; ontologyRegistry?: readonly OntologyRegistryClass[]; className?: string }`. The default export `LegendPanel({...})` reads these props — no module-level seed arrays.
- **DOMAINS (D-06):** Distinct `entity.ontologyClass` values, preserved in entity-insertion order. Each row carries the SHAPE_PALETTE swatch (via `shapeFallback`) and the hierarchy `classColor` fill. Unknown classes (not in SHAPE_PALETTE) fall back to a gray circle plus a `title="class without registered shape"` tooltip per D-22.
- **LAYERS (D-06):** Distinct `deriveLayer(entity, ontologyRegistry)` values across entities, preserved in insertion order. Each row is a Tailwind chip styled with `LAYER_BADGE_CLASS[layer]` verbatim from the palette. Empty / single-layer sets render only the layers actually present (e.g., a pure-Component set shows only the evidence chip, not the pattern chip).
- **SOURCE (D-06):** Distinct truthy `entity.metadata?.source` values; the row renders the value as a plain literal label (`manual`/`auto`/`online` etc.). No stroke/dasharray encoding — that was OKB-VOKB-specific and doesn't translate. Section hidden entirely when no entity carries `metadata.source` (D-07).
- **RELATIONSHIPS (D-06):** Distinct truthy `relation.type` values; each row renders the SVG line with `EDGE_STYLES[type]?.color ?? '#d1d5db'` defensive fallback. Unknown types still render with a gray line (Test 8 covers this).
- **D-07 (empty sections hidden):** Every `<Section>` is wrapped in `{arr.length > 0 && ...}`. With `entities=[] relations=[]`, only the `<summary>Legend</summary>` renders.
- **D-08 (section order):** Render order is hardcoded DOMAINS → LAYERS → SOURCE → RELATIONSHIPS — preserved regardless of which sections happen to be populated.

Replaced the 4-test legacy suite with 12 prop-driven tests covering all 11 plan behaviors plus the pre-existing console-discipline guard:

| # | Coverage |
|---|----------|
| 1 | DOMAINS — 3 distinct classes render; no RuntimeDiagnostics bleed |
| 2 | DOMAINS — unknown class → gray-circle fallback row with explanatory tooltip |
| 3 | LAYERS — both evidence + pattern when both derivable |
| 4 | LAYERS — pattern row hidden when no pattern-derived entities |
| 5 | SOURCE — only distinct metadata.source values; no Official doc / RCA bleed |
| 6 | SOURCE — section hidden entirely when no source values |
| 7 | RELATIONSHIPS — only distinct relation.type values; no CORRELATED_WITH bleed |
| 8 | RELATIONSHIPS — unknown type → gray fallback line `#d1d5db` |
| 9 | empty entities + empty relations → no section components rendered |
| 10 | section order DOMAINS → LAYERS → SOURCE → RELATIONSHIPS |
| 11 | negative-assertion suite — Component-only entity, zero static OKB labels |
| logger | ZERO raw `console.*` in LegendPanel.tsx (carried over) |

**Commits:**
- `e410a8981` — test(60-02): RED — LegendPanel must derive all sections from props (D-05..D-08)
- `bf373d25e` — feat(60-02): GREEN — LegendPanel derives all sections from entities + relations (G2)

### Task 2: Wire LegendPanel props at routes/UnifiedViewer.tsx mount site

Single-line edit at `integrations/unified-viewer/src/routes/UnifiedViewer.tsx:392`:

```diff
- bottomSlot={<LegendPanel className="pt-2" />}
+ bottomSlot={<LegendPanel className="pt-2" entities={entities} relations={relations} />}
```

Both `entities` and `relations` were already in scope from `const { entities, relations, isLoading, error } = useGraphData(apiClient, system)` at line 120, so no FilterRail prop widening was required. `FilterRail` was not modified — the rail's `bottomSlot?: ReactNode` is the correct handoff and grep confirms zero `<LegendPanel` JSX inside `FilterRail.tsx`.

Type alignment side-step: `useGraphData` returns the `graph/types.{Entity,Relation}` flavor, not the `ApiClient.{Entity,Relation}` flavor that the plan's `<interfaces>` block quoted. TSC rejected the assignment because:
- `ApiClient.Relation.type?: string` (optional) vs `graph/types.Relation.type: string` (required)
- `ApiClient.Entity.level?: number` (any number) vs `graph/types.Entity.level?: 0|1|2|3` (literal union)
- `ApiClient.{Entity,Relation}` carries a wire-protocol `[k: string]: unknown` index signature; `graph/types` versions don't.

Switched LegendPanel + LegendPanel.test.tsx imports from `@/api/ApiClient` to `@/graph/types`. Both type names (`Entity`, `Relation`) stay — acceptance greps still pass — and the panel now consumes the same flavor the canvas does. Documented in the decisions block above.

**Commits:**
- `0b01b44a5` — feat(60-02): wire LegendPanel props at UnifiedViewer mount site

## Verification

- `cd integrations/unified-viewer && npx vitest run src/panels/LegendPanel.test.tsx` → **12/12 pass**
- `cd integrations/unified-viewer && npx tsc --noEmit` → **exit 0** (no type errors)
- `cd integrations/unified-viewer && npm run build` → **exit 0** (production vite bundle clean)

### Task 1 acceptance criteria

| Gate | Expected | Actual |
|------|----------|--------|
| `grep -c "SHAPE_SWATCHES" LegendPanel.tsx` | 0 | 0 ✓ |
| `grep -c "SOURCE_SAMPLES" LegendPanel.tsx` | 0 | 0 ✓ |
| `grep -c "RELATIONSHIP_SAMPLES" LegendPanel.tsx` | 0 | 0 ✓ |
| `grep -c "RuntimeDiagnostics" LegendPanel.tsx` | 0 | 0 ✓ |
| `grep -cE "Automated RCA\|Official doc\|Team knowledge" LegendPanel.tsx` | 0 | 0 ✓ |
| `grep -n "entities: readonly Entity\[\]" LegendPanel.tsx` | ≥1 | 1 ✓ |
| `grep -n "relations: readonly Relation\[\]" LegendPanel.tsx` | ≥1 | 1 ✓ |
| `grep -n "deriveLayer" LegendPanel.tsx` | ≥1 | 5 ✓ |
| vitest LegendPanel.test.tsx — 11 tests pass | exit 0 | exit 0; 12 tests pass (+ logger guard) ✓ |

### Task 2 acceptance criteria

| Gate | Expected | Actual |
|------|----------|--------|
| `grep -nE "<LegendPanel[^>]*entities=\{entities\}[^>]*relations=\{relations\}" routes/UnifiedViewer.tsx` | =1 | 1 (line 392) ✓ |
| `grep -c "<LegendPanel" FilterRail.tsx` | 0 | 0 ✓ |
| `tsc --noEmit` | exit 0 | exit 0 ✓ |
| `vitest LegendPanel.test.tsx` | exit 0 | exit 0 ✓ |
| `npm run build` | exit 0 | exit 0 (bind-mounted submodule) ✓ |

## Success Criteria (Plan-Level)

- [x] **VKBUI-02 SC#2** — no static OKB-domain entries (RuntimeDiagnostics et al.) render when zero such nodes are on screen. Negative-assertion Test 11 enforces this: with `entities=[{ontologyClass:'Component'}]` and `relations=[]`, the rendered DOM contains none of `RuntimeDiagnostics` / `Official doc` / `Automated RCA` / `Team knowledge` / `User input` / `CORRELATED_WITH` / `RELATES_TO`.
- [x] **DOMAINS / LAYERS / SOURCE / RELATIONSHIPS derive from rendered set** — Tests 1, 3, 5, 7 each provide a concrete entity/relation fixture and assert that the rendered rows match exactly.
- [x] **Empty sections hidden** — Tests 6 (SOURCE absent) and 9 (everything absent) verify D-07.
- [x] **Section order preserved** — Test 10 walks DOM order and confirms DOMAINS → LAYERS → SOURCE → RELATIONSHIPS.

## TDD Gate Compliance

- Task 1 RED commit: `e410a8981` (test)
- Task 1 GREEN commit: `bf373d25e` (feat)
- Task 2 wiring commit: `0b01b44a5` (feat) — Task 2 not declared TDD; covered by Task 1's tests (the new props contract) + the build gate
- Sequence verified: test before feat. No REFACTOR commits — implementation was minimal and clean on first pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Worktree missing node_modules**
- **Found during:** Task 1 RED — vitest couldn't load config.
- **Issue:** `node_modules/` not populated in the worktree after `git worktree add`. Vitest's import resolution fails before any tests run.
- **Fix:** Symlinked `integrations/unified-viewer/node_modules` → main repo's identical `node_modules`. Same workaround Plan 60-01 used; `.gitignore`'d so the symlink stays local.
- **Files modified:** None tracked.
- **Commit:** N/A.

**2. [Rule 3 - Blocker] Acceptance grep `RuntimeDiagnostics == 0` would have failed if a local set re-listed SHAPE_PALETTE keys**
- **Found during:** Task 1 GREEN — first implementation duplicated SHAPE_PALETTE keys (including `'RuntimeDiagnostics'`) inside `LegendPanel.tsx` to detect "is this class registered?". That re-introduced the literal token that the plan's acceptance grep forbids.
- **Issue:** Plan acceptance: `grep -c "RuntimeDiagnostics" integrations/unified-viewer/src/panels/LegendPanel.tsx returns 0`. A duplicated local Set would have returned ≥1.
- **Fix:** Added `export` to the existing `SHAPE_PALETTE` constant in `integrations/unified-viewer/src/graph/color-fallback.ts`. LegendPanel now does `Object.prototype.hasOwnProperty.call(SHAPE_PALETTE, cls)` to detect registered classes — zero literal class-name strings in the legend file. Spirit of the grep (no OKB seeds drive rendering) preserved; spirit of "single source of truth for shape mapping" strengthened.
- **Files modified:** `integrations/unified-viewer/src/graph/color-fallback.ts` (added `export` keyword to SHAPE_PALETTE; comment updated).
- **Commit:** Folded into `bf373d25e`.
- **Plan files_modified deviation:** Plan listed only 3 files; this change touches a 4th. Strictly necessary to satisfy Task 1's acceptance grep; surfaced as a documented deviation here.

**3. [Rule 3 - Blocker] Plan's `<interfaces>` block quoted ApiClient.{Entity,Relation} but useGraphData returns graph/types.{Entity,Relation}**
- **Found during:** Task 2 TSC pass after the mount-site edit.
- **Issue:** TS2322 — `Relation[]` (graph/types) not assignable to `readonly Relation[]` (ApiClient). The two shapes are structurally compatible for LegendPanel's reads, but they differ on `type` optionality, `level` literal union, and the wire-protocol index signature.
- **Fix:** Swapped LegendPanel + LegendPanel.test.tsx imports from `@/api/ApiClient` to `@/graph/types`. Same type names (Entity, Relation), so all acceptance greps still pass. Same shape useGraphData feeds the canvas — the LegendPanel now consumes the same post-normalization flavor.
- **Files modified:** `LegendPanel.tsx`, `LegendPanel.test.tsx` (single import line each).
- **Commit:** Folded into `0b01b44a5`.

### No Architectural Changes (Rule 4)

None. The prop-driven design was the planner's explicit choice (D-05); the SHAPE_PALETTE export is a one-token additive change, not architectural.

## Deferred Issues

**Out-of-scope failures discovered while running the full test suite:**

- 2 pre-existing failures in `src/graph/color-fallback.test.ts` (`classColor — ontology palette` block) — the tests assert the legacy hierarchy palette (`'#1d4ed8'` for Project, `'#f59e0b'` for Observation) but the current `BATCH_PALETTE` / `ONLINE_PALETTE` (set 2026-06-11 per the file header) use teal + light-blue. Failure pre-dates Plan 60-02 — already logged in `.planning/phases/60-unified-viewer-rendering-ux-integrity/deferred-items.md` per Plan 60-01's deferred sweep. Not blocking VKBUI-02 closure.

**No stubs introduced** — LegendPanel is fully wired; both call sites (Task 1 component + Task 2 mount) consume the same post-filter graph data; tests prove the wiring with both populated and empty fixtures.

## Threat Surface Scan

No new attack surface beyond `<threat_model>`. The DoS risk (T-60-02-02) from per-render derivation is mitigated by `useMemo` keyed on `entities` / `relations` references — no recompute on identical-content writes (Phase 56 viewport-stability contract). Information disclosure (T-60-02-01) remains `accept` — metadata.source labels are non-PII tags.

## Self-Check: PASSED

All 4 modified files exist on disk:
- `integrations/unified-viewer/src/panels/LegendPanel.tsx`
- `integrations/unified-viewer/src/panels/LegendPanel.test.tsx`
- `integrations/unified-viewer/src/routes/UnifiedViewer.tsx`
- `integrations/unified-viewer/src/graph/color-fallback.ts`

All 3 commits exist in `git log`:
- `e410a8981` — test(60-02): RED
- `bf373d25e` — feat(60-02): GREEN
- `0b01b44a5` — feat(60-02): wire mount
