/**
 * A launch that dies while the terminal is still in tmux's raw mode must not
 * leave it broken ("staircase" output, LF without CR — 2026-11-09, a boxed
 * copilot that exited after 4 s). Three guarantees:
 *   1. the tmux wrapper resets the tty right after attach returns, before it
 *      prints anything (the fast-exit report included);
 *   2. _cleanup_session resets first and runs once;
 *   3. INT/TERM clean up AND exit, so the launcher does not keep printing
 *      after a signal.
 *
 * The functions are sliced out of the scripts and run in bash, so the test
 * exercises the launcher's own lines rather than a restatement of them.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRAPPER = readFileSync(join(REPO, 'scripts/tmux-session-wrapper.sh'), 'utf8');
const LAUNCH = readFileSync(join(REPO, 'scripts/launch-agent-common.sh'), 'utf8');

/** One top-level shell function, from `name() {` to its closing `}` at column 0. */
function fn(source, name) {
  const start = source.indexOf(`${name}() {`);
  assert.ok(start !== -1, `${name} not found`);
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end + 3);
}

function trapLines() {
  return LAUNCH.split('\n').filter((l) => /^\s*trap .*_cleanup_session/.test(l)).map((l) => l.trim()).join('\n');
}

/** Run the cleanup + traps in bash with stubbed helpers; `body` runs after the traps are set. */
function runCleanup(body) {
  const stub = mkdtempSync(join(tmpdir(), 'term-reset-'));
  const script = [
    'set +e',
    `SCRIPT_DIR=${stub}; AGENT_NAME=test; TARGET_PROJECT_DIR=${stub}; SESSION_ID=x`,
    '_agent_log() { echo "LOG $*"; }',
    '_tmux_wrapper_reset_tty() { echo RESET; }',
    fn(LAUNCH, '_cleanup_session'),
    trapLines(),
    body,
  ].join('\n');
  return spawnSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe('terminal reset on a dying launch', () => {
  test('the wrapper resets the tty immediately after attach returns', () => {
    const after = WRAPPER.slice(WRAPPER.indexOf('tmux attach-session -t "$session_name"'));
    const lines = after.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.equal(lines[1], 'local attach_rc=$?');
    assert.equal(lines[2], '_tmux_wrapper_reset_tty');
  });

  test('the reset goes through /dev/tty and is a no-op without a terminal', () => {
    const reset = fn(WRAPPER, '_tmux_wrapper_reset_tty');
    assert.match(reset, /stty sane <\/dev\/tty/);
    // setsid: no controlling terminal at all → must return 0 and print nothing
    const res = spawnSync('setsid', ['bash', '-c', `${reset}\n_tmux_wrapper_reset_tty; echo rc=$?`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (res.error?.code === 'ENOENT') return; // no setsid (macOS) — covered on Linux CI
    assert.equal(res.stdout.trim(), 'rc=0');
  });

  test('cleanup resets the tty first, and runs once', () => {
    const res = runCleanup('_cleanup_session; _cleanup_session; exit 0');
    const out = res.stdout.split('\n').filter(Boolean);
    assert.equal(out[0], 'RESET');
    assert.equal(out.filter((l) => l.includes('Session ending')).length, 1);
  });

  test('TERM cleans up once and exits 143 — nothing after it runs', () => {
    const res = runCleanup('kill -TERM $$; echo STILL-RUNNING');
    assert.equal(res.status, 143);
    assert.ok(!res.stdout.includes('STILL-RUNNING'));
    assert.equal(res.stdout.split('\n').filter((l) => l.includes('Session ending')).length, 1);
  });

  test('INT cleans up once and exits 130', () => {
    const res = runCleanup('kill -INT $$; echo STILL-RUNNING');
    assert.equal(res.status, 130);
    assert.ok(!res.stdout.includes('STILL-RUNNING'));
    assert.equal(res.stdout.split('\n').filter((l) => l.includes('Session ending')).length, 1);
  });

  test('a normal exit still cleans up (EXIT trap)', () => {
    const res = runCleanup('echo DONE');
    assert.equal(res.status, 0);
    assert.match(res.stdout, /DONE\n[\s\S]*Session ending/);
  });
});
