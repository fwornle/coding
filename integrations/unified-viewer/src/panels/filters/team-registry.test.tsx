// team-registry — the two-way team-selection sync and its "nothing changed,
// nothing written" rule. The first version wrote fresh objects into the store
// on every 15s poll and the graph redrew each time; these tests count store
// writes, not just values.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useViewerStore } from '@/store/viewer-store'
import type { TeamRegistry } from '@/api/ApiClient'
import { applyTeamRegistry, activeFor, useTeamRegistry, WRITE_DEBOUNCE_MS } from './team-registry'

const REG = (active: string[]): TeamRegistry => ({
  teams: [
    { id: 'coding', label: 'Coding', kind: 'project', description: '', projects: ['coding', 'km-core'] },
    { id: 'raas', label: 'RaaS', kind: 'team', description: '' },
    { id: 'work', label: 'work', kind: 'team', description: '' },
  ],
  viewGroups: [],
  scope: 'coding',
  active,
})

const reset = () =>
  useViewerStore.setState({
    selectedTeams: new Set<string>(), teamScope: null, teamProjects: {}, teamRegistry: null,
    dashboardSelectionKey: null, teamSelectionLocalAt: 0, teamSelectionWritePending: false,
  })

function countWrites() {
  let n = 0
  const off = useViewerStore.subscribe(() => { n += 1 })
  return { get: () => n, off }
}

describe('applyTeamRegistry', () => {
  beforeEach(reset)

  test('re-reading an unchanged registry writes nothing to the store', () => {
    applyTeamRegistry(REG(['coding']))
    const writes = countWrites()
    applyTeamRegistry(REG(['coding']))            // a poll: new objects, same content
    applyTeamRegistry(REG(['coding']), Date.now())
    expect(writes.get()).toBe(0)
    writes.off()
  })

  test('a changed dashboard selection is adopted; the rest stays the same objects', () => {
    applyTeamRegistry(REG(['coding']))
    const projects = useViewerStore.getState().teamProjects
    applyTeamRegistry(REG(['raas']))
    expect([...useViewerStore.getState().selectedTeams]).toEqual(['raas'])
    expect(useViewerStore.getState().teamProjects).toBe(projects)
  })

  test('an answer requested before the latest rail click is ignored', () => {
    applyTeamRegistry(REG(['coding']))
    const before = Date.now() - 10
    useViewerStore.setState({ selectedTeams: new Set(['raas']), teamSelectionLocalAt: Date.now() })
    applyTeamRegistry(REG(['work']), before)
    expect([...useViewerStore.getState().selectedTeams]).toEqual(['raas'])
  })
})

describe('activeFor — what a rail selection writes as `active:`', () => {
  test('all → [], none → nothing, views are not teams', () => {
    const reg = REG([])
    expect(activeFor(new Set(), reg)).toEqual([])
    expect(activeFor(new Set(['__none__']), reg)).toBeNull()
    expect(activeFor(new Set(['raas', 'kgbench-tree-1', 'coding']), reg)).toEqual(['coding', 'raas'])
    expect(activeFor(new Set(['kgbench-tree-1']), reg)).toBeNull()
  })
})

describe('useTeamRegistry — viewer → dashboard', () => {
  beforeEach(() => { reset(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); cleanup() })

  function Harness({ client }: { client: Parameters<typeof useTeamRegistry>[0] }) {
    useTeamRegistry(client)
    return null
  }

  test('a rail click is written back once (debounced), and its echo changes nothing', async () => {
    let dashboard = ['coding']
    const listTeams = vi.fn(async () => REG(dashboard))
    const setActiveTeams = vi.fn(async (a: string[]) => { dashboard = a; return true })
    render(<Harness client={{ listTeams, setActiveTeams }} />)
    await act(async () => { await Promise.resolve() })
    expect([...useViewerStore.getState().selectedTeams]).toEqual(['coding'])

    act(() => { useViewerStore.setState({ selectedTeams: new Set(['coding', 'raas']) }) })
    act(() => { useViewerStore.setState({ selectedTeams: new Set(['coding', 'raas', 'work']) }) })
    await act(async () => { vi.advanceTimersByTime(WRITE_DEBOUNCE_MS + 10); await Promise.resolve() })
    expect(setActiveTeams).toHaveBeenCalledTimes(1)
    expect(setActiveTeams).toHaveBeenCalledWith(['coding', 'raas', 'work'])

    // The echo: the server now says what the rail wrote. Only the registry
    // object (the rail's "Dashboard selection" line) may change — nothing the
    // canvases read: same selection, scope and project map, same objects.
    const before = useViewerStore.getState()
    vi.advanceTimersByTime(1)
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); await Promise.resolve() })
    expect(listTeams.mock.calls.length).toBeGreaterThan(1)
    const after = useViewerStore.getState()
    expect(after.selectedTeams).toBe(before.selectedTeams)
    expect(after.teamProjects).toBe(before.teamProjects)
    expect(after.teamScope).toBe(before.teamScope)
    expect(after.teamRegistry?.active).toEqual(['coding', 'raas', 'work'])

    // …and a further unchanged poll writes nothing at all.
    const writes = countWrites()
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); await Promise.resolve() })
    expect(writes.get()).toBe(0)
    writes.off()
  })
})
