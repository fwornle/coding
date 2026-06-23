#!/usr/bin/env node
/**
 * Operator CLI — read the experiment KB (D-03). "Comparisons as queries":
 * canned read-only queries over the Run/Outcome entities writeRun materialized
 * into the dedicated experiment store (71-04).
 *
 * Quarantine exclusion is NON-NEGOTIABLE (D-06): every query SKIPS Runs whose
 * `metadata.pending === true`. An unclassified/quarantined Run is never COUNTED
 * until `experiments-classify.mjs` resolves it (SC-4).
 *
 * Canned queries (--query):
 *   runs-by-class    — count + list Runs per task_class (the default).
 *   agent-vs-cost    — group by (agent, model); sum the produced Outcome.totalTokens.
 *
 * Optional filters: --task-class <c>, --agent <a>.
 *
 * Output via process.stdout.write / process.stderr.write only (no console.* —
 * no-console-log / CLAUDE.md).
 *
 * Usage:
 *   node scripts/experiments-query.mjs                              # runs-by-class (default)
 *   node scripts/experiments-query.mjs --query runs-by-class
 *   node scripts/experiments-query.mjs --query agent-vs-cost
 *   node scripts/experiments-query.mjs --query runs-by-class --task-class refactor
 *   node scripts/experiments-query.mjs --query runs-by-class --agent claude-code
 *
 * Analog: scripts/backfill-project-tag.mjs (CLI arg parse → store open/iterate → close in finally).
 */

import process from 'node:process';
import { pathToFileURL } from 'node:url';
// opens via openExperimentStore() — ontologyDir set in lib/experiments/store.mjs
import { openExperimentStore } from '../lib/experiments/store.mjs';

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
}

/**
 * Collect the non-quarantined Runs, applying optional task_class/agent filters.
 * The `pending === true` skip is the D-06 exclusion — always first.
 */
async function collectRuns(store, { filterClass, filterAgent }) {
  const runs = [];
  for await (const e of store.iterate({ entityType: 'Run' })) {
    if (e.metadata?.pending === true) continue;            // D-06 quarantine exclusion (non-negotiable)
    if (filterClass && e.metadata?.task_class !== filterClass) continue;
    if (filterAgent && e.metadata?.agent !== filterAgent) continue;
    runs.push(e);
  }
  return runs;
}

/** Map run_task_id → Outcome.totalTokens for the agent-vs-cost join. */
async function outcomeTokensByRunTaskId(store) {
  const byTaskId = new Map();
  for await (const o of store.iterate({ entityType: 'Outcome' })) {
    const tid = o.metadata?.run_task_id;
    if (tid) byTaskId.set(tid, Number(o.metadata?.totalTokens ?? 0));
  }
  return byTaskId;
}

function queryRunsByClass(runs) {
  const byClass = new Map();
  for (const r of runs) {
    const cls = r.metadata?.task_class ?? '(none)';
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(r.metadata?.task_id ?? r.id);
  }
  process.stdout.write(`runs-by-class (excludes quarantine) — ${runs.length} run(s)\n`);
  if (byClass.size === 0) {
    process.stdout.write('  (no classified runs)\n');
    return;
  }
  for (const [cls, ids] of [...byClass.entries()].sort()) {
    process.stdout.write(`  ${cls}: ${ids.length}  [${ids.join(', ')}]\n`);
  }
}

function queryAgentVsCost(runs, outcomeTokens) {
  const byAgentModel = new Map();
  for (const r of runs) {
    const agent = r.metadata?.agent ?? '(none)';
    const model = r.metadata?.model ?? '(none)';
    const key = `${agent} | ${model}`;
    const tokens = outcomeTokens.get(r.metadata?.task_id) ?? 0;
    const prev = byAgentModel.get(key) ?? { runs: 0, totalTokens: 0 };
    prev.runs += 1;
    prev.totalTokens += tokens;
    byAgentModel.set(key, prev);
  }
  process.stdout.write(`agent-vs-cost (excludes quarantine) — ${runs.length} run(s)\n`);
  if (byAgentModel.size === 0) {
    process.stdout.write('  (no classified runs)\n');
    return;
  }
  for (const [key, agg] of [...byAgentModel.entries()].sort((a, b) => b[1].totalTokens - a[1].totalTokens)) {
    process.stdout.write(`  ${key}: runs=${agg.runs} totalTokens=${agg.totalTokens}\n`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const query = parseStrArg(args, '--query') ?? 'runs-by-class';
  const filterClass = parseStrArg(args, '--task-class');
  const filterAgent = parseStrArg(args, '--agent');

  const store = await openExperimentStore();
  try {
    const runs = await collectRuns(store, { filterClass, filterAgent });
    if (query === 'runs-by-class') {
      queryRunsByClass(runs);
    } else if (query === 'agent-vs-cost') {
      const outcomeTokens = await outcomeTokensByRunTaskId(store);
      queryAgentVsCost(runs, outcomeTokens);
    } else {
      process.stderr.write(`error: unknown --query '${query}' (use: runs-by-class | agent-vs-cost)\n`);
      process.exitCode = 2;
    }
  } finally {
    await store.close();
  }
}

// Entry-point guard — only run the CLI when invoked directly, NOT when imported
// (the enforcement test imports this module for its pure helpers).
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

export { collectRuns, outcomeTokensByRunTaskId, queryRunsByClass, queryAgentVsCost };
