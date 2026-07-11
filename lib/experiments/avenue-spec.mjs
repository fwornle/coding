// lib/experiments/avenue-spec.mjs
//
// Phase 87, Plan 87-03, Task 1 (AVN-01) — synthesize a scriptable avenue
// experiment-spec from a COMPLETED origin span (the forked Run).
//
// Forking a finished span must produce a spec whose cells start BYTE-IDENTICAL to
// the origin (D-08): the origin prompt becomes goal_sentence, the origin snapshot id
// becomes snapshot_id, and each chosen variant becomes exactly one cell. The result
// is an ordinary experiment-spec object — the SAME shape resolveExperimentSpec /
// runMatrix already consume — so an avenue reuses the entire Phase-77/78 run loop.
//
// SCRIPTABLE (D-01, RESEARCH A4): the fork is NOT a UI-only affordance. synthesizeAvenueSpec
// returns a plain object that serializes to YAML via js-yaml; synthesizeToYamlFile persists it
// to config/experiments/avenue-<origin_task_id>.yaml so a power user can reproduce the fork
// from the CLI (`experiment-run.mjs --spec config/experiments/avenue-<origin>.yaml`).
//
// SECURITY (threat_model 87-03, T-87-03-01):
//   • goal_sentence is carried as a plain DATA field — never shelled. The branch name
//     (derived downstream by the runner via sanitizeTaskId) is the only thing that becomes
//     a git ref; this module never constructs a ref or a shell string.
//   • Cells route through the SAME makeCell/validateCells path (via resolveExperimentSpec at
//     run time), so agent-enum + unsupported-combo + test_command shell-safety all still gate.
//
// Diagnostics via process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import yaml from 'js-yaml';

import { sanitizeTaskId } from '../repro/capture-snapshot.mjs';

// The FIVE downstream cell keys (mirrors experiment-spec.mjs makeCell). The env axis
// carries the AVN-04 injection toggle (kb-on / kb-off) — it is NOT a new key.
const CELL_KEYS = Object.freeze(['agent', 'model', 'framework', 'env', 'test_command']);

/** Documented single-value defaults for an omitted variant field (mirrors DEFAULT_AXIS). */
const DEFAULT_VARIANT = Object.freeze({
  agent: 'claude',
  model: 'default',
  framework: 'straight',
  env: 'kb-on', // an avenue's default is injection-ON (D-08: mirror the origin's normal run)
});

/**
 * Normalize one chosen variant into a canonical cell carrying EXACTLY the five
 * downstream keys — an omitted field falls back to DEFAULT_VARIANT so the product
 * never collapses. `test_command` is preserved only when the variant (or the default)
 * supplies one (conditional — an undefined test_command is dropped, matching the
 * spec's explicit-variants path).
 *
 * @param {object} v a chosen variant ({agent?,model?,framework?,env?,test_command?})
 * @param {string|undefined} defaultTestCommand top-level default test_command
 * @returns {{agent:string, model:string, framework:string, env:string, test_command?:string}}
 */
function normalizeVariant(v, defaultTestCommand) {
  const o = (v && typeof v === 'object') ? v : {};
  const cell = {
    agent: o.agent ?? DEFAULT_VARIANT.agent,
    model: o.model ?? DEFAULT_VARIANT.model,
    framework: o.framework ?? DEFAULT_VARIANT.framework,
    env: o.env ?? DEFAULT_VARIANT.env,
  };
  const tc = o.test_command ?? defaultTestCommand;
  if (typeof tc === 'string' && tc.length) cell.test_command = tc;
  return cell;
}

/** Read the origin prompt from a Run/span, tolerating either goal_sentence or prompt. */
function originGoal(originRun) {
  const g = originRun?.goal_sentence ?? originRun?.prompt ?? originRun?.goal;
  return typeof g === 'string' ? g.trim() : '';
}

/** Read the origin snapshot id (Phase 67-07 links every Run to its RunSnapshot). */
function originSnapshot(originRun) {
  const s = originRun?.snapshot_id;
  return (typeof s === 'string' && s.length) ? s : null;
}

/** Read the origin span id — the task_id of the forked Run (the avenue's origin link). */
function originSpanId(originRun) {
  const id = originRun?.task_id ?? originRun?.run_id;
  return (typeof id === 'string' && id.length) ? id : null;
}

/**
 * Synthesize a scriptable avenue experiment-spec from a completed origin Run (AVN-01).
 *
 * The returned object is an ordinary experiment-spec: `goal_sentence` = the origin prompt,
 * `snapshot_id` = the origin snapshot id, and `variants` = one canonical cell per chosen
 * variant (so avenues start byte-identical to the origin, D-08). `origin_span_id` links the
 * avenue back to the forked span. It is the EXACT shape resolveExperimentSpec/runMatrix
 * consume — an avenue reuses the whole run loop.
 *
 * @param {object} args
 * @param {object} args.originRun the completed origin Run (goal_sentence/prompt, snapshot_id, task_id).
 * @param {Array<object>} args.variants the chosen variant matrix — one cell per entry
 *   ({agent,model,framework,env}; env carries kb-on/kb-off per Plan 02). REQUIRED, non-empty.
 * @param {number} [args.repeats] repeats per cell (default 1; coerced to a positive int downstream).
 * @param {string} [args.test_command] top-level default test_command (per-variant wins).
 * @returns {{ goal_sentence:string, snapshot_id:string|null, origin_span_id:string|null,
 *   repeats:number, variants:Array<object> }}
 * @throws {Error} when originRun has no prompt, or variants is empty/not an array.
 */
export function synthesizeAvenueSpec({ originRun, variants, repeats, test_command } = {}) {
  const goal_sentence = originGoal(originRun);
  if (!goal_sentence) {
    throw new Error(
      'synthesizeAvenueSpec: originRun has no goal_sentence/prompt — cannot fork an avenue without the origin task (D-08)',
    );
  }
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error(
      'synthesizeAvenueSpec: at least one chosen variant is required — an avenue with no cells declares nothing to run',
    );
  }

  const cells = variants.map((v) => normalizeVariant(v, test_command));
  const rep = Number.isFinite(repeats) && repeats > 0 ? Math.floor(repeats) : 1;

  return {
    goal_sentence,
    snapshot_id: originSnapshot(originRun),
    origin_span_id: originSpanId(originRun),
    repeats: rep,
    // Use an explicit `variants:` list (not `axes:`) so the chosen matrix maps 1:1 to cells
    // — resolveExperimentSpec normalizes each entry through the SAME makeCell/validateCells path.
    variants: cells,
  };
}

/**
 * Persist a synthesized avenue spec to `config/experiments/avenue-<origin_task_id>.yaml`
 * (D-01 / RESEARCH A4) so the fork is reproducible from the CLI. The filename is derived
 * from the origin span id via sanitizeTaskId (path-traversal-safe — the result provably
 * matches `avenue-[A-Za-z0-9._-]+.yaml`). Returns the absolute path written.
 *
 * @param {object} spec a synthesizeAvenueSpec() result.
 * @param {object} [opts]
 * @param {string} [opts.dir] output directory (default <repoRoot>/config/experiments).
 * @param {string} [opts.repoRoot] repo root used to resolve the default dir.
 * @returns {string} absolute path to the written YAML file.
 */
export function synthesizeToYamlFile(spec, { dir, repoRoot = process.cwd() } = {}) {
  const outDir = dir || path.join(repoRoot, 'config', 'experiments');
  fs.mkdirSync(outDir, { recursive: true });
  // sanitizeTaskId guarantees a safe basename (no `..`, no path sep, no metachar).
  const base = `avenue-${sanitizeTaskId(spec?.origin_span_id ?? 'unknown')}.yaml`;
  const outPath = path.join(outDir, base);
  fs.writeFileSync(outPath, yaml.dump(spec), 'utf8');
  process.stderr.write(`[avenue-spec] wrote scriptable avenue spec ${outPath}\n`);
  return outPath;
}

export { CELL_KEYS };
