// TeamsFilter — VKB reference filter for cross-team views. Each team in the
// dataset gets a checkbox with a count badge. Empty selection = "all
// visible" (matches the same convention as LayerFilter / OntologyFilter).
//
// Drives computeNodeState via store.selectedTeams. When the user picks a
// subset, entities whose metadata.team is NOT in the set hide.
//
// Added 2026-06-11 per user request — mirrors VKB's
// memory-visualizer/src/components/Filters/TeamFilter.tsx.

import { useMemo } from 'react'
import { useViewerStore } from '@/store/viewer-store'
import { Checkbox } from '@/components/ui/checkbox'
import { Logger } from '@/lib/logging'
import type { Entity } from '@/api/ApiClient'

interface TeamsFilterProps {
  entities: readonly Entity[]
}

export function TeamsFilter({ entities }: TeamsFilterProps) {
  const selectedTeams = useViewerStore((s) => s.selectedTeams)
  const set = useViewerStore.setState

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entities) {
      const t = ((e.metadata as { team?: string } | undefined)?.team) || 'coding'
      map.set(t, (map.get(t) ?? 0) + 1)
    }
    return map
  }, [entities])

  const teamNames = useMemo(() => [...counts.keys()].sort(), [counts])

  const toggle = (team: string) => {
    // 2026-06-11 (bug fix): when selectedTeams is empty (= "all visible"
    // sentinel) every checkbox renders as checked. Clicking one used to
    // produce selectedTeams = {coding} only, which DESELECTS all the
    // others — exactly what the user did NOT click. Materialise the
    // full team set first so a click on a checked-by-sentinel team
    // unchecks just that one. Same fix shape as the Layer toggle.
    const ALL_TEAMS = teamNames
    const base = selectedTeams.size === 0
      ? new Set<string>(ALL_TEAMS)
      : selectedTeams.has('__none__')
        ? new Set<string>() // "None" sentinel → start from empty
        : selectedTeams
    const next = new Set(base)
    if (next.has(team)) next.delete(team)
    else next.add(team)
    set({ selectedTeams: next })
    Logger.info(Logger.Categories.FILTERS, `Teams toggle: ${team} → ${[...next].join(',') || '∅'}`)
  }

  const isChecked = (team: string) =>
    selectedTeams.size === 0 || selectedTeams.has(team)

  return (
    <div className="space-y-1" data-testid="filter-teams">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">Teams / Views</div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => set({ selectedTeams: new Set() })}
            className="text-[10px] lowercase text-muted-foreground hover:text-foreground"
            aria-label="Select all teams"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => set({ selectedTeams: new Set(['__none__']) })}
            className="text-[10px] lowercase text-muted-foreground hover:text-foreground"
            aria-label="Clear teams"
          >
            None
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {teamNames.map((team) => (
          <label
            key={team}
            className="flex items-center gap-2 cursor-pointer hover:bg-accent p-1 rounded"
            data-testid={`filter-team-${team}`}
          >
            <Checkbox
              checked={isChecked(team)}
              onCheckedChange={() => toggle(team)}
              aria-label={team}
            />
            <span className="text-xs flex-1 capitalize">{team}</span>
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded tabular-nums">
              {counts.get(team) ?? 0}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
