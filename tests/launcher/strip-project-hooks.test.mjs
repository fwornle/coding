/**
 * Stale coding hooks in a project's .claude/settings.local.json.
 *
 * Old installs registered coding's hooks there. After the
 * mcp-constraint-monitor -> constraint-monitor rename those paths no longer
 * exist, and a host (`--no-box`) session failed with "Cannot find module" on
 * every prompt and tool call. The launcher now strips them; the user's own
 * hooks and every other key must survive.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripCodingHooks, isCodingHook } from '../../scripts/strip-project-hooks.mjs';

const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;

const STALE_PROMPT = 'node /x/coding/integrations/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js';
const STALE_TOOL = 'node /x/coding/integrations/mcp-constraint-monitor/src/hooks/pre-tool-hook-wrapper.js';
const USER_HOOK = 'bash ~/.claude/hooks/my-own-hook.sh';

function legacySettings() {
  return {
    permissions: { allow: ['Bash(ls:*)'], deny: [], ask: [] },
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: STALE_PROMPT }] }],
      PreToolUse: [
        { hooks: [{ type: 'command', command: STALE_TOOL }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: USER_HOOK }] },
      ],
    },
  };
}

describe('isCodingHook', () => {
  test('recognises current and retired coding hook scripts', () => {
    assert.ok(isCodingHook(STALE_PROMPT));
    assert.ok(isCodingHook(STALE_TOOL));
    assert.ok(isCodingHook('node /y/coding/integrations/constraint-monitor/src/hooks/pre-tool-hook-wrapper.js'));
    assert.ok(isCodingHook('node /y/coding/scripts/tool-interaction-hook-wrapper.js'));
    assert.ok(isCodingHook('node /y/coding/scripts/health-prompt-hook.js'));
  });

  test('leaves other hooks alone', () => {
    assert.ok(!isCodingHook(USER_HOOK));
    assert.ok(!isCodingHook('node "/Users/u/.claude/hooks/gsd-prompt-guard.js"'));
    assert.ok(!isCodingHook(undefined));
  });
});

describe('stripCodingHooks', () => {
  test('removes coding hooks, keeps the user hook and permissions', () => {
    const { settings, removed } = stripCodingHooks(legacySettings());
    assert.deepEqual(removed, [STALE_PROMPT, STALE_TOOL]);
    assert.deepEqual(settings.permissions, legacySettings().permissions);
    assert.equal(settings.hooks.UserPromptSubmit, undefined);
    assert.deepEqual(settings.hooks.PreToolUse, [
      { matcher: 'Bash', hooks: [{ type: 'command', command: USER_HOOK }] },
    ]);
  });

  test('drops the hooks key when nothing is left', () => {
    const s = legacySettings();
    s.hooks.PreToolUse.pop();
    const { settings } = stripCodingHooks(s);
    assert.equal('hooks' in settings, false);
  });

  test('returns the same object when there is nothing to strip', () => {
    const s = { permissions: {}, hooks: { Stop: [{ hooks: [{ type: 'command', command: USER_HOOK }] }] } };
    const { settings, removed } = stripCodingHooks(s);
    assert.equal(settings, s);
    assert.deepEqual(removed, []);
  });
});

describe('strip_stale_project_hooks (launcher)', () => {
  function run(project) {
    return execFileSync('bash', ['-c',
      `source "${REPO}/scripts/agent-common-setup.sh" >/dev/null 2>&1; strip_stale_project_hooks "$1" "$2"`,
      '--', project, REPO], { encoding: 'utf8' });
  }

  test('rewrites a legacy file and is a no-op on the second run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'strip-hooks-'));
    try {
      mkdirSync(join(dir, '.claude'));
      const file = join(dir, '.claude', 'settings.local.json');
      writeFileSync(file, JSON.stringify(legacySettings(), null, 2));

      const first = run(dir);
      assert.match(first, /Removed 2 stale coding hook/);
      const after = JSON.parse(readFileSync(file, 'utf8'));
      assert.deepEqual(after.hooks, {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: USER_HOOK }] }],
      });

      const mtime = statSync(file).mtimeMs;
      assert.equal(run(dir).trim(), '');
      assert.equal(statSync(file).mtimeMs, mtime, 'a clean file must not be rewritten');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a project without settings.local.json is fine', () => {
    const dir = mkdtempSync(join(tmpdir(), 'strip-hooks-'));
    try {
      assert.equal(run(dir).trim(), '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
