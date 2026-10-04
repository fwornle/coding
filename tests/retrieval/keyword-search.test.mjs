/**
 * Keyword search over the km-core store (src/retrieval/keyword-search.js).
 *
 * It used to read the archived SQLite file and return [] for every query, so
 * injection had nothing but Qdrant — and a machine with an empty Qdrant (a
 * teammate's fresh clone, T8) injected nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Graph from 'graphology';

import { KeywordSearch, queryTerms } from '../../src/retrieval/keyword-search.js';
import { keyToUuid } from '../../dist/embedding/point-id.js';

function store(entities) {
  const graph = new Graph();
  for (const e of entities) graph.addNode(e.id, e);
  return { graph };
}

const insight = (id, topic, summary, project = 'coding', extra = {}) => ({
  id, name: topic, entityType: 'Insight', description: summary, updatedAt: '2026-10-01T00:00:00Z',
  metadata: { topic, summary, confidence: 0.9, project }, ...extra,
});
const component = (id, name, description, project = 'coding') => ({
  id, name, entityType: 'Component', description, updatedAt: '2026-10-01T00:00:00Z', metadata: { project },
});

const entities = [
  insight('i-osprey', 'Osprey Queue Backpressure', 'The osprey queue applies backpressure once 512 messages are in flight.'),
  insight('i-heron', 'Heron Cache Eviction', 'The heron cache evicts entries after 41 minutes of idleness.'),
  insight('i-raas', 'Osprey Queue in RaaS', 'The osprey queue in raas backs off on overload.', 'raas-api'),
  component('c-queue', 'OspreyQueue', 'Message queue with backpressure for upstream writers.'),
  { id: 'o-1', name: 'obs', entityType: 'Observation', description: 'osprey queue backpressure observed', metadata: { project: 'coding' } },
  { id: 's-1', name: 'scaffold', entityType: 'Component', isScaffoldNode: true, description: 'osprey queue backpressure', metadata: { project: 'coding' } },
];

test('a natural-language prompt finds the insight by its terms, with the id Qdrant uses', () => {
  const hits = new KeywordSearch().search(store(entities), 'At how many in-flight messages does the osprey queue apply backpressure?');
  const insights = hits.filter((h) => h.tier === 'insights');
  assert.equal(insights[0].id, 'i-osprey', 'node key, as the backfill keys the insights collection');
  assert.match(insights[0].payload.summary_preview, /512 messages/);
  assert.equal(insights[0].payload.project, 'coding');
  const kg = hits.filter((h) => h.tier === 'kg_entities');
  assert.deepEqual(kg.map((h) => h.id), [keyToUuid('c-queue')], 'keyToUuid(key), as kg_entities is keyed');
  assert.ok(!hits.some((h) => h.id === 'i-heron'), 'one shared stop-word-free term is not enough');
});

test('observations, digests and scaffold nodes are not searched', () => {
  const ids = new KeywordSearch().search(store(entities), 'osprey queue backpressure').map((h) => h.id);
  assert.ok(!ids.includes('o-1') && !ids.includes(keyToUuid('o-1')));
  assert.ok(!ids.includes(keyToUuid('s-1')));
});

test('the project filter applies before the per-tier limit', () => {
  const many = [...entities];
  for (let i = 0; i < 15; i++) many.push(insight(`r-${i}`, `Osprey queue note ${i}`, 'osprey queue backpressure tuning', 'raas-api'));
  const hits = new KeywordSearch({ limit: 5 }).search(store(many), 'osprey queue backpressure', { projects: ['coding'] });
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.payload.project === 'coding'));
  assert.ok(hits.some((h) => h.id === 'i-osprey'));
});

test('a changed entity is re-read; a removed one is forgotten', () => {
  const s = store(entities);
  const ks = new KeywordSearch();
  assert.ok(ks.search(s, 'heron cache eviction').some((h) => h.id === 'i-heron'));
  s.graph.mergeNodeAttributes('i-heron', { updatedAt: '2026-10-02T00:00:00Z', metadata: { topic: 'Kestrel Cache', summary: 'kestrel cache eviction', project: 'coding' } });
  assert.ok(!ks.search(s, 'heron idleness minutes').some((h) => h.id === 'i-heron'), 'old text gone');
  const hit = ks.search(s, 'kestrel cache eviction').find((h) => h.id === 'i-heron');
  assert.equal(hit?.payload.topic, 'Kestrel Cache');
  s.graph.dropNode('i-heron');
  ks.search(s, 'kestrel cache');
  assert.equal(ks._docs.has('i-heron'), false);
});

test('no store, no query, or only stop words: nothing', () => {
  const ks = new KeywordSearch();
  assert.deepEqual(ks.search(null, 'osprey'), []);
  assert.deepEqual(ks.search(store(entities), ''), []);
  assert.deepEqual(ks.search(store(entities), 'how does the project use it'), []);
  assert.deepEqual([...queryTerms('How does the Osprey-queue work?')], ['osprey', 'queue', 'work']);
});
