/**
 * tests/live-logging/sub-agent-registry.test.js
 *
 * Phase 51 Plan 01 Task 1: in-process registry + adapter loader.
 *
 * 12 tests covering:
 *   1.  createRegistry() returns instance with 7 methods
 *   2.  upsert inserts new row with status='discovered'
 *   3.  upsert idempotency — second call mutates same row
 *   4.  listByAgent filters by agent
 *   5.  listByProject filters across agents
 *   6.  markCompleted sets status='completed' + observations_written + completed_at
 *   7.  markCompleted with error sets status='failed'
 *   8.  AGENTS exports locked 4-tuple ['claude','opencode','copilot','mastra']
 *   9.  loadAdapter(agentId) returns null when no adapter file + stderr notice
 *  10.  loadAdapter(agentId) with fixture adapter returns adapter export
 *  11.  getAgentSearchPaths('claude') honors LSL_CLAUDE_PROJECTS_DIR
 *  12.  getAgentSearchPaths('opencode') returns sqlite-shaped Array<{type, dbPath}>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';

let createRegistry;
let AGENTS;
let loadAdapter;
let getAgentSearchPaths;

beforeAll(async () => {
  ({ createRegistry } = await import('../../lib/lsl/registry.mjs'));
  ({ AGENTS, loadAdapter, getAgentSearchPaths } = await import('../../lib/lsl/adapters/index.mjs'));
});

let tmpDir;
let savedEnv;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-agent-registry-'));
  // Snapshot env vars we may mutate so each test starts clean.
  savedEnv = {
    LSL_CLAUDE_PROJECTS_DIR: process.env.LSL_CLAUDE_PROJECTS_DIR,
    LSL_OPENCODE_DB: process.env.LSL_OPENCODE_DB,
    LSL_COPILOT_SESSIONS_DIR: process.env.LSL_COPILOT_SESSIONS_DIR,
    LSL_MASTRA_TRANSCRIPTS_DIR: process.env.LSL_MASTRA_TRANSCRIPTS_DIR,
    LSL_ADAPTERS_DIR: process.env.LSL_ADAPTERS_DIR,
  };
});

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  // Restore snapshotted env.
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function sampleRow(overrides = {}) {
  return {
    agent: 'claude',
    sub_hash: 'a7e8c41',
    parent_session_id: 'parent-uuid-1',
    sub_index: 1,
    transcript_path: '/Users/x/.claude/projects/-coding/parent-uuid-1/subagents/agent-a7e8c41.jsonl',
    project: 'coding',
    agent_metadata: { agentName: 'gsd-executor' },
    ...overrides,
  };
}

describe('createRegistry — Registry shape', () => {
  test('Test 1: createRegistry() returns instance with all 7 methods', () => {
    const r = createRegistry();
    expect(typeof r.upsert).toBe('function');
    expect(typeof r.get).toBe('function');
    expect(typeof r.listByAgent).toBe('function');
    expect(typeof r.listByProject).toBe('function');
    expect(typeof r.markCompleted).toBe('function');
    expect(typeof r.size).toBe('function');
    expect(typeof r.clear).toBe('function');
  });

  test('Test 2: upsert inserts a new row with status="discovered" by default', () => {
    const r = createRegistry();
    const row = sampleRow();
    const inserted = r.upsert(row);
    expect(inserted.agent).toBe('claude');
    expect(inserted.sub_hash).toBe('a7e8c41');
    expect(inserted.parent_session_id).toBe('parent-uuid-1');
    expect(inserted.status).toBe('discovered');
    expect(inserted.observations_written).toBe(0);
    expect(typeof inserted.discovered_at).toBe('string');
    // ISO-parseable
    expect(Number.isFinite(Date.parse(inserted.discovered_at))).toBe(true);
    expect(inserted.completed_at).toBeNull();
    expect(inserted.error).toBeNull();
    const fetched = r.get('claude', 'a7e8c41');
    expect(fetched).toEqual(inserted);
  });

  test('Test 3: upsert called twice with same (agent, sub_hash) MUTATES — size stays 1', () => {
    const r = createRegistry();
    r.upsert(sampleRow());
    expect(r.size()).toBe(1);
    // Second call with different sub_index — should mutate, not append.
    const updated = r.upsert(sampleRow({ sub_index: 2 }));
    expect(updated.sub_index).toBe(2);
    expect(r.size()).toBe(1);
    expect(r.get('claude', 'a7e8c41').sub_index).toBe(2);
  });

  test('Test 4: listByAgent filters by agent across all four ids', () => {
    const r = createRegistry();
    r.upsert(sampleRow({ agent: 'claude', sub_hash: 'cl1' }));
    r.upsert(sampleRow({ agent: 'claude', sub_hash: 'cl2' }));
    r.upsert(sampleRow({ agent: 'opencode', sub_hash: 'oc1' }));
    r.upsert(sampleRow({ agent: 'copilot', sub_hash: 'co1' }));
    r.upsert(sampleRow({ agent: 'mastra', sub_hash: 'ma1' }));
    expect(r.listByAgent('claude')).toHaveLength(2);
    expect(r.listByAgent('opencode')).toHaveLength(1);
    expect(r.listByAgent('copilot')).toHaveLength(1);
    expect(r.listByAgent('mastra')).toHaveLength(1);
    expect(r.listByAgent('nonexistent')).toEqual([]);
  });

  test('Test 5: listByProject filters across all four agents', () => {
    const r = createRegistry();
    r.upsert(sampleRow({ agent: 'claude', sub_hash: 'cl1', project: 'coding' }));
    r.upsert(sampleRow({ agent: 'opencode', sub_hash: 'oc1', project: 'coding' }));
    r.upsert(sampleRow({ agent: 'copilot', sub_hash: 'co1', project: 'other-proj' }));
    expect(r.listByProject('coding')).toHaveLength(2);
    expect(r.listByProject('other-proj')).toHaveLength(1);
    expect(r.listByProject('nope')).toEqual([]);
  });

  test('Test 6: markCompleted sets status="completed", observations_written, ISO completed_at; preserves original fields', () => {
    const r = createRegistry();
    r.upsert(sampleRow());
    const t0 = Date.now() - 1;
    const updated = r.markCompleted('claude', 'a7e8c41', { observations_written: 5 });
    expect(updated.status).toBe('completed');
    expect(updated.observations_written).toBe(5);
    expect(typeof updated.completed_at).toBe('string');
    const completedMs = Date.parse(updated.completed_at);
    expect(Number.isFinite(completedMs)).toBe(true);
    expect(completedMs).toBeGreaterThanOrEqual(t0);
    // Originals preserved
    expect(updated.parent_session_id).toBe('parent-uuid-1');
    expect(updated.transcript_path).toContain('agent-a7e8c41.jsonl');
    expect(updated.project).toBe('coding');
    expect(updated.error).toBeNull();
  });

  test('Test 7: markCompleted with error sets status="failed" and stores error string', () => {
    const r = createRegistry();
    r.upsert(sampleRow());
    const updated = r.markCompleted('claude', 'a7e8c41', { error: 'parse failure on line 42' });
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('parse failure on line 42');
    expect(updated.observations_written).toBe(0);
  });
});

describe('adapters/index.mjs — loader contract', () => {
  test('Test 8: AGENTS exports the locked 4-tuple in canonical order', () => {
    expect(AGENTS).toEqual(['claude', 'opencode', 'copilot', 'mastra']);
    // Frozen — append should throw.
    expect(() => AGENTS.push('xtra')).toThrow();
  });

  test('Test 9: loadAdapter(claude) with NO adapter file returns null + stderr notice', async () => {
    // Point adapters dir to an empty tmpdir so no per-agent file exists.
    process.env.LSL_ADAPTERS_DIR = tmpDir;
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const mod = await loadAdapter('claude');
      expect(mod).toBeNull();
      const combined = stderrSpy.mock.calls.map((c) => c[0]).join('');
      // Accept either of the two phrasings the plan permits.
      expect(/adapter not yet implemented|no adapter found/i.test(combined)).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test('Test 10: loadAdapter(claude) returns adapter export when fixture present', async () => {
    // Write a fixture adapter file at the tmpdir-overridden adapters dir.
    process.env.LSL_ADAPTERS_DIR = tmpDir;
    const fixturePath = path.join(tmpDir, 'claude-fixture.mjs');
    fs.writeFileSync(
      fixturePath,
      `export const adapter = {
  agentId: 'claude',
  storageType: 'jsonl-tree',
  async discover() { return []; },
  async convertToObservations() { return []; },
};
`,
      'utf-8',
    );
    const mod = await loadAdapter('claude');
    expect(mod).not.toBeNull();
    expect(mod.agentId).toBe('claude');
    expect(mod.storageType).toBe('jsonl-tree');
    expect(typeof mod.discover).toBe('function');
    expect(typeof mod.convertToObservations).toBe('function');
  });
});

describe('adapters/index.mjs — getAgentSearchPaths', () => {
  test('Test 11: getAgentSearchPaths(claude) honors LSL_CLAUDE_PROJECTS_DIR; defaults to ~/.claude/projects', () => {
    const customDir = path.join(tmpDir, 'custom-claude-dir');
    fs.mkdirSync(customDir, { recursive: true });
    process.env.LSL_CLAUDE_PROJECTS_DIR = customDir;
    const paths = getAgentSearchPaths('claude');
    expect(Array.isArray(paths)).toBe(true);
    expect(paths).toContain(customDir);

    // Now remove the override and confirm default points at ~/.claude/projects
    delete process.env.LSL_CLAUDE_PROJECTS_DIR;
    const defaults = getAgentSearchPaths('claude');
    expect(Array.isArray(defaults)).toBe(true);
    const expectedDefault = path.join(os.homedir(), '.claude', 'projects');
    expect(defaults).toContain(expectedDefault);
  });

  test('Test 12: getAgentSearchPaths(opencode) returns Array<{type:"sqlite", dbPath}>', () => {
    const customDb = path.join(tmpDir, 'opencode.db');
    process.env.LSL_OPENCODE_DB = customDb;
    const paths = getAgentSearchPaths('opencode');
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
    const entry = paths[0];
    expect(entry).toMatchObject({ type: 'sqlite', dbPath: customDb });
    // Critical: NOT Array<string>
    expect(typeof entry).toBe('object');
    expect(typeof entry).not.toBe('string');
  });
});
