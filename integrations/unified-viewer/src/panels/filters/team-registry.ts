// The team registry (obs-api GET /api/teams) kept live in the store.
//
// Was fetched once by TeamsFilter, which only exists while the rail's Scope
// section is open — so with Scope collapsed (its default) the canvases never
// learned the registry's scope or team→project map, and the dashboard's team
// selection never reached the viewer at all. And once fetched it never
// changed: choosing teams in Dashboard → Teams needed a page reload here.
//
// Now the viewer core mounts useTeamRegistry: it fetches on mount, whenever
// the window regains focus (the usual path — you come back from the
// dashboard tab) and every POLL_MS while visible, and applyTeamRegistry
// publishes the result.
//
// SELECTION RULE. The dashboard's selection (`active:`) is where the rail
// starts, and a CHANGE to it is a newer, explicit choice — the rail adopts it.
// Between changes the rail's own clicks rule: re-reading an unchanged
// selection never undoes them.

import { useEffect } from 'react'
import { useViewerStore } from '@/store/viewer-store'
import type { ApiClient, TeamRegistry } from '@/api/ApiClient'
import { EMPTY_TEAM_REGISTRY } from '@/api/ApiClient'

export const POLL_MS = 15_000

/** A stable key for a selection: sorted ids ('' = all teams). */
function selectionKey(active: readonly string[]): string {
  return [...active].sort().join(',')
}

/** Publish a registry to the store and follow the dashboard's selection. */
export function applyTeamRegistry(registry: TeamRegistry): void {
  const state = useViewerStore.getState()
  const active = registry.active ?? EMPTY_TEAM_REGISTRY.active
  const key = selectionKey(active)
  const projects: Record<string, string[]> = {}
  for (const t of registry.teams) if (t.projects?.length) projects[t.id] = t.projects

  const patch: Partial<ReturnType<typeof useViewerStore.getState>> = {
    teamRegistry: registry,
    teamScope: registry.scope,
    teamProjects: projects,
    dashboardSelectionKey: key,
  }
  if (state.dashboardSelectionKey === null) {
    // First read: start from the dashboard's selection unless the rail was
    // already used before the registry arrived.
    if (state.selectedTeams.size === 0 && active.length) patch.selectedTeams = new Set(active)
  } else if (state.dashboardSelectionKey !== key) {
    patch.selectedTeams = active.length ? new Set(active) : new Set()
  }
  useViewerStore.setState(patch)
}

/** Keep the registry live for as long as the viewer is mounted. */
export function useTeamRegistry(apiClient: Pick<ApiClient, 'listTeams'> | undefined): void {
  useEffect(() => {
    if (!apiClient) return
    let live = true
    // listTeams never rejects — an unavailable registry (the OKB backend does
    // not mount the route) degrades to "every team is a view".
    const refresh = () => {
      void apiClient.listTeams().then((r) => {
        if (live) applyTeamRegistry(r)
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
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [apiClient])
}
