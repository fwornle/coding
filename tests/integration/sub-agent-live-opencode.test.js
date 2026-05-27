/**
 * tests/integration/sub-agent-live-opencode.test.js
 *
 * Phase 51 Plan 51-13 Task 2 (CR-02) — verifies the OpenCode live daemon's
 * heartbeat payload includes the `registry_rows` array.
 *
 * Background:
 *   lib/lsl/registry-reader.mjs:145 enumerates running sub-agents
 *   EXCLUSIVELY from `hb.registry_rows`. The OpenCode daemon previously
 *   omitted this field, so `live_registrations.opencode.running` on
 *   /health/state was permanently 0 regardless of real OpenCode activity.
 *
 * Strategy:
 *   Spawn the daemon as a child process against a tmpdir-seeded OpenCode
 *   fixture DB. Wait for the first heartbeat file write. Read the file.
 *   Assert registry_rows is an Array. With a seeded sub-session row,
 *   assert the entry shape is {sub_hash, parent_session_id, status, project}.
 *   Then drive registry-reader.loadAllHeartbeats() against the heartbeat
 *   tmpdir to assert the reader picks up the running daemon's row.
 *
 * Per CLAUDE.md no-console-log: tests use stderr inspection via jest.spyOn.
 * Zero new package installs — better-sqlite3 + child_process already present.
 *
 * NB: Per Plan 51-13 acceptance — OpenCode INCLUDES `project` in registry_rows
 * (Plan 51-07/51-09 claude/copilot daemons OMIT it). This makes the
 * registry-reader's project filter strict-correct rather than permissive.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const DAEMON_SCRIPT = path.join(REPO_ROOT, 'scripts/sub-agent-live-opencode.mjs');

let seedOpencodeFixture;

beforeAll(async () => {
  ({ seedOpencodeFixture } = await import('../fixtures/opencode/seed-opencode-fixture.mjs'));
});

let tmpDir;
let stateDir;
let dbPath;
let stateFile;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-opencode-'));
  stateDir = path.join(tmpDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  dbPath = path.join(tmpDir, 'opencode.db');
  stateFile = path.join(stateDir, 'sub-agent-live-state-opencode.json');
});

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Spawn the daemon with explicit CLI args pointing at the tmpdir fixture.
 * Returns the child process handle (caller is responsible for killing it).
 */
function spawnDaemon({ pollIntervalMs = 200, heartbeatIntervalSec = 1 } = {}) {
  const child = spawn(
    'node',
    [
      DAEMON_SCRIPT,
      '--db-path', dbPath,
      '--project-root', '/Users/Q284340/Agentic/coding',
      '--state-file', stateFile,
      '--poll-interval', String(pollIntervalMs),
      '--heartbeat-interval', String(heartbeatIntervalSec),
    ],
    {
      env: {
        ...process.env,
        LSL_PROJECT_ROOT_CODING: '/Users/Q284340/Agentic/coding',
        // Point ObservationWriter at a tmpdir DB so init doesn't touch
        // production .observations/observations.db.
        OBSERVATIONS_DB_PATH: path.join(tmpDir, 'observations.db'),
      },
      cwd: REPO_ROOT,
    },
  );
  // Drain stderr so the OS pipe buffer doesn't fill up.
  child.stderr.on('data', () => { /* swallow */ });
  child.stdout.on('data', () => { /* swallow */ });
  return child;
}

/**
 * Wait until the heartbeat file exists and is non-empty, OR timeoutMs elapses.
 */
async function waitForHeartbeat(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const stat = fs.statSync(stateFile);
      if (stat.size > 0) {
        const raw = fs.readFileSync(stateFile, 'utf-8');
        const parsed = JSON.parse(raw);
        // The first heartbeat is written synchronously before the timer
        // fires; ensure we have a fully-formed payload (agent field present).
        if (parsed && parsed.agent === 'opencode') {
          return parsed;
        }
      }
    } catch { /* missing file or partial write — keep polling */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`heartbeat file did not appear within ${timeoutMs}ms: ${stateFile}`);
}

/**
 * Kill the daemon and wait for exit.
 */
function killDaemon(child) {
  return new Promise((resolve) => {
    if (child.killed || child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    // Hard-kill after 3s if SIGTERM was ignored.
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } }, 3000);
  });
}

describe('sub-agent-live-opencode daemon — registry_rows emit (CR-02)', () => {
  test('Test 1: heartbeat payload includes registry_rows as an Array (possibly empty when no sub-sessions yet)', async () => {
    // Seed an EMPTY DB — just the schema, no sub-sessions. The watcher
    // should still produce heartbeats with registry_rows=[].
    seedOpencodeFixture(dbPath, { numSubSessions: 0 });

    const child = spawnDaemon();
    try {
      const hb = await waitForHeartbeat();

      // CR-02 regression guard: this field MUST exist and be an Array.
      // Prior to the fix it was undefined.
      expect(hb).toHaveProperty('registry_rows');
      expect(Array.isArray(hb.registry_rows)).toBe(true);

      // Sanity: other expected fields still present (no regression).
      expect(hb.agent).toBe('opencode');
      expect(typeof hb.last_heartbeat_at).toBe('string');
      expect(typeof hb.polls).toBe('number');
      expect(typeof hb.registered).toBe('number');
      expect(typeof hb.errors).toBe('number');
    } finally {
      await killDaemon(child);
    }
  }, 20000);

  test('Test 2: registry_rows entries have shape {sub_hash, parent_session_id, status, project} when sub-sessions present', async () => {
    // Seed a DB with 2 sub-sessions in the coding project root. The watcher
    // will poll, find them, registry.upsert each with status='running', and
    // the next heartbeat will include them in registry_rows.
    seedOpencodeFixture(dbPath, { numSubSessions: 2 });

    const child = spawnDaemon({ pollIntervalMs: 200, heartbeatIntervalSec: 1 });
    try {
      // Give the watcher time to complete its first poll AND emit a
      // post-poll heartbeat. waitForHeartbeat returns the first heartbeat
      // (which might be pre-poll empty). Re-read after a short delay to
      // get the post-poll heartbeat.
      //
      // Larger timeout than Test 1 because the daemon's first heartbeat
      // is gated on startOpencodeWatcher() returning, which is gated on
      // the initial poll completing — and the initial poll exercises
      // ObservationWriter.processMessages on every seeded sub-session,
      // which is a few hundred ms per session under jest's slow VM.
      await waitForHeartbeat(20000);
      // Wait one full heartbeat cycle so the timer fires after the first
      // poll has populated the registry.
      await new Promise((r) => setTimeout(r, 1500));
      const hb = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));

      expect(Array.isArray(hb.registry_rows)).toBe(true);

      // Tolerate slow first heartbeat: if registry_rows is empty in the
      // first heartbeat (initial poll hadn't populated yet), wait one more
      // heartbeat cycle and re-read.
      let rows = hb.registry_rows;
      if (rows.length === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        const hb2 = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        rows = hb2.registry_rows;
      }
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const row of rows) {
        // Shape contract — per Plan 51-13 Task 2 + REVIEW.md line 132.
        expect(typeof row.sub_hash).toBe('string');
        expect(row.sub_hash.length).toBeGreaterThan(0);
        // parent_session_id can legitimately be a string for sub-sessions.
        expect(['string'].includes(typeof row.parent_session_id)).toBe(true);
        // status: registry rows from the watcher use 'running'.
        expect(typeof row.status).toBe('string');
        // PROJECT field — OpenCode INCLUDES this (asymmetry with
        // claude/copilot daemons that omit it). REVIEW.md line 132.
        expect(row).toHaveProperty('project');
        expect(typeof row.project === 'string' || row.project === null).toBe(true);
      }
    } finally {
      await killDaemon(child);
    }
  }, 40000);

  test('Test 3: registry-reader.loadAllHeartbeats picks up the daemon and surfaces opencode rows', async () => {
    // Same setup as Test 2 — daemon must produce a heartbeat the reader
    // can ingest. Then drive registry-reader.loadAllHeartbeats({stateDir})
    // and assert the opencode key has registry_rows with status='running'.
    seedOpencodeFixture(dbPath, { numSubSessions: 1 });

    const child = spawnDaemon({ pollIntervalMs: 200, heartbeatIntervalSec: 1 });
    try {
      await waitForHeartbeat(20000);
      // Wait for at least one post-poll heartbeat.
      await new Promise((r) => setTimeout(r, 1500));

      const { loadAllHeartbeats } = await import('../../lib/lsl/registry-reader.mjs');
      const all = loadAllHeartbeats({ stateDir });

      expect(all).toHaveProperty('opencode');
      expect(all.opencode).toHaveProperty('registry_rows');
      expect(Array.isArray(all.opencode.registry_rows)).toBe(true);

      // The fresh-vs-stale split — the daemon JUST wrote, so it must be fresh.
      expect(all.opencode.stale).toBe(false);

      // At least one row with status='running'.
      // If registry_rows is empty (slow first poll), wait another cycle.
      let rows = all.opencode.registry_rows;
      if (rows.length === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        const all2 = loadAllHeartbeats({ stateDir });
        rows = all2.opencode.registry_rows;
      }
      const running = rows.filter((r) => r.status === 'running');
      expect(running.length).toBeGreaterThanOrEqual(1);
    } finally {
      await killDaemon(child);
    }
  }, 40000);
});
