#!/usr/bin/env node
/**
 * restore-insight-digest-ids.mjs — One-shot recovery for Insight → Digest
 * relationships dropped during the Phase 44 SQLite → km-core migration.
 *
 * Background:
 *   - The legacy SQLite `insights` table had a JSON-array `digest_ids`
 *     column linking each insight to the digests that fed it.
 *   - The Phase 44 migration carried each insight's name/summary/confidence
 *     across but never stamped `metadata.digest_ids` on the resulting
 *     km-core entity. The historic relationship survives only in the
 *     legacy `.data/observation-export/insights.json` (which my safety-
 *     merge kept intact when ObservationExporter ran).
 *   - The dashboard's `/api/coding/insights` reads from km-core via
 *     `insightToLegacy(entity)` which reads `metadata.digest_ids`. Empty
 *     metadata → "0 source digests" on the UI for ~80/86 insights.
 *
 * This script patches `.data/knowledge-graph/exports/general.json` (the
 * canonical km-core JSON — see CLAUDE.md persistence patch) directly.
 * Per-id rewrite, idempotent. Run before restarting obs-api; obs-api's
 * patched `hydrate()` will pick up the JSON over the LevelDB cache.
 *
 * Usage:
 *   node scripts/restore-insight-digest-ids.mjs                # apply
 *   node scripts/restore-insight-digest-ids.mjs --dry-run      # report only
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DRY_RUN = process.argv.includes('--dry-run');
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const KM_JSON = path.join(REPO_ROOT, '.data/knowledge-graph/exports/general.json');
const COLD_JSON = path.join(REPO_ROOT, '.data/observation-export/insights.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function main() {
  const km = readJson(KM_JSON);
  const cold = readJson(COLD_JSON);
  process.stderr.write(`[restore] km-core nodes: ${km.nodes.length}, cold-store insights: ${cold.length}\n`);

  // Build id → digestIds[] from the legacy export. Falls back through
  // legacyId.id (cold store stores SQLite UUIDs; km-core's legacyId is the
  // case-shift boundary).
  const digestIdsById = new Map();
  for (const ins of cold) {
    if (Array.isArray(ins.digestIds) && ins.digestIds.length > 0) {
      digestIdsById.set(ins.id, ins.digestIds);
    }
  }
  process.stderr.write(`[restore] legacy insights with digestIds: ${digestIdsById.size}\n`);

  let patched = 0;
  let alreadyHad = 0;
  let noMatch = 0;
  for (const node of km.nodes) {
    const attrs = node.attributes;
    if (!attrs || attrs.entityType !== 'Insight') continue;
    const m = attrs.metadata ?? {};
    if (Array.isArray(m.digest_ids) && m.digest_ids.length > 0) {
      alreadyHad++;
      continue;
    }
    // Match by legacyId.id first (the SQLite UUID), then by id.
    const candidates = [attrs.legacyId && attrs.legacyId.id, attrs.id].filter(Boolean);
    let digestIds = null;
    for (const cid of candidates) {
      if (digestIdsById.has(cid)) {
        digestIds = digestIdsById.get(cid);
        break;
      }
    }
    if (!digestIds) {
      noMatch++;
      continue;
    }
    if (!DRY_RUN) {
      attrs.metadata = { ...m, digest_ids: digestIds };
    }
    patched++;
  }
  process.stderr.write(
    `[restore] patched=${patched} already_had=${alreadyHad} no_legacy_match=${noMatch}\n`,
  );

  if (DRY_RUN) {
    process.stderr.write('[restore] dry-run, no files written\n');
    return;
  }
  if (patched === 0) {
    process.stderr.write('[restore] nothing to write\n');
    return;
  }
  fs.writeFileSync(KM_JSON, JSON.stringify(km, null, 2) + '\n', 'utf-8');
  process.stderr.write(`[restore] wrote ${KM_JSON}\n`);
  process.stderr.write('[restore] restart obs-api so hydrate() picks up the patched JSON:\n');
  process.stderr.write('[restore]   launchctl kickstart -k gui/$(id -u)/com.coding.obs-api\n');
}

main();
