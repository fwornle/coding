'use strict';

/**
 * Where a repo's session transcripts live — the one place that knows (T9).
 *
 * Per-repo tenancy (T3) moved them into the learning checkout:
 * `<repo>/.coding/history/`. `<repo>/.specstory/history` survives only as a
 * relative symlink so code that still spells the old path keeps working; this
 * module is what that code moves to, so the symlink can go.
 *
 *   repoHistoryDir(repo)
 *     <repo>/.coding/history      when <repo>/.coding exists (linked or skipped),
 *                                 or nothing exists yet (where it WILL be)
 *     <repo>/.specstory/history   only while it is a REAL directory and there is
 *                                 no .coding/ — a repo nobody has launched since
 *                                 T3, whose transcripts have not moved yet
 *
 * Never resolves through the symlink: the answer is the target itself, so a
 * caller that later checks `path.relative(repo, dir)` sees `.coding/history`.
 *
 * CommonJS like lib/paths/data-home.cjs — the status line is CJS.
 * Bash twin: scripts/lib/history-dir.sh (same rule, kept field-equal by
 * tests/history/paths.test.mjs).
 */

const fs = require('node:fs');
const path = require('node:path');

const CODING_DIR = '.coding';
const HISTORY = 'history';
const LEGACY_HISTORY = path.join('.specstory', 'history');

function isRealDir(p) {
  try {
    const st = fs.lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** The directory a repo's transcripts are written to and read from. */
function repoHistoryDir(repo) {
  const root = path.resolve(repo);
  const coding = path.join(root, CODING_DIR);
  if (!isRealDir(coding) && isRealDir(path.join(root, LEGACY_HISTORY))) {
    return path.join(root, LEGACY_HISTORY);
  }
  return path.join(coding, HISTORY);
}

/** Whether `dir` is a repo's transcript directory in either layout. */
function isHistoryDir(dir) {
  const d = path.resolve(dir);
  return d.endsWith(path.sep + path.join(CODING_DIR, HISTORY))
    || d.endsWith(path.sep + LEGACY_HISTORY);
}

/** The repo a transcript directory belongs to (inverse of repoHistoryDir). */
function repoOfHistoryDir(dir) {
  const d = path.resolve(dir);
  if (!isHistoryDir(d)) return null;
  return path.dirname(path.dirname(d));
}

module.exports = {
  CODING_DIR,
  LEGACY_HISTORY,
  repoHistoryDir,
  isHistoryDir,
  repoOfHistoryDir,
};
