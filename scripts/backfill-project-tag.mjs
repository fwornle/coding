#!/usr/bin/env node
/**
 * Phase 57 Plan 05 — One-shot `metadata.project` backfill (D-05).
 *
 * Reads `.data/knowledge-graph/exports/general.json`, derives
 * `metadata.project` per a 4-step precedence chain, and writes each entity
 * back through km-core's trusted path (`putEntity(entity, { skipOntologyCheck:
 * true })`). Idempotent — entities that already carry `metadata.project` are
 * skipped (step 1).
 *
 * Precedence (D-05):
 *   1. metadata.project populated + isProject(it)        → skip (no-op).
 *   2. metadata.team populated (string, length > 0)      → carry forward.
 *   3. legacyId.system === 'C'                           → 'okm'.
 *      legacyId.system === 'B'                           → 'coding'.
 *      legacyId.system === 'A'                           → 'coding'.
 *   4. default                                           → 'coding'
 *                                                          (record in ambiguousDefaultIds).
 *
 * Per CLAUDE.md "km-core scripts" rule (Phase 41 lesson, commits
 * 87bc2f567 / fd35c5350): constructs GraphKMStore WITH an `ontologyDir`
 * option resolved via `import.meta.resolve('@fwornle/km-core')` walking up to
 * the package root. Without this option GraphKMStore throws
 * `opts.classes omitted but store has no ontology registry`.
 *
 * Output: writes a summary artifact `.data/backfill-project-tag-<ISO>.json`
 * containing per-precedence-step counts + the ambiguous-default ID list so
 * the operator can spot-check classifications (D-06).
 *
 * Usage:
 *   node scripts/backfill-project-tag.mjs                           # live, defaults
 *   node scripts/backfill-project-tag.mjs --dry-run                 # scan + summary only, no writes
 *   node scripts/backfill-project-tag.mjs --limit N                 # stop after N entities (testing)
 *   node scripts/backfill-project-tag.mjs --source PATH             # override default export path
 *   node scripts/backfill-project-tag.mjs --log-dir DIR             # override default .data/ log dir
 *
 * Defaults:
 *   --source   .data/knowledge-graph/exports/general.json
 *   --log-dir  .data/
 *
 * Exit codes:
 *   0   success — errorRatio ≤ 5%.
 *   1   error budget exceeded (>5% of entities failed to write).
 *   2   pre-flight failure (source missing, ontologyDir unresolvable, etc.).
 *   3   uncaught exception in main().
 *
 * @module scripts/backfill-project-tag
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { fileURLToPath } from 'node:url';
import { GraphKMStore, isProject, PROJECTS } from '@fwornle/km-core';

// ────────────────────────────────────────────────────────────────────────────
// CLI flag parsing — pure process.argv walk, no new deps (matches the
// in-repo convention from scripts/migrate-sqlite-to-kmcore.mjs +
// integrations/.../augment-team-field-42.2.mjs).
// ────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    source: path.resolve(process.cwd(), '.data/knowledge-graph/exports/general.json'),
    logDir: path.resolve(process.cwd(), '.data'),
    limit: null,
    dryRun: false,
    help: false,
  };
  for (const a of argv) {
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--source=')) args.source = path.resolve(a.slice('--source='.length));
    else if (a === '--source') {
      // Support space-separated form too: `--source PATH`. Defer to next arg.
      // Not strictly needed by tests but matches operator habit.
    }
    else if (a.startsWith('--log-dir=')) args.logDir = path.resolve(a.slice('--log-dir='.length));
    else if (a.startsWith('--limit=')) {
      const n = parseInt(a.slice('--limit='.length), 10);
      args.limit = Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return args;
}

function printUsage() {
  process.stderr.write(
    [
      'Usage: node scripts/backfill-project-tag.mjs [flags]',
      '',
      'One-shot metadata.project backfill on the km-core JSON export.',
      '',
      'Flags:',
      '  --source=<path>    JSON export to read (default .data/knowledge-graph/exports/general.json)',
      '  --log-dir=<dir>    Where to write the summary JSON (default .data/)',
      '  --limit=<N>        Process at most N entities (testing)',
      '  --dry-run          Scan + summary only, NO putEntity writes',
      '  --help, -h         Show this usage and exit 0',
      '',
      'Exit codes: 0 ok | 1 error-budget exceeded | 2 pre-flight failure | 3 uncaught',
      '',
    ].join('\n'),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// km-core ontologyDir resolution — VERBATIM from Phase 43
// migrate-okm-json-to-kmcore.mjs:108-137 (CLAUDE.md "km-core scripts"
// mandatory rule). Walk up from import.meta.resolve('@fwornle/km-core')
// to the package root, then config/ontology/. Fallback to .data/ontologies/.
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
// 4-step precedence derivation (D-05). Returns { project, step } where
// `step` is one of: 'team' | 'legacyId-C' | 'legacyId-B' | 'legacyId-A'
// | 'default-ambiguous'. Caller handles the step-1 idempotency skip BEFORE
// invoking this — passing an entity with metadata.project populated would
// re-derive (which is a caller bug; we don't second-guess here).
// ────────────────────────────────────────────────────────────────────────────

function deriveProject(entity) {
  const meta = (entity && entity.metadata && typeof entity.metadata === 'object')
    ? entity.metadata
    : {};

  // Step 2: carry forward existing team — but ONLY if it passes the closed-set
  // typeguard. A team value like 'bmw' (not in PROJECTS) silently falls through
  // to step 3/4 and produces a stderr warning so the operator can investigate.
  if (typeof meta.team === 'string' && meta.team.length > 0) {
    if (isProject(meta.team)) {
      return { project: meta.team, step: 'team' };
    }
    process.stderr.write(
      `[backfill-57] WARN entity ${entity.id?.slice(0, 8) ?? '<no-id>'} `
      + `metadata.team='${meta.team}' is not in PROJECTS ${JSON.stringify(PROJECTS)} — `
      + `falling through to legacyId / default heuristic\n`,
    );
  }

  // Step 3: legacyId/system heuristic.
  const legacy = entity?.legacyId;
  if (legacy && typeof legacy === 'object') {
    if (legacy.system === 'C') return { project: 'okm', step: 'legacyId-C' };
    if (legacy.system === 'B') return { project: 'coding', step: 'legacyId-B' };
    if (legacy.system === 'A') return { project: 'coding', step: 'legacyId-A' };
  }

  // Step 4: default + log for operator review.
  return { project: 'coding', step: 'default-ambiguous' };
}

// ────────────────────────────────────────────────────────────────────────────
// Source parsing — read the km-core Graphology export. Each node carries
// `{ key, attributes: { id, name, entityType, metadata, legacyId, ... } }`.
// We work on `attributes` (the Entity shape km-core writes back).
// ────────────────────────────────────────────────────────────────────────────

async function readExport(sourcePath) {
  const raw = await fsp.readFile(sourcePath, 'utf-8');
  const parsed = JSON.parse(raw);
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  return nodes;
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
    `[backfill-57] start: source=${args.source} logDir=${args.logDir} `
    + `limit=${args.limit ?? '∞'} dryRun=${args.dryRun}\n`,
  );

  // Pre-flight: source must exist and be readable JSON.
  if (!fs.existsSync(args.source)) {
    process.stderr.write(`[backfill-57] FATAL: source does not exist: ${args.source}\n`);
    process.exit(2);
  }
  if (!fs.existsSync(args.logDir)) {
    try {
      fs.mkdirSync(args.logDir, { recursive: true });
    } catch (e) {
      process.stderr.write(`[backfill-57] FATAL: cannot create logDir ${args.logDir}: ${e.message}\n`);
      process.exit(2);
    }
  }

  // Resolve ontologyDir per CLAUDE.md.
  let ontologyDir;
  try {
    ontologyDir = await resolveOntologyDir();
  } catch (e) {
    process.stderr.write(`[backfill-57] FATAL: resolveOntologyDir failed: ${e.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`[backfill-57] ontologyDir=${ontologyDir}\n`);

  // Load nodes from the JSON export. The export is the authoritative read
  // surface — we do NOT open the live LevelDB store in --dry-run because
  // that could contend with the running obs-api / coding-services daemons.
  let nodes;
  try {
    nodes = await readExport(args.source);
  } catch (e) {
    process.stderr.write(`[backfill-57] FATAL: readExport(${args.source}) failed: ${e.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`[backfill-57] loaded ${nodes.length} nodes from ${path.basename(args.source)}\n`);

  // Apply --limit BEFORE opening the store so dry-run perf scales with limit.
  const sliceEnd = args.limit != null ? Math.min(args.limit, nodes.length) : nodes.length;
  const workingNodes = nodes.slice(0, sliceEnd);

  // Open the km-core store only when not dry-run. Dry-run does pure
  // derivation + summary — no LevelDB / no writes — so the script is safe to
  // run against a live system without --dry-run worries about LOCK contention.
  // The store opens against the live `.data/knowledge-graph/` dir by walking
  // up from the export path: <sourceParent>/../ = .data/knowledge-graph/.
  let store = null;
  if (!args.dryRun) {
    const exportDir = path.dirname(args.source);                 // .data/knowledge-graph/exports
    const dataDir = path.dirname(exportDir);                     // .data/knowledge-graph
    const dbPath = path.join(dataDir, 'leveldb');
    process.stderr.write(`[backfill-57] opening km-core store dbPath=${dbPath}\n`);
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
      process.stderr.write(`[backfill-57] FATAL: GraphKMStore.open failed: ${e.message}\n`);
      process.exit(2);
    }
  }

  // Counters per D-06 summary shape.
  let scanned = 0;
  let skipped = 0;
  let migrated = 0;
  let errors = 0;
  const byPrecedenceStep = {
    'team': 0,
    'legacyId-C': 0,
    'legacyId-B': 0,
    'legacyId-A': 0,
    'default-ambiguous': 0,
  };
  const ambiguousDefaultIds = [];
  const errorSamples = [];
  const PROGRESS_EVERY = 100;

  try {
    for (let i = 0; i < workingNodes.length; i++) {
      scanned++;
      const node = workingNodes[i];
      const entity = (node && node.attributes && typeof node.attributes === 'object')
        ? node.attributes
        : null;
      if (!entity || typeof entity.id !== 'string' || entity.id.length === 0) {
        errors++;
        errorSamples.push({
          idx: i,
          message: 'node.attributes missing or has no id',
        });
        continue;
      }

      try {
        // Step 1 — idempotency. Skip if metadata.project is already populated
        // AND passes the typeguard. (A bogus pre-existing value like
        // metadata.project='bmw' falls through to re-derivation so the script
        // is self-healing across schema-drift incidents.)
        const meta = (entity.metadata && typeof entity.metadata === 'object')
          ? entity.metadata
          : {};
        if (typeof meta.project === 'string' && meta.project.length > 0 && isProject(meta.project)) {
          skipped++;
          continue;
        }

        // Steps 2-4.
        const { project, step } = deriveProject(entity);
        byPrecedenceStep[step] = (byPrecedenceStep[step] ?? 0) + 1;
        if (step === 'default-ambiguous') {
          ambiguousDefaultIds.push(entity.id);
        }

        if (args.dryRun) {
          migrated++;
        } else {
          // Trusted-path write per Phase 43 D-G4.1 convention. We're stamping
          // metadata.project only — not changing ontologyClass — so skip the
          // ontology re-validation that would fail for entities whose
          // entityType isn't in the current registry (a pre-existing condition
          // unrelated to this backfill).
          const mutated = {
            ...entity,
            metadata: { ...meta, project },
          };
          try {
            await store.putEntity(mutated, { skipOntologyCheck: true });
            migrated++;
          } catch (writeErr) {
            errors++;
            if (errorSamples.length < 10) {
              errorSamples.push({
                id: entity.id.slice(0, 8),
                name: entity.name ?? '<no-name>',
                message: writeErr.message ?? String(writeErr),
              });
            }
            process.stderr.write(
              `[backfill-57] putEntity failed for ${entity.id.slice(0, 8)} (${entity.name ?? '?'}): ${writeErr.message}\n`,
            );
          }
        }
      } catch (e) {
        errors++;
        if (errorSamples.length < 10) {
          errorSamples.push({ id: entity.id?.slice(0, 8), message: e.message });
        }
      }

      if ((i + 1) % PROGRESS_EVERY === 0) {
        process.stderr.write(
          `[backfill-57] progress: ${i + 1}/${workingNodes.length} `
          + `migrated=${migrated} skipped=${skipped} errors=${errors}\n`,
        );
      }
    }

    // Flush the store's JSON exports so the operator can see the new
    // metadata.project value reflected in general.json immediately.
    if (!args.dryRun && store) {
      try {
        // GraphKMStore.exportJson() persists per-domain exports.
        if (typeof store.exportJson === 'function') {
          await store.exportJson();
        }
      } catch (e) {
        process.stderr.write(`[backfill-57] exportJson failed: ${e.message}\n`);
      }
    }
  } finally {
    if (store) {
      try { await store.close(); } catch (_e) { /* swallow */ }
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;
  const errorRatio = scanned === 0 ? 0 : errors / scanned;

  const summary = {
    startedAt,
    finishedAt,
    durationMs,
    source: args.source,
    dryRun: args.dryRun,
    totalEntities: scanned,
    skipped,
    migrated,
    errors,
    errorRatio,
    byPrecedenceStep,
    ambiguousDefaultIds,
    ambiguousDefaultCount: ambiguousDefaultIds.length,
    errorSamples,
  };

  // Write log artifact (D-06). Filename: backfill-project-tag-<ISO>.json with
  // colon-stripping so it's filesystem-friendly across OSes.
  const safeIso = startedAt.replace(/[:.]/g, '-');
  const logPath = path.join(args.logDir, `backfill-project-tag-${safeIso}.json`);
  try {
    await fsp.writeFile(logPath, JSON.stringify(summary, null, 2), 'utf-8');
    process.stderr.write(`[backfill-57] summary written: ${logPath}\n`);
  } catch (e) {
    process.stderr.write(`[backfill-57] WARN: could not write summary to ${logPath}: ${e.message}\n`);
  }

  // Final stderr summary line so operators see the result without opening the JSON.
  process.stderr.write(JSON.stringify(summary, null, 0) + '\n');

  // Fail-loud on >5% error budget (mirrors migrate-sqlite-to-kmcore.mjs +
  // augment-team-field-42.2.mjs conventions).
  if (errorRatio > 0.05) {
    process.stderr.write(
      `[backfill-57] FATAL: errorRatio=${errorRatio.toFixed(4)} exceeds 5% budget\n`,
    );
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
