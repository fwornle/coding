/**
 * Regression contract for the obs_api "busy vs dead" distinction (2026-08-09).
 *
 * Background: obs_api is single-owner-rw and single-threaded. A consolidation
 * run blocks its event loop, so both coordinator probes (`/health` at 3s,
 * `/api/consolidation/status` at 2s) time out while the process is perfectly
 * alive — idle latency is ~1ms, so a multi-second timeout never means "slow",
 * it means "blocked". That produced:
 *   1. services[].status='stopped' → the prompt hook told the operator
 *      "service obs_api stopped" about a service that never stopped
 *      (launchd runs=1, never exited).
 *   2. knowledge_pipeline.status='unreachable' → the restart_obs_api heal path
 *      aimed at a service that was mid-write.
 *
 * The fix rests on ONE empirical premise, asserted for real below: a blocked
 * process still accepts into its listen backlog and yields a TIMEOUT, whereas
 * a dead process has no socket and yields ECONNREFUSED instantly. If that
 * premise ever stops holding, the busy reclassification becomes unsafe and
 * these tests must fail loudly.
 *
 * The coordinator's tick loop is not unit-testable without spawning the whole
 * daemon (same constraint as health-coordinator-afk-suspend.test.js), so its
 * wiring is covered by a source contract. The prompt hook IS testable end to
 * end, by pointing it at a fake coordinator via HEALTH_COORDINATOR_URL.
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { probeHttpHealth, PROBE_TIMEOUT_ERROR } from '../../lib/utils/service-probe.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const COORD = path.join(REPO_ROOT, 'scripts', 'health-coordinator.js');
const HOOK = path.join(REPO_ROOT, 'scripts', 'health-prompt-hook.js');

const coordSrc = fs.readFileSync(COORD, 'utf-8');
const coordFlat = coordSrc.replace(/\s+/g, ' ');

/** Start a throwaway HTTP server on an ephemeral port. */
async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

async function close(server) {
  await new Promise(resolve => server.close(resolve));
}

describe('probe premise — a blocked service is distinguishable from a dead one', () => {
  test('event loop blocked past the deadline → timeout sentinel (reclassifiable as busy)', async () => {
    const { server, port } = await listen((req, res) => {
      const until = Date.now() + 2000;
      while (Date.now() < until) { /* block the loop, like a consolidation run */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    try {
      const result = await probeHttpHealth(`http://127.0.0.1:${port}/health`, 500);
      expect(result.status).toBe('stopped');
      expect(result.error).toBe(PROBE_TIMEOUT_ERROR);
    } finally {
      await close(server);
    }
  }, 15_000);

  test('nothing listening → ECONNREFUSED, NOT the timeout sentinel', async () => {
    // Bind then release, so we probe a port we know has no listener.
    const { server, port } = await listen((_req, res) => res.end('ok'));
    await close(server);

    const result = await probeHttpHealth(`http://127.0.0.1:${port}/health`, 3000);
    expect(result.status).toBe('stopped');
    // This is the safety property: a dead obs_api can never be masked as busy.
    expect(result.error).not.toBe(PROBE_TIMEOUT_ERROR);
  }, 15_000);
});

describe('health-prompt-hook — what the operator is actually told', () => {
  /**
   * Run the real hook against a fake coordinator serving `state`.
   *
   * Must use async spawn, NOT spawnSync: the fake coordinator lives in this
   * process, and spawnSync blocks this event loop until the child exits — so
   * the child's fetch could never be answered and the hook would be killed on
   * timeout with empty stdout. (The same blocked-event-loop failure this whole
   * fix is about, reproduced in the test harness.)
   */
  async function runHookAgainst(state) {
    const { server, port } = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
    });
    try {
      const stdout = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [HOOK], {
          env: { ...process.env, HEALTH_COORDINATOR_URL: `http://127.0.0.1:${port}` }
        });
        let out = '';
        let err = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { err += d; });
        child.on('error', reject);
        child.on('close', code => {
          if (!out) reject(new Error(`hook produced no stdout (exit ${code}): ${err}`));
          else resolve(out);
        });
        child.stdin.end('{}');
      });
      return JSON.parse(stdout).hookSpecificOutput.additionalContext;
    } finally {
      await close(server);
    }
  }

  const stateWith = (obsApiStatus) => ({
    generated_at: new Date().toISOString(),
    services: [
      { name: 'obs_api', status: obsApiStatus },
      { name: 'vkb_server', status: 'running' }
    ],
    lsl_by_project: { coding: 'healthy' }
  });

  test('busy obs_api is NOT reported as a problem', async () => {
    const context = await runHookAgainst(stateWith('busy'));
    expect(context).toContain('All systems operational');
    expect(context).not.toMatch(/obs_api/);
  }, 20_000);

  test('a genuinely stopped obs_api is STILL reported', async () => {
    const context = await runHookAgainst(stateWith('stopped'));
    expect(context).toContain('service obs_api stopped');
  }, 20_000);
});

describe('health-coordinator — busy-window source contract', () => {
  test('coordinator source still parses cleanly', () => {
    const res = spawnSync(process.execPath, ['--check', COORD], { encoding: 'utf-8' });
    expect(res.status).toBe(0);
  });

  test('only a TIMEOUT is reclassified as busy — never a refused connection', () => {
    // The guard must key off the shared sentinel, not a bare truthy error, or a
    // dead obs_api would be masked as busy and never healed.
    expect(coordFlat).toMatch(/result\.error !== PROBE_TIMEOUT_ERROR\) return result;/);
    expect(coordFlat).toMatch(/if \(!obsApiBusyNow\(\)\) return result;/);
  });

  test('the busy window is bounded, so a dead obs_api still recovers', () => {
    expect(coordSrc).toMatch(/OBS_API_BUSY_GRACE_MS/);
    // A window that never expires would suppress healing forever.
    expect(coordFlat).toMatch(/function obsApiBusyNow\(\) { return Date\.now\(\) < obsApiBusyUntil; }/);
  });

  test('the window opens BEFORE the consolidation POST, not after', () => {
    // Opening it after the POST loses the race: the next 5s tick can catch the
    // blocked loop before `inflight` is ever observable.
    const trigger = coordFlat.indexOf('[auto-consolidation] triggering');
    const note = coordFlat.indexOf("noteObsApiBusy('auto-consolidation dispatched')");
    const post = coordFlat.indexOf('/api/consolidation/run');
    expect(note).toBeGreaterThan(trigger);
    expect(note).toBeLessThan(post);
  });

  test('an inflight report from obs_api also opens the window', () => {
    expect(coordFlat).toMatch(/if \(body\.inflight\) noteObsApiBusy\(/);
  });

  test('busy freezes the auto-heal FSM rather than counting a failure', () => {
    expect(coordFlat).toMatch(/if \(status === 'busy'\) return;/);
  });

  // ── the 2026-09-07 gap ────────────────────────────────────────────────────
  //
  // Every arming signal above needs obs_api to ANSWER (an inflight report) or a
  // fresh dispatch. A blocked event loop supplies neither, so the window was in
  // practice a fixed 120s from the last answer. A consolidation outliving that
  // fell through a gap and was published as 'unreachable' — a red [📚] badge
  // for a pipeline that was working hard. Observed: window opened 05:28:47 on
  // dispatch, expired 05:30:47, obs_api could not answer again until 05:41:07.
  //
  // The re-arm closes it: a timeout arriving while we already believe obs_api
  // is busy is itself evidence the run continues. That must stay bounded, or
  // "no answer" becomes a way to excuse a dead service forever — hence the
  // episode ceiling, measured from the FIRST signal so re-arms cannot walk it
  // forward indefinitely.
  test('a timeout while already busy RE-ARMS the window', () => {
    expect(coordFlat).toMatch(/if \(!obsApiBusyExhausted\(\)\) noteObsApiBusy\('probe timed out while busy'\)/);
  });

  test('the re-arm is bounded by an episode ceiling', () => {
    expect(coordSrc).toMatch(/OBS_API_BUSY_MAX_MS/);
    expect(coordFlat).toMatch(/function obsApiBusyExhausted\(\) \{ return obsApiBusySince > 0 && \(Date\.now\(\) - obsApiBusySince\) >= OBS_API_BUSY_MAX_MS; \}/);
  });

  test('the ceiling is measured from the FIRST signal, not the latest re-arm', () => {
    // If obsApiBusySince were reassigned on every note, a stream of timeouts
    // would push the ceiling forward forever and the bound would be decorative.
    expect(coordFlat).toMatch(/if \(!obsApiBusyNow\(\)\) obsApiBusySince = now;/);
  });

  test('a clean probe with nothing in flight ends the episode', () => {
    // Otherwise the ceiling is consumed by an earlier, long-finished run and a
    // later genuine consolidation gets less grace than it should.
    expect(coordFlat).toMatch(/else clearObsApiBusyEpisode\(\);/);
  });
});

describe('status line — the [📚] badge fails open on an unknown status', () => {
  const slSrc = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'combined-status-line.js'), 'utf-8',
  );
  const slFlat = slSrc.replace(/\s+/g, ' ');

  test("'unreachable' still renders the red alarm", () => {
    expect(slFlat).toMatch(/case 'unreachable': \/\/ obs_api service itself is down/);
  });

  test('an UNRECOGNISED status renders the unknown glyph, not the alarm', () => {
    // Folding default into 'unreachable' meant any status the coordinator
    // learns to emit lights a red alarm here until this file catches up — a
    // false failure caused purely by version skew. Display surfaces fail open.
    const def = slFlat.indexOf("default: // A status this switch does not know");
    expect(def).toBeGreaterThan(-1);
    expect(slFlat.slice(def, def + 800)).toMatch(/parts\.push\('\[📚❓\]'\)/);
  });
});
