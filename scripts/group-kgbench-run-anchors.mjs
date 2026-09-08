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
 *   3. moves its `includes` edge from CollectiveKnowledge to `Kgbench -contains->`.
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

/** The graphology edge key the DELETE route takes. */
const edgeKey = (from, to, type) => `${from}|${to}|${type}`;

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

  // ---- 3. re-home each run anchor ----------------------------------------
  let reclassified = 0;
  let moved = 0;

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

    // Drop the edge that made it a top-level project.
    for (const r of relations) {
      if (r.target !== anchor.id) continue;
      if (r.source !== systemRoot.id) continue;
      const type = r.attributes?.type;
      if (type !== 'includes' && type !== 'parent-child') continue;
      const key = r.key ?? edgeKey(r.source, r.target, type);
      try {
        await api(`/api/v1/relations/${encodeURIComponent(key)}`, { method: 'DELETE' });
      } catch (err) {
        // Already gone on a re-run — not a failure.
        log(`  (edge ${key} not dropped: ${err.message})`);
      }
    }

    await api('/api/v1/relations', {
      method: 'POST',
      body: JSON.stringify({
        from: parent.id,
        to: anchor.id,
        relationType: 'contains',
        metadata: { source: 'group-kgbench-run-anchors' },
      }),
    });
    moved++;
    log(`re-homed ${anchor.name} (${team})`);
  }

  if (APPLY) {
    log(`DONE: reclassified ${reclassified}, re-homed ${moved}`);
    const stats = await api('/api/v1/stats');
    log(`km-core now: nodes=${stats.nodeCount} edges=${stats.edgeCount} orphans=${stats.orphanCount}`);
  } else {
    log(`DRY RUN complete — ${anchors.length} anchor(s) would move. Re-run with --apply.`);
  }
}

main().catch((err) => {
  log(`FATAL: ${err.stack}`);
  process.exit(1);
});
