#!/usr/bin/env node
/**
 * Dedup digests by embedding similarity, scoped to same-day.
 *
 * Digests are intentionally per-date snapshots, so cross-day "duplicates"
 * are meaningful and must NOT be merged. Within a single date, however,
 * LLM rewordings produce genuine duplicates — e.g. the LLM splits one
 * day's observations across multiple chunked prompts and returns two
 * digests with near-identical content under different themes.
 *
 * Threshold rationale: digests share more project vocabulary than
 * insights (every digest mentions the same toolchain, paths, agents),
 * so the noise floor is higher. Empirically, 0.97 isolates true LLM
 * rewordings without merging genuinely-different work on the same day.
 *
 * Merge rule per cluster:
 *   - Winner = longest-summary digest, ties broken by highest quality
 *   - Loser observation_ids unioned into winner
 *   - Loser agents and files_touched unioned
 *   - Loser rows deleted from SQLite + Qdrant
 *
 * Usage:
 *   node scripts/dedup-digests-by-embedding.js --dry-run
 *   node scripts/dedup-digests-by-embedding.js --execute [--threshold 0.97]
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/live-logging/SafeDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(REPO_ROOT, '.observations', 'observations.db');
const QDRANT_BASE = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'digests';

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const thresholdArg = args.find((a) => a.startsWith('--threshold'));
const THRESHOLD = thresholdArg
  ? parseFloat(thresholdArg.split('=')[1] ?? args[args.indexOf(thresholdArg) + 1])
  : 0.97;

const QUALITY_RANK = { high: 3, normal: 2, low: 1 };

function log(msg) {
  process.stderr.write(`[dedup-digests] ${msg}\n`);
}

async function fetchAllPoints() {
  const all = [];
  let offset = null;
  while (true) {
    const body = { limit: 500, with_payload: true, with_vector: true };
    if (offset) body.offset = offset;
    const res = await fetch(`${QDRANT_BASE}/collections/${COLLECTION}/points/scroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Qdrant scroll failed: ${res.status}`);
    const data = await res.json();
    const pts = data.result?.points ?? [];
    all.push(...pts);
    offset = data.result?.next_page_offset;
    if (!offset || pts.length === 0) break;
  }
  return all;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Greedy pairwise clustering, scoped to same date.
 */
function clusterByDateAndCosine(points, threshold) {
  const byDate = new Map();
  for (const p of points) {
    const date = p.payload?.date;
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(p);
  }

  const allPairs = [];
  for (const [date, group] of byDate) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const sim = cosine(group[i].vector, group[j].vector);
        if (sim >= threshold) {
          allPairs.push({ a: group[i], b: group[j], sim, date });
        }
      }
    }
  }
  allPairs.sort((x, y) => y.sim - x.sim);

  const rootOf = new Map();
  const clusters = new Map();
  for (const { a, b } of allPairs) {
    const ra = rootOf.get(a.id);
    const rb = rootOf.get(b.id);
    if (ra && rb) continue;
    if (ra) {
      rootOf.set(b.id, ra);
      clusters.get(ra).push(b);
    } else if (rb) {
      rootOf.set(a.id, rb);
      clusters.get(rb).push(a);
    } else {
      rootOf.set(a.id, a.id);
      rootOf.set(b.id, a.id);
      clusters.set(a.id, [a, b]);
    }
  }
  return [...clusters.values()];
}

async function deleteQdrantPoint(id) {
  const res = await fetch(`${QDRANT_BASE}/collections/${COLLECTION}/points/delete?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points: [id] }),
  });
  if (!res.ok) throw new Error(`Qdrant delete failed for ${id}: ${res.status}`);
}

function parseJsonArray(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

async function main() {
  log(`mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}, threshold: ${THRESHOLD}`);

  if (!fs.existsSync(DB_PATH)) {
    log(`DB not found at ${DB_PATH}`);
    process.exit(1);
  }

  const points = await fetchAllPoints();
  log(`Qdrant points: ${points.length}`);
  if (points.length === 0) return;

  const clusters = clusterByDateAndCosine(points, THRESHOLD);
  log(`Same-day duplicate clusters: ${clusters.length}`);
  if (clusters.length === 0) return;

  const db = openDatabase(DB_PATH);
  const getRow = db.prepare(`
    SELECT id, date, theme, summary, observation_ids, agents, files_touched, quality, created_at, metadata
    FROM digests WHERE id = ?
  `);
  const updateWinner = db.prepare(`
    UPDATE digests
    SET observation_ids = ?, agents = ?, files_touched = ?, summary = ?, quality = ?, created_at = ?
    WHERE id = ?
  `);
  const deleteLoser = db.prepare('DELETE FROM digests WHERE id = ?');

  let totalLosers = 0;
  for (const cluster of clusters) {
    const rows = cluster.map((p) => ({ point: p, row: getRow.get(p.id) })).filter((r) => r.row);
    if (rows.length < 2) continue;

    rows.sort((a, b) => {
      const lenDiff = (b.row.summary?.length ?? 0) - (a.row.summary?.length ?? 0);
      if (lenDiff !== 0) return lenDiff;
      const qDiff = (QUALITY_RANK[b.row.quality] ?? 0) - (QUALITY_RANK[a.row.quality] ?? 0);
      if (qDiff !== 0) return qDiff;
      return new Date(b.row.created_at) - new Date(a.row.created_at);
    });

    const winner = rows[0];
    const losers = rows.slice(1);

    const oidUnion = new Set();
    const agentUnion = new Set();
    const fileUnion = new Set();
    let bestQuality = winner.row.quality ?? 'normal';
    let mostRecentCreated = winner.row.created_at;

    for (const r of [winner, ...losers]) {
      for (const oid of parseJsonArray(r.row.observation_ids)) oidUnion.add(oid);
      for (const a of parseJsonArray(r.row.agents)) agentUnion.add(a);
      for (const f of parseJsonArray(r.row.files_touched)) fileUnion.add(f);
      if ((QUALITY_RANK[r.row.quality] ?? 0) > (QUALITY_RANK[bestQuality] ?? 0)) {
        bestQuality = r.row.quality;
      }
      if (r.row.created_at > mostRecentCreated) mostRecentCreated = r.row.created_at;
    }

    log(`\nCluster of ${rows.length} on ${winner.row.date}:`);
    log(`  WINNER: "${winner.row.theme}" (${winner.row.summary?.length ?? 0} chars, q=${winner.row.quality})`);
    for (const l of losers) {
      log(`  LOSER:  "${l.row.theme}" (${l.row.summary?.length ?? 0} chars, q=${l.row.quality})`);
    }
    log(`  Merged: ${oidUnion.size} obs, ${agentUnion.size} agents, ${fileUnion.size} files`);

    if (!DRY_RUN) {
      const txn = db.transaction(() => {
        updateWinner.run(
          JSON.stringify([...oidUnion]),
          JSON.stringify([...agentUnion]),
          JSON.stringify([...fileUnion]),
          winner.row.summary,
          bestQuality,
          mostRecentCreated,
          winner.row.id
        );
        for (const l of losers) deleteLoser.run(l.row.id);
      });
      txn();
      for (const l of losers) {
        try {
          await deleteQdrantPoint(l.row.id);
        } catch (err) {
          log(`  WARNING: Qdrant delete failed for ${l.row.id}: ${err.message}`);
        }
      }
    }

    totalLosers += losers.length;
  }

  if (!DRY_RUN) db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  log(`\n${DRY_RUN ? 'Would merge' : 'Merged'} ${totalLosers} duplicate(s) into ${clusters.length} winner(s).`);
}

main().catch((err) => {
  process.stderr.write(`[dedup-digests] FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
