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
import { ObservationPruner } from '../src/live-logging/ObservationPruner.js';
import { ColdStoreReader } from '../src/live-logging/ColdStoreReader.js';
// Phase 35 plan 35-04 - pure merge helpers extracted into a sibling module so
// the Jest integration test can import them without dragging in RetrievalService
// and its TS dist deps.  Re-exported below for backwards-compatible discovery.
import { _computeRetentionBoundary, _mergeObservations, _mergeDigests } from './observations-api-merge.mjs';

// Phase 44 plan 07 — km-core canonical /api/v1 surface (root-barrel imports).
// The legacy versioned-prefix-removed orphan-draft mount + the orphan-draft
// router factory were REPLACED in this plan per CONTEXT R-4 hard cutover.
// createKmCoreRouter (Plan 44-06) is the canonical 15-endpoint factory and
// the observation-view reshapers (Plan 44-05) feed the typed views at
// /api/coding/{observations,digests,insights}.
import {
  GraphKMStore,
  createKmCoreRouter,
  observationToLegacy,
  digestToLegacy,
  insightToLegacy,
  defaultOntologyDir,
} from '@fwornle/km-core';
import { Router } from 'express';

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

// Phase 35 plan 35-04 wiring — module-level state for the in-process pruner
// (1h interval, per CONTEXT.md G3 option a) and the read-only cold-store reader
// used by the range-merge handlers below.
let _pruner = null;
let _pruneInterval = null;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;  // 1 hour
let _coldStore = null;

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

// Phase 35 plan 35-04 - pruner factory + 1h interval scheduler.
// The pruner is constructed lazily after ensureWriter resolves (so _writer.db
// and _writer.retentionDays are populated). First prune fires immediately on
// boot so an already-oversized DB shrinks without a 1h wait. Errors are logged
// to stderr but never thrown - obs-api boot must remain crash-free even if the
// pruner cannot run.
function ensurePruner() {
  if (_pruner) return _pruner;
  if (!_writer || !_writer.db || !_writer.retentionDays) return null;
  _pruner = new ObservationPruner({ db: _writer.db, retentionDays: _writer.retentionDays });
  try {
    const r = _pruner.prune();
    process.stderr.write(`[obs-api] initial prune: ${JSON.stringify(r)}\n`);
  } catch (err) {
    process.stderr.write(`[obs-api] initial prune failed: ${err.message}\n`);
  }
  _pruneInterval = setInterval(() => {
    try { _pruner.prune(); } catch (err) {
      process.stderr.write(`[obs-api] periodic prune failed: ${err.message}\n`);
    }
  }, PRUNE_INTERVAL_MS);
  _pruneInterval.unref?.();
  return _pruner;
}

// Phase 35 plan 35-04 - cold-store reader factory. Defaults to .data/observation-export
// (the JSON files maintained by ObservationExporter on a 10s debounced cadence).
function ensureColdStore() {
  if (_coldStore) return _coldStore;
  _coldStore = new ColdStoreReader({});
  return _coldStore;
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

// Reading the heartbeat doubles as crash-recovery: if the pid that wrote it
// is dead, or the file is older than 15× the 2s heartbeat interval (so the
// worker has clearly stopped bumping it), the heartbeat is stale and we
// actively clean it up. Otherwise the dashboard would render a perpetual
// "Consolidating..." after any obs-api crash or restart, blocking the user
// from triggering a fresh run.
const HEARTBEAT_STALE_MS = 30_000;

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

    // Stale-heartbeat recovery. Two failure modes the live writer can leave
    // behind: (1) the obs-api process that owned the run died (alive=false),
    // (2) the in-process worker is still in this process but stopped bumping
    // — usually because the consolidation thread is hung on a wedged LLM call
    // or DB lock. Either way, the dashboard should NOT keep showing
    // "Consolidating..." indefinitely. Clean up the file so a fresh run can
    // be triggered, and report inflight=null upstream.
    if (!alive || ageMs > HEARTBEAT_STALE_MS) {
      try { fs.unlinkSync(HEARTBEAT_PATH); } catch { /* may already be gone */ }
      process.stderr.write(
        `[obs-api] cleared stale consolidation heartbeat (pid=${data.pid}, alive=${alive}, ageMs=${ageMs})\n`
      );
      return null;
    }

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
// F1: async consolidation — POST /api/consolidation/run returns 202 immediately
// and the frontend polls /api/consolidation/status. We track the last completed
// run so the polling loop can detect "just finished" and surface the result.
let _lastConsolidationJobId = null;     // monotonic counter, surfaced in 202 + status
let _lastConsolidationResult = null;    // { digests, observations, days, ... } from runConsolidation
let _lastConsolidationError = null;     // { message } if last run threw
let _lastConsolidationFinishedAt = null; // ISO timestamp, set in the finally of runConsolidation
let _consolidationJobCounter = 0;       // bump on each new run start
let _consolidationArgs = null;
let _heartbeatInterval = null;
let _lastStderrLine = '';
let _lastStderrAt = null;
// Abort controller for any in-flight LLM HTTP call the consolidator makes.
// Aborted in shutdown() so the proxy can kill its spawned claude CLI children
// instead of leaving them orphaned past obs-api's exit.
let _consolidationAbort = null;
let _shuttingDown = false;

// Keep-alive threshold: how long real stderr can be silent before _bumpHeartbeat
// refreshes _lastStderrAt anyway. The consolidator's insight stage logs once
// per chunk start, then sleeps inside a single LLM call for 1-3 min — during
// which the dashboard's "stuck" rule (stderrAgeMs > 60s) would otherwise fire
// a false-positive red banner. A genuinely wedged JS event loop cannot fire
// this timer, so lastHeartbeat going stale is the real wedge signal (caught
// by the obs-api stale-heartbeat sweep — readConsolidationHeartbeat).
const STDERR_KEEPALIVE_MS = 30_000;

function _bumpHeartbeat() {
  if (!_consolidationStartedAt) return;
  try {
    const now = new Date();
    const lastReal = _lastStderrAt ? new Date(_lastStderrAt).getTime() : 0;
    if (now.getTime() - lastReal > STDERR_KEEPALIVE_MS) {
      _lastStderrAt = now.toISOString();
    }
    fs.mkdirSync(path.dirname(HEARTBEAT_PATH), { recursive: true });
    fs.writeFileSync(HEARTBEAT_PATH, JSON.stringify({
      pid: process.pid,
      startedAt: _consolidationStartedAt,
      lastHeartbeat: now.toISOString(),
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
  // F1: bump jobId on each new run start so the frontend can detect a fresh
  // completion (lastJobId increments + lastFinishedAt advances).
  _consolidationJobCounter += 1;
  _lastConsolidationJobId = _consolidationJobCounter;

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

  _consolidationAbort = new AbortController();
  _consolidationPromise = (async () => {
    const consolidator = new ObservationConsolidator({
      dbPath: DB_PATH,
      abortSignal: _consolidationAbort.signal,
    });
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
      // F1: capture for /api/consolidation/status. Don't reset to null on the
      // next run start — the polling frontend reads lastFinishedAt to decide
      // "is this a NEW completion since I last looked?".
      _lastConsolidationResult = result;
      _lastConsolidationError = null;
      return { ok: true, ...result };
    } catch (err) {
      _lastConsolidationError = { message: err?.message || String(err) };
      _lastConsolidationResult = null;
      throw err;
    } finally {
      _lastConsolidationFinishedAt = new Date().toISOString();
      try { consolidator.close(); } catch { /* best-effort */ }
      if (stderrTapped) {
        process.stderr.write = origStderrWrite;
        stderrTapped = false;
      }
      _clearHeartbeat();
      _consolidationStartedAt = null;
      _consolidationArgs = null;
      _consolidationPromise = null;
      _consolidationAbort = null;
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

// Phase 44 plan 07 (R-4 hard cutover): the legacy SQLite-backed GET
// /api/observations was REPLACED by /api/coding/observations (mounted
// later in this file). There is no legacy URL fallback per CONTEXT R-4 —
// requests to the old path return 404 from Express's default handler.

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

// Phase 44 plan 07 (R-4 hard cutover): the legacy SQLite-backed GET
// /api/digests was REPLACED by /api/coding/digests. Requests to the old
// path return 404.

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

// Phase 44 plan 07 (R-4 hard cutover): the legacy SQLite-backed GET
// /api/insights was REPLACED by /api/coding/insights. Requests to the
// old path return 404.

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
 * GET /api/projects/:project/coverage
 *
 * Per-project truthfulness + coverage summary used by the dashboard's
 * Project Coverage tab.
 *
 * Response shape:
 *   {
 *     project: "coding",
 *     computedAt: "ISO",
 *     insights: { total, fresh, partial, stale, unverified, avgRatio },
 *     coverage: {
 *       filesReferenced: number,           // distinct verified PATH claims
 *       componentsMentioned: string[],     // from working-memory taxonomy
 *       componentsMissing: string[]
 *     },
 *     perInsight: [
 *       { id, topic, confidence, ratio, totalClaims, verifiedClaims, staleClaimCount, lastUpdated, parentTopic, relatedInsightIds, referencedFiles }
 *     ]
 *   }
 */
/**
 * Per-project component taxonomy with search aliases.
 *
 * Working-memory tags are CamelCase identifiers ("LiveLoggingSystem")
 * but insights use natural language ("live logging", "LSL"). Each entry
 * lists the canonical name plus alternate spellings that should count
 * as a mention. Match is case-insensitive substring against
 * topic + summary across all insights in the project.
 */
const PROJECT_COMPONENT_TAXONOMY = {
  coding: [
    { name: 'SemanticAnalysis', aliases: ['semantic analysis', 'semantic-analysis', 'wave-analysis'] },
    { name: 'KnowledgeManagement', aliases: ['knowledge management', 'knowledge graph', 'insight', 'digest', 'okb', 'ukb'] },
    { name: 'ConstraintSystem', aliases: ['constraint', 'constraints'] },
    { name: 'DockerizedServices', aliases: ['docker', 'container', 'compose'] },
    { name: 'CodingPatterns', aliases: ['coding pattern', 'pattern'] },
    { name: 'LiveLoggingSystem', aliases: ['live logging', 'lsl', 'specstory', 'transcript monitor', 'etm'] },
    { name: 'LLMAbstraction', aliases: ['llm proxy', 'llm cli', 'rapid-llm-proxy', 'llmservice'] },
  ],
  'rapid-automations': [
    { name: 'OKB', aliases: ['operational knowledge base', 'okb'] },
    { name: 'OKM', aliases: ['operational-knowledge-management', 'okm'] },
    { name: 'rapid-toolkit', aliases: ['rapid-toolkit', 'rapid toolkit'] },
    { name: 'rapid-agentic-sandbox', aliases: ['rapid-agentic-sandbox', 'sandbox'] },
    { name: 'rapidscribe-meeting', aliases: ['rapidscribe', 'meeting'] },
  ],
};

app.get('/api/projects/:project/coverage', (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Observations database unavailable' });
  const { project } = req.params;
  if (!project) return res.status(400).json({ error: 'project required' });
  try {
    try { db.prepare('SELECT 1 FROM insights LIMIT 0').get(); } catch {
      return res.json({
        project,
        computedAt: new Date().toISOString(),
        insights: { total: 0, fresh: 0, partial: 0, stale: 0, unverified: 0, avgRatio: 1 },
        coverage: { filesReferenced: 0, componentsMentioned: [], componentsMissing: [] },
        perInsight: [],
      });
    }
    // Auto-archived insights are filtered out of Coverage — they're treated
    // as deleted from the user's perspective. The /api/insights list
    // applies the same default, so the two views stay consistent.
    const rows = db.prepare(
      `SELECT id, topic, confidence, summary, digest_ids as digestIds,
              last_updated as lastUpdated, created_at as createdAt, project, metadata
       FROM insights
       WHERE project = ? AND json_extract(metadata, '$.archivedAt') IS NULL
       ORDER BY last_updated DESC`
    ).all(project);

    const perInsight = [];
    const allReferencedFiles = new Set();
    let fresh = 0, partial = 0, stale = 0, unverified = 0;
    let ratioSum = 0, ratioCount = 0;

    for (const r of rows) {
      let metadata = {};
      try { metadata = r.metadata ? JSON.parse(r.metadata) : {}; } catch { /* keep empty */ }
      const cv = metadata.codeVerification || null;
      const ratio = cv && typeof cv.verificationRatio === 'number' ? cv.verificationRatio : null;

      if (ratio === null) {
        unverified++;
      } else {
        ratioSum += ratio;
        ratioCount++;
        if (ratio >= 0.7) fresh++;
        else if (ratio >= 0.5) partial++;
        else stale++;
      }

      const referencedFiles = Array.isArray(cv?.referencedFiles) ? cv.referencedFiles : [];
      for (const f of referencedFiles) allReferencedFiles.add(f);

      perInsight.push({
        id: r.id,
        topic: r.topic,
        confidence: r.confidence,
        ratio,
        totalClaims: cv?.totalClaims ?? null,
        verifiedClaims: cv?.verifiedClaims ?? null,
        staleClaimCount: Array.isArray(cv?.staleClaims) ? cv.staleClaims.length : 0,
        verifiedAt: cv?.verifiedAt ?? null,
        lastUpdated: r.lastUpdated,
        parentTopic: metadata.parentTopic ?? null,
        relatedInsightIds: Array.isArray(metadata.relatedInsightIds) ? metadata.relatedInsightIds : [],
        referencedFiles,
      });
    }

    // Component taxonomy match — case-insensitive substring of EITHER the
    // canonical name OR any alias (split-camelCase form) against the union
    // of every insight's topic+summary in the project.
    const taxonomy = PROJECT_COMPONENT_TAXONOMY[project] || [];
    const componentsMentioned = [];
    const componentsMissing = [];
    if (taxonomy.length > 0) {
      const haystack = rows
        .map((r) => `${r.topic} ${r.summary || ''}`)
        .join(' ')
        .toLowerCase();
      for (const c of taxonomy) {
        const probes = [c.name, ...(c.aliases || [])].map((s) => s.toLowerCase());
        if (probes.some((p) => haystack.includes(p))) componentsMentioned.push(c.name);
        else componentsMissing.push(c.name);
      }
    }

    res.json({
      project,
      computedAt: new Date().toISOString(),
      insights: {
        total: rows.length,
        fresh,
        partial,
        stale,
        unverified,
        avgRatio: ratioCount > 0 ? Number((ratioSum / ratioCount).toFixed(3)) : 1,
      },
      coverage: {
        filesReferenced: allReferencedFiles.size,
        componentsMentioned,
        componentsMissing,
      },
      perInsight,
    });
  } catch (err) {
    process.stderr.write(`[obs-api] /projects/${project}/coverage error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: 'Failed to compute project coverage' });
  }
});

/**
 * POST /api/insights/:id/resynthesize
 *
 * Regenerates an insight's summary from its source digests, grounded in
 * the current codebase. Mirrors the new content into the VKB graph so the
 * LevelDB-backed knowledge store stays in sync with SQLite. Called by the
 * Insights page's per-card Update button when the verifier has flagged
 * stale claims.
 *
 * Single-flight: only one re-synthesis at a time per process, since the
 * consolidator opens its own DB handle and an LLM call is in flight.
 * Returns 409 if a re-synthesis (or the bulk consolidation) is already
 * running.
 *
 * Response (200):
 *   { id, topic, summary, confidence, lastUpdated, codeVerification,
 *     kgPushed, preStaleCount, postStaleCount, durationMs }
 */
let _resynthesizeInflight = false;

app.post('/api/insights/:id/resynthesize', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'insight id required' });
  if (_consolidationPromise) {
    return res.status(409).json({ error: 'Bulk consolidation in progress; try again when it completes' });
  }
  if (_resynthesizeInflight) {
    return res.status(409).json({ error: 'Another insight re-synthesis is already running; try again shortly' });
  }
  _resynthesizeInflight = true;
  const startedAt = Date.now();

  const consolidator = new ObservationConsolidator({ dbPath: DB_PATH });
  try {
    await consolidator.init();
    const updated = await consolidator.resynthesizeInsight(id);
    const durationMs = Date.now() - startedAt;
    res.json({ ...updated, durationMs });
  } catch (err) {
    process.stderr.write(`[obs-api] /insights/${id}/resynthesize error: ${err.message}\n`);
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    // NO_SOURCE: both the source digests AND a usable summary are missing.
    // We can no longer fall back to summary-only synthesis. 409 because
    // it's a conflict with current state, not a server error.
    if (err.code === 'NO_SOURCE' || err.code === 'NO_DIGESTS') {
      return res.status(409).json({ error: err.message });
    }
    if (err.code === 'LLM_FAILED' || err.code === 'PARSE_FAILED') {
      return res.status(502).json({ error: err.message });
    }
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: `Re-synthesis failed: ${err.message}` });
  } finally {
    try { consolidator.close(); } catch { /* best-effort */ }
    _resynthesizeInflight = false;
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
app.post('/api/consolidation/run', (req, res) => {
  if (_shuttingDown) {
    return res.status(503).json({ error: 'Server is shutting down' });
  }
  // F1: fire-and-forget. Each consolidation run can take many minutes
  // (every digest/insight call may fall back to the claude CLI at ~10-14s),
  // which exceeded the dashboard's reverse-proxy timeout and surfaced as a
  // bogus 502 even though the work completed server-side. Return 202 immediately
  // with the job id; the frontend polls /api/consolidation/status to detect
  // completion + read the result. runConsolidation() coalesces concurrent
  // triggers, so a second click during an in-flight run just attaches.
  const attached = !!_consolidationPromise;
  // Kick off (or attach to) the run. Swallow the rejection here — the error
  // lands in _lastConsolidationError where the status endpoint surfaces it.
  // Without the .catch we'd get an unhandledRejection log on every failed run.
  runConsolidation(req.body || {}).catch(err => {
    process.stderr.write(`[obs-api] /consolidation/run async error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
  });
  res.status(202).json({
    success: true,
    accepted: true,
    attached,
    jobId: _lastConsolidationJobId,
    startedAt: _consolidationStartedAt,
  });
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

    // Latest write timestamps per table — consumed by health-coordinator's
    // knowledge_pipeline slice to drive the [📚] statusline badge. ISO-8601
    // strings (the column type), null when the table is empty or absent.
    let lastObservationAt = null;
    try { lastObservationAt = db.prepare('SELECT MAX(created_at) AS t FROM observations').get().t || null; } catch { /* */ }
    let lastDigestAt = null;
    try { lastDigestAt = db.prepare('SELECT MAX(created_at) AS t FROM digests').get().t || null; } catch { /* */ }
    let lastInsightAt = null;
    try { lastInsightAt = db.prepare('SELECT MAX(created_at) AS t FROM insights').get().t || null; } catch { /* */ }

    const inflight = readConsolidationHeartbeat();

    res.json({
      totalObs, undigested, lowQuality, pendingPast, pendingToday,
      digested: totalObs - undigested - lowQuality,
      totalDigests, totalInsights,
      lastObservationAt, lastDigestAt, lastInsightAt,
      inflight,
      // F1: last-completed run surface for the polling frontend. lastJob.id
      // advances on every new run; when (id !== prevId AND inflight === null)
      // the frontend renders the result and stops polling.
      lastJob: _lastConsolidationJobId === null ? null : {
        id: _lastConsolidationJobId,
        finishedAt: _lastConsolidationFinishedAt,
        result: _lastConsolidationResult,   // null while running, or on error
        error: _lastConsolidationError,     // null on success
      },
    });
  } catch (err) {
    process.stderr.write(`[obs-api] /consolidation/status error: ${err.message}\n`);
    if (isCorruptionError(err)) invalidateDb();
    res.status(500).json({ error: 'Failed to get consolidation status' });
  }
});

// ── Phase 44 plan 07: km-core GraphKMStore + canonical REST router ────────
//
// Mount the km-core canonical REST router at the versioned `/api/v` path so
// the observations API server exposes the unified entity/relation/search
// surface alongside the typed-view legacy reshape endpoints.  The store
// opens asynchronously; requests that arrive before hydration completes
// get a 503.

const KG_DB_PATH = path.join(REPO_ROOT, '.data', 'knowledge-graph', 'leveldb');
const KG_EXPORT_DIR = path.join(REPO_ROOT, '.data', 'knowledge-graph', 'exports');

let _kmStore = null;
let _kmStoreReady = false;

async function ensureKMStore() {
  if (_kmStore && _kmStoreReady) return _kmStore;
  if (_kmStore) return null; // init in progress
  try {
    // CLAUDE.md mandatory rule: ALL GraphKMStore construction MUST pass
    // `ontologyDir` (Phase 41 lesson, commits 87bc2f567 / fd35c5350) —
    // otherwise default-class resolution throws `opts.classes omitted but
    // store has no ontology registry`. `defaultOntologyDir()` walks up from
    // the @fwornle/km-core package to find the bundled ontology directory.
    _kmStore = new GraphKMStore({
      dbPath: KG_DB_PATH,
      exportDir: KG_EXPORT_DIR,
      ontologyDir: defaultOntologyDir(),
    });
    await _kmStore.open();
    _kmStoreReady = true;
    process.stderr.write(`[obs-api] km-core GraphKMStore ready\n`);
    return _kmStore;
  } catch (err) {
    process.stderr.write(`[obs-api] km-core store init failed: ${err.message}\n`);
    _kmStore = null;
    return null;
  }
}

// ── Phase 44 plan 07 (R-4 hard cutover): canonical /api/v1 mount ──────────
//
// Mount the km-core canonical 15-endpoint surface at /api/v1 via the
// keystone factory createKmCoreRouter (Plan 44-06). The prior orphan-draft
// mount + alias endpoints + X-KM-Store-Available enrichment middleware
// were REMOVED in this plan — there is NO dual-mount and NO deprecation
// window per CONTEXT R-4. The same 503-until-ready hydration gate that
// guarded the prior mount now guards /api/v1/ verbatim (RESEARCH Open Q5).
const kmRouter = Router();

// Hydration gate: 503 until the GraphKMStore finishes opening. Preserved
// verbatim from the prior orphan-draft mount to keep symmetry across A/B/C.
kmRouter.use((_req, res, next) => {
  if (!_kmStoreReady || !_kmStore) {
    return res.status(503).json({ error: 'Knowledge graph store not ready' });
  }
  next();
});

app.use('/api/v1', kmRouter);

// After the store opens, attach the canonical 15-endpoint surface. The
// factory takes a Router-like instance + opts; opts.ontologyRegistry feeds
// /ontology/*, opts.snapshotDir wires the SnapshotManager for /snapshots/*,
// opts.restartCommand is surfaced in the restore handler's restartRequired
// signal (S-2 revised — operator triggers `launchctl kickstart` to restart
// the obs-api launchd job).
function mountKMRoutes(store) {
  createKmCoreRouter(store, kmRouter, {
    ontologyRegistry: store.ontology,
    snapshotDir: KG_EXPORT_DIR,
    restartCommand: 'launchctl kickstart -k gui/$(id -u) com.coding.obs-api',
  });
  process.stderr.write(`[obs-api] km-core /api/v1 routes mounted\n`);
}

// ── Phase 44 plan 07 (A-4): /api/coding/* typed views ─────────────────────
//
// These replace the SQLite-backed legacy GETs at /api/observations,
// /api/digests, /api/insights. Each handler iterates km-core entities
// filtered by ontologyClass='Observation|Digest|Insight' (Pitfall 3
// two-field OR-check), reshapes via the observation-view adapter
// (Plan 44-05), applies the legacy query-string filters in JS, and
// returns the EXACT same response envelope shape the dashboard at :3032
// reads (Pitfall 2 — `{data, total, limit, offset, _metadata}`).
//
// Between Plan 07 landing and Plan 10 migrating SQLite → km-core, these
// views return empty `data:[]` — that is by design. Plan 02 typed-views
// test GREENs on shape; Plan 11 verifies dashboard rendering once data
// flows from Plan 10.

// Cap per-request scan size — RULE 2 (Rule 4 explicit cap per T-44-07-03).
// The dashboard's default page size matches the legacy `limit=50`; legacy
// handler hard-capped at 200 (Math.min(parseInt(limitStr) || 50, 200)),
// so we preserve that ceiling.
const TYPED_VIEW_DEFAULT_LIMIT = 50;
const TYPED_VIEW_MAX_LIMIT = 200;

function parseLimitOffset(req, defaultLimit = TYPED_VIEW_DEFAULT_LIMIT) {
  const limit = Math.min(parseInt(req.query.limit) || defaultLimit, TYPED_VIEW_MAX_LIMIT);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  return { limit, offset };
}

// Collect all km-core entities of an ontologyClass via the canonical
// public API. `_kmStore.graph` is private (GraphKMStore.ts:137); the
// earlier draft of this helper iterated it directly and threw
// `.for is not iterable` at runtime. `store.findByOntologyClass(cls)`
// is the canonical helper — it already enforces the Pitfall 3 two-field
// OR-check (entityType === cls || ontologyClass === cls) at
// GraphKMStore.ts:565 and respects D-34 active-only filtering.
//
// Iterating the underlying graph is O(n) on the entity count — Plan 10's
// migration delivers ~800 obs + ~250 digests + ~77 insights, well within
// memory budget. T-44-07-03 mitigation: caller applies `limit` ceiling
// before paging.
async function collectByOntologyClass(cls) {
  return _kmStore.findByOntologyClass(cls);
}

// /api/coding/observations — replaces SQLite /api/observations.
// Query params preserved verbatim: agent, project, from, to, q, quality,
// limit, offset (Pitfall 2 contract).
app.get('/api/coding/observations', async (_req, res) => {
  try {
    if (!_kmStoreReady || !_kmStore) {
      return res.status(503).json({ error: 'Knowledge graph store not ready' });
    }
    const req = _req;
    const { agent, project, from, to, q, quality } = req.query;
    const { limit, offset } = parseLimitOffset(req);

    const entities = await collectByOntologyClass('Observation');
    const reshaped = entities.map(observationToLegacy);

    // Legacy filter semantics, ported from the prior SQLite WHERE-builder.
    const agentSet = agent
      ? new Set(
          (Array.isArray(agent) ? agent : String(agent).split(',')).map((a) => String(a).trim())
        )
      : null;
    const qualitySet = quality
      ? new Set(Array.isArray(quality) ? quality : String(quality).split(','))
      : null;
    const qLower = q ? String(q).toLowerCase() : null;
    const toExclusive = to && !String(to).includes('T') ? `${to}T23:59:59.999Z` : to;

    let filtered = reshaped;
    if (agentSet) filtered = filtered.filter((row) => agentSet.has(row.agent));
    if (project) filtered = filtered.filter((row) => row.project === project);
    if (from) filtered = filtered.filter((row) => row.timestamp && row.timestamp >= from);
    if (toExclusive) filtered = filtered.filter((row) => row.timestamp && row.timestamp <= toExclusive);
    if (qualitySet) filtered = filtered.filter((row) => qualitySet.has(row.quality ?? 'normal'));
    if (qLower) {
      filtered = filtered.filter((row) =>
        typeof row.content === 'string' && row.content.toLowerCase().includes(qLower)
      );
    }

    // Sort newest-first to match SQLite handler's `ORDER BY created_at DESC`.
    filtered.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));
    const total = filtered.length;
    const data = filtered.slice(offset, offset + limit);

    res.json({
      data,
      total,
      limit,
      offset,
      _metadata: { fromColdStore: false, source: 'km-core' },
    });
  } catch (err) {
    process.stderr.write(`[obs-api] /api/coding/observations error: ${err.message}\n`);
    res.status(500).json({ error: 'Failed to query observations' });
  }
});

// /api/coding/digests — replaces SQLite /api/digests.
// Query params preserved: date, from, to, q, project, limit, offset.
app.get('/api/coding/digests', async (_req, res) => {
  try {
    if (!_kmStoreReady || !_kmStore) {
      return res.status(503).json({ error: 'Knowledge graph store not ready' });
    }
    const req = _req;
    const { date, from, to, q, project } = req.query;
    const { limit, offset } = parseLimitOffset(req);

    const entities = await collectByOntologyClass('Digest');
    const reshaped = entities.map(digestToLegacy);

    const qLower = q ? String(q).toLowerCase() : null;

    let filtered = reshaped;
    if (date) filtered = filtered.filter((row) => row.date === date);
    if (from) filtered = filtered.filter((row) => row.date && row.date >= from);
    if (to) filtered = filtered.filter((row) => row.date && row.date <= to);
    if (project) filtered = filtered.filter((row) => row.project === project);
    if (qLower) {
      filtered = filtered.filter((row) =>
        (typeof row.theme === 'string' && row.theme.toLowerCase().includes(qLower)) ||
        (typeof row.summary === 'string' && row.summary.toLowerCase().includes(qLower))
      );
    }

    // Newest-first by date — matches SQLite `ORDER BY date DESC, created_at DESC`.
    filtered.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    const total = filtered.length;
    const data = filtered.slice(offset, offset + limit);

    res.json({
      data,
      total,
      limit,
      offset,
      _metadata: { fromColdStore: false, source: 'km-core' },
    });
  } catch (err) {
    process.stderr.write(`[obs-api] /api/coding/digests error: ${err.message}\n`);
    res.status(500).json({ error: 'Failed to query digests' });
  }
});

// /api/coding/insights — replaces SQLite /api/insights.
// Query params preserved: topic, q, project, includeArchived, limit, offset.
// The legacy handler returned `{data, total}` (no limit/offset because
// insights are scarce); we keep the same envelope but include limit+offset
// to match the Pitfall 2 typed-view contract that Plan 02's test asserts.
app.get('/api/coding/insights', async (_req, res) => {
  try {
    if (!_kmStoreReady || !_kmStore) {
      return res.status(503).json({ error: 'Knowledge graph store not ready' });
    }
    const req = _req;
    const { topic, q, project, includeArchived } = req.query;
    const { limit, offset } = parseLimitOffset(req);

    const entities = await collectByOntologyClass('Insight');
    // For insights we also need access to the underlying metadata.archivedAt
    // (legacy behaviour: archived insights are hidden by default). The
    // reshaper drops metadata, so we keep a parallel array of the original
    // entities and zip the archive flag onto each row before filtering.
    const reshaped = entities.map((entity) => {
      const legacy = insightToLegacy(entity);
      const m = (entity.metadata ?? {});
      return { legacy, archivedAt: m.archivedAt ?? null };
    });

    const qLower = q ? String(q).toLowerCase() : null;
    let filtered = reshaped;
    if (includeArchived !== 'true') {
      filtered = filtered.filter((row) => row.archivedAt === null || row.archivedAt === undefined);
    }
    if (topic) filtered = filtered.filter((row) => row.legacy.topic === topic);
    if (project) filtered = filtered.filter((row) => row.legacy.project === project);
    if (qLower) {
      filtered = filtered.filter((row) =>
        (typeof row.legacy.topic === 'string' && row.legacy.topic.toLowerCase().includes(qLower)) ||
        (typeof row.legacy.summary === 'string' && row.legacy.summary.toLowerCase().includes(qLower))
      );
    }

    // Sort by confidence DESC, then last_updated DESC — matches SQLite.
    filtered.sort((a, b) => {
      const c = (b.legacy.confidence ?? 0) - (a.legacy.confidence ?? 0);
      if (c !== 0) return c;
      return (b.legacy.last_updated ?? '').localeCompare(a.legacy.last_updated ?? '');
    });
    const total = filtered.length;
    const data = filtered.slice(offset, offset + limit).map((row) => row.legacy);

    res.json({
      data,
      total,
      limit,
      offset,
      _metadata: { fromColdStore: false, source: 'km-core' },
    });
  } catch (err) {
    process.stderr.write(`[obs-api] /api/coding/insights error: ${err.message}\n`);
    res.status(500).json({ error: 'Failed to query insights' });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  process.stderr.write(`[obs-api] listening on http://0.0.0.0:${PORT} (db: ${DB_PATH})\n`);
  // Warm the writer first (opens DB rw + FTS triggers + WAL), then warm
  // retrieval (fastembed model + Qdrant client) so the first POST /retrieve
  // doesn't pay a multi-second cold start.
  ensureWriter()
    .then(() => { ensureRetrieval(); ensurePruner(); })
    .catch((err) => {
      process.stderr.write(`[obs-api] startup init failed: ${err.message}\n`);
    });
  // Warm km-core store (independent of SQLite writer)
  ensureKMStore()
    .then((store) => { if (store) mountKMRoutes(store); })
    .catch((err) => {
      process.stderr.write(`[obs-api] km-core mount failed: ${err.message}\n`);
    });
});

async function shutdown(signal) {
  // Include ppid so the next investigator can identify the SIGTERM sender —
  // this codebase has at least three places that can kill obs_api
  // (process-state-manager, health-remediation-actions, ETM-driven cleanups)
  // and the source of any given kill has historically been a guessing game.
  process.stderr.write(`[obs-api] ${signal} — shutting down (pid=${process.pid}, ppid=${process.ppid})\n`);
  _shuttingDown = true;
  // Wait briefly for in-flight consolidation to drain. Bound the wait so a
  // wedged LLM call can't outlast the supervisor's SIGKILL grace. We give
  // the consolidator 10s to finish its current chunk gracefully; if it's
  // still running after that, we abort the LLM HTTP call so the proxy
  // tears down its spawned claude CLI subprocess. Then wait up to 10 more
  // seconds for the consolidator promise itself to settle.
  if (_consolidationPromise) {
    process.stderr.write(`[obs-api] waiting up to 10s for in-flight consolidation to drain naturally\n`);
    const gracefulDrain = await Promise.race([
      _consolidationPromise.catch(() => 'errored').then(() => 'done'),
      new Promise((r) => setTimeout(() => r('timeout'), 10_000)),
    ]);
    if (gracefulDrain === 'timeout' && _consolidationAbort) {
      process.stderr.write(`[obs-api] graceful drain timed out — aborting LLM HTTP calls to reap orphan CLI children\n`);
      _consolidationAbort.abort(new Error('obs-api shutting down'));
      await Promise.race([
        _consolidationPromise.catch(() => { /* surfaced in handler */ }),
        new Promise((r) => setTimeout(r, 10_000)),
      ]);
    }
  }
  if (_pruneInterval) { clearInterval(_pruneInterval); _pruneInterval = null; }
  _clearHeartbeat();
  server.close(async () => {
    if (_writer) {
      try { await _writer.close?.(); } catch { /* best effort */ }
    }
    // SIGKILL ourselves to skip Node's native destructor teardown.
    // process.exit(0) triggers the fastembed C++ cleanup path which hits a
    // libc++ mutex bug ("mutex lock failed: Invalid argument") and crashes
    // with a non-zero exit code.  SIGKILL bypasses all destructors cleanly.
    process.kill(process.pid, 'SIGKILL');
  });
  // Hard exit if graceful shutdown stalls
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 25_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Phase 35 plan 35-04 - re-export merge helpers for any caller that imports the
// obs-api server module directly (back-compat with the original plan contract).
export { _mergeObservations, _mergeDigests, _computeRetentionBoundary };
