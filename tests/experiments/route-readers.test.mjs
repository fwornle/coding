// tests/experiments/route-readers.test.mjs
//
// Phase 72, Plan 72-03 (Wave 2) — per-agent normalized-route-trace reader suite
// (ROUTE-02). Each reader emits the Plan-01 `RouteEvent[]` contract from the
// DISJOINT tool-call slice of the SAME session files the Phase-69 *token*
// adapters read (Claude session JSONL tool_use/tool_result; Copilot events.jsonl
// tool.execution_start/complete) — never the token-row builders.
//
// Convention: node:test + node:assert/strict (the established tests/experiments/
// pattern — NOT jest globals). Output via process.stderr.write only
// (no console.* — no-console-log). The `ownedCopy` tmpdir mechanic copies a
// fixture into an own-uid temp file so each reader's uid-check gate passes
// (mechanic adapted from tests/token-adapters/claude-token-rows.test.js, asserts
// via node:assert/strict — not jest).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildClaudeRouteTrace } from '../../lib/lsl/route/claude-route-trace.mjs';
import { buildCopilotRouteTrace } from '../../lib/lsl/route/copilot-route-trace.mjs';
import { inputsDigest } from '../../lib/lsl/route/route-event.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'route');

/** Copy a fixture into a temp dir so the file is own-uid (the uid gate passes). */
function ownedCopy(srcName, dstName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-readers-'));
  const dst = path.join(dir, dstName);
  fs.copyFileSync(path.join(FIXTURE_DIR, srcName), dst);
  return { dir, dst };
}

describe('buildClaudeRouteTrace — tool_use/tool_result → RouteEvent[]', () => {
  test('emits one RouteEvent per tool_use with correct outcomes + fields', () => {
    const { dir, dst } = ownedCopy('claude-tooluse-sample.jsonl', 'session.jsonl');
    try {
      const trace = buildClaudeRouteTrace(dst);

      // 6 tool_use blocks total: read1, edit1, bash_err, abandoned, par_a, par_b.
      assert.equal(trace.length, 6);

      // seq is 0-based ascending; every event is agent='claude'.
      trace.forEach((ev, i) => {
        assert.equal(ev.seq, i);
        assert.equal(ev.agent, 'claude');
      });

      const byId = Object.fromEntries(trace.map((e) => [e.tool_call_id, e]));

      // Two success pairs (Read, Edit) — ended_at set, outcome success.
      assert.equal(byId.toolu_read1.outcome, 'success');
      assert.equal(byId.toolu_read1.tool_name, 'Read');
      assert.equal(byId.toolu_read1.target_path, '/repo/a.txt');
      assert.ok(byId.toolu_read1.ended_at, 'success event has ended_at');
      assert.equal(
        byId.toolu_read1.inputs_digest,
        inputsDigest({ file_path: '/repo/a.txt' }),
      );

      assert.equal(byId.toolu_edit1.outcome, 'success');
      assert.equal(byId.toolu_edit1.target_path, '/repo/a.txt');

      // is_error tool_result → outcome='error'.
      assert.equal(byId.toolu_bash_err.outcome, 'error');
      assert.equal(byId.toolu_bash_err.target_path, null); // Bash has no file_path
      assert.ok(byId.toolu_bash_err.ended_at);

      // tool_use with NO matching tool_result → outcome='abandoned', ended_at=null.
      assert.equal(byId.toolu_abandoned.outcome, 'abandoned');
      assert.equal(byId.toolu_abandoned.ended_at, null);

      // Parallel same-turn: TWO separate RouteEvents, never collapsed (D-07).
      assert.equal(byId.toolu_par_a.outcome, 'success');
      assert.equal(byId.toolu_par_b.outcome, 'success');
      assert.notEqual(byId.toolu_par_a.seq, byId.toolu_par_b.seq);
      assert.equal(byId.toolu_par_a.target_path, '/repo/b.txt');
      assert.equal(byId.toolu_par_b.target_path, '/repo/c.txt');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-owned / unreadable file → [] (uid gate, never throws)', () => {
    // A path that does not exist exercises the fail-closed stat branch.
    const trace = buildClaudeRouteTrace(
      path.join(os.tmpdir(), 'route-readers-does-not-exist-xyz', 'session.jsonl'),
    );
    assert.deepEqual(trace, []);
  });

  test('malformed JSONL line is skipped, valid events still returned', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-readers-bad-'));
    const dst = path.join(dir, 'session.jsonl');
    try {
      const good = fs.readFileSync(
        path.join(FIXTURE_DIR, 'claude-tooluse-sample.jsonl'),
        'utf8',
      );
      fs.writeFileSync(dst, `{ this is not json }\n${good}`);
      const trace = buildClaudeRouteTrace(dst);
      assert.equal(trace.length, 6); // malformed line skipped, all 6 still built
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildCopilotRouteTrace — tool.execution_start/complete → RouteEvent[]', () => {
  test('emits one RouteEvent per execution_start with correct outcomes + fields', () => {
    const { dir, dst } = ownedCopy('copilot-toolevents-sample.jsonl', 'events.jsonl');
    try {
      const trace = buildCopilotRouteTrace(dst);

      // 4 execution_start: tc-1, tc-2 (success), tc-3 (error), tc-4 (abandoned).
      assert.equal(trace.length, 4);

      trace.forEach((ev, i) => {
        assert.equal(ev.seq, i);
        assert.equal(ev.agent, 'copilot');
      });

      const byId = Object.fromEntries(trace.map((e) => [e.tool_call_id, e]));

      // Two success pairs.
      assert.equal(byId['tc-1'].outcome, 'success');
      assert.equal(byId['tc-1'].tool_name, 'read');
      assert.ok(byId['tc-1'].ended_at, 'success event has ended_at');
      assert.equal(
        byId['tc-1'].inputs_digest,
        inputsDigest({ file_path: '/repo/a.txt' }),
      );
      assert.equal(byId['tc-1'].target_path, '/repo/a.txt');

      assert.equal(byId['tc-2'].outcome, 'success');

      // success:false → outcome='error'.
      assert.equal(byId['tc-3'].outcome, 'error');
      assert.ok(byId['tc-3'].ended_at);

      // execution_start with NO matching execution_complete → abandoned, ended_at=null.
      assert.equal(byId['tc-4'].outcome, 'abandoned');
      assert.equal(byId['tc-4'].ended_at, null);

      // Matching is by toolCallId, NOT positional.
      assert.equal(byId['tc-1'].started_at, '2026-06-22T11:00:10.000Z');
      assert.equal(byId['tc-1'].ended_at, '2026-06-22T11:00:11.000Z');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-owned / unreadable file → [] (readOwnedFile fail-closed)', () => {
    const trace = buildCopilotRouteTrace(
      path.join(os.tmpdir(), 'route-readers-copilot-missing-xyz', 'events.jsonl'),
    );
    assert.deepEqual(trace, []);
  });

  test('malformed JSONL line is skipped, valid events still returned', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-readers-copilot-bad-'));
    const dst = path.join(dir, 'events.jsonl');
    try {
      const good = fs.readFileSync(
        path.join(FIXTURE_DIR, 'copilot-toolevents-sample.jsonl'),
        'utf8',
      );
      fs.writeFileSync(dst, `{ not json at all }\n${good}`);
      const trace = buildCopilotRouteTrace(dst);
      assert.equal(trace.length, 4);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
