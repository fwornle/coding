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

test('DASH-02: reader exposes process + timestamp per row (finding-1 display fix)', async () => {
  // The timeline UI renders each row's `process` (what produced it) and `timestamp`
  // so a row reads "08:03 · consolidator-insight" instead of "Turn N · untagged".
  // Both must survive the read (they are SELECTed and spread through shape()).
  const { dbPath, cleanup } = seedTokenDb([
    { task_id: 'tp', tool_call_id: '', parent_call_id: '', granularity_tier: '',
      total_tokens: 100, model: 'claude-sonnet-4.6', process: 'consolidator-insight',
      provider: 'copilot', timestamp: '2026-06-29T05:33:47.751Z' },
  ]);
  try {
    const { readTimeline } = await import('../../lib/experiments/timeline-read.mjs');
    const [row] = await readTimeline('tp', dbPath);
    assert.equal(row.process, 'consolidator-insight', 'process is exposed for the row label');
    assert.equal(row.timestamp, '2026-06-29T05:33:47.751Z', 'timestamp is exposed for the row label');
    assert.equal(row.provider, 'copilot', 'provider is exposed');
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

/** Seed foreground rows for the run + concurrent background/infra rows (empty task_id). */
function seedAmbientDb() {
  return seedTokenDb([
    // Foreground turns attributed to the run 'run1'.
    { task_id: 'run1', tool_call_id: 'fg1', granularity_tier: 'turn', process: 'coding-agent-claude',
      total_tokens: 12000, timestamp: '2026-06-28T08:01:00.000Z' },
    // Concurrent background (knowledge) — two individual calls, NOT grouped, empty task_id.
    { task_id: '', tool_call_id: '', granularity_tier: 'turn', process: 'consolidator-insight',
      total_tokens: 3200, timestamp: '2026-06-28T08:01:30.000Z' },
    { task_id: '', tool_call_id: '', granularity_tier: 'turn', process: 'observation-writer',
      total_tokens: 1540, timestamp: '2026-06-28T08:03:00.000Z' },
    // Concurrent infrastructure call.
    { task_id: '', tool_call_id: '', granularity_tier: 'turn', process: 'health-coordinator',
      total_tokens: 16, timestamp: '2026-06-28T08:02:00.000Z' },
    // A non-background process in-window (must be EXCLUDED by AMBIENT_PROCESS_RE).
    { task_id: '', tool_call_id: '', granularity_tier: 'turn', process: 'some-other-tool',
      total_tokens: 999, timestamp: '2026-06-28T08:02:30.000Z' },
    // A background call OUTSIDE the window (must be excluded by the timestamp bound).
    { task_id: '', tool_call_id: '', granularity_tier: 'turn', process: 'consolidator-insight',
      total_tokens: 7777, timestamp: '2026-06-28T09:30:00.000Z' },
  ]);
}

test('AMBIENT-TL: per-call background rows returned individually (not grouped), in-window, non-attributed', async () => {
  const { dbPath, cleanup } = seedAmbientDb();
  try {
    const { readAmbientTimeline } = await import('../../lib/experiments/timeline-read.mjs');
    const win = ['2026-06-28T08:00:00.000Z', '2026-06-28T08:30:00.000Z'];
    const amb = await readAmbientTimeline('run1', win[0], win[1], dbPath);
    const procs = amb.map((r) => r.process).sort();
    // 3 background rows (two knowledge + one infra), each individual — NOT one row per process group.
    assert.deepEqual(procs, ['consolidator-insight', 'health-coordinator', 'observation-writer'],
      'individual background rows for in-window background processes');
    assert.ok(!procs.includes('coding-agent-claude'), 'the run\'s own foreground row is excluded');
    assert.ok(!procs.includes('some-other-tool'), 'non-background processes are excluded by AMBIENT_PROCESS_RE');
    // The 09:30 consolidator call is outside the window → only ONE consolidator row survives.
    assert.equal(procs.filter((p) => p === 'consolidator-insight').length, 1, 'out-of-window background row excluded');
  } finally {
    cleanup();
  }
});

test('AMBIENT-TL: missing window or DB returns graceful empty', async () => {
  const { readAmbientTimeline } = await import('../../lib/experiments/timeline-read.mjs');
  const { dbPath, cleanup } = seedAmbientDb();
  try {
    assert.deepEqual(await readAmbientTimeline('run1', null, null, dbPath), [], 'no window -> []');
    const missing = path.join(os.tmpdir(), 'no-db-' + Date.now(), 'token-usage.db');
    assert.deepEqual(
      await readAmbientTimeline('run1', '2026-06-28T08:00:00.000Z', '2026-06-28T08:30:00.000Z', missing),
      [], 'missing DB -> []');
  } finally {
    cleanup();
  }
});
