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
      await tick(150);
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
      await tick(150);
      fs.appendFileSync(eventsPath, startedEvent('toolu_vrtx_01ABCDEF') + '\n');
      await tick(500);

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
      await tick(150);
      fs.appendFileSync(eventsPath, startedEvent('toolu_vrtx_01PAIRED1') + '\n');
      await tick(400);
      fs.appendFileSync(eventsPath, completedEvent('toolu_vrtx_01PAIRED1', '2026-05-26T12:31:53Z') + '\n');
      await tick(500);

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
      await tick(150);
      fs.appendFileSync(eventsPath, startedEvent('toolu_vrtx_01FAILED2') + '\n');
      await tick(400);
      fs.appendFileSync(eventsPath, failedEvent('toolu_vrtx_01FAILED2', 'context window exhausted') + '\n');
      await tick(500);

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
      await tick(150);
      fs.appendFileSync(eventsPath, startedEvent('toolu_vrtx_01STUB001') + '\n');
      await tick(300);
      fs.appendFileSync(eventsPath, completedEvent('toolu_vrtx_01STUB001') + '\n');
      await tick(600);

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
      await tick(150);
      fs.appendFileSync(eventsPath, startedEvent('toolu_vrtx_01GONE001') + '\n');
      await tick(400);

      // Remove the lock file — simulates session crash/exit
      fs.unlinkSync(path.join(sessionDir, 'inuse.1234.lock'));
      await tick(300);

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
      await tick(150);
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
      await tick(150);
      fs.appendFileSync(eventsPath, startedEvent('toolu_vrtx_01PROJ001') + '\n');
      await tick(400);

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
      await tick(200);
      expect(handle.getStats().watching_sessions).toBe(0);
    } finally {
      await handle.stop();
    }
  });

  test('Test 11 — Stop drains in-flight writes', async () => {
    const sessionDir = makeSession('uuid-11', { eventsLines: [], locked: true });
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    await tick(150);
    fs.appendFileSync(
      eventsPath,
      startedEvent('toolu_vrtx_01DRAIN01') + '\n' +
      completedEvent('toolu_vrtx_01DRAIN01') + '\n',
    );
    await tick(50);
    await handle.stop();
    // After stop, the write should have been allowed to complete
    const row = registry.get('copilot', '01DRAIN');
    expect(row).toBeDefined();
  });

  test('Test 12 — getStats returns shape with last_scan_at', async () => {
    const handle = await mod.startCopilotWatcher({
      sessionStateDir: tmpRoot,
      registry,
      observationWriter: writer,
      projectRoot: PROJECT_ROOT,
      liveSessionScanIntervalMs: 50,
    });
    try {
      await tick(150);
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
      await tick(200);
      expect(handle.getStats().watching_sessions).toBe(0);
      expect(stderrChunks.join('')).toMatch(/skipping non-owned/i);
    } finally {
      process.stderr.write = origWrite;
      fs.statSync.mockRestore();
      await handle.stop();
    }
  });
});
