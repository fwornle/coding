/**
 * Tests for lib/lsl/live/copilot-events-tail.mjs — Phase 51 Plan 09 Task 1.
 *
 * Locks the Copilot Path A (file-tail live) watcher contract:
 *   - startCopilotWatcher detects live sessions via inuse.<pid>.lock + mtime grace
 *   - Tails events.jsonl, registers subagent.started / completes on subagent.completed|failed
 *   - Stub observation per RESEARCH-copilot.md key finding ("lifecycle bookends only")
 *   - Every observation carries metadata.lsl_incomplete:true + locked note string
 *   - Lock-file disappearance → markCompleted('lock_gone') (best-effort)
 *   - uid-check on session dirs + events.jsonl files
 *
 * Strategy: tmpdir-based fixtures that simulate ~/.copilot/session-state/<uuid>/
 * trees. Tests use fs.appendFileSync to simulate incremental jsonl appends.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { jest } from '@jest/globals';

let mod;
beforeAll(async () => {
  mod = await import('../../lib/lsl/live/copilot-events-tail.mjs');
});

let tmpRoot;
let registry;
let writerCalls;
let writer;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-tail-test-'));
  registry = createTestRegistry();
  writerCalls = [];
  writer = {
    async init() {},
    async close() {},
    async processMessages(messages, metadata) {
      writerCalls.push({ messages, metadata });
      return { observations: 1, errors: 0 };
    },
  };
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

function createTestRegistry() {
  const rows = new Map();
  const key = (agent, sub_hash) => `${agent}:${sub_hash}`;
  return {
    upsert(row) {
      const k = key(row.agent, row.sub_hash);
      const existing = rows.get(k);
      const merged = existing ? { ...existing, ...row } : { ...row };
      if (!merged.discovered_at) merged.discovered_at = new Date().toISOString();
      if (typeof merged.observations_written !== 'number') merged.observations_written = 0;
      rows.set(k, merged);
      return merged;
    },
    get(agent, sub_hash) { return rows.get(key(agent, sub_hash)); },
    markCompleted(agent, sub_hash, fields = {}) {
      const k = key(agent, sub_hash);
      const existing = rows.get(k);
      if (!existing) throw new Error(`no row ${k}`);
      const updated = {
        ...existing,
        status: fields.error ? 'failed' : 'completed',
        completed_at: fields.completed_at ?? new Date().toISOString(),
        ...fields,
      };
      rows.set(k, updated);
      return updated;
    },
    listByAgent(agent) {
      return [...rows.values()].filter((r) => r.agent === agent);
    },
    listByProject(project) {
      return [...rows.values()].filter((r) => r.project === project);
    },
    size() { return rows.size; },
    clear() { rows.clear(); },
    _all() { return [...rows.values()]; },
  };
}

const DEFAULT_WORKSPACE = `id: 11111111-2222-3333-4444-555555555555
cwd: /Users/Q284340/Agentic/coding/integrations/llm-cli-proxy
git_root: /Users/Q284340/Agentic/coding
repository: fwornle/coding
branch: main
created_at: 2026-05-26T12:30:00.000Z
updated_at: 2026-05-26T15:45:00.000Z
`;

function makeSession(name, {
  workspaceYaml = DEFAULT_WORKSPACE,
  eventsLines = [],
  locked = true,
  lockMtimeMs,
} = {}) {
  const sessionDir = path.join(tmpRoot, name);
  fs.mkdirSync(sessionDir, { recursive: true });
  if (workspaceYaml) {
    fs.writeFileSync(path.join(sessionDir, 'workspace.yaml'), workspaceYaml);
  }
  fs.writeFileSync(
    path.join(sessionDir, 'events.jsonl'),
    eventsLines.length ? eventsLines.join('\n') + '\n' : '',
  );
  if (locked) {
    const lockPath = path.join(sessionDir, 'inuse.1234.lock');
    fs.writeFileSync(lockPath, '1234');
    if (lockMtimeMs !== undefined) {
      const t = new Date(lockMtimeMs);
      fs.utimesSync(lockPath, t, t);
    }
  }
  return sessionDir;
}

function startedEvent(toolCallId, ts = '2026-05-26T12:30:53Z') {
  return JSON.stringify({
    type: 'subagent.started',
    data: {
      toolCallId,
      agentName: 'general-purpose',
      agentDisplayName: 'General Purpose Agent',
      agentDescription: 'Full-capability sub-agent.',
    },
    id: `id-start-${toolCallId}`,
    timestamp: ts,
    parentId: 'parent-evt',
  });
}

function completedEvent(toolCallId, ts = '2026-05-26T12:31:53Z') {
  return JSON.stringify({
    type: 'subagent.completed',
    data: { toolCallId, agentName: 'general-purpose' },
    id: `id-end-${toolCallId}`,
    timestamp: ts,
    parentId: `id-start-${toolCallId}`,
  });
}

function failedEvent(toolCallId, errorMsg, ts = '2026-05-26T12:31:53Z') {
  return JSON.stringify({
    type: 'subagent.failed',
    data: { toolCallId, agentName: 'general-purpose', error: errorMsg },
    id: `id-fail-${toolCallId}`,
    timestamp: ts,
    parentId: `id-start-${toolCallId}`,
  });
}

async function tick(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll `predicate` until it is true. Replaces a fixed sleep wherever the wait is
 * for the watcher to NOTICE something — the scan interval is 50ms, and on a
 * loaded machine (a full jest run is ~10 workers deep) a 50ms sleep routinely
 * expires before the scan has run at all.
 */
async function waitFor(predicate, { timeoutMs = 5000, stepMs = 10, context } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await tick(stepMs);
  }
  // A bare "condition not met" says nothing about WHICH link broke: the watcher
  // never attached, the append never landed, the tail read it but the row was
  // keyed differently, or an onError fired and was swallowed. `context` is
  // evaluated only on the failure path and appended to the message, so a red CI
  // run reports the state instead of requiring a local repro of the runner.
  let extra = '';
  if (context) {
    try { extra = ` — ${JSON.stringify(await context())}`; } catch (err) { extra = ` — context threw: ${err.message}`; }
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms${extra}`);
}

/**
 * withTimeout — bound one await with a diagnostic message.
 *
 * Jest's own per-test timeout reports nothing but the test declaration line, so a
 * stall inside a test with several awaits is reported as "Exceeded timeout of
 * 15000 ms" and a caret on `test(...)`. That cannot distinguish "the tail never
 * observed the append" from "stop() never drained a pending write" — the two ways
 * Test 11 can hang — which is how a red CI run arrived carrying no information
 * about its own cause. Bounding each await separately makes the failure name itself.
 */
async function withTimeout(promise, ms, describe) {
  let timer;
  const guard = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`withTimeout(${ms}ms): ${describe()}`)), ms);
  });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * waitForAttach — block until the watcher has attached at least `n` tails.
 *
 * Replaces `await tick(150)` before an append. The append must land AFTER attach:
 * tailEventsFile() records lastSize = st.size at attach and never replays what
 * preceded it, so anything written earlier is classed as pre-existing and skipped
 * forever. A fixed sleep expressed that ordering as a guess about scheduling —
 * three scan intervals of margin on an unloaded laptop, unknown margin on a
 * contended CI runner.
 */
async function waitForAttach(handle, n = 1) {
  await waitFor(() => handle.getStats().watching_sessions >= n);
}

/**
 * waitForNextScan — block until one further scan cycle has completed.
 *
 * For the NEGATIVE assertions (watching_sessions === 0), which cannot wait on the
 * condition itself: it is already true at t=0, so waitFor would return immediately
 * and prove nothing. What those tests need is "the watcher had a real chance to
 * attach this session and still did not", and state.lastScanAt advancing is that
 * chance — observed rather than assumed. ISO timestamps are ms-resolution and the
 * scan interval is 50ms, so consecutive scans are always distinguishable.
 */
async function waitForNextScan(handle) {
  const before = handle.getStats().last_scan_at;
  await waitFor(() => handle.getStats().last_scan_at !== before);
}

const PROJECT_ROOT = '/Users/Q284340/Agentic/coding';

describe('copilot-events-tail watcher contract', () => {
  test('Test 1 — startCopilotWatcher returns handle with stop + getStats', async () => {
    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      expect(typeof handle.stop).toBe('function');
      expect(typeof handle.getStats).toBe('function');
      const stats = handle.getStats();
      expect(typeof stats).toBe('object');
      expect(stats).toHaveProperty('watching_sessions');
      expect(stats).toHaveProperty('tail_count');
      expect(stats).toHaveProperty('registered');
      expect(stats).toHaveProperty('errors');
    } finally {
      await handle.stop();
    }
  });

  test('Test 2 — Live-session scan only watches locked sessions', async () => {
    makeSession('session-locked', {
      eventsLines: [],
      locked: true,
    });
    makeSession('session-unlocked', {
      eventsLines: [],
      locked: false,
    });

    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      await waitForAttach(handle);
      const stats = handle.getStats();
      expect(stats.watching_sessions).toBe(1);
    } finally {
      await handle.stop();
    }
  });

  test('Test 3 — subagent.started detection registers row', async () => {
    const sessionDir = makeSession('00b9c9f4-15dd-443f-842e-cd7fd188be6a', {
      eventsLines: [],
      locked: true,
    });
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      await waitForAttach(handle);
      fs.appendFileSync(eventsPath, startedEvent('toolu_vrtx_01ABCDEF') + '\n');
      await waitFor(() => registry.get('copilot', '01ABCDE'), {
        context: () => ({
          stats: handle.getStats(),
          eventsBytes: fs.statSync(eventsPath).size,
          registryKeys: registry.listByAgent('copilot').map((r) => r.sub_hash),
        }),
      });

      const row = registry.get('copilot', '01ABCDE');
      expect(row).toBeDefined();
      expect(row.parent_session_id).toBe('00b9c9f4-15dd-443f-842e-cd7fd188be6a');
      expect(row.status).toBe('running');
      expect(row.detected_via).toBe('event-tail');
      expect(row.agent_metadata.toolCallId).toBe('toolu_vrtx_01ABCDEF');
      expect(row.agent_metadata.agentName).toBe('general-purpose');
      expect(row.agent_metadata.started_at).toBe('2026-05-26T12:30:53Z');
    } finally {
      await handle.stop();
    }
  });

  test('Test 4 — subagent.completed pairing stamps completed_at + success', async () => {
    const sessionDir = makeSession('uuid-4', { eventsLines: [], locked: true });
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      await waitForAttach(handle);
      fs.appendFileSync(eventsPath, startedEvent('toolu_vrtx_01PAIRED1') + '\n');
      await waitFor(() => registry.get('copilot', '01PAIRE'));
      fs.appendFileSync(eventsPath, completedEvent('toolu_vrtx_01PAIRED1', '2026-05-26T12:31:53Z') + '\n');
      await waitFor(() => registry.get('copilot', '01PAIRE')?.status === 'completed');

      const row = registry.get('copilot', '01PAIRE');
      expect(row).toBeDefined();
      expect(row.status).toBe('completed');
      expect(row.completed_at).toBe('2026-05-26T12:31:53Z');
      expect(row.agent_metadata.completion_status).toBe('success');
    } finally {
      await handle.stop();
    }
  });

  test('Test 5 — subagent.failed pairing stamps completion_status=error + errorMessage', async () => {
    const sessionDir = makeSession('uuid-5', { eventsLines: [], locked: true });
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      await waitForAttach(handle);
      fs.appendFileSync(eventsPath, startedEvent('toolu_vrtx_01FAILED2') + '\n');
      await waitFor(() => registry.get('copilot', '01FAILE'));
      fs.appendFileSync(eventsPath, failedEvent('toolu_vrtx_01FAILED2', 'context window exhausted') + '\n');
      await waitFor(() => registry.get('copilot', '01FAILE')?.agent_metadata?.completion_status === 'error');

      const row = registry.get('copilot', '01FAILE');
      expect(row).toBeDefined();
      expect(row.agent_metadata.completion_status).toBe('error');
      expect(row.agent_metadata.errorMessage).toBe('context window exhausted');
    } finally {
      await handle.stop();
    }
  });

  test('Test 6 — Stub observation written on completion (lsl_incomplete=true + locked note)', async () => {
    const sessionDir = makeSession('uuid-6', { eventsLines: [], locked: true });
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      await waitForAttach(handle);
      fs.appendFileSync(eventsPath, startedEvent('toolu_vrtx_01STUB001') + '\n');
      await waitFor(() => registry.get('copilot', '01STUB0'));
      fs.appendFileSync(eventsPath, completedEvent('toolu_vrtx_01STUB001') + '\n');
      await waitFor(() => writerCalls.length >= 1);

      expect(writerCalls.length).toBeGreaterThanOrEqual(1);
      const lastCall = writerCalls[writerCalls.length - 1];
      const { messages, metadata } = lastCall;
      expect(messages.some((m) => m.role === 'user')).toBe(true);
      expect(messages.some((m) => m.role === 'assistant')).toBe(true);
      expect(metadata.lsl_incomplete).toBe(true);
      expect(metadata.note).toMatch(/lifecycle bookends/i);
      expect(metadata.source).toBe('sub-agent');
      expect(metadata.agent).toBe('copilot');
      expect(metadata.detected_via).toBe('event-tail');
      expect(metadata.completion_status).toBe('success');
    } finally {
      await handle.stop();
    }
  });

  test('Test 7 — Lock-file disappearance triggers markCompleted with lock_gone', async () => {
    const sessionDir = makeSession('uuid-7', { eventsLines: [], locked: true });
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      await waitForAttach(handle);
      fs.appendFileSync(eventsPath, startedEvent('toolu_vrtx_01GONE001') + '\n');
      await waitFor(() => registry.get('copilot', '01GONE0'));

      // Remove the lock file — simulates session crash/exit
      fs.unlinkSync(path.join(sessionDir, 'inuse.1234.lock'));
      await waitFor(() => registry.get('copilot', '01GONE0')?.agent_metadata?.completion_status === 'lock_gone');

      const row = registry.get('copilot', '01GONE0');
      expect(row).toBeDefined();
      expect(row.agent_metadata.completion_status).toBe('lock_gone');
      expect(row.completed_at).toBeNull();
    } finally {
      await handle.stop();
    }
  });

  test('Test 8 — Lock-file stale-mtime (> 10min old): session NOT watched', async () => {
    const stale = Date.now() - (15 * 60 * 1000); // 15 minutes ago
    makeSession('uuid-stale', {
      eventsLines: [],
      locked: true,
      lockMtimeMs: stale,
    });

    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      await waitForNextScan(handle);
      expect(handle.getStats().watching_sessions).toBe(0);
    } finally {
      await handle.stop();
    }
  });

  test('Test 9 — workspace.yaml-derived project=coding (basename of git_root)', async () => {
    const sessionDir = makeSession('uuid-9', { eventsLines: [], locked: true });
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      await waitForAttach(handle);
      fs.appendFileSync(eventsPath, startedEvent('toolu_vrtx_01PROJ001') + '\n');
      await waitFor(() => registry.get('copilot', '01PROJ0'));

      const row = registry.get('copilot', '01PROJ0');
      expect(row.project).toBe('coding');
    } finally {
      await handle.stop();
    }
  });

  test('Test 10 — Project filter: mismatched git_root session NOT watched', async () => {
    const otherWorkspace = `id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
cwd: /Users/Q284340/other/project
git_root: /Users/Q284340/other/project
repository: example/other
branch: main
`;
    makeSession('uuid-other', {
      workspaceYaml: otherWorkspace,
      eventsLines: [],
      locked: true,
    });

    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      await waitForNextScan(handle);
      expect(handle.getStats().watching_sessions).toBe(0);
    } finally {
      await handle.stop();
    }
  });

  test('Test 11 — Stop drains in-flight writes', async () => {
    const sessionDir = makeSession('uuid-11', { eventsLines: [], locked: true });
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    // Make the write PROVABLY in flight when stop() is called, instead of hoping a
    // fixed sleep lands inside it. The old shape was `append; await tick(50); stop()`
    // against a 50ms scan interval — on a loaded machine the scan had often not run
    // at all, so no write had started, so there was nothing to drain and the row was
    // simply absent. The test failed on the drain assertion while the drain was never
    // exercised, which is the worst of both: red for a reason it does not name.
    let writeEntered;
    const entered = new Promise((resolve) => { writeEntered = resolve; });
    writer.processMessages = async (messages, metadata) => {
      writerCalls.push({ messages, metadata });
      writeEntered();
      // Hold the write open long enough that stop() cannot possibly arrive after it.
      await tick(100);
      return { observations: 1, errors: 0 };
    };

    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    // See waitForAttach — the append must land after attach. The guard this replaced
    // was fs.existsSync(eventsPath), which makeSession() had already made true, so it
    // waited for nothing and returned on its first predicate call.
    //
    // Today the ordering holds anyway, because startCopilotWatcher awaits its initial
    // scanLoop() before returning the handle (measured: watching_sessions is already 1
    // at t+0ms). The guard pins that invariant rather than depending on it silently.
    //
    // NOTE: this is not a proven diagnosis of the 2026-09-01 CI hang (run
    // 33507727691), which passed unchanged on re-run and left no inner stack. The
    // withTimeout bounds below are what will name that one if it recurs.
    await waitForAttach(handle);
    fs.appendFileSync(
      eventsPath,
      startedEvent('toolu_vrtx_01DRAIN01') + '\n' +
      completedEvent('toolu_vrtx_01DRAIN01') + '\n',
    );

    // stop() is now issued strictly INSIDE processMessages. Both awaits are bounded
    // so that whichever one stalls says so — see withTimeout above.
    await withTimeout(entered, 5000, () =>
      `processMessages never ran: the tail did not observe the append. stats=${JSON.stringify(handle.getStats())}`);
    await withTimeout(handle.stop(), 5000, () =>
      `handle.stop() never settled: an in-flight write did not drain. stats=${JSON.stringify(handle.getStats())}`);

    // After stop, the write should have been allowed to complete.
    const row = registry.get('copilot', '01DRAIN');
    expect(row).toBeDefined();
    expect(writerCalls.length).toBeGreaterThan(0);
  }, 15000);

  test('Test 12 — getStats returns shape with last_scan_at', async () => {
    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      await waitForNextScan(handle);
      const stats = handle.getStats();
      expect(stats).toHaveProperty('watching_sessions');
      expect(stats).toHaveProperty('tail_count');
      expect(stats).toHaveProperty('registered');
      expect(stats).toHaveProperty('errors');
      expect(stats).toHaveProperty('last_scan_at');
      expect(typeof stats.last_scan_at).toBe('string');
    } finally {
      await handle.stop();
    }
  });

  test('Test 13 — uid-check skips non-owned session dirs', async () => {
    const sessionDir = makeSession('uuid-13', { eventsLines: [], locked: true });

    const realStatSync = fs.statSync;
    const realFakeUid = 999999;
    jest.spyOn(fs, 'statSync').mockImplementation((p, opts) => {
      const real = realStatSync(p, opts);
      if (p === sessionDir) {
        return {
          ...real,
          uid: realFakeUid,
          isDirectory: () => real.isDirectory(),
          isFile: () => real.isFile(),
        };
      }
      return real;
    });

    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };

    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      await waitForNextScan(handle);
      expect(handle.getStats().watching_sessions).toBe(0);
      expect(stderrChunks.join('')).toMatch(/skipping non-owned/i);
    } finally {
      process.stderr.write = origWrite;
      fs.statSync.mockRestore();
      await handle.stop();
    }
  });
});
