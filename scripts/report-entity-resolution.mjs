#!/usr/bin/env node
/**
 * What would km-core's LayeredDeduplicator merge that today's writers do not?
 *
 * WHY THIS EXISTS BEFORE THE SWITCH
 *
 * Three entity resolvers are live in this repo and none of them is the one
 * km-core ships:
 *
 *   online  — exact upsert on `legacyId`, else exact `topic + project`
 *             (ObservationWriter.js). No fuzzy matching at all.
 *   UKB     — Tree-KG `operator_dedup` + DeduplicationAgent -> mergeEntities.
 *   km-core — LayeredDeduplicator (Jaccard -> cosine -> LLM), fully built,
 *             fully tested, ZERO production callers.
 *
 * Stage 3 of the KM revamp routes both writers through the third one. That
 * changes merge behaviour across the whole corpus, so it gets a report before
 * it gets a switch: this runs the real km-core orchestrator over the live
 * graph and prints every pair it WOULD merge. It writes nothing.
 *
 * LAYER CHOICE. Jaccard only, by default. It is the layer that runs first in
 * production, it is free and deterministic, and it answers the question this
 * report is for. The embedding layer exists but note its cost shape:
 * CosineEmbeddingMatcher re-embeds the entity AND every candidate on each
 * call, so a pairwise sweep of the 924-Insight pool is ~854k embeddings. That
 * layer wants a cached-vector pass, not this loop.
 *
 * THIN CLIENT — the km-core LevelDB is single-owner (obs-api). Reads go over
 * HTTP; this process never opens the store.
 *
 * Usage:
 *   node scripts/report-entity-resolution.mjs
 *   node scripts/report-entity-resolution.mjs --threshold=0.75
 *   node scripts/report-entity-resolution.mjs --class=Insight --limit=40
 */

import { LayeredDeduplicator, JaccardNameMatcher } from '@fwornle/km-core';

const OBS_API = process.env.OBS_API_URL || 'http://127.0.0.1:12436';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const THRESHOLD = Number(args.threshold) > 0 ? Number(args.threshold) : 0.85;
const ONLY_CLASS = typeof args.class === 'string' ? args.class : null;
const LIMIT = Number(args.limit) > 0 ? Number(args.limit) : 25;

const out = (m = '') => process.stdout.write(`${m}\n`);
const die = (m) => { process.stderr.write(`${m}\n`); process.exit(1); };

// ---------------------------------------------------------------------------

out('\n=== entity-resolution report (read-only) ===');
out(`obs-api  : ${OBS_API}`);
out(`layer    : JaccardNameMatcher, threshold ${THRESHOLD}`);
out(`scope    : ${ONLY_CLASS ?? 'every ontologyClass'}\n`);

let entities;
try {
  const res = await fetch(`${OBS_API}/api/v1/entities?limit=100000`);
  if (!res.ok) throw new Error(`GET /api/v1/entities → ${res.status}`);
  entities = (await res.json()).data ?? [];
} catch (e) {
  die(`cannot read entities: ${e.message}\nIs obs-api running? curl ${OBS_API}/health`);
}
out(`entities : ${entities.length}`);

// D-46 candidate pools are class-scoped and active-only. Archived rows are
// excluded: they were deliberately folded behind a roll-up parent, and
// "these two archived rows are duplicates" is noise, not a finding.
const active = entities.filter((e) => !(e.metadata ?? {}).archivedAt);
const pools = new Map();
for (const e of active) {
  const cls = e.ontologyClass ?? e.entityType;
  if (!cls) continue;
  if (ONLY_CLASS && cls !== ONLY_CLASS) continue;
  if (!pools.has(cls)) pools.set(cls, []);
  pools.get(cls).push(e);
}
out(`active   : ${active.length}  (archived rows excluded)`);
out(`pools    : ${pools.size}\n`);

const dedup = new LayeredDeduplicator({
  exactName: new JaccardNameMatcher({ threshold: THRESHOLD }),
});

/** Pairs already reported, keyed by the unordered id pair. */
const seen = new Set();
const findings = [];

for (const [cls, pool] of [...pools].sort((a, b) => b[1].length - a[1].length)) {
  if (pool.length < 2) continue;
  for (const entity of pool) {
    // Candidates exclude self. The matcher deliberately has no self-guard
    // (CR-02: to it an id collision IS a duplicate), so the pool must.
    const candidates = pool.filter((c) => c.id !== entity.id);
    const result = await dedup.dedup(entity, candidates);
    if (!result.matched || !result.survivor) continue;
    const key = [entity.id, result.survivor.id].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ cls, confidence: result.confidence ?? 0, a: entity, b: result.survivor });
  }
}

findings.sort((x, y) => y.confidence - x.confidence);

out(`=== would merge: ${findings.length} pairs ===\n`);
const byClass = new Map();
for (const f of findings) byClass.set(f.cls, (byClass.get(f.cls) ?? 0) + 1);
for (const [cls, n] of [...byClass].sort((a, b) => b[1] - a[1])) {
  out(`  ${String(n).padStart(5)}  ${cls}`);
}

if (findings.length) {
  out(`\n=== top ${Math.min(LIMIT, findings.length)} by confidence ===`);
  for (const f of findings.slice(0, LIMIT)) {
    out(`\n  [${f.confidence.toFixed(3)}] ${f.cls}`);
    out(`    A  ${String(f.a.name).slice(0, 88)}`);
    out(`    B  ${String(f.b.name).slice(0, 88)}`);
  }
}

// Contrast with what ships today. The online path keys Insights on
// `topic + project`, so a pair those two fields already unify is not a
// behaviour change — the rest are merges this adoption would newly make.
const alreadyUnified = findings.filter((f) => {
  const ma = f.a.metadata ?? {};
  const mb = f.b.metadata ?? {};
  return ma.topic && ma.topic === mb.topic && (ma.project ?? null) === (mb.project ?? null);
});
out('\n=== contrast with the current online resolver ===');
out(`  pairs exact topic+project already unifies : ${alreadyUnified.length}`);
out(`  NEW merges if this is adopted             : ${findings.length - alreadyUnified.length}`);
out('\nRead-only. Nothing was written.\n');
