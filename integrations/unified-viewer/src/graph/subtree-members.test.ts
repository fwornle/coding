// What a hierarchy row resolves to when it is clicked.
//
// The rule these tests pin is the one that makes the SAME resolver serve both
// spines: members = the row + its subtree + the code-tree ancestors of all of
// them. For the code tree the ancestor walk only adds the chain above the
// clicked row; for the intent tree it is the entire point, because an Insight's
// parent chain IS its code placement.

import { describe, it, expect } from 'vitest'
import { resolveSubtreeMembers, type SubtreeNode } from './subtree-members'

const node = (id: string, children: SubtreeNode[] = []): SubtreeNode => ({ id, children })

// s1 ─ p1 ─ c1 ─ sc1 ─ d1
//            └─ c2
const CODE_PARENTS = new Map<string, string>([
  ['p1', 's1'],
  ['c1', 'p1'],
  ['c2', 'p1'],
  ['sc1', 'c1'],
  ['d1', 'sc1'],
])

describe('resolveSubtreeMembers', () => {
  it('a leaf resolves to itself plus its ancestor chain', () => {
    const members = resolveSubtreeMembers(node('d1'), CODE_PARENTS)
    expect([...members].sort()).toEqual(['c1', 'd1', 'p1', 's1', 'sc1'])
  })

  it('an inner row resolves to its subtree AND the chain above it', () => {
    const c1 = node('c1', [node('sc1', [node('d1')])])
    const members = resolveSubtreeMembers(c1, CODE_PARENTS)
    // Subtree: c1, sc1, d1. Anchors: p1, s1. NOT the sibling branch c2 — this
    // is a focus filter, and a sibling is exactly what it is focusing away from.
    expect([...members].sort()).toEqual(['c1', 'd1', 'p1', 's1', 'sc1'])
    expect(members.has('c2')).toBe(false)
  })

  it('the root of the tree resolves to the tree and adds nothing above it', () => {
    const s1 = node('s1', [node('p1', [node('c2')])])
    const members = resolveSubtreeMembers(s1, CODE_PARENTS)
    expect([...members].sort()).toEqual(['c2', 'p1', 's1'])
  })

  it('an intent row pulls in its insights AND the code they were learned in', () => {
    // The intent spine's children are Insights, which the code tree has placed
    // under Components. Neither tree knows the other; the resolver is where
    // they meet, and this is the join the intent row's evidence subtitle names.
    const parents = new Map<string, string>([
      ...CODE_PARENTS,
      ['i-a', 'c1'],
      ['i-b', 'c2'],
    ])
    const intent = node('intent-1', [node('i-a'), node('i-b')])
    const members = resolveSubtreeMembers(intent, parents)
    expect([...members].sort()).toEqual(
      ['c1', 'c2', 'i-a', 'i-b', 'intent-1', 'p1', 's1'],
    )
    // The Intent itself is a real entity and stays on the canvas — it is the
    // node the insights hang off.
    expect(members.has('intent-1')).toBe(true)
    // Nothing under the code it touches comes along: this is "the goal and the
    // code it touched", not "the goal and everything in that code".
    expect(members.has('sc1')).toBe(false)
    expect(members.has('d1')).toBe(false)
  })

  it('an empty parent map degrades to the bare subtree rather than failing', () => {
    const members = resolveSubtreeMembers(node('c1', [node('sc1')]), new Map())
    expect([...members].sort()).toEqual(['c1', 'sc1'])
  })

  it('a parent cycle terminates instead of hanging the tab', () => {
    // deriveParents already breaks cycles; this runs on a click, and a future
    // writer emitting a both-ways `contains` must not freeze the rail.
    const cyclic = new Map<string, string>([['a', 'b'], ['b', 'a']])
    const members = resolveSubtreeMembers(node('a'), cyclic)
    expect([...members].sort()).toEqual(['a', 'b'])
  })

  it('a cycle in the rendered children terminates too', () => {
    const a: SubtreeNode = { id: 'a', children: [] }
    const b: SubtreeNode = { id: 'b', children: [a] }
    ;(a.children as SubtreeNode[]).push(b)
    expect([...resolveSubtreeMembers(a, new Map())].sort()).toEqual(['a', 'b'])
  })
})
