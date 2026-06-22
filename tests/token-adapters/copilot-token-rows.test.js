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
 *      agent='copilot', provider='copilot', tool_call_id===model, user_hash='copadt'.
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

    for (const r of agg) {
      expect(r.agent).toBe('copilot');
      expect(r.provider).toBe('copilot');
      expect(r.process).toBe('token-adapter-copilot');
      expect(r.user_hash).toBe('copadt');
      expect(r.tool_call_id).toBe(r.model);
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
