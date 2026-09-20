#!/usr/bin/env node
/**
 * delete-dangling-relations — remove edges whose source or target entity no
 * longer exists in the graph.
 *
 * WHY THIS EXISTS. `DELETE /api/v1/entities/:id` does NOT cascade to that
 * entity's edges. Deleting 128 stub entities on 2026-09-20 therefore left ~256
 * edges pointing at ids that resolve to nothing, and the viewer's graph build
 * stalls on them — the canvas sits at "Connecting…" with every counter blank,
 * which looks exactly like an API outage and is not one.
 *
 * A handful of dangling edges predate that deletion (TieredConfigLoader had two
 * whose source was already gone), so this is a general repair, not a one-shot
 * undo. An edge to a node that does not exist carries no meaning in either
 * direction; removing it loses nothing.
 *
 * Callers that delete entities should remove the edges themselves — see
 * delete-wave-insight-stubs.mjs, which now does. This script cleans up what was
 * already orphaned.
 *
 * Usage:
 *   node scripts/delete-dangling-relations.mjs            # dry run (default)
 *   node scripts/delete-dangling-relations.mjs --apply    # delete
 */

const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';
const APPLY = process.argv.includes('--apply');

const out = (m = '') => process.stdout.write(`${m}\n`);

const get = async (p) => {
  const r = await fetch(`${OBS_API}${p}`, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`);
  return (await r.json()).data;
};

const entities = await get('/api/v1/entities?limit=1000000');
const relations = await get('/api/v1/relations?limit=200000');

const ids = new Set(entities.map((e) => e.id));
const edgeFrom = (r) => r.from ?? r.source;
const edgeTo = (r) => r.to ?? r.target;

const dangling = relations.filter((r) => !ids.has(edgeFrom(r)) || !ids.has(edgeTo(r)));

out(`entities: ${entities.length}   relations: ${relations.length}`);
out(`dangling (missing endpoint): ${dangling.length}`);
out('');

if (dangling.length === 0) { out('Nothing to do.'); process.exit(0); }

const byType = {};
for (const r of dangling) {
  const t = r.type ?? r.attributes?.type ?? '(untyped)';
  byType[t] = (byType[t] ?? 0) + 1;
}
out(`by edge type: ${JSON.stringify(byType)}`);
out('');

if (!APPLY) { out('Dry run. Re-run with --apply.'); process.exit(0); }

let deleted = 0;
let failed = 0;
for (const r of dangling) {
  if (!r.key) { failed += 1; continue; }
  const res = await fetch(`${OBS_API}/api/v1/relations/${encodeURIComponent(r.key)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    if (failed < 3) out(`  FAILED ${r.key} -> ${res.status} ${(await res.text()).slice(0, 120)}`);
    failed += 1;
    continue;
  }
  deleted += 1;
}

out(`deleted: ${deleted}${failed ? `, failed: ${failed}` : ''}`);
const stats = await get('/api/v1/stats');
out(`nodes now: ${stats.nodeCount}, edges: ${stats.edgeCount}, orphans: ${stats.orphanCount}`);
