/**
 * Host-daemon and container-program gating — drift guards.
 *
 * Three copies of the program/daemon -> feature mapping have to exist, because
 * three different runtimes need it and none can call the others:
 *
 *   lib/features/daemons.mjs        Node, host service managers
 *   scripts/apply-features.mjs      Node, an ALREADY RUNNING container
 *   docker/entrypoint.sh            bash, container boot (no resolver available)
 *
 * docs/architecture/features.md is the contract all three answer to. These
 * tests fail when any of the four disagree.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { DAEMONS, platform, isInstalled, start, stop } from '../../lib/features/daemons.mjs';

const require = createRequire(import.meta.url);
const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;
const { FEATURE_IDS } = require(join(REPO, 'lib/features/catalogue.cjs'));

const doc = readFileSync(join(REPO, 'docs/architecture/features.md'), 'utf8');
const entrypoint = readFileSync(join(REPO, 'docker/entrypoint.sh'), 'utf8');
const applyScript = readFileSync(join(REPO, 'scripts/apply-features.mjs'), 'utf8');

function entrypointMapping() {
  const block = /PROGRAM_FEATURES="\\?\n?([\s\S]*?)"/.exec(entrypoint);
  const out = {};
  for (const [, program, feature] of block[1].matchAll(/([a-z0-9-]+):([a-z0-9-]+)/g)) out[program] = feature;
  return out;
}

function applyMapping() {
  const block = /const CONTAINER_PROGRAMS = \{([\s\S]*?)\n\};/.exec(applyScript);
  assert.ok(block, 'CONTAINER_PROGRAMS not found in scripts/apply-features.mjs');
  const out = {};
  for (const [, program, feature] of block[1].matchAll(/'?([a-z0-9-]+)'?:\s*'([a-z0-9-]+)'/g)) {
    out[program] = feature;
  }
  return out;
}

describe('host daemons', () => {
  test('every daemon names a real feature', () => {
    for (const [name, feature] of Object.entries(DAEMONS)) {
      assert.ok(FEATURE_IDS.includes(feature), `${name} maps to unknown feature '${feature}'`);
    }
  });

  test('every daemon appears in the documented matrix with the same feature', () => {
    for (const [name, feature] of Object.entries(DAEMONS)) {
      const row = new RegExp(`\`com\\.coding\\.${name.replace(/[-]/g, '-')}\`.*\`${feature}\``);
      assert.match(doc, row, `docs/architecture/features.md has no row for com.coding.${name} -> ${feature}`);
    }
  });

  test('the documented daemon table has no rows this module is missing', () => {
    const documented = [...doc.matchAll(/\| `com\.coding\.([a-z0-9-]+)` \|[^|]*\| `([a-z0-9-]+)` \|/g)]
      .map((m) => m[1]);
    for (const name of documented) {
      assert.ok(DAEMONS[name], `docs name com.coding.${name}, which lib/features/daemons.mjs does not control`);
    }
  });

  test('no daemon is owned by a feature that cannot be switched off alone', () => {
    // `statusline` has no daemons; a daemon claiming it would never be stopped
    // by any realistic profile.
    assert.ok(!Object.values(DAEMONS).includes('statusline'));
  });
});

describe('container programs', () => {
  test('entrypoint.sh and apply-features.mjs agree exactly', () => {
    // One decides autostart at container boot, the other reconciles a running
    // container. A program in only one of them is gated in only half the cases.
    assert.deepEqual(applyMapping(), entrypointMapping());
  });

  test('every container program names a real feature', () => {
    for (const [program, feature] of Object.entries(applyMapping())) {
      assert.ok(FEATURE_IDS.includes(feature), `${program} maps to unknown feature '${feature}'`);
    }
  });

  test('host daemons and container programs do not overlap', () => {
    const overlap = Object.keys(DAEMONS).filter((n) => applyMapping()[n]);
    assert.deepEqual(overlap, [], 'a unit controlled by both backends would be fought over');
  });
});

describe('platform backend', () => {
  test('reports a supported platform here', () => {
    assert.ok(['macos', 'linux', 'windows'].includes(platform()), `unsupported: ${platform()}`);
  });

  test('an uninstalled unit is skipped, not failed', async () => {
    // A wrapper-scoped install has no daemons at all; that must not read as an
    // error, and must not be reported as a successful stop either.
    const bogus = 'definitely-not-installed-unit';
    assert.equal(await isInstalled(bogus), false);
    const stopped = await stop(bogus);
    assert.equal(stopped.action, 'skipped');
    assert.match(stopped.reason, /not installed/);
  });

  test('starting an uninstalled unit points at repair rather than claiming success', async () => {
    const started = await start('definitely-not-installed-unit');
    assert.equal(started.action, 'skipped');
    assert.match(started.reason, /coding-features repair/);
  });

  test('dryRun never touches the machine', async () => {
    // Picks a daemon that IS installed here when there is one, so the dry-run
    // path is exercised rather than short-circuited by the not-installed check.
    const installed = [];
    for (const name of Object.keys(DAEMONS)) {
      if (await isInstalled(name)) installed.push(name);
    }
    if (!installed.length) return; // nothing installed on this machine; nothing to prove
    const r = await stop(installed[0], { dryRun: true });
    assert.equal(r.action, 'would-stop');
    assert.equal(await isInstalled(installed[0]), true, 'dryRun must not remove anything');
  });
});
