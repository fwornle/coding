/**
 * The agent box's paste bridge (docker/agent-box/clipboard/paste-bridge.py):
 * Cmd+V on a Mac sends an EMPTY bracketed paste when only an image is on the
 * clipboard; the bridge must turn exactly that into Ctrl+V and pass every
 * other byte through untouched. Runs the real bridge on a pseudo-terminal
 * (tests/guard/fixtures/paste-bridge-drive.py plays the terminal).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRIDGE = path.join(REPO, 'docker/agent-box/clipboard/paste-bridge.py');
const DRIVER = path.join(REPO, 'tests/guard/fixtures/paste-bridge-drive.py');

const hex = (s) => Buffer.from(s, 'latin1').toString('hex');
const START = '\x1b[200~';
const END = '\x1b[201~';

function drive(chunks, { exit = 0, pause = 0 } = {}) {
  const res = spawnSync('python3', [DRIVER, BRIDGE, String(exit), String(pause), ...chunks.map(hex)],
    { encoding: 'utf8', timeout: 30_000 });
  assert.equal(res.status, 0, `driver failed: ${res.stderr}`);
  const out = JSON.parse(res.stdout.trim().split('\n').at(-1));
  return { received: Buffer.from(out.received, 'hex').toString('latin1'), exit: out.exit };
}

const python = spawnSync('python3', ['--version']).status === 0;

test('an empty bracketed paste (Cmd+V, image-only clipboard) reaches the agent as Ctrl+V', { skip: !python }, () => {
  assert.equal(drive([`a${START}${END}b`]).received, 'a\x16b');
});

test('a paste with content passes through byte for byte', { skip: !python }, () => {
  const paste = `${START}hello\nworld${END}`;
  assert.equal(drive([paste]).received, paste);
});

test('an empty paste split across two reads is still recognised', { skip: !python }, () => {
  assert.equal(drive([`${START}\x1b[2`, `01~x`], { pause: 0.01 }).received, '\x16x');
});

test('a held prefix is released unchanged when nothing completes it', { skip: !python }, () => {
  // ESC alone (the Escape key) must not be swallowed while the bridge waits.
  assert.equal(drive(['\x1b'], { pause: 0.3 }).received, '\x1b');
  assert.equal(drive([`${START}`, 'x'], { pause: 0.3 }).received, `${START}x`);
});

test('a typed Ctrl+V and ordinary keys are untouched', { skip: !python }, () => {
  assert.equal(drive(['\x16abc\x1b[A\r']).received, '\x16abc\x1b[A\r');
});

test("the agent's exit code is the bridge's exit code", { skip: !python }, () => {
  assert.equal(drive(['q'], { exit: 7 }).exit, 7);
});

test('without a terminal the bridge just runs the command', { skip: !python }, () => {
  const res = spawnSync('python3', [BRIDGE, '--', 'sh', '-c', 'cat; exit 3'], { input: `${START}${END}`, encoding: 'latin1' });
  assert.equal(res.status, 3);
  assert.equal(res.stdout, `${START}${END}`);
});
