/**
 * Tests for lib/lsl/adapters/copilot-events.mjs — Phase 51 Plan 04 Task 2.
 *
 * Locks the Copilot Path B (sweep) adapter contract:
 *   - exports {agentId:'copilot', storageType:'events-jsonl', discover, convertToObservations}
 *   - workspace.yaml is parsed via regex (NO js-yaml dependency)
 *   - sub_hash derives from toolCallId (NOT session id) — first 7 chars after
 *     stripping the `toolu_vrtx_` prefix
 *   - Stub-LSL marker (lsl_incomplete:true) is stamped on every row's
 *     agent_metadata per RESEARCH-copilot.md key finding
 *   - Live sessions (inuse.<pid>.lock present) are skipped
 *   - uid-check on each session subdirectory
 *
 * Strategy: build tmpdir fixtures simulating ~/.copilot/session-state/<uuid>/
 * trees containing events.jsonl + workspace.yaml, then drive adapter.discover.
 * ObservationWriter is mocked via jest.unstable_mockModule.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { jest } from '@jest/globals';

const writerCalls = [];

jest.unstable_mockModule('../../src/live-logging/ObservationWriter.js', () => ({
  ObservationWriter: class {
    constructor(opts) { this.opts = opts; }
    async init() { /* no-op */ }
    async close() { /* no-op */ }
    async processMessages(messages, metadata = {}) {
      writerCalls.push({ messages, metadata });
      return { observations: 1, errors: 0 };
    }
  },
}));

let adapter;
beforeAll(async () => {
  ({ adapter } = await import('../../lib/lsl/adapters/copilot-events.mjs'));
});

beforeEach(() => {
  writerCalls.length = 0;
});

let tmpRoot;
beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-adapter-test-'));
});
afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

function makeSession(name, { workspaceYaml, eventsLines, locked } = {}) {
  const sessionDir = path.join(tmpRoot, name);
  fs.mkdirSync(sessionDir, { recursive: true });
  if (workspaceYaml !== undefined) {
    fs.writeFileSync(path.join(sessionDir, 'workspace.yaml'), workspaceYaml);
  }
  if (Array.isArray(eventsLines)) {
    fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), eventsLines.join('\n') + '\n');
  }
  if (locked) {
    fs.writeFileSync(path.join(sessionDir, 'inuse.1234.lock'), '1234');
  }
  return sessionDir;
}

const DEFAULT_WORKSPACE = `id: d5611a90-874c-4b08-accc-224d04604593
cwd: /Users/Q284340/Agentic/coding/integrations/llm-cli-proxy
git_root: /Users/Q284340/Agentic/coding
repository: fwornle/coding
branch: main
created_at: 2026-03-05T12:30:00.000Z
updated_at: 2026-03-05T15:45:00.000Z
`;

function startedEvent(toolCallId, ts = '2026-03-05T12:30:53Z') {
  return JSON.stringify({
    type: 'subagent.started',
    data: {
      toolCallId,
      agentName: 'general-purpose',
      agentDisplayName: 'General Purpose Agent',
      agentDescription: 'Full-capability sub-agent description.',
    },
    id: `id-start-${toolCallId}`,
    timestamp: ts,
    parentId: 'parent-evt',
  });
}

function completedEvent(toolCallId, ts = '2026-03-05T12:33:39Z') {
  return JSON.stringify({
    type: 'subagent.completed',
    data: {
      toolCallId,
      agentName: 'general-purpose',
      agentDisplayName: 'General Purpose Agent',
    },
    id: `id-end-${toolCallId}`,
    timestamp: ts,
    parentId: `id-start-${toolCallId}`,
  });
}

function failedEvent(toolCallId, errorMsg, ts = '2026-03-05T12:34:00Z') {
  return JSON.stringify({
    type: 'subagent.failed',
    data: {
      toolCallId,
      agentName: 'general-purpose',
      error: errorMsg,
    },
    id: `id-fail-${toolCallId}`,
    timestamp: ts,
    parentId: `id-start-${toolCallId}`,
  });
}

describe('copilot-events adapter contract', () => {
  test('Test 1 — adapter exports the locked Plan 51-01 shape', () => {
    expect(adapter.agentId).toBe('copilot');
    expect(adapter.storageType).toBe('events-jsonl');
    expect(typeof adapter.discover).toBe('function');
    expect(typeof adapter.convertToObservations).toBe('function');
  });

  test('Test 2 — discover walks session-state and yields a row per subagent.started', async () => {
    makeSession('00b9c9f4', {
      workspaceYaml: DEFAULT_WORKSPACE,
      eventsLines: [
        startedEvent('toolu_vrtx_01ABCDEF'),
        completedEvent('toolu_vrtx_01ABCDEF'),
      ],
    });
    const rows = await adapter.discover({ searchPaths: [tmpRoot], project: 'coding' });
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.agent).toBe('copilot');
    expect(row.parent_session_id).toBe('00b9c9f4');
    expect(row.detected_via).toBe('sweep');
    expect(row.status).toBe('discovered');
    expect(typeof row.transcript_path).toBe('string');
    expect(row.transcript_path.endsWith('events.jsonl')).toBe(true);
  });

  test('Test 3 — workspace.yaml regex parser extracts cwd/git_root/repository/branch + prefers git_root', async () => {
    makeSession('uuid-3', {
      workspaceYaml: DEFAULT_WORKSPACE,
      eventsLines: [startedEvent('toolu_vrtx_01ZZZAAA'), completedEvent('toolu_vrtx_01ZZZAAA')],
    });
    const rows = await adapter.discover({ searchPaths: [tmpRoot] });
    expect(rows[0].project).toBe('coding'); // basename of git_root, NOT basename of cwd (llm-cli-proxy)
  });

  test('Test 4 — missing workspace.yaml falls back to project=unknown + stderr', async () => {
    makeSession('uuid-4', {
      // No workspace.yaml
      eventsLines: [startedEvent('toolu_vrtx_01NOYAML'), completedEvent('toolu_vrtx_01NOYAML')],
    });
    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
    try {
      const rows = await adapter.discover({ searchPaths: [tmpRoot] });
      expect(rows.length).toBe(1);
      expect(rows[0].project).toBe('unknown');
      expect(stderrChunks.join('')).toMatch(/workspace\.yaml missing/i);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test('Test 5 — toolCallId-based sub_hash strips toolu_vrtx_ prefix then takes first 7 chars', async () => {
    makeSession('uuid-5', {
      workspaceYaml: DEFAULT_WORKSPACE,
      eventsLines: [
        startedEvent('toolu_vrtx_01ABCDEFGH'),
        completedEvent('toolu_vrtx_01ABCDEFGH'),
      ],
    });
    const rows = await adapter.discover({ searchPaths: [tmpRoot] });
    expect(rows[0].sub_hash).toBe('01ABCDE');
  });

  test('Test 6 — empty toolCallId or missing prefix: defensive fallback + stderr', async () => {
    makeSession('uuid-6', {
      workspaceYaml: DEFAULT_WORKSPACE,
      eventsLines: [
        startedEvent('rawToolCall1234'),
        completedEvent('rawToolCall1234'),
      ],
    });
    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
    try {
      const rows = await adapter.discover({ searchPaths: [tmpRoot] });
      expect(rows[0].sub_hash).toBe('rawTool'); // first 7 chars of raw
      expect(stderrChunks.join('')).toMatch(/unexpected toolCallId format/i);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test('Test 7 — sub_index reflects chronological order of subagent.started events', async () => {
    makeSession('uuid-7', {
      workspaceYaml: DEFAULT_WORKSPACE,
      eventsLines: [
        startedEvent('toolu_vrtx_01AAA0000', '2026-03-05T12:30:00Z'),
        startedEvent('toolu_vrtx_01BBB0000', '2026-03-05T12:31:00Z'),
        startedEvent('toolu_vrtx_01CCC0000', '2026-03-05T12:32:00Z'),
        completedEvent('toolu_vrtx_01AAA0000', '2026-03-05T12:30:30Z'),
        completedEvent('toolu_vrtx_01BBB0000', '2026-03-05T12:31:30Z'),
        completedEvent('toolu_vrtx_01CCC0000', '2026-03-05T12:32:30Z'),
      ],
    });
    const rows = await adapter.discover({ searchPaths: [tmpRoot] });
    expect(rows.length).toBe(3);
    const ordered = rows.slice().sort((a, b) => a.sub_index - b.sub_index);
    expect(ordered.map((r) => r.sub_index)).toEqual([1, 2, 3]);
    expect(ordered[0].agent_metadata.toolCallId).toBe('toolu_vrtx_01AAA0000');
    expect(ordered[2].agent_metadata.toolCallId).toBe('toolu_vrtx_01CCC0000');
  });

  test('Test 8 — subagent.completed pairing stamps completed_at + status=success; orphan stays running', async () => {
    makeSession('uuid-8', {
      workspaceYaml: DEFAULT_WORKSPACE,
      eventsLines: [
        startedEvent('toolu_vrtx_01PAIRED'),
        completedEvent('toolu_vrtx_01PAIRED'),
        startedEvent('toolu_vrtx_01ORPHAN'),
        // no completed for ORPHAN
      ],
    });
    const rows = await adapter.discover({ searchPaths: [tmpRoot] });
    const paired = rows.find((r) => r.agent_metadata.toolCallId === 'toolu_vrtx_01PAIRED');
    const orphan = rows.find((r) => r.agent_metadata.toolCallId === 'toolu_vrtx_01ORPHAN');
    expect(paired.agent_metadata.completion_status).toBe('success');
    expect(paired.agent_metadata.completed_at).toBeTruthy();
    expect(orphan.agent_metadata.completion_status).toBeNull();
    expect(orphan.agent_metadata.completed_at).toBeNull();
  });

  test('Test 9 — subagent.failed pairing stamps completion_status=error + errorMessage', async () => {
    makeSession('uuid-9', {
      workspaceYaml: DEFAULT_WORKSPACE,
      eventsLines: [
        startedEvent('toolu_vrtx_01FAILED'),
        failedEvent('toolu_vrtx_01FAILED', 'context window exhausted'),
      ],
    });
    const rows = await adapter.discover({ searchPaths: [tmpRoot] });
    expect(rows.length).toBe(1);
    expect(rows[0].agent_metadata.completion_status).toBe('error');
    expect(rows[0].agent_metadata.errorMessage).toBe('context window exhausted');
  });

  test('Test 10 — path-injection cwd → project=unknown + stderr', async () => {
    const evilYaml = `id: aaa
cwd: /../../etc
git_root: /../../etc
repository: evil
branch: main
`;
    makeSession('uuid-10', {
      workspaceYaml: evilYaml,
      eventsLines: [startedEvent('toolu_vrtx_01EVILEVIL'), completedEvent('toolu_vrtx_01EVILEVIL')],
    });
    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
    try {
      const rows = await adapter.discover({ searchPaths: [tmpRoot] });
      expect(rows[0].project).toBe('unknown');
      expect(stderrChunks.join('')).toMatch(/invalid project path/i);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test('Test 11 — convertToObservations({dryRun:true}) does NOT write observations', async () => {
    makeSession('uuid-11', {
      workspaceYaml: DEFAULT_WORKSPACE,
      eventsLines: [startedEvent('toolu_vrtx_01DRYRUN1'), completedEvent('toolu_vrtx_01DRYRUN1')],
    });
    const rows = await adapter.discover({ searchPaths: [tmpRoot] });
    const result = await adapter.convertToObservations(rows, { dryRun: true, tag: 'sub-agent-backfill' });
    expect(writerCalls.length).toBe(0);
    expect(Array.isArray(result)).toBe(true);
  });

  test('Test 12 — convertToObservations({dryRun:false}) writes one synthetic observation per row + stamps stub-LSL marker', async () => {
    makeSession('uuid-12', {
      workspaceYaml: DEFAULT_WORKSPACE,
      eventsLines: [startedEvent('toolu_vrtx_01WRITE01'), completedEvent('toolu_vrtx_01WRITE01')],
    });
    const rows = await adapter.discover({ searchPaths: [tmpRoot] });
    await adapter.convertToObservations(rows, { dryRun: false, tag: 'sub-agent-backfill' });
    expect(writerCalls.length).toBe(1);
    const { messages, metadata } = writerCalls[0];
    // synthetic exchange: at least one user + one assistant message
    expect(messages.some((m) => m.role === 'user')).toBe(true);
    expect(messages.some((m) => m.role === 'assistant')).toBe(true);
    // metadata carries stub-LSL marker
    expect(metadata.lsl_incomplete).toBe(true);
    expect(metadata.lsl_incomplete_reason).toMatch(/lifecycle/i);
    expect(metadata.agent).toBe('copilot');
    expect(metadata.parent_session_id).toBe('uuid-12');
    expect(metadata.sub_index).toBe(1);
    expect(metadata.sub_hash).toBe('01WRITE');
    expect(metadata.source).toBe('sub-agent-backfill');
    // Summary mentions the agentName
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg.content).toMatch(/general-purpose/);
  });

  test('Test 13 — uid-check skips sessions owned by another uid', async () => {
    const sessionDir = makeSession('uuid-13', {
      workspaceYaml: DEFAULT_WORKSPACE,
      eventsLines: [startedEvent('toolu_vrtx_01UIDSKIP'), completedEvent('toolu_vrtx_01UIDSKIP')],
    });

    // Spy on fs.statSync — pretend this session dir is owned by uid 99999
    const realStatSync = fs.statSync;
    const fakeUid = 999999;
    jest.spyOn(fs, 'statSync').mockImplementation((p, opts) => {
      const real = realStatSync(p, opts);
      if (p === sessionDir) {
        return { ...real, uid: fakeUid, isDirectory: () => real.isDirectory(), isFile: () => real.isFile() };
      }
      return real;
    });
    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
    try {
      const rows = await adapter.discover({ searchPaths: [tmpRoot] });
      expect(rows.length).toBe(0);
      expect(stderrChunks.join('')).toMatch(/skipping non-owned/i);
    } finally {
      process.stderr.write = origWrite;
      fs.statSync.mockRestore();
    }
  });
});
