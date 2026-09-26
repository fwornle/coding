/**
 * Drag-to-select must actually put the dragged text on the clipboard.
 *
 * This exists because the previous attempt at this passed every check anyone
 * thought to make and still did not work. The bindings were right, they fired,
 * `list-keys` showed them, the drag entered copy-mode and `copy-pipe-and-cancel`
 * ran — and the selection was empty, because of something no binding can show:
 *
 *   A coding agent enables ANY-EVENT mouse tracking (DECSET 1003). The moment a
 *   drag opens copy-mode, no visible pane holds MODE_MOUSE_ALL any more, so tmux
 *   downgrades the TERMINAL from 1003 to 1002 mid-gesture. xterm.js drops the
 *   in-flight drag there and reports no further motion. Against the real agent
 *   binary a 30-column drag copied 6 bytes, cut off at the first motion event.
 *
 * So the test drives a real tmux client over a pty and models the one terminal
 * behaviour that matters: motion reporting ends when tracking is switched off
 * mid-gesture. Both cases are asserted — with the agent holding the mouse the
 * selection collapses, without it the whole span is copied — because a test
 * that only checks the good case cannot tell a fix from a coincidence.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'tmux-mouse');
const CLIENT = path.join(FIXTURES, 'drag-client.py');
const APP = path.join(FIXTURES, 'grabby-app.sh');
const SOCKET = 'coding-mouse-test';
const WRAPPER = path.join(REPO, 'scripts', 'tmux-session-wrapper.sh');

const have = (bin) => spawnSync('command', ['-v', bin], { shell: true }).status === 0;
const SKIP = !have('tmux') || !have('python3')
  ? 'needs tmux and python3 on PATH'
  : false;

/** The binding set the wrapper actually ships, read out of the wrapper. */
function shippedBindings() {
  const src = readFileSync(WRAPPER, 'utf8');
  const body = src.split('<<EOF_MOUSE_COPY\n')[1]?.split('\nEOF_MOUSE_COPY')[0];
  assert.ok(body, 'could not find the mouse binding heredoc in the wrapper');
  return body.replaceAll('${copy_pipe}', '');
}

const tmux = (...args) =>
  execFileSync('tmux', ['-L', SOCKET, ...args], { encoding: 'utf8' }).trim();

/**
 * Stop the server and wait for it to actually be gone.
 *
 * `kill-server` returns as soon as the request is sent, not when the socket is
 * released. Starting a new session into that window makes the client attach to
 * a server on its way out and fail with "server exited unexpectedly" — which is
 * what CI hit once the run before it left a server behind.
 */
function killServer() {
  try { execFileSync('tmux', ['-L', SOCKET, 'kill-server'], { stdio: 'ignore' }); }
  catch { return; }   // nothing was running
  for (let i = 0; i < 50; i++) {
    const alive = spawnSync('tmux', ['-L', SOCKET, 'has-session'], { stdio: 'ignore' }).status === 0;
    if (!alive) return;
    execFileSync('sleep', ['0.1']);
  }
}

function startSession({ grab }) {
  killServer();
  execFileSync('tmux', ['-L', SOCKET, 'new-session', '-d', '-s', 't',
    '-x', '100', '-y', '24', `${APP} ${grab ? 'grab' : 'nograb'}`]);
  tmux('set-option', '-g', 'mouse', 'on');
  // Via a real file, NOT `source-file /dev/stdin` with `{ input }`.
  //
  // `source-file` is executed by the tmux SERVER, a daemon that long outlives
  // the client invocation — so `/dev/stdin` is the SERVER's fd 0, never the
  // pipe `input` writes to. On Linux that path is /proc/self/fd/0 and the
  // server's stdin is closed, so opening it fails with ENXIO:
  //   "/dev/stdin: No such device or address"
  // macOS resolves /dev/stdin differently and happens to succeed, which is why
  // this passed on every developer machine and failed on every CI run.
  const dir = mkdtempSync(path.join(tmpdir(), 'tmux-mouse-'));
  const conf = path.join(dir, 'bindings.conf');
  try {
    writeFileSync(conf, shippedBindings());
    execFileSync('tmux', ['-L', SOCKET, 'source-file', conf]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The app announces its mouse modes after it starts; the flag is not set at
  // the instant new-session returns.
  const want = grab ? '1' : '0';
  for (let i = 0; i < 40; i++) {
    if (tmux('display-message', '-p', '#{mouse_any_flag}') === want) return;
    execFileSync('sleep', ['0.1']);
  }
}

function drag(steps) {
  try { tmux('delete-buffer'); } catch { /* no buffer yet */ }
  execFileSync('python3', [CLIENT, SOCKET, steps], { encoding: 'utf8', timeout: 60_000 });
  try { return execFileSync('tmux', ['-L', SOCKET, 'show-buffer'], { encoding: 'utf8' }); }
  catch { return ''; }   // empty selection copies nothing and creates no buffer
}

/** Columns 10-29 of the fixture's line 3, the span the drag covers. */
const SPAN = 'aaaa bbbb cccc dddd ';

describe('tmux drag-to-select', { skip: SKIP }, () => {
  after(() => { killServer(); });

  test('the agent holding the mouse is what breaks it', () => {
    startSession({ grab: true });
    assert.equal(tmux('display-message', '-p', '#{mouse_any_flag}'), '1');
    const copied = drag('down:10:3,move:15:3,move:22:3,move:30:3,up:30:3');
    // The full span is "aaaa bbbb cccc dddd ". What survives is only what the
    // drag covered before copy-mode opened and the protocol was downgraded.
    assert.ok(copied.length < 10,
      `expected a collapsed selection while the pane holds 1003, got ${JSON.stringify(copied)}`);
  });

  test('with the mouse left alone, the whole dragged span is copied', () => {
    startSession({ grab: false });
    assert.equal(tmux('display-message', '-p', '#{mouse_any_flag}'), '0');
    const copied = drag('down:10:3,move:15:3,move:22:3,move:30:3,up:30:3');
    // Whether the cell UNDER the cursor at MouseDragEnd joins the selection
    // depends on whether the last motion event was handled separately or
    // coalesced with the release. Both are correct tmux and which one happens
    // is machine-speed dependent: idle, this copies 20 chars; under full-suite
    // load the same gesture copies 21, and the grab case likewise went 5 -> 6.
    // Pinning the exact boundary cell made the suite fail only when busy, which
    // is how this reached CI. The behaviour under test is the SPAN — 20 copied
    // against the collapsed case's 6 — so assert that and not the race.
    assert.ok(copied === SPAN || copied === `${SPAN}e`,
      `expected the whole dragged span, got ${JSON.stringify(copied)}`);
  });
});

describe('the wrapper takes the mouse off the agents it launches', () => {
  const src = readFileSync(WRAPPER, 'utf8');

  test('claude and opencode each get their documented opt-out', () => {
    assert.match(src, /claude\)\s+\[ -z "\$\{CLAUDE_CODE_DISABLE_MOUSE:-\}" \] && export CLAUDE_CODE_DISABLE_MOUSE=1/);
    assert.match(src, /opencode\)\s+\[ -z "\$\{OPENCODE_DISABLE_MOUSE:-\}" \] && export OPENCODE_DISABLE_MOUSE=1/);
  });

  test('the opt-outs travel into a newly created session', () => {
    // Exported above, so they must also be on the propagation list or they
    // would apply only to the already-inside-tmux path.
    const envList = src.split('local env_vars=(')[1].split(')')[0];
    for (const name of ['CLAUDE_CODE_DISABLE_MOUSE', 'OPENCODE_DISABLE_MOUSE', 'CODING_AGENT_MOUSE']) {
      assert.ok(envList.includes(name), `${name} is exported but never propagated`);
    }
  });

  test('an explicit choice is never overridden', () => {
    assert.match(src, /CODING_AGENT_MOUSE:-\}" != "keep"/);
  });

  test('the wheel is handed back, since the agent can no longer hear it', () => {
    // Taking the mouse away takes the agent's wheel scrolling with it, and on
    // an alternate screen there is no tmux scrollback to fall back to.
    assert.match(src, /WheelUpPane.*alternate_on.*send-keys PageUp/s);
    assert.match(src, /WheelDownPane.*alternate_on.*send-keys PageDown/s);
  });
});
