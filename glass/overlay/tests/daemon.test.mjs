// tests/daemon.test.mjs — glass's daemon, wiring and CLI against a fake upstream.
//
// In-process: the daemon with an injected fetch that sends every https://<host>
// upstream call to a local stub, so each agent's wire shape is measured end to
// end — claude via the base URL, copilot / opencode / pi via interception (a real
// CONNECT + TLS handshake verified against glass's CA, the session token as
// Proxy-Authorization). Out of process: the `glass` CLI with a stand-in agent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'glass.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-test-'));
const { daemonEnv } = await import('../lib/glass/home.mjs');
Object.assign(process.env, daemonEnv(home));
for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete process.env[k];
const { startDaemon } = await import('../lib/glass/daemon.mjs');
const { sessionEnv, withHeaders } = await import('../lib/glass/wiring.mjs');
const { cmdQuote } = await import('../lib/glass/spawn.mjs');

const sse = (events, named) => events.map((e) => (named ? `event: ${e.type}\n` : '') + `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
const ANTHROPIC_SSE = sse([
  { type: 'message_start', message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pong' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
  { type: 'message_stop' },
], true);
const CHAT_USAGE = { prompt_tokens: 120, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 100 } };

let upstream; let upPort; let daemon; const upSeen = []; let reqSeq = 0;

function respond(req, body, res) {
  const host = req.headers['x-test-host'] || 'direct';
  const json = body ? JSON.parse(body) : {};
  reqSeq += 1;
  if (req.url.startsWith('/v1/messages')) {
    if (json.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': `req_${reqSeq}` });
      return res.end(ANTHROPIC_SSE);
    }
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_${reqSeq}` });
    return res.end(JSON.stringify({ id: 'm2', model: 'claude-sonnet-5.5', content: [{ type: 'text', text: 'pong' }], usage: { input_tokens: 33, output_tokens: 4, cache_read_input_tokens: 16 } }));
  }
  if (req.url.endsWith('/chat/completions')) {
    if (json.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': `oa_${reqSeq}` });
      const ev = [{ model: json.model, choices: [{ index: 0, delta: { content: 'pong' } }] }];
      if (json.stream_options?.include_usage) ev.push({ model: json.model, choices: [], usage: CHAT_USAGE });
      return res.end(sse([...ev, '[DONE]']));
    }
    res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': `oa_${reqSeq}` });
    return res.end(JSON.stringify({ model: json.model, choices: [{ index: 0, message: { role: 'assistant', content: 'pong' } }], usage: CHAT_USAGE }));
  }
  if (req.url.endsWith('/responses')) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': `rs_${reqSeq}` });
    return res.end(sse([{ type: 'response.completed', response: { model: 'gpt-5.1', usage: { input_tokens: 50, output_tokens: 4, input_tokens_details: { cached_tokens: 30 } } } }], true));
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  return res.end(JSON.stringify({ host, path: req.url }));
}

// Upstream fetch for the in-process daemon: https://<host>/… → the stub, host in a header.
const stubFetch = (url, init = {}) => {
  const u = new URL(url);
  if (u.protocol === 'http:') return fetch(url, init);
  return fetch(`http://127.0.0.1:${upPort}${u.pathname}${u.search}`, { ...init, headers: { ...init.headers, 'x-test-host': u.hostname } });
};

before(async () => {
  upstream = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    upSeen.push({ method: req.method, url: req.url, headers: req.headers, body });
    respond(req, body, res);
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  upPort = upstream.address().port;
  daemon = await startDaemon({ home, port: 0, fetch: stubFetch, log: () => {} });
});

after(async () => {
  await daemon?.close();
  await new Promise((r) => upstream.close(r));
  fs.rmSync(home, { recursive: true, force: true });
});

const api = async (method, route, body) => {
  const res = await fetch(`${daemon.url}${route}`, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const recent = async () => (await api('GET', '/api/token-usage/recent?limit=50&scope=both')).body.data;
const rowsFor = async (taskId) => (await recent()).filter((r) => r.task_id === taskId);
const settle = () => new Promise((r) => setTimeout(r, 150));

// An intercepted HTTPS request: CONNECT with the session token, TLS verified against glass's CA.
function intercepted({ host, token, method = 'POST', route, body }) {
  return new Promise((resolve, reject) => {
    const c = http.request({
      host: '127.0.0.1', port: daemon.port, method: 'CONNECT', path: `${host}:443`,
      headers: { 'proxy-authorization': `Basic ${Buffer.from(`glass:${token}`).toString('base64')}` },
    });
    c.once('connect', (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error(`CONNECT ${res.statusCode}`));
      const s = tls.connect({ socket, servername: host, ca: fs.readFileSync(daemon.caPath) });
      const r = http.request({
        host, method, path: route, createConnection: () => s,
        headers: { host, 'content-type': 'application/json', authorization: 'Bearer agent-own-login' },
      }, (resp) => {
        let text = '';
        resp.on('data', (d) => { text += d; });
        resp.on('end', () => resolve({ status: resp.statusCode, text }));
      });
      r.on('error', reject);
      r.end(body ? JSON.stringify(body) : undefined);
    });
    c.once('error', reject);
    c.end();
  });
}

const open = async (agent, extra = {}) => (await api('POST', '/sessions', { agent, cwd: '/w/glass', project: 'glass', ...extra })).body;
const msgs = [{ role: 'user', content: 'ping' }];

test('health, sessions open with a task id + token + the CA', async () => {
  const h = await api('GET', '/health');
  assert.equal(h.body.ok, true);
  const s = await open('claude');
  assert.match(s.taskId, /^glass-claude-\d{8}-\d{6}-[0-9a-f]{6}$/);
  assert.ok(s.token.length >= 20);
  assert.ok(fs.existsSync(s.caPath));
  const list = (await api('GET', '/sessions')).body.sessions;
  assert.ok(list.some((x) => x.taskId === s.taskId && !('token' in x)), 'tokens are never listed');
  assert.equal((await api('POST', '/sessions', { agent: 'codex' })).status, 400);
});

test('claude via the base URL: forwarded, row + context turn under the session task', async () => {
  const s = await open('claude');
  const res = await fetch(`${daemon.url}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'sk-user-own', 'x-task-id': s.taskId, 'x-agent': 'claude', 'x-project': 'glass', 'x-glass-upstream': `http://127.0.0.1:${upPort}` },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 8, stream: true, messages: msgs }),
  });
  assert.match(await res.text(), /message_stop/);
  await settle();
  const up = upSeen.at(-1);
  assert.equal(up.headers['x-api-key'], 'sk-user-own', 'the user\'s own key is forwarded');
  assert.equal(up.headers['x-glass-upstream'], undefined, 'the glass header stays local');
  const [row] = await rowsFor(s.taskId);
  assert.equal(row.agent, 'claude');
  assert.equal(row.provider, 'anthropic');
  assert.equal(row.input_tokens, 12);
  assert.equal(row.output_tokens, 9);
  assert.equal(row.cache_read_tokens, 300);
  const turns = (await api('GET', `/api/context-turns?task_id=${s.taskId}`)).body.contextTurns;
  assert.equal(turns.length, 1);
});

test('copilot via interception: Anthropic wire to copilot-api.<tenant>.ghe.com, own login forwarded', async () => {
  const s = await open('copilot');
  const r = await intercepted({ host: 'copilot-api.acme.ghe.com', token: s.token, route: '/v1/messages', body: { model: 'claude-sonnet-5.5', max_tokens: 8, messages: msgs } });
  assert.equal(r.status, 200);
  await settle();
  const up = upSeen.at(-1);
  assert.equal(up.headers['x-test-host'], 'copilot-api.acme.ghe.com');
  assert.equal(up.headers.authorization, 'Bearer agent-own-login');
  const [row] = await rowsFor(s.taskId);
  assert.equal(row.agent, 'copilot');
  assert.equal(row.user_hash, 'copadt');
  assert.equal(row.provider, 'github-copilot');
  assert.equal(row.subscription, '');
  assert.equal(row.input_tokens, 33);
  assert.equal((await api('GET', `/api/context-breakdown?task_id=${s.taskId}`)).status, 200);
  assert.equal((await api('GET', `/api/context-turns?task_id=${s.taskId}`)).body.contextTurns.length, 1);
});

test('opencode via interception: chat SSE (usage requested) and Responses SSE', async () => {
  const s = await open('opencode');
  const a = await intercepted({ host: 'api.githubcopilot.com', token: s.token, route: '/chat/completions', body: { model: 'claude-haiku-4.5', stream: true, messages: msgs } });
  assert.match(a.text, /\[DONE\]/);
  await settle();
  assert.deepEqual(JSON.parse(upSeen.at(-1).body).stream_options, { include_usage: true });
  await intercepted({ host: 'api.githubcopilot.com', token: s.token, route: '/responses', body: { model: 'gpt-5.1', input: [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }] } });
  await settle();
  const rows = await rowsFor(s.taskId);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.agent === 'opencode' && r.user_hash === 'opcadt'));
  assert.deepEqual(rows.map((r) => r.input_tokens).sort(), [20, 20]);
  assert.equal((await api('GET', `/api/context-turns?task_id=${s.taskId}`)).body.contextTurns.length, 2);
});

test('pi via interception: chat JSON; a non-model path is forwarded but never tapped', async () => {
  const s = await open('pi');
  await intercepted({ host: 'api.openai.com', token: s.token, route: '/v1/chat/completions', body: { model: 'gpt-4o-mini', messages: msgs } });
  const other = await intercepted({ host: 'api.openai.com', token: s.token, method: 'GET', route: '/v1/models' });
  assert.deepEqual(JSON.parse(other.text), { host: 'api.openai.com', path: '/v1/models' });
  await settle();
  const rows = await rowsFor(s.taskId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agent, 'pi');
  assert.equal(rows[0].provider, 'openai');
});

test('closing a session archives its span', async () => {
  const s = await open('copilot');
  const closed = await api('DELETE', `/sessions/${encodeURIComponent(s.token)}`);
  assert.equal(closed.status, 200);
  assert.equal(closed.body.task_id, s.taskId);
  assert.equal(closed.body.adapters, 'skipped (intercepted)', 'intercepted calls are all on the wire');
  const file = path.join(home, 'data', 'measurements', `${s.taskId}.json`);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).meta.source, 'glass');
  assert.equal((await api('DELETE', `/sessions/${encodeURIComponent(s.token)}`)).status, 404);
});

test('an idle daemon exits by itself', async () => {
  const idleHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-idle-'));
  const d = await startDaemon({ home: idleHome, port: 0, fetch: stubFetch, idleMs: 100, tickMs: 25, log: () => {} });
  assert.ok(fs.existsSync(path.join(idleHome, 'daemon.json')));
  await d.closed;
  assert.equal(fs.existsSync(path.join(idleHome, 'daemon.json')), false, 'lock removed on exit');
  fs.rmSync(idleHome, { recursive: true, force: true });
});

test('wiring: claude keeps the user\'s keys and gateway; intercepted agents get the proxy + CA', () => {
  const ca = path.join(home, 'ca', 'ca.pem');
  const base = { ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_BASE_URL: 'https://gateway.corp/anthropic/', ANTHROPIC_CUSTOM_HEADERS: 'x-team: a\nx-task-id: old' };
  const c = sessionEnv('claude', base, { port: 12445, taskId: 'T1', token: 'tok', caPath: ca, project: 'glass' });
  assert.equal(c.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:12445');
  assert.equal(c.env.ANTHROPIC_API_KEY, 'sk-x');
  assert.equal(c.env.ANTHROPIC_CUSTOM_HEADERS, 'x-team: a\nx-task-id: T1\nx-agent: claude\nx-project: glass\nx-glass-upstream: https://gateway.corp/anthropic');
  const nested = sessionEnv('claude', { ANTHROPIC_BASE_URL: 'http://127.0.0.1:12445' }, { port: 12445, taskId: 'T2', token: 't', caPath: ca, project: 'p' });
  assert.doesNotMatch(nested.env.ANTHROPIC_CUSTOM_HEADERS, /x-glass-upstream/);

  const userCa = path.join(home, 'user-ca.pem');
  fs.writeFileSync(userCa, '-----BEGIN CERTIFICATE-----\nUSER\n-----END CERTIFICATE-----\n');
  const p = sessionEnv('copilot', { NODE_EXTRA_CA_CERTS: userCa, NO_PROXY: '.corp' }, { port: 12445, taskId: 'T3', token: 'a/b', caPath: ca, project: 'p' });
  assert.equal(p.env.HTTPS_PROXY, 'http://glass:a%2Fb@127.0.0.1:12445');
  assert.equal(p.env.HTTP_PROXY, undefined, 'plain HTTP is left alone');
  assert.equal(p.env.NO_PROXY, '.corp');
  assert.match(fs.readFileSync(p.env.NODE_EXTRA_CA_CERTS, 'utf8'), /USER[\s\S]*BEGIN CERTIFICATE/);
  const off = sessionEnv('pi', {}, { port: 12445, taskId: 'T4', token: 't', caPath: ca, project: 'p', intercept: false });
  assert.equal(off.wired, false);
  assert.equal(off.env.HTTPS_PROXY, undefined);
  assert.equal(withHeaders('', { a: '1', b: '' }), 'a: 1');
  assert.equal(cmdQuote('two words'), '"two words"');
  assert.equal(cmdQuote('plain'), 'plain');
});

// ── the CLI, out of process ──────────────────────────────────────────────────

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH, HOME: home, ...env } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

// A stand-in agent: reports what it was given, and (as claude) makes one call.
function fakeAgent(dir) {
  const file = path.join(dir, 'fake-agent.mjs');
  fs.writeFileSync(file, `#!/usr/bin/env node
const base = process.env.ANTHROPIC_BASE_URL;
if (base && process.argv.includes('--call')) {
  const headers = { 'content-type': 'application/json', 'x-api-key': 'sk-user' };
  for (const l of (process.env.ANTHROPIC_CUSTOM_HEADERS || '').split('\\n')) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  const r = await fetch(base + '/v1/messages', { method: 'POST', headers, body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }) });
  await r.text();
}
process.stdout.write(JSON.stringify({ base: base || null, task: process.env.GLASS_TASK_ID || null, args: process.argv.slice(2) }) + '\\n');
`);
  fs.chmodSync(file, 0o755);
  return file;
}

const freePort = () => new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

test('CLI: a measured claude run through a lazily started daemon, then status and stop', { skip: process.platform === 'win32' && 'POSIX stand-in agent' }, async () => {
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-cli-'));
  const port = await freePort();
  const env = { GLASS_HOME: cliHome, GLASS_PORT: String(port), GLASS_CLAUDE_BIN: fakeAgent(cliHome), ANTHROPIC_BASE_URL: `http://127.0.0.1:${upPort}` };
  const run = await runCli(['claude', '--call', 'two words'], env);
  assert.equal(run.code, 0, run.stderr);
  const seen = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.equal(seen.base, `http://127.0.0.1:${port}`);
  assert.match(seen.task, /^glass-claude-/);
  assert.deepEqual(seen.args, ['--call', 'two words']);
  const status = await runCli(['status'], env);
  assert.match(status.stdout, /glass daemon: running/);
  assert.match(status.stdout, new RegExp(seen.task));
  const stop = await runCli(['stop'], env);
  assert.match(stop.stdout, /stopping/);
  await new Promise((r) => setTimeout(r, 500));
  const after = await runCli(['status'], env);
  assert.match(after.stdout, /not running/);
  fs.rmSync(cliHome, { recursive: true, force: true });
});

test('CLI: daemon unreachable → one warning, the agent runs unwired', { skip: process.platform === 'win32' && 'POSIX stand-in agent' }, async () => {
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-cli-'));
  const squatter = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  await new Promise((r) => squatter.listen(0, '127.0.0.1', r));
  const env = { GLASS_HOME: cliHome, GLASS_PORT: String(squatter.address().port), GLASS_CLAUDE_BIN: fakeAgent(cliHome) };
  const run = await runCli(['claude', 'hi'], env);
  await new Promise((r) => squatter.close(r));
  assert.equal(run.code, 0);
  const lines = run.stderr.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /daemon not reachable .* running claude unmeasured/);
  assert.equal(JSON.parse(run.stdout.trim()).base, null);
  fs.rmSync(cliHome, { recursive: true, force: true });
});
