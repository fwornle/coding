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
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'glass.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-test-'));
const { daemonEnv } = await import('../lib/glass/home.mjs');
Object.assign(process.env, daemonEnv(home));
for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete process.env[k];
const { startDaemon } = await import('../lib/glass/daemon.mjs');
const { sessionEnv, withHeaders, opencodeRelayContent } = await import('../lib/glass/wiring.mjs');
const { cmdQuote } = await import('../lib/glass/spawn.mjs');

const sse = (events, named) => events.map((e) => (named ? `event: ${e.type}\n` : '') + `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
const ANTHROPIC_SSE = sse([
  { type: 'message_start', message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pong' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
  { type: 'message_stop' },
], true);
const CHAT_USAGE = { prompt_tokens: 120, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 100 } };

// Network facts without probing this machine (network.mjs is tested on its own).
const stubNetwork = { facts: () => ({ location: 'vpn', proxy_running: true, proxy_functional: true, proxy_enabled_by_user: false }), tick: () => {}, start: () => {}, stop: () => {} };

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
  daemon = await startDaemon({ home, port: 0, fetch: stubFetch, log: () => {}, network: stubNetwork });
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
// A write the daemon finishes after the response: poll for it rather than trust one
// fixed sleep, which a slow runner (Windows CI) outlasts.
async function eventually(read, ok, ms = 5000) {
  const end = Date.now() + ms;
  let v = await read();
  while (!ok(v) && Date.now() < end) { await new Promise((r) => setTimeout(r, 50)); v = await read(); }
  return v;
}

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
  const turns = await eventually(async () => (await api('GET', `/api/context-turns?task_id=${s.taskId}`)).body.contextTurns, (t) => t.length > 0);
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

test('opencode relay: a plain-HTTP provider is forwarded to its own URL and measured; only with the session token', async () => {
  const base = `http://127.0.0.1:${upPort}/v1`;
  const s = await open('opencode', { relays: { 'rapid-proxy': base, bad: 'https://example.com/v1', 'a/b': base } });
  const relay = (id, route, body, token = s.token) => fetch(`${daemon.url}/relay/${encodeURIComponent(token)}/${id}${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer placeholder' }, body: JSON.stringify(body),
  });
  const chat = await relay('rapid-proxy', '/chat/completions', { model: 'claude-sonnet-5', stream: true, messages: msgs });
  assert.match(await chat.text(), /\[DONE\]/);
  assert.equal(upSeen.at(-1).url, '/v1/chat/completions', 'the provider\'s own path, then the request\'s');
  assert.equal(upSeen.at(-1).headers.authorization, 'Bearer placeholder', 'the agent\'s credential is forwarded');
  const msg = await relay('rapid-proxy', '/messages', { model: 'claude-sonnet-5', max_tokens: 8, messages: msgs });
  assert.equal(msg.status, 200);
  assert.equal(upSeen.at(-1).url, '/v1/messages');
  await settle();
  const rows = await rowsFor(s.taskId);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.agent === 'opencode' && r.provider === 'rapid-proxy'));
  assert.equal((await relay('rapid-proxy', '/chat/completions', {}, 'not-a-session')).status, 404);
  assert.equal((await relay('bad', '/chat/completions', {})).status, 404, 'https providers are intercepted, never relayed');
  assert.equal((await api('GET', '/sessions')).body.sessions.find((x) => x.taskId === s.taskId).relays, undefined);
});

// A daemon of its own: these depend on exactly which sessions are live.
async function ownDaemon(dir) {
  return startDaemon({ home: dir, port: 0, fetch: stubFetch, log: () => {}, network: stubNetwork });
}
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;
// A proxy credential no session of this daemon was issued (an earlier daemon's).
const STALE = 'stale';

test('a session credential the daemon does not know is never guessed, even with one live session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-stale-'));
  const main = daemon;
  daemon = await ownDaemon(dir);
  try {
    const s = await open('copilot', { pid: process.pid });
    await intercepted({ host: 'api.githubcopilot.com', token: STALE, route: '/chat/completions', body: { model: 'gpt-5.6-sol', messages: msgs } });
    await intercepted({ host: 'api.githubcopilot.com', token: s.token, route: '/chat/completions', body: { model: 'gpt-5.6-sol', messages: msgs } });
    await settle();
    const rows = await recent();
    assert.equal(rows.filter((r) => r.task_id === s.taskId).length, 1, 'only its own call');
    assert.equal(rows.filter((r) => r.agent === 'unknown' && !r.task_id).length, 1, 'the stale credential\'s call stays unbound');
  } finally {
    await daemon.close();
    daemon = main;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a daemon restart re-adopts sessions whose agent still runs, and closes the ended ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-adopt-'));
  const main = daemon;
  try {
    daemon = await ownDaemon(dir);
    const live = await open('opencode', { pid: process.pid });
    const gone = await open('pi', { pid: deadPid() });
    const file = path.join(dir, 'run', 'sessions.json');
    if (process.platform !== 'win32') assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600', 'the session credentials are owner-only');
    await daemon.close();
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).map((x) => x.taskId), [live.taskId], 'a stopping daemon keeps the running session');
    assert.ok(fs.existsSync(path.join(dir, 'data', 'measurements', `${gone.taskId}.json`)), 'the ended one is archived');

    daemon = await ownDaemon(dir);
    assert.deepEqual((await api('GET', '/sessions')).body.sessions.map((x) => x.taskId), [live.taskId]);
    await intercepted({ host: 'api.githubcopilot.com', token: live.token, route: '/chat/completions', body: { model: 'gpt-5.6-sol', messages: msgs } });
    await settle();
    assert.equal((await rowsFor(live.taskId)).length, 1, 'the same credential is still its session');
    assert.equal((await api('GET', `/api/statusline?task_id=${live.taskId}`)).status, 200, 'its status line keeps working');
  } finally {
    await daemon.close();
    daemon = main;
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

test('UI reads: sessions as runs (live + closed), a session\'s timeline and context turns', async () => {
  const s = await open('copilot');
  await intercepted({ host: 'copilot-api.acme.ghe.com', token: s.token, route: '/v1/messages', body: { model: 'claude-sonnet-5.5', max_tokens: 8, messages: msgs } });
  await settle();
  let run = (await api('GET', '/api/experiments/runs')).body.rows.find((r) => r.task_id === s.taskId);
  assert.equal(run.ended_at, null, 'a live session is a run without an end');
  assert.equal(run.canonical_agent, 'copilot');
  assert.equal(run.project, 'glass');
  assert.equal(run.outcome.calls, 1);
  assert.equal(run.outcome.inputTokens, 33);
  assert.ok(run.canonical_model, 'dominant model of the session');
  await api('DELETE', `/sessions/${encodeURIComponent(s.token)}`);
  run = (await api('GET', '/api/experiments/runs')).body.rows.find((r) => r.task_id === s.taskId);
  assert.ok(run.ended_at, 'closed: read back from the archived span');
  assert.equal(run.outcome.calls, 1);
  const tl = (await api('GET', `/api/experiments/runs/${s.taskId}/timeline`)).body;
  assert.equal(tl.timeline.length, 1);
  assert.equal(tl.timeline[0].input_tokens, 33);
  assert.equal((await api('GET', `/api/experiments/runs/${s.taskId}/context-turns`)).body.contextTurns.length, 1);
  assert.deepEqual((await api('GET', '/api/experiments/runs/no-such-task/context-turns')).body, { contextTurns: [] });
  assert.equal((await api('GET', '/api/experiments/runs/..%2F..%2Fetc/timeline')).status, 400);
});

test('status line: facts of a live session — tokens, the last turn against the model window', async () => {
  const s = await open('copilot');
  assert.equal((await api('GET', `/api/statusline?task_id=${s.taskId}`)).body.ctx, null, 'no turn yet');
  await intercepted({ host: 'copilot-api.acme.ghe.com', token: s.token, route: '/v1/messages', body: { model: 'claude-sonnet-5.5', max_tokens: 8, messages: msgs } });
  await settle();
  const d = (await api('GET', `/api/statusline?task_id=${s.taskId}`)).body;
  assert.equal(d.agent, 'copilot');
  assert.equal(d.tokens.calls, 1);
  assert.equal(d.tokens.prompt, d.tokens.input + d.tokens.cache_read + d.tokens.cache_write);
  assert.equal(d.ctx.turns, 1);
  assert.equal(d.ctx.used, d.tokens.prompt, 'one turn: the gauge is that turn\'s prompt');
  assert.ok(d.ctx.window > 0 && d.ctx.pct > 0);
  assert.equal(d.egress, 'direct');
  assert.equal(d.network.location, 'vpn', 'the network monitor\'s facts');
  assert.ok(d.ca_path.endsWith('.pem'));
  assert.equal((await api('GET', '/api/statusline')).body.task_id, s.taskId, 'no task: the newest live session');
  await api('DELETE', `/sessions/${encodeURIComponent(s.token)}`);
  assert.equal((await api('GET', `/api/statusline?task_id=${s.taskId}`)).status, 404, 'closed sessions have no status line');
});

test('UI static: page, assets, client routes; no escape from the UI dir', async () => {
  const { createUiApi } = await import('../lib/glass/ui-api.mjs');
  const uiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-ui-'));
  fs.mkdirSync(path.join(uiDir, 'assets'));
  fs.writeFileSync(path.join(uiDir, 'index.html'), '<div id="root"></div>');
  fs.writeFileSync(path.join(uiDir, 'assets', 'a.js'), 'x');
  const handle = createUiApi({ uiDir, dataDir: uiDir, tokenDb: () => null, dbPath: '', measurement: {}, liveSessions: () => [] });
  const srv = http.createServer(async (req, res) => { if (!(await handle(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(await page.text(), /root/);
    const js = await fetch(`${base}/assets/a.js`);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.match(js.headers.get('cache-control'), /immutable/);
    assert.match(await (await fetch(`${base}/sessions`)).text(), /root/, 'a client route gets the page');
    assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
    // Raw paths: fetch() would normalise the dots away before they reach the server.
    const raw = (p) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: p }, (r) => {
        let body = '';
        r.on('data', (d) => { body += d; });
        r.on('end', () => resolve({ status: r.statusCode, body }));
      }).on('error', reject);
    });
    fs.writeFileSync(path.join(path.dirname(uiDir), 'glass-ui-secret.txt'), 'SECRET');
    for (const p of ['/../glass-ui-secret.txt', '/%2e%2e/glass-ui-secret.txt', '/assets/..%2f..%2fglass-ui-secret.txt']) {
      const r = await raw(p);
      assert.ok(!r.body.includes('SECRET'), `${p} escaped the UI dir`);
    }
    fs.rmSync(path.join(path.dirname(uiDir), 'glass-ui-secret.txt'), { force: true });
    assert.deepEqual(await (await fetch(`${base}/api/experiments/runs`)).json(), { rows: [] });
  } finally {
    await new Promise((r) => srv.close(r));
    fs.rmSync(uiDir, { recursive: true, force: true });
  }
});

test('glass ui: one opener chain per platform, no shell', async () => {
  const { openers } = await import('../lib/glass/open-url.mjs');
  const u = 'http://127.0.0.1:12445/?a=1&b=2';
  assert.deepEqual(openers(u, 'darwin', false), [['open', [u]]]);
  assert.deepEqual(openers(u, 'win32', false)[0], ['cmd', ['/c', 'start', '""', 'http://127.0.0.1:12445/?a=1^&b=2']]);
  assert.equal(openers(u, 'linux', true)[0][0], 'wslview');
  assert.equal(openers(u, 'linux', false)[0][0], 'xdg-open');
  // macOS: coding's tab reuse (lib/statusline/browser-tab.mjs), keyed on the given prefix.
  const { openUrl } = await import('../lib/glass/open-url.mjs');
  const seen = [];
  assert.equal(await openUrl('http://127.0.0.1:12445/#/sessions?task=t', 'http://127.0.0.1:12445/', {
    platform: 'darwin', focusTab: (url, prefix) => { seen.push([url, prefix]); return 'reused idx=1 active=1 wins=1'; },
  }), true);
  assert.deepEqual(seen, [['http://127.0.0.1:12445/#/sessions?task=t', 'http://127.0.0.1:12445/']]);
});

test('an idle daemon exits by itself', async () => {
  const idleHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-idle-'));
  const d = await startDaemon({ home: idleHome, port: 0, fetch: stubFetch, idleMs: 100, tickMs: 25, log: () => {}, network: stubNetwork });
  assert.ok(fs.existsSync(path.join(idleHome, 'daemon.json')));
  await d.closed;
  assert.equal(fs.existsSync(path.join(idleHome, 'daemon.json')), false, 'lock removed on exit');
  fs.rmSync(idleHome, { recursive: true, force: true });
});

test('wiring: opencode relays plain-HTTP providers through OPENCODE_CONFIG_CONTENT, keeping what was there', () => {
  const prior = JSON.stringify({ model: 'rapid-proxy/x', provider: { 'rapid-proxy': { options: { headers: { 'x-project': 'p' } } } } });
  const cfg = JSON.parse(opencodeRelayContent(prior, ['rapid-proxy'], { port: 12445, token: 't/k' }));
  assert.equal(cfg.model, 'rapid-proxy/x');
  assert.deepEqual(cfg.provider['rapid-proxy'].options, { headers: { 'x-project': 'p' }, baseURL: 'http://127.0.0.1:12445/relay/t%2Fk/rapid-proxy' });
  const ca = path.join(home, 'ca', 'ca.pem');
  const { env, note } = sessionEnv('opencode', {}, { port: 12445, taskId: 'T', token: 'tok', caPath: ca, project: 'p', relays: { local: 'http://127.0.0.1:8081/v1' } });
  assert.equal(JSON.parse(env.OPENCODE_CONFIG_CONTENT).provider.local.options.baseURL, 'http://127.0.0.1:12445/relay/tok/local');
  assert.match(note, /relaying local/);
  assert.equal(sessionEnv('opencode', {}, { port: 12445, taskId: 'T', token: 'tok', caPath: ca, project: 'p' }).env.OPENCODE_CONFIG_CONTENT, undefined);
  assert.equal(sessionEnv('pi', {}, { port: 12445, taskId: 'T', token: 'tok', caPath: ca, project: 'p', relays: { local: 'http://x' } }).env.OPENCODE_CONFIG_CONTENT, undefined);
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

// A daemon left over from another glass version: /health and /stop only.
async function oldDaemon(sessions, glass = '0.0.1') {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/stop') { res.end('{"stopping":true}'); setImmediate(() => { srv.close(); srv.closeAllConnections(); }); return; }
    res.end(JSON.stringify({ ok: true, glass, pid: 2 ** 22 + 7, port: srv.address().port, sessions }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, seen, close: () => new Promise((r) => { srv.close(() => r()); srv.closeAllConnections(); }) };
}

test('version check: an older daemon with live sessions is joined, with one warning', async () => {
  const { daemonFor } = await import('../lib/glass/cli.mjs');
  const old = await oldDaemon(2);
  const warnings = [];
  const h = await daemonFor({ home, port: old.port, env: {}, version: '9.9.9', warn: (l) => warnings.push(l) });
  assert.equal(h.glass, '0.0.1');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /running daemon is glass 0\.0\.1, this is 9\.9\.9 — it keeps serving its 2 live session/);
  assert.ok(!old.seen.includes('/stop'), 'a daemon with sessions is never stopped');
  await old.close();
});

test('version check: an older daemon without sessions is replaced by this version', { skip: process.platform === 'win32' && 'spawns a detached daemon' }, async () => {
  const { daemonFor } = await import('../lib/glass/cli.mjs');
  const { stopDaemon } = await import('../lib/glass/client.mjs');
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-ver-'));
  const old = await oldDaemon(0);
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const h = await daemonFor({ home: cliHome, port: old.port, env: { PATH: process.env.PATH, HOME: home }, version, warn: () => assert.fail('no warning') });
  assert.ok(old.seen.includes('/stop'));
  assert.equal(h?.glass, version);
  await stopDaemon(old.port, { waitMs: 10_000 });
  fs.rmSync(cliHome, { recursive: true, force: true });
});

test('version check: a daemon that keeps its sessions (0.1.6+) is replaced even with live ones', { skip: process.platform === 'win32' && 'spawns a detached daemon' }, async () => {
  const { daemonFor } = await import('../lib/glass/cli.mjs');
  const { stopDaemon } = await import('../lib/glass/client.mjs');
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-ver-'));
  const old = await oldDaemon(3, '0.1.6');
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const h = await daemonFor({ home: cliHome, port: old.port, env: { PATH: process.env.PATH, HOME: home }, version: '9.9.9', warn: () => assert.fail('no warning') });
  assert.ok(old.seen.includes('/stop'), 'its sessions survive the restart, so it is replaced');
  assert.equal(h?.glass, version);
  await stopDaemon(old.port, { waitMs: 10_000 });
  fs.rmSync(cliHome, { recursive: true, force: true });
});

test('glass update: an old daemon with live sessions is replaced and the new one started at once', { skip: process.platform === 'win32' && 'spawns a detached daemon' }, async () => {
  // Running agents send through the daemon; waiting for the next glass <agent>
  // left them without one after an update.
  const { replaceAfterUpdate } = await import('../lib/glass/cli.mjs');
  const { health, stopDaemon } = await import('../lib/glass/client.mjs');
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-upd-'));
  const old = await oldDaemon(3, '0.1.8');
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const said = [];
  const n = await replaceAfterUpdate({ latest: version, home: cliHome, port: old.port, env: { PATH: process.env.PATH, HOME: home }, say: (l) => said.push(l) });
  assert.ok(old.seen.includes('/stop'));
  assert.equal(n?.glass, version);
  assert.equal((await health(old.port))?.glass, version, 'the new daemon is up before glass update returns');
  assert.match(said[0], /replaced the glass 0\.1\.8 daemon .* its 3 live session/);
  await stopDaemon(old.port, { waitMs: 10_000 });
  fs.rmSync(cliHome, { recursive: true, force: true });
});

test('glass update: an old daemon without sessions is only stopped', async () => {
  const { replaceAfterUpdate } = await import('../lib/glass/cli.mjs');
  const { health } = await import('../lib/glass/client.mjs');
  const old = await oldDaemon(0, '0.1.8');
  const said = [];
  assert.equal(await replaceAfterUpdate({ latest: '9.9.9', home, port: old.port, env: {}, say: (l) => said.push(l) }), null);
  assert.ok(old.seen.includes('/stop'));
  assert.equal(await health(old.port), null);
  assert.match(said[0], /next glass <agent> starts 9\.9\.9/);
});

test('CLI: a reader that goes away (glass status | head) ends glass quietly', async () => {
  const child = spawn(process.execPath, [BIN, 'status'], { env: { PATH: process.env.PATH, HOME: home, GLASS_PORT: String(await freePort()) } });
  child.stdout.destroy();
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 0, stderr);
  assert.doesNotMatch(stderr, /EPIPE/);
});

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
  // No terminal → no tmux: claude gets glass as its own statusLine, for this run only.
  assert.equal(seen.args[0], '--settings');
  assert.deepEqual(seen.args.slice(2), ['--call', 'two words']);
  assert.equal(fs.existsSync(seen.args[1]), false, 'the settings file is removed after the run');
  const plain = await runCli(['claude', '--call', 'x'], { ...env, GLASS_NO_STATUSLINE: '1' });
  assert.deepEqual(JSON.parse(plain.stdout.trim().split('\n').pop()).args, ['--call', 'x']);
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

test('CLI: uninstall returns only after the daemon process has exited, then removes the home', { skip: process.platform === 'win32' && 'POSIX stand-in agent' }, async () => {
  // Windows refuses to delete the token DB and the daemon log while the daemon
  // still holds them — answering /stop is not enough (G5, windows CI).
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-cli-'));
  const port = await freePort();
  const env = { GLASS_HOME: cliHome, GLASS_PORT: String(port), GLASS_CLAUDE_BIN: fakeAgent(cliHome), ANTHROPIC_BASE_URL: `http://127.0.0.1:${upPort}` };
  assert.equal((await runCli(['claude', '--call', 'x'], env)).code, 0);
  const { pid } = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  const un = await runCli(['uninstall', '--yes'], env);
  assert.equal(un.code, 0, un.stderr);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'daemon still running when uninstall returned');
  assert.equal(fs.existsSync(cliHome), false);
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
