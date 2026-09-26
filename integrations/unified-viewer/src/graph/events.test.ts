// Pure event-handler factory tests. No sigma context — tests the closures.

import { describe, test, expect, vi } from 'vitest'
import { makeEventHandlers } from './events'
import { buildGraph } from './graph-builder'
import type { Entity, OntologyClass, Relation } from './types'

const ontology: OntologyClass[] = [{ name: 'Observation' }]
const entities: Entity[] = [
  { id: 'a', name: 'Alpha', ontologyClass: 'Observation' },
  { id: 'b', name: 'Beta', ontologyClass: 'Observation' },
]
const relations: Relation[] = [{ from: 'a', to: 'b', type: 'derives_from' }]

function makeDeps(extra?: {
  /** The loaded relation set the 1-hop expand reads. */
  loadedRelations?: Relation[]
}) {
  const setStoreSpy = vi.fn()
  const setHoveredSpy = vi.fn()
  const onMutated = vi.fn()
  const graph = buildGraph(entities, relations, ontology, 'dark')
  return {
    graph,
    getLoadedRelations: () => extra?.loadedRelations ?? relations,
    setStore: setStoreSpy,
    setHoveredNode: setHoveredSpy,
    onGraphMutated: onMutated,
    spies: { setStoreSpy, setHoveredSpy, onMutated },
  }
}

describe('event handlers', () => {
  test('handleClickNode sets focalNodeId + selectedNodeIds (Phase 56.1 multi-set)', () => {
    const d = makeDeps()
    const h = makeEventHandlers(d)
    h.handleClickNode('a')
    expect(d.spies.setStoreSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        focalNodeId: 'a',
        selectedNodeIds: expect.any(Set),
      }),
    )
    const call = d.spies.setStoreSpy.mock.calls[0][0] as { selectedNodeIds: Set<string> }
    expect(call.selectedNodeIds.has('a')).toBe(true)
  })

  test('handleClickStage clears focalNodeId + selectedNodeIds (Phase 56.1 multi-set)', () => {
    const d = makeDeps()
    const h = makeEventHandlers(d)
    h.handleClickStage()
    expect(d.spies.setStoreSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        focalNodeId: null,
        selectedNodeIds: expect.any(Set),
      }),
    )
    const call = d.spies.setStoreSpy.mock.calls[0][0] as { selectedNodeIds: Set<string> }
    expect(call.selectedNodeIds.size).toBe(0)
  })

  test('clicking the same node twice keeps focalNodeId set', () => {
    const d = makeDeps()
    const h = makeEventHandlers(d)
    h.handleClickNode('a')
    h.handleClickNode('a')
    expect(d.spies.setStoreSpy).toHaveBeenCalledTimes(2)
    const c1 = d.spies.setStoreSpy.mock.calls[0][0] as { focalNodeId: string }
    const c2 = d.spies.setStoreSpy.mock.calls[1][0] as { focalNodeId: string }
    expect(c1.focalNodeId).toBe('a')
    expect(c2.focalNodeId).toBe('a')
  })

  // 2026-09-26: the two tests that stood here asserted a server fetch — that
  // `getNeighbors` was called once with ('a', 1), and that a second call was
  // idempotent. Both passed against a SPY for as long as the method existed,
  // which is precisely what made them worthless: no backend has ever mounted
  // `/api/v1/entities/:id/neighbors`. They proved the client built a request,
  // never that anything answered it. The path is gone; what remains below is
  // the client-side expand, which now serves every backend.

  test('T-45-02-04: a second double-click on the same node is idempotent', async () => {
    const d = makeDeps()
    const h = makeEventHandlers(d)
    const first = await h.handleDoubleClickNode('a')
    const orderAfterFirst = d.graph.order
    const second = await h.handleDoubleClickNode('a')
    // The expand derives a selection from the loaded relations rather than
    // adding nodes, so repeating it recomputes the same set.
    expect(second).toBe(first)
    expect(d.graph.order).toBe(orderAfterFirst)
  })

  test('double-click computes the 1-hop neighborhood client-side, for every backend', async () => {
    // Loaded relations a→b mean double-clicking 'a' selects {a, b} from the
    // loaded set. This was the okb-only path until coding's server fetch was
    // found to target a route no backend mounts.
    const d = makeDeps({
      loadedRelations: [{ from: 'a', to: 'b', type: 'derives_from' }],
    })
    const h = makeEventHandlers(d)
    const added = await h.handleDoubleClickNode('a')
    expect(added).toBe(1) // one neighbor (b) in the loaded set
    const call = d.spies.setStoreSpy.mock.calls.at(-1)?.[0] as {
      focalNodeId: string
      selectedNodeIds: Set<string>
    }
    expect(call.focalNodeId).toBe('a')
    expect(call.selectedNodeIds.has('a')).toBe(true)
    expect(call.selectedNodeIds.has('b')).toBe(true)
  })

  test('double-click on a node with no incident loaded relation still selects it (no silent no-op)', async () => {
    const d = makeDeps({
      loadedRelations: [], // no edges loaded
    })
    const h = makeEventHandlers(d)
    const added = await h.handleDoubleClickNode('a')
    expect(added).toBe(0) // no neighbors, but...
    const call = d.spies.setStoreSpy.mock.calls.at(-1)?.[0] as {
      focalNodeId: string
      selectedNodeIds: Set<string>
    }
    expect(call.focalNodeId).toBe('a') // ...the node is still selected — click is visible
    expect(call.selectedNodeIds.has('a')).toBe(true)
  })

  test('handleEnterNode tracks hovered node id', () => {
    const d = makeDeps()
    const h = makeEventHandlers(d)
    h.handleEnterNode('a')
    expect(d.spies.setHoveredSpy).toHaveBeenCalledWith('a')
  })

  test('handleLeaveNode clears hovered node id', () => {
    const d = makeDeps()
    const h = makeEventHandlers(d)
    h.handleLeaveNode()
    expect(d.spies.setHoveredSpy).toHaveBeenCalledWith(null)
  })
})
