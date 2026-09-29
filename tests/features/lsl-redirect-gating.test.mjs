/**
 * `lsl-redirect` must stay a switch that is wired to something.
 *
 * It shipped as a catalogue entry, a profile omission, a docs section and a
 * dashboard chip — with zero consumers. `coding-features set lsl-redirect off`
 * changed no behaviour, and nothing in the build noticed, because every other
 * feature is asserted through an artifact it owns (a daemon, a container
 * program, a port) and this one owns none. What it owns is a DECISION, taken in
 * three programs, and a decision has no artifact to count.
 *
 * So these assert the consumers directly, against the real source:
 *
 *   1. each of the three programs resolves the feature, and
 *   2. the five scope tests it replaced do not come back.
 *
 * Source-text assertions are brittle by nature, and that is the trade accepted
 * here for the same reason tests/features/daemon-gating.test.mjs takes it: the
 * failure being guarded against is silent and permanent, while a false alarm
 * from a refactor is loud and costs one line. Each assertion names the exact
 * idiom it forbids so a legitimate rewrite knows what it has to preserve.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = (process.env.CODING_REPO || new URL('../..', import.meta.url).pathname).replace(/\/$/, '');

const { FEATURES } = require(join(REPO, 'lib/features/resolve.cjs'));
const { loadFeatures } = require(join(REPO, 'lib/features/resolve.cjs'));

const src = (rel) => readFileSync(join(REPO, rel), 'utf8');

/**
 * Assert a pattern is present in a file.
 *
 * Not `assert.match(src(rel), re)`: these files run to a quarter of a megabyte,
 * and node:assert prints the whole `actual` value on failure. One failed
 * assertion then buries the message — and every other test's result — under
 * 240 KB of source. This reports the file, the pattern and the reason instead.
 */
function assertPresent(rel, re, why) {
  assert.ok(re.test(src(rel)), `${rel}: ${why}\n  expected to match: ${re}`);
}

function assertAbsent(rel, re, why) {
  assert.ok(!re.test(src(rel)), `${rel}: ${why}\n  expected NOT to match: ${re}`);
}

/** The three programs that take the redirect decision. */
const CONSUMERS = [
  'scripts/enhanced-transcript-monitor.js',
  'scripts/batch-lsl-processor.js',
  'scripts/combined-status-line.js',
];

describe('lsl-redirect has real consumers', () => {
  test('every consumer resolves the feature by name', () => {
    for (const rel of CONSUMERS) {
      assertPresent(
        rel,
        /'lsl-redirect'/,
        'must resolve the lsl-redirect feature — without a consumer the switch is ' +
          'decorative and turning it off changes nothing',
      );
    }
  });

  test('the ETM gates the redirect, the classifier and the decision log', () => {
    const etm = 'scripts/enhanced-transcript-monitor.js';

    // Resolved once, in the constructor: applyTier is 'apply', so a flip lands
    // on the next ETM generation rather than splitting one session's turns.
    assertPresent(
      etm,
      /this\.lslRedirectEnabled\s*=\s*featureEnabled\('lsl-redirect'\)/,
      'the feature must be resolved once and stored, not re-read per prompt set',
    );

    // determineTargetProject() stops before any classification when off.
    // 'foreign' mode returns null rather than the local project: that mode is a
    // redirect-only spawn, so filing its turns locally would be a NEW behaviour
    // rather than an absent one.
    assertPresent(
      etm,
      /if \(!this\.lslRedirectEnabled\) \{[\s\S]*?return this\.config\.mode === 'foreign' \? null : this\.config\.projectPath;/,
      'determineTargetProject must short-circuit before classifying when the redirect is off',
    );

    // The classifier and the decision logger exist only to serve that decision;
    // neither may be built when the decision cannot happen.
    assertPresent(
      etm,
      /if \(this\.lslRedirectEnabled && !isToolsRepo\(this\.config\.projectPath\)\) \{/,
      'the coding classifier must not be constructed when there is nothing to classify',
    );
    assertPresent(
      etm,
      /if \(!this\.lslRedirectEnabled \|\| isToolsRepo\(this\.config\.projectPath\)\) \{/,
      'the classification logger must not be built when no decision will be traced',
    );
  });

  test('the batch processor bypasses classification when the redirect is off', () => {
    const batch = 'scripts/batch-lsl-processor.js';
    assertPresent(
      batch,
      /this\.classificationBypassed\s*=\s*this\.isToolsProject \|\| !this\.lslRedirectEnabled/,
      'the tools-repo bypass and the feature gate must resolve to ONE flag — four ' +
        'downstream guards read it, and two names would let them drift',
    );
    assertAbsent(
      batch,
      /this\.isCodingProject/,
      'isCodingProject was the tools-repo-only predicate; it must not survive alongside the feature gate',
    );
  });

  test('the status line gates the badge on lsl-redirect, not on lsl', () => {
    assertPresent(
      'scripts/combined-status-line.js',
      /gated\('lsl-redirect',\s*'redirect'/,
      'the [→target] badge must follow its own feature — an install that logs ' +
        'sessions without redirecting them must not draw a redirect badge',
    );
  });
});

describe('the five scope tests do not come back', () => {
  // lib/scope/resolve.cjs replaced five mutually inconsistent answers to
  // "am I the tools repo?". Each assertion below names one of them.
  //
  // Scanned against CODE ONLY. The replacements deliberately quote the idiom
  // they removed in a comment ("Was `targetProject.includes(codingPath)` — a
  // substring test that also matched..."), which is the most useful place for
  // that note to live and would otherwise trip every one of these.

  /** Comment-stripped source, as `[lineNumber, text]` pairs. */
  const codeLines = (rel) =>
    readFileSync(join(REPO, rel), 'utf8')
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => {
        const t = line.trim();
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .map(([n, line]) => [n, line.replace(/\s\/\/.*$/, '')]);

  /** Offending `file:line` hits, so a failure names the site instead of dumping the file. */
  const hits = (re) =>
    CONSUMERS.flatMap((rel) =>
      codeLines(rel)
        .filter(([, line]) => re.test(line))
        .map(([n, line]) => `${rel}:${n}: ${line.trim()}`),
    );

  test('no basename equality against the literal tools-repo name', () => {
    // `path.basename(projectPath) === 'coding'` matched ANY directory named
    // coding anywhere, and missed a tools checkout under any other name.
    assert.deepEqual(
      hits(/basename\([^)]*\)\s*===\s*['"]coding['"]/),
      [],
      'use isToolsRepo() instead of a basename comparison',
    );
  });

  test('no substring test for the tools repo', () => {
    // `filePath.includes('coding')`, `targetProject.includes(codingPath)` and
    // `dir.includes('coding')` all matched siblings: <repo>-history, ~/src/decoding.
    assert.deepEqual(
      hits(/\.includes\(\s*(?:['"]\/?coding\/?['"]|codingPath)\s*\)/),
      [],
      'use isToolsRepo() instead of a substring test',
    );
  });

  test('no bare path.resolve() equality between two project paths', () => {
    // Correct as far as it went, but blind to symlinks — and P2 puts a symlink
    // on exactly that path when .specstory/history moves to the data root.
    assert.deepEqual(
      hits(/path\.resolve\([^)]*\)\s*===\s*path\.resolve\(/),
      [],
      'use samePath(), which resolves symlinks too',
    );
  });

  test('no raw string equality between a project path and the tools checkout', () => {
    // `this.projectPath === this.codingRepo`, defeated by a trailing slash.
    assert.deepEqual(
      hits(/projectPath\s*===\s*this\.codingRepo|this\.codingRepo\s*===\s*this\.projectPath/),
      [],
      'use isToolsRepo(projectPath, { toolsRepo: codingRepo })',
    );
  });

  test('the third copy of the redirect logic stays deleted', () => {
    // src/live-logging/ExchangeRouter.js and StatusLineIntegrator.js held a
    // third implementation, including a determineCurrentProject() that
    // classified ANY repo with a CLAUDE.md as the tools repo. Zero importers.
    for (const rel of [
      'src/live-logging/ExchangeRouter.js',
      'src/live-logging/StatusLineIntegrator.js',
    ]) {
      assert.equal(
        existsSync(join(REPO, rel)),
        false,
        `${rel} was deleted in P1 — it is a third copy of the redirect decision`,
      );
    }
  });
});

describe('the catalogue shape the consumers rely on', () => {
  test('lsl-redirect requires lsl and owns no artifact', () => {
    const f = FEATURES['lsl-redirect'];
    assert.deepEqual(f.requires, ['lsl']);
    assert.equal(f.needsDocker, false);
    assert.equal(f.applyTier, 'apply');
  });

  test('it is on by default, so the historical stack is unchanged', () => {
    // The acceptance criterion for P1: for this install, nothing moves.
    const resolved = loadFeatures({ env: {}, homeDir: '/nonexistent-home-for-defaults' });
    assert.equal(resolved.features['lsl-redirect'].enabled, true);
  });

  test('turning lsl off forces lsl-redirect off, and never the reverse', () => {
    const resolved = loadFeatures({
      env: { CODING_FEATURE_LSL: 'off' },
      homeDir: '/nonexistent-home-for-defaults',
    });
    assert.equal(resolved.features.lsl.enabled, false);
    assert.equal(resolved.features['lsl-redirect'].enabled, false);

    // A dependency is never auto-enabled by its dependent.
    const other = loadFeatures({
      env: { CODING_FEATURE_LSL: 'off', CODING_FEATURE_LSL_REDIRECT: 'on' },
      homeDir: '/nonexistent-home-for-defaults',
    });
    assert.equal(other.features.lsl.enabled, false);
    assert.equal(other.features['lsl-redirect'].enabled, false);
  });
});
