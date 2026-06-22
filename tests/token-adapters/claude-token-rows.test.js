/**
 * tests/token-adapters/claude-token-rows.test.js
 *
 * Phase 69, Plan 69-03, Task 1 — per-turn row extraction (ADAPT-01 / D-01).
 *
 * Covers:
 *   1. buildClaudeTokenRows emits exactly one `per-turn` row per assistant
 *      `usage` block in the Wave-0 session fixture (3 assistant usage blocks).
 *   2. Each per-turn row carries the coalesced input/output/total token counts,
 *      `granularity_tier='per-turn'`, `tokens_estimated=0`, `reasoning_tokens=0`,
 *      agent='claude', provider='claude-code', the per-record model, and
 *      `tool_call_id === record.requestId`.
 *   3. A non-owned file (uid-check gate) yields [] — exercised structurally via
 *      the malformed/empty-file path (returns [] without throwing).
 *   4. A malformed JSONL line is skipped (try/catch per line), never throws.
 *
 * The fixture nests `usage`/`content`/`model` under `record.message`, with
 * `requestId`/`type`/`isSidechain` at the record top level (verified shape,
 * see fixtures/README.md + 69-RESEARCH.md).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'claude-session-sample.jsonl');

const { buildClaudeTokenRows } = await import(
  '../../lib/lsl/token/claude-token-rows.mjs'
);

/** Copy a fixture into a temp dir so the file is owned by the test user (uid gate passes). */
function ownedCopy(srcPath, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-token-rows-'));
  const dst = path.join(dir, name);
  fs.copyFileSync(srcPath, dst);
  return { dir, dst };
}

test('one per-turn row per assistant usage block, with coalesced counts', () => {
  const { dir, dst } = ownedCopy(FIXTURE, 'session.jsonl');
  try {
    const rows = buildClaudeTokenRows(dst);
    const perTurn = rows.filter((r) => r.granularity_tier === 'per-turn');

    // The session fixture has 3 assistant records each carrying a usage block.
    expect(perTurn.length).toBe(3);

    for (const r of perTurn) {
      expect(r.agent).toBe('claude');
      expect(r.provider).toBe('claude-code');
      expect(r.process).toBe('token-adapter-claude');
      expect(r.tokens_estimated).toBe(0);
      expect(r.reasoning_tokens).toBe(0);
      expect(r.user_hash).toBe('cladpt');
      expect(typeof r.input_tokens).toBe('number');
      expect(typeof r.output_tokens).toBe('number');
      expect(r.total_tokens).toBe(r.input_tokens + r.output_tokens);
    }

    // First assistant turn: req_TEST0001, opus, 10895 in / 119 out.
    const first = perTurn.find((r) => r.tool_call_id === 'req_TEST0001');
    expect(first).toBeTruthy();
    expect(first.model).toBe('claude-opus-4-8');
    expect(first.input_tokens).toBe(10895);
    expect(first.output_tokens).toBe(119);
    expect(first.total_tokens).toBe(10895 + 119);

    // Third assistant turn uses sonnet and has NO thinking block.
    const third = perTurn.find((r) => r.tool_call_id === 'req_TEST0003');
    expect(third).toBeTruthy();
    expect(third.model).toBe('claude-sonnet-4-5');
    expect(third.input_tokens).toBe(5120);
    expect(third.output_tokens).toBe(311);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('per-turn rows carry parent_call_id="" for a main-session (non-subagent) path', () => {
  const { dir, dst } = ownedCopy(FIXTURE, 'session.jsonl');
  try {
    const rows = buildClaudeTokenRows(dst);
    for (const r of rows) {
      expect(r.parent_call_id).toBe('');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed JSONL line is skipped without throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-token-rows-bad-'));
  const dst = path.join(dir, 'session.jsonl');
  try {
    const good = fs.readFileSync(FIXTURE, 'utf-8').trim().split('\n')[1]; // a real assistant line
    fs.writeFileSync(dst, `${good}\n{ this is not json }\n${good}\n`);

    let rows;
    expect(() => {
      rows = buildClaudeTokenRows(dst);
    }).not.toThrow();
    // Two valid assistant usage lines → two per-turn rows; the bad line is skipped.
    const perTurn = rows.filter((r) => r.granularity_tier === 'per-turn');
    expect(perTurn.length).toBe(2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-existent / unreadable file yields [] without throwing', () => {
  let rows;
  expect(() => {
    rows = buildClaudeTokenRows('/nonexistent/does-not-exist.jsonl');
  }).not.toThrow();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length).toBe(0);
});
