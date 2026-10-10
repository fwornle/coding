// lib/glass/tmux.mjs — the clickable status line where tmux exists.
//
// tmux is optional and never installed by glass (decision 5). With it (and a
// terminal), `glass <agent>` runs the agent in a tmux session of its own:
//
//   outer  glass claude …   → tmux new-session -d (argv, no shell) running
//                             `glass claude …` again, then attach; the agent's
//                             exit code comes back through a file
//   inner  glass claude …   → $TMUX is set: measured run as usual, with this
//                             session's status bar pointed at its task
//
// Started inside a tmux session the user already has, glass configures that
// session for the run and puts its options back afterwards.
//
// Clicks: one root binding for MouseDown1Status (key tables are server-wide). It
// handles glass's `g:*` ranges in a session that carries @glass_task and hands
// everything else to whatever was bound before — a coding session on the same
// tmux server keeps its own clickable fields.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { PKG_ROOT } from './home.mjs';

const SESSION_OPTIONS = ['status', 'status-interval', 'status-style', 'status-right', 'status-right-length', 'mouse', '@glass_task', '@glass_port'];
// Marks glass's binding in list-keys output (coding's binding names bin/statusline-click).
const MARK = '--src glass-tmux';

function tmux(args, opts = {}) {
  return spawnSync('tmux', args, { encoding: 'utf8', ...opts });
}

/**
 * Should `glass <agent>` run inside tmux? Not on native Windows, not without a
 * terminal, not when asked not to, and only if tmux is on PATH.
 */
export function tmuxWanted({ argv, env = process.env, platform = process.platform, tty = Boolean(process.stdin.isTTY && process.stdout.isTTY), which }) {
  if (platform === 'win32' || !tty) return false;
  if (argv.includes('--no-tmux') || env.GLASS_NO_TMUX) return false;
  return Boolean(env.TMUX) || Boolean(which('tmux'));
}

/** The `glass` invocation that tmux and Claude Code run: this node, this package's entry point. */
export function selfCommand() {
  return [process.execPath, path.join(PKG_ROOT, 'bin', 'glass.mjs')];
}

/** Environment for the inner run: everything the user has, minus tmux's own. */
export function innerEnv(env) {
  const out = [];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || k === 'TMUX' || k === 'TMUX_PANE') continue;
    out.push('-e', `${k}=${v}`);
  }
  return out;
}

/**
 * Outer run: start a detached tmux session running `glass <agent> <args>`, attach,
 * and return the agent's exit code.
 */
export function launchInTmux({ agent, args, env = process.env, cwd = process.cwd(), runDir }) {
  const name = `glass-${agent}-${crypto.randomBytes(2).toString('hex')}`;
  fs.mkdirSync(runDir, { recursive: true });
  const exitFile = path.join(runDir, `${name}.exit`);
  const [node, bin] = selfCommand();
  const cols = process.stdout.columns || 200;
  const rows = process.stdout.rows || 50;
  const created = tmux([
    'new-session', '-d', '-s', name, '-c', cwd, '-x', String(cols), '-y', String(rows),
    ...innerEnv({ ...env, GLASS_TMUX_EXIT_FILE: exitFile, GLASS_TMUX_OWNED: '1' }),
    '--', node, bin, agent, ...args,
  ]);
  if (created.status !== 0) {
    process.stderr.write(`glass: tmux new-session failed (${(created.stderr || '').trim()}) — running without tmux\n`);
    return null;
  }
  tmux(['attach-session', '-t', `=${name}`], { stdio: 'inherit' });
  let code = 0;
  try { code = Number(fs.readFileSync(exitFile, 'utf8').trim()) || 0; } catch { /* detached, or killed */ }
  fs.rmSync(exitFile, { force: true });
  return code;
}

/** A value quoted for a tmux command line ('…', with ' escaped). */
const tq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/** The status-right command: re-rendered by tmux every status-interval seconds. */
export function statusCommand(port) {
  const [node, bin] = selfCommand();
  return `#(${tq(node)} ${tq(bin)} statusline --format tmux --port ${port} --task '#{@glass_task}' 2>/dev/null || echo '[glass ?]')`;
}

/**
 * The MouseDown1Status binding: glass's ranges in a glass session → `glass click`,
 * anything else → the previous binding (tmux's default: switch to the clicked window).
 */
export function clickBinding(previous) {
  const [node, bin] = selfCommand();
  const run = `run-shell -b "'${node}' '${bin}' click '#{mouse_status_range}' --task '#{@glass_task}' --port '#{@glass_port}' --client '#{client_name}' --pane '#{pane_id}' ${MARK}"`;
  const fallback = previous && previous.trim() ? previous.trim() : 'switch-client -t =';
  return `bind-key -T root MouseDown1Status if-shell -F "#{&&:#{@glass_task},#{m:g:*,#{mouse_status_range}}}" { ${run} } { ${fallback} }\n`;
}

/** What MouseDown1Status runs now, without the `bind-key -T root MouseDown1Status` head. */
export function currentClickCommand() {
  const r = tmux(['list-keys', '-T', 'root', 'MouseDown1Status']);
  const line = (r.stdout || '').split('\n').find((l) => /MouseDown1Status/.test(l)) || '';
  return line.replace(/^bind-key\s+(?:-r\s+)?-T\s+root\s+MouseDown1Status\s+/, '');
}

function bindClicks(tmpDir) {
  const previous = currentClickCommand();
  if (previous.includes(MARK)) return; // already glass's (it keeps the original as fallback)
  const snippet = path.join(tmpDir, `glass-click-${process.pid}.tmux`);
  fs.writeFileSync(snippet, clickBinding(previous));
  tmux(['source-file', snippet]);
  fs.rmSync(snippet, { force: true });
}

/**
 * Inner run, inside tmux: point this session's status bar at `taskId`.
 * @returns {() => void} puts the session's own options back (no-op for a session glass owns)
 */
export function configureStatus({ taskId, port, env = process.env, tmpDir = os.tmpdir() }) {
  const session = tmux(['display-message', '-p', '#{session_id}']).stdout?.trim();
  if (!session) return () => {};
  const saved = {};
  for (const o of SESSION_OPTIONS) {
    const r = tmux(['show-options', '-q', '-v', '-t', session, o]);
    saved[o] = r.status === 0 && r.stdout !== '' ? r.stdout.replace(/\n$/, '') : null;
  }
  const set = (o, v) => tmux(['set-option', '-t', session, o, v]);
  set('@glass_task', taskId);
  set('@glass_port', String(port));
  set('status', 'on');
  set('status-interval', '5');
  set('status-right-length', '120');
  // The terminal's own colours, as coding's session wrapper sets them — not the
  // global status-style (tmux's default, and many configs, paint it green).
  set('status-style', 'bg=default,fg=default');
  set('status-right', statusCommand(port));
  set('mouse', 'on');
  bindClicks(tmpDir);
  if (env.GLASS_TMUX_OWNED) return () => {};
  return () => {
    for (const [o, v] of Object.entries(saved)) {
      if (v === null) tmux(['set-option', '-u', '-t', session, o]);
      else tmux(['set-option', '-t', session, o, v]);
    }
  };
}

/** A report in a popup over the clicked pane (tmux ≥ 3.2). */
export function popup({ client, pane, argv, title }) {
  const r = tmux(['display-popup', '-E', '-w', '90%', '-h', '80%', '-T', ` ${title} `,
    ...(client ? ['-c', client] : []), ...(pane ? ['-t', pane] : []), '--', ...argv]);
  return r.status === 0;
}
