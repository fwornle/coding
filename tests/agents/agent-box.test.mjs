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
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  boxRunArgs, boxPath, toBoxUrl, guardSource, configRoots, prepareCopilotConfig, stageBoxPiDir, boxOpencodeConfig, opencodeConfigFile, PROXY_NO_AUTH,
  boxClaudeSettings, claudeMcpConfigPath, stageClaudeSession, hostGitIdentity, gitIdentityEnv, boxCodingHooks, BOX_CODING_HOOKS,
  IMAGE, HOME_VOLUME, BOX_HOME, BOX_GUARD_KEYS, BOX_PI_DIR, BOX_CLAUDE_SESSION, HOST_COMMAND_SETTINGS,
} from '../../scripts/agent-box.mjs';
import { hookScript, HOOK_SCRIPTS } from '../../docker/agent-box/coding-hook.mjs';

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
    assert.throws(() => boxRunArgs({ ...base, env: { PI_CODING_AGENT_SESSION_DIR: '/Users/u/.coding/guard' } }), /guard's keys/);
    assert.throws(() => boxRunArgs({ ...base, agent: 'pi', piAgentDir: '/Users/u/.coding' }), /guard's keys/);
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

  test('pi session dir and a CA bundle are mounted at the same path', () => {
    const argv = boxRunArgs({ ...base, agent: 'pi', env: { PI_CODING_AGENT_SESSION_DIR: '/Users/u/proj/.observations/pi-sessions', NODE_EXTRA_CA_CERTS: '/Users/u/ca.pem' } });
    assert.ok(volumes(argv).includes('/Users/u/proj/.observations/pi-sessions:/Users/u/proj/.observations/pi-sessions'));
    assert.ok(volumes(argv).includes('/Users/u/ca.pem:/Users/u/ca.pem:ro'));
  });

  test("pi's HOST config dir is never mounted or named — the box gets the staged copy", () => {
    const env = { PI_CODING_AGENT_DIR: '/Users/u/coding/.pi-agent' };
    const bare = boxRunArgs({ ...base, agent: 'pi', env });
    assert.ok(!volumes(bare).some((v) => v.startsWith('/Users/u/coding/.pi-agent')));
    assert.strictEqual(envs(bare).PI_CODING_AGENT_DIR, undefined);
    const staged = boxRunArgs({ ...base, agent: 'pi', env, piAgentDir: '/tmp/coding-box-pi-x' });
    assert.ok(volumes(staged).includes(`/tmp/coding-box-pi-x:${BOX_PI_DIR}`));
    assert.strictEqual(envs(staged).PI_CODING_AGENT_DIR, BOX_PI_DIR);
    // only pi takes it
    assert.ok(!volumes(boxRunArgs({ ...base, piAgentDir: '/tmp/coding-box-pi-x' })).some((v) => v.includes('coding-box-pi')));
  });

  test("copilot's session store is mounted from the host (session logging reads it); other agents do not get it", () => {
    const want = `/Users/u/.copilot/session-state:${BOX_HOME}/.copilot/session-state`;
    assert.ok(volumes(boxRunArgs({ ...base, agent: 'copilot', cwd: '/Users/u/proj' })).includes(want));
    for (const agent of ['claude', 'opencode', 'pi']) {
      assert.ok(!volumes(boxRunArgs({ ...base, agent })).some((v) => v.includes('.copilot')), agent);
    }
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

describe('boxOpencodeConfig', () => {
  /** Stands in for whatever key the host file holds; it must never reach the box. */
  const HOST_ONLY = 'host-value-not-for-the-box';
  // What the launcher sends (opencodeConfigContent): per-launch overlays only.
  const launch = JSON.stringify({
    enabled_providers: ['rapid-proxy', 'github-copilot'],
    provider: {
      'rapid-proxy': { options: { headers: { 'x-project': 'coding' } }, models: { 'gpt-4o': { variants: { cheap: {} } } } },
      'github-copilot': { options: { baseURL: 'http://127.0.0.1:12435/v1/opencode' } },
    },
  });
  // The host's file config, which the box does not have.
  const hostFile = JSON.stringify({
    model: 'rapid-proxy/claude-sonnet-5',
    small_model: 'qwen-laptop/qwen3.8-27b-local',
    provider: {
      'rapid-proxy': { npm: '@ai-sdk/openai-compatible', name: 'Proxy', options: { baseURL: 'http://localhost:12435/v1', apiKey: HOST_ONLY }, models: { 'gpt-4o': { name: 'GPT-4o' }, 'claude-sonnet-5': {} } },
      'qwen-laptop': { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:8081/v1' } },
    },
  });

  test('the enabled providers get their definition from the host file; the launch values win', () => {
    const cfg = JSON.parse(boxOpencodeConfig(launch, hostFile));
    const rp = cfg.provider['rapid-proxy'];
    assert.equal(rp.npm, '@ai-sdk/openai-compatible');
    assert.equal(rp.options.baseURL, 'http://localhost:12435/v1', 'the URL opencode reported missing ("Invalid URL")');
    assert.deepEqual(rp.options.headers, { 'x-project': 'coding' });
    assert.deepEqual(rp.models['gpt-4o'], { name: 'GPT-4o', variants: { cheap: {} } });
    assert.ok(rp.models['claude-sonnet-5']);
    assert.equal(cfg.provider['github-copilot'].options.baseURL, 'http://127.0.0.1:12435/v1/opencode');
    assert.equal(cfg.model, 'rapid-proxy/claude-sonnet-5');
  });

  test('never the host key, never a provider the launch did not enable', () => {
    const cfg = JSON.parse(boxOpencodeConfig(launch, hostFile));
    assert.equal(cfg.provider['rapid-proxy'].options.apiKey, PROXY_NO_AUTH);
    assert.equal(cfg.provider['qwen-laptop'], undefined);
    assert.equal(cfg.small_model, undefined, 'its provider is not enabled');
    assert.ok(!boxOpencodeConfig(launch, hostFile).includes(HOST_ONLY));
  });

  test('a model the launch chose is kept; unparseable input leaves the content alone', () => {
    const own = JSON.stringify({ ...JSON.parse(launch), model: 'github-copilot/gpt-4o' });
    assert.equal(JSON.parse(boxOpencodeConfig(own, hostFile)).model, 'github-copilot/gpt-4o');
    assert.equal(boxOpencodeConfig(launch, '{ not json'), launch);
  });

  test('loopback URLs reach the host once boxed', () => {
    assert.match(toBoxUrl(boxOpencodeConfig(launch, hostFile)), /"baseURL":"http:\/\/host\.docker\.internal:12435\/v1"/);
  });

  test('the host file: OPENCODE_CONFIG, else XDG_CONFIG_HOME, else ~/.config', () => {
    assert.equal(opencodeConfigFile({ OPENCODE_CONFIG: '/x/oc.json' }, '/Users/u'), '/x/oc.json');
    assert.equal(opencodeConfigFile({ XDG_CONFIG_HOME: '/xdg' }, '/Users/u'), '/xdg/opencode/opencode.json');
    assert.equal(opencodeConfigFile({}, '/Users/u'), '/Users/u/.config/opencode/opencode.json');
  });
});

describe('stageBoxPiDir', () => {
  test('copies provider config with loopback pointed at the host, and the extensions; leaves credentials and sessions', () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-src-'));
    const dst = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dst-')), 'stage');
    try {
      fs.writeFileSync(path.join(src, 'models.json'), '{"baseUrl":"http://127.0.0.1:12435/v1"}');
      fs.writeFileSync(path.join(src, 'settings.json'), '{"defaultProvider":"rapid-proxy-pi"}');
      fs.writeFileSync(path.join(src, 'APPEND_SYSTEM.md'), 'localhost stays text here');
      fs.writeFileSync(path.join(src, 'auth.json'), '{"secret":1}');
      fs.writeFileSync(path.join(src, 'models-store.json'), '{}');
      fs.mkdirSync(path.join(src, 'extensions', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(src, 'extensions', 'coding-proxy-headers.ts'), 'export default 1;');
      fs.mkdirSync(path.join(src, 'sessions'));
      fs.writeFileSync(path.join(src, 'sessions', 'old.jsonl'), '{}');

      const copied = stageBoxPiDir(src, dst);
      assert.deepStrictEqual(copied.sort(), ['APPEND_SYSTEM.md', 'extensions/coding-proxy-headers.ts', 'models.json', 'settings.json'].sort());
      assert.strictEqual(fs.readFileSync(path.join(dst, 'models.json'), 'utf8'), '{"baseUrl":"http://host.docker.internal:12435/v1"}');
      assert.strictEqual(fs.readFileSync(path.join(dst, 'APPEND_SYSTEM.md'), 'utf8'), 'localhost stays text here');
      for (const gone of ['auth.json', 'models-store.json', 'sessions', 'extensions/nested']) {
        assert.ok(!fs.existsSync(path.join(dst, gone)), gone);
      }
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
      fs.rmSync(path.dirname(dst), { recursive: true, force: true });
    }
  });

  test('a missing source dir stages nothing (and does not throw)', () => {
    const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dst-'));
    try {
      assert.deepStrictEqual(stageBoxPiDir(path.join(dst, 'nope'), path.join(dst, 's')), []);
    } finally {
      fs.rmSync(dst, { recursive: true, force: true });
    }
  });
});

describe('entrypoint ↔ nested mounts', () => {
  // Docker creates the missing parents of a nested mount as root. A top-level
  // home dir created that way is unwritable for the agent: copilot exited at
  // once on 2026-11-09 because ~/.copilot was root-owned. The entrypoint
  // chowns each such parent — this pins that list to the mounts.
  const entry = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'docker', 'agent-box', 'entrypoint.sh'), 'utf8');
  const chowned = (/^for dir in (.*); do$/m.exec(entry)?.[1] ?? '').match(/"\$home\/([^"]+)"/g)?.map((s) => s.slice(7, -1)) ?? [];

  test('every nested mount in the box home has its top-level parent chowned', () => {
    for (const agent of ['claude', 'copilot', 'opencode', 'pi']) {
      const argv = boxRunArgs({ ...base, agent, piAgentDir: '/tmp/coding-box-pi-x' });
      for (const v of volumes(argv)) {
        const target = v.split(':')[1];
        if (!target.startsWith(`${BOX_HOME}/`)) continue;
        const rel = target.slice(BOX_HOME.length + 1).split('/');
        if (rel.length < 2) continue; // a direct child is the mount itself, not a created parent
        assert.ok(chowned.includes(rel[0]), `${agent}: ${target} needs "$home/${rel[0]}" in the entrypoint chown loop (has: ${chowned.join(', ')})`);
      }
    }
  });
});

describe('a boxed Claude gets what a host Claude gets', () => {
  // claude-mcp-launcher.sh gives a host Claude --settings, --plugin-dir and
  // --mcp-config; until 2026-11-09 the box got none of them, so a boxed session
  // had no /sl (or any project command), none of the user's settings and no MCP.
  const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

  test('the session dir is mounted read-only, only for claude', () => {
    const dir = '/tmp/coding-box-claude-x';
    assert.ok(volumes(boxRunArgs({ ...base, claudeSessionDir: dir })).includes(`${dir}:${BOX_CLAUDE_SESSION}:ro`));
    assert.ok(!volumes(boxRunArgs({ ...base, agent: 'opencode', claudeSessionDir: dir })).some((v) => v.includes(BOX_CLAUDE_SESSION)));
  });

  test('the session dir may not expose the guard home', () => {
    assert.throws(() => boxRunArgs({ ...base, claudeSessionDir: '/Users/u/.coding/guard' }), /guard's keys/);
  });

  test('the env the slash commands read points at the coding repo in the box', () => {
    const e = envs(boxRunArgs(base));
    assert.strictEqual(e.CODING_REPO, '/Users/u/coding');
    assert.strictEqual(e.CODING_TOOLS_PATH, '/Users/u/coding');
    assert.strictEqual(e.CODING_KNOWLEDGE_EXPORT, '/Users/u/coding/.data/knowledge-export');
    assert.strictEqual(envs(boxRunArgs({ ...base, platform: 'win32', codingRepo: 'C:\\Users\\u\\coding' })).CODING_REPO, '/host/c/Users/u/coding');
  });

  test('settings keep the user\'s choices but drop everything that runs a host command', () => {
    const derived = { model: 'opus[1m]', autoMode: { allow: ['x'] }, env: { A: '1' }, hooks: { PreToolUse: [] }, statusLine: { command: 'node /x' }, apiKeyHelper: '/x' };
    const boxed = boxClaudeSettings(derived);
    assert.deepStrictEqual(boxed, { model: 'opus[1m]', autoMode: { allow: ['x'] }, env: { A: '1' } });
    for (const k of HOST_COMMAND_SETTINGS) assert.ok(!(k in boxed));
    assert.ok('hooks' in derived, 'the input is not mutated');
  });

  test('the MCP config is picked the way the host launcher picks it', () => {
    const has = (...files) => (f) => files.includes(f);
    assert.strictEqual(claudeMcpConfigPath('/r', {}, has('/r/claude-code-mcp-docker.json', '/r/claude-code-mcp-processed.json')), '/r/claude-code-mcp-docker.json');
    assert.strictEqual(claudeMcpConfigPath('/r', { MCP_CONFIG: '/m.json' }, has('/m.json', '/r/claude-code-mcp-processed.json')), '/m.json');
    assert.strictEqual(claudeMcpConfigPath('/r', {}, has('/r/claude-code-mcp-processed.json')), '/r/claude-code-mcp-processed.json');
    assert.strictEqual(claudeMcpConfigPath('/r', {}, has()), null);
  });

  test('staging with the real generator: commands, settings, MCP with host URLs', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'box-claude-test-'));
    try {
      const home = path.join(tmp, 'home');
      const repo = path.join(tmp, 'repo');
      const stage = path.join(tmp, 'stage');
      fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus[1m]', statusLine: { type: 'command', command: 'node /host/only.js' } }));
      // A repo with the real generator and its feature libs, and two commands.
      fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
      fs.copyFileSync(path.join(REPO, 'scripts', 'build-claude-runtime-config.mjs'), path.join(repo, 'scripts', 'build-claude-runtime-config.mjs'));
      fs.symlinkSync(path.join(REPO, 'lib'), path.join(repo, 'lib'));
      fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(repo, 'node_modules'));
      fs.mkdirSync(path.join(repo, '.claude', 'commands'), { recursive: true });
      fs.writeFileSync(path.join(repo, '.claude', 'commands', 'sl.md'), '# sl');
      fs.writeFileSync(path.join(repo, '.claude', 'commands', 'graphify.md'), '# graphify');
      fs.writeFileSync(path.join(repo, 'claude-code-mcp-docker.json'), JSON.stringify({ mcpServers: { graphify: { type: 'http', url: 'http://localhost:3851/mcp' } } }));
      fs.mkdirSync(stage);

      const env = { PATH: process.env.PATH, HOME: home, CODING_FEATURE_LSL: 'on' };
      const args = stageClaudeSession(stage, { repo, env });

      assert.deepStrictEqual(args, [
        '--settings', `${BOX_CLAUDE_SESSION}/settings.json`,
        '--plugin-dir', `${BOX_CLAUDE_SESSION}/claude-plugin`,
        '--mcp-config', `${BOX_CLAUDE_SESSION}/mcp.json`,
        '--strict-mcp-config',
      ]);
      assert.deepStrictEqual(fs.readdirSync(path.join(stage, 'claude-plugin', 'commands')).sort(), ['graphify.md', 'sl.md']);
      assert.ok(fs.existsSync(path.join(stage, 'claude-plugin', '.claude-plugin', 'plugin.json')));
      const settings = JSON.parse(fs.readFileSync(path.join(stage, 'settings.json'), 'utf8'));
      assert.strictEqual(settings.model, 'opus[1m]');
      assert.ok(!('hooks' in settings) && !('statusLine' in settings));
      assert.match(fs.readFileSync(path.join(stage, 'mcp.json'), 'utf8'), /http:\/\/host\.docker\.internal:3851\/mcp/);
      assert.deepStrictEqual(fs.readdirSync(stage).sort(), ['claude-plugin', 'mcp.json', 'settings.json'], 'nothing else is left in the mounted dir');
      assert.ok(!fs.existsSync(path.join(repo, '.coding')), "the repo's own .coding/ is never touched");

      assert.ok(!stageClaudeSession(fs.mkdtempSync(path.join(tmp, 's-')), { repo, env: { ...env, CODING_MCP_STRICT: '0' } }).includes('--strict-mcp-config'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a failing generator is reported, not silently ignored', () => {
    const run = () => ({ status: 1, stdout: '', stderr: 'boom\nlast line' });
    assert.throws(() => stageClaudeSession('/nonexistent', { run }), /last line/);
  });
});

describe('git identity in the box', () => {
  // The box has no ~/.gitconfig: on 2026-11-09 a boxed commit failed with
  // "Author identity unknown". Name and email are passed; the file is not.
  test('name and email become author and committer env', () => {
    const e = envs(boxRunArgs({ ...base, gitIdentity: { name: 'Ada Lovelace', email: 'ada@example.com' } }));
    assert.strictEqual(e.GIT_AUTHOR_NAME, 'Ada Lovelace');
    assert.strictEqual(e.GIT_COMMITTER_NAME, 'Ada Lovelace');
    assert.strictEqual(e.GIT_AUTHOR_EMAIL, 'ada@example.com');
    assert.strictEqual(e.GIT_COMMITTER_EMAIL, 'ada@example.com');
  });

  test('no identity on the host → nothing is set, and ~/.gitconfig is never mounted', () => {
    const argv = boxRunArgs({ ...base, gitIdentity: { name: null, email: null } });
    assert.ok(!Object.keys(envs(argv)).some((k) => k.startsWith('GIT_')));
    assert.ok(!volumes(argv).some((v) => v.includes('.gitconfig')));
    assert.deepStrictEqual(gitIdentityEnv({ name: 'A', email: null }), { GIT_AUTHOR_NAME: 'A', GIT_COMMITTER_NAME: 'A' });
  });

  test('read with git config in the workspace, so a repo-local identity wins', () => {
    const calls = [];
    const run = (cmd, args, opts) => {
      calls.push([cmd, args, opts.cwd]);
      return args[2] === 'user.name' ? { status: 0, stdout: 'Ada\n' } : { status: 1, stdout: '' };
    };
    assert.deepStrictEqual(hostGitIdentity('/w', run), { name: 'Ada', email: null });
    assert.deepStrictEqual(calls.map((c) => [c[0], c[1].join(' '), c[2]]), [
      ['git', 'config --get user.name', '/w'], ['git', 'config --get user.email', '/w'],
    ]);
  });

  test('against a real repo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'box-git-id-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'Repo Local'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'local@example.com'], { cwd: dir });
      assert.deepStrictEqual(hostGitIdentity(dir), { name: 'Repo Local', email: 'local@example.com' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the coding hooks in the box', () => {
  const policy = JSON.parse(fs.readFileSync(new URL('../../docker/agent-box/managed-settings.json', import.meta.url), 'utf8')).hooks;
  const runner = (name) => `/usr/bin/env -u NODE_OPTIONS /usr/local/bin/node /opt/coding-box/coding-hook.mjs ${name}`;

  test('the managed policy runs them where a host Claude does: after each tool call, on each prompt', () => {
    assert.ok(policy.PostToolUse.some((e) => e.matcher === '*' && e.hooks[0].command === runner('tool-interaction')));
    assert.strictEqual(policy.UserPromptSubmit[0].hooks[0].command, runner('health-prompt'));
    assert.ok(policy.UserPromptSubmit[0].hooks[0].timeout <= 5, 'a slow coordinator must not hold up the prompt');
    // The guard stays first and unchanged.
    assert.match(policy.PostToolUse[0].hooks[0].command, /^\/usr\/bin\/env -i .* \/opt\/coding-guard\//);
  });

  test('the runner runs the same scripts the host config installs, and the image ships it', () => {
    const host = fs.readFileSync(new URL('../../scripts/build-claude-runtime-config.mjs', import.meta.url), 'utf8');
    for (const rel of Object.values(HOOK_SCRIPTS)) {
      assert.ok(host.includes(`\${repoPath}/${rel}`), rel);
      assert.ok(fs.existsSync(new URL(`../../${rel}`, import.meta.url)), rel);
    }
    assert.deepStrictEqual(Object.keys(HOOK_SCRIPTS).sort(), Object.keys(BOX_CODING_HOOKS).sort());
    const dockerfile = fs.readFileSync(new URL('../../docker/agent-box/Dockerfile', import.meta.url), 'utf8');
    assert.match(dockerfile, /^COPY coding-hook\.mjs \/opt\/coding-box\/coding-hook\.mjs$/m);
  });

  test('only hooks whose feature is on reach the box (fail closed)', () => {
    assert.deepStrictEqual(boxCodingHooks(() => true), ['tool-interaction', 'health-prompt']);
    assert.deepStrictEqual(boxCodingHooks((f) => f === 'health'), ['health-prompt']);
    assert.deepStrictEqual(boxCodingHooks(() => { throw new Error('broken config'); }), []);
    const e = envs(boxRunArgs({ ...base, codingHooks: ['tool-interaction', 'health-prompt'] }));
    assert.strictEqual(e.CODING_BOX_HOOKS, 'tool-interaction,health-prompt');
    assert.strictEqual(e.HEALTH_COORDINATOR_URL, 'http://host.docker.internal:3034');
    assert.ok(!('CODING_BOX_HOOKS' in envs(boxRunArgs(base))));
  });

  test('the runner picks a script only when it is enabled and present', () => {
    const env = { CODING_REPO: '/repo', CODING_BOX_HOOKS: 'tool-interaction' };
    const yes = () => true;
    assert.strictEqual(hookScript('tool-interaction', env, yes), '/repo/scripts/tool-interaction-hook-wrapper.js');
    assert.strictEqual(hookScript('health-prompt', env, yes), null, 'feature off');
    assert.strictEqual(hookScript('tool-interaction', env, () => false), null, 'missing script');
    assert.strictEqual(hookScript('tool-interaction', { ...env, CODING_REPO: 'repo' }, yes), null, 'relative repo');
    assert.strictEqual(hookScript('constructor', { ...env, CODING_BOX_HOOKS: 'constructor' }, yes), null, 'unknown name');
  });

  test('the health hook, run by the runner, reads the coordinator and exits 0', async () => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ overallStatus: 'healthy', services: {} }));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const repo = fileURLToPath(new URL('../..', import.meta.url));
      const out = await new Promise((resolve) => {
        const child = spawn(process.execPath, [fileURLToPath(new URL('../../docker/agent-box/coding-hook.mjs', import.meta.url)), 'health-prompt'], {
          env: { PATH: process.env.PATH, CODING_REPO: repo, CODING_TOOLS_PATH: repo, CODING_BOX_HOOKS: 'health-prompt', HEALTH_COORDINATOR_URL: `http://127.0.0.1:${srv.address().port}` },
        });
        let stdout = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stdin.end(JSON.stringify({ prompt: 'hi' }));
        child.on('exit', (code) => resolve({ code, stdout }));
      });
      assert.strictEqual(out.code, 0);
      assert.strictEqual(JSON.parse(out.stdout).hookSpecificOutput.hookEventName, 'UserPromptSubmit');
      assert.match(JSON.parse(out.stdout).hookSpecificOutput.additionalContext, /System Health/);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });
});

describe('claudeGaugeSession — the boxed session id the host gauge reads', async () => {
  const { claudeGaugeSession, claudeLaunchModel } = await import('../../scripts/agent-box.mjs');
  const id = '11111111-2222-3333-4444-555555555555';
  test('a fresh launch is pinned to a new id', () => {
    const r = claudeGaugeSession(['--settings', 'x'], () => id);
    assert.deepStrictEqual(r, { args: ['--settings', 'x', '--session-id', id], sessionId: id });
  });
  test('an explicit --resume or --session-id is read back, args untouched', () => {
    assert.deepStrictEqual(claudeGaugeSession(['--resume', id]), { args: ['--resume', id], sessionId: id });
    assert.deepStrictEqual(claudeGaugeSession([`--session-id=${id}`]), { args: [`--session-id=${id}`], sessionId: id });
  });
  test('continue, picker resume and fork leave the id to Claude', () => {
    for (const args of [['-c'], ['--resume'], ['-r', '--model', 'opus'], ['--resume', id, '--fork-session']]) {
      assert.deepStrictEqual(claudeGaugeSession(args), { args, sessionId: null }, args.join(' '));
    }
  });
  test('model: --model, then staged settings, then env', () => {
    assert.strictEqual(claudeLaunchModel(['--model', 'opus[1m]']), 'opus[1m]');
    assert.strictEqual(claudeLaunchModel([], null, { ANTHROPIC_MODEL: 'sonnet' }), 'sonnet');
    assert.strictEqual(claudeLaunchModel([], '/nonexistent', {}), null);
  });
});
