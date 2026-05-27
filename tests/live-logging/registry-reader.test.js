/**
 * tests/live-logging/registry-reader.test.js
 *
 * Phase 51 Plan 10 Task 1 — TDD RED → GREEN.
 *
 * Locks the contract for `lib/lsl/registry-reader.mjs` — reads the per-agent
 * heartbeat state files written by the daemons in Plans 51-07 (claude),
 * 51-08 (opencode), and 51-09 (copilot), and aggregates a per-project
 * sub-agent freshness signal for the statusline to consume.
 *
 * Per CONTEXT.md D-Statusline: the registry-reader replaces the 2026-05-24
 * mitigation in scripts/combined-status-line.js that re-walked
 * `<parent>/subagents/` on every tick. Source of truth is now the
 * per-daemon heartbeat files.
 *
 * 10 tests covering:
 *   1. loadAllHeartbeats({stateDir:<empty>}) returns {claude:{}, opencode:{}, copilot:{}}
 *   2. loadAllHeartbeats with one fresh heartbeat present returns the parsed object
 *      and `stale: false` + `mtime_ms` stamped at the per-agent root.
 *   3. loadAllHeartbeats with a stale (> 90s old) heartbeat returns the parsed
 *      object PLUS `stale: true` flag + `age_ms` stamped.
 *   4. getFreshSubAgents('coding', stateDir) returns all three agents'
 *      running sub-agents merged into one array.
 *   5. getFreshSubAgents filters by project — rows with a different
 *      `project` field are excluded.
 *   6. getProjectSubMt('coding') returns max heartbeat-file mtime across
 *      the three agents (file mtime, NOT last_heartbeat_at content).
 *   7. getProjectSubMt returns 0 when all three heartbeat files are stale.
 *   8. getProjectSubMt returns 0 when no heartbeat files exist.
 *   9. Malformed JSON in a heartbeat file: loadAllHeartbeats logs stderr
 *      'failed to parse heartbeat <path>' and treats as empty (defensive).
 *  10. uid-check: a heartbeat file owned by another uid is skipped + stderr
 *      'skipping non-owned heartbeat'.
 *
 * Per CLAUDE.md no-console-log: tests use stderr inspection via jest.spyOn.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// Lazy import inside beforeAll so the module-not-found error surfaces in the
// RED phase. (Module created in GREEN.)
let loadAllHeartbeats;
let getFreshSubAgents;
let getProjectSubMt;

beforeAll(async () => {
  const mod = await import('../../lib/lsl/registry-reader.mjs');
  loadAllHeartbeats = mod.loadAllHeartbeats;
  getFreshSubAgents = mod.getFreshSubAgents;
  getProjectSubMt = mod.getProjectSubMt;
});

let tmpDir;
let stderrSpy;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-reader-'));
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  if (stderrSpy) stderrSpy.mockRestore();
});

/**
 * Helper — write a heartbeat file with the Plan 51-07/08/09 shape.
 * Returns the file path.
 */
function writeHeartbeat(stateDir, agent, payload, { mtimeMs } = {}) {
  const filename = `sub-agent-live-state-${agent}.json`;
  const filePath = path.join(stateDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  if (typeof mtimeMs === 'number') {
    const t = mtimeMs / 1000;
    fs.utimesSync(filePath, t, t);
  }
  return filePath;
}

describe('lib/lsl/registry-reader.mjs', () => {
  test('1. loadAllHeartbeats with empty stateDir returns {claude:{}, opencode:{}, copilot:{}}', () => {
    const result = loadAllHeartbeats({ stateDir: tmpDir });
    expect(result).toEqual({ claude: {}, opencode: {}, copilot: {} });
  });

  test('2. loadAllHeartbeats with fresh claude heartbeat returns parsed object + stale:false + mtime_ms', () => {
    const now = Date.now();
    writeHeartbeat(tmpDir, 'claude', {
      agent: 'claude',
      last_heartbeat_at: new Date(now).toISOString(),
      watched_dirs: 1,
      active_tails: 2,
      registered_subagents: 3,
      registry_rows: [
        { sub_hash: 'abc1234', parent_session_id: 'parent-uuid', status: 'running' },
      ],
    });
    const result = loadAllHeartbeats({ stateDir: tmpDir });
    expect(result.claude.agent).toBe('claude');
    expect(result.claude.watched_dirs).toBe(1);
    expect(result.claude.active_tails).toBe(2);
    expect(result.claude.stale).toBe(false);
    expect(typeof result.claude.mtime_ms).toBe('number');
    expect(result.claude.mtime_ms).toBeGreaterThan(0);
    expect(result.opencode).toEqual({});
    expect(result.copilot).toEqual({});
  });

  test('3. loadAllHeartbeats with a stale heartbeat (>90s old) stamps stale:true + age_ms', () => {
    const oldTs = Date.now() - 120_000; // 2 min old; > 90s threshold
    writeHeartbeat(tmpDir, 'opencode', {
      agent: 'opencode',
      last_heartbeat_at: new Date(oldTs).toISOString(),
      polls: 100,
      registered: 0,
    }, { mtimeMs: oldTs });
    const result = loadAllHeartbeats({ stateDir: tmpDir });
    expect(result.opencode.stale).toBe(true);
    expect(typeof result.opencode.age_ms).toBe('number');
    expect(result.opencode.age_ms).toBeGreaterThan(90_000);
  });

  test('4. getFreshSubAgents merges running sub-agents from all three agents for a project', () => {
    const now = Date.now();
    writeHeartbeat(tmpDir, 'claude', {
      agent: 'claude',
      last_heartbeat_at: new Date(now).toISOString(),
      registry_rows: [
        { sub_hash: 'aaa0001', parent_session_id: 'p1', status: 'running', project: 'coding' },
        { sub_hash: 'aaa0002', parent_session_id: 'p1', status: 'completed', project: 'coding' },
      ],
    });
    writeHeartbeat(tmpDir, 'opencode', {
      agent: 'opencode',
      last_heartbeat_at: new Date(now).toISOString(),
      registry_rows: [
        { sub_hash: 'bbb0001', parent_session_id: 'p2', status: 'running', project: 'coding' },
      ],
    });
    writeHeartbeat(tmpDir, 'copilot', {
      agent: 'copilot',
      last_heartbeat_at: new Date(now).toISOString(),
      registry_rows: [
        { sub_hash: 'ccc0001', parent_session_id: 'p3', status: 'running', project: 'coding' },
      ],
    });
    const out = getFreshSubAgents('coding', { stateDir: tmpDir });
    // 3 running rows (the 'completed' one is filtered out).
    expect(out).toHaveLength(3);
    const agents = out.map((r) => r.agent).sort();
    expect(agents).toEqual(['claude', 'copilot', 'opencode']);
    // Shape spot-check
    const first = out[0];
    expect(first).toHaveProperty('agent');
    expect(first).toHaveProperty('sub_hash');
    expect(first).toHaveProperty('parent_session_id');
    expect(first).toHaveProperty('status');
    expect(first).toHaveProperty('heartbeat_age_ms');
  });

  test('5. getFreshSubAgents filters by project — other-project rows excluded', () => {
    const now = Date.now();
    writeHeartbeat(tmpDir, 'claude', {
      agent: 'claude',
      last_heartbeat_at: new Date(now).toISOString(),
      registry_rows: [
        { sub_hash: 'aaa0001', parent_session_id: 'p1', status: 'running', project: 'coding' },
        { sub_hash: 'aaa0002', parent_session_id: 'p1', status: 'running', project: 'other-project' },
      ],
    });
    const out = getFreshSubAgents('coding', { stateDir: tmpDir });
    expect(out).toHaveLength(1);
    expect(out[0].sub_hash).toBe('aaa0001');
  });

  test('6. getProjectSubMt returns max file-mtime across the three agents (file mtime, not last_heartbeat_at)', () => {
    const t1 = Date.now() - 30_000; // 30s old (fresh)
    const t2 = Date.now() - 10_000; // 10s old (freshest)
    const t3 = Date.now() - 20_000; // 20s old (fresh)
    writeHeartbeat(tmpDir, 'claude', {
      agent: 'claude',
      last_heartbeat_at: '1970-01-01T00:00:00Z', // garbage content; reader uses file mtime
      registry_rows: [
        { sub_hash: 'aaa0001', parent_session_id: 'p1', status: 'running', project: 'coding' },
      ],
    }, { mtimeMs: t1 });
    writeHeartbeat(tmpDir, 'opencode', {
      agent: 'opencode',
      last_heartbeat_at: '1970-01-01T00:00:00Z',
      registry_rows: [
        { sub_hash: 'bbb0001', parent_session_id: 'p2', status: 'running', project: 'coding' },
      ],
    }, { mtimeMs: t2 });
    writeHeartbeat(tmpDir, 'copilot', {
      agent: 'copilot',
      last_heartbeat_at: '1970-01-01T00:00:00Z',
      registry_rows: [
        { sub_hash: 'ccc0001', parent_session_id: 'p3', status: 'running', project: 'coding' },
      ],
    }, { mtimeMs: t3 });
    const mt = getProjectSubMt('coding', { stateDir: tmpDir });
    // Should be approximately t2 (freshest of the three file mtimes).
    expect(mt).toBeGreaterThanOrEqual(t2 - 2_000);
    expect(mt).toBeLessThanOrEqual(t2 + 2_000);
  });

  test('7. getProjectSubMt returns 0 when all three heartbeat files are stale (>90s)', () => {
    const old = Date.now() - 120_000;
    writeHeartbeat(tmpDir, 'claude', {
      agent: 'claude',
      registry_rows: [{ sub_hash: 'a', parent_session_id: 'p', status: 'running', project: 'coding' }],
    }, { mtimeMs: old });
    writeHeartbeat(tmpDir, 'opencode', {
      agent: 'opencode',
      registry_rows: [{ sub_hash: 'b', parent_session_id: 'p', status: 'running', project: 'coding' }],
    }, { mtimeMs: old });
    writeHeartbeat(tmpDir, 'copilot', {
      agent: 'copilot',
      registry_rows: [{ sub_hash: 'c', parent_session_id: 'p', status: 'running', project: 'coding' }],
    }, { mtimeMs: old });
    expect(getProjectSubMt('coding', { stateDir: tmpDir })).toBe(0);
  });

  test('8. getProjectSubMt returns 0 when no heartbeat files exist (daemons not running)', () => {
    expect(getProjectSubMt('coding', { stateDir: tmpDir })).toBe(0);
  });

  test('9. malformed JSON: loadAllHeartbeats logs stderr + treats as empty (no crash)', () => {
    const filePath = path.join(tmpDir, 'sub-agent-live-state-claude.json');
    fs.writeFileSync(filePath, '{not valid json', 'utf-8');
    const result = loadAllHeartbeats({ stateDir: tmpDir });
    expect(result.claude).toEqual({});
    // Stderr should mention parse failure for forensics.
    const stderrCalls = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(stderrCalls).toMatch(/failed to parse heartbeat/);
  });

  test('10. uid-check: heartbeat file owned by another uid is skipped + stderr "skipping non-owned heartbeat"', () => {
    const filePath = writeHeartbeat(tmpDir, 'copilot', {
      agent: 'copilot',
      registry_rows: [{ sub_hash: 'c', parent_session_id: 'p', status: 'running', project: 'coding' }],
    });
    const realStatSync = fs.statSync;
    const myUid = process.getuid ? process.getuid() : 1000;
    const statSpy = jest.spyOn(fs, 'statSync').mockImplementation((p, ...rest) => {
      const real = realStatSync.call(fs, p, ...rest);
      if (p === filePath) {
        // Build a stub Stats-like with the real numeric fields but spoofed uid.
        return Object.assign(Object.create(Object.getPrototypeOf(real)), {
          uid: myUid + 99_999,
          gid: real.gid,
          size: real.size,
          mtimeMs: real.mtimeMs,
          ctimeMs: real.ctimeMs,
          atimeMs: real.atimeMs,
          birthtimeMs: real.birthtimeMs,
          mode: real.mode,
          nlink: real.nlink,
          ino: real.ino,
          dev: real.dev,
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
        });
      }
      return real;
    });
    try {
      const result = loadAllHeartbeats({ stateDir: tmpDir });
      expect(result.copilot).toEqual({});
      const stderrCalls = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(stderrCalls).toMatch(/skipping non-owned heartbeat/);
    } finally {
      statSpy.mockRestore();
    }
  });
});
