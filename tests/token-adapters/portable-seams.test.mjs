// tests/token-adapters/portable-seams.test.mjs
//
// glass G1 / WP1 — the token row builders as an extractable, portable subset:
//   1. Claude sub-agent paths resolve with either separator (Windows + POSIX),
//      and the POSIX shape is matched exactly as before.
//   2. The builders take an injected cwd → project mapping (ctx.projectOf).
//   3. The builders' static + dynamic import closure stays out of the LSL
//      pipeline (src/live-logging, scan-and-convert) — what glass's extractor
//      will enforce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUBAGENT_PATH_RE,
  parentSessionFromClaudeSubagentPath,
  agentIdFromClaudeSubagentPath,
} from '../../lib/lsl/adapters/claude-subagent-path.mjs';
import * as tree from '../../lib/lsl/adapters/claude-jsonl-tree.mjs';
import { buildClaudeTokenRows } from '../../lib/lsl/token/claude-token-rows.mjs';
import { projectOfCwd } from '../../lib/lsl/token/project-of.mjs';
import { importClosure } from '../../scripts/glass/import-graph.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const UUID = '0123abcd-0123-4567-89ab-0123456789ab';

test('sub-agent path: POSIX and Windows separators both resolve', () => {
  const posix = `/Users/me/.claude/projects/-Users-me-Agentic-coding/${UUID}/subagents/agent-abc123.jsonl`;
  const win = `C:\\Users\\me\\.claude\\projects\\C--Users-me-glass\\${UUID}\\subagents\\agent-abc123.jsonl`;
  for (const p of [posix, win]) {
    assert.equal(SUBAGENT_PATH_RE.test(p), true, p);
    assert.equal(parentSessionFromClaudeSubagentPath(p), UUID);
    assert.equal(agentIdFromClaudeSubagentPath(p), 'abc123');
  }
});

test('sub-agent path: main sessions and non-encoded dirs still do not match', () => {
  assert.equal(SUBAGENT_PATH_RE.test(`/Users/me/.claude/projects/-Users-me-coding/${UUID}.jsonl`), false);
  assert.equal(SUBAGENT_PATH_RE.test(`/x/.claude/projects/foo/${UUID}/subagents/agent-ab.jsonl`), false);
});

test('claude-jsonl-tree re-exports the same sub-agent helpers', () => {
  assert.equal(tree.SUBAGENT_PATH_RE, SUBAGENT_PATH_RE);
  assert.equal(tree.parentSessionFromClaudeSubagentPath, parentSessionFromClaudeSubagentPath);
  assert.equal(tree.agentIdFromClaudeSubagentPath, agentIdFromClaudeSubagentPath);
});

test('projectOfCwd: relative or non-string cwd → empty project', () => {
  assert.equal(projectOfCwd('relative/dir'), '');
  assert.equal(projectOfCwd(undefined), '');
});

test('claude builder: ctx.projectOf replaces the default cwd mapping', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-seams-'));
  const file = path.join(dir, `${UUID}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({
    type: 'assistant', uuid: 'u1', sessionId: UUID, cwd: '/somewhere/repo', timestamp: '2026-10-08T10:00:00.000Z',
    message: { id: 'msg_1', model: 'claude-sonnet-5', usage: { input_tokens: 3, output_tokens: 2 } },
  }) + '\n');
  const seen = [];
  const rows = buildClaudeTokenRows(file, { projectOf: (cwd) => { seen.push(cwd); return 'injected'; } });
  assert.ok(rows.length > 0, 'fixture yields a row');
  assert.deepEqual(seen, ['/somewhere/repo']);
  assert.ok(rows.every((r) => r.project === 'injected'));
});

test('token row builders: import closure stays out of the LSL pipeline', () => {
  const roots = ['claude', 'copilot', 'opencode'].map((a) => path.join(REPO, 'lib/lsl/token', `${a}-token-rows.mjs`));
  const { files, missing } = importClosure(roots);
  assert.deepEqual(missing, [], 'every relative import resolves');
  const rel = files.map((f) => path.relative(REPO, f));
  const leaks = rel.filter((f) => f.startsWith(`src${path.sep}live-logging`) || f.endsWith(`scan-and-convert.mjs`));
  assert.deepEqual(leaks, [], `closure: ${rel.join(', ')}`);
});
