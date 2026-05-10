#!/usr/bin/env node

/**
 * Prune orphaned Qdrant vectors — points whose source SQLite row is gone.
 *
 * The retrieval pipeline assembles results by joining Qdrant hits back to
 * SQLite by id, and silently drops hits whose row is missing. Orphans are
 * therefore functionally benign — they cost a bit of disk and memory and
 * waste fusion slots, but don't poison results. This script cleans them
 * out so collection sizes match the source of truth.
 *
 * Sources of drift:
 *   - manual SQL deletes (e.g. dedupe-observations.mjs --apply)
 *   - direct DB churn during development (DB rebuilds, migrations)
 *   - failed mid-write transactions where SQLite rolled back but Qdrant
 *     publish had already fired
 *
 * Scope: observations, digests, insights — all three Qdrant collections
 * whose point IDs match a row id in SQLite. The kg_entities collection
 * is intentionally skipped: it sources from the OKB Graphology graph,
 * not SQLite, so "orphan" is meaningless from this DB's perspective.
 *
 * Usage:
 *   node scripts/prune-orphan-vectors.mjs               # dry run (default)
 *   node scripts/prune-orphan-vectors.mjs --apply       # actually delete
 *   node scripts/prune-orphan-vectors.mjs --collection=observations,digests
 *
 * Strategy:
 *   1. Read all IDs from the SQLite source table → keep set
 *   2. Scroll the Qdrant collection in pages of 1000 → all-points set
 *   3. Compute orphans = all-points − keep set
 *   4. Delete orphans in batches of 200 (Qdrant POST size sanity)
 *
 * Safety: read-only by default. Even with --apply, the operation is
 * limited to a precise list of point IDs computed from the diff — no
 * "delete by query" that could surprise. Failures per batch are reported
 * but don't block subsequent batches.
 */

import Database from 'better-sqlite3';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const CODING_DIR = path.resolve(SCRIPT_DIR, '..');
const DB_PATH = path.join(CODING_DIR, '.observations', 'observations.db');
const QDRANT_HOST = process.env.QDRANT_HOST || '127.0.0.1';
const QDRANT_PORT = parseInt(process.env.QDRANT_PORT || '6333', 10);

const APPLY = process.argv.includes('--apply');
const collArg = process.argv.find((a) => a.startsWith('--collection='));
const SELECTED = collArg ? collArg.split('=')[1].split(',') : ['observations', 'digests', 'insights'];

function info(msg) { process.stdout.write(`[prune] ${msg}\n`); }
function warn(msg) { process.stderr.write(`[prune] ${msg}\n`); }

function qdrantRequest(pathStr, method, body) {
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: QDRANT_HOST, port: QDRANT_PORT, path: pathStr, method,
        headers: bodyStr
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
          : {},
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch { resolve({ status: res.statusCode, body: null }); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ status: null, body: null, error: 'timeout' }); });
    req.on('error', (err) => resolve({ status: null, body: null, error: err.message }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function scrollAllIds(collection) {
  const ids = new Set();
  let offset = null;
  while (true) {
    const body = { limit: 1000, with_payload: false, with_vector: false };
    if (offset != null) body.offset = offset;
    const { status, body: resp } = await qdrantRequest(
      `/collections/${collection}/points/scroll`, 'POST', body
    );
    if (status !== 200 || !resp?.result) {
      warn(`scroll ${collection} failed (status=${status})`);
      return null;
    }
    for (const p of resp.result.points || []) ids.add(p.id);
    offset = resp.result.next_page_offset;
    if (offset == null) break;
  }
  return ids;
}

async function deleteIds(collection, ids) {
  const BATCH = 200;
  let dropped = 0, failed = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const { status } = await qdrantRequest(
      `/collections/${collection}/points/delete?wait=true`, 'POST', { points: batch }
    );
    if (status && status >= 200 && status < 300) dropped += batch.length;
    else { failed += batch.length; warn(`batch delete in ${collection} failed (status=${status})`); }
  }
  return { dropped, failed };
}

const db = new Database(DB_PATH, { readonly: true });

const SOURCE_TABLE = {
  observations: 'observations',
  digests: 'digests',
  insights: 'insights',
};

info(APPLY ? 'mode: APPLY (will delete)' : 'mode: dry-run (no deletes)');
info(`collections: ${SELECTED.join(', ')}`);

let totalOrphans = 0;
let totalDropped = 0;

for (const col of SELECTED) {
  const tbl = SOURCE_TABLE[col];
  if (!tbl) { warn(`skipping unknown collection: ${col}`); continue; }

  const sqlIds = new Set(db.prepare(`SELECT id FROM ${tbl}`).all().map((r) => r.id));
  const qdrantIds = await scrollAllIds(col);
  if (qdrantIds == null) { warn(`could not enumerate ${col}, skipping`); continue; }

  const orphans = [];
  for (const id of qdrantIds) if (!sqlIds.has(id)) orphans.push(id);

  process.stdout.write(`\n[prune] ${col}: sqlite=${sqlIds.size}  qdrant=${qdrantIds.size}  orphans=${orphans.length}\n`);
  totalOrphans += orphans.length;

  if (orphans.length === 0) continue;

  // Sample 5 orphans for the dry-run report
  const sample = orphans.slice(0, 5);
  process.stdout.write(`  sample orphan ids: ${sample.join(', ')}${orphans.length > 5 ? ` … (+${orphans.length - 5} more)` : ''}\n`);

  if (APPLY) {
    const { dropped, failed } = await deleteIds(col, orphans);
    process.stdout.write(`  deleted: ${dropped} ok, ${failed} failed\n`);
    totalDropped += dropped;
  }
}

db.close();

process.stdout.write('\n');
if (APPLY) info(`done — ${totalDropped} / ${totalOrphans} orphan vectors deleted`);
else info(`dry run — found ${totalOrphans} orphan vectors total. Pass --apply to delete.`);
