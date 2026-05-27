/**
 * Integration tests for the Phase 51 Plan 11 launchd integration —
 *
 *   - launchd/com.coding.sub-agent-sweep.plist
 *   - launchd/com.coding.sub-agent-live-claude.plist
 *   - launchd/com.coding.sub-agent-live-opencode.plist
 *   - launchd/com.coding.sub-agent-live-copilot.plist
 *   - scripts/install-sub-agent-launchd.sh
 *   - scripts/sub-agent-sweep-job.sh
 *
 * Mirrors the Plan 50-03 lsl-resolver-launchd test pattern with one extra
 * test for the 4-plist iteration in the installer. We spawn the wrapper as
 * a subprocess and assert on exit code + stderr + the state file. The sweep
 * CLI itself is stubbed via SWEEP_BIN pointing at a tmpdir bash shim; the
 * LLM proxy probe is stubbed via LLM_CLI_PROXY_URL pointing at a tiny in-test
 * HTTP server.
 *
 * The wrapper honors three env overrides (Plan-permitted for testability):
 *   - SUB_AGENT_SWEEP_STATE_FILE — override the path of the state JSON
 *   - SWEEP_BIN — override the node command (default = `node scripts/...mjs`)
 *   - LLM_CLI_PROXY_URL — proxy reachability probe target
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const WRAPPER_PATH = path.join(REPO_ROOT, 'scripts/sub-agent-sweep-job.sh');
const INSTALLER_PATH = path.join(REPO_ROOT, 'scripts/install-sub-agent-launchd.sh');
const LAUNCHD_DIR = path.join(REPO_ROOT, 'launchd');

const PLISTS = [
  'com.coding.sub-agent-sweep',
  'com.coding.sub-agent-live-claude',
  'com.coding.sub-agent-live-opencode',
  'com.coding.sub-agent-live-copilot',
];

/**
 * Run the wrapper as a subprocess. Returns { code, stdout, stderr }.
 */
function runWrapper(env) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [WRAPPER_PATH], {
      env: { ...process.env, ...env },
      cwd: REPO_ROOT,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

/**
 * Tiny HTTP server simulating the LLM proxy. We can dial its response
 * code per test to exercise reachable / unreachable code paths.
 */
function startFakeProxy(statusCode) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.statusCode = statusCode;
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function stopFakeProxy(handle) {
  return new Promise((resolve) => handle.server.close(() => resolve()));
}

/**
 * Build a tmpdir + a fake sweep script that mimics the Plan 51-01 CLI.
 * `exitCode` controls how the fake CLI terminates. We also write its
 * captured argv into a sidecar file so tests can assert --since
 * propagated correctly.
 */
function makeFakeSweep(tmpDir, exitCode) {
  const fakePath = path.join(tmpDir, 'fake-sweep.sh');
  const argvLog = path.join(tmpDir, 'fake-sweep-argv.json');
  const body = [
    '#!/usr/bin/env bash',
    'set -e',
    `echo "$@" > "${argvLog}"`,
    `exit ${exitCode}`,
    '',
  ].join('\n');
  fs.writeFileSync(fakePath, body, { mode: 0o755 });
  return { fakePath, argvLog };
}

describe('Phase 51 Plan 11 — launchd plists + installer + sweep wrapper integration', () => {
  let tmpDir;
  let proxy;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-agent-sweep-'));
  });

  afterEach(async () => {
    if (proxy) { await stopFakeProxy(proxy); proxy = null; }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test('Test 1: all four plists pass plutil -lint', () => {
    for (const label of PLISTS) {
      const plistPath = path.join(LAUNCHD_DIR, `${label}.plist`);
      expect(fs.existsSync(plistPath)).toBe(true);
      const r = spawnSync('/usr/bin/plutil', ['-lint', plistPath], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout || '').toMatch(/OK/);
    }
  });

  test('Test 2: install script passes bash -n (syntax-clean)', () => {
    const r = spawnSync('bash', ['-n', INSTALLER_PATH], { encoding: 'utf8' });
    expect(r.status).toBe(0);
  });

  test('Test 3: sweep wrapper passes bash -n (syntax-clean) + starts with set -euo pipefail', () => {
    const r = spawnSync('bash', ['-n', WRAPPER_PATH], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const body = fs.readFileSync(WRAPPER_PATH, 'utf8');
    // Plan acceptance: `head -3 ... | grep -F "set -euo pipefail"` returns 1 line.
    const firstThree = body.split('\n').slice(0, 3).join('\n');
    expect(firstThree).toMatch(/set -euo pipefail/);
  });

  test('Test 4: first run with no state file — defaults --since to 7 days ago + writes fresh state', async () => {
    proxy = await startFakeProxy(400);  // 4xx = reachable probe success
    const statePath = path.join(tmpDir, 'state.json');
    const { fakePath, argvLog } = makeFakeSweep(tmpDir, 0);
    expect(fs.existsSync(statePath)).toBe(false);

    const { code, stderr } = await runWrapper({
      SUB_AGENT_SWEEP_STATE_FILE: statePath,
      SWEEP_BIN: fakePath,
      LLM_CLI_PROXY_URL: proxy.url,
    });

    expect(code).toBe(0);
    expect(fs.existsSync(statePath)).toBe(true);
    expect(fs.existsSync(argvLog)).toBe(true);
    const capturedArgv = fs.readFileSync(argvLog, 'utf8').trim();
    const sinceMatch = capturedArgv.match(/--since\s+(\S+)/);
    expect(sinceMatch).toBeTruthy();
    const sinceMs = Date.parse(sinceMatch[1]);
    expect(Number.isFinite(sinceMs)).toBe(true);
    const ageHours = (Date.now() - sinceMs) / 3_600_000;
    expect(ageHours).toBeGreaterThanOrEqual(167);  // 7d minus a margin
    expect(ageHours).toBeLessThanOrEqual(169);
    expect(capturedArgv).toMatch(/--limit\s+100/);
    expect(capturedArgv).toMatch(/--project\s+coding/);
    expect(stderr).toMatch(/no prior state/i);
  }, 15000);

  test('Test 5: subsequent run — reads last_run_at from state file as --since; updates state on success', async () => {
    proxy = await startFakeProxy(400);
    const statePath = path.join(tmpDir, 'state.json');
    const priorIso = '2026-04-01T12:00:00Z';
    fs.writeFileSync(statePath, JSON.stringify({ last_run_at: priorIso, last_run_limit: 100 }));
    const priorMtime = fs.statSync(statePath).mtimeMs;
    const { fakePath, argvLog } = makeFakeSweep(tmpDir, 0);

    await new Promise((r) => setTimeout(r, 50));

    const { code } = await runWrapper({
      SUB_AGENT_SWEEP_STATE_FILE: statePath,
      SWEEP_BIN: fakePath,
      LLM_CLI_PROXY_URL: proxy.url,
    });

    expect(code).toBe(0);
    const capturedArgv = fs.readFileSync(argvLog, 'utf8').trim();
    expect(capturedArgv).toContain(`--since ${priorIso}`);
    const newState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(newState.last_run_at).toBeTruthy();
    expect(newState.last_run_at).not.toBe(priorIso);
    expect(fs.statSync(statePath).mtimeMs).toBeGreaterThan(priorMtime);
  }, 15000);

  test('Test 6: LLM proxy unreachable — wrapper exits 0 without running sweep or updating state', async () => {
    const closedPort = (await (async () => {
      const tmp = http.createServer();
      await new Promise((r) => tmp.listen(0, '127.0.0.1', r));
      const p = tmp.address().port;
      await new Promise((r) => tmp.close(r));
      return p;
    })());
    const statePath = path.join(tmpDir, 'state.json');
    const { fakePath, argvLog } = makeFakeSweep(tmpDir, 0);
    expect(fs.existsSync(statePath)).toBe(false);

    const { code, stderr } = await runWrapper({
      SUB_AGENT_SWEEP_STATE_FILE: statePath,
      SWEEP_BIN: fakePath,
      LLM_CLI_PROXY_URL: `http://127.0.0.1:${closedPort}`,
    });

    expect(code).toBe(0);                                  // NOT 1 — keeps launchd schedule clean
    expect(fs.existsSync(statePath)).toBe(false);          // state not updated
    expect(fs.existsSync(argvLog)).toBe(false);            // sweep CLI never invoked
    expect(stderr).toMatch(/proxy unreachable/i);
  }, 15000);

  test('Test 7: atomic state write — wrapper source uses .tmp + mv', () => {
    const wrapperBody = fs.readFileSync(WRAPPER_PATH, 'utf8');
    expect(wrapperBody).toMatch(/\.tmp/);
    expect(wrapperBody).toMatch(/\bmv\b/);
    // The literal idiom: write to STATE_FILE.tmp, then mv → STATE_FILE.
    expect(wrapperBody).toMatch(/mv\s+"?\$\{?TMP_FILE\}?"?\s+"?\$\{?STATE_FILE\}?"?/);
    // And zero console.* calls (it's bash; matches Plan 50-03 gate).
    const consoleCalls = (wrapperBody.match(/\bconsole\./g) || []).length;
    expect(consoleCalls).toBe(0);
    // log() helper redirects to stderr.
    expect(wrapperBody).toMatch(/log\(\)\s*\{[^}]*>&2/m);
    // And there must be a timestamped prefix on log lines.
    expect(wrapperBody).toMatch(/\[sub-agent-sweep\]/);
  });

  test('Test 8: install script iterates all 4 plist labels + KeepAlive policy differs by job class', () => {
    const installerBody = fs.readFileSync(INSTALLER_PATH, 'utf8');
    // Every label must appear in the installer (the PLISTS=( ... ) array).
    for (const label of PLISTS) {
      expect(installerBody).toMatch(new RegExp(label.replace(/\./g, '\\.')));
    }
    // Bootstrap idiom present.
    expect(installerBody).toMatch(/launchctl\s+bootstrap/);
    expect(installerBody).toMatch(/launchctl\s+bootout/);
    // Set -euo pipefail.
    expect(installerBody).toMatch(/set -euo pipefail/);

    // Sweep plist has NO KeepAlive (one-shot via StartInterval per the
    // Plan 50-03 precedent — avoids tight-loop on failure).
    const sweepBody = fs.readFileSync(path.join(LAUNCHD_DIR, 'com.coding.sub-agent-sweep.plist'), 'utf8');
    expect((sweepBody.match(/<key>KeepAlive<\/key>/g) || []).length).toBe(0);
    expect(sweepBody).toMatch(/<key>StartInterval<\/key>\s*<integer>1800<\/integer>/);

    // Each live daemon plist HAS KeepAlive (restart on crash) + StderrPath
    // redirected into .data/live-<agent>.log so the heartbeat stderr never
    // bleeds into the user's terminal (Wave-5 follow-up defect mitigation).
    for (const agent of ['claude', 'opencode', 'copilot']) {
      const livePlist = path.join(LAUNCHD_DIR, `com.coding.sub-agent-live-${agent}.plist`);
      const body = fs.readFileSync(livePlist, 'utf8');
      expect((body.match(/<key>KeepAlive<\/key>/g) || []).length).toBeGreaterThanOrEqual(1);
      expect(body).toMatch(/<key>ThrottleInterval<\/key>\s*<integer>60<\/integer>/);
      // Critical defect mitigation: stderr redirected to .data/live-<agent>.log.
      expect(body).toMatch(new RegExp(`<key>StandardErrorPath</key>\\s*<string>[^<]*\\.data/live-${agent}\\.log</string>`));
      expect(body).toMatch(new RegExp(`<key>StandardOutPath</key>\\s*<string>[^<]*\\.data/live-${agent}\\.log</string>`));
    }
  });
});
