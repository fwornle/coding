#!/usr/bin/env node
/**
 * On-demand re-judge / recompute CLI for a single Run's success Score (Phase 73-06,
 * ROUTE-03 / SCORE-01 / D-03 / D-06). A near-clone of experiments-recompute-route.mjs:
 * it re-derives the goal-alignment + 5-dim rubric for an EXISTING Run from its
 * archived span and calls the SAME idempotent writeScore, which UPDATES the same
 * Score node + dedupes the `scored` edge (never a duplicate — Pitfall 1/2). Use it to
 * backfill runs closed before 73-06 landed, or to re-score after a judge/evidence fix.
 *
 * D-06 OVERRIDE PRESERVATION: writeScore carries forward any human `corrected_*` /
 * overridden_by / overridden_at on every re-write — so a recompute REFRESHES the
 * judged fields (goal_aligned_ratio + rubric + rationales + pending/not_scored)
 * WITHOUT clobbering operator overrides (T-73-06-CLOBBER, re-asserted here).
 *
 * The store is opened EXCLUSIVELY via openExperimentStore() (the mandatory
 * ontologyDir factory — CLAUDE.md km-core rule; the store is never constructed
 * inline), in a try/finally that always close()s the single-owner LevelDB
 * (Pitfall 5 / T-73-06-LOCK — do NOT run two experiment CLIs concurrently).
 *
 * Output via process.stdout.write / process.stderr.write only — the no-console-log
 * rule (CLAUDE.md) forbids the stdout/err logging family here.
 *
 * Usage:
 *   node scripts/experiments-recompute-score.mjs <task_id>
 *   node scripts/experiments-recompute-score.mjs <task_id> --dry-run
 *
 * Env:
 *   CODING_REPO         repo root (default /Users/Q284340/Agentic/coding)
 *   LLM_PROXY_DATA_DIR  data dir for the archived span files (default <repo>/.data)
 *
 * Analog: scripts/experiments-recompute-route.mjs — verbatim arg parse + span read +
 *         store open/finally-close + agent-seam trace rebuild + entry-point guard;
 *         the heuristics step is SWAPPED for the judge + writeScore step.
 */

import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { openExperimentStore } from '../lib/experiments/store.mjs';
import { buildNormalizedTrace } from '../lib/lsl/route/build-trace.mjs';
import { normalizeAgent, buildTraceSeam } from '../lib/experiments/route-trace-resolve.mjs';
// 73-06 — the success-scoring half (the step swapped in for computeHeuristics):
//   gatherEvidence reads on-disk artifacts (73-03); runJudge does the ONE Haiku
//   /api/complete call and internally quarantines to pending (73-04, never throws);
//   writeScore materializes the Score + scored edge, preserving corrected_* (73-02);
//   isTrivialRun (73-01) short-circuits trivial runs before the proxy is paid.
import { gatherEvidence, deriveNonGsdRubric } from '../lib/experiments/evidence-harness.mjs';
import { runJudge } from '../lib/experiments/judge.mjs';
import { writeScore } from '../lib/experiments/score-write.mjs';
import { isTrivialRun, filterConsequential } from '../lib/experiments/consequential-events.mjs';

const REPO_ROOT = process.env.CODING_REPO || '/Users/Q284340/Agentic/coding';

const out = (s) => process.stdout.write(s + '\n');
const warn = (s) => process.stderr.write(s + '\n');

// The three deterministic, harness-derived (non-LLM) rubric dims (76-03, D-08).
const NON_GSD_DIMS = Object.freeze(['code_quality', 'test_coverage', 'regressions']);

/**
 * Gap-fill the deterministic non-GSD dims onto a judgment IN PLACE (VALID-03 / D-08) —
 * the SAME overlay the live close applies, so a backfill scores non-GSD dims too. For
 * each of code_quality/test_coverage/regressions, set the judged value from the
 * harness-derived signal ONLY when the judged value is null AND the derived value is
 * non-null; never clobber a real judged dim, never overwrite with a derived null.
 * Trivial runs (no rubric) are skipped; pending judgments (null rubric) ARE filled.
 * @param {object} judgment the judgment object (mutated).
 * @param {object} evidence the gathered evidence (diff + test run).
 */
function overlayNonGsdRubric(judgment, evidence) {
  if (!judgment || judgment.not_scored === 'trivial') return;
  const derived = deriveNonGsdRubric(evidence);
  const rubric = judgment.rubric ?? (judgment.rubric = {});
  for (const dim of NON_GSD_DIMS) {
    if ((rubric[dim] ?? null) === null && derived[dim] !== null) {
      rubric[dim] = derived[dim];
    }
  }
}

/** Resolve the default data dir (mirrors the proxy/backfill resolution order). */
function resolveDataDir() {
  return process.env.LLM_PROXY_DATA_DIR || path.join(REPO_ROOT, '.data');
}

/** Read the archived span JSON the proxy wrote at close. Returns null when unreadable. */
function readArchivedSpan(taskId) {
  const file = path.join(resolveDataDir(), 'measurements', `${taskId}.json`);
  try {
    const span = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!span || typeof span.task_id !== 'string') return null;
    return span;
  } catch (err) {
    warn(`[recompute-score] cannot read archived span ${file}: ${err?.message ?? String(err)}`);
    return null;
  }
}

/** Find an existing Run carrying this task_id (the idempotency key). null when absent. */
async function findRun(store, taskId) {
  for await (const e of store.iterate({ entityType: 'Run' })) {
    if (e.metadata?.task_id === taskId) return e;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const taskId = args.find((a) => !a.startsWith('--'));

  if (!taskId) {
    warn('error: <task_id> is required');
    warn('usage: node scripts/experiments-recompute-score.mjs <task_id> [--dry-run]');
    process.exitCode = 2;
    return;
  }

  out(`[recompute-score] mode=${dryRun ? 'DRY-RUN' : 'APPLY'} task_id=${taskId}`);

  const span = readArchivedSpan(taskId);
  if (!span) {
    warn(`[recompute-score] no archived span for task_id=${taskId} — nothing to recompute`);
    process.exitCode = 1;
    return;
  }

  const store = await openExperimentStore();
  try {
    const run = await findRun(store, taskId);
    if (!run) {
      warn(`[recompute-score] no existing Run for task_id=${taskId} (run a close first)`);
      process.exitCode = 1;
      return;
    }
    const m = run.metadata ?? {};

    // Rebuild the trace + inject the Claude session seam EXACTLY as the close
    // orchestrator does — otherwise recompute would re-null Claude/Copilot runs (the
    // default locator is a stub awaiting a seam; build-trace.mjs). MUST copy verbatim.
    const normAgent = normalizeAgent({ agent: m.agent ?? null, model: m.model ?? null });
    const trace = await buildNormalizedTrace(span, {
      dominantAgent: normAgent,
      __seam: buildTraceSeam(normAgent, span),
    });

    // Gather deterministic on-disk evidence (73-03). phaseArg is best-effort from the
    // span/run metadata; null degrades each evidence slot to null (diffStat still read).
    const phaseArg = span.meta?.phase ?? m.phase ?? null;
    const evidence = gatherEvidence({ span, phaseArg, repoRoot: REPO_ROOT });

    // Judge the rebuilt trace — D-04 trivial-run guard short-circuits the proxy; else
    // runJudge does the ONE Haiku call and internally quarantines to pending (D-03).
    const judgment = isTrivialRun(trace)
      ? { not_scored: 'trivial' }
      : await runJudge({ span, trace: filterConsequential(trace), evidence });

    // VALID-03 (76-03, D-08): overlay the deterministic non-GSD dims onto the
    // judgment (gap-fill only — never clobber a judged dim, skip trivial runs), so
    // re-scoring an EXISTING non-GSD Run persists code_quality/test_coverage/
    // regressions from the harness derivation without any LLM call for those dims.
    overlayNonGsdRubric(judgment, evidence);

    const ratioStr = judgment?.goal_aligned_ratio == null
      ? 'null'
      : judgment.goal_aligned_ratio.toFixed(3);
    const marker = judgment?.not_scored === 'trivial'
      ? 'trivial'
      : (judgment?.pending === true ? 'pending' : 'scored');
    out(
      `[recompute-score] agent=${m.agent ?? 'null'} score=${marker} ` +
      `goal_aligned_ratio=${ratioStr}`,
    );

    if (dryRun) {
      out('[recompute-score] dry-run — no write performed.');
      return;
    }

    // Idempotent re-judge: UPDATES the same Score, dedupes the scored edge, and
    // PRESERVES any human corrected_* overrides (D-06) while refreshing judged fields.
    const scoreId = await writeScore(store, { span, judgment });
    out(`[recompute-score] updated Score (id=${String(scoreId).slice(0, 8)}) for task_id=${taskId}`);
  } finally {
    await store.close();
  }
}

// Entry-point guard — only run main() when invoked directly, NOT when imported for
// tests (mirrors scripts/experiments-recompute-route.mjs:149-162).
const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    warn(`FATAL: ${err.stack || err.message}`);
    process.exit(1);
  });
}
