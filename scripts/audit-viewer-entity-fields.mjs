#!/usr/bin/env node
/**
 * Audit every entity field the unified-viewer READS against what the store
 * actually SENDS.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * On 2026-09-26 four separate defects in the viewer turned out to be one
 * defect: a renderer reading a field no writer populates, with nothing
 * anywhere reporting an error.
 *
 *   • `entity.level` / `entity.parent` — 0 of 2809 rows. The identity header
 *     and the IDENTITY block printed `—` for every entity, in every session,
 *     since they shipped.
 *   • `mergeIntoGraph` stamped `level: e.level` → `undefined`, and
 *     `computeNodeState` reads an undefined level as `filter-hidden`, so every
 *     node that function added was invisible on arrival.
 *   • `entity.createdBy` / `lastConfirmedBy` / `lastSegment` /
 *     `confirmationCount` — 0 of 2809, while `metadata.provenance` carried all
 *     of them on 2705 (96%). The whole Provenance section read `—`.
 *   • `entity.lastConfirmedAt` — 0 of 2809. "last confirmed —" on EVERY entity
 *     in both side panels.
 *
 * None of these could fail loudly. A missing field is `undefined`, `undefined`
 * renders as a placeholder, and a placeholder looks exactly like a row that
 * genuinely has no value. The only symptom was a screenshot.
 *
 * ── The two halves, and why only one is a script ────────────────────────────
 * TOP-LEVEL reads are now caught by the compiler: `Entity` in
 * `graph/types.ts` mirrors km-core's `EntityWireSchema` and no longer carries
 * `[k: string]: unknown`, so `entity.anythingAtAll` is a type error. This
 * script re-checks that the declared keys still match the live wire, which the
 * compiler cannot know — the type is hand-written and the server could move.
 *
 * `metadata` is the half a type cannot help with. It is an open record
 * (`MetadataSchema = z.record(z.string(), z.unknown())`) by deliberate design,
 * so every `metadata.<key>` read type-checks no matter what the key is. That
 * is what this script is really for: it extracts the keys the viewer reads and
 * measures how many live rows carry each one.
 *
 * ── Not a CI gate ───────────────────────────────────────────────────────────
 * It needs obs-api, which CI has not got. Run it by hand after touching viewer
 * reads, or when a panel shows a suspicious number of dashes.
 *
 * A 0% key is not automatically a bug — a viewer may legitimately read a field
 * only OKB populates (the `okb` tab shares these panels). The script reports
 * and lets a person judge; it fails only on a read that is 0% AND whose key is
 * one this repo's own writers are supposed to produce.
 *
 * Usage:
 *   node scripts/audit-viewer-entity-fields.mjs            # report
 *   node scripts/audit-viewer-entity-fields.mjs --all      # include 0-row keys
 *                                                          # known to be OKB-only
 * Exit 0 = every read is backed by data. Exit 1 = at least one is not.
 */

import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.CODING_REPO || path.resolve(import.meta.dirname, '..');
const VIEWER_SRC = path.join(REPO, 'integrations', 'unified-viewer', 'src');
const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';
const SHOW_ALL = process.argv.includes('--all');

const out = (m = '') => process.stdout.write(`${m}\n`);

/**
 * Keys that are read by panels shared with the OKB tab and are not expected on
 * the coding corpus. Listed rather than silently skipped, so the list itself is
 * reviewable — an entry here is a claim that a key belongs to another backend.
 */
const OKB_ONLY = new Set(['domain', 'lastSeen', 'insight', 'source_refs']);

/**
 * Keys the viewer writes or reads that are structural rather than server-sent
 * (set by the viewer itself, or by a backfill this repo owns).
 */
const VIEWER_OWNED = new Set(['parentId']);

// ── 1. Extract every metadata.<key> read from the viewer source ─────────────

/** Walk .ts/.tsx under a root, skipping tests and node_modules. */
function* sourceFiles(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* sourceFiles(p);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield p;
    }
  }
}

/**
 * The metadata bag is reached through several local names — `metadata`, `meta`,
 * `md`, and inline casts like `(e.metadata as {x?: string}).x`. Matching the
 * VARIABLE names rather than trying to type-resolve is deliberate: this is a
 * lint, and a false positive costs one line of review while a false negative
 * costs another screenshot.
 */
const READ_PATTERNS = [
  /\b(?:metadata|meta|md)\s*\??\.\s*([A-Za-z_][A-Za-z0-9_]*)/g,
  /\.metadata\s+as\s+\{\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/g,
  /\b(?:metadata|meta|md)\s*\??\.\s*\[\s*['"]([^'"]+)['"]\s*\]/g,
];

/** Property names on the bag itself, not keys in it. */
const NOT_KEYS = new Set(['length', 'map', 'filter', 'forEach', 'get', 'set', 'has', 'keys', 'values', 'entries', 'slice', 'push', 'find', 'some', 'every', 'sort', 'join', 'includes', 'toString', 'title', 'cause', 'color', 'icon', 'label']);

function collectReads() {
  /** @type {Map<string, Set<string>>} key -> files that read it */
  const reads = new Map();
  for (const file of sourceFiles(VIEWER_SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    // Strip comments so prose about a removed field is not counted as a read.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const re of READ_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code)) !== null) {
        const key = m[1];
        if (NOT_KEYS.has(key)) continue;
        if (!reads.has(key)) reads.set(key, new Set());
        reads.get(key).add(path.relative(REPO, file));
      }
    }
  }
  return reads;
}

// ── 2. Measure what the store actually sends ────────────────────────────────

async function fetchEntities() {
  const url = `${OBS_API}/api/v1/entities?limit=1000000`;
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const body = await res.json();
  const rows = body.data ?? body;
  if (!Array.isArray(rows)) throw new Error('unexpected /api/v1/entities shape');
  return rows;
}

/** The nine keys km-core's entityToWire emits. Kept in step with contracts.ts. */
const WIRE_KEYS = [
  'id', 'name', 'entityType', 'ontologyClass', 'layer',
  'description', 'createdAt', 'updatedAt', 'metadata',
];

function measure(rows) {
  const metaCounts = new Map();
  const topKeys = new Set();
  for (const e of rows) {
    for (const k of Object.keys(e)) topKeys.add(k);
    const md = e.metadata ?? {};
    for (const [k, v] of Object.entries(md)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      metaCounts.set(k, (metaCounts.get(k) ?? 0) + 1);
    }
  }
  return { metaCounts, topKeys };
}

// ── 3. Report ───────────────────────────────────────────────────────────────

const pad = (s, n) => String(s).padEnd(n).slice(0, n);

const rows = await fetchEntities();
const { metaCounts, topKeys } = measure(rows);
const reads = collectReads();
const total = rows.length;

out(`Viewer entity-field audit — ${total} entities from ${OBS_API}`);
out('='.repeat(78));
out();

// 3a. The wire shape itself.
const unexpected = [...topKeys].filter((k) => !WIRE_KEYS.includes(k));
const missing = WIRE_KEYS.filter((k) => !topKeys.has(k));
out('TOP-LEVEL WIRE SHAPE (the compiler enforces the viewer side; this checks the server side)');
if (unexpected.length === 0 && missing.length === 0) {
  out(`  OK — exactly the ${WIRE_KEYS.length} keys graph/types.ts declares.`);
} else {
  if (unexpected.length) out(`  SERVER SENDS UNDECLARED: ${unexpected.join(', ')}`);
  if (missing.length) out(`  DECLARED BUT NEVER SENT:  ${missing.join(', ')}`);
  out('  -> graph/types.ts + api/ApiClient.ts + api/shape-lock.test.ts move together.');
}
out();

// 3b. metadata reads vs population.
out('METADATA READS (an open record — no type can check these)');
out();
out(`  ${pad('key', 30)}${pad('rows', 8)}${pad('%', 6)}read from`);
out(`  ${'-'.repeat(74)}`);

const dead = [];
const sorted = [...reads.entries()].sort((a, b) =>
  (metaCounts.get(a[0]) ?? 0) - (metaCounts.get(b[0]) ?? 0) || a[0].localeCompare(b[0]));

for (const [key, files] of sorted) {
  const n = metaCounts.get(key) ?? 0;
  const pct = total ? Math.round((n / total) * 100) : 0;
  const known = OKB_ONLY.has(key) || VIEWER_OWNED.has(key);
  if (n === 0 && !known) dead.push([key, files]);
  if (n === 0 && known && !SHOW_ALL) continue;
  const first = [...files][0] ?? '';
  const more = files.size > 1 ? ` (+${files.size - 1} more)` : '';
  const flag = n === 0 ? (known ? '  [expected elsewhere]' : '  <-- DEAD READ') : '';
  out(`  ${pad(key, 30)}${pad(n, 8)}${pad(pct + '%', 6)}${first}${more}${flag}`);
}

out();
if (dead.length === 0) {
  out('Every metadata read is backed by data. Exit 0.');
  process.exit(0);
}

out(`${dead.length} read(s) matched 0 of ${total} rows:`);
out();
for (const [key, files] of dead) {
  out(`  metadata.${key}`);
  for (const f of files) out(`      ${f}`);
}
out();
out('Each is either a field whose writer never shipped, or a rename the reader');
out('missed. Both render as a placeholder, which is why only a screenshot finds');
out('them. Fix the read, or add the key to OKB_ONLY with the reason.');
process.exit(1);
