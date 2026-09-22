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
import { existsSync, readFileSync } from 'node:fs';
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

function startSession({ grab }) {
  try { execFileSync('tmux', ['-L', SOCKET, 'kill-server'], { stdio: 'ignore' }); } catch { /* none running */ }
  execFileSync('tmux', ['-L', SOCKET, 'new-session', '-d', '-s', 't',
    '-x', '100', '-y', '24', `${APP} ${grab ? 'grab' : 'nograb'}`]);
  tmux('set-option', '-g', 'mouse', 'on');
  execFileSync('tmux', ['-L', SOCKET, 'source-file', '/dev/stdin'],
    { input: shippedBindings() });
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

describe('tmux drag-to-select', { skip: SKIP }, () => {
  after(() => {
    try { execFileSync('tmux', ['-L', SOCKET, 'kill-server'], { stdio: 'ignore' }); } catch { /* gone */ }
  });

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
    assert.equal(copied, 'aaaa bbbb cccc dddd ');
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
