// tests/agent-mouse.test.mjs — under tmux, a drag reaches whoever makes the
// selection (lib/glass/tmux.mjs AGENT_MOUSE).
//
// Two halves, because either can break on its own:
//
//   routing   glass's bindings on a real tmux server, driven by a real tmux
//             client: an outer tmux pane runs `tmux attach`, so bytes sent into
//             that pane are what a terminal would send. A stub agent that holds
//             the mouse must receive the whole gesture; one that let go must
//             leave tmux's selection in the buffer. Skipped without tmux.
//
//   contract  the real agent CLIs, launched under tmux with the environment
//             glass gives them: `own` agents hold the mouse, `release` agents
//             let go of it. Upstream releases change this without a commit
//             here (pi and Copilot both went full-screen with their own
//             selection), so CI runs it on a schedule against the latest
//             agents. Launches the agents: only with GLASS_AGENT_PROBE=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const { AGENT_MOUSE, agentMouseEnv, configureStatus } = await import('../lib/glass/tmux.mjs');
const { agentBin, whichBin } = await import('../lib/glass/cli.mjs');

const hasTmux = process.platform !== 'win32' && spawnSync('tmux', ['-V']).status === 0;

function server(dir, name, env = process.env) {
  const sock = path.join(dir, name);
  const t = (...a) => spawnSync('tmux', ['-S', sock, '-f', '/dev/null', ...a], { encoding: 'utf8', env });
  return { sock, t, flag: (f) => t('display-message', '-p', '-t', 's', f).stdout.trim() };
}

async function until(fn, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(100); }
  return false;
}

// Alternate screen, ten lines of text, and with `own` any-event mouse tracking
// (DECSET 1003 + SGR), as Copilot CLI asks for; everything read is logged.
const STUB = `
const fs = require('node:fs');
const [log, kind] = process.argv.slice(2);
process.stdout.write('\\x1b[?1049h' + (kind === 'own' ? '\\x1b[?1003h\\x1b[?1006h' : ''));
for (let i = 0; i < 10; i++) process.stdout.write('\\x1b[' + (i + 1) + ';1Hline-' + i + ' alpha bravo charlie delta');
process.stdin.setRawMode(true); process.stdin.resume();
process.stdin.on('data', (b) => fs.appendFileSync(log, b.toString('latin1')));
`;

/** Drag across the second line, columns 3 → 20, with the agent of `kind` in the pane. */
async function dragOver(kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-mouse-'));
  const inner = server(dir, 'i');
  const outer = server(dir, 'o');
  const stub = path.join(dir, 'stub.cjs');
  const log = path.join(dir, 'agent.log');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(log, '');
  const saved = { TMUX: process.env.TMUX, TMUX_PANE: process.env.TMUX_PANE };
  try {
    inner.t('new-session', '-d', '-s', 's', '-x', '100', '-y', '20', '--', process.execPath, stub, log, kind);
    process.env.TMUX = `${inner.sock},${inner.flag('#{pid}')},0`;
    process.env.TMUX_PANE = inner.flag('#{pane_id}');
    // glass's own bindings, as the inner run installs them; no clipboard pipe, so
    // a tmux selection stays in tmux's buffer where the test can read it.
    configureStatus({ taskId: 'glass-test-1', port: 12999, env: { GLASS_TMUX_OWNED: '1' }, tmpDir: dir, which: () => false });
    assert.ok(await until(() => inner.flag('#{mouse_any_flag}') === (kind === 'own' ? '1' : '0')
      && inner.t('capture-pane', '-p', '-t', 's').stdout.includes('line-9')), 'stub agent up');
    outer.t('new-session', '-d', '-s', 's', '-x', '100', '-y', '22', '--', 'tmux', '-S', inner.sock, 'attach', '-t', 's');
    assert.ok(await until(() => inner.t('list-clients').stdout.trim() !== ''), 'client attached');
    await sleep(500);
    for (const seq of ['\x1b[<0;3;2M', '\x1b[<32;10;2M', '\x1b[<32;20;2M', '\x1b[<0;20;2m']) {
      outer.t('send-keys', '-t', 's', '-l', seq);
      await sleep(150);
    }
    await sleep(500);
    const buffer = inner.t('show-buffer');
    return {
      agentGot: fs.readFileSync(log, 'latin1'),
      buffer: buffer.status === 0 ? buffer.stdout : '',
      inMode: inner.flag('#{pane_in_mode}'),
    };
  } finally {
    Object.assign(process.env, saved);
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    outer.t('kill-server');
    inner.t('kill-server');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('routing: an agent that holds the mouse gets the whole drag (pi, Copilot)', { skip: !hasTmux && 'no tmux' }, async () => {
  const r = await dragOver('own');
  assert.ok(r.agentGot.includes('\x1b[<0;3;2M'), `press reaches the agent: ${JSON.stringify(r.agentGot)}`);
  assert.ok(r.agentGot.includes('\x1b[<32;'), `motion reaches the agent: ${JSON.stringify(r.agentGot)}`);
  assert.ok(r.agentGot.includes('\x1b[<0;20;2m'), `release reaches the agent: ${JSON.stringify(r.agentGot)}`);
  assert.equal(r.inMode, '0', 'tmux stays out of copy-mode');
  assert.equal(r.buffer, '', 'and selects nothing of its own');
});

test('routing: over an agent that let go of the mouse, tmux selects (claude, opencode)', { skip: !hasTmux && 'no tmux' }, async () => {
  const r = await dragOver('release');
  assert.match(r.buffer, /alpha bravo/, `the dragged span is in tmux's buffer: ${JSON.stringify(r.buffer)}`);
  assert.equal(r.agentGot, '', 'the agent hears nothing');
});

// ── contract: the installed agents ─────────────────────────────────────────────

const PROBE = process.env.GLASS_AGENT_PROBE === '1';

/** The agent's mouse grab once it is up, under tmux, with `extraEnv` and no other opt-out. */
async function grabOf(bin, extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-probe-'));
  // The tmux server hands its environment to the agent; a shell inside coding's
  // or glass's tmux already carries an opt-out, which would decide the answer.
  const base = { ...process.env };
  for (const k of ['GLASS_AGENT_MOUSE', 'TMUX', 'TMUX_PANE', ...Object.keys(AGENT_MOUSE).flatMap((a) => Object.keys(agentMouseEnv(a, {})))]) delete base[k];
  const s = server(dir, 'p', base);
  const env = Object.entries(extraEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  try {
    // One command argument is run by the shell: quoted, so a path with a space
    // (VS Code's copilot shim lives under "Application Support") stays one word.
    // Started in this checkout, a folder the agent already trusts on a developer's
    // machine: a folder-trust prompt does not take the mouse.
    s.t('new-session', '-d', '-s', 's', '-x', '120', '-y', '35', '-c', process.cwd(), ...env, '--', `'${bin.replace(/'/g, "'\\''")}'`);
    // A grabbing agent shows it within seconds; one that does not grab is given
    // the same time after its full-screen view is up before it counts as `no`.
    if (await until(() => s.flag('#{mouse_any_flag}') === '1', 25_000)) return true;
    await until(() => s.flag('#{alternate_on}') === '1', 5_000);
    await sleep(3_000);
    return s.flag('#{mouse_any_flag}') === '1';
  } finally {
    s.t('kill-server');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const [agent, who] of Object.entries(AGENT_MOUSE)) {
  const bin = PROBE && hasTmux ? whichBin(agentBin(agent)) : null;
  const skip = !PROBE ? 'launches the agent: GLASS_AGENT_PROBE=1' : !hasTmux ? 'no tmux' : !bin && `${agent} not installed`;
  test(`contract: ${agent} ${who === 'own' ? 'holds the mouse and selects by itself' : 'lets go of the mouse under glass'}`, { skip, timeout: 90_000 }, async (t) => {
    const env = agentMouseEnv(agent, {});
    if (who === 'own') {
      assert.equal(await grabOf(bin, env), true,
        `${agent} no longer holds the mouse: a drag now opens tmux's copy-mode over it — set AGENT_MOUSE.${agent} = 'release' if that selects cleanly`);
      return;
    }
    // Without its opt-out the agent must grab, or this proves nothing (Claude Code
    // grabs only for some accounts; not for a CI runner without a login).
    if (!(await grabOf(bin, {}))) { t.skip(`${agent} does not take the mouse here even without ${Object.keys(env)[0]}`); return; }
    assert.equal(await grabOf(bin, env), false,
      `${agent} ignores ${Object.keys(env)[0]}=1 and keeps the mouse: drags go to it and select nothing`);
  });
}
