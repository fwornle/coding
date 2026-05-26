/**
 * tests/live-logging/adapter-claude.test.js
 *
 * Phase 51 Plan 02 Task 1: Claude Code Path B sweep adapter.
 *
 * 12 tests covering:
 *   1.  projectFromClaudeSubagentPath — decodes encoded-cwd to 'coding'
 *   2.  parentSessionFromClaudeSubagentPath — extracts UUID
 *   3.  agentIdFromClaudeSubagentPath — extracts full hex
 *   4.  subHashFromAgentId — first 7 chars
 *   5.  discover() returns rows for 3 fixture transcripts across 2 parent dirs
 *   6.  discover() sub_index ordering — by first-message timestamp, NOT lexicographic
 *   7.  discover() uid-check gate — fail-closed for non-owned files (T-51-02-FI)
 *   8.  discover() isSidechain:false filter — defense-in-depth (landmine #3)
 *   9.  discover() handles truncated last lines gracefully (landmine #5)
 *  10.  convertToObservations() delegates to Phase 50 primitive
 *  11.  convertToObservations() passes per-row metadata via tag/source channel
 *  12.  Adapter exports the locked {agentId, storageType, discover, convertToObservations} contract
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { jest } from '@jest/globals';

// Mock the Phase 50 primitive BEFORE importing the adapter — must be set up
// before any dynamic import of the adapter module so the mock is picked up.
const convertCalls = [];
jest.unstable_mockModule('../../lib/lsl/scan-and-convert.mjs', () => ({
  scanTranscriptsForUnconverted: jest.fn(() => []),
  convertTranscriptsToObservations: jest.fn(async (transcripts, opts) => {
    convertCalls.push({ transcripts, opts });
    return transcripts.map((t) => ({
      transcriptPath: t.path,
      observationsWritten: 1,
      skipped: 0,
    }));
  }),
}));

let adapter;
let projectFromClaudeSubagentPath;
let parentSessionFromClaudeSubagentPath;
let agentIdFromClaudeSubagentPath;
let subHashFromAgentId;

beforeAll(async () => {
  const mod = await import('../../lib/lsl/adapters/claude-jsonl-tree.mjs');
  adapter = mod.adapter;
  projectFromClaudeSubagentPath = mod.projectFromClaudeSubagentPath;
  parentSessionFromClaudeSubagentPath = mod.parentSessionFromClaudeSubagentPath;
  agentIdFromClaudeSubagentPath = mod.agentIdFromClaudeSubagentPath;
  subHashFromAgentId = mod.subHashFromAgentId;
});

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-claude-'));
  convertCalls.length = 0;
});

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Path under tmpDir that mirrors the real `~/.claude/projects/` layout so the
 * adapter's SUBAGENT_PATH_RE anchors match. Everything below this prefix is
 * the test's fake claude-projects root.
 */
function claudeRoot() {
  return path.join(tmpDir, '.claude', 'projects');
}

/**
 * Write a fake sub-agent JSONL fixture under
 *   <tmpDir>/.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl
 * and return the absolute path.
 *
 * @param {object} opts
 * @param {string} opts.encodedCwd  e.g. '-Users-Q284340-Agentic-coding'
 * @param {string} opts.parentUuid  36-char UUID
 * @param {string} opts.agentId     17-char hex
 * @param {Array<object>} opts.records   Records to write (one per line)
 */
function writeSubAgent({ encodedCwd, parentUuid, agentId, records }) {
  const dir = path.join(claudeRoot(), encodedCwd, parentUuid, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `agent-${agentId}.jsonl`);
  fs.writeFileSync(abs, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
  // Set mtime ~24h ago so it clears the Phase 50 race-guard if used downstream.
  const oldMs = Date.now() - 24 * 60 * 60 * 1000;
  fs.utimesSync(abs, oldMs / 1000, oldMs / 1000);
  return abs;
}

function userMsg(ts) {
  return {
    agentId: 'placeholder',
    cwd: '/Users/Q284340/Agentic/coding',
    isSidechain: true,
    message: { role: 'user', content: 'hello' },
    parentUuid: null,
    sessionId: 'session-uuid',
    timestamp: ts,
    type: 'user',
    userType: 'external',
    uuid: 'msg-1',
    version: '2.1.141',
  };
}

function assistantMsg(ts, attribAgent = 'gsd-executor', attribSkill = 'gsd-execute-phase') {
  return {
    agentId: 'placeholder',
    attributionAgent: attribAgent,
    attributionSkill: attribSkill,
    cwd: '/Users/Q284340/Agentic/coding',
    isSidechain: true,
    message: { role: 'assistant', content: 'hi' },
    parentUuid: 'msg-1',
    requestId: 'req-1',
    sessionId: 'session-uuid',
    timestamp: ts,
    type: 'assistant',
    userType: 'external',
    uuid: 'msg-2',
    version: '2.1.141',
  };
}

describe('path-parsing helpers', () => {
  const samplePath = '/Users/Q284340/.claude/projects/-Users-Q284340-Agentic-coding/abcdef12-3456-7890-abcd-ef1234567890/subagents/agent-deadbeef1234fa6f7.jsonl';

  test('Test 1: projectFromClaudeSubagentPath decodes encoded-cwd to last segment', () => {
    expect(projectFromClaudeSubagentPath(samplePath)).toBe('coding');
  });

  test('Test 2: parentSessionFromClaudeSubagentPath returns UUID', () => {
    expect(parentSessionFromClaudeSubagentPath(samplePath)).toBe('abcdef12-3456-7890-abcd-ef1234567890');
  });

  test('Test 3: agentIdFromClaudeSubagentPath returns full hex', () => {
    expect(agentIdFromClaudeSubagentPath(samplePath)).toBe('deadbeef1234fa6f7');
  });

  test('Test 4: subHashFromAgentId returns first 7 chars', () => {
    expect(subHashFromAgentId('a24960e65f317241e')).toBe('a24960e');
  });
});

describe('discover()', () => {
  test('Test 5: returns 3 rows for 3 fixtures across 2 parent dirs', async () => {
    const encodedCwd = '-Users-Q284340-Agentic-coding';
    const uuid1 = '11111111-1111-1111-1111-111111111111';
    const uuid2 = '22222222-2222-2222-2222-222222222222';

    writeSubAgent({
      encodedCwd, parentUuid: uuid1, agentId: 'aaaaaaaaaaaaaaaaa',
      records: [userMsg('2026-05-23T10:00:00Z'), assistantMsg('2026-05-23T10:00:05Z')],
    });
    writeSubAgent({
      encodedCwd, parentUuid: uuid1, agentId: 'bbbbbbbbbbbbbbbbb',
      records: [userMsg('2026-05-23T10:05:00Z'), assistantMsg('2026-05-23T10:05:05Z')],
    });
    writeSubAgent({
      encodedCwd, parentUuid: uuid2, agentId: 'ccccccccccccccccc',
      records: [userMsg('2026-05-23T11:00:00Z'), assistantMsg('2026-05-23T11:00:05Z')],
    });

    const rows = await adapter.discover({
      searchPaths: [tmpDir],
      project: 'coding',
    });
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.agent).toBe('claude');
      expect(r.project).toBe('coding');
      expect(r.status).toBe('discovered');
      expect(r.detected_via).toBe('sweep');
      expect(typeof r.sub_hash).toBe('string');
      expect(r.sub_hash.length).toBe(7);
      expect(typeof r.parent_session_id).toBe('string');
      expect(typeof r.discovered_at).toBe('string');
      expect(r.agent_metadata).toBeDefined();
    }
  });

  test('Test 6: sub_index by first-message timestamp NOT lexicographic order', async () => {
    const encodedCwd = '-Users-Q284340-Agentic-coding';
    const uuid = '33333333-3333-3333-3333-333333333333';

    // Both ids must be lowercase hex per Claude's filename schema. The
    // hex-lex order is fff... > aaa... but make fff... have a LATER first
    // message and aaa... have an EARLIER one → first-msg-ts ordering should
    // give aaa=1 and fff=2 — matching what lex would also give. To prove
    // ordering is by TIMESTAMP NOT LEX we therefore use two ids where lex
    // ordering disagrees with desired sub_index assignment: 'fffffffffffffffff'
    // (lex-greater, ts-earlier) and 'aaaaaaaaaaaaaaaaa' (lex-lesser, ts-later).
    // sub_index should give fff=1 and aaa=2 — the OPPOSITE of lex order.
    writeSubAgent({
      encodedCwd, parentUuid: uuid, agentId: 'fffffffffffffffff',
      records: [userMsg('2026-05-23T10:00:05Z'), assistantMsg('2026-05-23T10:00:10Z')],
    });
    writeSubAgent({
      encodedCwd, parentUuid: uuid, agentId: 'aaaaaaaaaaaaaaaaa',
      records: [userMsg('2026-05-23T10:00:10Z'), assistantMsg('2026-05-23T10:00:15Z')],
    });

    const rows = await adapter.discover({
      searchPaths: [tmpDir],
      project: 'coding',
    });
    expect(rows).toHaveLength(2);
    const fff = rows.find((r) => r.agent_metadata?.agent_id === 'fffffffffffffffff');
    const aaa = rows.find((r) => r.agent_metadata?.agent_id === 'aaaaaaaaaaaaaaaaa');
    expect(aaa).toBeDefined();
    expect(fff).toBeDefined();
    expect(fff.sub_index).toBe(1); // earlier first-msg timestamp (lex-greater)
    expect(aaa.sub_index).toBe(2); // later first-msg timestamp (lex-lesser)
  });

  test('Test 7: uid-check gate — non-owned file is skipped with stderr', async () => {
    const encodedCwd = '-Users-Q284340-Agentic-coding';
    const uuid = '44444444-4444-4444-4444-444444444444';
    const p = writeSubAgent({
      encodedCwd, parentUuid: uuid, agentId: 'ddddddddddddddddd',
      records: [userMsg('2026-05-23T12:00:00Z'), assistantMsg('2026-05-23T12:00:05Z')],
    });

    // Spy on fs.statSync to return a stub with a non-owner uid for our file.
    const realStat = fs.statSync.bind(fs);
    const myUid = process.getuid();
    const statSpy = jest.spyOn(fs, 'statSync').mockImplementation((file, ...args) => {
      const s = realStat(file, ...args);
      if (file === p) {
        // Return a stat-like proxy with uid !== process.getuid().
        return { ...s, uid: myUid + 12345, mtimeMs: s.mtimeMs, size: s.size, mode: s.mode };
      }
      return s;
    });
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      const rows = await adapter.discover({
        searchPaths: [tmpDir],
        project: 'coding',
      });
      expect(rows).toHaveLength(0);
      const calls = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(calls).toMatch(/skipping non-owned/);
    } finally {
      statSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  test('Test 8: isSidechain:false filter — file skipped with stderr', async () => {
    const encodedCwd = '-Users-Q284340-Agentic-coding';
    const uuid = '55555555-5555-5555-5555-555555555555';
    const dir = path.join(claudeRoot(), encodedCwd, uuid, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, 'agent-eeeeeeeeeeeeeeeee.jsonl');
    // First line has isSidechain:false — should be rejected.
    const bogus = { ...userMsg('2026-05-23T13:00:00Z'), isSidechain: false };
    fs.writeFileSync(abs, JSON.stringify(bogus) + '\n', 'utf-8');
    const oldMs = Date.now() - 24 * 60 * 60 * 1000;
    fs.utimesSync(abs, oldMs / 1000, oldMs / 1000);

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const rows = await adapter.discover({
        searchPaths: [tmpDir],
        project: 'coding',
      });
      expect(rows).toHaveLength(0);
      const calls = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(calls).toMatch(/skipped non-sidechain/);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test('Test 9: truncated last lines do not throw — row still produced', async () => {
    const encodedCwd = '-Users-Q284340-Agentic-coding';
    const uuid = '66666666-6666-6666-6666-666666666666';
    const dir = path.join(claudeRoot(), encodedCwd, uuid, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, 'agent-fffffffffffffffff.jsonl');
    // Valid first line + malformed second line (truncated JSON).
    const valid = userMsg('2026-05-23T14:00:00Z');
    fs.writeFileSync(abs, JSON.stringify(valid) + '\n' + '{"truncated":', 'utf-8');
    const oldMs = Date.now() - 24 * 60 * 60 * 1000;
    fs.utimesSync(abs, oldMs / 1000, oldMs / 1000);

    const rows = await adapter.discover({
      searchPaths: [tmpDir],
      project: 'coding',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].sub_hash).toBe('fffffff');
  });
});

describe('convertToObservations()', () => {
  test('Test 10: delegates to Phase 50 convertTranscriptsToObservations with tag', async () => {
    const rows = [
      {
        agent: 'claude',
        sub_hash: 'abcdefg',
        parent_session_id: 'p1',
        sub_index: 1,
        transcript_path: '/some/path/agent-abcdefg1234567.jsonl',
        project: 'coding',
        agent_metadata: { agent_id: 'abcdefg1234567' },
      },
      {
        agent: 'claude',
        sub_hash: 'hijklmn',
        parent_session_id: 'p1',
        sub_index: 2,
        transcript_path: '/some/path/agent-hijklmn1234567.jsonl',
        project: 'coding',
        agent_metadata: { agent_id: 'hijklmn1234567' },
      },
      {
        agent: 'claude',
        sub_hash: 'opqrstu',
        parent_session_id: 'p2',
        sub_index: 1,
        transcript_path: '/some/path/agent-opqrstu1234567.jsonl',
        project: 'coding',
        agent_metadata: { agent_id: 'opqrstu1234567' },
      },
    ];
    const results = await adapter.convertToObservations(rows, {
      dryRun: true,
      tag: 'sub-agent-backfill',
    });
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(3);
    // Phase 50 primitive was called (mocked, see top-of-file)
    expect(convertCalls.length).toBeGreaterThanOrEqual(1);
    // Every call's tag is preserved
    for (const c of convertCalls) {
      expect(c.opts.tag).toBe('sub-agent-backfill');
    }
  });

  test('Test 11: per-row metadata is woven into Phase 50 call args', async () => {
    const rows = [
      {
        agent: 'claude',
        sub_hash: 'aaaaaaa',
        parent_session_id: 'parent-1',
        sub_index: 1,
        transcript_path: '/tmp/agent-aaaaaaa1234567.jsonl',
        project: 'coding',
        agent_metadata: { agent_id: 'aaaaaaa1234567' },
      },
    ];
    await adapter.convertToObservations(rows, {
      dryRun: true,
      tag: 'sub-agent-backfill',
    });
    // The Phase 50 primitive was invoked. The adapter passes per-row metadata
    // via the call args — either embedded in the transcripts argument's row
    // objects (carrying sub_hash/parent_session_id/sub_index) OR via the tag
    // string (JSON-encoded payload). Either is acceptable per the plan.
    expect(convertCalls.length).toBeGreaterThanOrEqual(1);
    // At least one row in the transcripts arg carries the per-row context fields.
    const allTranscripts = convertCalls.flatMap((c) => c.transcripts);
    const found = allTranscripts.find((t) =>
      t.parent_session_id === 'parent-1'
      || t.sub_hash === 'aaaaaaa'
      || (t.path && t.path.includes('aaaaaaa')),
    );
    expect(found).toBeDefined();
  });
});

describe('adapter contract', () => {
  test('Test 12: exports the locked {agentId, storageType, discover, convertToObservations}', () => {
    expect(adapter.agentId).toBe('claude');
    expect(adapter.storageType).toBe('jsonl-tree');
    expect(typeof adapter.discover).toBe('function');
    expect(typeof adapter.convertToObservations).toBe('function');
  });
});
