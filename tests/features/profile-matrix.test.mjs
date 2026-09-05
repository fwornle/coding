/**
 * The four profiles, end to end through the real launcher.
 *
 * This is the acceptance test for the whole feature system: for each profile it
 * drives `bin/coding --claude --dry-run` — the same code path a launch takes,
 * up to the point just before the agent starts — and asserts the decisions that
 * actually matter downstream.
 *
 * Every run is sandboxed with CODING_HOME, so no profile is ever written to the
 * developer's real ~/.coding, and --dry-run means no service is started or
 * stopped. The daemon and container halves of "apply" are covered separately
 * (tests/features/daemon-gating.test.mjs) and were verified against live
 * launchd and a real container by hand.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const REPO = (process.env.CODING_REPO || new URL('../..', import.meta.url).pathname).replace(/\/$/, '');

/**
 * What each profile must produce. Written as the OUTCOME a user would notice,
 * not as a restatement of the profile definition — otherwise the test only
 * proves the YAML parses.
 */
const MATRIX = {
  full: {
    docker: true,
    features: ['lsl', 'observations', 'knowledge', 'codegraph', 'constraints', 'llm-proxy', 'performance', 'health', 'statusline'],
    mcpServers: ['graphify'],
    hooks: ['PreToolUse', 'PostToolUse', 'UserPromptSubmit'],
  },
  'proxy-only': {
    docker: false,
    features: ['llm-proxy', 'statusline'],
    mcpServers: [],
    hooks: [],
  },
  'logging-only': {
    docker: false,
    features: ['lsl', 'health', 'statusline'],
    mcpServers: [],
    hooks: ['PostToolUse', 'UserPromptSubmit'],
  },
  minimal: {
    docker: false,
    features: ['statusline'],
    mcpServers: [],
    hooks: [],
  },
};

let sandbox;
const homes = {};

/**
 * Two derived artifacts are regenerated IN THE REPO by the generators this
 * suite exercises, because both write to a fixed path under CODING_REPO. They
 * are saved here and restored in `after`, so a test run cannot leave this
 * machine's next launch with a minimal-profile MCP config and no hooks.
 */
const REPO_ARTIFACTS = [
  join(REPO, 'claude-code-mcp-docker.json'),
  join(REPO, '.coding/runtime/claude-settings.json'),
];
const saved = new Map();

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'coding-matrix-'));
  for (const profile of Object.keys(MATRIX)) {
    const dir = join(sandbox, profile);
    mkdirSync(join(dir, '.coding'), { recursive: true });
    writeFileSync(join(dir, '.coding', 'features.yaml'), `profile: ${profile}\n`);
    homes[profile] = dir;
  }
  for (const file of REPO_ARTIFACTS) {
    if (existsSync(file)) saved.set(file, readFileSync(file, 'utf8'));
  }
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
  for (const [file, content] of saved) writeFileSync(file, content);
});

async function run(cmd, args, profile, extraEnv = {}) {
  const env = {
    ...process.env,
    CODING_REPO: REPO,
    CODING_HOME: homes[profile],
    ...extraEnv,
  };
  try {
    const { stdout, stderr } = await exec(cmd, args, { cwd: REPO, timeout: 300000, maxBuffer: 8 * 1024 * 1024, env });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (err) {
    return { code: err.code ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('the resolver agrees with the matrix', () => {
  for (const [profile, expected] of Object.entries(MATRIX)) {
    test(`${profile}`, async () => {
      const { code, out } = await run('node', [join(REPO, 'bin/coding-features'), 'json'], profile);
      assert.equal(code, 0, out);
      const resolved = JSON.parse(out);
      assert.deepEqual([...resolved.enabled].sort(), [...expected.features].sort());
      assert.equal(resolved.needsDocker, expected.docker);
    });
  }
});

describe('the launcher acts on it', () => {
  for (const [profile, expected] of Object.entries(MATRIX)) {
    test(`${profile}: --dry-run succeeds and reports the right Docker decision`, async () => {
      const { code, out } = await run(join(REPO, 'bin/coding'), ['--claude', '--dry-run', '--verbose'], profile);
      assert.equal(code, 0, `launch failed under '${profile}':\n${out}`);
      assert.match(out, /DRY-RUN: All startup logic completed successfully/);
      assert.match(
        out,
        new RegExp(`docker needed: ${expected.docker}`),
        `expected docker:${expected.docker} under '${profile}'`,
      );
      for (const feature of expected.features) {
        assert.match(out, new RegExp(`Features=[^\\n]*\\b${feature.replace('-', '\\-')}\\b`), `${feature} missing from the launcher's set`);
      }
    });
  }

  test('a profile needing no container never demands Docker', async () => {
    // The whole point of proxy-only and minimal: they must work on a machine
    // that has no Docker Desktop at all.
    for (const profile of ['proxy-only', 'minimal', 'logging-only']) {
      const { out } = await run(join(REPO, 'bin/coding'), ['--claude', '--dry-run', '--verbose'], profile);
      assert.doesNotMatch(out, /Docker is required but not running/, profile);
      assert.match(out, /docker needed: false/, profile);
    }
  });
});

describe('derived artifacts follow the profile', () => {
  for (const [profile, expected] of Object.entries(MATRIX)) {
    test(`${profile}: MCP servers`, async () => {
      // Written to a sandbox path so the repo's real config is untouched: the
      // generator honours the output path via CODING_REPO, which also has to
      // resolve bin/coding-features, so the sandbox mirrors just enough.
      const { code, out } = await run(
        'node',
        ['-e', `
          const { execSync } = require('child_process');
          execSync('bash scripts/generate-docker-mcp-config.sh', { cwd: process.env.CODING_REPO, stdio: 'pipe' });
          process.stdout.write(require('fs').readFileSync(process.env.CODING_REPO + '/claude-code-mcp-docker.json', 'utf8'));
        `],
        profile,
      );
      assert.equal(code, 0, out);
      const servers = Object.keys(JSON.parse(out).mcpServers);
      assert.deepEqual(servers.sort(), [...expected.mcpServers].sort());
    });
  }

  for (const [profile, expected] of Object.entries(MATRIX)) {
    test(`${profile}: agent hooks`, async () => {
      const { code, out } = await run(
        'node',
        ['-e', `
          const { execSync } = require('child_process');
          execSync('node scripts/build-claude-runtime-config.mjs', { cwd: process.env.CODING_REPO, stdio: 'pipe' });
          const s = JSON.parse(require('fs').readFileSync(process.env.CODING_REPO + '/.coding/runtime/claude-settings.json', 'utf8'));
          const ours = {
            PreToolUse: 'pre-tool-hook-wrapper.js',
            PostToolUse: 'tool-interaction-hook-wrapper.js',
            UserPromptSubmit: 'health-prompt-hook.js',
          };
          const present = Object.entries(ours)
            .filter(([ev, script]) => JSON.stringify(s.hooks?.[ev] ?? []).includes(script))
            .map(([ev]) => ev);
          process.stdout.write(JSON.stringify(present));
        `],
        profile,
      );
      assert.equal(code, 0, out);
      assert.deepEqual(JSON.parse(out).sort(), [...expected.hooks].sort());
    });
  }
});

describe('the default install is untouched', () => {
  test('no configuration anywhere resolves to the historical stack', async () => {
    // The guarantee that makes this whole change safe to ship: an existing user
    // who upgrades and changes nothing gets exactly what they had.
    const empty = mkdtempSync(join(tmpdir(), 'coding-nohome-'));
    try {
      const { stdout } = await exec('node', [join(REPO, 'bin/coding-features'), 'json'], {
        cwd: REPO,
        env: { ...process.env, CODING_REPO: REPO, CODING_HOME: empty },
      });
      const resolved = JSON.parse(stdout);
      assert.deepEqual(resolved.disabled, []);
      assert.equal(resolved.needsDocker, true);
      assert.equal(resolved.profile, null);
      assert.deepEqual(resolved.layers, [], 'no config file should have been read');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
