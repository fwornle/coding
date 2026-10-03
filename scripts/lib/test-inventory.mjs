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
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Directories that hold no executable suites. */
const SKIP_DIRS = new Set(['node_modules', 'fixtures', '__snapshots__', 'dist', 'coverage']);

/**
 * Roots searched for suites. node:test suites are NOT confined to tests/ — 63
 * passing assertions sat in src/live-logging and scripts/ that no runner ever
 * reached, because the first version of this file only walked tests/.
 */
const SEARCH_ROOTS = ['tests', 'test', 'src', 'scripts', 'lib/lsl'];

/**
 * Files that import `node:test` but must NOT be run as part of `npm test`,
 * each with the reason it is excluded. Keep this list short and justified —
 * an unexplained entry here is how a suite quietly stops being run.
 */
export const EXCLUDED = new Map([
  [
    'src/ontology/OntologyConfigManager.layout.test.ts',
    // The three src/ontology suites below are node:test suites that NO runner
    // executes, and until now that was recorded only as a comment on the `.ts`
    // filter in nodeTestFiles(). Declaring them here is what makes the gap
    // visible to suiteOwnership() — an undeclared drop now fails the build.
    //
    // Why they cannot simply be run: `node --test` strips types, it does not
    // TRANSFORM them, and ontologyPathResolver.ts uses constructor parameter
    // properties (`constructor(public readonly kind: …)`) — strip-only mode
    // rejects that outright with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. Running
    // them needs a real transform (tsx / ts-node) plus a `.js`→`.ts` resolve
    // hook, because the sources use the TS ESM convention of importing
    // `./x.js`. jest cannot take them either: its testMatch is `.test.js`
    // under test/ or tests/, and it cannot see a node:test registration.
    //
    // Nor can the neighbouring submodule: `src/ontology` is a real directory
    // of THIS repo that integrations/semantic-analysis symlinks into, and that
    // submodule's own `npm test` is `npm run build && node dist/test.js`.
    'needs a TS transform, not node --test type-stripping (parameter properties); see the note above',
  ],
  [
    'src/ontology/ontologyPathResolver.test.ts',
    'same: TS transform required; also the source jest would need is imported as ./x.js',
  ],
  [
    'src/ontology/registry-adoption.test.ts',
    'same TS-transform gap, and it additionally derives the repo root wrong (reads ~/.data/ontologies/upper.json)',
  ],
  [
    'tests/integration/cross-system-parity.mjs',
    // Phase 44 Wave 0 RED stub. Its own header says it fails BY DESIGN until
    // Plans 44-07 + 44-08 + 44-09 land /api/v1 on all three systems. Wiring it
    // into `npm test` would make the suite permanently red for a reason that
    // is already tracked, and a permanently-red suite stops being read.
    'deliberate RED stub — goes green after Plans 44-07/44-08/44-09',
  ],
]);

/**
 * Suites that cannot run on a hosted CI runner, with the reason each was verified
 * against. Applied ONLY when `process.env.CI` is set — locally every one of these
 * still runs, because locally every one of them passes.
 *
 * Each entry was reproduced in a linux/amd64 container built the way the workflow
 * builds it (real clone so `.git` is present, km-core cloned and built, `npm run
 * build` for dist/). Nothing is listed here on suspicion.
 *
 * Deliberately NOT a way to quieten a failing test: a suite belongs here only when
 * the thing it needs cannot exist on the runner. Every entry below meets that bar —
 * the two that were once parked here as "NOT ROOT-CAUSED" turned out to be portability
 * bugs in the tests themselves and were fixed rather than skipped.
 */
export const CI_SKIPPED = new Map([
  ['tests/integration/sub-agent-launchd-install.test.js',
    'macOS-only: shells out to /usr/bin/plutil and asserts on launchd plists'],
  ['tests/integration/typed-views.test.js',
    'needs a live obs-api on :12436 ("A obs-api at http://localhost:12436/... unreachable")'],
  ['tests/integration/kgbench-publish-guard.test.js',
    'reads .data/kgbench/runs/*/results.jsonl — gitignored local run artifacts, absent on a fresh checkout'],
  ['tests/context-turns/cache-split.test.mjs',
    'imports _work/rapid-llm-proxy/proxy-bridge/context-turns.mjs — a SIBLING repo, not part of this one'],
  ['tests/context-turns/digest.test.mjs',
    'imports _work/rapid-llm-proxy/proxy-bridge/context-turns.mjs — sibling repo'],
  ['tests/context-turns/openai-wire.test.mjs',
    'imports _work/rapid-llm-proxy/proxy-bridge/context-turns.mjs — sibling repo'],
  ['tests/context-turns/write-line.test.mjs',
    'imports _work/rapid-llm-proxy/proxy-bridge/context-turns.mjs — sibling repo'],
  ['tests/redaction/proxy-raw-body.test.mjs',
    'imports _work/rapid-llm-proxy/proxy-bridge/raw-bodies.mjs — sibling repo'],
  ['tests/experiments/experiment-runner.integration.test.mjs',
    'drives measurement-start, which imports the sibling proxy dist (lib/lsl/token/task-id.mjs DEFAULT_DIST)'],
  ['tests/experiments/avenue-fork-thread.test.mjs',
    'same measurement-start / sibling-proxy-dist dependency'],
  ['tests/experiments/run-parallel.test.mjs',
    'same measurement-start / sibling-proxy-dist dependency'],
  ['tests/experiments/report-write.test.mjs',
    'same measurement-start / sibling-proxy-dist dependency'],
  ['tests/experiments/experiment-runner.test.mjs',
    'runMatrix threads argv through measurement-start — unreachable without the sibling proxy dist'],
  ['tests/experiments/variant-override.test.mjs',
    'same: asserts on --base-variant in the measurement-start argv runMatrix never emits here'],
  ['scripts/backfill-claude-prompt-preview.test.mjs',
    'top-level await import of _work/rapid-llm-proxy/proxy-bridge/turn-identity.mjs — sibling repo'],
]);

/** True when running under CI, where {@link CI_SKIPPED} applies. */
export function isCI() {
  return Boolean(process.env.CI);
}

/** Repo-relative paths skipped in this environment (empty when not under CI). */
export function environmentSkippedRelative() {
  return isCI() ? [...CI_SKIPPED.keys()] : [];
}

const IMPORTS_NODE_TEST = /(?:from\s*['"]node:test['"]|require\(\s*['"]node:test['"]\s*\))/;

/** A jest suite registers with describe/it/test at top level. */
const REGISTERS_JEST = /^\s*(?:describe|it|test)\s*\(/m;

/** `#!/usr/bin/env node` — an executable script, not a suite. */
const HAS_NODE_SHEBANG = /^#!.*\bnode\b/;

/** Mirrors jest.config.js testMatch: **\/test|tests\/**\/*.test.js */
const JEST_COLLECTS = /(?:^|\/)tests?\/.*\.test\.js$/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // root absent in this checkout — not an error
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (/\.(js|mjs|cjs|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function isExcluded(root, file) {
  const rel = path.relative(root, file);
  for (const key of EXCLUDED.keys()) {
    if (rel === key || rel.startsWith(`${key}/`)) return true;
  }
  return false;
}

function candidates(root) {
  return SEARCH_ROOTS.flatMap((r) => walk(path.join(root, r)))
    .filter((f) => !isExcluded(root, f));
}

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Absolute paths of every runnable node:test suite, sorted for stable ordering.
 * Stable ordering matters: an unstable list makes a flaky failure impossible to
 * reproduce from the previous run's output.
 */
export function nodeTestFiles({ root = REPO_ROOT } = {}) {
  return candidates(root)
    // .ts node:test suites (src/ontology/*.test.ts) need a TypeScript loader that
    // `node --test` does not have; they are left for a follow-up rather than
    // silently reported as passing.
    .filter((f) => !f.endsWith('.ts'))
    .filter((file) => IMPORTS_NODE_TEST.test(read(file)))
    .filter((file) => !(isCI() && CI_SKIPPED.has(path.relative(root, file))))
    .sort();
}

/**
 * Executable harnesses: a `#!…node` shebang and no jest registrations. They are
 * run as `node <file>` — scripts/deploy-enhanced-lsl.sh and scripts/test-coding.sh
 * invoke several of them by path — but jest collected them through the *.test.js
 * glob and reported "Your test suite must contain at least one test" for each.
 *
 * Both conditions are required. The shebang alone would let a jest suite that
 * happens to carry one be dropped; the missing-registration check alone would
 * silently swallow a suite whose registrations failed to parse, turning a syntax
 * error into a disappearance instead of a failure.
 */
export function executableScriptFiles({ root = REPO_ROOT } = {}) {
  return candidates(root)
    // Only files jest would COLLECT can need excluding from it. scripts/ is full of
    // shebanged executables that testMatch never looks at; listing them would be
    // hundreds of inert patterns pretending to be a decision.
    .filter((file) => JEST_COLLECTS.test(path.relative(root, file)))
    .filter((file) => {
      const src = read(file);
      return HAS_NODE_SHEBANG.test(src) && !REGISTERS_JEST.test(src);
    })
    .sort();
}

/** Everything jest must not collect: the other runner's suites plus the scripts. */
export function jestExcludedFiles(opts = {}) {
  const root = opts.root ?? REPO_ROOT;
  const ciSkipped = environmentSkippedRelative().map((rel) => path.join(root, rel));
  return [...new Set([
    ...nodeTestFiles(opts),
    ...executableScriptFiles(opts),
    ...ciSkipped,
  ])].sort();
}

/** Repo-relative form of {@link nodeTestFiles}, for display and for jest patterns. */
export function nodeTestFilesRelative(opts = {}) {
  const root = opts.root ?? REPO_ROOT;
  return nodeTestFiles(opts).map((f) => path.relative(root, f));
}

/** Repo-relative form of {@link jestExcludedFiles}. */
export function jestExcludedFilesRelative(opts = {}) {
  const root = opts.root ?? REPO_ROOT;
  return jestExcludedFiles(opts).map((f) => path.relative(root, f));
}

/**
 * A suite by NAME, for the ownership audit. Content decides which runner owns a
 * file (see the module header), but a file named `*.test.*` that imports neither
 * runner is still a suite somebody meant to run — and is exactly the thing that
 * disappears silently.
 */
const IS_TEST_FILENAME = /\.test\.(?:js|mjs|cjs|ts)$/;

/**
 * Who owns every suite in the tree — the audit behind the claim this module and
 * jest.config.js both make, that "a file can never be claimed by both runners or
 * dropped by both".
 *
 * NOTHING ENFORCED THAT CLAIM UNTIL NOW, and it was false. Three node:test
 * suites under src/ontology ran in neither runner from the day they were
 * written; the only record was a comment on a `.filter()`. The same shape of
 * hole swallowed src/live-logging/ObservationConsolidator.test.js for two
 * months, until 4988235c widened SEARCH_ROOTS to include src/ — and because
 * nothing checked, the fix was invisible too, and the suite was still being
 * described as dead five weeks later.
 *
 * A dropped suite cannot be noticed by reading output: it produces none. So the
 * invariant needs a test, and `scripts/lib/test-inventory.test.mjs` is it.
 *
 * `unclaimed` is the finding that matters. `contested` covers the other
 * direction: a suite jest still collects even though the node runner owns it,
 * which jest reports as the misleading "must contain at least one test".
 */
export function suiteOwnership({ root = REPO_ROOT } = {}) {
  const rel = (f) => path.relative(root, f);

  // The universe is deliberately the UNION of the two ways a suite announces
  // itself — named like one, or importing a runner. Either alone has a blind
  // spot: tests/integration/cross-system-parity.mjs is a node:test suite whose
  // name says nothing, and a `*.test.ts` whose import fails to parse would
  // vanish from a content-only sweep.
  const universe = SEARCH_ROOTS
    .flatMap((r) => walk(path.join(root, r)))
    .filter((f) => IS_TEST_FILENAME.test(f) || IMPORTS_NODE_TEST.test(read(f)))
    .map(rel)
    .sort();

  const node = new Set(nodeTestFilesRelative({ root }));
  const jestExcluded = new Set(jestExcludedFilesRelative({ root }));
  const scripts = new Set(executableScriptFiles({ root }).map(rel));

  // Declared drops. CI_SKIPPED counts only where it applies, or the audit would
  // report those suites as lost on the runner and nowhere else.
  const declared = (f) =>
    [...EXCLUDED.keys()].some((k) => f === k || f.startsWith(`${k}/`)) ||
    (isCI() && CI_SKIPPED.has(f));

  const out = { node: [], jest: [], scripts: [], excluded: [], unclaimed: [], contested: [] };
  for (const f of universe) {
    const byNode = node.has(f);
    // What jest ACTUALLY runs: collected by testMatch and not on its exclusion
    // list. Testing the pattern alone would call every node:test suite under
    // tests/ contested, which is the arrangement working as designed.
    const byJest = JEST_COLLECTS.test(f) && !jestExcluded.has(f);
    if (byNode && byJest) out.contested.push(f);
    if (byNode) out.node.push(f);
    else if (byJest) out.jest.push(f);
    else if (scripts.has(f)) out.scripts.push(f);
    else if (declared(f)) out.excluded.push(f);
    else out.unclaimed.push(f);
  }
  return out;
}

export { REPO_ROOT };
