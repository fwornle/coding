#!/usr/bin/env node
/**
 * Phase 58 Plan 04 — SC#1 acceptance gate.
 *
 * Reads `.data/knowledge-graph/exports/general.json`, identifies every
 * `entityType === 'Insight'` node, optionally restricts to "recent" Insights
 * (sorted by `attributes.createdAt` descending and limited to the first 2×N),
 * samples N of them at random (or seeded if `--seed` is passed), and exits
 * 0 IFF ≥M of the N carry ≥1 outgoing edge of type `mentions`.
 *
 * This is the executable codification of Phase 58 SC#1 from .planning/ROADMAP.md:
 *   "Sampling 20 random recent online-learned Insights, at least 18 carry
 *    at least one semantic-content relation type beyond capturedBy."
 *
 * Mirrors the structural template of `scripts/check-l2-emission-rate.mjs`
 * (Phase 57-04) — same CLI shape, same exit code contract, same one-line
 * summary on stdout for CI / operator capture without parsing prose.
 *
 * Usage:
 *   node scripts/check-insight-mentions-coverage.mjs                    # defaults
 *   node scripts/check-insight-mentions-coverage.mjs --sample 20 --min 18
 *   node scripts/check-insight-mentions-coverage.mjs --no-recent-only   # all Insights
 *   node scripts/check-insight-mentions-coverage.mjs --seed=42          # reproducible
 *   node scripts/check-insight-mentions-coverage.mjs --source PATH
 *   node scripts/check-insight-mentions-coverage.mjs --help
 *
 * Defaults:
 *   --sample 20
 *   --min    18                                  (matches ROADMAP SC#1)
 *   --source .data/knowledge-graph/exports/general.json
 *   --recent-only      true                      (sort by createdAt desc + take first 2N)
 *
 * Exit codes:
 *   0  → covered >= min     (PASS)
 *   1  → covered <  min     (FAIL)  OR  pre-flight failure (missing file, bad JSON)
 *
 * Output:
 *   stdout: single parseable line — `[check-58] sample=N covered=K threshold=M result=PASS|FAIL`
 *   stderr: human-readable diagnostics
 *
 * Per CLAUDE.md "no console.*" — diagnostic output uses process.stderr.write
 * and the result line uses process.stdout.write. The module contains zero
 * raw stdout-API calls outside comments.
 *
 * @module scripts/check-insight-mentions-coverage
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

// ---------------------------------------------------------------------------
// CLI parsing — supports both `--flag value` and `--flag=value` shapes.
// ---------------------------------------------------------------------------

/**
 * Parse argv into the script's flag set. Pure function (no I/O) so unit
 * tests can exercise it directly.
 *
 * @param {string[]} argv
 * @returns {{sample:number, min:number, source:string, recentOnly:boolean, seed:number|null, help:boolean}}
 */
function parseArgs(argv) {
  const out = {
    sample: 20,
    min: 18,
    source: resolve(REPO_ROOT, '.data/knowledge-graph/exports/general.json'),
    recentOnly: true,
    seed: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--no-recent-only') {
      out.recentOnly = false;
    } else if (a === '--recent-only') {
      out.recentOnly = true;
    } else if (a === '--sample') {
      const v = parseInt(argv[++i], 10);
      if (!Number.isFinite(v) || v <= 0) {
        process.stderr.write('[check-58] --sample requires a positive integer\n');
        process.exit(1);
      }
      out.sample = v;
    } else if (a.startsWith('--sample=')) {
      const v = parseInt(a.slice('--sample='.length), 10);
      if (!Number.isFinite(v) || v <= 0) {
        process.stderr.write('[check-58] --sample requires a positive integer\n');
        process.exit(1);
      }
      out.sample = v;
    } else if (a === '--min') {
      const v = parseInt(argv[++i], 10);
      if (!Number.isFinite(v) || v < 0) {
        process.stderr.write('[check-58] --min requires a non-negative integer\n');
        process.exit(1);
      }
      out.min = v;
    } else if (a.startsWith('--min=')) {
      const v = parseInt(a.slice('--min='.length), 10);
      if (!Number.isFinite(v) || v < 0) {
        process.stderr.write('[check-58] --min requires a non-negative integer\n');
        process.exit(1);
      }
      out.min = v;
    } else if (a === '--source') {
      out.source = resolve(argv[++i]);
    } else if (a.startsWith('--source=')) {
      out.source = resolve(a.slice('--source='.length));
    } else if (a === '--seed') {
      const v = parseInt(argv[++i], 10);
      if (!Number.isFinite(v)) {
        process.stderr.write('[check-58] --seed requires an integer\n');
        process.exit(1);
      }
      out.seed = v;
    } else if (a.startsWith('--seed=')) {
      const v = parseInt(a.slice('--seed='.length), 10);
      if (!Number.isFinite(v)) {
        process.stderr.write('[check-58] --seed requires an integer\n');
        process.exit(1);
      }
      out.seed = v;
    } else {
      process.stderr.write(`[check-58] unknown flag: ${a}\n`);
      process.exit(1);
    }
  }
  return out;
}

function printUsage() {
  process.stdout.write(
    [
      'Usage: node scripts/check-insight-mentions-coverage.mjs [flags]',
      '',
      'Phase 58 SC#1 acceptance gate — samples N random recent Insights from the',
      'live km-core JSON export and exits 0 IFF >=M of them carry >=1 mentions edge.',
      '',
      'Flags:',
      '  --sample N              Number of Insights to sample (default 20).',
      '  --min M                 Threshold: at least M of the N must carry >=1 mentions edge (default 18).',
      '  --source PATH           Override the default JSON export path',
      '                          (default .data/knowledge-graph/exports/general.json).',
      '  --recent-only           Sort Insights by createdAt desc and sample from the first 2*N (default true).',
      '  --no-recent-only        Disable the recent-only filter; sample from the full Insight pool.',
      '  --seed N                Deterministic seed for reproducibility (default: unseeded Math.random()).',
      '  --help, -h              Show this usage and exit 0.',
      '',
      'Exit codes:',
      '  0  PASS  (covered >= min)',
      '  1  FAIL  (covered <  min) OR pre-flight failure (missing file, bad JSON, bad flag).',
      '',
      'Result line on stdout (single line, parseable):',
      '  [check-58] sample=N covered=K threshold=M result=PASS|FAIL',
      '',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Export reader
// ---------------------------------------------------------------------------

/**
 * Read and parse the km-core JSON export. Returns { nodes, edges } at the
 * top level (verified against the live file 2026-06-15).
 *
 * @param {string} sourcePath
 * @returns {{nodes: any[], edges: any[]}}
 */
function loadExport(sourcePath) {
  if (!existsSync(sourcePath)) {
    process.stderr.write(`[check-58] ERROR: export not found at ${sourcePath}\n`);
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(sourcePath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`[check-58] ERROR: failed to parse ${sourcePath}: ${err.message}\n`);
    process.exit(1);
  }
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const edges = Array.isArray(parsed?.edges) ? parsed.edges : [];
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Deterministic sampling helpers
// ---------------------------------------------------------------------------

/**
 * Mulberry32 PRNG — small, fast, deterministic. Used when --seed is passed
 * so the same input + seed yields the same sample (reproducible for CI / debug).
 *
 * @param {number} a — seed
 * @returns {() => number} a function returning floats in [0, 1)
 */
function mulberry32(a) {
  let t = a | 0;
  return function () {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sample N items at random from the given pool using a uniform-random
 * algorithm (Fisher-Yates partial shuffle). If the pool has fewer items
 * than N, returns the full pool.
 *
 * @template T
 * @param {T[]} pool
 * @param {number} n
 * @param {() => number} rng — random function in [0,1)
 * @returns {T[]}
 */
function sampleRandom(pool, n, rng) {
  const arr = pool.slice();
  const take = Math.min(n, arr.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, take);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  const { nodes, edges } = loadExport(opts.source);
  process.stderr.write(`[check-58] loaded ${nodes.length} nodes / ${edges.length} edges\n`);

  // Build the set of Insight ids that have ≥1 outgoing `mentions` edge.
  //
  // Edge shape in km-core export: `{ key, source, target, undirected,
  // attributes: { type, from, to, metadata, ... } }`. The edge type lives at
  // `attributes.type` and the from-id lives at `attributes.from` (mirrors
  // the consolidator/backfill writer convention) OR at the top-level
  // `source` field (Graphology convention). Honor both to stay robust.
  const insightsWithMentions = new Set();
  for (const edge of edges) {
    const attrs = edge?.attributes ?? {};
    if (attrs?.type !== 'mentions') continue;
    const fromId = typeof attrs.from === 'string' ? attrs.from
      : (typeof edge?.source === 'string' ? edge.source : null);
    if (fromId) insightsWithMentions.add(fromId);
  }

  // Identify Insight nodes via `attributes.entityType === 'Insight'`.
  let insightNodes = nodes
    .filter((n) => n?.attributes?.entityType === 'Insight')
    .map((n) => n.attributes); // hoist attributes to Entity shape

  process.stderr.write(`[check-58] total Insights: ${insightNodes.length}\n`);

  // Optional `--recent-only` filter — sort by createdAt desc + take first 2*N.
  if (opts.recentOnly) {
    insightNodes.sort((a, b) => {
      const ta = a?.createdAt ?? '';
      const tb = b?.createdAt ?? '';
      if (ta === tb) return 0;
      return ta < tb ? 1 : -1;
    });
    const cap = Math.min(opts.sample * 2, insightNodes.length);
    insightNodes = insightNodes.slice(0, cap);
    process.stderr.write(`[check-58] recent-only: restricted to first ${insightNodes.length} (2*sample cap)\n`);
  }

  if (insightNodes.length === 0) {
    process.stderr.write('[check-58] WARN: zero Insight nodes — cannot evaluate SC#1 gate\n');
    process.stdout.write(`[check-58] sample=0 covered=0 threshold=${opts.min} result=${opts.min === 0 ? 'PASS' : 'FAIL'}\n`);
    process.exit(opts.min === 0 ? 0 : 1);
  }

  // Sample N at random (seeded if --seed was passed).
  const rng = opts.seed != null ? mulberry32(opts.seed) : Math.random;
  const sample = sampleRandom(insightNodes, opts.sample, rng);

  // Count how many of the sampled Insights have ≥1 mentions edge.
  let covered = 0;
  for (const insight of sample) {
    if (insightsWithMentions.has(insight.id)) covered += 1;
  }

  const result = covered >= opts.min ? 'PASS' : 'FAIL';

  // Diagnostic stderr — operator-readable.
  process.stderr.write(
    `[check-58] sampled=${sample.length} covered=${covered} threshold=${opts.min} `
    + `recent-only=${opts.recentOnly} seed=${opts.seed ?? 'unseeded'} result=${result}\n`,
  );

  // Per-sample breakdown (operator quick-scan).
  for (const e of sample) {
    const has = insightsWithMentions.has(e.id) ? '✓' : ' ';
    const shortName = String(e.name || '(unnamed)').slice(0, 40);
    process.stderr.write(`  [${has}] ${shortName.padEnd(40)} ${e.createdAt ?? '(no-createdAt)'}\n`);
  }

  // Single-line parseable result on stdout (the contract gate).
  process.stdout.write(`[check-58] sample=${sample.length} covered=${covered} threshold=${opts.min} result=${result}\n`);

  process.exit(result === 'PASS' ? 0 : 1);
}

main();
