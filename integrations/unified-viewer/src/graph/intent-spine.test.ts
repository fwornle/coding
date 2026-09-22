// Tests for the intent spine — the second tree.
//
// What each one is here to stop:
//   1-2. The spine reads `aggregates` and nothing else. If it ever also read
//        `contains`, the two trees would merge back into one and the whole
//        point (drop one edge type, revert one tree) would be gone.
//   3.   Heaviest goal first — a reader descending coarse-to-fine needs the
//        top of the list to be what the project actually spent itself on.
//   4.   Duplicate edges are deduped on READ. km-core's addRelation is not
//        idempotent on (from,to,type) and this store has carried 91% duplicate
//        edges before; the viewer must not render one lesson twice.
//   5.   codeEvidence survives to the row — it IS the join between the trees.
//   6.   No Intent entities means an empty spine, not a broken one: the caller
//        distinguishes "not derived" from "derived but empty".
//   7.   An edge to an Insight the store does not hold is skipped, not rendered
//        as a nameless child.

import { describe, it, expect } from 'vitest'
import { buildIntentSpine, INTENT_EDGE } from './intent-spine'
import type { IntentSpineEntity, IntentSpineEdge } from './intent-spine'

const intent = (id: string, name: string, extra: Record<string, unknown> = {}): IntentSpineEntity => ({
  id,
  name,
  ontologyClass: 'Intent',
  metadata: { test: `what belongs in ${name}`, ...extra },
})
const insight = (id: string, name: string): IntentSpineEntity => ({
  id,
  name,
  ontologyClass: 'Insight',
  metadata: {},
})
const agg = (from: string, to: string): IntentSpineEdge => ({ from, to, type: INTENT_EDGE })

describe('buildIntentSpine', () => {
  it('Test 1: aggregates edges build Intent -> Insight', () => {
    const spine = buildIntentSpine(
      [intent('i1', 'Keep services reachable'), insight('n1', 'proxy pin went stale')],
      [agg('i1', 'n1')],
    )
    expect(spine).toHaveLength(1)
    expect(spine[0].name).toBe('Keep services reachable')
    expect(spine[0].descendantCount).toBe(1)
    expect(spine[0].children[0].name).toBe('proxy pin went stale')
    expect(spine[0].children[0].ontologyClass).toBe('Insight')
  })

  it('Test 2: `contains` is the OTHER tree and is ignored here', () => {
    // If this ever passes with a child attached, the two spines have merged.
    const spine = buildIntentSpine(
      [intent('i1', 'Keep services reachable'), insight('n1', 'a lesson')],
      [{ from: 'i1', to: 'n1', type: 'contains' }],
    )
    expect(spine[0].descendantCount).toBe(0)
  })

  it('Test 3: the heaviest intent sorts first, ties broken by name', () => {
    const ents = [
      intent('a', 'Bravo'),
      intent('b', 'Alpha'),
      intent('c', 'Charlie'),
      insight('n1', 'x'),
      insight('n2', 'y'),
      insight('n3', 'z'),
    ]
    const spine = buildIntentSpine(ents, [agg('c', 'n1'), agg('c', 'n2'), agg('a', 'n3')])
    expect(spine.map((n) => n.name)).toEqual(['Charlie', 'Bravo', 'Alpha'])
  })

  it('Test 4: a duplicate edge renders once', () => {
    const spine = buildIntentSpine(
      [intent('i1', 'Goal'), insight('n1', 'lesson')],
      [agg('i1', 'n1'), agg('i1', 'n1'), agg('i1', 'n1')],
    )
    expect(spine[0].descendantCount).toBe(1)
    expect(spine[0].children).toHaveLength(1)
  })

  it('Test 5: codeEvidence and the excludability test reach the node', () => {
    const spine = buildIntentSpine(
      [
        intent('i1', 'Goal', {
          codeEvidence: [
            { component: 'LiveLoggingSystem', insights: 7 },
            { component: 'KnowledgeManagement', insights: 3 },
          ],
        }),
      ],
      [],
    )
    expect(spine[0].codeEvidence).toEqual([
      { component: 'LiveLoggingSystem', insights: 7 },
      { component: 'KnowledgeManagement', insights: 3 },
    ])
    expect(spine[0].test).toBe('what belongs in Goal')
  })

  it('Test 6: no Intent entities yields an empty spine, not a throw', () => {
    expect(buildIntentSpine([insight('n1', 'orphan lesson')], [])).toEqual([])
    expect(buildIntentSpine([], [])).toEqual([])
  })

  it('Test 7: an edge to an absent Insight is skipped rather than rendered nameless', () => {
    const spine = buildIntentSpine([intent('i1', 'Goal')], [agg('i1', 'gone-from-store')])
    expect(spine[0].descendantCount).toBe(0)
  })

  it('Test 8: malformed codeEvidence degrades to empty instead of crashing the row', () => {
    const spine = buildIntentSpine(
      [intent('i1', 'Goal', { codeEvidence: 'not-an-array' })],
      [],
    )
    expect(spine[0].codeEvidence).toEqual([])
  })

  it('Test 9: entityType is honoured when ontologyClass is absent', () => {
    // Wave-emitted rows carry both; some legacy rows carry only entityType.
    const spine = buildIntentSpine(
      [
        { id: 'i1', name: 'Goal', entityType: 'Intent', metadata: {} },
        { id: 'n1', name: 'lesson', entityType: 'Insight', metadata: {} },
      ],
      [agg('i1', 'n1')],
    )
    expect(spine[0].descendantCount).toBe(1)
  })
})
