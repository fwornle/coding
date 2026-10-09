#!/usr/bin/env node
// tests/install-check.mjs — install → measure → uninstall, the way a user does it.
//
//   node tests/install-check.mjs [--tarball <glass-x.y.z.tgz>]
//
// Packs this tree (or takes a release tarball), installs it globally and offline
// into a sandbox (its own HOME, npm prefix, npm cache and temp dir), runs
// `glass <agent>` once per agent with a stand-in agent that sends that agent's
// real wire shape, checks that each call became a token row bound to its run,
// then `glass uninstall --yes` + `npm rm -g glass` and requires HOME to be exactly
// as it was before the install, the temp dir empty and the prefix free of glass.
//
// Upstream is a local stand-in for the user's corporate proxy: glass chains to it
// through HTTPS_PROXY, and it terminates TLS for the model hosts with its own CA
// (NODE_EXTRA_CA_CERTS) and answers like the real APIs. Nothing leaves the machine.
// Exit 0 when every check holds; each failed check is printed.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attachIntercept } from '../proxy/proxy-bridge/intercept.mjs';
import { DEFAULT_INTERCEPT_HOSTS } from '../lib/glass/daemon.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const AGENTS = ['claude', 'copilot', 'opencode', 'pi'];
// The host and wire each stand-in uses — the ones the real agents were measured on (G3).
const WIRE = {
  claude: { path: '/v1/messages' },
  copilot: { host: 'copilot-api.bmw.ghe.com', path: '/v1/messages' },
  opencode: { host: 'api.githubcopilot.com', path: '/chat/completions' },
  pi: { host: 'api.openai.com', path: '/v1/responses' },
};

const failures = [];
const check = (ok, what) => {
  process.stdout.write(`${ok ? '✓' : '✗'} ${what}\n`);
  if (!ok) failures.push(what);
  return ok;
};
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

// ── sandbox ───────────────────────────────────────────────────────────────────
const box = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glass-install-')));
const dirs = Object.fromEntries(['home', 'prefix', 'cache', 'tmp', 'npm-tmp', 'upstream', 'agents'].map((d) => {
  const p = path.join(box, d);
  fs.mkdirSync(p, { recursive: true });
  return [d, p];
}));
// A HOME with the usual furniture, so a write into any of it shows up in the diff.
for (const d of WIN ? ['AppData/Roaming', 'AppData/Local'] : ['.config', '.cache', '.local/share', '.local/state']) {
  fs.mkdirSync(path.join(dirs.home, d), { recursive: true });
}

const baseEnv = { ...process.env };
for (const k of Object.keys(baseEnv)) {
  if (/^(GLASS_|npm_|NPM_CONFIG_|XDG_)|^(HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|ALL_PROXY|ANTHROPIC_|NODE_EXTRA_CA_CERTS|TMUX)/i.test(k)) delete baseEnv[k];
}
const env = {
  ...baseEnv,
  HOME: dirs.home,
  USERPROFILE: dirs.home,
  TMPDIR: dirs.tmp, TEMP: dirs.tmp, TMP: dirs.tmp,
  npm_config_prefix: dirs.prefix,
  npm_config_cache: dirs.cache,
  npm_config_update_notifier: 'false',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  ...(WIN
    ? { APPDATA: path.join(dirs.home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(dirs.home, 'AppData', 'Local') }
    : { XDG_CONFIG_HOME: path.join(dirs.home, '.config'), XDG_CACHE_HOME: path.join(dirs.home, '.cache'),
      XDG_DATA_HOME: path.join(dirs.home, '.local', 'share'), XDG_STATE_HOME: path.join(dirs.home, '.local', 'state') }),
};

/** Every path under `dir` → sha256 of its content (directories → 'dir'). */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p).split(path.sep).join('/');
      if (e.isDirectory()) { out[rel] = 'dir'; walk(p); } else {
        out[rel] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      }
    }
  };
  walk(dir);
  return out;
}

function diff(a, b) {
  const lines = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(k in a)) lines.push(`+ ${k}`);
    else if (!(k in b)) lines.push(`- ${k}`);
    else if (a[k] !== b[k]) lines.push(`~ ${k}`);
  }
  return lines.sort();
}

function run(cmd, args, extra = {}, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...env, ...extra }, cwd: opts.cwd || dirs.home, shell: WIN, windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => resolve({ code: 127, stdout, stderr: String(err) }));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}
const npm = WIN ? 'npm.cmd' : 'npm';
// npm (11+) keeps Node's compile cache in TMPDIR — npm's trace, not glass's: its own temp dir.
const npmTmp = { TMPDIR: dirs['npm-tmp'], TEMP: dirs['npm-tmp'], TMP: dirs['npm-tmp'] };
const show = (r) => `\n${r.stdout}${r.stderr}`.trimEnd();

// ── upstream: the corporate proxy stand-in, answering as the model APIs ──────
const upSeen = [];
function answer(req, res, { host }) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    upSeen.push({ host, path: req.url });
    const json = body ? JSON.parse(body) : {};
    res.setHeader('x-request-id', `up_${upSeen.length}`);
    if (req.url.startsWith('/v1/messages')) {
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_${upSeen.length}` });
      return res.end(JSON.stringify({ id: `m${upSeen.length}`, type: 'message', role: 'assistant', model: json.model,
        content: [{ type: 'text', text: 'pong' }], stop_reason: 'end_turn',
        usage: { input_tokens: 21, output_tokens: 3, cache_read_input_tokens: 400, cache_creation_input_tokens: 50 } }));
    }
    if (req.url.endsWith('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ model: json.model, choices: [{ index: 0, message: { role: 'assistant', content: 'pong' } }],
        usage: { prompt_tokens: 130, completion_tokens: 6, prompt_tokens_details: { cached_tokens: 100 } } }));
    }
    if (req.url.endsWith('/responses')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ model: json.model, output: [], usage: { input_tokens: 60, output_tokens: 5, input_tokens_details: { cached_tokens: 20 } } }));
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end('{}');
  });
}
const upstream = http.createServer((req, res) => { res.writeHead(400); res.end('CONNECT only'); });
const { caPath: upstreamCa, close: closeUpstreamTls } = attachIntercept(upstream, {
  caDir: dirs.upstream, hosts: DEFAULT_INTERCEPT_HOSTS, onRequest: answer,
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

// ── stand-in agents ───────────────────────────────────────────────────────────
// One script; its role comes from STANDIN_AGENT. It makes one model call over the
// wiring glass gave it, the way the real agent does, and prints what happened.
const standIn = path.join(dirs.agents, 'stand-in.mjs');
fs.writeFileSync(standIn, `#!/usr/bin/env node
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
const wire = ${JSON.stringify(WIRE)}[process.env.STANDIN_AGENT];
const body = (agent) => JSON.stringify(agent === 'pi'
  ? { model: 'gpt-5.1', input: 'ping' }
  : agent === 'opencode'
    ? { model: 'claude-haiku-4.5', messages: [{ role: 'user', content: 'ping' }] }
    : { model: 'claude-sonnet-5.5', max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] });
const done = (status, text) => {
  const via = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY).host : process.env.ANTHROPIC_BASE_URL;
  process.stdout.write(JSON.stringify({ agent: process.env.STANDIN_AGENT, task: process.env.GLASS_TASK_ID || null, via, status, args: process.argv.slice(2), text: text.slice(0, 200) }) + '\\n');
  process.exit(status === 200 ? 0 : 1);
};
const agent = process.env.STANDIN_AGENT;
if (agent === 'claude') {
  // ANTHROPIC_BASE_URL + ANTHROPIC_CUSTOM_HEADERS, as Claude Code reads them.
  const headers = { 'content-type': 'application/json', 'x-api-key': 'sk-standin', 'anthropic-version': '2023-06-01' };
  for (const l of (process.env.ANTHROPIC_CUSTOM_HEADERS || '').split('\\n')) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  const r = await fetch(process.env.ANTHROPIC_BASE_URL + wire.path, { method: 'POST', headers, body: body(agent) });
  done(r.status, await r.text());
} else {
  // HTTPS_PROXY with credentials → CONNECT + Proxy-Authorization, then TLS that
  // must verify against the system roots + NODE_EXTRA_CA_CERTS. No agent: with one,
  // https.request ignores createConnection and dials the host itself.
  const proxy = new URL(process.env.HTTPS_PROXY);
  const auth = 'Basic ' + Buffer.from(decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password)).toString('base64');
  const connect = http.request({ host: proxy.hostname, port: proxy.port, method: 'CONNECT', path: wire.host + ':443',
    headers: { host: wire.host + ':443', 'proxy-authorization': auth } });
  connect.on('error', (e) => done(0, String(e)));
  connect.on('connect', (res, socket) => {
    if (res.statusCode !== 200) return done(res.statusCode, 'CONNECT refused');
    const req = https.request({ host: wire.host, path: wire.path, method: 'POST',
      createConnection: () => tls.connect({ socket, servername: wire.host }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer standin' } }, (r) => {
      let t = ''; r.on('data', (c) => { t += c; }); r.on('end', () => done(r.statusCode, t));
    });
    req.on('error', (e) => done(0, String(e)));
    req.end(body(agent));
  });
  connect.end();
}
`);
let agentBin = standIn;
if (WIN) {
  agentBin = path.join(dirs.agents, 'stand-in.cmd');
  fs.writeFileSync(agentBin, `@node "%~dp0stand-in.mjs" %*\r\n`);
} else {
  fs.chmodSync(standIn, 0o755);
}

const freePort = () => new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
const port = await freePort();
const glassEnv = {
  GLASS_PORT: String(port),
  HTTPS_PROXY: upstreamUrl,
  NODE_EXTRA_CA_CERTS: upstreamCa,
  ...Object.fromEntries(AGENTS.map((a) => [`GLASS_${a.toUpperCase()}_BIN`, agentBin])),
};

let exitCode = 1;
try {
  // ── pack ────────────────────────────────────────────────────────────────────
  let tarball = arg('--tarball') && path.resolve(arg('--tarball'));
  if (!tarball) {
    const r = await run(npm, ['pack', '--json', '--pack-destination', box], npmTmp, { cwd: ROOT });
    if (!check(r.code === 0, `npm pack${r.code ? show(r) : ''}`)) throw new Error('pack failed');
    const info = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')))[0];
    tarball = path.join(box, info.filename);
    const paths = info.files.map((f) => f.path);
    check(['undici', 'node-forge'].every((d) => info.bundled.includes(d)), `tarball bundles its dependencies (${info.bundled.join(', ') || 'none'})`);
    check(!paths.some((p) => p.startsWith('tests/') || p.startsWith('.github/')), 'tarball carries no tests or CI files');
    check(paths.includes('ui/index.html') && paths.includes('bin/glass.mjs'), 'tarball carries the CLI and the UI');
    process.stdout.write(`  ${info.filename}: ${(info.size / 1024).toFixed(0)} KB packed, ${info.entryCount} files\n`);
  }

  const before = snapshot(dirs.home);

  // ── install: global, offline (the bundled dependencies need no registry) ───
  const inst = await run(npm, ['install', '--global', '--offline', '--ignore-scripts', tarball], npmTmp);
  check(inst.code === 0, `npm install -g --offline ${path.basename(tarball)}${inst.code ? show(inst) : ''}`);
  const glass = WIN ? path.join(dirs.prefix, 'glass.cmd') : path.join(dirs.prefix, 'bin', 'glass');
  if (!check(fs.existsSync(glass), `glass on the npm prefix (${glass})`)) throw new Error('not installed');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const ver = await run(glass, ['--version']);
  check(ver.stdout.trim() === pkg.version || Boolean(arg('--tarball')), `glass --version → ${ver.stdout.trim()}`);
  const doctor = await run(glass, ['doctor'], glassEnv);
  check(/data home: .*\.glass/.test(doctor.stdout), `glass doctor${show(doctor).split('\n').map((l) => `\n    ${l}`).join('')}`);

  // ── measure: one run per agent ──────────────────────────────────────────────
  const tasks = {};
  for (const agent of AGENTS) {
    const r = await run(glass, [agent, '--no-tmux', 'say', 'pong'], { ...glassEnv, STANDIN_AGENT: agent });
    let seen = null;
    try { seen = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* reported below */ }
    const ok = r.code === 0 && seen?.status === 200 && /^glass-/.test(seen.task || '');
    check(ok, `glass ${agent}: call answered through glass (${seen ? `${seen.status}, ${seen.task}` : 'no output'})${ok ? '' : show(r)}`);
    check(JSON.stringify(seen?.args?.slice(-2)) === '["say","pong"]', `glass ${agent}: arguments passed through`);
    if (seen?.task) tasks[agent] = seen.task;
  }
  check(upSeen.length === AGENTS.length, `upstream saw ${upSeen.length} call(s) via the chained proxy (${upSeen.map((s) => s.host).join(', ')})`);

  const recent = await fetch(`http://127.0.0.1:${port}/api/token-usage/recent?limit=50`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  const rows = recent.data || [];
  for (const agent of AGENTS) {
    const row = rows.find((x) => tasks[agent] && Object.values(x).includes(tasks[agent]));
    check(Boolean(row) && (row.input_tokens > 0 || row.total_tokens > 0), `${agent}: token row bound to ${tasks[agent] || '?'}${row ? ` (in ${row.input_tokens}, out ${row.output_tokens})` : ` — rows: ${JSON.stringify(recent).slice(0, 300)}`}`);
  }

  // ── uninstall ───────────────────────────────────────────────────────────────
  const daemonLog = path.join(dirs.home, '.glass', 'logs', 'daemon.log');
  if (failures.length && fs.existsSync(daemonLog)) process.stdout.write(`--- daemon.log\n${fs.readFileSync(daemonLog, 'utf8')}---\n`);
  const un = await run(glass, ['uninstall', '--yes'], glassEnv);
  check(un.code === 0 && /removed/.test(un.stdout), `glass uninstall --yes${show(un)}`);
  const rm = await run(npm, ['rm', '--global', 'glass'], npmTmp);
  check(rm.code === 0, `npm rm -g glass${rm.code ? show(rm) : ''}`);
  const daemonGone = await fetch(`http://127.0.0.1:${port}/health`).then(() => false, () => true);
  check(daemonGone, 'daemon stopped');

  const residue = diff(before, snapshot(dirs.home));
  check(residue.length === 0, `HOME unchanged after uninstall${residue.map((l) => `\n    ${l}`).join('')}`);
  const tmpLeft = fs.readdirSync(dirs.tmp);
  check(tmpLeft.length === 0, `temp dir empty${tmpLeft.map((l) => `\n    ${l}`).join('')}`);
  const prefixLeft = Object.keys(snapshot(dirs.prefix)).filter((p) => /glass/i.test(p));
  check(prefixLeft.length === 0, `npm prefix free of glass${prefixLeft.map((l) => `\n    ${l}`).join('')}`);
  exitCode = failures.length ? 1 : 0;
} catch (err) {
  check(false, `aborted: ${err.message}`);
} finally {
  closeUpstreamTls();
  upstream.close();
  upstream.closeAllConnections?.();
  if (!process.env.GLASS_KEEP_SANDBOX) fs.rmSync(box, { recursive: true, force: true });
  else process.stdout.write(`sandbox kept: ${box}\n`);
}
process.stdout.write(failures.length ? `\n${failures.length} check(s) failed\n` : `\ninstall → measure → uninstall: all checks passed (${process.platform}, Node ${process.versions.node})\n`);
process.exit(exitCode);
