/**
 * scripts/lib/test-inventory.mjs
 *
 * Single source of truth for WHICH RUNNER owns WHICH test file.
 *
 * This repo has two test systems and, until now, only one of them was wired
 * into `npm test`:
 *
 *   * jest      — `tests/**\/*.test.js` (ESM via --experimental-vm-modules)
 *   * node:test — 85 suites, ~717 assertions, run only when someone
 *                 remembered to type `node --test <file>` by hand.
 *
 * Most node:test suites are `.test.mjs`, which jest's `testMatch` never even
 * collects — so they were invisible rather than failing, which is worse. Six
 * more are `.test.js`: jest DID collect those and reported "Your test suite
 * must contain at least one test", because jest cannot see `node:test`
 * registrations. Both runners now read this module, so a file cannot be
 * claimed by both or by neither.
 *
 * Classification is by CONTENT (does the file import `node:test`?), not by
 * filename. A naming convention would have to be enforced by a second check;
 * the import is the actual fact that decides which runner can execute the file.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Directories under tests/ that hold no executable suites. */
const SKIP_DIRS = new Set(['node_modules', 'fixtures', '__snapshots__']);

/**
 * Files that import `node:test` but must NOT be run as part of `npm test`,
 * each with the reason it is excluded. Keep this list short and justified —
 * an unexplained entry here is how a suite quietly stops being run.
 */
export const EXCLUDED = new Map([
  [
    'tests/integration/cross-system-parity.mjs',
    // Phase 44 Wave 0 RED stub. Its own header says it fails BY DESIGN until
    // Plans 44-07 + 44-08 + 44-09 land /api/v1 on all three systems. Wiring it
    // into `npm test` would make the suite permanently red for a reason that
    // is already tracked, and a permanently-red suite stops being read.
    'deliberate RED stub — goes green after Plans 44-07/44-08/44-09',
  ],
]);

const IMPORTS_NODE_TEST = /(?:from\s*['"]node:test['"]|require\(\s*['"]node:test['"]\s*\))/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Absolute paths of every runnable node:test suite, sorted for stable ordering.
 * Stable ordering matters: an unstable list makes a flaky failure impossible to
 * reproduce from the previous run's output.
 */
export function nodeTestFiles({ root = REPO_ROOT } = {}) {
  const testsDir = path.join(root, 'tests');
  let candidates;
  try {
    candidates = walk(testsDir);
  } catch {
    return []; // no tests/ dir (e.g. a partial checkout) — not an error here
  }
  return candidates
    .filter((file) => {
      const rel = path.relative(root, file);
      if (EXCLUDED.has(rel)) return false;
      try {
        return IMPORTS_NODE_TEST.test(readFileSync(file, 'utf8'));
      } catch {
        return false;
      }
    })
    .sort();
}

/** Repo-relative form of {@link nodeTestFiles}, for display and for jest patterns. */
export function nodeTestFilesRelative(opts = {}) {
  const root = opts.root ?? REPO_ROOT;
  return nodeTestFiles(opts).map((f) => path.relative(root, f));
}

export { REPO_ROOT };
