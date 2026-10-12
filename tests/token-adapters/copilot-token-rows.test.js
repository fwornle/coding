/**
 * tests/token-adapters/copilot-token-rows.test.js
 *
 * Phase 69, Plan 69-04, Task 1 — per-session-aggregate row extraction from
 * `session.shutdown.modelMetrics` (ADAPT-02 / D-04).
 *
 * Covers:
 *   1. buildCopilotTokenRows emits exactly one `per-session-aggregate` row per
 *      model in the Wave-0 events fixture (two models in session.shutdown).
 *   2. Each row carries the coalesced input/output token counts,
 *      total_tokens = input + output, granularity_tier='per-session-aggregate',
 *      agent='copilot', provider='copilot', user_hash='copadt', and a
 *      session-scoped tool_call_id `<sessionUuid>:<model>` (CR-02).
 *   3. The model whose usage OMITS reasoningTokens (claude-sonnet-4.6) coalesces
 *      to reasoning_tokens===0 — never NaN/null (Pitfall 5).
 *   4. The model carrying reasoningTokens (claude-opus-4.6) preserves it.
 *   5. A malformed JSONL line is skipped without throwing.
 *   6. A non-existent / unreadable file yields [] without throwing.
 *
 * The fixture's session.shutdown event nests
 * `data.modelMetrics.<model>.usage.{inputTokens,outputTokens,reasoningTokens?}`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'copilot-events-sample.jsonl');

const { buildCopilotTokenRows } = await import(
  '../../lib/lsl/token/copilot-token-rows.mjs'
);

/** Copy a fixture into a temp dir so the file is owned by the test user (uid gate passes). */
function ownedCopy(srcPath, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-token-rows-'));
  const dst = path.join(dir, name);
  fs.copyFileSync(srcPath, dst);
  return { dir, dst };
}

test('one per-session-aggregate row per model, with coalesced counts', () => {
  const { dir, dst } = ownedCopy(FIXTURE, 'events.jsonl');
  try {
    const rows = buildCopilotTokenRows(dst);
    const agg = rows.filter((r) => r.granularity_tier === 'per-session-aggregate');

    // session.shutdown.modelMetrics has exactly two models.
    expect(agg.length).toBe(2);

    // CR-02: the fixture's session.start carries this data.sessionId.
    const SESSION_ID = '00000000-0000-4000-a000-000000000000';

    for (const r of agg) {
      expect(r.agent).toBe('copilot');
      expect(r.provider).toBe('copilot');
      expect(r.process).toBe('token-adapter-copilot');
      expect(r.user_hash).toBe('copadt');
      // Session-scoped natural key: `<sessionUuid>:<model>` (CR-02).
      expect(r.tool_call_id).toBe(`${SESSION_ID}:${r.model}`);
      expect(typeof r.input_tokens).toBe('number');
      expect(typeof r.output_tokens).toBe('number');
      expect(typeof r.reasoning_tokens).toBe('number');
      expect(Number.isNaN(r.reasoning_tokens)).toBe(false);
      expect(r.total_tokens).toBe(r.input_tokens + r.output_tokens);
    }

    // claude-opus-4.6: 232866 in / 1282 out / 115 reasoning.
    const opus = agg.find((r) => r.model === 'claude-opus-4.6');
    expect(opus).toBeTruthy();
    expect(opus.input_tokens).toBe(232866);
    expect(opus.output_tokens).toBe(1282);
    expect(opus.total_tokens).toBe(232866 + 1282);
    expect(opus.reasoning_tokens).toBe(115);

    // claude-sonnet-4.6: 51002 in / 640 out / NO reasoningTokens key → 0.
    const sonnet = agg.find((r) => r.model === 'claude-sonnet-4.6');
    expect(sonnet).toBeTruthy();
    expect(sonnet.input_tokens).toBe(51002);
    expect(sonnet.output_tokens).toBe(640);
    expect(sonnet.total_tokens).toBe(51002 + 640);
    // Pitfall 5: reasoningTokens absent → coalesced to 0 (not NaN/null/undefined).
    expect(sonnet.reasoning_tokens).toBe(0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed JSONL line is skipped without throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-token-rows-bad-'));
  const dst = path.join(dir, 'events.jsonl');
  try {
    const lines = fs.readFileSync(FIXTURE, 'utf-8').trim().split('\n');
    const shutdownLine = lines[lines.length - 1]; // the session.shutdown event
    fs.writeFileSync(dst, `{ this is not json }\n${shutdownLine}\n`);

    let rows;
    expect(() => {
      rows = buildCopilotTokenRows(dst);
    }).not.toThrow();
    const agg = rows.filter((r) => r.granularity_tier === 'per-session-aggregate');
    // The bad line is skipped; the shutdown line still yields two model rows.
    expect(agg.length).toBe(2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-existent / unreadable file yields [] without throwing', () => {
  let rows;
  expect(() => {
    rows = buildCopilotTokenRows('/nonexistent/does-not-exist.jsonl');
  }).not.toThrow();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length).toBe(0);
});

describe('BYOK calls (coding routes them through the proxy)', () => {
  const SID = '11111111-0000-4000-a000-000000000000';
  const usage = (model, isByok, i, o, cr = 0) => ({
    type: 'session.usage_record',
    data: { usage: { model, isByok, inputTokens: i, outputTokens: o, cacheReadTokens: cr, cacheWriteTokens: 0 } },
  });
  const shutdown = (metrics) => ({
    type: 'session.shutdown',
    timestamp: '2026-10-12T11:38:21.000Z',
    data: { modelMetrics: metrics },
  });
  function write(events) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-token-rows-'));
    const dst = path.join(dir, 'events.jsonl');
    const start = { type: 'session.start', data: { sessionId: SID, context: { cwd: dir } } };
    fs.writeFileSync(dst, [start, ...events].map((e) => JSON.stringify(e)).join('\n'));
    return { dir, dst };
  }

  test('an all-BYOK session yields no rows — the proxy rows already count it', () => {
    const { dir, dst } = write([
      usage('claude-opus-5', true, 13639, 190, 41617),
      usage('claude-opus-5', true, 41617, 0, 0),
      shutdown({ 'claude-opus-5': { usage: { inputTokens: 55256, outputTokens: 190, cacheReadTokens: 41617, cacheWriteTokens: 0 } } }),
    ]);
    try {
      expect(buildCopilotTokenRows(dst, { project: 'p' })).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a mixed session keeps only the non-BYOK share', () => {
    const { dir, dst } = write([
      usage('m', true, 1000, 10),
      usage('m', false, 500, 5),
      shutdown({ m: { usage: { inputTokens: 1500, outputTokens: 15 } } }),
    ]);
    try {
      const rows = buildCopilotTokenRows(dst, { project: 'p' });
      expect(rows.length).toBe(1);
      expect(rows[0].input_tokens).toBe(500);
      expect(rows[0].output_tokens).toBe(5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('byokMetered: false keeps BYOK calls (glass, where nothing else recorded them)', () => {
    const { dir, dst } = write([
      usage('m', true, 1000, 10),
      shutdown({ m: { usage: { inputTokens: 1000, outputTokens: 10 } } }),
    ]);
    try {
      const rows = buildCopilotTokenRows(dst, { project: 'p', byokMetered: false });
      expect(rows.length).toBe(1);
      expect(rows[0].input_tokens).toBe(1000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
