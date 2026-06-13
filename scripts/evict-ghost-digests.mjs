#!/usr/bin/env node

/**
 * Evict ghost digest rows from `.data/observation-export/digests.json`.
 *
 * A ghost row is one whose top-level `observationIds` is empty but whose
 * nested `metadata.observation_ids` is populated. They are stranded
 * artifacts of pre-`7ab1f9cd8` exporter passes that wrote the wrong
 * top-level shape — the safety-merge logic in `ObservationExporter`
 * preserves them because their `D|date|theme` contentKey doesn't match
 * any current km-core entity (which dates them differently).
 *
 * The ghosts sort to the top of the dashboard's Digests view by date DESC
 * and read as "0 obs", confusing the user about how recent activity was
 * digested. Today's writer code path puts the same list in both
 * carriers, so any row with the empty-top + populated-nested asymmetry
 * is unambiguously stale.
 *
 * Usage:
 *   node scripts/evict-ghost-digests.mjs           # dry run, print summary
 *   node scripts/evict-ghost-digests.mjs --apply   # rewrite the file
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, '.data', 'observation-export', 'digests.json');

const apply = process.argv.includes('--apply');

const raw = fs.readFileSync(TARGET, 'utf8');
const all = JSON.parse(raw);
if (!Array.isArray(all)) {
  process.stderr.write('digests.json root is not an array — refusing\n');
  process.exit(1);
}

const isGhost = (r) => {
  const top = Array.isArray(r.observationIds) ? r.observationIds : null;
  if (top === null || top.length > 0) return false;
  const nested = r.metadata && Array.isArray(r.metadata.observation_ids)
    ? r.metadata.observation_ids
    : [];
  return nested.length > 0;
};

const ghosts = all.filter(isGhost);
const kept = all.filter((r) => !isGhost(r));

process.stdout.write(`Total digests:    ${all.length}\n`);
process.stdout.write(`Ghosts (evict):   ${ghosts.length}\n`);
process.stdout.write(`Kept:             ${kept.length}\n\n`);

if (ghosts.length > 0) {
  process.stdout.write('Sample ghosts (first 8):\n');
  for (const g of ghosts.slice(0, 8)) {
    const theme = (g.theme || '').slice(0, 50);
    const nestedLen = (g.metadata?.observation_ids || []).length;
    process.stdout.write(`  ${g.date}  ${theme}  (nested=${nestedLen})\n`);
  }
  process.stdout.write('\n');
}

if (!apply) {
  process.stdout.write('Dry run. Re-run with --apply to rewrite digests.json.\n');
  process.exit(0);
}

// Write atomically: temp + rename. Keep a timestamped backup so the
// operator has a recovery path if the eviction heuristic misclassified.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = TARGET + `.bak-${stamp}`;
fs.copyFileSync(TARGET, backup);
const tmp = TARGET + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(kept, null, 2));
fs.renameSync(tmp, TARGET);
process.stdout.write(`Backup written: ${backup}\n`);
process.stdout.write(`Evicted ${ghosts.length} ghost(s). digests.json now has ${kept.length} entries.\n`);
