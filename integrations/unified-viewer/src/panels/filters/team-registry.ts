// The team registry (obs-api GET /api/teams) kept live in the store, and the
// team selection kept in step with Dashboard → Teams — in BOTH directions.
//
// Was fetched once by TeamsFilter, which only exists while the rail's Scope
// section is open — so with Scope collapsed (its default) the canvases never
// learned the registry's scope or team→project map, and the dashboard's
// selection never reached the viewer. Once fetched it never changed either.
//
// FETCH: useTeamRegistry (mounted by the viewer core) reads the registry on
// mount, when the window regains focus and every POLL_MS while visible.
//
// NOTHING CHANGES UNLESS SOMETHING CHANGED. Every store field the canvases read
// is written only when its content differs: a poll that finds the same teams,
// scope, projects and selection writes nothing, so nothing re-renders. (The
// first version wrote fresh objects on every poll, and the graph redrew every
// 15 seconds.)
//
// SELECTION, dashboard → viewer: the dashboard's `active:` is where the rail
// starts, and a CHANGE to it is a newer, explicit choice — the rail adopts it.
// SELECTION, viewer → dashboard: a click in the rail is written back as
// `active:` (debounced, PUT /api/teams/active → the coordinator's one writer),
// and the key of what was written is remembered, so reading it back is not
// mistaken for a dashboard change. A poll that STARTED before the latest click
// (or while its write was pending) is ignored, so a stale answer in flight
// cannot undo the click.

import { useEffect } from 'react'
import { useViewerStore } from '@/store/viewer-store'
import type { ApiClient, TeamRegistry } from '@/api/ApiClient'
import { EMPTY_TEAM_REGISTRY } from '@/api/ApiClient'

export const POLL_MS = 15_000
export const WRITE_DEBOUNCE_MS = 800

/** A stable key for a selection: sorted ids ('' = all teams). */
export function selectionKey(active: readonly string[]): string {
  return [...active].sort().join(',')
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x))

/** True while applyTeamRegistry writes, so the store listener can tell its own writes from a click. */
let applying = false

type State = ReturnType<typeof useViewerStore.getState>

/**
 * Publish a registry and follow the dashboard's selection — writing only what changed.
 *
 * @param fetchedAt when the request that produced `registry` STARTED; an answer
 *   older than the rail's latest local change is ignored (see the header).
 */
export function applyTeamRegistry(registry: TeamRegistry, fetchedAt?: number): void {
  const state = useViewerStore.getState()
  if (fetchedAt !== undefined && (fetchedAt < state.teamSelectionLocalAt || state.teamSelectionWritePending)) return

  const active = registry.active ?? EMPTY_TEAM_REGISTRY.active
  const key = selectionKey(active)
  const projects: Record<string, string[]> = {}
  for (const t of registry.teams) if (t.projects?.length) projects[t.id] = t.projects

  const patch: Partial<State> = {}
  if (!same(state.teamRegistry, registry)) patch.teamRegistry = registry
  if (state.teamScope !== registry.scope) patch.teamScope = registry.scope
  if (!same(state.teamProjects, projects)) patch.teamProjects = projects
  if (state.dashboardSelectionKey !== key) patch.dashboardSelectionKey = key

  let next: ReadonlySet<string> | null = null
  if (state.dashboardSelectionKey === null) {
    // First read: start from the dashboard's selection unless the rail was
    // already used before the registry arrived.
    if (state.selectedTeams.size === 0 && active.length) next = new Set(active)
  } else if (state.dashboardSelectionKey !== key) {
    next = active.length ? new Set(active) : new Set()
  }
  if (next && !sameSet(next, state.selectedTeams)) patch.selectedTeams = next

  if (Object.keys(patch).length === 0) return
  applying = true
  try {
    useViewerStore.setState(patch)
  } finally {
    applying = false
  }
}

/** The `active:` list a rail selection stands for; null = not expressible (none / views only). */
export function activeFor(selected: ReadonlySet<string>, registry: TeamRegistry | null): string[] | null {
  if (selected.size === 0) return []
  if (selected.has('__none__')) return null
  const teamIds = new Set((registry?.teams ?? []).map((t) => t.id))
  const active = [...selected].filter((t) => teamIds.has(t)).sort()
  return active.length ? active : null
}

/** Keep the registry live and the selection in step with the dashboard, for as long as the viewer is mounted. */
export function useTeamRegistry(
  apiClient: (Pick<ApiClient, 'listTeams'> & Partial<Pick<ApiClient, 'setActiveTeams'>>) | undefined,
): void {
  useEffect(() => {
    if (!apiClient) return
    let live = true

    // ---- dashboard → viewer ------------------------------------------------
    // listTeams never rejects — an unavailable registry (the OKB backend does
    // not mount the route) degrades to "every team is a view".
    const refresh = () => {
      const startedAt = Date.now()
      void apiClient.listTeams().then((r) => {
        if (live) applyTeamRegistry(r, startedAt)
      })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, POLL_MS)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)

    // ---- viewer → dashboard ------------------------------------------------
    let writeTimer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = apiClient.setActiveTeams
      ? useViewerStore.subscribe((s, prev) => {
          if (applying || s.selectedTeams === prev.selectedTeams) return
          const active = activeFor(s.selectedTeams, s.teamRegistry)
          if (active === null || selectionKey(active) === s.dashboardSelectionKey) {
            useViewerStore.setState({ teamSelectionLocalAt: Date.now() })
            return
          }
          useViewerStore.setState({ teamSelectionLocalAt: Date.now(), teamSelectionWritePending: true })
          if (writeTimer) clearTimeout(writeTimer)
          writeTimer = setTimeout(() => {
            writeTimer = null
            const latest = activeFor(useViewerStore.getState().selectedTeams, useViewerStore.getState().teamRegistry)
            const write = latest ?? active
            void apiClient.setActiveTeams!(write).then((ok) => {
              if (!live) return
              useViewerStore.setState({
                teamSelectionWritePending: false,
                teamSelectionLocalAt: Date.now(),
                ...(ok ? { dashboardSelectionKey: selectionKey(write) } : {}),
              })
            })
          }, WRITE_DEBOUNCE_MS)
        })
      : () => {}

    return () => {
      live = false
      clearInterval(timer)
      if (writeTimer) {
        clearTimeout(writeTimer)
        useViewerStore.setState({ teamSelectionWritePending: false })
      }
      unsubscribe()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [apiClient])
}
