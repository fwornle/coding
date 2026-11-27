/**
 * Nothing user-facing is unmapped (.planning/coding-releases.md, P1): every
 * `bin/*` command and every dashboard route is in lib/features/surfaces.cjs,
 * under a feature or `core`, and the registry agrees with the code's own gates.
 *
 * Read from the sources rather than restated, so a new command or route fails
 * here until someone decides which feature it belongs to.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = (process.env.CODING_REPO || new URL('../..', import.meta.url).pathname).replace(/\/$/, '');
const { CORE, CLIS, ROUTES } = require(join(REPO, 'lib/features/surfaces.cjs'));
const { FEATURE_IDS } = require(join(REPO, 'lib/features/resolve.cjs'));

const DASH = join(REPO, 'integrations/system-health-dashboard/src');
const APP = readFileSync(join(DASH, 'App.tsx'), 'utf8');
const NAV = readFileSync(join(DASH, 'components/nav-bar.tsx'), 'utf8');
const DOCS = readFileSync(join(REPO, 'docs/architecture/features.md'), 'utf8');

const known = (f) => f === 'core' || FEATURE_IDS.includes(f);

describe('CLIs', () => {
  test('every bin/* command is in the registry, and nothing else is', () => {
    const onDisk = readdirSync(join(REPO, 'bin')).map((f) => `bin/${f}`).sort();
    assert.deepEqual(Object.keys(CLIS).sort(), onDisk);
  });

  test('every entry names a real feature or core', () => {
    for (const [cli, e] of Object.entries(CLIS)) assert.ok(known(e.feature), `${cli}: unknown feature '${e.feature}'`);
  });

  test('a guarded command guards on its own feature; core never refuses', () => {
    for (const [cli, e] of Object.entries(CLIS)) {
      const path = join(REPO, cli);
      if (lstatSync(path).isSymbolicLink()) continue; // bin/ckb: dangling, see its `why`
      const src = readFileSync(path, 'utf8');
      if (e.guard) assert.match(src, new RegExp(`require_feature ${e.feature}\\b`), `${cli} does not guard on ${e.feature}`);
      else assert.doesNotMatch(src, /require_feature /, `${cli} guards, but the registry says it does not`);
    }
  });

  test('an unguarded command of a feature says why', () => {
    for (const [cli, e] of Object.entries(CLIS)) {
      if (e.feature !== 'core' && !e.guard) assert.ok(e.why, `${cli} belongs to ${e.feature} but is not guarded, and says nothing about why`);
    }
  });
});

describe('dashboard routes', () => {
  const gates = Object.fromEntries([...APP.matchAll(/const (Gated\w+) = gated\('([\w-]+)'/g)].map((m) => [m[1], m[2]]));
  const routes = Object.fromEntries([...APP.matchAll(/<Route path="([^"]+)" element=\{<(\w+)/g)].map((m) => [m[1], m[2]]));

  test('every route is in the registry, and nothing else is', () => {
    assert.deepEqual(Object.keys(ROUTES).sort(), Object.keys(routes).sort());
  });

  test("a feature's route renders through that feature's gate; a core route is never gated", () => {
    for (const [path, e] of Object.entries(ROUTES)) {
      assert.ok(known(e.feature), `${path}: unknown feature '${e.feature}'`);
      const el = routes[path];
      if (e.feature === 'core') { assert.equal(gates[el], undefined, `${path} is core but gated`); continue; }
      if (e.why) continue;
      assert.equal(gates[el], e.feature, `${path} renders ${el}, which ${gates[el] ? `gates on ${gates[el]}` : 'is not gated'}`);
    }
  });

  test('each nav tab gates on the same feature as its route', () => {
    const tabs = [...NAV.matchAll(/\{ label: '[^']+', path: '([^']+)'[^}]*?feature: '([\w-]+)'/g)];
    assert.ok(tabs.length >= 9, 'nav tabs not found');
    for (const [, path, feature] of tabs) assert.equal(feature, ROUTES[path]?.feature, `nav ${path}`);
    // The Teams entry is an icon, not a tab row.
    assert.match(NAV, /features\.teams\?\.enabled !== false && \(\s*<Link\s+to="\/teams"/);
  });
});

describe('core is written down', () => {
  test('docs/architecture/features.md lists core and every core command', () => {
    const section = DOCS.slice(DOCS.indexOf('## Core'));
    assert.ok(DOCS.includes('## Core'), 'no ## Core section');
    for (const line of CORE) assert.ok(section.includes(line), `core item missing from the docs: ${line}`);
    for (const [cli, e] of Object.entries(CLIS)) {
      if (e.feature === 'core') assert.ok(section.includes(cli), `${cli} is core but not in the docs' core section`);
    }
  });
});
