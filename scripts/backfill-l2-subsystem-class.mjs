#!/usr/bin/env node
/**
 * Phase 60 Plan 09 — One-shot L2 subsystem re-classification migration
 * (SC#5 / LOWERONTO-03). Sister-script to the writer-side deterministic
 * refinement in `integrations/mcp-server-semantic-analysis/src/agents/
 * ontology-classification-agent.ts` (Task 2) — BOTH import the SAME
 * `classifyL2` mapper from the submodule's built dist, so there is exactly
 * one mapping implementation and zero copy-paste drift.
 *
 * # What this does
 *
 * Reads `.data/knowledge-graph/exports/general.json`. For every node whose
 * `attributes.ontologyClass` is one of the refinable L1 carriers
 * (Component / SubComponent / Detail) AND whose name is NOT a hierarchy root,
 * it computes `classifyL2(name, description, ontologyClass)`. When that yields
 * a non-null L2 class different from the current class, it queues a mutation.
 * In live mode each mutation is written via km-core's trusted path
 * (`putEntity({ skipOntologyCheck: true })`, Phase 43 D-G4.1) and the JSON
 * export is flushed once at the end.
 *
 * # Why this is needed
 *
 * The unified-viewer Ontology Class filter builds its L1->L2 tree by
 * intersecting the registry's L2 classes with the `ontologyClass` values
 * actual entities carry (`OntologyFilter.tsx` availSet guard). Before this
 * migration NO entity carried an L2 class, so every L1 collapsed to a flat
 * row and SC#5 stayed PARTIAL. This backfill makes existing entities carry
 * an L2 class so the tree renders with real per-L2 counts and L2 selection
 * actually filters.
 *
 * # Idempotent + deterministic
 *
 * `classifyL2` is pure and deterministic, so a re-run after a successful
 * migration finds every refinable entity already carrying its L2 class and
 * reports 0 mutations. No-forced-L2 (Phase 57 D-10): entities with no
 * confident keyword match keep their L1 class.
 *
 * # km-core `ontologyDir` resolution (CLAUDE.md mandatory)
 *
 * Per the CLAUDE.md "km-core scripts" rule (Phase 41 lesson, commits
 * 87bc2f567 / fd35c5350): constructs `GraphKMStore` WITH an `ontologyDir`
 * option resolved via `import.meta.resolve('@fwornle/km-core')` walking up to
 * the package root. Without this option `GraphKMStore` throws
 * `opts.classes omitted but store has no ontology registry`.
 *
 * # Channel choice — stderr (per the repair-ck-ontology-class.mjs convention)
 *
 * Operator-facing status text goes to `process.stderr.write` (stdout reserved
 * for machine-readable output; this script writes the per-L2 distribution to
 * stderr + a summary JSON to the log dir). DELIBERATE host-side-CLI channel
 * choice — not a `no-console-log` constraint-dodge.
 *
 * # Usage
 *
 *   node scripts/backfill-l2-subsystem-class.mjs              # LIVE migration
 *   node scripts/backfill-l2-subsystem-class.mjs --dry-run    # scan + per-L2 summary, no writes
 *   node scripts/backfill-l2-subsystem-class.mjs --source PATH # override export path
 *   node scripts/backfill-l2-subsystem-class.mjs --log-dir DIR # override .data/ log dir
 *   node scripts/backfill-l2-subsystem-class.mjs --help        # this text + exit 0
 *
 * # Exit codes
 *
 *   0   success — dry-run reported a distribution, OR live run persisted all
 *       queued mutations (or there were none — idempotent re-run).
 *   1   live write integrity failure (a queued mutation did not persist).
 *   2   pre-flight failure (source missing, ontologyDir unresolvable, classifier
 *       import failed, etc.).
 *   3   uncaught exception in main().
 *
 * @module scripts/backfill-l2-subsystem-class
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { fileURLToPath } from 'node:url';
import { GraphKMStore, isHierarchyRoot } from '@fwornle/km-core';
// SHARED mapper — the one implementation also wired into the writer agent
// (Task 2). Imported from the submodule's built dist so there is no copy of
// the keyword table in this script.
import { classifyL2 } from '../integrations/mcp-server-semantic-analysis/dist/agents/l2-subsystem-classifier.js';

const REFINABLE_L1 = new Set(['Component', 'SubComponent', 'Detail']);

// ────────────────────────────────────────────────────────────────────────────
// CLI flag parsing — pure process.argv walk (matches repair-ck-ontology-class.mjs)
// ────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    source: path.resolve(process.cwd(), '.data/knowledge-graph/exports/general.json'),
    logDir: path.resolve(process.cwd(), '.data'),
    dryRun: false,
    help: false,
  };
  for (const a of argv) {
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--source=')) args.source = path.resolve(a.slice('--source='.length));
    else if (a.startsWith('--log-dir=')) args.logDir = path.resolve(a.slice('--log-dir='.length));
  }
  return args;
}

function printUsage() {
  process.stderr.write(
    [
      'Usage: node scripts/backfill-l2-subsystem-class.mjs [flags]',
      '',
      'One-shot migration: re-classifies existing Component/SubComponent/Detail',
      'entities to a parent-consistent L2 subsystem class via the shared',
      'deterministic classifyL2 mapper. Idempotent — a re-run reports 0 mutations.',
      'No-forced-L2: entities with no confident keyword match keep their L1 class.',
      '',
      'Flags:',
      '  --source=<path>    JSON export to read (default .data/knowledge-graph/exports/general.json)',
      '  --log-dir=<dir>    Where to write the summary JSON (default .data/)',
      '  --dry-run          Scan + per-L2 distribution only, NO putEntity writes',
      '  --help, -h         Show this usage and exit 0',
      '',
      'Exit codes: 0 ok | 1 live write integrity failure | 2 pre-flight failure | 3 uncaught',
      '',
    ].join('\n'),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// km-core ontologyDir resolution — VERBATIM from repair-ck-ontology-class.mjs
// (CLAUDE.md "km-core scripts" mandatory rule).
// ────────────────────────────────────────────────────────────────────────────

async function resolveOntologyDir() {
  const kmCoreEntry = import.meta.resolve('@fwornle/km-core');
  const kmCorePath = fileURLToPath(kmCoreEntry);
  let kmCoreRoot = path.dirname(kmCorePath);
  while (kmCoreRoot !== '/') {
    try {
      await fsp.access(path.join(kmCoreRoot, 'package.json'));
      break;
    } catch {
      kmCoreRoot = path.dirname(kmCoreRoot);
    }
  }
  const ontologyDir = path.join(kmCoreRoot, 'config', 'ontology');
  try {
    await fsp.access(ontologyDir);
    return ontologyDir;
  } catch {
    return path.resolve(process.cwd(), '.data/ontologies');
  }
}

async function readExport(sourcePath) {
  const raw = await fsp.readFile(sourcePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Scan the export and compute the queue of L2 mutations + the per-L2 count map.
 */
function computeMutations(exportData) {
  const nodes = Array.isArray(exportData?.nodes) ? exportData.nodes : [];
  const mutations = [];
  const perL2 = {};
  let refinableSeen = 0;
  for (const node of nodes) {
    const attrs = node?.attributes;
    if (!attrs) continue;
    const current = attrs.ontologyClass;
    if (!REFINABLE_L1.has(current)) continue;
    if (isHierarchyRoot(attrs.name)) continue; // never refine hierarchy roots
    refinableSeen += 1;
    const l2 = classifyL2(attrs.name, attrs.description, current);
    if (!l2 || l2 === current) continue;
    perL2[l2] = (perL2[l2] ?? 0) + 1;
    mutations.push({
      id: typeof attrs.id === 'string' ? attrs.id : node.key,
      name: attrs.name,
      from: current,
      to: l2,
      attrs,
    });
  }
  return { mutations, perL2, refinableSeen };
}

function renderPerL2(perL2) {
  const allClasses = [
    'LiveLoggingSystem', 'ConstraintMonitor', 'KnowledgeManagement',
    'BatchSemanticAnalysis', 'RapidLlmProxy', 'DockerizedServices',
    'OnlineObservation', 'OnlineDigest', 'OnlineInsight', 'EtmDaemon',
  ];
  const lines = [];
  for (const c of allClasses) {
    lines.push(`    ${c.padEnd(24)} ${perL2[c] ?? 0}`);
  }
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  process.stderr.write(
    `[backfill-l2] start: source=${args.source} logDir=${args.logDir} dryRun=${args.dryRun}\n`,
  );

  if (!fs.existsSync(args.source)) {
    process.stderr.write(`[backfill-l2] FATAL: source does not exist: ${args.source}\n`);
    process.exit(2);
  }
  if (!fs.existsSync(args.logDir)) {
    try {
      fs.mkdirSync(args.logDir, { recursive: true });
    } catch (e) {
      process.stderr.write(`[backfill-l2] FATAL: cannot create logDir ${args.logDir}: ${e.message}\n`);
      process.exit(2);
    }
  }

  let ontologyDir;
  try {
    ontologyDir = await resolveOntologyDir();
  } catch (e) {
    process.stderr.write(`[backfill-l2] FATAL: resolveOntologyDir failed: ${e.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`[backfill-l2] ontologyDir=${ontologyDir}\n`);

  let exportData;
  try {
    exportData = await readExport(args.source);
  } catch (e) {
    process.stderr.write(`[backfill-l2] FATAL: readExport(${args.source}) failed: ${e.message}\n`);
    process.exit(2);
  }

  const { mutations, perL2, refinableSeen } = computeMutations(exportData);
  const distinctL2 = Object.keys(perL2).length;
  const safeIso = startedAt.replace(/[:.]/g, '-');
  const logPath = path.join(args.logDir, `backfill-l2-subsystem-class-${safeIso}.json`);

  process.stderr.write(
    `[backfill-l2] scanned ${refinableSeen} refinable (Component/SubComponent/Detail) entities; `
    + `${mutations.length} would gain an L2 class across ${distinctL2}/10 L2 classes:\n`
    + `${renderPerL2(perL2)}\n`,
  );

  // ── Dry-run: write summary, no writes ──
  if (args.dryRun) {
    const summary = {
      status: 'dry-run',
      refinableSeen,
      mutationCount: mutations.length,
      distinctL2,
      perL2,
      sample: mutations.slice(0, 20).map((m) => ({ name: m.name, from: m.from, to: m.to })),
      dryRun: true,
      source: args.source,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    };
    try {
      await fsp.writeFile(logPath, JSON.stringify(summary, null, 2), 'utf-8');
      process.stderr.write(`[backfill-l2] DRY RUN — no writes; summary: ${logPath}\n`);
    } catch (e) {
      process.stderr.write(`[backfill-l2] WARN: could not write summary to ${logPath}: ${e.message}\n`);
    }
    process.exit(0);
  }

  // ── Idempotent live run with nothing to do ──
  if (mutations.length === 0) {
    const summary = {
      status: 'no-change',
      refinableSeen,
      mutationCount: 0,
      distinctL2: 0,
      perL2: {},
      dryRun: false,
      source: args.source,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    };
    try {
      await fsp.writeFile(logPath, JSON.stringify(summary, null, 2), 'utf-8');
    } catch (_e) { /* swallow */ }
    process.stderr.write(`[backfill-l2] no mutations needed (idempotent); summary: ${logPath}\n`);
    process.exit(0);
  }

  // ── Live write path ──
  const exportDir = path.dirname(args.source);   // .data/knowledge-graph/exports
  const dataDir = path.dirname(exportDir);        // .data/knowledge-graph
  const dbPath = path.join(dataDir, 'leveldb');
  process.stderr.write(`[backfill-l2] opening km-core store dbPath=${dbPath} (${mutations.length} writes)\n`);

  let store;
  try {
    store = new GraphKMStore({
      dbPath,
      exportDir,
      ontologyDir,
      ontologyStrict: false,
      debounceMs: 0,
      domains: ['general'],
    });
    await store.open();
  } catch (e) {
    process.stderr.write(`[backfill-l2] FATAL: GraphKMStore.open failed: ${e.message}\n`);
    process.exit(2);
  }

  let writeErrors = 0;
  try {
    for (const m of mutations) {
      const mutated = { ...m.attrs, ontologyClass: m.to };
      try {
        await store.putEntity(mutated, { skipOntologyCheck: true });
      } catch (e) {
        writeErrors += 1;
        process.stderr.write(`[backfill-l2] WARN: putEntity '${m.name}' -> ${m.to} failed: ${e.message}\n`);
      }
    }
    if (typeof store.exportJson === 'function') {
      try {
        await store.exportJson();
      } catch (e) {
        process.stderr.write(`[backfill-l2] WARN: exportJson failed: ${e.message}\n`);
      }
    }
  } finally {
    try { await store.close(); } catch (_e) { /* swallow */ }
  }

  // Re-read the export and report ACTUAL per-L2 counts now on entities.
  let afterData;
  try {
    afterData = await readExport(args.source);
  } catch (e) {
    process.stderr.write(`[backfill-l2] FATAL: post-write readExport failed: ${e.message}\n`);
    process.exit(1);
  }
  const afterCounts = {};
  for (const node of (Array.isArray(afterData?.nodes) ? afterData.nodes : [])) {
    const cls = node?.attributes?.ontologyClass;
    if (cls) afterCounts[cls] = (afterCounts[cls] ?? 0) + 1;
  }
  const persistedL2 = Object.keys(perL2).filter((c) => (afterCounts[c] ?? 0) > 0).length;

  const summary = {
    status: writeErrors === 0 && persistedL2 === distinctL2 ? 'migrated' : 'partial',
    refinableSeen,
    mutationCount: mutations.length,
    writeErrors,
    distinctL2,
    persistedL2,
    intendedPerL2: perL2,
    afterCountsForL2: Object.fromEntries(
      Object.keys(perL2).map((c) => [c, afterCounts[c] ?? 0]),
    ),
    dryRun: false,
    source: args.source,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
  };
  try {
    await fsp.writeFile(logPath, JSON.stringify(summary, null, 2), 'utf-8');
    process.stderr.write(`[backfill-l2] summary written: ${logPath}\n`);
  } catch (e) {
    process.stderr.write(`[backfill-l2] WARN: could not write summary to ${logPath}: ${e.message}\n`);
  }

  process.stderr.write(
    `[backfill-l2] live migration done: ${mutations.length} writes, ${writeErrors} errors, `
    + `${persistedL2}/${distinctL2} intended L2 classes now non-zero on entities.\n`,
  );

  if (writeErrors > 0 || persistedL2 < distinctL2) {
    process.stderr.write(`[backfill-l2] FATAL: not all queued L2 mutations persisted; log: ${logPath}\n`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify({ fatal: err?.message ?? String(err), stack: err?.stack }) + '\n',
  );
  process.exit(3);
});
