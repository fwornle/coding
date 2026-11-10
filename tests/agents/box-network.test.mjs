/**
 * The box's locked network (scripts/agent-box.mjs): the box joins only its
 * --internal network, host.docker.internal is the gate, web traffic goes to
 * the gate's allow-list proxy, and the gate forwards the LLM proxy and the
 * guard — nothing else. The gate's own behaviour: tests/agents/box-gate.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxRunArgs, boxNetworkMode, gatePorts, gateRunArgs, gateRelays, gateMcpRelays, healthCoordinatorPort, gateUpstream, gateDenials, gateExitReason, watchGate, GATE_CONNECT_PORT, IMAGE,
} from '../../scripts/agent-box.mjs';

const base = {
  agent: 'claude', cwd: '/Users/u/proj', codingRepo: '/Users/u/coding', home: '/Users/u',
  platform: 'darwin', uid: 501, gid: 20, name: 'coding-box-claude-1', exists: () => true, env: {},
};
const gate = { network: 'coding-box-claude-1-net', ip: '172.30.0.2', gateName: 'coding-box-claude-1-gate' };
const envs = (argv) => Object.fromEntries(argv.flatMap((a, i) => (a === '-e' ? [argv[i + 1].split(/=(.*)/s).slice(0, 2)] : [])));
const flag = (argv, f) => argv.flatMap((a, i) => (a === f ? [argv[i + 1]] : []));

describe('locked box network — the box side', () => {
  test('the box joins only its internal network, and host.docker.internal is the gate', () => {
    const argv = boxRunArgs({ ...base, gate });
    assert.deepEqual(flag(argv, '--network'), [gate.network]);
    assert.deepEqual(flag(argv, '--add-host'), [`host.docker.internal:${gate.ip}`]);
  });

  test('on Linux too: the gate, never the host gateway', () => {
    const argv = boxRunArgs({ ...base, platform: 'linux', gate });
    assert.deepEqual(flag(argv, '--add-host'), [`host.docker.internal:${gate.ip}`]);
  });

  test("the host's web proxy is replaced by the gate's allow-list proxy", () => {
    const env = { HTTPS_PROXY: 'http://localhost:3128', http_proxy: 'http://localhost:3128', NO_PROXY: 'localhost' };
    const e = envs(boxRunArgs({ ...base, env, gate }));
    const via = `http://host.docker.internal:${GATE_CONNECT_PORT}`;
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) assert.equal(e[k], via, k);
    assert.equal(e.NO_PROXY, 'localhost,host.docker.internal');
  });

  test('without a host NO_PROXY the box still talks to the gate directly for the LLM proxy and guard', () => {
    const e = envs(boxRunArgs({ ...base, gate }));
    assert.match(e.NO_PROXY, /host\.docker\.internal/);
  });

  test('routing URLs keep pointing at host.docker.internal (= the gate)', () => {
    const e = envs(boxRunArgs({ ...base, env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:12435' }, gate }));
    assert.equal(e.ANTHROPIC_BASE_URL, 'http://host.docker.internal:12435');
    assert.match(e.CODING_GUARD_URL, /^http:\/\/host\.docker\.internal:\d+$/);
  });

  test('open mode (no gate) is the default bridge, as before', () => {
    const argv = boxRunArgs({ ...base, env: { HTTPS_PROXY: 'http://localhost:3128' } });
    assert.deepEqual(flag(argv, '--network'), []);
    assert.equal(envs(argv).HTTPS_PROXY, 'http://host.docker.internal:3128');
  });
});

describe('locked box network — the gate', () => {
  test('locked is the default; only CODING_BOX_NETWORK=open opens it', () => {
    assert.equal(boxNetworkMode({}), 'locked');
    assert.equal(boxNetworkMode({ CODING_BOX_NETWORK: 'locked' }), 'locked');
    assert.equal(boxNetworkMode({ CODING_BOX_NETWORK: 'anything' }), 'locked');
    assert.equal(boxNetworkMode({ CODING_BOX_NETWORK: 'OPEN' }), 'open');
  });

  test('the gate forwards the LLM proxy and the guard — and nothing else', () => {
    assert.deepEqual(gatePorts({}, 3035), [12435, 3035]);
    assert.deepEqual(gatePorts({ LLM_CLI_PROXY_PORT: '22435' }, 61399), [22435, 61399]);
  });

  test('gate argv: nobody, read-only, no capabilities, labelled with its launcher', () => {
    const argv = gateRunArgs({ name: 'b', agent: 'claude', ports: [12435, 3035], network: 'b-net', platform: 'darwin', pid: 4242 });
    for (const f of ['--read-only', '--cap-drop', '--security-opt']) assert.ok(argv.includes(f), f);
    assert.deepEqual(flag(argv, '--user'), ['65534:65534']);
    assert.deepEqual(flag(argv, '--network'), ['bridge']);
    assert.ok(argv.includes('coding.box.gate.pid=4242'));
    assert.ok(!argv.includes('--rm'), 'a dead gate keeps its log and can be restarted');
    assert.ok(!argv.some((a) => /docker\.sock/.test(a)));
    assert.ok(!argv.includes('-v'), 'the gate mounts nothing');
    const tail = argv.slice(argv.indexOf(IMAGE) + 1);
    assert.deepEqual(flag(tail, '--forward'), ['12435', '3035']);
    assert.deepEqual(flag(tail, '--agent'), ['claude']);
    assert.deepEqual(flag(tail, '--connect'), [String(GATE_CONNECT_PORT)]);
  });

  test('the health coordinator is relayed for GET /health/state only', () => {
    assert.deepEqual(gateRelays({}), [{ port: 3034, paths: ['/health/state'] }]);
    assert.equal(healthCoordinatorPort({ HEALTH_COORDINATOR_URL: 'http://localhost:4034' }), 4034);
    assert.equal(healthCoordinatorPort({ HEALTH_COORDINATOR_URL: 'http://example.com:4034' }), 3034, 'only a host-local coordinator');
    assert.equal(healthCoordinatorPort({ HEALTH_COORDINATOR_URL: 'off' }), 3034);
    const argv = gateRunArgs({ name: 'b', agent: 'claude', ports: [12435, 3035], network: 'n', relays: gateRelays({}), platform: 'darwin' });
    assert.deepEqual(flag(argv.slice(argv.indexOf(IMAGE) + 1), '--http-get'), ['3034:/health/state']);
    assert.deepEqual(flag(argv.slice(argv.indexOf(IMAGE) + 1), '--forward'), ['12435', '3035'], 'not a raw forward');
  });

  test('graphify is relayed as MCP with the tools config/code-graph.json lists', () => {
    const relays = gateMcpRelays({});
    assert.deepEqual(relays.map((r) => [r.port, r.path]), [[3851, '/mcp']]);
    assert.ok(relays[0].tools.includes('query_graph'));
    assert.ok(!relays[0].tools.some((t) => /pr/.test(t)), 'no PR tools: they run gh in the services container');
    assert.equal(gateMcpRelays({ GRAPHIFY_MCP_PORT: '4851' })[0].port, 4851);
    assert.deepEqual(gateMcpRelays({}, '/nonexistent'), [], 'no config → no relay');
    const argv = gateRunArgs({ name: 'b', agent: 'claude', ports: [1], network: 'n', mcpRelays: [{ port: 3851, path: '/mcp', tools: ['a', 'b'] }], platform: 'darwin' });
    assert.deepEqual(flag(argv.slice(argv.indexOf(IMAGE) + 1), '--mcp'), ['3851:/mcp:a,b']);
    assert.ok(!flag(argv, '--forward').includes('3851'), 'not a raw forward');
  });

  test('the gate chains through the host web proxy when there is one', () => {
    assert.equal(gateUpstream({ HTTPS_PROXY: 'http://localhost:3128' }), 'http://host.docker.internal:3128');
    assert.equal(gateUpstream({}), null);
    const argv = gateRunArgs({ name: 'b', agent: 'pi', ports: [1], network: 'n', upstream: 'http://host.docker.internal:3128', platform: 'linux' });
    assert.deepEqual(flag(argv, '--upstream'), ['http://host.docker.internal:3128']);
    assert.deepEqual(flag(argv, '--add-host'), ['host.docker.internal:host-gateway']);
  });

  test('refusals are summarised from the gate log, most frequent first', () => {
    const log = [
      '{"ready":true}',
      '{"deny":"example.com:443"}',
      'not json',
      '{"deny":"api.anthropic.com:443"}',
      '{"deny":"example.com:443"}',
      '{"allow":"claude.ai:443"}',
    ].join('\n');
    assert.deepEqual(gateDenials(log), [{ dest: 'example.com:443', count: 2 }, { dest: 'api.anthropic.com:443', count: 1 }]);
    assert.deepEqual(gateDenials(''), []);
  });
  test('why a gate died: its fatal line, else the unhandled error of a Node stack', () => {
    assert.equal(gateExitReason('{"ready":true}\n{"fatal":"gate: bad --forward port"}'), 'gate: bad --forward port');
    const stack = ['{"ready":true}', '{"deny":"api.anthropic.com:443"}', 'node:events:497', '      throw er; // Unhandled \'error\' event', '      ^', '', 'Error: read ECONNRESET', '    at TCP.onStreamRead (node:internal/stream_base_commons:216:20)'].join('\n');
    assert.equal(gateExitReason(stack), 'Error: read ECONNRESET');
    assert.equal(gateExitReason('{"ready":true}'), null);
  });
});

describe('locked box network — gate liveness', () => {
  /** Fake docker side: the gate dies once per entry in `deaths`, restarts at `ips` in turn. */
  function fakeOps({ deaths, ips, log = 'Error: read ECONNRESET' }) {
    const calls = { wait: 0, restart: 0, cancelled: 0 };
    return {
      calls,
      ops: {
        wait() {
          calls.wait++;
          const dies = calls.wait <= deaths;
          let cancel;
          const done = dies ? Promise.resolve(1) : new Promise((r) => { cancel = () => { calls.cancelled++; r(null); }; });
          return { done, cancel: () => cancel?.() };
        },
        logs: () => log,
        restart: () => ips[calls.restart++] ?? null,
      },
    };
  }
  const gate = { gateName: 'b-gate', network: 'b-net', ip: '172.20.0.2' };
  const tick = () => new Promise((r) => setTimeout(r, 10));

  test('a dead gate is restarted at its address and the pane is told why', async () => {
    const out = [];
    const { ops, calls } = fakeOps({ deaths: 1, ips: ['172.20.0.2'] });
    const w = watchGate(gate, { ops, write: (s) => out.push(s) });
    await tick();
    assert.equal(calls.restart, 1);
    assert.equal(calls.wait, 2, 'watches the restarted gate');
    assert.match(out.join(''), /gate died \(Error: read ECONNRESET\); restarted it \(1\/3\)/);
    w.stop();
    await w.done;
    assert.equal(calls.cancelled, 1, 'stop() ends the docker wait');
  });

  test('a gate that comes back at another address is not trusted: the box has no network', async () => {
    const out = [];
    const { ops, calls } = fakeOps({ deaths: 1, ips: ['172.20.0.3'] });
    const w = watchGate(gate, { ops, write: (s) => out.push(s) });
    await w.done;
    assert.equal(calls.wait, 1);
    assert.match(out.join(''), /new address 172\.20\.0\.3, the box expects 172\.20\.0\.2.*NO network/);
  });

  test('restarts are capped', async () => {
    const out = [];
    const { ops, calls } = fakeOps({ deaths: 9, ips: Array(9).fill('172.20.0.2') });
    const w = watchGate(gate, { ops, write: (s) => out.push(s), maxRestarts: 2 });
    await w.done;
    assert.equal(calls.restart, 2);
    assert.match(out.at(-1), /restarted 2× already — the box has NO network/);
  });

  test('stopping before any death says nothing', async () => {
    const out = [];
    const { ops } = fakeOps({ deaths: 0, ips: [] });
    const w = watchGate(gate, { ops, write: (s) => out.push(s) });
    w.stop();
    await w.done;
    assert.deepEqual(out, []);
  });
});
