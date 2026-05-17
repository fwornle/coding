#!/usr/bin/env node

/**
 * Periodic insight compaction — re-examines all stored insights, clusters
 * by embedding cosine + topic-Jaccard, and asks the LLM to MERGE / FACET /
 * SEPARATE each cluster. Use cases:
 *
 *   - Catch dupes that slipped through the per-synthesis dedup band.
 *   - Auto-group sibling facets that emerged across separate runs.
 *   - Self-heal the corpus on a weekly cadence (cron / launchd).
 *
 * Usage:
 *   node scripts/compact-insights.mjs                    # dry run, project=coding
 *   node scripts/compact-insights.mjs --project=resi     # different project scope
 *   node scripts/compact-insights.mjs --apply            # write changes
 *
 * Side effects when --apply is set:
 *   - SQLite: MERGE deletes absorbed rows, FACET writes relatedInsightIds metadata.
 *   - LLM: one proxy call per multi-member cluster (consolidator-compaction process).
 *   - Qdrant: nothing direct; orphan points from MERGE deletes self-heal on next embed.
 */

import { ObservationConsolidator } from '../src/live-logging/ObservationConsolidator.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const APPLY = !!args.apply;
const PROJECT = args.project || 'coding';
const CLUSTERS_ONLY = !!args['clusters-only'];

const out = (msg = '') => process.stdout.write(`${msg}\n`);
const err = (msg) => process.stderr.write(`${msg}\n`);

const consolidator = new ObservationConsolidator({
  dbPath: resolve(ROOT, '.observations/observations.db'),
});

try {
  await consolidator.init();
} catch (e) {
  err(`Init failed: ${e.message}`);
  process.exit(1);
}

const mode = CLUSTERS_ONLY
  ? '— CLUSTER-PREVIEW (no LLM, no writes)'
  : APPLY
    ? '— APPLY MODE'
    : '(dry run, LLM verdicts only)';
out(`\n=== Insight compaction ${mode} ===`);
out(`Project: ${PROJECT}\n`);

const result = await consolidator.compactInsights({
  project: PROJECT,
  dryRun: !APPLY,
  clustersOnly: CLUSTERS_ONLY,
});

out('');
out(`Clusters found:    ${result.clusters}`);
if (CLUSTERS_ONLY && result.clusterTopics) {
  for (let i = 0; i < result.clusterTopics.length; i++) {
    out(`  Cluster ${i + 1} (${result.clusterTopics[i].length} insights):`);
    for (const t of result.clusterTopics[i]) out(`    - ${t}`);
  }
  out('');
  out('Cluster preview only. Re-run without --clusters-only for LLM verdicts.\n');
} else {
  out(`MERGE verdicts:    ${result.merges}`);
  out(`FACET verdicts:    ${result.facets}`);
  out(`SEPARATE verdicts: ${result.separated}`);
  out('');
  if (!APPLY) {
    out('Dry run only. Re-run with --apply to commit verdicts.\n');
  }
}

consolidator.close();
