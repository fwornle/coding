#!/usr/bin/env node

/**
 * One-shot semantic dedup for the observations DB.
 *
 * Applies the same logic as ObservationWriter._isSemanticallyDuplicate()
 * (combined Intent+Approach Jaccard + new Intent-only band) but pairwise
 * across the entire history per agent — not just the 4-hour window the
 * live writer uses. The live dedup catches new dupes; this script removes
 * the ones that already accumulated before the fix landed.
 *
 * Usage:
 *   node scripts/dedupe-observations.mjs                       # dry run, 4h window (default)
 *   node scripts/dedupe-observations.mjs --window-hours=24     # wider window
 *   node scripts/dedupe-observations.mjs --window-hours=0      # unbounded (whole history)
 *   node scripts/dedupe-observations.mjs --apply               # actually delete
 *
 * Strategy: greedy clustering per (agent, project). For each obs in
 * created_at order, compare against kept cluster representatives whose
 * created_at is within the configured window. If it matches one, mark as
 * dup of that cluster. Otherwise, start a new cluster. The oldest obs in
 * each cluster is kept; the rest are deleted from SQLite and from the
 * Qdrant `observations` collection (point IDs match the SQLite UUID).
 *
 * Window default is 4 hours, matching the live ObservationWriter dedup.
 * That preserves daily-recurring activities (e.g. /sl context loads on
 * different days) as distinct rows, while still collapsing the rapid-fire
 * dupes the live writer would have caught had its Intent-only band
 * existed at write time.
 *
 * Project boundary: dedup is scoped to (agent, project) pairs — same as
 * the user's mental model on the dashboard. An opencode obs in coding
 * doesn't cluster with a claude obs in rapid-automations even if their
 * Intents read similarly.
 *
 * Safety:
 *   - Default dry run prints counts + a sample of clusters; no writes.
 *   - --apply opens a single SQLite IMMEDIATE transaction so live writes
 *     queue rather than race. FTS cleanup is automatic via the existing
 *     observations_ad trigger.
 *   - Qdrant deletion runs after SQL commits; Qdrant failures are logged
 *     but don't roll back SQL (orphan vectors are harmless — retrieval
 *     joins back to SQL by id and skips missing rows).
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
const windowArg = process.argv.find((a) => a.startsWith('--window-hours='));
const WINDOW_HOURS = windowArg ? parseFloat(windowArg.split('=')[1]) : 4;
const WINDOW_MS = WINDOW_HOURS > 0 ? WINDOW_HOURS * 3600 * 1000 : Infinity;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'after',
  'before', 'about', 'then', 'than', 'also', 'just', 'more', 'some',
  'what', 'when', 'where', 'which', 'while', 'being', 'been', 'have',
  'does', 'doing', 'done', 'were', 'will', 'would', 'could', 'should',
  'their', 'them', 'they', 'your', 'using', 'used', 'make', 'made',
  'still', 'already', 'currently', 'previously', 'specifically',
  'issue', 'issues', 'problem', 'check', 'checking', 'needed',
  'trying', 'appears', 'whether', 'without', 'because', 'through',
  'work', 'working', 'session', 'logs', 'files', 'file', 'code',
  'data', 'started', 'continue', 'first', 'context', 'prior',
  'understand', 'reading', 'read', 'look', 'looking', 'find',
  'morning', 'progress', 'reconstruct', 'steps', 'next',
]);

const STEM_MAP = {
  investigate: 'debug', investigating: 'debug', diagnose: 'debug', diagnosing: 'debug',
  debugging: 'debug', traced: 'debug', tracing: 'debug',
  showing: 'show', shown: 'show', displaying: 'show', display: 'show',
  appearing: 'show', appears: 'show', appear: 'show', visible: 'show',
  missing: 'absent', absent: 'absent',
  fixing: 'fix', fixed: 'fix', repair: 'fix', resolve: 'fix', resolved: 'fix',
  removing: 'remove', removed: 'remove', delete: 'remove', deleted: 'remove',
  clean: 'remove', cleanup: 'remove',
  resuming: 'resume', resumed: 'resume', restore: 'resume', restoring: 'resume',
  recovering: 'resume', recover: 'resume', interrupted: 'resume',
  observations: 'observation', observation: 'observation',
};

function extractKeywords(text) {
  const words = (text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
  return new Set(words.map(w => STEM_MAP[w] || w));
}

function extractIntent(summary) {
  const m = (summary || '').match(/^Intent:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

function extractApproach(summary) {
  const m = (summary || '').match(/^Approach:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

/**
 * Mirrors ObservationWriter._isSemanticallyDuplicate's decision rule:
 * combined-text band (jaccard > 0.4 OR containment > 0.7) OR
 * intent-only band (intent jaccard > 0.7, both intent kw sets >= 4).
 */
function isDup(a, b) {
  if (!a.combinedKw || !b.combinedKw) return false;
  if (a.combinedKw.size < 3 || b.combinedKw.size < 3) return false;

  let inter = 0;
  for (const w of a.combinedKw) if (b.combinedKw.has(w)) inter++;
  const union = new Set([...a.combinedKw, ...b.combinedKw]).size;
  const jaccard = inter / union;
  const minSize = Math.min(a.combinedKw.size, b.combinedKw.size);
  const containment = inter / minSize;
  if (jaccard > 0.4 || containment > 0.7) return { via: 'combined', jaccard, containment };

  if (a.intentKw && b.intentKw && a.intentKw.size >= 4 && b.intentKw.size >= 4) {
    let ii = 0;
    for (const w of a.intentKw) if (b.intentKw.has(w)) ii++;
    const iu = new Set([...a.intentKw, ...b.intentKw]).size;
    const ij = ii / iu;
    if (ij > 0.7) return { via: 'intent-only', intentJaccard: ij };
  }
  return false;
}

function projectOf(metadataJson) {
  if (!metadataJson) return 'unknown';
  try {
    const m = JSON.parse(metadataJson);
    return (m.project || m.projectName || 'unknown');
  } catch { return 'unknown'; }
}

function qdrantDelete(ids) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ points: ids });
    const req = http.request(
      {
        hostname: QDRANT_HOST, port: QDRANT_PORT,
        path: '/collections/observations/points/delete?wait=true',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 10000,
      },
      (res) => { res.resume(); resolve(res.statusCode); }
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

const db = new Database(DB_PATH, { readonly: false });
db.pragma('journal_mode = WAL');

const rows = db.prepare(
  `SELECT id, summary, agent, created_at, metadata
   FROM observations
   ORDER BY created_at ASC`
).all();

const windowLabel = Number.isFinite(WINDOW_MS) ? `${WINDOW_HOURS}h window` : 'unbounded window';
process.stdout.write(`[dedupe] loaded ${rows.length} observations (${windowLabel})\n`);

// Pre-compute keyword sets and group key
const enriched = rows.map((r) => {
  const intent = extractIntent(r.summary);
  const approach = extractApproach(r.summary);
  const combined = [intent, approach].filter(Boolean).join(' ');
  return {
    id: r.id,
    agent: r.agent || 'unknown',
    project: projectOf(r.metadata),
    created_at: r.created_at,
    summary: r.summary,
    intent,
    intentKw: intent ? extractKeywords(intent) : null,
    combinedKw: combined ? extractKeywords(combined) : null,
  };
});

// Group by (agent, project)
const groups = new Map();
for (const obs of enriched) {
  const key = `${obs.agent}|${obs.project}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(obs);
}

// Cluster within each group
const toDelete = []; // { id, keptId, via, sample }
const clusterStats = []; // { key, kept, dropped }
let totalKept = 0, totalDropped = 0;
let groupsWithDupes = 0;

for (const [key, members] of groups) {
  // Sort by created_at ASC (already sorted globally; preserve)
  const reps = []; // cluster representatives within this group
  let kept = 0, dropped = 0;
  for (const obs of members) {
    if (obs.combinedKw == null || obs.combinedKw.size < 3) {
      // Can't dedup this — keep as own cluster
      reps.push(obs);
      kept++;
      continue;
    }
    let matched = null;
    let via = null;
    const obsTime = Date.parse(obs.created_at);
    for (const r of reps) {
      // Bound the dedup window to match the live writer's 4-hour scope
      // (configurable via --window-hours). Without this, daily-recurring
      // patterns like /sl context loads collapse across weeks into one row.
      if (Number.isFinite(WINDOW_MS)) {
        const repTime = Date.parse(r.created_at);
        if (Math.abs(obsTime - repTime) > WINDOW_MS) continue;
      }
      const d = isDup(r, obs);
      if (d) { matched = r; via = d; break; }
    }
    if (matched) {
      toDelete.push({
        id: obs.id, keptId: matched.id, via,
        keptIntent: matched.intent || '(no Intent)',
        dropIntent: obs.intent || '(no Intent)',
        keptDate: matched.created_at, dropDate: obs.created_at,
      });
      dropped++;
    } else {
      reps.push(obs);
      kept++;
    }
  }
  totalKept += kept; totalDropped += dropped;
  if (dropped > 0) {
    groupsWithDupes++;
    clusterStats.push({ key, kept, dropped });
  }
}

process.stdout.write(`[dedupe] groups: ${groups.size}, groups with dupes: ${groupsWithDupes}\n`);
process.stdout.write(`[dedupe] kept: ${totalKept}, would drop: ${totalDropped}\n`);

// Print top-10 most affected groups
clusterStats.sort((a, b) => b.dropped - a.dropped);
process.stdout.write('\n[dedupe] top affected (agent|project): kept / dropped\n');
for (const c of clusterStats.slice(0, 10)) {
  process.stdout.write(`  ${c.key.padEnd(40)}  kept=${c.kept}  dropped=${c.dropped}\n`);
}

// Print a sample of dup pairs (10 random) to sanity check
process.stdout.write('\n[dedupe] sample of dup pairs (kept ← dropped):\n');
const sample = toDelete.slice(0, Math.min(10, toDelete.length));
for (const d of sample) {
  const ki = (d.keptIntent || '').slice(0, 70);
  const di = (d.dropIntent || '').slice(0, 70);
  const kd = d.keptDate.replace('T', ' ').slice(0, 19);
  const dd = d.dropDate.replace('T', ' ').slice(0, 19);
  process.stdout.write(`  via=${(d.via?.via || '?').padEnd(12)}\n`);
  process.stdout.write(`    KEEP ${kd} ${ki}\n`);
  process.stdout.write(`    DROP ${dd} ${di}\n`);
}

if (!APPLY) {
  process.stdout.write(`\n[dedupe] dry run — pass --apply to actually delete ${toDelete.length} rows.\n`);
  db.close();
  process.exit(0);
}

if (toDelete.length === 0) {
  process.stdout.write('\n[dedupe] nothing to do.\n');
  db.close();
  process.exit(0);
}

// Apply: delete from SQLite (single transaction) then from Qdrant
const ids = toDelete.map((d) => d.id);
const stmt = db.prepare('DELETE FROM observations WHERE id = ?');
const tx = db.transaction((idList) => {
  for (const id of idList) stmt.run(id);
});
const sqlStart = Date.now();
tx.immediate(ids);
process.stdout.write(`\n[dedupe] SQLite: deleted ${ids.length} rows in ${Date.now() - sqlStart}ms\n`);

// Verify
const remaining = db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
process.stdout.write(`[dedupe] SQLite: ${remaining} rows remain (was ${rows.length})\n`);
db.close();

// Qdrant delete (batched in groups of 200 to keep request bodies reasonable)
let qdrantDropped = 0;
let qdrantFailed = 0;
const BATCH = 200;
for (let i = 0; i < ids.length; i += BATCH) {
  const batch = ids.slice(i, i + BATCH);
  const code = await qdrantDelete(batch);
  if (code && code >= 200 && code < 300) qdrantDropped += batch.length;
  else qdrantFailed += batch.length;
}
process.stdout.write(`[dedupe] Qdrant: deleted ${qdrantDropped}, failed ${qdrantFailed}\n`);
process.stdout.write('[dedupe] done.\n');
