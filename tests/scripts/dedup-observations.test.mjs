import test from 'node:test';
import assert from 'node:assert/strict';
import { planDedup } from '../../scripts/dedup-observations.mjs';

const T = '2026-11-11T20:30:23.647Z';
const row = (id, extra = {}) => ({ id, project: 'glass', timestamp: T, quality: 'normal', content: 'x', ...extra });
const ids = (rows) => rows.map((r) => r.id).sort();

test('keeps the best row of an uncited group: quality, then the longer summary', () => {
  const rows = [row('a'), row('b', { quality: 'high' }), row('c', { quality: 'high', content: 'longer' })];
  assert.deepEqual(ids(planDedup(rows, new Set())), ['a', 'b']);
});

test('keeps every row a digest cites, deletes only the uncited', () => {
  const rows = [row('a'), row('b'), row('c', { quality: 'high' })];
  assert.deepEqual(ids(planDedup(rows, new Set(['a', 'b']))), ['c']);
});

test('different project or timestamp, singletons and progress snapshots are untouched', () => {
  const rows = [
    row('a'), row('b', { project: 'coding' }), row('c', { timestamp: '2026-11-11T20:30:24.000Z' }),
    row('p1', { kind: 'progress' }),
  ];
  assert.deepEqual(planDedup(rows, new Set()), []);
});
