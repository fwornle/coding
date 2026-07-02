#!/usr/bin/env node
// Backfill ATTR-02 model attribution (canonical_model / canonical_agent /
// background_models) onto Run entities that were written before the attribution
// existed (or via a path that never computed it). It recomputes from the SAME
// source and with the SAME fg/bg split logic as measurement-stop.mjs
// (aggregateByTaskId + isForegroundGroup + normalizeAgent), so a legacy run's
// persisted attribution matches what a fresh close would have produced — which is
// exactly what the Performance table + Model facet read.
//
// GAP-FILL ONLY: it never clobbers existing values. It sets background_models only
// when the persisted list is empty, and canonical_model/agent only when currently
// null. When NO foreground token group was captured (the Anthropic-direct bypass),
// canonical_agent falls back to the run's DECLARED foreground agent — the historical
// metadata.agent, the persisted analog of measurement-stop's span.agent fallback —
// while canonical_model stays null (agent-only; a model is never guessed).
// Idempotent — re-running is a no-op.
//
// Usage: node scripts/backfill-run-attribution.mjs [--dry-run]

import process from 'node:process';
import { openExperimentStore } from '../lib/experiments/store.mjs';
import { aggregateByTaskId, isForegroundGroup } from '../lib/experiments/token-aggregate.mjs';
import { normalizeAgent } from '../lib/experiments/route-trace-resolve.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

function computeAttribution(taskId, md) {
  const { byAgentModel } = aggregateByTaskId(taskId);
  const fg = byAgentModel.filter(isForegroundGroup);
  const bg = byAgentModel.filter((g) => !isForegroundGroup(g));
  const canonical = fg[0] ?? null;
  // Foreground-agent fallback (agent-only): with no measured foreground group,
  // attribute the run to its declared foreground agent — the historical
  // metadata.agent, mirroring measurement-stop's span.agent fallback. Unlike the
  // live close (which defaults an unknown foreground to 'claude' — ground truth at
  // close time), the backfill has no live span, so it stays conservative: only a
  // KNOWN recorded agent produces a family; an absent/empty one leaves it null.
  const fgAgent = normalizeAgent({ agent: md?.agent || '' });
  return {
    canonical_model: canonical?.model ?? null,
    canonical_agent: canonical ? normalizeAgent(canonical) : fgAgent,
    background_models: bg.map((g) => ({
      model: g.model,
      process: g.process,
      total_tokens: g.total_tokens,
    })),
  };
}

async function main() {
  const store = await openExperimentStore();
  let scanned = 0;
  let updated = 0;
  try {
    // Collect first — do not mutate the store while iterating it.
    const runs = [];
    for await (const e of store.iterate({ entityType: 'Run' })) runs.push(e);

    for (const e of runs) {
      scanned += 1;
      const md = e.metadata ?? {};
      const taskId = md.task_id;
      if (!taskId) continue;

      const persistedBg = Array.isArray(md.background_models) ? md.background_models : [];
      const attr = computeAttribution(taskId, md);

      // Gap-fill: only fill what is missing; never overwrite existing values. Model
      // and agent fill INDEPENDENTLY — the foreground-agent fallback populates
      // canonical_agent even when canonical_model stays null (bypass runs).
      const fillBg = persistedBg.length === 0 && attr.background_models.length > 0;
      const fillModel = (md.canonical_model ?? null) == null && attr.canonical_model != null;
      const fillAgent = (md.canonical_agent ?? null) == null && attr.canonical_agent != null;
      if (!fillBg && !fillModel && !fillAgent) continue;

      const nextMd = {
        ...md,
        canonical_model: fillModel ? attr.canonical_model : (md.canonical_model ?? null),
        canonical_agent: fillAgent ? attr.canonical_agent : (md.canonical_agent ?? null),
        background_models: fillBg ? attr.background_models : persistedBg,
      };

      const bgSummary = nextMd.background_models.map((b) => b.model).join(', ') || '(none)';
      process.stdout.write(
        `${DRY_RUN ? '[dry-run] ' : ''}${taskId}: ` +
        `${fillModel ? `model→${attr.canonical_model} ` : ''}` +
        `${fillAgent ? `agent→${attr.canonical_agent} ` : ''}` +
        `${fillBg ? `bg→[${bgSummary}]` : ''}\n`,
      );

      if (!DRY_RUN) {
        await store.putEntity({
          id: e.id,
          name: e.name ?? taskId,
          entityType: 'Run',
          layer: e.layer ?? 'evidence',
          description: e.description ?? '',
          metadata: nextMd,
        }, {
          provenance: {
            provider: 'coding-backfill-attribution',
            model: 'n/a',
            runId: taskId,
            timestamp: new Date().toISOString(),
          },
        });
      }
      updated += 1;
    }
  } finally {
    await store.close();
  }
  process.stdout.write(`\n${DRY_RUN ? '[dry-run] ' : ''}scanned ${scanned} runs, ${updated} ${DRY_RUN ? 'would be ' : ''}updated\n`);
}

main().catch((err) => {
  process.stderr.write(`backfill failed: ${err?.stack || err}\n`);
  process.exit(1);
});
