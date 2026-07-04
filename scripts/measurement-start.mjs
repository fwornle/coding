#!/usr/bin/env node
/**
 * Operator CLI — open a measurement span (TELEM-02, Phase 68-02).
 *
 * Writes <dataDir>/active-measurement.json with started_at = now. The data dir
 * resolves from LLM_PROXY_DATA_DIR (coding sets it to its own .data; the same
 * env the running daemon uses), falling back to <cwd>/.data — mirroring how
 * scripts/backfill-raw-observations.mjs resolves the proxy environment.
 *
 * Import-resolution decision: coding's node_modules holds the pinned v1.0.0
 * .tgz of @rapid/llm-proxy (pre-measurement-span). The operator CLIs therefore
 * import the measurement-span surface from the LOCAL proxy build at
 * /Users/Q284340/Agentic/_work/rapid-llm-proxy/dist — the SAME dist the daemon
 * (proxy-bridge/server.mjs) loads and that Plan 68-03's write path will import
 * getActiveMeasurement from. This keeps exactly one reader across the whole
 * system and avoids re-packing/re-pinning the tarball just for two operator CLIs.
 * Override with LLM_PROXY_DIST_DIR if the proxy checkout lives elsewhere.
 *
 * Usage:
 *   node scripts/measurement-start.mjs --task-id <id> [--goal "<sentence>"]
 *
 * goal_sentence (D-04 start side): when --goal is omitted AND stdin is a TTY
 * (interactive freeform run), the operator is PROMPTED for a one-sentence goal.
 * Headless (no TTY — cron/CI/pipe, D-05) or a blank answer → no goal; the span is
 * created immediately and the close-side quarantine path sets pending. Never blocks.
 *
 * Env:
 *   LLM_PROXY_DATA_DIR  data dir for the span files (default <cwd>/.data)
 *   LLM_PROXY_DIST_DIR  proxy dist dir (default _work/rapid-llm-proxy/dist)
 */

import process from 'node:process';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

// Phase 67-07 (REPRO-01/02): capture a RunSnapshot at span open (pre-mutation
// baseline, Pattern 3) and arm record/replay via the span meta. captureSnapshot
// folds clock_base into the snapshot manifest; sanitizeTaskId keeps every
// snapshot/replay path under .data/run-snapshots/ (T-67-07-01 path-traversal).
import { captureSnapshot, sanitizeTaskId } from '../lib/repro/capture-snapshot.mjs';

// Phase 77-02 (SPEC-01/SPEC-02): turn a validated variant cell (Plan 01) — or bare
// per-field CLI flags — into span.meta. resolveExperimentSpec loads + whole-run
// validates a spec matrix (agent enum, unsupported-combo gate, test_command
// shell-safety) before the span opens; SHELL_META_RE is the single canonical
// argv-safety regex the direct-CLI --test-command path reuses (D-08).
import { resolveExperimentSpec } from '../lib/experiments/experiment-spec.mjs';
import { SHELL_META_RE } from '../lib/experiments/evidence-harness.mjs';

const REPO_ROOT = process.env.CODING_REPO || '/Users/Q284340/Agentic/coding';

const PROXY_DIST = process.env.LLM_PROXY_DIST_DIR
  || '/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist';

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

/** Derive a stable per-cell variant name from a resolved cell (agent-model-framework-env). */
function cellName(cell) {
  return `${cell.agent}-${cell.model}-${cell.framework}-${cell.env}`;
}

/**
 * Build the variant-specific span.meta fields from CLI flags and/or a --spec matrix cell.
 *
 * SPEC-01 (per-field flags): `--agent`, `--model`, `--framework`, `--test-command`,
 * `--variant` map onto the EXACT downstream meta keys (`agent`, `model`, `framework`,
 * `test_command` snake_case, plus `variant` provenance). SPEC-02 (spec resolution): when
 * `--spec <file>` is present, resolveSpec() whole-run validates the matrix and the cell
 * whose derived name equals `--variant` supplies `{agent,model,framework,env,test_command}`.
 *
 * Layering (D-03): cell fields apply FIRST, then any explicit per-field CLI flag overrides
 * LAST, so an operator can narrow/override a single run without editing the file. Returns
 * ONLY the defined keys via conditional spread — no null/undefined pollution, and never a
 * divergent key name (T-77-07: the snake_case `test_command` key, never a camelCase alias).
 *
 * Fails fast (process.exit(1)) BEFORE the span opens on: an unsafe --test-command or
 * spec-sourced test_command (SHELL_META_RE, D-08 / T-77-05); an invalid spec (aggregated
 * validation throw, D-06 / T-77-06); or an unknown --variant (stderr-lists the available
 * names). Diagnostics via process.stderr.write only.
 *
 * @param {string[]} args - process.argv.slice(2)
 * @param {{ resolveSpec?: (p:string)=>{goal_sentence:string, repeats:number, cells:object[]} }} [opts]
 * @returns {object} the effective variant meta (only defined keys)
 */
export function buildVariantMeta(args, { resolveSpec = resolveExperimentSpec } = {}) {
  // ── Per-field CLI flags (SPEC-01 declaration surface) ──
  const flagAgent = parseStrArg(args, '--agent');
  const flagModel = parseStrArg(args, '--model');
  const flagFramework = parseStrArg(args, '--framework');
  const flagTestCmd = parseStrArg(args, '--test-command');
  const variant = parseStrArg(args, '--variant');
  const specPath = parseStrArg(args, '--spec');
  // R2 (Phase 78-01, D-10): --repeat threads the numeric repeat index into span.meta,
  // symmetric with --variant. Presence-checked (not truthiness) so index 0 survives;
  // a non-numeric value is dropped (omitted), same conditional-spread idiom as variant.
  const flagRepeat = parseStrArg(args, '--repeat');
  const repeat = flagRepeat != null ? Number(flagRepeat) : null;

  // Fail fast on an unsafe --test-command BEFORE the span opens (D-08 / T-77-05). The
  // direct-CLI path must not smuggle a shell-metacharacter command into span.meta.
  if (flagTestCmd && SHELL_META_RE.test(flagTestCmd)) {
    process.stderr.write(
      `error: --test-command '${flagTestCmd}' contains a shell metacharacter — `
      + 'use a fixed argv (no |, $(), ;, &, newline)\n',
    );
    process.exit(1);
  }

  // ── SPEC-02 concrete-config resolution: select a validated cell from the matrix ──
  let cell = null;
  if (specPath) {
    let resolved;
    try {
      // Whole-matrix validation runs here; ANY invalid cell throws an aggregated error
      // and aborts BEFORE active-measurement.json is written (D-06 / T-77-06).
      resolved = resolveSpec(specPath);
    } catch (err) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
    const available = resolved.cells.map(cellName).join(', ');
    if (!variant) {
      process.stderr.write(
        `error: --spec requires --variant <name> to select a cell\n  available variants: ${available}\n`,
      );
      process.exit(1);
    }
    cell = resolved.cells.find((c) => cellName(c) === variant);
    if (!cell) {
      process.stderr.write(
        `error: --variant '${variant}' matches no cell in ${specPath}\n  available variants: ${available}\n`,
      );
      process.exit(1);
    }
  }

  // ── Layer cell fields FIRST, then CLI flags override LAST (D-03) ──
  const agent = flagAgent ?? cell?.agent ?? null;
  const model = flagModel ?? cell?.model ?? null;
  const framework = flagFramework ?? cell?.framework ?? null;
  const testCmd = flagTestCmd ?? cell?.test_command ?? null;
  const env = cell?.env ?? null; // env is spec-cell-sourced only (no --env flag this plan)

  // Defence-in-depth: a spec-sourced test_command was already gated by resolveSpec, but
  // re-check the EFFECTIVE command so no unsafe string reaches span.meta.test_command.
  if (testCmd && SHELL_META_RE.test(testCmd)) {
    process.stderr.write(
      `error: resolved test_command '${testCmd}' contains a shell metacharacter — `
      + 'use a fixed argv (no |, $(), ;, &, newline)\n',
    );
    process.exit(1);
  }

  // Conditional spread — ONLY defined keys land, using the EXACT downstream key names
  // (snake_case test_command). `variant` is an intentional in-span provenance key that
  // downstream Run.metadata drops; it never becomes a persisted attribution field.
  return {
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    ...(framework ? { framework } : {}),
    ...(testCmd ? { test_command: testCmd } : {}),
    ...(env ? { env } : {}),
    ...(variant ? { variant } : {}),
    ...(repeat != null && Number.isFinite(repeat) ? { repeat } : {}),
  };
}

/** Ask one question on the TTY and resolve the trimmed answer (mirrors measurement-stop.mjs:94-103). */
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer).trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const taskId = parseStrArg(args, '--task-id');
  const goal = parseStrArg(args, '--goal');

  if (!taskId) {
    process.stderr.write('error: --task-id <id> is required\n');
    process.stderr.write('usage: node scripts/measurement-start.mjs --task-id <id> [--goal "<sentence>"]\n');
    process.exit(2);
  }

  // ── D-04 (start side): source goal_sentence at span creation ──
  //   • --goal arg present → use it verbatim.
  //   • interactive freeform (no --goal, process.stdin.isTTY) → PROMPT for the
  //     one-sentence goal (single readline question, trimmed).
  //   • headless (no TTY — cron/CI/pipe, D-05) OR a blank prompt answer → NO goal;
  //     the span is created with an empty goal and the close-side quarantine path
  //     (measurement-stop.mjs:181-185) sets pending at write time. NEVER block/hang
  //     waiting for input (D-05).
  // ── Phase 77-02 (SPEC-01/SPEC-02): resolve the variant meta UP FRONT ──
  //   buildVariantMeta whole-run validates a --spec matrix and fails fast (process.exit)
  //   on an unsafe --test-command, an invalid spec, or an unknown --variant BEFORE the
  //   goal prompt, the snapshot, or the span open (validation-before-run). A memoized
  //   resolver reads/validates the spec exactly once (single WARN emission) and is shared
  //   with the goal_sentence fallback below.
  const specPath = parseStrArg(args, '--spec');
  let cachedResolved;
  const resolveSpec = (p) => (cachedResolved ??= resolveExperimentSpec(p));
  const variantMeta = buildVariantMeta(args, { resolveSpec });

  let goalSentence = goal;
  // D-03/SPEC-02: when --goal is absent, the resolved spec's goal_sentence fills the span
  // goal (before any TTY prompt). The spec is already validated (memoized) at this point.
  if (!goalSentence && specPath) {
    try {
      goalSentence = resolveSpec(specPath).goal_sentence || null;
    } catch (err) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
  }
  if (!goalSentence && process.stdin.isTTY) {
    const answer = await prompt('one-sentence goal for this run (blank to skip): ');
    goalSentence = answer || null; // blank → null (no goal; never block)
  }

  // ── Phase 67-07 (REPRO-02): arm record (+ optional replay) via span meta ──
  //   The proxy's LLM taps (Plan 06) read the FULL active span off the SINGLE
  //   reader (getActiveMeasurement) and arm off `meta.record` / `meta.replay_from`
  //   — persisted into active-measurement.json by startMeasurement and read back
  //   UNCHANGED (measurement-span.ts:186-191). NO schema change, NO second reader.
  //   `--replay <snapshot>` points replay at that snapshot's recorded LLM fixtures
  //   dir (.data/run-snapshots/<sanitizeTaskId>/fixtures — the SAME dir the record
  //   tap wrote to), so record→replay round-trips through one path.
  const replayFrom = parseStrArg(args, '--replay');
  const dataDir = process.env.LLM_PROXY_DATA_DIR || path.join(REPO_ROOT, '.data');
  const replayFixturesDir = replayFrom
    ? path.join(REPO_ROOT, '.data', 'run-snapshots', sanitizeTaskId(replayFrom), 'fixtures')
    : null;
  // Merge the variant meta (SPEC-01/SPEC-02) onto the record/replay base — only defined
  // keys land, preserving record:true and the conditional replay_from (Phase 77-02, D-03).
  // --cwd: the directory the measured AGENT runs in. For a sandboxed experiment cell this is the
  // throwaway worktree — NOT this start-process's cwd. The claude transcript locator (stop-adapter-
  // registry) encodes this to find `~/.claude/projects/<cwd>/*.jsonl`; without it the locator uses
  // the stop-process cwd (main repo) and MISSES the sandbox session → claude falls back to the
  // cache-excluded proxy passthrough (a ~530× undercount). Absent → locator uses process.cwd().
  const agentCwd = parseStrArg(args, '--cwd');
  const meta = {
    record: true,
    ...(replayFixturesDir ? { replay_from: replayFixturesDir } : {}),
    ...(agentCwd ? { cwd: agentCwd } : {}),
    ...variantMeta,
  };

  const modUrl = pathToFileURL(path.join(PROXY_DIST, 'measurement-span.js')).href;
  const { startMeasurement, resolveMeasurementPaths } = await import(modUrl);

  let span;
  try {
    span = startMeasurement({
      task_id: taskId,
      ...(goalSentence ? { goal_sentence: goalSentence } : {}),
      meta,
    });
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }

  // ── Capture the RunSnapshot at span open (pre-mutation baseline, Pattern 3) ──
  //   BEST-EFFORT: a capture failure must NEVER abort the measurement (T-67-07-05).
  //   captureSnapshot writes .data/run-snapshots/<sanitizeTaskId(task_id)>/ with the
  //   git/kb/env/mcp/manifest artifacts and folds clock_base into manifest.json.
  try {
    const snap = captureSnapshot(taskId, { repoRoot: REPO_ROOT, dataDir, prompt: goalSentence || '' });
    process.stderr.write(
      `captured run-snapshot ${snap.snapshot_id} at ${snap.dir} (clock_base=${snap.clock_base})\n`,
    );
  } catch (err) {
    process.stderr.write(`[measurement-start] snapshot capture failed (non-fatal): ${err.message}\n`);
  }

  // ── Honest at-arm channel gating (D-08 / SC-4): surface unsupported replay ──
  //   When replay is armed, tell the operator UP FRONT that only the LLM channel +
  //   the virtualized clock replay faithfully. WebSearch/WebFetch/MCP are harness
  //   channels: replayHarnessChannel() hard-fails REPLAY_UNSUPPORTED_CHANNEL by
  //   design (record-only), so those tools would hit LIVE services on a replay run
  //   and destroy comparability — the operator must know this before the run.
  if (replayFrom) {
    process.stderr.write(
      `NOTICE: replay armed from snapshot '${sanitizeTaskId(replayFrom)}' ` +
      `(fixtures: ${replayFixturesDir}).\n` +
      '  Faithfully replayed: LLM channel (recorded /api/complete responses) + virtualized clock.\n' +
      '  UNSUPPORTED for replay: WebSearch, WebFetch, MCP — these harness channels are\n' +
      '  record-only (replayHarnessChannel throws REPLAY_UNSUPPORTED_CHANNEL); they cannot be\n' +
      '  reproduced from fixtures and would hit LIVE services, breaking comparability (D-06/D-08).\n',
    );
  }

  const { activePath } = resolveMeasurementPaths();
  process.stdout.write(`started measurement span task_id=${span.task_id} started_at=${span.started_at}\n`);
  process.stdout.write(`active span: ${activePath}\n`);
}

// Run main() only when executed directly as a CLI — NOT when imported (the variant test
// imports buildVariantMeta as a pure helper and must not open a span on module load).
const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`FATAL: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
