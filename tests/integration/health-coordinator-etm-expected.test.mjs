/**
 * Lifecycle contract for the ETM expectation set in scripts/health-coordinator.js.
 *
 * `lsl_by_project` is rolled up from sessions that have ALREADY heartbeated, so
 * the one failure it structurally cannot express is "no session ever appeared".
 * A project whose ETM crash-loops on startup contributes no key, and every
 * consumer — prompt hook, statusline, dashboard — reads an absent key as health.
 * That is how a project sits at [LSL🔴] while the health line says "All systems
 * operational". `_etmExpected` closes it by remembering which projects QUALIFY
 * for an ETM independently of whether one is beating.
 *
 * The tick loop needs the whole daemon to run, so this is a source contract in
 * the style of health-coordinator-afk-suspend.test.mjs. It guards the three
 * invariants that make the difference between a useful alarm and a stuck one —
 * each of which was a live way to get this wrong:
 *
 *   1. RECORDED only after the activity gate, or every directory under ~/Agentic
 *      becomes a permanent alarm.
 *   2. PRUNED on a full sweep and skipped on a targeted one, or a closed session
 *      reports 'missing' forever / a launcher's single-project request wipes
 *      every other expectation on the machine.
 *   3. DELETED on reap, or closing a session becomes an alarm 90s later.
 *
 * Plus the threshold's derivation: hardcoding it below two spawn intervals would
 * flag the normal startup path, when a just-spawned ETM has not yet beaten.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COORD = path.join(REPO, 'scripts/health-coordinator.js');
const src = fs.readFileSync(COORD, 'utf-8');
const flat = src.replace(/\s+/g, ' ');

test('coordinator source still parses cleanly', () => {
  const res = spawnSync(process.execPath, ['--check', COORD], { encoding: 'utf-8' });
  assert.equal(res.status, 0, res.stderr);
});

test('the missing threshold is derived from the spawn interval, not a literal', () => {
  assert.match(flat, /const ETM_MISSING_MS = \d+ \* ETM_SPAWN_INTERVAL_MS;/);
  // Below two intervals it would fire on a healthy spawn that has not beaten yet.
  const mult = Number(flat.match(/const ETM_MISSING_MS = (\d+) \* ETM_SPAWN_INTERVAL_MS;/)[1]);
  assert.ok(mult >= 2, `ETM_MISSING_MS multiplier ${mult} flags normal startup`);
});

test('an expectation is recorded only after the activity gate, never before it', () => {
  const gate = src.indexOf('if (!targeted && !transcriptFresh && !tmuxAlive && !hasOpenCode)');
  const record = src.indexOf('_etmExpected.set(');
  assert.ok(gate > 0, 'activity gate not found — did the gate move?');
  assert.ok(record > gate, 'expectation is recorded before the activity gate: every ~/Agentic dir would alarm');
});

test('a full sweep prunes expectations; a targeted one must not', () => {
  assert.match(flat, /if \(!only\) \{ for \(const name of \[\.\.\._etmExpected\.keys\(\)\]\) \{ if \(!qualified\.has\(name\)\) _etmExpected\.delete\(name\); \} \}/);
});

test('reaping an ETM forgets its expectation', () => {
  const reap = src.indexOf('_reapedProjects.set(e.projectName, Date.now())');
  assert.ok(reap > 0, 'reaper stamp not found');
  const after = src.slice(reap, reap + 600);
  assert.match(after, /_etmExpected\.delete\(e\.projectName\)/);
});

test("'missing' never overwrites a project the rollup already reports", () => {
  // A 'degraded' project is already an issue for every consumer. Relabelling it
  // would lose the distinction between "beat, then stopped" and "never beat".
  assert.match(flat, /if \(name in rollup\) continue;/);
  assert.match(flat, /if \(now - exp\.since > ETM_MISSING_MS\) rollup\[name\] = 'missing';/);
});

test('a healthy project clears its own expectation', () => {
  assert.match(flat, /if \(rollup\[name\] === 'healthy'\) \{ _etmExpected\.delete\(name\); continue; \}/);
});
