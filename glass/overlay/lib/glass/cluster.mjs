// lib/glass/cluster.mjs — a GPU cluster's nodes, read over HTTP, for the UI's Cluster page.
//
//   GET /api/cluster   { configured: false } with no cluster.json; else every node's
//                      gateway health, served models, GPUs, jobs and listening
//                      endpoints, with a short history for the sparklines
//   GET /api/cluster?peek=1   { configured } only — the tab's gate, which polls nothing
//
// Opt-in and read-only. The files live in GLASS_HOME, written by whoever has the
// cluster's credentials (a devcontainer from its .env, or by hand):
//
//   cluster.json   { "nodes": [{ "name": "node1", "host": "192.0.2.10" }, …],
//                    "gatewayPort": 8000, "statusPort": 8099 }
//   cluster.key          the gateways' API key, alone and owner-only (as offload.key):
//                        sent only to /v1/models
//   cluster-status.key   the status services' key, a separate secret, alone and
//                        owner-only: sent only to /status
//   Either may be absent (that request is skipped); neither is ever logged or returned.
//
// Per node, in parallel, each with a short timeout:
//   GET http://<host>:<gatewayPort>/health       no key: { status, backends: { url: bool } } (503 = no live backend)
//   GET http://<host>:<gatewayPort>/v1/models    cluster.key: the model ids the gateway serves
//   GET http://<host>:<statusPort>/status        cluster-status.key: GPUs, CPU and RAM, jobs, endpoints (optional — a
//                                                node without the service says so)
// then, for each port in MODEL_SERVER_PORTS the status service reports listening (other than
// the gateway and status ports):
//   GET http://<host>:<port>/v1/models           no key: a model server running outside the gateway
//                                                (a llama-server for an experiment); no key is ever
//                                                sent to it, so one that wants a key reads "needs a key"
//
// Polled only while someone looks: the first /api/cluster read starts the poller,
// and it stops itself once no read came for `activeMs`. A cluster nobody has open
// gets no traffic from glass. glass spawns no shell (manifest forbidden.spawn):
// every fact here is an HTTP answer.
import fs from 'node:fs';
import path from 'node:path';

export const CLUSTER_POLL_MS = 15_000;
/** Ports where a node's status endpoints are asked whether they serve models; at most MAX_SERVERS per node. */
export const MODEL_SERVER_PORTS = { from: 8000, to: 8999 };
const MAX_SERVERS = 4;
const NAME = /^[A-Za-z0-9._-]{1,64}$/;
const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*$|^\[[0-9A-Fa-f:.]+\]$/;
const MAX_NODES = 256;

const port = (v, d) => (Number.isInteger(v) && v > 0 && v < 65536 ? v : d);

/**
 * The cluster.json shape, validated: unknown keys dropped, bad nodes skipped and
 * named in `problems`. Absent or unreadable → { configured: false }.
 */
export function normalizeClusterConfig(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes)) return { configured: false, problems: raw ? ['cluster.json has no "nodes" list'] : [] };
  const problems = [];
  const seen = new Set();
  const nodes = [];
  for (const [i, n] of raw.nodes.entries()) {
    const name = String(n?.name ?? '').trim();
    const host = String(n?.host ?? '').trim();
    if (!NAME.test(name) || !HOST.test(host) || host.length > 253) { problems.push(`node ${i + 1}: needs a name and a host name or IP`); continue; }
    if (seen.has(name)) { problems.push(`node ${name}: listed twice`); continue; }
    seen.add(name);
    nodes.push({ name, host });
    if (nodes.length === MAX_NODES) { problems.push(`more than ${MAX_NODES} nodes: the rest are left out`); break; }
  }
  return {
    configured: true,
    nodes,
    gatewayPort: port(raw.gatewayPort, 8000),
    statusPort: port(raw.statusPort, 8099),
    problems,
  };
}

/** cluster.json and the two key files in `home`, each re-read on every poll. */
export function createClusterStore(home, { platform = process.platform } = {}) {
  const file = path.join(home, 'cluster.json');
  const keyFiles = { gateway: path.join(home, 'cluster.key'), status: path.join(home, 'cluster-status.key') };
  const stat = (f) => { try { return fs.statSync(f); } catch { return null; } };
  let cached = null;
  let cachedMtime = -1;

  function getConfig() {
    const m = stat(file)?.mtimeMs ?? 0;
    if (cached && m === cachedMtime) return cached;
    let raw = null;
    let unreadable = '';
    if (m) {
      try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { unreadable = `cluster.json is not valid JSON (${err.message.slice(0, 80)})`; }
    }
    cached = unreadable ? { configured: false, problems: [unreadable] } : normalizeClusterConfig(raw);
    cachedMtime = m;
    return cached;
  }

  /**
   * The key, or '' — with why when there is a file that cannot be used. A key file
   * other users can read is refused (POSIX only; Windows has no such mode bits):
   * the devcontainer and `chmod 600` both make it owner-only.
   */
  function readKey(which = 'gateway') {
    const f = keyFiles[which];
    const name = path.basename(f);
    const s = stat(f);
    if (!s) return { key: '', problem: '' };
    if (platform !== 'win32' && (s.mode & 0o077)) return { key: '', problem: `${name} is readable by other users — make it owner-only (chmod 600)` };
    try { return { key: fs.readFileSync(f, 'utf8').trim(), problem: '' }; } catch { return { key: '', problem: `${name} cannot be read` }; }
  }

  /** Writes a key owner-only ('' removes it); true when one is set. Offload's settings write cluster.key. */
  function writeKey(which, key) {
    const f = keyFiles[which];
    const k = String(key || '').trim();
    if (!k) { try { fs.rmSync(f); } catch { /* none */ } return false; }
    fs.mkdirSync(home, { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${k}\n`, { mode: 0o600 });
    fs.renameSync(tmp, f);
    return true;
  }

  return { getConfig, readKey, writeKey, file, keyFiles };
}

/**
 * GET `url` with a timeout; { status, body } (body parsed JSON or null) or { error }.
 *
 * The timeout is an ordinary timer, cleared once the body is read — not
 * AbortSignal.timeout(), whose timer is unref'd: when nothing else holds the event
 * loop (no socket yet), Node 22 exits with the request still pending instead of
 * timing it out.
 */
async function getJson(fetch, url, { key = '', timeoutMs }) {
  const t0 = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new DOMException('timed out', 'TimeoutError')), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      signal: abort.signal,
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body, ms: Date.now() - t0 };
  } catch (err) {
    const cause = err?.cause?.code || err?.code || '';
    const msg = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? `no answer within ${timeoutMs} ms` : (cause || String(err?.message || err));
    return { error: msg.slice(0, 160), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v, max = 200) => (v == null ? '' : String(v).slice(0, max));

/** The status service's answer, keeping only the contract's fields. */
export function normalizeStatus(body) {
  const b = body && typeof body === 'object' ? body : {};
  const gpus = (Array.isArray(b.gpus) ? b.gpus : []).slice(0, 16).map((g) => ({
    index: finite(g?.index), name: str(g?.name, 80), utilPct: finite(g?.util_pct),
    memUsedMib: finite(g?.mem_used_mib), memTotalMib: finite(g?.mem_total_mib), tempC: finite(g?.temp_c),
  }));
  const jobs = (Array.isArray(b.jobs) ? b.jobs : []).slice(0, 50).map((j) => ({
    id: str(j?.id, 80), name: str(j?.name, 120), image: str(j?.image, 200), status: str(j?.status, 60),
    started: j?.started ? str(j.started, 40) : null, gpu: j?.gpu == null ? null : str(j.gpu, 40),
    // 'llm' (training, inference) or 'other' (a build, any non-LLM work); null when the service does not say.
    kind: j?.kind === 'llm' || j?.kind === 'other' ? j.kind : null,
  }));
  const endpoints = (Array.isArray(b.endpoints) ? b.endpoints : []).slice(0, 50)
    .map((e) => ({ port: finite(e?.port), process: str(e?.process, 80) }))
    .filter((e) => e.port != null);
  const gw = b.gateway && typeof b.gateway === 'object' ? b.gateway : null;
  // The node itself: CPU busy share and load, RAM (used = total − available). null when not sent.
  const h = b.host && typeof b.host === 'object' ? b.host : null;
  const host = h ? {
    cpuCount: finite(h.cpu_count), cpuPct: finite(h.cpu_pct),
    load: Array.isArray(h.load) ? h.load.slice(0, 3).map(finite) : null,
    memTotalMib: finite(h.mem_total_mib), memUsedMib: finite(h.mem_used_mib), memAvailableMib: finite(h.mem_available_mib),
  } : null;
  return {
    ts: b.ts ? str(b.ts, 40) : null,
    gpus, host, jobs, endpoints,
    gateway: gw ? { port: finite(gw.port), healthy: typeof gw.healthy === 'boolean' ? gw.healthy : null } : null,
  };
}

/** A model server's /v1/models answer: { port, ids, error }, or null when the port does not speak it. */
export function modelServerOf(port, res) {
  if (!res || res.error) return null;
  if (res.status === 401 || res.status === 403) return { port, ids: [], error: 'needs a key' };
  const data = res.status === 200 && Array.isArray(res.body?.data) ? res.body.data : null;
  if (!data) return null;
  return { port, ids: data.slice(0, 32).map((m) => str(m?.id, 200)).filter(Boolean), error: '' };
}

const backendsOf = (b) => (b && typeof b.backends === 'object' && b.backends
  ? Object.fromEntries(Object.entries(b.backends).slice(0, 32).map(([u, ok]) => [str(u, 200), Boolean(ok)]))
  : {});

/** One node, probed: gateway health, its models, its status service. */
export async function probeNode(node, { fetch, key = '', statusKey = '', gatewayPort, statusPort, timeoutMs, keyProblem = '', statusKeyProblem = '' }) {
  const gw = `http://${node.host}:${gatewayPort}`;
  const [health, models, status] = await Promise.all([
    getJson(fetch, `${gw}/health`, { timeoutMs }),
    key ? getJson(fetch, `${gw}/v1/models`, { key, timeoutMs }) : Promise.resolve(null),
    statusKey ? getJson(fetch, `http://${node.host}:${statusPort}/status`, { key: statusKey, timeoutMs }) : Promise.resolve(null),
  ]);
  const noKey = keyProblem || 'no gateway key';
  const noStatusKey = statusKeyProblem || 'no status key';

  const gateway = health.error
    ? { endpoint: `${node.host}:${gatewayPort}`, reachable: false, healthy: false, status: '', backends: {}, latencyMs: null, error: health.error }
    : {
      endpoint: `${node.host}:${gatewayPort}`, reachable: true,
      // The gateway answers 503 when none of its backends is live.
      healthy: health.status === 200,
      status: str(health.body?.status, 40) || `HTTP ${health.status}`,
      backends: backendsOf(health.body), latencyMs: health.ms,
      error: health.status === 503 ? 'no backend live' : (health.status >= 400 ? `HTTP ${health.status}` : ''),
    };

  let modelView = { ids: [], adapters: [], error: noKey };
  if (models) {
    if (models.error) modelView = { ids: [], adapters: [], error: models.error };
    else if (models.status === 401 || models.status === 403) modelView = { ids: [], adapters: [], error: 'the gateway refused cluster.key' };
    else if (models.status !== 200) modelView = { ids: [], adapters: [], error: `HTTP ${models.status}` };
    else {
      const data = (Array.isArray(models.body?.data) ? models.body.data : []).slice(0, 32);
      modelView = {
        ids: data.map((m) => str(m?.id, 120)).filter(Boolean),
        // A fine-tuning adapter names its base model as `parent` (vLLM's LoRA modules); a base model has none.
        adapters: data.filter((m) => m?.parent && m.parent !== m.id).map((m) => str(m.id, 120)).filter(Boolean),
        error: '',
      };
    }
  }

  // 'absent' — nothing listens on the status port (not deployed on this node yet).
  let statusView = { state: 'no-key', error: noStatusKey, ts: null, gpus: [], host: null, jobs: [], endpoints: [], gateway: null };
  if (status) {
    if (status.error) statusView = { ...statusView, state: 'absent', error: status.error };
    else if (status.status === 401 || status.status === 403) statusView = { ...statusView, state: 'unauthorized', error: 'the status service refused cluster-status.key' };
    else if (status.status !== 200) statusView = { ...statusView, state: 'error', error: `HTTP ${status.status}` };
    else statusView = { state: 'ok', error: '', ...normalizeStatus(status.body) };
  }

  const ports = statusView.endpoints.map((e) => e.port)
    .filter((p) => p >= MODEL_SERVER_PORTS.from && p <= MODEL_SERVER_PORTS.to && p !== gatewayPort && p !== statusPort)
    .slice(0, MAX_SERVERS);
  const servers = (await Promise.all(ports.map((p) => getJson(fetch, `http://${node.host}:${p}/v1/models`, { timeoutMs })
    .then((res) => modelServerOf(p, res))))).filter(Boolean);

  const answered = gateway.reachable || (models && !models.error) || (status && !status.error);
  return { up: Boolean(answered), gateway, models: modelView, status: statusView, servers };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** One history point: up, the GPUs' mean utilisation and memory share, the host's CPU and RAM share, gateway latency. */
export function sampleOf(ts, probe) {
  const gpus = probe.status.gpus || [];
  const util = mean(gpus.map((g) => g.utilPct).filter((v) => v != null));
  const mem = mean(gpus.filter((g) => g.memUsedMib != null && g.memTotalMib).map((g) => (100 * g.memUsedMib) / g.memTotalMib));
  const host = probe.status.host;
  const ram = host?.memUsedMib != null && host?.memTotalMib ? (100 * host.memUsedMib) / host.memTotalMib : null;
  const pct = (v) => (v == null ? null : Math.round(v));
  return {
    ts, up: probe.up, utilPct: pct(util), memPct: pct(mem),
    cpuPct: pct(host?.cpuPct ?? null), ramPct: pct(ram), latencyMs: probe.gateway.latencyMs,
  };
}

/**
 * Whether this machine can reach the cluster at all, from one poll's probes:
 *   'reachable'    some node answered
 *   'nodes-down'   none answered, but some host refused the connection — the network
 *                  path is there and nothing listens
 *   'unreachable'  none answered and none refused: every request timed out or had no
 *                  route — what a cluster on a private network looks like from outside it
 *                  (off VPN). Its tiles would only repeat stale facts, so the page says this instead.
 */
export function reachOf(probes) {
  if (!probes.length || probes.some((p) => p.up)) return 'reachable';
  const refused = (e) => /ECONNREFUSED/.test(e || '');
  return probes.some((p) => refused(p.gateway?.error) || refused(p.status?.error)) ? 'nodes-down' : 'unreachable';
}

/** A GPU counts as busy at this utilisation or above. */
export const BUSY_UTIL_PCT = 10;

/**
 * @param {object} o
 * @param {string} o.home
 * @param {Function} o.fetch          a fetch that reaches the nodes (the daemon's: private hosts go direct)
 * @param {(line: string) => void} [o.log]
 * @param {number} [o.intervalMs]     between polls while the page is open
 * @param {number} [o.activeMs]       stop polling this long after the last read
 * @param {number} [o.timeoutMs]      per request
 * @param {number} [o.historySize]    samples kept per node (240 = an hour at 15 s, for the node's charts)
 * @param {number} [o.jobLogSize]     jobs kept in the job log
 */
export function createCluster({
  home, fetch, log = () => {}, intervalMs = CLUSTER_POLL_MS, activeMs = 120_000, timeoutMs = 3_000, historySize = 240,
  jobLogSize = 200, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, store = createClusterStore(home),
}) {
  const nodes = new Map(); // name → { last probe, lastSeen, history }
  // node/job id → the job as last seen, with when it was first and last seen: the jobs
  // the status services reported while the page was open, for the history sidebar.
  const jobLog = new Map();
  let polledAt = null;
  let reach = null; // reachOf() of the last poll
  let lastReachedAt = null;
  let polling = null;
  let timer = null;
  let lastRead = 0;
  let signature = '';

  async function poll() {
    if (polling) return polling;
    const cfg = store.getConfig();
    if (!cfg.configured) { nodes.clear(); polledAt = null; return null; }
    // A changed node list drops the history of nodes no longer in it.
    const sig = JSON.stringify([cfg.nodes, cfg.gatewayPort, cfg.statusPort]);
    if (sig !== signature) {
      const names = new Set(cfg.nodes.map((n) => n.name));
      for (const k of [...nodes.keys()]) if (!names.has(k)) nodes.delete(k);
      if (signature) log(`cluster: ${cfg.nodes.length} node(s) configured`);
      signature = sig;
    }
    const { key, problem } = store.readKey('gateway');
    const status = store.readKey('status');
    polling = (async () => {
      const probes = await Promise.all(cfg.nodes.map((n) => probeNode(n, {
        fetch, key, statusKey: status.key, gatewayPort: cfg.gatewayPort, statusPort: cfg.statusPort, timeoutMs,
        keyProblem: problem, statusKeyProblem: status.problem,
      }).catch((err) => ({ up: false, error: String(err?.message || err) }))));
      const ts = new Date(now()).toISOString();
      cfg.nodes.forEach((n, i) => {
        const p = probes[i];
        const prev = nodes.get(n.name) || { history: [], lastSeen: null, hasGateway: false };
        const history = p.gateway ? [...prev.history, sampleOf(ts, p)].slice(-historySize) : prev.history;
        // Once a gateway has answered, the node keeps counting as one that has a gateway:
        // an outage, or this host losing the network, must not shrink "gateways healthy"'s denominator.
        nodes.set(n.name, { probe: p, lastSeen: p.up ? ts : prev.lastSeen, history, hasGateway: prev.hasGateway || Boolean(p.gateway?.reachable) });
        for (const j of p.status?.state === 'ok' ? p.status.jobs : []) {
          const k = `${n.name}/${j.id || j.name}`;
          const firstSeen = jobLog.get(k)?.firstSeen ?? ts;
          jobLog.delete(k); // re-inserted: the Map's order is last-seen order
          jobLog.set(k, { ...j, node: n.name, host: n.host, firstSeen, lastSeen: ts });
        }
      });
      while (jobLog.size > jobLogSize) jobLog.delete(jobLog.keys().next().value);
      reach = reachOf(probes);
      if (reach === 'reachable') lastReachedAt = ts;
      polledAt = ts;
    })();
    try { await polling; } finally { polling = null; }
    return polledAt;
  }

  function schedule() {
    if (timer) return;
    timer = setTimer(async function tick() {
      timer = null;
      if (now() - lastRead > activeMs || !store.getConfig().configured) return; // nobody looking: stop
      try { await poll(); } catch (err) { log(`ERROR cluster poll: ${err.message}`); }
      schedule();
    }, intervalMs);
    timer?.unref?.();
  }

  function view() {
    const cfg = store.getConfig();
    if (!cfg.configured) return { configured: false, ...(cfg.problems?.length ? { problems: cfg.problems } : {}) };
    const { key, problem } = store.readKey('gateway');
    const status = store.readKey('status');
    const list = cfg.nodes.map((n) => {
      const s = nodes.get(n.name);
      const p = s?.probe;
      return {
        name: n.name, host: n.host,
        up: p ? p.up : null,
        lastSeen: s?.lastSeen ?? null,
        gateway: p?.gateway ?? null,
        models: p?.models ?? null,
        servers: p?.servers ?? [],
        status: p?.status ?? null,
        history: s?.history ?? [],
      };
    });
    const gpus = list.flatMap((n) => (n.up ? n.status?.gpus ?? [] : []));
    return {
      configured: true,
      gatewayPort: cfg.gatewayPort, statusPort: cfg.statusPort,
      keySet: Boolean(key), keyProblem: problem,
      statusKeySet: Boolean(status.key), statusKeyProblem: status.problem,
      problems: cfg.problems,
      polledAt, intervalMs, reach, lastReachedAt,
      jobLog: [...jobLog.values()].reverse(),
      summary: {
        nodes: list.length,
        up: list.filter((n) => n.up).length,
        down: list.filter((n) => n.up === false).length,
        gateways: cfg.nodes.filter((n) => nodes.get(n.name)?.hasGateway).length,
        gatewaysHealthy: list.filter((n) => n.gateway?.healthy).length,
        gpus: gpus.length,
        gpusBusy: gpus.filter((g) => (g.utilPct ?? 0) >= BUSY_UTIL_PCT).length,
        jobs: list.reduce((a, n) => a + (n.up ? n.status?.jobs?.length ?? 0 : 0), 0),
        statusServices: list.filter((n) => n.status?.state === 'ok').length,
      },
      nodes: list,
    };
  }

  /** The page's read: marks it watched, polls first when there is nothing yet. */
  async function read() {
    lastRead = now();
    const cfg = store.getConfig();
    if (!cfg.configured) return view();
    // Nothing yet, or cluster.json changed since the last poll: answer with fresh facts.
    if (!polledAt || JSON.stringify([cfg.nodes, cfg.gatewayPort, cfg.statusPort]) !== signature) await poll();
    schedule();
    return view();
  }

  function stop() { if (timer) { clearTimer(timer); timer = null; } }

  /** Whether cluster.json configures a cluster — for the UI's tab, without starting the poller. */
  const peek = () => ({ configured: store.getConfig().configured });

  return { read, view, peek, poll, stop, store };
}
