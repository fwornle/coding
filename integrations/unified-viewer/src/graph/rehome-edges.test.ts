// Re-homing contract. The invariant these tests protect: a node that is
// RENDERED is never left without a visible neighbour when the hierarchy could
// supply one.
//
// Measured motivation, on the condensed default view: 181 nodes, 7 floating —
// six Details whose only `contains` parent was a collapsed SubComponent, one
// Project whose every child had been archived by the roll-up. All seven were
// correctly anchored in the DATA; the health coordinator read 0 orphans
// throughout. Data connectivity and view connectivity are different problems.

import { describe, it, expect } from 'vitest'
import { buildRehomeEdges } from './rehome-edges'

const set = (...ids: string[]) => new Set(ids)

describe('buildRehomeEdges', () => {
  // Component -> SubComponent -> Detail, with the SubComponent collapsed.
  const parents = new Map([['detail', 'sub'], ['sub', 'comp'], ['comp', 'project']])

  it('attaches a stranded node to its nearest VISIBLE ancestor', () => {
    const edges = buildRehomeEdges(set('comp', 'detail'), set('comp'), parents)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: 'comp', to: 'detail', type: 'contains', synthetic: true })
  })

  it('records the real parent it stands in for, so the substitution is auditable', () => {
    const [edge] = buildRehomeEdges(set('comp', 'detail'), set('comp'), parents)
    expect(edge.rehomedFrom).toBe('sub')
  })

  it('skips a node that already has a drawn edge', () => {
    expect(buildRehomeEdges(set('comp', 'detail'), set('comp', 'detail'), parents)).toHaveLength(0)
  })

  it('walks up MULTIPLE hidden levels', () => {
    // Both sub and comp hidden — attach all the way to the project.
    const edges = buildRehomeEdges(set('project', 'detail'), set('project'), parents)
    expect(edges[0]).toMatchObject({ from: 'project', to: 'detail' })
  })

  it('emits nothing when no ancestor is visible — an invented edge would lie', () => {
    expect(buildRehomeEdges(set('detail'), set(), parents)).toHaveLength(0)
  })

  it('emits nothing for a node no parent claims', () => {
    expect(buildRehomeEdges(set('loner'), set(), parents)).toHaveLength(0)
  })

  it('never attaches a node to itself', () => {
    const selfish = new Map([['x', 'x']])
    expect(buildRehomeEdges(set('x'), set(), selfish)).toHaveLength(0)
  })

  it('terminates on a parent CYCLE instead of hanging the render', () => {
    // deriveParents picks one parent per node but does not prove acyclicity;
    // an unguarded walk would spin forever and take the canvas with it.
    const cycle = new Map([['a', 'b'], ['b', 'c'], ['c', 'a']])
    expect(buildRehomeEdges(set('a'), set(), cycle)).toHaveLength(0)
  })

  it('handles several stranded siblings independently', () => {
    const p = new Map([['d1', 'sub'], ['d2', 'sub'], ['sub', 'comp']])
    const edges = buildRehomeEdges(set('comp', 'd1', 'd2'), set('comp'), p)
    expect(edges.map((e) => e.to).sort()).toEqual(['d1', 'd2'])
    expect(edges.every((e) => e.from === 'comp')).toBe(true)
  })
})
