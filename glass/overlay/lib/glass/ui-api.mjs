// lib/glass/ui-api.mjs — what the daemon serves to the browser.
//
//   GET /, /assets/*                           the built UI (ui/ in the package)
//   GET /api/experiments/runs                  glass sessions, as the dashboard's Run rows
//   GET /api/experiments/runs/<id>/timeline    token rows of one session
//   GET /api/experiments/runs/<id>/context-turns
//   GET /api/experiments/runs/<id>/models      one session's model mix + its newest calls
//   GET /api/calls/unbound                     calls no session could be bound to
//   GET /api/models?hours=N                    every session's calls by agent × model × account × host × kind
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

// upstream / call_kind (rapid-llm-proxy token_usage): '' on rows written before them.
function factColumns(db) {
  const have = new Set(db.prepare("SELECT name FROM pragma_table_info('token_usage') WHERE name IN ('upstream','call_kind')").all().map((r) => r.name));
  return {
    upstream: have.has('upstream') ? 'upstream' : "''",
    callKind: have.has('call_kind') ? 'call_kind' : "''",
  };
}

/**
 * One session by model, the account that answered, the host it went to and the
 * call kind (main / subagent / side; '' = not recorded) — plus its newest calls.
 * What the agent chose and who served it; glass routes nothing.
 */
export function sessionModels(db, taskId, { limit = 200 } = {}) {
  if (!db) return { groups: [], calls: [] };
  const cache = hasCacheColumns(db);
  const f = factColumns(db);
  const cr = cache ? 'COALESCE(cache_read_tokens,0)' : '0';
  const cw = cache ? 'COALESCE(cache_write_tokens,0)' : '0';
  const groups = db.prepare(`
    SELECT model, provider, ${f.upstream} AS upstream, ${f.callKind} AS call_kind, COUNT(*) AS calls,
           SUM(input_tokens) AS input, SUM(output_tokens) AS output,
           SUM(${cr}) AS cache_read, SUM(${cw}) AS cache_write
    FROM token_usage WHERE task_id = ?
    GROUP BY model, provider, upstream, call_kind ORDER BY calls DESC, model
  `).all(taskId);
  const calls = db.prepare(`
    SELECT timestamp, model, provider, ${f.upstream} AS upstream, ${f.callKind} AS call_kind,
           input_tokens AS input, output_tokens AS output, ${cr} AS cache_read, ${cw} AS cache_write, latency_ms
    FROM token_usage WHERE task_id = ? ORDER BY timestamp DESC LIMIT ?
  `).all(taskId, limit);
  return { groups, calls };
}

/**
 * All measured calls of the last `hours` (0 = all time) by agent, model, account,
 * host and call kind, with the number of sessions each group spans. The Models tab.
 * `accounts` is the account selection as an SQL fragment (token-usage accountClause),
 * as on the Token Usage page. The daemon builds it: the CLI loads this module for the
 * status line, and the proxy's token-usage module does network work when it loads.
 */
export function modelMix(db, { hours = 24, accounts = { sql: '', params: [] } } = {}) {
  if (!db) return { hours, groups: [] };
  const cache = hasCacheColumns(db);
  const f = factColumns(db);
  const cr = cache ? 'COALESCE(cache_read_tokens,0)' : '0';
  const cw = cache ? 'COALESCE(cache_write_tokens,0)' : '0';
  const since = hours > 0 ? new Date(Date.now() - hours * 3_600_000).toISOString() : '';
  const ac = accounts;
  const groups = db.prepare(`
    SELECT agent, model, provider, ${f.upstream} AS upstream, ${f.callKind} AS call_kind, COUNT(*) AS calls,
           COUNT(DISTINCT NULLIF(task_id, '')) AS sessions,
           SUM(input_tokens) AS input, SUM(output_tokens) AS output,
           SUM(${cr}) AS cache_read, SUM(${cw}) AS cache_write
    FROM token_usage WHERE timestamp >= ?${ac.sql}
    GROUP BY agent, model, provider, upstream, call_kind ORDER BY calls DESC, agent, model
  `).all(since, ...ac.params);
  return { hours, groups };
}

/**
 * Calls recorded without a session: intercepted traffic that carried no session
 * credential while not exactly one intercepting session was live (G3's rule —
 * never guessed). Counted, so they are visible rather than silently missing.
 */
export function unboundCalls(db) {
  if (!db) return { calls: 0, tokens: 0, first: null, last: null };
  const cache = hasCacheColumns(db);
  const r = db.prepare(`
    SELECT COUNT(*) AS calls, MIN(timestamp) AS first, MAX(timestamp) AS last,
           COALESCE(SUM(input_tokens + output_tokens${cache ? ' + COALESCE(cache_read_tokens,0) + COALESCE(cache_write_tokens,0)' : ''}), 0) AS tokens
    FROM token_usage WHERE task_id = ''
  `).get();
  return { calls: r.calls, tokens: r.tokens, first: r.first ?? null, last: r.last ?? null };
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
 * @param {() => object|null} [o.usageDb]  what the usage views read (coding's rows
 *                                         included where wanted); defaults to tokenDb
 * @returns {(req, res) => Promise<boolean>}
 */
export function createUiApi({ uiDir, dataDir, tokenDb, usageDb = tokenDb, dbPath, measurement, liveSessions, accountFilter = () => ({ sql: '', params: [] }) }) {
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
    if (p === '/api/models') {
      const h = Number(u.searchParams.get('hours') ?? 24);
      json(res, 200, modelMix(usageDb()?.db, { hours: Number.isFinite(h) && h >= 0 ? Math.min(h, 24 * 366) : 24, accounts: accountFilter() }));
      return true;
    }
    if (p === '/api/calls/unbound') {
      json(res, 200, unboundCalls(tokenDb()?.db));
      return true;
    }
    const m = /^\/api\/experiments\/runs\/([^/]+)\/(timeline|context-turns|models)$/.exec(p);
    if (m) {
      const taskId = decodeURIComponent(m[1]);
      if (!TASK_ID.test(taskId)) { json(res, 400, { error: 'invalid task id' }); return true; }
      if (m[2] === 'models') {
        json(res, 200, sessionModels(tokenDb()?.db, taskId));
      } else if (m[2] === 'timeline') {
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
