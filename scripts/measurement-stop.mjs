#!/usr/bin/env node
/**
 * Operator CLI — close the active measurement span (TELEM-02, Phase 68-02).
 *
 * Stamps ended_at = now and atomically archives the span to
 * <dataDir>/measurements/<task_id>.json, then removes active-measurement.json.
 * Idempotent: if there is no active span, prints a notice and exits 0.
 *
 * Import-resolution decision: see scripts/measurement-start.mjs — imports the
 * measurement-span surface from the LOCAL proxy build (the same dist the daemon
 * loads), since coding's node_modules pins the older v1.0.0 tarball.
 *
 * Usage:
 *   node scripts/measurement-stop.mjs
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

async function main() {
  const modUrl = pathToFileURL(path.join(PROXY_DIST, 'measurement-span.js')).href;
  const { stopMeasurement, resolveMeasurementPaths } = await import(modUrl);

  const archived = stopMeasurement();
  if (!archived) {
    process.stdout.write('no active measurement span\n');
    process.exit(0);
  }

  const { archiveDir } = resolveMeasurementPaths();
  const archivePath = path.join(archiveDir, `${archived.task_id}.json`);
  process.stdout.write(`stopped measurement span task_id=${archived.task_id} ended_at=${archived.ended_at}\n`);
  process.stdout.write(`archived: ${archivePath}\n`);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
