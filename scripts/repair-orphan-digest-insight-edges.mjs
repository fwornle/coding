#!/usr/bin/env node

/**
 * Phase 59 Plan 04 — Two-layer one-shot orphan-repair script.
 *
 * Layer 1 (graph orphan repair, km-core REST view at :3848):
 *   Walks `GET ${KMCORE_REST_BASE}/api/v1/graph/orphans` and dispatches by
 *   entityType. Digest orphans get one `derivedFrom` edge per resolvable
 *   `metadata.observation_ids` entry. Insight orphans get one
 *   `synthesizedFrom` edge per resolvable `metadata.digest_ids` entry PLUS a
 *   `has_insight` edge from the team's Project anchor (the writer-side
 *   `_resolveAnchorId` patch in 955617a1a is the canonical fix for newly-
 *   minted Insights; Layer 1 backfills pre-existing orphan Insights).
 *
 *   PORT DISCIPLINE (load-bearing — see CONTEXT.md D-04 / D-05): Phase 59
 *   targets the km-core REST view at `:3848` served by
 *   `integrations/mcp-server-semantic-analysis/src/sse-server.ts:46-103`.
 *   This is the same graph the writer (consolidator) emits into and the
 *   same graph the unified-viewer reads. The analog script
 *   `scripts/purge-kmcore-orphans.mjs` defaults to the obs-api daemon's
 *   port instead, which is a DIFFERENT graph (probed 2026-06-16: km-core
 *   REST → 840/7 orphans, obs-api → 869/13 orphans). Do NOT silently fall
 *   back to the obs-api port — see threat T-02 in PLAN frontmatter.
 *
 * Layer 2 (cold-store dangling-ref scrub):
 *   Reads `.data/observation-export/digests.json` and
 *   `.data/observation-export/observations.json`. Builds a Set of known
 *   observation uuids, filters each Digest's `obs_ids[]` /
 *   `observation_ids[]` / `observationIds[]` references against the Set,
 *   atomically rewrites `digests.json` via tmp+rename with a timestamped
 *   `.bak-<ISO-ts>` backup. Closes the folded todo
 *   `2026-05-23-orphan-digest-observation-refs.md`.
 *
 * Usage:
 *   node scripts/repair-orphan-digest-insight-edges.mjs [--dry-run] [--layer=graph|cold-store|both]
 *
 *   Default is LIVE. Default layer is `both` (Layer 1 first, then Layer 2).
 *   `--dry-run` reads everything but performs zero mutations.
 *
 * Exit codes:
 *   0   success — Layer 1 and/or Layer 2 ran clean
 *   1   repair-phase fatal — Layer 1 error-budget exceeded (5% across ≥20 attempts)
 *   2   pre-flight failure — KMCORE_REST_BASE unreachable, or cold-store file missing
 *   3   uncaught exception in main()
 *
 * @module scripts/repair-orphan-digest-insight-edges
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const KMCORE_REST_BASE = process.env.KMCORE_REST_BASE || 'http://localhost:3848';

// 5% error budget — mirrors `scripts/backfill-insight-mentions.mjs:75-76`.
// Per-edge addRelation failures are non-fatal; the loop aborts only when
// the aggregate failure ratio exceeds this threshold AND the attempted
// population is statistically meaningful.
const ERROR_BUDGET_RATIO = 0.05;
const ERROR_BUDGET_MIN_POPULATION = 20;

// metadata.source tag for every emitted edge — distinct from
// 'observation-consolidator' (writer-path) and 'backfill-insight-mentions'
// (Phase 58 mentions backfill) so every edge from this script is traceable.
const EDGE_SOURCE = 'repair-orphan-digest-insight-edges';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIGESTS_TARGET = path.join(ROOT, '.data', 'observation-export', 'digests.json');
const OBSERVATIONS_REF = path.join(ROOT, '.data', 'observation-export', 'observations.json');

// ────────────────────────────────────────────────────────────────────────────
// Logging — per CLAUDE.md `no-console-log`, only process.stderr.write
// ────────────────────────────────────────────────────────────────────────────

function log(msg) {
  process.stderr.write('[repair-orphans] ' + msg + '\n');
}

// ────────────────────────────────────────────────────────────────────────────
// Session log — incremental append so a mid-run crash leaves partial evidence
// ────────────────────────────────────────────────────────────────────────────

const sessionLog = [];
const sessionTs = new Date().toISOString().replace(/[:.]/g, '-');
const sessionLogPath = path.join(ROOT, '.data', `repair-orphan-digest-insight-edges-${sessionTs}.json`);

function appendSession(record) {
  sessionLog.push(record);
  try {
    fs.writeFileSync(sessionLogPath, JSON.stringify(sessionLog, null, 2));
  } catch (err) {
    process.stderr.write(`[repair-orphans] session log write failed: ${err.message}\n`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CLI parsing — `--key=value` convention from purge-knowledge-entities.js:73-102
// ────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    dryRun: false,
    layer: 'both',
    help: false,
  };
  for (const a of argv) {
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--layer=')) {
      const v = a.slice('--layer='.length);
      if (v === 'graph' || v === 'cold-store' || v === 'both') {
        args.layer = v;
      } else {
        process.stderr.write(`Invalid --layer value: ${v} (expected graph|cold-store|both)\n`);
        process.exit(2);
      }
    }
  }
  return args;
}

function printUsage() {
  process.stderr.write(
    [
      'Usage: node scripts/repair-orphan-digest-insight-edges.mjs [flags]',
      '',
      'Two-layer one-shot orphan-repair for km-core graph + cold-store digests.',
      '',
      'Flags:',
      '  --dry-run                       Read+probe only, NO mutations',
      '  --layer=graph|cold-store|both   Default: both',
      '  --help, -h                      Show this usage and exit 0',
      '',
      'Env:',
      '  KMCORE_REST_BASE                Default: http://localhost:3848',
      '',
      'Exit codes: 0 ok | 1 error-budget exceeded | 2 pre-flight failure | 3 uncaught',
      '',
    ].join('\n'),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pre-flight gate — probe km-core REST at KMCORE_REST_BASE
// ────────────────────────────────────────────────────────────────────────────

async function preflightGraph() {
  try {
    const probe = await fetch(`${KMCORE_REST_BASE}/api/v1/stats`);
    if (!probe.ok) {
      process.stderr.write(`KMCORE_REST_BASE unreachable: ${KMCORE_REST_BASE} (HTTP ${probe.status})\n`);
      process.exit(2);
    }
    const body = await probe.json();
    const s = body.data || {};
    // /api/v1/stats response shape varies by km-core version: prefer node/edge
    // count keys with both nodeCount and nodes fallbacks for portability.
    const nodes = s.nodeCount ?? s.nodes ?? '?';
    const edges = s.edgeCount ?? s.edges ?? '?';
    const orphans = s.orphanCount ?? s.orphans ?? '?';
    log(`pre-flight OK at ${KMCORE_REST_BASE}: nodes=${nodes} edges=${edges} orphans=${orphans}`);
    return s;
  } catch (err) {
    process.stderr.write(`KMCORE_REST_BASE unreachable: ${KMCORE_REST_BASE} (${err.message})\n`);
    process.exit(2);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// REST helpers — findRelations probe + addRelation write
// ────────────────────────────────────────────────────────────────────────────

/**
 * Probe-before-write per Shared Pattern A. Returns true if at least one
 * matching relation already exists; the caller skips the write.
 * Non-fatal on probe failure — fall through and risk a duplicate edge
 * over dropping the write (matches OW.js:496-501 precedent).
 */
async function relationExists({ from, to, type }) {
  try {
    const url = `${KMCORE_REST_BASE}/api/v1/relations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&type=${encodeURIComponent(type)}`;
    const res = await fetch(url);
    if (!res.ok) return false;
    const body = await res.json();
    const items = Array.isArray(body.data) ? body.data : [];
    return items.length > 0;
  } catch (err) {
    log(`dedup probe ${from.slice(0, 8)}->${to.slice(0, 8)} (${type}) failed (non-fatal): ${err.message}`);
    return false;
  }
}

/**
 * POST /api/v1/relations with {from, to, relationType, metadata}.
 * Body shape per link-collective-to-projects.mjs:39-48 — REST surface uses
 * `relationType` (NOT the in-process kmStore `type` key). Call sites pass
 * canonical edge labels: relationType: 'derivedFrom' (Digest → Observation),
 * relationType: 'synthesizedFrom' (Insight → Digest),
 * relationType: 'has_insight' (Project → Insight).
 *
 * Returns true on HTTP 2xx, false otherwise. Caller handles error-budget.
 */
async function addRelation({ from, to, type, metadata, dryRun }) {
  if (dryRun) {
    log(`DRY-RUN would addRelation ${from.slice(0, 8)} -> ${to.slice(0, 8)} (${type})`);
    return true;
  }
  try {
    const res = await fetch(`${KMCORE_REST_BASE}/api/v1/relations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, relationType: type, metadata }),
    });
    if (!res.ok) {
      const text = await res.text();
      log(`addRelation ${from.slice(0, 8)} -> ${to.slice(0, 8)} (${type}) HTTP ${res.status}: ${text.slice(0, 120)}`);
      return false;
    }
    return true;
  } catch (err) {
    log(`addRelation ${from.slice(0, 8)} -> ${to.slice(0, 8)} (${type}) threw: ${err.message}`);
    return false;
  }
}

/**
 * Resolve a legacy id (system='A') to a minted km-core id.
 *
 * IMPORTANT: The km-core REST surface strips `legacyId` on the wire
 * (lib/km-core/src/adapters/wire-serializers.ts — `entityToWire` only
 * exposes id/name/entityType/layer/description/metadata/ontologyClass).
 * No `/api/v1/entities/legacy/A/<id>` endpoint exists.
 *
 * Strategy: try direct fetch by minted id first — if the legacy id IS
 * the minted id (rare but possible for entities ingested without the
 * legacyId distinction), GET /entities/:id returns the entity. Otherwise
 * the wire surface cannot resolve legacy ids — return null (per D-02.2
 * skip-and-log; the writer-path emission inside ObservationConsolidator
 * is the canonical resolver for newly-minted entities).
 */
async function resolveLegacyId(legacyId) {
  if (!legacyId) return null;
  try {
    const res = await fetch(`${KMCORE_REST_BASE}/api/v1/entities/${encodeURIComponent(legacyId)}`);
    if (!res.ok) return null;
    const body = await res.json();
    return body.data || null;
  } catch (err) {
    log(`resolveLegacyId ${legacyId.slice(0, 8)} threw: ${err.message}`);
    return null;
  }
}

/**
 * Find the Project anchor entity by name. Uses the same
 * findByOntologyClass-style query the writer uses at OC.js:681-682.
 *
 * Case tolerance: the Project anchor's canonical `name` is title-case
 * (e.g. "Coding"), while metadata.project / metadata.team are usually
 * lowercase ("coding"). Match case-insensitively to bridge the convention.
 */
async function findProjectAnchor(projectName) {
  if (!projectName) return null;
  try {
    const res = await fetch(`${KMCORE_REST_BASE}/api/v1/entities?ontologyClass=Project&limit=100`);
    if (!res.ok) return null;
    const body = await res.json();
    const items = Array.isArray(body.data) ? body.data : [];
    const lowered = projectName.toLowerCase();
    return (
      items.find((p) => p.name === projectName) ||
      items.find((p) => (p.name || '').toLowerCase() === lowered) ||
      null
    );
  } catch (err) {
    log(`findProjectAnchor(${projectName}) threw: ${err.message}`);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Layer 1 — graph orphan repair (km-core REST view at :3848)
// ────────────────────────────────────────────────────────────────────────────

async function processGraphLayer({ dryRun }) {
  log(`Layer 1 (graph orphan repair) — ${dryRun ? 'DRY-RUN' : 'LIVE'}`);

  let orphans;
  try {
    const res = await fetch(`${KMCORE_REST_BASE}/api/v1/graph/orphans`);
    if (!res.ok) {
      log(`Layer 1 abort: /api/v1/graph/orphans HTTP ${res.status}`);
      process.exit(2);
    }
    const body = await res.json();
    orphans = Array.isArray(body.data) ? body.data : [];
  } catch (err) {
    log(`Layer 1 abort: /api/v1/graph/orphans threw: ${err.message}`);
    process.exit(2);
  }
  log(`orphan count: ${orphans.length}`);

  const typeCounts = new Map();
  for (const o of orphans) {
    const t = o.entityType || 'unknown';
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
  }
  for (const [t, n] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${t}: ${n}`);
  }

  let totalAttempts = 0;
  let totalFailures = 0;
  let edgesAddedAggregate = 0;
  const inScopeTypes = new Set(['Digest', 'Insight']);

  for (const orphan of orphans) {
    const eType = orphan.entityType;
    const eId = orphan.id;
    if (!inScopeTypes.has(eType)) {
      log(`skipping orphan ${eId.slice(0, 8)} entityType=${eType} — out of scope`);
      appendSession({ layer: 'graph', entityId: eId, entityType: eType, edgesAdded: 0, errors: [] });
      continue;
    }

    const meta = orphan.metadata || {};
    const record = { layer: 'graph', entityId: eId, entityType: eType, edgesAdded: 0, errors: [] };

    if (eType === 'Digest') {
      const obsIds = Array.isArray(meta.observation_ids) ? meta.observation_ids : [];
      for (const obsId of obsIds) {
        if (!obsId) continue;
        if (obsId === eId) continue; // self-loop guard
        const obsEntity = await resolveLegacyId(obsId);
        if (!obsEntity) {
          log(`derivedFrom: observation ${obsId.slice(0, 8)} not yet persisted, skipping edge`);
          record.errors.push(`unresolved observation ${obsId}`);
          continue;
        }
        const targetId = obsEntity.id;
        const exists = await relationExists({ from: eId, to: targetId, type: 'derivedFrom' });
        if (exists) continue;
        totalAttempts++;
        const ok = await addRelation({
          from: eId,
          to: targetId,
          type: 'derivedFrom',
          metadata: { source: EDGE_SOURCE, addedAt: new Date().toISOString() },
          dryRun,
        });
        if (ok) {
          record.edgesAdded++;
          edgesAddedAggregate++;
        } else {
          totalFailures++;
          record.errors.push(`addRelation derivedFrom -> ${targetId} failed`);
        }
      }
    } else if (eType === 'Insight') {
      // synthesizedFrom edges to digest legacyIds
      const digestIds = Array.isArray(meta.digest_ids) ? meta.digest_ids : [];
      for (const digId of digestIds) {
        if (!digId) continue;
        if (digId === eId) continue; // self-loop guard
        const digEntity = await resolveLegacyId(digId);
        if (!digEntity) {
          log(`synthesizedFrom: digest ${digId.slice(0, 8)} not yet persisted, skipping edge`);
          record.errors.push(`unresolved digest ${digId}`);
          continue;
        }
        const targetId = digEntity.id;
        const exists = await relationExists({ from: eId, to: targetId, type: 'synthesizedFrom' });
        if (exists) continue;
        totalAttempts++;
        const ok = await addRelation({
          from: eId,
          to: targetId,
          type: 'synthesizedFrom',
          metadata: { source: EDGE_SOURCE, addedAt: new Date().toISOString() },
          dryRun,
        });
        if (ok) {
          record.edgesAdded++;
          edgesAddedAggregate++;
        } else {
          totalFailures++;
          record.errors.push(`addRelation synthesizedFrom -> ${targetId} failed`);
        }
      }

      // has_insight re-emission (mirrors OC.js:684-700 pattern)
      const projectName = meta.project || meta.team || 'coding';
      const project = await findProjectAnchor(projectName);
      if (project) {
        const projectId = project.id;
        if (projectId !== eId) {
          const exists = await relationExists({ from: projectId, to: eId, type: 'has_insight' });
          if (!exists) {
            totalAttempts++;
            const ok = await addRelation({
              from: projectId,
              to: eId,
              type: 'has_insight',
              metadata: { source: EDGE_SOURCE, team: projectName, confidence: 1.0 },
              dryRun,
            });
            if (ok) {
              record.edgesAdded++;
              edgesAddedAggregate++;
            } else {
              totalFailures++;
              record.errors.push('addRelation has_insight failed');
            }
          }
        }
      } else {
        log(`has_insight: Project anchor "${projectName}" not found, skipping edge`);
        record.errors.push(`Project anchor ${projectName} not found`);
      }

      // D-05.2: capturedBy belt-and-suspenders is NOT emitted here — the
      // writer-side _resolveAnchorId patch (commit 955617a1a) owns that fix.
      // The orphan-by-definition means no edges exist; we LOG that capturedBy
      // would also be missing but defer to the writer-side fix for re-emission.
      log(`orphan Insight ${eId.slice(0, 8)} also missing capturedBy — writer-side _resolveAnchorId fix owns this; not emitting here per D-05.2`);
    }

    appendSession(record);

    // Error-budget check after every 50 orphans
    if (
      totalAttempts >= ERROR_BUDGET_MIN_POPULATION &&
      totalFailures / totalAttempts > ERROR_BUDGET_RATIO
    ) {
      log(`ERROR BUDGET EXCEEDED at orphan ${eId.slice(0, 8)}: attempts=${totalAttempts} failures=${totalFailures} ratio=${(totalFailures / totalAttempts).toFixed(3)} > ${ERROR_BUDGET_RATIO}`);
      log('aborting Layer 1 — partial session log written');
      return {
        orphansInspected: orphans.length,
        edgesAdded: edgesAddedAggregate,
        attempts: totalAttempts,
        failures: totalFailures,
        aborted: true,
      };
    }
  }

  // End-of-Layer-1 stats verification
  try {
    const res = await fetch(`${KMCORE_REST_BASE}/api/v1/stats`);
    if (res.ok) {
      const body = await res.json();
      const s = body.data || {};
      const nodes = s.nodeCount ?? s.nodes ?? '?';
      const edges = s.edgeCount ?? s.edges ?? '?';
      const orphans = s.orphanCount ?? s.orphans ?? '?';
      log(`Layer 1 post-stats at ${KMCORE_REST_BASE}: nodes=${nodes} edges=${edges} orphans=${orphans}`);
    }
  } catch (err) {
    log(`post-stats fetch failed (non-fatal): ${err.message}`);
  }

  return {
    orphansInspected: orphans.length,
    edgesAdded: edgesAddedAggregate,
    attempts: totalAttempts,
    failures: totalFailures,
    aborted: false,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Layer 2 — cold-store dangling-ref scrub (.data/observation-export/digests.json)
// ────────────────────────────────────────────────────────────────────────────

async function processColdStoreLayer({ dryRun }) {
  log(`Layer 2 (cold-store dangling-ref scrub) — ${dryRun ? 'DRY-RUN' : 'LIVE'}`);

  // Pre-flight: both files must exist
  if (!fs.existsSync(DIGESTS_TARGET)) {
    log(`Layer 2 pre-flight: ${DIGESTS_TARGET} not found`);
    process.exit(2);
  }
  if (!fs.existsSync(OBSERVATIONS_REF)) {
    log(`Layer 2 pre-flight: ${OBSERVATIONS_REF} not found`);
    process.exit(2);
  }

  // Read observations.json and build the known-id Set
  const obsRaw = fs.readFileSync(OBSERVATIONS_REF, 'utf8');
  const obsAll = JSON.parse(obsRaw);
  if (!Array.isArray(obsAll)) {
    log('observations.json root is not an array — refusing');
    process.exit(1);
  }
  const knownObsIds = new Set(obsAll.map((o) => o.id).filter(Boolean));
  log(`observations.json: ${knownObsIds.size} known ids`);

  // Read digests.json
  const digRaw = fs.readFileSync(DIGESTS_TARGET, 'utf8');
  const digAll = JSON.parse(digRaw);
  if (!Array.isArray(digAll)) {
    log('digests.json root is not an array — refusing');
    process.exit(1);
  }
  log(`digests.json: ${digAll.length} entries`);

  let totalDropped = 0;
  let digestsAffected = 0;
  const fieldNameUsage = { observationIds: 0, obs_ids: 0, observation_ids: 0 };

  const newDigests = digAll.map((d) => {
    // Field name tolerance — writer side has used obs_ids, observation_ids,
    // AND observationIds at various times. Detect and preserve whichever
    // shape the entry actually carries. The current cold-store writer uses
    // `observationIds` (camelCase, observed 2026-06-17); older entries may
    // still carry `obs_ids` or `observation_ids` (snake_case).
    let refsField = null;
    if (Array.isArray(d.observationIds)) refsField = 'observationIds';
    else if (Array.isArray(d.obs_ids)) refsField = 'obs_ids';
    else if (Array.isArray(d.observation_ids)) refsField = 'observation_ids';

    if (!refsField) return d;
    fieldNameUsage[refsField]++;

    const before = d[refsField];
    const after = before.filter((id) => knownObsIds.has(id));
    const droppedHere = before.length - after.length;
    if (droppedHere > 0) {
      totalDropped += droppedHere;
      digestsAffected++;
      sessionLog.push({
        layer: 'cold-store',
        entityId: d.id,
        entityType: 'Digest',
        edgesAdded: 0,
        dangling_refs_dropped: droppedHere,
        errors: [],
      });
    }
    return { ...d, [refsField]: after };
  });

  log(
    `field-name usage in digests.json: observationIds=${fieldNameUsage.observationIds} obs_ids=${fieldNameUsage.obs_ids} observation_ids=${fieldNameUsage.observation_ids}`,
  );
  log(`scrub summary: ${totalDropped} dangling refs across ${digestsAffected} digests`);

  // Persist session log so the cold-store records are flushed
  try {
    fs.writeFileSync(sessionLogPath, JSON.stringify(sessionLog, null, 2));
  } catch (err) {
    log(`session log flush failed: ${err.message}`);
  }

  if (totalDropped === 0) {
    log('Layer 2: no dangling refs found, nothing to write');
    return { dropped: 0, digestsAffected: 0, errors: [], backupPath: null };
  }

  if (dryRun) {
    log(`DRY-RUN — would drop ${totalDropped} dangling refs across ${digestsAffected} digests; NOT writing`);
    return { dropped: totalDropped, digestsAffected, errors: [], backupPath: null };
  }

  // Atomic rewrite per Shared Pattern F (evict-ghost-digests.mjs:74-81)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = DIGESTS_TARGET + `.bak-${stamp}`;
  fs.copyFileSync(DIGESTS_TARGET, backup);
  const tmp = DIGESTS_TARGET + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(newDigests, null, 2));
  fs.renameSync(tmp, DIGESTS_TARGET);
  log(`Backup written: ${backup}`);
  log(`digests.json rewritten with ${totalDropped} dangling refs dropped across ${digestsAffected} digests`);

  return { dropped: totalDropped, digestsAffected, errors: [], backupPath: backup };
}

// ────────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  log(`mode: ${args.dryRun ? 'DRY-RUN' : 'LIVE'} layer=${args.layer}`);
  log(`session log: ${sessionLogPath}`);

  // Pre-flight: Layer 1 needs km-core REST reachable; Layer 2 only needs files.
  if (args.layer === 'graph' || args.layer === 'both') {
    await preflightGraph();
  }

  let layer1Result = null;
  let layer2Result = null;

  if (args.layer === 'graph' || args.layer === 'both') {
    layer1Result = await processGraphLayer({ dryRun: args.dryRun });
    if (layer1Result.aborted) {
      // Error-budget exceeded — partial session log already on disk
      const summary = {
        layer1: layer1Result,
        layer2: null,
        sessionLogPath,
      };
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
      process.exit(1);
    }
  }

  if (args.layer === 'cold-store' || args.layer === 'both') {
    layer2Result = await processColdStoreLayer({ dryRun: args.dryRun });
  }

  // End-of-run summary to stdout (operator's "what was done" record)
  const summary = {
    layer1: layer1Result
      ? {
          orphans_inspected: layer1Result.orphansInspected,
          edges_added: layer1Result.edgesAdded,
          errors_logged: layer1Result.failures,
        }
      : null,
    layer2: layer2Result
      ? {
          dangling_refs_dropped: layer2Result.dropped,
          digests_affected: layer2Result.digestsAffected,
          backup_path: layer2Result.backupPath,
          errors_logged: layer2Result.errors.length,
        }
      : null,
    sessionLogPath,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

main().catch((e) => {
  log(`FATAL: ${e.stack}`);
  process.exit(3);
});
