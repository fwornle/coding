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
// null and a foreground group exists. Idempotent — re-running is a no-op.
//
// Usage: node scripts/backfill-run-attribution.mjs [--dry-run]

import process from 'node:process';
import { openExperimentStore } from '../lib/experiments/store.mjs';
import { aggregateByTaskId, isForegroundGroup } from '../lib/experiments/token-aggregate.mjs';
import { normalizeAgent } from '../lib/experiments/route-trace-resolve.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

function computeAttribution(taskId) {
  const { byAgentModel } = aggregateByTaskId(taskId);
  const fg = byAgentModel.filter(isForegroundGroup);
  const bg = byAgentModel.filter((g) => !isForegroundGroup(g));
  const canonical = fg[0] ?? null;
  return {
    canonical_model: canonical?.model ?? null,
    canonical_agent: canonical ? normalizeAgent(canonical) : null,
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
      const persistedCanonical = md.canonical_model ?? null;
      const attr = computeAttribution(taskId);

      // Gap-fill: only fill what is missing; never overwrite existing values.
      const fillBg = persistedBg.length === 0 && attr.background_models.length > 0;
      const fillCanonical = persistedCanonical == null && attr.canonical_model != null;
      if (!fillBg && !fillCanonical) continue;

      const nextMd = {
        ...md,
        canonical_model: fillCanonical ? attr.canonical_model : (md.canonical_model ?? null),
        canonical_agent: fillCanonical ? attr.canonical_agent : (md.canonical_agent ?? null),
        background_models: fillBg ? attr.background_models : persistedBg,
      };

      const bgSummary = nextMd.background_models.map((b) => b.model).join(', ') || '(none)';
      process.stdout.write(
        `${DRY_RUN ? '[dry-run] ' : ''}${taskId}: ` +
        `${fillCanonical ? `canonical→${attr.canonical_model} ` : ''}` +
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
