/**
 * tests/live-logging/live-claude-fs-watch.test.js
 *
 * Phase 51 Plan 07 Task 1 (TDD RED then GREEN).
 *
 * Locks the contract for the Claude Code Path A (live) hook:
 *   `lib/lsl/live/claude-fs-watch.mjs` — FSEvents-based watcher on
 *   ~/.claude/projects/<encoded-cwd>/ (recursive) that detects new
 *   sub-agent JSONL files, registers them in the Plan 51-01 registry,
 *   and tails them to ObservationWriter with metadata.source='sub-agent'
 *   (no -backfill suffix per CONTEXT.md D-Live-Sweep-Tags).
 *
 * 10 tests covering:
 *   1. startClaudeWatcher returns a handle with `stop` and `getStats` methods.
 *   2. New file create → registry.upsert called with row's path + sub_hash +
 *      parent_session_id, status='running', detected_via='fs-watch'.
 *   3. uid-check on file: when stat uid !== process.getuid(), the file is NOT
 *      registered + stderr 'skipping non-owned' emitted.
 *   4. isSidechain filter: a file whose first line has isSidechain:false is
 *      registered briefly but tail-reader emits stderr 'skipping non-sidechain'
 *      + closes the tail without calling onMessage. markCompleted is called
 *      with error='non-sidechain' for audit clarity.
 *   5. Tail-reader emits complete exchanges: append a user record then an
 *      assistant record to a watched file → onMessage callback fires once
 *      with the exchange.
 *   6. Race tolerance: file created EMPTY → registry.upsert called with
 *      sub_hash, parent_session_id, transcript_path set + agentId TBD. When
 *      the first JSONL line is appended ~500ms later, the row is upserted
 *      AGAIN with the verified agentId.
 *   7. Completion detection: when mtime stops updating for > raceGuardMs,
 *      onClose fires; watcher calls registry.markCompleted with
 *      observations_written set.
 *   8. Stop drains in-flight tails: calling handle.stop() while a tail is
 *      mid-append does NOT lose the in-flight exchange; stop promise
 *      resolves after the writer completes.
 *   9. getStats returns {watched, tailing, registered} — useful for Plan
 *      51-11 heartbeat surface.
 *  10. Watcher gracefully handles fs.watch ENOENT (projectsDir doesn't exist
 *      yet): logs stderr 'projects dir not yet created; deferring' and
 *      retries every retryIntervalMs.
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

let tmpDir;
let registry;
let writer;
let stderrSpy;
let stderrChunks;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-fs-watch-'));
  registry = createRegistry();
  writer = makeWriterStub();
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

/** Sleep helper using setTimeout. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build the project root layout under tmpDir/.claude/projects/-fixture-coding */
function claudeProjectsDir() {
  // The adapter's SUBAGENT_PATH_RE requires the literal '/.claude/projects/'
  // substring anywhere in the path; tmpDir alone doesn't include it.
  const root = path.join(tmpDir, '.claude', 'projects');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

describe('startClaudeWatcher', () => {
  test('Test 1: returns a handle with stop and getStats methods', async () => {
    const root = claudeProjectsDir();
    const handle = await startClaudeWatcher({
      projectsDir: root,
      registry,
      observationWriter: writer,
    });
    try {
      expect(handle).toBeDefined();
      expect(typeof handle.stop).toBe('function');
      expect(typeof handle.getStats).toBe('function');
      const stats = handle.getStats();
      expect(stats).toHaveProperty('watched');
      expect(stats).toHaveProperty('tailing');
      expect(stats).toHaveProperty('registered');
    } finally {
      await handle.stop();
    }
  });

  test('Test 2: new sub-agent file create registers row in registry', async () => {
    const root = claudeProjectsDir();
    const upsertSpy = jest.spyOn(registry, 'upsert');
    const handle = await startClaudeWatcher({
      projectsDir: root,
      registry,
      observationWriter: writer,
    });
    try {
      // Give the watcher a tick to attach to root.
      await sleep(100);
      const parentUuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const agentId = 'abc1234567890abcd';
      const subDir = ensureSubagentDir(root, '-Users-Q284340-Agentic-coding', parentUuid);
      const filePath = path.join(subDir, `agent-${agentId}.jsonl`);
      fs.writeFileSync(filePath, JSON.stringify(userRecord({ agentId, parentUuid })) + '\n');
      // Wait for the watcher to observe the create event.
      // FSEvents on macOS can take several hundred ms.
      await sleep(800);
      expect(upsertSpy).toHaveBeenCalled();
      // Find the call carrying our sub_hash.
      const found = upsertSpy.mock.calls.find(([row]) => row && row.sub_hash === 'abc1234');
      expect(found).toBeDefined();
      expect(found[0].agent).toBe('claude');
      expect(found[0].parent_session_id).toBe(parentUuid);
      expect(found[0].status).toBe('running');
      expect(found[0].detected_via).toBe('fs-watch');
      expect(found[0].transcript_path).toBe(filePath);
    } finally {
      await handle.stop();
    }
  });

  test('Test 3: uid-check skips non-owned files', async () => {
    const root = claudeProjectsDir();
    const upsertSpy = jest.spyOn(registry, 'upsert');
    // Use a 17-char hex agentId so the SUBAGENT_PATH_RE matches.
    const agentId = 'beefdeadbabe12345';
    const targetBasename = `agent-${agentId}.jsonl`;
    // Mock fs.statSync to return a foreign uid for ONLY our test file.
    const realStatSync = fs.statSync.bind(fs);
    const statSpy = jest.spyOn(fs, 'statSync').mockImplementation((p, ...rest) => {
      const real = realStatSync(p, ...rest);
      if (typeof p === 'string' && p.endsWith(targetBasename)) {
        // fs.Stats fields are getters on the prototype — copy the relevant
        // numeric/boolean fields by hand so the override carries them.
        const stub = Object.create(Object.getPrototypeOf(real));
        for (const k of ['size', 'mtimeMs', 'ctimeMs', 'atimeMs', 'birthtimeMs', 'mode', 'nlink', 'gid', 'ino', 'dev']) {
          stub[k] = real[k];
        }
        for (const fn of ['isFile', 'isDirectory', 'isSymbolicLink']) {
          stub[fn] = () => (fn === 'isFile' ? true : false);
        }
        stub.uid = real.uid + 99999; // foreign owner
        return stub;
      }
      return real;
    });
    const handle = await startClaudeWatcher({
      projectsDir: root,
      registry,
      observationWriter: writer,
    });
    try {
      await sleep(200);
      const parentUuid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      const subDir = ensureSubagentDir(root, '-Users-Q284340-Agentic-coding', parentUuid);
      const filePath = path.join(subDir, targetBasename);
      fs.writeFileSync(filePath, JSON.stringify(userRecord({ agentId, parentUuid })) + '\n');
      await sleep(1200);
      // The row should NOT be registered.
      const found = upsertSpy.mock.calls.find(([row]) => row && row.sub_hash === 'beefdea');
      expect(found).toBeUndefined();
      // Stderr should mention skipping non-owned.
      const joined = stderrChunks.join('');
      expect(joined).toMatch(/skipping non-owned/);
    } finally {
      statSpy.mockRestore();
      await handle.stop();
    }
  });

  test('Test 4: isSidechain:false closes tail with error=non-sidechain', async () => {
    const root = claudeProjectsDir();
    const markCompletedSpy = jest.spyOn(registry, 'markCompleted');
    const handle = await startClaudeWatcher({
      projectsDir: root,
      registry,
      observationWriter: writer,
      raceGuardMs: 500,
      tailIntervalMs: 100,
    });
    try {
      await sleep(100);
      const parentUuid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      // 17-char hex agentId — first 7 chars = 'cafedea' for the markCompleted assertion.
      const agentId = 'cafedeadbeef12345';
      const subDir = ensureSubagentDir(root, '-Users-Q284340-Agentic-coding', parentUuid);
      const filePath = path.join(subDir, `agent-${agentId}.jsonl`);
      // Write a non-sidechain (parent-shaped) record.
      fs.writeFileSync(
        filePath,
        JSON.stringify(userRecord({ agentId, parentUuid, isSidechain: false })) + '\n',
      );
      // Wait for create + tail-read + close.
      await sleep(1500);
      // No exchange should have been written to the observation writer.
      expect(writer.calls.length).toBe(0);
      // markCompleted should have been called with error='non-sidechain'.
      const found = markCompletedSpy.mock.calls.find(
        (args) => args[0] === 'claude' && args[1] === 'cafedea',
      );
      expect(found).toBeDefined();
      expect(found[2]).toBeDefined();
      expect(found[2].error).toBe('non-sidechain');
      const joined = stderrChunks.join('');
      expect(joined).toMatch(/skipping non-sidechain/);
    } finally {
      await handle.stop();
    }
  });

  test('Test 5: tail-reader emits complete user+assistant exchanges to writer', async () => {
    const root = claudeProjectsDir();
    const handle = await startClaudeWatcher({
      projectsDir: root,
      registry,
      observationWriter: writer,
      raceGuardMs: 5000,
      tailIntervalMs: 100,
    });
    try {
      await sleep(100);
      const parentUuid = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
      // 17-char hex agentId.
      const agentId = 'feedface12345abcd';
      const subDir = ensureSubagentDir(root, '-Users-Q284340-Agentic-coding', parentUuid);
      const filePath = path.join(subDir, `agent-${agentId}.jsonl`);
      // Initial: file with one user record.
      fs.writeFileSync(filePath, JSON.stringify(userRecord({ agentId, parentUuid })) + '\n');
      await sleep(500);
      // Append: assistant record.
      fs.appendFileSync(filePath, JSON.stringify(assistantRecord({ agentId, parentUuid })) + '\n');
      // Wait for the polling tailFile to pick up the new line.
      await sleep(1200);
      // Writer should have received at least one processMessages call.
      expect(writer.calls.length).toBeGreaterThanOrEqual(1);
      // The call's metadata.source should be 'sub-agent' (no -backfill).
      const allMeta = writer.calls.map((c) => c.metadata);
      const claudeMetaCalls = allMeta.filter((m) => m && m.source === 'sub-agent');
      expect(claudeMetaCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      await handle.stop();
    }
  });

  test('Test 6: empty-file race tolerance — agentId enriched on first line', async () => {
    const root = claudeProjectsDir();
    const upsertSpy = jest.spyOn(registry, 'upsert');
    const handle = await startClaudeWatcher({
      projectsDir: root,
      registry,
      observationWriter: writer,
      raceGuardMs: 5000,
      tailIntervalMs: 100,
    });
    try {
      await sleep(100);
      const parentUuid = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
      // 17-char hex agentId — first 7 chars = 'deadbee'.
      const agentId = 'deadbeefcafe12345';
      const subDir = ensureSubagentDir(root, '-Users-Q284340-Agentic-coding', parentUuid);
      const filePath = path.join(subDir, `agent-${agentId}.jsonl`);
      // Create EMPTY file first.
      fs.writeFileSync(filePath, '');
      await sleep(500);
      // First upsert should be the registration with status='running'.
      const firstCalls = upsertSpy.mock.calls.filter(([row]) => row && row.sub_hash === 'deadbee');
      expect(firstCalls.length).toBeGreaterThanOrEqual(1);
      const first = firstCalls[0][0];
      expect(first.parent_session_id).toBe(parentUuid);
      expect(first.transcript_path).toBe(filePath);
      // Append the first JSONL record.
      fs.appendFileSync(filePath, JSON.stringify(userRecord({ agentId, parentUuid })) + '\n');
      await sleep(500);
      // Second upsert should carry agentId enrichment in agent_metadata.agent_id.
      const allCalls = upsertSpy.mock.calls.filter(([row]) => row && row.sub_hash === 'deadbee');
      const enriched = allCalls.find(([row]) => row.agent_metadata && row.agent_metadata.agent_id === agentId);
      expect(enriched).toBeDefined();
    } finally {
      await handle.stop();
    }
  });

  test('Test 7: completion detection — mtime stops → markCompleted called', async () => {
    const root = claudeProjectsDir();
    const markCompletedSpy = jest.spyOn(registry, 'markCompleted');
    const handle = await startClaudeWatcher({
      projectsDir: root,
      registry,
      observationWriter: writer,
      raceGuardMs: 500,
      tailIntervalMs: 100,
    });
    try {
      await sleep(100);
      const parentUuid = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      // 17-char hex agentId — first 7 chars = 'cab1234' for markCompleted assertion.
      const agentId = 'cab1234deadbeef56';
      const subDir = ensureSubagentDir(root, '-Users-Q284340-Agentic-coding', parentUuid);
      const filePath = path.join(subDir, `agent-${agentId}.jsonl`);
      fs.writeFileSync(filePath, JSON.stringify(userRecord({ agentId, parentUuid })) + '\n');
      fs.appendFileSync(filePath, JSON.stringify(assistantRecord({ agentId, parentUuid })) + '\n');
      // Wait for raceGuardMs (500ms) + buffer for the mtime-stop detection.
      await sleep(2000);
      // markCompleted should have been called for 'cab1234' (first 7 chars of agentId).
      const found = markCompletedSpy.mock.calls.find(
        (args) => args[0] === 'claude' && args[1] === 'cab1234',
      );
      expect(found).toBeDefined();
      // The call should NOT carry an error (clean completion).
      expect(found[2].error).toBeFalsy();
    } finally {
      await handle.stop();
    }
  });

  test('Test 8: stop() drains in-flight tails — writer call completes before resolve', async () => {
    const root = claudeProjectsDir();
    // Slow writer to simulate in-flight work.
    let writerResolved = false;
    const slowWriter = {
      calls: [],
      async processMessages(messages, metadata = {}) {
        slowWriter.calls.push({ messages, metadata });
        await sleep(300);
        writerResolved = true;
        return { observations: messages.length, errors: 0 };
      },
    };
    const handle = await startClaudeWatcher({
      projectsDir: root,
      registry,
      observationWriter: slowWriter,
      raceGuardMs: 60_000,
      tailIntervalMs: 100,
    });
    await sleep(100);
    const parentUuid = '99999999-9999-9999-9999-999999999999';
    // 17-char hex agentId.
    const agentId = 'aabbccdd123456789';
    const subDir = ensureSubagentDir(root, '-Users-Q284340-Agentic-coding', parentUuid);
    const filePath = path.join(subDir, `agent-${agentId}.jsonl`);
    fs.writeFileSync(filePath, JSON.stringify(userRecord({ agentId, parentUuid })) + '\n');
    fs.appendFileSync(filePath, JSON.stringify(assistantRecord({ agentId, parentUuid })) + '\n');
    // Give the watcher time to start the tail + fire one processMessages.
    await sleep(500);
    // Now stop while the writer is mid-flight (300ms latency).
    await handle.stop();
    // After stop() resolves, all in-flight writer calls must be done.
    expect(writerResolved).toBe(true);
    expect(slowWriter.calls.length).toBeGreaterThanOrEqual(1);
  });

  test('Test 9: getStats reports watched/tailing/registered counts', async () => {
    const root = claudeProjectsDir();
    const handle = await startClaudeWatcher({
      projectsDir: root,
      registry,
      observationWriter: writer,
      raceGuardMs: 60_000,
      tailIntervalMs: 100,
    });
    try {
      const initial = handle.getStats();
      expect(initial.watched).toBeGreaterThanOrEqual(1);
      expect(initial.tailing).toBe(0);
      expect(initial.registered).toBe(0);
      await sleep(100);
      const parentUuid = '88888888-8888-8888-8888-888888888888';
      // 17-char hex agentId.
      const agentId = 'bbccdd9876543210e';
      const subDir = ensureSubagentDir(root, '-Users-Q284340-Agentic-coding', parentUuid);
      const filePath = path.join(subDir, `agent-${agentId}.jsonl`);
      fs.writeFileSync(filePath, JSON.stringify(userRecord({ agentId, parentUuid })) + '\n');
      await sleep(800);
      const after = handle.getStats();
      expect(after.tailing).toBeGreaterThanOrEqual(1);
      expect(after.registered).toBeGreaterThanOrEqual(1);
    } finally {
      await handle.stop();
    }
  });

  test('Test 10: handles ENOENT on projectsDir — defers and retries', async () => {
    const missingRoot = path.join(tmpDir, 'no-such-dir', 'projects');
    // Don't create the dir; the watcher should log "deferring" and retry.
    const handle = await startClaudeWatcher({
      projectsDir: missingRoot,
      registry,
      observationWriter: writer,
      retryIntervalMs: 200,
    });
    try {
      // Give it a tick to attempt the watch.
      await sleep(400);
      const joined = stderrChunks.join('');
      expect(joined).toMatch(/projects dir not yet created/);
      // Now create the dir; the watcher should pick up.
      fs.mkdirSync(missingRoot, { recursive: true });
      await sleep(800);
      const stats = handle.getStats();
      expect(stats.watched).toBeGreaterThanOrEqual(1);
    } finally {
      await handle.stop();
    }
  });
});

