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
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  boxRunArgs, boxPath, toBoxUrl, guardSource, configRoots, prepareCopilotConfig,
  IMAGE, HOME_VOLUME, BOX_HOME, BOX_GUARD_KEYS,
} from '../../scripts/agent-box.mjs';

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

  test('host mounts: workspace rw, coding repo ro, transcripts, the home volume, guard PUBLIC key — nothing else', () => {
    assert.deepStrictEqual(volumes(argv).sort(), [
      `${HOME_VOLUME}:${BOX_HOME}`,
      `/Users/u/.coding/guard/public:${BOX_GUARD_KEYS}:ro`,
      `/Users/u/.claude/projects:${BOX_HOME}/.claude/projects`,
      '/Users/u/coding:/Users/u/coding:ro',
      '/Users/u/proj:/Users/u/proj',
    ].sort());
  });

  test('the coding repo is the workspace itself → mounted once, writable', () => {
    const v = volumes(boxRunArgs({ ...base, cwd: '/Users/u/coding' }));
    assert.ok(v.includes('/Users/u/coding:/Users/u/coding'));
    assert.ok(!v.some((m) => m.endsWith(':ro') && !m.includes(BOX_GUARD_KEYS)));
  });

  test('image, then the agent command and its args, in the workspace', () => {
    const tail = boxRunArgs({ ...base, args: ['--resume'] }).slice(-5);
    assert.deepStrictEqual(tail, ['-w', '/Users/u/proj', IMAGE, 'claude', '--resume']);
  });

  test('a workspace that contains the guard keys is refused', () => {
    assert.throws(() => boxRunArgs({ ...base, cwd: '/Users/u' }), /guard's keys/);
    assert.throws(() => boxRunArgs({ ...base, cwd: '/Users/u/.coding' }), /guard's keys/);
    assert.throws(() => boxRunArgs({ ...base, env: { PI_CODING_AGENT_DIR: '/Users/u/.coding/guard' } }), /guard's keys/);
  });

  test('the guard key dir is never mounted beyond its public part', () => {
    assert.ok(!volumes(argv).some((v) => /\.coding\/guard(:|\/(?!public:))/.test(v)));
  });

  test('the box knows where the host guard is and which session it is', () => {
    assert.strictEqual(envs(argv).CODING_GUARD_URL, 'http://host.docker.internal:3035');
    assert.strictEqual(envs(argv).CODING_GUARD_SESSION, 'coding-box-claude-1');
  });

  test('the box token binds `coding svc` to this box, and is only passed when the guard issued one', () => {
    assert.ok(!('CODING_GUARD_BOX_TOKEN' in envs(argv)));
    const issued = randomBytes(16).toString('hex');
    assert.strictEqual(envs(boxRunArgs({ ...base, boxToken: issued })).CODING_GUARD_BOX_TOKEN, issued);
  });

  test('the hostname is the session: grants are bound to what the agent cannot change', () => {
    assert.strictEqual(argv[argv.indexOf('--hostname') + 1], 'coding-box-claude-1');
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

  test('the mouse switches the tmux wrapper sets reach the agent (drag-select in tmux)', () => {
    const e = envs(boxRunArgs({ ...base, env: { CLAUDE_CODE_DISABLE_MOUSE: '1', OPENCODE_DISABLE_MOUSE: '1' } }));
    assert.strictEqual(e.CLAUDE_CODE_DISABLE_MOUSE, '1');
    assert.strictEqual(e.OPENCODE_DISABLE_MOUSE, '1');
    // CODING_AGENT_MOUSE=keep leaves them unset in the wrapper → nothing passed.
    assert.strictEqual(envs(boxRunArgs(base)).CLAUDE_CODE_DISABLE_MOUSE, undefined);
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

describe('the in-box guard (Phase 1 item 4)', () => {
  const policy = JSON.parse(fs.readFileSync(new URL('../../docker/agent-box/managed-settings.json', import.meta.url), 'utf8'));
  const command = policy.hooks.PreToolUse[0].hooks[0].command;

  test('box mode and the key dir are set INLINE in the managed command, not inherited from the agent', () => {
    const inline = Object.fromEntries([...command.matchAll(/(?:^|\s)([A-Z_]+)=(\S+)/g)].map((m) => [m[1], m[2]]));
    assert.strictEqual(inline.CODING_GUARD_MODE, 'box');
    assert.strictEqual(inline.CODING_GUARD_KEYS, BOX_GUARD_KEYS);
    assert.match(inline.CONSTRAINT_CONFIG_PATH, /^\/opt\/coding-guard\//);
    assert.strictEqual(policy.allowManagedHooksOnly, true);
  });

  test('the grant verifier is part of what the image digest covers', () => {
    assert.match(guardSource().grants, /^[0-9a-f]{40}$/);
  });
});

describe('per-agent guards (Phase 1 item 5)', () => {
  const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../../docker/agent-box/${rel}`, import.meta.url), 'utf8'));
  const tail = (agent) => { const a = boxRunArgs({ ...base, agent }); return a.slice(a.indexOf(IMAGE) + 1); };

  test('each agent starts with its guard fixed on the command line (claude/opencode: managed config)', () => {
    assert.deepStrictEqual(tail('claude'), ['claude']);
    assert.deepStrictEqual(tail('opencode'), ['opencode']);
    assert.deepStrictEqual(tail('copilot'), ['copilot', '--plugin-dir', '/opt/coding-guard/agents/copilot']);
    assert.deepStrictEqual(tail('pi'), ['pi', '-e', '/opt/coding-guard/agents/pi/guard.js']);
  });

  test('user args come after the guard, so they cannot replace it', () => {
    const a = boxRunArgs({ ...base, agent: 'pi', args: ['-ne'] });
    assert.deepStrictEqual(a.slice(-4), ['pi', '-e', '/opt/coding-guard/agents/pi/guard.js', '-ne']);
  });

  test('every hook entry point starts the hook with a fixed environment and an absolute node', () => {
    // Nothing inherited: a nested agent's NODE_OPTIONS or PATH must not reach the hook.
    const fixed = (agent) => new RegExp(`^/usr/bin/env -i HOME=/home/agent PATH=/usr/local/bin:/usr/bin:/bin CODING_GUARD_MODE=box CODING_GUARD_KEYS=/etc/coding-guard CODING_GUARD_AGENT=${agent} CONSTRAINT_CONFIG_PATH=\\S+ /usr/local/bin/node /opt/coding-guard/`);
    assert.match(read('agents/copilot/hooks/hooks.json').hooks.PreToolUse[0].hooks[0].command, fixed('copilot'));
    assert.match(read('managed-settings.json').hooks.PreToolUse[0].hooks[0].command, fixed('claude'));
    assert.deepStrictEqual(read('agents/opencode/opencode.json').plugin, ['file:///opt/coding-guard/agents/opencode/guard.js']);
    const helper = fs.readFileSync(new URL('../../docker/agent-box/agents/guard-hook.mjs', import.meta.url), 'utf8');
    assert.match(helper, /env: \{ \.\.\.FIXED_ENV, CODING_GUARD_AGENT: agent \}/, 'no inherited env');
    assert.match(helper, /const NODE = '\/usr\/local\/bin\/node'/);
  });

  test('every agent also runs the result check after a call (Phase 2), with the same fixed environment', () => {
    const POST = '/opt/coding-guard/integrations/constraint-monitor/src/hooks/post-tool-hook.js';
    const claude = read('managed-settings.json').hooks;
    const copilot = read('agents/copilot/hooks/hooks.json').hooks;
    // A command that writes a file and then fails still wrote it: PostToolUseFailure too.
    for (const entry of [claude.PostToolUse, claude.PostToolUseFailure, copilot.PostToolUse]) {
      assert.strictEqual(entry[0].matcher, '*');
      const cmd = entry[0].hooks[0].command;
      assert.ok(cmd.endsWith(` /usr/local/bin/node ${POST}`), cmd);
      assert.match(cmd, /^\/usr\/bin\/env -i HOME=\/home\/agent PATH=\/usr\/local\/bin:\/usr\/bin:\/bin CODING_GUARD_MODE=box /);
    }
    const helper = fs.readFileSync(new URL('../../docker/agent-box/agents/guard-hook.mjs', import.meta.url), 'utf8');
    assert.ok(helper.includes(`post: '${POST}'`));
    const opencode = fs.readFileSync(new URL('../../docker/agent-box/agents/opencode/guard.js', import.meta.url), 'utf8');
    assert.match(opencode, /'tool\.execute\.after'[\s\S]*checkCall\('opencode', \{[\s\S]*\}, 'post'\)/);
    const pi = fs.readFileSync(new URL('../../docker/agent-box/agents/pi/guard.js', import.meta.url), 'utf8');
    assert.match(pi, /pi\.on\('tool_result'[\s\S]*checkCall\('pi', \{[\s\S]*\}, 'post'\)/);
  });

  test('copilot: repo settings dirs are read-only, .github pinned, in every dir down to the cwd', () => {
    const a = boxRunArgs({ ...base, agent: 'copilot', cwd: '/Users/u/proj/sub', env: { TARGET_PROJECT_DIR: '/Users/u/proj' } });
    const v = volumes(a);
    for (const d of ['/Users/u/proj', '/Users/u/proj/sub']) {
      assert.ok(v.includes(`${d}/.github:${d}/.github`));
      assert.ok(v.includes(`${d}/.github/copilot:${d}/.github/copilot:ro`));
      assert.ok(v.includes(`${d}/.claude:${d}/.claude:ro`));
    }
    assert.ok(!volumes(boxRunArgs(base)).some((x) => x.includes('.github')), 'other agents keep them writable');
  });

  test('configRoots: the workspace, then each level to the cwd; a cwd outside is ignored', () => {
    assert.deepStrictEqual(configRoots('/w', '/w/a/b'), ['/w', '/w/a', '/w/a/b']);
    assert.deepStrictEqual(configRoots('/w', '/elsewhere'), ['/w']);
  });

  test('copilot refuses to start when a repo settings file disables hooks; creates missing dirs otherwise', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-cfg-'));
    try {
      prepareCopilotConfig(ws, ws);
      assert.ok(fs.statSync(path.join(ws, '.github', 'copilot')).isDirectory());
      assert.ok(fs.statSync(path.join(ws, '.claude')).isDirectory());
      fs.writeFileSync(path.join(ws, '.claude', 'settings.local.json'), '{ "disableAllHooks": true }');
      assert.throws(() => prepareCopilotConfig(ws, ws), /disables Copilot hooks/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
