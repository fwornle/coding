/**
 * The ETM is the writer behind `lsl`, and the only artifact the feature system
 * cannot reach through a supervisor.
 *
 * It is spawned `detached` + `unref()`ed by the health coordinator, so it has no
 * launchd label and no supervisord program. That made it invisible to the whole
 * apply tier: `coding-features set lsl off` stopped the five lsl sweeper
 * daemons and left the writer running, filling .specstory/history for a feature
 * the user had switched off. Under `minimal` the coordinator stopped in the same
 * pass, so nothing was left to notice — two ETMs, up 8-9 hours, kept writing.
 *
 * These cover the apply half. The coordinator half (spawn gate + reap) is
 * exercised against the real source, because standing up a coordinator with live
 * ETM children in a unit test would test the harness, not the gate.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listEtms, reconcileEtm } from '../../scripts/apply-features.mjs';

const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

const PS = [
  '  501   /bin/zsh -l',
  '32265   node /Users/x/coding/scripts/enhanced-transcript-monitor.js /Users/x/Agentic/coding',
  '99839   node /Users/x/coding/scripts/enhanced-transcript-monitor.js /Users/x/Agentic/_work/a2a-xpr',
  // The near-miss that must NOT be reaped: a grep for the same script name.
  '77777   grep enhanced-transcript-monitor.js',
].join('\n');

const psOk = () => Promise.resolve({ ok: true, stdout: PS, stderr: '' });
const features = (lsl) => ({ features: { lsl: { enabled: lsl } } });

describe('listEtms', () => {
  test('finds each ETM and the project it monitors', async () => {
    assert.deepEqual(await listEtms({ list: psOk }), [
      { pid: 32265, projectPath: '/Users/x/Agentic/coding' },
      { pid: 99839, projectPath: '/Users/x/Agentic/_work/a2a-xpr' },
    ]);
  });

  test('a ps that fails yields nothing rather than throwing', async () => {
    // A reap that cannot list is a no-op. It must not take down the apply.
    const failed = () => Promise.resolve({ ok: false, stdout: '', stderr: 'boom' });
    assert.deepEqual(await listEtms({ list: failed }), []);
  });
});

describe('reconcileEtm', () => {
  test('lsl on: every ETM is left alone', async () => {
    const killed = [];
    const r = await reconcileEtm(features(true), { list: psOk, kill: (p) => killed.push(p) });
    assert.deepEqual(killed, [], 'an ETM was stopped while lsl is on');
    assert.deepEqual(r.stopped, []);
    assert.deepEqual(r.unchanged, ['etm(coding)', 'etm(a2a-xpr)']);
  });

  test('lsl on: it never STARTS one either', async () => {
    // Spawning is the coordinator's sweep, gated on the same feature. A second
    // spawner here would race it.
    const r = await reconcileEtm(features(true), { list: psOk, kill: () => {} });
    assert.deepEqual(r.started, []);
  });

  test('lsl off: every ETM is signalled, named by project', async () => {
    const killed = [];
    const r = await reconcileEtm(features(false), { list: psOk, kill: (p) => killed.push(p) });
    assert.deepEqual(killed, [32265, 99839]);
    assert.deepEqual(r.stopped.map((s) => s.name), ['etm(coding)', 'etm(a2a-xpr)']);
    assert.ok(r.stopped.every((s) => s.ok && s.action === 'stopped'));
  });

  test('a dry run signals nothing and says so', async () => {
    const killed = [];
    const r = await reconcileEtm(features(false), { dryRun: true, list: psOk, kill: (p) => killed.push(p) });
    assert.deepEqual(killed, [], '--dry-run killed a process');
    assert.deepEqual(r.stopped.map((s) => s.action), ['would-stop', 'would-stop']);
  });

  test('an already-dead pid is success, not a failure', async () => {
    // "Not running" is the state being asked for, so losing the race to reach it
    // is not an error to report.
    const kill = () => { const e = new Error('kill ESRCH'); e.code = 'ESRCH'; throw e; };
    const r = await reconcileEtm(features(false), { list: psOk, kill });
    assert.ok(r.stopped.every((s) => s.ok), 'ESRCH was reported as a failure');
  });

  test('a kill that genuinely fails is reported, not swallowed', async () => {
    const kill = () => { const e = new Error('kill EPERM'); e.code = 'EPERM'; throw e; };
    const r = await reconcileEtm(features(false), { list: psOk, kill });
    assert.ok(r.stopped.every((s) => s.ok === false));
    assert.match(r.stopped[0].detail, /EPERM/);
  });
});

describe('the coordinator half', () => {
  const src = readFileSync(join(REPO, 'scripts/health-coordinator.js'), 'utf8');

  test('the safety-net sweep is gated on lsl', () => {
    // Without this the sweep respawned an ETM every 30s for a switched-off
    // feature — the apply tier stopping them then achieved nothing.
    const fn = src.slice(src.indexOf('function ensureEtmForActiveProjects'));
    const body = fn.slice(0, fn.indexOf('\nfunction '));
    assert.match(body, /features\.lsl === false/, 'ensureEtmForActiveProjects does not read the feature');
  });

  test('the reaper stops everything when lsl is off', () => {
    const fn = src.slice(src.indexOf('function reapEtmsForClosedSessions'));
    const body = fn.slice(0, fn.indexOf('\n/**'));
    assert.match(body, /features\.lsl === false/, 'reapEtmsForClosedSessions does not read the feature');
  });

  test('both read the feature fail-OPEN', () => {
    // `currentFeatures()` returns null when the config cannot be resolved. A
    // truthiness check on the map alone would then read as "lsl is off" and stop
    // session logging over a YAML typo.
    for (const m of src.matchAll(/features\.lsl === false/g)) {
      const guard = src.slice(Math.max(0, m.index - 120), m.index + 30);
      assert.match(guard, /features &&\s*features\.lsl === false/, `not fail-open at index ${m.index}`);
    }
  });

  test('one kill path, so both reasons take the same care', () => {
    // SIGTERM (the ETM flushes a pending prompt set and unregisters from PSM)
    // and a _reapedProjects stamp (so the spawner does not undo the reap).
    assert.equal((src.match(/function killEtmEntry\(/g) || []).length, 1);
    assert.match(src, /function killEtmEntry[\s\S]{0,600}SIGTERM/);
    assert.match(src, /function killEtmEntry[\s\S]{0,600}_reapedProjects\.set/);
  });
});
