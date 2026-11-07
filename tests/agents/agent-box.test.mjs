/**
 * The agent box's `docker run` argv (scripts/agent-box.mjs boxRunArgs).
 *
 * Pins what keeps the box a boundary — no Docker socket, no privileges, no
 * host home beyond the transcript folder, the coding repo read-only when it is
 * not the workspace — and what keeps the host integrations working: same-path
 * workspace (transcript folder names), routed env with localhost rewritten.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { boxRunArgs, boxPath, toBoxUrl, IMAGE, HOME_VOLUME, BOX_HOME } from '../../scripts/agent-box.mjs';

const base = {
  agent: 'claude', cwd: '/Users/u/proj', codingRepo: '/Users/u/coding', home: '/Users/u',
  platform: 'darwin', uid: 501, gid: 20, name: 'coding-box-claude-1', exists: () => true,
  env: {},
};

const volumes = (argv) => argv.flatMap((a, i) => (a === '-v' ? [argv[i + 1]] : []));
const envs = (argv) => Object.fromEntries(argv.flatMap((a, i) => (a === '-e' ? [argv[i + 1].split(/=(.*)/s).slice(0, 2)] : [])));

describe('boxRunArgs — boundary', () => {
  const argv = boxRunArgs(base);

  test('never mounts the Docker socket or runs privileged', () => {
    assert.ok(!argv.some((a) => /docker\.sock/.test(a)));
    assert.ok(!argv.includes('--privileged'));
    assert.ok(!argv.some((a) => a.startsWith('--cap-add')));
  });

  test('runs as the host user, never root', () => {
    assert.strictEqual(envs(argv).CODING_BOX_UID, '501');
    assert.strictEqual(envs(argv).CODING_BOX_GID, '20');
  });

  test('host mounts: workspace rw, coding repo ro, transcripts, the home volume — nothing else', () => {
    assert.deepStrictEqual(volumes(argv).sort(), [
      `${HOME_VOLUME}:${BOX_HOME}`,
      `/Users/u/.claude/projects:${BOX_HOME}/.claude/projects`,
      '/Users/u/coding:/Users/u/coding:ro',
      '/Users/u/proj:/Users/u/proj',
    ].sort());
  });

  test('the coding repo is the workspace itself → mounted once, writable', () => {
    const v = volumes(boxRunArgs({ ...base, cwd: '/Users/u/coding' }));
    assert.ok(v.includes('/Users/u/coding:/Users/u/coding'));
    assert.ok(!v.some((m) => m.endsWith(':ro')));
  });

  test('image, then the agent command and its args, in the workspace', () => {
    const tail = boxRunArgs({ ...base, args: ['--resume'] }).slice(-5);
    assert.deepStrictEqual(tail, ['-w', '/Users/u/proj', IMAGE, 'claude', '--resume']);
  });

  test('unknown agent is refused', () => {
    assert.throws(() => boxRunArgs({ ...base, agent: 'bash' }), /unknown agent/);
  });
});

describe('boxRunArgs — host integrations keep working', () => {
  test('routing env passes through with localhost rewritten', () => {
    const e = envs(boxRunArgs({ ...base, env: {
      ANTHROPIC_BASE_URL: 'http://localhost:12435/p/x',
      COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:12435/v1/copilot',
      NO_PROXY: 'localhost,127.0.0.1',
      SECRET_THING: 'not passed',
    } }));
    assert.strictEqual(e.ANTHROPIC_BASE_URL, 'http://host.docker.internal:12435/p/x');
    assert.strictEqual(e.COPILOT_PROVIDER_BASE_URL, 'http://host.docker.internal:12435/v1/copilot');
    assert.strictEqual(e.NO_PROXY, 'localhost,127.0.0.1,host.docker.internal');
    assert.strictEqual(e.SECRET_THING, undefined);
  });

  test('pi agent dir and a CA bundle are mounted at the same path', () => {
    const argv = boxRunArgs({ ...base, agent: 'pi', env: { PI_CODING_AGENT_DIR: '/Users/u/.pi/agent', NODE_EXTRA_CA_CERTS: '/Users/u/ca.pem' } });
    assert.ok(volumes(argv).includes('/Users/u/.pi/agent:/Users/u/.pi/agent'));
    assert.ok(volumes(argv).includes('/Users/u/ca.pem:/Users/u/ca.pem:ro'));
  });

  test('TARGET_PROJECT_DIR is the workspace when set', () => {
    const v = volumes(boxRunArgs({ ...base, cwd: '/Users/u/proj/sub', env: { TARGET_PROJECT_DIR: '/Users/u/proj' } }));
    assert.ok(v.includes('/Users/u/proj:/Users/u/proj'));
  });

  test('Linux maps host.docker.internal to the bridge gateway; Desktop platforms need nothing', () => {
    assert.ok(boxRunArgs({ ...base, platform: 'linux', home: '/home/u', cwd: '/home/u/p', codingRepo: '/home/u/coding' }).includes('host.docker.internal:host-gateway'));
    assert.ok(!boxRunArgs(base).includes('--add-host'));
  });

  test('-t only with a terminal', () => {
    assert.ok(boxRunArgs({ ...base, tty: true }).includes('-t'));
    assert.ok(!boxRunArgs(base).includes('-t'));
  });
});

describe('path and URL mapping', () => {
  test('POSIX paths keep their path', () => {
    assert.strictEqual(boxPath('/home/u/proj', 'linux'), '/home/u/proj');
  });
  test('Windows paths land under /host/<drive>', () => {
    assert.strictEqual(boxPath('C:\\Users\\u\\proj', 'win32'), '/host/c/Users/u/proj');
  });
  test('loopback hosts become host.docker.internal; others untouched', () => {
    assert.strictEqual(toBoxUrl('http://[::1]:3034/x'), 'http://host.docker.internal:3034/x');
    assert.strictEqual(toBoxUrl('https://api.example.com'), 'https://api.example.com');
  });
});
