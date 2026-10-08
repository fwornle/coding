// lib/glass/cli.mjs — the `glass` command.
//
//   glass <claude|copilot|opencode|pi> [--no-intercept] [agent args…]
//   glass status | doctor | stop | uninstall [--yes] | daemon | --version | help
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';

import { glassHome, glassPort, glassPaths, PKG_ROOT } from './home.mjs';
import { AGENTS, sessionEnv } from './wiring.mjs';
import { ensureDaemon, health, openSession, closeSession, listSessions, recentRows, stopDaemon } from './client.mjs';
import { runAgent } from './spawn.mjs';
import { upstreamProxy } from './egress.mjs';

const out = (line = '') => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;
const MIN_COPILOT = [1, 0, 93]; // VS Code's bundled 1.0.81 asks the public host (glass G0/S7)

const HELP = `glass ${VERSION} — token measurement and context insight for coding agents

  glass claude|copilot|opencode|pi [--no-intercept] [args…]   run an agent, measured
  glass status       daemon, live sessions, latest rows
  glass doctor       agent binaries, CA, egress, daemon
  glass stop         stop the daemon (it also exits by itself when idle)
  glass uninstall    stop the daemon and delete ${glassHome()} (asks first; --yes skips)

Data: GLASS_HOME (default ~/.glass). Port: GLASS_PORT (default 12445).
--no-intercept: copilot/opencode/pi run without TLS interception (not measured by the proxy).`;

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

async function runMeasured(agent, argv) {
  const intercept = !argv.includes('--no-intercept');
  const args = argv.filter((a) => a !== '--no-intercept');
  const home = glassHome();
  const port = glassPort();
  const baseEnv = { ...process.env };
  const bin = agentBin(agent);

  const up = await ensureDaemon({ home, port, env: baseEnv });
  const session = up ? await openSession(port, {
    agent, intercept, cwd: process.cwd(), project: projectOf(process.cwd()), pid: process.pid,
  }) : null;
  if (!session) {
    err(`glass: daemon not reachable on 127.0.0.1:${port} — running ${agent} unmeasured (log: ${path.join(glassPaths(home).logs, 'daemon.log')})`);
    return runAgent(bin, args, baseEnv);
  }
  const { env, note } = sessionEnv(agent, baseEnv, {
    port, taskId: session.taskId, token: session.token, caPath: session.caPath, project: projectOf(process.cwd()), intercept,
  });
  if (process.env.GLASS_VERBOSE) err(`glass: ${session.taskId} — ${note}`);
  const code = await runAgent(bin, args, env);
  await closeSession(port, session.token);
  return code;
}

async function status() {
  const port = glassPort();
  const h = await health(port);
  if (!h) {
    out(`glass daemon: not running (port ${port})`);
    return 0;
  }
  out(`glass daemon: running — glass ${h.glass}, pid ${h.pid}, 127.0.0.1:${h.port}, data ${h.data}`);
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
  out(`daemon: ${h ? `running, pid ${h.pid}, ${h.sessions} session(s)` : 'not running (starts with the first glass <agent>)'}`);
  return problems ? 1 : 0;
}

async function uninstall(argv) {
  const home = glassHome();
  await stopDaemon(glassPort());
  if (!fs.existsSync(home)) { out(`nothing to remove (${home} does not exist)`); return 0; }
  if (!argv.includes('--yes')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Delete ${home} (token DB, captures, CA, logs)? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) { out('kept'); return 1; }
  }
  fs.rmSync(home, { recursive: true, force: true });
  out(`removed ${home} — remove the package with: npm rm -g glass`);
  return 0;
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (AGENTS.includes(cmd)) return runMeasured(cmd, rest);
  switch (cmd) {
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
