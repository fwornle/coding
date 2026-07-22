#!/usr/bin/env node
// scripts/experiment-write-spec.mjs
//
// Code-guaranteed persistence of a /experiment-synthesized spec into
// config/experiments/, so the experiment reliably appears in the dashboard "Launch
// experiment" listbox (handleSpecList enumerates that dir) AND passes the launch V5
// membership gate (handleExperimentRun) for one-click re-launch.
//
// WHY this exists: the /experiment skill is a thin prose wrapper (D-09). It previously
// hand-authored the spec YAML in prose — no serializer, no schema validation, no name
// derivation — so whether a resolveable, uniquely-named spec actually landed in
// config/experiments/ depended on the LLM following instructions. This script makes it
// deterministic: it BUILDS the spec, VALIDATES it through the same resolveExperimentSpec
// the listbox + launch gate use, and WRITES it under a clean, path-safe, collision-safe
// `gen-<id>.yaml` name (the `gen-` prefix distinguishes auto-generated specs from curated
// ones in the listbox).
//
// Usage:
//   node scripts/experiment-write-spec.mjs \
//     --experiment-id <id> --goal "<sentence>" --variants '<json-array>' \
//     [--snapshot-id smoke-spec] [--task-class new-feature] [--test-command "<cmd>"] \
//     [--repeats N] [--version 1] [--slug <basename-stem>] [--no-prefix]
// Prints the absolute path to the written config/experiments/<slug>.yaml on stdout.
//
// Diagnostics via process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

import { resolveExperimentSpec } from '../lib/experiments/experiment-spec.mjs';
import { isValidClass, loadTaxonomy } from '../lib/experiments/taxonomy.mjs';
import { sanitizeTaskId } from '../lib/repro/capture-snapshot.mjs';

/** Read a `--name value` argument (undefined when absent). */
function argVal(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/**
 * Assemble a fully-populated experiment spec object (the compare-fizzbuzz.yaml shape) and
 * VALIDATE it through resolveExperimentSpec — the same resolver the dashboard listbox
 * (handleSpecList) and launch gate (handleExperimentRun) run. Throws on any invalid input
 * (missing goal, empty variants, unknown agent, non-closed-6 task_class) so a broken spec
 * is NEVER written.
 *
 * @param {object} a
 * @param {string} a.experimentId  stable path-safe id (drives deterministic task_ids). REQUIRED.
 * @param {string} a.goal          goal_sentence (the task_hash source). REQUIRED, non-empty.
 * @param {Array<object>} a.variants  one cell per variant ({agent,model,framework,env,test_command?}). REQUIRED, non-empty.
 * @param {string} [a.snapshotId]  resolvable baseline (default 'smoke-spec').
 * @param {string} [a.taskClass]   closed-6 member (default 'new-feature').
 * @param {string} [a.testCommand] score-time gate command (omitted when empty → ungated run).
 * @param {number} [a.repeats]     repeats per cell (default 1).
 * @param {number} [a.version]     spec version (default 1).
 * @returns {object} the validated spec object.
 */
export function buildExperimentSpec({
  experimentId, goal, variants, snapshotId, taskClass, testCommand, repeats, version,
} = {}) {
  if (typeof experimentId !== 'string' || !experimentId.trim()) {
    throw new Error('--experiment-id is required (it drives deterministic per-cell task_ids)');
  }
  if (typeof goal !== 'string' || !goal.trim()) {
    throw new Error('--goal is required and must be a non-empty sentence (it is the task_hash source)');
  }
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error('--variants must be a non-empty JSON array (one entry per matrix cell)');
  }
  const cls = (typeof taskClass === 'string' && taskClass.trim()) ? taskClass.trim() : 'new-feature';
  if (!isValidClass(cls, loadTaxonomy())) {
    throw new Error(
      `invalid task_class "${cls}" — must be a closed-6 member (refactor|bugfix|new-feature|migration|debug|docs). `
      + 'An unclassified run quarantines as pending and renders EMPTY in the Comparison tab.',
    );
  }

  const spec = {
    version: Number.isFinite(version) && version > 0 ? Math.floor(version) : 1,
    experiment_id: experimentId.trim(),
    snapshot_id: (typeof snapshotId === 'string' && snapshotId.trim()) ? snapshotId.trim() : 'smoke-spec',
    goal_sentence: goal.trim(),
    repeats: Number.isFinite(repeats) && repeats > 0 ? Math.floor(repeats) : 1,
    task_class: cls,
    variants,
  };
  if (typeof testCommand === 'string' && testCommand.trim().length) {
    spec.test_command = testCommand.trim();
  }

  // VALIDATE through the SAME resolver the listbox + launch membership gate use. Throws on
  // missing goal_sentence, empty variants, or an unknown agent (KNOWN_AGENTS) — so we never
  // persist a spec that would list with an `error` or be rejected at launch.
  resolveExperimentSpec(spec);
  return spec;
}

/**
 * Persist a validated spec to `config/experiments/<prefix><stem>.yaml`. The stem is the
 * spec's experiment_id (or an explicit slug) run through sanitizeTaskId (path-traversal-safe,
 * matches [A-Za-z0-9._-]). The `gen-` prefix marks auto-generated specs; pass prefix:'' to omit.
 *
 * @param {object} spec  a buildExperimentSpec() result.
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]  repo root (default process.cwd()).
 * @param {string} [opts.slug]      override the filename stem (default spec.experiment_id).
 * @param {string} [opts.prefix]    filename prefix (default 'gen-').
 * @returns {string} absolute path to the written YAML.
 */
export function writeExperimentSpec(spec, { repoRoot = process.cwd(), slug, prefix = 'gen-' } = {}) {
  const outDir = path.join(repoRoot, 'config', 'experiments');
  fs.mkdirSync(outDir, { recursive: true });
  const stem = sanitizeTaskId(slug || spec?.experiment_id || 'experiment');
  const base = `${prefix}${stem}.yaml`;
  const outPath = path.join(outDir, base);
  fs.writeFileSync(outPath, yaml.dump(spec), 'utf8');
  return outPath;
}

// ── CLI ──
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let variants;
  try {
    variants = JSON.parse(argVal(args, '--variants') ?? '[]');
  } catch (err) {
    process.stderr.write(`[experiment-write-spec] --variants must be a JSON array: ${err.message}\n`);
    process.exit(2);
  }
  try {
    const spec = buildExperimentSpec({
      experimentId: argVal(args, '--experiment-id'),
      goal: argVal(args, '--goal'),
      variants,
      snapshotId: argVal(args, '--snapshot-id'),
      taskClass: argVal(args, '--task-class'),
      testCommand: argVal(args, '--test-command'),
      repeats: Number(argVal(args, '--repeats')),
      version: Number(argVal(args, '--version')),
    });
    const outPath = writeExperimentSpec(spec, {
      repoRoot: process.env.CODING_REPO || process.cwd(),
      slug: argVal(args, '--slug'),
      prefix: args.includes('--no-prefix') ? '' : 'gen-',
    });
    process.stderr.write(`[experiment-write-spec] wrote validated spec ${outPath}\n`);
    process.stdout.write(`${outPath}\n`); // stdout = the path only, for the skill to capture
  } catch (err) {
    process.stderr.write(`[experiment-write-spec] ERROR: ${err.message}\n`);
    process.exit(1);
  }
}
