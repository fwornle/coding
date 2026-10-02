#!/usr/bin/env node
/**
 * enrich-entity-sources — give entities the `metadata.sourceRefs[]` and
 * `metadata.occurrences[]` the viewer has always read and nothing ever wrote.
 *
 * WHY THESE ARRAYS ARE EMPTY. They are not damaged rows; they were never
 * populated. Measured 2026-09-27 across the live store: `sourceRefs` on 0 of
 * 2795 entities, `occurrences` on 0. Meanwhile `EntityDetailPanel` reads both
 * in five places — the Sources & Evidence section, Occurrence History, the
 * Timeline event list, the sub-tab visibility predicate, and the client
 * confidence heuristic — so every entity in the corpus renders "No sources." /
 * "No occurrences.", hides its Evolution and Timeline pills, and scores an
 * unmeasurable confidence. Same class of defect as the four the viewer
 * data-contract sweep fixed (a renderer reading a field no writer populates),
 * approached from the other side: here the RENDERER is right and the data is
 * missing.
 *
 * WHERE THE VALUES COME FROM. Both derivations are deterministic — no LLM, no
 * fuzzy matching, nothing inferred. Each one restates a fact the graph already
 * holds in a place the viewer reads.
 *
 *   sourceRefs[]   ← the entity's own insight document. 937 entities have a
 *                    document at knowledge-management/insights/<name>.md. The
 *                    panel already offers a "View Insight Document" button for
 *                    exactly these rows, gated on the same index — this records
 *                    the same fact IN the store, where an export or a query can
 *                    see it, instead of re-deriving it from the name at render
 *                    time. `addedAt` is the document's own mtime.
 *
 *   occurrences[]  ← incoming `mentions` / `capturedBy` edges, 738 entities.
 *                    An Insight that mentions this entity, or an Observation it
 *                    was captured by, IS an occurrence of it; the edge carries
 *                    the date the classifier assigned. `sourceEvidenceId` is
 *                    the source row's id, which is what the field name means.
 *
 * WHY `sourceRefs` GETS NOTHING FROM THE EDGES. The plan's table expected the
 * edge pass to yield both arrays. It cannot: a `sourceRef` renders as a LINK,
 * and the source rows have no resolvable URL — Observation `sourceFile` is the
 * literal string `live-etm`, and Insight rows carry no path of their own. The
 * repo has already ruled on this shape of question in CodeItTouches.tsx:14-19
 * ("A link that 404s is worse than text, so the path is text"), so the edge
 * pass writes `occurrences` only and the honest link stays absent.
 *
 * ⚠ EXACT NAME MATCH MEANS THE INDEX, NOT `existsSync`. macOS APFS is
 * case-insensitive by default, so `existsSync('…/insights/Rec.md')` returns
 * true for an entity named `rec` and the row would be handed a document that
 * is not its own. Membership in the document-name SET is case-sensitive
 * everywhere. It also matches how the viewer gates its own button
 * (`/api/insights/docs`), so the store and the UI agree by construction.
 * Cost of getting this wrong, measured: 12 entities (949 vs 937).
 *
 * ⚠ THE URL IS ORIGIN-RELATIVE, DELIBERATELY. `/api/insights/doc/<name>` and
 * not `http://localhost:12436/…`: the store is exported to
 * `.data/knowledge-graph/exports/general.json`, which is COMMITTED, so a host
 * and port written here becomes tracked data that is wrong on every other
 * machine — and an absolute path under /Users/<someone> would trip the
 * portability guard outright (km-core tests/unit/portable-paths.test.ts). The
 * viewer resolves a root-relative ref against `apiClient.base`, which is the
 * one place that knows where obs-api actually is.
 *
 * ⚠ OCCURRENCES ARE CAPPED AT 50. One entity has 974 incoming edges. The
 * reader slices at 50 (EntityDetailPanel:1166), the Timeline pushes one event
 * per occurrence, and the confidence heuristic saturates at 5 — so rows 51+
 * are invisible to every consumer while still being serialised into the whole
 * graph on every mutation. Newest first, which is the order the panel renders.
 * The true total is deliberately NOT stored beside it: a field no renderer
 * reads is the exact bug this script exists to undo.
 *
 * Usage:
 *   node scripts/enrich-entity-sources.mjs                 # dry run (default)
 *   node scripts/enrich-entity-sources.mjs --apply         # write
 *   node scripts/enrich-entity-sources.mjs --only=docs     # insight docs only
 *   node scripts/enrich-entity-sources.mjs --only=edges    # occurrences only
 *   node scripts/enrich-entity-sources.mjs --force         # ignore the marker
 *
 * Idempotent: a row carrying `metadata.sourceRefsBackfilledAt` is skipped
 * unless `--force`. Re-running after new edges arrive needs `--force`, which
 * recomputes both arrays from scratch rather than appending — the derivation is
 * a function of the graph, so recomputing is the only way to stay consistent
 * with it.
 *
 * obs-api owns the km-core store single-writer, so this goes over HTTP and must
 * NOT run while a wave-analysis run is in flight — both write these rows. The
 * script refuses to --apply if a run is active.
 *
 * The pure planner is exported and driven from two places: this CLI (over HTTP)
 * and obs-api's POST /api/v1/enrich/sources (in-process, against the store it
 * already holds open). One derivation, two drivers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Evidence type for an insight document — `mkdocs` renders as "Documentation". */
export const INSIGHT_DOC_EVIDENCE_TYPE = 'mkdocs';

/** Edge types that count as an occurrence of their target. */
export const OCCURRENCE_EDGE_TYPES = new Set(['mentions', 'capturedBy']);

/**
 * Most occurrences written per entity. The reader's own cap — see the header.
 */
export const OCCURRENCE_CAP = 50;

/** Marker fields, per the house idempotency convention. */
export const MARKER_AT = 'sourceRefsBackfilledAt';
export const MARKER_FROM = 'sourceRefsBackfilledFrom';

const edgeType = (r) => r?.type ?? r?.attributes?.type;
const edgeFrom = (r) => r?.from ?? r?.source;
const edgeTo = (r) => r?.to ?? r?.target;
const edgeMeta = (r) => r?.metadata ?? r?.attributes?.metadata ?? {};
const edgeCreatedAt = (r) => r?.createdAt ?? r?.attributes?.createdAt ?? '';

/**
 * The date an edge asserts about itself, in the order the writers set them.
 * `classifiedAt` is what the mentions classifier stamps; `anchoredAt` is what
 * the observation anchoring pass stamps; `createdAt` is Graphology's own and is
 * the empty string on the backfilled edges, hence last and filtered.
 */
export function edgeTimestamp(rel) {
  const md = edgeMeta(rel);
  for (const v of [md.classifiedAt, md.anchoredAt, md.backfilledAt, edgeCreatedAt(rel)]) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/**
 * Read the insight-document index off disk: name -> {url, addedAt}.
 *
 * Returns a Map keyed by the document's real name, so lookups are
 * case-sensitive regardless of what the filesystem would have tolerated.
 */
export function readInsightDocIndex(insightsDir) {
  const index = new Map();
  let names;
  try {
    names = fs.readdirSync(insightsDir);
  } catch {
    return index;                      // no directory — no refs, not an error
  }
  for (const file of names) {
    if (!file.endsWith('.md')) continue;
    const name = file.slice(0, -3);
    let addedAt = null;
    try {
      addedAt = fs.statSync(path.join(insightsDir, file)).mtime.toISOString();
    } catch {
      continue;                        // vanished between readdir and stat
    }
    index.set(name, {
      type: INSIGHT_DOC_EVIDENCE_TYPE,
      url: `/api/insights/doc/${encodeURIComponent(name)}`,
      addedAt,
    });
  }
  return index;
}

/**
 * Group occurrence-bearing edges by the entity they point AT.
 *
 * "Reversed" in the plan's sense: the edge runs evidence -> entity, and the
 * entity is the one that gains the occurrence.
 */
export function indexIncomingEvidence(relations) {
  const byTarget = new Map();
  for (const rel of relations) {
    if (!OCCURRENCE_EDGE_TYPES.has(edgeType(rel))) continue;
    const target = edgeTo(rel);
    const source = edgeFrom(rel);
    if (!target || !source || target === source) continue;
    const timestamp = edgeTimestamp(rel);
    if (!timestamp) continue;          // undateable — nothing honest to render
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push({ timestamp, sourceEvidenceId: source });
  }
  // Newest first, capped. Sorting before the cap is what makes the cap mean
  // "the 50 most recent" rather than "whichever 50 the export happened to
  // list first".
  for (const [target, occ] of byTarget) {
    occ.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
    byTarget.set(target, occ.slice(0, OCCURRENCE_CAP));
  }
  return byTarget;
}

/**
 * What this entity should gain, or null when it should be left alone.
 *
 * Pure: every input is passed in. Returns the additions only — the caller
 * merges them onto the FULL existing metadata (see applyEnrichment).
 */
export function planEntity(entity, { docIndex, incoming, only = 'both', force = false }) {
  const md = entity?.metadata ?? {};
  if (!force && typeof md[MARKER_AT] === 'string' && md[MARKER_AT].length > 0) {
    return null;                       // already enriched
  }

  const wantDocs = only === 'both' || only === 'docs';
  const wantEdges = only === 'both' || only === 'edges';

  const docRef = wantDocs ? docIndex.get(entity?.name) : undefined;
  const occurrences = wantEdges ? incoming.get(entity?.id) : undefined;

  const additions = {};
  const from = [];
  if (docRef && !hasRef(md.sourceRefs, docRef.url)) {
    additions.sourceRefs = [...asArray(md.sourceRefs), docRef];
    from.push('insight-document');
  }
  if (occurrences && occurrences.length > 0 && asArray(md.occurrences).length === 0) {
    additions.occurrences = occurrences;
    from.push('evidence-edge');
  }
  if (from.length === 0) return null;

  return { additions, from };
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const hasRef = (refs, url) =>
  asArray(refs).some((r) => r && typeof r === 'object' && r.url === url);

/**
 * The FULL metadata object to write.
 *
 * Deliberately full: the PUT lands in km-core's `mergeNodeAttributes`, a
 * SHALLOW merge, so handing it a partial `metadata` REPLACES the stored one and
 * erases everything else on the row. That is not hypothetical — it is what
 * wave 4's insight stamp did to `parentEntityName` on 181 rows
 * (scripts/backfill-parent-metadata.mjs documents the incident).
 */
export function mergeEnrichment(existingMetadata, plan, now = new Date().toISOString()) {
  return {
    ...(existingMetadata ?? {}),
    ...plan.additions,
    [MARKER_AT]: now,
    [MARKER_FROM]: plan.from.join('+'),
  };
}

/**
 * Build the whole plan. `entities` and `relations` are the wire shapes; the
 * result is ordered for a stable report.
 */
export function buildEnrichmentPlan({ entities, relations, docIndex, only = 'both', force = false }) {
  const incoming = indexIncomingEvidence(relations);
  const planned = [];
  const counts = { docsOnly: 0, edgesOnly: 0, both: 0, skippedMarker: 0, noSource: 0 };

  for (const entity of entities) {
    const md = entity?.metadata ?? {};
    const marked = typeof md[MARKER_AT] === 'string' && md[MARKER_AT].length > 0;
    const plan = planEntity(entity, { docIndex, incoming, only, force });
    if (!plan) {
      if (marked && !force) counts.skippedMarker++;
      else counts.noSource++;
      continue;
    }
    const hasDoc = 'sourceRefs' in plan.additions;
    const hasOcc = 'occurrences' in plan.additions;
    if (hasDoc && hasOcc) counts.both++;
    else if (hasDoc) counts.docsOnly++;
    else counts.edgesOnly++;
    planned.push({ entity, ...plan });
  }

  planned.sort((a, b) => String(a.entity.name).localeCompare(String(b.entity.name)));
  return { planned, counts, incoming };
}

/**
 * Apply a plan through a caller-supplied writer.
 *
 * `write(id, metadata)` is the seam: the CLI PUTs over HTTP, obs-api calls
 * `mergeAttributes` on the store it already holds. Neither driver needs to know
 * how the other reaches the graph.
 */
export async function applyEnrichment(planned, write, { onEach } = {}) {
  let written = 0;
  const failures = [];
  for (const item of planned) {
    const next = mergeEnrichment(item.entity.metadata, item);
    try {
      await write(item.entity.id, next);
      written++;
    } catch (err) {
      failures.push({ id: item.entity.id, name: item.entity.name, error: err?.message ?? String(err) });
    }
    if (onEach) onEach(item, written, failures.length);
  }
  return { written, failures };
}

// ── CLI driver ───────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (m = '') => process.stdout.write(`${m}\n`);

function parseArgs(argv) {
  const only = (argv.find((a) => a.startsWith('--only=')) ?? '').slice('--only='.length) || 'both';
  if (!['both', 'docs', 'edges'].includes(only)) {
    throw new Error(`--only must be both|docs|edges, got "${only}"`);
  }
  return {
    apply: argv.includes('--apply'),
    force: argv.includes('--force'),
    only,
    obsApi: process.env.OBS_API_URL || 'http://localhost:12436',
    insightsDir: path.join(REPO_ROOT, 'knowledge-management', 'insights'),
  };
}

async function getJson(base, route) {
  const r = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`GET ${route} -> ${r.status}`);
  return (await r.json()).data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.apply) {
    try {
      const st = await getJson(args.obsApi, '/api/workflows/wave-analysis/status');
      // activeWorkflow, not running: every UKB workflow writes these rows, and
      // `running` only answers for wave-analysis itself.
      if (st?.running || st?.activeWorkflow) {
        out(`REFUSING to apply: a ${st.activeWorkflow?.workflow || 'wave-analysis'} run is in flight.`);
        out('It writes these same rows; wait for it to finish, then re-run.');
        process.exit(2);
      }
    } catch {
      out('WARNING: could not read wave-analysis status; proceeding.');
    }
  }

  const docIndex = readInsightDocIndex(args.insightsDir);
  const entities = await getJson(args.obsApi, '/api/v1/entities?limit=10000');
  const relations = await getJson(args.obsApi, '/api/v1/relations?limit=100000');

  const { planned, counts } = buildEnrichmentPlan({
    entities,
    relations,
    docIndex,
    only: args.only,
    force: args.force,
  });

  out(`insight documents on disk        : ${docIndex.size}`);
  out(`entities read                    : ${entities.length}`);
  out(`relations read                   : ${relations.length}`);
  out(`scope                            : --only=${args.only}${args.force ? ' --force' : ''}`);
  out('');
  out(`  sourceRefs only (insight doc)  : ${counts.docsOnly}`);
  out(`  occurrences only (edges)       : ${counts.edgesOnly}`);
  out(`  both                           : ${counts.both}`);
  out(`  already enriched (marker)      : ${counts.skippedMarker}${args.force ? '' : '  (use --force to recompute)'}`);
  out(`  nothing derivable              : ${counts.noSource}`);
  out('');

  if (planned.length === 0) {
    out('Nothing to do.');
    return;
  }

  out(`${'entity'.padEnd(38)} ${'class'.padEnd(13)} ${'refs'.padStart(4)} ${'occ'.padStart(4)}  from`);
  out(`${'-'.repeat(38)} ${'-'.repeat(13)} ${'-'.repeat(4)} ${'-'.repeat(4)}  ${'-'.repeat(24)}`);
  for (const item of planned.slice(0, 40)) {
    const e = item.entity;
    const cls = e.ontologyClass ?? e.entityType ?? '';
    const refs = asArray(item.additions.sourceRefs).length;
    const occ = asArray(item.additions.occurrences).length;
    out(
      `${String(e.name).padEnd(38).slice(0, 38)} ${String(cls).padEnd(13).slice(0, 13)} ` +
      `${String(refs || '').padStart(4)} ${String(occ || '').padStart(4)}  ${item.from.join('+')}`,
    );
  }
  if (planned.length > 40) out(`… and ${planned.length - 40} more`);
  out('');

  if (!args.apply) {
    out(`Dry run — would enrich ${planned.length} entities. Re-run with --apply.`);
    return;
  }

  const write = async (id, metadata) => {
    const r = await fetch(`${args.obsApi}/api/v1/entities/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 140)}`);
  };

  const started = Date.now();
  const { written, failures } = await applyEnrichment(planned, write, {
    onEach: (_item, done) => {
      if (done % 100 === 0) out(`  … ${done}/${planned.length}`);
    },
  });

  out('');
  out(`enriched: ${written}/${planned.length} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (failures.length > 0) {
    out(`failed: ${failures.length}`);
    for (const f of failures.slice(0, 10)) out(`  - ${f.name}: ${f.error}`);
    if (failures.length > 10) out(`  … and ${failures.length - 10} more`);
    process.exitCode = 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (thisFile === invokedFile) {
  main().catch((err) => {
    process.stderr.write(`[enrich-entity-sources] FATAL: ${err?.stack ?? err?.message ?? String(err)}\n`);
    process.exit(3);
  });
}
