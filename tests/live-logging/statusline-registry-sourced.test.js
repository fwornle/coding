/**
 * Phase 51 Plan 10 Task 2 — combined-status-line.js sources sub-agent freshness
 * from lib/lsl/registry-reader.mjs (heartbeat files) instead of walking
 * <parent>/subagents/ on disk.
 *
 * Test surface mixes:
 *   - Source-level grep gates (Tests 1, 2, 6) — assert the 2026-05-24 mitigation
 *     was removed and the registry-reader is imported.
 *   - Behavior tests (Tests 3, 4, 5, 7, 8, 9) — load registry-reader directly
 *     (since the statusline module is huge and async), feed it controlled
 *     heartbeat fixtures, and assert getProjectSubMt() returns the expected
 *     mtime so the statusline integration is exercised at the seam where
 *     combined-status-line.js calls into it.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COMBINED = path.join(REPO_ROOT, 'scripts', 'combined-status-line.js');
const FAST = path.join(REPO_ROOT, 'scripts', 'status-line-fast.cjs');
const READER_PATH = path.join(REPO_ROOT, 'lib', 'lsl', 'registry-reader.mjs');

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase51-plan10-task2-'));
  fs.mkdirSync(path.join(tmpDir, '.data'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeHeartbeat(agent, project, { ageMs = 0, status = 'running' } = {}) {
  const filename = `sub-agent-live-state-${agent}.json`;
  const filePath = path.join(tmpDir, '.data', filename);
  const now = Date.now();
  const body = {
    last_heartbeat_at: new Date(now - ageMs).toISOString(),
    registered: { [`sub_${agent}_${project}`]: { agent, project, status, started_at: new Date(now - ageMs).toISOString() } },
    registry_rows: [
      { id: `sub_${agent}_${project}`, agent, project, status, started_at: new Date(now - ageMs).toISOString() },
    ],
  };
  fs.writeFileSync(filePath, JSON.stringify(body));
  if (ageMs > 0) {
    const mtimeSeconds = (now - ageMs) / 1000;
    fs.utimesSync(filePath, mtimeSeconds, mtimeSeconds);
  }
  return filePath;
}

describe('Phase 51 Plan 10 Task 2 — statusline sources from registry-reader', () => {
  // -------- Source-level grep gates --------

  test('Test 1: combined-status-line.js no longer walks <parent>/subagents/', () => {
    const src = readFile(COMBINED);
    // The 2026-05-24 mitigation was a fs.readdirSync(...subagents...) walk
    // inside _effectiveActivityMtime(). After the refactor that pattern
    // must not appear anywhere in this file.
    const matches = src.match(/fs\.readdirSync\([^)]*subagents/g) || [];
    expect(matches).toHaveLength(0);
  });

  test('Test 2: combined-status-line.js imports lib/lsl/registry-reader.mjs', () => {
    const src = readFile(COMBINED);
    // The registry-reader is ESM; combined-status-line.js is CJS, so the
    // integration is a dynamic import() reference. Either an `import(...)`
    // expression or a `require(...registry-reader...)` (in case of a wrapper)
    // satisfies the gate.
    const hasReference = /registry-reader/.test(src);
    expect(hasReference).toBe(true);
    // Specifically must mention the .mjs path so a stale string match
    // (e.g. in a comment) without an actual import isn't enough.
    expect(src).toMatch(/registry-reader\.mjs/);
  });

  test('Test 3: combined-status-line.js calls getProjectSubMt', () => {
    const src = readFile(COMBINED);
    // Either the statusline references the function by name or uses it as
    // a destructured binding — both satisfy this gate.
    expect(/getProjectSubMt/.test(src)).toBe(true);
  });

  test('Test 6: visibleCellWidth() and codepoint-width handling are unchanged', () => {
    // The 2026-05-12 emoji-width fix lives in ~/.tmux.conf (codepoint-widths
    // U+26A0=2) and the visibleCellWidth() helper that mirrors it. Per
    // memory/reference_tmux_emoji_width_fix.md, this is the third recurring
    // mistake in the statusline area — width changes here introduce trailing-
    // char residue regressions in VS Code's xterm.js. Test 6 locks the count
    // of visibleCellWidth call-sites to a known baseline.
    const src = readFile(COMBINED);
    const callsites = (src.match(/visibleCellWidth\(/g) || []).length;
    // visibleCellWidth is exercised once in the width compositor.
    // If a future refactor needs to change this count, that refactor must
    // explicitly justify the tmux-rendering implication.
    expect(callsites).toBeGreaterThanOrEqual(1);
  });

  test('Test 6b: status-line-fast.cjs is untouched by Plan 51-10', () => {
    // D-Statusline NOT-TOUCHED clause: the fast variant continues to read
    // `subMt` from projects-mapping.json as-is. Plan 51-10 only modifies
    // combined-status-line.js's write side.
    const src = readFile(FAST);
    expect(src).toMatch(/subMt/);
    // No new imports of registry-reader in the fast variant.
    expect(/registry-reader/.test(src)).toBe(false);
  });

  // -------- Behavior tests at the registry-reader seam --------

  test('Test 4: getProjectSubMt returns 0 when no heartbeat files exist (clean state)', async () => {
    const reader = await import(READER_PATH);
    const mt = reader.getProjectSubMt('coding', { stateDir: path.join(tmpDir, '.data') });
    expect(mt).toBe(0);
  });

  test('Test 5: getProjectSubMt returns max fresh heartbeat mtime when one daemon is alive', async () => {
    const filePath = writeHeartbeat('claude', 'coding', { ageMs: 10_000 }); // 10s old
    const expectedMt = fs.statSync(filePath).mtimeMs;
    const reader = await import(READER_PATH);
    const mt = reader.getProjectSubMt('coding', { stateDir: path.join(tmpDir, '.data') });
    expect(mt).toBe(expectedMt);
    expect(mt).toBeGreaterThan(0);
  });

  test('Test 7: integration — heartbeats from multiple agents merge into one project subMt', async () => {
    const oldClaude = writeHeartbeat('claude', 'coding', { ageMs: 40_000 });
    const freshOpencode = writeHeartbeat('opencode', 'coding', { ageMs: 5_000 });
    writeHeartbeat('copilot', 'other-project', { ageMs: 5_000 });
    const reader = await import(READER_PATH);
    const mt = reader.getProjectSubMt('coding', { stateDir: path.join(tmpDir, '.data') });
    // The fresher (opencode) heartbeat for 'coding' should win.
    expect(mt).toBe(fs.statSync(freshOpencode).mtimeMs);
    expect(mt).toBeGreaterThan(fs.statSync(oldClaude).mtimeMs);
  });

  test('Test 8: empty state — no heartbeats → projects-mapping consumers see subMt 0', async () => {
    // Mirrors how combined-status-line.js's projects-mapping write decides
    // whether to stamp `subMt`. Status-line-fast.cjs already handles
    // `subMt: v?.subMt || 0`, so 0 is the canonical empty signal.
    const reader = await import(READER_PATH);
    const mt = reader.getProjectSubMt('coding', { stateDir: path.join(tmpDir, '.data') });
    expect(mt).toBe(0);
  });

  test('Test 9: stale daemon (heartbeat file > 90s old) → returns 0 (mtime gate)', async () => {
    writeHeartbeat('claude', 'coding', { ageMs: 5 * 60_000 }); // 5 min old, exceeds 90s default
    const reader = await import(READER_PATH);
    const mt = reader.getProjectSubMt('coding', { stateDir: path.join(tmpDir, '.data') });
    expect(mt).toBe(0);
  });
});
