'use strict';

/**
 * Where a repo's session transcripts live — the one place that knows (T9).
 *
 * Per-repo tenancy (T3) moved them into the learning checkout:
 * `<repo>/.coding/history/`. Nothing addresses `<repo>/.specstory/history` any
 * more (T9 removed the compatibility symlink, T10 the rest of `.specstory/`);
 * the legacy layout is only RECOGNISED, for a repo not relaunched since.
 *
 *   repoHistoryDir(repo)
 *     <repo>/.coding/history      when it exists, or nothing exists yet (where
 *                                 it WILL be)
 *     <repo>/.specstory/history   only while it is a REAL directory and there is
 *                                 no real <repo>/.coding/history — a repo whose
 *                                 transcripts have not moved yet. An empty or
 *                                 history-less .coding/ does not hide it.
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
  const current = path.join(root, CODING_DIR, HISTORY);
  if (!isRealDir(current) && isRealDir(path.join(root, LEGACY_HISTORY))) {
    return path.join(root, LEGACY_HISTORY);
  }
  return current;
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
