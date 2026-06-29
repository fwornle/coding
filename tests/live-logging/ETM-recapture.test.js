/**
 * tests/live-logging/ETM-recapture.test.js
 *
 * Phase 75 Plan 01 (Wave 0) — RED jest test for OBS-02 (event-time re-capture)
 * + OBS-01 (active task_id stamping), built from the real `e0af5b8b` case.
 *
 * Finding D (the bug this phase fixes): the operator's `e0af5b8b` session had
 * its last TYPED prompt at 2026-06-28T21:00:43Z (T0), then ran overnight with
 * 5 morning AskUserQuestion decisions (05:30–06:03Z on 2026-06-29) and real
 * deliverables — yet ETM produced 8 observations ALL stamped 21:00:43Z (the
 * prompt-set start). The fix must turn that into observations dated ~05:30–06:03Z.
 *
 * This test drives the Plan 05 re-capture fire logic — exposed as
 * `computeRecaptureFires(messages, opts)` in lib/live-logging/etm-recapture.mjs.
 * That module does NOT exist yet, so the dynamic import in beforeAll throws
 * `Cannot find module` and every test below fails RED. Plan 05 creates the
 * module + the mid-set fire boundary that turns it green.
 *
 * The persist seam (obs-writer / km-core) is NOT exercised here — the function
 * under test returns the per-batch observation DESCRIPTORS (created_at, task_id,
 * dedupKey), so this test pins the fire-boundary + timestamp + dedup logic only.
 *
 * Acceptance bar (finding D / 75-CONTEXT §specifics, 75-RESEARCH §Specifics):
 *   (a) MORE THAN ONE observation is emitted (not a single T0 snapshot).
 *   (b) at least one observation's created_at is in the 05:30–06:03Z window
 *       (NOT 21:00:43Z).
 *   (c) every emitted observation carries a non-empty metadata.task_id (OBS-01).
 *   (d) no two observations share the same (task_id, batch-last-message-uuid).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.join(__dirname, '_fixtures', 'e0af5b8b-recapture.jsonl');

const T0_ISO = '2026-06-28T21:00:43.000Z';
const WINDOW_START = Date.parse('2026-06-29T05:30:00.000Z');
const WINDOW_END = Date.parse('2026-06-29T06:03:00.000Z');
const STUB_TASK_ID = 'm-e0af5b8b';

/** Parse the fixture JSONL into ETM-shaped messages (one per transcript line). */
function loadMessages() {
  const raw = fs.readFileSync(FIXTURE, 'utf-8');
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

let computeRecaptureFires;

beforeAll(async () => {
  // RED today: lib/live-logging/etm-recapture.mjs does not exist (Plan 05 creates it).
  ({ computeRecaptureFires } = await import('../../lib/live-logging/etm-recapture.mjs'));
});

describe('Phase 75 ETM re-capture (OBS-02 event-time + OBS-01 task_id) — e0af5b8b', () => {
  test('fixture sanity: one typed prompt @T0 + 5 AskUserQuestion decision pairs @05:30–06:03Z', () => {
    const messages = loadMessages();
    const typedPrompts = messages.filter(
      (m) =>
        m.type === 'user' &&
        Array.isArray(m.message?.content) &&
        m.message.content.some((c) => c.type === 'text'),
    );
    expect(typedPrompts).toHaveLength(1);
    expect(typedPrompts[0].timestamp).toBe(T0_ISO);

    const asks = messages.filter(
      (m) =>
        m.type === 'assistant' &&
        Array.isArray(m.message?.content) &&
        m.message.content.some((c) => c.type === 'tool_use' && c.name === 'AskUserQuestion'),
    );
    expect(asks.length).toBeGreaterThanOrEqual(5);
    for (const a of asks) {
      const t = Date.parse(a.timestamp);
      expect(t).toBeGreaterThanOrEqual(WINDOW_START);
      expect(t).toBeLessThanOrEqual(WINDOW_END);
    }

    // Every message carries a distinct uuid + a timestamp.
    const uuids = messages.map((m) => m.uuid);
    expect(new Set(uuids).size).toBe(uuids.length);
    expect(messages.every((m) => typeof m.timestamp === 'string')).toBe(true);
  });

  test('(a) emits MORE THAN ONE observation (not a single T0 snapshot)', () => {
    const fires = computeRecaptureFires(loadMessages(), {
      taskId: STUB_TASK_ID,
      toolBatchThreshold: 8,
      timeThresholdMs: 10 * 60 * 1000,
    });
    expect(Array.isArray(fires)).toBe(true);
    expect(fires.length).toBeGreaterThanOrEqual(2);
  });

  test('(b) at least one observation is dated in the 05:30–06:03Z window (NOT 21:00:43Z)', () => {
    const fires = computeRecaptureFires(loadMessages(), {
      taskId: STUB_TASK_ID,
      toolBatchThreshold: 8,
      timeThresholdMs: 10 * 60 * 1000,
    });
    const inWindow = fires.filter((f) => {
      const t = Date.parse(f.created_at);
      return t >= WINDOW_START && t <= WINDOW_END;
    });
    expect(inWindow.length).toBeGreaterThanOrEqual(1);
    // And NOT collapsed to T0 — at least one fire must NOT be the prompt-set start.
    expect(fires.some((f) => f.created_at !== T0_ISO)).toBe(true);
  });

  test('(c) every emitted observation carries a non-empty metadata.task_id (OBS-01)', () => {
    const fires = computeRecaptureFires(loadMessages(), {
      taskId: STUB_TASK_ID,
      toolBatchThreshold: 8,
      timeThresholdMs: 10 * 60 * 1000,
    });
    for (const f of fires) {
      expect(f.metadata?.task_id).toBe(STUB_TASK_ID);
      expect(typeof f.metadata.task_id).toBe('string');
      expect(f.metadata.task_id.length).toBeGreaterThan(0);
    }
  });

  test('(d) no two observations share the same (task_id, batch-last-message-uuid) dedup key', () => {
    const fires = computeRecaptureFires(loadMessages(), {
      taskId: STUB_TASK_ID,
      toolBatchThreshold: 8,
      timeThresholdMs: 10 * 60 * 1000,
    });
    const keys = fires.map((f) => `${f.metadata.task_id}|${f.dedupKey ?? f.batchLastMessageUuid}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
