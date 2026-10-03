// teamOf — the one rule the Teams rail and both canvases share.
//
// The cases that matter are the ones the three previous rules disagreed on:
// `project` without `team` (the rail said 'coding', the Sigma filter said the
// project), and an entity with neither (every reader guessed 'coding', which is
// only the developer's own tenant).

import { describe, test, expect } from 'vitest'
import { teamOf, teamSelected, UNTAGGED_TEAM } from './team-of'

const node = (metadata: Record<string, unknown> | null | undefined) => ({ metadata })

describe('teamOf', () => {
  test('project wins over team', () => {
    expect(teamOf(node({ project: 'a2a-xpr', team: 'general' }), 'coding')).toBe('a2a-xpr')
  })

  test('project alone is the team — not the scope', () => {
    expect(teamOf(node({ project: 'a2a-xpr' }), 'coding')).toBe('a2a-xpr')
  })

  test('team alone is the team', () => {
    expect(teamOf(node({ team: 'raas' }), 'coding')).toBe('raas')
  })

  test('an untagged entity belongs to the installation scope', () => {
    expect(teamOf(node({}), 'acme')).toBe('acme')
    expect(teamOf(node(null), 'acme')).toBe('acme')
    expect(teamOf(node(undefined), 'acme')).toBe('acme')
  })

  test('with no scope known, untagged is untagged — never a guessed tenant', () => {
    expect(teamOf(node({}), null)).toBe(UNTAGGED_TEAM)
  })

  test('empty and non-string values count as absent', () => {
    expect(teamOf(node({ project: '', team: 'raas' }), null)).toBe('raas')
    expect(teamOf(node({ project: 42, team: '' }), 'acme')).toBe('acme')
  })
})

describe('teamSelected — a selected team admits its repos (T6)', () => {
  const teamProjects = { raas: ['raas-api', 'raas-ui'] }

  test('a registry team admits each of its projects, case-insensitively', () => {
    const sel = new Set(['raas'])
    expect(teamSelected('raas-api', sel, teamProjects)).toBe(true)
    expect(teamSelected('RAAS-UI', sel, teamProjects)).toBe(true)
    expect(teamSelected('raas', sel, teamProjects)).toBe(true)
    expect(teamSelected('coding', sel, teamProjects)).toBe(false)
  })

  test('a view (no registry entry) admits exactly itself', () => {
    expect(teamSelected('kgbench-tree-1', new Set(['kgbench-tree-1']), teamProjects)).toBe(true)
    expect(teamSelected('raas-api', new Set(['kgbench-tree-1']), teamProjects)).toBe(false)
  })

  test('without the registry map, the old exact-id rule', () => {
    expect(teamSelected('raas-api', new Set(['raas']), undefined)).toBe(false)
    expect(teamSelected('raas', new Set(['raas']), undefined)).toBe(true)
  })
})
