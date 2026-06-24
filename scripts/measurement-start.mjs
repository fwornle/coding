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

const PROXY_DIST = process.env.LLM_PROXY_DIST_DIR
  || '/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist';

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
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
  let goalSentence = goal;
  if (!goalSentence && process.stdin.isTTY) {
    const answer = await prompt('one-sentence goal for this run (blank to skip): ');
    goalSentence = answer || null; // blank → null (no goal; never block)
  }

  const modUrl = pathToFileURL(path.join(PROXY_DIST, 'measurement-span.js')).href;
  const { startMeasurement, resolveMeasurementPaths } = await import(modUrl);

  let span;
  try {
    span = startMeasurement({ task_id: taskId, ...(goalSentence ? { goal_sentence: goalSentence } : {}) });
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }

  const { activePath } = resolveMeasurementPaths();
  process.stdout.write(`started measurement span task_id=${span.task_id} started_at=${span.started_at}\n`);
  process.stdout.write(`active span: ${activePath}\n`);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
