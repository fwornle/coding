/**
 * The invariant both runners' configs assert and neither enforced.
 *
 * `test-inventory.mjs` and `jest.config.js` each state, in prose, that "a file
 * can never be claimed by both runners or dropped by both". The claim was
 * false. Three node:test suites under `src/ontology` ran in NEITHER runner from
 * the day they were written, recorded only as a comment on a `.filter()`; the
 * same hole had already swallowed `src/live-logging/ObservationConsolidator.test.js`
 * for two months before 4988235c widened SEARCH_ROOTS to reach `src/`.
 *
 * WHY PROSE WAS NEVER GOING TO HOLD. A dropped suite emits nothing. There is no
 * failure to read, no count that looks wrong, and the runner's own summary is
 * happy — so the only way to notice is to go looking, and the only reason to go
 * looking is to already suspect it. That fix stayed invisible in the other
 * direction too: the ObservationConsolidator suite was still being described as
 * dead five weeks after it started running, because nothing anywhere could say
 * otherwise.
 *
 * So this suite asserts the claim instead of repeating it. A new test file now
 * has exactly three honest outcomes — a runner takes it, or it is listed in
 * EXCLUDED / CI_SKIPPED with a reason, or this goes red. Silently running
 * nowhere stops being one of them.
 *
 * @module scripts/lib/test-inventory.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  suiteOwnership,
  nodeTestFilesRelative,
  jestExcludedFilesRelative,
  EXCLUDED,
  CI_SKIPPED,
} from './test-inventory.mjs';

const owned = suiteOwnership();

/** Multi-line so a failure names the files rather than a count. */
const list = (files) => files.map((f) => `\n  - ${f}`).join('');

describe('test inventory — every suite has exactly one runner', () => {
  it('no suite is dropped by both runners', () => {
    assert.deepEqual(
      owned.unclaimed,
      [],
      'These files look like test suites but NO runner executes them. Either wire '
        + 'them into a runner, or add each to EXCLUDED in test-inventory.mjs with '
        + `the reason it cannot run:${list(owned.unclaimed)}`,
    );
  });

  it('no suite is claimed by both runners', () => {
    // jest cannot see a node:test registration, so a contested file is reported
    // as "Your test suite must contain at least one test" — a failure that names
    // neither the cause nor the fix.
    assert.deepEqual(
      owned.contested,
      [],
      'These node:test suites are ALSO collected by jest, which cannot run them. '
        + `They belong in jest.config.js's exclusion list:${list(owned.contested)}`,
    );
  });

  it('finds a real corpus on both sides — a walk that matched nothing would pass every other assertion here', () => {
    // The two emptiness checks above are vacuously true if the walk breaks (a
    // renamed SEARCH_ROOT, a bad SKIP_DIRS entry). This is the one assertion
    // that fails when the audit stops seeing anything.
    assert.ok(owned.node.length > 100, `expected >100 node:test suites, got ${owned.node.length}`);
    assert.ok(owned.jest.length > 50, `expected >50 jest suites, got ${owned.jest.length}`);
  });
});

describe('test inventory — the exclusion lists stay honest', () => {
  it('every EXCLUDED entry carries a non-trivial reason', () => {
    // An unexplained entry is how a suite quietly stops being run — the module's
    // own words. A one-word reason is the same thing with extra steps.
    for (const [file, why] of EXCLUDED) {
      assert.ok(
        typeof why === 'string' && why.trim().length >= 20,
        `EXCLUDED["${file}"] needs a real reason, got ${JSON.stringify(why)}`,
      );
    }
    for (const [file, why] of CI_SKIPPED) {
      assert.ok(
        typeof why === 'string' && why.trim().length >= 20,
        `CI_SKIPPED["${file}"] needs a real reason, got ${JSON.stringify(why)}`,
      );
    }
  });

  it('jest is told to skip every suite the node runner owns', () => {
    // The two lists are derived from one source, so this cannot drift — which is
    // the point of asserting it: if the derivation is ever replaced by a hand
    // list, this is what notices.
    const jestSkips = new Set(jestExcludedFilesRelative());
    const missing = nodeTestFilesRelative().filter((f) => !jestSkips.has(f));
    assert.deepEqual(missing, [], `node:test suites jest is not told to skip:${list(missing)}`);
  });
});
