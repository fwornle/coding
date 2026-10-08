// lib/glass/ui-api.mjs — what the daemon serves to the browser.
//
//   GET /, /assets/*                           the built UI (ui/ in the package)
//   GET /api/experiments/runs                  glass sessions, as the dashboard's Run rows
//   GET /api/experiments/runs/<id>/timeline    token rows of one session
//   GET /api/experiments/runs/<id>/context-turns
//
// The UI is the dashboard's own components (token-usage page, timeline, context
// explainer), so the reads answer in the shapes those components already fetch
// from coding's experiment API — one session is one run.
import fs from 'node:fs';
import path from 'node:path';

import { readTimeline } from '../experiments/timeline-read.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};
const TASK_ID = /^[A-Za-z0-9._-]{1,120}$/;

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

function hasCacheColumns(db) {
  return db.prepare("SELECT COUNT(*) AS c FROM pragma_table_info('token_usage') WHERE name IN ('cache_read_tokens','cache_write_tokens')").get().c === 2;
}

/** Calls, token totals and the dominant model per task id. */
export function totalsByTask(db, taskIds) {
  const out = new Map();
  if (!db || taskIds.length === 0) return out;
  const cache = hasCacheColumns(db);
  const marks = taskIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT task_id, model, COUNT(*) AS calls,
           SUM(input_tokens) AS input, SUM(output_tokens) AS output,
           ${cache ? 'SUM(COALESCE(cache_read_tokens,0))' : '0'} AS cache_read,
           ${cache ? 'SUM(COALESCE(cache_write_tokens,0))' : '0'} AS cache_write
    FROM token_usage WHERE task_id IN (${marks}) GROUP BY task_id, model
  `).all(...taskIds);
  for (const r of rows) {
    const t = out.get(r.task_id) || { calls: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, model: null, modelCalls: 0 };
    t.calls += r.calls; t.input += r.input; t.output += r.output; t.cache_read += r.cache_read; t.cache_write += r.cache_write;
    if (r.calls > t.modelCalls) { t.model = r.model; t.modelCalls = r.calls; }
    out.set(r.task_id, t);
  }
  return out;
}

/** Archived glass spans (closed sessions) from <data>/measurements/*.json. */
export function readSpans(measurementsDir) {
  let names = [];
  try { names = fs.readdirSync(measurementsDir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const spans = [];
  for (const n of names) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(measurementsDir, n), 'utf8'));
      if (s?.meta?.source === 'glass' && s.task_id) spans.push(s);
    } catch { /* partly written or foreign — skip */ }
  }
  return spans;
}

/** Sessions (live + archived) as dashboard Run rows, newest first. */
export function sessionRuns({ live, spans, db }) {
  const byId = new Map();
  for (const s of spans) {
    byId.set(s.task_id, {
      task_id: s.task_id, agent: s.agent, started_at: s.started_at, ended_at: s.ended_at,
      project: s.meta?.project || '', intercept: s.meta?.intercept !== false,
    });
  }
  for (const s of live) {
    byId.set(s.taskId, {
      task_id: s.taskId, agent: s.agent, started_at: s.started_at, ended_at: null, project: s.project, intercept: s.intercept,
    });
  }
  const totals = totalsByTask(db, [...byId.keys()]);
  const rows = [...byId.values()].map((r) => {
    const t = totals.get(r.task_id);
    const total = t ? t.input + t.output + t.cache_read + t.cache_write : 0;
    return {
      ...r,
      canonical_agent: r.agent,
      model: t?.model ?? null,
      canonical_model: t?.model ?? null,
      score: null,
      outcome: {
        calls: t?.calls ?? 0, totalTokens: total, inputTokens: t?.input ?? 0, outputTokens: t?.output ?? 0,
        cacheReadTokens: t?.cache_read ?? 0, cacheWriteTokens: t?.cache_write ?? 0,
      },
    };
  });
  return rows.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
}

function serveStatic(uiDir, urlPath, res) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return false; }
  const file = path.resolve(uiDir, `.${rel === '/' ? '/index.html' : rel}`);
  if (file !== uiDir && !file.startsWith(uiDir + path.sep)) return false;
  let target = file;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    if (rel.startsWith('/assets/') || path.extname(rel)) return false;
    target = path.join(uiDir, 'index.html'); // client-side route
  }
  if (!fs.existsSync(target)) return false;
  const immutable = rel.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': TYPES[path.extname(target)] || 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(target).pipe(res);
  return true;
}

/**
 * @param {object} o
 * @param {string} o.uiDir                 the built UI
 * @param {string} o.dataDir               the daemon's data dir (measurements/ under it)
 * @param {() => object|null} o.tokenDb    live token-DB handle ({ db })
 * @param {string} o.dbPath                the token DB file (read-only timeline reads)
 * @param {{ readContextTurns: Function }} o.measurement
 * @param {() => object[]} o.liveSessions  open sessions (token stripped)
 * @returns {(req, res) => Promise<boolean>}
 */
export function createUiApi({ uiDir, dataDir, tokenDb, dbPath, measurement, liveSessions }) {
  const ui = path.resolve(uiDir);
  return async function handleUi(req, res) {
    if (req.method !== 'GET') return false;
    const u = new URL(req.url || '/', 'http://localhost');
    const p = u.pathname;

    if (p === '/api/experiments/runs') {
      const rows = sessionRuns({ live: liveSessions(), spans: readSpans(path.join(dataDir, 'measurements')), db: tokenDb()?.db });
      json(res, 200, { rows });
      return true;
    }
    const m = /^\/api\/experiments\/runs\/([^/]+)\/(timeline|context-turns)$/.exec(p);
    if (m) {
      const taskId = decodeURIComponent(m[1]);
      if (!TASK_ID.test(taskId)) { json(res, 400, { error: 'invalid task id' }); return true; }
      if (m[2] === 'timeline') {
        json(res, 200, { timeline: await readTimeline(taskId, dbPath), ambient: [], ambientTimeline: [] });
      } else {
        let contextTurns = [];
        try { contextTurns = measurement.readContextTurns(taskId); } catch { contextTurns = []; }
        json(res, 200, { contextTurns });
      }
      return true;
    }
    if (p.startsWith('/api/')) return false;
    if (serveStatic(ui, p, res)) return true;
    if (p === '/' || p === '/index.html') {
      json(res, 404, { error: `UI not built (${ui} is missing) — the generated glass tree ships it` });
      return true;
    }
    return false;
  };
}
