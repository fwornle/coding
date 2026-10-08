/**
 * Age-based retention for per-turn capture files — the logic behind
 * scripts/context-turns-sweeper-job.sh (launchd, hourly), and the same function
 * glass runs from an in-process timer.
 *
 * Reclaims two independent families once they age past the retention window:
 *   1. `context-turns.jsonl(.gz)` + `raw-bodies.jsonl(.gz)` under
 *      `<measurementsDir>/<task_id>/` — the request-body context capture.
 *   2. `<task_id>.jsonl` (+ superseded legacy `<task_id>.json`) in the FLAT
 *      retrieval-captures dir — the per-turn KB injection capture.
 * Both carry user prompt text, so both get the same bounded retention. Each
 * file's mtime is judged on its own (a stale raw-bodies file goes even while
 * its context-turns sibling is fresh).
 *
 * Never throws: a missing dir or an undeletable file is logged and skipped.
 *
 * CLI (what the .sh runs), env as before:
 *   CODING_REPO                   repo root (default this checkout)
 *   LLM_PROXY_DATA_DIR            data root the proxy writes to (default proxyDataDir(),
 *                                 the same resolution the proxy's launcher uses —
 *                                 `<dataHome>/var`; until glass G1 it defaulted to
 *                                 <CODING_REPO>/.data, which the proxy no longer
 *                                 writes to, so nothing was ever swept)
 *   CONTEXT_TURNS_RETENTION_DAYS  retention window in days (default 14)
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { proxyDataDir } from '../paths/index.mjs';

const DAY_MS = 86_400_000;

/** Per-task capture files reclaimed by age. */
export const TASK_CAPTURE_NAMES = Object.freeze([
  'context-turns.jsonl',
  'context-turns.jsonl.gz',
  'raw-bodies.jsonl',
  'raw-bodies.jsonl.gz',
]);

function defaultLog(msg) {
  const t = new Date().toISOString().slice(11, 19);
  process.stderr.write(`[context-turns-sweeper][${t}Z] ${msg}\n`);
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/**
 * @param {object} opts
 * @param {string} [opts.measurementsDir]       `<dataDir>/measurements`
 * @param {string} [opts.retrievalCapturesDir]  flat retrieval-captures dir
 * @param {number} [opts.retentionDays=14]
 * @param {number} [opts.now=Date.now()]        epoch ms
 * @param {(msg: string) => void} [opts.log]
 * @returns {{ checked: number, removed: number }}
 */
export function sweepAgedCaptures({
  measurementsDir,
  retrievalCapturesDir,
  retentionDays = 14,
  now = Date.now(),
  log = defaultLog,
} = {}) {
  const staleSecs = Math.floor(retentionDays * 86400);
  const nowSecs = Math.floor(now / 1000);
  let checked = 0;
  let removed = 0;

  const reclaimIfAged = (file) => {
    let st;
    try { st = fs.statSync(file); } catch { return; }
    checked++;
    const age = nowSecs - Math.floor(st.mtimeMs / 1000);
    if (age < staleSecs) {
      log(`SKIP ${file} — only ${age}s old (< ${staleSecs}s retention)`);
      return;
    }
    try {
      fs.rmSync(file, { force: true });
      removed++;
      log(`REMOVED aged file ${file} (age ${age}s >= ${staleSecs}s)`);
    } catch {
      log(`WARN failed to remove ${file} (age ${age}s) — permissions?`);
    }
  };

  if (measurementsDir && isDir(measurementsDir)) {
    let tasks = [];
    try { tasks = fs.readdirSync(measurementsDir, { withFileTypes: true }); } catch { tasks = []; }
    for (const t of tasks) {
      if (!t.isDirectory()) continue;
      for (const name of TASK_CAPTURE_NAMES) reclaimIfAged(path.join(measurementsDir, t.name, name));
    }
  } else {
    log(`measurements dir absent (${measurementsDir}) — skipping per-task sweep`);
  }

  if (retrievalCapturesDir && isDir(retrievalCapturesDir)) {
    let files = [];
    try { files = fs.readdirSync(retrievalCapturesDir, { withFileTypes: true }); } catch { files = []; }
    for (const f of files) {
      if (f.isFile() && (f.name.endsWith('.jsonl') || f.name.endsWith('.json'))) {
        reclaimIfAged(path.join(retrievalCapturesDir, f.name));
      }
    }
  } else {
    log(`retrieval-captures dir absent (${retrievalCapturesDir}) — skipping`);
  }

  log(`sweep complete — retention ${retentionDays}d, checked ${checked}, removed ${removed}`);
  return { checked, removed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const repoRoot = process.env.CODING_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const dataDir = process.env.LLM_PROXY_DATA_DIR || proxyDataDir();
    const days = Number(process.env.CONTEXT_TURNS_RETENTION_DAYS || 14);
    sweepAgedCaptures({
      measurementsDir: path.join(dataDir, 'measurements'),
      retrievalCapturesDir: path.join(repoRoot, '.data', 'retrieval-captures'),
      retentionDays: Number.isFinite(days) ? days : 14,
    });
  } catch (err) {
    defaultLog(`WARN sweep aborted: ${err?.message || err}`);
  }
  process.exit(0);
}
