#!/usr/bin/env node
/**
 * Move this installation's knowledge out of the tools repo and into the data root.
 *
 * WHY. `.data/` inside the tools repo used to be the data root, so a colleague's
 * clone started life holding someone else's knowledge base and their first run
 * dirtied tracked files. lib/paths now resolves the data root per scope
 * (~/.coding/data/<scope>/), and the code reads it — so the content has to follow,
 * once, per machine.
 *
 * Dry-run by default. `--apply` performs the moves.
 *
 * SAFETY PROPERTIES, in the order they matter:
 *   1. It refuses to run while anything holds the store. LevelDB is opened by
 *      BOTH the host obs-api and the container's sse-server; moving it underneath
 *      a live opener is how you get a half-written manifest and a store that
 *      hydrates to an empty graph.
 *   2. It refuses to overwrite a non-empty destination. Re-running after a
 *      partial move must not merge two generations of the same tree.
 *   3. It is idempotent: a tree already at the destination is reported and skipped,
 *      so it is safe to re-run after fixing whatever stopped it.
 *   4. It uses rename() where possible — same APFS/ext4 volume, so the 58 MB of
 *      exports and 32 MB of cold store move instantly and atomically. A
 *      cross-device move falls back to copy-then-verify-then-remove, never
 *      remove-then-copy.
 *
 * It deliberately does NOT touch git. Untracking the ~118 MB that was committed is
 * a separate, reviewable step, and printing the exact command is more honest than
 * rewriting someone's index inside a data migration.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  kbDir, varDir, graphExportsDir, insightsDir,
  observationExportDir, knowledgeExportDir, graphDbDir, ensureDataHome, explain,
  proxyDataDir, measurementsDir, autoMeasureDir, runSnapshotsDir,
} from '../lib/paths/index.mjs';

const REPO = process.env.CODING_REPO || path.resolve(import.meta.dirname, '..');
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

// Who can be mid-write in a given tree. A holder blocks ONLY the trees it can
// actually corrupt: obs-api and the container open the knowledge LevelDB and the
// cold-store JSON and nothing else, so leaving them up cannot hurt a move of the
// measurement or snapshot trees. A blanket guard reads as safety but is the
// opposite — it makes the migration all-or-nothing, so the trees that CAN move
// today don't, and the repo keeps two generations of the same data while the
// code has already switched to reading the new one.
const KNOWLEDGE_HOLDERS = ['obs-api', 'container'];
const PROXY_HOLDERS = ['proxy', 'reconciler', 'auto-measure'];

/** Each tree, which side of the tracked/untracked line it lands on, and its holders. */
const MOVES = [
  { heldBy: KNOWLEDGE_HOLDERS, from: '.data/knowledge-graph/leveldb', to: () => graphDbDir(), side: 'var (not tracked — a projection of the exports)' },
  { heldBy: KNOWLEDGE_HOLDERS, from: '.data/knowledge-graph/exports', to: () => graphExportsDir(), side: 'kb (tracked)' },
  { heldBy: KNOWLEDGE_HOLDERS, from: '.data/knowledge-graph/insights', to: () => insightsDir(), side: 'kb (tracked)' },
  { heldBy: KNOWLEDGE_HOLDERS, from: '.data/observation-export', to: () => observationExportDir(), side: 'kb (tracked)' },
  { heldBy: KNOWLEDGE_HOLDERS, from: '.data/knowledge-export', to: () => knowledgeExportDir(), side: 'kb (tracked)' },
  // Performance measurement. All var/ — a 233 MB SQLite file and 2.8 GB of
  // measurement archives are never committed, and the proxy composes
  // `<dataDir>/llm-proxy/...` itself from LLM_PROXY_DATA_DIR, which is why the
  // destination is proxyDataDir() rather than a deeper path.
  { heldBy: PROXY_HOLDERS, from: '.data/llm-proxy', to: () => path.join(proxyDataDir(), 'llm-proxy'), side: 'var (not tracked — 233 MB token DB)' },
  { heldBy: PROXY_HOLDERS, from: '.data/llm-proxy-export', to: () => path.join(proxyDataDir(), 'llm-proxy-export'), side: 'var (not tracked)' },
  { heldBy: PROXY_HOLDERS, from: '.data/measurements', to: () => measurementsDir(), side: 'var (not tracked — 2.8 GB)' },
  { heldBy: PROXY_HOLDERS, from: '.data/auto-measure', to: () => autoMeasureDir(), side: 'var (not tracked)' },
  // Repro snapshots. Moves with the rest of the performance trees because the
  // record tap (proxy) and the capture/restore pair (lib/repro) both resolve it
  // from the data dir now — leaving it here would orphan every existing snapshot
  // the instant the code started reading the new location.
  { heldBy: ['proxy'], from: '.data/run-snapshots', to: () => runSnapshotsDir(), side: 'var (not tracked — 28 GB)' },
];

const log = (s = '') => process.stdout.write(`${s}\n`);

function isEmptyDir(p) {
  try { return fs.readdirSync(p).length === 0; } catch { return true; }
}

function du(p) {
  try {
    return execFileSync('du', ['-sh', p], { encoding: 'utf8' }).split('\t')[0].trim();
  } catch { return '?'; }
}

/**
 * Who is holding the graph store right now.
 *
 * Checked by process, not by the LOCK file: a stale LOCK left by a crash would
 * block a migration that is actually safe, and a live opener that has not yet
 * taken the LOCK would slip past a file check.
 */
function storeHolders(want) {
  const holders = [];
  const ps = (id, pattern, label, stop) => {
    if (!want.has(id)) return;
    try {
      const out = execFileSync('/usr/bin/pgrep', ['-f', pattern], { encoding: 'utf8' }).trim();
      if (out) holders.push({ label: `${label} (pid ${out.split('\n').join(', ')})`, stop });
    } catch { /* pgrep exits 1 when nothing matches */ }
  };
  ps('obs-api', 'observations-api-server', 'host obs-api',
    'launchctl bootout gui/$(id -u)/com.coding.obs-api');
  // The proxy holds token-usage.db open (WAL + SHM). Moving a live SQLite file
  // with an open WAL is how you get a database that opens but has lost its most
  // recent writes.
  ps('proxy', 'proxy-bridge/server.mjs', 'rapid-llm-proxy',
    'launchctl bootout gui/$(id -u)/com.coding.llm-cli-proxy');
  ps('reconciler', 'measurement-reconciler', 'measurement-reconciler',
    'launchctl bootout gui/$(id -u)/com.coding.measurement-reconciler');
  ps('auto-measure', 'auto-measure-foreground', 'auto-measure-foreground',
    'launchctl bootout gui/$(id -u)/com.coding.auto-measure-foreground');
  // The ETM is deliberately NOT checked. It writes LSL transcripts (a tree this
  // migration does not touch) and reaches observations over HTTP via
  // ObservationApiClient — it never opens the LevelDB or the cold-store JSON.
  // Listing it would mean killing the logger for the session running the
  // migration, to protect trees it cannot touch.
  if (want.has('container')) {
    try {
      const out = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
      if (out.split('\n').some((n) => n.trim() === 'coding-services')) {
        holders.push({
          label: 'container coding-services (sse-server opens the same LevelDB)',
          stop: 'docker compose -f docker/docker-compose.yml stop coding-services',
        });
      }
    } catch { /* no docker, or daemon down — then it is not a holder */ }
  }
  return holders;
}

function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
    return 'renamed';
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    // Cross-device: copy, verify the entry count, only then remove the source.
    fs.cpSync(from, to, { recursive: true });
    const n = (p) => fs.readdirSync(p, { recursive: true }).length;
    if (n(from) !== n(to)) {
      throw new Error(`cross-device copy of ${from} is incomplete — source left in place`);
    }
    fs.rmSync(from, { recursive: true, force: true });
    return 'copied across devices';
  }
}

// ── report ───────────────────────────────────────────────────────────────────

const e = explain();
log('');
log(`scope      ${e.scope}  (from ${e.scopeSource})`);
log(`data home  ${e.dataHome}`);
log(`repo       ${REPO}`);
if (e.scopeIsDefault) {
  log('');
  log('REFUSING: the scope is the placeholder default, so this would migrate your');
  log('knowledge into ~/.coding/data/default/. Write the intended tenant first:');
  log('  echo <scope> > ~/.coding/scope');
  process.exit(2);
}

const planned = [];
const skipped = [];
for (const m of MOVES) {
  const from = path.join(REPO, m.from);
  const to = m.to();
  const hasFrom = fs.existsSync(from) && !isEmptyDir(from);
  const hasTo = fs.existsSync(to) && !isEmptyDir(to);

  if (!hasFrom && hasTo) { skipped.push([m.from, 'already migrated']); continue; }
  if (!hasFrom) { skipped.push([m.from, 'nothing to move']); continue; }
  if (hasTo) { skipped.push([m.from, `DESTINATION NOT EMPTY — ${to}`]); continue; }
  planned.push({ ...m, from, to });
}

log('');
log('to move:');
if (planned.length === 0) log('  (nothing)');
for (const m of planned) {
  log(`  ${m.from.replace(`${REPO}/`, '')}  ${du(m.from)}`);
  log(`    → ${m.to}`);
  log(`      ${m.side}`);
}
if (skipped.length) {
  log('');
  log('skipped:');
  for (const [what, why] of skipped) log(`  ${what} — ${why}`);
}

const blocked = skipped.filter(([, why]) => why.startsWith('DESTINATION NOT EMPTY'));
if (blocked.length && !FORCE) {
  log('');
  log('REFUSING: a destination already holds content. Two generations of the same');
  log('tree must not be merged. Inspect them, then remove the one you do not want.');
  process.exit(2);
}

if (planned.length === 0) {
  log('');
  log('Nothing to do.');
  process.exit(0);
}

// Only the holders of the trees actually being moved. A knowledge-tree move asks
// for obs-api and the container; a measurement or snapshot move does not.
const wanted = new Set(planned.flatMap((m) => m.heldBy || []));
const holders = storeHolders(wanted);
if (holders.length) {
  log('');
  log('REFUSING: these are live in a tree this run would move:');
  for (const h of holders) log(`  - ${h.label}`);
  log('');
  log('Stop them first, then re-run:');
  for (const h of holders) log(`  ${h.stop}`);
  process.exit(3);
}

if (!APPLY) {
  log('');
  log('Dry run — nothing was moved. Re-run with --apply.');
  process.exit(0);
}

// ── apply ────────────────────────────────────────────────────────────────────

ensureDataHome();
log('');
for (const m of planned) {
  const how = move(m.from, m.to);
  log(`  moved (${how})  ${m.from.replace(`${REPO}/`, '')} → ${m.to}`);
}

log('');
log('Done. Restart the services:');
log('  launchctl kickstart -k gui/$(id -u)/com.coding.obs-api');
log('  export CODING_DATA_HOME="$(bin/coding-data-home)"');
log('  docker compose -f docker/docker-compose.yml up -d coding-services');
log('');
log('Then untrack what used to be committed (separate, reviewable step):');
log('  git rm -r --cached --quiet .data/knowledge-graph/exports .data/knowledge-graph/insights \\');
log('      .data/observation-export .data/knowledge-export');
log('  # then add those paths to .gitignore');
log(`\nkb  ${kbDir()}\nvar ${varDir()}\n`);
