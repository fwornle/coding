#!/usr/bin/env node
/**
 * scripts/run-node-tests.mjs
 *
 * Runs the node:test half of the suite. Before this existed, `npm test` ran
 * jest only, so ~717 node:test assertions across 84 suites executed only when
 * someone typed `node --test <file>` by hand. Two stale assertions had been
 * sitting undetected in that gap.
 *
 * Which files run is decided by scripts/lib/test-inventory.mjs, shared with
 * jest.config.js so the two runners cannot both claim a file or both skip it.
 *
 * Usage:
 *   node scripts/run-node-tests.mjs                 # all node:test suites
 *   node scripts/run-node-tests.mjs --list          # print the inventory, run nothing
 *   node scripts/run-node-tests.mjs --concurrency=4 # override parallelism
 *   node scripts/run-node-tests.mjs tests/repro     # only suites under a prefix
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  nodeTestFilesRelative, EXCLUDED, REPO_ROOT, CI_SKIPPED, isCI,
} from './lib/test-inventory.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const has = (name) => argv.includes(`--${name}`);
const prefixes = argv.filter((a) => !a.startsWith('--'));

// Default to 4 rather than availableParallelism(). Two suites in this repo
// assert on real concurrency/timing (e.g. tests/experiments/run-parallel
// "agents should overlap"); at full parallelism they contend with the other 80
// suites for CPU and fail intermittently. A test runner whose own result
// depends on machine load is not a check you can act on — the point of wiring
// this in is a signal that means the same thing every run.
const concurrency = flag('concurrency') ?? '4';

let files = nodeTestFilesRelative();
if (prefixes.length) {
  files = files.filter((f) => prefixes.some((p) => f.startsWith(p.replace(/\/$/, ''))));
}

if (has('list')) {
  for (const f of files) console.log(f);
  console.log(`\n${files.length} node:test suite(s)`);
  for (const [f, why] of EXCLUDED) console.log(`excluded: ${f} — ${why}`);
  for (const [f, why] of CI_SKIPPED) console.log(`ci-skipped: ${f} — ${why}`);
  process.exit(0);
}

if (files.length === 0) {
  console.error('run-node-tests: no node:test suites matched.');
  process.exit(1);
}

console.log(`node:test — ${files.length} suite(s), concurrency ${concurrency}`);
for (const [f, why] of EXCLUDED) console.log(`  (excluded: ${f} — ${why})`);
// Print what CI drops, every run. A skip nobody can see is indistinguishable from
// a test that does not exist.
if (isCI()) {
  for (const [f, why] of CI_SKIPPED) console.log(`  (CI-skipped: ${f} — ${why})`);
}

const child = spawn(
  process.execPath,
  ['--test', `--test-concurrency=${concurrency}`, ...files],
  { cwd: REPO_ROOT, stdio: 'inherit' },
);

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`run-node-tests: killed by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
