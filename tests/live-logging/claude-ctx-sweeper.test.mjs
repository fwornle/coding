// tests/live-logging/claude-ctx-sweeper.test.mjs
//
// The status-line temp-file sweeper: what it reclaims, and — more importantly — what it
// must never touch.
//
// Driven through the CLAUDE_CTX_SWEEP_TMPDIR seam so no test ever points the sweeper at
// the real temp directory. Mirrors tests/context-turns/sweeper.test.mjs: seed a throwaway
// dir, back-date with fs.utimesSync, run the job as a subprocess, assert on the files.
//
// The load-bearing test here is "leaves unrelated files alone". The sweeper runs against a
// directory shared with the whole OS, so a widened prefix match is the one bug in this file
// that would do real damage, and it would do it silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWEEPER = path.join(__dirname, '..', '..', 'scripts', 'claude-ctx-sweeper.mjs');
const DAY_MS = 24 * 60 * 60 * 1000;

function mkdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sweeper-test-'));
}

/** Write a file into the fixture dir and back-date it by `ageDays`. */
function seed(dir, name, ageDays) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '{"session_id":"x"}');
  const when = new Date(Date.now() - ageDays * DAY_MS);
  fs.utimesSync(file, when, when);
  return file;
}

function run(dir, args = [], env = {}) {
  return spawnSync(process.execPath, [SWEEPER, ...args], {
    env: { ...process.env, CLAUDE_CTX_SWEEP_TMPDIR: dir, ...env },
    encoding: 'utf8',
  });
}

const exists = (f) => fs.existsSync(f);

test('reclaims files past retention and keeps the ones inside it', (t) => {
  const dir = mkdir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const stale = seed(dir, 'claude-ctx-11111111-aaaa-bbbb-cccc-000000000001.json', 5);
  const live = seed(dir, 'claude-ctx-22222222-aaaa-bbbb-cccc-000000000002.json', 0);

  const res = run(dir);
  assert.equal(res.status, 0, `non-zero exit: ${res.stderr}`);
  assert.equal(exists(stale), false, 'a 5-day-old bridge file should be reclaimed');
  assert.equal(exists(live), true, 'a bridge file written today must survive');
});

test('all three families are swept on the same rule', (t) => {
  const dir = mkdir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // The -warned companion is written by GSD's context-monitor hook and would otherwise
  // outlive the bridge file it belongs to; claude-tmux-session-* is the pane record.
  const bridge = seed(dir, 'claude-ctx-33333333-aaaa-bbbb-cccc-000000000003.json', 5);
  const warned = seed(dir, 'claude-ctx-33333333-aaaa-bbbb-cccc-000000000003-warned.json', 5);
  const record = seed(dir, 'claude-tmux-session-coding-claude-99999.json', 5);

  run(dir);
  assert.equal(exists(bridge), false, 'bridge file should be reclaimed');
  assert.equal(exists(warned), false, '-warned companion should be reclaimed');
  assert.equal(exists(record), false, 'pane record should be reclaimed');
});

test('leaves unrelated temp files alone, however old', (t) => {
  const dir = mkdir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // The temp dir is shared with the OS and with the rest of this repo. Every one of these
  // is older than the retention window and every one must survive: age is the eligibility
  // rule only AFTER the name has been matched, never on its own.
  const others = [
    seed(dir, 'vkb-server.pid', 30),
    seed(dir, 'kgbench-needles-4242.txt', 30),
    seed(dir, 'claude-something-else.json', 30),  // shares a word, not the prefix
    seed(dir, 'some-unrelated-file.json', 30),
    seed(dir, 'claude-ctx-not-json.txt', 30),     // right prefix, wrong extension
  ];

  const res = run(dir);
  assert.equal(res.status, 0);
  for (const f of others) {
    assert.equal(exists(f), true, `${path.basename(f)} must not be touched`);
  }
});

test('--dry-run reports without deleting', (t) => {
  const dir = mkdir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const stale = seed(dir, 'claude-ctx-44444444-aaaa-bbbb-cccc-000000000004.json', 5);
  const res = run(dir, ['--dry-run']);

  assert.equal(exists(stale), true, '--dry-run must not delete');
  assert.match(res.stdout, /would remove claude-ctx-44444444/);
});

test('retention is configurable by flag and by env', (t) => {
  const dir = mkdir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const threeDays = seed(dir, 'claude-ctx-55555555-aaaa-bbbb-cccc-000000000005.json', 3);
  run(dir, ['--retention-days=10']);
  assert.equal(exists(threeDays), true, 'a 10-day retention must spare a 3-day-old file');

  run(dir, [], { CLAUDE_CTX_RETENTION_DAYS: '1' });
  assert.equal(exists(threeDays), false, 'a 1-day retention must reclaim it');
});

test('a malformed retention falls back to the default instead of coercing to zero', (t) => {
  const dir = mkdir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Number('') is 0 and Number('abc') is NaN. Either one treated as a retention of zero
  // would delete every file in the directory, including live sessions'.
  const live = seed(dir, 'claude-ctx-66666666-aaaa-bbbb-cccc-000000000006.json', 0);
  for (const bad of ['', 'abc', '0', '-5']) {
    run(dir, [], { CLAUDE_CTX_RETENTION_DAYS: bad });
    assert.equal(exists(live), true, `retention "${bad}" must not reclaim a live file`);
  }
});

test('a missing sweep directory exits 0 rather than throwing', () => {
  // The never-throw contract: this runs on the agent launch path, where a non-zero exit
  // would turn housekeeping into a failed launch.
  const res = run(path.join(os.tmpdir(), 'ctx-sweeper-does-not-exist-9f3a'));
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
  assert.equal(res.stderr, '');
});

test('--if-older-than skips while the stamp is fresh and runs once it ages', (t) => {
  const dir = mkdir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  seed(dir, 'claude-ctx-77777777-aaaa-bbbb-cccc-000000000007.json', 5);
  run(dir);                                    // first run writes the stamp
  const stampFile = path.join(dir, '.claude-ctx-sweeper-stamp');
  assert.equal(exists(stampFile), true, 'a real run should leave a stamp');

  const second = seed(dir, 'claude-ctx-88888888-aaaa-bbbb-cccc-000000000008.json', 5);
  const skipped = run(dir, ['--if-older-than=3600']);
  assert.equal(exists(second), true, 'a fresh stamp must skip the sweep entirely');
  assert.equal(skipped.stdout, '', 'a skipped run should say nothing');

  // Age the stamp past the window; the sweep must resume.
  fs.writeFileSync(stampFile, JSON.stringify({ last_run_at: Date.now() - 2 * 3600 * 1000 }));
  run(dir, ['--if-older-than=3600']);
  assert.equal(exists(second), false, 'an aged stamp must let the sweep run');
});

test('a corrupt stamp means sweep, not skip forever', (t) => {
  const dir = mkdir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // A bad stamp must fail toward doing the work. Failing the other way would silently
  // disable the sweeper permanently, with nothing to notice.
  fs.writeFileSync(path.join(dir, '.claude-ctx-sweeper-stamp'), 'not json at all');
  const stale = seed(dir, 'claude-ctx-99999999-aaaa-bbbb-cccc-000000000009.json', 5);
  run(dir, ['--if-older-than=3600']);
  assert.equal(exists(stale), false, 'a corrupt stamp must not suppress the sweep');
});
