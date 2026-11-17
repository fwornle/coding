// tests/agent-mouse.test.mjs — under tmux, a drag reaches whoever makes the
// selection: the agent when it holds the mouse, tmux's copy-mode otherwise
// (lib/glass/tmux.mjs).
//
// Two halves, because either can break on its own:
//
//   routing   glass's bindings on a real tmux server, driven by a real tmux
//             client: an outer tmux pane runs `tmux attach`, so bytes sent into
//             that pane are what a terminal would send. A stub agent that holds
//             the mouse must receive the whole gesture; one that does not must
//             leave tmux's selection in the buffer. Skipped without tmux.
//
//   contract  the real agent CLIs, launched under tmux the way glass launches
//             them: a drag across a phrase on the agent's screen must copy a
//             piece of that line, and leave tmux out of copy-mode. Agent
//             releases change how they handle the mouse without a commit here,
//             so CI runs this on a schedule against the latest agents.
//             Launches the agents and uses the clipboard: only with
//             GLASS_AGENT_PROBE=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const { agentMouseEnv, configureStatus } = await import('../lib/glass/tmux.mjs');
const { agentBin, whichBin } = await import('../lib/glass/cli.mjs');

const hasTmux = process.platform !== 'win32' && spawnSync('tmux', ['-V']).status === 0;

function server(dir, name, env = process.env) {
  const sock = path.join(dir, name);
  const t = (...a) => spawnSync('tmux', ['-S', sock, '-f', '/dev/null', ...a], { encoding: 'utf8', env });
  return { sock, t, flag: (f) => t('display-message', '-p', '-t', 's', f).stdout.trim() };
}

async function until(fn, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(100); }
  return false;
}

/**
 * `argv` in a tmux session with glass's bindings, and a tmux client attached
 * from a second server, so `drag` arrives as a terminal's mouse input.
 */
async function underTmux(argv, { env = process.env, ready }, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-mouse-'));
  const inner = server(dir, 'i', env);
  const outer = server(dir, 'o', env);
  const saved = { TMUX: process.env.TMUX, TMUX_PANE: process.env.TMUX_PANE };
  try {
    inner.t('new-session', '-d', '-s', 's', '-x', '140', '-y', '36', '-c', process.cwd(), '--', ...argv);
    // An agent's own copy of its selection lands in tmux's buffer as OSC 52.
    inner.t('set-option', '-s', 'set-clipboard', 'on');
    process.env.TMUX = `${inner.sock},${inner.flag('#{pid}')},0`;
    process.env.TMUX_PANE = inner.flag('#{pane_id}');
    // glass's own bindings, as the inner run installs them; no clipboard pipe, so
    // a tmux selection stays in tmux's buffer where the test can read it.
    configureStatus({ taskId: 'glass-test-1', port: 12999, env: { GLASS_TMUX_OWNED: '1' }, tmpDir: dir, which: () => false });
    const screen = () => inner.t('capture-pane', '-p', '-t', 's').stdout;
    assert.ok(await until(() => ready(inner, screen()), 30_000), `up: ${screen()}`);
    outer.t('new-session', '-d', '-s', 's', '-x', '140', '-y', '38', '--', 'tmux', '-S', inner.sock, 'attach', '-t', 's');
    assert.ok(await until(() => inner.t('list-clients').stdout.trim() !== ''), 'client attached');
    await sleep(500);
    const drag = async (row, from, to) => {
      const steps = [from, Math.round((from + to) / 2), to];
      const seqs = [`\x1b[<0;${from};${row}M`, ...steps.slice(1).map((x) => `\x1b[<32;${x};${row}M`), `\x1b[<0;${to};${row}m`];
      for (const seq of seqs) { outer.t('send-keys', '-t', 's', '-l', seq); await sleep(150); }
    };
    const buffer = () => { const r = inner.t('show-buffer'); return r.status === 0 ? r.stdout : ''; };
    return await body({ inner, screen, drag, buffer, dir });
  } finally {
    Object.assign(process.env, saved);
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    outer.t('kill-server');
    inner.t('kill-server');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Alternate screen, ten lines of text, and with `own` any-event mouse tracking
// (DECSET 1003 + SGR), as the agents ask for; everything read is logged.
const STUB = `
const fs = require('node:fs');
const [log, kind] = process.argv.slice(2);
process.stdout.write('\\x1b[?1049h' + (kind === 'own' ? '\\x1b[?1003h\\x1b[?1006h' : ''));
for (let i = 0; i < 10; i++) process.stdout.write('\\x1b[' + (i + 1) + ';1Hline-' + i + ' alpha bravo charlie delta');
process.stdin.setRawMode(true); process.stdin.resume();
process.stdin.on('data', (b) => fs.appendFileSync(log, b.toString('latin1')));
`;

/** Drag across the second line, columns 3 → 20, over a stub agent of `kind`. */
function dragOverStub(kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-stub-'));
  const stub = path.join(dir, 'stub.cjs');
  const log = path.join(dir, 'agent.log');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(log, '');
  const ready = (s, text) => s.flag('#{mouse_any_flag}') === (kind === 'own' ? '1' : '0') && text.includes('line-9');
  return underTmux([process.execPath, stub, log, kind], { ready }, async ({ inner, drag, buffer }) => {
    await drag(2, 3, 20);
    await sleep(500);
    return { agentGot: fs.readFileSync(log, 'latin1'), buffer: buffer(), inMode: inner.flag('#{pane_in_mode}') };
  }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

test('routing: an agent that holds the mouse gets the whole drag', { skip: !hasTmux && 'no tmux' }, async () => {
  const r = await dragOverStub('own');
  assert.ok(r.agentGot.includes('\x1b[<0;3;2M'), `press reaches the agent: ${JSON.stringify(r.agentGot)}`);
  assert.ok(r.agentGot.includes('\x1b[<32;'), `motion reaches the agent: ${JSON.stringify(r.agentGot)}`);
  assert.ok(r.agentGot.includes('\x1b[<0;20;2m'), `release reaches the agent: ${JSON.stringify(r.agentGot)}`);
  assert.equal(r.inMode, '0', 'tmux stays out of copy-mode');
  assert.equal(r.buffer, '', 'and selects nothing of its own');
});

test('routing: over a pane without the mouse, tmux selects', { skip: !hasTmux && 'no tmux' }, async () => {
  const r = await dragOverStub('release');
  assert.match(r.buffer, /alpha bravo/, `the dragged span is in tmux's buffer: ${JSON.stringify(r.buffer)}`);
  assert.equal(r.agentGot, '', 'the agent hears nothing');
});

// ── contract: the installed agents ─────────────────────────────────────────────

const PROBE = process.env.GLASS_AGENT_PROBE === '1';
const AGENTS = ['claude', 'opencode', 'copilot', 'pi'];
const MOUSE_SWITCHES = ['GLASS_AGENT_MOUSE', 'CLAUDE_CODE_DISABLE_MOUSE', 'OPENCODE_DISABLE_MOUSE'];

// Where an agent puts a selection besides tmux's buffer: the system clipboard
// (opencode and pi on macOS). Read and written only here, put back afterwards.
const CLIP = process.platform === 'darwin' ? { read: ['pbpaste'], write: ['pbcopy'] }
  : whichBin('xclip')
    ? { read: ['xclip', '-selection', 'clipboard', '-o'], write: ['xclip', '-selection', 'clipboard'] } : null;
const clipRead = () => (CLIP ? spawnSync(CLIP.read[0], CLIP.read.slice(1), { encoding: 'utf8' }).stdout || '' : '');
const clipWrite = (text) => { if (CLIP) spawnSync(CLIP.write[0], CLIP.write.slice(1), { input: text }); };

/** A phrase of three or more words on the agent's screen: row (1-based), first and last column. */
function phraseOn(text) {
  const rows = text.split('\n');
  for (let i = 0; i < rows.length; i++) {
    const m = /[A-Za-z]{3,}(?: [A-Za-z][\w.-]*){2,}/.exec(rows[i]);
    if (m && /^[\x20-\x7e─-▟]*$/.test(rows[i].slice(0, m.index))) {
      return { row: i + 1, from: m.index + 1, to: m.index + Math.min(m[0].length, 40), line: rows[i] };
    }
  }
  return null;
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();

// An agent that copies a selection only on a key, as a user would press it:
// Copilot CLI copies on release on macOS and on Ctrl+C elsewhere (its
// `copyOnSelect` setting).
const COPY_KEY = { copilot: 'C-c' };

for (const agent of AGENTS) {
  const bin = PROBE && hasTmux ? whichBin(agentBin(agent)) : null;
  const skip = !PROBE ? 'launches the agent: GLASS_AGENT_PROBE=1' : !hasTmux ? 'no tmux' : !bin && `${agent} not installed`;
  test(`contract: a drag over ${agent} copies what it covered`, { skip, timeout: 90_000 }, async (t) => {
    // The tmux server hands its environment to the agent; a shell inside coding's
    // or glass's tmux may carry a mouse switch, which would decide the answer.
    const env = { ...process.env };
    for (const k of [...MOUSE_SWITCHES, 'TMUX', 'TMUX_PANE']) delete env[k];
    Object.assign(env, agentMouseEnv(agent, env));
    let last = '';
    const ready = (s, text) => {
      // Up, and drawn: a phrase on screen, unchanged since the last look.
      const settled = text === last && phraseOn(text) !== null;
      last = text;
      return settled;
    };
    const saved = clipRead();
    try {
      // One command argument is run by the shell: quoted, so a path with a space
      // (VS Code's copilot shim lives under "Application Support") stays one word.
      await underTmux([`'${bin.replace(/'/g, "'\\''")}'`], { env, ready }, async ({ inner, screen, drag, buffer }) => {
        await sleep(1_000);
        const p = phraseOn(screen());
        assert.ok(p, `a phrase to drag across: ${screen()}`);
        const by = inner.flag('#{mouse_any_flag}') === '1' ? 'the agent' : 'tmux';
        clipWrite('glass-probe-sentinel');
        await drag(p.row, p.from, p.to);
        let copied = '';
        const got = () => { copied = buffer() || (clipRead() !== 'glass-probe-sentinel' ? clipRead() : ''); return copied !== ''; };
        let how = 'on release';
        if (!(await until(got, 5_000)) && COPY_KEY[agent]) {
          how = `on ${COPY_KEY[agent]}`;
          inner.t('send-keys', '-t', 's', COPY_KEY[agent]);
          await until(got, 5_000);
        }
        t.diagnostic(`${agent}: selected by ${by}, copied ${how}: ${JSON.stringify(copied)}`);
        assert.equal(inner.flag('#{pane_in_mode}'), '0', 'tmux is not left in copy-mode');
        assert.ok(squash(copied).length >= 3 && squash(p.line).includes(squash(copied)),
          `${agent} (selected by ${by}): copied ${JSON.stringify(copied)}, a piece of ${JSON.stringify(p.line.trim())} expected`);
      });
    } finally {
      clipWrite(saved);
    }
  });
}
