// TeamsFilter — render + store wiring.
//
// The grouping shape is covered by team-groups.test.ts; what this file locks is
// the part that talks to the store and the DOM: the two `selectedTeams`
// sentinels surviving group-level operations, Views starting collapsed, and the
// registry arriving over the wire rather than being hardcoded.

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { useViewerStore } from '@/store/viewer-store'
import type { ApiClient, Entity, TeamRegistry } from '@/api/ApiClient'
import { TeamsFilter } from './TeamsFilter'

const REGISTRY: TeamRegistry = {
  teams: [
    { id: 'coding', label: 'Coding', kind: 'project', description: '' },
    { id: 'ui', label: 'UI', kind: 'project', description: '' },
    { id: 'raas', label: 'RaaS', kind: 'team', description: '' },
    { id: 'resi', label: 'ReSi', kind: 'team', description: '' },
  ],
  viewGroups: [
    { id: 'kgbench', label: 'Kgbench', match: '^kgbench(-tree-.*)?$', description: '' },
  ],
}

function ent(id: string, team?: string): Entity {
  return { id, name: id, ontologyClass: 'Insight', metadata: team ? { team } : {} } as unknown as Entity
}

const ENTITIES: readonly Entity[] = [
  ent('a', 'coding'),
  ent('b', 'coding'),
  ent('c', 'ui'),
  ent('d', 'a2a'),
  ent('e', 'kgbench-tree-hOMRUf'),
  ent('f', 'kgbench-tree-ncw6IQ'),
]

const renderFilter = (props: Partial<React.ComponentProps<typeof TeamsFilter>> = {}) =>
  render(<TeamsFilter entities={ENTITIES} registry={REGISTRY} {...props} />)

describe('TeamsFilter', () => {
  beforeEach(() => {
    useViewerStore.setState({ selectedTeams: new Set<string>() })
    cleanup()
  })

  test('renders the three groups', () => {
    renderFilter()
    expect(screen.getByTestId('filter-team-group-projects')).toBeInTheDocument()
    expect(screen.getByTestId('filter-team-group-teams')).toBeInTheDocument()
    expect(screen.getByTestId('filter-team-group-views')).toBeInTheDocument()
  })

  test('Projects and Teams are open, Views is collapsed by default', () => {
    renderFilter()
    expect(screen.getByTestId('filter-team-group-toggle-projects')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByTestId('filter-team-group-toggle-views')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    // Views is the unbounded half — its rows must not render until asked for.
    expect(screen.queryByTestId('filter-team-a2a')).not.toBeInTheDocument()
    expect(screen.getByTestId('filter-team-coding')).toBeInTheDocument()
  })

  test('expanding Views reveals the Kgbench subgroup, itself collapsed', () => {
    renderFilter()
    fireEvent.click(screen.getByTestId('filter-team-group-toggle-views'))
    expect(screen.getByTestId('filter-team-a2a')).toBeInTheDocument()
    expect(screen.getByTestId('filter-team-group-kgbench')).toBeInTheDocument()
    expect(screen.queryByTestId('filter-team-kgbench-tree-hOMRUf')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('filter-team-group-toggle-kgbench'))
    expect(screen.getByTestId('filter-team-kgbench-tree-hOMRUf')).toBeInTheDocument()
    expect(screen.getByTestId('filter-team-kgbench-tree-ncw6IQ')).toBeInTheDocument()
  })

  test('a collapsed group advertises the count of everything beneath it', () => {
    renderFilter()
    // 1 loose (a2a) + 2 kgbench trees
    expect(screen.getByTestId('filter-team-group-count-views').textContent).toBe('(3)')
    expect(screen.getByTestId('filter-team-group-count-projects').textContent).toBe('(3)')
  })

  test('a registry team with no entities still renders', () => {
    renderFilter()
    expect(screen.getByTestId('filter-team-raas')).toBeInTheDocument()
  })

  test('empty selectedTeams renders every box checked (the "all" sentinel)', () => {
    renderFilter()
    const coding = screen.getByTestId('filter-team-coding').querySelector('button')
    expect(coding).toHaveAttribute('data-state', 'checked')
  })

  test('clicking one team from the "all" sentinel unchecks only that team', () => {
    // The 2026-06-11 regression: an unqualified toggle produced a one-element
    // set, deselecting every team the user did not click.
    renderFilter()
    fireEvent.click(screen.getByTestId('filter-team-coding').querySelector('button')!)
    const sel = useViewerStore.getState().selectedTeams
    expect(sel.has('coding')).toBe(false)
    expect(sel.has('ui')).toBe(true)
    expect(sel.has('raas')).toBe(true)
    expect(sel.has('kgbench-tree-hOMRUf')).toBe(true)
  })

  test('group "none" clears only that group', () => {
    renderFilter()
    fireEvent.click(screen.getByLabelText('Clear all in Projects'))
    const sel = useViewerStore.getState().selectedTeams
    expect(sel.has('coding')).toBe(false)
    expect(sel.has('ui')).toBe(false)
    expect(sel.has('raas')).toBe(true)
    expect(sel.has('a2a')).toBe(true)
  })

  test('group "all" re-adds only that group', () => {
    useViewerStore.setState({ selectedTeams: new Set(['__none__']) })
    renderFilter()
    fireEvent.click(screen.getByLabelText('Select all in Projects'))
    const sel = useViewerStore.getState().selectedTeams
    expect([...sel].sort()).toEqual(['coding', 'ui'])
  })

  test('group "none" on Views clears its nested subgroup members too', () => {
    renderFilter()
    fireEvent.click(screen.getByLabelText('Clear all in Views'))
    const sel = useViewerStore.getState().selectedTeams
    expect(sel.has('kgbench-tree-hOMRUf')).toBe(false)
    expect(sel.has('kgbench-tree-ncw6IQ')).toBe(false)
    expect(sel.has('a2a')).toBe(false)
    expect(sel.has('coding')).toBe(true)
  })

  test('the rail-level All / None sentinels are preserved', () => {
    renderFilter()
    fireEvent.click(screen.getByLabelText('Clear teams'))
    expect([...useViewerStore.getState().selectedTeams]).toEqual(['__none__'])
    fireEvent.click(screen.getByLabelText('Select all teams'))
    expect(useViewerStore.getState().selectedTeams.size).toBe(0)
  })

  test('fetches the registry from the client when none is passed', async () => {
    const listTeams = vi.fn().mockResolvedValue(REGISTRY)
    render(<TeamsFilter entities={ENTITIES} apiClient={{ listTeams } as unknown as ApiClient} />)
    await waitFor(() => expect(screen.getByTestId('filter-team-group-projects')).toBeInTheDocument())
    expect(listTeams).toHaveBeenCalledOnce()
  })

  test('with no registry available, every team renders as a view', async () => {
    // The OKB backend does not mount /api/teams; listTeams resolves empty
    // rather than rejecting, and the rail falls back to the pre-registry shape.
    const listTeams = vi.fn().mockResolvedValue({ teams: [], viewGroups: [] })
    render(<TeamsFilter entities={ENTITIES} apiClient={{ listTeams } as unknown as ApiClient} />)
    await waitFor(() => expect(screen.getByTestId('filter-team-group-views')).toBeInTheDocument())
    expect(screen.queryByTestId('filter-team-group-projects')).not.toBeInTheDocument()
  })
})
