// lib/experiments/experiment-spec.mjs
// The experiment declaration + validation foundation (SPEC-01 / SPEC-02). This
// module is PURE and deterministic — no LLM, no network, no fs beyond reading the
// spec file the user hands it.
//
//   expandAxes(axes, opts)                 → cell[]                       (D-02 cartesian expansion)
//   resolveExperimentSpec(fileOrObj, opts) → { goal_sentence, repeats, cells } | throws (D-01/D-05..D-08)
//   UNSUPPORTED_COMBINATIONS               → frozen combo table          (D-07 gate, extensible)
//
// A user authors a YAML matrix (config/experiments/example-experiment.yaml is the
// documented schema example). resolveExperimentSpec loads it, expands the cartesian
// `{agent[], model[], framework[], env[]}` axes into concrete variant cells, and
// validates EVERY cell before run 0 (validateCells — the D-05/D-07/D-08 enforcement,
// aggregated whole-run fail-fast D-06). The CLI (Plan 02) and the per-cell restore
// orchestrator (Plan 03) both consume the resolved envelope; downstream
// (measurement-stop.mjs / evidence-harness.mjs) reads EXACTLY the five cell keys
// `agent, model, framework, env, test_command` — any other key name is silently
// dropped, so cells carry precisely those five and no more.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// This module lives at <repo>/lib/experiments/, so the repo root is two levels up.
const DEFAULT_SPEC_PATH = path.resolve(
  __dirname, '..', '..', 'config', 'experiments', 'example-experiment.yaml',
);

// The D-05 agent enum. Mirrors the (currently module-private) KNOWN_AGENTS in
// lib/experiments/route-trace-resolve.mjs:23. Frozen so later phases extend it
// deliberately; a divergence test in the suite asserts it equals the route-trace set.
export const KNOWN_AGENTS = Object.freeze(['claude', 'copilot', 'opencode']);

// Documented single-value defaults for a MISSING axis (D-02): the cartesian product
// must never collapse to zero cells, so an omitted dimension contributes exactly one
// value. `agent`/`model` are almost always user-supplied; framework/env default to
// the straight, non-headless baseline.
const DEFAULT_AXIS = Object.freeze({
  agent: 'claude',
  model: 'default',
  framework: 'straight',
  env: 'default',
});

// The D-07 unsupported-combination table. A cell whose {agent, env} matches a `when`
// entry aborts the whole matrix with `reason` + `pointer`. Frozen; later phases append
// entries (e.g. when Phase-78 RUN-04 resolves copilot headless drivability).
export const UNSUPPORTED_COMBINATIONS = Object.freeze([
  Object.freeze({
    when: Object.freeze({ agent: 'copilot', env: 'headless' }),
    reason: 'Copilot headless drivability is unproven',
    pointer: 'gated by Phase-78 RUN-04 drivability spike',
  }),
]);

/** Coerce `v` to a positive integer, falling back to `fallback` on anything else. */
function coercePositiveInt(v, fallback) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Build a canonical cell carrying EXACTLY the five downstream keys (D-01 contract). */
function makeCell({ agent, model, framework, env, test_command }) {
  return {
    agent: agent ?? DEFAULT_AXIS.agent,
    model: model ?? DEFAULT_AXIS.model,
    framework: framework ?? DEFAULT_AXIS.framework,
    env: env ?? DEFAULT_AXIS.env,
    // Preserve the key even when undefined so Object.keys(cell) is stable downstream.
    test_command,
  };
}

/**
 * Expand `{agent[], model[], framework[], env[]}` into the cartesian product of cells
 * (D-02). A missing/empty axis contributes its single DEFAULT_AXIS sentinel so the
 * product never collapses to zero. A scalar axis value is treated as a one-element
 * list. Each returned cell carries EXACTLY `agent, model, framework, env, test_command`;
 * `test_command` threads in from the top-level default (opts.test_command). `repeats`
 * is NOT an axis — it lives on the resolved envelope, never multiplied into this list.
 *
 * @param {{agent?:string[]|string, model?:string[]|string, framework?:string[]|string, env?:string[]|string}} [axes]
 * @param {{ test_command?: string }} [opts]
 * @returns {Array<{agent:string, model:string, framework:string, env:string, test_command:string|undefined}>}
 */
export function expandAxes(axes = {}, { test_command } = {}) {
  const dims = ['agent', 'model', 'framework', 'env'];
  const lists = dims.map((d) => {
    const v = axes?.[d];
    if (Array.isArray(v)) return v.length ? v : [DEFAULT_AXIS[d]];
    if (v != null) return [v]; // scalar → single-element axis
    return [DEFAULT_AXIS[d]]; // missing → documented single sentinel
  });
  // Nested cartesian expansion (no existing helper — net-new per PATTERNS §No-Analog).
  let partials = [{}];
  dims.forEach((d, i) => {
    const next = [];
    for (const partial of partials) {
      for (const val of lists[i]) {
        next.push({ ...partial, [d]: val });
      }
    }
    partials = next;
  });
  return partials.map((p) => makeCell({ ...p, test_command }));
}

/**
 * Validate every resolved cell before run 0 (D-05 agent enum, D-07 unsupported-combination
 * gate, D-08 test_command shell-safety) with aggregated whole-run fail-fast (D-06).
 *
 * SEAM: filled by Plan 77-01 Task 2. Task 1 ships expansion + load; the enforcement
 * body (import SHELL_META_RE from ./evidence-harness.mjs, iterate cells, collect errors,
 * throw one aggregated Error) is added next. Left as a no-op so resolveExperimentSpec's
 * call site is wired now and Task 2 only fills the body.
 * @param {Array<object>} _cells
 * @returns {void}
 */
export function validateCells(_cells) {
  // Task 2 fills this seam.
}

/** Normalize an explicit `variants:` entry into a canonical cell (per-cell test_command wins). */
function normalizeVariant(v, defaultTestCommand) {
  const o = (v && typeof v === 'object') ? v : {};
  return makeCell({
    agent: o.agent,
    model: o.model,
    framework: o.framework,
    env: o.env,
    test_command: o.test_command ?? defaultTestCommand,
  });
}

/**
 * Resolve a user-authored experiment spec (D-01) into a validated envelope. Accepts a
 * YAML file path OR a pre-parsed object (for testability). Applies the taxonomy-style
 * null/shape guard, requires `goal_sentence` (the task_hash source downstream), reads
 * `repeats` (default 1, coerced to a positive int), expands `axes:` (or reads an
 * explicit `variants:` list), validates every cell (validateCells), and returns
 * `{ goal_sentence, repeats, cells }`. Any cell-validation failure propagates as the
 * aggregated whole-run abort (D-06). PURE + deterministic.
 *
 * @param {string|object} filePathOrObj - YAML spec path, or a pre-parsed spec object.
 * @param {object} [opts]
 * @returns {{ goal_sentence: string, repeats: number, cells: Array<object> }}
 */
export function resolveExperimentSpec(filePathOrObj = DEFAULT_SPEC_PATH, opts = {}) {
  let parsed;
  let pathLabel;
  if (typeof filePathOrObj === 'string') {
    pathLabel = filePathOrObj;
    const raw = fs.readFileSync(filePathOrObj, 'utf8');
    parsed = yaml.load(raw); // DEFAULT_SCHEMA — no arbitrary JS type construction (T-77-02).
  } else {
    pathLabel = '<inline object>';
    parsed = filePathOrObj;
  }

  // Null/shape guard (mirrors taxonomy.mjs): yaml.load() returns undefined for an empty
  // file and null for an explicit YAML null document; reject non-objects honestly.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`experiment spec is empty or malformed: not an object (path: ${pathLabel})`);
  }
  if (typeof parsed.goal_sentence !== 'string' || !parsed.goal_sentence.trim()) {
    throw new Error(
      `experiment spec is missing required goal_sentence (it is the task_hash source downstream) (path: ${pathLabel})`,
    );
  }

  const goal_sentence = parsed.goal_sentence.trim();
  const repeats = coercePositiveInt(parsed.repeats, 1);
  const test_command = typeof parsed.test_command === 'string' && parsed.test_command.trim().length
    ? parsed.test_command.trim()
    : undefined;

  let cells;
  if (Array.isArray(parsed.variants)) {
    // Claude's Discretion escape hatch: an explicit named-variant list.
    cells = parsed.variants.map((v) => normalizeVariant(v, test_command));
  } else if (parsed.axes && typeof parsed.axes === 'object') {
    cells = expandAxes(parsed.axes, { test_command });
  } else {
    throw new Error(
      `experiment spec is empty or malformed: needs an 'axes:' block or an explicit 'variants:' list (path: ${pathLabel})`,
    );
  }

  // D-06 whole-run all-or-nothing validation — throws an aggregated error on any bad cell.
  validateCells(cells);

  return { goal_sentence, repeats, cells };
}
