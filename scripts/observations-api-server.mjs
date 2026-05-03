#!/usr/bin/env node
/**
 * observations-api-server — Host-side HTTP gateway for .observations/observations.db.
 *
 * Single-owner pattern (mirrors OKB/VKB): this process is the only one that opens
 * observations.db at runtime. The dashboard (in coding-services container) and any
 * other client reach it via HTTP at host.docker.internal:12436. Eliminates the
 * Docker bind-mount + SQLite WAL/SHM corruption that plagued the prior layout.
 *
 * Phase 1 surface (read-only): mirrors system-health-dashboard/server.js handlers.
 *
 *   GET  /health
 *   GET  /ready
 *   GET  /api/observations             ?agent=&from=&to=&project=&q=&quality=&limit=&offset=
 *   GET  /api/observations/projects
 *   GET  /api/digests                  ?date=&from=&to=&q=&project=&limit=&offset=
 *   GET  /api/digests/projects
 *   GET  /api/insights                 ?topic=&q=&project=
 *   GET  /api/insights/projects
 *   GET  /api/projects
 *   GET  /api/consolidation/status
 */

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ObservationWriter } from '../src/live-logging/ObservationWriter.js';
import { ObservationConsolidator } from '../src/live-logging/ObservationConsolidator.js';
import { RetrievalService } from '../src/retrieval/retrieval-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.OBSERVATIONS_DB_PATH || path.join(REPO_ROOT, '.observations', 'observations.db');
const PORT = parseInt(process.env.OBSERVATIONS_API_PORT || '12436', 10);
const HEARTBEAT_PATH = path.join(path.dirname(DB_PATH), 'consolidation-heartbeat.json');

// Single writer that owns the SQLite file. All reads and writes go through
// this instance — eliminates concurrent openers across the Docker bind-mount
// boundary that previously caused WAL/SHM corruption.
let _writer = null;
let _writerInit = null; // pending init promise

async function ensureWriter() {
  if (_writer && _writer.db) return _writer;
  if (_writerInit) return _writerInit;
  _writerInit = (async () => {
    const w = new ObservationWriter({ dbPath: DB_PATH });
    await w.init();
    _writer = w;
    return w;
  })();
  try {
    return await _writerInit;
  } finally {
    _writerInit = null;
  }
}

function getDb() {
  return _writer?.db || null;
}

// Retrieval service runs in this process (Phase 5: container has zero
// access to observations.db). Qdrant is reachable via localhost:6333
// (port-mapped from coding-qdrant container).
let _retrieval = null;
function ensureRetrieval() {
  if (_retrieval) return _retrieval;
  if (!process.env.QDRANT_URL) {
    process.env.QDRANT_URL = 'http://localhost:6333';
  }
  _retrieval = new RetrievalService({ dbGetter: () => _writer?.db || null });
  // Eager init warms fastembed; fire-and-forget so startup isn't blocked.
  _retrieval.initialize().catch((err) => {
    process.stderr.write(`[obs-api] retrieval init failed (lazy retry on first request): ${err.message}\n`);
  });
  return _retrieval;
}

function invalidateDb() {
  if (_writer) {
    try { _writer.close?.(); } catch { /* best effort */ }
    _writer = null;
  }
}

function isCorruptionError(err) {
  const msg = err?.message || '';
  return msg.includes('malformed') || msg.includes('corrupt') || msg.includes('disk I/O');
}

function readConsolidationHeartbeat() {
  try {
    if (!fs.existsSync(HEARTBEAT_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(HEARTBEAT_PATH, 'utf8'));
    const now = Date.now();
    const last = new Date(data.lastHeartbeat || 0).getTime();
    const ageMs = now - last;
    const stderrAt = data.lastStderrAt ? new Date(data.lastStderrAt).getTime() : last;
    const stderrAgeMs = now - stderrAt;
    let alive = false;
    try { process.kill(data.pid, 0); alive = true; } catch { /* dead */ }
    return {
      pid: data.pid,
      alive,
      startedAt: data.startedAt,
      lastHeartbeat: data.lastHeartbeat,
      ageMs,
      lastStderrAt: data.lastStderrAt,
      stderrAgeMs,
      lastMessage: data.lastMessage,
      args: data.args,
    };
  } catch {
    return null;
  }
}

// ── Consolidation runner state ─────────────────────────────────────────────
//
// The consolidator runs IN-PROCESS here (single-owner pattern). It opens its
// own better-sqlite3 connection to observations.db; multiple connections in
// the same process share state safely under WAL mode, so this coexists with
// the writer instance without the Docker bind-mount corruption pattern.

let _consolidationPromise = null;
let _consolidationStartedAt = null;
let _consolidationArgs = null;
let _heartbeatInterval = null;
let _lastStderrLine = '';
let _lastStderrAt = null;
let _shuttingDown = false;

function _bumpHeartbeat() {
  if (!_consolidationStartedAt) return;
  try {
    fs.mkdirSync(path.dirname(HEARTBEAT_PATH), { recursive: true });
    fs.writeFileSync(HEARTBEAT_PATH, JSON.stringify({
      pid: process.pid,
      startedAt: _consolidationStartedAt,
      lastHeartbeat: new Date().toISOString(),
      lastStderrAt: _lastStderrAt || _consolidationStartedAt,
      lastMessage: _lastStderrLine.slice(0, 240),
      args: _consolidationArgs || [],
    }));
  } catch { /* best-effort */ }
}

function _clearHeartbeat() {
  if (_heartbeatInterval) {
    clearInterval(_heartbeatInterval);
    _heartbeatInterval = null;
  }
  try { fs.unlinkSync(HEARTBEAT_PATH); } catch { /* may not exist */ }
}

/**
 * Run a consolidation pipeline. Coalesces concurrent triggers — if a run is
 * already in flight, returns the same promise so all callers see the same
 * outcome (matches the dashboard's prior _activeConsolidation semantics).
 *
 * @param {{ date?: string, includeToday?: boolean, insightsOnly?: boolean }} options
 */
function runConsolidation(options = {}) {
  if (_consolidationPromise) return _consolidationPromise;

  const args = options.date
    ? ['--date', options.date]
    : options.insightsOnly
    ? ['--insights']
    : ['--include-today'];

  _consolidationStartedAt = new Date().toISOString();
  _consolidationArgs = args;
  _lastStderrLine = 'starting…';
  _lastStderrAt = _consolidationStartedAt;

  _bumpHeartbeat();
  _heartbeatInterval = setInterval(_bumpHeartbeat, 2000);
  _heartbeatInterval.unref?.();

  // Capture consolidator log output so the heartbeat reflects real activity.
  // The consolidator emits to process.stderr; tap it via a passthrough.
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  let stderrTapped = true;
  process.stderr.write = (chunk, ...rest) => {
    try {
      const s = typeof chunk === 'string' ? chunk : chunk?.toString?.('utf8');
      if (s) {
        const line = s.trim().split('\n').filter(Boolean).pop();
        if (line) {
          _lastStderrLine = line;
          _lastStderrAt = new Date().toISOString();
        }
      }
    } catch { /* ignore */ }
    return origStderrWrite(chunk, ...rest);
  };

  _consolidationPromise = (async () => {
    const consolidator = new ObservationConsolidator({ dbPath: DB_PATH });
    try {
      await consolidator.init();
      let result;
      if (options.insightsOnly) {
        result = await consolidator.synthesizeInsights();
      } else if (options.date) {
        result = await consolidator.consolidateDay(options.date);
      } else {
        result = await consolidator.run({ includeToday: options.includeToday !== false });
      }
      return { ok: true, ...result };
    } finally {
      try { consolidator.close(); } catch { /* best-effort */ }
      if (stderrTapped) {
        process.stderr.write = origStderrWrite;
        stderrTapped = false;
      }
      _clearHeartbeat();
      _consolidationStartedAt = null;
      _consolidationArgs = null;
      _consolidationPromise = null;
    }
  })();

  return _consolidationPromise;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: _writer && _writer.db ? 'ok' : 'starting',
    dbPath: DB_PATH,
    dbExists: fs.existsSync(DB_PATH),
    port: PORT,
    role: 'single-owner-rw',
  });
});

app.get('/ready', (_req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ ready: false });
  res.json({ ready: true });
});

/**
 * POST /api/observations/messages — process a chunk of raw messages.
 * Body: { messages: [...], metadata: {...} }
 * Forwards to ObservationWriter.processMessages (LLM summarize + insert).
 */
app.post('/api/observations/messages', async (req, res) => {
  try {
    const { messages, metadata } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages must be an array' });
    }
    const writer = await ensureWriter();
    const result = await writer.processMessages(messages, metadata || {});
    res.json(result);
  } catch (err) {
    process.stderr.write(`[obs-api] /observations/messages error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: err.message || 'Failed to process messages' });
  }
});

/**
 * POST /api/observations/patch-artifacts/recent — backfill artifacts on
 * recent observations whose summary still says "Artifacts: none".
 * Body: { agent: string, modifiedFiles: string[] }
 */
app.post('/api/observations/patch-artifacts/recent', async (req, res) => {
  try {
    const { agent, modifiedFiles } = req.body || {};
    if (!agent || !Array.isArray(modifiedFiles) || modifiedFiles.length === 0) {
      return res.status(400).json({ error: 'agent and non-empty modifiedFiles required' });
    }
    const writer = await ensureWriter();
    const db = writer.db;
    const rows = db.prepare(
      `SELECT id, summary, metadata FROM observations
       WHERE agent = ? AND summary LIKE '%Artifacts: none%'
        AND created_at > datetime('now', '-4 hours')
       ORDER BY created_at DESC LIMIT 10`
    ).all(agent);

    const artifactsList = modifiedFiles.map(f => `edited ${f.split('/').pop()}`).join(', ');
    const update = db.prepare('UPDATE observations SET summary = ?, metadata = ? WHERE id = ?');
    let patched = 0;
    for (const row of rows) {
      let meta = {};
      try { meta = JSON.parse(row.metadata || '{}'); } catch { /* keep empty */ }
      meta.modifiedFiles = Array.from(new Set([...(meta.modifiedFiles || []), ...modifiedFiles]));
      const updatedSummary = row.summary.replace(/Artifacts:\s*none/i, `Artifacts: ${artifactsList}`);
      update.run(updatedSummary, JSON.stringify(meta), row.id);
      patched++;
    }
    res.json({ patched });
  } catch (err) {
    process.stderr.write(`[obs-api] /patch-artifacts/recent error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: err.message || 'Failed to patch recent artifacts' });
  }
});

/**
 * POST /api/observations/patch-artifacts/historical — one-time pass over
 * up to 500 historical rows: if metadata has modifiedFiles but summary
 * still says "Artifacts: none", fix the summary in place.
 */
app.post('/api/observations/patch-artifacts/historical', async (_req, res) => {
  try {
    const writer = await ensureWriter();
    const db = writer.db;
    const rows = db.prepare(
      `SELECT id, summary, metadata FROM observations
       WHERE summary LIKE '%Artifacts: none%'
       AND metadata IS NOT NULL AND metadata != '{}'
       ORDER BY created_at DESC LIMIT 500`
    ).all();

    const update = db.prepare('UPDATE observations SET summary = ? WHERE id = ?');
    let patched = 0;
    for (const row of rows) {
      let meta = {};
      try { meta = JSON.parse(row.metadata || '{}'); } catch { continue; }
      if (!meta.modifiedFiles || meta.modifiedFiles.length === 0) continue;
      const artifactsList = meta.modifiedFiles.map(f => `edited ${f.split('/').pop()}`).join(', ');
      const updatedSummary = row.summary.replace(/Artifacts:\s*none/i, `Artifacts: ${artifactsList}`);
      update.run(updatedSummary, row.id);
      patched++;
    }
    res.json({ patched, scanned: rows.length });
  } catch (err) {
    process.stderr.write(`[obs-api] /patch-artifacts/historical error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: err.message || 'Failed to patch historical artifacts' });
  }
});

app.get('/api/observations', (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Observations database unavailable' });

  let { agent, from, to, project, q, limit: limitStr, offset: offsetStr } = req.query;
  const limit = Math.min(parseInt(limitStr) || 50, 200);
  const offset = parseInt(offsetStr) || 0;

  try {
    const where = [];
    const params = {};

    if (agent) {
      const agents = Array.isArray(agent) ? agent : agent.split(',').map(a => a.trim());
      where.push(`agent IN (${agents.map((_, i) => `@agent${i}`).join(',')})`);
      agents.forEach((a, i) => { params[`agent${i}`] = a; });
    }
    if (from) {
      where.push('created_at >= @from');
      params.from = from;
    }
    if (to) {
      where.push('created_at <= @to');
      params.to = to.includes('T') ? to : `${to}T23:59:59.999Z`;
    }
    if (project) {
      where.push("json_extract(metadata, '$.project') = @project");
      params.project = project;
    }
    if (req.query.quality) {
      const qualities = Array.isArray(req.query.quality) ? req.query.quality : req.query.quality.split(',');
      where.push(`COALESCE(quality, 'normal') IN (${qualities.map((_, i) => `@quality${i}`).join(',')})`);
      qualities.forEach((qq, i) => { params[`quality${i}`] = qq; });
    }
    if (q) {
      try {
        db.prepare('SELECT 1 FROM observations_fts LIMIT 0').get();
        where.push('observations.rowid IN (SELECT rowid FROM observations_fts WHERE observations_fts MATCH @q)');
      } catch {
        where.push('summary LIKE @q');
        q = `%${q}%`;
      }
      params.q = q;
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const { total } = db.prepare(`SELECT COUNT(*) as total FROM observations ${whereClause}`).get(params);

    params.limit = limit;
    params.offset = offset;
    const rows = db.prepare(`
      SELECT id, summary as content, agent,
             session_id as sessionId,
             json_extract(metadata, '$.project') as project,
             created_at as timestamp,
             source_file as source,
             metadata,
             COALESCE(quality, 'normal') as quality
      FROM observations ${whereClause}
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `).all(params);

    const data = rows.map(row => {
      let meta = {};
      try { meta = JSON.parse(row.metadata || '{}'); } catch { /* ignore */ }
      const { metadata: _raw, ...rest } = row;
      return {
        ...rest,
        llmModel: meta.llmModel || null,
        llmProvider: meta.llmProvider || null,
        llmTokens: meta.llmTokens || null,
        llmLatencyMs: meta.llmLatencyMs || null,
      };
    });

    res.json({ data, total, limit, offset });
  } catch (err) {
    process.stderr.write(`[obs-api] /observations error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: 'Failed to query observations' });
  }
});

app.get('/api/observations/projects', (_req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Observations database unavailable' });
  try {
    const rows = db.prepare(
      "SELECT DISTINCT json_extract(metadata, '$.project') as project FROM observations WHERE json_extract(metadata, '$.project') IS NOT NULL ORDER BY project"
    ).all();
    res.json(rows.map(r => r.project).filter(Boolean));
  } catch (err) {
    process.stderr.write(`[obs-api] /observations/projects error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: 'Failed to query projects' });
  }
});

app.get('/api/digests', (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Observations database unavailable' });

  const { date, from, to, q, project, limit: limitStr, offset: offsetStr } = req.query;
  const limit = Math.min(parseInt(limitStr) || 50, 200);
  const offset = parseInt(offsetStr) || 0;

  try {
    try { db.prepare('SELECT 1 FROM digests LIMIT 0').get(); } catch {
      return res.json({ data: [], total: 0, limit, offset });
    }

    const where = [];
    const params = {};
    if (date) { where.push('date = @date'); params.date = date; }
    if (from) { where.push('date >= @from'); params.from = from; }
    if (to) { where.push('date <= @to'); params.to = to; }
    if (q) { where.push('(theme LIKE @q OR summary LIKE @q)'); params.q = `%${q}%`; }
    if (project) { where.push('project = @project'); params.project = project; }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    const { total } = db.prepare(`SELECT COUNT(*) as total FROM digests ${whereClause}`).get(params);

    params.limit = limit;
    params.offset = offset;
    const rows = db.prepare(`
      SELECT id, date, theme, summary, observation_ids as observationIds,
             agents, files_touched as filesTouched, quality, created_at as createdAt,
             project
      FROM digests ${whereClause}
      ORDER BY date DESC, created_at DESC
      LIMIT @limit OFFSET @offset
    `).all(params);

    const data = rows.map(row => ({
      ...row,
      observationIds: JSON.parse(row.observationIds || '[]'),
      agents: JSON.parse(row.agents || '[]'),
      filesTouched: JSON.parse(row.filesTouched || '[]'),
    }));

    res.json({ data, total, limit, offset });
  } catch (err) {
    process.stderr.write(`[obs-api] /digests error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: 'Failed to query digests' });
  }
});

app.get('/api/digests/projects', (_req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Observations database unavailable' });
  try {
    try { db.prepare('SELECT 1 FROM digests LIMIT 0').get(); } catch { return res.json([]); }
    const rows = db.prepare(
      'SELECT DISTINCT project FROM digests WHERE project IS NOT NULL ORDER BY project'
    ).all();
    res.json(rows.map(r => r.project).filter(Boolean));
  } catch (err) {
    process.stderr.write(`[obs-api] /digests/projects error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: 'Failed to query digest projects' });
  }
});

app.get('/api/insights', (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Observations database unavailable' });

  const { topic, q, project } = req.query;
  try {
    try { db.prepare('SELECT 1 FROM insights LIMIT 0').get(); } catch {
      return res.json({ data: [], total: 0 });
    }

    const where = [];
    const params = {};
    if (topic) { where.push('topic = @topic'); params.topic = topic; }
    if (q) { where.push('(topic LIKE @q OR summary LIKE @q)'); params.q = `%${q}%`; }
    if (project) { where.push('project = @project'); params.project = project; }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const rows = db.prepare(`
      SELECT id, topic, summary, confidence, digest_ids as digestIds,
             last_updated as lastUpdated, created_at as createdAt, project
      FROM insights ${whereClause}
      ORDER BY confidence DESC, last_updated DESC
    `).all(params);

    const data = rows.map(row => ({
      ...row,
      digestIds: JSON.parse(row.digestIds || '[]'),
    }));

    res.json({ data, total: data.length });
  } catch (err) {
    process.stderr.write(`[obs-api] /insights error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: 'Failed to query insights' });
  }
});

app.get('/api/insights/projects', (_req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Observations database unavailable' });
  try {
    try { db.prepare('SELECT 1 FROM insights LIMIT 0').get(); } catch { return res.json([]); }
    const rows = db.prepare(
      'SELECT DISTINCT project FROM insights WHERE project IS NOT NULL ORDER BY project'
    ).all();
    res.json(rows.map(r => r.project).filter(Boolean));
  } catch (err) {
    process.stderr.write(`[obs-api] /insights/projects error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: 'Failed to query insight projects' });
  }
});

app.get('/api/projects', (_req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Observations database unavailable' });
  try {
    const all = new Set();
    try {
      const obs = db.prepare(
        "SELECT DISTINCT json_extract(metadata, '$.project') as project FROM observations WHERE json_extract(metadata, '$.project') IS NOT NULL"
      ).all();
      for (const r of obs) if (r.project) all.add(r.project);
    } catch { /* table may be missing */ }
    try {
      const digs = db.prepare('SELECT DISTINCT project FROM digests WHERE project IS NOT NULL').all();
      for (const r of digs) if (r.project) all.add(r.project);
    } catch { /* table may be missing */ }
    try {
      const ins = db.prepare('SELECT DISTINCT project FROM insights WHERE project IS NOT NULL').all();
      for (const r of ins) if (r.project) all.add(r.project);
    } catch { /* table may be missing */ }
    res.json([...all].sort());
  } catch (err) {
    process.stderr.write(`[obs-api] /projects error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: 'Failed to query projects' });
  }
});

/**
 * POST /api/retrieve — retrieve relevant knowledge for a query.
 * Body: { query: string, budget?: number, threshold?: number, context?: any }
 * Returns: { markdown: string, meta: { ... } }
 */
app.post('/api/retrieve', async (req, res) => {
  const startMs = Date.now();
  const { query, budget = 1000, threshold = 0.75, context = null } = req.body || {};

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'query (string) is required' });
  }
  if (query.length > 500) {
    return res.status(400).json({ error: 'query must be 500 characters or less' });
  }
  const parsedBudget = Number(budget);
  if (Number.isNaN(parsedBudget) || parsedBudget < 100 || parsedBudget > 5000) {
    return res.status(400).json({ error: 'budget must be between 100 and 5000' });
  }

  try {
    await ensureWriter(); // ensure db is open for keyword search
    const result = await ensureRetrieval().retrieve(query, {
      budget: parsedBudget,
      threshold: Number(threshold) || 0.75,
      context: context || null,
    });
    result.meta.latency_ms = Date.now() - startMs;
    res.json(result);
  } catch (err) {
    process.stderr.write(`[obs-api] /retrieve error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: 'Retrieval failed' });
  }
});

/**
 * POST /api/consolidation/run — trigger consolidation in-process.
 * Body: { date?: string, includeToday?: boolean, insightsOnly?: boolean }
 * Coalesces concurrent triggers — second caller attaches to the in-flight run.
 */
app.post('/api/consolidation/run', async (req, res) => {
  if (_shuttingDown) {
    return res.status(503).json({ error: 'Server is shutting down' });
  }
  const attached = !!_consolidationPromise;
  try {
    const result = await runConsolidation(req.body || {});
    res.json({ success: true, attached, ...result });
  } catch (err) {
    process.stderr.write(`[obs-api] /consolidation/run error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: err.message || 'Consolidation failed' });
  }
});

app.get('/api/consolidation/status', (_req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Observations database unavailable' });
  try {
    const totalObs = db.prepare('SELECT COUNT(*) as cnt FROM observations').get().cnt;
    const today = new Date().toISOString().split('T')[0];

    let undigested = totalObs;
    let pendingPast = 0;
    let pendingToday = 0;
    let lowQuality = 0;
    try {
      undigested = db.prepare("SELECT COUNT(*) as cnt FROM observations WHERE digested_at IS NULL AND quality != 'low'").get().cnt;
      lowQuality = db.prepare("SELECT COUNT(*) as cnt FROM observations WHERE digested_at IS NULL AND quality = 'low'").get().cnt;
      pendingPast = db.prepare("SELECT COUNT(*) as cnt FROM observations WHERE digested_at IS NULL AND quality != 'low' AND date(created_at) < ?").get(today).cnt;
      pendingToday = db.prepare("SELECT COUNT(*) as cnt FROM observations WHERE digested_at IS NULL AND quality != 'low' AND date(created_at) = ?").get(today).cnt;
    } catch { /* digested_at column may not exist */ }

    let totalDigests = 0;
    try { totalDigests = db.prepare('SELECT COUNT(*) as cnt FROM digests').get().cnt; } catch { /* table may not exist */ }

    let totalInsights = 0;
    try { totalInsights = db.prepare('SELECT COUNT(*) as cnt FROM insights').get().cnt; } catch { /* table may not exist */ }

    const inflight = readConsolidationHeartbeat();

    res.json({
      totalObs, undigested, lowQuality, pendingPast, pendingToday,
      digested: totalObs - undigested - lowQuality,
      totalDigests, totalInsights,
      inflight,
    });
  } catch (err) {
    process.stderr.write(`[obs-api] /consolidation/status error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: 'Failed to get consolidation status' });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  process.stderr.write(`[obs-api] listening on http://0.0.0.0:${PORT} (db: ${DB_PATH})\n`);
  // Warm the writer first (opens DB rw + FTS triggers + WAL), then warm
  // retrieval (fastembed model + Qdrant client) so the first POST /retrieve
  // doesn't pay a multi-second cold start.
  ensureWriter()
    .then(() => { ensureRetrieval(); })
    .catch((err) => {
      process.stderr.write(`[obs-api] startup init failed: ${err.message}\n`);
    });
});

async function shutdown(signal) {
  process.stderr.write(`[obs-api] ${signal} — shutting down\n`);
  _shuttingDown = true;
  // Wait briefly for in-flight consolidation to drain. Bound the wait so a
  // wedged LLM call can't outlast the supervisor's SIGKILL grace.
  if (_consolidationPromise) {
    process.stderr.write(`[obs-api] waiting up to 20s for in-flight consolidation\n`);
    await Promise.race([
      _consolidationPromise.catch(() => { /* surfaced in handler */ }),
      new Promise((r) => setTimeout(r, 20_000)),
    ]);
  }
  _clearHeartbeat();
  server.close(async () => {
    if (_writer) {
      try { await _writer.close?.(); } catch { /* best effort */ }
    }
    process.exit(0);
  });
  // Hard exit if graceful shutdown stalls
  setTimeout(() => process.exit(1), 25_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
