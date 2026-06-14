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

function makeDeps(extra?: { neighborsResponse?: { entity: Entity; neighbors: Entity[]; relations: Relation[] } }) {
  const setStoreSpy = vi.fn()
  const setHoveredSpy = vi.fn()
  const onMutated = vi.fn()
  const getNeighborsSpy = vi
    .fn()
    .mockResolvedValue(
      extra?.neighborsResponse ?? {
        entity: entities[0],
        neighbors: [],
        relations: [],
      },
    )
  const graph = buildGraph(entities, relations, ontology, 'dark')
  return {
    graph,
    apiClient: { getNeighbors: getNeighborsSpy } as never,
    getOntology: () => ontology,
    getTheme: () => 'dark' as const,
    setStore: setStoreSpy,
    setHoveredNode: setHoveredSpy,
    onGraphMutated: onMutated,
    spies: { setStoreSpy, setHoveredSpy, onMutated, getNeighborsSpy },
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

  test('handleDoubleClickNode calls apiClient.getNeighbors(node, 1) exactly once', async () => {
    const d = makeDeps({
      neighborsResponse: {
        entity: entities[0],
        neighbors: [{ id: 'c', name: 'Gamma', ontologyClass: 'Observation' }],
        relations: [{ from: 'a', to: 'c', type: 'derives_from' }],
      },
    })
    const h = makeEventHandlers(d)
    const added = await h.handleDoubleClickNode('a')
    expect(d.spies.getNeighborsSpy).toHaveBeenCalledTimes(1)
    expect(d.spies.getNeighborsSpy).toHaveBeenCalledWith('a', 1)
    expect(added).toBe(1)
    expect(d.graph.order).toBe(3) // a, b, c
  })

  test('T-45-02-04: second double-click on same node does NOT grow graph.order', async () => {
    // First expansion adds c; second expansion returns same c; graph.order stays 3
    const sameNeighbors = {
      entity: entities[0],
      neighbors: [{ id: 'c', name: 'Gamma', ontologyClass: 'Observation' }],
      relations: [{ from: 'a', to: 'c', type: 'derives_from' }],
    }
    const d = makeDeps({ neighborsResponse: sameNeighbors })
    const h = makeEventHandlers(d)
    await h.handleDoubleClickNode('a')
    const orderAfterFirst = d.graph.order
    expect(orderAfterFirst).toBe(3)
    const addedSecond = await h.handleDoubleClickNode('a')
    expect(addedSecond).toBe(0) // idempotent
    expect(d.graph.order).toBe(orderAfterFirst)
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
