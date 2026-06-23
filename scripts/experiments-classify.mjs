#!/usr/bin/env node
/**
 * Operator CLI — quarantine resolver (D-08). Lists the Runs that landed in
 * quarantine (`metadata.pending === true`, e.g. a headless close with no
 * confident class — D-06), lets the operator assign a closed-6 task_class, and
 * flips `pending → false` so the Run is RE-INCLUDED in `experiments-query` results.
 *
 * Enforcement (SC-4 / T-71-05-01): the assigned class is enum-validated via
 * `isValidClass` (the same closed-6 gate the write path uses) — free strings are
 * rejected with a non-zero exit BEFORE any store mutation.
 *
 * The store is re-written on the STRICT path with a synthetic provenance stamp
 * (the store never invents one — D-30), preserving entityType validation against
 * the experiment ontology registry.
 *
 * Output via process.stdout.write / process.stderr.write only (no console.* —
 * no-console-log / CLAUDE.md).
 *
 * Usage:
 *   node scripts/experiments-classify.mjs                                   # list pending; interactive assign (TTY)
 *   node scripts/experiments-classify.mjs --task-id <id> --task-class <c>   # non-interactive single assign
 *
 * Analog: scripts/backfill-project-tag.mjs (store open/update/close) + node:readline.
 */

import process from 'node:process';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
// opens via openExperimentStore() — ontologyDir set in lib/experiments/store.mjs
import { openExperimentStore } from '../lib/experiments/store.mjs';
import { loadTaxonomy, isValidClass } from '../lib/experiments/taxonomy.mjs';

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
}

/** Collect every quarantined Run (pending:true) — drains the iterator. */
async function collectPending(store) {
  const pending = [];
  for await (const e of store.iterate({ entityType: 'Run' })) {
    if (e.metadata?.pending === true) pending.push(e);
  }
  return pending;
}

/**
 * Re-include a quarantined Run: validate the assigned class, then strict-path
 * re-write the SAME node (same id) with task_class set + pending:false. Throws
 * on an invalid class so callers can surface a non-zero exit before any write.
 */
async function assignClass(store, run, taskClass, taxonomy) {
  if (!isValidClass(taskClass, taxonomy)) {
    throw new Error(
      `'${taskClass}' is not a valid taxonomy class. Allowed: ${Object.keys(taxonomy.classes).join(', ')}`,
    );
  }
  const provenance = {
    provider: 'coding-experiments-classify',
    model: 'n/a',
    runId: run.metadata?.task_id ?? run.id,
    timestamp: new Date().toISOString(),
  };
  await store.putEntity({
    ...run,
    metadata: { ...run.metadata, task_class: taskClass, pending: false },
  }, { provenance });
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer).trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const taskIdArg = parseStrArg(args, '--task-id');
  const taskClassArg = parseStrArg(args, '--task-class');
  const taxonomy = loadTaxonomy();

  const store = await openExperimentStore();
  try {
    const pending = await collectPending(store);
    process.stdout.write(`pending (quarantined) Runs: ${pending.length}\n`); // D-08 pending count

    if (pending.length === 0) {
      process.stdout.write('nothing to classify\n');
      return;
    }

    // Non-interactive single assign.
    if (taskIdArg && taskClassArg) {
      const run = pending.find((r) => r.metadata?.task_id === taskIdArg);
      if (!run) {
        process.stderr.write(`error: no pending Run with task_id='${taskIdArg}'\n`);
        process.exitCode = 2;
        return;
      }
      try {
        await assignClass(store, run, taskClassArg, taxonomy);
      } catch (err) {
        process.stderr.write(`error: ${err.message}\n`);
        process.exitCode = 2;
        return;
      }
      process.stdout.write(`classified ${taskIdArg} → ${taskClassArg} (re-included)\n`);
      return;
    }

    // List, then interactive assign on a TTY (skip otherwise).
    for (const run of pending) {
      process.stdout.write(`  pending: task_id=${run.metadata?.task_id} goal="${run.description ?? ''}"\n`);
    }
    if (!process.stdin.isTTY) {
      process.stdout.write(
        'non-interactive: re-run with --task-id <id> --task-class <c> to assign\n',
      );
      return;
    }

    let resolved = 0;
    for (const run of pending) {
      const answer = await prompt(
        `assign task_class for ${run.metadata?.task_id} ` +
        `(one of: ${Object.keys(taxonomy.classes).join(', ')}; blank to skip): `,
      );
      if (!answer) continue;
      try {
        await assignClass(store, run, answer, taxonomy);
        resolved += 1;
        process.stdout.write(`  classified ${run.metadata?.task_id} → ${answer} (re-included)\n`);
      } catch (err) {
        process.stderr.write(`  skipped ${run.metadata?.task_id}: ${err.message}\n`);
      }
    }
    process.stdout.write(`resolved ${resolved} of ${pending.length} pending Run(s)\n`);
  } finally {
    await store.close();
  }
}

// Entry-point guard — only run the CLI when invoked directly, NOT when imported
// (the enforcement test imports this module for assignClass/collectPending).
const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`FATAL: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

export { collectPending, assignClass };
