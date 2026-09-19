#!/usr/bin/env node

/**
 * Periodic insight compaction — re-examines all stored insights, clusters
 * by embedding cosine + topic-Jaccard, and asks the LLM to MERGE / FACET /
 * SEPARATE each cluster. Use cases:
 *
 *   - Catch dupes that slipped through the per-synthesis dedup band.
 *   - Auto-group sibling facets that emerged across separate runs.
 *   - Self-heal the corpus on a weekly cadence (launchd).
 *
 * Usage:
 *   node scripts/compact-insights.mjs                    # dry run, project=coding
 *   node scripts/compact-insights.mjs --project=resi     # different project scope
 *   node scripts/compact-insights.mjs --clusters-only    # clustering preview, no LLM
 *   node scripts/compact-insights.mjs --apply            # write changes
 *
 * THIS IS A THIN CLIENT. The work runs inside obs-api.
 *
 * km-core's LevelDB is SINGLE-OWNER: obs-api holds the store, so a second
 * process cannot open it. This script previously built its own
 * ObservationConsolidator with no kmStore and threw
 * "km-core not configured — pass options.kmStore" on every invocation —
 * which is why the insight corpus had never been compacted even once. It
 * now POSTs to obs-api's /api/insights/compact and polls for the result,
 * the same in-process pattern the consolidator and LSL resolver already use.
 *
 * Side effects when --apply is set:
 *   - km-core: MERGE absorbs + deletes rows, FACET writes relatedInsightIds.
 *   - LLM: one proxy call per multi-member cluster (consolidator-compaction).
 *   - Qdrant: orphan points from MERGE deletes self-heal on the next embed.
 */

const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const APPLY = !!args.apply;
const PROJECT = args.project || 'coding';
const CLUSTERS_ONLY = !!args['clusters-only'];
// Connected-components clustering is single-linkage, so similarity chains
// transitively. Components above this size are reported, never merged.
const MAX_CLUSTER_SIZE = Number(args['max-cluster-size']) > 0
  ? Number(args['max-cluster-size'])
  : 20;
// Compaction is one LLM call per multi-member cluster; a large corpus can
// legitimately run for many minutes. Bounded so a wedged run cannot hang a
// weekly launchd job forever.
const TIMEOUT_MS = Number(args.timeout) > 0 ? Number(args.timeout) : 45 * 60_000;

const out = (msg = '') => process.stdout.write(`${msg}\n`);
const err = (msg) => process.stderr.write(`${msg}\n`);

const mode = CLUSTERS_ONLY
  ? '— CLUSTER-PREVIEW (no LLM, no writes)'
  : APPLY
    ? '— APPLY MODE'
    : '(dry run, LLM verdicts only)';
out(`\n=== Insight compaction ${mode} ===`);
out(`Project: ${PROJECT}\n`);

let accepted;
try {
  const r = await fetch(`${OBS_API}/api/insights/compact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: PROJECT, dryRun: !APPLY, clustersOnly: CLUSTERS_ONLY, maxClusterSize: MAX_CLUSTER_SIZE }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 409) {
    err(`Busy: ${body.error || 'consolidation in flight'} — try again shortly.`);
    process.exit(75); // EX_TEMPFAIL — a cron retry is the right response
  }
  if (!r.ok && r.status !== 202) {
    err(`obs-api returned HTTP ${r.status}: ${body.error || '(no detail)'}`);
    process.exit(1);
  }
  accepted = body;
} catch (e) {
  err(`Cannot reach obs-api at ${OBS_API}: ${e.message}`);
  err('Is com.coding.obs-api running?  launchctl list | grep obs-api');
  process.exit(1);
}

const jobId = accepted.jobId;
const deadline = Date.now() + TIMEOUT_MS;
let result = null;

while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5_000));
  let st;
  try {
    const r = await fetch(`${OBS_API}/api/insights/compact/status`, {
      signal: AbortSignal.timeout(15_000),
    });
    st = await r.json();
  } catch {
    continue; // transient — obs-api is busy doing the work
  }
  if (st.inflight) continue;
  if (st.lastJob && st.lastJob.id === jobId) {
    if (st.lastJob.error) {
      err(`Compaction failed: ${st.lastJob.error.message}`);
      process.exit(1);
    }
    result = st.lastJob.result;
    break;
  }
}

if (!result) {
  err(`Timed out after ${Math.round(TIMEOUT_MS / 60000)} min waiting for job ${jobId}.`);
  err(`The run may still be in flight — check ${OBS_API}/api/insights/compact/status`);
  process.exit(1);
}

out('');
out(`Clusters found:    ${result.clusters}  (actionable, size <= ${MAX_CLUSTER_SIZE})`);
if (result.oversizedSkipped) {
  out(`Oversized skipped: ${result.oversizedSkipped}  (sizes: ${(result.oversizedSizes || []).join(', ')})`);
  out('  ^ single-linkage chaining — these need a tighter clustering pass, not a merge.');
}
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
