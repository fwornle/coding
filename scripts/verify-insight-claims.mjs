#!/usr/bin/env node

/**
 * Bulk verify the code-claims in every insight.
 *
 * Extracts backticked file paths, function names, env vars, routes, and
 * package names from each insight summary, then checks each against the
 * filesystem (paths) or `git grep` (symbols). Writes the verification
 * result into the insight's metadata so the dashboard and compactInsights
 * can see freshness signals.
 *
 * Usage:
 *   node scripts/verify-insight-claims.mjs                     # all coding insights, persist results
 *   node scripts/verify-insight-claims.mjs --project=rapid-automations
 *   node scripts/verify-insight-claims.mjs --dry-run           # no SQLite writes
 *   node scripts/verify-insight-claims.mjs --show-stale        # print every stale claim
 *   node scripts/verify-insight-claims.mjs --topic="LLM CLI"   # filter to a topic substring
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
const PROJECT = args.project || 'coding';
const DRY_RUN = !!args['dry-run'];
const SHOW_STALE = !!args['show-stale'];
const TOPIC_FILTER = typeof args.topic === 'string' ? args.topic : null;

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

out(`\n=== Insight code-claim verification ${DRY_RUN ? '(dry run)' : '— PERSISTING TO METADATA'} ===`);
out(`Project: ${PROJECT}${TOPIC_FILTER ? `, topic substring: "${TOPIC_FILTER}"` : ''}\n`);

const result = await consolidator.verifyInsights({ project: PROJECT, persist: !DRY_RUN });

if (result.scanned === 0) {
  out('No insights found.');
  consolidator.close();
  process.exit(0);
}

let results = result.results;
if (TOPIC_FILTER) {
  results = results.filter((r) => (r.topic || '').toLowerCase().includes(TOPIC_FILTER.toLowerCase()));
}

// Sort: stalest first so problems jump out.
results.sort((a, b) => a.verificationRatio - b.verificationRatio);

out(`Insights scanned:   ${result.scanned}`);
out(`Fresh   (>=0.7):    ${result.freshCount}`);
out(`Stale   (<0.5):     ${result.staleCount}`);
out(`Average ratio:      ${result.avgRatio}`);
out('');

out('Per-insight (sorted stalest first):');
out('');

for (const r of results) {
  const bar = r.verificationRatio >= 0.7
    ? 'FRESH'
    : r.verificationRatio >= 0.5
      ? 'PARTIAL'
      : 'STALE';
  out(
    `  [${bar.padEnd(7)}] ${r.verifiedClaims}/${r.totalClaims} (${r.verificationRatio.toFixed(2)}) — ${r.topic}`
  );
  if (SHOW_STALE && r.staleClaims && r.staleClaims.length > 0) {
    for (const s of r.staleClaims) {
      out(`              ${s.type}: ${s.raw}`);
    }
  }
}

out('');
if (DRY_RUN) {
  out('Dry run only. Re-run without --dry-run to persist metadata.codeVerification to SQLite.\n');
}

consolidator.close();
