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

/** Classes this script is willing to repair automatically. */
const WRITER_OWNED = new Set(['Observation', 'Digest']);

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

const repairable = [];
const foreign = [];
const unknownClass = [];

for (const e of entities) {
  const et = e.entityType;
  const oc = e.ontologyClass;
  if (!et || !oc || et === oc) continue;
  if (!parent.has(et) || !parent.has(oc)) {
    unknownClass.push(e);
    continue;
  }
  if (chainOf(et, parent).includes(oc)) continue; // ontologyClass IS an ancestor — legal
  (WRITER_OWNED.has(et) ? repairable : foreign).push(e);
}

const tally = (rows) => {
  const m = new Map();
  for (const r of rows) {
    const k = `${r.entityType} → ${r.ontologyClass}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

out(`violations       : ${repairable.length + foreign.length}`);
out(`  repairable here: ${repairable.length}`);
for (const [k, n] of tally(repairable)) out(`      ${String(n).padStart(5)}  ${k}`);

if (foreign.length) {
  out(`  other producers: ${foreign.length}  (reported only — not repaired)`);
  if (ALL) for (const [k, n] of tally(foreign)) out(`      ${String(n).padStart(5)}  ${k}`);
  else out('      re-run with --all to list them');
}
if (unknownClass.length) {
  out(`  unknown classes: ${unknownClass.length}  (entityType or ontologyClass not in the registry)`);
  if (ALL) for (const [k, n] of tally(unknownClass)) out(`      ${String(n).padStart(5)}  ${k}`);
}

if (!repairable.length) {
  out('\nNothing to repair.\n');
  process.exit(0);
}

if (!APPLY) {
  out('\nWould set ontologyClass := entityType on the repairable rows.');
  out('Re-run with --apply to write.\n');
  process.exit(0);
}

let ok = 0;
const failures = [];
for (const e of repairable) {
  try {
    // Send ONLY ontologyClass. mergeAttributes is a shallow merge, so passing
    // `metadata` here would replace the row's whole metadata object.
    await api(`/api/v1/entities/${e.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ontologyClass: e.entityType }),
    });
    ok += 1;
    if (ok % 50 === 0) out(`  … ${ok}/${repairable.length}`);
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
