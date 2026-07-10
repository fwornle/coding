#!/usr/bin/env node
/**
 * One-shot maintenance: purge the Feb–Mar 2026 copilot "explore sub-agent spawn"
 * stub observations (~2,988 undigested near-duplicates) from the JSON cold store.
 *
 * WHERE THE DATA LIVES: the live km-core GraphKMStore only holds the retention
 * window (~338 observations; old ones are pruned by ObservationPruner). The
 * historical archive is the git-tracked JSON cold store at
 * `.data/observation-export/observations.json`, which ObservationExporter MERGES
 * into (kmStore ∪ existing) — so it accumulates history the hot graph no longer
 * holds. These stubs are ONLY in the cold store (verified: 0 in km-core), so the
 * purge edits the JSON directly. Because the exporter merge is kmStore ∪ existing
 * and the stubs are in neither kmStore nor the edited existing file afterwards,
 * the deletion is durable across the next export.
 *
 * Context: the copilot explore sub-agent was spawned repeatedly during heavy
 * Feb–Mar development; each spawn produced a near-identical degraded
 * (lsl_incomplete) stub ("Intent: spawn/invoke the explore sub-agent to perform
 * fast codebase exploration/discovery/analysis"). They escaped exact-hash dedup
 * (reworded) but carry near-zero distinguishing content — pure archive bloat.
 *
 * Selection (conservative): agent === 'copilot' AND createdAt < CUTOFF AND NOT
 * digested AND NOT referenced by any digest's `observation_ids`. Both guards are
 * required: an observation's own `digestedAt` being unset does NOT prove no digest
 * references it (observed: 55 undigested-but-referenced rows), and a dangling
 * digest→observation reference is a corruption signal. Referenced rows PRESERVED.
 *
 * Usage:
 *   node scripts/purge-copilot-stub-observations.mjs            # dry-run (default)
 *   node scripts/purge-copilot-stub-observations.mjs --apply    # rewrite the JSON
 *   node scripts/purge-copilot-stub-observations.mjs --cutoff=2026-04-01
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const APPLY = process.argv.includes('--apply');
const cutoffArg = process.argv.find((a) => a.startsWith('--cutoff='));
const CUTOFF = cutoffArg ? cutoffArg.split('=')[1] : '2026-04-01';

const COLD = path.join(REPO_ROOT, '.data', 'observation-export', 'observations.json');
const DIGESTS = path.join(REPO_ROOT, '.data', 'observation-export', 'digests.json');
const log = (m) => process.stderr.write(`[purge] ${m}\n`);

const raw = fs.readFileSync(COLD, 'utf8');
const parsed = JSON.parse(raw);
const isArray = Array.isArray(parsed);
const list = isArray ? parsed : (parsed.observations || []);
log(`cold store: ${list.length} observations (${COLD})`);

// Every observation id referenced by ANY digest — these must never be deleted,
// regardless of their own digestedAt flag (which is not a reliable proxy).
const referenced = new Set();
try {
  const dj = JSON.parse(fs.readFileSync(DIGESTS, 'utf8'));
  const digs = Array.isArray(dj) ? dj : (dj.digests || []);
  for (const d of digs) {
    const ids = d.observation_ids || d.observationIds || (d.metadata && d.metadata.observation_ids) || [];
    if (Array.isArray(ids)) for (const id of ids) referenced.add(id);
  }
} catch (err) {
  log(`WARN: could not read digests for reference guard (${err.message}) — aborting to be safe`);
  process.exit(1);
}
log(`digest-referenced observation ids: ${referenced.size}`);

const isCopilotFebMar = (o) =>
  o && o.agent === 'copilot' && typeof o.createdAt === 'string' && o.createdAt < CUTOFF;
const targets = list.filter((o) => isCopilotFebMar(o) && !o.digestedAt && !referenced.has(o.id));
const preserved = list.filter((o) => isCopilotFebMar(o) && (o.digestedAt || referenced.has(o.id)));
const targetIds = new Set(targets.map((o) => o.id));

log(`copilot < ${CUTOFF}: ${targets.length + preserved.length}`);
log(`  · TARGETS (undigested + unreferenced → delete): ${targets.length}`);
log(`  · PRESERVED (digested or digest-referenced — kept): ${preserved.length}`);
for (const o of targets.slice(0, 5)) {
  log(`   - ${o.createdAt}  ${o.id}  :: ${String(o.summary || '').replace(/\s+/g, ' ').slice(0, 70)}`);
}

if (!APPLY) {
  log('DRY-RUN — no file written. Re-run with --apply.');
  process.exit(0);
}

const kept = list.filter((o) => !targetIds.has(o.id));
log(`rewriting: ${list.length} → ${kept.length} (removed ${list.length - kept.length})`);
const out = isArray ? kept : { ...parsed, observations: kept };
const tmp = `${COLD}.tmp.${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
fs.renameSync(tmp, COLD);
log('cold store rewritten (atomic tmp+rename).');
process.exit(0);
