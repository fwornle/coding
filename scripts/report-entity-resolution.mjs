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
 * LAYERS. Jaccard by default — free, deterministic, and the layer that runs
 * first in production. `--embed` adds km-core's cosine layer on top, behind a
 * memoizing embedding client: CosineEmbeddingMatcher re-embeds the probe AND
 * every candidate per call, so an all-pairs sweep of the Insight pool would be
 * ~774k embeddings without the memo and one per entity with it.
 *
 * THIN CLIENT — the km-core LevelDB is single-owner (obs-api). Reads go over
 * HTTP; this process never opens the store.
 *
 * Usage:
 *   node scripts/report-entity-resolution.mjs
 *   node scripts/report-entity-resolution.mjs --threshold=0.75
 *   node scripts/report-entity-resolution.mjs --class=Insight --limit=40
 *   node scripts/report-entity-resolution.mjs --class=Insight --embed
 *   node scripts/report-entity-resolution.mjs --class=Insight --embed --embed-threshold=0.93
 *   node scripts/report-entity-resolution.mjs --class=Insight --embed --embed-text=name+desc200
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LayeredDeduplicator,
  JaccardNameMatcher,
  CosineEmbeddingMatcher,
  FastembedEmbeddingClient,
} from '@fwornle/km-core';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OBS_API = process.env.OBS_API_URL || 'http://127.0.0.1:12436';

// The repo's copy of the ONNX weights. km-core reads KM_FASTEMBED_CACHE_DIR
// when a caller passes no cacheDir; set it here so the default construction
// below finds the model instead of trying to download it (which fails behind
// the corporate proxy as an empty AggregateError).
process.env.KM_FASTEMBED_CACHE_DIR ??= path.join(REPO_ROOT, '.data', 'fastembed-cache');

/**
 * Embedding client that embeds each distinct text ONCE.
 *
 * CosineEmbeddingMatcher re-embeds the probe entity AND every candidate on
 * every call, which is the right shape for one-at-a-time ingestion and the
 * wrong shape for an all-pairs sweep: the 880-Insight pool would be ~774k
 * embeddings instead of 880. Memoizing underneath the matcher keeps km-core's
 * real code path — the matcher, its threshold, its cosine — while paying the
 * model cost once per entity.
 */
class MemoizingEmbeddingClient {
  constructor(inner) {
    this.inner = inner;
    this.cache = new Map();
    this.calls = 0;
    this.misses = 0;
  }

  async embed(text) {
    this.calls += 1;
    const hit = this.cache.get(text);
    if (hit) return hit;
    this.misses += 1;
    const vec = await this.inner.embed(text);
    this.cache.set(text, vec);
    return vec;
  }

  async embedBatch(texts) {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const THRESHOLD = Number(args.threshold) > 0 ? Number(args.threshold) : 0.85;
const ONLY_CLASS = typeof args.class === 'string' ? args.class : null;
const LIMIT = Number(args.limit) > 0 ? Number(args.limit) : 25;
const EMBED = args.embed === true || args.embed === 'true';
const EMBED_THRESHOLD = Number(args['embed-threshold']) > 0 ? Number(args['embed-threshold']) : 0.90;
// What text represents an entity to the embedder. The km-core default is
// `name + description`, which is wrong for this corpus: insight descriptions
// have a median length of 2,354 chars against all-MiniLM-L6-v2's ~256-token
// window, so every row embeds its truncated '## Purpose ...' preamble and
// unrelated insights score 0.99+ against each other.
const EMBED_TEXT_MODES = {
  // Name only. Short and distinctive, always inside the window.
  name: (e) => String(e.name ?? ''),
  // Name plus a slice of the description that fits the model's window
  // alongside it. `## Purpose ` is 11 characters of shared preamble, so a
  // 200-char slice is ~190 characters of actual content.
  'name+desc200': (e) =>
    `${e.name ?? ''}\n\n${String(e.description ?? '').slice(0, 200)}`.trim(),
  // km-core's default. Kept so the broken configuration stays reproducible.
  'name+desc': (e) => `${e.name}\n\n${e.description ?? ''}`.trim(),
};
const EMBED_TEXT = Object.hasOwn(EMBED_TEXT_MODES, args['embed-text'])
  ? args['embed-text']
  : 'name';

const out = (m = '') => process.stdout.write(`${m}\n`);
const die = (m) => { process.stderr.write(`${m}\n`); process.exit(1); };

// ---------------------------------------------------------------------------

out('\n=== entity-resolution report (read-only) ===');
out(`obs-api  : ${OBS_API}`);
out(`layers   : Jaccard@${THRESHOLD}${EMBED ? ` → cosine@${EMBED_THRESHOLD} on ${EMBED_TEXT}` : ' (cosine off — pass --embed)'}`);
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

let memo = null;
const layers = { exactName: new JaccardNameMatcher({ threshold: THRESHOLD }) };
if (EMBED) {
  memo = new MemoizingEmbeddingClient(new FastembedEmbeddingClient());
  layers.embedding = new CosineEmbeddingMatcher({
    client: memo,
    threshold: EMBED_THRESHOLD,
    textOf: EMBED_TEXT_MODES[EMBED_TEXT],
  });
}
// shortCircuit stays at its production default (true): the cheap layer wins
// when it fires, exactly as it would in the write path. The point is to see
// what production would do, not to audit every layer's opinion.
const dedup = new LayeredDeduplicator(layers);

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
    findings.push({
      cls,
      confidence: result.confidence ?? 0,
      layer: result.matchedLayer ?? 'exactName',
      a: entity,
      b: result.survivor,
    });
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
    out(`\n  [${f.confidence.toFixed(3)} via ${f.layer}] ${f.cls}`);
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
const byLayer = new Map();
for (const f of findings) byLayer.set(f.layer, (byLayer.get(f.layer) ?? 0) + 1);
if (byLayer.size) {
  out('\n=== which layer caught them ===');
  for (const [l, n] of [...byLayer].sort((a, b) => b[1] - a[1])) out(`  ${String(n).padStart(5)}  ${l}`);
}
if (memo) {
  out(`\nembeddings: ${memo.misses} computed for ${memo.calls} matcher requests ` +
      `(${(100 - (memo.misses / Math.max(memo.calls, 1)) * 100).toFixed(1)}% served from memo)`);
}
out('\nRead-only. Nothing was written.\n');
