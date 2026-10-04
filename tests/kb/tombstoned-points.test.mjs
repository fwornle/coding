/**
 * src/embedding/tombstones.ts — the Qdrant points a deletion leaves behind (T8).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tombstonedPointIds } from '../../dist/embedding/tombstones.js';
import { keyToUuid } from '../../dist/embedding/point-id.js';

const at = '2026-10-04T10:00:00.000Z';

test('a tombstoned entity names its point', () => {
  const graph = {
    attributes: { kmTombstones: { entities: { gone: { at } }, relations: { 'a\u0000x\u0000b': { at } } } },
    nodes: [{ key: 'kept' }],
  };
  assert.deepEqual(tombstonedPointIds(graph), [keyToUuid('gone')]);
});

test('an entity re-created after its deletion keeps its point', () => {
  const graph = { attributes: { kmTombstones: { entities: { back: { at } } } }, nodes: [{ key: 'back' }] };
  assert.deepEqual(tombstonedPointIds(graph), []);
});

test('a graph without tombstones names nothing', () => {
  assert.deepEqual(tombstonedPointIds({ nodes: [{ key: 'a' }] }), []);
  assert.deepEqual(tombstonedPointIds({}), []);
});
