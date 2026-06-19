#!/usr/bin/env node
/**
 * resolve-observations-from-lsl.mjs — CLI trigger for the LSL-grounded
 * observation resolver.
 *
 * Phase 50 introduced this as a standalone resolver that opened the legacy
 * SQLite store directly. Phase 44 migrated observations SQLite → km-core, whose
 * LevelDB is SINGLE-OWNER (owned by the obs-api process); a second opener
 * corrupts/loses writes. The resolution therefore moved IN-PROCESS into the
 * obs-api (`src/live-logging/LslObservationResolver.js`, run on a 30-min sweep).
 *
 * This script is now a thin client: it POSTs to the obs-api
 * `/api/observations/resolve-lsl` endpoint so a manual run shares the
 * single-owner store instead of fighting it. The detector/LLM/confidence logic
 * lives in LslObservationResolver and is covered by
 * tests/live-logging/resolve-observations-from-lsl.test.js.
 *
 * Usage:
 *   node scripts/resolve-observations-from-lsl.mjs --dry-run
 *   node scripts/resolve-observations-from-lsl.mjs --limit 3
 *   node scripts/resolve-observations-from-lsl.mjs --id <legacyId>
 *   node scripts/resolve-observations-from-lsl.mjs --since 2026-05-23T07:30:00Z
 *   node scripts/resolve-observations-from-lsl.mjs --force
 *   node scripts/resolve-observations-from-lsl.mjs --mode=images-only
 *   node scripts/resolve-observations-from-lsl.mjs --project coding
 *
 * Env:
 *   OBS_API_URL             obs-api base URL (default http://localhost:$OBSERVATIONS_API_PORT)
 *   OBSERVATIONS_API_PORT   obs-api port (default 12436)
 */

import path from 'node:path';
import process from 'node:process';

const REQUEST_TIMEOUT_MS = 120_000;

function parseIntArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const v = parseInt(argv[i + 1], 10);
  return Number.isFinite(v) ? v : null;
}

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

/** Parse `--mode=value` or `--mode value`. */
function parseModeArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--mode=')) return a.slice('--mode='.length);
    if (a === '--mode') return argv[i + 1] || null;
  }
  return null;
}

function resolveObsApiUrl() {
  if (process.env.OBS_API_URL) return process.env.OBS_API_URL.replace(/\/+$/, '');
  const port = process.env.OBSERVATIONS_API_PORT || '12436';
  return `http://localhost:${port}`;
}

/**
 * POST the resolution request to the obs-api. Exported for tests/back-compat.
 * Returns the sweep stats { candidates, processed, updated, skipped, failed }.
 */
export async function main(opts = {}) {
  const base = opts.obsApiUrl || resolveObsApiUrl();
  const body = {
    mode: opts.mode || 'all',
    project: opts.project || 'coding',
    since: opts.since || null,
    onlyId: opts.onlyId || null,
    limit: Number.isFinite(opts.limit) ? opts.limit : 50,
    force: opts.force === true,
    dryRun: opts.dryRun === true,
  };

  process.stderr.write(
    `[resolver] POST ${base}/api/observations/resolve-lsl mode=${body.mode} project=${body.project} limit=${body.limit}${body.force ? ' (force)' : ''}${body.dryRun ? ' DRY-RUN' : ''}\n`,
  );

  const resp = await fetch(`${base}/api/observations/resolve-lsl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`obs-api HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`);
  }
  const result = await resp.json();
  process.stderr.write(
    `[resolver] done. candidates=${result.candidates} processed=${result.processed} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}\n`,
  );
  return result;
}

async function cliEntry() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stderr.write(`Usage:
  node scripts/resolve-observations-from-lsl.mjs [flags]

Triggers one LSL-resolution sweep via the obs-api (single-owner km-core).

Flags:
  --dry-run             Select + log candidates; do not write.
  --limit N             Cap rows processed (default 50, hard cap 50).
  --id <legacyId>       Process exactly one observation by legacyId.
  --since <ISO>         Only observations with createdAt >= since.
  --force               Re-process rows already stamped lsl_resolved_at/skipped.
  --mode <ambiguous|images-only|all>   Detector class (default 'all').
  --project <name>      Scope to a project (default 'coding').

Env: OBS_API_URL (default http://localhost:\${OBSERVATIONS_API_PORT:-12436})
`);
    process.exit(0);
  }
  const opts = {
    dryRun: argv.includes('--dry-run'),
    limit: parseIntArg(argv, '--limit') ?? 50,
    onlyId: parseStrArg(argv, '--id'),
    since: parseStrArg(argv, '--since'),
    force: argv.includes('--force'),
    mode: parseModeArg(argv) || 'all',
    project: parseStrArg(argv, '--project') || 'coding',
  };
  try {
    const result = await main(opts);
    if (result.failed > 0) process.exit(1);
  } catch (err) {
    process.stderr.write(`[resolver] FATAL: ${err.stack || err.message}\n`);
    process.exit(1);
  }
}

// Detect direct invocation (vs import by tests).
const invokedDirectly = (() => {
  try {
    const argv1 = process.argv[1] && path.resolve(process.argv[1]);
    const here = new URL(import.meta.url).pathname;
    return argv1 && path.resolve(here) === argv1;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  cliEntry();
}
