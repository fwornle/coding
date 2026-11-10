/**
 * The box's locked network (scripts/agent-box.mjs): the box joins only its
 * --internal network, host.docker.internal is the gate, web traffic goes to
 * the gate's allow-list proxy, and the gate forwards the LLM proxy and the
 * guard — nothing else. The gate's own behaviour: tests/agents/box-gate.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxRunArgs, boxNetworkMode, gatePorts, gateRunArgs, gateRelays, healthCoordinatorPort, gateUpstream, gateDenials, GATE_CONNECT_PORT, IMAGE,
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
});
