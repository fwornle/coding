#!/usr/bin/env node
/**
 * Put the kgbench benchmark-run anchors under one `Kgbench` node.
 *
 * THE PROBLEM
 *
 * kgbench sandboxes each run in its own git worktree under a temp directory
 * (`lib/kgbench/sandbox.mjs` — `mkdtemp(..., 'kgbench-tree-')`). Agents running
 * inside it have that directory as their cwd, so every observation they write
 * is attributed to a team named after it: `kgbench-tree-hOMRUf`, and a fresh one
 * per run. The observation consolidator then mints a Project anchor per team,
 * and CollectiveKnowledge `includes` it — so eleven benchmark runs show up in
 * the viewer as eleven top-level PROJECTS, beside Coding and Normalisa.
 *
 * They are not projects. They are runs of the measurement harness.
 *
 * WHAT THIS DOES
 *
 *   1. ensures one `Kgbench` Project, included by CollectiveKnowledge;
 *   2. reclassifies each run anchor Project -> Component;
 *   3. adds `Kgbench -contains-> anchor`;
 *   4. sweeps the `CollectiveKnowledge -includes-> anchor` edges that used to
 *      make them top-level projects.
 *
 * Step 4 is a SEPARATE pass over every child of Kgbench, not a tail of step 2.
 * The two go out of sync: an anchor already reclassified by an earlier run has
 * nothing to do in step 2, but may still carry the stale root edge — which is
 * exactly the state this repo was left in when DELETE /api/v1/relations/:key
 * could not address those edges (fixed in km-core 2026-09-08: findRelations now
 * emits the real graphology key rather than a synthetic one).
 *
 * The viewer's hierarchy reads those edges (integrations/unified-viewer/src/
 * graph/hierarchy-parents.ts), so the eleven rows become one expandable node.
 *
 * IDEMPOTENT AND MEANT TO BE RE-RUN. This does not change the minting path — the
 * next kgbench run will create another anchor exactly as before. Re-running folds
 * it in. That is the deliberate trade: the consolidator's attribution is correct
 * (the work really did happen in that tree), it is only the PLACEMENT that was
 * wrong, and placement is cheap to redo.
 *
 * USAGE
 *   node scripts/group-kgbench-run-anchors.mjs            # dry run (default)
 *   node scripts/group-kgbench-run-anchors.mjs --apply
 *
 * Env: OBS_API_BASE (default http://localhost:12436)
 */

import process from 'node:process';

const KM = process.env.OBS_API_BASE || 'http://localhost:12436';
const APPLY = process.argv.includes('--apply');

/** Team ids that denote a benchmark run tree, not a project. */
export const RUN_TEAM_RE = /^kgbench-tree-/i;

/** The node the run anchors are collected under. */
export const PARENT_NAME = 'Kgbench';
const PARENT_TEAM = 'kgbench';
const SYSTEM_ROOT = 'CollectiveKnowledge';

function log(msg) {
  process.stderr.write(`[kgbench-group] ${msg}\n`);
}

async function api(path, init) {
  const res = await fetch(`${KM}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} → HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  return body?.data ?? body;
}

const teamOf = (e) => (e?.metadata ?? {}).team ?? null;

/** Edge types that would place a node at the top of the hierarchy. */
const ROOT_EDGE_TYPES = new Set(['includes', 'parent-child']);

async function main() {
  if (!APPLY) log('DRY RUN — pass --apply to write. Nothing below is executed.');

  const entities = await api('/api/v1/entities?limit=20000');
  const relations = await api('/api/v1/relations?limit=60000');

  const systemRoot = entities.find((e) => e.name === SYSTEM_ROOT);
  if (!systemRoot) throw new Error(`no ${SYSTEM_ROOT} node — cannot anchor ${PARENT_NAME}`);

  const anchors = entities.filter(
    (e) => e.entityType === 'Project' && RUN_TEAM_RE.test(teamOf(e) ?? ''),
  );
  log(`run anchors still classified as Project: ${anchors.length}`);

  // ---- 1. the Kgbench node ------------------------------------------------
  let parent = entities.find((e) => e.name === PARENT_NAME && e.entityType === 'Project');
  if (parent) {
    log(`${PARENT_NAME} exists: ${parent.id}`);
  } else if (!APPLY) {
    log(`would CREATE ${PARENT_NAME} (Project, team=${PARENT_TEAM})`);
  } else {
    parent = await api('/api/v1/entities', {
      method: 'POST',
      body: JSON.stringify({
        name: PARENT_NAME,
        entityType: 'Project',
        ontologyClass: 'Project',
        layer: 'evidence',
        description:
          'Registry of kgbench benchmark runs. Each child is one run tree — a git '
          + 'worktree kgbench sandboxes the corpus in, whose directory name became a '
          + 'team id and therefore an anchor. They are runs of the measurement '
          + 'harness, not projects, and hang here rather than beside Coding.',
        metadata: {
          team: PARENT_TEAM,
          subsystem: 'kgbench',
          source: 'group-kgbench-run-anchors',
        },
      }),
    });
    log(`created ${PARENT_NAME}: ${parent.id}`);
  }

  // ---- 2. CollectiveKnowledge -includes-> Kgbench -------------------------
  const parentId = parent?.id ?? '<new>';
  const hasRootEdge = relations.some(
    (r) => r.source === systemRoot.id && r.target === parentId && r.attributes?.type === 'includes',
  );
  if (hasRootEdge) {
    log(`${SYSTEM_ROOT} -includes-> ${PARENT_NAME} already present`);
  } else if (!APPLY) {
    log(`would LINK ${SYSTEM_ROOT} -includes-> ${PARENT_NAME}`);
  } else {
    await api('/api/v1/relations', {
      method: 'POST',
      body: JSON.stringify({
        from: systemRoot.id,
        to: parent.id,
        relationType: 'includes',
        metadata: { source: 'group-kgbench-run-anchors' },
      }),
    });
    log(`linked ${SYSTEM_ROOT} -includes-> ${PARENT_NAME}`);
  }

  // ---- 3. reclassify + attach ---------------------------------------------
  let reclassified = 0;

  for (const anchor of anchors) {
    const team = teamOf(anchor);

    if (!APPLY) {
      log(`would RE-HOME ${anchor.name} (${team}): Project→Component, under ${PARENT_NAME}`);
      continue;
    }

    // PUT is a SHALLOW merge (km-core mergeAttributes) — send the whole
    // metadata object or the provenance block on it is dropped.
    await api(`/api/v1/entities/${encodeURIComponent(anchor.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        entityType: 'Component',
        ontologyClass: 'Component',
        metadata: {
          ...(anchor.metadata ?? {}),
          regroupedBy: 'group-kgbench-run-anchors',
          regroupedUnder: PARENT_NAME,
        },
      }),
    });
    reclassified++;

    const alreadyAttached = relations.some(
      (r) => r.source === parent.id && r.target === anchor.id && r.attributes?.type === 'contains',
    );
    if (!alreadyAttached) {
      await api('/api/v1/relations', {
        method: 'POST',
        body: JSON.stringify({
          from: parent.id,
          to: anchor.id,
          relationType: 'contains',
          metadata: { source: 'group-kgbench-run-anchors' },
        }),
      });
    }
    log(`re-homed ${anchor.name} (${team})`);
  }

  // ---- 4. sweep the stale root edges --------------------------------------
  //
  // Every current child of Kgbench, not just the ones step 3 touched: an anchor
  // reclassified by an earlier run still carries the edge that made it a
  // top-level project, and while the hierarchy picks the better parent anyway,
  // the graph canvas draws both.
  const childIds = new Set(
    relations
      .filter((r) => r.source === parent?.id && r.attributes?.type === 'contains')
      .map((r) => r.target),
  );
  for (const a of anchors) childIds.add(a.id);

  const stale = relations.filter(
    (r) =>
      r.source === systemRoot.id
      && childIds.has(r.target)
      && ROOT_EDGE_TYPES.has(r.attributes?.type),
  );

  let dropped = 0;
  for (const r of stale) {
    const name = (entities.find((e) => e.id === r.target) ?? {}).name ?? r.target;
    if (!APPLY) {
      log(`would DROP ${SYSTEM_ROOT} -${r.attributes.type}-> ${name}`);
      continue;
    }
    try {
      await api(`/api/v1/relations/${encodeURIComponent(r.key)}`, { method: 'DELETE' });
      dropped++;
      log(`dropped ${SYSTEM_ROOT} -${r.attributes.type}-> ${name}`);
    } catch (err) {
      // Already gone on a re-run — not a failure.
      log(`  (edge ${r.key} not dropped: ${err.message})`);
    }
  }

  if (APPLY) {
    log(`DONE: reclassified ${reclassified}, stale root edges dropped ${dropped}`);
    const stats = await api('/api/v1/stats');
    log(`km-core now: nodes=${stats.nodeCount} edges=${stats.edgeCount} orphans=${stats.orphanCount}`);
  } else {
    log(
      `DRY RUN complete — ${anchors.length} anchor(s) would move, `
      + `${stale.length} stale edge(s) would drop. Re-run with --apply.`,
    );
  }
}

main().catch((err) => {
  log(`FATAL: ${err.stack}`);
  process.exit(1);
});
