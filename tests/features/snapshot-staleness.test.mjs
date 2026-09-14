/**
 * Snapshot staleness — does the on-disk snapshot still match the live config?
 *
 * The snapshot is what every non-Node consumer acts on, most consequentially
 * the container entrypoint, which cannot resolve and so cannot notice it is
 * acting on an old answer. These tests pin the one property that makes the
 * check trustworthy: it reports drift when there IS drift, and reports
 * anything else — missing file, broken config — as its own state rather than
 * as a confident 'stale' pointing at the wrong cause.
 *
 * Like the rest of this suite, every case drives explicit sandbox paths so it
 * never reads or disturbs the developer's own ~/.coding.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;

const { checkSnapshot, writeSnapshot } = require(join(REPO, 'lib/features/snapshot.cjs'));
const { FEATURE_IDS } = require(join(REPO, 'lib/features/resolve.cjs'));

let dir;
const PROFILES = join(REPO, 'config', 'feature-profiles.yaml');

function opts(extra = {}) {
  return {
    repoPath: dir,
    repoConfigPath: join(dir, 'repo-features.yaml'),
    homeConfigPath: join(dir, 'home-features.yaml'),
    profilesPath: PROFILES,
    env: {},
    ...extra,
  };
}

function writeHome(text) { writeFileSync(join(dir, 'home-features.yaml'), text); }

/** Put an arbitrary feature map on disk where the container would read it. */
function putSnapshot(features, extra = {}) {
  mkdirSync(join(dir, '.coding', 'runtime'), { recursive: true });
  writeFileSync(
    join(dir, '.coding', 'runtime', 'features.json'),
    `${JSON.stringify({
      generatedAt: '2026-09-13T12:54:51.924Z',
      profile: null,
      features,
      ...extra,
    }, null, 2)}\n`,
  );
}

const ALL_ON = Object.fromEntries(FEATURE_IDS.map((id) => [id, true]));

describe('feature snapshot staleness', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coding-snapshot-'));
    writeFileSync(join(dir, 'repo-features.yaml'), '');
    writeFileSync(join(dir, 'home-features.yaml'), '');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('a snapshot written from the same config is fresh', () => {
    writeSnapshot(opts());
    const r = checkSnapshot(opts());
    assert.equal(r.state, 'fresh');
    assert.deepEqual(r.differences, []);
  });

  test('no snapshot on disk reports missing, not stale', () => {
    const r = checkSnapshot(opts());
    assert.equal(r.state, 'missing');
    assert.ok(r.remedy, 'a missing snapshot should still say how to get one');
  });

  test('the real regression: config says on, snapshot still says off', () => {
    // Exactly the shape that disabled six container programs for ~17 hours —
    // a logging-only snapshot outliving the config that produced it.
    putSnapshot({ ...ALL_ON, knowledge: false, codegraph: false, constraints: false });

    const r = checkSnapshot(opts());
    assert.equal(r.state, 'stale');
    assert.deepEqual(
      r.differences.map((d) => d.id).sort(),
      ['codegraph', 'constraints', 'knowledge'],
    );
    for (const d of r.differences) {
      assert.equal(d.snapshot, false);
      assert.equal(d.live, true);
    }
    assert.equal(r.generatedAt, '2026-09-13T12:54:51.924Z');
  });

  test('drift is reported in the other direction too', () => {
    // Config turned something OFF and nothing re-applied: the container is
    // still running a program the operator believes they disabled.
    writeHome('features:\n  codegraph: off\n');
    putSnapshot(ALL_ON);

    const r = checkSnapshot(opts());
    assert.equal(r.state, 'stale');
    assert.deepEqual(r.differences, [{ id: 'codegraph', snapshot: true, live: false }]);
  });

  test('a feature missing from the snapshot counts as drift', () => {
    // Snapshot predates the feature existing, so the container has no opinion
    // to act on — that is drift, not a silent default.
    const { codegraph, ...withoutCodegraph } = ALL_ON;
    putSnapshot(withoutCodegraph);

    const r = checkSnapshot(opts());
    assert.equal(r.state, 'stale');
    assert.deepEqual(r.differences, [{ id: 'codegraph', snapshot: null, live: true }]);
  });

  test('an unresolvable config reports unknown, never stale', () => {
    // Fails open: a YAML typo must not also manufacture a drift warning that
    // sends the operator regenerating a snapshot instead of fixing the typo.
    putSnapshot(ALL_ON);
    writeHome('features:\n  lsl: maybe\n');

    const r = checkSnapshot(opts());
    assert.equal(r.state, 'unknown');
    assert.match(r.error, /expected on\/off/);
    assert.deepEqual(r.differences, []);
  });

  test('presentation-only differences are not drift', () => {
    // Same feature set, different profile label and reasons. Consumers act on
    // `features` alone, so rewriting the prose must not read as a config change.
    putSnapshot(ALL_ON, { profile: 'everything', reasons: { lsl: 'on — because' } });
    assert.equal(checkSnapshot(opts()).state, 'fresh');
  });
});
