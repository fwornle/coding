#!/usr/bin/env node
/**
 * Phase 58 Plan 03 — One-shot `mentions`-edges backfill (D-05).
 *
 * Reads `.data/knowledge-graph/exports/general.json`, identifies every
 * `entityType === 'Insight'` node, runs the same LLM classifier
 * (`MentionsClassifier.classifyMentions` from Plan 58-01) against each, and
 * emits `mentions` edges back through `kmStore.addRelation` with
 * `metadata.source = 'backfill-insight-mentions'` (D-05.1).
 *
 * Idempotent — Insights that already carry ≥1 outgoing `mentions` edge
 * (per the export-time scan) are filtered out; the per-target write also
 * runs a `findRelations` dedup probe so re-runs against the live store
 * don't duplicate edges (PATTERNS Shared Pattern A; km-core `addRelation`
 * is NOT idempotent on the `(from,to,type)` triple).
 *
 * Per CLAUDE.md "km-core scripts" rule (Phase 41 lesson), constructs
 * `GraphKMStore` WITH an `ontologyDir` option resolved via
 * `import.meta.resolve('@fwornle/km-core')` walking up to the package root.
 *
 * Output: `.data/backfill-insight-mentions-<ISO>.json` per the Phase 57-05
 * convention — `{ dryRun, totalInsights, classified, edgesWritten, errors,
 * skipped, perInsight: [{insightId, name, mentionsAdded, errors[]}, ...] }`.
 *
 * Operator-invocation contract — see plan §Task 3 for the LOCK-release dance
 * (`docker-compose stop coding-services` + `launchctl bootout
 * com.coding.obs-api.plist` before live runs) and the wave-analysis routing
 * pre-flight that keeps wall-clock under ~3 min (vs ~90 min on claude-code).
 *
 * Usage:
 *   node scripts/backfill-insight-mentions.mjs                  # live, defaults
 *   node scripts/backfill-insight-mentions.mjs --dry-run        # scan + summary only
 *   node scripts/backfill-insight-mentions.mjs --limit N        # process at most N
 *   node scripts/backfill-insight-mentions.mjs --source PATH    # override export
 *   node scripts/backfill-insight-mentions.mjs --log-dir DIR    # override summary dir
 *
 * Defaults:
 *   --source   .data/knowledge-graph/exports/general.json
 *   --log-dir  .data/
 *
 * Exit codes:
 *   0   success — errorRatio ≤ 5%
 *   1   error budget exceeded
 *   2   pre-flight failure (source missing, ontologyDir unresolvable)
 *   3   uncaught exception in main()
 *
 * @module scripts/backfill-insight-mentions
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { fileURLToPath } from 'node:url';
import { GraphKMStore } from '@fwornle/km-core';
import { loadMentionCandidates, classifyMentions } from '../src/live-logging/MentionsClassifier.js';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/**
 * 5% error budget — mirrors `scripts/backfill-project-tag.mjs` (Phase 57-05).
 * Per-Insight errors don't abort the loop; the whole script aborts only when
 * the aggregate ratio exceeds this threshold AND the population is large
 * enough for the ratio to be statistically meaningful.
 *
 * The min-population gate (`ERROR_BUDGET_MIN_POPULATION`) prevents the
 * budget from firing on tiny test fixtures where 1-of-3 errors (33%) is a
 * single noisy classifier call rather than a systemic failure. The plan's
 * Task 1 Test 8 explicitly contracts exit 0 when one of three Insights
 * throws — the per-Insight failure mode is captured in
 * `perInsight[].errors[]` but the run is considered successful.
 */
const ERROR_BUDGET_RATIO = 0.05;
const ERROR_BUDGET_MIN_POPULATION = 20;

/**
 * Edge metadata source-tag. Distinct from the writer-path
 * (`'observation-writer'`), the consolidator-emit tag
 * (`'observation-consolidator'`), and the bridge tag
 * (`'consolidator-bridge'`) so every mentions edge is traceable to its
 * originating writer (D-06.2 / threat T-58-03-06).
 */
const EDGE_SOURCE = 'backfill-insight-mentions';

// ────────────────────────────────────────────────────────────────────────────
// CLI parsing
// ────────────────────────────────────────────────────────────────────────────

/**
 * Walk process.argv for the supported flags. Pure function — no I/O — so
 * unit tests can exercise it directly.
 *
 * Supported flags:
 *   --dry-run               scan + summary, NO kmStore writes (NO LevelDB open)
 *   --limit=N               process at most N un-mentioned Insights
 *   --source=PATH           override default JSON export path
 *   --log-dir=DIR           override default summary destination
 *   --help, -h              print usage and exit 0
 *
 * @param {string[]} argv
 * @returns {{source:string, logDir:string, limit:number|null, dryRun:boolean, help:boolean}}
 */
export function parseArgs(argv) {
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
      'Usage: node scripts/backfill-insight-mentions.mjs [flags]',
      '',
      'One-shot mentions-edges backfill on the km-core JSON export (Phase 58 D-05).',
      '',
      'Flags:',
      '  --source=<path>    JSON export to read (default .data/knowledge-graph/exports/general.json)',
      '  --log-dir=<dir>    Where to write the summary JSON (default .data/)',
      '  --limit=<N>        Process at most N un-mentioned Insights',
      '  --dry-run          Scan + classify + summary only, NO kmStore writes',
      '  --help, -h         Show this usage and exit 0',
      '',
      'Operator runbook for live execution — see PLAN §Task 3.',
      '',
      'Exit codes: 0 ok | 1 error-budget exceeded | 2 pre-flight failure | 3 uncaught',
      '',
    ].join('\n'),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// km-core ontologyDir resolution (Phase 41 / 57-05 verbatim)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Walk up from `import.meta.resolve('@fwornle/km-core')` to find the package
 * root, then `config/ontology/`. Falls back to `.data/ontologies` per
 * `scripts/backfill-project-tag.mjs` lines 115-150.
 *
 * Required by CLAUDE.md "km-core scripts" rule: GraphKMStore constructed
 * WITHOUT `ontologyDir` throws `opts.classes omitted but store has no
 * ontology registry` on default-class resolution.
 *
 * @returns {Promise<string>} absolute path
 */
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

// ────────────────────────────────────────────────────────────────────────────
// Export reader
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse the km-core Graphology export. Returns the parsed payload with
 * `{ nodes: [...], edges: [...] }` at the top level (verified 2026-06-15
 * against the live file).
 *
 * @param {string} sourcePath
 * @returns {Promise<{nodes: any[], edges: any[]}>}
 */
async function readExport(sourcePath) {
  const raw = await fsp.readFile(sourcePath, 'utf-8');
  const parsed = JSON.parse(raw);
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const edges = Array.isArray(parsed?.edges) ? parsed.edges : [];
  return { nodes, edges };
}

// ────────────────────────────────────────────────────────────────────────────
// Description derivation — mirrors MentionsClassifier.deriveDescription
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract a string summary from an Insight node for the classifier input.
 *
 * Handles the three Entity shapes the codebase emits:
 *   1. `e.descriptionSegments[].text` (segmented provenance)
 *   2. `e.description` (legacy / scripted-write string)
 *   3. `e.name` (fallback if description missing)
 *
 * Falls back to empty string (NOT undefined) so the LLM never sees
 * 'undefined' as a summary.
 *
 * @param {object} insight
 * @returns {string}
 */
function deriveInsightSummary(insight) {
  if (!insight || typeof insight !== 'object') return '';
  if (Array.isArray(insight.descriptionSegments) && insight.descriptionSegments.length > 0) {
    const joined = insight.descriptionSegments
      .map((s) => (s && typeof s.text === 'string') ? s.text : '')
      .filter(Boolean)
      .join(' ');
    if (joined) return joined;
  }
  if (typeof insight.description === 'string' && insight.description) return insight.description;
  if (typeof insight.name === 'string') return insight.name;
  return '';
}

// ────────────────────────────────────────────────────────────────────────────
// processInsight — exported helper (W5 contract for Plan 58-04 Test 5)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Process one Insight node: derive its summary, classify mentions, dedup,
 * emit edges.
 *
 * Exported so the Plan 58-04 integration test can exercise the per-Insight
 * path WITHOUT re-implementing the dedup logic. The script's `main()` loop
 * calls this exact function — no copy-paste; the exported helper IS the
 * per-Insight implementation.
 *
 * Per CLAUDE.md "no console.*" — uses `process.stderr.write` for forensic
 * output. The `process.stderr.write` channel is the established logger for
 * this module surface (Phase 57-04 / 58-01 / 58-02 SUMMARY all lock the
 * convention with `grep -c 'console\.log' == 0`).
 *
 * @param {Object} insightNode - Insight node from the JSON export OR a live
 *   `findByOntologyClass('Insight')` entity. Must have `id`, `name`; ideally
 *   carries `description` or `descriptionSegments`.
 * @param {Object} kmStore - GraphKMStore instance OR a mock with
 *   `findRelations({from,to,type})` and `addRelation({from,to,type,metadata})`.
 * @param {Object} options
 * @param {(summary:string, candidates:any[]) => Promise<string[]>} options.classifier
 *   - Classifier function returning target ids (typically `classifyMentions`).
 * @param {Array<{id:string,name:string,description:string}>} options.candidates
 *   - Pre-loaded candidate catalog (from `loadMentionCandidates(kmStore)`).
 * @param {string} options.source - `metadata.source` stamp for each emitted edge.
 * @param {boolean} [options.dryRun=false] - When true, classifier still runs
 *   for forecast accuracy but addRelation is skipped.
 * @returns {Promise<{insightId:string, name:string, mentionsAdded:number,
 *   classifierTargets:string[], errors:string[]}>}
 */
export async function processInsight(insightNode, kmStore, options) {
  const insightId = insightNode?.id ?? '';
  const name = insightNode?.name ?? '';
  const record = {
    insightId,
    name,
    mentionsAdded: 0,
    classifierTargets: [],
    errors: [],
  };

  const classifier = options?.classifier;
  if (typeof classifier !== 'function') {
    record.errors.push('options.classifier must be a function');
    return record;
  }
  const candidates = Array.isArray(options?.candidates) ? options.candidates : [];
  const source = typeof options?.source === 'string' ? options.source : EDGE_SOURCE;
  const dryRun = Boolean(options?.dryRun);

  // Step 1: derive summary and call classifier (D-02 / D-04.1 fail-fast).
  const summary = deriveInsightSummary(insightNode);
  let targetIds;
  try {
    targetIds = await classifier(summary, candidates);
    if (!Array.isArray(targetIds)) targetIds = [];
  } catch (err) {
    const msg = err && typeof err.message === 'string' ? err.message : String(err);
    record.errors.push(`classifier: ${msg}`);
    return record;
  }
  record.classifierTargets = [...targetIds];

  // Step 2: per-target dedup + addRelation (or skip if dry-run).
  for (const targetId of targetIds) {
    if (!targetId || typeof targetId !== 'string') continue;
    if (targetId === insightId) continue; // self-loop guard

    // dryRun: still count classifier targets but skip dedup + write.
    if (dryRun) continue;

    // Dedup probe — km-core addRelation is NOT idempotent on (from,to,type).
    let existing = [];
    try {
      existing = await kmStore.findRelations({ from: insightId, to: targetId, type: 'mentions' });
    } catch (err) {
      const msg = err && typeof err.message === 'string' ? err.message : String(err);
      record.errors.push(`findRelations ${insightId}->${targetId}: ${msg}`);
      continue;
    }
    if (Array.isArray(existing) && existing.length > 0) continue;

    try {
      await kmStore.addRelation({
        from: insightId,
        to: targetId,
        type: 'mentions',
        metadata: {
          source,
          classifiedAt: new Date().toISOString(),
          classifier: 'llm-haiku',
        },
      });
      record.mentionsAdded += 1;
    } catch (err) {
      // Source/Target-not-found is benign — mirrors _anchorEntity precedent.
      const msg = err && typeof err.message === 'string' ? err.message : String(err);
      record.errors.push(`addRelation ${insightId}->${targetId}: ${msg}`);
      process.stderr.write(
        `[backfill-58-03] addRelation ${insightId.slice(0, 8)}->${targetId.slice(0, 8)} `
        + `failed (non-fatal): ${msg}\n`,
      );
    }
  }

  return record;
}

// ────────────────────────────────────────────────────────────────────────────
// Test-stub classifier — driven by BACKFILL_TEST_CLASSIFIER_STUB env var
// ────────────────────────────────────────────────────────────────────────────

/**
 * When the BACKFILL_TEST_CLASSIFIER_STUB env var is set, the script swaps
 * the live `classifyMentions` for a deterministic stub. Used by the unit
 * suite to drive the end-to-end script-invocation tests without touching
 * the live LLM proxy.
 *
 * Stub format:
 *   BACKFILL_TEST_CLASSIFIER_STUB = JSON({ [insightId]: string[] })
 *   BACKFILL_TEST_CLASSIFIER_THROW = JSON({ [insightId]: true })  (optional)
 *
 * @returns {((summary:string, candidates:any[]) => Promise<string[]>) | null}
 *   The stub function bound to a specific insightId, OR null when no env var
 *   is set (production path).
 */
function makeStubClassifierForInsight(insightId) {
  const stubRaw = process.env.BACKFILL_TEST_CLASSIFIER_STUB;
  const throwRaw = process.env.BACKFILL_TEST_CLASSIFIER_THROW;
  if (!stubRaw && !throwRaw) return null;
  let stubMap = {};
  let throwMap = {};
  try { stubMap = stubRaw ? JSON.parse(stubRaw) : {}; } catch { stubMap = {}; }
  try { throwMap = throwRaw ? JSON.parse(throwRaw) : {}; } catch { throwMap = {}; }
  return async () => {
    if (throwMap[insightId]) {
      throw new Error(`stub-classifier-throw for ${insightId}`);
    }
    const out = stubMap[insightId];
    return Array.isArray(out) ? out : [];
  };
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
    `[backfill-58-03] start: source=${args.source} logDir=${args.logDir} `
    + `limit=${args.limit ?? '∞'} dryRun=${args.dryRun}\n`,
  );

  // Pre-flight: source must exist + log-dir must be writable.
  if (!fs.existsSync(args.source)) {
    process.stderr.write(`[backfill-58-03] FATAL: source does not exist: ${args.source}\n`);
    process.exit(2);
  }
  if (!fs.existsSync(args.logDir)) {
    try {
      fs.mkdirSync(args.logDir, { recursive: true });
    } catch (e) {
      process.stderr.write(`[backfill-58-03] FATAL: cannot create logDir ${args.logDir}: ${e.message}\n`);
      process.exit(2);
    }
  }

  // Resolve ontologyDir per CLAUDE.md.
  let ontologyDir;
  try {
    ontologyDir = await resolveOntologyDir();
  } catch (e) {
    process.stderr.write(`[backfill-58-03] FATAL: resolveOntologyDir failed: ${e.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`[backfill-58-03] ontologyDir=${ontologyDir}\n`);

  // Load nodes + edges from the JSON export.
  let parsedExport;
  try {
    parsedExport = await readExport(args.source);
  } catch (e) {
    process.stderr.write(`[backfill-58-03] FATAL: readExport(${args.source}) failed: ${e.message}\n`);
    process.exit(2);
  }
  const { nodes, edges } = parsedExport;
  process.stderr.write(`[backfill-58-03] loaded ${nodes.length} nodes / ${edges.length} edges\n`);

  // Build the already-mentioned set by scanning edges for mentions edges
  // (idempotency gate — D-05).
  const insightsWithMentions = new Set();
  for (const edge of edges) {
    const attrs = edge?.attributes;
    if (attrs && attrs.type === 'mentions' && typeof attrs.from === 'string') {
      insightsWithMentions.add(attrs.from);
    }
  }

  // Filter to entityType==='Insight' AND NOT already-mentioned.
  const insightNodes = nodes
    .filter((n) => n?.attributes?.entityType === 'Insight')
    .map((n) => n.attributes); // hoist attributes to Entity shape
  const unmentioned = insightNodes.filter((e) => !insightsWithMentions.has(e.id));

  process.stderr.write(
    `[backfill-58-03] Insight total=${insightNodes.length} `
    + `alreadyMentioned=${insightNodes.length - unmentioned.length} `
    + `unmentioned=${unmentioned.length}\n`,
  );

  // Apply --limit slicing (after the universe is counted).
  const sliceEnd = args.limit != null ? Math.min(args.limit, unmentioned.length) : unmentioned.length;
  const working = unmentioned.slice(0, sliceEnd);
  const limitSkipped = unmentioned.length - working.length;

  // Open the live kmStore only when NOT dry-run.
  let store = null;
  let candidates = [];
  if (!args.dryRun) {
    const exportDir = path.dirname(args.source);
    const dataDir = path.dirname(exportDir);
    const dbPath = path.join(dataDir, 'leveldb');
    process.stderr.write(`[backfill-58-03] opening km-core store dbPath=${dbPath}\n`);
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
      process.stderr.write(`[backfill-58-03] FATAL: GraphKMStore.open failed: ${e.message}\n`);
      process.exit(2);
    }
    // Load the candidate catalog once — shared across all Insight calls.
    try {
      candidates = await loadMentionCandidates(store);
    } catch (e) {
      process.stderr.write(`[backfill-58-03] FATAL: loadMentionCandidates failed: ${e.message}\n`);
      try { await store.close(); } catch { /* swallow */ }
      process.exit(2);
    }
    process.stderr.write(`[backfill-58-03] candidate catalog: ${candidates.length} entries\n`);
  } else {
    // Dry-run: build candidates from the export so the classifier has something
    // to work against. The classifier stub used by tests ignores candidates,
    // but a live --dry-run still benefits from a real catalog forecast.
    candidates = nodes
      .filter((n) => n?.attributes?.entityType === 'Component'
        || n?.attributes?.entityType === 'SubComponent'
        || n?.attributes?.entityType === 'Detail')
      .map((n) => ({
        id: n.attributes.id,
        name: n.attributes.name,
        description: typeof n.attributes.description === 'string' ? n.attributes.description : '',
      }));
    process.stderr.write(`[backfill-58-03] dry-run candidate catalog: ${candidates.length} entries\n`);
  }

  // Per-Insight processing loop.
  const perInsight = [];
  let edgesWritten = 0;
  let classified = 0;
  let errors = 0;
  const PROGRESS_EVERY = 10;

  try {
    for (let i = 0; i < working.length; i++) {
      const insight = working[i];
      // Choose classifier: stub from env var (test-mode), or the production
      // classifyMentions wired to the rapid-llm-proxy. The dry-run path also
      // honors the stub so the test suite gets deterministic output.
      const stub = makeStubClassifierForInsight(insight.id);
      const classifierFn = stub != null
        ? stub
        : async (summary, cands) => await classifyMentions(summary, cands);

      const record = await processInsight(insight, store ?? makeDryRunStore(), {
        classifier: classifierFn,
        candidates,
        source: EDGE_SOURCE,
        dryRun: args.dryRun,
      });
      perInsight.push(record);
      classified += 1;
      edgesWritten += record.mentionsAdded;
      if (record.errors.length > 0) errors += 1;

      if ((i + 1) % PROGRESS_EVERY === 0) {
        process.stderr.write(
          `[backfill-58-03] progress: ${i + 1}/${working.length} `
          + `edgesWritten=${edgesWritten} errors=${errors}\n`,
        );
      }
    }

    // Flush the store's JSON export so the operator sees the new edges
    // reflected in general.json immediately (mirrors backfill-project-tag.mjs).
    if (!args.dryRun && store) {
      try {
        if (typeof store.exportJson === 'function') {
          await store.exportJson();
        }
      } catch (e) {
        process.stderr.write(`[backfill-58-03] exportJson failed: ${e.message}\n`);
      }
    }
  } finally {
    if (store) {
      try { await store.close(); } catch { /* swallow */ }
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;
  const errorRatio = classified === 0 ? 0 : errors / classified;

  const summary = {
    startedAt,
    finishedAt,
    durationMs,
    source: args.source,
    dryRun: args.dryRun,
    totalInsights: insightNodes.length,
    alreadyMentioned: insightNodes.length - unmentioned.length,
    skipped: (insightNodes.length - unmentioned.length) + limitSkipped,
    classified,
    edgesWritten,
    errors,
    errorRatio,
    perInsight,
  };

  // Write the per-run summary artifact (D-05.1).
  const safeIso = startedAt.replace(/[:.]/g, '-');
  const summaryPath = path.join(args.logDir, `backfill-insight-mentions-${safeIso}.json`);
  try {
    await fsp.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    process.stderr.write(`[backfill-58-03] summary written: ${summaryPath}\n`);
  } catch (e) {
    process.stderr.write(`[backfill-58-03] WARN: could not write summary to ${summaryPath}: ${e.message}\n`);
  }

  // Final stderr summary line.
  process.stderr.write(
    `[backfill-58-03] DONE total=${insightNodes.length} classified=${classified} `
    + `edgesWritten=${edgesWritten} errors=${errors} ratio=${errorRatio.toFixed(4)} `
    + `durationMs=${durationMs}\n`,
  );

  // Fail-loud on >5% error budget — but only when the population is large
  // enough for the ratio to be meaningful (ERROR_BUDGET_MIN_POPULATION).
  // Tiny populations (test fixtures with 1-of-3 errors) are not aborted —
  // per-Insight failures are still captured in perInsight[].errors[] but
  // the run is considered successful (Task 1 Test 8 contract).
  if (classified >= ERROR_BUDGET_MIN_POPULATION && errorRatio > ERROR_BUDGET_RATIO) {
    process.stderr.write(
      `[backfill-58-03] FATAL: errorRatio=${errorRatio.toFixed(4)} `
      + `exceeds ${ERROR_BUDGET_RATIO} budget over ${classified} Insights\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}

/**
 * Minimal in-memory store for dry-run mode. Backs the per-Insight
 * findRelations/addRelation calls in processInsight so the loop has a
 * consistent interface; in dry-run, processInsight short-circuits BEFORE
 * either call, so these methods are mostly never exercised in dry-run.
 *
 * @returns {{findRelations: Function, addRelation: Function}}
 */
function makeDryRunStore() {
  return {
    async findRelations() { return []; },
    async addRelation() { /* no-op */ },
  };
}

// Only run main() when executed directly (not when imported by tests).
// Compare normalized URLs to avoid mismatches from process.argv[1] being a
// relative path on some test invocations.
const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (thisFile === invokedFile) {
  main().catch((err) => {
    process.stderr.write(
      `[backfill-58-03] FATAL: ${err?.stack ?? err?.message ?? String(err)}\n`,
    );
    process.exit(3);
  });
}
