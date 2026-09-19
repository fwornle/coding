#!/usr/bin/env node

/**
 * Hierarchical insight roll-up — collapse many granular Detail insights into
 * few SubComponent-level insights, archiving the originals behind them.
 *
 * Usage:
 *   node scripts/rollup-insights.mjs --plan       # grouping only, no LLM, no writes
 *   node scripts/rollup-insights.mjs              # dry run (LLM synthesis, no writes)
 *   node scripts/rollup-insights.mjs --apply      # write parents + archive children
 *   node scripts/rollup-insights.mjs --strategy=bucket --chunk-size=25
 *   node scripts/rollup-insights.mjs --project=rec --min-group-size=4
 *
 * Strategies:
 *   cluster (default) — collapse only lexically near-duplicate insights. Safe;
 *                       measured 678 -> 533 on the coding corpus.
 *   bucket            — chunk each subsystem into groups of --chunk-size and
 *                       roll each chunk into one subsystem-level entry. This is
 *                       the one that yields a corpus a human will actually read
 *                       (chunk-size 20 -> ~47 entries, 25 -> ~40).
 *
 * THIN CLIENT — the work runs inside obs-api (km-core LevelDB is single-owner).
 *
 * Children are ARCHIVED, never deleted: metadata.archivedAt + rolledUpInto.
 * The insights typed-view hides archived rows unless includeArchived=true, so
 * the visible corpus shrinks while every original stays queryable. Reverse a
 * roll-up by clearing those two metadata keys.
 */

const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const APPLY = !!args.apply;
const PLAN_ONLY = !!args.plan;
const PROJECT = args.project || 'coding';
const TIMEOUT_MS = Number(args.timeout) > 0 ? Number(args.timeout) : 60 * 60_000;

const out = (m = '') => process.stdout.write(`${m}\n`);
const err = (m) => process.stderr.write(`${m}\n`);

const mode = PLAN_ONLY ? '— PLAN ONLY (no LLM, no writes)'
  : APPLY ? '— APPLY MODE (writes parents, archives children)'
  : '(dry run — LLM synthesis, no writes)';
out(`\n=== Insight roll-up ${mode} ===`);
out(`Project: ${PROJECT}\n`);

let accepted;
try {
  const r = await fetch(`${OBS_API}/api/insights/rollup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: PROJECT,
      dryRun: !APPLY,
      planOnly: PLAN_ONLY,
      ...(args.strategy ? { strategy: String(args.strategy) } : {}),
      ...(args['chunk-size'] ? { chunkSize: Number(args['chunk-size']) } : {}),
      ...(args['max-groups'] ? { maxGroups: Number(args['max-groups']) } : {}),
      ...(args['min-group-size'] ? { minGroupSize: Number(args['min-group-size']) } : {}),
      ...(args['max-group-size'] ? { maxGroupSize: Number(args['max-group-size']) } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 409) { err(`Busy: ${body.error}`); process.exit(75); }
  if (!r.ok && r.status !== 202) { err(`HTTP ${r.status}: ${body.error || ''}`); process.exit(1); }
  accepted = body;
} catch (e) {
  err(`Cannot reach obs-api at ${OBS_API}: ${e.message}`);
  process.exit(1);
}

const deadline = Date.now() + TIMEOUT_MS;
let result = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5_000));
  let st;
  try {
    const r = await fetch(`${OBS_API}/api/insights/rollup/status`, { signal: AbortSignal.timeout(15_000) });
    st = await r.json();
  } catch { continue; }
  if (st.inflight) continue;
  if (st.lastJob && st.lastJob.id === accepted.jobId) {
    if (st.lastJob.error) { err(`Roll-up failed: ${st.lastJob.error.message}`); process.exit(1); }
    result = st.lastJob.result;
    break;
  }
}
if (!result) { err(`Timed out waiting for job ${accepted.jobId}.`); process.exit(1); }

out('Subsystem buckets:');
for (const [b, n] of Object.entries(result.buckets || {}).sort((a, b2) => b2[1] - a[1])) {
  out(`  ${String(b).padEnd(24)} ${n}`);
}
out('');
out(`Roll-up groups:     ${result.groups}`);
if (PLAN_ONLY) {
  out(`Would archive:      ${result.wouldArchive}`);
  out(`Projected corpus:   ${result.projectedCorpus}`);
  out('');
  for (const g of (result.plan || []).slice(0, 12)) {
    out(`  [${g.bucket}] ${g.size} insights:`);
    for (const t of g.topics.slice(0, 6)) out(`     - ${t}`);
    if (g.topics.length > 6) out(`     … ${g.topics.length - 6} more`);
  }
  out('\nPlan only. Re-run without --plan for LLM synthesis.\n');
} else {
  out(`Parents synthesized: ${result.rolledUp}`);
  out(`Children archived:   ${result.archived}`);
  out(`Projected corpus:    ${result.projectedCorpus}`);
  out('');
  if (!APPLY) out('Dry run only. Re-run with --apply to write parents and archive children.\n');
}
