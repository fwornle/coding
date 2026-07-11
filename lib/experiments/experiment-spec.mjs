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
import { SHELL_META_RE } from './evidence-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Re-export the canonical shell-safety regex (defined once in evidence-harness.mjs) so
// callers + tests import a single source — no duplicate character class (D-08).
export { SHELL_META_RE };

// This module lives at <repo>/lib/experiments/, so the repo root is two levels up.
const DEFAULT_SPEC_PATH = path.resolve(
  __dirname, '..', '..', 'config', 'experiments', 'example-experiment.yaml',
);

// The D-05 agent enum — the closed allowlist of AVENUE agents a variant cell may name.
// This is a SUPERSET of route-trace-resolve.mjs:27's KNOWN_AGENTS: it adds `mastracode`
// (Phase 87 / AVN-03) — the agent literal `argvForAgent`/AGENT_CONFIG_FILE in
// agent-headless.mjs understands. `mastracode` is spec-legal but has NO separate route-trace
// family because mastra is self-routed (MASTRACODE_MODEL_ID → rapid-proxy-mastra), so it is
// intentionally absent from the route-trace set; the drift test asserts a SUPERSET, not
// strict equality. (The variant picker's `mastra`→`mastracode` display mapping is Plan 04's
// job.) Frozen so later phases extend it deliberately.
//
// KNOWLEDGE-INJECTION AXIS (AVN-04): the injection on/off toggle is NOT a new cell key
// (Pitfall 3 — makeCell would silently drop it). It is encoded in the EXISTING `env` axis
// as the reserved values `kb-on` (injection enabled) / `kb-off` (injection disabled). The
// runner (Plan 03) maps `env === 'kb-off'` → `CODING_KNOWLEDGE_INJECTION=0` in the spawned
// agent's child env; both injection seams (the Claude UserPromptSubmit hook and the bash
// injector for opencode/copilot/mastra) early-return when that var is off.
export const KNOWN_AGENTS = Object.freeze(['claude', 'copilot', 'opencode', 'mastracode']);

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

// Soft advisory sets for the LOOSE dimensions (D-05 loose half): model + framework
// stay FREE-FORM. A value outside these lists only WARNs — it NEVER blocks. Kept
// deliberately small; the point is to nudge on obvious typos, not to gate.
const KNOWN_MODELS_SOFT = Object.freeze([
  'default', 'opus', 'sonnet', 'haiku',
]);
const KNOWN_FRAMEWORKS_SOFT = Object.freeze([
  'straight', 'tdd',
]);

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
 * Validate every resolved cell before run 0 and, if ANY cell fails, throw ONE aggregated
 * error enumerating every offending cell/dimension (D-06 all-or-nothing whole-run
 * fail-fast — never validate-and-skip). Hard gates: (a) agent not in KNOWN_AGENTS (D-05
 * strict); (b) any UNSUPPORTED_COMBINATIONS entry matching the cell (D-07); (c)
 * test_command carrying a shell metacharacter per SHELL_META_RE (D-08). Loose: an
 * unrecognized model/framework WARNs to stderr but NEVER blocks (D-05 loose).
 * Diagnostics go via process.stderr.write only (never the global logging API).
 *
 * @param {Array<{agent:string, model:string, framework:string, env:string, test_command?:string}>} cells
 * @returns {void}
 */
export function validateCells(cells) {
  const errors = [];
  cells.forEach((cell, i) => {
    const coords = `cell[${i}] (agent=${cell.agent}, model=${cell.model}, framework=${cell.framework}, env=${cell.env})`;

    // (a) agent enum — closed set, hard block (D-05 strict half).
    if (!KNOWN_AGENTS.includes(cell.agent)) {
      errors.push(
        `${coords}: dimension 'agent' has unknown value '${cell.agent}' — `
        + `legal agents are ${KNOWN_AGENTS.join(', ')}`,
      );
    }

    // (b) unsupported-combination gate (D-07).
    for (const combo of UNSUPPORTED_COMBINATIONS) {
      const matches = Object.entries(combo.when).every(([k, val]) => cell[k] === val);
      if (matches) {
        const when = Object.entries(combo.when).map(([k, v]) => `${k}=${v}`).join(', ');
        errors.push(
          `${coords}: unsupported combination {${when}} — ${combo.reason}; fix: ${combo.pointer}`,
        );
      }
    }

    // (c) test_command shell-safety (D-08) — reject shell metacharacters at resolve time.
    if (typeof cell.test_command === 'string' && cell.test_command.length && SHELL_META_RE.test(cell.test_command)) {
      errors.push(
        `${coords}: dimension 'test_command' contains a shell metacharacter in '${cell.test_command}' — `
        + 'fix: use a fixed-argv command (no |, $(), ;, &, newline)',
      );
    }

    // Loose dimensions (D-05 loose half): unknown model/framework WARN but never block.
    if (typeof cell.model === 'string' && !KNOWN_MODELS_SOFT.includes(cell.model)) {
      process.stderr.write(`WARN: ${coords}: unrecognized model '${cell.model}' — free-form, not blocked (D-05)\n`);
    }
    if (typeof cell.framework === 'string' && !KNOWN_FRAMEWORKS_SOFT.includes(cell.framework)) {
      process.stderr.write(`WARN: ${coords}: unrecognized framework '${cell.framework}' — free-form, not blocked (D-05)\n`);
    }
  });

  if (errors.length) {
    throw new Error(
      `experiment spec has ${errors.length} invalid cell(s) — the WHOLE matrix is aborted before run 0 (D-06):\n`
      + errors.map((e) => `  - ${e}`).join('\n'),
    );
  }
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

  // WR-01 (Phase 77 review): never collapse to zero cells silently. An explicit empty
  // `variants: []` (or an `axes:` block whose product is empty) declares nothing to run —
  // that is a spec authoring error, not a valid zero-variant experiment. Fail fast here so
  // the CLI/runner never launches a comparison over an empty matrix.
  if (cells.length === 0) {
    throw new Error(
      `experiment spec resolved to ZERO variant cells: an empty 'variants:' list or an 'axes:' block ` +
        `with an empty axis declares nothing to run (path: ${pathLabel})`,
    );
  }

  // D-06 whole-run all-or-nothing validation — throws an aggregated error on any bad cell.
  validateCells(cells);

  return { goal_sentence, repeats, cells };
}
