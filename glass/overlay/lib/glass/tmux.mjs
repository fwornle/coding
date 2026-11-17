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

/** An agent that ends sooner than this after starting most likely failed to start. */
export const QUICK_EXIT_MS = 5000;

/**
 * Inner run in a session glass owns: when the agent ended within
 * QUICK_EXIT_MS, hold the pane until Enter. The session closes with its last
 * pane, so without this an agent that fails at startup takes its own error
 * message with it and the outer terminal shows only tmux's `[exited]`.
 * @returns {Promise<boolean>} whether it held
 */
export function holdQuickExit({ agent, code, elapsedMs, env = process.env, stdin = process.stdin, stderr = process.stderr }) {
  if (!env.GLASS_TMUX_OWNED || elapsedMs >= QUICK_EXIT_MS || !stdin.isTTY) return Promise.resolve(false);
  stderr.write(`\nglass: ${agent} exited after ${(elapsedMs / 1000).toFixed(1)}s (code ${code}) — its output is above. Press Enter to close.\n`);
  return new Promise((resolve) => {
    const done = () => { stdin.off('data', onData); stdin.pause(); if (stdin.setRawMode) stdin.setRawMode(false); resolve(true); };
    const onData = (buf) => { if (/[\r\n\x03\x04]/.test(String(buf))) done(); };
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
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
  sourceSnippet(tmpDir, 'click', clickBinding(previous));
}

// Bindings chain commands with ';' and braces, which survive only in a sourced
// file: a ';' handed to `tmux bind-key` as an argument ends the bind-key.
function sourceSnippet(tmpDir, name, text) {
  const snippet = path.join(tmpDir, `glass-${name}-${process.pid}.tmux`);
  fs.writeFileSync(snippet, text);
  tmux(['source-file', snippet]);
  fs.rmSync(snippet, { force: true });
}

// ── Selecting text with the mouse ─────────────────────────────────────────────
// The clickable status line needs `mouse on`, which hands the mouse to tmux. A
// drag then has to reach whoever makes the selection, and coding's session
// wrapper does the same (scripts/tmux-session-wrapper.sh).
//
// Claude Code, opencode, pi and Copilot CLI run full-screen, hold the mouse
// (DECSET 1002/1003) and select by themselves: drag, double/triple click,
// auto-scroll past the viewport, copy to the clipboard. Their selection follows
// their layout — no opencode sidebar, no Copilot scrollbar, no frame glyphs. So
// a drag goes to the agent whenever the pane holds the mouse. tmux's copy-mode
// over them would select whole screen rows, panels included, and switch the
// terminal from 1003 to 1002 mid-gesture, after which the terminal stops
// reporting the motion (a 30-column drag copied 6 bytes).
//
// The bindings below make that choice on #{mouse_any_flag}, copy a tmux
// selection (a pane without the mouse) to the clipboard — tmux's defaults stop
// at its buffer — and hand the wheel to an agent started with its mouse off as
// PageUp / PageDown.
//
// prefix + S switches the mouse off for the session: the terminal's own
// selection (scrollback, survives repaints) at the price of status-line clicks.

/**
 * The agent's environment under tmux. Agents keep their mouse and select by
 * themselves; GLASS_AGENT_MOUSE=off starts Claude Code and opencode with theirs
 * off (pi and Copilot have no such switch), for tmux's selection instead. A
 * value set for either switch is left alone.
 */
export function agentMouseEnv(agent, env = process.env) {
  if (env.GLASS_AGENT_MOUSE !== 'off') return {};
  const key = { claude: 'CLAUDE_CODE_DISABLE_MOUSE', opencode: 'OPENCODE_DISABLE_MOUSE' }[agent];
  return key && !env[key] ? { [key]: '1' } : {};
}

/** The command a finished selection is piped to, or '' (then tmux's buffer and OSC 52 only). */
export function clipboardCommand(which) {
  for (const c of ['pbcopy', 'wl-copy', 'xclip -selection clipboard', 'xsel --clipboard --input', 'clip.exe']) {
    if (which(c.split(' ')[0])) return c;
  }
  return '';
}

/**
 * Each selection binding: the table and key, when the current binding may be
 * replaced (tmux's default, or nothing), and glass's line. A binding the user
 * changed is left as it is. Replaceable too: a drag-to-copy-mode line glass and
 * coding bound earlier (`if-shell -F "#{pane_in_mode}"`), which takes the drag
 * from an agent that holds the mouse.
 */
export function mouseCopyBindings(copy) {
  const pipe = copy ? ` "${copy}"` : '';
  const toAgent = '#{||:#{pane_in_mode},#{mouse_any_flag}}';
  const isDefaultSelect = (cur) => cur.includes('mouse_any_flag') || cur.includes('if-shell -F "#{pane_in_mode}"');
  const isDefaultWheel = (cur) => cur.includes('mouse_any_flag') && !cur.includes('PageUp') && !cur.includes('PageDown');
  const isDefaultDragEnd = (cur) => /^send-keys -X copy-pipe-and-cancel\s*$/.test(cur.trim());
  return [
    { table: 'root', key: 'MouseDrag1Pane', replace: isDefaultSelect,
      line: `bind-key -T root MouseDrag1Pane if-shell -F "${toAgent}" { send-keys -M } { copy-mode -M }` },
    { table: 'root', key: 'DoubleClick1Pane', replace: isDefaultSelect,
      line: `bind-key -T root DoubleClick1Pane { select-pane -t = ; if-shell -F "${toAgent}" { send-keys -M } { copy-mode -H ; send-keys -X select-word ; run-shell -d 0.3 ; send-keys -X copy-pipe-and-cancel${pipe} } }` },
    { table: 'root', key: 'TripleClick1Pane', replace: isDefaultSelect,
      line: `bind-key -T root TripleClick1Pane { select-pane -t = ; if-shell -F "${toAgent}" { send-keys -M } { copy-mode -H ; send-keys -X select-line ; run-shell -d 0.3 ; send-keys -X copy-pipe-and-cancel${pipe} } }` },
    { table: 'root', key: 'WheelUpPane', replace: isDefaultWheel,
      line: 'bind-key -T root WheelUpPane if-shell -F "#{||:#{pane_in_mode},#{mouse_any_flag}}" { send-keys -M } { if-shell -F "#{alternate_on}" { send-keys PageUp } { copy-mode -e } }' },
    { table: 'root', key: 'WheelDownPane', replace: isDefaultWheel,
      line: 'bind-key -T root WheelDownPane if-shell -F "#{||:#{pane_in_mode},#{mouse_any_flag}}" { send-keys -M } { if-shell -F "#{alternate_on}" { send-keys PageDown } { send-keys -M } }' },
    { table: 'copy-mode', key: 'MouseDragEnd1Pane', replace: isDefaultDragEnd,
      line: `bind-key -T copy-mode MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel${pipe}` },
    { table: 'copy-mode-vi', key: 'MouseDragEnd1Pane', replace: isDefaultDragEnd,
      line: `bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel${pipe}` },
    { table: 'prefix', key: 'S', replace: () => false,
      line: 'bind-key -T prefix S { if-shell -F "#{mouse}" { set-option mouse off ; display-message -d 2500 "mouse OFF: the terminal\'s own selection. Status-line clicks are off. prefix+S restores." } { set-option mouse on ; display-message -d 2500 "mouse ON: drag selects to the clipboard, the status line is clickable. prefix+S for the terminal\'s own selection." } }' },
  ];
}

/** What `table key` runs now, '' when unbound. */
function currentBinding(table, key) {
  const r = tmux(['list-keys', '-T', table, key]);
  const line = (r.status === 0 ? r.stdout : '').split('\n').find((l) => l.includes(` ${key} `)) || '';
  // A literal pattern, then compare: table and key never become regex source.
  const m = /^bind-key\s+(?:-r\s+)?-T\s+(\S+)\s+(\S+)\s+/.exec(line);
  return m && m[1] === table && m[2] === key ? line.slice(m[0].length) : line;
}

function bindMouseCopy(tmpDir, which) {
  const lines = mouseCopyBindings(clipboardCommand(which))
    .filter((b) => { const cur = currentBinding(b.table, b.key); return cur === '' || b.replace(cur); })
    .map((b) => `${b.line}\n`);
  if (lines.length) sourceSnippet(tmpDir, 'mouse', lines.join(''));
}

const onPath = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0;

/**
 * Inner run, inside tmux: point this session's status bar at `taskId`.
 * @returns {() => void} puts the session's own options back (no-op for a session glass owns)
 */
export function configureStatus({ taskId, port, env = process.env, tmpDir = os.tmpdir(), which = onPath }) {
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
  bindMouseCopy(tmpDir, which);
  if (env.GLASS_TMUX_OWNED) return () => {};
  return () => {
    for (const [o, v] of Object.entries(saved)) {
      if (v === null) tmux(['set-option', '-u', '-t', session, o]);
      else tmux(['set-option', '-t', session, o, v]);
    }
  };
}

/** A one-line message on the clicked client's status line. */
export function message({ client, text }) {
  return tmux(['display-message', ...(client ? ['-c', client] : []), '-d', '8000', text]).status === 0;
}

/** A report in a popup over the clicked pane (tmux ≥ 3.2). */
export function popup({ client, pane, argv, title }) {
  const r = tmux(['display-popup', '-E', '-w', '90%', '-h', '80%', '-T', ` ${title} `,
    ...(client ? ['-c', client] : []), ...(pane ? ['-t', pane] : []), '--', ...argv]);
  return r.status === 0;
}
