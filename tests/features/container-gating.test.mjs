/**
 * Container-side feature gating — drift guard.
 *
 * The program -> feature mapping has to exist inside `docker/entrypoint.sh`,
 * because the container cannot run the resolver: ~/.coding/features.yaml is on
 * the host and never mounted, so all it gets is the flat snapshot. That means
 * the mapping is a second copy of knowledge that also lives in the catalogue and
 * in docs/architecture/features.md.
 *
 * These tests are what stop the copies drifting: a program added to
 * supervisord.conf without a feature, or a feature renamed in the catalogue,
 * fails here rather than silently starting (or never starting) in production.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;
const { FEATURE_IDS } = require(join(REPO, 'lib/features/catalogue.cjs'));

const supervisord = readFileSync(join(REPO, 'docker/supervisord.conf'), 'utf8');
const entrypoint = readFileSync(join(REPO, 'docker/entrypoint.sh'), 'utf8');
const compose = readFileSync(join(REPO, 'docker/docker-compose.yml'), 'utf8');

/** `[program:name]` sections, ignoring commented-out ones. */
function supervisordPrograms() {
  return [...supervisord.matchAll(/^\[program:([^\]]+)\]/gm)].map((m) => m[1]).sort();
}

/** The PROGRAM_FEATURES list in entrypoint.sh, as {program: feature}. */
function entrypointMapping() {
  const block = /PROGRAM_FEATURES="\\?\n?([\s\S]*?)"/.exec(entrypoint);
  assert.ok(block, 'PROGRAM_FEATURES not found in docker/entrypoint.sh');
  const out = {};
  for (const [, program, feature] of block[1].matchAll(/([a-z0-9-]+):([a-z0-9-]+)/g)) {
    out[program] = feature;
  }
  return out;
}

describe('supervisord include', () => {
  test('the features.d include is declared', () => {
    // Without this, the generated override file is written and never read —
    // gating would appear to work while every program still autostarted.
    assert.match(supervisord, /^\[include\]\s*$/m);
    assert.match(supervisord, /^files\s*=\s*\/etc\/supervisor\/features\.d\/\*\.conf\s*$/m);
  });

  test('the include is declared before [supervisord]', () => {
    assert.ok(
      supervisord.indexOf('[include]') < supervisord.indexOf('[supervisord]'),
      'section order is how supervisor finds the include',
    );
  });
});

describe('program -> feature mapping', () => {
  test('every supervisord program is mapped', () => {
    const mapped = Object.keys(entrypointMapping()).sort();
    assert.deepEqual(
      supervisordPrograms(),
      mapped,
      'a program with no feature can never be switched off',
    );
  });

  test('every mapped feature exists in the catalogue', () => {
    for (const [program, feature] of Object.entries(entrypointMapping())) {
      assert.ok(
        FEATURE_IDS.includes(feature),
        `${program} maps to '${feature}', which is not a feature`,
      );
    }
  });

  test('the mapping matches the documented matrix', () => {
    // The doc is the contract; this catches an edit to one without the other.
    const doc = readFileSync(join(REPO, 'docs/architecture/features.md'), 'utf8');
    for (const [program, feature] of Object.entries(entrypointMapping())) {
      const row = new RegExp(`^\\|\\s*\`${program}\`\\s*\\|.*\\|\\s*\`${feature}\`\\s*\\|`, 'm');
      assert.match(doc, row, `docs/architecture/features.md has no row mapping ${program} -> ${feature}`);
    }
  });

  test('only container-backed features are named', () => {
    // A container program owned by a feature the resolver marks needsDocker:false
    // would mean the launcher could skip Docker while something still needed it.
    const { FEATURES } = require(join(REPO, 'lib/features/catalogue.cjs'));
    for (const [program, feature] of Object.entries(entrypointMapping())) {
      if (feature === 'health') continue; // has host implementations; see the catalogue note
      assert.equal(
        FEATURES[feature].needsDocker, true,
        `${program} runs only in the container, so '${feature}' must declare needsDocker`,
      );
    }
  });
});

describe('snapshot delivery', () => {
  test('the compose file mounts the runtime snapshot into the container', () => {
    assert.match(
      compose,
      /\$\{CODING_REPO:-\.\}\/\.coding\/runtime:\/coding\/\.coding\/runtime:ro/,
      'without this mount the entrypoint has nothing to read and starts everything',
    );
  });

  test('the entrypoint reads the snapshot from the mounted path', () => {
    assert.match(entrypoint, /FEATURES_SNAPSHOT="\/coding\/\.coding\/runtime\/features\.json"/);
  });

  test('a missing snapshot fails OPEN', () => {
    // A container that silently ran nothing because a JSON file was late is far
    // harder to diagnose than one that ran too much.
    assert.match(entrypoint, /No feature snapshot .* starting everything/);
  });

  test('an unknown feature in the snapshot reads as enabled', () => {
    // So a snapshot written by an older host cannot switch a new program off.
    assert.match(entrypoint, /value === false \? "false" : "true"/);
  });
});
