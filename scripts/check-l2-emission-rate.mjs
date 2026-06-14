#!/usr/bin/env node
/**
 * Phase 57 Plan 04 — SC#3 acceptance gate.
 *
 * Samples the last N online-learned entities in `.data/knowledge-graph/
 * exports/general.json` and asserts that ≥M of them carry an `ontologyClass`
 * matching one of the 10 L2 classes shipped in `.data/ontologies/
 * coding.lower.json` (LiveLoggingSystem, ConstraintMonitor, OnlineObservation,
 * OnlineDigest, OnlineInsight, KnowledgeManagement, BatchSemanticAnalysis,
 * RapidLlmProxy, DockerizedServices, EtmDaemon).
 *
 * Online entities are identified by `attributes.metadata.source === 'online'`
 * and sorted by `attributes.createdAt` descending. The L2 name set is read
 * dynamically from coding.lower.json — there is no hardcoded list.
 *
 * Usage:
 *   node scripts/check-l2-emission-rate.mjs [--sample N] [--min M]
 *                                            [--export PATH] [--ontology PATH]
 *
 * Defaults: --sample 20, --min 18 (matches Phase 57 success criterion #3).
 *
 * Exit codes:
 *   0  → l2Count >= --min     (PASS)
 *   1  → l2Count <  --min     (FAIL)
 *   2  → script error (missing file, bad JSON, etc.)
 *
 * Output: human-readable summary on stderr; per-class breakdown of which L2
 * classes were and were NOT emitted in the sample.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

// ---------------------------------------------------------------------------
// CLI parsing — no external dep; argv pairs (--flag value).
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    sample: 20,
    min: 18,
    exportPath: resolve(REPO_ROOT, '.data/knowledge-graph/exports/general.json'),
    ontologyPath: resolve(REPO_ROOT, '.data/ontologies/coding.lower.json'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sample') {
      const v = parseInt(argv[++i], 10);
      if (!Number.isFinite(v) || v <= 0) {
        process.stderr.write(`[l2-emission-rate] --sample requires a positive integer\n`);
        process.exit(2);
      }
      out.sample = v;
    } else if (a === '--min') {
      const v = parseInt(argv[++i], 10);
      if (!Number.isFinite(v) || v < 0) {
        process.stderr.write(`[l2-emission-rate] --min requires a non-negative integer\n`);
        process.exit(2);
      }
      out.min = v;
    } else if (a === '--export') {
      out.exportPath = resolve(argv[++i]);
    } else if (a === '--ontology') {
      out.ontologyPath = resolve(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      process.stderr.write(
        `Usage: node scripts/check-l2-emission-rate.mjs [--sample N] [--min M]\n` +
          `                                              [--export PATH] [--ontology PATH]\n` +
          `Defaults: --sample 20 --min 18\n` +
          `Reads L2 names dynamically from .data/ontologies/coding.lower.json\n`,
      );
      process.exit(0);
    } else {
      process.stderr.write(`[l2-emission-rate] unknown flag: ${a}\n`);
      process.exit(2);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Load coding.lower.json and extract the 10 L2 class names.
// Fail-loud if the file is missing or malformed.
// ---------------------------------------------------------------------------

function loadL2Names(ontologyPath) {
  if (!existsSync(ontologyPath)) {
    process.stderr.write(
      `[l2-emission-rate] ERROR: coding.lower.json not found at ${ontologyPath}\n`,
    );
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(ontologyPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`[l2-emission-rate] ERROR: failed to parse ${ontologyPath}: ${err.message}\n`);
    process.exit(2);
  }
  const classes = parsed?.classes;
  if (!classes || typeof classes !== 'object') {
    process.stderr.write(
      `[l2-emission-rate] ERROR: coding.lower.json has no .classes object\n`,
    );
    process.exit(2);
  }
  const names = Object.keys(classes);
  if (names.length === 0) {
    process.stderr.write(
      `[l2-emission-rate] ERROR: coding.lower.json declares zero classes\n`,
    );
    process.exit(2);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Load general.json export and select the recent online entities.
// ---------------------------------------------------------------------------

function loadExport(exportPath) {
  if (!existsSync(exportPath)) {
    process.stderr.write(`[l2-emission-rate] ERROR: export not found at ${exportPath}\n`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(exportPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`[l2-emission-rate] ERROR: failed to parse ${exportPath}: ${err.message}\n`);
    process.exit(2);
  }
  const nodes = parsed?.nodes;
  if (!Array.isArray(nodes)) {
    process.stderr.write(`[l2-emission-rate] ERROR: export has no .nodes array\n`);
    process.exit(2);
  }
  return nodes;
}

function selectRecentOnline(nodes, sampleSize) {
  const onlineNodes = nodes.filter((n) => {
    const attrs = n?.attributes ?? {};
    const meta = attrs?.metadata ?? {};
    return meta?.source === 'online';
  });
  // Sort by createdAt descending (lexicographic ISO-8601 sort is correct).
  onlineNodes.sort((a, b) => {
    const ta = a?.attributes?.createdAt ?? '';
    const tb = b?.attributes?.createdAt ?? '';
    if (ta === tb) return 0;
    return ta < tb ? 1 : -1;
  });
  return onlineNodes.slice(0, sampleSize);
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const l2Names = loadL2Names(opts.ontologyPath);
  const l2Set = new Set(l2Names);

  const nodes = loadExport(opts.exportPath);
  const sample = selectRecentOnline(nodes, opts.sample);

  if (sample.length === 0) {
    process.stderr.write(
      `[l2-emission-rate] WARN: zero online entities in export — cannot evaluate SC#3 gate.\n` +
        `[l2-emission-rate] sample=0, l2_emitted=0, threshold=${opts.min}, status=FAIL\n`,
    );
    process.exit(opts.min === 0 ? 0 : 1);
  }

  const sampleSize = sample.length;
  let l2Count = 0;
  const perClassCount = Object.create(null);
  const sampleClasses = [];

  for (const n of sample) {
    const cls = n?.attributes?.ontologyClass ?? '(missing)';
    sampleClasses.push({
      name: n?.attributes?.name ?? '(unnamed)',
      ontologyClass: cls,
      createdAt: n?.attributes?.createdAt ?? '',
    });
    if (l2Set.has(cls)) {
      l2Count++;
      perClassCount[cls] = (perClassCount[cls] ?? 0) + 1;
    }
  }

  const status = l2Count >= opts.min ? 'PASS' : 'FAIL';
  process.stderr.write(
    `[l2-emission-rate] sample=${sampleSize}, l2_emitted=${l2Count}, threshold=${opts.min}, status=${status}\n`,
  );

  // Per-class emission breakdown.
  process.stderr.write(`[l2-emission-rate] per-class L2 emission (in sample):\n`);
  for (const name of l2Names.sort()) {
    const count = perClassCount[name] ?? 0;
    const marker = count > 0 ? '✓' : ' ';
    process.stderr.write(`  ${marker} ${name.padEnd(24)} ${count}\n`);
  }

  // Sample-level detail to help operator spot non-L2 ontologyClass values.
  process.stderr.write(
    `[l2-emission-rate] sample (most recent first):\n`,
  );
  for (const e of sampleClasses) {
    const isL2 = l2Set.has(e.ontologyClass);
    const tag = isL2 ? 'L2' : '  ';
    const shortName = (e.name ?? '').slice(0, 36);
    process.stderr.write(
      `  [${tag}] ${shortName.padEnd(36)} ${e.ontologyClass.padEnd(24)} ${e.createdAt}\n`,
    );
  }

  process.exit(status === 'PASS' ? 0 : 1);
}

main();
