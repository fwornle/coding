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
  resolveScope, requireScope, isPlaceholderScope,
  explain, normaliseScope, isToolsRepo, toolsRepo, samePath,
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

describe('strict resolution — requireScope and isPlaceholderScope', () => {
  test('with nothing configured requireScope throws and names the fix', () => {
    assert.throws(() => requireScope(opts()), (err) => {
      assert.ok(err instanceof ScopeError);
      // The message has to be actionable: the whole reason this throws rather
      // than returning the placeholder is so somebody can fix it.
      assert.match(err.message, /~\/\.coding\/scope/);
      assert.match(err.message, /CODING_SCOPE/);
      return true;
    });
    // ...while the lenient resolver is unchanged. That pairing is the design.
    assert.equal(resolveScope(opts()), DEFAULT_SCOPE);
  });

  test('a real tenant from the home file is returned', () => {
    writeScope('raas\n');
    assert.equal(requireScope(opts()), 'raas');
  });

  test('a real tenant from the env is returned', () => {
    assert.equal(requireScope(opts({ env: { CODING_SCOPE: 'resi' } })), 'resi');
  });

  test('CODING_SCOPE=default throws — the placeholder must not arrive via env', () => {
    // REGRESSION, do not relax this to an `isDefault` check.
    //
    // `bin/coding-data-home --scope` prints `default` on a machine with no
    // ~/.coding/scope, and scripts/launch-agent-common.sh:382 exports whatever
    // it printed. So the fresh-install case this function exists to catch
    // arrives as CODING_SCOPE=default, which explain() reports as
    // `source: 'env', isDefault: false` — an isDefault check waves it through
    // and the placeholder ends up tagged onto entities permanently.
    const o = opts({ env: { CODING_SCOPE: 'default' } });
    assert.equal(explain(o).isDefault, false, 'precondition: env makes isDefault false');
    assert.equal(explain(o).source, 'env');
    assert.throws(() => requireScope(o), ScopeError);
  });

  test('a literal "default" in the scope file throws — the name is reserved', () => {
    // Every unconfigured install would share ~/.coding/data/default/, so one
    // person's `default` knowledge would merge with everyone else's.
    writeScope('default\n');
    assert.throws(() => requireScope(opts()), ScopeError);
    writeScope('  DEFAULT  \n');
    assert.throws(() => requireScope(opts()), ScopeError);
  });

  test('a malformed value still throws from normalisation, not from the new check', () => {
    // Ordering matters: a bad value is a bad value, not an unresolved one, and
    // the message must keep naming its source.
    assert.throws(() => requireScope(opts({ env: { CODING_SCOPE: 'a/b' } })), (err) => {
      assert.match(err.message, /CODING_SCOPE/);
      assert.doesNotMatch(err.message, /has no scope/);
      return true;
    });
  });

  test('isPlaceholderScope recognises the placeholder in every spelling', () => {
    for (const yes of [null, undefined, '', '   ', 'default', 'DEFAULT', ' Default ']) {
      assert.equal(isPlaceholderScope(yes), true, `expected ${JSON.stringify(yes)} to be a placeholder`);
    }
    for (const no of ['raas', 'coding', 'default-team', 'defaults']) {
      assert.equal(isPlaceholderScope(no), false, `expected ${JSON.stringify(no)} to be real`);
    }
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

describe('samePath', () => {
  // The primitive isToolsRepo() is built from, exported for the two callers that
  // compare a pair of paths NEITHER of which is the tools repo: the ETM asking
  // "was this prompt set redirected?" and the batch processor comparing its
  // project against its configured checkout. Both were bare
  // `path.resolve(a) === path.resolve(b)`.

  test('trailing slashes and . segments do not make a path different', () => {
    const a = join(dir, 'p');
    mkdirSync(a, { recursive: true });
    assert.equal(samePath(a, `${a}/`), true);
    assert.equal(samePath(a, join(a, '.')), true);
    assert.equal(samePath(a, join(a, 'x', '..')), true);
  });

  test('a symlink and its target are the same path', () => {
    // This is the case plain path.resolve() gets wrong, and the reason the two
    // ETM comparisons had to move off it: P2 makes .specstory/history a symlink
    // into the data root, so the redirected/not-redirected test would start
    // reporting every local write as a redirect.
    const real = join(dir, 'sp-real');
    const link = join(dir, 'sp-link');
    mkdirSync(real, { recursive: true });
    symlinkSync(real, link);
    assert.equal(samePath(link, real), true);
  });

  test('a prefix is not a match', () => {
    // The failure mode of the two substring tests this replaces:
    // `'<repo>-history'.includes('<repo>')` was true, so a sibling checkout
    // read as the same project.
    const base = join(dir, 'repo');
    mkdirSync(base, { recursive: true });
    assert.equal(samePath(base, `${base}-history`), false);
    assert.equal(samePath(`${base}-history`, base), false);
  });

  test('paths that do not exist compare lexically instead of throwing', () => {
    const missing = join(dir, 'nope', 'deeper');
    assert.equal(samePath(missing, missing), true);
    assert.equal(samePath(missing, join(dir, 'other')), false);
  });

  test('a falsy operand is never a match', () => {
    for (const bad of [null, undefined, '']) {
      assert.equal(samePath(bad, dir), false);
      assert.equal(samePath(dir, bad), false);
    }
  });

  test('isToolsRepo is samePath against the resolved tools checkout', () => {
    // One implementation, not two: the guarantee that makes exporting the
    // primitive safe rather than a second copy of the comparison.
    const tools = join(dir, 'tools-x');
    mkdirSync(tools, { recursive: true });
    assert.equal(isToolsRepo(tools, { toolsRepo: tools }), samePath(tools, tools));
    assert.equal(
      isToolsRepo(join(dir, 'elsewhere'), { toolsRepo: tools }),
      samePath(join(dir, 'elsewhere'), tools),
    );
  });
});
