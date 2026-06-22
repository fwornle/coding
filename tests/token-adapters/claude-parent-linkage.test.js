/**
 * tests/token-adapters/claude-parent-linkage.test.js
 *
 * Phase 69, Plan 69-03, Task 2 — sub-agent parent_call_id linkage (D-02 reuse).
 *
 * D-02: a sub-agent row's `parent_call_id` is derived from the EXPORTED
 * claude-jsonl-tree linkage (`parentSessionFromClaudeSubagentPath`) — NOT a
 * re-walked subagents directory. The isSidechain first-record gate is honored
 * (first record isSidechain:false → []). A main-session (non-subagent) path
 * yields rows with `parent_call_id===''`.
 *
 * Covers:
 *   1. A SUBAGENT_PATH_RE-matching path → every emitted row carries the
 *      non-empty parent_call_id == parentSessionFromClaudeSubagentPath(path).
 *   2. A main-session (non-subagent) path → rows with parent_call_id===''.
 *   3. A sub-agent fixture whose first record is isSidechain:false → [].
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FIXTURE = path.join(
  __dirname,
  'fixtures',
  'claude-session-sample.jsonl',
);
const SUBAGENT_FIXTURE = path.join(
  __dirname,
  'fixtures',
  'claude-subagent-sample.jsonl',
);

const { buildClaudeTokenRows } = await import(
  '../../lib/lsl/token/claude-token-rows.mjs'
);
const { parentSessionFromClaudeSubagentPath, SUBAGENT_PATH_RE } = await import(
  '../../lib/lsl/adapters/claude-jsonl-tree.mjs'
);

// A canonical 36-char UUID + hex agent id matching SUBAGENT_PATH_RE.
const PARENT_UUID = '00000000-0000-4000-8000-0000000000aa';
const AGENT_HEX = 'a1b2c3d4e5f60718';

/**
 * Materialize a sub-agent transcript at a path matching SUBAGENT_PATH_RE, with
 * the given source fixture as its contents. Returns { dir, subPath }.
 */
function materializeSubAgent(srcFixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-parent-link-'));
  const subDir = path.join(
    dir,
    '.claude',
    'projects',
    '-Users-Q284340-Agentic-coding',
    PARENT_UUID,
    'subagents',
  );
  fs.mkdirSync(subDir, { recursive: true });
  const subPath = path.join(subDir, `agent-${AGENT_HEX}.jsonl`);
  fs.copyFileSync(srcFixture, subPath);
  return { dir, subPath };
}

test('sub-agent rows carry parent_call_id from the locked tree linkage (D-02)', () => {
  const { dir, subPath } = materializeSubAgent(SUBAGENT_FIXTURE);
  try {
    // sanity: the constructed path actually matches the locked regex.
    expect(SUBAGENT_PATH_RE.test(subPath)).toBe(true);

    const expectedParent = parentSessionFromClaudeSubagentPath(subPath);
    expect(expectedParent).toBe(PARENT_UUID);

    const rows = buildClaudeTokenRows(subPath);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.parent_call_id).toBe(expectedParent);
      expect(r.parent_call_id).not.toBe('');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a main-session (non-subagent) path yields rows with parent_call_id===""', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-parent-link-main-'));
  const mainPath = path.join(dir, 'session.jsonl');
  try {
    fs.copyFileSync(SESSION_FIXTURE, mainPath);
    expect(SUBAGENT_PATH_RE.test(mainPath)).toBe(false);

    const rows = buildClaudeTokenRows(mainPath);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.parent_call_id).toBe('');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a sub-agent fixture whose first record is isSidechain:false yields []', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-parent-link-ns-'));
  const subDir = path.join(
    dir,
    '.claude',
    'projects',
    '-Users-Q284340-Agentic-coding',
    PARENT_UUID,
    'subagents',
  );
  fs.mkdirSync(subDir, { recursive: true });
  const subPath = path.join(subDir, `agent-${AGENT_HEX}.jsonl`);
  try {
    // Build a transcript whose FIRST record is isSidechain:false.
    const firstFalse = JSON.stringify({
      type: 'user',
      uuid: '00000000-0000-4000-8000-0000000000bb',
      parentUuid: null,
      isSidechain: false,
      timestamp: '2026-06-22T11:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: '[REDACTED]' }] },
    });
    const asst = JSON.stringify({
      type: 'assistant',
      requestId: 'req_NS00001',
      isSidechain: false,
      timestamp: '2026-06-22T11:00:03.000Z',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-8',
        content: [{ type: 'text', text: '[REDACTED]' }],
        usage: { input_tokens: 100, output_tokens: 10 },
      },
    });
    fs.writeFileSync(subPath, `${firstFalse}\n${asst}\n`);

    const rows = buildClaudeTokenRows(subPath);
    expect(rows).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
