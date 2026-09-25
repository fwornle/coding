// PATTERN SOURCE: 55-08-PLAN.md Task 3 + 55-PATTERNS.md § GraphToggles
//
// 2026-06-19: removed four defunct no-op toggles — Show All Relations
// (showEdges), Labels (showRelationLabels), Show Clusters (showClusters) and
// Merged Only (showMergedOnly). None were consumed by the D3GraphCanvas, so
// they were pure dead UI (operator confirmed 2026-06-19). Do not reintroduce
// a row here that nothing reads.
//
// 2026-09-25 — SPLIT INTO TWO GROUPS, both living under Advanced.
//
// This block used to sit in the main rail as five flat checkboxes, and three of
// them (hideArchived, aggregatesOnly, collapseSubComponents) were really one
// question — "how much detail?" — asked three times with two opposite
// polarities. That question is now the DetailLevel control at the top of the
// rail; these remain as the underlying switches, because an operator who wants
// an exact combination should still be able to build one. Touching any of them
// puts DetailLevel into its derived `custom` state rather than having the
// preset silently claim a view it is not showing.
//
// The grouping is by what the switch acts on:
//   ContentToggles   — which KINDS of row exist at all (documentation, stale,
//                      debug stream types)
//   StructureToggles — how the hierarchy is folded (rolled-up, aggregates,
//                      sub-components)
//
// All of them route through useGraphVisibility, so the canvas, the footer count
// and the bucket list cannot disagree about them.

import { useViewerStore } from '@/store/viewer-store'
import { Checkbox } from '@/components/ui/checkbox'
import { Logger } from '@/lib/logging'

/** Which kinds of row exist at all. */
export function ContentToggles() {
  const hideDocNodes = useViewerStore((s) => s.hideDocNodes)
  const toggleHideDocNodes = useViewerStore((s) => s.toggleHideDocNodes)
  const showStale = useViewerStore((s) => s.showStale)
  const toggleShowStale = useViewerStore((s) => s.toggleShowStale)
  // Phase 60 Plan 03 (G3) — D-09..D-11: runtime toggle that re-enables
  // Observation/Digest visibility for debugging. Default OFF (architecture-
  // bleed shield), non-persistent (D-11): resets every page load.
  const showDebugEntityTypes = useViewerStore((s) => s.showDebugEntityTypes)
  const toggleShowDebugEntityTypes = useViewerStore((s) => s.toggleShowDebugEntityTypes)

  return (
    <div className="space-y-1" data-testid="filter-content-toggles-section">
      <label
        className="flex items-center gap-2 text-xs cursor-pointer"
        data-testid="graph-toggle-hide-doc"
      >
        <Checkbox
          checked={hideDocNodes}
          onCheckedChange={() => {
            toggleHideDocNodes()
            Logger.info(Logger.Categories.FILTERS, `GraphToggles: hideDocNodes → ${!hideDocNodes}`)
          }}
          aria-label="Hide Documentation"
        />
        Hide Documentation
      </label>
      {hideDocNodes && (
        <p
          className="text-[10px] ml-6 leading-tight italic text-muted-foreground"
          data-testid="graph-toggle-hide-doc-hint"
        >
          Hides green business/doc nodes (Decision, Requirement, DocumentSource, etc.)
        </p>
      )}

      {/*
        STALE — split out of the old "Hide archived (rolled-up)" checkbox on
        2026-09-25. `metadata.archivedAt` marks two unrelated populations, and
        the old label named only one of them:
          rolled up  a parent stands in for the row on the canvas
          stale      archived by the ratio=0 sweep, "code claims no longer
                     exist" — NOTHING stands in for it
        Hiding the second under a control that says "rolled-up" is how a row
        disappears and nobody goes looking for it. Default OFF: measured-wrong
        knowledge stays out of the default view at every detail level, and is
        one click from coming back.
      */}
      <label
        className="flex items-center gap-2 text-xs cursor-pointer"
        data-testid="graph-toggle-show-stale"
      >
        <Checkbox
          checked={showStale}
          onCheckedChange={() => {
            toggleShowStale()
            Logger.info(Logger.Categories.FILTERS, `GraphToggles: showStale → ${!showStale}`)
          }}
          aria-label="Show stale (code gone)"
        />
        Show stale (code gone)
      </label>
      {showStale && (
        <p
          className="text-[10px] ml-6 leading-tight italic text-muted-foreground"
          data-testid="graph-toggle-show-stale-hint"
        >
          Rows archived because the code they describe no longer exists
          (verification ratio 0 for 30+ days). No roll-up parent represents
          these — they are shown for audit, not because they are current.
        </p>
      )}

      <label
        className="flex items-center gap-2 text-xs cursor-pointer"
        data-testid="graph-toggle-debug-entity-types"
      >
        <Checkbox
          checked={showDebugEntityTypes}
          onCheckedChange={() => {
            toggleShowDebugEntityTypes()
            Logger.info(
              Logger.Categories.FILTERS,
              `GraphToggles: showDebugEntityTypes → ${!showDebugEntityTypes}`,
            )
          }}
          aria-label="Show debug entity types"
        />
        Show debug entity types (Observation, Digest)
      </label>
      {showDebugEntityTypes && (
        <p
          className="text-[10px] ml-6 leading-tight italic text-muted-foreground"
          data-testid="graph-toggle-debug-hint"
        >
          Architecture-bleed shield: these types should not appear in production VKB. Toggle ON only for debugging.
        </p>
      )}
    </div>
  )
}

/** How the hierarchy is folded. These are the switches DetailLevel writes. */
export function StructureToggles() {
  const hideRolledUp = useViewerStore((s) => s.hideRolledUp)
  const toggleHideRolledUp = useViewerStore((s) => s.toggleHideRolledUp)
  const aggregatesOnly = useViewerStore((s) => s.aggregatesOnly)
  const toggleAggregatesOnly = useViewerStore((s) => s.toggleAggregatesOnly)
  const collapseSubComponents = useViewerStore((s) => s.collapseSubComponents)
  const toggleCollapseSubComponents = useViewerStore((s) => s.toggleCollapseSubComponents)
  const expandedComponentIds = useViewerStore((s) => s.expandedComponentIds)
  const toggleComponentExpanded = useViewerStore((s) => s.toggleComponentExpanded)
  const collapseAllComponents = useViewerStore((s) => s.collapseAllComponents)
  const componentSummary = useViewerStore((s) => s.componentSummary)

  return (
    <div className="space-y-1" data-testid="filter-structure-toggles-section">
      <p className="text-[10px] leading-tight italic text-muted-foreground">
        The switches behind Detail level. Change one and the level reads
        “custom”.
      </p>

      <label
        className="flex items-center gap-2 text-xs cursor-pointer"
        data-testid="graph-toggle-hide-rolled-up"
      >
        <Checkbox
          checked={hideRolledUp}
          onCheckedChange={() => {
            toggleHideRolledUp()
            Logger.info(Logger.Categories.FILTERS, `GraphToggles: hideRolledUp → ${!hideRolledUp}`)
          }}
          aria-label="Hide rolled-up rows"
        />
        Hide rolled-up rows
      </label>
      {hideRolledUp && (
        <p
          className="text-[10px] ml-6 leading-tight italic text-muted-foreground"
          data-testid="graph-toggle-hide-rolled-up-hint"
        >
          Hides insights the roll-up pass folded into a subsystem-level parent.
          Leaves the condensed corpus on the canvas; the rows stay queryable.
        </p>
      )}

      <label
        className="flex items-center gap-2 text-xs cursor-pointer"
        data-testid="graph-toggle-aggregates-only"
      >
        <Checkbox
          checked={aggregatesOnly}
          onCheckedChange={() => {
            toggleAggregatesOnly()
            Logger.info(
              Logger.Categories.FILTERS,
              `GraphToggles: aggregatesOnly → ${!aggregatesOnly}`,
            )
          }}
          aria-label="Aggregates only (roll-up parents)"
        />
        Aggregates only (roll-up parents)
      </label>
      {aggregatesOnly && (
        <p
          className="text-[10px] ml-6 leading-tight italic text-muted-foreground"
          data-testid="graph-toggle-aggregates-only-hint"
        >
          Shows only subsystem-level roll-up parents plus the Project/Component
          backbone. Rows the roll-up has not reached yet are hidden — if this
          view looks sparse, that is the corpus telling you what is aggregated.
        </p>
      )}

      <label
        className="flex items-center gap-2 text-xs cursor-pointer"
        data-testid="graph-toggle-collapse-subcomponents"
      >
        <Checkbox
          checked={collapseSubComponents}
          onCheckedChange={() => {
            toggleCollapseSubComponents()
            Logger.info(
              Logger.Categories.FILTERS,
              `GraphToggles: collapseSubComponents → ${!collapseSubComponents}`,
            )
          }}
          aria-label="Collapse sub-components"
        />
        Collapse sub-components
      </label>
      {collapseSubComponents && (
        <div className="ml-6 mt-1 space-y-1" data-testid="component-expander-list">
          <p className="text-[10px] leading-tight italic text-muted-foreground">
            Sub-components are the architecture skeleton, not knowledge — hidden
            until you open the component that owns them.
          </p>
          {componentSummary.length === 0 ? (
            <p className="text-[10px] italic text-muted-foreground">Loading components…</p>
          ) : (
            <>
              {componentSummary.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 text-[11px] cursor-pointer"
                  data-testid={`component-expander-${c.id}`}
                >
                  <Checkbox
                    checked={expandedComponentIds.has(c.id)}
                    onCheckedChange={() => toggleComponentExpanded(c.id)}
                    aria-label={`Expand ${c.name}`}
                  />
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {c.childCount}
                  </span>
                </label>
              ))}
              {expandedComponentIds.size > 0 && (
                <button
                  type="button"
                  className="text-[10px] underline text-muted-foreground hover:text-foreground"
                  onClick={collapseAllComponents}
                  data-testid="component-expander-collapse-all"
                >
                  collapse all ({expandedComponentIds.size} open)
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Backwards-compatible composition. Kept so anything still importing
 * `GraphToggles` renders both groups rather than silently losing rows.
 */
export function GraphToggles() {
  return (
    <div className="space-y-1" data-testid="filter-graph-toggles-section">
      <StructureToggles />
      <ContentToggles />
    </div>
  )
}
