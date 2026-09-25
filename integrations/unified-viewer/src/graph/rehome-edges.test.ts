// Re-homing contract: every RENDERED node stays reachable from the rest of the
// graph whenever a real chain of containment can supply the link.
//
// Three measured failures shaped this, and each is pinned below:
//
//  1. Hiding an intermediate level strands what is under it — collapse
//     SubComponents and their Details float though the Component is right
//     there. (Condensed view: 181 nodes, 7 floating, all correctly anchored in
//     the DATA with graph_integrity reading 0 orphans.)
//  2. A per-node "has an edge?" test misses ISLANDS. CopiIntegration <->
//     CopiCliWrapper have degree 1 apiece and still float. 13 components in
//     the full view: one of 1408 and twelve strays.
//  3. A single-parent map is the wrong ladder. Four strays had no entry in
//     deriveParents at all (their anchor is `has_insight` from a Project,
//     which that map ignores) and three more had a parent whose own chain was
//     entirely hidden. The real structural edges are the ladder.

import { describe, it, expect } from 'vitest'
import { buildRehomeEdges, ANCHOR_EDGE_TYPES } from './rehome-edges'

const set = (...ids: string[]) => new Set(ids)
const e = (from: string, to: string, type = 'contains') => ({ from, to, type })

describe('buildRehomeEdges', () => {
  it('attaches a stranded node to its nearest visible ancestor', () => {
    // project-comp is the main component; detail hangs off a HIDDEN sub.
    const anchors = [e('project', 'comp'), e('comp', 'sub'), e('sub', 'detail')]
    const edges = buildRehomeEdges(set('project', 'comp', 'detail'), [e('project', 'comp')], anchors)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: 'comp', to: 'detail', type: 'contains', synthetic: true, hops: 2 })
  })

  it('attaches an ISLAND PAIR — the case a degree test misses', () => {
    const anchors = [e('project', 'comp'), e('comp', 'a'), e('a', 'b')]
    const edges = buildRehomeEdges(
      set('project', 'comp', 'a', 'b'),
      [e('project', 'comp'), e('a', 'b')],
      anchors,
    )
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: 'comp', to: 'a' })
  })

  it('follows has_insight — the Project anchor a hierarchy map ignores', () => {
    // This is the exact shape of the four strays deriveParents could not map.
    const anchors = [e('project', 'other'), e('project', 'stray', 'has_insight')]
    const edges = buildRehomeEdges(set('project', 'other', 'stray'), [e('project', 'other')], anchors)
    expect(edges[0]).toMatchObject({ from: 'project', to: 'stray', hops: 1 })
  })

  it('takes a DIFFERENT branch when one ancestor chain dead-ends hidden', () => {
    // stray -> deadSub (hidden, no parent) and stray -> project (visible).
    // A single-parent walk that picked deadSub would find nothing.
    const anchors = [e('project', 'other'), e('deadSub', 'stray'), e('project', 'stray', 'has_insight')]
    const edges = buildRehomeEdges(set('project', 'other', 'stray'), [e('project', 'other')], anchors)
    expect(edges[0]).toMatchObject({ from: 'project', to: 'stray' })
  })

  it('walks up MULTIPLE hidden levels', () => {
    const anchors = [e('root', 'project'), e('project', 'comp'), e('comp', 'sub'), e('sub', 'detail')]
    const edges = buildRehomeEdges(set('root', 'x', 'detail'), [e('root', 'x')], anchors)
    expect(edges[0]).toMatchObject({ from: 'root', to: 'detail', hops: 4 })
  })

  it('ignores provenance edges — they say nothing about containment', () => {
    expect(ANCHOR_EDGE_TYPES.has('mentions')).toBe(false)
    expect(ANCHOR_EDGE_TYPES.has('capturedBy')).toBe(false)
    const anchors = [e('main1', 'main2'), e('main1', 'stray', 'mentions')]
    expect(buildRehomeEdges(set('main1', 'main2', 'stray'), [e('main1', 'main2')], anchors)).toHaveLength(0)
  })

  it('emits nothing when the graph is already one component', () => {
    expect(buildRehomeEdges(set('a', 'b'), [e('a', 'b')], [e('a', 'b')])).toHaveLength(0)
  })

  it('emits nothing when no visible anchor exists — an invented edge would lie', () => {
    expect(buildRehomeEdges(set('a', 'b', 'lone'), [e('a', 'b')], [e('a', 'b')])).toHaveLength(0)
  })

  it('never attaches a component to itself', () => {
    const anchors = [e('main1', 'main2'), e('sub', 'detail')]
    const edges = buildRehomeEdges(
      set('main1', 'main2', 'sub', 'detail'), [e('main1', 'main2'), e('sub', 'detail')], anchors,
    )
    expect(edges).toHaveLength(0)
  })

  it('terminates on an anchor CYCLE instead of hanging the render', () => {
    const cycle = [e('a', 'b'), e('b', 'c'), e('c', 'a'), e('m1', 'm2')]
    expect(buildRehomeEdges(set('a', 'm1', 'm2'), [e('m1', 'm2')], cycle)).toHaveLength(0)
  })

  it('attaches several independent islands', () => {
    const anchors = [e('p', 'main'), e('p', 'i1', 'has_insight'), e('p', 'i2', 'has_insight')]
    const edges = buildRehomeEdges(set('p', 'main', 'i1', 'i2'), [e('p', 'main')], anchors)
    expect(edges.map((x) => x.to).sort()).toEqual(['i1', 'i2'])
  })

  it('is deterministic regardless of input order', () => {
    const anchors = [e('p', 'main'), e('p', 'a', 'has_insight'), e('p', 'b', 'has_insight')]
    const first = buildRehomeEdges(set('p', 'main', 'a', 'b'), [e('p', 'main')], anchors)
    const again = buildRehomeEdges(set('b', 'a', 'main', 'p'), [e('p', 'main')], [...anchors].reverse())
    expect(first).toEqual(again)
  })

  it('ignores edges pointing at hidden nodes when forming components', () => {
    const anchors = [e('comp', 'detail'), e('comp', 'other')]
    const edges = buildRehomeEdges(set('comp', 'other', 'detail'), [e('comp', 'ghost'), e('comp', 'other')], anchors)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: 'comp', to: 'detail' })
  })
})

describe('buildRehomeEdges — explicit placements are part of the ladder', () => {
  // A row placed by writing `metadata.parentId` has a parent in the tree and
  // NO edge on the canvas. Before the caller fed placements in, such a row was
  // a stray component with an empty `anchorsOf`, so nothing was emitted and it
  // rendered as a free-floating dot while every count called it attributed.
  // `explicitPlacementEdges` (hierarchy-parents.ts) supplies the missing rung.
  test('an edgeless placed row attaches to its recorded parent', () => {
    const placement = e('comp', 'orphan') // what explicitPlacementEdges emits
    const edges = buildRehomeEdges(
      set('project', 'comp', 'orphan'),
      [e('project', 'comp')],                       // drawn: orphan is alone
      [e('project', 'comp'), placement],            // ladder: includes it
    )
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: 'comp', to: 'orphan', synthetic: true, hops: 1 })
  })

  test('without the placement in the ladder it stays adrift — the bug this fixes', () => {
    expect(buildRehomeEdges(
      set('project', 'comp', 'orphan'),
      [e('project', 'comp')],
      [e('project', 'comp')],
    )).toHaveLength(0)
  })

  test('a placement whose parent is HIDDEN still reaches a visible ancestor', () => {
    // The walk climbs through hidden endpoints, so a row placed under a
    // collapsed Detail attaches to whatever is visible above it rather than
    // being dropped.
    const edges = buildRehomeEdges(
      set('project', 'orphan'),                     // `comp` is hidden
      [],
      [e('project', 'comp'), e('comp', 'orphan')],
    )
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: 'project', to: 'orphan', hops: 2 })
  })

  test('a row with a REAL edge is unaffected — no duplicate synthetic edge', () => {
    // Placements are anchors, not evidence: a row that already draws an edge
    // is in the main component and must not also acquire a synthetic one.
    expect(buildRehomeEdges(
      set('project', 'comp', 'child'),
      [e('project', 'comp'), e('comp', 'child')],
      [e('project', 'comp'), e('comp', 'child'), e('comp', 'child')],
    )).toHaveLength(0)
  })
})
