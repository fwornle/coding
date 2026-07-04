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

// Required agents whose non-completion makes the whole run fail (copilot may legitimately
// land a recorded skip-Run when the headless probe fails — that is NOT a failure).
const REQUIRED_AGENTS = new Set(['claude', 'opencode']);

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

function usage() {
  process.stderr.write(
    'usage: node scripts/experiment-run.mjs --spec <file> [--variant <name>] [--repeats N] [--timeout <sec>]\n' +
    '  --spec <file>     (required) the YAML experiment matrix spec (config/experiments/*.yaml)\n' +
    '  --variant <name>  narrow the run to the single cell whose agent-model-framework-env name matches\n' +
    '  --repeats N       override the spec repeats (positive integer)\n' +
    '  --timeout <sec>   override the per-cell wall-clock cap (seconds; default 20 min — D-06)\n',
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
  const variant = parseStrArg(args, '--variant') || undefined;
  const repeatsArg = parseStrArg(args, '--repeats');
  const timeoutArg = parseStrArg(args, '--timeout');

  if (!specPath) {
    process.stderr.write('error: --spec <file> is required\n');
    usage();
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

  // --variant narrowing: keep only the cell whose derived name matches. An unknown variant is
  // a usage error (exit 2) — list the legal variant names so the operator can correct it.
  let cells = resolved.cells;
  if (variant) {
    cells = cells.filter((c) => cellName(c) === variant);
    if (cells.length === 0) {
      const names = resolved.cells.map((c) => cellName(c)).join(', ');
      process.stderr.write(`error: --variant '${variant}' matches no cell — legal variants: ${names}\n`);
      process.exit(2);
    }
  }
  const repeats = repeatsOverride ?? resolved.repeats;
  const narrowed = { goal_sentence: resolved.goal_sentence, repeats, cells };

  const opts = {
    repoRoot,
    dataDir,
    // Inject the already-resolved+narrowed envelope so runMatrix uses exactly these cells /
    // repeats (its default resolveSpec would re-read the whole unnarrowed matrix).
    resolveSpec: () => narrowed,
  };
  if (timeoutMs != null) opts.timeoutMs = timeoutMs;

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
