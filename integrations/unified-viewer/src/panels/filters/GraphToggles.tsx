// PATTERN SOURCE: 55-08-PLAN.md Task 3 + 55-PATTERNS.md § GraphToggles
//
// 2026-06-19: removed four defunct no-op toggles — Show All Relations
// (showEdges), Labels (showRelationLabels), Show Clusters (showClusters) and
// Merged Only (showMergedOnly). None were consumed by the D3GraphCanvas (edges
// + relation labels always render; clusters/merged-only were never wired), so
// they were pure dead UI (operator confirmed 2026-06-19). The FUNCTIONAL
// toggles remain: Hide Documentation (hideDocNodes), Hide archived
// (hideArchived — the condensed roll-up view, default ON), Aggregates only
// (aggregatesOnly — roll-up parents + backbone) and Show debug entity types
// (showDebugEntityTypes — Plan 60-03 Observation/Digest shield). All four go
// through useGraphVisibility, so the canvas, the footer count and the bucket
// list cannot disagree about them.

import { useViewerStore } from '@/store/viewer-store'
import { Checkbox } from '@/components/ui/checkbox'
import { Logger } from '@/lib/logging'

export function GraphToggles() {
  const hideDocNodes = useViewerStore((s) => s.hideDocNodes)
  // Phase 60 Plan 03 (G3) — D-09..D-11: runtime toggle that lets operators
  // re-enable Observation/Digest visibility in the graph for debugging.
  // Default OFF (architecture-bleed shield).
  const showDebugEntityTypes = useViewerStore((s) => s.showDebugEntityTypes)
  const toggleHideDocNodes = useViewerStore((s) => s.toggleHideDocNodes)
  const toggleShowDebugEntityTypes = useViewerStore(
    (s) => s.toggleShowDebugEntityTypes,
  )
  // Roll-up condensed view: hide insights archived behind a subsystem parent.
  const hideArchived = useViewerStore((s) => s.hideArchived)
  const toggleHideArchived = useViewerStore((s) => s.toggleHideArchived)
  // Aggregates-only: the roll-up layer on its own.
  const aggregatesOnly = useViewerStore((s) => s.aggregatesOnly)
  const toggleAggregatesOnly = useViewerStore((s) => s.toggleAggregatesOnly)
  // SubComponent collapse + the per-Component expanders.
  const collapseSubComponents = useViewerStore((s) => s.collapseSubComponents)
  const toggleCollapseSubComponents = useViewerStore((s) => s.toggleCollapseSubComponents)
  const expandedComponentIds = useViewerStore((s) => s.expandedComponentIds)
  const toggleComponentExpanded = useViewerStore((s) => s.toggleComponentExpanded)
  const collapseAllComponents = useViewerStore((s) => s.collapseAllComponents)
  const componentSummary = useViewerStore((s) => s.componentSummary)

  return (
    <div className="space-y-1" data-testid="filter-graph-toggles-section">
      <label
        className="flex items-center gap-2 text-xs cursor-pointer"
        data-testid="graph-toggle-hide-doc"
      >
        <Checkbox
          checked={hideDocNodes}
          onCheckedChange={() => {
            toggleHideDocNodes()
            Logger.info(
              Logger.Categories.FILTERS,
              `GraphToggles: hideDocNodes → ${!hideDocNodes}`,
            )
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

      <label
        className="flex items-center gap-2 text-xs cursor-pointer"
        data-testid="graph-toggle-hide-archived"
      >
        <Checkbox
          checked={hideArchived}
          onCheckedChange={() => {
            toggleHideArchived()
            Logger.info(
              Logger.Categories.FILTERS,
              `GraphToggles: hideArchived → ${!hideArchived}`,
            )
          }}
          aria-label="Hide archived (rolled-up)"
        />
        Hide archived (rolled-up)
      </label>
      {hideArchived && (
        <p
          className="text-[10px] ml-6 leading-tight italic text-muted-foreground"
          data-testid="graph-toggle-hide-archived-hint"
        >
          Hides insights the roll-up pass folded into a subsystem-level parent. Leaves the condensed corpus on the canvas; archived rows stay queryable.
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

      {/*
        Phase 60 Plan 03 (G3) — D-09..D-11: runtime toggle that lets operators
        re-enable Observation/Digest visibility for debugging. Default OFF —
        the architecture-bleed shield. Non-persistent (D-11): resets every page
        load.
      */}
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
