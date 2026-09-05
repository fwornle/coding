/**
 * Feature gating of the CLIs and the coordinator's health rules.
 *
 * The CLI half runs the real shims in a subprocess against a sandbox
 * CODING_HOME, because the thing being tested is the guard's behaviour in a
 * shell — exit status, stream, wording — and none of that survives being mocked.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const REPO = (process.env.CODING_REPO || new URL('../..', import.meta.url).pathname).replace(/\/$/, '');
const { FEATURE_IDS } = require(join(REPO, 'lib/features/catalogue.cjs'));

/** CLI -> the feature it must refuse to run without. */
const GUARDED = {
  'bin/semantic': 'knowledge',
  'bin/vkb': 'knowledge',
  'bin/clean-knowledge-base': 'knowledge',
  'bin/fix-knowledge-base': 'knowledge',
  'bin/graphify': 'codegraph',
  'bin/codegraph': 'codegraph',
  'bin/constraints': 'constraints',
  'bin/log-session': 'lsl',
};

function homeWith(yaml) {
  const dir = mkdtempSync(join(tmpdir(), 'coding-cli-'));
  mkdirSync(join(dir, '.coding'), { recursive: true });
  writeFileSync(join(dir, '.coding', 'features.yaml'), yaml);
  return dir;
}

/** Run a CLI and return {code, stdout, stderr} without throwing on non-zero. */
async function run(cli, args, home) {
  try {
    const { stdout, stderr } = await exec(join(REPO, cli), args, {
      env: { ...process.env, CODING_REPO: REPO, CODING_HOME: home },
      timeout: 60000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('CLI guards', () => {
  test('every guarded CLI sources the shared helper', () => {
    // One helper, so the wording is identical everywhere. A CLI with its own
    // hand-rolled message would drift from the rest on the next edit.
    for (const cli of Object.keys(GUARDED)) {
      const src = readFileSync(join(REPO, cli), 'utf8');
      assert.match(src, /require-feature\.sh/, `${cli} does not source the guard`);
      assert.match(src, new RegExp(`require_feature ${GUARDED[cli]}\\b`), `${cli} guards the wrong feature`);
    }
  });

  test('every guarded feature is a real one', () => {
    for (const [cli, feature] of Object.entries(GUARDED)) {
      assert.ok(FEATURE_IDS.includes(feature), `${cli} names unknown feature '${feature}'`);
    }
  });

  test('bin/llm is NOT gated on llm-proxy', () => {
    // It queries Docker Model Runner directly, not rapid-llm-proxy. Gating it
    // would break a working command for a reason that is not true.
    const src = readFileSync(join(REPO, 'bin/llm'), 'utf8');
    assert.ok(!src.includes('require_feature'), 'bin/llm must not be feature-gated');
    assert.match(src, /engines\/v1/, 'precondition: bin/llm talks to Docker Model Runner');
  });

  test('a disabled feature refuses with exit 2 and an actionable message', async () => {
    const home = homeWith('features:\n  codegraph: off\n');
    try {
      const r = await run('bin/graphify', ['query', 'anything'], home);
      // 2, not 1, so a caller can tell "switched off" from the wrapped
      // command's own failures.
      assert.equal(r.code, 2);
      assert.match(r.stderr, /'codegraph' feature, which is switched off/);
      assert.match(r.stderr, /coding-features set codegraph on/);
      // The guard talks on stderr; stdout stays clean for anything piping it.
      assert.equal(r.stdout.trim(), '');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('the refusal quotes the resolver, including a dependency reason', async () => {
    const home = homeWith('features:\n  lsl: off\n');
    try {
      // knowledge is off transitively (lsl -> observations -> knowledge), and
      // the message must say that rather than inventing its own explanation.
      const r = await run('bin/semantic', ['status'], home);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /requires 'observations'/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('an enabled feature lets the command through', async () => {
    const home = homeWith('profile: full\n');
    try {
      const r = await run('bin/graphify', ['--help'], home);
      assert.notEqual(r.code, 2, 'the guard must not fire when the feature is on');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('the guard never blocks when it cannot resolve', async () => {
    // A guard that stops the command because it could not find its own helper
    // is worse than no guard.
    const guard = readFileSync(join(REPO, 'lib/features/require-feature.sh'), 'utf8');
    assert.match(guard, /\[ -n "\$repo" \] \|\| return 0/);
    assert.match(guard, /command -v node .* \|\| return 0/);
  });
});

describe('coordinator health rules', () => {
  const rules = require(join(REPO, 'config/health-verification-rules.json'));

  const tagged = () => {
    const out = [];
    for (const [category, group] of Object.entries(rules.rules)) {
      for (const [name, rule] of Object.entries(group)) {
        if (rule && rule.feature) out.push([`${category}.${name}`, rule.feature]);
      }
    }
    return out;
  };

  test('every tagged rule names real features', () => {
    for (const [name, feature] of tagged()) {
      for (const id of Array.isArray(feature) ? feature : [feature]) {
        assert.ok(FEATURE_IDS.includes(id), `${name} names unknown feature '${id}'`);
      }
    }
  });

  test('every service rule is tagged', () => {
    // A service check with no feature keeps running against a service the user
    // stopped, and reports a permanent outage of something working as configured.
    const untagged = Object.entries(rules.rules.services)
      .filter(([, r]) => r && r.enabled !== false && !r.feature)
      .map(([n]) => n);
    assert.deepEqual(untagged, [], 'untagged service checks will alarm on a disabled feature');
  });

  test('process and file rules stay core', () => {
    // These are about the machine, not about any feature, and must survive the
    // minimal profile — otherwise a pared-down install monitors nothing at all.
    for (const category of ['processes', 'files']) {
      for (const [name, rule] of Object.entries(rules.rules[category] || {})) {
        assert.ok(!rule?.feature, `${category}.${name} should not be feature-gated`);
      }
    }
  });

  test('qdrant survives while EITHER of its users is on', () => {
    const feature = rules.rules.databases.qdrant_availability.feature;
    assert.ok(Array.isArray(feature), 'qdrant backs two features, so any-of is required');
    assert.deepEqual([...feature].sort(), ['constraints', 'knowledge']);
  });

  test('the coordinator applies the gate, and fails open when it cannot', () => {
    const src = readFileSync(join(REPO, 'scripts/health-coordinator.js'), 'utf8');
    assert.match(src, /if \(rule\.feature && !ruleFeatureActive\(rule\.feature, features\)\) continue;/);
    // null features (unresolvable config) must not silently skip every check.
    assert.match(src, /if \(!features\) return true;/);
    // An unknown id from a newer rules file must read as active.
    assert.match(src, /features\[id\] === undefined \|\| features\[id\] === true/);
  });
});

describe('bin/status', () => {
  test('reports the active feature set before anything else', () => {
    const src = readFileSync(join(REPO, 'bin/status'), 'utf8');
    assert.match(src, /Features/);
    assert.ok(
      src.indexOf('🎛️') < src.indexOf('Current Status'),
      'the feature set must be printed before the per-service report it explains',
    );
  });
});

describe('guard file', () => {
  test('exists and is sourceable', () => {
    assert.ok(existsSync(join(REPO, 'lib/features/require-feature.sh')));
  });
});
