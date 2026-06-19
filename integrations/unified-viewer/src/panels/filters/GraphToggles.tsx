// PATTERN SOURCE: 55-08-PLAN.md Task 3 + 55-PATTERNS.md § GraphToggles
//
// 2026-06-19: removed four defunct no-op toggles — Show All Relations
// (showEdges), Labels (showRelationLabels), Show Clusters (showClusters) and
// Merged Only (showMergedOnly). None were consumed by the D3GraphCanvas (edges
// + relation labels always render; clusters/merged-only were never wired), so
// they were pure dead UI (operator confirmed 2026-06-19). The two FUNCTIONAL
// toggles remain: Hide Documentation (hideDocNodes — consumed by
// useVisibleEntityIds) and Show debug entity types (showDebugEntityTypes —
// Plan 60-03 Observation/Digest shield).

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
