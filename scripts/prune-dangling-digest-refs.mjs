#!/usr/bin/env node
/**
 * One-shot / periodic maintenance: prune dangling `observationIds` from cold-store
 * digests — references to observations that no longer exist in the cold store.
 *
 * WHY THEY EXIST: a Digest consolidates N observations and keeps their ids as
 * provenance. Observations are later pruned (retention) or were never exported
 * (quality==='low' is excluded by ObservationExporter), so the ids dangle. This
 * is a natural lifecycle artifact, not corruption — but a digest claiming a
 * source that isn't in the store is misleading and trips any consumer that
 * counts/expands `observationIds`.
 *
 * SCOPE (verified): all dangling-ref digests are COLD-ONLY (0 in the km-core hot
 * graph — digests old enough to have their source obs pruned have themselves aged
 * out of the retention window). So editing `.data/observation-export/digests.json`
 * is the complete, durable fix: the read-path merge (_mergeDigests) serves
 * cold-only digests verbatim, and the exporter merge (kmStore ∪ existing)
 * preserves the edited file for ids not in kmStore.
 *
 * WHAT IT DOES: for each digest, filter `observationIds` down to ids that resolve
 * to an existing observation. Digest summaries/themes are UNTOUCHED. A digest
 * whose sources are all gone ends with `observationIds: []` — honest (the summary
 * still stands; the read path already degrades gracefully for missing sources).
 *
 * Usage:
 *   node scripts/prune-dangling-digest-refs.mjs            # dry-run (default)
 *   node scripts/prune-dangling-digest-refs.mjs --apply    # rewrite digests.json
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const APPLY = process.argv.includes('--apply');
const EXPORT_DIR = path.join(REPO_ROOT, '.data', 'observation-export');
const OBS = path.join(EXPORT_DIR, 'observations.json');
const DIGESTS = path.join(EXPORT_DIR, 'digests.json');
const log = (m) => process.stderr.write(`[prune-refs] ${m}\n`);

const obsRaw = JSON.parse(fs.readFileSync(OBS, 'utf8'));
const obsIds = new Set((Array.isArray(obsRaw) ? obsRaw : obsRaw.observations || []).map((o) => o.id));
log(`observations in cold store: ${obsIds.size}`);

const digRaw = JSON.parse(fs.readFileSync(DIGESTS, 'utf8'));
const isArray = Array.isArray(digRaw);
const digs = isArray ? digRaw : (digRaw.digests || []);
log(`digests: ${digs.length}`);

let refsTotal = 0;
let refsDangling = 0;
let digestsTouched = 0;
let digestsEmptiedNow = 0;
const cleaned = digs.map((d) => {
  const ids = Array.isArray(d.observationIds) ? d.observationIds : [];
  refsTotal += ids.length;
  const kept = ids.filter((id) => obsIds.has(id));
  const removed = ids.length - kept.length;
  if (removed > 0) {
    refsDangling += removed;
    digestsTouched++;
    if (kept.length === 0) digestsEmptiedNow++;
    return { ...d, observationIds: kept };
  }
  return d;
});

log(`ref total: ${refsTotal} | dangling (to remove): ${refsDangling} (${(refsDangling / refsTotal * 100).toFixed(1)}%)`);
log(`digests with dangling refs (to touch): ${digestsTouched}`);
log(`  · of which fully-orphaned → observationIds becomes []: ${digestsEmptiedNow}`);

if (!APPLY) {
  log('DRY-RUN — no file written. Re-run with --apply.');
  process.exit(0);
}

const out = isArray ? cleaned : { ...digRaw, digests: cleaned };
const tmp = `${DIGESTS}.tmp.${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
fs.renameSync(tmp, DIGESTS);
log(`digests.json rewritten — removed ${refsDangling} dangling refs across ${digestsTouched} digests (atomic tmp+rename).`);
process.exit(0);
