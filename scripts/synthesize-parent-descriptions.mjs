#!/usr/bin/env node
/**
 * synthesize-parent-descriptions.mjs — stage 5, run on demand.
 *
 * Gives every hierarchy parent a description synthesised FROM ITS CHILDREN.
 *
 * WHAT IT FIXES. `wave-controller.ts:1233` assigns a parent's description from
 * `entity.observations[0]` — one arbitrary child's text, verbatim. So the
 * KnowledgeManagement component is described by a paragraph about the
 * GraphifyGraph reader, and moving UP the tree returns a detail rather than a
 * summary. The pass this triggers replaces that with a real aggregation and
 * REFUSES to write a description that is a verbatim copy of a child.
 *
 * THIN CLIENT — km-core's LevelDB is single-owner and obs-api holds it, so the
 * work runs in-process there. This only POSTs and polls.
 *
 * DRY RUN BY DEFAULT, like compaction and the insight backfill.
 *
 * Budget, measured on the live graph before any of this was built:
 *   full pass   282 parents -> 338 calls (16 need chunking), ~3.3M tokens
 *   --dirty     ~22 parents/day, which is what the scheduled pass inside
 *               obs-api runs every 6h (capped at 25/tick)
 * Routed as `consolidator-rollup`, pinned to `small` in llm-routing.yaml so a
 * whole-graph pass cannot escalate band silently.
 *
 * Usage:
 *   node scripts/synthesize-parent-descriptions.mjs                 # dry run, all parents
 *   node scripts/synthesize-parent-descriptions.mjs --dirty         # only changed parents
 *   node scripts/synthesize-parent-descriptions.mjs --limit=5       # smoke test
 *   node scripts/synthesize-parent-descriptions.mjs --apply         # write
 *   node scripts/synthesize-parent-descriptions.mjs --classes=Component,SubComponent
 */

const OBS_API = process.env.OBS_API_URL || 'http://127.0.0.1:12436';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const APPLY = args.apply === true || args.apply === 'true';
const DIRTY = args.dirty === true || args.dirty === 'true';
const LIMIT = Number(args.limit) > 0 ? Number(args.limit) : 0;
const CLASSES = typeof args.classes === 'string' ? args.classes.split(',').map((s) => s.trim()) : null;

const out = (m = '') => process.stdout.write(`${m}\n`);
const die = (m) => { process.stderr.write(`${m}\n`); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

out('\n=== parent description synthesis (stage 5) ===');
out(`obs-api : ${OBS_API}`);
out(`mode    : ${APPLY ? 'APPLY — rewrites parent descriptions' : 'DRY RUN — writes nothing'}`);
out(`scope   : ${DIRTY ? 'changed parents only' : 'every parent with children'}` +
    `${LIMIT ? ` · first ${LIMIT}` : ''}${CLASSES ? ` · ${CLASSES.join(', ')}` : ''}\n`);

let started;
try {
  const res = await fetch(`${OBS_API}/api/insights/parent-synthesis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dryRun: !APPLY,
      onlyDirty: DIRTY,
      ...(LIMIT ? { limit: LIMIT } : {}),
      ...(CLASSES ? { classes: CLASSES } : {}),
    }),
  });
  if (res.status === 409) die(`refused: ${(await res.json()).error}`);
  if (!res.ok) throw new Error(`POST -> ${res.status}`);
  started = await res.json();
  out(`accepted: job ${started.jobId}${started.attached ? ' (attached to a run already in flight)' : ''}`);
} catch (e) {
  die(`cannot start: ${e.message}\nIs obs-api running? curl ${OBS_API}/health`);
}

// The run is fire-and-forget server-side (a full pass is minutes of LLM time),
// so poll the status endpoint rather than holding the request open.
out('waiting… (synthesis is one LLM call per parent, plus a reduce for large ones)\n');
let last = null;
for (;;) {
  await sleep(5000);
  let st;
  try {
    st = await (await fetch(`${OBS_API}/api/insights/parent-synthesis/status`)).json();
  } catch { continue; }
  if (st.inflight) {
    if (st.inflight.startedAt !== last) { last = st.inflight.startedAt; out(`  running since ${last}`); }
    continue;
  }
  if (st.lastJob?.error) die(`\nfailed: ${st.lastJob.error.message}`);
  const r = st.lastJob?.result;
  if (!r) { out('  no result recorded'); break; }
  out('\n=== result ===\n');
  out(`  parents with children : ${r.candidates}`);
  out(`  selected              : ${r.selected}`);
  out(`  synthesised           : ${r.synthesised}`);
  out(`  refused (verbatim)    : ${r.verbatimBlocked}   <- the bug this stage exists to fix`);
  out(`  skipped (too short)   : ${r.skipped}`);
  out(`  failed                : ${r.failed}`);
  out(`  LLM calls             : ${r.calls}`);
  out(`  dry run               : ${r.dryRun}`);
  if (r.dryRun) out('\nDRY RUN — nothing written. Re-run with --apply.\n');
  else out('\nWritten. Parent descriptions now summarise their children.\n');
  break;
}
