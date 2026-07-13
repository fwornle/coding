#!/usr/bin/env node
/**
 * Operator CLI (CMP-03) — the honest side-by-side variant comparison + the 79→80
 * seam. It opens the experiment store, reads the Run/Score/Outcome join via
 * `readRuns`, builds the comparison with the Plan-02 pure aggregator
 * (`buildComparison`), renders a RANKED human-readable table to stdout, and writes
 * the canonical machine-readable JSON export to
 * `.data/experiments/reports/<task_hash>.json` (the STABLE contract Phase 80's
 * dashboard variant columns consume WITHOUT re-running the experiment).
 *
 * `--csv` additionally writes a CSV alongside the JSON (D-12, opt-in).
 * `--rank-by tokens|wallclock|score|composite` overrides the default composite
 * cost-per-quality ranking (D-05/D-06).
 *
 * CALLER-OWNS-STORE (mirrors experiments-query.mjs): main() is the ONLY place that
 * opens the store (via openExperimentStore(), which sets the mandatory ontologyDir
 * inside — NEVER `new GraphKMStore`) and closes it in a try/finally. compare.mjs
 * receives the pre-read rows and never touches a store.
 *
 * SECURITY (T-79-03-01): the operator-supplied task_hash becomes a report filename.
 * `sanitizeTaskHash` allows ONLY `[A-Za-z0-9._-]` and rejects `/`, `\`, `..`, and
 * null bytes; the resolved report path is asserted to stay under the reports dir —
 * no path traversal on the JSON/CSV write.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STABLE JSON EXPORT SCHEMA (Phase 80 consumes these field names verbatim):
 *
 *   {
 *     "task_hash":   string,                       // the report key (D-13)
 *     "rank_by":     "composite"|"tokens"|"wallclock"|"score",
 *     "generated_at": string,                      // ISO-8601 UTC write time
 *     "ranked":   VariantEntry[],  // successful-gated+scored, sorted by rank_by; each has .rank + .composite
 *     "failed":   VariantEntry[],  // gate_passed===false OR terminal_state timeout/abort ("no successful runs")
 *     "ungated":  VariantEntry[],  // gate_passed===null (no test_command) — shown, not ranked
 *     "unscored": VariantEntry[]   // successful+gated but null/zero rubric — shown, not ranked
 *   }
 *
 *   VariantEntry = {
 *     "variant":      string,
 *     "n":            number,                       // repeat count of the aggregated runs (D-10)
 *     "gate_outcome": "passed"|"failed"|"ungated"|"unscored",  // per-variant success-gate outcome (D-13)
 *     "rank"?:        number,                       // 1-based; ranked group only
 *     "composite"?:   number,                       // ranked only: totalTokens.mean / rubric_score.mean
 *     "reason"?:      string,                        // failed/ungated/unscored group only
 *     "metrics": {                                  // per-metric {mean,stddev,median,min,max,n}, nulls excluded
 *       "totalTokens", "wallclock",
 *       "loop_count", "edit_revert_count", "redundant_read_count",
 *       "abandoned_tool_count", "total_step_count", "wallclock_per_step",
 *       "rubric_score",
 *       "goal_achieved", "code_quality", "test_coverage", "regressions", "spec_drift"
 *     }
 *   }
 *
 * The composite denominator is `score.goal_aligned_ratio` ALONE (D-08, resolved in
 * 79-02); the 5 locked rubric dims are still surfaced in the variance block.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Output via process.stdout.write (table/status) + process.stderr.write
 * (diagnostics) only — no console.* (CLAUDE.md no-console-log).
 *
 * Usage:
 *   node scripts/experiments-compare.mjs --task-hash <h>
 *   node scripts/experiments-compare.mjs --task-hash <h> --rank-by tokens
 *   node scripts/experiments-compare.mjs --task-hash <h> --csv
 *
 * Analog: scripts/experiments-query.mjs (shebang, arg parser, store open in main,
 *   try/finally close, entry-point guard, named exports for pure helpers).
 */

import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// opens via openExperimentStore() — ontologyDir set in lib/experiments/store.mjs
import { openExperimentStore } from '../lib/experiments/store.mjs';
import { readRuns } from '../lib/experiments/query.mjs';
import { buildComparison, GROUP_GATE_OUTCOME, withGateOutcomes } from '../lib/experiments/compare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');

/** The metrics surfaced per variant, in a stable column order. */
const METRIC_KEYS = Object.freeze([
  'totalTokens', 'wallclock',
  'loop_count', 'edit_revert_count', 'redundant_read_count',
  'abandoned_tool_count', 'total_step_count', 'wallclock_per_step',
  'rubric_score',
  'goal_achieved', 'code_quality', 'test_coverage', 'regressions', 'spec_drift',
]);

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
}

/**
 * Validate + sanitize an operator-supplied task_hash before it becomes a report
 * filename (T-79-03-01). Allows ONLY `[A-Za-z0-9._-]`; rejects empty/non-string,
 * any path separator (`/`, `\`), a parent-dir token (`..`), and a null byte.
 * Returns the value UNCHANGED when it is already a safe basename — this is the
 * ONLY filename component the writers use.
 *
 * @param {string} hash
 * @returns {string} the safe basename (=== input for a valid hash)
 * @throws {Error} on any unsafe or empty value (routed to stderr by the caller).
 */
export function sanitizeTaskHash(hash) {
  if (typeof hash !== 'string' || hash.length === 0) {
    throw new Error('sanitizeTaskHash: task_hash is required and must be a non-empty string');
  }
  if (hash.includes('\0')) {
    throw new Error(`sanitizeTaskHash: task_hash contains a null byte (invalid): ${JSON.stringify(hash)}`);
  }
  if (hash.includes('/') || hash.includes('\\')) {
    throw new Error(`sanitizeTaskHash: task_hash contains a path separator (invalid): ${JSON.stringify(hash)}`);
  }
  if (hash.includes('..')) {
    throw new Error(`sanitizeTaskHash: task_hash contains '..' (traversal — invalid): ${JSON.stringify(hash)}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(hash)) {
    throw new Error(`sanitizeTaskHash: task_hash must match [A-Za-z0-9._-] (invalid): ${JSON.stringify(hash)}`);
  }
  return hash;
}

/**
 * Resolve the reports dir + the safe <hash>.<ext> path, asserting the resolved
 * path stays strictly under the reports dir (defense-in-depth over sanitize).
 *
 * @returns {{ reportsDir: string, filePath: string, safe: string }}
 */
function resolveReportPath(taskHash, ext, repoRoot) {
  const safe = sanitizeTaskHash(taskHash);
  const reportsDir = path.join(repoRoot, '.data', 'experiments', 'reports');
  const filePath = path.join(reportsDir, `${safe}.${ext}`);
  const resolvedDir = path.resolve(reportsDir);
  const resolvedFile = path.resolve(filePath);
  if (resolvedFile !== path.join(resolvedDir, `${safe}.${ext}`) ||
      !resolvedFile.startsWith(resolvedDir + path.sep)) {
    throw new Error(`resolveReportPath: refusing to write outside the reports dir (invalid task_hash): ${JSON.stringify(taskHash)}`);
  }
  return { reportsDir, filePath, safe };
}

// GROUP_GATE_OUTCOME + withGateOutcomes are the SHARED gate_outcome stamping,
// imported from lib/experiments/compare.mjs (single source of truth — the
// vkb-server handleComparison endpoint imports the same helpers so the live JSON
// deep-equals this CLI's writeReportJson output; no schema drift — Phase 80).

/**
 * Serialize the comparison report to the canonical stable JSON export at
 * `.data/experiments/reports/<sanitized_task_hash>.json`. Creates the reports dir
 * if absent. Includes per-variant gate outcome, the full
 * {mean,stddev,median,min,max,n} block per metric, the rank, and the
 * failed/ungated/unscored groupings (D-13). Returns the written path.
 *
 * @param {object} report the buildComparison output
 * @param {string} taskHash the operator-supplied hash (sanitized here)
 * @param {{ repoRoot?: string }} [opts]
 * @returns {string} the written file path
 */
export function writeReportJson(report, taskHash, opts = {}) {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT;
  const { reportsDir, filePath } = resolveReportPath(taskHash, 'json', repoRoot);
  fs.mkdirSync(reportsDir, { recursive: true });

  const doc = {
    task_hash: report.taskHash ?? taskHash,
    rank_by: report.rankBy ?? 'composite',
    generated_at: new Date().toISOString(),
    ranked: withGateOutcomes(report.ranked, GROUP_GATE_OUTCOME.ranked),
    failed: withGateOutcomes(report.failed, GROUP_GATE_OUTCOME.failed),
    ungated: withGateOutcomes(report.ungated, GROUP_GATE_OUTCOME.ungated),
    unscored: withGateOutcomes(report.unscored, GROUP_GATE_OUTCOME.unscored),
  };

  fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  process.stderr.write(`[experiments] wrote JSON report ${filePath}\n`);
  return filePath;
}

/** CSV-escape one field (quote when it contains a comma, quote, or newline). */
function csvField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Write a CSV alongside the JSON: one row per variant (across all four groups)
 * carrying variant, rank, n, gate outcome, the composite, and the key variance
 * columns (tokens mean/stddev, wallclock mean, rubric mean). Returns the path.
 *
 * @param {object} report the buildComparison output
 * @param {string} taskHash the operator-supplied hash (sanitized here)
 * @param {{ repoRoot?: string }} [opts]
 * @returns {string} the written CSV path
 */
export function writeReportCsv(report, taskHash, opts = {}) {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT;
  const { reportsDir, filePath } = resolveReportPath(taskHash, 'csv', repoRoot);
  fs.mkdirSync(reportsDir, { recursive: true });

  const header = [
    'variant', 'rank', 'n', 'gate_outcome', 'composite',
    'tokens_mean', 'tokens_stddev', 'wallclock_mean', 'rubric_mean',
  ];
  const lines = [header.join(',')];

  const emit = (group, outcome) => {
    for (const v of (Array.isArray(group) ? group : [])) {
      const m = v.metrics ?? {};
      lines.push([
        csvField(v.variant),
        csvField(v.rank ?? ''),
        csvField(v.n),
        csvField(outcome),
        csvField(v.composite ?? ''),
        csvField(m.totalTokens?.mean ?? ''),
        csvField(m.totalTokens?.stddev ?? ''),
        csvField(m.wallclock?.mean ?? ''),
        csvField(m.rubric_score?.mean ?? ''),
      ].join(','));
    }
  };
  emit(report.ranked, GROUP_GATE_OUTCOME.ranked);
  emit(report.failed, GROUP_GATE_OUTCOME.failed);
  emit(report.ungated, GROUP_GATE_OUTCOME.ungated);
  emit(report.unscored, GROUP_GATE_OUTCOME.unscored);

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  process.stderr.write(`[experiments] wrote CSV report ${filePath}\n`);
  return filePath;
}

/** Format a nullable number for the table (n/a for null/undefined). */
function fmt(value, digits = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return digits > 0 ? value.toFixed(digits) : String(Math.round(value));
}

/**
 * Render a human-readable RANKED table string. The ranked variants get a rank +
 * composite + the key metric variance; the failed/ungated/unscored variants get a
 * DISTINCT "no successful runs" section so an all-fail variant is visibly NOT a
 * winner (CMP-01 honesty invariant). Columns are at the CLI's discretion (D-11).
 *
 * @param {object} report the buildComparison output
 * @returns {string} the table text (ends with a newline)
 */
export function renderTable(report) {
  const out = [];
  out.push(`Comparison report — task_hash=${report.taskHash} rank_by=${report.rankBy}`);
  out.push('');

  // ── Ranked (the honest winners) ──
  out.push('RANKED (successful-gated variants — lowest cost-per-quality first):');
  if (!report.ranked || report.ranked.length === 0) {
    out.push('  (no successful-gated variants)');
  } else {
    out.push('  rank  variant              n   composite   tokens(mean±sd)      rubric(mean)');
    for (const v of report.ranked) {
      const m = v.metrics ?? {};
      const tokens = `${fmt(m.totalTokens?.mean)}±${fmt(m.totalTokens?.stddev)}`;
      out.push(
        `  ${String(v.rank).padEnd(4)}  ${String(v.variant).padEnd(18)} ` +
        `${String(v.n).padEnd(3)} ${fmt(v.composite, 2).padEnd(11)} ` +
        `${tokens.padEnd(20)} ${fmt(m.rubric_score?.mean, 3)}`,
      );
    }
  }
  out.push('');

  // ── Not ranked (shown so they never masquerade as cheap winners) ──
  const renderGroup = (label, group) => {
    if (!group || group.length === 0) return;
    out.push(`${label}:`);
    for (const v of group) {
      const m = v.metrics ?? {};
      out.push(
        `  ${String(v.variant).padEnd(18)} n=${v.n}  ` +
        `tokens(mean)=${fmt(m.totalTokens?.mean)}  ${v.reason ?? ''}`,
      );
    }
    out.push('');
  };
  renderGroup('FAILED (no successful runs — gate failed or timeout/abort)', report.failed);
  renderGroup('UNGATED (no test_command — shown, not ranked)', report.ungated);
  renderGroup('UNSCORED (null/zero rubric — shown, not ranked)', report.unscored);

  return `${out.join('\n')}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const taskHash = parseStrArg(args, '--task-hash');
  const rankBy = parseStrArg(args, '--rank-by') ?? 'composite';
  const wantCsv = args.includes('--csv');

  if (!taskHash) {
    process.stderr.write('error: --task-hash <h> is required\n');
    process.exit(2);
  }
  // Fail fast on an unsafe task_hash BEFORE opening the store.
  sanitizeTaskHash(taskHash);

  const store = await openExperimentStore(); // caller owns lifecycle (ontologyDir inside store.mjs)
  try {
    const rows = await readRuns(store); // the join seam — reuse, don't re-read
    const report = buildComparison(rows, { taskHash, rankBy });
    process.stdout.write(renderTable(report));
    const jsonPath = writeReportJson(report, taskHash);
    process.stdout.write(`JSON report: ${jsonPath}\n`);
    if (wantCsv) {
      const csvPath = writeReportCsv(report, taskHash);
      process.stdout.write(`CSV report:  ${csvPath}\n`);
    }
  } finally {
    await store.close(); // caller owns close (query.mjs / score-write contract)
  }
}

// Entry-point guard — only run the CLI when invoked directly, NOT when imported
// (the integration test imports the pure helpers without running main).
const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`FATAL: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

export { buildComparison };
