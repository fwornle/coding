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
 * Env:
 *   LLM_PROXY_DATA_DIR  data dir for the span files (default <cwd>/.data)
 *   LLM_PROXY_DIST_DIR  proxy dist dir (default _work/rapid-llm-proxy/dist)
 */

import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROXY_DIST = process.env.LLM_PROXY_DIST_DIR
  || '/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist';

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
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

  const modUrl = pathToFileURL(path.join(PROXY_DIST, 'measurement-span.js')).href;
  const { startMeasurement, resolveMeasurementPaths } = await import(modUrl);

  let span;
  try {
    span = startMeasurement({ task_id: taskId, ...(goal ? { goal_sentence: goal } : {}) });
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
