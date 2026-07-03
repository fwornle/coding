#!/usr/bin/env node
/**
 * On-demand recompute / backfill CLI for a single Run's route heuristics + Route
 * node (Phase 72-05, ROUTE-02 / D-14). Rides the Phase-71 idempotent re-close:
 * it re-derives the six syntactic heuristics for an EXISTING Run from its archived
 * span and calls the SAME extended `writeRun`, which UPDATES the same Run + Route
 * (never a duplicate — Pitfall 1/2). Use it to backfill runs closed before this
 * plan landed, or to recompute after a reader/heuristic fix.
 *
 * The store is opened EXCLUSIVELY via openExperimentStore() (the mandatory
 * ontologyDir factory — CLAUDE.md km-core rule; the store is never constructed
 * inline), in a try/finally that always close()s the single-owner LevelDB
 * (Pitfall 5 — do NOT run two experiment CLIs concurrently against the store).
 *
 * Output via process.stdout.write / process.stderr.write only — the no-console-log
 * rule (CLAUDE.md) forbids the stdout/err logging family here.
 *
 * Usage:
 *   node scripts/experiments-recompute-route.mjs <task_id>
 *   node scripts/experiments-recompute-route.mjs <task_id> --dry-run
 *
 * Env:
 *   CODING_REPO         repo root (default /Users/Q284340/Agentic/coding)
 *   LLM_PROXY_DATA_DIR  data dir for the archived span files (default <repo>/.data)
 *
 * Analog: scripts/backfill-task-id-by-timestamp.mjs (entry-point guard, --dry-run,
 *         store/db open-on-demand + finally-close).
 */

import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { openExperimentStore } from '../lib/experiments/store.mjs';
import { aggregateByTaskId, isForegroundGroup } from '../lib/experiments/token-aggregate.mjs';
import { writeRun } from '../lib/experiments/run-write.mjs';
import { buildNormalizedTrace } from '../lib/lsl/route/build-trace.mjs';
import { computeHeuristics, ALL_NULL_HEURISTICS } from '../lib/experiments/route-heuristics.mjs';
import { normalizeAgent, buildTraceSeam } from '../lib/experiments/route-trace-resolve.mjs';

const REPO_ROOT = process.env.CODING_REPO || '/Users/Q284340/Agentic/coding';

const out = (s) => process.stdout.write(s + '\n');
const warn = (s) => process.stderr.write(s + '\n');

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
    warn(`[recompute] cannot read archived span ${file}: ${err?.message ?? String(err)}`);
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
    warn('usage: node scripts/experiments-recompute-route.mjs <task_id> [--dry-run]');
    process.exitCode = 2;
    return;
  }

  out(`[recompute] mode=${dryRun ? 'DRY-RUN' : 'APPLY'} task_id=${taskId}`);

  const span = readArchivedSpan(taskId);
  if (!span) {
    warn(`[recompute] no archived span for task_id=${taskId} — nothing to recompute`);
    process.exitCode = 1;
    return;
  }

  const store = await openExperimentStore();
  try {
    const run = await findRun(store, taskId);
    if (!run) {
      warn(`[recompute] no existing Run for task_id=${taskId} (run a close first)`);
      process.exitCode = 1;
      return;
    }

    // Re-aggregate tokens (read-only) and reuse the run's stored class/tags so the
    // recompute is a faithful idempotent re-close (no re-prompt, no reclassification).
    const { totals, byAgentModel } = aggregateByTaskId(taskId);
    const m = run.metadata ?? {};

    // ── Canonical model/agent selection — MIRROR the stop path (measurement-stop.mjs
    //    §327-360; do NOT re-derive isForegroundGroup). We NEVER fall back to the
    //    by-count winner (byAgentModel[0]); that by-count fallback was the finding-B
    //    bug — a 1.24M-token haiku daemon out-massed the Opus foreground and re-stamped
    //    the Run as haiku. Precedence: (1) the Run's already-persisted canonical value
    //    when non-null; (2) else the foreground group that is NOT a captured sub-agent
    //    (isForegroundGroup filter, fall back to fgGroups[0]); (3) else null. A null
    //    persists as "unmeasured" downstream — it is never coerced to a by-count group.
    const fgGroups = byAgentModel.filter(isForegroundGroup);
    const bgGroups = byAgentModel.filter((g) => !isForegroundGroup(g));
    const isSubagentGroup = (g) => g?.process === 'token-adapter-claude-subagent';
    const canonical = fgGroups.find((g) => !isSubagentGroup(g)) ?? fgGroups[0] ?? null;
    // Declared foreground agent — the agent-only fallback for the Anthropic-direct
    // bypass (no proxy/adapter fg group), mirroring measurement-stop's span.agent
    // fallback. Model stays null when no fg group was measured (never guessed).
    const declaredAgent = span.agent ?? span.meta?.agent ?? m.agent ?? null;
    const canonicalModel = m.canonical_model ?? canonical?.model ?? null;
    const canonicalAgent =
      m.canonical_agent
      ?? (canonical
        ? normalizeAgent(canonical)
        : (declaredAgent ? normalizeAgent({ agent: declaredAgent }) : null));
    const backgroundModels =
      Array.isArray(m.background_models) && m.background_models.length
        ? m.background_models
        : bgGroups.map((g) => ({
          model: g.model,
          process: g.process,
          total_tokens: g.total_tokens,
        }));

    // writeRun persists canonical_model/canonical_agent/background_models from the
    // tags object (run-write.mjs §119-121 reads them off `tags`), so thread the
    // resolved canonical value in — this makes the idempotent re-close preserve the
    // corrected model and is what prevents a re-close from regressing it back to null.
    const tags = {
      task_hash: m.task_hash ?? null,
      agent: m.agent ?? canonicalAgent ?? null,
      model: m.model ?? canonicalModel ?? null,
      framework: m.framework ?? null,
      trace_id: m.trace_id ?? taskId,
      canonical_model: canonicalModel,
      canonical_agent: canonicalAgent,
      background_models: backgroundModels,
    };
    const taskClass = m.task_class ?? 'unclassified';
    const pending = m.pending === true;

    // Rebuild the trace + recompute heuristics (D-02 null when no trace).
    // Normalize the agent + inject the Claude session seam exactly as the close
    // orchestrator does — otherwise recompute would re-null Claude/Copilot runs
    // (the default locator is a stub awaiting a seam; build-trace.mjs).
    const normAgent = normalizeAgent({ agent: tags.agent, model: tags.model });
    const trace = await buildNormalizedTrace(span, {
      dominantAgent: normAgent,
      __seam: buildTraceSeam(normAgent, span),
    });
    const heuristics = trace ? computeHeuristics(trace) : ALL_NULL_HEURISTICS;

    out(
      `[recompute] task_class=${taskClass} agent=${tags.agent ?? 'null'} ` +
      `canonical_model=${canonicalModel ?? 'null'} ` +
      `steps=${heuristics.total_step_count ?? 'null'} loops=${heuristics.loop_count ?? 'null'}`,
    );

    if (dryRun) {
      out('[recompute] dry-run — no write performed.');
      return;
    }

    // Idempotent re-close: UPDATES the same Run + Route, dedupes the tookRoute edge.
    await writeRun(store, { span, taskClass, pending, tags, totals, heuristics });
    out(`[recompute] updated Run + Route for task_id=${taskId}`);
  } finally {
    await store.close();
  }
}

// Entry-point guard — only run main() when invoked directly, NOT when imported for
// tests (mirrors scripts/backfill-task-id-by-timestamp.mjs:281-287).
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
