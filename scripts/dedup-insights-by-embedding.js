#!/usr/bin/env node
/**
 * Dedup insights by embedding similarity.
 *
 * Reads all rows from the insights table, looks up each row's vector
 * in Qdrant, and clusters near-duplicates by cosine similarity.
 *
 * Merge rule per cluster:
 *   - Winner = row whose summary is longest (richest content)
 *   - Loser digest_ids are unioned into the winner's digest_ids
 *   - Winner's last_updated is bumped to now
 *   - Loser rows are deleted from the SQLite table
 *   - Loser points are deleted from Qdrant
 *
 * Usage:
 *   node scripts/dedup-insights-by-embedding.js --dry-run
 *   node scripts/dedup-insights-by-embedding.js --execute [--threshold 0.90]
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/live-logging/SafeDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(REPO_ROOT, '.observations', 'observations.db');
const QDRANT_BASE = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'insights';

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const thresholdArg = args.find((a) => a.startsWith('--threshold'));
// Empirical: MiniLM-L6-v2 cosine for "any two project docs" floors ~0.89-0.92,
// so genuine near-duplicates only emerge above ~0.93. Lower thresholds chain
// unrelated topics together via single-linkage.
const THRESHOLD = thresholdArg
  ? parseFloat(thresholdArg.split('=')[1] ?? args[args.indexOf(thresholdArg) + 1])
  : 0.93;

function log(msg) {
  process.stderr.write(`[dedup-insights] ${msg}\n`);
}

async function fetchAllPoints() {
  const res = await fetch(`${QDRANT_BASE}/collections/${COLLECTION}/points/scroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 1000, with_payload: true, with_vector: true }),
  });
  if (!res.ok) throw new Error(`Qdrant scroll failed: ${res.status}`);
  const data = await res.json();
  return data.result?.points ?? [];
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
 * Greedy pairwise merging: sort all pairs by similarity descending, walk top-down,
 * merge each pair where both endpoints are still active and sim >= threshold.
 *
 * This avoids the chaining problem of single-linkage clustering, where
 * transitive similarity (A~B, B~C) merges A and C even if A~C is below
 * threshold. With MiniLM scores clustering tightly across an entire
 * project's docs, single-linkage collapses everything into one group.
 *
 * Returns an array of clusters (>=2 points each). The first point in each
 * cluster is the "root" that absorbed the others.
 */
function clusterByCosine(points, threshold) {
  const pairs = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const sim = cosine(points[i].vector, points[j].vector);
      if (sim >= threshold) {
        pairs.push({ a: points[i], b: points[j], sim });
      }
    }
  }
  pairs.sort((x, y) => y.sim - x.sim);

  // Map each absorbed point to its cluster's root id.
  const rootOf = new Map();
  const clusters = new Map();
  for (const { a, b } of pairs) {
    const ra = rootOf.get(a.id);
    const rb = rootOf.get(b.id);
    if (ra && rb) continue; // already absorbed elsewhere
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

async function main() {
  log(`mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}, threshold: ${THRESHOLD}`);

  if (!fs.existsSync(DB_PATH)) {
    log(`DB not found at ${DB_PATH}`);
    process.exit(1);
  }

  const points = await fetchAllPoints();
  log(`Qdrant points: ${points.length}`);
  if (points.length === 0) return;

  const clusters = clusterByCosine(points, THRESHOLD);
  log(`Duplicate clusters found: ${clusters.length}`);
  if (clusters.length === 0) {
    log('No duplicates above threshold. Done.');
    return;
  }

  const db = openDatabase(DB_PATH);
  const getRow = db.prepare('SELECT id, topic, summary, confidence, digest_ids, last_updated, created_at FROM insights WHERE id = ?');
  const updateWinner = db.prepare(`
    UPDATE insights
    SET digest_ids = ?, summary = ?, confidence = ?, last_updated = ?
    WHERE id = ?
  `);
  const deleteLoser = db.prepare('DELETE FROM insights WHERE id = ?');

  let totalLosers = 0;
  for (const cluster of clusters) {
    const rows = cluster.map((p) => ({ point: p, row: getRow.get(p.id) })).filter((r) => r.row);
    if (rows.length < 2) continue;

    // Pick winner: longest summary, ties broken by highest confidence then most recent
    rows.sort((a, b) => {
      const lenDiff = (b.row.summary?.length ?? 0) - (a.row.summary?.length ?? 0);
      if (lenDiff !== 0) return lenDiff;
      const confDiff = (b.row.confidence ?? 0) - (a.row.confidence ?? 0);
      if (confDiff !== 0) return confDiff;
      return new Date(b.row.last_updated) - new Date(a.row.last_updated);
    });

    const winner = rows[0];
    const losers = rows.slice(1);

    // Union digest_ids
    const unionedIds = new Set();
    for (const r of [winner, ...losers]) {
      try {
        const ids = JSON.parse(r.row.digest_ids || '[]');
        for (const id of ids) unionedIds.add(id);
      } catch { /* tolerate corrupt JSON */ }
    }

    // Pick highest confidence across cluster
    const maxConfidence = Math.max(...rows.map((r) => r.row.confidence ?? 0));

    log(`\nCluster of ${rows.length}:`);
    log(`  WINNER: "${winner.row.topic}" (${winner.row.summary.length} chars, conf=${winner.row.confidence})`);
    for (const l of losers) {
      log(`  LOSER:  "${l.row.topic}" (${l.row.summary.length} chars, conf=${l.row.confidence})`);
    }
    log(`  Merged digest_ids: ${unionedIds.size} unique`);

    if (!DRY_RUN) {
      const txn = db.transaction(() => {
        updateWinner.run(
          JSON.stringify([...unionedIds]),
          winner.row.summary,
          maxConfidence,
          new Date().toISOString(),
          winner.row.id
        );
        for (const l of losers) {
          deleteLoser.run(l.row.id);
        }
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

  if (!DRY_RUN) {
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
  db.close();

  log(`\n${DRY_RUN ? 'Would merge' : 'Merged'} ${totalLosers} duplicate(s) into ${clusters.length} winner(s).`);
}

main().catch((err) => {
  process.stderr.write(`[dedup-insights] FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
