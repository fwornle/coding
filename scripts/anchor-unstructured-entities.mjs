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
 * A row that declares its parent (`metadata.parentEntityName`) and whose
 * parent exists is anchored THERE, with `contains` — that is its place in the
 * hierarchy, and hanging it straight under its Project would flatten it (a
 * Detail of ObservationPipeline is not a child of Coding). 68 hierarchy rows
 * carried a parent name with no edge from that parent (2026-10-04), written
 * since March by UKB and by hand; the viewer anchors along edges only, so they
 * floated as "unanchored". Ambiguous names (two entities) prefer the row's own
 * project; still ambiguous = fall through.
 *
 * Otherwise: every row knows its project (`metadata.project`), and every project is an
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
// Opt-in. `--check` keeps its exact meaning (edge invariant only) so anything
// already wired to it cannot start failing because a SECOND invariant shipped.
const CHECK_PARENTS = process.argv.includes('--check-parents');
import {
  ANCHORED_CLASSES,
  auditStructuralAnchors,
  auditParentMetadata,
  auditParentEdges,
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
// The parent-METADATA invariant, from the same shared module for the same
// reason: the guard and the coordinator must not drift apart.
const parents = auditParentMetadata(entities);
// Third invariant: the declared parent exists → there is an edge from it.
const parentEdges = auditParentEdges(entities, relations);
const unanchored = audit.rows.map((r) => entities.find((e) => e.id === r.id)).filter(Boolean);

const projectsByName = new Map();
for (const e of entities) {
  if (classOf(e) === 'Project') projectsByName.set(projectSlug(e.name), e);
}

out(`unanchored (no structural edge): ${audit.unanchored}`);
out(`  true orphans (degree 0)      : ${audit.orphans}`);
out(`  stranded (provenance only)   : ${audit.stranded}`);
out(`  by class: ${JSON.stringify(audit.byClass)}`);
out(`missing parent metadata        : ${parents.missingParent}`);
out(`parent names nothing in graph  : ${parents.danglingParent}`);
out(`  of checked                   : ${parents.checked}`);
out(`  by class: ${JSON.stringify(parents.byClass)}`);
out(`no edge from its declared parent: ${parentEdges.unlinked}`);
out(`  of checked                   : ${parentEdges.checked}`);

if (CHECK) {
  out('');
  const parentViolations = parents.missingParent + parents.danglingParent;
  const parentFails = CHECK_PARENTS && parentViolations > 0;
  if (audit.unanchored === 0 && parentEdges.unlinked === 0 && !parentFails) {
    out('OK — structural-anchor invariant holds.');
    out('OK — every row with an existing declared parent has an edge from it.');
    if (CHECK_PARENTS) out('OK — parent-metadata invariant holds.');
    process.exit(0);
  }
  if (audit.unanchored > 0) out(`FAIL — ${audit.unanchored} row(s) carry no structural edge.`);
  if (parentEdges.unlinked > 0) out(`FAIL — ${parentEdges.unlinked} row(s) have no edge from their declared parent.`);
  if (parentFails) {
    out(`FAIL — ${parents.missingParent} row(s) without metadata.parentEntityName, `
      + `${parents.danglingParent} naming a parent that is not in the graph.`);
  }
  process.exit(1);
}

const DECLARED = declaredProjects();
let written = 0; const unresolved = {}; const created = new Set();
const byName = new Map();
for (const x of entities) {
  if (!byName.has(x.name)) byName.set(x.name, []);
  byName.get(x.name).push(x);
}
const CONTAINERS = new Set(['Project', 'System', 'Component', 'SubComponent']);
/**
 * The row's declared parent, if it exists and is unambiguous. Several nodes by
 * that name: a container class (a SubComponent, not an older Detail namesake),
 * then the row's own project. Two rows naming EACH OTHER as parent is a cycle
 * in the data — no edge is right, so it is reported, not written.
 */
function declaredParent(e) {
  const name = e.metadata?.parentEntityName;
  let hits = ((name && byName.get(name)) || []).filter((h) => h.id !== e.id);
  if (hits.length > 1) {
    const containers = hits.filter((h) => CONTAINERS.has(classOf(h)));
    if (containers.length) hits = containers;
  }
  if (hits.length > 1) {
    hits = hits.filter((h) => projectSlug(resolveProjectKey(h)) === projectSlug(resolveProjectKey(e)));
  }
  if (hits.length !== 1) return null;
  if (hits[0].metadata?.parentEntityName === e.name) {
    cycles.add([e.name, hits[0].name].sort().join(' <-> '));
    return null;
  }
  return hits[0];
}
const cycles = new Set();
let toParent = 0;
for (const e of unanchored) {
  const parent = declaredParent(e);
  if (parent && parent.id !== e.id) {
    toParent++;
    if (!APPLY) { written++; continue; }
    const r = await fetch(`${OBS_API}/api/v1/relations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: parent.id, to: e.id, type: 'contains',
        metadata: { source: 'anchor-unstructured-entities', anchor: 'declared-parent', confidence: 1.0 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (r.ok) written++;
    else out(`  FAILED contains ${parent.name} -> ${(e.name ?? '').slice(0, 40)}: ${r.status}`);
    continue;
  }
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

    // Link the new Project UP to the System root. Anchoring its children to it
    // is only half the job: a Project with children but no parent is itself
    // unattached, and in any view that hides its children (the condensed
    // roll-up view hid all nine of UI's) it renders as a floating node. 19 of
    // the 20 Projects already hang off CollectiveKnowledge; the one created
    // without this edge was the exception, and it showed.
    const systemRoot = entities.find((x) => classOf(x) === 'System');
    if (systemRoot) {
      const sr = await fetch(`${OBS_API}/api/v1/relations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: systemRoot.id, to: newId, type: 'parent-child',
          metadata: { source: 'anchor-unstructured-entities', confidence: 1.0 },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      out(sr.ok
        ? `  created Project entity "${declared[0]}" and linked it to ${systemRoot.name}`
        : `  created Project entity "${declared[0]}" but FAILED to link it to the System root: ${sr.status}`);
    } else {
      out(`  created Project entity "${declared[0]}" — no System root found to link it to`);
    }
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

// Second pass — rows that HAVE a structural edge, just not from their declared
// parent (an insight's has_insight, a mentions-promoted contains). The audit
// above counts them anchored; the viewer walks parent edges up to a Project
// and finds none, so they still float. Same declared-parent rule.
// The work list IS the guard's (auditParentEdges), so repair and check agree.
const firstPass = new Set(unanchored.map((e) => e.id));
const byId = new Map(entities.map((x) => [x.id, x]));
let reparented = 0;
for (const row of auditParentEdges(entities, relations).rows) {
  const e = byId.get(row.id);
  if (!e || firstPass.has(e.id)) continue;
  const parent = declaredParent(e);
  if (!parent) continue;
  reparented++;
  if (!APPLY) continue;
  const r = await fetch(`${OBS_API}/api/v1/relations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: parent.id, to: e.id, type: 'contains',
      metadata: { source: 'anchor-unstructured-entities', anchor: 'declared-parent', confidence: 1.0 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) { reparented--; out(`  FAILED contains ${parent.name} -> ${(e.name ?? '').slice(0, 40)}: ${r.status}`); }
}

out('');
out(`${APPLY ? 'edges written' : 'edges that WOULD be written'}: ${written} (${toParent} to the declared parent, the rest to the project)`);
out(`${APPLY ? 'parent edges written' : 'parent edges that WOULD be written'} for anchored rows missing theirs: ${reparented}`);
if (cycles.size) out(`left alone — rows naming each other as parent (fix the metadata): ${[...cycles].join('; ')}`);
if (created.size > 0) out(`Project entities ${APPLY ? 'created' : 'that WOULD be created'}: ${[...created].join(', ')}`);
if (Object.keys(unresolved).length > 0) {
  out(`left alone — project does not resolve to an entity: ${JSON.stringify(unresolved)}`);
  out('  (a wrong parent is worse than a visible gap — fix the project entity, then re-run)');
}
if (!APPLY) out('\nDry run. Re-run with --apply.');
