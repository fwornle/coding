// lib/glass/cli.mjs — the `glass` command.
//
//   glass <claude|copilot|opencode|pi> [--no-intercept] [--no-tmux] [agent args…]
//   glass ui | status | doctor | stop | uninstall [--yes] | daemon | --version | help
//   glass statusline | watch | click <tag> | report <ctx|net>   the status line
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';

import { glassHome, glassPort, glassPaths, PKG_ROOT } from './home.mjs';
import { AGENTS, sessionEnv } from './wiring.mjs';
import {
  ensureDaemon, health, openSession, closeSession, listSessions, recentRows, stopDaemon, statusline as fetchStatusline, contextTurns,
} from './client.mjs';
import { runAgent } from './spawn.mjs';
import { upstreamProxy } from './egress.mjs';
import { coexistWarnings, opencodeHttpProviders } from './coexist.mjs';
import { openUrl } from './open-url.mjs';
import { renderStatusline, renderReport, uiLinks, TAGS } from './statusline.mjs';
import { tmuxWanted, launchInTmux, configureStatus, popup, selfCommand } from './tmux.mjs';

const out = (line = '') => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;
const MIN_COPILOT = [1, 0, 93]; // VS Code's bundled 1.0.81 asks the public host (glass G0/S7)

const HELP = `glass ${VERSION} — token measurement and context insight for coding agents

  glass claude|copilot|opencode|pi [--no-intercept] [--no-tmux] [args…]   run an agent, measured
  glass ui           open the UI (Token Usage, Sessions + context) in the browser
  glass status       daemon, live sessions, latest rows
  glass doctor       agent binaries, CA, egress, daemon, other local proxies
  glass stop         stop the daemon (it also exits by itself when idle)
  glass uninstall    stop the daemon and delete ${glassHome()} (asks first; --yes skips)
  glass watch        a live status line for the newest session (--task <id> for another)

Data: GLASS_HOME (default ~/.glass). Port: GLASS_PORT (default 12445).
--no-intercept: copilot/opencode/pi run without TLS interception (not measured by the proxy).
--no-tmux (or GLASS_NO_TMUX=1): run the agent in this terminal, not in a tmux session with
glass's status line. Without tmux, claude gets the status line as its own statusLine
(GLASS_NO_STATUSLINE=1 turns that off); for the other agents use glass watch in a split.`;

/** The project name a session is filed under: the enclosing git checkout, else the cwd. */
export function projectOf(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return path.basename(dir);
    const up = path.dirname(dir);
    if (up === dir) return path.basename(path.resolve(cwd));
    dir = up;
  }
}

/** The agent's executable: GLASS_<AGENT>_BIN, else its name on PATH. */
export function agentBin(agent, env = process.env) {
  return env[`GLASS_${agent.toUpperCase()}_BIN`] || agent;
}

/** First match of `bin` on PATH (PATHEXT on Windows), or null. */
export function whichBin(bin, env = process.env) {
  if (bin.includes('/') || bin.includes('\\')) return fs.existsSync(bin) ? bin : null;
  const exts = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const cand = path.join(dir, bin + ext);
      try { if (fs.statSync(cand).isFile()) return cand; } catch { /* next */ }
    }
  }
  return null;
}

function versionOf(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15_000, shell: process.platform === 'win32' });
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(`${r.stdout || ''}${r.stderr || ''}`);
  return m ? m.slice(1, 4).map(Number) : null;
}

const older = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Value of `--name <value>` in argv, or undefined. */
function opt(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * Claude Code's own statusLine for this run (no tmux): a settings file passed
 * with --settings, removed afterwards. The user's settings are not edited.
 */
export function claudeStatusSettings(file, { port, taskId }) {
  const [node, bin] = selfCommand();
  const command = `"${node}" "${bin}" statusline --format ansi --port ${port} --task ${taskId}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ statusLine: { type: 'command', command, padding: 0 } }, null, 2)}\n`);
  return file;
}

/**
 * A daemon of this glass version. An older (or newer) one left running after an
 * update is replaced when it has no live session; with sessions it keeps serving
 * them, and this run joins it with a warning.
 */
export async function daemonFor({ home, port, env, version = VERSION, warn = err }) {
  let h = await ensureDaemon({ home, port, env });
  if (h && h.glass !== version) {
    if (!h.sessions) {
      await stopDaemon(port, { waitMs: 10_000 });
      h = await ensureDaemon({ home, port, env });
    } else {
      warn(`glass: the running daemon is glass ${h.glass}, this is ${version} — it keeps serving its ${h.sessions} live session(s) and this one; after they end, glass stop starts ${version} next time`);
    }
  }
  return h;
}

async function runMeasured(agent, argv) {
  const intercept = !argv.includes('--no-intercept');
  const args = argv.filter((a) => a !== '--no-intercept' && a !== '--no-tmux');
  const home = glassHome();
  const port = glassPort();
  const baseEnv = { ...process.env };
  const bin = agentBin(agent);
  const p = glassPaths(home);
  const useTmux = tmuxWanted({ argv, which: whichBin });

  // Outside tmux: run this same command inside a tmux session of its own.
  if (useTmux && !process.env.TMUX) {
    const code = launchInTmux({ agent, args: argv.filter((a) => a !== '--no-tmux'), runDir: p.run });
    if (code !== null) return code;
  }

  // opencode providers on plain HTTP never reach HTTPS_PROXY: the daemon relays them.
  // A provider already on this daemon (a nested glass run) is left as it is.
  const relays = agent === 'opencode' && intercept
    ? Object.fromEntries(Object.entries(opencodeHttpProviders(baseEnv)).filter(([, url]) => !url.startsWith(`http://127.0.0.1:${port}/relay/`)))
    : {};
  const up = await daemonFor({ home, port, env: baseEnv });
  const session = up ? await openSession(port, {
    agent, intercept, cwd: process.cwd(), project: projectOf(process.cwd()), pid: process.pid, relays,
  }) : null;
  if (!session) {
    err(`glass: daemon not reachable on 127.0.0.1:${port} — running ${agent} unmeasured (log: ${path.join(glassPaths(home).logs, 'daemon.log')})`);
    return runAgent(bin, args, baseEnv);
  }
  const { env, note } = sessionEnv(agent, baseEnv, {
    port, taskId: session.taskId, token: session.token, caPath: session.caPath, project: projectOf(process.cwd()), intercept, relays,
  });
  if (process.env.GLASS_VERBOSE) err(`glass: ${session.taskId} — ${note}`);

  let restore = () => {};
  let agentArgs = args;
  let settings = null;
  if (useTmux && process.env.TMUX) {
    restore = configureStatus({ taskId: session.taskId, port, tmpDir: p.run });
  } else if (agent === 'claude' && !process.env.GLASS_NO_STATUSLINE && !args.includes('--settings')) {
    settings = claudeStatusSettings(path.join(p.run, `${session.taskId}.settings.json`), { port, taskId: session.taskId });
    agentArgs = ['--settings', settings, ...args];
  }
  const code = await runAgent(bin, agentArgs, env);
  restore();
  if (settings) fs.rmSync(settings, { force: true });
  await closeSession(port, session.token);
  if (process.env.GLASS_TMUX_EXIT_FILE) {
    try { fs.writeFileSync(process.env.GLASS_TMUX_EXIT_FILE, String(code)); } catch { /* outer gone */ }
  }
  return code;
}

// ── status line ──

async function statuslineCmd(argv) {
  const port = Number(opt(argv, '--port')) || glassPort();
  const format = opt(argv, '--format') || 'plain';
  const task = opt(argv, '--task') || undefined;
  const r = await fetchStatusline(port, task);
  if (r.state === 'none') { out(format === 'tmux' ? '[glass ●] (no live session)' : '[glass ●] no live session'); return 0; }
  out(renderStatusline(r.data, { format, port }));
  return 0;
}

async function waitForKey() {
  if (!process.stdin.isTTY) return;
  process.stdout.write('\n[press any key]');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  await new Promise((r) => process.stdin.once('data', r));
  process.stdin.setRawMode(false);
  process.stdin.pause();
}

async function report(argv) {
  const which = argv[0];
  if (!['ctx', 'net'].includes(which)) { err('glass report: ctx or net'); return 2; }
  const port = Number(opt(argv, '--port')) || glassPort();
  const r = await fetchStatusline(port, opt(argv, '--task'));
  const turns = r.data && which === 'ctx' ? await contextTurns(port, r.data.task_id) : [];
  out(r.state === 'none' ? 'No live glass session.' : renderReport(TAGS[which], { d: r.data, turns, port, caPath: r.data?.ca_path }));
  if (argv.includes('--hold')) await waitForKey();
  return 0;
}

/** A status-line click (tmux run-shell): open the UI, or a report in a popup. */
async function click(argv) {
  const tag = argv[0];
  const port = Number(opt(argv, '--port')) || glassPort();
  const task = opt(argv, '--task') || undefined;
  const links = uiLinks(port, task);
  // Any open glass UI tab is re-used and navigated (macOS), as coding's
  // dashboards are: the origin is the reuse prefix.
  const origin = links.root;
  if (tag === TAGS.health) return (await openUrl(links.root, origin)) ? 0 : 1;
  if (tag === TAGS.tok) return (await openUrl(links.session, origin)) ? 0 : 1;
  if (tag === TAGS.ctx || tag === TAGS.net) {
    const which = tag === TAGS.ctx ? 'ctx' : 'net';
    const shown = popup({
      client: opt(argv, '--client'), pane: opt(argv, '--pane'),
      title: which === 'ctx' ? 'glass · context window' : 'glass · network',
      argv: [...selfCommand(), 'report', which, '--port', String(port), ...(task ? ['--task', task] : []), '--hold'],
    });
    if (!shown && which === 'ctx') return (await openUrl(links.explain, origin)) ? 0 : 1;
    return shown ? 0 : 1;
  }
  err(`glass click: unknown field ${tag}`);
  return 2;
}

/** A live one-line status bar in this terminal (no tmux: a split pane next to the agent). */
async function watch(argv) {
  const port = Number(opt(argv, '--port')) || glassPort();
  const task = opt(argv, '--task') || undefined;
  const format = process.stdout.isTTY ? 'ansi' : 'plain';
  let stop = false;
  process.on('SIGINT', () => { stop = true; });
  process.stdout.on('error', () => { stop = true; }); // the reader went away (a closed split, `| head`)
  while (!stop) {
    const r = await fetchStatusline(port, task);
    const line = r.state === 'ok' ? renderStatusline(r.data, { format, port })
      : r.state === 'none' ? '[glass ●] waiting for a session…' : renderStatusline(null, { format, port });
    if (process.stdout.isTTY) process.stdout.write(`\r\x1b[2K${line}`);
    else out(line);
    for (let i = 0; i < 10 && !stop; i++) await new Promise((res) => setTimeout(res, 200));
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  return 0;
}

async function ui() {
  const home = glassHome();
  const port = glassPort();
  if (!(await daemonFor({ home, port, env: { ...process.env } }))) {
    err(`glass: daemon not reachable on 127.0.0.1:${port} (log: ${path.join(glassPaths(home).logs, 'daemon.log')})`);
    return 1;
  }
  const url = `http://127.0.0.1:${port}/`;
  out(url);
  if (!(await openUrl(url, url))) err('glass: no browser opener found — open the URL above yourself');
  return 0;
}

async function status() {
  const port = glassPort();
  const h = await health(port);
  if (!h) {
    out(`glass daemon: not running (port ${port})`);
    return 0;
  }
  out(`glass daemon: running — glass ${h.glass}, pid ${h.pid}, 127.0.0.1:${h.port}, data ${h.data}`);
  if (h.glass !== VERSION) out(`  ! this glass is ${VERSION} — the daemon is replaced once it has no live session (glass stop)`);
  const sessions = (await listSessions(port)) || [];
  out(`live sessions: ${sessions.length}`);
  for (const s of sessions) out(`  ${s.taskId}  ${s.agent}${s.intercept ? '' : ' (no intercept)'}  ${s.project}  since ${s.started_at}`);
  const rows = (await recentRows(port, 8)) || [];
  out(`latest rows: ${rows.length ? '' : '(none)'}`);
  for (const r of rows) {
    out(`  ${r.timestamp}  ${String(r.agent || '').padEnd(8)} ${String(r.model || '').padEnd(24)} in ${r.input_tokens} out ${r.output_tokens} cache ${r.cache_read_tokens || 0}/${r.cache_write_tokens || 0}  ${r.task_id || '(unbound)'}`);
  }
  return 0;
}

async function doctor() {
  const home = glassHome();
  const port = glassPort();
  const p = glassPaths(home);
  let problems = 0;
  out(`glass ${VERSION} on Node ${process.version} (${process.platform})`);
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) { out('  ✗ Node >= 22.13 required (node:sqlite)'); problems++; }
  out(`data home: ${home}`);
  out(`interception CA: ${fs.existsSync(path.join(p.ca, 'ca.pem')) ? path.join(p.ca, 'ca.pem') : '(created on first daemon start)'}`);
  out(`egress proxy: ${upstreamProxy(process.env, port) || '(direct)'}`);
  for (const agent of AGENTS) {
    const bin = whichBin(agentBin(agent));
    if (!bin) { out(`  - ${agent}: not found on PATH`); continue; }
    const v = versionOf(bin);
    let line = `  ✓ ${agent}: ${bin}${v ? ` (${v.join('.')})` : ''}`;
    if (agent === 'copilot' && v && older(v, MIN_COPILOT) < 0) {
      line = `  ✗ copilot: ${bin} (${v.join('.')}) — below ${MIN_COPILOT.join('.')}: it calls the public Copilot host; put the npm @github/copilot CLI first on PATH`;
      problems++;
    }
    out(line);
  }
  const h = await health(port);
  out(`daemon: ${h ? `running, glass ${h.glass}, pid ${h.pid}, ${h.sessions} session(s)` : 'not running (starts with the first glass <agent>)'}`);
  if (h && h.glass !== VERSION) out(`  ! daemon is glass ${h.glass}, this is ${VERSION} — it is replaced once it has no live session (glass stop)`);
  // Warnings, not problems: glass still runs, it just measures less (or twice).
  const warnings = coexistWarnings({ port });
  if (warnings.length) out('warnings (glass runs, but measures less or twice):');
  for (const w of warnings) out(`  ! ${w}`);
  return problems ? 1 : 0;
}

async function uninstall(argv) {
  const home = glassHome();
  await stopDaemon(glassPort(), { waitMs: 10_000 });
  if (!fs.existsSync(home)) { out(`nothing to remove (${home} does not exist)`); return 0; }
  if (!argv.includes('--yes')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Delete ${home} (token DB, captures, CA, logs)? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) { out('kept'); return 1; }
  }
  // Retries: on Windows an antivirus scan or a just-exited process can hold a file briefly.
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  out(`removed ${home} — remove the package with: npm rm -g glass`);
  return 0;
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  // A reader that went away (`glass status | head`) ends the output, not with a crash.
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });
  if (AGENTS.includes(cmd)) return runMeasured(cmd, rest);
  switch (cmd) {
    case 'ui': return ui();
    case 'statusline': return statuslineCmd(rest);
    case 'report': return report(rest);
    case 'click': return click(rest);
    case 'watch': return watch(rest);
    case 'status': return status();
    case 'doctor': return doctor();
    case 'stop': {
      const stopped = await stopDaemon(glassPort());
      out(stopped ? 'glass daemon stopping' : 'glass daemon was not running');
      return 0;
    }
    case 'uninstall': return uninstall(rest);
    case '--version': case '-v': out(VERSION); return 0;
    case undefined: case 'help': case '--help': case '-h': out(HELP); return 0;
    default:
      err(`glass: unknown command "${cmd}"\n\n${HELP}`);
      return 2;
  }
}
