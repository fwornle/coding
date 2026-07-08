#!/usr/bin/env node
/**
 * Operator CLI — run a WHOLE experiment matrix from one command (Phase 78, Plan 78-04;
 * RUN-02 / RUN-03 / RUN-04).
 *
 * Thin wrapper over the 78-03 runMatrix engine: resolve + whole-run-validate the spec
 * (Phase-77 resolveExperimentSpec, fail-fast before run 0), optionally NARROW the run
 * (--variant one cell / --repeats override / --timeout override of the 20-min default,
 * D-06), then drive the sequential, idempotent, resumable matrix loop. Exactly one scored
 * Run lands per variant×repeat cell (SC#4); a re-run adds none (D-10 idempotent resume).
 *
 *   node scripts/experiment-run.mjs --spec <file> [--variant <name>] [--repeats N] [--timeout <sec>]
 *
 * CLI skeleton copied from scripts/experiment-restore.mjs (parseStrArg + main().catch →
 * stderr FATAL + exit 1). Diagnostics via process.stderr.write only (no-console-log
 * constraint, CLAUDE.md). Usage errors exit 2; a required-agent (claude/opencode) cell that
 * did not complete exits non-zero; any thrown runtime failure exits 1.
 *
 * RUN UNATTENDED — token attribution caveat: each cell opens ONE global measurement span
 * (active-measurement.json) that the shared host llm-proxy reads to stamp token_usage.task_id.
 * There is a single span slot per data dir, so ANY concurrent main-session LLM call in this repo
 * while a cell is open would be mis-stamped with the cell's task_id. Run this CLI standalone (no
 * interactive agent driving the same repo) — consistent with the Phase-78 D-09 single-owner intent.
 *
 * Env:
 *   CODING_REPO        repo working-tree root (default: cwd) → runMatrix repoRoot.
 *   LLM_PROXY_DATA_DIR live data dir (default: <repoRoot>/.data) → restore source AND the span
 *                      dir the shared proxy reads for task_id attribution (must match the proxy).
 *   LLM_PROXY_PORT     proxy port agents are routed through (default 12435) → ANTHROPIC_BASE_URL.
 *   CODING_PROXY_ROUTE set to 0/false/no/off to launch agents DIRECT (unrouted → unmeasured);
 *                      default routes claude/opencode through the proxy so their tokens attribute.
 *   EXPERIMENT_RUN_FAKE test-only seam — injects fail-soft stub seams (a stub agent that
 *                       always 'complete's, a throwaway restore sandbox, a no-op measurement
 *                       + resume store, and a passthrough proxy-routing seam so no live proxy is
 *                       probed) so the CLI is drivable end-to-end WITHOUT a live agent, snapshot,
 *                       proxy, or the real Run store. Fail-soft; ignored in production
 *                       (mirrors EXPERIMENT_RESTORE_FAKE).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import yaml from 'js-yaml';

import { runMatrix, cellName } from '../lib/experiments/experiment-runner.mjs';
import { resolveExperimentSpec } from '../lib/experiments/experiment-spec.mjs';
import { writeProgress } from '../lib/experiments/run-progress.mjs';
import { loadTaxonomy, isValidClass } from '../lib/experiments/taxonomy.mjs';

// Required agents whose non-completion makes the whole run fail (copilot may legitimately
// land a recorded skip-Run when the headless probe fails — that is NOT a failure).
const REQUIRED_AGENTS = new Set(['claude', 'opencode']);

// T-85-01-01: the run_id becomes a run-dir path segment AND the composeTaskId salt, so it MUST
// be short + path-safe. Charset [A-Za-z0-9._-], length ≤ 12 (a 6-8 char suffix is the target —
// Pitfall 1: a long salt blows composeTaskId's slug/path-key limit and re-breaks D-10 resume).
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,12}$/;

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

/**
 * Collect EVERY occurrence of a repeatable string flag (Phase 85-06 fix). The
 * launcher UI (Plan 05) submits a `variants` SUBSET (multi-pick) which run-launch
 * maps to repeated `--variant <name>` pairs — a single-value parse silently
 * dropped all but the first and the run executed the FULL matrix.
 */
function parseMultiStrArg(argv, flag) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag && argv[i + 1]) values.push(argv[i + 1]);
  }
  return values;
}

/**
 * Parse repeatable per-variant override flags into a variantOverrides map (D-06). Each
 * `--model <variant>=<model>` / `--agent <variant>=<agent>` pair is keyed by the ORIGINAL
 * variant name (cellName). Returns `{ [originalVariantName]: { model?, agent? } }`. This is
 * the SAME field name the API (Plan 04) and UI (Plan 05) submit — do NOT rename in isolation.
 * A malformed pair (no `=`, empty variant or value) is a usage error (returns { error }).
 */
function parseVariantOverrides(argv) {
  const overrides = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag !== '--model' && flag !== '--agent') continue;
    const raw = argv[i + 1];
    const dim = flag === '--model' ? 'model' : 'agent';
    const eq = raw == null ? -1 : raw.indexOf('=');
    if (eq <= 0 || eq === raw.length - 1) {
      return { error: `${flag} expects <variant>=<${dim}> (got '${raw ?? ''}')` };
    }
    const variant = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    (overrides[variant] ??= {})[dim] = value;
  }
  return { overrides };
}

function usage() {
  process.stderr.write(
    'usage: node scripts/experiment-run.mjs --spec <file> [--variant <name>]... [--repeats N] [--timeout <sec>]\n' +
    '                                       [--run-id <id>] [--run-dir <dir>] [--rerun-of <run_id>]\n' +
    '                                       [--model <variant>=<model>]... [--agent <variant>=<agent>]...\n' +
    '  --spec <file>     (required) the YAML experiment matrix spec (config/experiments/*.yaml)\n' +
    '  --variant <name>  narrow the run to the cells named (repeatable — a SUBSET of the matrix)\n' +
    '  --repeats N       override the spec repeats (positive integer)\n' +
    '  --timeout <sec>   override the per-cell wall-clock cap (seconds; default 20 min — D-06)\n' +
    '  --run-id <id>     short path-safe run identity ([A-Za-z0-9._-], ≤12) — the composeTaskId salt\n' +
    '  --run-dir <dir>   directory to emit progress.json into (dashboard poll surface — D-03/D-04)\n' +
    '  --rerun-of <id>   the ORIGINAL run_id this run re-runs (Run.metadata.rerun_of — D-05)\n' +
    '  --task-class <c>  closed-taxonomy class for scoring (falls back to the spec task_class field;\n' +
    '                    absent → the Run quarantines as unclassified and is hidden from default queries)\n' +
    '  --model V=M       per-variant model override keyed by ORIGINAL variant name V (D-06; repeatable)\n' +
    '  --agent V=A       per-variant agent override keyed by ORIGINAL variant name V (D-06; repeatable)\n',
  );
}

/**
 * Test-only fail-soft stub seams (EXPERIMENT_RUN_FAKE). Injects a throwaway restore sandbox,
 * a stub agent that always completes, a no-op measurement CLI, and an empty in-memory resume
 * store — so the operator CLI runs end-to-end without a live agent, a real snapshot, or the
 * repo-global Run store. Ignored unless the env var is set (never active in production).
 */
function makeFakeSeams() {
  return {
    openStore: async () => ({ close: async () => {} }),
    readDone: async () => [],
    restore: async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-run-fake-'));
      const sandboxDataDir = path.join(root, '.data');
      fs.mkdirSync(sandboxDataDir, { recursive: true });
      return { worktree: root, sandboxDataDir };
    },
    spawnAgent: async () => 'complete',
    runMeasurement: async () => 0,
    probeCopilot: () => true,
    // Passthrough routing seam — never probe a live proxy under the fake harness.
    configureRouting: async (_agent, env) => env,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const specPath = parseStrArg(args, '--spec');
  // Repeatable: `--variant a --variant b` narrows the run to that SUBSET (a
  // single occurrence keeps the original single-cell narrowing semantics).
  const variants = parseMultiStrArg(args, '--variant');
  const repeatsArg = parseStrArg(args, '--repeats');
  const timeoutArg = parseStrArg(args, '--timeout');
  // Phase 85-01: run identity (D-05), progress surface (D-03/D-04), per-variant overrides (D-06).
  const runIdArg = parseStrArg(args, '--run-id');
  const runDir = parseStrArg(args, '--run-dir') || undefined;
  const rerunOf = parseStrArg(args, '--rerun-of') || undefined;
  // Phase 85-06: the closed-taxonomy task_class for scoring. Flag wins; the spec's
  // own `task_class:` field is the declarative fallback. WITHOUT one, every Run
  // quarantines as `unclassified` (pending=true) and is EXCLUDED from the default
  // dashboard runs query — a spec-launched run would complete invisibly.
  const taskClassArg = parseStrArg(args, '--task-class') || undefined;

  if (!specPath) {
    process.stderr.write('error: --spec <file> is required\n');
    usage();
    process.exit(2);
  }

  // T-85-01-01: validate --run-id is short + path-safe BEFORE it touches any run-dir path or the
  // composeTaskId salt (Pitfall 1: a long/unsafe salt blows the slug/path-key limit → breaks D-10).
  let runId;
  if (runIdArg != null) {
    if (!RUN_ID_RE.test(runIdArg)) {
      process.stderr.write(
        `error: --run-id must match [A-Za-z0-9._-] and be 1–12 chars (got '${runIdArg}')\n`,
      );
      process.exit(2);
    }
    runId = runIdArg;
  }

  // D-06: parse repeatable --model/--agent <variant>=<value> pairs into the variantOverrides map.
  const { overrides: variantOverrides, error: overrideError } = parseVariantOverrides(args);
  if (overrideError) {
    process.stderr.write(`error: ${overrideError}\n`);
    process.exit(2);
  }

  // --repeats override (optional): a positive integer or a usage error (exit 2).
  let repeatsOverride;
  if (repeatsArg != null) {
    repeatsOverride = Number.parseInt(repeatsArg, 10);
    if (!Number.isInteger(repeatsOverride) || repeatsOverride < 1) {
      process.stderr.write(`error: --repeats must be a positive integer (got '${repeatsArg}')\n`);
      process.exit(2);
    }
  }

  // --timeout override (optional): D-06 — seconds on the CLI, converted to ms for runMatrix.
  let timeoutMs;
  if (timeoutArg != null) {
    const secs = Number.parseInt(timeoutArg, 10);
    if (!Number.isInteger(secs) || secs <= 0) {
      process.stderr.write(`error: --timeout must be a positive integer number of seconds (got '${timeoutArg}')\n`);
      process.exit(2);
    }
    timeoutMs = secs * 1000;
  }

  const repoRoot = process.env.CODING_REPO || process.cwd();
  const dataDir = process.env.LLM_PROXY_DATA_DIR || path.join(repoRoot, '.data');

  // Load the raw spec object (so runMatrix can read experiment_id/snapshot_id off it) and
  // resolve+whole-run-validate the matrix via the shipped Phase-77 resolver (fail-fast).
  const specObj = yaml.load(fs.readFileSync(specPath, 'utf8'));
  const resolved = resolveExperimentSpec(specObj);

  // Resolve + validate the task_class (flag > spec field). Fail-fast on an unknown
  // class (matches the VALID-before-RUN spec-validation ethos) — a typo'd class
  // would otherwise quarantine every Run of the matrix.
  const taskClass = taskClassArg ?? (typeof specObj?.task_class === 'string' ? specObj.task_class : undefined);
  if (taskClass !== undefined) {
    let taxonomy;
    try {
      taxonomy = loadTaxonomy();
    } catch (e) {
      process.stderr.write(`error: task-taxonomy load failed: ${e.message}\n`);
      process.exit(2);
    }
    if (!isValidClass(taskClass, taxonomy)) {
      process.stderr.write(`error: task_class '${taskClass}' is not in the closed taxonomy — legal classes: ${Object.keys(taxonomy.classes).join(', ')}\n`);
      process.exit(2);
    }
  }

  // --variant narrowing: keep only the cells whose derived names are in the requested
  // SUBSET (repeatable flag — Phase 85-06). ANY unknown variant name is a usage error
  // (exit 2) — list the legal variant names so the operator can correct it. This matches
  // the server-side Plan-04 _validateOverrides strictness (never silently drop a name).
  let cells = resolved.cells;
  if (variants.length > 0) {
    const legalNames = resolved.cells.map((c) => cellName(c));
    const legal = new Set(legalNames);
    const unknown = variants.filter((v) => !legal.has(v));
    if (unknown.length > 0) {
      process.stderr.write(`error: --variant '${unknown.join("', '")}' matches no cell — legal variants: ${legalNames.join(', ')}\n`);
      process.exit(2);
    }
    const wanted = new Set(variants);
    cells = cells.filter((c) => wanted.has(cellName(c)));
  }
  const repeats = repeatsOverride ?? resolved.repeats;
  const narrowed = { goal_sentence: resolved.goal_sentence, repeats, cells };

  // D-03/D-04: when a --run-dir is set, initialize progress.json as a `pending` grid BEFORE the
  // loop so the dashboard poller (Plan 05) has a header + one cell per variant×repeat immediately.
  // writeProgress is atomic + never-throw, so a progress-init failure never blocks the run.
  if (runDir) {
    const pendingCells = [];
    for (const c of cells) {
      const v = cellName(c);
      for (let rep = 0; rep < repeats; rep += 1) {
        pendingCells.push({ variant: v, rep, state: 'pending' });
      }
    }
    await writeProgress(runDir, {
      run_id: runId ?? null,
      spec: specPath,
      snapshot_id: specObj?.snapshot_id ?? null,
      pid: process.pid,
      done: 0,
      total: pendingCells.length,
      overall: 'running',
      cells: pendingCells,
    });
  }

  const opts = {
    repoRoot,
    dataDir,
    // Inject the already-resolved+narrowed envelope so runMatrix uses exactly these cells /
    // repeats (its default resolveSpec would re-read the whole unnarrowed matrix).
    resolveSpec: () => narrowed,
    // Phase 85-01: run identity + progress surface + per-variant override map (D-03/D-05/D-06).
    // The APPLICATION of variantOverrides (mutating the cell + derived name + --base-variant)
    // lands in runMatrix/runCell (Task 4); here we only thread them through.
    runDir,
    runId,
    rerunOf,
    variantOverrides,
  };
  if (timeoutMs != null) opts.timeoutMs = timeoutMs;
  // Phase 85-06: thread the validated task_class → runCell --task-class → the
  // measurement-stop judge, so spec-launched Runs land CLASSIFIED (visible in the
  // default dashboard runs query) instead of quarantined `unclassified`.
  if (taskClass !== undefined) opts.taskClass = taskClass;

  if (process.env.EXPERIMENT_RUN_FAKE) {
    Object.assign(opts, makeFakeSeams());
  }

  const summary = await runMatrix(specObj, opts);

  // Per-cell summary to stderr (no-console-log; stdout stays clean).
  for (const s of summary) {
    const state = s.terminal_state ? ` terminal_state=${s.terminal_state}` : '';
    const reason = s.reason ? ` reason=${s.reason}` : '';
    process.stderr.write(`[experiment-run] ${s.task_id} status=${s.status}${state}${reason}\n`);
  }

  // Exit non-zero if any REQUIRED-agent cell (claude/opencode) did not complete (D-04 abort /
  // timeout). The agent is the first '-'-segment of the variant name (KNOWN_AGENTS carry no
  // dash). A copilot skip-Run is NOT a failure.
  const failed = summary.filter((s) => {
    if (s.status !== 'ran') return false;
    if (!s.terminal_state || s.terminal_state === 'complete') return false;
    const agent = String(s.variant || '').split('-')[0];
    return REQUIRED_AGENTS.has(agent);
  });
  if (failed.length) {
    process.stderr.write(
      `error: ${failed.length} required-agent cell(s) did not complete: ` +
      `${failed.map((s) => `${s.task_id}(${s.terminal_state})`).join(', ')}\n`,
    );
    process.exit(1);
  }

  process.stderr.write(`[experiment-run] matrix complete: ${summary.length} cell(s)\n`);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.message}\n`);
  process.exit(1);
});
