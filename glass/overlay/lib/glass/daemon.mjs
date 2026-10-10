// lib/glass/daemon.mjs — `glass daemon`: one process, one port.
//
//   POST /v1/messages*      claude via ANTHROPIC_BASE_URL → Anthropic forward + tap
//   CONNECT host:443        copilot / opencode / pi via HTTPS_PROXY → model hosts are
//                           decrypted and measured (Anthropic or OpenAI wire), the
//                           rest is tunnelled
//   ANY  /relay/<token>/<provider>/…   opencode providers with a plain-HTTP base URL
//                           (a local model server or another tool's proxy), which
//                           HTTPS_PROXY never sees: forwarded to the URL the session
//                           registered for that provider, and measured
//   GET  /api/token-usage/*, /api/context-breakdown, /api/context-turns   reads
//   POST /sessions, DELETE /sessions/<token>, GET /sessions                wrapper sessions
//   GET  /health, POST /stop
//   GET  /, /assets/*, /api/experiments/runs[/<id>/…]   the UI (ui-api.mjs)
//   GET  /api/statusline[?task_id=]   status-line facts of a live session (statusline.mjs)
//
// Every `glass <agent>` run is a session with its own task id; its rows, context
// turns and breakdown are keyed by it, and closing it archives the span and lets
// the file adapters fill what the proxy could not see. No routing, no providers:
// each call goes where the agent sent it, with the agent's own credentials.
//
// The caller (bin/glass.mjs) sets daemonEnv() on process.env BEFORE importing this
// module — the extracted measurement modules read it at import time.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';

import { initTokenDb, resolveTokenDbPath } from '../../proxy/dist/token-usage.js';
import { sanitizeTaskId } from '../../proxy/dist/measurement-span.js';
import { createMeasurement } from '../../proxy/proxy-bridge/measurement.mjs';
import { handleAnthropicMessages } from '../../proxy/proxy-bridge/anthropic-forward.mjs';
import { handleOpenAIPassthrough, forwardPlain, openAIWireOf } from '../../proxy/proxy-bridge/openai-passthrough.mjs';
import { createUsageApi } from '../../proxy/proxy-bridge/usage-api.mjs';
import { attachIntercept } from '../../proxy/proxy-bridge/intercept.mjs';
import { loadRawBodyRedactionPatterns, makeRedactRawBody } from '../../proxy/proxy-bridge/raw-bodies.mjs';
import { canonicalizeModelName } from '../../proxy/proxy-bridge/model-canonical.mjs';
import { sweepAgedCaptures } from '../measurement/context-turns-retention.mjs';
import { captureForegroundTokens } from '../lsl/token/stop-adapter-registry.mjs';
import { glassPaths, PKG_ROOT } from './home.mjs';
import { createEgressFetch, upstreamProxy } from './egress.mjs';
import { createUiApi } from './ui-api.mjs';
import { statuslineData } from './statusline.mjs';
import { createNetworkMonitor } from './network.mjs';

export const VERSION = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;

// Model hosts decrypted by default; ~/.glass/config.json { "interceptHosts": [...] } replaces the list.
export const DEFAULT_INTERCEPT_HOSTS = Object.freeze([
  'copilot-api.*.ghe.com', 'api.githubcopilot.com', 'api.*.githubcopilot.com',
  'api.openai.com', 'api.anthropic.com',
]);

/** The account label for a row, from the host the agent was talking to. */
export function providerFor(host) {
  if (/(^|\.)githubcopilot\.com$/.test(host) || /^copilot-api\./.test(host)) return 'github-copilot';
  if (host === 'api.openai.com') return 'openai';
  if (host === 'api.anthropic.com') return 'anthropic';
  return host;
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  let raw = '';
  for await (const c of req) raw += c;
  try { return raw ? JSON.parse(raw) : {}; } catch { return null; }
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function readConfig(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

/** A user-supplied upstream for claude: https anywhere, http only on loopback. */
function safeUpstream(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))) {
      return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
    }
  } catch { /* fall through */ }
  return '';
}

/**
 * A session's relays: provider id → its plain-HTTP base URL split into origin and
 * path. Only http: URLs — anything HTTPS reaches the daemon through interception.
 */
export function relaysOf(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, url] of Object.entries(raw)) {
    try {
      const u = new URL(String(url));
      if (u.protocol !== 'http:' || !/^[\w.@:+~-]+$/.test(id)) continue;
      out[id] = { origin: u.origin, path: u.pathname.replace(/\/+$/, ''), loopback: ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) };
    } catch { /* skip */ }
  }
  return out;
}

/**
 * Start the daemon.
 *
 * @param {object} o
 * @param {string} o.home              GLASS_HOME
 * @param {number} o.port
 * @param {Function} [o.fetch]         upstream fetch (default: env-proxy aware undici)
 * @param {number} [o.idleMs]          exit after this long with no session and no request
 * @param {number} [o.retentionDays]
 * @param {(line: string) => void} [o.log]
 * @param {object} [o.network]         network monitor (default: coding's probes, see network.mjs)
 * @returns {Promise<{ port: number, url: string, caPath: string, close: () => Promise<void>, closed: Promise<void> }>}
 */
export async function startDaemon({
  home, port, fetch, idleMs = 30 * 60_000, tickMs = 60_000, retentionDays = 7,
  log = (l) => process.stdout.write(`${new Date().toISOString()} ${l}\n`), network,
}) {
  const p = glassPaths(home);
  for (const d of [p.data, p.ca, p.logs]) fs.mkdirSync(d, { recursive: true });
  const logErr = (l) => log(`ERROR ${l}`);
  const egress = fetch || createEgressFetch(process.env, port);
  const direct = fetch || createEgressFetch({}, port); // a relay to loopback never takes the corporate proxy
  const config = readConfig(p.config);

  const tokenDb = initTokenDb(p.data);
  const measurement = createMeasurement({
    dataDir: p.data,
    tokenDb: () => tokenDb,
    redactRawBody: makeRedactRawBody(loadRawBodyRedactionPatterns(PKG_ROOT, process.env.LLM_PROXY_REDACTION_CONFIG)),
    canonicalModel: canonicalizeModelName,
    log,
    logErr,
  });
  const usageRead = createUsageApi({ tokenDb: () => tokenDb, measurement });

  // ── sessions ──
  const sessions = new Map(); // token → session
  const publicSessions = () => [...sessions.values()].map(({ token, relays, ...s }) => s);
  const uiRead = createUiApi({
    uiDir: path.join(PKG_ROOT, 'ui'), dataDir: p.data, tokenDb: () => tokenDb,
    dbPath: resolveTokenDbPath(p.data), measurement, liveSessions: publicSessions,
  });
  // [N:… P:…]: probed only while a session is live (nothing else reads it).
  const netMonitor = network || createNetworkMonitor({ log });
  netMonitor.start({ active: () => sessions.size > 0 });
  let lastActivity = Date.now();
  const touch = () => { lastActivity = Date.now(); };

  function openSession(body) {
    const agent = String(body.agent || '');
    const taskId = sanitizeTaskId(`glass-${agent}-${stamp()}-${crypto.randomBytes(3).toString('hex')}`);
    const token = crypto.randomBytes(18).toString('base64url');
    const s = {
      token, taskId, agent, intercept: body.intercept !== false,
      cwd: typeof body.cwd === 'string' ? body.cwd : '', project: typeof body.project === 'string' ? body.project : '',
      pid: Number(body.pid) || null, started_at: new Date().toISOString(), relays: relaysOf(body.relays),
    };
    sessions.set(token, s);
    netMonitor.tick(); // the first status line should not wait a whole interval
    log(`session open ${taskId} (${agent}${s.intercept ? '' : ', no intercept'})`);
    return s;
  }

  async function closeSession(token) {
    const s = sessions.get(token);
    if (!s) return null;
    sessions.delete(token);
    const span = {
      task_id: s.taskId, agent: s.agent, started_at: s.started_at, ended_at: new Date().toISOString(),
      meta: { source: 'glass', cwd: s.cwd, project: s.project, intercept: s.intercept },
    };
    try {
      const dir = path.join(p.data, 'measurements');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${s.taskId}.json`), `${JSON.stringify(span, null, 2)}\n`);
    } catch (err) {
      logErr(`span archive ${s.taskId}: ${err.message}`);
    }
    // File adapters fill what the proxy could not see. An intercepted session's
    // model calls are all on the wire — opencode's adapter would re-add its
    // github-copilot calls under a different key (in coding that provider
    // bypasses the proxy) — so adapters run only for claude, whose adapter dedups
    // on the request id, and for --no-intercept sessions, where they are the
    // measurement.
    let adapters = 'skipped (intercepted)';
    if (s.agent === 'claude' || !s.intercept) {
      try {
        const r = await captureForegroundTokens(span, { agent: s.agent, reconcile: true, dbPath: resolveTokenDbPath(p.data) });
        adapters = typeof r === 'number' ? `${r} rows` : JSON.stringify(r);
      } catch (err) {
        adapters = `failed: ${err.message}`;
        logErr(`adapter capture ${s.taskId}: ${err.message}`);
      }
    }
    log(`session close ${s.taskId} (adapters: ${adapters})`);
    return { ...span, adapters };
  }

  // The session an intercepted request belongs to: its Proxy-Authorization token,
  // else — for a client that sent none — the only live intercepting session.
  function sessionForBinding(binding) {
    if (binding && sessions.has(binding)) return sessions.get(binding);
    const live = [...sessions.values()].filter((s) => s.intercept && s.agent !== 'claude');
    return live.length === 1 ? live[0] : null;
  }

  async function onIntercepted(req, res, { host, binding }) {
    touch();
    const s = sessionForBinding(binding);
    const agent = s?.agent || 'unknown';
    const taskId = s?.taskId || '';
    const upstreamBase = `https://${host}`;
    const provider = providerFor(host);
    const pathOnly = (req.url || '').split('?')[0];
    if (req.method === 'POST' && pathOnly.startsWith('/v1/messages')) {
      return handleAnthropicMessages(req, res, {
        measurement, fetch: egress, upstreamBase, agent, provider, subscription: '',
        bindTaskId: () => taskId, logErr,
      });
    }
    if (req.method === 'POST' && openAIWireOf(req.url)) {
      return handleOpenAIPassthrough(req, res, {
        measurement, fetch: egress, upstreamBase, provider, agent, taskId, project: s?.project || '', logErr,
      });
    }
    return forwardPlain(req, res, { fetch: egress, upstreamBase, logErr });
  }

  // /relay/<token>/<provider><rest> → <provider's base URL><rest>, measured like an
  // intercepted call. The token keeps it from being an open forwarder.
  async function onRelay(req, res) {
    const m = /^\/relay\/([^/]+)\/([^/?]+)(.*)$/.exec(req.url || '');
    const s = m && sessions.get(decodeURIComponent(m[1]));
    const relay = s && s.relays[decodeURIComponent(m[2])];
    if (!relay) return json(res, 404, { error: 'no such relay' });
    const provider = decodeURIComponent(m[2]);
    req.url = `${relay.path}${m[3]}` || '/';
    const upstreamBase = relay.origin;
    const via = relay.loopback ? direct : egress;
    const pathOnly = req.url.split('?')[0];
    if (req.method === 'POST' && pathOnly.endsWith('/messages')) {
      return handleAnthropicMessages(req, res, {
        measurement, fetch: via, upstreamBase, agent: s.agent, provider, subscription: '',
        bindTaskId: () => s.taskId, logErr,
      });
    }
    return handleOpenAIPassthrough(req, res, {
      measurement, fetch: via, upstreamBase, provider, agent: s.agent, taskId: s.taskId, project: s.project, logErr,
    });
  }

  let shuttingDown = false;
  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });

  const server = http.createServer(async (req, res) => {
    touch();
    try {
      const url = req.url || '';
      if (req.method === 'GET' && url === '/health') {
        return json(res, 200, { ok: true, glass: VERSION, pid: process.pid, port, sessions: sessions.size, data: p.data });
      }
      if (url === '/sessions' && req.method === 'POST') {
        const body = await readJson(req);
        if (!body || !['claude', 'copilot', 'opencode', 'pi'].includes(body.agent)) return json(res, 400, { error: 'agent must be claude, copilot, opencode or pi' });
        const s = openSession(body);
        return json(res, 200, { taskId: s.taskId, token: s.token, caPath: intercept.caPath });
      }
      if (url === '/sessions' && req.method === 'GET') {
        return json(res, 200, { sessions: publicSessions() });
      }
      if (url.startsWith('/sessions/') && req.method === 'DELETE') {
        const span = await closeSession(decodeURIComponent(url.slice('/sessions/'.length)));
        return span ? json(res, 200, span) : json(res, 404, { error: 'no such session' });
      }
      if (req.method === 'GET' && (url === '/api/statusline' || url.startsWith('/api/statusline?'))) {
        // The named session, else the newest live one (`glass watch` with no --task).
        const want = new URL(url, 'http://localhost').searchParams.get('task_id');
        const live = [...sessions.values()].sort((a, b) => b.started_at.localeCompare(a.started_at));
        const s = want ? live.find((x) => x.taskId === want) : live[0];
        if (!s) return json(res, 404, { error: want ? `no live session ${want}` : 'no live session' });
        return json(res, 200, {
          ...statuslineData({ session: s, db: tokenDb?.db, measurement, egress: upstreamProxy(process.env, port), network: netMonitor.facts(), glass: VERSION }),
          ca_path: intercept.caPath,
        });
      }
      if (url === '/stop' && req.method === 'POST') {
        json(res, 200, { stopping: true });
        setImmediate(() => shutdown('stop requested'));
        return undefined;
      }
      if (req.method === 'POST' && url.split('?')[0].startsWith('/v1/messages')) {
        const upstreamBase = safeUpstream(req.headers['x-glass-upstream']) || 'https://api.anthropic.com';
        delete req.headers['x-glass-upstream'];
        return handleAnthropicMessages(req, res, {
          measurement, fetch: egress, upstreamBase, provider: 'anthropic', subscription: '', logErr,
        });
      }
      if (url.startsWith('/relay/')) return onRelay(req, res);
      if (usageRead(req, res)) return undefined;
      if (await uiRead(req, res)) return undefined;
      return json(res, 404, { error: `no route for ${req.method} ${url.split('?')[0]}` });
    } catch (err) {
      logErr(`${req.method} ${req.url}: ${err?.stack || err}`);
      if (!res.headersSent) json(res, 500, { error: String(err?.message || err) });
      else res.end();
      return undefined;
    }
  });

  const intercept = attachIntercept(server, {
    caDir: p.ca,
    hosts: Array.isArray(config.interceptHosts) && config.interceptHosts.length ? config.interceptHosts : DEFAULT_INTERCEPT_HOSTS,
    upstreamProxy: upstreamProxy(process.env, port),
    noProxy: process.env.NO_PROXY ?? process.env.no_proxy ?? '',
    onRequest: onIntercepted,
    logErr,
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const boundPort = server.address().port;
  fs.writeFileSync(p.lock, `${JSON.stringify({ pid: process.pid, port: boundPort, glass: VERSION, started_at: new Date().toISOString() }, null, 2)}\n`);
  log(`glass ${VERSION} daemon on 127.0.0.1:${boundPort} (data ${p.data}, CA ${intercept.caPath})`);

  const sweep = () => {
    try {
      const r = sweepAgedCaptures({
        measurementsDir: path.join(p.data, 'measurements'),
        breakdownsDir: path.join(p.data, 'llm-proxy', 'context-breakdown'),
        retentionDays, log,
      });
      if (r.removed) log(`retention: removed ${r.removed} of ${r.checked} captures older than ${retentionDays} days`);
    } catch (err) {
      logErr(`retention sweep: ${err.message}`);
    }
  };
  sweep();
  const sweepTimer = setInterval(sweep, 3_600_000);
  const idleTimer = setInterval(() => {
    if (sessions.size === 0 && Date.now() - lastActivity > idleMs) shutdown(`idle for ${Math.round(idleMs / 60_000)} min`);
  }, tickMs);
  sweepTimer.unref();

  async function shutdown(reason) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down: ${reason}`);
    clearInterval(sweepTimer);
    clearInterval(idleTimer);
    netMonitor.stop();
    for (const token of [...sessions.keys()]) await closeSession(token);
    intercept.close();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(() => r()));
    try {
      const lock = JSON.parse(fs.readFileSync(p.lock, 'utf8'));
      if (lock.pid === process.pid) fs.rmSync(p.lock, { force: true });
    } catch { /* no lock */ }
    try { tokenDb.db.close(); } catch { /* already closed */ }
    resolveClosed();
  }

  return { port: boundPort, url: `http://127.0.0.1:${boundPort}`, caPath: intercept.caPath, close: () => shutdown('closed'), closed };
}
