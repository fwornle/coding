// LearningSourceFilter — VKB reference filter for "where this entity came
// from". Three options:
//   - Batch: manual / UKB / semantic-analysis / wave-analysis writes
//   - Online: ETM / observation-writer / consolidator writes (auto-learned)
//   - Combined: both (default)
//
// Drives computeNodeState via store.learningSource. Entities whose
// metadata.source matches the selection (or all when 'combined') render
// normally; the rest hide.
//
// Added 2026-06-11 per user request — mirrors VKB's
// memory-visualizer/src/components/Filters/SourceFilter.tsx.

import { useViewerStore } from '@/store/viewer-store'
import { Logger } from '@/lib/logging'

const OPTIONS = [
  { value: 'batch', label: 'Batch', sub: 'Manual / UKB learned knowledge' },
  { value: 'online', label: 'Online', sub: 'Auto-learned knowledge' },
  { value: 'combined', label: 'Combined', sub: 'All knowledge sources' },
] as const

export function LearningSourceFilter() {
  const learningSource = useViewerStore((s) => s.learningSource)
  const set = useViewerStore.setState

  return (
    <div className="space-y-1" data-testid="filter-learning-source">
      <div className="text-xs font-medium text-muted-foreground">Learning Source</div>
      <div className="space-y-1">
        {OPTIONS.map(({ value, label, sub }) => {
          const checked = learningSource === value
          return (
            <label
              key={value}
              className="flex items-start gap-2 cursor-pointer hover:bg-accent p-1 rounded"
              data-testid={`filter-learning-source-${value}`}
            >
              <input
                type="radio"
                name="learning-source"
                checked={checked}
                onChange={() => {
                  set({ learningSource: value })
                  Logger.info(
                    Logger.Categories.FILTERS,
                    `LearningSource → ${value}`,
                  )
                }}
                className="mt-0.5 size-3.5 accent-primary"
                aria-label={label}
              />
              <span className="flex flex-col">
                <span className="text-xs">{label}</span>
                <span className="text-[10px] text-muted-foreground">{sub}</span>
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
