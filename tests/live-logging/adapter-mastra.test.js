/**
 * tests/live-logging/adapter-mastra.test.js
 *
 * Phase 51 Plan 05 Task 1: Mastra Path B (sweep) adapter — NDJSON parser
 * handling BOTH the current parent-only mastracode shape AND the
 * forward-compat sub-agent shape per RESEARCH-mastra.md §Detection plan —
 * Path B forward-compat hook.
 *
 * 13 tests covering:
 *   1.  adapter export shape — {agentId, storageType, discover, convertToObservations}
 *   2.  empty-file no-op (empty directory) → []
 *   3.  missing-file no-op (non-existent directory) → []
 *   4.  parent-only NDJSON (Section A of fixture) → 0 rows + stderr forward-compat notice
 *   5.  forward-compat sub-agent shape (single subagent_start) → 1 row, sub_index=1
 *   6.  multiple sub-agents in same file (Section B has 2) → 2 rows with sub_index=1,2
 *   7.  multi-session NDJSON — partition by sessionId not file-position
 *   8.  project mapping — <tmpdir>/coding/.observations/transcripts/ → row.project='coding'
 *   9.  project allowlist — paths failing the allowlist regex are skipped with stderr
 *  10.  uid-check — file owned by a different uid is skipped (statSync mocked)
 *  11.  convertToObservations({dryRun:true}) does NOT invoke writer
 *  12.  convertToObservations({dryRun:false}) — forward-compat shape produces observations
 *  13.  convertToObservations({dryRun:false}) — empty rows in → empty results out
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'mastra', 'mastra-transcript-sample.jsonl');

// Mock the heavy deps used by convertToObservations so we don't touch the DB / network.
const writerCalls = [];
jest.unstable_mockModule('../../src/live-logging/ObservationApiClient.js', () => ({
  ObservationApiClient: class {
    constructor(opts) { this.opts = opts; }
    async init() { /* no-op */ }
    async close() { /* no-op */ }
    async processMessages(messages, metadata = {}) {
      writerCalls.push({ messages, metadata });
      const hasUser = messages.some(m => m.role === 'user');
      const hasAsst = messages.some(m => m.role === 'assistant');
      return { observations: hasUser && hasAsst ? 1 : 0, errors: 0 };
    }
  },
}));

let adapter;

beforeAll(async () => {
  const mod = await import('../../lib/lsl/adapters/mastra-ndjson.mjs');
  adapter = mod.adapter;
});

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastra-adapter-'));
  writerCalls.length = 0;
});

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Stage a mastra transcripts directory at <tmpDir>/<project>/.observations/transcripts/
 * with the given NDJSON content, return the search-path (the transcripts dir).
 */
function stageTranscript(project, ndjsonContent, filename = 'mastra-transcript.jsonl') {
  const projectDir = path.join(tmpDir, project);
  const transcriptsDir = path.join(projectDir, '.observations', 'transcripts');
  fs.mkdirSync(transcriptsDir, { recursive: true });
  const filePath = path.join(transcriptsDir, filename);
  fs.writeFileSync(filePath, ndjsonContent, 'utf-8');
  return { transcriptsDir, filePath };
}

function readFixture() {
  return fs.readFileSync(FIXTURE_PATH, 'utf-8');
}

/** Lines belonging to Section A of the fixture (parent-only mastracode shape). */
function sectionA() {
  const lines = readFixture().split('\n').filter(Boolean);
  // Section A: indexes 0..6 (session_start + 5 events + session_end for ses_parent_A).
  return lines.slice(0, 7).join('\n') + '\n';
}

/** Lines belonging to Section B of the fixture (forward-compat sub-agent shape). */
function sectionB() {
  const lines = readFixture().split('\n').filter(Boolean);
  // Section B: indexes 7..16 (parent B with 2 sub-agents).
  return lines.slice(7).join('\n') + '\n';
}

describe('mastra-ndjson adapter — contract + shape', () => {
  test('Test 1: adapter exports {agentId:"mastra", storageType:"ndjson", discover, convertToObservations}', () => {
    expect(adapter).toBeDefined();
    expect(adapter.agentId).toBe('mastra');
    expect(adapter.storageType).toBe('ndjson');
    expect(typeof adapter.discover).toBe('function');
    expect(typeof adapter.convertToObservations).toBe('function');
  });
});

describe('mastra-ndjson adapter — discover() no-op safety', () => {
  test('Test 2: empty transcripts dir → [] without error', async () => {
    const { transcriptsDir } = stageTranscript('coding', '', 'mastra-transcript.jsonl');
    // Remove the empty file to make the dir truly empty (no files).
    for (const f of fs.readdirSync(transcriptsDir)) {
      fs.rmSync(path.join(transcriptsDir, f));
    }
    const rows = await adapter.discover({ searchPaths: [transcriptsDir], project: 'coding' });
    expect(rows).toEqual([]);
  });

  test('Test 3: missing transcripts dir → [] without error', async () => {
    const rows = await adapter.discover({
      searchPaths: [path.join(tmpDir, 'no-such-dir')],
      project: 'coding',
    });
    expect(rows).toEqual([]);
  });
});

describe('mastra-ndjson adapter — discover() shape handling', () => {
  test('Test 4: parent-only NDJSON → 0 rows + stderr forward-compat notice', async () => {
    const { transcriptsDir, filePath } = stageTranscript('coding', sectionA());
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const rows = await adapter.discover({ searchPaths: [transcriptsDir], project: 'coding' });
      expect(rows).toEqual([]);
      const combined = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(combined).toMatch(/\[mastra-adapter\] no sub-agent records in /);
      expect(combined).toMatch(/parent-only mastracode shape; forward-compat hook ready/);
      expect(combined).toContain(filePath);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test('Test 5: forward-compat single subagent_start → 1 row with sub_index=1 and full metadata', async () => {
    // Build a fixture with just ONE sub-agent: parent + 1 subagent_start + msgs + subagent_end + parent end.
    const lines = [
      { type: 'session_start', sessionId: 'ses_parent_X', cwd: '/tmp/coding', timestamp: '2026-05-26T18:00:00Z' },
      { type: 'subagent_start', sessionId: 'ses_parent_X', subAgentSessionId: 'ses_subX', subIndex: 1, subName: 'reviewer', timestamp: '2026-05-26T18:00:01Z' },
      { type: 'message', role: 'user', content: 'review', sessionId: 'ses_subX', subAgentSessionId: 'ses_subX', timestamp: '2026-05-26T18:00:02Z' },
      { type: 'message', role: 'assistant', content: 'done', sessionId: 'ses_subX', subAgentSessionId: 'ses_subX', timestamp: '2026-05-26T18:00:03Z' },
      { type: 'subagent_end', sessionId: 'ses_parent_X', subAgentSessionId: 'ses_subX', timestamp: '2026-05-26T18:00:04Z' },
      { type: 'session_end', sessionId: 'ses_parent_X', cwd: '/tmp/coding', timestamp: '2026-05-26T18:00:05Z' },
    ];
    const ndjson = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    const { transcriptsDir, filePath } = stageTranscript('coding', ndjson);
    const rows = await adapter.discover({ searchPaths: [transcriptsDir], project: 'coding' });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.agent).toBe('mastra');
    expect(r.parent_session_id).toBe('ses_parent_X');
    expect(r.sub_index).toBe(1);
    expect(r.sub_hash).toBe('ses_sub'.slice(0, 7));
    expect(r.transcript_path).toBe(filePath);
    expect(r.project).toBe('coding');
    expect(r.status).toBe('discovered');
    expect(r.detected_via).toBe('sweep');
    expect(typeof r.discovered_at).toBe('string');
    expect(r.agent_metadata.subName).toBe('reviewer');
    expect(r.agent_metadata.subAgentSessionId).toBe('ses_subX');
    expect(r.agent_metadata.lsl_incomplete).toBe(false);
    expect(typeof r.agent_metadata.started_at).toBe('string');
    expect(typeof r.agent_metadata.completed_at).toBe('string');
  });

  test('Test 6: two sub-agents in same file → 2 rows with sub_index=1 and sub_index=2', async () => {
    const { transcriptsDir } = stageTranscript('coding', sectionB());
    const rows = await adapter.discover({ searchPaths: [transcriptsDir], project: 'coding' });
    expect(rows).toHaveLength(2);
    const byIndex = new Map(rows.map((r) => [r.sub_index, r]));
    expect(byIndex.has(1)).toBe(true);
    expect(byIndex.has(2)).toBe(true);
    expect(byIndex.get(1).agent_metadata.subName).toBe('reviewer');
    expect(byIndex.get(2).agent_metadata.subName).toBe('tester');
    expect(byIndex.get(1).agent_metadata.subAgentSessionId).toBe('ses_sub1');
    expect(byIndex.get(2).agent_metadata.subAgentSessionId).toBe('ses_sub2');
    expect(byIndex.get(1).parent_session_id).toBe('ses_parent_B');
    expect(byIndex.get(2).parent_session_id).toBe('ses_parent_B');
  });

  test('Test 7: multi-session NDJSON — sub-agents partition by sessionId not file-position', async () => {
    // Two parent sessions A and B interleaved; sub-agents reference their parent
    // via sessionId on subagent_start — NOT by appearance order in the file.
    const lines = [
      { type: 'session_start', sessionId: 'ses_A', cwd: '/tmp/coding', timestamp: '2026-05-26T19:00:00Z' },
      { type: 'session_start', sessionId: 'ses_B', cwd: '/tmp/coding', timestamp: '2026-05-26T19:00:01Z' },
      // Sub-agent of parent B (appears BEFORE A's sub-agent in file)
      { type: 'subagent_start', sessionId: 'ses_B', subAgentSessionId: 'ses_subFromB', subIndex: 1, subName: 'b-reviewer', timestamp: '2026-05-26T19:00:02Z' },
      { type: 'message', role: 'user', content: 'B', sessionId: 'ses_subFromB', subAgentSessionId: 'ses_subFromB', timestamp: '2026-05-26T19:00:03Z' },
      // Sub-agent of parent A (appears AFTER B's sub-agent)
      { type: 'subagent_start', sessionId: 'ses_A', subAgentSessionId: 'ses_subFromA', subIndex: 1, subName: 'a-reviewer', timestamp: '2026-05-26T19:00:04Z' },
      { type: 'message', role: 'user', content: 'A', sessionId: 'ses_subFromA', subAgentSessionId: 'ses_subFromA', timestamp: '2026-05-26T19:00:05Z' },
      { type: 'subagent_end', sessionId: 'ses_B', subAgentSessionId: 'ses_subFromB', timestamp: '2026-05-26T19:00:06Z' },
      { type: 'subagent_end', sessionId: 'ses_A', subAgentSessionId: 'ses_subFromA', timestamp: '2026-05-26T19:00:07Z' },
      { type: 'session_end', sessionId: 'ses_A', cwd: '/tmp/coding', timestamp: '2026-05-26T19:00:08Z' },
      { type: 'session_end', sessionId: 'ses_B', cwd: '/tmp/coding', timestamp: '2026-05-26T19:00:09Z' },
    ];
    const ndjson = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    const { transcriptsDir } = stageTranscript('coding', ndjson);
    const rows = await adapter.discover({ searchPaths: [transcriptsDir], project: 'coding' });
    expect(rows).toHaveLength(2);
    // Partition correctness: each sub-agent's parent_session_id is keyed by the
    // subagent_start record's sessionId field, NOT inferred from preceding
    // session_start records in file order.
    const bySubId = new Map(rows.map((r) => [r.agent_metadata.subAgentSessionId, r]));
    expect(bySubId.get('ses_subFromA').parent_session_id).toBe('ses_A');
    expect(bySubId.get('ses_subFromB').parent_session_id).toBe('ses_B');
  });
});

describe('mastra-ndjson adapter — project mapping + safety', () => {
  test('Test 8: project derived from path ancestor of .observations/transcripts/', async () => {
    const { transcriptsDir } = stageTranscript('coding', sectionB());
    const rows = await adapter.discover({ searchPaths: [transcriptsDir], project: 'coding' });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.project).toBe('coding');
  });

  test('Test 9: project allowlist — non-allowlisted project name is skipped + stderr', async () => {
    // Stage a transcript under a bad-ish project name. Use a name that fails
    // /^[a-z0-9-]+$/i — e.g. contains slash by way of path traversal.
    // We cannot literally put a "/" in a directory name, but we can use chars
    // outside the allowlist: a dot.
    const badProjectDir = path.join(tmpDir, 'bad.project');
    const badTranscriptsDir = path.join(badProjectDir, '.observations', 'transcripts');
    fs.mkdirSync(badTranscriptsDir, { recursive: true });
    const filePath = path.join(badTranscriptsDir, 'mastra-transcript.jsonl');
    fs.writeFileSync(filePath, sectionB(), 'utf-8');

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const rows = await adapter.discover({ searchPaths: [badTranscriptsDir] });
      expect(rows).toEqual([]);
      const combined = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(combined).toMatch(/invalid project path/i);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test('Test 10: uid-check — file owned by different uid is skipped with stderr', async () => {
    const { transcriptsDir, filePath } = stageTranscript('coding', sectionB());
    // Spy on fs.statSync to return a foreign uid for the transcript file only.
    const realStat = fs.statSync.bind(fs);
    const ownUid = process.getuid();
    const spy = jest.spyOn(fs, 'statSync').mockImplementation((p, ...rest) => {
      const stat = realStat(p, ...rest);
      if (p === filePath) {
        // Return a Stats-like object with foreign uid.
        return new Proxy(stat, {
          get(target, prop) {
            if (prop === 'uid') return ownUid + 9999;
            return target[prop];
          },
        });
      }
      return stat;
    });
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const rows = await adapter.discover({ searchPaths: [transcriptsDir], project: 'coding' });
      expect(rows).toEqual([]);
      const combined = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(combined).toMatch(/skipping non-owned|skip non-owner/i);
    } finally {
      spy.mockRestore();
      stderrSpy.mockRestore();
    }
  });
});

describe('mastra-ndjson adapter — convertToObservations', () => {
  test('Test 11: dryRun:true does NOT invoke writer', async () => {
    const { transcriptsDir, filePath } = stageTranscript('coding', sectionB());
    const rows = await adapter.discover({ searchPaths: [transcriptsDir], project: 'coding' });
    expect(rows.length).toBeGreaterThan(0);
    const results = await adapter.convertToObservations(rows, { dryRun: true, tag: 'sub-agent-backfill' });
    expect(Array.isArray(results)).toBe(true);
    expect(writerCalls).toHaveLength(0);
  });

  test('Test 12: dryRun:false invokes writer.processMessages and stamps metadata per row', async () => {
    const { transcriptsDir, filePath } = stageTranscript('coding', sectionB());
    const rows = await adapter.discover({ searchPaths: [transcriptsDir], project: 'coding' });
    expect(rows.length).toBe(2);
    const results = await adapter.convertToObservations(rows, { dryRun: false, tag: 'sub-agent-backfill' });
    expect(Array.isArray(results)).toBe(true);
    expect(writerCalls.length).toBeGreaterThan(0);
    // Each writer call should carry the per-row metadata (parent_session_id,
    // sub_index, sub_hash, agent='mastra', project).
    const meta = writerCalls[0].metadata;
    expect(meta.agent).toBe('mastra');
    expect(meta.project).toBe('coding');
    expect(typeof meta.parent_session_id).toBe('string');
    expect(typeof meta.sub_index).toBe('number');
    expect(typeof meta.sub_hash).toBe('string');
    // Tag propagated
    expect(meta.tag === 'sub-agent-backfill' || meta.source === 'sub-agent-backfill').toBe(true);
  });

  test('Test 13: empty rows in → empty results out (parent-only case)', async () => {
    const { transcriptsDir } = stageTranscript('coding', sectionA());
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const rows = await adapter.discover({ searchPaths: [transcriptsDir], project: 'coding' });
      expect(rows).toEqual([]);
      const results = await adapter.convertToObservations(rows, { dryRun: false, tag: 'sub-agent-backfill' });
      expect(results).toEqual([]);
      expect(writerCalls).toHaveLength(0);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
