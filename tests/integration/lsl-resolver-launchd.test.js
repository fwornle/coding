/**
 * Integration tests for scripts/lsl-resolver-job.sh — the wrapper script
 * launchd executes every 30 minutes (Phase 50, Plan 03, Task 2).
 *
 * The wrapper is bash, so we spawn it as a subprocess and assert on
 * exit code + stderr + the state-file path. We stub the resolver CLI
 * itself via an env-injected RESOLVER_BIN that points at a small fake
 * script under a tmpdir; we stub the LLM proxy probe by pointing
 * LLM_CLI_PROXY_URL at a tiny local HTTP server we control.
 *
 * The wrapper is required to honor (Plan-permitted for testability):
 *   - LSL_RESOLVER_STATE_FILE — override the path of the state JSON
 *   - RESOLVER_BIN — override the node command (default = `node scripts/...mjs`)
 *   - LLM_CLI_PROXY_URL — proxy reachability probe target
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const WRAPPER_PATH = path.join(REPO_ROOT, 'scripts/lsl-resolver-job.sh');

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
 * Build a tmpdir + a fake resolver script that mimics the Plan 1 CLI.
 * `exitCode` controls how the fake resolver terminates. We also write
 * its captured argv into a sidecar file so tests can assert --since
 * propagated correctly.
 */
function makeFakeResolver(tmpDir, exitCode) {
  const fakePath = path.join(tmpDir, 'fake-resolver.sh');
  const argvLog = path.join(tmpDir, 'fake-resolver-argv.json');
  // The wrapper invokes RESOLVER_BIN with --since X --limit N. We capture
  // them via a thin bash shim so we can assert later.
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

describe('scripts/lsl-resolver-job.sh — launchd wrapper integration', () => {
  let tmpDir;
  let proxy;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsl-resolver-job-'));
  });

  afterEach(async () => {
    if (proxy) { await stopFakeProxy(proxy); proxy = null; }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test('Test 1: first run with no state file — defaults --since to 7 days ago and writes a fresh state file', async () => {
    proxy = await startFakeProxy(400);  // 4xx = reachable probe success
    const statePath = path.join(tmpDir, 'state.json');
    const { fakePath, argvLog } = makeFakeResolver(tmpDir, 0);
    expect(fs.existsSync(statePath)).toBe(false);

    const { code, stderr } = await runWrapper({
      LSL_RESOLVER_STATE_FILE: statePath,
      RESOLVER_BIN: fakePath,
      LLM_CLI_PROXY_URL: proxy.url,
    });

    expect(code).toBe(0);
    expect(fs.existsSync(statePath)).toBe(true);
    expect(fs.existsSync(argvLog)).toBe(true);
    const capturedArgv = fs.readFileSync(argvLog, 'utf8').trim();
    // Expect --since <ISO> --limit 100. We can't pin the ISO, but
    // it must be a parseable timestamp roughly 7 days ago.
    const sinceMatch = capturedArgv.match(/--since\s+(\S+)/);
    expect(sinceMatch).toBeTruthy();
    const sinceMs = Date.parse(sinceMatch[1]);
    expect(Number.isFinite(sinceMs)).toBe(true);
    const ageHours = (Date.now() - sinceMs) / 3_600_000;
    expect(ageHours).toBeGreaterThanOrEqual(167);  // 7d minus a margin
    expect(ageHours).toBeLessThanOrEqual(169);
    expect(capturedArgv).toMatch(/--limit\s+100/);
    expect(stderr).toMatch(/no prior state/i);
  }, 15000);

  test('Test 2: subsequent run — uses last_run_at from state file as --since; updates state on success', async () => {
    proxy = await startFakeProxy(400);
    const statePath = path.join(tmpDir, 'state.json');
    const priorIso = '2026-04-01T12:00:00Z';
    fs.writeFileSync(statePath, JSON.stringify({ last_run_at: priorIso, last_run_limit: 100 }));
    const priorMtime = fs.statSync(statePath).mtimeMs;
    const { fakePath, argvLog } = makeFakeResolver(tmpDir, 0);

    // Sleep briefly so we can verify mtime change.
    await new Promise((r) => setTimeout(r, 50));

    const { code } = await runWrapper({
      LSL_RESOLVER_STATE_FILE: statePath,
      RESOLVER_BIN: fakePath,
      LLM_CLI_PROXY_URL: proxy.url,
    });

    expect(code).toBe(0);
    const capturedArgv = fs.readFileSync(argvLog, 'utf8').trim();
    expect(capturedArgv).toContain(`--since ${priorIso}`);
    const newState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(newState.last_run_at).toBeTruthy();
    expect(newState.last_run_at).not.toBe(priorIso);  // updated
    expect(fs.statSync(statePath).mtimeMs).toBeGreaterThan(priorMtime);
  }, 15000);

  test('Test 3: LLM proxy unreachable — exit 0 WITHOUT running resolver or updating state', async () => {
    // Don't start the fake proxy at all — point to a closed port.
    const closedPort = (await (async () => {
      const tmp = http.createServer();
      await new Promise((r) => tmp.listen(0, '127.0.0.1', r));
      const p = tmp.address().port;
      await new Promise((r) => tmp.close(r));
      return p;
    })());
    const statePath = path.join(tmpDir, 'state.json');
    const { fakePath, argvLog } = makeFakeResolver(tmpDir, 0);
    expect(fs.existsSync(statePath)).toBe(false);

    const { code, stderr } = await runWrapper({
      LSL_RESOLVER_STATE_FILE: statePath,
      RESOLVER_BIN: fakePath,
      LLM_CLI_PROXY_URL: `http://127.0.0.1:${closedPort}`,
    });

    expect(code).toBe(0);  // NOT 1 — keeps launchd schedule clean
    expect(fs.existsSync(statePath)).toBe(false);  // state not updated
    expect(fs.existsSync(argvLog)).toBe(false);    // resolver never invoked
    expect(stderr).toMatch(/proxy unreachable/i);
  }, 15000);

  test('Test 4: CLI failure (resolver exits 1) — wrapper exits 1 and does NOT update state', async () => {
    proxy = await startFakeProxy(400);
    const statePath = path.join(tmpDir, 'state.json');
    const priorIso = '2026-04-01T12:00:00Z';
    fs.writeFileSync(statePath, JSON.stringify({ last_run_at: priorIso }));
    const { fakePath } = makeFakeResolver(tmpDir, 1);

    const { code, stderr } = await runWrapper({
      LSL_RESOLVER_STATE_FILE: statePath,
      RESOLVER_BIN: fakePath,
      LLM_CLI_PROXY_URL: proxy.url,
    });

    expect(code).toBe(1);
    // State must be untouched on failure so next run retries same --since.
    const stillThere = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(stillThere.last_run_at).toBe(priorIso);
    expect(stderr).toMatch(/exit 1/);
  }, 15000);

  test('Test 5: atomic state write — wrapper source uses .tmp + mv', async () => {
    const wrapperBody = fs.readFileSync(WRAPPER_PATH, 'utf8');
    expect(wrapperBody).toMatch(/\.tmp/);
    expect(wrapperBody).toMatch(/\bmv\b/);
    // The literal idiom: write to STATE_FILE.tmp, then mv → STATE_FILE.
    expect(wrapperBody).toMatch(/mv\s+"?\$\{?TMP_FILE\}?"?\s+"?\$\{?STATE_FILE\}?"?/);
  });

  test('Test 5a: proxy reachability probe targets GET /health (mirrors sweep wrapper post sweep-llm-proxy-probe-fix)', () => {
    // Companion to sub-agent-launchd-install.test.js Test 7a. Both Phase 50
    // and Phase 51 wrappers shared the same broken probe pattern. The fix
    // switches both to GET /health. See:
    //   - .planning/todos/pending/sweep-llm-proxy-probe-fix.md
    const wrapperBody = fs.readFileSync(WRAPPER_PATH, 'utf8');
    // GET /health (canonical reachability endpoint) — multi-line tolerant.
    expect(wrapperBody).toMatch(/\$\{?PROXY_URL\}?\/health/);
    expect(wrapperBody).not.toMatch(/-X\s+POST[\s\S]{0,200}\/api\/complete/);
    expect(wrapperBody).not.toMatch(/-d\s+'\{\}'[\s\S]{0,200}\/api\/complete/);
  });

  test('Test 6: bash strict mode — script starts with set -euo pipefail', async () => {
    const wrapperBody = fs.readFileSync(WRAPPER_PATH, 'utf8');
    const firstNonShebang = wrapperBody.split('\n').slice(1, 10).join('\n');
    expect(firstNonShebang).toMatch(/set -euo pipefail/);
  });

  test('Test 7: stderr logging — no console.* and all log lines go through >&2', async () => {
    const wrapperBody = fs.readFileSync(WRAPPER_PATH, 'utf8');
    // It's bash — there should be zero `console.` calls.
    const consoleCalls = (wrapperBody.match(/\bconsole\./g) || []).length;
    expect(consoleCalls).toBe(0);
    // Every log() helper invocation must redirect to stderr.
    expect(wrapperBody).toMatch(/log\(\)\s*\{[^}]*>&2/m);
    // And there must be a timestamped prefix on log lines.
    expect(wrapperBody).toMatch(/\[lsl-resolver\]/);
  });
});
