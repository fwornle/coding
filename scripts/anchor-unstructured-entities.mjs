#!/usr/bin/env node

/**
 * Enforce the structural-anchor invariant: every knowledge row carries at
 * least one STRUCTURAL edge (`contains` / `parent-child` / `has_insight` /
 * `includes`).
 *
 * WHY THIS IS THE RULE THAT MATTERS
 *
 * "Orphan" (degree 0) is the wrong metric for what an operator actually sees.
 * Provenance edges — `capturedBy` (13038) and `mentions` (11410) — are 89% of
 * this graph and are hidden by default in the viewer, because drawing them
 * makes the canvas unreadable. A row whose ONLY edges are provenance is
 * therefore connected in the data and a floating dot on screen. That gap is
 * why the header can honestly say "orphans 14" over a picture showing ~81
 * stranded nodes.
 *
 * Measured before this script first ran:
 *   Detail 314, Digest 140, Insight 65, SubComponent 8  = 527 unanchored
 *   of which 13 were true orphans and 514 were provenance-only.
 *
 * THE ANCHOR
 *
 * Every row knows its project (`metadata.project`), and every project is an
 * entity. Insights get `has_insight` — the same edge the consolidator already
 * writes for insights it mints — everything else gets `contains`. Both are
 * structural and drawn by default, so an anchored row can never strand under
 * default filters.
 *
 * Rows whose project does not resolve to a Project entity are REPORTED, not
 * invented: a wrong parent is worse than a visible gap.
 *
 * Usage:
 *   node scripts/anchor-unstructured-entities.mjs             # dry run
 *   node scripts/anchor-unstructured-entities.mjs --apply
 *   node scripts/anchor-unstructured-entities.mjs --check     # exit 1 if any
 *
 * `--check` is the guard: wire it into a health check and the invariant stops
 * silently rotting between releases.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Projects DECLARED in config/teams/*.json with kind:'project'. A declared
 * project that has no Project entity is a gap in the graph, not an unknown
 * owner — the consolidator already auto-creates these anchors (the `General`
 * Project entity says so in its own description). Creating one here follows
 * that precedent; inventing a parent for an UNDECLARED name would not, which
 * is why only declared names are eligible.
 */
function declaredProjects() {
  const dir = path.join(REPO, 'config/teams');
  const out = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'view-groups.json') continue;
    try {
      const cfg = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (cfg.kind === 'project' && cfg.team) out.set(String(cfg.team), cfg);
    } catch { /* a malformed team file must not stop the repair */ }
  }
  return out;
}
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
import {
  ANCHORED_CLASSES,
  auditStructuralAnchors,
  classOf,
  projectSlug,
  resolveProjectKey,
} from '../lib/knowledge/structural-anchors.mjs';

const out = (m = '') => process.stdout.write(`${m}\n`);

const get = async (path) => {
  const r = await fetch(`${OBS_API}${path}`, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return (await r.json()).data;
};

const entities = await get('/api/v1/entities?limit=10000');
const relations = await get('/api/v1/relations?limit=100000');

// ONE definition of a violation, shared with the health coordinator's
// graph_integrity slice — the guard and the repair must never disagree.
const audit = auditStructuralAnchors(entities, relations);
const unanchored = audit.rows.map((r) => entities.find((e) => e.id === r.id)).filter(Boolean);

const projectsByName = new Map();
for (const e of entities) {
  if (classOf(e) === 'Project') projectsByName.set(projectSlug(e.name), e);
}

out(`unanchored (no structural edge): ${audit.unanchored}`);
out(`  true orphans (degree 0)      : ${audit.orphans}`);
out(`  stranded (provenance only)   : ${audit.stranded}`);
out(`  by class: ${JSON.stringify(audit.byClass)}`);

if (CHECK) {
  out('');
  if (audit.unanchored === 0) { out('OK — structural-anchor invariant holds.'); process.exit(0); }
  out(`FAIL — ${audit.unanchored} row(s) carry no structural edge.`);
  process.exit(1);
}

const DECLARED = declaredProjects();
let written = 0; const unresolved = {}; const created = new Set();
for (const e of unanchored) {
  const projectName = resolveProjectKey(e);
  let project = projectsByName.get(projectSlug(projectName));
  if (!project) {
    // A DECLARED project with no entity: create the anchor, same as the
    // consolidator does for `general`.
    const declared = [...DECLARED.entries()]
      .find(([team]) => projectSlug(team) === projectSlug(projectName));
    if (!declared) {
      unresolved[String(projectName)] = (unresolved[String(projectName)] ?? 0) + 1;
      continue;
    }
    if (!APPLY) { created.add(declared[0]); written++; continue; }
    const body = {
      name: declared[0],
      entityType: 'Project',
      ontologyClass: 'Project',
      layer: 'evidence',
      description: declared[1].description
        || `Project anchor for the ${declared[0]} team — auto-created so its rows have a parent in the graph.`,
      metadata: { source: 'anchor-unstructured-entities', team: projectSlug(declared[0]) },
    };
    const cr = await fetch(`${OBS_API}/api/v1/entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
    if (!cr.ok) {
      out(`  FAILED to create Project ${declared[0]}: ${cr.status} ${(await cr.text()).slice(0, 140)}`);
      unresolved[String(projectName)] = (unresolved[String(projectName)] ?? 0) + 1;
      continue;
    }
    const createdEntity = (await cr.json()).data ?? (await Promise.resolve({})).data;
    const newId = createdEntity?.id ?? createdEntity?.entityId;
    if (!newId) {
      out(`  FAILED to read id of created Project ${declared[0]}`);
      unresolved[String(projectName)] = (unresolved[String(projectName)] ?? 0) + 1;
      continue;
    }
    project = { id: newId, name: declared[0] };
    projectsByName.set(projectSlug(declared[0]), project);
    created.add(declared[0]);
    out(`  created Project entity "${declared[0]}"`);
  }
  const type = classOf(e).endsWith('Insight') ? 'has_insight' : 'contains';
  if (!APPLY) { written++; continue; }
  const r = await fetch(`${OBS_API}/api/v1/relations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: project.id, to: e.id, type,
      metadata: { source: 'anchor-unstructured-entities', confidence: 1.0 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (r.ok) written++;
  else out(`  FAILED ${type} -> ${(e.name ?? '').slice(0, 40)}: ${r.status}`);
}

out('');
out(`${APPLY ? 'edges written' : 'edges that WOULD be written'}: ${written}`);
if (created.size > 0) out(`Project entities ${APPLY ? 'created' : 'that WOULD be created'}: ${[...created].join(', ')}`);
if (Object.keys(unresolved).length > 0) {
  out(`left alone — project does not resolve to an entity: ${JSON.stringify(unresolved)}`);
  out('  (a wrong parent is worse than a visible gap — fix the project entity, then re-run)');
}
if (!APPLY) out('\nDry run. Re-run with --apply.');
