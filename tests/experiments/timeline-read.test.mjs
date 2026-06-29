// tests/experiments/timeline-read.test.mjs
//
// DASH-02 RED test (Phase 74, Wave 0): `readTimeline(taskId, dbPathOverride)` from
// the as-yet-unwritten `lib/experiments/timeline-read.mjs`. This test MUST
// currently fail at import — `timeline-read.mjs` does not exist. Plan 03/04 turns
// it GREEN.
//
// Contract proven here (mirrors token-aggregate.mjs read-only / graceful-empty idiom):
//   - per-reasoning-step children (`tool_call_id = 'turn1:reason:N'`, parent_call_id
//     = 'turn1') nest UNDER the per-turn parent (`tool_call_id = 'turn1'`).
//   - a missing DB path returns graceful EMPTY (NOT a throw) — environment-availability
//     fallback, same as aggregateByTaskId.
//   - task_id is bound as a `?` parameter: rows for a second task_id are EXCLUDED
//     (no leakage / no string interpolation — T-71-03-01 analog).
//
// node:test + node:assert/strict. Output via process.stderr.write only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

import { seedTokenDb } from './_fixtures/seed-experiment-store.mjs';

/** Seed one parent turn + two per-reasoning-step children for 't1', plus a 't2' row. */
function seedTimelineDb() {
  return seedTokenDb([
    { task_id: 't1', tool_call_id: 'turn1', parent_call_id: null,
      granularity_tier: 'turn', input_tokens: 100, output_tokens: 50, total_tokens: 150, timestamp: '2026-06-28T00:00:00.000Z' },
    { task_id: 't1', tool_call_id: 'turn1:reason:0', parent_call_id: 'turn1',
      granularity_tier: 'reasoning-step', reasoning_tokens: 20, total_tokens: 20, timestamp: '2026-06-28T00:00:01.000Z' },
    { task_id: 't1', tool_call_id: 'turn1:reason:1', parent_call_id: 'turn1',
      granularity_tier: 'reasoning-step', reasoning_tokens: 30, total_tokens: 30, timestamp: '2026-06-28T00:00:02.000Z' },
    // A second task's row that MUST NOT leak into a t1 timeline (bound-param check).
    { task_id: 't2', tool_call_id: 'turnX', parent_call_id: null,
      granularity_tier: 'turn', total_tokens: 999, timestamp: '2026-06-28T00:00:03.000Z' },
  ]);
}

test('DASH-02: per-reasoning-step children nest under the per-turn parent', async () => {
  const { dbPath, cleanup } = seedTimelineDb();
  try {
    const { readTimeline } = await import('../../lib/experiments/timeline-read.mjs');
    const timeline = await readTimeline('t1', dbPath);
    assert.equal(timeline.length, 1, 'one parent turn for t1');
    const parent = timeline[0];
    assert.equal(parent.tool_call_id, 'turn1', 'parent is the per-turn row');
    assert.ok(Array.isArray(parent.children), 'parent carries a children array');
    assert.equal(parent.children.length, 2, 'two per-reasoning-step children nest under it');
    const childIds = parent.children.map((c) => c.tool_call_id).sort();
    assert.deepEqual(childIds, ['turn1:reason:0', 'turn1:reason:1'], 'both reasoning steps nested');
  } finally {
    cleanup();
  }
});

test('DASH-02: multiple empty-tool_call_id rows each become a distinct parent (no collapse)', async () => {
  // Regression: untagged token rows all share the empty tool_call_id key. The old
  // grouping deduped parents by that shared '' key, dropping all but the first — the
  // timeline showed 1 row while the aggregate summed them all. Each empty-id row must
  // be its own parent so the timeline total matches the aggregate.
  const { dbPath, cleanup } = seedTokenDb([
    { task_id: 'tu', tool_call_id: '', parent_call_id: '', granularity_tier: '', total_tokens: 100, model: 'claude-haiku-4.5', timestamp: '2026-06-29T00:00:00.000Z' },
    { task_id: 'tu', tool_call_id: '', parent_call_id: '', granularity_tier: '', total_tokens: 200, model: 'claude-sonnet-4.6', timestamp: '2026-06-29T00:00:01.000Z' },
    { task_id: 'tu', tool_call_id: '', parent_call_id: '', granularity_tier: '', total_tokens: 300, model: 'claude-haiku-4.5', timestamp: '2026-06-29T00:00:02.000Z' },
  ]);
  try {
    const { readTimeline } = await import('../../lib/experiments/timeline-read.mjs');
    const timeline = await readTimeline('tu', dbPath);
    assert.equal(timeline.length, 3, 'all three untagged rows are distinct parents (not collapsed to 1)');
    const sum = timeline.reduce((s, p) => s + (p.total_tokens || 0), 0);
    assert.equal(sum, 600, 'timeline total matches the row sum (no dropped rows)');
  } finally {
    cleanup();
  }
});

test('DASH-02: missing DB path returns graceful empty (no throw)', async () => {
  const { readTimeline } = await import('../../lib/experiments/timeline-read.mjs');
  const missing = path.join(os.tmpdir(), 'does-not-exist-timeline-' + Date.now(), 'token-usage.db');
  const timeline = await readTimeline('t1', missing);
  assert.deepEqual(timeline, [], 'missing DB -> empty array, not a throw');
});

test('DASH-02: task_id is bound as ? — a second task_id is excluded', async () => {
  const { dbPath, cleanup } = seedTimelineDb();
  try {
    const { readTimeline } = await import('../../lib/experiments/timeline-read.mjs');
    const t2 = await readTimeline('t2', dbPath);
    assert.equal(t2.length, 1, 'only the t2 parent turn is returned');
    assert.equal(t2[0].tool_call_id, 'turnX', 't2 row is isolated from t1');
    // Reverse-check: the t1 timeline never contains the t2 row.
    const t1 = await readTimeline('t1', dbPath);
    const allIds = t1.flatMap((p) => [p.tool_call_id, ...(p.children ?? []).map((c) => c.tool_call_id)]);
    assert.ok(!allIds.includes('turnX'), 't2 row never leaks into the t1 timeline');
  } finally {
    cleanup();
  }
});
