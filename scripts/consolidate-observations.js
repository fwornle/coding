#!/usr/bin/env node
/**
 * consolidate-observations.js — CLI for observation consolidation pipeline.
 *
 * Usage:
 *   node scripts/consolidate-observations.js              # consolidate all past days + insights
 *   node scripts/consolidate-observations.js --date 2026-04-21  # consolidate a specific day
 *   node scripts/consolidate-observations.js --status     # show consolidation status
 *   node scripts/consolidate-observations.js --insights   # run insight synthesis only
 */

import { ObservationConsolidator } from '../src/live-logging/ObservationConsolidator.js';
import path from 'node:path';

const args = process.argv.slice(2);
const dateFlag = args.indexOf('--date');
const statusFlag = args.includes('--status');
const insightsFlag = args.includes('--insights');

const dbPath = path.resolve('.observations/observations.db');

async function main() {
  const consolidator = new ObservationConsolidator({ dbPath });
  await consolidator.init();

  try {
    if (statusFlag) {
      const status = consolidator.getStatus();
      process.stderr.write(`\nConsolidation Status:\n`);
      process.stderr.write(`  Observations: ${status.totalObs} total, ${status.undigested} undigested\n`);
      process.stderr.write(`  Digests:      ${status.totalDigests}\n`);
      process.stderr.write(`  Insights:     ${status.totalInsights}\n\n`);
      return;
    }

    if (insightsFlag) {
      const result = await consolidator.synthesizeInsights();
      process.stderr.write(`\nInsight synthesis: ${result.created} created, ${result.updated} updated\n`);
      return;
    }

    if (dateFlag >= 0 && args[dateFlag + 1]) {
      const date = args[dateFlag + 1];
      const result = await consolidator.consolidateDay(date);
      process.stderr.write(`\n${date}: ${result.digests} digests from ${result.observations} observations\n`);
      return;
    }

    // Full pipeline
    const result = await consolidator.run();
    process.stderr.write(`\nConsolidation complete:\n`);
    process.stderr.write(`  Days processed: ${result.days}\n`);
    process.stderr.write(`  Digests created: ${result.digests}\n`);
    process.stderr.write(`  Observations digested: ${result.observations}\n`);
    process.stderr.write(`  Insights created: ${result.created}\n`);
    process.stderr.write(`  Insights updated: ${result.updated}\n`);
  } finally {
    consolidator.close();
  }
}

main().catch(err => {
  process.stderr.write(`[consolidate-observations] Fatal: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
