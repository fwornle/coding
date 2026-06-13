#!/usr/bin/env node
/**
 * observations-api-server — Host-side HTTP gateway for the km-core knowledge store.
 *
 * Single-owner pattern (mirrors OKB/VKB): this process owns the on-disk km-core
 * GraphKMStore and the dashboard (in coding-services container) and any other
 * client reaches it via HTTP at host.docker.internal:12436. Plan 44-18 finalized
 * the km-core cutover: the legacy SQLite file at .observations/ is no longer
 * read or written by any production code path — see .planning/phases/
 * 44-rest-api-git-snapshots/44-18-AUDIT.md for the migration history.
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
import { ObservationWriter, subscribeObservationWritten } from '../src/live-logging/ObservationWriter.js';
import { ObservationConsolidator } from '../src/live-logging/ObservationConsolidator.js';
import { RetrievalService } from '../src/retrieval/retrieval-service.js';
import { ObservationPruner } from '../src/live-logging/ObservationPruner.js';
import { ColdStoreReader } from '../src/live-logging/ColdStoreReader.js';
import { ObservationExporter } from '../src/live-logging/ObservationExporter.js';
// Plan 44-18 — the legacy SQLite handle is gone. ObservationPruner cut to
// km-core in Plan 44-18 Task 2 (no more direct SQLite reads). RetrievalService
// freshness-rerank cut to km-core in Plan 44-18 Task 3. KeywordSearch (FTS5
// over the legacy SQLite file) loses its handle here and degrades silently
// to [] until that path is also cut to km-core; semantic search via Qdrant
// continues to dominate /api/retrieve responses.
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
  SnapshotManager,
} from '@fwornle/km-core';
import { Router } from 'express';
// Phase 44 Plan 14 — shared Artifacts-patch mutator used by both
// `/patch-artifacts/recent` and `/patch-artifacts/historical`. Single
// source of truth for the regex + meta merge.
import { patchArtifactsInPlace } from './lib/artifacts-patch-util.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.OBSERVATIONS_API_PORT || '12436', 10);
// Heartbeat path stays under `.observations/` (a sibling of the now-archived
// SQLite file) — directory is preserved post-archive for consolidation
// heartbeat + config.json. Derived directly from REPO_ROOT now that the
// `DB_PATH` constant has been removed (Plan 44-18 Task 5 cleanup commit).
const HEARTBEAT_PATH = path.join(REPO_ROOT, '.observations', 'consolidation-heartbeat.json');

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

// Plan 44-18 Task 5 — the legacy SQLite file `.observations/observations.db`
// has been archived to `.observations/observations.db.archived.2026-06-05`.
// No production code path in this process opens that file anymore: the writer
// is km-core-native (Plan 44-13), the consolidator + insights re-synth are
// km-core-native (Plan 44-17), and pruner + retrieval freshness-rerank are
// km-core-native (Plan 44-18 Tasks 2-3). The `DB_PATH` constant was dropped
// from this file in the Task 5 cleanup commit; ObservationWriter and
// ObservationConsolidator are constructed without an explicit `dbPath` — their
// internal defaults resolve correctly from cwd=REPO_ROOT (launchd cwd, see
// `com.coding.obs-api.plist`) and the path string is only used by those
// classes to derive `projectRoot` for the redactor config lookup. Nothing in
// this process reads or writes the archived SQLite file.

async function ensureWriter() {
  // Phase 44 Plan 14 — readiness predicate switched from `_writer.db`
  // (SQLite handle truthiness, was the only authority before Plan 14)
  // to `_writer._kmStore` (km-core handle truthiness, the canonical
  // write path after Plan 12). Re-entry shares the in-flight init
  // promise so two simultaneous requests don't construct two writers.
  if (_writer && _writer._kmStore) return _writer;
  if (_writerInit) return _writerInit;
  _writerInit = (async () => {
    // Phase 44 Plan 12: share the km-core store between the writer and the
    // typed-view handlers. obs-api opens the store FIRST so the writer
    // doesn't lazy-init a second one (which would compete for the LevelDB
    // LOCK and silently lose writes). Single source of truth — both
    // /api/coding/* reads and the live writer share one GraphKMStore
    // instance.
    const kmStore = await ensureKMStore();
    // Plan 44-18 Task 5 — `dbPath` arg omitted; ObservationWriter defaults to
    // `.observations/observations.db` (now archived) only to derive the
    // redactor's `projectRoot`. The file is never opened.
    const w = new ObservationWriter({ kmStore });
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

// Retrieval service runs in this process (Phase 5: container has zero
// access to the host data store). Qdrant is reachable via localhost:6333
// (port-mapped from coding-qdrant container).
let _retrieval = null;
function ensureRetrieval() {
  if (_retrieval) return _retrieval;
  if (!process.env.QDRANT_URL) {
    process.env.QDRANT_URL = 'http://localhost:6333';
  }
  // Plan 44-18 (Task 4) — retrieval reads insight metadata exclusively
  // through km-core (`kmStoreGetter`). The `dbGetter` is gone with the rest
  // of the legacy plumbing; KeywordSearch.search() receives `null` and the
  // _keywordSearch helper short-circuits to [] (graceful degradation —
  // already the catch in the helper). Semantic search via Qdrant continues
  // to dominate the /api/retrieve response.
  _retrieval = new RetrievalService({
    kmStoreGetter: () => (_kmStoreReady ? _kmStore : null),
  });
  // Eager init warms fastembed; fire-and-forget so startup isn't blocked.
  _retrieval.initialize().catch((err) => {
    process.stderr.write(`[obs-api] retrieval init failed (lazy retry on first request): ${err.message}\n`);
  });
  return _retrieval;
}

// Phase 35 plan 35-04 - pruner factory + 1h interval scheduler.
// The pruner is constructed lazily after ensureWriter resolves (so the
// writer's `retentionDays` is computed from its config-load). First prune
// fires immediately on boot so an already-oversized graph shrinks without a 1h
// wait. Errors are logged to stderr but never thrown - obs-api boot must
// remain crash-free even if the pruner cannot run.
//
// Phase 44 Plan 18: pruner reads + deletes through km-core exclusively
// (no more SQLite handle). `prune()` is async — `Promise.resolve().then`
// wraps the call so the synchronous caller path stays unchanged while
// errors still flow to the catch.
async function ensurePruner() {
  if (_pruner) return _pruner;
  if (!_writer || !_writer.retentionDays) return null;
  const kmStore = await ensureKMStore();
  if (!kmStore) return null;
  _pruner = new ObservationPruner({ kmStore, retentionDays: _writer.retentionDays });
  try {
    const r = await _pruner.prune();
    process.stderr.write(`[obs-api] initial prune: ${JSON.stringify(r)}\n`);
  } catch (err) {
    process.stderr.write(`[obs-api] initial prune failed: ${err.message}\n`);
  }
  _pruneInterval = setInterval(() => {
    Promise.resolve()
      .then(() => _pruner.prune())
      .catch((err) => {
        process.stderr.write(`[obs-api] periodic prune failed: ${err.message}\n`);
      });
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

// 2026-06-12: km-core-backed ObservationExporter wiring. Plan 44-18 archived
// the legacy SQLite file but left the exporter pointed at it, so the cold
// store at .data/observation-export/ froze on Jun 5 and the dashboard's
// /api/coding/observations view fell ~7 days behind km-core. The fix is in
// ObservationExporter.js (now reads via `kmStore.graph`); this wires a
// debounced trigger on each successful write so the cold store stays fresh.
//
// Cadence: 30s debounce — coalesces bursts (e.g. a sweep flushing 40
// observations in 5 seconds runs the exporter exactly once instead of 40
// times). Errors are best-effort and logged; nothing in the write hot path
// is blocked.
let _exporter = null;
let _exportTimer = null;
const EXPORT_DEBOUNCE_MS = 30_000;
function ensureExporter() {
  if (_exporter) return _exporter;
  if (!_kmStoreReady || !_kmStore) return null;
  _exporter = new ObservationExporter({
    kmStore: _kmStore,
    projectRoot: REPO_ROOT,
  });
  return _exporter;
}
function scheduleExport() {
  if (_exportTimer) return;
  _exportTimer = setTimeout(() => {
    _exportTimer = null;
    const exporter = ensureExporter();
    if (!exporter) return;
    try {
      exporter.exportAll();
    } catch (err) {
      process.stderr.write(`[obs-api] ObservationExporter.exportAll failed: ${err.message}\n`);
    }
  }, EXPORT_DEBOUNCE_MS);
  _exportTimer.unref?.();
}

// Phase 44 Plan 14: `getDb()` / `invalidateDb()` / `isCorruptionError()`
// REMOVED. Pre-Plan-14 these wrapped the SQLite handle for the legacy
// /api/observations + /api/digests + /api/insights + /api/projects +
// dashboard COUNT endpoints; all of those endpoints now route through
// km-core via `ensureKMStore()`. The two surviving consolidation handlers
// (/api/consolidation/run + /api/consolidation/status pipeline-stats
// path) construct their own ObservationConsolidator on-demand which
// opens its own SQLite handle — independent of the writer. The
// SQLite-corruption-recovery code paths (was: `if (isCorruptionError(err))
// invalidateDb()`) are obsolete because km-core failures surface as
// JS exceptions with completely different messages; the catch-all
// `res.status(500)` handler suffices.

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
// The consolidator runs IN-PROCESS here (single-owner pattern). Plan 44-17
// cut its persistence path to km-core; before that it opened its own
// better-sqlite3 connection. The single-owner pattern survives the cutover:
// km-core's GraphKMStore is shared between writer + consolidator + retrieval
// via `ensureKMStore()` so all three see the same in-memory graph and
// LevelDB-backed persistence.

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

// Phase 44 Plan 14 fix: cache the pipeline-stats consolidator at module scope
// so the dashboard's polling of /api/consolidation/status (default ~10s)
// doesn't construct a fresh consolidator + open a fresh SQLite handle on
// every call. Per-request construction caused ~360 `[Consolidator] Database
// initialized` log lines/hour without any resource leak (handles were closed
// in finally), just noise. Deferred-to-44-15 scope is unchanged: the
// consolidator still owns its own SQLite handle; only the obs-api caching
// strategy moves.
let _pipelineStatsConsolidator = null;
let _pipelineStatsConsolidatorInit = null;
let _heartbeatInterval = null;
let _lastStderrLine = '';
let _lastStderrAt = null;
// Abort controller for any in-flight LLM HTTP call the consolidator makes.
// Aborted in shutdown() so the proxy can kill its spawned claude CLI children
// instead of leaving them orphaned past obs-api's exit.
let _consolidationAbort = null;
let _shuttingDown = false;

// ── Phase 44 Plan 14 (T-44-14-06) — staleness-timestamp cache ─────────────
//
// The three staleness timestamps (lastObservationAt/lastDigestAt/
// lastInsightAt) drive the dashboard's [📚] statusline badge and are
// polled at the same cadence as /api/consolidation/status (~5s). Without
// caching, each poll would O(N)-scan all entities of each class. The cache
// is per-process, 5s TTL, manually invalidated on writer publish so a
// fresh ETM observation surfaces within one poll cycle.
//
// Acceptance gate (T-44-14-06 mitigation): dashboard statusline stays
// GREEN through 100 consecutive /api/consolidation/status polls.
const STALENESS_TTL_MS = 5_000;
const _stalenessCache = {
  ts: 0,
  value: null,  // { lastObservationAt, lastDigestAt, lastInsightAt }
  invalidate() {
    this.ts = 0;
    this.value = null;
  },
  async get(store) {
    const now = Date.now();
    if (this.value && now - this.ts < STALENESS_TTL_MS) return this.value;
    const [lastObservationAt, lastDigestAt, lastInsightAt] = await Promise.all([
      store.lastModifiedByClass('Observation'),
      store.lastModifiedByClass('Digest'),
      store.lastModifiedByClass('Insight'),
    ]);
    this.value = { lastObservationAt, lastDigestAt, lastInsightAt };
    this.ts = now;
    return this.value;
  },
};

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
    // Phase 44 Plan 17: consolidator is km-core-native. Share obs-api's
    // GraphKMStore instance so reads + writes go through the same store
    // the writer + typed-view handlers use (single-owner pattern from
    // ObservationWriter Plan 44-13).
    const kmStore = await ensureKMStore();
    // Plan 44-18 Task 5 — `dbPath` arg omitted; ObservationConsolidator
    // defaults to `.observations/observations.db` (now archived) only to
    // derive `projectRoot`. The file is never opened.
    const consolidator = new ObservationConsolidator({
      abortSignal: _consolidationAbort.signal,
      kmStore,
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
  // Phase 44 Plan 14 — readiness switched from `_writer.db` (SQLite
  // handle) to `_writer._kmStore` (km-core handle, canonical write path).
  // Plan 44-18 Task 5 — `dbPath` + `dbExists` fields dropped: the legacy
  // SQLite file has been archived to `.observations/observations.db.archived.2026-06-05`
  // and is no longer the runtime store. Health now reports km-core readiness
  // only. The dashboard's health view consumes `status`/`role`.
  res.json({
    status: _writer && _writer._kmStore ? 'ok' : 'starting',
    port: PORT,
    role: 'single-owner-rw',
  });
});

app.get('/ready', (_req, res) => {
  // Phase 44 Plan 14 — same readiness predicate as /health.
  if (!_writer || !_writer._kmStore) return res.status(503).json({ ready: false });
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
    // Phase 44 Plan 14: a fresh write invalidates the staleness cache so
    // the next /api/consolidation/status poll surfaces the new
    // lastObservationAt within ~5s (T-44-14-06 SLA).
    _stalenessCache.invalidate();
    res.json(result);
  } catch (err) {
    process.stderr.write(`[obs-api] /observations/messages error: ${err.message}\n`);
    res.status(500).json({ error: err.message || 'Failed to process messages' });
  }
});

/**
 * POST /api/observations/patch-artifacts/recent — backfill artifacts on
 * recent observations whose summary still says "Artifacts: none".
 * Body: { agent: string, modifiedFiles: string[] }
 *
 * Phase 44 Plan 14 — cut over from SQLite SELECT+UPDATE to km-core
 * findByOntologyClass + per-entity predicate + putEntity replay. Scope
 * is `agent === req.body.agent && properties.summary matches "Artifacts:
 * none" && properties.createdAt > fourHoursAgoISO`, sorted DESC by
 * createdAt, limited to 10. Shared `patchArtifactsInPlace` from
 * scripts/lib/artifacts-patch-util.mjs handles the mutation; the entity
 * is replayed via `kmStore.putEntity(mutated, { skipOntologyCheck: true })`
 * which preserves id + legacyId + createdAt + provenance verbatim
 * (trusted-path bulk semantics).
 */
app.post('/api/observations/patch-artifacts/recent', async (req, res) => {
  try {
    const { agent, modifiedFiles } = req.body || {};
    if (!agent || !Array.isArray(modifiedFiles) || modifiedFiles.length === 0) {
      return res.status(400).json({ error: 'agent and non-empty modifiedFiles required' });
    }
    const store = await ensureKMStore();
    if (!store) return res.status(503).json({ error: 'Knowledge graph store not ready' });

    const fourHoursAgoISO = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const candidates = await store.findByOntologyClass('Observation');
    const filtered = candidates.filter((e) => {
      if ((e.metadata?.agent ?? null) !== agent) return false;
      const summary = typeof e.metadata?.summary === 'string'
        ? e.metadata.summary
        : (typeof e.description === 'string' ? e.description : '');
      if (!/Artifacts:\s*none/i.test(summary)) return false;
      const createdAt = typeof e.createdAt === 'string' ? e.createdAt : '';
      return createdAt > fourHoursAgoISO;
    });
    // ORDER BY created_at DESC LIMIT 10 — preserve the legacy contract.
    filtered.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    const targets = filtered.slice(0, 10);

    let patched = 0;
    for (const entity of targets) {
      if (patchArtifactsInPlace(entity, modifiedFiles)) {
        await store.putEntity(entity, { skipOntologyCheck: true });
        patched += 1;
      }
    }
    // Writer publish would invalidate the staleness cache; this is a
    // backfill (not a new write) so we explicitly bump too — the
    // dashboard staleness clock should reflect the patch.
    _stalenessCache.invalidate();
    res.json({ patched });
  } catch (err) {
    process.stderr.write(`[obs-api] /patch-artifacts/recent error: ${err.message}\n`);
    res.status(500).json({ error: err.message || 'Failed to patch recent artifacts' });
  }
});

/**
 * POST /api/observations/patch-artifacts/historical — one-time pass over
 * up to 500 historical rows: if metadata has modifiedFiles but summary
 * still says "Artifacts: none", fix the summary in place.
 *
 * Phase 44 Plan 14 — cut over from SQLite SELECT+UPDATE to km-core
 * findByOntologyClass + per-entity predicate + per-entity
 * patchArtifactsInPlace + putEntity replay. Each entity's
 * `metadata.modifiedFiles` is the source of truth for the patched files;
 * empty/missing modifiedFiles short-circuits per-entity (the util
 * returns false). T-44-14-02 mitigation: limit 500 + per-entity work
 * bounded; full historical scan completes well within the 2s budget on
 * this machine at the current ~4k-observation scale.
 */
app.post('/api/observations/patch-artifacts/historical', async (_req, res) => {
  try {
    const store = await ensureKMStore();
    if (!store) return res.status(503).json({ error: 'Knowledge graph store not ready' });

    const candidates = await store.findByOntologyClass('Observation');
    const filtered = candidates.filter((e) => {
      const summary = typeof e.metadata?.summary === 'string'
        ? e.metadata.summary
        : (typeof e.description === 'string' ? e.description : '');
      if (!/Artifacts:\s*none/i.test(summary)) return false;
      const mf = e.metadata?.modifiedFiles;
      return Array.isArray(mf) && mf.length > 0;
    });
    filtered.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    const targets = filtered.slice(0, 500);

    let patched = 0;
    for (const entity of targets) {
      const mf = Array.isArray(entity.metadata?.modifiedFiles)
        ? entity.metadata.modifiedFiles
        : [];
      if (patchArtifactsInPlace(entity, mf)) {
        await store.putEntity(entity, { skipOntologyCheck: true });
        patched += 1;
      }
    }
    _stalenessCache.invalidate();
    res.json({ patched, scanned: targets.length });
  } catch (err) {
    process.stderr.write(`[obs-api] /patch-artifacts/historical error: ${err.message}\n`);
    res.status(500).json({ error: err.message || 'Failed to patch historical artifacts' });
  }
});

// Phase 44 plan 07 (R-4 hard cutover): the legacy SQLite-backed GET
// /api/observations was REPLACED by /api/coding/observations (mounted
// later in this file). There is no legacy URL fallback per CONTEXT R-4 —
// requests to the old path return 404 from Express's default handler.

// Phase 44 Plan 14 — projects-distinct endpoints cut over from SQLite to
// km-core. Each endpoint iterates findByOntologyClass(class), projects
// the per-entity `metadata.project` (with `properties.metadata.project`
// fallback for legacy shapes), dedupes via Set, and returns sorted.
// Empty-class behavior: findByOntologyClass returns []; the resulting
// JSON is `[]` (matches the prior SQLite handler's `digests LIMIT 0`
// empty-table guard, naturally).

function _extractProject(entity) {
  // Both placement variants survive in production: `metadata.project`
  // (canonical, mirrors legacy-ingest.ts:266) and the row-level
  // `properties.metadata.project` (legacy backfilled rows). Prefer the
  // canonical placement; fall back to the legacy one.
  const m = entity?.metadata ?? {};
  if (typeof m.project === 'string' && m.project.length > 0) return m.project;
  const nested = m.metadata && typeof m.metadata === 'object' ? m.metadata.project : null;
  if (typeof nested === 'string' && nested.length > 0) return nested;
  return null;
}

app.get('/api/observations/projects', async (_req, res) => {
  try {
    const store = await ensureKMStore();
    if (!store) return res.status(503).json({ error: 'Knowledge graph store not ready' });
    const entities = await store.findByOntologyClass('Observation');
    const projects = new Set();
    for (const e of entities) {
      const p = _extractProject(e);
      if (p) projects.add(p);
    }
    res.json([...projects].sort());
  } catch (err) {
    process.stderr.write(`[obs-api] /observations/projects error: ${err.message}\n`);
    res.status(500).json({ error: 'Failed to query projects' });
  }
});

// Phase 44 plan 07 (R-4 hard cutover): the legacy SQLite-backed GET
// /api/digests was REPLACED by /api/coding/digests. Requests to the old
// path return 404.

app.get('/api/digests/projects', async (_req, res) => {
  try {
    const store = await ensureKMStore();
    if (!store) return res.status(503).json({ error: 'Knowledge graph store not ready' });
    const entities = await store.findByOntologyClass('Digest');
    const projects = new Set();
    for (const e of entities) {
      const p = _extractProject(e);
      if (p) projects.add(p);
    }
    res.json([...projects].sort());
  } catch (err) {
    process.stderr.write(`[obs-api] /digests/projects error: ${err.message}\n`);
    res.status(500).json({ error: 'Failed to query digest projects' });
  }
});

// Phase 44 plan 07 (R-4 hard cutover): the legacy SQLite-backed GET
// /api/insights was REPLACED by /api/coding/insights. Requests to the
// old path return 404.

app.get('/api/insights/projects', async (_req, res) => {
  try {
    const store = await ensureKMStore();
    if (!store) return res.status(503).json({ error: 'Knowledge graph store not ready' });
    const entities = await store.findByOntologyClass('Insight');
    const projects = new Set();
    for (const e of entities) {
      const p = _extractProject(e);
      if (p) projects.add(p);
    }
    res.json([...projects].sort());
  } catch (err) {
    process.stderr.write(`[obs-api] /insights/projects error: ${err.message}\n`);
    res.status(500).json({ error: 'Failed to query insight projects' });
  }
});

app.get('/api/projects', async (_req, res) => {
  try {
    const store = await ensureKMStore();
    if (!store) return res.status(503).json({ error: 'Knowledge graph store not ready' });
    // Parallel scan — three findByOntologyClass calls in flight at once.
    // The aggregation is union-dedup across all three classes.
    const [obs, digs, ins] = await Promise.all([
      store.findByOntologyClass('Observation'),
      store.findByOntologyClass('Digest'),
      store.findByOntologyClass('Insight'),
    ]);
    const all = new Set();
    for (const list of [obs, digs, ins]) {
      for (const e of list) {
        const p = _extractProject(e);
        if (p) all.add(p);
      }
    }
    res.json([...all].sort());
  } catch (err) {
    process.stderr.write(`[obs-api] /projects error: ${err.message}\n`);
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
  // sketcher: React+VLM whiteboard-image analyzer (`_work/sketcher`).
  // Taxonomy intentionally left undefined until real sketcher insights
  // are synthesized — earlier draft included generic Teams/Tmux
  // components from mislabeled insights that have since been
  // reclassified to their correct projects.
  'onboarding-repro': [
    { name: 'BrandschutzAgent', aliases: ['brandschutz', 'articulate rise', 'fire safety', 'brandschutz-agent'] },
  ],
  daFrankTeam: [
    { name: 'HackathonGame', aliases: ['kraken', 'browser game', 'hackathon', 'spa'] },
  ],
  'ai-transformation-day-hackathon': [
    { name: 'AIKrakenSPA', aliases: ['kraken', 'spa', 'information hub', 'skills marketplace'] },
  ],
};

app.get('/api/projects/:project/coverage', async (req, res) => {
  const { project } = req.params;
  if (!project) return res.status(400).json({ error: 'project required' });
  try {
    const store = await ensureKMStore();
    if (!store) return res.status(503).json({ error: 'Knowledge graph store not ready' });

    // Phase 44 Plan 14 — read source moved from SQLite to km-core. The
    // ratio buckets, taxonomy-match componentsMentioned/Missing math,
    // and perInsight payload shape are UNCHANGED — only the row source
    // moves. legacy-ingest.ts:340-362 stamps topic/summary/confidence/
    // digest_ids/last_updated/project into entity.metadata, so the
    // existing field-extraction code reads from there with no shape
    // drift. Auto-archived insights filtered out by the same
    // `metadata.archivedAt === null` predicate the SQLite handler used.
    const allInsights = await store.findByOntologyClass('Insight');
    const rows = allInsights
      .filter((e) => _extractProject(e) === project && !e.metadata?.archivedAt)
      // ORDER BY last_updated DESC — preserve legacy ordering.
      .sort((a, b) => {
        const al = a.metadata?.last_updated ?? a.updatedAt ?? '';
        const bl = b.metadata?.last_updated ?? b.updatedAt ?? '';
        return String(bl).localeCompare(String(al));
      })
      // Project to the legacy row shape the downstream computation expects.
      .map((e) => ({
        id: e.legacyId?.id ?? e.id,
        topic: e.metadata?.topic ?? e.name,
        confidence: typeof e.metadata?.confidence === 'number' ? e.metadata.confidence : 0.8,
        summary: e.metadata?.summary ?? e.description ?? '',
        digestIds: Array.isArray(e.metadata?.digest_ids) ? e.metadata.digest_ids : [],
        lastUpdated: e.metadata?.last_updated ?? e.updatedAt ?? null,
        createdAt: e.createdAt ?? null,
        project: _extractProject(e),
        metadata: e.metadata ?? {},
      }));

    const perInsight = [];
    const allReferencedFiles = new Set();
    let fresh = 0, partial = 0, stale = 0, unverified = 0;
    let ratioSum = 0, ratioCount = 0;

    for (const r of rows) {
      const metadata = r.metadata && typeof r.metadata === 'object' ? r.metadata : {};
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

  // Phase 44 Plan 17: share obs-api's km-core store with the resynthesize
  // path (same single-owner pattern as the main consolidator).
  const kmStoreForResynth = await ensureKMStore();
  // Plan 44-18 Task 5 — `dbPath` arg omitted; see note above ensureWriter().
  const consolidator = new ObservationConsolidator({ kmStore: kmStoreForResynth });
  try {
    await consolidator.init();
    // Phase 44 Plan 14 — the dashboard projects `id: entity.legacyId?.id
    // ?? entity.id`. For insights created without a legacyId stamp, that
    // falls back to the km-core entity UUID. resynthesizeInsight() looks
    // up by `findByLegacyId({system:'A', id})`, so a km-core UUID lands
    // as a NOT_FOUND. Normalize by resolving the incoming id against
    // both indexes and rewriting it to the legacy id before delegating.
    let resolvedId = id;
    try {
      const store = await ensureKMStore();
      if (store) {
        const byLegacy = await store.findByLegacyId({ system: 'A', id });
        if (!byLegacy) {
          const byEntity = await store.getEntity(id);
          if (byEntity && byEntity.legacyId?.id) {
            resolvedId = byEntity.legacyId.id;
          } else if (byEntity) {
            // Entity exists but has no legacyId stamp — fall through and
            // let resynthesizeInsight raise NOT_FOUND so the caller sees a
            // clean error with the requested id, not a silent mismatch.
          }
        }
      }
    } catch { /* best-effort; resynthesizeInsight will surface NOT_FOUND */ }
    const updated = await consolidator.resynthesizeInsight(resolvedId);

    // Phase 44 Plan 14 Task 2(g) — mirror the resynthesized fields into
    // the km-core entity via findByLegacyId + putEntity replay. The
    // consolidator owns the LLM call + the SQLite UPDATE (deferred to
    // Plan 44-15); km-core is the canonical going-forward state. The
    // mirror keeps the dashboard read paths at /api/coding/insights in
    // sync with the new summary/topic/confidence/last_updated, while
    // preserving digest_ids + metadata.codeVerification verbatim
    // (T-44-14-03 mitigation: only the four resynthesized fields and
    // a fresh createdBy.runId mutate; everything else is preserved).
    try {
      const store = await ensureKMStore();
      if (store) {
        const entity = await store.findByLegacyId({ system: 'A', id: resolvedId })
          ?? await store.getEntity(resolvedId);
        if (entity) {
          // Mutate ONLY the resynthesized fields. createdBy.runId carries
          // the resynthesis-identifying stamp so downstream provenance
          // queries can distinguish a resynthesized payload from an
          // original synthesis.
          const newRunId = 'insight-resynthesize-' + Date.now();
          entity.metadata = {
            ...(entity.metadata ?? {}),
            summary: updated.summary,
            topic: updated.topic,
            confidence: updated.confidence,
            last_updated: updated.lastUpdated,
          };
          entity.description = updated.summary;
          entity.updatedAt = updated.lastUpdated || entity.updatedAt;
          entity.name = (updated.topic || entity.name || '').slice(0, 80) || entity.name;
          entity.createdBy = {
            ...(entity.createdBy ?? {}),
            provider: entity.createdBy?.provider ?? 'observation-writer',
            model: entity.createdBy?.model ?? 'live-pipeline',
            runId: newRunId,
            timestamp: new Date().toISOString(),
          };
          await store.putEntity(entity, { skipOntologyCheck: true });
          _stalenessCache.invalidate();
        }
      }
    } catch (mirrorErr) {
      // Mirror failure is non-fatal — the consolidator already wrote to
      // SQLite (the deferred source) and the response payload already
      // describes the result. Surface to stderr so the operator can
      // catch a systematic drift.
      process.stderr.write(`[obs-api] /insights/${id}/resynthesize km-core mirror failed: ${mirrorErr.message}\n`);
    }

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
    res.status(500).json({ error: `Re-synthesis failed: ${err.message}` });
  } finally {
    try { consolidator.close(); } catch { /* best-effort */ }
    _resynthesizeInflight = false;
  }
});

/**
 * POST /api/insights/verify
 *
 * Runs the code-claim verifier across every active insight in `project`
 * (defaults to "coding") and persists `metadata.codeVerification` on each
 * entity. Same code path the cadence-guarded pass inside `consolidator.run()`
 * uses, but exposed so the dashboard's Project Coverage tab can be
 * re-populated on demand after the data has been wiped or never
 * back-filled post-migration.
 *
 * Body: { project?: string, force?: boolean }
 *   - project: project slug (default "coding")
 *   - force:   ignored — this endpoint always runs (the cadence guard is
 *              the consolidator's, not the verifier's).
 *
 * Response: { scanned, freshCount, staleCount, unverifiableCount,
 *             avgRatio, durationMs }
 */
app.post('/api/insights/verify', async (req, res) => {
  if (_consolidationPromise) {
    return res.status(409).json({ error: 'Bulk consolidation in progress; try again when it completes' });
  }
  const project = (req.body && typeof req.body.project === 'string' && req.body.project) || 'coding';
  const startedAt = Date.now();
  const kmStore = await ensureKMStore();
  if (!kmStore) return res.status(503).json({ error: 'Knowledge graph store not ready' });
  // Plan 44-18 Task 5 — `dbPath` arg omitted; ObservationConsolidator
  // defaults to `.observations/observations.db` (now archived) only to
  // derive `projectRoot`. The file is never opened. We need init() so the
  // PII redactor is wired (verifyInsight calls _redact on staleClaims).
  const consolidator = new ObservationConsolidator({ kmStore });
  try {
    await consolidator.init();
    const result = await consolidator.verifyInsights({ project, persist: true });
    // Mark the cadence sentinel as done so the next consolidation pass
    // doesn't immediately re-run verification on top of what we just did.
    try { consolidator._markCadenceDone('last-verification', project); } catch { /* non-fatal */ }
    const durationMs = Date.now() - startedAt;
    process.stderr.write(
      `[obs-api] /insights/verify ${project}: ${result.scanned} scanned, ${result.freshCount} fresh, ${result.staleCount} stale, avg ratio ${result.avgRatio}, ${durationMs}ms\n`
    );
    res.json({
      project,
      scanned: result.scanned,
      freshCount: result.freshCount,
      staleCount: result.staleCount,
      unverifiableCount: result.unverifiableCount,
      avgRatio: result.avgRatio,
      durationMs,
    });
  } catch (err) {
    process.stderr.write(`[obs-api] /insights/verify error: ${err.message}\n`);
    res.status(500).json({ error: `Verification failed: ${err.message}` });
  } finally {
    try { consolidator.close(); } catch { /* best-effort */ }
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
  });
  res.status(202).json({
    success: true,
    accepted: true,
    attached,
    jobId: _lastConsolidationJobId,
    startedAt: _consolidationStartedAt,
  });
});

app.get('/api/consolidation/status', async (_req, res) => {
  try {
    const store = await ensureKMStore();
    if (!store) return res.status(503).json({ error: 'Knowledge graph store not ready' });

    // Phase 44 Plan 14 Task 2(g) — split COUNTs onto km-core
    // (countByOntologyClass) and the 3 staleness timestamps onto the
    // 5s-TTL cache wrapping lastModifiedByClass. The 4 consolidator-
    // pipeline stats (undigested / pendingPast / pendingToday /
    // lowQuality) STAY on the consolidator's own SQLite handle because
    // they depend on the `digested_at` column owned by the
    // consolidator's bookkeeping — deferred to Plan 44-15 (consolidator
    // cutover). Operator chose to keep payload shape identical so the
    // dashboard at :3032 + health-coordinator [📚] badge see no shape
    // drift.
    const [totalObs, totalDigests, totalInsights, staleness] = await Promise.all([
      store.countByOntologyClass('Observation'),
      store.countByOntologyClass('Digest'),
      store.countByOntologyClass('Insight'),
      _stalenessCache.get(store),
    ]);

    // Phase 44 Plan 17: pipeline stats now route through km-core's
    // countByOntologyClass instead of a cached SQLite-backed consolidator.
    // The `_pipelineStatsConsolidator` cache + close path below are dead
    // code post-cutover (left in place so the SIGTERM handler is a no-op
    // when null). km-core's GraphKMStore is a process-wide singleton
    // via `ensureKMStore()` — no per-call init cost.
    // Wrapped in try/catch with safe defaults so a missing km-core store
    // returns zeros instead of a 503.
    let undigested = 0;
    let pendingPast = 0;
    let pendingToday = 0;
    let lowQuality = 0;
    try {
      // Phase 44 Plan 17: pipeline-stats counts via km-core countByOntologyClass
      // (predicate form). The previous SQLite path used 4 indexed COUNT(*)
      // queries; km-core's countByOntologyClass scans the Observation class
      // once per call with a predicate filter. At ~4k entities the 4 calls
      // sum to a few ms — acceptable for a /consolidation/status response.
      const today = new Date().toISOString().split('T')[0];
      try {
        const kmStoreForStats = await ensureKMStore();
        const isUndigested = e => !(e.metadata?.digested_at);
        const isLow = e => e.metadata?.quality === 'low';
        const isNotLow = e => e.metadata?.quality !== 'low';
        const dayPrefix = e => (typeof e.metadata?.createdAt === 'string' ? e.metadata.createdAt.slice(0, 10) : '');
        [undigested, lowQuality, pendingPast, pendingToday] = await Promise.all([
          kmStoreForStats.countByOntologyClass('Observation', { predicate: e => isUndigested(e) && isNotLow(e) }),
          kmStoreForStats.countByOntologyClass('Observation', { predicate: e => isUndigested(e) && isLow(e) }),
          kmStoreForStats.countByOntologyClass('Observation', { predicate: e => isUndigested(e) && isNotLow(e) && dayPrefix(e) < today }),
          kmStoreForStats.countByOntologyClass('Observation', { predicate: e => isUndigested(e) && isNotLow(e) && dayPrefix(e) === today }),
        ]);
      } catch { /* km-core unavailable — leave counters at 0 */ }
    } catch (consolidatorErr) {
      // Consolidator init failure is non-fatal — the dashboard sees the
      // km-core counts + staleness clock; pipeline stats remain zero.
      // Plan 44-15 archives this path entirely.
      process.stderr.write(`[obs-api] /consolidation/status consolidator probe failed: ${consolidatorErr.message}\n`);
    }

    const inflight = readConsolidationHeartbeat();

    res.json({
      totalObs, undigested, lowQuality, pendingPast, pendingToday,
      digested: totalObs - undigested - lowQuality,
      totalDigests, totalInsights,
      lastObservationAt: staleness.lastObservationAt,
      lastDigestAt: staleness.lastDigestAt,
      lastInsightAt: staleness.lastInsightAt,
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
// Cached in-flight init promise — concurrent ensureKMStore() callers share
// one open() rather than the second caller getting back null. Plan 44-12
// (commit c2582c7e) added `ensureWriter → ensureKMStore` so the writer and
// the typed-view handlers share a store; on startup the listen handler then
// fires a second ensureKMStore() in parallel. The prior `if (_kmStore) return
// null` early-return resolved that second call to null, so mountKMRoutes()
// never ran and /api/v1/* came back 404 (Plan 44-11 verification finding).
let _kmStoreInit = null;

async function ensureKMStore() {
  if (_kmStore && _kmStoreReady) return _kmStore;
  if (_kmStoreInit) return _kmStoreInit;
  _kmStoreInit = (async () => {
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
      _kmStoreReady = false;
      return null;
    }
  })();
  try {
    return await _kmStoreInit;
  } finally {
    _kmStoreInit = null;
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
    // Phase 45 Plan 04 follow-up — wire the display-overlay loader. The
    // overlay file lives at `.data/ontologies/{system}.display.json`,
    // NOT at km-core's default `lib/km-core/ontology` dir — point the
    // handler explicitly at the operator-side data root.
    ontologyDir: path.join(process.cwd(), '.data', 'ontologies'),
    displayOverlaySystem: 'coding',
  });
  process.stderr.write(`[obs-api] km-core /api/v1 routes mounted\n`);
}

// ── Phase 55 Plan 06: composed /api/v1/stats endpoint ─────────────────────
//
// UI-SPEC §18 row 1 — the unified-viewer StatsBar consumes a single
// composed envelope rather than fanning out to /api/v1/graph/connectivity
// + /api/v1/graph/orphans + /api/v1/entities?count=true. Implementation
// composes the underlying km-core helpers (countByOntologyClass,
// lastModifiedByClass) with a degree-walk on the raw Graphology instance
// (graph.degree(node)) for orphans.  Wire-shape mirrors `OkbStats` from
// `_work/.../viewer/src/api/okbClient.ts:35-45` (Phase 55 PATTERNS lock).
//
// Active snapshot: walks `git tag -l 'snapshot/*' --sort=-creatordate` via
// the SnapshotManager.listSnapshots() helper — newest is the active head;
// null when no snapshot tags exist (fresh repo / first launch).
//
// Registered on kmRouter so the existing hydration gate (line ~1236)
// applies — 503 until the GraphKMStore has finished opening.
kmRouter.get('/stats', async (_req, res) => {
  try {
    const store = _kmStore;
    const graph = store.graph;
    const nodeCount = graph.order;
    const edgeCount = graph.size;

    const [evidenceCount, patternCount, componentCount] = await Promise.all([
      store.countByOntologyClass('Observation'),
      store.countByOntologyClass('Pattern'),
      store.countByOntologyClass('Component'),
    ]);

    // Orphan walk (mirrors /api/v1/graph/orphans handler logic but counts only).
    let orphanCount = 0;
    graph.forEachNode((id) => {
      if (graph.degree(id) === 0) orphanCount += 1;
    });
    // Connectivity is the inverse density of orphans against the node
    // population — 1.0 means every node touches at least one edge.
    const connectivity = nodeCount > 0
      ? 1 - (orphanCount / nodeCount)
      : 1;

    // lastUpdated: maximum createdAt across all known ontology classes.
    // Falls back to "now" on a completely empty store so the
    // unified-viewer StatsBar never renders a missing-field state.
    const observedClasses = ['Observation', 'Digest', 'Insight', 'Pattern', 'Component'];
    const lastUpdatedCandidates = await Promise.all(
      observedClasses.map((cls) => store.lastModifiedByClass(cls).catch(() => null)),
    );
    let lastUpdated = null;
    for (const ts of lastUpdatedCandidates) {
      if (typeof ts === 'string' && (lastUpdated === null || ts > lastUpdated)) {
        lastUpdated = ts;
      }
    }
    if (lastUpdated === null) lastUpdated = new Date().toISOString();

    // Active snapshot: newest entry from SnapshotManager.listSnapshots().
    // Returns null when no snapshot tags are present OR when the listing
    // throws (no git repo, etc.) — the unified-viewer StatsBar renders
    // "no snapshot" affordances in that case rather than a hard error.
    let activeSnapshot = null;
    try {
      const sm = new SnapshotManager({ exportDir: KG_EXPORT_DIR });
      const snapshots = await sm.listSnapshots();
      if (Array.isArray(snapshots) && snapshots.length > 0) {
        const head = snapshots[0];
        activeSnapshot = {
          hash: head.commit_sha,
          message: head.message,
          date: head.timestamp,
        };
      }
    } catch {
      // Fall through — activeSnapshot stays null.
    }

    res.json({
      success: true,
      data: {
        nodeCount,
        edgeCount,
        evidenceCount,
        patternCount,
        orphanCount,
        componentCount,
        connectivity,
        lastUpdated,
        activeSnapshot,
      },
    });
  } catch (err) {
    process.stderr.write(`[obs-api] /api/v1/stats error: ${err.message}\n`);
    res.status(500).json({ success: false, error: 'Failed to compute viewer stats' });
  }
});

// ── Phase 55 Plan 06: /api/v1/trends?top=N ────────────────────────────────
//
// Wire-shape per okbClient.ts:62-78 (TrendingPattern). Walks Pattern-class
// entities, scores by occurrenceCount * exp(-ageHours / TRENDS_HALFLIFE_H).
// occurrenceCount is read from `entity.metadata.occurrences.length` when
// the writer maintains an occurrences[] array; otherwise the Phase 39
// confirmationCount is the fallback (every confirmation == one occurrence).
//
// Returns sorted desc by trendScore, sliced to top (default 20, max 100 —
// upper cap per Plan-spec to bound the response shape).
const TRENDS_DEFAULT_TOP = 20;
const TRENDS_MAX_TOP = 100;
const TRENDS_HALFLIFE_HOURS = 720; // 30 days — exposed as a constant for tunability.

function computeTrendScore(entity, nowMs) {
  const meta = entity.metadata || {};
  const occurrences = Array.isArray(meta.occurrences) ? meta.occurrences : null;
  const occurrenceCount = occurrences
    ? occurrences.length
    : (meta.provenance?.confirmationCount ?? 1);
  // Age decay anchored at `createdAt`. The shorter half-life weights very
  // recent patterns higher; the 30-day default matches the OKB convention.
  const createdAtMs = Date.parse(entity.createdAt || '') || nowMs;
  const ageHours = Math.max(0, (nowMs - createdAtMs) / 3_600_000);
  const decay = Math.exp(-ageHours / TRENDS_HALFLIFE_HOURS);
  return occurrenceCount * decay;
}

function computeTrendBuckets(entity, nowMs) {
  // Phase 55 D-55-06 default — bucket counts read from
  // `entity.metadata.trends` when the writer maintains it; otherwise
  // collapse to a single "all entries land in the active window" stub
  // (occurrenceCount in last7Days; 0/0 for the longer windows). Frontend
  // already treats absent fields as 0 per okbClient.ts:62-78.
  const meta = entity.metadata || {};
  if (meta.trends && typeof meta.trends === 'object') {
    const t = meta.trends;
    return {
      last7Days: Number(t.last7Days ?? 0),
      last30Days: Number(t.last30Days ?? 0),
      last90Days: Number(t.last90Days ?? 0),
    };
  }
  const createdAtMs = Date.parse(entity.createdAt || '') || nowMs;
  const ageDays = (nowMs - createdAtMs) / 86_400_000;
  const occurrenceCount = Array.isArray(meta.occurrences)
    ? meta.occurrences.length
    : (meta.provenance?.confirmationCount ?? 1);
  return {
    last7Days: ageDays <= 7 ? occurrenceCount : 0,
    last30Days: ageDays <= 30 ? occurrenceCount : 0,
    last90Days: ageDays <= 90 ? occurrenceCount : 0,
  };
}

kmRouter.get('/trends', async (req, res) => {
  try {
    const rawTop = parseInt(req.query.top, 10);
    const top = Math.min(
      Math.max(Number.isFinite(rawTop) && rawTop > 0 ? rawTop : TRENDS_DEFAULT_TOP, 1),
      TRENDS_MAX_TOP,
    );
    const entities = await _kmStore.findByOntologyClass('Pattern');
    const nowMs = Date.now();
    const scored = entities.map((entity) => {
      const trendScore = computeTrendScore(entity, nowMs);
      return {
        nodeId: entity.id,
        entity: {
          id: entity.id,
          name: entity.name,
          entityType: entity.entityType,
          ...(entity.description ? { description: entity.description } : {}),
        },
        trendScore,
        trends: computeTrendBuckets(entity, nowMs),
      };
    });
    scored.sort((a, b) => b.trendScore - a.trendScore);
    const patterns = scored.slice(0, top);
    res.json({ success: true, data: { patterns } });
  } catch (err) {
    process.stderr.write(`[obs-api] /api/v1/trends error: ${err.message}\n`);
    res.status(500).json({ success: false, error: 'Failed to compute trends' });
  }
});

// ── Phase 55 Plan 06: /api/v1/entities/:id/confidence ─────────────────────
//
// Wire-shape per UI-SPEC §18 row 8 + plan <interfaces> block —
// `{overall, bands:{high,moderate,low}, segments[]}`. A 404 is returned
// for unknown ids; UI-SPEC §16 prescribes the frontend silently degrades
// to a client-side heuristic in that case (NOT a hard error banner).
//
// Overall score is averaged across `metadata.descriptionSegments[].confidence`
// when present. The Phase 39 fallback path (entities without per-segment
// confidence) collapses to 0.7 when there is at least one confirmation,
// otherwise 0.5 — matching the conservative default the okbClient
// fallback heuristic uses (NodeDetails.tsx:165-213).
function classifyConfidence(score) {
  if (score >= 0.8) return 'high';
  if (score >= 0.6) return 'moderate';
  return 'low';
}

kmRouter.get('/entities/:id/confidence', async (req, res) => {
  try {
    const id = req.params.id;
    let entity;
    try {
      entity = await _kmStore.getEntity(id);
    } catch {
      entity = undefined;
    }
    if (!entity) {
      return res.status(404).json({ success: false, error: 'not_found' });
    }
    const meta = entity.metadata || {};
    const segments = Array.isArray(meta.descriptionSegments) ? meta.descriptionSegments : [];
    let overall;
    if (segments.length > 0) {
      const sum = segments.reduce((acc, s) => acc + (Number.isFinite(s.confidence) ? s.confidence : 0.5), 0);
      overall = sum / segments.length;
    } else {
      const confirmations = meta.provenance?.confirmationCount ?? 0;
      overall = confirmations > 0 ? 0.7 : 0.5;
    }
    // Clamp to [0, 1] defensively — a bad segment value MUST NOT yield a
    // value outside the documented contract.
    overall = Math.max(0, Math.min(1, overall));

    // Band counts: how many segments land in each confidence bucket.
    // When there are no segments, all weight is on the overall band so
    // the StatsBar pill renders something predictable.
    const bands = { high: 0, moderate: 0, low: 0 };
    if (segments.length > 0) {
      for (const s of segments) {
        const c = Number.isFinite(s.confidence) ? Math.max(0, Math.min(1, s.confidence)) : 0.5;
        bands[classifyConfidence(c)] += 1;
      }
    } else {
      bands[classifyConfidence(overall)] = 1;
    }

    const segmentsOut = segments.map((s, idx) => {
      const c = Number.isFinite(s.confidence) ? Math.max(0, Math.min(1, s.confidence)) : 0.5;
      const out = {
        segmentId: typeof s.segmentId === 'string' && s.segmentId.length > 0
          ? s.segmentId
          : `seg-${idx}`,
        confidence: c,
      };
      if (typeof s.source === 'string') out.source = s.source;
      else if (typeof s.provider === 'string') out.source = s.provider;
      return out;
    });

    res.json({
      success: true,
      data: { overall, bands, segments: segmentsOut },
    });
  } catch (err) {
    process.stderr.write(`[obs-api] /api/v1/entities/:id/confidence error: ${err.message}\n`);
    res.status(500).json({ success: false, error: 'Failed to compute entity confidence' });
  }
});

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
//
// 2026-06-11 cutover: this endpoint used to call collectByOntologyClass(
// 'Observation') against km-core. We've separated the graph store (km-core,
// for the VKB/unified-viewer hierarchy) from the time-series event log
// (.data/observation-export/observations.json, written by ObservationExporter
// on every consolidator pass). Observations and Digests no longer live as
// graph nodes — they belong in the events list, read via ColdStoreReader.
// Insights stay in km-core because they ARE graph-worthy (long-lived synthesis
// of patterns across the codebase). See user request 2026-06-11:
//   "you need to separate the vkb viewer content (insights only) from the
//    tabs in the health monitoring board (observations, digests, insights)".
app.get('/api/coding/observations', async (_req, res) => {
  try {
    const req = _req;
    const { agent, project, from, to, q, quality } = req.query;
    const { limit, offset } = parseLimitOffset(req);

    const reader = ensureColdStore();
    // ColdStoreReader caps any single read at 366 days. The legacy contract
    // accepts open-ended `from`/`to`; map missing bounds to the last 365 days
    // (the longest window the reader will accept). Downstream filters still
    // narrow on `from`/`to` after the read, so the response respects what the
    // caller asked for. (2026-06-11 cutover.)
    const nowIso = new Date().toISOString();
    const yearAgoIso = new Date(Date.now() - 364 * 24 * 60 * 60 * 1000).toISOString();
    const readFrom = from || yearAgoIso;
    const readTo = to || nowIso;
    // ColdStoreReader returns JSON rows verbatim — shape:
    //   {id, summary, agent, project, quality, createdAt, digestedAt, llm, modifiedFiles}
    // Adapt to the legacy /api/coding/observations contract used by the
    // dashboard (Pitfall 2): keys are id, agent, project, content, timestamp,
    // quality, artifacts.
    const rows = reader.readObservations({ from: readFrom, to: readTo });
    const reshaped = rows.map((r) => ({
      id: r.id,
      agent: typeof r.agent === 'string' ? r.agent : 'unknown',
      project: typeof r.project === 'string' ? r.project : 'unknown',
      content: typeof r.summary === 'string' ? r.summary : '',
      artifacts: Array.isArray(r.modifiedFiles) ? r.modifiedFiles : [],
      timestamp: typeof r.createdAt === 'string' ? r.createdAt : '',
      quality: typeof r.quality === 'string' ? r.quality : 'normal',
    }));

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
      _metadata: { fromColdStore: true, source: 'observation-export' },
    });
  } catch (err) {
    process.stderr.write(`[obs-api] /api/coding/observations error: ${err.message}\n`);
    res.status(500).json({ error: 'Failed to query observations' });
  }
});

// /api/coding/digests — replaces SQLite /api/digests.
// Query params preserved: date, from, to, q, project, limit, offset.
//
// 2026-06-11 cutover: same separation as /api/coding/observations — Digests
// are time-series events (one per day per theme) and belong in the dashboard
// list, not as graph nodes. Read from .data/observation-export/digests.json
// via ColdStoreReader.
app.get('/api/coding/digests', async (_req, res) => {
  try {
    const req = _req;
    const { date, from, to, q, project } = req.query;
    const { limit, offset } = parseLimitOffset(req);

    const reader = ensureColdStore();
    // Same 365-day window as /api/coding/observations — see that handler for
    // rationale.
    const nowDateStr = new Date().toISOString().slice(0, 10);
    const yearAgoStr = new Date(Date.now() - 364 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const readFrom = from || yearAgoStr;
    const readTo = to || nowDateStr;
    // Digest JSON shape from ObservationExporter:
    //   {id, date, theme, summary, observation_ids[], agents[], files_touched[],
    //    quality, created_at, project}
    // Adapt to the legacy contract used by the dashboard.
    const rows = reader.readDigests({ from: readFrom, to: readTo });
    const reshaped = rows.map((r) => ({
      id: r.id,
      date: r.date,
      theme: typeof r.theme === 'string' ? r.theme : '',
      summary: typeof r.summary === 'string' ? r.summary : '',
      // Prefer the first NON-EMPTY array among the three legal carriers.
      // Pre-fix-7ab1f9cd8 exports stored only the nested `metadata.observation_ids`;
      // those rows are now ghosts in digests.json whose top-level field is
      // [] but whose metadata still has the original link list. Falling
      // back to metadata.observation_ids prevents the dashboard from
      // rendering them as "0 obs" while the eviction script catches up.
      observationIds: (
        (Array.isArray(r.observation_ids) && r.observation_ids.length > 0 ? r.observation_ids : null)
        ?? (Array.isArray(r.observationIds) && r.observationIds.length > 0 ? r.observationIds : null)
        ?? (r.metadata && Array.isArray(r.metadata.observation_ids) ? r.metadata.observation_ids : [])
      ),
      agents: Array.isArray(r.agents) ? r.agents : [],
      filesTouched: Array.isArray(r.files_touched) ? r.files_touched : (Array.isArray(r.filesTouched) ? r.filesTouched : []),
      quality: typeof r.quality === 'string' ? r.quality : 'normal',
      createdAt: r.created_at || r.createdAt || '',
      project: typeof r.project === 'string' ? r.project : 'unknown',
    }));

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
      _metadata: { fromColdStore: true, source: 'observation-export' },
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

// ── 2026-06-11: SSE /api/v1/stream ────────────────────────────────────────
//
// The unified-viewer's StatsBar opens an EventSource against
// `${apiClient.base}/api/v1/stream` to receive live km-core stats. Until
// today the endpoint didn't exist on obs-api, so the viewer's console
// spammed `GET /api/v1/stream 404 (Not Found)` + `[API] [WARN] StatsBar
// SSE connection dropped (attempt #N)` once per backoff retry forever.
//
// Lightweight implementation: every 10s we emit a `data: <stats>\n\n`
// frame computed from km-core via the same `/api/v1/stats` handler.
// `req.on('close')` clears the interval so we don't leak.
app.get('/api/v1/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const emit = async () => {
    try {
      if (!_kmStoreReady || !_kmStore) return;
      // Reuse the same shape that /api/v1/stats returns so StatsBar's
      // parser (which tolerates both `{success,data}` envelope and the
      // bare ViewerStats shape) works without a second adapter.
      const graph = _kmStore.graph;
      const nodeCount = graph.order;
      const edgeCount = graph.size;
      let orphans = 0;
      for (const id of graph.nodes()) {
        if (graph.degree(id) === 0) orphans++;
      }
      const connectivity = nodeCount > 0 ? (nodeCount - orphans) / nodeCount : 0;
      const stats = {
        nodeCount,
        edgeCount,
        evidenceCount: 0,
        patternCount: 0,
        orphanCount: orphans,
        componentCount: 0,
        connectivity,
        lastUpdated: new Date().toISOString(),
      };
      res.write(`data: ${JSON.stringify({ success: true, data: stats })}\n\n`);
    } catch (err) {
      process.stderr.write(`[obs-api] /api/v1/stream emit failed (non-fatal): ${err.message}\n`);
    }
  };

  // Send one immediately so the client transitions from connecting → live
  // without waiting 10s.
  await emit();
  const interval = setInterval(emit, 10_000);
  req.on('close', () => clearInterval(interval));
});

// ── Phase 55 Plan 06 Task 3: SSE /api/coding/observations/stream ──────────
//
// Broadcasts every successful observation write to all connected HTTP
// clients via the process-wide `subscribeObservationWritten` bus
// (ObservationWriter.js, added in Plan 55-06). Each client gets a single
// long-lived response; each emit becomes a `data: <json>\n\n` frame.
//
// `req.on('close')` releases the listener slot — verified by the Plan 55-06
// integration test (`obs-api.coding-observations-stream.test.js`).
// SSE handler reference: integrations/mcp-server-semantic-analysis/src/sse-server.ts:136.
app.get('/api/coding/observations/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Allow the unified-viewer dev server (any localhost origin) to consume
  // this stream — the global cors() middleware already sets the wildcard
  // Access-Control-Allow-Origin for plain GET, but SSE clients sometimes
  // require a flushed-headers signal before they treat the connection as
  // "open" (Chrome's EventSource impl).
  res.flushHeaders();

  const send = (obs) => {
    try {
      res.write(`data: ${JSON.stringify(obs)}\n\n`);
    } catch (err) {
      // The connection has gone away mid-frame — log once and let the
      // req.on('close') unsubscribe path clean up.
      process.stderr.write(`[obs-api] SSE write failed (non-fatal): ${err.message}\n`);
    }
  };

  let unsubscribe;
  try {
    unsubscribe = subscribeObservationWritten(send);
  } catch (err) {
    process.stderr.write(`[obs-api] SSE subscribe failed: ${err.message}\n`);
    res.end();
    return;
  }
  req.on('close', () => {
    try { unsubscribe(); } catch { /* idempotent */ }
  });
});

// ── Phase 55 Plan 06 Task 3: GET /api/coding/lsl/sessions ─────────────────
//
// Walks the LSL history directory (env-overridable for tests via
// OBSERVATIONS_LSL_HISTORY_DIR; defaults to `.specstory/history` relative
// to REPO_ROOT). Parses the Phase 51 filename convention:
//   {YYYY-MM-DD}_{HHMM-HHMM}[-{idx}][_S{slot}-{sub-idx}-{sub-hash}][_partN]_{hash}.md
// per `.planning/phases/51-.../51-CONTEXT.md`. For each session, derives:
//   - `id` from the hash group
//   - `startAt`/`endAt` from the HHMM-HHMM range (UTC ISO via the date prefix)
//   - `observationCount` + `entityIds` via km-core findByLegacyId on the sid
//     (best-effort; empty array when the writer has not yet associated entities).
//
// Hard caps: ?limit defaults to 200, max 500. ?since defaults to last 7d.
// Malformed ?since silently falls back to the 7d default (T-55-06-03 mitigation —
// the parameter is NEVER used as a filesystem path component).
const LSL_DEFAULT_LIMIT = 200;
const LSL_MAX_LIMIT = 500;
const LSL_DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const LSL_FILE_REGEX = new RegExp(
  '^(\\d{4}-\\d{2}-\\d{2})'   // date
  + '_(\\d{4})-(\\d{4})'      // HHMM-HHMM
  + '(?:-(\\d+))?'             // optional -idx (sub-agent variant 1)
  + '(?:_S(\\d+)-(\\d+)-([^_]+))?' // optional _S{slot}-{sub-idx}-{sub-hash} (variant 2)
  + '(?:-part\\d+)?'           // optional -partN
  + '_([A-Za-z0-9]+)\\.md$'   // _<hash>.md
);

function* _walkLslDir(rootDir) {
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      yield* _walkLslDir(full);
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
      yield full;
    }
  }
}

function _parseLslFilename(basename) {
  const m = LSL_FILE_REGEX.exec(basename);
  if (!m) return null;
  const [, date, startHHMM, endHHMM, , , , subHash, hash] = m;
  // 2026-06-12: LSL filenames use the writer's LOCAL time (CEST, etc.) —
  // NOT UTC. The prior parser stamped them with a trailing 'Z' which
  // mis-bucketed every session by the local-tz offset (entities created
  // at 05:00 UTC ended up in a "07:00 UTC" bucket on a CEST host). Parse
  // as local time and convert to UTC ISO via toISOString().
  const startHH = startHHMM.slice(0, 2);
  const startMM = startHHMM.slice(2, 4);
  const endHH = endHHMM.slice(0, 2);
  const endMM = endHHMM.slice(2, 4);
  const startLocal = new Date(`${date}T${startHH}:${startMM}:00`);
  const endLocal = new Date(`${date}T${endHH}:${endMM}:00`);
  if (Number.isNaN(startLocal.getTime()) || Number.isNaN(endLocal.getTime())) return null;
  const startAt = startLocal.toISOString();
  const endAt = endLocal.toISOString();
  // Session id prefers the explicit sub-agent hash when present; otherwise
  // the parent-session hash from the filename.
  const id = subHash || hash;
  return { id, startAt, endAt };
}

app.get('/api/coding/lsl/sessions', async (req, res) => {
  try {
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(
      Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : LSL_DEFAULT_LIMIT, 1),
      LSL_MAX_LIMIT,
    );
    // T-55-06-03 mitigation: parse ?since as ISO via new Date; if NaN, fall
    // back to "last 7 days" silently. The string is never used as a path.
    let sinceMs;
    const sinceStr = typeof req.query.since === 'string' ? req.query.since : '';
    const sinceDate = sinceStr ? new Date(sinceStr) : null;
    if (sinceDate && Number.isFinite(sinceDate.getTime())) {
      sinceMs = sinceDate.getTime();
    } else {
      sinceMs = Date.now() - LSL_DEFAULT_WINDOW_MS;
    }
    const sinceISO = new Date(sinceMs).toISOString();

    const historyDir = process.env.OBSERVATIONS_LSL_HISTORY_DIR
      || path.join(REPO_ROOT, '.specstory', 'history');

    const nowMs = Date.now();

    // 2026-06-12: real per-bucket observation count + entityIds. Previously
    // we only ran findByLegacyId for the session prefix (which finds the
    // session ENTITY itself, not the observations created during the hour
    // bucket), so observationCount was always 0 or 1 and entityIds was at
    // most one. Now we pre-scan all km-core entities once, group by hour
    // bucket of their createdAt + project team, and look up per file.
    // O(n) scan with O(1) lookup — for ~900 entities this is sub-ms.
    // 2026-06-12: switched from hour-slice bucketing to RANGE-MATCH
    // aggregation. LSL file timestamps are parsed local→UTC; entities'
    // createdAt is already UTC. Their UTC hours don't align when the
    // host TZ is non-UTC, so slice(0,13) buckets diverged. Instead we
    // pre-scan all entities into a sorted list, then for each parsed
    // LSL session do a linear scan to find entities whose createdAt
    // falls in [startAt, endAt). For ~900 entities × ~200 sessions
    // that's ~180k comparisons — sub-ms.
    const TYPE_RANK = (t) => {
      if (t === 'Insight') return 0;
      if (t === 'Observation' || t === 'Digest') return 9;
      return 5;
    };
    const HIDDEN_FROM_VIEWER = new Set(['Observation', 'Digest']);
    const allEnts = []; // [{id, type, hidden, createdMs}]
    try {
      if (_kmStoreReady && _kmStore && _kmStore.graph) {
        const graph = _kmStore.graph;
        for (const id of graph.nodes()) {
          const attrs = graph.getNodeAttributes(id);
          const created = attrs.createdAt
            || (attrs.metadata && attrs.metadata.createdAt);
          if (typeof created !== 'string') continue;
          const createdMs = Date.parse(created);
          if (!Number.isFinite(createdMs)) continue;
          allEnts.push({
            id,
            type: attrs.entityType,
            hidden: HIDDEN_FROM_VIEWER.has(attrs.entityType)
              || (typeof attrs.name === 'string' && attrs.name.startsWith('[Raw]')),
            createdMs,
          });
        }
      }
    } catch (err) {
      process.stderr.write(`[obs-api] /api/coding/lsl/sessions bucket scan failed: ${err.message}\n`);
    }
    // Keyed by session-startAt ISO so we can look it up below in the
    // file-walk loop.
    const entitiesBySessionStart = new Map();
    // 2026-06-12: every tick must be clickable. Return ALL entityIds in
    // the bucket, sorted by TYPE_RANK so the FIRST one is the best
    // selection target — Insights bubble up; if none, the user gets the
    // top non-stream entity; if still none, an Observation. The graph
    // won't react when the selected entity is hidden (Observation/
    // Digest), but the right panel still shows its content so the user
    // can read what was captured during that session.
    const aggregateForRange = (startMs, endMs) => {
      const matches = allEnts.filter(
        (e) => e.createdMs >= startMs && e.createdMs < endMs,
      );
      matches.sort((a, b) => TYPE_RANK(a.type) - TYPE_RANK(b.type));
      return {
        entityIds: matches.map((x) => x.id),
        totalCount: matches.length,
      };
    };

    const sessions = [];
    for (const file of _walkLslDir(historyDir)) {
      const parsed = _parseLslFilename(path.basename(file));
      if (!parsed) continue;
      if (parsed.startAt < sinceISO) continue;
      // Currently-running heuristic: when endAt is in the future, surface
      // null so the unified-viewer LslTimelineStrip renders the live pulse.
      const endAtRaw = parsed.endAt;
      const endAt = Date.parse(endAtRaw) > nowMs ? null : endAtRaw;
      // 2026-06-12: RANGE match — find entities created within
      // [startAt, endAt) (or [startAt, now) when still running).
      const startMs = Date.parse(parsed.startAt);
      const endMs = endAt ? Date.parse(endAt) : Date.now() + 1;
      const { entityIds, totalCount } =
        (Number.isFinite(startMs) && Number.isFinite(endMs))
          ? aggregateForRange(startMs, endMs)
          : { entityIds: [], totalCount: 0 };
      // Persist for the client side (debug / future per-session API).
      entitiesBySessionStart.set(parsed.startAt, entityIds);
      sessions.push({
        id: parsed.id,
        startAt: parsed.startAt,
        endAt,
        observationCount: totalCount,
        entityIds,
      });
    }
    sessions.sort((a, b) => (b.startAt > a.startAt ? 1 : b.startAt < a.startAt ? -1 : 0));
    const sliced = sessions.slice(0, limit);
    res.json({ success: true, data: { sessions: sliced } });
  } catch (err) {
    process.stderr.write(`[obs-api] /api/coding/lsl/sessions error: ${err.message}\n`);
    res.status(500).json({ success: false, error: 'Failed to list LSL sessions' });
  }
});

// Phase 44 Plan 14 — guard auto-listen so the integration test
// (tests/integration/obs-api.legacy-endpoints.km-core.test.js) can
// import this module without triggering a real :12436 bind. The test
// sets OBSERVATIONS_API_NO_AUTOSTART=1, then drives the exported `app`
// directly via supertest-style in-process fetch.
const _autostart = process.env.OBSERVATIONS_API_NO_AUTOSTART !== '1';
const server = _autostart
  ? app.listen(PORT, '0.0.0.0', () => {
      process.stderr.write(`[obs-api] listening on http://0.0.0.0:${PORT} (km-core data root: ${path.dirname(KG_DB_PATH)})\n`);
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
        .then((store) => {
          if (store) mountKMRoutes(store);
          // 2026-06-12: subscribe the debounced cold-store exporter to the
          // write bus + schedule an initial pass so the .data/observation-
          // export/ JSON files catch up on whatever was added to km-core
          // while obs-api wasn't running. The exporter is a no-op when the
          // store hasn't initialised yet (guarded by ensureExporter()).
          if (store) {
            subscribeObservationWritten(() => scheduleExport());
            scheduleExport();
            // Re-run hourly as a belt-and-suspenders against missed write
            // events (e.g., an observation lands during a coordinator
            // failure and the event bus is briefly orphaned).
            const hourly = setInterval(scheduleExport, 60 * 60 * 1000);
            hourly.unref?.();
          }
        })
        .catch((err) => {
          process.stderr.write(`[obs-api] km-core mount failed: ${err.message}\n`);
        });
    })
  : null;

// Export the Express app + a manual store-injector for tests. The test
// can construct a tmpdir-backed GraphKMStore, hand it to _testHooks, then
// hit the app via supertest-style requests without touching production
// state.
export const _testHooks = {
  app,
  setKMStoreForTest(store) {
    _kmStore = store;
    _kmStoreReady = true;
    // Phase 55 Plan 06: legacy /api/* tests still skip /api/v1 mount via
    // the dedicated mountV1RoutesForTest hook below. Tests that need the
    // /api/v1/stats surface (or the BC /api/v1/graph/* routes) must
    // explicitly call mountV1RoutesForTest() after setKMStoreForTest.
  },
  // Phase 55 Plan 06 Task 1 — opt-in hook for tests that exercise the
  // /api/v1 surface (stats and the BC graph routes). Calls into
  // mountKMRoutes with the test-injected store, which registers the
  // canonical 15-endpoint surface (incl. /graph/connectivity + /graph/orphans).
  // Idempotent for a single test fixture; tests that wire one store per
  // `beforeAll` only need to call this once.
  mountV1RoutesForTest() {
    if (!_kmStore) {
      throw new Error('mountV1RoutesForTest called before setKMStoreForTest');
    }
    mountKMRoutes(_kmStore);
  },
  invalidateStalenessCache() {
    _stalenessCache.invalidate();
  },
};

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
  if (!server) {
    // No autostart (integration-test path) — nothing to close.
    return;
  }
  server.close(async () => {
    if (_writer) {
      try { await _writer.close?.(); } catch { /* best effort */ }
    }
    if (_pipelineStatsConsolidator) {
      try { _pipelineStatsConsolidator.close(); } catch { /* best effort */ }
      _pipelineStatsConsolidator = null;
    }
    // Plan 44-18 (Task 4) — the prior legacy SQLite shutdown handler is
    // gone. Pruner + retrieval-service freshness-rerank are km-core-only;
    // no sqlite handle remains in this process to close.
    // SIGKILL ourselves to skip Node's native destructor teardown.
    // process.exit(0) triggers the fastembed C++ cleanup path which hits a
    // libc++ mutex bug ("mutex lock failed: Invalid argument") and crashes
    // with a non-zero exit code.  SIGKILL bypasses all destructors cleanly.
    process.kill(process.pid, 'SIGKILL');
  });
  // Hard exit if graceful shutdown stalls
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 25_000).unref();
}
if (_autostart) {
  // Skip signal handlers in test mode — Jest reuses the process for many
  // suites; installing a SIGINT/SIGTERM listener would interfere with
  // Jest's own --watch and worker lifecycle.
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Phase 35 plan 35-04 - re-export merge helpers for any caller that imports the
// obs-api server module directly (back-compat with the original plan contract).
export { _mergeObservations, _mergeDigests, _computeRetentionBoundary };
