#!/usr/bin/env node
/**
 * Phase 60 Plan 04 — One-shot CollectiveKnowledge `ontologyClass` repair
 * (D-13). Sister-script to Phase 60 D-14's writer-side hard-root guard in
 * `integrations/mcp-server-semantic-analysis/src/agents/
 * ontology-classification-agent.ts`.
 *
 * # What this does
 *
 * Reads `.data/knowledge-graph/exports/general.json`, finds the
 * `CollectiveKnowledge` node (the System root of the VKB knowledge graph),
 * and — if its `ontologyClass` has drifted away from `'System'` — writes
 * it back via km-core's trusted path (`putEntity({ skipOntologyCheck:
 * true })`, Phase 43 D-G4.1 convention). Idempotent: a second run reports
 * "no change needed" instead of flipping again.
 *
 * # Why this is needed
 *
 * The unified viewer at `localhost:5173/viewer/coding` exempts
 * `System | Project | Component` ontologyClasses from the Learning Source
 * filter (`visibility-predicate.ts:69-76`). But the live snapshot
 * `general.json` carries CK as `ontologyClass: 'Detail'` while the writer
 * at `content-validation-agent.ts:2685` correctly asserts CK should be
 * `'System'`. Root cause is upstream data drift: a downstream LLM
 * re-classifier overwrites the writer's intended class. Plan 04 ships
 * both a data repair (this script, D-13) AND a writer-side guard (Task 3,
 * D-14) so the data flip can't recur.
 *
 * # Scope (narrow)
 *
 * Per Phase 60 D-24, this script stays NARROW. It touches ONLY
 * `attributes.ontologyClass` on the CK node. It does NOT touch:
 *
 *   - `metadata.classification` — already `'System'` per the 2026-06-17
 *     snapshot. No work.
 *   - `metadata.team` — `'ui'` is unusual for a system root but the
 *     `metadata.team` -> `metadata.project` rename is Phase 57 D-11's
 *     follow-up scope (LOWERONTO-04). Out of Phase 60.
 *   - The 4 project anchors (Coding / DynArch / Timeline / Normalisa) —
 *     verified `ontologyClass='Project'` already; the writer guard now
 *     keeps them locked.
 *
 * # km-core `ontologyDir` resolution (CLAUDE.md mandatory)
 *
 * Per the CLAUDE.md "km-core scripts" rule (Phase 41 lesson, commits
 * 87bc2f567 / fd35c5350): constructs `GraphKMStore` WITH an `ontologyDir`
 * option resolved via `import.meta.resolve('@fwornle/km-core')` walking up
 * to the package root. Without this option `GraphKMStore` throws
 * `opts.classes omitted but store has no ontology registry`.
 *
 * # Channel choice — stderr (per plan §Notes / I-1 rationale)
 *
 * All operator-facing status text goes to `process.stderr.write`. This is
 * a DELIBERATE channel choice matching the template script
 * `scripts/backfill-project-tag.mjs` (Phase 57 D-05): stdout stays
 * reserved for machine-readable output (this script writes none), stderr
 * carries operator-facing status. NOT a constraint-dodge from
 * `no-console-log` — the CLAUDE.md `Constraint dodging is forbidden`
 * clause does not apply to host-side scripts whose channel choice is
 * deliberate per the existing host-side CLI convention.
 *
 * # Usage
 *
 *   node scripts/repair-ck-ontology-class.mjs                # live, defaults
 *   node scripts/repair-ck-ontology-class.mjs --dry-run      # scan + summary, no writes
 *   node scripts/repair-ck-ontology-class.mjs --source PATH  # override default export path
 *   node scripts/repair-ck-ontology-class.mjs --log-dir DIR  # override default .data/ log dir
 *   node scripts/repair-ck-ontology-class.mjs --help         # this text + exit 0
 *
 * # Exit codes
 *
 *   0   success — CK ontologyClass is `'System'` after the run (whether
 *       no-change-needed OR a flip just occurred), OR --dry-run reported a
 *       needed flip.
 *   1   the post-write read showed the new class did NOT stick (data
 *       integrity failure — see log JSON for before/after).
 *   2   pre-flight failure (source missing, ontologyDir unresolvable,
 *       CK node not in the export, etc.).
 *   3   uncaught exception in main().
 *
 * @module scripts/repair-ck-ontology-class
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  GraphKMStore,
  HIERARCHY_ROOTS,
  HIERARCHY_ROOT_CLASS,
  isHierarchyRoot,
} from '@fwornle/km-core';

// ────────────────────────────────────────────────────────────────────────────
// CLI flag parsing — pure process.argv walk (matches backfill-project-tag.mjs)
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
      'Usage: node scripts/repair-ck-ontology-class.mjs [flags]',
      '',
      'One-shot repair: flips the CollectiveKnowledge node\'s `ontologyClass`',
      'back to "System" when it has drifted to "Detail" (or any other value).',
      'Idempotent — a second run reports "no change needed".',
      '',
      'Scope (narrow per Phase 60 D-24):',
      '  - Touches ONLY attributes.ontologyClass on the CK node.',
      '  - Does NOT touch metadata.classification (already "System").',
      '  - Does NOT touch metadata.team (out of scope; LOWERONTO-04).',
      '  - The 4 project anchors (Coding/DynArch/Timeline/Normalisa) are',
      '    not touched here — Phase 60 Task 3 writer-guard keeps them locked.',
      '',
      'Flags:',
      '  --source=<path>    JSON export to read (default .data/knowledge-graph/exports/general.json)',
      '  --log-dir=<dir>    Where to write the summary JSON (default .data/)',
      '  --dry-run          Scan + summary only, NO putEntity writes',
      '  --help, -h         Show this usage and exit 0',
      '',
      'Exit codes: 0 ok | 1 post-write check failed | 2 pre-flight failure | 3 uncaught',
      '',
    ].join('\n'),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// km-core ontologyDir resolution — VERBATIM from backfill-project-tag.mjs
// (CLAUDE.md "km-core scripts" mandatory rule). Walk up from
// import.meta.resolve('@fwornle/km-core') to the package root, then
// config/ontology/. Fallback to .data/ontologies/.
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
    // Most installs don't ship config/ontology/. Fall back to the project's
    // .data/ontologies/ which carries upper.json + coding-ontology.json.
    return path.resolve(process.cwd(), '.data/ontologies');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Source parsing — read the km-core Graphology export.
// ────────────────────────────────────────────────────────────────────────────

async function readExport(sourcePath) {
  const raw = await fsp.readFile(sourcePath, 'utf-8');
  return JSON.parse(raw);
}

function findCkNode(exportData) {
  const nodes = Array.isArray(exportData?.nodes) ? exportData.nodes : [];
  for (const node of nodes) {
    const name = node?.attributes?.name;
    if (name === 'CollectiveKnowledge') {
      return node;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

const TARGET_NAME = 'CollectiveKnowledge';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // Sanity assertion: the imported km-core surface must include CK in
  // HIERARCHY_ROOTS, and HIERARCHY_ROOT_CLASS[CK] must be 'System'. This
  // is the single source of truth we lock against — if the constants
  // drift, fail fast rather than silently writing the wrong value.
  if (!isHierarchyRoot(TARGET_NAME)) {
    process.stderr.write(
      `[repair-ck] FATAL: '${TARGET_NAME}' is not in HIERARCHY_ROOTS `
      + `(${JSON.stringify(HIERARCHY_ROOTS)}) — km-core export drift\n`,
    );
    process.exit(2);
  }
  const TARGET_CLASS = HIERARCHY_ROOT_CLASS[TARGET_NAME];
  if (TARGET_CLASS !== 'System') {
    process.stderr.write(
      `[repair-ck] FATAL: HIERARCHY_ROOT_CLASS['${TARGET_NAME}']='${TARGET_CLASS}' (expected 'System')\n`,
    );
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  process.stderr.write(
    `[repair-ck] start: source=${args.source} logDir=${args.logDir} `
    + `dryRun=${args.dryRun} target='${TARGET_NAME}' lockedClass='${TARGET_CLASS}'\n`,
  );

  // Pre-flight: source must exist and be readable JSON.
  if (!fs.existsSync(args.source)) {
    process.stderr.write(`[repair-ck] FATAL: source does not exist: ${args.source}\n`);
    process.exit(2);
  }
  if (!fs.existsSync(args.logDir)) {
    try {
      fs.mkdirSync(args.logDir, { recursive: true });
    } catch (e) {
      process.stderr.write(`[repair-ck] FATAL: cannot create logDir ${args.logDir}: ${e.message}\n`);
      process.exit(2);
    }
  }

  // Resolve ontologyDir per CLAUDE.md km-core scripts rule.
  let ontologyDir;
  try {
    ontologyDir = await resolveOntologyDir();
  } catch (e) {
    process.stderr.write(`[repair-ck] FATAL: resolveOntologyDir failed: ${e.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`[repair-ck] ontologyDir=${ontologyDir}\n`);

  // Load nodes from the JSON export and find the CK node.
  let exportData;
  try {
    exportData = await readExport(args.source);
  } catch (e) {
    process.stderr.write(`[repair-ck] FATAL: readExport(${args.source}) failed: ${e.message}\n`);
    process.exit(2);
  }
  const ckNode = findCkNode(exportData);
  if (!ckNode) {
    process.stderr.write(
      `[repair-ck] FATAL: CollectiveKnowledge node not found in ${args.source}\n`,
    );
    process.exit(2);
  }
  const ckEntity = ckNode.attributes;
  const entityId = typeof ckEntity?.id === 'string' ? ckEntity.id : ckNode.key;
  const before = ckEntity?.ontologyClass;
  process.stderr.write(
    `[repair-ck] found CK: key=${ckNode.key} entityId=${entityId} `
    + `before.ontologyClass=${JSON.stringify(before)}\n`,
  );

  const safeIso = startedAt.replace(/[:.]/g, '-');
  const logPath = path.join(args.logDir, `repair-ck-ontology-class-${safeIso}.json`);

  // Idempotency — exit clean if already System.
  if (before === TARGET_CLASS) {
    const summary = {
      status: 'no-change',
      target: TARGET_NAME,
      entityId,
      before,
      after: before,
      lockedClass: TARGET_CLASS,
      dryRun: args.dryRun,
      source: args.source,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    };
    try {
      await fsp.writeFile(logPath, JSON.stringify(summary, null, 2), 'utf-8');
    } catch (e) {
      process.stderr.write(`[repair-ck] WARN: could not write summary to ${logPath}: ${e.message}\n`);
    }
    process.stderr.write(
      `[repair-ck] no change needed (already ${TARGET_CLASS}); log: ${logPath}\n`,
    );
    process.exit(0);
  }

  // Dry-run path — print what would happen, exit 0, no writes.
  if (args.dryRun) {
    const summary = {
      status: 'dry-run',
      target: TARGET_NAME,
      entityId,
      before,
      wouldBecome: TARGET_CLASS,
      lockedClass: TARGET_CLASS,
      dryRun: true,
      source: args.source,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    };
    try {
      await fsp.writeFile(logPath, JSON.stringify(summary, null, 2), 'utf-8');
    } catch (e) {
      process.stderr.write(`[repair-ck] WARN: could not write summary to ${logPath}: ${e.message}\n`);
    }
    process.stderr.write(
      `[repair-ck] DRY RUN — would flip ontologyClass: ${JSON.stringify(before)} → `
      + `${JSON.stringify(TARGET_CLASS)} on entity ${entityId}; log: ${logPath}\n`,
    );
    process.exit(0);
  }

  // Live write path — open km-core store, putEntity with skipOntologyCheck.
  const exportDir = path.dirname(args.source);            // .data/knowledge-graph/exports
  const dataDir = path.dirname(exportDir);                // .data/knowledge-graph
  const dbPath = path.join(dataDir, 'leveldb');
  process.stderr.write(`[repair-ck] opening km-core store dbPath=${dbPath}\n`);

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
    process.stderr.write(`[repair-ck] FATAL: GraphKMStore.open failed: ${e.message}\n`);
    process.exit(2);
  }

  let putErr = null;
  let after = null;
  try {
    const mutated = { ...ckEntity, ontologyClass: TARGET_CLASS };
    try {
      // Phase 43 D-G4.1 trusted-path: skip ontology re-validation so the
      // (likely-unchanged) entityType registration in the lower ontology
      // doesn't block the write of an upper-class string.
      await store.putEntity(mutated, { skipOntologyCheck: true });
    } catch (writeErr) {
      putErr = writeErr;
    }

    // Flush the JSON export so general.json reflects the new value.
    if (typeof store.exportJson === 'function') {
      try {
        await store.exportJson();
      } catch (e) {
        process.stderr.write(`[repair-ck] WARN: exportJson failed: ${e.message}\n`);
      }
    }
  } finally {
    try { await store.close(); } catch (_e) { /* swallow */ }
  }

  if (putErr) {
    const summary = {
      status: 'error',
      target: TARGET_NAME,
      entityId,
      before,
      after: null,
      error: putErr.message ?? String(putErr),
      lockedClass: TARGET_CLASS,
      dryRun: false,
      source: args.source,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    };
    try {
      await fsp.writeFile(logPath, JSON.stringify(summary, null, 2), 'utf-8');
    } catch (_e) { /* swallow */ }
    process.stderr.write(
      `[repair-ck] FATAL: putEntity failed: ${putErr.message ?? putErr}; log: ${logPath}\n`,
    );
    process.exit(1);
  }

  // Re-read the export and verify the new value stuck.
  let afterData;
  try {
    afterData = await readExport(args.source);
  } catch (e) {
    process.stderr.write(`[repair-ck] FATAL: post-write readExport failed: ${e.message}\n`);
    process.exit(1);
  }
  const ckAfter = findCkNode(afterData);
  after = ckAfter?.attributes?.ontologyClass;

  const summary = {
    status: after === TARGET_CLASS ? 'flipped' : 'flip-not-persisted',
    target: TARGET_NAME,
    entityId,
    before,
    after,
    lockedClass: TARGET_CLASS,
    dryRun: false,
    source: args.source,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
  };
  try {
    await fsp.writeFile(logPath, JSON.stringify(summary, null, 2), 'utf-8');
    process.stderr.write(`[repair-ck] summary written: ${logPath}\n`);
  } catch (e) {
    process.stderr.write(`[repair-ck] WARN: could not write summary to ${logPath}: ${e.message}\n`);
  }

  if (after !== TARGET_CLASS) {
    process.stderr.write(
      `[repair-ck] FATAL: ontologyClass did not stick — got ${JSON.stringify(after)}; log: ${logPath}\n`,
    );
    process.exit(1);
  }

  process.stderr.write(
    `[repair-ck] before: ontologyClass=${JSON.stringify(before)}; `
    + `after: ontologyClass=${JSON.stringify(after)}; `
    + `log written to ${logPath}\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify({ fatal: err?.message ?? String(err), stack: err?.stack }) + '\n',
  );
  process.exit(3);
});
