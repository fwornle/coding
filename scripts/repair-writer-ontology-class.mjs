#!/usr/bin/env node
/**
 * Repair rows whose `ontologyClass` contradicts their `entityType`.
 *
 * THE RULE it enforces: `ontologyClass` must be `entityType` itself, or one of
 * its ancestors in the ontology registry. A row saying "I am a Detail" while
 * being an Observation is a lie to every consumer that reasons over class —
 * the ontology filter, roll-up candidate selection, and the putEntity IS-A
 * guard that is meant to land once this reaches zero.
 *
 * WHAT PRODUCED THEM
 *
 * `ObservationWriter` overwrote `ontologyClass` to 'Detail' on every
 * Observation (2026-06-11) and every Digest, to force raw rows into the
 * 4-class hierarchy the viewer used to colour against. That rewrite was
 * removed on 2026-09-20 — the viewer's predicate now checks BOTH fields
 * (visibility-predicate.ts:144) and the other consumer it named,
 * lib/vkb-server/data-processor.js, was deleted with vkb-server. This script
 * repairs the rows written while it was in force.
 *
 * SCOPE. By default only the classes that writer owned (`Observation`,
 * `Digest`) are repaired — the rows this change is responsible for, where the
 * correct value is unambiguous: entityType. `--all` reports every violation in
 * the graph, including ones from other producers (the consolidator stamping an
 * L2 subsystem into entityType while ontologyClass stays 'Insight', and the
 * wave path stamping upper-ontology classes onto Details). Those need their
 * own decision about which field is wrong, so this script REPORTS them and
 * refuses to guess.
 *
 * THIN CLIENT — the km-core LevelDB is single-owner (obs-api). Every read and
 * write goes over HTTP; this process never opens the store.
 *
 * Usage:
 *   node scripts/repair-writer-ontology-class.mjs              # dry run
 *   node scripts/repair-writer-ontology-class.mjs --all        # + report other producers
 *   node scripts/repair-writer-ontology-class.mjs --apply      # write
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const ALL = args.has('--all');

const out = (m = '') => process.stdout.write(`${m}\n`);
const die = (m) => { process.stderr.write(`${m}\n`); process.exit(1); };

/** Classes where entityType is unambiguously the correct value. */
const WRITER_OWNED = new Set(['Observation', 'Digest']);

/**
 * Artifact classes — what a row IS, as opposed to what it is ABOUT.
 *
 * Two rules follow from this set:
 *
 *   - BOTH fields name an artifact class and they disagree ('Insight' vs
 *     'Detail') → two claims about the same fact. Migrating 'Insight' into
 *     `metadata.subsystem` would be nonsense, so it is reported for a human
 *     decision rather than guessed at.
 *   - `ontologyClass` names one and `entityType` does NOT → the class field
 *     is holding a tag: an L2 subsystem ('AgentIntegration'), an
 *     upper-ontology descriptor ('Process', 'File'), or an unregistered label
 *     ('TransferablePattern'). The tag MIGRATES to `metadata.subsystem` and
 *     entityType is set to match the class, so nothing is lost.
 *
 * The migration is safe because nothing reads the tag through
 * `findByOntologyClass`'s entityType OR-gate: the viewer's class filter tests
 * `ontologyClass` only (visibility-predicate.ts:247), the pruner passes
 * literal 'Observation'/'Digest', and every other caller names a literal
 * artifact class.
 */
const ARTIFACT_CLASSES = new Set([
  'System', 'Project', 'Component', 'SubComponent', 'Detail',
  'Observation', 'Digest', 'Insight',
  'OnlineObservation', 'OnlineDigest', 'OnlineInsight',
]);

// ---------------------------------------------------------------------------
// Ontology registry — the same union obs-api loads (KG_ONTOLOGY_DIR).
// ---------------------------------------------------------------------------
function loadParentMap() {
  const curated = path.join(REPO_ROOT, '.data', 'ontologies', 'obs-api');
  if (!fs.existsSync(curated)) die(`ontology dir not found: ${curated}`);
  const parent = new Map();
  for (const f of fs.readdirSync(curated)) {
    if (!f.endsWith('.json')) continue;
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(curated, f), 'utf8'));
    } catch {
      continue; // display overlays and non-registry files
    }
    const classes = doc?.classes;
    if (!classes || typeof classes !== 'object') continue;
    for (const [name, body] of Object.entries(classes)) {
      parent.set(name, body?.extends ?? body?.parent ?? null);
    }
  }
  return parent;
}

/** entityType's ancestor chain, self first. Cycle-safe. */
function chainOf(cls, parent) {
  const chain = [];
  const seen = new Set();
  let cur = cls;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = parent.get(cur) ?? null;
  }
  return chain;
}

async function api(pathname, init) {
  const res = await fetch(`${OBS_API}${pathname}`, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${pathname} → ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------

const parent = loadParentMap();
out(`\n=== ontologyClass repair ${APPLY ? '— APPLY MODE' : '(dry run)'} ===`);
out(`registry: ${parent.size} classes from .data/ontologies/obs-api/`);
out(`obs-api : ${OBS_API}\n`);

let entities;
try {
  const body = await api('/api/v1/entities?limit=100000');
  entities = body.data ?? [];
} catch (e) {
  die(`cannot read entities: ${e.message}\nIs obs-api running? curl ${OBS_API}/health`);
}
out(`entities scanned : ${entities.length}`);

const repairable = [];   // ontologyClass := entityType
const migratable = [];   // entityType -> metadata.subsystem, then entityType := ontologyClass
const foreign = [];
const unknownClass = [];

for (const e of entities) {
  const et = e.entityType;
  const oc = e.ontologyClass;
  if (!et || !oc || et === oc) continue;
  const known = parent.has(et) && parent.has(oc);
  if (known && chainOf(et, parent).includes(oc)) continue; // legal IS-A
  if (known && WRITER_OWNED.has(et)) { repairable.push(e); continue; }
  // Two artifact classes disagreeing is a claim conflict, not a misplaced
  // tag — never guess which wins.
  if (ARTIFACT_CLASSES.has(et)) { foreign.push(e); continue; }
  // entityType is a subsystem, an upper-ontology descriptor, or an unknown
  // tag (TransferablePattern, Pattern) — the same shape in every case: a
  // non-class value sitting in the class field. Migrate it.
  if (ARTIFACT_CLASSES.has(oc)) { migratable.push(e); continue; }
  (known ? foreign : unknownClass).push(e);
}

const tally = (rows) => {
  const m = new Map();
  for (const r of rows) {
    const k = `${r.entityType} → ${r.ontologyClass}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

out(`violations       : ${repairable.length + migratable.length + foreign.length + unknownClass.length}`);
out(`  class := type  : ${repairable.length}`);
for (const [k, n] of tally(repairable)) out(`      ${String(n).padStart(5)}  ${k}`);
out(`  tag -> metadata: ${migratable.length}  (entityType moves to metadata.subsystem)`);
for (const [k, n] of tally(migratable)) out(`      ${String(n).padStart(5)}  ${k}`);

if (foreign.length) {
  out(`  other producers: ${foreign.length}  (reported only — not repaired)`);
  if (ALL) for (const [k, n] of tally(foreign)) out(`      ${String(n).padStart(5)}  ${k}`);
  else out('      re-run with --all to list them');
}
if (unknownClass.length) {
  out(`  unknown classes: ${unknownClass.length}  (entityType or ontologyClass not in the registry)`);
  if (ALL) for (const [k, n] of tally(unknownClass)) out(`      ${String(n).padStart(5)}  ${k}`);
}

const work = repairable.length + migratable.length;
if (!work) {
  out('\nNothing to repair.\n');
  process.exit(0);
}

if (!APPLY) {
  out(`\nWould set ontologyClass := entityType on ${repairable.length} rows,`);
  out(`and move entityType into metadata.subsystem on ${migratable.length} rows.`);
  out('Re-run with --apply to write.\n');
  process.exit(0);
}

let ok = 0;
const failures = [];

const put = (id, body) =>
  api(`/api/v1/entities/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

for (const e of repairable) {
  try {
    // ONLY ontologyClass. mergeAttributes is a shallow merge, so passing
    // `metadata` here would replace the row's whole metadata object.
    await put(e.id, { ontologyClass: e.entityType });
    ok += 1;
    if (ok % 50 === 0) out(`  … ${ok}/${work}`);
  } catch (err) {
    failures.push({ id: e.id, name: e.name, error: err.message });
  }
}

for (const e of migratable) {
  try {
    // Shallow merge again: send the row's EXISTING metadata plus the new key,
    // or the write drops every other metadata field on the row.
    const meta = { ...(e.metadata ?? {}) };
    if (!meta.subsystem) meta.subsystem = e.entityType;
    await put(e.id, { entityType: e.ontologyClass, metadata: meta });
    ok += 1;
    if (ok % 50 === 0) out(`  … ${ok}/${work}`);
  } catch (err) {
    failures.push({ id: e.id, name: e.name, error: err.message });
  }
}

out(`\nrepaired : ${ok}`);
out(`failed   : ${failures.length}`);
for (const f of failures.slice(0, 10)) out(`    ${f.id} ${String(f.name).slice(0, 40)} — ${f.error}`);
if (failures.length > 10) out(`    … and ${failures.length - 10} more`);
out('');
process.exit(failures.length ? 1 : 0);
