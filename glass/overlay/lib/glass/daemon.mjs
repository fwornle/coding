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
//   GET|PATCH /api/offload, PUT /api/offload/key, POST /api/offload/test
//                           the opt-in offload (offload-store.mjs), from the UI
//
// Every `glass <agent>` run is a session with its own task id; its rows, context
// turns and breakdown are keyed by it, and closing it archives the span and lets
// the file adapters fill what the proxy could not see. Live sessions are kept in
// run/sessions.json: a daemon that stops (an update, `glass stop`) leaves the
// running ones there, and the next daemon re-adopts every one whose `glass
// <agent>` process still runs — its agent keeps the same token, task and status
// line across the restart. No routing, no providers: each call goes where the
// agent sent it, with the agent's own credentials — unless the user switched the
// opt-in offload on for that agent, and then only easy chat calls go to the
// endpoint the user named, falling back to exactly that forward.
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
import { createEgressFetch, upstreamProxy, proxyEnvOf, noProxyOf } from './egress.mjs';
import { createUiApi } from './ui-api.mjs';
import { statuslineData, renderReport, TAGS } from './statusline.mjs';
import { loadCostDefaults, saveExcludedAccounts } from './cost.mjs';
import { createNetworkMonitor } from './network.mjs';
import { createOffloadStore } from './offload-store.mjs';
import { createOffloader, createTargetHealth, OFFLOAD_AGENTS } from '../../proxy/proxy-bridge/offload.mjs';

const PKG = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
export const VERSION = PKG.version;
// The online docs' presentation, linked from the UI's header (each target's own site).
const DOCS = PKG.homepage ? new URL('overview/', PKG.homepage).href : null;

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

/**
 * The offload endpoint is on the user's own network (a model server on this
 * machine, a cluster on the LAN or VPN) unless it is a public host: those go
 * direct, since a corporate proxy cannot reach a private address anyway.
 */
export function isPrivateHost(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || !h.includes('.') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return /^f[cd][0-9a-f]{2}:/.test(h);
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * A browser page may not drive the daemon's write routes: a cross-site form or
 * fetch cannot set a custom header without a CORS preflight, which the daemon
 * never answers, and an Origin other than the daemon's own is refused outright.
 */
export function uiWriteAllowed(req, port) {
  if (req.headers['x-glass-ui'] !== '1') return false;
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin);
}

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

// The Copilot API hosts opencode's github-copilot provider talks to: copilot-api.<tenant>
// for an enterprise login, api[.<plan>].githubcopilot.com otherwise.
const COPILOT_API_HOST = /^(copilot-api\.[a-z0-9.-]+|api(\.[a-z0-9-]+)?\.githubcopilot\.com)$/i;

/**
 * A session's relays: provider id → its base URL split into origin and path.
 * http: URLs (a local model server, another tool's proxy), plus https: for the
 * Copilot API only — opencode's github-copilot reaches it through the relay by
 * configuration instead of interception. Any other HTTPS host is intercepted,
 * never relayed: the relay must not become a general forwarder.
 */
export function relaysOf(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, url] of Object.entries(raw)) {
    try {
      const u = new URL(String(url));
      const allowed = u.protocol === 'http:' || (u.protocol === 'https:' && COPILOT_API_HOST.test(u.hostname));
      if (!allowed || !/^[\w.@:+~-]+$/.test(id)) continue;
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
  // The last tunnel the upstream proxy refused, for the network popup.
  let lastRefusal = null;
  const makeEgress = (env) => createEgressFetch(env, port, {
    onRefusal: (r) => {
      lastRefusal = r;
      logErr(`upstream proxy refused the tunnel to ${r.host} (HTTP ${r.status})`);
    },
  });
  // The proxy settings egress uses. They start as the daemon's own environment
  // (the shell of the first `glass` command) and follow each new session's shell:
  // a daemon started at home must not keep going direct after you join VPN.
  let egressEnv = proxyEnvOf(process.env);
  // glass's own port, for "a proxy pointing back at glass is no proxy": the
  // requested one until the server is bound (port 0 binds a random one).
  let selfPort = port;
  let egress = fetch || makeEgress(egressEnv);
  function adoptProxyEnv(env) {
    if (!env || typeof env !== 'object') return;
    const next = proxyEnvOf(env);
    const before = upstreamProxy(egressEnv, selfPort);
    const after = upstreamProxy(next, selfPort);
    if (before === after && noProxyOf(egressEnv) === noProxyOf(next)) return;
    egressEnv = next;
    if (!fetch) egress = makeEgress(next);
    intercept.setUpstream({ upstreamProxy: after, noProxy: noProxyOf(next) });
    log(`egress proxy ${before || 'direct'} → ${after || 'direct'} (proxy settings of the newest glass session)`);
  }
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
  // The account selection lives in ~/.glass/cost.json (cost.mjs) and filters
  // every usage read, as coding's proxy does with its cost settings.
  const usageRead = createUsageApi({
    tokenDb: () => tokenDb,
    measurement,
    accounts: {
      excluded: () => loadCostDefaults(home).excludeAccounts ?? [],
      setExcluded: (list) => saveExcludedAccounts(home, list),
    },
  });

  // ── opt-in offload ──
  const offloadStore = createOffloadStore(home);
  const targetFetch = (url, init) => {
    let host = '';
    try { host = new URL(url).hostname; } catch { /* egress */ }
    return (isPrivateHost(host) ? direct : egress)(url, init);
  };
  const offloadHealth = createTargetHealth({
    fetch: targetFetch, getConfig: offloadStore.getConfig, getKey: offloadStore.getKey, setTimer: () => null, clearTimer: () => {},
  });
  const offloader = createOffloader({ fetch: targetFetch, getConfig: offloadStore.getConfig, getKey: offloadStore.getKey, health: offloadHealth });
  const offload = { offloader, getConfig: offloadStore.getConfig };
  // Probed only while offload is on: a switched-off feature makes no network call.
  const probeIfOn = () => (offloadStore.getConfig().enabled ? offloadHealth.probe() : Promise.resolve(offloadHealth.state));
  probeIfOn().catch(() => {});
  const offloadTimer = setInterval(() => { probeIfOn().catch(() => {}); }, 60_000);
  offloadTimer.unref();
  const offloadView = () => {
    const cfg = offloadStore.getConfig();
    return {
      config: cfg, keySet: offloadStore.hasKey(), agents: OFFLOAD_AGENTS,
      health: { ...offloadHealth.state, current: offloadHealth.state.url === cfg.target.url },
      counters: { ...offloader.counters }, inFlight: offloader.inFlight(),
    };
  };

  // ── sessions ──
  const sessions = new Map(); // token → session
  const sessionsFile = path.join(p.run, 'sessions.json');
  const alive = (pid) => {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
  };
  // Owner-only: the file holds the sessions' proxy credentials.
  function saveSessions() {
    try {
      fs.mkdirSync(p.run, { recursive: true });
      fs.writeFileSync(sessionsFile, `${JSON.stringify([...sessions.values()], null, 2)}\n`, { mode: 0o600 });
    } catch (err) {
      logErr(`sessions save: ${err.message}`);
    }
  }
  const publicSessions = () => [...sessions.values()].map(({ token, relays, ...s }) => s);
  // The named live session, else the newest (`glass watch` with no --task).
  const liveSession = (want) => {
    const live = [...sessions.values()].sort((x, y) => y.started_at.localeCompare(x.started_at));
    return want ? live.find((x) => x.taskId === want) : live[0];
  };
  const uiRead = createUiApi({
    uiDir: path.join(PKG_ROOT, 'ui'), dataDir: p.data, tokenDb: () => tokenDb,
    dbPath: resolveTokenDbPath(p.data), measurement, liveSessions: publicSessions,
    excludedAccounts: () => loadCostDefaults(home).excludeAccounts ?? [],
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
    saveSessions();
    netMonitor.tick(); // the first status line should not wait a whole interval
    log(`session open ${taskId} (${agent}${s.intercept ? '' : ', no intercept'})`);
    return s;
  }

  async function closeSession(token) {
    const s = sessions.get(token);
    if (!s) return null;
    sessions.delete(token);
    saveSessions();
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
    // measurement — unless opencode's github-copilot (the only provider its
    // adapter imports) was relayed, and so is on the wire already.
    const relayedCopilot = s.agent === 'opencode' && Boolean(s.relays?.['github-copilot']);
    let adapters = s.intercept ? 'skipped (intercepted)' : 'skipped (github-copilot relayed)';
    if (s.agent === 'claude' || (!s.intercept && !relayedCopilot)) {
      try {
        // byokMetered: false — a copilot BYOK provider is the user's own here,
        // not coding's proxy, so its calls are on no wire glass measured.
        const r = await captureForegroundTokens(span, { agent: s.agent, reconcile: true, byokMetered: false, dbPath: resolveTokenDbPath(p.data) });
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
  // else — for a client that sent none — the only live intercepting session. A
  // token this daemon does not know is never guessed: filed under the only live
  // session, an orphaned agent's calls would count as another agent's.
  function sessionForBinding(binding) {
    if (binding) return sessions.get(binding) || null;
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
        measurement, fetch: egress, upstreamBase, provider, agent, taskId, project: s?.project || '', logErr, offload,
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
      measurement, fetch: via, upstreamBase, provider, agent: s.agent, taskId: s.taskId, project: s.project, logErr, offload,
    });
  }

  let shuttingDown = false;
  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });

  const lineData = (session) => statuslineData({
    session, db: tokenDb?.db, measurement, egress: upstreamProxy(egressEnv, selfPort), network: netMonitor.facts(), glass: VERSION,
    refusal: lastRefusal, offload: { config: offloadStore.getConfig(), reachable: offloadHealth.usable(offloadStore.getConfig()) },
    costCfg: loadCostDefaults(home),
  });

  const server = http.createServer(async (req, res) => {
    touch();
    try {
      const url = req.url || '';
      if (req.method === 'GET' && url === '/health') {
        return json(res, 200, { ok: true, glass: VERSION, docs: DOCS, pid: process.pid, port, sessions: sessions.size, data: p.data });
      }
      if (url === '/sessions' && req.method === 'POST') {
        const body = await readJson(req);
        if (!body || !['claude', 'copilot', 'opencode', 'pi'].includes(body.agent)) return json(res, 400, { error: 'agent must be claude, copilot, opencode or pi' });
        adoptProxyEnv(body.proxyEnv);
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
      // The Cost tab's prices without coding's settings API: the contract
      // discount / FX from the build's and the user's cost files (cost.mjs).
      if (req.method === 'GET' && url === '/api/cost-defaults') return json(res, 200, loadCostDefaults(home));
      if (req.method === 'GET' && (url === '/api/statusline' || url.startsWith('/api/statusline?'))) {
        const want = new URL(url, 'http://localhost').searchParams.get('task_id');
        const s = liveSession(want);
        if (!s) return json(res, 404, { error: want ? `no live session ${want}` : 'no live session' });
        return json(res, 200, { ...lineData(s), ca_path: intercept.caPath });
      }
      if (req.method === 'GET' && (url === '/report/net' || url.startsWith('/report/net?'))) {
        // The network field's link outside tmux (Claude Code's own status line,
        // glass watch): the popup's report, as a page.
        const s = liveSession(new URL(url, 'http://localhost').searchParams.get('task'));
        const text = s ? renderReport(TAGS.net, { d: lineData(s), port, caPath: intercept.caPath }) : 'No live glass session.';
        const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(`<!doctype html><meta charset="utf-8"><title>glass · network</title>`
          + `<style>body{font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;margin:24px;background:#fff;color:#111}`
          + `@media (prefers-color-scheme:dark){body{background:#111;color:#ddd}}</style><pre>${esc}</pre>`);
        return undefined;
      }
      if (url === '/stop' && req.method === 'POST') {
        json(res, 200, { stopping: true });
        setImmediate(() => shutdown('stop requested'));
        return undefined;
      }
      if (req.method === 'POST' && url.split('?')[0].startsWith('/v1/messages')) {
        const upstreamBase = safeUpstream(req.headers['x-glass-upstream']) || 'https://api.anthropic.com';
        delete req.headers['x-glass-upstream'];
        // Which account a direct call bills is the login's KIND, read from which
        // header carries it — never from the credential: an x-api-key is a metered
        // API key, an Authorization bearer is a Claude subscription (Max or Pro,
        // indistinguishable on the wire). An LLM proxy in between names the
        // account itself (x-llm-provider), which takes precedence in the forward.
        const provider = req.headers['x-api-key'] ? 'anthropic-api' : 'anthropic';
        return handleAnthropicMessages(req, res, {
          measurement, fetch: egress, upstreamBase, provider, subscription: '', logErr,
        });
      }
      if (url === '/api/offload' && req.method === 'GET') return json(res, 200, offloadView());
      if (url.startsWith('/api/offload') && req.method !== 'GET') {
        if (!uiWriteAllowed(req, selfPort)) return json(res, 403, { error: 'offload settings change only from the glass UI or CLI' });
        const body = await readJson(req);
        if (!body) return json(res, 400, { error: 'body must be JSON' });
        if (url === '/api/offload' && req.method === 'PATCH') {
          const before = offloadStore.getConfig();
          const next = offloadStore.update(body);
          log(`offload settings changed: ${next.enabled ? 'on' : 'off'} for ${OFFLOAD_AGENTS.filter((a) => next.agents[a]).join(', ') || 'no agent'}`);
          if (next.enabled && (!before.enabled || before.target.url !== next.target.url)) await probeIfOn();
          return json(res, 200, offloadView());
        }
        if (url === '/api/offload/key' && req.method === 'PUT') {
          offloadStore.setKey(body.key);
          await probeIfOn();
          return json(res, 200, offloadView());
        }
        if (url === '/api/offload/test' && req.method === 'POST') {
          // An explicit test probes even while offload is off: it is how the user
          // checks an endpoint before switching it on.
          await offloadHealth.probe();
          return json(res, 200, offloadView());
        }
        return json(res, 404, { error: `no route for ${req.method} ${url}` });
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
    upstreamProxy: upstreamProxy(egressEnv, port),
    noProxy: noProxyOf(egressEnv),
    onRequest: onIntercepted,
    logErr,
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const boundPort = server.address().port;
  selfPort = boundPort;
  fs.writeFileSync(p.lock, `${JSON.stringify({ pid: process.pid, port: boundPort, glass: VERSION, started_at: new Date().toISOString() }, null, 2)}\n`);

  // Re-adopt the previous daemon's sessions — only now, with the port won, so a
  // daemon that loses the race never touches the running one's sessions. Those
  // whose agent has exited meanwhile are closed (span archived, adapters run).
  let previous = [];
  try { previous = JSON.parse(fs.readFileSync(sessionsFile, 'utf8')); } catch { /* none */ }
  for (const s of Array.isArray(previous) ? previous : []) {
    if (s && typeof s.token === 'string' && typeof s.taskId === 'string') sessions.set(s.token, { ...s, relays: s.relays || {} });
  }
  let ended = 0;
  for (const s of [...sessions.values()]) if (!alive(s.pid)) { await closeSession(s.token); ended++; }
  if (sessions.size || ended) log(`re-adopted ${sessions.size} live session(s) from the previous daemon, closed ${ended} that had ended`);
  if (sessions.size) netMonitor.tick(); // their status lines should not wait a whole interval
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
    // A `glass <agent>` that was killed never closes its session: reap it, or
    // the daemon would never go idle.
    for (const s of [...sessions.values()]) if (s.pid && !alive(s.pid)) closeSession(s.token);
    if (sessions.size === 0 && Date.now() - lastActivity > idleMs) shutdown(`idle for ${Math.round(idleMs / 60_000)} min`);
  }, tickMs);
  sweepTimer.unref();

  async function shutdown(reason) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down: ${reason}`);
    clearInterval(sweepTimer);
    clearInterval(idleTimer);
    clearInterval(offloadTimer);
    netMonitor.stop();
    // Sessions whose agent still runs stay in sessions.json for the next daemon.
    for (const s of [...sessions.values()]) if (!alive(s.pid)) await closeSession(s.token);
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
