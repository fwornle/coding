#!/usr/bin/env node

/**
 * One-shot repair — restore `ontologyClass: 'Insight'` on roll-up parents.
 *
 * WHY: rollUpInsights originally set BOTH `entityType` AND `ontologyClass` to
 * the subsystem bucket (e.g. 'KnowledgeManagement') so the graph would cluster
 * by subsystem. But `GraphKMStore.findByOntologyClass(cls)` is an OR-gate
 * (`entityType === cls || ontologyClass === cls`, GraphKMStore.ts:577) and the
 * `/api/coding/insights` typed view queries it with 'Insight' — so a parent
 * carrying the subsystem in BOTH fields matched neither, and vanished from the
 * Insights page entirely while its 25 children sat archived behind it.
 *
 * The consolidator now writes `ontologyClass: 'Insight'` + `entityType:
 * <subsystem>`, which satisfies both the typed view and the graph clustering.
 * This script repairs parents written before that fix.
 *
 * Identifies parents by `metadata.rollUpOf` (the child id list) — never by
 * name — and touches nothing else.
 *
 * REQUIRES obs-api STOPPED: km-core's LevelDB is single-owner.
 *   launchctl bootout gui/$(id -u)/com.coding.obs-api
 *   node scripts/repair-rollup-parent-class.mjs --apply
 *   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.coding.obs-api.plist
 *
 * Default is a DRY RUN. Operator text goes to stderr by the repair-script
 * convention (deliberate host-CLI channel choice, not a no-console-log dodge).
 */

import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GraphKMStore } from '@fwornle/km-core';

const APPLY = process.argv.includes('--apply');
const err = (m) => process.stderr.write(`${m}\n`);

async function resolveOntologyDir() {
  const kmCorePath = fileURLToPath(import.meta.resolve('@fwornle/km-core'));
  let root = path.dirname(kmCorePath);
  while (root !== '/') {
    try { await fsp.access(path.join(root, 'package.json')); break; }
    catch { root = path.dirname(root); }
  }
  const dir = path.join(root, 'config', 'ontology');
  try { await fsp.access(dir); return dir; }
  catch { return path.resolve(process.cwd(), '.data/ontologies'); }
}

const dataDir = path.resolve(process.cwd(), '.data/knowledge-graph');
const store = new GraphKMStore({
  dbPath: path.join(dataDir, 'leveldb'),
  exportDir: path.join(dataDir, 'exports'),
  ontologyDir: await resolveOntologyDir(),
  ontologyStrict: false,
  debounceMs: 0,
  domains: ['general'],
});

try {
  await store.open();
} catch (e) {
  err(`FATAL: GraphKMStore.open failed: ${e.message}`);
  err('Is obs-api still running?  launchctl list | grep obs-api');
  process.exit(2);
}

let repaired = 0; let alreadyOk = 0;
try {
  // Roll-up parents are not reachable via findByOntologyClass('Insight') --
  // that is the bug -- so scan every class the buckets could have used.
  const seen = new Map();
  const classes = new Set(['Insight']);
  const lower = JSON.parse(
    await fsp.readFile(path.resolve(process.cwd(), '.data/ontologies/coding.lower.json'), 'utf8')
  );
  for (const c of Object.keys(lower.classes || {})) classes.add(c);
  for (const c of classes) {
    for (const e of await store.findByOntologyClass(c)) seen.set(e.id, e);
  }

  const parents = [...seen.values()].filter((e) => Array.isArray(e.metadata?.rollUpOf));
  err(`found ${parents.length} roll-up parent(s) across ${classes.size} class(es)`);

  for (const p of parents) {
    if (p.ontologyClass === 'Insight') { alreadyOk++; continue; }
    err(`  ${APPLY ? 'REPAIR' : 'would repair'}: "${(p.name || '').slice(0, 55)}" `
      + `ontologyClass ${p.ontologyClass} -> Insight (entityType stays ${p.entityType})`);
    if (APPLY) {
      await store.putEntity({ ...p, ontologyClass: 'Insight' }, { skipOntologyCheck: true });
    }
    repaired++;
  }

  if (APPLY && typeof store.exportJson === 'function') {
    try { await store.exportJson(); } catch (e) { err(`WARN: exportJson failed: ${e.message}`); }
  }
} finally {
  try { await store.close(); } catch { /* best-effort */ }
}

err('');
err(`already correct: ${alreadyOk}`);
err(`${APPLY ? 'repaired' : 'would repair'}: ${repaired}`);
if (!APPLY && repaired > 0) err('\nDry run. Re-run with --apply to write.');
