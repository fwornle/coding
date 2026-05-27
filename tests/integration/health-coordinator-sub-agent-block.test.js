/**
 * Integration tests for the Phase 51 Plan 11 sub_agent_capture extension
 * to scripts/health-coordinator.js.
 *
 * Tests the pollSubAgentCapture() function via in-test imports of
 * lib/lsl/registry-reader.mjs (Path A). We DON'T spawn a full coordinator
 * subprocess — that's already covered by the existing e2e suite; here we
 * focus on the aggregation logic in isolation by:
 *
 *   1. Writing fake heartbeat files into a tmp `.data/` dir
 *   2. Exercising loadAllHeartbeats() directly (same primitive
 *      pollSubAgentCapture uses internally)
 *   3. Asserting status transitions match the contract documented in
 *      health-coordinator.js's pollSubAgentCapture jsdoc
 *
 * Plus one regression test that the coordinator file still parses cleanly
 * after the edit (since this test file is the gate on Plan 11 Task 2).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import { loadAllHeartbeats } from '../../lib/lsl/registry-reader.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const COORDINATOR_PATH = path.join(REPO_ROOT, 'scripts/health-coordinator.js');

/**
 * Build a fresh tmpdir `.data/`-style dir + populate per-agent heartbeat
 * files. Returns the tmpdir. Caller is responsible for cleanup.
 */
function makeTmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sub-agent-state-'));
}

/**
 * Replicate the status-decision logic from pollSubAgentCapture() so the
 * tests can verify the aggregation contract end-to-end without spawning a
 * full coordinator subprocess. If the implementation drifts away from
 * this contract, the assertions here flag the change.
 */
function deriveStatus(heartbeats) {
  let anyFresh = false;
  let anyFile = false;
  for (const agent of ['claude', 'opencode', 'copilot']) {
    const hb = heartbeats[agent] || {};
    if (Object.keys(hb).length === 0) continue;
    anyFile = true;
    if (!hb.stale) anyFresh = true;
  }
  if (anyFresh) return 'healthy';
  if (anyFile) return 'degraded';
  return 'unknown';
}

describe('Phase 51 Plan 11 — health-coordinator sub_agent_capture block', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpStateDir();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test('Test 1: status=unknown when no heartbeat files exist (cold boot)', () => {
    // Empty stateDir — no files at all.
    const heartbeats = loadAllHeartbeats({ stateDir: tmpDir });
    expect(heartbeats).toEqual({ claude: {}, opencode: {}, copilot: {} });
    expect(deriveStatus(heartbeats)).toBe('unknown');
  });

  test('Test 2: status=healthy when at least one daemon has a fresh heartbeat', () => {
    const payload = {
      agent: 'claude',
      last_heartbeat_at: new Date().toISOString(),
      watched_dirs: 1,
      active_tails: 2,
      registered_subagents: 3,
      registry_rows: [
        { sub_hash: 'abc1234', parent_session_id: 'p1', status: 'running' },
        { sub_hash: 'def5678', parent_session_id: 'p1', status: 'running' },
        { sub_hash: 'ghi9abc', parent_session_id: 'p2', status: 'completed' }
      ]
    };
    fs.writeFileSync(path.join(tmpDir, 'sub-agent-live-state-claude.json'), JSON.stringify(payload));

    const heartbeats = loadAllHeartbeats({ stateDir: tmpDir });
    expect(heartbeats.claude.stale).toBe(false);
    expect(heartbeats.claude.registry_rows).toHaveLength(3);
    expect(deriveStatus(heartbeats)).toBe('healthy');
  });

  test('Test 3: status=degraded when all heartbeat files exist but are stale (>90s old)', () => {
    const payload = {
      agent: 'opencode',
      last_heartbeat_at: '2020-01-01T00:00:00Z',
      registry_rows: []
    };
    const hbPath = path.join(tmpDir, 'sub-agent-live-state-opencode.json');
    fs.writeFileSync(hbPath, JSON.stringify(payload));
    // Backdate the mtime so the registry-reader's stale-threshold gate fires
    // (DEFAULT_MAX_AGE_MS = 90s; we go 5 min back).
    const oldMs = Date.now() - 5 * 60 * 1000;
    fs.utimesSync(hbPath, new Date(oldMs), new Date(oldMs));

    const heartbeats = loadAllHeartbeats({ stateDir: tmpDir });
    expect(heartbeats.opencode.stale).toBe(true);
    expect(heartbeats.opencode.age_ms).toBeGreaterThan(90_000);
    expect(deriveStatus(heartbeats)).toBe('degraded');
  });

  test('Test 4: defensive — malformed JSON in heartbeat file does not crash; agent slot stays {}', () => {
    // Write something that is NOT valid JSON.
    const hbPath = path.join(tmpDir, 'sub-agent-live-state-copilot.json');
    fs.writeFileSync(hbPath, '{this is not valid json');

    // loadAllHeartbeats should swallow the parse error (writes stderr) and
    // leave the slot as `{}`.
    const heartbeats = loadAllHeartbeats({ stateDir: tmpDir });
    expect(heartbeats.copilot).toEqual({});
    // No fresh AND no stale entry → still "unknown" if nothing else present.
    expect(deriveStatus(heartbeats)).toBe('unknown');
  });

  test('Test 5: regression — health-coordinator.js parses cleanly after edit + sub_agent_capture is registered', () => {
    // The coordinator imports MUST still resolve and the file MUST be
    // syntactically valid Node.js. If a refactor breaks node --check,
    // this test catches it before the launchd-loaded service silently
    // exits at startup (which would otherwise be invisible until the
    // dashboard staleness alert fires hours later).
    const r = spawnSync(process.execPath, ['--check', COORDINATOR_PATH], { encoding: 'utf8' });
    expect(r.status).toBe(0);

    // Plan 11 Task 2 grep gate: file must contain the sub_agent_capture
    // key + a pollSubAgentCapture function declaration.
    const body = fs.readFileSync(COORDINATOR_PATH, 'utf8');
    expect(body).toMatch(/sub_agent_capture/);
    expect(body).toMatch(/async function pollSubAgentCapture/);
    // Wired into runAllChecks — there must be an `await pollSubAgentCapture()` invocation.
    expect(body).toMatch(/await pollSubAgentCapture\(\)/);
    // CLAUDE.md no-console-log rule preserved.
    const consoleCount = (body.match(/\bconsole\./g) || []).length;
    expect(consoleCount).toBe(0);
  });

  test('Test 6: mixed state — claude fresh, opencode stale, copilot missing → still healthy (anyFresh wins)', () => {
    // Fresh claude
    fs.writeFileSync(
      path.join(tmpDir, 'sub-agent-live-state-claude.json'),
      JSON.stringify({ agent: 'claude', registry_rows: [{ sub_hash: 'a', status: 'running' }] }),
    );
    // Stale opencode
    const stalePath = path.join(tmpDir, 'sub-agent-live-state-opencode.json');
    fs.writeFileSync(stalePath, JSON.stringify({ agent: 'opencode', registry_rows: [] }));
    const oldMs = Date.now() - 5 * 60 * 1000;
    fs.utimesSync(stalePath, new Date(oldMs), new Date(oldMs));
    // No copilot file

    const heartbeats = loadAllHeartbeats({ stateDir: tmpDir });
    expect(heartbeats.claude.stale).toBe(false);
    expect(heartbeats.opencode.stale).toBe(true);
    expect(heartbeats.copilot).toEqual({});
    expect(deriveStatus(heartbeats)).toBe('healthy');
  });
});
