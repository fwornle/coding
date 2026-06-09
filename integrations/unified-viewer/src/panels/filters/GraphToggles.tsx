// PATTERN SOURCE: 55-08-PLAN.md Task 3 + 55-PATTERNS.md § GraphToggles
// PORT-SPEC: _work/.../viewer/src/components/Filters/LegendPanel.tsx:14-80
//   (toggle block — NOT the legend body below)
//
// UI-SPEC §5 copywriting is locked: each label string is verbatim
// from VOKB LegendPanel.tsx. Italic hint text uses text-[10px] ml-6
// leading-tight (UI-SPEC §3 micro-type exception, preserved verbatim).
//
// Nested "Labels" sub-toggle for Show All Relations appears ONLY when
// the parent toggle is on (LegendPanel.tsx:27-37 pattern).

import { useViewerStore } from '@/store/viewer-store'
import { Checkbox } from '@/components/ui/checkbox'
import { Logger } from '@/lib/logging'

export function GraphToggles() {
  const showEdges = useViewerStore((s) => s.showEdges)
  const showRelationLabels = useViewerStore((s) => s.showRelationLabels)
  const showClusters = useViewerStore((s) => s.showClusters)
  const showMergedOnly = useViewerStore((s) => s.showMergedOnly)
  const hideDocNodes = useViewerStore((s) => s.hideDocNodes)
  const toggleShowEdges = useViewerStore((s) => s.toggleShowEdges)
  const toggleShowRelationLabels = useViewerStore(
    (s) => s.toggleShowRelationLabels,
  )
  const toggleShowClusters = useViewerStore((s) => s.toggleShowClusters)
  const toggleShowMergedOnly = useViewerStore((s) => s.toggleShowMergedOnly)
  const toggleHideDocNodes = useViewerStore((s) => s.toggleHideDocNodes)

  return (
    <div className="space-y-1" data-testid="filter-graph-toggles-section">
      <label
        className="flex items-center gap-2 text-xs cursor-pointer"
        data-testid="graph-toggle-show-edges"
      >
        <Checkbox
          checked={showEdges}
          onCheckedChange={() => {
            toggleShowEdges()
            Logger.info(
              Logger.Categories.FILTERS,
              `GraphToggles: showEdges → ${!showEdges}`,
            )
          }}
          aria-label="Show All Relations"
        />
        Show All Relations
      </label>
      {showEdges && (
        <label
          className="flex items-center gap-2 text-xs cursor-pointer ml-6 text-muted-foreground"
          data-testid="graph-toggle-relation-labels"
        >
          <Checkbox
            checked={showRelationLabels}
            onCheckedChange={() => {
              toggleShowRelationLabels()
              Logger.info(
                Logger.Categories.FILTERS,
                `GraphToggles: showRelationLabels → ${!showRelationLabels}`,
              )
            }}
            aria-label="Labels"
          />
          Labels
        </label>
      )}

      <label
        className="flex items-center gap-2 text-xs cursor-pointer"
        data-testid="graph-toggle-show-clusters"
      >
        <Checkbox
          checked={showClusters}
          onCheckedChange={() => {
            toggleShowClusters()
            Logger.info(
              Logger.Categories.FILTERS,
              `GraphToggles: showClusters → ${!showClusters}`,
            )
          }}
          aria-label="Show Clusters"
        />
        Show Clusters
      </label>
      {showClusters && (
        <p
          className="text-[10px] ml-6 leading-tight italic text-muted-foreground"
          data-testid="graph-toggle-clusters-hint"
        >
          Halos = connectivity clusters (densely linked groups)
        </p>
      )}

      <label
        className="flex items-center gap-2 text-xs cursor-pointer"
        data-testid="graph-toggle-merged-only"
      >
        <Checkbox
          checked={showMergedOnly}
          onCheckedChange={() => {
            toggleShowMergedOnly()
            Logger.info(
              Logger.Categories.FILTERS,
              `GraphToggles: showMergedOnly → ${!showMergedOnly}`,
            )
          }}
          aria-label="Merged Only"
        />
        Merged Only
      </label>
      {showMergedOnly && (
        <p
          className="text-[10px] ml-6 leading-tight italic text-muted-foreground"
          data-testid="graph-toggle-merged-hint"
        >
          Nodes with content from multiple ingestion runs
        </p>
      )}

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
    </div>
  )
}
