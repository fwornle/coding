/**
 * Slash commands follow their owning feature (lib/features/skills.cjs).
 *
 * A skill is a feature's entry point into an agent session, like a hook: a
 * harness install offering `/constraints` or `/semantic` hands the agent a
 * command that can only fail.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const exec = promisify(execFile);
const REPO = (process.env.CODING_REPO || new URL('../..', import.meta.url).pathname).replace(/\/$/, '');
const { SKILL_FEATURES } = require(join(REPO, 'lib/features/skills.cjs'));
const { FEATURE_IDS } = require(join(REPO, 'lib/features/catalogue.cjs'));

const SKILLS = readdirSync(join(REPO, '.claude/commands'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.slice(0, -3));

describe('the skill map cannot drift', () => {
  test('every skill has an owner (or null for base)', () => {
    for (const name of SKILLS) {
      assert.ok(Object.hasOwn(SKILL_FEATURES, name), `${name}.md has no entry in lib/features/skills.cjs`);
    }
  });

  test('every entry names a real skill and a real feature', () => {
    for (const [name, feature] of Object.entries(SKILL_FEATURES)) {
      assert.ok(SKILLS.includes(name), `skills.cjs lists '${name}', which has no .claude/commands/${name}.md`);
      if (feature !== null) assert.ok(FEATURE_IDS.includes(feature), `${name}: unknown feature '${feature}'`);
    }
  });
});

describe('the per-launch plugin ships only enabled skills', () => {
  async function pluginSkills(profile) {
    const dir = mkdtempSync(join(tmpdir(), 'coding-skills-'));
    try {
      mkdirSync(join(dir, 'home', '.coding'), { recursive: true });
      writeFileSync(join(dir, 'home', '.coding', 'features.yaml'), `profile: ${profile}\n`);
      await exec('node', [join(REPO, 'scripts/build-claude-runtime-config.mjs')], {
        cwd: REPO,
        env: { ...process.env, CODING_REPO: REPO, CODING_HOME: join(dir, 'home'), CODING_RUNTIME_DIR: join(dir, 'rt') },
      });
      return readdirSync(join(dir, 'rt', 'claude-plugin', 'commands')).map((f) => f.slice(0, -3)).sort();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('harness gets only the base skills', async () => {
    const want = SKILLS.filter((n) => SKILL_FEATURES[n] === null).sort();
    assert.deepEqual(await pluginSkills('harness'), want);
  });

  test('everything gets every skill', async () => {
    assert.deepEqual(await pluginSkills('everything'), [...SKILLS].sort());
  });
});
