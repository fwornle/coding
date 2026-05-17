#!/usr/bin/env node

/**
 * One-shot insight consolidation per .data/insight-consolidation-plan.md.
 *
 * Applies the 8 classified clusters to the live insights table:
 *
 *   - MERGE  → canonical absorbs others' digest_ids; absorbed rows are deleted.
 *   - FACET  → cross-link survivors via metadata.relatedInsightIds. No deletes.
 *
 * Default = dry run. --apply opens an IMMEDIATE transaction and writes.
 *
 * Usage:
 *   node scripts/consolidate-insight-clusters.mjs
 *   node scripts/consolidate-insight-clusters.mjs --apply
 *   node scripts/consolidate-insight-clusters.mjs --apply --cleanup-qdrant
 *
 * Qdrant cleanup is optional and best-effort — deleted insight points in the
 * `insights` collection will otherwise become orphaned (still searchable but
 * pointing at a missing SQLite row). The next full re-embed run cleans up
 * automatically; the flag is for users who want immediate cleanup.
 */

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_PATH = resolve(ROOT, '.observations/observations.db');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const APPLY = !!args.apply;
const CLEANUP_QDRANT = !!args['cleanup-qdrant'];

const out = (msg = '') => process.stdout.write(`${msg}\n`);
const err = (msg) => process.stderr.write(`${msg}\n`);

// --- Planned operations (from .data/insight-consolidation-plan.md) ----

/** @type {({kind:'merge', canonicalIdPrefix:string, absorbIdPrefixes:string[], reason:string} | {kind:'facet', memberIdPrefixes:string[], parentTopic:string, reason:string})[]} */
const PLAN = [
  // Cluster 1 — Knowledge Context Injection: 1 merge + 3 retained facets
  {
    kind: 'merge',
    canonicalIdPrefix: 'df7d4f50',
    absorbIdPrefixes: ['0cbb482a'],
    reason: 'Embedding Pipeline (Phase 28) is a weak, partial-scope duplicate of Knowledge Context Injection — Embedding Pipeline',
  },
  {
    kind: 'facet',
    memberIdPrefixes: ['df7d4f50', '6f29d110', '37043e75'],
    parentTopic: 'Knowledge Context Injection System',
    reason: 'Three distinct facets of the v6.0 knowledge-injection system: embedding pipeline, hook+agent adapters, retrieval relevance',
  },

  // Cluster 2 — ETM: 3 → 1
  {
    kind: 'merge',
    canonicalIdPrefix: 'e843400b',
    absorbIdPrefixes: ['b4710bf3', '4bf35389'],
    reason: 'Three regenerations of the same ETM daemon description — same subsystem, drifting topic name',
  },

  // Cluster 3 — LLM CLI Proxy: 2 → 1
  {
    kind: 'merge',
    canonicalIdPrefix: 'dec1c5e6',
    absorbIdPrefixes: ['722fb941'],
    reason: 'LLM CLI Proxy is a narrower-scope version of LLM CLI Proxy — VPN/Corporate Network Detection',
  },

  // Cluster 4 — System Health Dashboard Frontend: facet
  {
    kind: 'facet',
    memberIdPrefixes: ['59be9148', '5871c5a8'],
    parentTopic: 'System Health Dashboard — Frontend',
    reason: 'Architecture vs build/deploy facets — distinct concerns, both worth keeping',
  },

  // Cluster 5 — Observations API Server: 2 → 1
  {
    kind: 'merge',
    canonicalIdPrefix: 'baca2d4b',
    absorbIdPrefixes: ['c8e5cc24'],
    reason: 'Host-API Pattern and Host-Side HTTP Wrapper describe the same observations-api-server.mjs',
  },

  // Cluster 6 — Observation Pipeline: 2 → 1
  {
    kind: 'merge',
    canonicalIdPrefix: '82a5d333',
    absorbIdPrefixes: ['3110b272'],
    reason: 'Both insights cover ObservationWriter+SQLite — same scope, different emphasis',
  },

  // Cluster 7 — MCP Server Configuration: 2 → 1
  {
    kind: 'merge',
    canonicalIdPrefix: 'b19446bf',
    absorbIdPrefixes: ['11c6af1b'],
    reason: 'Same MCP server config topic, agent-scoping is implicit in the canonical version',
  },

  // Cluster 8 — Observations Dashboard: 2 → 1
  {
    kind: 'merge',
    canonicalIdPrefix: '7861723a',
    absorbIdPrefixes: ['c3c65d92'],
    reason: 'Auto-refresh is a feature of the dashboard, not a separate concept',
  },
];

// --- helpers ---------------------------------------------------------

const db = new Database(DB_PATH, { readonly: !APPLY });

function findFullId(prefix) {
  const row = db
    .prepare('SELECT id FROM insights WHERE id LIKE ?')
    .get(`${prefix}%`);
  if (!row) throw new Error(`No insight matched prefix ${prefix}`);
  return row.id;
}

function loadInsight(id) {
  return db
    .prepare(
      'SELECT id, topic, confidence, digest_ids, metadata, last_updated FROM insights WHERE id = ?'
    )
    .get(id);
}

function parseJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function fmt(insight) {
  const digests = parseJson(insight.digest_ids, []).length;
  return `${insight.id.slice(0, 8)} (conf ${insight.confidence}, ${digests} digests) — ${insight.topic}`;
}

// --- resolve plan to full ids + concrete actions ---------------------

const actions = [];

for (const op of PLAN) {
  if (op.kind === 'merge') {
    const canonicalId = findFullId(op.canonicalIdPrefix);
    const canonical = loadInsight(canonicalId);
    const absorbIds = op.absorbIdPrefixes.map(findFullId);
    const absorb = absorbIds.map(loadInsight);

    const canonicalDigests = parseJson(canonical.digest_ids, []);
    const allDigests = new Set(canonicalDigests);
    for (const a of absorb) {
      for (const id of parseJson(a.digest_ids, [])) allDigests.add(id);
    }

    actions.push({
      kind: 'merge',
      canonical,
      absorb,
      mergedDigestIds: [...allDigests],
      reason: op.reason,
    });
  } else if (op.kind === 'facet') {
    const ids = op.memberIdPrefixes.map(findFullId);
    const members = ids.map(loadInsight);
    actions.push({
      kind: 'facet',
      members,
      parentTopic: op.parentTopic,
      reason: op.reason,
    });
  }
}

// --- report ----------------------------------------------------------

out(`\n=== Insight consolidation ${APPLY ? '— APPLY MODE' : '(dry run)'} ===`);
out(`DB: ${DB_PATH}\n`);

const insightsBefore = db.prepare('SELECT COUNT(*) AS n FROM insights').get().n;
out(`Insights before: ${insightsBefore}\n`);

let deletes = 0;
let updates = 0;
let facetWrites = 0;

for (const a of actions) {
  if (a.kind === 'merge') {
    out(`MERGE — ${a.reason}`);
    out(`  canonical: ${fmt(a.canonical)}`);
    for (const x of a.absorb) {
      out(`  absorb:    ${fmt(x)}`);
    }
    out(
      `  result:    ${a.canonical.id.slice(0, 8)} keeps summary, digests grow ${parseJson(a.canonical.digest_ids, []).length} -> ${a.mergedDigestIds.length}\n`
    );
    deletes += a.absorb.length;
    updates += 1;
  } else {
    out(`FACET — ${a.reason}`);
    out(`  parent topic: ${a.parentTopic}`);
    for (const m of a.members) out(`  facet:  ${fmt(m)}`);
    out(`  result: cross-link via metadata.relatedInsightIds + parentTopic\n`);
    facetWrites += a.members.length;
  }
}

out(
  `Will: delete ${deletes} insight(s), update ${updates} canonical(s), write facet metadata on ${facetWrites} insight(s)`
);
out(`Insights after: ${insightsBefore - deletes}\n`);

if (!APPLY) {
  out('Dry run only. Re-run with --apply to write.\n');
  db.close();
  process.exit(0);
}

// --- apply ----------------------------------------------------------

const now = new Date().toISOString();
const stmts = {
  update: db.prepare(
    "UPDATE insights SET digest_ids = ?, last_updated = ?, metadata = json_patch(COALESCE(metadata, '{}'), ?) WHERE id = ?"
  ),
  del: db.prepare('DELETE FROM insights WHERE id = ?'),
  facetUpdate: db.prepare(
    "UPDATE insights SET last_updated = ?, metadata = json_patch(COALESCE(metadata, '{}'), ?) WHERE id = ?"
  ),
};

const deletedIds = [];

const tx = db.transaction(() => {
  for (const a of actions) {
    if (a.kind === 'merge') {
      const patch = JSON.stringify({
        absorbed: a.absorb.map((x) => ({ id: x.id, topic: x.topic })),
        consolidatedAt: now,
        consolidationReason: a.reason,
      });
      stmts.update.run(
        JSON.stringify(a.mergedDigestIds),
        now,
        patch,
        a.canonical.id
      );
      for (const x of a.absorb) {
        stmts.del.run(x.id);
        deletedIds.push(x.id);
      }
    } else {
      // FACET: each member gets relatedInsightIds = [other members' ids] + parentTopic.
      for (const m of a.members) {
        const others = a.members.filter((x) => x.id !== m.id).map((x) => x.id);
        const patch = JSON.stringify({
          parentTopic: a.parentTopic,
          relatedInsightIds: others,
          facetGroupedAt: now,
        });
        stmts.facetUpdate.run(now, patch, m.id);
      }
    }
  }
});

tx();

const insightsAfter = db.prepare('SELECT COUNT(*) AS n FROM insights').get().n;
out(`SQLite consolidation applied. Insights: ${insightsBefore} -> ${insightsAfter}\n`);

db.close();

// --- optional Qdrant cleanup ----------------------------------------

if (CLEANUP_QDRANT && deletedIds.length > 0) {
  out(`Cleaning up ${deletedIds.length} orphan Qdrant points...`);
  const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
  try {
    const res = await fetch(`${qdrantUrl}/collections/insights/points/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: deletedIds }),
    });
    if (res.ok) {
      out('Qdrant points deleted.');
    } else {
      const txt = await res.text();
      err(`Qdrant cleanup failed (non-fatal): ${res.status} ${txt}`);
    }
  } catch (e) {
    err(`Qdrant cleanup error (non-fatal): ${e.message}`);
  }
}

out('Done.\n');
