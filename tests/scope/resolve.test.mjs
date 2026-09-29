/**
 * Scope resolver — layering, normalisation, failure modes, and the tools-repo test.
 *
 * Every test drives the resolver through explicit `homeDir` / `scopeFilePath` /
 * `env` options rather than through process.env, so the suite never reads or
 * disturbs the developer's own ~/.coding/scope. A test that could pick up the
 * real scope would pass on this machine and fail everywhere else.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;

const {
  resolveScope, explain, normaliseScope, isToolsRepo, toolsRepo,
  ScopeError, DEFAULT_SCOPE, SCOPE_MAX,
} = require(join(REPO, 'lib/scope/resolve.cjs'));

let dir;

/** Options pointing every layer at the sandbox, with an empty environment. */
function opts(extra = {}) {
  return { homeDir: dir, env: {}, ...extra };
}

function writeScope(text) {
  mkdirSync(join(dir, '.coding'), { recursive: true });
  writeFileSync(join(dir, '.coding', 'scope'), text);
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'scope-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('layering', () => {
  test('with nothing configured the scope is the inert placeholder, not "coding"', () => {
    const e = explain(opts());
    assert.equal(e.scope, DEFAULT_SCOPE);
    assert.equal(e.scope, 'default');
    assert.equal(e.source, 'default');
    assert.equal(e.isDefault, true);
    // The whole point: never derive the fallback from the tools repo basename.
    assert.notEqual(e.scope, 'coding');
  });

  test('the home file beats the default', () => {
    writeScope('raas\n');
    const e = explain(opts());
    assert.equal(e.scope, 'raas');
    assert.equal(e.source, 'home');
    assert.equal(e.path, join(dir, '.coding', 'scope'));
    assert.equal(e.isDefault, false);
  });

  test('the env beats the home file', () => {
    writeScope('raas\n');
    const e = explain(opts({ env: { CODING_SCOPE: 'normalisa' } }));
    assert.equal(e.scope, 'normalisa');
    assert.equal(e.source, 'env');
    assert.equal(e.path, null);
  });

  test('an empty or whitespace CODING_SCOPE contributes nothing', () => {
    writeScope('raas\n');
    assert.equal(resolveScope(opts({ env: { CODING_SCOPE: '' } })), 'raas');
    assert.equal(resolveScope(opts({ env: { CODING_SCOPE: '   ' } })), 'raas');
  });

  test('resolveScope is the thin wrapper over explain', () => {
    writeScope('raas');
    assert.equal(resolveScope(opts()), explain(opts()).scope);
  });
});

describe('file parsing', () => {
  test('comments and blank lines are skipped; the first real line wins', () => {
    writeScope('# written by install.sh\n\n  raas  \nnormalisa\n');
    assert.equal(resolveScope(opts()), 'raas');
  });

  test('a file containing only comments falls through to the default', () => {
    writeScope('# nothing decided here\n\n');
    assert.equal(explain(opts()).source, 'default');
  });

  test('a missing file is not an error', () => {
    assert.equal(explain(opts()).source, 'default');
  });

  test('an unreadable file throws rather than silently becoming the default', () => {
    // A directory where the file should be: readFileSync gives EISDIR, not ENOENT.
    // Silently defaulting here would relocate the data root, and the symptom would
    // be a knowledge base that looks empty rather than an error anyone can act on.
    mkdirSync(join(dir, '.coding', 'scope'), { recursive: true });
    assert.throws(() => resolveScope(opts()), ScopeError);
  });
});

describe('normalisation and validation', () => {
  test('mixed case is lowercased rather than rejected', () => {
    // Two spellings must not become two directories each holding half a KB.
    assert.equal(normaliseScope('RaaS', 't'), 'raas');
    assert.equal(normaliseScope('  Normalisa\t', 't'), 'normalisa');
  });

  test('dots, dashes, underscores and digits are allowed', () => {
    for (const ok of ['raas', 'raas-2', 'raas_2', 'raas.2', 'a', '9lives']) {
      assert.equal(normaliseScope(ok, 't'), ok);
    }
  });

  test('anything unusable as a path segment is rejected', () => {
    for (const bad of ['', '   ', '.', '..', '../escape', 'a/b', 'a\\b', '-lead', '.lead', 'a b', 'a:b']) {
      assert.throws(() => normaliseScope(bad, 't'), ScopeError, `expected '${bad}' to be rejected`);
    }
  });

  test('a non-string is rejected', () => {
    for (const bad of [null, 42, {}, []]) {
      assert.throws(() => normaliseScope(bad, 't'), ScopeError);
    }
  });

  test('an over-long scope is rejected', () => {
    assert.equal(normaliseScope('a'.repeat(SCOPE_MAX), 't').length, SCOPE_MAX);
    assert.throws(() => normaliseScope('a'.repeat(SCOPE_MAX + 1), 't'), ScopeError);
  });

  test('a bad value in the file or the env is reported against its source', () => {
    writeScope('../escape\n');
    assert.throws(() => resolveScope(opts()), (err) => {
      assert.ok(err instanceof ScopeError);
      assert.match(err.message, /\.coding\/scope/);
      return true;
    });
    assert.throws(() => resolveScope(opts({ env: { CODING_SCOPE: 'a/b' } })), (err) => {
      assert.match(err.message, /CODING_SCOPE/);
      return true;
    });
  });
});

describe('isToolsRepo — the one test that replaces five disagreeing ones', () => {
  test('the tools repo itself is the tools repo', () => {
    assert.equal(isToolsRepo(REPO, { toolsRepo: REPO }), true);
  });

  test('a trailing slash and a non-normalised path still compare equal', () => {
    assert.equal(isToolsRepo(`${REPO}/`, { toolsRepo: REPO }), true);
    assert.equal(isToolsRepo(join(REPO, 'lib', '..'), { toolsRepo: REPO }), true);
  });

  test('a different directory that merely CONTAINS the name is not the tools repo', () => {
    // These are the cases the two `String.includes` tests got wrong:
    // batch-lsl-processor.js:425 `filePath.includes('coding')` and
    // combined-status-line.js:1632 `targetProject.includes(codingPath)`.
    const tools = join(dir, 'Agentic', 'coding');
    mkdirSync(tools, { recursive: true });
    for (const other of ['coding-history', 'coding.bak', 'decoding']) {
      const p = join(dir, 'Agentic', other);
      mkdirSync(p, { recursive: true });
      assert.equal(isToolsRepo(p, { toolsRepo: tools }), false, `${other} must not match`);
    }
  });

  test('a same-named directory somewhere else is not the tools repo', () => {
    // The case enhanced-transcript-monitor.js:3362 got wrong: any directory
    // named `coding`, anywhere on disk, short-circuited as the tools repo.
    const tools = join(dir, 'Agentic', 'coding');
    const decoy = join(dir, 'elsewhere', 'coding');
    mkdirSync(tools, { recursive: true });
    mkdirSync(decoy, { recursive: true });
    assert.equal(isToolsRepo(decoy, { toolsRepo: tools }), false);
  });

  test('a symlink to the tools repo IS the tools repo', () => {
    // Required by the data-root split: <project>/.specstory/history becomes a
    // symlink, so path equality alone would start answering wrongly.
    const tools = join(dir, 'real-tools');
    const link = join(dir, 'linked-tools');
    mkdirSync(tools, { recursive: true });
    symlinkSync(tools, link);
    assert.equal(isToolsRepo(link, { toolsRepo: tools }), true);
  });

  test('a path that does not exist resolves lexically instead of throwing', () => {
    // The ETM asks about projects it has never written to.
    const missing = join(dir, 'never', 'created');
    assert.equal(isToolsRepo(missing, { toolsRepo: join(dir, 'tools') }), false);
    assert.equal(isToolsRepo(missing, { toolsRepo: missing }), true);
  });

  test('a falsy project path is not the tools repo', () => {
    for (const bad of [null, undefined, '']) {
      assert.equal(isToolsRepo(bad, { toolsRepo: REPO }), false);
    }
  });

  test('toolsRepo prefers CODING_TOOLS_PATH over CODING_REPO', () => {
    // Matches the precedence the ETM already uses at :501. Note :29 of the same
    // file has these reversed — this function is what removes that split brain.
    const saved = { t: process.env.CODING_TOOLS_PATH, r: process.env.CODING_REPO };
    try {
      process.env.CODING_TOOLS_PATH = '/tmp/tools-a';
      process.env.CODING_REPO = '/tmp/tools-b';
      assert.equal(toolsRepo(), '/tmp/tools-a');
      delete process.env.CODING_TOOLS_PATH;
      assert.equal(toolsRepo(), '/tmp/tools-b');
    } finally {
      if (saved.t === undefined) delete process.env.CODING_TOOLS_PATH;
      else process.env.CODING_TOOLS_PATH = saved.t;
      if (saved.r === undefined) delete process.env.CODING_REPO;
      else process.env.CODING_REPO = saved.r;
    }
  });
});
