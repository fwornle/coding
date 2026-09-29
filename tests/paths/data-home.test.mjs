/**
 * Data root — derivation, the tracked/untracked split, and the overrides.
 *
 * Every test passes explicit `homeDir` / `env` options, so the suite never reads
 * or disturbs the developer's own ~/.coding/data. The tracked-vs-var assertions
 * are the load-bearing ones: if a database or a snapshot archive ever lands on
 * the kb/ side, someone eventually commits gigabytes to a knowledge repo.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;

const paths = require(join(REPO, 'lib/paths/data-home.cjs'));
const {
  dataHome, historyDir, kbDir, varDir,
  graphExportsDir, insightsDir, observationExportDir, knowledgeExportDir,
  graphDbDir, proxyDataDir, experimentsDir, kgbenchDir, measurementsDir, runSnapshotsDir,
  explain, ensureDataHome,
} = paths;

let dir;

function opts(extra = {}) {
  return { homeDir: dir, env: {}, ...extra };
}

function writeScope(text) {
  mkdirSync(join(dir, '.coding'), { recursive: true });
  writeFileSync(join(dir, '.coding', 'scope'), text);
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'datahome-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('derivation', () => {
  test('the root is ~/.coding/data/<scope>', () => {
    writeScope('raas');
    assert.equal(dataHome(opts()), join(dir, '.coding', 'data', 'raas'));
  });

  test('two scopes on one machine cannot collide', () => {
    const a = dataHome(opts({ env: { CODING_SCOPE: 'raas' } }));
    const b = dataHome(opts({ env: { CODING_SCOPE: 'normalisa' } }));
    assert.notEqual(a, b);
    assert.ok(!a.startsWith(b) && !b.startsWith(a), 'neither scope may nest inside the other');
  });

  test('an unconfigured install lands under the placeholder scope, never under "coding"', () => {
    assert.equal(dataHome(opts()), join(dir, '.coding', 'data', 'default'));
  });

  test('CODING_DATA_HOME overrides everything and is resolved absolute', () => {
    writeScope('raas');
    const target = join(dir, 'elsewhere');
    assert.equal(dataHome(opts({ env: { CODING_DATA_HOME: target } })), target);
    // Relative overrides are resolved, not passed through — a half-resolved root
    // is how cwd-relative path bugs get reintroduced.
    const rel = dataHome(opts({ env: { CODING_DATA_HOME: 'rel/ative' } }));
    assert.ok(rel.startsWith(sep), `expected an absolute path, got ${rel}`);
  });

  test('a blank CODING_DATA_HOME contributes nothing', () => {
    writeScope('raas');
    assert.equal(dataHome(opts({ env: { CODING_DATA_HOME: '  ' } })),
      join(dir, '.coding', 'data', 'raas'));
  });
});

describe('the tracked / untracked split', () => {
  test('history and kb are the tracked subtrees', () => {
    const o = opts({ env: { CODING_SCOPE: 'raas' } });
    const root = dataHome(o);
    assert.equal(historyDir(o), join(root, 'history'));
    assert.equal(kbDir(o), join(root, 'kb'));
  });

  test('everything that is large, binary or rebuildable is under var/', () => {
    const o = opts({ env: { CODING_SCOPE: 'raas' } });
    const v = varDir(o);
    for (const [name, p] of Object.entries({
      graphDbDir: graphDbDir(o),
      experimentsDir: experimentsDir(o),
      kgbenchDir: kgbenchDir(o),
      measurementsDir: measurementsDir(o),
      runSnapshotsDir: runSnapshotsDir(o),
      proxyDataDir: proxyDataDir(o),
    })) {
      assert.ok(p === v || p.startsWith(v + sep), `${name} must live under var/, got ${p}`);
    }
  });

  test('everything worth sharing is under kb/', () => {
    const o = opts({ env: { CODING_SCOPE: 'raas' } });
    const k = kbDir(o);
    for (const [name, p] of Object.entries({
      graphExportsDir: graphExportsDir(o),
      insightsDir: insightsDir(o),
      observationExportDir: observationExportDir(o),
      knowledgeExportDir: knowledgeExportDir(o),
    })) {
      assert.ok(p.startsWith(k + sep), `${name} must live under kb/, got ${p}`);
    }
  });

  test('the graph store and its exports are on OPPOSITE sides', () => {
    // This is the split's reason to exist. LevelDB is a projection that km-core's
    // hydrate() rebuilds from the JSON exports; tracking both would commit the
    // same knowledge twice, in a binary format that cannot merge.
    const o = opts({ env: { CODING_SCOPE: 'raas' } });
    assert.ok(graphDbDir(o).startsWith(varDir(o) + sep));
    assert.ok(graphExportsDir(o).startsWith(kbDir(o) + sep));
  });

  test('no tracked path is nested inside var/ and vice versa', () => {
    const o = opts({ env: { CODING_SCOPE: 'raas' } });
    assert.ok(!kbDir(o).startsWith(varDir(o) + sep));
    assert.ok(!historyDir(o).startsWith(varDir(o) + sep));
    assert.ok(!varDir(o).startsWith(kbDir(o) + sep));
  });
});

describe('proxy compatibility', () => {
  test('LLM_PROXY_DATA_DIR still wins, so the proxy keeps running mid-migration', () => {
    const legacy = join(dir, 'legacy', '.data');
    assert.equal(
      proxyDataDir(opts({ env: { CODING_SCOPE: 'raas', LLM_PROXY_DATA_DIR: legacy } })),
      legacy,
    );
  });

  test('without it the proxy writes under var/', () => {
    const o = opts({ env: { CODING_SCOPE: 'raas' } });
    assert.equal(proxyDataDir(o), varDir(o));
  });

  test('the token database path the proxy composes lands under var/', () => {
    // The proxy appends 'llm-proxy/token-usage.db' to whatever dataDir it is
    // given (_work/rapid-llm-proxy/src/token-usage.ts:239-242).
    const o = opts({ env: { CODING_SCOPE: 'raas' } });
    const db = join(proxyDataDir(o), 'llm-proxy', 'token-usage.db');
    assert.ok(db.startsWith(varDir(o) + sep));
  });
});

describe('explain', () => {
  test('it reports the scope, its provenance, and whether the root is tracked', () => {
    writeScope('raas');
    const e = explain(opts());
    assert.equal(e.scope, 'raas');
    assert.equal(e.scopeSource, 'home');
    assert.equal(e.scopeIsDefault, false);
    assert.equal(e.dataHome, join(dir, '.coding', 'data', 'raas'));
    assert.equal(e.dataHomeOverridden, false);
    assert.equal(e.exists, false);
    assert.equal(e.tracked, false);
  });

  test('it flags the placeholder scope so surfaces can say so out loud', () => {
    const e = explain(opts());
    assert.equal(e.scopeIsDefault, true);
  });

  test('it reports an override', () => {
    const e = explain(opts({ env: { CODING_DATA_HOME: join(dir, 'x') } }));
    assert.equal(e.dataHomeOverridden, true);
  });

  test('exists and tracked follow the filesystem', () => {
    const o = opts({ env: { CODING_SCOPE: 'raas' } });
    ensureDataHome(o);
    assert.equal(explain(o).exists, true);
    assert.equal(explain(o).tracked, false);
    mkdirSync(join(dataHome(o), '.git'));
    assert.equal(explain(o).tracked, true);
  });
});

describe('ensureDataHome', () => {
  test('it creates the root and all three subtrees', () => {
    const o = opts({ env: { CODING_SCOPE: 'raas' } });
    const root = ensureDataHome(o);
    assert.equal(root, dataHome(o));
    for (const p of [root, historyDir(o), kbDir(o), varDir(o)]) {
      assert.ok(existsSync(p), `${p} should exist`);
    }
  });

  test('it ships a .gitignore that excludes var/', () => {
    // Without this the split is decorative: the first `git add -A` in the data
    // repo stages the snapshot archive.
    const o = opts({ env: { CODING_SCOPE: 'raas' } });
    ensureDataHome(o);
    const ignore = readFileSync(join(dataHome(o), '.gitignore'), 'utf8');
    assert.match(ignore, /^var\/$/m);
  });

  test('it is idempotent', () => {
    const o = opts({ env: { CODING_SCOPE: 'raas' } });
    ensureDataHome(o);
    assert.doesNotThrow(() => ensureDataHome(o));
  });

  test('it does not overwrite a .gitignore the user has edited', () => {
    const o = opts({ env: { CODING_SCOPE: 'raas' } });
    ensureDataHome(o);
    const ignore = join(dataHome(o), '.gitignore');
    writeFileSync(ignore, 'var/\nmy-own-rule\n');
    ensureDataHome(o);
    assert.match(readFileSync(ignore, 'utf8'), /my-own-rule/);
  });
});
