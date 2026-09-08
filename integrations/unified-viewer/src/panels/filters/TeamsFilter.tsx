// TeamsFilter — the "Teams / Views" rail.
//
// Originally (2026-06-11) a flat checkbox per distinct `metadata.team`, mirroring
// VKB's memory-visualizer/src/components/Filters/TeamFilter.tsx. That list has no
// upper bound: kgbench mints a `kgbench-tree-<id>` team per sandbox worktree, and
// any agent session run somewhere new adds another, so the five teams that matter
// ended up buried among twenty-odd machine-generated ones.
//
// Now a three-group collapsible tree. The grouping itself is pure and lives in
// ./team-groups; this file is render + store wiring only. Predefined entries come
// from config/teams/ via obs-api GET /api/teams, so adding a team is a config
// change, and the Projects/Teams split honours the `kind` contract stated on
// TeamOntologyConfig in src/knowledge-management/types.ts.
//
// STORE SEMANTICS ARE UNCHANGED. `selectedTeams` keeps both sentinels — empty Set
// = "all visible", `{__none__}` = "none" — so graph-builder.ts:525 and
// visibility-predicate.ts:100 need no counterpart edit.
//
// Collapse idiom (▶ triangle + aria-expanded + per-group all|none) is lifted from
// OntologyFilter.tsx so the two rails read the same.

import { useEffect, useMemo, useState } from 'react'
import { useViewerStore } from '@/store/viewer-store'
import { Checkbox } from '@/components/ui/checkbox'
import { Logger } from '@/lib/logging'
import type { ApiClient, Entity, TeamRegistry } from '@/api/ApiClient'
import { EMPTY_TEAM_REGISTRY } from '@/api/ApiClient'
import {
  buildTeamGroups,
  allTeamIds,
  PROJECTS_GROUP,
  TEAMS_GROUP,
  type TeamGroup,
} from './team-groups'

/** Groups that render expanded on first paint; everything else starts closed. */
const OPEN_BY_DEFAULT: ReadonlySet<string> = new Set([PROJECTS_GROUP, TEAMS_GROUP])

interface TeamsFilterProps {
  entities: readonly Entity[]
  /** Omitted in unit tests that drive `registry` directly. */
  apiClient?: ApiClient
  /** Test seam — bypasses the fetch when provided. */
  registry?: TeamRegistry
}

/**
 * Entities with no `metadata.team` are counted as 'coding'.
 *
 * Carried over from the original filter verbatim. It is a guess, but it is the
 * guess the graph already makes elsewhere, and changing it here would silently
 * move ~850 entities between rows for reasons unrelated to this rail.
 */
function teamOf(e: Entity): string {
  return ((e.metadata as { team?: string } | undefined)?.team) || 'coding'
}

export function TeamsFilter({ entities, apiClient, registry: registryProp }: TeamsFilterProps) {
  const selectedTeams = useViewerStore((s) => s.selectedTeams)
  const set = useViewerStore.setState

  const [fetched, setFetched] = useState<TeamRegistry | null>(null)
  const registry = registryProp ?? fetched ?? EMPTY_TEAM_REGISTRY

  useEffect(() => {
    if (registryProp || !apiClient) return
    let live = true
    // listTeams never rejects — an unavailable registry (the OKB backend does
    // not mount the route) degrades to "every team is a view", which is exactly
    // the pre-registry behaviour.
    void apiClient.listTeams().then((r) => {
      if (live) setFetched(r)
    })
    return () => {
      live = false
    }
  }, [apiClient, registryProp])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entities) {
      const t = teamOf(e)
      map.set(t, (map.get(t) ?? 0) + 1)
    }
    return map
  }, [entities])

  const groups = useMemo(() => buildTeamGroups(counts, registry), [counts, registry])

  // Only the two registry groups start open. Views and every cluster inside it
  // start closed: that half is the unbounded one, and expanding Views would
  // otherwise re-dump the eleven kgbench rows this grouping exists to fold away.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  // Both readers must apply the SAME default. Toggling against a hardcoded
  // `?? false` while reading against `?? !OPEN_BY_DEFAULT` makes the first click
  // on a default-closed group a no-op — it writes back the value it already had.
  const collapsedDefault = (id: string) => !OPEN_BY_DEFAULT.has(id)
  const isCollapsed = (id: string) => collapsed[id] ?? collapsedDefault(id)
  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !(prev[id] ?? collapsedDefault(id)) }))

  /**
   * Materialise the current selection as a concrete set.
   *
   * 2026-06-11 (bug fix, still load-bearing): with the empty-Set sentinel every
   * box renders checked, so an unqualified toggle produced a one-element set —
   * deselecting every team the user did NOT click. Expanding the sentinel to
   * the full id list first makes a click uncheck exactly one box.
   */
  const materialise = (): Set<string> => {
    if (selectedTeams.size === 0) return new Set(allTeamIds(groups))
    if (selectedTeams.has('__none__')) return new Set()
    return new Set(selectedTeams)
  }

  const apply = (next: Set<string>, what: string) => {
    set({ selectedTeams: next })
    Logger.info(Logger.Categories.FILTERS, `Teams ${what} → ${[...next].join(',') || '∅'}`)
  }

  const toggle = (team: string) => {
    const next = materialise()
    if (next.has(team)) next.delete(team)
    else next.add(team)
    apply(next, `toggle ${team}`)
  }

  /** Group-level all/none — same materialisation, applied to a slice of ids. */
  const setGroup = (group: TeamGroup, on: boolean) => {
    const next = materialise()
    for (const id of group.memberIds) {
      if (on) next.add(id)
      else next.delete(id)
    }
    apply(next, `${group.label} ${on ? 'all' : 'none'}`)
  }

  const isChecked = (team: string) => selectedTeams.size === 0 || selectedTeams.has(team)

  const renderRow = (row: { id: string; label: string; count: number }, depth: number) => (
    <label
      key={row.id}
      style={{ paddingLeft: `${depth * 10}px` }}
      className="flex items-center gap-2 cursor-pointer hover:bg-accent p-1 rounded"
      data-testid={`filter-team-${row.id}`}
    >
      <Checkbox
        checked={isChecked(row.id)}
        onCheckedChange={() => toggle(row.id)}
        aria-label={row.label}
      />
      <span className="text-xs flex-1 truncate capitalize">{row.label}</span>
      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded tabular-nums">
        {row.count}
      </span>
    </label>
  )

  const renderGroup = (group: TeamGroup, depth: number) => {
    const open = !isCollapsed(group.id)
    return (
      <div key={group.id} data-testid={`filter-team-group-${group.id}`}>
        <div
          className="flex items-center justify-between px-1"
          style={{ paddingLeft: `${depth * 10}px` }}
        >
          <button
            type="button"
            onClick={() => toggleCollapse(group.id)}
            className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1 hover:text-foreground"
            aria-expanded={open}
            data-testid={`filter-team-group-toggle-${group.id}`}
          >
            <span
              className={`transform transition-transform text-[8px] ${open ? 'rotate-90' : ''}`}
              aria-hidden
            >
              ▶
            </span>
            {group.label}
            <span
              className="text-[9px] normal-case tabular-nums opacity-70"
              data-testid={`filter-team-group-count-${group.id}`}
            >
              ({group.total})
            </span>
          </button>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setGroup(group, true)}
              className="text-[9px] lowercase text-muted-foreground hover:text-foreground"
              aria-label={`Select all in ${group.label}`}
            >
              all
            </button>
            <button
              type="button"
              onClick={() => setGroup(group, false)}
              className="text-[9px] lowercase text-muted-foreground hover:text-foreground"
              aria-label={`Clear all in ${group.label}`}
            >
              none
            </button>
          </div>
        </div>
        {open && (
          <div className="space-y-0.5">
            {group.subgroups.map((sub) => renderGroup(sub, depth + 1))}
            {group.rows.map((row) => renderRow(row, depth + 1))}
          </div>
        )}
      </div>
    )
  }

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
      <div className="space-y-1">{groups.map((g) => renderGroup(g, 0))}</div>
    </div>
  )
}
