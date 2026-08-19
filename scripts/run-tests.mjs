#!/usr/bin/env node
/**
 * scripts/run-tests.mjs — the whole suite, both runners.
 *
 * This repo has two test systems (see scripts/lib/test-inventory.mjs). `npm test`
 * used to invoke jest alone, which left 84 node:test suites unrun.
 *
 * Both halves ALWAYS run, even when the first fails. Chaining them with `&&`
 * would mean the node:test half never executes for as long as any jest suite is
 * red — which is the state the repo is in today, and exactly the state in which
 * you most want the other half's result.
 *
 * Exit code is nonzero if EITHER half failed.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const onlyArg = process.argv.slice(2).find((a) => a.startsWith('--only='))?.split('=')[1];

function run(name, command, args, env = {}) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(72)}\n  ${name}\n${'='.repeat(72)}`);
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code, signal) => resolve({ name, code: signal ? 1 : (code ?? 1), signal }));
    child.on('error', (err) => {
      console.error(`${name}: failed to start — ${err.message}`);
      resolve({ name, code: 1 });
    });
  });
}

const results = [];

if (onlyArg !== 'node') {
  results.push(await run('jest', 'npx', ['jest', ...process.argv.slice(2).filter((a) => !a.startsWith('--only='))], {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --experimental-vm-modules --no-warnings`.trim(),
  }));
}

if (onlyArg !== 'jest') {
  results.push(await run('node:test', process.execPath, ['scripts/run-node-tests.mjs']));
}

console.log(`\n${'='.repeat(72)}\n  SUITE SUMMARY\n${'='.repeat(72)}`);
for (const r of results) {
  console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name}${r.signal ? ` (${r.signal})` : ''}`);
}

process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
