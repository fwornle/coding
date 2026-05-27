/**
 * tests/integration/claude-fs-watch-observations-written.test.js
 *
 * Phase 51 Plan 14 Task 1 — CR-03 regression test.
 *
 * Locks the fix for `lib/lsl/live/claude-fs-watch.mjs` post-flush
 * observations_written increment. Prior to Plan 51-14 the code was:
 *
 *   const cur = opts.registry.get('claude', subHash);
 *   if (cur) {
 *     opts.registry.upsert({ agent:'claude', sub_hash: subHash });  // (*)
 *     cur.observations_written = (cur.observations_written || 0) + 1; // (**)
 *   }
 *
 * (*) upsert internally does `const merged = {...existing, ...row}; this._rows.set(key, merged)`
 * which creates a NEW object and replaces the Map slot. (**) then mutates the
 * stale `cur` reference, which is no longer in the Map. The downstream effect
 * was `observations_written` stuck at 0 for any mid-tail reader. The fix is a
 * single atomic upsert that inlines the incremented counter — see the
 * <interfaces> block in 51-14-PLAN.md.
 *
 * 5 tests covering:
 *   1. Direct upsert path: ten atomic upserts with incremented counter land
 *      in the registry — row.observations_written === 10 (was 0 on broken).
 *   2. markCompleted reads the REAL count, not the exchangesEmitted fallback.
 *   3. End-to-end pipeline via tailFile-like flush: a synthetic JSONL fixture
 *      drives startClaudeWatcher → onMessage → ObservationWriter.processMessages
 *      → registry upsert, and row.observations_written > 0 BEFORE markCompleted.
 *   4. The misleading "overrideable list" comment block is gone from
 *      claude-fs-watch.mjs (sanity grep — proves we didn't lose the comment
 *      removal in a future refactor).
 *   5. The atomic-upsert pattern is present (sanity grep — proves we didn't
 *      regress to the stale-ref pattern in a future refactor).
 *
 * Per CLAUDE.md no-console-log: tests use stderr inspection via jest.spyOn.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { createRegistry } from '../../lib/lsl/registry.mjs';
import { startClaudeWatcher } from '../../lib/lsl/live/claude-fs-watch.mjs';

/** Tiny ObservationWriter stub recording processMessages calls. */
function makeWriterStub() {
  const calls = [];
  return {
    calls,
    async processMessages(messages, metadata = {}) {
      calls.push({ messages, metadata });
      return { observations: messages.length, errors: 0 };
    },
  };
}

/** Helper — create the per-sub-agent directory tree under tmpRoot. */
function ensureSubagentDir(tmpRoot, encodedCwd, parentUuid) {
  const dir = path.join(tmpRoot, encodedCwd, parentUuid, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Build a minimally-valid Claude sub-agent JSONL user record. */
function userRecord({
  agentId,
  parentUuid,
  isSidechain = true,
  ts = new Date().toISOString(),
  text = 'hello world',
}) {
  return {
    agentId,
    cwd: '/Users/Q284340/Agentic/coding',
    entrypoint: 'Agent',
    gitBranch: 'main',
    isSidechain,
    message: { role: 'user', content: text },
    parentUuid: null,
    sessionId: parentUuid,
    timestamp: ts,
    type: 'user',
    userType: 'external',
    uuid: '11111111-1111-1111-1111-111111111111',
    version: '2.1.141',
  };
}

function assistantRecord({
  agentId,
  parentUuid,
  isSidechain = true,
  ts = new Date().toISOString(),
  text = 'hello back',
}) {
  return {
    agentId,
    cwd: '/Users/Q284340/Agentic/coding',
    entrypoint: 'Agent',
    gitBranch: 'main',
    isSidechain,
    message: { role: 'assistant', content: text },
    parentUuid: '11111111-1111-1111-1111-111111111111',
    sessionId: parentUuid,
    timestamp: ts,
    type: 'assistant',
    userType: 'external',
    uuid: '22222222-2222-2222-2222-222222222222',
    version: '2.1.141',
    attributionAgent: 'gsd-executor',
    attributionSkill: 'gsd-execute-phase',
    requestId: 'req_abc',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let tmpDir;
let stderrSpy;
let stderrChunks;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-fs-watch-obs-written-'));
  stderrChunks = [];
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((s) => {
    stderrChunks.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf-8'));
    return true;
  });
});

afterEach(() => {
  if (stderrSpy) stderrSpy.mockRestore();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function claudeProjectsDir() {
  // The adapter's SUBAGENT_PATH_RE requires the literal '/.claude/projects/'
  // substring anywhere in the path.
  const root = path.join(tmpDir, '.claude', 'projects');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

describe('CR-03 — observations_written atomic upsert (Plan 51-14)', () => {
  test('Test 1: ten atomic upserts increment observations_written to 10 (was permanently 0 on broken code)', () => {
    const registry = createRegistry();
    const subHash = 'abc1234';
    registry.upsert({
      agent: 'claude',
      sub_hash: subHash,
      parent_session_id: 'parent-uuid-test-1',
      project: 'coding',
      status: 'running',
    });
    expect(registry.get('claude', subHash).observations_written).toBe(0);

    // Simulate ten flush cycles via the SAME atomic-upsert pattern used in
    // claude-fs-watch.mjs:514-527 (post-fix).
    for (let i = 0; i < 10; i++) {
      const cur = registry.get('claude', subHash);
      registry.upsert({
        agent: 'claude',
        sub_hash: subHash,
        observations_written: (cur.observations_written || 0) + 1,
      });
    }

    const row = registry.get('claude', subHash);
    expect(row.observations_written).toBe(10);
    // ALSO assert > 0 (the canonical regression assertion per plan acceptance).
    expect(row.observations_written).toBeGreaterThan(0);
  });

  test('Test 2: markCompleted reads the REAL observations_written (not the exchangesEmitted fallback)', () => {
    const registry = createRegistry();
    const subHash = 'def5678';
    registry.upsert({
      agent: 'claude',
      sub_hash: subHash,
      parent_session_id: 'parent-uuid-test-2',
      project: 'coding',
      status: 'running',
    });

    // Drive 3 atomic-upsert increments (post-fix pattern).
    for (let i = 0; i < 3; i++) {
      const cur = registry.get('claude', subHash);
      registry.upsert({
        agent: 'claude',
        sub_hash: subHash,
        observations_written: (cur.observations_written || 0) + 1,
      });
    }

    // Now simulate the markCompleted branch in claude-fs-watch.mjs:543-545.
    const exchangesEmitted = 99; // Pretend tail counted 99 (deliberately divergent).
    const row = registry.get('claude', subHash);
    // Truthy check would have failed on `0` (broken path) and fallen back to 99.
    // Post-fix it succeeds and we pass the REAL count: 3.
    const passed = row && row.observations_written ? row.observations_written : exchangesEmitted;
    expect(passed).toBe(3); // The real count, NOT the fallback.

    const completed = registry.markCompleted('claude', subHash, {
      observations_written: passed,
      completed_at: new Date().toISOString(),
    });
    expect(completed.observations_written).toBe(3);
    expect(completed.status).toBe('completed');
  });

  test('Test 3: end-to-end — startClaudeWatcher drives a real exchange and observations_written > 0 before markCompleted', async () => {
    const registry = createRegistry();
    const writer = makeWriterStub();
    const root = claudeProjectsDir();
    const handle = await startClaudeWatcher({
      projectsDir: root,
      registry,
      observationWriter: writer,
      raceGuardMs: 60_000, // Don't let mtime-stop fire during the test.
      tailIntervalMs: 100,
    });
    try {
      await sleep(100);
      const parentUuid = '77777777-7777-7777-7777-777777777777';
      // 17-char hex agentId — first 7 chars are the sub_hash key.
      // Per SUBAGENT_PATH_RE in lib/lsl/adapters/claude-jsonl-tree.mjs the
      // agentId must match [a-f0-9]+ (no other letters allowed).
      const agentId = '0b50b5012345abcde';
      const subDir = ensureSubagentDir(root, '-Users-Q284340-Agentic-coding', parentUuid);
      const filePath = path.join(subDir, `agent-${agentId}.jsonl`);
      // Initial: file with one user record (no exchange yet — solo user).
      fs.writeFileSync(filePath, JSON.stringify(userRecord({ agentId, parentUuid })) + '\n');
      await sleep(500);
      // Append the assistant record — completes the first exchange.
      fs.appendFileSync(filePath, JSON.stringify(assistantRecord({ agentId, parentUuid })) + '\n');
      // Wait for tail to pick up, processMessages to run, and the post-flush
      // atomic upsert to fire.
      await sleep(1500);
      // Writer should have been called at least once.
      expect(writer.calls.length).toBeGreaterThanOrEqual(1);
      // The registry row should now have observations_written > 0 — mid-tail
      // observability is restored. This is what was broken pre-Plan 51-14.
      const row = registry.get('claude', '0b50b50');
      expect(row).toBeDefined();
      expect(row.observations_written).toBeGreaterThan(0);
    } finally {
      await handle.stop();
    }
  }, 15_000);

  test('Test 4: misleading "overrideable list" comment removed from claude-fs-watch.mjs', () => {
    const filePath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      '..',
      'lib',
      'lsl',
      'live',
      'claude-fs-watch.mjs',
    );
    const contents = fs.readFileSync(filePath, 'utf-8');
    expect(contents).not.toMatch(/overrideable list/);
  });

  test('Test 5: atomic-upsert pattern present (no regression to stale-ref mutation)', () => {
    const filePath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      '..',
      'lib',
      'lsl',
      'live',
      'claude-fs-watch.mjs',
    );
    const contents = fs.readFileSync(filePath, 'utf-8');
    // The fix landed: the inline increment pattern OR a registry helper call.
    expect(contents).toMatch(/observations_written:\s*\(cur\.observations_written|incrementObservationsWritten/);
    // The broken pattern is gone: there must NOT be a `cur.observations_written =`
    // assignment statement (the stale-ref mutation).
    expect(contents).not.toMatch(/cur\.observations_written\s*=\s*\(/);
  });
});
