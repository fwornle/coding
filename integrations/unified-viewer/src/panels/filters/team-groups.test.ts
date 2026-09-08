// Grouping for the Teams / Views rail — the shape, without a DOM.
//
// What matters here: the kind split survives, registry entries are not
// count-gated, dynamic views cluster by rule, and the counts a collapsed group
// advertises are the sum of everything underneath it.

import { describe, test, expect } from 'vitest'
import type { TeamRegistry } from '@/api/ApiClient'
import {
  buildTeamGroups,
  allTeamIds,
  PROJECTS_GROUP,
  TEAMS_GROUP,
  VIEWS_GROUP,
} from './team-groups'

const REGISTRY: TeamRegistry = {
  teams: [
    { id: 'coding', label: 'Coding', kind: 'project', description: '' },
    { id: 'ui', label: 'UI', kind: 'project', description: '' },
    { id: 'normalisa', label: 'Normalisa', kind: 'team', description: '' },
    { id: 'raas', label: 'RaaS', kind: 'team', description: '' },
    { id: 'resi', label: 'ReSi', kind: 'team', description: '' },
  ],
  viewGroups: [
    { id: 'kgbench', label: 'Kgbench', match: '^kgbench(-tree-.*)?$', description: '' },
  ],
}

/** Counts roughly as the live graph has them. */
const COUNTS = new Map<string, number>([
  ['coding', 1280],
  ['ui', 12],
  ['resi', 3],
  ['a2a', 34],
  ['a2a-xpr', 48],
  ['general', 28],
  ['kgbench-tree-XnGqXD', 22],
  ['kgbench-tree-ncw6IQ', 18],
  ['kgbench-tree-hOMRUf', 17],
])

const find = (groups: ReturnType<typeof buildTeamGroups>, id: string) =>
  groups.find((g) => g.id === id)

describe('buildTeamGroups', () => {
  test('splits the registry by kind into Projects and Teams', () => {
    const groups = buildTeamGroups(COUNTS, REGISTRY)
    expect(groups.map((g) => g.id)).toEqual([PROJECTS_GROUP, TEAMS_GROUP, VIEWS_GROUP])
    expect(find(groups, PROJECTS_GROUP)!.rows.map((r) => r.label)).toEqual(['Coding', 'UI'])
    expect(find(groups, TEAMS_GROUP)!.rows.map((r) => r.label)).toEqual([
      'Normalisa',
      'RaaS',
      'ReSi',
    ])
  })

  test('a registry entry with no entities still renders, at count 0', () => {
    // RaaS has no entities in the live graph. A registry that hides its own
    // members until data arrives is not a registry.
    const raas = find(buildTeamGroups(COUNTS, REGISTRY), TEAMS_GROUP)!.rows.find(
      (r) => r.id === 'raas',
    )
    expect(raas).toBeDefined()
    expect(raas!.count).toBe(0)
  })

  test('uses the registry spelling for labels, the graph spelling for ids', () => {
    const resi = find(buildTeamGroups(COUNTS, REGISTRY), TEAMS_GROUP)!.rows.find(
      (r) => r.id === 'resi',
    )!
    expect(resi.label).toBe('ReSi')
    expect(resi.count).toBe(3)
  })

  test('kgbench-tree teams cluster into one Kgbench subgroup', () => {
    const views = find(buildTeamGroups(COUNTS, REGISTRY), VIEWS_GROUP)!
    expect(views.subgroups.map((g) => g.id)).toEqual(['kgbench'])
    const kg = views.subgroups[0]
    expect(kg.label).toBe('Kgbench')
    expect(kg.rows.map((r) => r.id).sort()).toEqual([
      'kgbench-tree-XnGqXD',
      'kgbench-tree-hOMRUf',
      'kgbench-tree-ncw6IQ',
    ])
    // and none of them leaked into the ungrouped rows
    expect(views.rows.map((r) => r.id)).toEqual(['a2a', 'a2a-xpr', 'general'])
  })

  test('the bare kgbench anchor team folds into the same subgroup', () => {
    const counts = new Map(COUNTS)
    counts.set('kgbench', 1)
    const views = find(buildTeamGroups(counts, REGISTRY), VIEWS_GROUP)!
    expect(views.subgroups[0].rows.map((r) => r.id)).toContain('kgbench')
  })

  test('group total sums its own rows and its subgroups', () => {
    const views = find(buildTeamGroups(COUNTS, REGISTRY), VIEWS_GROUP)!
    // 34 + 48 + 28 loose, 22 + 18 + 17 under Kgbench
    expect(views.subgroups[0].total).toBe(57)
    expect(views.total).toBe(167)
    expect(find(buildTeamGroups(COUNTS, REGISTRY), PROJECTS_GROUP)!.total).toBe(1292)
  })

  test('memberIds covers rows and nested subgroup rows', () => {
    const views = find(buildTeamGroups(COUNTS, REGISTRY), VIEWS_GROUP)!
    expect(views.memberIds).toHaveLength(6)
    expect(views.memberIds).toContain('kgbench-tree-hOMRUf')
    expect(views.memberIds).toContain('a2a')
  })

  test('an empty registry degrades to a single Views group', () => {
    const groups = buildTeamGroups(COUNTS, { teams: [], viewGroups: [] })
    expect(groups.map((g) => g.id)).toEqual([VIEWS_GROUP])
    // every team the data mentions, ungrouped — the pre-registry behaviour
    expect(groups[0].rows).toHaveLength(COUNTS.size)
    expect(groups[0].subgroups).toEqual([])
  })

  test('a rule whose regex will not compile is skipped, its members stay loose', () => {
    const groups = buildTeamGroups(COUNTS, {
      teams: REGISTRY.teams,
      viewGroups: [{ id: 'bad', label: 'Bad', match: '^[unclosed', description: '' }],
    })
    const views = find(groups, VIEWS_GROUP)!
    expect(views.subgroups).toEqual([])
    expect(views.rows.map((r) => r.id)).toContain('kgbench-tree-hOMRUf')
  })

  test('the first matching rule wins', () => {
    const groups = buildTeamGroups(new Map([['kgbench-tree-x', 1]]), {
      teams: [],
      viewGroups: [
        { id: 'first', label: 'First', match: '^kgbench', description: '' },
        { id: 'second', label: 'Second', match: '^kgbench-tree', description: '' },
      ],
    })
    const views = find(groups, VIEWS_GROUP)!
    expect(views.subgroups.map((g) => g.id)).toEqual(['first'])
  })

  test('a subgroup with no members is omitted', () => {
    const groups = buildTeamGroups(new Map([['a2a', 1]]), REGISTRY)
    expect(find(groups, VIEWS_GROUP)!.subgroups).toEqual([])
  })

  test('rows are sorted by label within each group', () => {
    const views = find(buildTeamGroups(COUNTS, REGISTRY), VIEWS_GROUP)!
    expect(views.rows.map((r) => r.label)).toEqual([...views.rows.map((r) => r.label)].sort())
  })
})

describe('allTeamIds', () => {
  test('is the flat union across groups and nested subgroups', () => {
    const ids = allTeamIds(buildTeamGroups(COUNTS, REGISTRY))
    // 5 registry entries + 3 loose views + 3 kgbench trees
    expect(ids).toHaveLength(11)
    expect(new Set(ids).size).toBe(11)
    expect(ids).toContain('raas')
    expect(ids).toContain('kgbench-tree-ncw6IQ')
  })
})
