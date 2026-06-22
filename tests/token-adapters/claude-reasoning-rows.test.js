/**
 * tests/token-adapters/claude-reasoning-rows.test.js
 *
 * Phase 69, Plan 69-03, Task 1 — per-reasoning-step row extraction (D-01 / D-05).
 *
 * D-05 (CRITICAL): Claude's JSONL `usage` block carries NO native reasoning-token
 * field. Each extended-thinking block becomes a DISTINCT `per-reasoning-step`
 * row whose `reasoning_tokens` is ESTIMATED from the thinking-block content
 * length, and every such row stamps `tokens_estimated=1`. The value is NEVER
 * claimed to be extracted from `usage`.
 *
 * Covers:
 *   1. One per-reasoning-step row per thinking block (the session fixture has
 *      two assistant records carrying a single thinking block each → 2 rows).
 *   2. Each reasoning row: granularity_tier='per-reasoning-step',
 *      tokens_estimated=1, reasoning_tokens > 0, and a distinct `:reason:<n>`
 *      tool_call_id derived from the base requestId.
 *   3. estimateReasoningTokens is monotonic non-decreasing in input length and
 *      returns >= 1 for empty / undefined input.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'claude-session-sample.jsonl');

const { buildClaudeTokenRows, estimateReasoningTokens } = await import(
  '../../lib/lsl/token/claude-token-rows.mjs'
);

function ownedCopy(srcPath, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-reasoning-rows-'));
  const dst = path.join(dir, name);
  fs.copyFileSync(srcPath, dst);
  return { dir, dst };
}

test('one per-reasoning-step row per thinking block, each estimated (tokens_estimated=1)', () => {
  const { dir, dst } = ownedCopy(FIXTURE, 'session.jsonl');
  try {
    const rows = buildClaudeTokenRows(dst);
    const reason = rows.filter(
      (r) => r.granularity_tier === 'per-reasoning-step',
    );

    // Two assistant records carry a thinking block (req_TEST0001, req_TEST0002).
    expect(reason.length).toBe(2);

    for (const r of reason) {
      expect(r.granularity_tier).toBe('per-reasoning-step');
      expect(r.tokens_estimated).toBe(1);
      expect(r.reasoning_tokens).toBeGreaterThan(0);
      expect(r.agent).toBe('claude');
      expect(r.provider).toBe('claude-code');
      expect(r.user_hash).toBe('cladpt');
      // distinct reasoning tool_call_id keyed off the base requestId + index.
      expect(r.tool_call_id).toMatch(/:reason:\d+$/);
    }

    // tool_call_ids must be distinct across reasoning rows.
    const ids = reason.map((r) => r.tool_call_id);
    expect(new Set(ids).size).toBe(ids.length);

    // The longer thinking block (req_TEST0002) must estimate more tokens than
    // the shorter one (req_TEST0001) — proves the estimate is length-derived.
    const short = reason.find((r) => r.tool_call_id.startsWith('req_TEST0001'));
    const long = reason.find((r) => r.tool_call_id.startsWith('req_TEST0002'));
    expect(short).toBeTruthy();
    expect(long).toBeTruthy();
    expect(long.reasoning_tokens).toBeGreaterThan(short.reasoning_tokens);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('estimateReasoningTokens is monotonic in length and >= 1 for empty input', () => {
  expect(estimateReasoningTokens('')).toBeGreaterThanOrEqual(1);
  expect(estimateReasoningTokens(undefined)).toBeGreaterThanOrEqual(1);
  expect(estimateReasoningTokens(null)).toBeGreaterThanOrEqual(1);

  const small = estimateReasoningTokens('abcd');
  const big = estimateReasoningTokens('abcd'.repeat(100));
  expect(big).toBeGreaterThan(small);

  // Deterministic: ceil(chars / 4).
  expect(estimateReasoningTokens('abcdefgh')).toBe(2);
  expect(Number.isInteger(estimateReasoningTokens('xyz'.repeat(7)))).toBe(true);
});
