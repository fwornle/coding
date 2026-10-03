/**
 * Per-repo token-usage summaries (per-repo tenancy T4b).
 *
 * The proxy's token_usage table is machine-local (D7). What travels with a repo
 * is a SUMMARY of it, written into that repo's learning checkout next to its
 * knowledge, so a teammate who pulls the repo sees what was spent on it:
 *
 *   <repo>/.coding/kb/usage/<user_hash>.json        a repo with a .coding/ (lib/kb/layout)
 *   <data home>/kb/usage/<project>/<user_hash>.json  everything else (no checkout here,
 *                                                     a teammate's shared clone)
 *
 * One file per USER (the machine's LSL user hash), never one shared file: two
 * teammates rewriting the same JSON would conflict on every pull. Each writes
 * only its own; readers sum the directory.
 *
 * Only this machine's rows are summarised — its own machine hash plus the
 * adapter hashes, which only ever describe local sessions. Rows a teammate's
 * export hydrated into this DB are theirs to summarise.
 *
 * Content is canonical (sorted, no timestamps of its own) and a file whose
 * content did not change is not rewritten, so an hourly run on an idle machine
 * produces no git churn.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { projectKbDirs } from '../kb/layout.mjs';
import dataHome from '../paths/data-home.cjs';

/** user_hash values that only ever describe this machine's own sessions. */
export const LOCAL_ADAPTER_HASHES = ['cladpt', 'copadt', 'opcadt', 'opnadt', 'piadpt'];
export const USAGE_SUBDIR = 'usage';
export const DEFAULT_WINDOW_DAYS = 90;

const SUMS = `
  COUNT(*)                                 AS calls,
  COALESCE(SUM(input_tokens),0)            AS input_tokens,
  COALESCE(SUM(output_tokens),0)           AS output_tokens,
  COALESCE(SUM(cache_read_tokens),0)       AS cache_read_tokens,
  COALESCE(SUM(cache_write_tokens),0)      AS cache_write_tokens,
  COALESCE(SUM(reasoning_tokens),0)        AS reasoning_tokens,
  COALESCE(SUM(total_tokens),0)            AS total_tokens`;

/**
 * project → { daily, tasks } for this machine's rows in the window.
 *
 * daily: one row per (UTC date, agent, model, provider).
 * tasks: one row per measured task_id (a Run's tokens, by its idempotency key).
 *
 * @param {import('better-sqlite3').Database} db  read-only handle
 * @param {{userHash: string, sinceIso: string}} opts
 * @returns {Map<string, {daily: object[], tasks: object[]}>}
 */
export function summarizeProjects(db, { userHash, sinceIso }) {
  const cols = new Set(db.prepare('PRAGMA table_info(token_usage)').all().map((c) => c.name));
  if (!cols.has('project')) return new Map();

  const hashes = [userHash, ...LOCAL_ADAPTER_HASHES].filter(Boolean);
  const inHashes = hashes.map(() => '?').join(',');
  const where = `project != '' AND timestamp >= ? AND user_hash IN (${inHashes})`;
  const args = [sinceIso, ...hashes];

  const out = new Map();
  const slot = (p) => {
    if (!out.has(p)) out.set(p, { daily: [], tasks: [] });
    return out.get(p);
  };

  const daily = db.prepare(`
    SELECT project, substr(timestamp, 1, 10) AS date, agent, model, provider, ${SUMS}
    FROM token_usage WHERE ${where}
    GROUP BY project, date, agent, model, provider
    ORDER BY project, date, agent, model, provider
  `).all(...args);
  for (const { project, ...r } of daily) slot(project).daily.push(r);

  const tasks = db.prepare(`
    SELECT project, task_id, agent, MIN(timestamp) AS first, MAX(timestamp) AS last, ${SUMS}
    FROM token_usage WHERE ${where} AND task_id != ''
    GROUP BY project, task_id, agent
    ORDER BY project, first, task_id, agent
  `).all(...args);
  for (const { project, ...r } of tasks) slot(project).tasks.push(r);

  return out;
}

/** Where a project's usage file for this user goes (see the header). */
export function usageFileFor(project, userHash, { dirs, dataHomeOpts } = {}) {
  const hit = dirs?.get(project);
  const dir = hit && hit.kind !== 'shared'
    ? path.join(hit.kbDir, USAGE_SUBDIR)
    : path.join(dataHome.kbDir(dataHomeOpts), USAGE_SUBDIR, project);
  return path.join(dir, `${userHash}.json`);
}

/**
 * Write every project's summary for this user. Returns what it did, per project.
 *
 * @param {{dbPath: string, userHash: string, windowDays?: number, now?: Date,
 *          dirs?: Map, codingRoot?: string, dataHomeOpts?: object}} opts
 */
export function writeProjectUsage(opts) {
  const { dbPath, userHash } = opts;
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = opts.now ?? new Date();
  if (!userHash || !/^[A-Za-z0-9_-]+$/.test(userHash)) {
    throw new Error(`writeProjectUsage: unusable user hash ${JSON.stringify(userHash)}`);
  }
  if (!dbPath || !fs.existsSync(dbPath)) return { written: [], unchanged: [], skipped: 'no token DB' };

  const sinceIso = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);
  let summaries;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    summaries = summarizeProjects(db, { userHash, sinceIso });
  } finally {
    db.close();
  }

  const dirs = opts.dirs ?? projectKbDirs({ codingRoot: opts.codingRoot });
  const result = { written: [], unchanged: [] };
  for (const [project, { daily, tasks }] of [...summaries].sort(([a], [b]) => a.localeCompare(b))) {
    const file = usageFileFor(project, userHash, { dirs, dataHomeOpts: opts.dataHomeOpts });
    const body = `${JSON.stringify({
      project, user_hash: userHash, since: sinceIso, window_days: windowDays, daily, tasks,
    }, null, 2)}\n`;
    let current = null;
    try { current = fs.readFileSync(file, 'utf8'); } catch { /* new */ }
    if (current === body) { result.unchanged.push(project); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
    result.written.push({ project, file });
  }
  return result;
}
