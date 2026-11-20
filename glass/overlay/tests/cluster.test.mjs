// tests/cluster.test.mjs — the Cluster page's daemon side: cluster.json gating, the
// owner-only key, and the poller's aggregation against stubbed node answers (no
// network: the fetch is injected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createCluster, createClusterStore, normalizeClusterConfig, normalizeStatus, probeNode, sampleOf } = await import('../lib/glass/cluster.mjs');
const { createKeyStore, parseEnv, setEnvLine } = await import('../lib/glass/keys.mjs');

// Two separate secrets: the gateways' key and the status services' key.
const KEY = 'unit-fixture-token';
const STATUS_KEY = 'unit-fixture-status-token';
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'glass-cluster-'));
const writeCfg = (home, cfg) => fs.writeFileSync(path.join(home, 'cluster.json'), JSON.stringify(cfg));
const writeSecret = (home, name, value, mode) => {
  const f = path.join(home, name);
  fs.writeFileSync(f, `${value}\n`, { mode });
  fs.chmodSync(f, mode);
};
// One variable of GLASS_HOME/.env, the rest of the file kept.
const writeVar = (home, name, value, mode = 0o600) => {
  const f = path.join(home, '.env');
  let text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch { /* new */ }
  fs.writeFileSync(f, setEnvLine(text, name, value), { mode });
  fs.chmodSync(f, mode);
};
const readVar = (home, name) => { try { return parseEnv(fs.readFileSync(path.join(home, '.env'), 'utf8'))[name]; } catch { return undefined; } };
const writeKey = (home, mode = 0o600) => writeVar(home, 'CLUSTER_OPS_KEY', KEY, mode);
const writeStatusKey = (home, mode = 0o600) => writeVar(home, 'CLUSTER_MON_KEY', STATUS_KEY, mode);
const writeKeys = (home) => { writeKey(home); writeStatusKey(home); };

const res = (status, body) => ({ status, json: async () => body });
const refused = () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; };

/**
 * Two nodes: a answers everything; b has a gateway with no live backend and no
 * status service. Records every request with its auth header.
 */
function stubFetch(calls = []) {
  return async (url, init) => {
    const auth = init?.headers?.authorization || '';
    calls.push({ url, auth });
    const authed = auth === `Bearer ${KEY}`;
    const statusAuthed = auth === `Bearer ${STATUS_KEY}`;
    if (url === 'http://192.0.2.1:8000/health') return res(200, { status: 'ok', backends: { 'http://127.0.0.1:8001': true } });
    if (url === 'http://192.0.2.1:8000/v1/models') return authed ? res(200, { data: [{ id: 'm-small' }, { id: 'm-large' }] }) : res(401, { error: 'invalid API key' });
    if (url === 'http://192.0.2.1:8099/status') {
      return statusAuthed ? res(200, {
        node: 'a', ts: '2026-11-15T10:00:00Z',
        gpus: [{ index: 0, name: 'GPU', util_pct: 64, mem_used_mib: 12000, mem_total_mib: 16000, temp_c: 61 }],
        jobs: [{ id: 'j1', name: 'train', image: 'img:1', status: 'running', started: '2026-11-15T09:00:00Z', gpu: '0' }],
        endpoints: [{ port: 8000, process: 'gateway' }, { port: 8001, process: 'server' }],
        gateway: { port: 8000, healthy: true, backends: {} },
      }) : res(401, { error: 'invalid API key' });
    }
    if (url === 'http://192.0.2.2:8000/health') return res(503, { status: 'no backend', backends: { 'http://127.0.0.1:8001': false } });
    if (url === 'http://192.0.2.2:8000/v1/models') return res(200, { data: [] });
    if (url.startsWith('http://192.0.2.2:8099/')) return refused();
    return refused();
  };
}

const CFG = { nodes: [{ name: 'a', host: '192.0.2.1' }, { name: 'b', host: '192.0.2.2' }, { name: 'c', host: '192.0.2.3' }] };

test('no cluster.json → configured: false, and no request is made', async () => {
  const home = tmpHome();
  const calls = [];
  const c = createCluster({ home, fetch: stubFetch(calls) });
  assert.deepEqual(await c.read(), { configured: false });
  assert.equal(calls.length, 0);
  c.stop();
});

test('an unparseable cluster.json is not configured and says why', async () => {
  const home = tmpHome();
  fs.writeFileSync(path.join(home, 'cluster.json'), '{ nodes: ');
  const v = await createCluster({ home, fetch: stubFetch() }).read();
  assert.equal(v.configured, false);
  assert.match(v.problems[0], /not valid JSON/);
});

test('normalizeClusterConfig keeps valid nodes, names the bad ones, defaults the ports', () => {
  const n = normalizeClusterConfig({ nodes: [{ name: 'a', host: '192.0.2.1' }, { name: 'a', host: '192.0.2.9' }, { name: 'x y', host: 'h' }, { name: 'b', host: 'node-b.example' }], gatewayPort: 'x' });
  assert.deepEqual(n.nodes.map((x) => x.name), ['a', 'b']);
  assert.equal(n.gatewayPort, 8000);
  assert.equal(n.statusPort, 8099);
  assert.equal(n.problems.length, 2);
  assert.equal(n.name, '');
  assert.equal(normalizeClusterConfig({}).configured, false);
});

test('normalizeClusterConfig keeps a short cluster name for the title', () => {
  const nodes = [{ name: 'a', host: '192.0.2.1' }];
  assert.equal(normalizeClusterConfig({ name: ' Turing ', nodes }).name, 'Turing');
  assert.equal(normalizeClusterConfig({ name: 'x'.repeat(65), nodes }).name, '');
});

test('each key goes only to its own service — gateway key to /v1/models, status key to /status — never to /health, never in the view', async () => {
  const home = tmpHome();
  writeCfg(home, CFG);
  writeKeys(home);
  const calls = [];
  const c = createCluster({ home, fetch: stubFetch(calls), timeoutMs: 500 });
  const v = await c.read();
  c.stop();
  assert.equal(v.configured, true);
  assert.equal(v.keySet, true);
  assert.equal(v.statusKeySet, true);
  for (const call of calls) {
    if (call.url.endsWith('/health')) assert.equal(call.auth, '', `${call.url} carries no key`);
    else if (call.url.endsWith(':8000/v1/models')) assert.equal(call.auth, `Bearer ${KEY}`);
    else if (call.url.endsWith('/v1/models')) assert.equal(call.auth, '', `${call.url} is no gateway: no key`);
    else if (call.url.endsWith('/status')) assert.equal(call.auth, `Bearer ${STATUS_KEY}`);
    else assert.fail(`unexpected request ${call.url}`);
  }
  const text = JSON.stringify(v);
  assert.ok(!text.includes(KEY) && !text.includes(STATUS_KEY), 'neither key is anywhere in the view');
});

test('aggregation: up/down, gateway health, models, GPUs, jobs, an absent status service', async () => {
  const home = tmpHome();
  writeCfg(home, CFG);
  writeKeys(home);
  const c = createCluster({ home, fetch: stubFetch(), timeoutMs: 500 });
  const v = await c.read();
  c.stop();
  const [a, b, cNode] = v.nodes;

  assert.equal(a.up, true);
  assert.equal(a.gateway.healthy, true);
  assert.equal(a.gateway.endpoint, '192.0.2.1:8000');
  assert.deepEqual(a.models.ids, ['m-small', 'm-large']);
  assert.equal(a.status.state, 'ok');
  assert.equal(a.status.gpus[0].utilPct, 64);
  assert.equal(a.status.jobs[0].name, 'train');
  assert.equal(a.history.length, 1);
  assert.equal(a.history[0].utilPct, 64);
  assert.equal(a.history[0].memPct, 75);
  assert.ok(a.lastSeen);

  assert.equal(b.up, true, 'a gateway that answers 503 is still a node that is up');
  assert.equal(b.gateway.healthy, false);
  assert.equal(b.gateway.error, 'no backend live');
  assert.equal(b.status.state, 'absent', 'nothing on the status port');

  assert.equal(cNode.up, false);
  assert.equal(cNode.gateway.reachable, false);
  assert.equal(cNode.lastSeen, null);

  assert.deepEqual(v.summary, { nodes: 3, up: 2, down: 1, gateways: 2, gatewaysHealthy: 1, gpus: 1, gpusBusy: 1, jobs: 1, statusServices: 1 });
});

test('a node whose gateway once answered keeps counting among the gateways when it goes silent', async () => {
  const home = tmpHome();
  writeCfg(home, CFG);
  let offline = false;
  const online = stubFetch();
  const c = createCluster({ home, fetch: (url, init) => (offline ? refused() : online(url, init)), timeoutMs: 500 });
  assert.equal((await c.read()).summary.gateways, 2);
  offline = true;
  await c.poll();
  const s = c.view().summary;
  c.stop();
  assert.equal(s.up, 0);
  assert.equal(s.gatewaysHealthy, 0);
  assert.equal(s.gateways, 2, 'losing the network shows 0 / 2, not 0 / 0');
});

test('a model whose /v1/models entry names a parent is an adapter; a base model is not', async () => {
  const home = tmpHome();
  writeCfg(home, { nodes: [CFG.nodes[0]] });
  writeKeys(home);
  const online = stubFetch();
  const fetch = async (url, init) => (url.endsWith('/v1/models')
    ? res(200, { data: [{ id: 'qwen-base', parent: null }, { id: 'qwen-lora-ab', parent: 'qwen-base' }] })
    : online(url, init));
  const v = await createCluster({ home, fetch, timeoutMs: 500 }).read();
  assert.deepEqual(v.nodes[0].models.ids, ['qwen-base', 'qwen-lora-ab']);
  assert.deepEqual(v.nodes[0].models.adapters, ['qwen-lora-ab']);
});

test('the job log keeps every job seen, newest first, with when it was first and last seen', async () => {
  const home = tmpHome();
  writeCfg(home, CFG);
  writeKeys(home);
  let t = Date.parse('2026-11-19T10:00:00Z');
  const c = createCluster({ home, fetch: stubFetch(), timeoutMs: 500, now: () => t });
  await c.read();
  t += 15_000;
  await c.poll();
  const v = c.view();
  c.stop();
  assert.equal(v.jobLog.length, 1, 'the same job on the same node is one entry');
  const j = v.jobLog[0];
  assert.equal(j.node, 'a');
  assert.equal(j.name, 'train');
  assert.equal(j.kind, null, 'a status service that does not say what kind leaves it open');
  assert.equal(j.firstSeen, '2026-11-19T10:00:00.000Z');
  assert.equal(j.lastSeen, '2026-11-19T10:00:15.000Z');
});

test('normalizeStatus passes a job\'s kind through only when it is llm or other', () => {
  const s = normalizeStatus({ jobs: [{ id: '1', kind: 'llm' }, { id: '2', kind: 'other' }, { id: '3', kind: 'gpu' }] });
  assert.deepEqual(s.jobs.map((j) => j.kind), ['llm', 'other', null]);
});

test('reach: reachable while a node answers; nodes-down when hosts refuse; unreachable when nothing answers at all', async () => {
  const home = tmpHome();
  writeCfg(home, CFG);
  writeKeys(home);
  const noRoute = () => { const e = new TypeError('fetch failed'); e.cause = { code: 'EHOSTUNREACH' }; throw e; };
  let mode = 'online';
  const online = stubFetch();
  const c = createCluster({ home, fetch: (url, init) => (mode === 'online' ? online(url, init) : mode === 'refused' ? refused() : noRoute()), timeoutMs: 500 });
  const first = await c.read();
  assert.equal(first.reach, 'reachable');
  assert.equal(first.lastReachedAt, first.polledAt);

  mode = 'refused';
  await c.poll();
  assert.equal(c.view().reach, 'nodes-down', 'a refused connection means the network path is there');

  mode = 'offline';
  await c.poll();
  const v = c.view();
  c.stop();
  assert.equal(v.reach, 'unreachable');
  assert.equal(v.lastReachedAt, first.polledAt, 'when it was last reached is kept');
});

test('without either key only /health is read, and the view says so', async () => {
  const home = tmpHome();
  writeCfg(home, { nodes: [CFG.nodes[0]] });
  const calls = [];
  const v = await createCluster({ home, fetch: stubFetch(calls) }).read();
  assert.deepEqual(calls.map((x) => x.url), ['http://192.0.2.1:8000/health']);
  assert.equal(v.keySet, false);
  assert.equal(v.statusKeySet, false);
  assert.equal(v.nodes[0].status.state, 'no-key');
  assert.equal(v.nodes[0].status.error, 'no status key');
  assert.equal(v.nodes[0].models.error, 'no gateway key');
});

test('only the gateway key: /v1/models is read, /status is skipped ("no status key")', async () => {
  const home = tmpHome();
  writeCfg(home, { nodes: [CFG.nodes[0]] });
  writeKey(home);
  const calls = [];
  const v = await createCluster({ home, fetch: stubFetch(calls) }).read();
  assert.deepEqual(calls.map((x) => x.url).sort(), ['http://192.0.2.1:8000/health', 'http://192.0.2.1:8000/v1/models']);
  assert.deepEqual(v.nodes[0].models.ids, ['m-small', 'm-large']);
  assert.equal(v.nodes[0].status.state, 'no-key');
  assert.equal(v.nodes[0].status.error, 'no status key');
});

test('only the status key: /status is read, /v1/models is skipped ("no gateway key")', async () => {
  const home = tmpHome();
  writeCfg(home, { nodes: [CFG.nodes[0]] });
  writeStatusKey(home);
  const calls = [];
  const v = await createCluster({ home, fetch: stubFetch(calls) }).read();
  // :8001 is the model-server probe of a port the status service listed — never with a key.
  assert.deepEqual(calls.map((x) => x.url).sort(), ['http://192.0.2.1:8000/health', 'http://192.0.2.1:8001/v1/models', 'http://192.0.2.1:8099/status']);
  assert.equal(calls.find((x) => x.url.endsWith(':8001/v1/models')).auth, '');
  assert.equal(calls.find((x) => x.url.endsWith('/status')).auth, `Bearer ${STATUS_KEY}`);
  assert.equal(v.keySet, false);
  assert.equal(v.statusKeySet, true);
  assert.equal(v.nodes[0].status.state, 'ok');
  assert.equal(v.nodes[0].models.error, 'no gateway key');
});

test('a .env other users can read is refused, for both keys (POSIX)', { skip: process.platform === 'win32' }, async () => {
  const home = tmpHome();
  writeCfg(home, { nodes: [CFG.nodes[0]] });
  writeKey(home);
  writeStatusKey(home, 0o644);
  const calls = [];
  const v = await createCluster({ home, fetch: stubFetch(calls) }).read();
  assert.equal(v.keySet, false);
  assert.equal(v.statusKeySet, false);
  assert.match(v.keyProblem, /\.env is readable by other users/);
  assert.ok(calls.every((x) => x.auth === ''), 'the refused keys are sent nowhere');
  assert.match(createClusterStore(home).readKey('gateway').problem, /chmod 600/);
});

test('a refused key reads as such, not as an outage', async () => {
  const p = await probeNode({ name: 'a', host: '192.0.2.1' }, {
    fetch: stubFetch(), key: 'wrong', statusKey: KEY, gatewayPort: 8000, statusPort: 8099, timeoutMs: 500,
  });
  assert.equal(p.up, true);
  assert.equal(p.models.error, 'the gateway refused CLUSTER_OPS_KEY');
  assert.equal(p.status.state, 'unauthorized');
});

test('a node that never answers times out instead of hanging the read', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const t0 = Date.now();
  const p = await probeNode({ name: 'a', host: '192.0.2.1' }, { fetch: hang, key: KEY, statusKey: STATUS_KEY, gatewayPort: 8000, statusPort: 8099, timeoutMs: 100 });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(p.up, false);
  assert.match(p.gateway.error, /no answer within 100 ms/);
});

test('polls only while read: the timer stops itself once no read came for activeMs', async () => {
  const home = tmpHome();
  writeCfg(home, { nodes: [CFG.nodes[0]] });
  let t = 1_000_000;
  const timers = [];
  const calls = [];
  const c = createCluster({
    home, fetch: stubFetch(calls), now: () => t, activeMs: 60_000, intervalMs: 15_000,
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {},
  });
  await c.read();
  assert.equal(calls.length, 1);
  assert.equal(timers.length, 1, 'a read schedules the next poll');
  t += 15_000;
  await timers[0]();
  assert.equal(calls.length, 2, 'still watched → polled');
  assert.equal(timers.length, 2, 'and rescheduled');
  assert.equal(c.view().nodes[0].history.length, 2);
  t += 120_000;
  await timers[1]();
  assert.equal(calls.length, 2, 'nobody read for longer than activeMs → no poll');
  assert.equal(timers.length, 2, 'and no further timer');
});

test('history is capped at historySize', async () => {
  const home = tmpHome();
  writeCfg(home, { nodes: [CFG.nodes[0]] });
  const c = createCluster({ home, fetch: stubFetch(), historySize: 3, setTimer: () => null, clearTimer: () => {} });
  for (let i = 0; i < 5; i++) await c.poll();
  assert.equal(c.view().nodes[0].history.length, 3);
});

test('a model server outside the gateway: ports the status service reports in 8000–8999 are asked /v1/models, with no key', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, auth: init?.headers?.authorization || '' });
    if (url === 'http://192.0.2.5:8099/status') {
      return res(200, { endpoints: [22, 8000, 8001, 8002, 8003, 8099, 9000].map((port) => ({ port, process: 'unknown' })) });
    }
    if (url === 'http://192.0.2.5:8001/v1/models') return res(200, { data: [{ id: '/home/u/Qwen-4B.gguf' }] });
    if (url === 'http://192.0.2.5:8002/v1/models') return res(401, { error: 'invalid API key' });
    if (url === 'http://192.0.2.5:8003/v1/models') return res(404, null); // listens, but no model server
    return refused();
  };
  const p = await probeNode({ name: 'e', host: '192.0.2.5' }, { fetch, key: KEY, statusKey: STATUS_KEY, gatewayPort: 8000, statusPort: 8099, timeoutMs: 500 });
  assert.deepEqual(p.servers, [{ port: 8001, ids: ['/home/u/Qwen-4B.gguf'], error: '' }, { port: 8002, ids: [], error: 'needs a key' }]);
  const asked = calls.filter((c) => /:(800[1-3]|9000|22)\//.test(c.url));
  assert.deepEqual(asked.map((c) => c.url).sort(), ['http://192.0.2.5:8001/v1/models', 'http://192.0.2.5:8002/v1/models', 'http://192.0.2.5:8003/v1/models']);
  assert.ok(asked.every((c) => c.auth === ''), 'neither key reaches a model server outside the gateway');
});

test('no status service, no model-server requests: the ports come only from its endpoints', async () => {
  const calls = [];
  const p = await probeNode({ name: 'b', host: '192.0.2.2' }, { fetch: stubFetch(calls), key: KEY, statusKey: STATUS_KEY, gatewayPort: 8000, statusPort: 8099, timeoutMs: 500 });
  assert.deepEqual(p.servers, []);
  assert.ok(!calls.some((c) => /:80(0[1-9]|[1-9]\d)\//.test(c.url) && !c.url.includes(':8099/')));
});

test('normalizeStatus keeps the contract fields only', () => {
  const s = normalizeStatus({ gpus: [{ index: 0, util_pct: '12', secret: 'x' }], jobs: [{ id: 1, name: 'n', env: { A: 1 } }], endpoints: [{ port: 22 }, { process: 'no port' }] });
  assert.deepEqual(Object.keys(s.gpus[0]).sort(), ['index', 'memTotalMib', 'memUsedMib', 'name', 'tempC', 'utilPct']);
  assert.equal(s.gpus[0].utilPct, 12);
  assert.ok(!('env' in s.jobs[0]));
  assert.equal(s.endpoints.length, 1);
});

test('normalizeStatus keeps the host block: CPU, load and RAM', () => {
  const s = normalizeStatus({ host: { cpu_count: 32, cpu_pct: '41.5', load: [3.52, 2.1, 1.75, 9], mem_total_mib: 128799, mem_used_mib: 32543, mem_available_mib: 96256, cmdline: 'x' } });
  assert.deepEqual(s.host, { cpuCount: 32, cpuPct: 41.5, load: [3.52, 2.1, 1.75], memTotalMib: 128799, memUsedMib: 32543, memAvailableMib: 96256 });
  assert.equal(normalizeStatus({}).host, null);
});

test('a sample carries the host CPU and RAM share', () => {
  const probe = { up: true, gateway: { latencyMs: 5 }, status: { gpus: [], host: { cpuPct: 41.5, memUsedMib: 32, memTotalMib: 128 } } };
  const s = sampleOf('t', probe);
  assert.equal(s.cpuPct, 42);
  assert.equal(s.ramPct, 25);
  assert.equal(s.utilPct, null);
  assert.equal(sampleOf('t', { ...probe, status: { gpus: [], host: null } }).cpuPct, null);
});

test('peek answers whether a cluster is configured and polls nothing', async () => {
  const home = tmpHome();
  const calls = [];
  const c = createCluster({ home, fetch: stubFetch(calls) });
  assert.deepEqual(c.peek(), { configured: false });
  writeCfg(home, CFG);
  assert.deepEqual(c.peek(), { configured: true });
  assert.equal(calls.length, 0);
});

test('a changed cluster.json is polled on the next read, and dropped nodes lose their history', async () => {
  const home = tmpHome();
  writeCfg(home, { nodes: [CFG.nodes[0]] });
  const c = createCluster({ home, fetch: stubFetch(), setTimer: () => null, clearTimer: () => {} });
  await c.read();
  writeCfg(home, { nodes: [CFG.nodes[1]], gatewayPort: 8000 });
  // mtime granularity: make sure the store sees a change
  const f = path.join(home, 'cluster.json');
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(f, t, t);
  const v = await c.read();
  assert.deepEqual(v.nodes.map((n) => [n.name, n.up]), [['b', true]]);
  assert.equal(v.nodes[0].history.length, 1);
});

// ── offload to a cluster gateway: one secret, one file ──
const { createOffloadStore, isClusterGateway } = await import('../lib/glass/offload-store.mjs');
const offloadHome = (url) => {
  const home = tmpHome();
  writeCfg(home, { nodes: [{ name: 'n1', host: '192.0.2.10' }], gatewayPort: 8000 });
  fs.writeFileSync(path.join(home, 'offload.json'), JSON.stringify({ enabled: true, target: { name: 't', url } }));
  return home;
};
const has = (home, f) => fs.existsSync(path.join(home, f));

test('isClusterGateway: a node host on the gateway port, nothing else', () => {
  const c = normalizeClusterConfig({ nodes: [{ name: 'n1', host: '192.0.2.10' }], gatewayPort: 8000 });
  assert.equal(isClusterGateway('http://192.0.2.10:8000/v1', c), true);
  assert.equal(isClusterGateway('http://192.0.2.10:8001/v1', c), false, 'another port on the node is not its gateway');
  assert.equal(isClusterGateway('http://192.0.2.11:8000/v1', c), false);
  assert.equal(isClusterGateway('http://192.0.2.10:8000/v1', { configured: false }), false);
});

test('offload to a cluster gateway uses CLUSTER_OPS_KEY; a leftover OFFLOAD_KEY is moved, or dropped as a copy', () => {
  // moved: no CLUSTER_OPS_KEY yet
  let home = offloadHome('http://192.0.2.10:8000/v1');
  writeVar(home, 'OFFLOAD_KEY', KEY);
  let s = createOffloadStore(home, { cluster: createClusterStore(home) });
  assert.deepEqual(s.keyState(), { key: KEY, file: 'CLUSTER_OPS_KEY', problem: '' });
  assert.equal(readVar(home, 'OFFLOAD_KEY'), undefined);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(home, '.env')).mode & 0o777, 0o600);

  // dropped: the same secret twice
  home = offloadHome('http://192.0.2.10:8000/v1');
  writeKey(home);
  writeVar(home, 'OFFLOAD_KEY', KEY);
  s = createOffloadStore(home, { cluster: createClusterStore(home) });
  assert.equal(s.getKey(), KEY);
  assert.equal(readVar(home, 'OFFLOAD_KEY'), undefined);

  // kept and reported: another secret, CLUSTER_OPS_KEY wins
  const other = 'another-fixture-value';
  home = offloadHome('http://192.0.2.10:8000/v1');
  writeKey(home);
  writeVar(home, 'OFFLOAD_KEY', other);
  s = createOffloadStore(home, { cluster: createClusterStore(home) });
  const st = s.keyState();
  assert.equal(st.key, KEY);
  assert.match(st.problem, /OFFLOAD_KEY holds another key/);
  assert.equal(readVar(home, 'OFFLOAD_KEY'), other);

  // the settings' key field writes CLUSTER_OPS_KEY for a cluster target
  const set = 'set-fixture-value';
  home = offloadHome('http://192.0.2.10:8000/v1');
  s = createOffloadStore(home, { cluster: createClusterStore(home) });
  assert.equal(s.setKey(set), true);
  assert.equal(readVar(home, 'CLUSTER_OPS_KEY'), set);
  assert.equal(readVar(home, 'OFFLOAD_KEY'), undefined);
  s.setKey('');
  assert.equal(readVar(home, 'CLUSTER_OPS_KEY'), undefined);
});

test('offload to an endpoint outside cluster.json uses OFFLOAD_KEY', () => {
  const own = 'endpoint-fixture-value';
  const home = offloadHome('http://198.51.100.7:8000/v1');
  writeKey(home);
  writeVar(home, 'OFFLOAD_KEY', own);
  const s = createOffloadStore(home, { cluster: createClusterStore(home) });
  assert.deepEqual(s.keyState(), { key: own, file: 'OFFLOAD_KEY', problem: '' });
  assert.equal(readVar(home, 'CLUSTER_OPS_KEY'), KEY);
});

// ── GLASS_HOME/.env: one file for the keys, earlier key files moved into it ──
test('the earlier key files move into .env once: unset → moved, same → removed, other → kept and reported', () => {
  const home = tmpHome();
  writeSecret(home, 'cluster.key', KEY, 0o600);
  writeSecret(home, 'cluster-status.key', STATUS_KEY, 0o600);
  const keys = createKeyStore(home);
  assert.deepEqual(keys.read('ops'), { key: KEY, name: 'CLUSTER_OPS_KEY', problem: '' });
  assert.deepEqual(keys.read('mon'), { key: STATUS_KEY, name: 'CLUSTER_MON_KEY', problem: '' });
  assert.equal(has(home, 'cluster.key'), false);
  assert.equal(has(home, 'cluster-status.key'), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(home, '.env')).mode & 0o777, 0o600);

  writeSecret(home, 'cluster.key', KEY, 0o600);
  assert.equal(keys.read('ops').problem, '');
  assert.equal(has(home, 'cluster.key'), false, 'a copy of the same key is removed');

  const other = 'another-fixture-value';
  writeSecret(home, 'cluster.key', other, 0o600);
  const r = keys.read('ops');
  assert.equal(r.key, KEY, '.env wins');
  assert.match(r.problem, /cluster\.key holds another key than CLUSTER_OPS_KEY/);
  assert.equal(has(home, 'cluster.key'), true);
});

test('writing a key keeps the rest of .env — comments, other variables, order', () => {
  const home = tmpHome();
  const f = path.join(home, '.env');
  fs.writeFileSync(f, '# glass keys\nFOO=bar\nCLUSTER_MON_KEY="quoted"\n', { mode: 0o600 });
  const keys = createKeyStore(home);
  assert.equal(keys.read('mon').key, 'quoted');
  keys.write('ops', KEY);
  keys.write('mon', STATUS_KEY);
  assert.equal(fs.readFileSync(f, 'utf8'), `# glass keys\nFOO=bar\nCLUSTER_MON_KEY=${STATUS_KEY}\nCLUSTER_OPS_KEY=${KEY}\n`);
  keys.write('mon', '');
  assert.equal(fs.readFileSync(f, 'utf8'), `# glass keys\nFOO=bar\nCLUSTER_OPS_KEY=${KEY}\n`);
});
