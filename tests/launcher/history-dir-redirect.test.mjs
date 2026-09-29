/**
 * `coding` launched from inside a private history checkout.
 *
 * `<project>/.specstory/history/` is a nested git repo holding verbatim
 * transcripts. bin/coding takes the project directory from `pwd`, so a launch
 * from inside that checkout used to make it the project: agent_common_init then
 * offered a `history-history` remote (basename of the directory), wrote CLAUDE.md
 * and the agent instruction files into it, and appended a bare `logs/` to its
 * .gitignore — which ignores the classification tree that repo exists to carry.
 *
 * The guard is a pure string function, so it is tested as one: the definition is
 * sliced out of bin/coding and evaluated in bash. Slicing rather than re-stating
 * the body is deliberate — a copy here would keep passing after the real function
 * was changed or deleted, which is exactly the regression being guarded against.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;
const SOURCE = readFileSync(join(REPO, 'bin/coding'), 'utf8');

/** The `strip_history_dir() { ... }` definition, verbatim from bin/coding. */
function definition() {
  const start = SOURCE.indexOf('strip_history_dir() {');
  assert.notEqual(start, -1, 'bin/coding no longer defines strip_history_dir()');
  const end = SOURCE.indexOf('\n}\n', start);
  assert.notEqual(end, -1, 'strip_history_dir() definition is not terminated');
  return SOURCE.slice(start, end + 3);
}

function strip(path) {
  return execFileSync('bash', ['-c', `${definition()}\nstrip_history_dir "$1"`, '--', path], {
    encoding: 'utf8',
  });
}

describe('strip_history_dir', () => {
  test('a history checkout resolves to the project that owns it', () => {
    assert.equal(strip('/w/a2a-xpr/.specstory/history'), '/w/a2a-xpr');
  });

  test('a directory below it resolves the same way', () => {
    assert.equal(strip('/w/a2a-xpr/.specstory/history/2026/09'), '/w/a2a-xpr');
  });

  test('an already-nested checkout collapses in one pass', () => {
    // The state a launch from the history dir actually produced on disk.
    assert.equal(
      strip('/w/a2a-xpr/.specstory/history/.specstory/history'),
      '/w/a2a-xpr',
    );
  });

  test('a project root is left alone', () => {
    assert.equal(strip('/w/a2a-xpr'), '/w/a2a-xpr');
  });

  test('.specstory itself is not a history checkout', () => {
    assert.equal(strip('/w/a2a-xpr/.specstory'), '/w/a2a-xpr/.specstory');
  });

  test('a sibling -history repo is not a history checkout', () => {
    // `coding-history` and `decoding` are the substring false positives that
    // six earlier "am I the tools repo?" idioms got wrong (see d6583ea3).
    assert.equal(strip('/w/coding-history'), '/w/coding-history');
    assert.equal(strip('/w/decoding'), '/w/decoding');
  });

  test('a directory merely named history is not a history checkout', () => {
    assert.equal(strip('/w/proj/docs/history'), '/w/proj/docs/history');
  });
});

describe('bin/coding wiring', () => {
  test('the resolved project directory is passed through the guard', () => {
    assert.match(
      SOURCE,
      /PROJECT_DIR="\$\(strip_history_dir "\$PROJECT_DIR"\)"/,
      'bin/coding defines the guard but never applies it to PROJECT_DIR',
    );
  });

  test('CODING_PROJECT_DIR exports the guarded value', () => {
    const guard = SOURCE.indexOf('PROJECT_DIR="$(strip_history_dir');
    const exported = SOURCE.indexOf('export CODING_PROJECT_DIR="$PROJECT_DIR"');
    assert.notEqual(exported, -1, 'bin/coding no longer exports CODING_PROJECT_DIR');
    assert.ok(guard < exported, 'CODING_PROJECT_DIR is exported before the guard runs');
  });
});
