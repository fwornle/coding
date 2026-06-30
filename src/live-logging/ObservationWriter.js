/**
 * ObservationWriter - writes normalized transcript exchanges as observations,
 * daily digests, and insights into km-core (`GraphKMStore`).
 *
 * Phase 44 Plan 12 (A-1 architectural close-out): the WRITE path was cut
 * from SQLite to km-core. Three public write methods now route through
 * km-core's `putEntity` via the shared `legacy-ingest` adapter
 * (lib/km-core/src/adapters/legacy-ingest.ts), eliminating the dual-source
 * problem that Plan 44-07's read-only cutover left exposed: the dashboard
 * at :3032 reads km-core via the typed views at /api/coding/*, so new
 * observations written to SQLite were invisible until a manual `--resume`
 * migration ran. The fix is a hard cutover per CONTEXT R-4: every write
 * goes through km-core; no dual-write window; no feature flag.
 *
 * Phase 44 Plan 13 (writer-side deep cutover — wave 5.7): the SQLite
 * handle is GONE. The three remaining helpers (`_findExistingByContentHash`,
 * `_isSemanticallyDuplicate`, `_maybePatchArtifacts`) now read+write via
 * km-core. The km-core helpers `findByContentHash` + `findRecentByAgent` +
 * `findByLegacyId` + `putEntity` (replay) back them. No SQLite handle is
 * constructed; the legacy startup ack log was retired. The `this.dbPath`
 * field is preserved as a path string used to derive `projectRoot`
 * for the redactor — it is a config path, NOT a handle.
 *
 * Routes LLM summarization calls through the coding LLM proxy (port from
 * LLM_CLI_PROXY_PORT env, default 12435) rather than direct Google/Anthropic
 * API calls, avoiding API key issues in containerized environments.
 *
 * @module ObservationWriter
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import ConfigurableRedactor from './ConfigurableRedactor.js';
import { getLSLWindow } from '../../lib/lsl/window.mjs';
// Phase 75 (OBS-01 / D-09): the shared single-span task_id reader. ETM stamps
// metadata.task_id at the fire site; this is the best-effort fallback so direct
// callers (without ETM) still link observations to the active Run. Never throws.
import { resolveLiveTaskIdSafe } from '../../lib/lsl/token/task-id.mjs';

// Phase 55 Plan 06 Task 3 — process-wide observation-write event bus.
//
// The obs-api SSE endpoint `/api/coding/observations/stream` (Plan 55-06)
// needs a hook to broadcast each successful observation write to long-poll
// HTTP listeners. The writer is constructed lazily by obs-api so an
// instance-local EventEmitter would force callers to traverse the
// writer-init pipeline before subscribing; a module-level emitter sidesteps
// that ordering constraint entirely and is the canonical pattern for
// "process-wide write taps" in this codebase.
//
// Emitted events:
//   'written'   — payload = the observation row that was persisted
//                 (shape mirrors writeObservation's obsRow object — see
//                 below at the `_observationEmitter.emit(...)` call site).
//
// Listener responsibility: handlers MUST NOT throw — listener exceptions
// surface inside the writer's hot path and could derail subsequent observation
// processing. The SSE handler wraps its res.write in a try/catch per
// `subscribeObservationWritten` documentation.
const _observationEmitter = new EventEmitter();
// Defensive cap — production has at most ~2 SSE clients (the unified-viewer
// dev server + one tab). The default Node EventEmitter cap of 10 is fine,
// but bump to 32 to silence the warning under brief multi-client conditions.
_observationEmitter.setMaxListeners(32);

/**
 * Subscribe to observation-write events emitted by ObservationWriter.
 *
 * Returns an unsubscribe function — call it inside `req.on('close')` (the
 * canonical SSE pattern) to release the listener slot when the HTTP client
 * disconnects. Calling the returned function more than once is a no-op.
 *
 * Phase 55 Plan 06 Task 3 — added so `/api/coding/observations/stream` can
 * fan each write out to every connected SSE client without bolting a
 * Redis subscription onto the request hot path.
 *
 * @param {(obs: object) => void} listener — invoked with the persisted row.
 * @returns {() => void} unsubscribe handle (idempotent).
 */
export function subscribeObservationWritten(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('subscribeObservationWritten requires a function listener');
  }
  _observationEmitter.on('written', listener);
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    _observationEmitter.off('written', listener);
  };
}

/**
 * Test-only helper to reset the listener registry between integration tests.
 * Production code does NOT call this — listeners are scoped to a single
 * SSE connection lifetime and are released by their own unsubscribe hooks.
 */
export function _resetObservationEmitterForTests() {
  _observationEmitter.removeAllListeners('written');
}

/**
 * Test-only helper to fire a synthetic `written` event without going through
 * the LLM/dedup pipeline. Used by the `/api/coding/observations/stream`
 * integration test to drive the SSE handler deterministically.
 */
export function _emitObservationWrittenForTests(row) {
  _observationEmitter.emit('written', row);
}
// Phase 44 Plan 12: km-core write path. `GraphKMStore` is the canonical
// store for the A-1 observation/digest/insight surface; the three
// `legacy*ToEntity` adapters are the SINGLE source of truth for the
// SQLite-row → Entity field map (see lib/km-core/src/adapters/legacy-
// ingest.ts). The migration script `scripts/migrate-sqlite-to-kmcore.mjs`
// uses the same three helpers — the two consumers cannot drift.
import {
  GraphKMStore,
  defaultOntologyDir,
} from '@fwornle/km-core';
import {
  legacyObservationToEntity,
  legacyDigestToEntity,
  legacyInsightToEntity,
} from '@fwornle/km-core/adapters/legacy-ingest';

/**
 * Resolve the km-core ontology directory using the import.meta.resolve +
 * walk-up pattern (mirrors `scripts/backfill-raw-observations.mjs:40` and
 * `scripts/observations-api-server.mjs:935`). Falls back to the package's
 * exported `defaultOntologyDir()` helper — which walks up from the
 * @fwornle/km-core package root to the bundled ontology directory.
 *
 * CLAUDE.md mandatory rule (Phase 41 lesson, commits 87bc2f567 /
 * fd35c5350): ANY host-side process constructing GraphKMStore MUST pass
 * `ontologyDir`. Without it, default-class resolution throws `opts.classes
 * omitted but store has no ontology registry`. Acceptance grep for
 * `ontologyDir` in this file documents the rule's enforcement.
 */
function resolveKmCoreOntologyDir() {
  // Primary: km-core's exported helper walks up from the package root.
  try {
    return defaultOntologyDir();
  } catch { /* fall through */ }
  // Fallback: import.meta.resolve walk-up (matches backfill-raw-observations
  // and observations-api-server). This path triggers when the helper is
  // unavailable (older km-core dist) — defence-in-depth, should never fire.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', '..', 'lib', 'km-core', '.data', 'ontologies');
  } catch {
    return null;
  }
}

/**
 * Load the observations config from .observations/config.json
 * @param {string} configPath
 * @returns {Object} Parsed config or defaults
 */
function loadConfig(configPath) {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {
      defaults: {
        model: 'anthropic/claude-haiku-4-5',
        observation: { messageTokens: 20000, bufferTokens: 0.2, retentionDays: 7 },
      },
    };
  }
}

export class ObservationWriter {
  /**
   * @param {Object} [options]
   * @param {string} [options.dbPath] - Path to SQLite database file
   * @param {string} [options.proxyUrl] - LLM proxy URL (default: http://localhost:$LLM_CLI_PROXY_PORT)
   * @param {string} [options.model] - Model identifier for summarization
   * @param {number} [options.batchSize] - Messages per summarization batch
   * @param {string} [options.configPath] - Path to .observations/config.json
   * @param {import('@fwornle/km-core').GraphKMStore} [options.kmStore] -
   *   Phase 44 Plan 12: pre-constructed km-core store. When supplied (preferred
   *   path — obs-api passes its own so writes + typed-view reads share one
   *   store), the writer uses it as-is; when absent, the writer lazy-constructs
   *   one in `init()` with `ontologyDir` resolved via the km-core helper.
   * @param {string} [options.kmStoreDbPath] - LevelDB path when lazy-constructing
   *   the kmStore (default: .data/knowledge-graph/leveldb — matches obs-api).
   * @param {string} [options.kmStoreExportDir] - JSON export dir when lazy-
   *   constructing the kmStore (default: .data/knowledge-graph/exports).
   */
  constructor(options = {}) {
    const configPath = options.configPath || path.resolve('.observations/config.json');
    const config = loadConfig(configPath);

    this.dbPath = options.dbPath || '.observations/observations.db';
    const proxyPort = process.env.LLM_CLI_PROXY_PORT || '12435';
    this.proxyUrl = options.proxyUrl || `http://localhost:${proxyPort}`;
    // Provider is optional — if omitted, the LLM proxy uses network-adaptive routing
    // (VPN → copilot subscription, outside → claude-code subscription)
    this.provider = options.provider || null;
    this.batchSize = options.batchSize || 10;
    this.messageTokenLimit = config.defaults?.observation?.messageTokens || 20000;
    const rawRetentionDays = config.defaults?.observation?.retentionDays;
    const retentionDays = Number.isFinite(rawRetentionDays) ? rawRetentionDays : 7;
    // CONTEXT.md L4: dedup window in _isSemanticallyDuplicate is 4h. retentionDays must
    // translate to a cutoff strictly later than 4h ago, i.e. retentionDays >= 1 day (24h).
    // Refuse to construct if the configured value would collapse the dedup window —
    // silently clamping would mask operator misconfiguration and trip the 35-04 pruner.
    if (retentionDays < 1) {
      throw new Error(
        `[ObservationWriter] retentionDays must be >= 1 (got ${rawRetentionDays}) — ` +
        `the 4h dedup window in _isSemanticallyDuplicate would be invalidated. ` +
        `See .planning/phases/35-observation-digest-retention-with-json-cold-store-fallback/CONTEXT.md L4.`
      );
    }
    this.retentionDays = retentionDays;
    /** @type {Map<string, number>} Recent content hashes → timestamp for dedup */
    this._recentHashes = new Map();
    this._dedupWindowMs = 60_000; // skip duplicates within 60s
    /** Write lock: serializes DB writes so concurrent fire-and-forget calls
     *  don't race past the semantic dedup check (TOCTOU prevention) */
    this._writeLock = Promise.resolve();
    /** @type {import('ioredis').default|null} Redis publisher for embedding events (lazy-init, fire-and-forget) */
    this._redisPub = null;
    this._redisInitAttempted = false;

    // ── Phase 44 Plan 12 (A-1 cutover): km-core write path ───────────────────
    //
    // kmStore can be supplied externally (preferred — obs-api passes its own
    // so the writer + typed-view reads share one canonical store) OR lazy-
    // constructed against an EXPLICIT `kmStoreDbPath` (T-44-12-04 mitigation:
    // tests pass a tmpdir path to avoid contention with the live production
    // store at .data/knowledge-graph/leveldb). The lazy-construction path
    // requires `ontologyDir` per the CLAUDE.md mandatory rule (Phase 41
    // lesson, commits 87bc2f567 / fd35c5350); resolved via km-core's
    // `defaultOntologyDir()` helper, with import.meta.resolve walk-up as
    // backup (mirrors scripts/backfill-raw-observations.mjs:40,95).
    //
    // When NEITHER `kmStore` NOR `kmStoreDbPath` is supplied, lazy-init is
    // SKIPPED and the writer surfaces this as a clear error on the first
    // write attempt. This preserves backward compat with legacy unit tests
    // (tests/live-logging/ObservationWriter.*.test.js) that exercise the
    // SQLite-only paths (dedup, retention floor) without a km-core
    // dependency.
    this._kmStore = options.kmStore || null;
    this._kmStoreDbPath = options.kmStoreDbPath || null;
    this._kmStoreExportDir = options.kmStoreExportDir || null;
    /** True when this instance constructed the kmStore (and must close it) */
    this._ownsKmStore = false;
    /** Per-process run identifier — distinguishes writer-stamped rows in
     *  provenance queries. Re-generated on every constructor call so a
     *  service restart yields a fresh runId in the stamp. */
    this._runId = 'obs-writer-' + Date.now() + '-' +
      Math.random().toString(36).slice(2, 8);

    // Anchor-edge cache. Every Observation/Digest/Insight written by this
    // class would otherwise land as a km-core orphan (zero edges). We attach
    // each new node to the LiveLoggingSystem Component so the unified viewer
    // doesn't show a rotating outer ring of disconnected dots. Resolved
    // lazily at first write — null until then, null on lookup failure (the
    // anchor edge is a best-effort, never break the write hot path).
    this._anchorId = null;
    this._anchorResolveAttempted = false;
  }

  /**
   * Initialize the writer: opens the km-core GraphKMStore (canonical write
   * target post-Plan-44-13) and the PII/secret redactor. No SQLite handle
   * is opened — the writer is fully migrated to km-core for all
   * read+write paths (`writeObservation`, `_findExistingByContentHash`,
   * `_isSemanticallyDuplicate`, `_maybePatchArtifacts`).
   *
   * Phase 44 Plan 13: dropped the SQLite open helper call, the
   * FTS5/triggers/index creation, the WAL checkpoint interval, the
   * `_reopenDb` inode-rotation watchdog, and the row→JSON exporter wiring.
   * The exporter is gone because the writer no longer populates SQLite;
   * the legacy `.data/observation-export/*.json` files are now maintained
   * by the consolidator (deferred to Plan 44-15) and ultimately by
   * km-core's own JSON export under `.data/knowledge-graph/exports/`.
   *
   * The `this.dbPath` field is preserved as a path string — used to
   * derive `projectRoot` for the redactor config lookup. It is a config
   * path, NOT a handle.
   */
  async init() {
    // Initialize redactor for PII/secret scrubbing (same rules as LSL system).
    // The redactor's configDir is derived from the (no-longer-opened) dbPath:
    // ".observations/observations.db" → projectRoot = ".", config = ".specstory/config".
    try {
      const projectRoot = path.resolve(path.dirname(this.dbPath), '..');
      this._redactor = new ConfigurableRedactor({
        configDir: path.join(projectRoot, '.specstory', 'config'),
      });
      await this._redactor.initialize();
      process.stderr.write(`[ObservationWriter] Redactor initialized (${this._redactor.compiledPatterns?.length || 0} patterns)\n`);
    } catch (err) {
      process.stderr.write(`[ObservationWriter] Redactor init failed (observations will be stored unredacted): ${err.message}\n`);
      this._redactor = null;
    }

    // Phase 44 Plan 13: km-core is the canonical write+read target. When the
    // caller supplied either `kmStore` directly OR an explicit
    // `kmStoreDbPath`, eagerly open the store so the first write doesn't pay
    // a cold-start. When NEITHER is supplied, the first write throws — there
    // is no SQLite-only fallback after Plan 13.
    if (this._kmStore || this._kmStoreDbPath) {
      try {
        await this._ensureKmStore();
      } catch (err) {
        process.stderr.write(
          `[ObservationWriter] km-core init failed (write path will throw): ${err.message}\n`
        );
        // Surface — the writer cannot honor its R-4 hard-cutover contract
        // without km-core. Caller (obs-api) decides whether to retry or fail.
        throw err;
      }
    }
  }

  /**
   * Lazy-construct + open the km-core GraphKMStore. Idempotent — second
   * call is a no-op when the store is already open. Honors the CLAUDE.md
   * mandatory ontologyDir rule (Phase 41 lesson). Mirrors the lazy-init
   * pattern in `scripts/observations-api-server.mjs:923-946`.
   *
   * When the constructor was supplied with `options.kmStore`, this method
   * trusts it and only flips the `_ownsKmStore` flag to false (so close()
   * does NOT tear down a store the caller still owns).
   */
  async _ensureKmStore() {
    if (this._kmStore) {
      // Caller-supplied; assume already opened. Mark as not-owned so we
      // don't close it on shutdown.
      this._ownsKmStore = false;
      return this._kmStore;
    }
    if (!this._kmStoreDbPath) {
      throw new Error(
        '[ObservationWriter] km-core write path not configured — pass ' +
        '`options.kmStore` (preferred) or `options.kmStoreDbPath` to the ' +
        'constructor. Phase 44 Plan 12 cut the SQLite write path; calling ' +
        'writeObservation/writeDigest/writeInsight without km-core wiring ' +
        'is unsupported.'
      );
    }
    const ontologyDir = resolveKmCoreOntologyDir();
    if (!ontologyDir) {
      throw new Error(
        '[ObservationWriter] ontologyDir resolution failed — refusing to construct ' +
        'GraphKMStore without ontologyDir per CLAUDE.md mandatory rule (Phase 41 ' +
        'commits 87bc2f567 / fd35c5350).'
      );
    }
    const exportDir = this._kmStoreExportDir
      || path.join(path.dirname(this._kmStoreDbPath), 'exports');
    this._kmStore = new GraphKMStore({
      dbPath: this._kmStoreDbPath,
      exportDir,
      ontologyDir,
    });
    await this._kmStore.open();
    this._ownsKmStore = true;
    process.stderr.write(
      `[ObservationWriter] kmStore initialized: ${this._kmStoreDbPath} (ontologyDir=${ontologyDir})\n`
    );
    return this._kmStore;
  }

  /**
   * Resolve (and cache) the id of the LiveLoggingSystem Component node — the
   * anchor every Observation/Digest/Insight gets a `capturedBy` edge to.
   * Without this anchor every new node lands as an orphan and the unified
   * viewer renders the outer-ring dot-art the user has objected to (2026-06-11).
   *
   * Scans nodes via Components ontology class and matches by name. Result
   * cached on the instance once resolved. RETRIES on each call until success —
   * the original "give-up-after-first-failure" semantics produced silent
   * orphan-drift on the coding project (2026-06-15: 22 Insights orphaned
   * because the first lookup raced an obs-api boot before LiveLoggingSystem
   * was hydrated, then every subsequent Insight write skipped anchoring
   * permanently). Returns null when the anchor genuinely does not exist
   * (a fresh km-core with no project hierarchy yet); callers MUST treat
   * null as "skip anchoring" rather than failing the write.
   */
  async _resolveAnchorId(kmStore) {
    if (this._anchorId) return this._anchorId;
    try {
      const components = await kmStore.findByOntologyClass('Component');
      const lsl = components.find((e) => e && e.name === 'LiveLoggingSystem');
      if (lsl && lsl.id) {
        this._anchorId = lsl.id;
        process.stderr.write(
          `[ObservationWriter] anchor resolved: LiveLoggingSystem = ${lsl.id}\n`
        );
        return lsl.id;
      }
      // Anchor genuinely missing this attempt — log once per `(process lifetime, missing)`
      // transition so steady-state writes don't spam stderr while preserving signal
      // when the anchor first goes missing.
      if (!this._anchorAbsenceLogged) {
        this._anchorAbsenceLogged = true;
        process.stderr.write(
          `[ObservationWriter] anchor lookup: LiveLoggingSystem Component not found yet — will retry on next write (writes meanwhile land as orphans)\n`
        );
      }
      return null;
    } catch (err) {
      // Same one-shot logging for transient errors; next call retries.
      if (!this._anchorErrorLogged) {
        this._anchorErrorLogged = true;
        process.stderr.write(
          `[ObservationWriter] anchor resolve failed (will retry on next write): ${err.message}\n`
        );
      }
      return null;
    }
  }

  /**
   * Attach a `capturedBy` edge from the just-written entity to the
   * LiveLoggingSystem anchor. Best-effort: any failure (anchor missing,
   * duplicate-edge race, store error) logs to stderr and returns — the
   * observation/digest/insight write is already durable.
   */
  async _anchorEntity(kmStore, fromId, relationType = 'capturedBy') {
    if (!fromId) return;
    const anchorId = await this._resolveAnchorId(kmStore);
    if (!anchorId) return;
    try {
      await kmStore.addRelation({
        from: fromId,
        to: anchorId,
        type: relationType,
        metadata: { source: 'observation-writer', anchoredAt: new Date().toISOString() },
      });
    } catch (err) {
      // Source/Target-not-found can race with a putEntity in-flight; treat
      // as benign. Other errors get one-line logged.
      process.stderr.write(
        `[ObservationWriter] anchor edge ${fromId}->${anchorId} failed (non-fatal): ${err.message}\n`
      );
    }
  }

  /**
   * Phase 58 Plan 02 — emit N `mentions` edges from a just-written entity
   * to the target entity ids the classifier produced.
   *
   * N-edge generalization of `_anchorEntity` (which is the 1-edge analog).
   * Lives in the same try-block as the writeInsight putEntity call so the
   * km-core JSON exporter's 5s debounce sees putEntity + every addRelation
   * in the same export tick (EDGE-02 atomicity contract per D-04). The
   * exporter-debounce envelope IS the atomicity unit; await between
   * iterations is fine because the debounce window is wall-clock seconds
   * while the loop runs in microseconds.
   *
   * Per-edge guards mirror Shared Pattern A from the phase PATTERNS.md:
   *   1. Skip self-loops (`toId === fromId`) defensively.
   *   2. Dedup via `kmStore.findRelations({from, to, type: 'mentions'})`
   *      before write — km-core `addRelation` is NOT idempotent on the
   *      (from, to, type) triple per `reprojectFromOnlineStore.ts:441-456`
   *      precedent, so re-runs would multiply edges otherwise (D-04 + D-05
   *      idempotency requirement).
   *   3. Wrap each addRelation in its own try/catch — Source/Target-not-found
   *      can race with putEntity in-flight; treat as benign with a one-line
   *      stderr log (same convention as `_anchorEntity` above).
   *
   * Metadata stamp `source: 'observation-writer'` distinguishes writer-path
   * edges from `'backfill-insight-mentions'` (Plan 03 backfill script) and
   * `'consolidator-bridge'` (Plan 03 bridge extension) — every edge is
   * traceable to its emitter (threat T-58-02-04 mitigation).
   *
   * @param {object} kmStore     — the km-core GraphKMStore (already opened)
   * @param {string} fromId      — the just-written entity id (output of putEntity)
   * @param {string[]} targetIds — entity ids the Insight `mentions`
   * @returns {Promise<void>}
   */
  async _emitMentionsEdges(kmStore, fromId, targetIds) {
    if (!fromId) return;
    if (!Array.isArray(targetIds) || targetIds.length === 0) return;
    for (const toId of targetIds) {
      // Self-loop guard — defensive; the classifier shouldn't produce
      // self-references but a hallucination could match the insight's own
      // id if it ever appeared in the candidate catalog.
      if (!toId || toId === fromId) continue;

      // Idempotency check — see Shared Pattern A. Skip on failure so we
      // never block a write because the dedup probe choked.
      try {
        const existing = await kmStore.findRelations({
          from: fromId,
          to: toId,
          type: 'mentions',
        });
        if (Array.isArray(existing) && existing.length > 0) continue;
      } catch (err) {
        process.stderr.write(
          `[ObservationWriter] mentions dedup probe ${fromId}->${toId} failed (non-fatal): ${err.message}\n`
        );
        // Fall through — better to risk a duplicate edge than to drop the write.
      }

      try {
        await kmStore.addRelation({
          from: fromId,
          to: toId,
          type: 'mentions',
          metadata: {
            source: 'observation-writer',
            classifiedAt: new Date().toISOString(),
            classifier: 'llm-haiku',
          },
        });
      } catch (err) {
        // Source/Target-not-found can race with a putEntity in-flight;
        // treat as benign per `_anchorEntity` precedent.
        process.stderr.write(
          `[ObservationWriter] mentions edge ${fromId}->${toId} failed (non-fatal): ${err.message}\n`
        );
      }
    }
  }

  /**
   * Redact PII/secrets from text using the same rules as the LSL system.
   * Falls back to identity if redactor is not initialized.
   * @param {string} text
   * @returns {string}
   */
  _redact(text) {
    if (!text || !this._redactor) return text;
    try {
      return this._redactor.redact(text);
    } catch {
      return text;
    }
  }

  /**
   * Lazily initialize Redis publisher for embedding events.
   * Fire-and-forget: if Redis is unreachable, observations still work.
   */
  _initRedis() {
    if (this._redisInitAttempted) return;
    this._redisInitAttempted = true;
    try {
      this._redisPub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // Don't retry -- fail fast
        lazyConnect: true,
        connectTimeout: 2000,
      });
      this._redisPub.connect().catch((err) => {
        process.stderr.write(`[ObservationWriter] Redis connect failed (non-fatal): ${err.message}\n`);
        this._redisPub = null;
      });
    } catch (err) {
      process.stderr.write(`[ObservationWriter] Redis init failed (non-fatal): ${err.message}\n`);
      this._redisPub = null;
    }
  }

  /**
   * Call the LLM proxy to generate an observation summary from messages.
   * Falls back to a raw concatenation if the proxy is unavailable.
   *
   * @param {import('./TranscriptNormalizer.js').MastraDBMessage[]} messages
   * @returns {Promise<string>} Summary text
   */
  /**
   * @param {import('./TranscriptNormalizer.js').MastraDBMessage[]} messages
   * @param {Object} [metadata] - Context metadata (project, agent, etc.)
   * @returns {Promise<{summary: string, llm?: {model: string, provider: string}}>}
   */
  /**
   * Fetch a short window of prior user→assistant exchanges from the Live
   * Session Log (LSL) so the summarizer can resolve context-dependent
   * references ("it", "that", "the change", "implement it now") that
   * otherwise produce content-free summaries like "Developer requested
   * implementation of some previously discussed feature". Returns a small
   * XML block ready to drop into the prompt, or an empty string when no
   * prior exchanges are available.
   *
   * Phase 50 Plan 02: scoped to the most recent 3 user-prompt exchanges in
   * the LSL (project-scoped) via `lib/lsl/window.mjs::getLSLWindow`. The
   * 30-min observation-DB lookup that lived here previously is retired —
   * both inline and async tiers now agree on what "recent context" means
   * (CONTEXT.md "Implication for tier-1" lines 82-90, Should #7). The
   * window walker is interaction-time, not wall-clock, so a 6-hour
   * autonomous task with no user activity still surfaces the most recent
   * user prompt as antecedent.
   */
  _buildPriorContext(metadata) {
    try {
      const agent = metadata.agent;
      const project = metadata.project;
      if (!agent || !project) return '';

      const observation = {
        created_at: metadata.created_at || new Date().toISOString(),
        project,
      };
      let window;
      try {
        window = getLSLWindow(observation, { maxPrompts: 3, project });
      } catch {
        return '';
      }
      if (!window || !window.exchanges || window.exchanges.length === 0) return '';

      // Build the line list. The LSL window's exchange.content is a single
      // string combining <user> and <assistant> turns (see lib/lsl/window.mjs
      // renderExchangeContent). For each exchange, prefer the assistant turn's
      // Intent line when it follows the 4-line template; otherwise fall back
      // to the user's first non-blank line. Cap at 3 lines (mirrors maxPrompts).
      const lines = [];
      for (const ex of window.exchanges) {
        if (lines.length >= 3) break;
        const repr = this._extractPriorLine(ex.content);
        if (!repr) continue;
        const truncated = repr.length > 200 ? repr.slice(0, 200) + '…' : repr;
        lines.push('  - ' + truncated);
      }
      if (lines.length === 0) return '';

      return `\n<prior_observations>\n` +
        `The most recent observations for this agent+project (oldest first). ` +
        `Use ONLY to resolve pronominal or implicit references in the exchange below ` +
        `(e.g. "it", "that", "the change", "implement it now"). ` +
        `Do NOT copy these into Intent unless the current exchange explicitly references them.\n` +
        lines.join('\n') +
        `\n</prior_observations>`;
    } catch {
      return ''; // never let context-fetch break summarization
    }
  }

  /**
   * Heuristic: does the last user message in `messages` contain an
   * unresolved pronoun reference? Used in tandem with
   * `_buildPriorContext` to set `metadata.needs_lsl_resolution = true`
   * at capture time, so the Plan 01 async resolver can pre-filter rows
   * worth re-summarizing without re-scanning all of `.observations/`.
   *
   * The heuristic is intentionally lenient — false positives just mean
   * an extra LLM call by the resolver on its next sweep (bounded by
   * Plan 01's --limit and idempotency). False negatives are the failure
   * mode (the row is never re-resolved), so err toward over-flagging.
   *
   * Phase 50 Plan 02 detector B (CONTEXT.md § "B. Capture-time hint").
   *
   * @param {Array<{role: string, content: string}>} messages
   * @returns {boolean}
   */
  _hasUnresolvedPronoun(messages) {
    try {
      if (!Array.isArray(messages) || messages.length === 0) return false;
      const userMsgs = messages.filter(m => m && m.role === 'user' && typeof m.content === 'string');
      if (userMsgs.length === 0) return false;
      const lastUser = userMsgs[userMsgs.length - 1].content || '';
      const trimmed = lastUser.trim();
      // Standalone affirmation patterns: single-word/phrase user reply.
      if (/^(yes|yep|sure|proceed|continue|do it|go ahead|same again|do the same)$/i.test(trimmed)) {
        return true;
      }
      // Canonical verb + pronoun trigger: "implement it now", "do that", etc.
      if (/\b(implement|do|fix|continue|resume|apply)\s+(it|that|this|the same|again)\b/i.test(lastUser)) {
        return true;
      }
      // Bare "the same|change|previous|earlier|prior|first|second|other"
      // without a clarifying noun within ~5 tokens. "Apply the change please"
      // → triggers. "Apply the change to file user-profile.tsx" → does not
      // (clarifying noun 'file' within window).
      const bareRefRe = /\bthe\s+(same|change|previous|earlier|prior|first|second|other)\b/i;
      const bareRefMatch = lastUser.match(bareRefRe);
      if (bareRefMatch) {
        const tailStart = bareRefMatch.index + bareRefMatch[0].length;
        const after = lastUser.slice(tailStart, tailStart + 40);
        const clarifyingNounRe = /\b(file|feature|function|plan|change|fix|button|page|api|component|test|migration|script|module|class|method|hook|workflow|task|step|wave|phase|exchange)s?\b/i;
        if (!clarifyingNounRe.test(after)) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Extract a one-line representation from a single LSL-window exchange
   * content string. The content combines <user>...</user> and optional
   * <assistant>...</assistant> blocks (per lib/lsl/window.mjs).
   *
   * Strategy:
   *   1. If the assistant turn follows the 4-line template, return its
   *      Intent line value.
   *   2. Otherwise, return the first non-blank line of the user turn.
   *
   * Returns null when neither yields a usable line.
   */
  _extractPriorLine(content) {
    if (!content || typeof content !== 'string') return null;
    // Try assistant Intent line first.
    const asstMatch = content.match(/<assistant>([\s\S]*?)<\/assistant>/);
    if (asstMatch) {
      const intent = this._extractIntent(asstMatch[1]);
      if (intent) return intent;
    }
    // Fall back to first non-blank line of user turn.
    const userMatch = content.match(/<user>([\s\S]*?)<\/user>/);
    if (userMatch) {
      const userText = userMatch[1].trim();
      if (userText) {
        const firstLine = userText.split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0);
        if (firstLine) return firstLine;
      }
    }
    return null;
  }

  async summarize(messages, metadata = {}) {
    const projectName = metadata.project || 'unknown';
    const priorContext = this._buildPriorContext(metadata);
    // Phase 50 Plan 02 detector B: when prior context is empty AND the
    // current user message has an unresolved pronoun, stamp the row so
    // the Plan 01 resolver picks it up first on its next sweep.
    const needsLslResolution = priorContext === '' && this._hasUnresolvedPronoun(messages);
    if (needsLslResolution) {
      process.stderr.write(
        `[ObservationWriter] needs_lsl_resolution flagged: ` +
        `agent=${metadata.agent || 'unknown'} project=${metadata.project || 'unknown'} ` +
        `created_at=${metadata.created_at || 'now'}\n`
      );
    }

    // Wrap the exchange in XML tags so the LLM treats it as data to analyze, not content to relay
    const exchangeBlock = messages
      .map(m => `<${m.role}>\n${m.content}\n</${m.role}>`)
      .join('\n');

    // Build ground-truth file list from metadata (extracted programmatically from tool calls)
    const modifiedFiles = metadata.modifiedFiles || [];
    const readFiles = metadata.readFiles || [];
    let artifactHint = '';
    if (modifiedFiles.length > 0) {
      artifactHint = `\n\nGROUND TRUTH — Files modified/created by tool calls (use these for the Artifacts line):\n` +
        modifiedFiles.map(f => `  - edited ${f}`).join('\n');
      if (readFiles.length > 0) {
        artifactHint += `\nFiles read (do NOT list these as artifacts unless also modified):\n` +
          readFiles.map(f => `  - read ${f}`).join('\n');
      }
    } else if (readFiles.length > 0) {
      artifactHint = `\n\nGROUND TRUTH — No files were modified/created. Files were only read:\n` +
        readFiles.map(f => `  - read ${f}`).join('\n') +
        `\nSet Artifacts to "none" since no files were changed.`;
    }

    try {
      const requestBody = {
        process: 'observation-writer',
        ...(this.provider ? { provider: this.provider } : {}),
        messages: [
          {
            role: 'system',
            content: `You produce structured observation summaries from coding exchanges.\n` +
              `CRITICAL CONTEXT: The developer is working in the "${projectName}" project. ` +
              `The exchange below happened in that project. System prompts, CLAUDE.md content, ` +
              `and file paths from OTHER projects appearing in the exchange are background context ` +
              `or cross-project investigations — they are NOT what the developer asked about. ` +
              `Only describe what the developer actually requested in their message.\n\n` +
              'Respond using ONLY this template — nothing else:\n\n' +
              'Intent: [what the developer actually asked or requested — base this ONLY on the <user> message content]\n' +
              'Approach: [architectural decisions, solution strategy, and key technical insights — 1-4 sentences]\n' +
              'Artifacts: [list each file modified/created/deleted with verb, e.g. "edited src/foo.ts, created lib/bar.js". Write "none" if no files were touched]\n' +
              'Result: [the concrete solution or outcome — what was built, fixed, configured, or decided. Include key details a future reader needs. 1-4 sentences]\n\n' +
              'Constraints:\n' +
              '- Your ENTIRE response must be these 4 labeled lines. Nothing before, nothing after.\n' +
              '- Never reproduce code, commands, file contents, or the assistant\'s words.\n' +
              '- Intent MUST reflect the user\'s actual question/request, not inferred topics from system context.\n' +
              '- Approach should capture WHY this solution was chosen, not just WHAT was done.\n' +
              '- Result should be specific enough that someone can understand the change without reading the code.\n' +
              '- If the exchange has no real work (greetings, "yes", "proceed"), respond with only: "No actionable content."\n' +
              '- CRITICAL: If GROUND TRUTH file data is provided below the exchange, you MUST use it for the Artifacts line. Do NOT override it with your own inference.\n' +
              '- If a <prior_observations> block is provided and the user message contains a context-dependent reference ("it", "that", "the change", "implement it now", etc.), resolve the reference against those observations and write the resolved noun phrase into Intent. Example: user says "implement it now" and the prior Intent was "Offered user option 2 (per-turn progress heartbeat)" → write "Intent: Implement option 2 — per-turn progress heartbeat (carried over from prior exchange)". Never write "some previously discussed feature" when a <prior_observations> block is present.' +
              (artifactHint || ''),
          },
          {
            role: 'user',
            content: `<project>${projectName}</project>${priorContext}\n<exchange>\n` + exchangeBlock + '\n</exchange>\n\nProduce the observation summary.',
          },
        ],
      };
      // Retry loop: 4 attempts with exponential backoff (1s, 2s, 4s -> ~7s
      // total wait + per-attempt fetch latency). The old 2-attempt / 3s budget
      // couldn't cover a proxy auto-heal kickstart window (the proxy is
      // unavailable for several seconds while launchd respawns + the new node
      // process binds its listener) — observations submitted during a kickstart
      // landed in _fallbackSummary() and were persisted as "[Raw] ... LLM
      // summary unavailable" rows that later need backfilling.
      const RETRY_BACKOFF_MS = [1000, 2000, 4000];
      const MAX_RETRIES = RETRY_BACKOFF_MS.length + 1;
      let lastError = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          process.stderr.write(`[ObservationWriter] Calling proxy (attempt ${attempt}/${MAX_RETRIES}, provider: ${this.provider || 'auto'})\n`);

          const response = await fetch(`${this.proxyUrl}/api/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(60000),
          });

          if (!response.ok) {
            const errBody = await response.text();
            lastError = `Proxy error ${response.status}: ${errBody.slice(0, 200)}`;
            process.stderr.write(`[ObservationWriter] ${lastError}\n`);
            if (attempt < MAX_RETRIES) {
              await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1]));
              continue;
            }
            return { summary: this._fallbackSummary(messages), needs_lsl_resolution: needsLslResolution || undefined };
          }

          const result = await response.json();
          const summary = this._sanitizeSummary(result.content) || this._fallbackSummary(messages);
          const llm = result.model && result.provider
            ? { model: result.model, provider: result.provider, tokens: result.tokens || null, latencyMs: result.latencyMs || null }
            : undefined;
          process.stderr.write(`[ObservationWriter] Summary ${result.content ? 'received' : 'MISSING'} (${summary.length} chars) via ${llm ? `${llm.model}@${llm.provider}` : 'fallback'}\n`);
          return { summary, llm, needs_lsl_resolution: needsLslResolution || undefined };
        } catch (err) {
          lastError = err.message;
          process.stderr.write(`[ObservationWriter] Attempt ${attempt} failed: ${err.message}\n`);
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1]));
          }
        }
      }

      process.stderr.write(`[ObservationWriter] All ${MAX_RETRIES} attempts failed. Last error: ${lastError}. Storing raw summary.\n`);
      return { summary: this._fallbackSummary(messages), needs_lsl_resolution: needsLslResolution || undefined };
    } catch (err) {
      process.stderr.write(`[ObservationWriter] Unexpected error: ${err.message}. Storing raw summary.\n`);
      return { summary: this._fallbackSummary(messages), needs_lsl_resolution: needsLslResolution || undefined };
    }
  }

  /**
   * Fallback summary when LLM proxy is unavailable.
   * @param {Array} messages
   * @returns {string}
   */
  _fallbackSummary(messages) {
    const roles = messages.reduce((acc, m) => {
      acc[m.role] = (acc[m.role] || 0) + 1;
      return acc;
    }, {});
    const roleSummary = Object.entries(roles).map(([r, c]) => `${c} ${r}`).join(', ');
    return `[Raw] ${messages.length} messages (${roleSummary}). LLM summary unavailable.`;
  }

  /**
   * Sanitize LLM-generated summary: detect unfilled template placeholders,
   * self-correction artifacts, and other quality issues.
   * @param {string|undefined} raw - Raw LLM response
   * @returns {string|null} Cleaned summary, or null if unusable
   */
  _sanitizeSummary(raw) {
    if (!raw || typeof raw !== 'string') return null;

    let summary = raw.trim();

    // Detect self-correction: LLM outputs template placeholders then corrects itself.
    // Pattern: first attempt with brackets, then "Wait..." or "Let me...", then real content.
    // Keep only the last valid Intent/Approach/Artifacts/Result block.
    const intentBlocks = [...summary.matchAll(/^Intent:\s*.+$/gm)];
    if (intentBlocks.length > 1) {
      // Multiple Intent blocks — take the last complete one
      const lastIntentIdx = summary.lastIndexOf('Intent:');
      const candidate = summary.slice(lastIntentIdx).trim();
      // Only use it if it has all 4 fields and no bracket placeholders
      if (/^Intent:/m.test(candidate) && /^Result:/m.test(candidate) &&
          !candidate.includes('[what the developer') && !candidate.includes('[architectural decisions')) {
        summary = candidate;
        process.stderr.write(`[ObservationWriter] Sanitized: stripped LLM self-correction preamble\n`);
      }
    }

    // Detect unfilled template placeholders — the LLM echoed the instructions
    const placeholderPatterns = [
      '[what the developer actually asked',
      '[architectural decisions, solution strategy',
      '[key actions taken',
      '[list each file modified/created/deleted with verb',
      'base this ONLY on the <user> message content',
    ];
    const hasPlaceholders = placeholderPatterns.some(p => summary.includes(p));
    if (hasPlaceholders) {
      process.stderr.write(`[ObservationWriter] Sanitized: LLM returned unfilled template placeholders — discarding\n`);
      return null;
    }

    return summary;
  }

  /**
   * Compute the content-hash used for dedup. Must produce the identical
   * value as the inline hash in writeObservation(). Callers in the
   * pre-LLM path use this to short-circuit the summarize() call when the
   * same exchange has already been observed (~98% of overnight wasted
   * sonnet calls per the 2026-06-04 audit).
   */
  _computeContentHash(messages, metadata = {}) {
    const userContent = messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join('|');
    const assistantContent = messages
      .filter(m => m.role === 'assistant')
      .map(m => typeof m.content === 'string' ? m.content.slice(0, 500) : '')
      .join('|');
    // 2026-06-19: the dedup hash is INTENDED to be session-scoped (sessionId is
    // part of the md5 input) so the same content in a different session is NOT
    // treated as already-observed. But every caller sets `metadata.sessionId`
    // (camelCase) — ETM's fire path (enhanced-transcript-monitor.js) and the
    // write path (writeObservation line ~1132 `session_id: metadata.sessionId`)
    // — while this read used `metadata.session_id` (snake_case), which is never
    // set. Result: sessionId was ALWAYS '' → the hash collapsed to
    // `|userContent|assistantContent`, making dedup cross-session. Symptom: a
    // user pasting a prior session's (already-observed) summary block as a new
    // prompt produced ZERO observations for the whole follow-up exchange — the
    // paste collided with the earlier session's row. Prefer camelCase (the field
    // callers actually set); keep snake_case as a defensive fallback.
    const sessionId = metadata.sessionId || metadata.session_id || '';
    return crypto.createHash('md5')
      .update(`${sessionId}|${userContent}|${assistantContent}`)
      .digest('hex');
  }

  /**
   * Look up an existing observation by (agent, content_hash) via km-core.
   *
   * Phase 44 Plan 13: replaces the previous SQLite
   *   `SELECT id, summary, metadata FROM observations WHERE agent=? AND
   *    content_hash=? LIMIT 1`
   * with `kmStore.findByContentHash(agent, contentHash)`. Returns the shape
   * the previous SQLite row produced so the callers (`writeObservation`,
   * `processMessages`) don't change.
   *
   * Shape returned: `{ id, summary, metadata }` where:
   *   - id      = `entity.legacyId.id` (the row UUID — same as the value
   *               the previous SQLite write produced via crypto.randomUUID()).
   *   - summary = `entity.properties.summary`. legacy-ingest.ts:262-274
   *               stores the summary string under `metadata.summary`; for
   *               km-core entities the top-level `description` carries the
   *               same value (set at adapter line 261). We surface
   *               `metadata.summary` here for consistency with the SQLite
   *               shape (Artifacts-patch regex matches on summary text).
   *   - metadata = JSON string of `entity.metadata`. Pre-Plan-13 callers
   *                JSON.parse the string in `_maybePatchArtifacts`; rather
   *                than break that contract, we stringify here.
   *
   * Returns null when no match. Safe to call before init() (returns null).
   */
  async _findExistingByContentHash(agent, contentHash) {
    if (!this._kmStore) return null;
    const matches = await this._kmStore.findByContentHash(agent, contentHash);
    if (matches.length === 0) return null;
    const e = matches[0];
    const meta = e.metadata || {};
    return {
      id: e.legacyId?.id ?? e.id,
      summary: meta.summary ?? e.description ?? '',
      metadata: typeof meta === 'string' ? meta : JSON.stringify(meta),
    };
  }

  /**
   * If an existing observation has "Artifacts: none" but the current fire
   * has ground-truth modifiedFiles, patch the Artifacts line in place. No
   * LLM call needed — modifiedFiles comes from deterministic tool-call
   * extraction. Returns true if a patch was applied, false otherwise.
   *
   * Phase 44 Plan 13: replaces the previous SQLite
   *   `UPDATE observations SET summary=?, metadata=? WHERE id=?`
   * with a km-core fetch-modify-putEntity replay:
   *   1. `kmStore.findByLegacyId({ system: 'A', id: existing.id })`
   *   2. mutate `entity.metadata.summary` (the Artifacts: substring) +
   *      `entity.metadata.modifiedFiles` / `readFiles`.
   *   3. mutate `entity.description` so the dashboard reshape via
   *      observation-view.ts surfaces the patched text too.
   *   4. `kmStore.putEntity(entity, { skipOntologyCheck: true })` — replay
   *      preserves `entity.createdAt`, `entity.createdBy`, `entity.id`,
   *      `entity.legacyId` verbatim (T-44-13-02 mitigation).
   *
   * Returns false when the existing summary doesn't carry "Artifacts: none"
   * OR no new modifiedFiles were supplied. Caller's contract unchanged.
   */
  async _maybePatchArtifacts(existing, metadata) {
    const hasNoArtifacts = /Artifacts:\s*none/i.test(existing.summary);
    const newModifiedFiles = metadata.modifiedFiles;
    if (!hasNoArtifacts || !newModifiedFiles || newModifiedFiles.length === 0) {
      return false;
    }
    if (!this._kmStore) return false;

    const artifactsList = newModifiedFiles.map(f => {
      const base = f.split('/').pop();
      return `edited ${base}`;
    }).join(', ');
    const updatedSummary = existing.summary.replace(
      /Artifacts:\s*none/i,
      `Artifacts: ${artifactsList}`,
    );

    // Fetch the canonical entity (km-core is the single source of truth
    // post-Plan-13). The Artifacts-patch path is idempotent — if the entity
    // has since been overwritten by a successor (rare) the patch becomes a
    // no-op fetch but the caller's `return true` contract still holds because
    // the SQLite row would have been similarly stale.
    const entity = await this._kmStore.findByLegacyId({
      system: 'A',
      id: existing.id,
    });
    if (!entity) {
      process.stderr.write(
        `[ObservationWriter] Artifacts-patch: legacyId ${existing.id} not found in km-core — skipping\n`
      );
      return false;
    }

    // Build the patched entity. T-44-13-02 invariant: PRESERVE the original
    // entity.createdAt, entity.createdBy, entity.id, entity.legacyId verbatim;
    // mutate ONLY metadata.summary + metadata.modifiedFiles + metadata.readFiles
    // (and the top-level `description` which carries the same summary text for
    // the dashboard reshape).
    const patchedMeta = { ...(entity.metadata || {}) };
    patchedMeta.summary = updatedSummary;
    patchedMeta.modifiedFiles = newModifiedFiles;
    if (metadata.readFiles) patchedMeta.readFiles = metadata.readFiles;

    const patched = {
      ...entity,
      description: updatedSummary,
      metadata: patchedMeta,
    };

    try {
      await this._kmStore.putEntity(patched, { skipOntologyCheck: true });
    } catch (err) {
      process.stderr.write(
        `[ObservationWriter] Artifacts-patch putEntity failed for ${existing.id}: ${err.message}\n`
      );
      return false;
    }
    return true;
  }

  /**
   * Write a single observation to the database.
   *
   * @param {string} summary - Observation summary text
   * @param {Array} messages - Original messages
   * @param {Object} metadata - Additional metadata (agent, sessionId, sourceFile)
   */
  async writeObservation(summary, messages, metadata = {}) {
    // Phase 44 Plan 13: km-core is the single canonical store. The legacy
    // SQLite handle is gone; we require `_ensureKmStore()` to succeed.
    const kmStore = await this._ensureKmStore();

    // Skip trivial and no-work observations (no value for learning)
    // Note: [Raw] fallback summaries are NOT skipped — they are stored as quality='low'
    // so observations are preserved even when the LLM proxy is unavailable.
    const lower = summary.toLowerCase();
    if (
      lower.includes('trivial exchange') ||
      lower.includes('no actionable content') ||
      lower.includes('no new work was performed') ||
      (lower.includes('single-word check-in') && lower.includes('artifacts: none'))
    ) {
      process.stderr.write(`[ObservationWriter] Skipping low-value observation\n`);
      return null;
    }

    const agent = metadata.agent || null;
    // Content-based dedup. Hash inputs: session id + user-message content +
    // first 500 chars of each assistant message. Including assistant content
    // is required because identical user prompts (e.g. "Continue") produce
    // completely different exchanges across sessions.
    // This is a TOCTOU-defense backstop: processMessages() runs the same
    // check before calling the LLM, so a hit here means two fire-and-forget
    // calls raced past the pre-LLM check before either wrote.
    const contentHash = this._computeContentHash(messages, metadata);
    const existing = await this._findExistingByContentHash(agent, contentHash);
    if (existing) {
      if (await this._maybePatchArtifacts(existing, metadata)) {
        process.stderr.write(`[ObservationWriter] Dedup+patch: updated ${existing.id.slice(0, 8)} with ${(metadata.modifiedFiles || []).length} artifacts\n`);
        return existing.id;
      }
      process.stderr.write(`[ObservationWriter] Dedup: same input already observed (hash=${contentHash.slice(0, 8)})\n`);
      return null;
    }

    // Semantic dedup: check if a very similar observation was written recently (same agent, last 5).
    // kind:'progress' snapshots are EXEMPT: a long turn emits several near-identical
    // mid-turn checkpoints (and the final obs is near-identical to them too). Running
    // them through the 4h window would drop all but the first — and worse, suppress the
    // turn's FINAL observation as a "duplicate" of an earlier partial snapshot. Progress
    // snapshots are intentionally periodic; the token-delta gate already rate-limits them.
    if (metadata.kind !== 'progress' && await this._isSemanticallyDuplicate(agent, summary)) {
      process.stderr.write(`[ObservationWriter] Dedup: semantically similar observation already exists\n`);
      return null;
    }

    // Classify observation quality
    const quality = this._classifyQuality(summary);

    // Redact PII/secrets from summary and messages before storage
    const redactedSummary = this._redact(summary);
    const redactedMessages = messages.map(m => ({
      ...m,
      content: typeof m.content === 'string' ? this._redact(m.content) : m.content,
    }));

    const id = crypto.randomUUID();
    // Use the earliest message timestamp for created_at when backfilling,
    // falling back to current time for live observations.
    const messageTimestamp = messages.find(m => m.createdAt)?.createdAt;
    const nowISO = messageTimestamp || new Date().toISOString();

    // Phase 75 (OBS-01 / D-09): link the observation to the active Run via
    // task_id. ETM resolves it at the fire site and passes it on metadata; for
    // direct callers without ETM, fall back to the same single-span reader the
    // token path uses so token attribution and observation linkage agree on the
    // active task_id. Best-effort — '' when no span is open / on any failure.
    const taskId = metadata.task_id ?? (await resolveLiveTaskIdSafe());

    // ── Phase 44 Plan 12 (A-1 cutover): write to km-core ──────────────────
    //
    // The legacy SQLite INSERT INTO observations is GONE. Every observation
    // is shaped via the shared `legacyObservationToEntity` adapter (same
    // helper the migration script uses — single source of truth for the
    // field map, Pitfall 3, legacyId placement, and Phase 39 D-30
    // provenance) and persisted via `kmStore.putEntity` on the trusted path
    // (`skipOntologyCheck: true` — Observation/Digest/Insight classes are
    // NOT in the bundled km-core ontology; same precedent as the migration
    // script per CONTEXT R-4 hard cutover).
    const obsRow = {
      id,
      summary: redactedSummary,
      messages: JSON.stringify(redactedMessages),
      agent,
      session_id: metadata.sessionId || null,
      source_file: metadata.sourceFile || null,
      created_at: nowISO,
      metadata: this._redact(JSON.stringify(metadata)),
      content_hash: contentHash,
      quality,
    };
    try {
      const entity = legacyObservationToEntity(obsRow, this._runId, nowISO);
      // Ontology normalization (2026-06-11): the legacy adapter sets
      // entityType='Observation' AND ontologyClass='Observation', which
      // pollutes the 4-class hierarchy {Project, Component, SubComponent,
      // Detail} that VKB + unified-viewer color/filter against. Keep
      // entityType='Observation' as a free-form category tag, but force
      // ontologyClass='Detail' so the node renders inside the hierarchy.
      // Also stamp `metadata.source='auto'` so VKB's data-processor
      // (lib/vkb-server/data-processor.js:175) maps it to the 'online'
      // bucket → red dot, not blue.
      entity.ontologyClass = 'Detail';
      // Phase 75 (OBS-01): stamp task_id into the persisted entity metadata so
      // observations are queryable per Run. Only set a non-empty value so a
      // no-span fire doesn't pollute metadata with ''.
      entity.metadata = {
        ...entity.metadata,
        source: 'auto',
        ...(taskId ? { task_id: taskId } : {}),
        // Persist the progress tag explicitly so _isSemanticallyDuplicate's
        // candidate filter can exclude these snapshots on later writes.
        ...(metadata.kind ? { kind: metadata.kind } : {}),
      };
      const mintedId = await kmStore.putEntity(entity, { skipOntologyCheck: true });
      await this._anchorEntity(kmStore, mintedId);
    } catch (err) {
      process.stderr.write(
        `[ObservationWriter] km-core putEntity (observation) failed: ${err.message}\n`
      );
      throw err;
    }

    // Phase 55 Plan 06 Task 3 — broadcast the persisted row to any
    // subscribers (the obs-api SSE handler at /api/coding/observations/stream
    // is the canonical consumer). Each listener runs synchronously, but the
    // SSE handler wraps res.write in try/catch so a single broken connection
    // cannot derail the writer hot path. We intentionally emit the obsRow
    // (post-redaction) — the SSE consumer expects the same wire shape the
    // legacy /api/coding/observations REST endpoint produces.
    try {
      _observationEmitter.emit('written', obsRow);
    } catch (err) {
      process.stderr.write(
        `[ObservationWriter] observation-emit listener threw (non-fatal): ${err.message}\n`
      );
    }

    // Fire-and-forget: publish embedding event to Redis (per D-05)
    this._initRedis();
    if (this._redisPub) {
      this._redisPub.publish('embedding:new', JSON.stringify({
        type: 'observation',
        id,
        content: redactedSummary,
        metadata: { agent, quality, date: nowISO.slice(0, 10), project: 'coding' },
        timestamp: nowISO,
      })).catch((err) => {
        process.stderr.write(`[ObservationWriter] Redis publish failed (non-fatal): ${err.message}\n`);
      });
    }

    // Phase 44 Plan 13: removed `_scheduleExport()` — the previous debounced
    // JSON export pulled rows from the legacy SQLite observations table,
    // which is no longer populated by the writer. km-core's own JSON export
    // under `.data/knowledge-graph/exports/` handles the entity-shaped
    // equivalent on a separate debounce.

    return id;
  }

  /**
   * Phase 44 Plan 12: write a daily-digest entity into km-core.
   *
   * The legacy SQLite consolidator (ObservationConsolidator.consolidateDay)
   * historically owned digest persistence. Post-cutover, digests are
   * persisted via this method through the shared `legacyDigestToEntity`
   * adapter so they land in km-core with the canonical `legacyId.system='A'`
   * + Pitfall 3 (BOTH entityType + ontologyClass) + Phase 39 D-30
   * provenance shape. Consumers migrate to call this method instead of
   * direct SQLite writes in a follow-up phase; this method exists today so
   * the writer surfaces the full A-1 write contract in one place.
   *
   * @param {Object} row  Digest row matching `LegacyDigestRow` (see
   *   lib/km-core/src/adapters/legacy-ingest.ts). At minimum:
   *   `{id, date, theme, summary, observation_ids[], agents[],
   *   files_touched[], project, created_at}`.
   * @returns {Promise<string>} The persisted entity's legacyId.id (= row.id).
   */
  async writeDigest(row) {
    if (!row || typeof row !== 'object') {
      throw new Error('[ObservationWriter] writeDigest: row required');
    }
    if (!row.id) {
      throw new Error('[ObservationWriter] writeDigest: row.id required');
    }
    const kmStore = await this._ensureKmStore();
    const ts = row.created_at || new Date().toISOString();
    try {
      const entity = legacyDigestToEntity(row, this._runId, ts);
      // See writeObservation for the rationale.
      entity.ontologyClass = 'Detail';
      entity.metadata = { ...entity.metadata, source: 'auto' };
      const mintedId = await kmStore.putEntity(entity, { skipOntologyCheck: true });
      await this._anchorEntity(kmStore, mintedId);
      return row.id;
    } catch (err) {
      process.stderr.write(
        `[ObservationWriter] km-core putEntity (digest ${row.id}) failed: ${err.message}\n`
      );
      throw err;
    }
  }

  /**
   * Phase 44 Plan 12: write an insight entity into km-core.
   *
   * Symmetric counterpart of `writeDigest` for the 'Insight' ontology
   * class. The shared `legacyInsightToEntity` adapter shapes the row;
   * trusted-path putEntity (skipOntologyCheck:true) bypasses the bundled
   * km-core ontology registry which doesn't ship the Insight class (same
   * precedent as the migration script).
   *
   * Phase 58 Plan 02 (D-04 + D-06) — extended to accept an optional
   * pre-computed list of `mentions` target entity ids. When supplied,
   * the writer emits one `mentions` edge per id between `putEntity` and
   * `_anchorEntity` IN THE SAME try-block so the km-core JSON exporter's
   * 5s debounce window sees the node + every edge in the same export
   * tick. This is the atomicity envelope EDGE-02 demands (no orphan-
   * Insight visible to a concurrent reader of `/api/v1/entities`).
   *
   * The post-Phase-58 ordering inside the try-block is:
   *   1. legacyInsightToEntity(row, ...)
   *   2. preserve mapper-supplied ontologyClass (Phase 58 — was 'Detail'
   *      clobber pre-58; the mapper sets 'Insight' which is the correct
   *      label, so don't overwrite when present)
   *   3. kmStore.putEntity(entity, {skipOntologyCheck:true})
   *   4. _emitMentionsEdges(kmStore, mintedId, mentionsTargetIds)  ← NEW
   *   5. _anchorEntity(kmStore, mintedId)  ← capturedBy → LiveLoggingSystem;
   *      preserved by construction so the orphan-Insight fix from commit
   *      955617a1a propagates to every writeInsight consumer (the D-06
   *      consolidator route-through inherits this for free).
   *
   * @param {Object} row  Insight row matching `LegacyInsightRow` (see
   *   lib/km-core/src/adapters/legacy-ingest.ts). At minimum:
   *   `{id, topic, summary, confidence, digest_ids[], last_updated,
   *   created_at, project}`.
   * @param {Object} [options]  Phase 58 Plan 02 extension.
   * @param {string[]} [options.mentionsTargetIds]  Pre-computed entity ids
   *   the Insight `mentions`. When supplied, N `mentions` edges are emitted
   *   inside the same atomic try-block as `putEntity`. Each edge is
   *   dedup-checked via `kmStore.findRelations` before write (D-04 + D-05
   *   idempotency contract). Empty array / undefined / non-array silently
   *   skips the mentions loop.
   * @returns {Promise<{legacyId: string, mintedId: string}>} legacyId is the
   *   stable system='A' surrogate (= row.id); mintedId is the freshly-minted
   *   km-core entity id (= return of internal kmStore.putEntity). The mintedId
   *   eliminates the post-write findByLegacyId race that pre-D-03 callers paid
   *   (Phase 59 D-03).
   */
  async writeInsight(row, options = {}) {
    if (!row || typeof row !== 'object') {
      throw new Error('[ObservationWriter] writeInsight: row required');
    }
    if (!row.id) {
      throw new Error('[ObservationWriter] writeInsight: row.id required');
    }
    const mentionsTargetIds = Array.isArray(options?.mentionsTargetIds)
      ? options.mentionsTargetIds
      : [];
    const kmStore = await this._ensureKmStore();
    const ts = row.created_at || new Date().toISOString();
    try {
      const entity = legacyInsightToEntity(row, this._runId, ts);
      // Phase 58 Plan 02 — preserve the mapper-supplied ontologyClass
      // (the mapper sets 'Insight' for Insight rows; pre-58 we clobbered
      // it to 'Detail'). The guard also lets a future caller pass an
      // explicit row.ontologyClass-derived value through without it being
      // lost. Metadata.source: only stamp 'auto' when the mapper / caller
      // didn't already set one (e.g. consolidator passes source: 'online').
      if (!entity.ontologyClass) entity.ontologyClass = 'Detail';
      entity.metadata = {
        ...entity.metadata,
        source: entity.metadata?.source ?? 'auto',
      };
      // UPSERT — `putEntity` always mints a NEW km-core id, so a blind create
      // duplicated every Insight whose row.id is a stable key re-used across
      // runs (the 2026-06 duplicate-insight bug: 74 orphan copies, 38 topics,
      // some 7×). Resolve an existing entity by TWO keys:
      //   1. legacyId surrogate (row.id) — the migration-era key.
      //   2. topic + project — the REAL identity of an Insight.
      // The topic key is primary-in-spirit: the consolidator keeps a "main"
      // entity (UUID legacyId, carries digest_ids) AND _pushInsightToKG writes
      // a topic-keyed mirror. Without the topic match, a mirror write
      // (row.id = topic) misses the UUID-keyed canonical via findByLegacyId and
      // spawns a fresh sibling every run. Matching on topic+project collapses
      // both write paths onto ONE entity. (legacyId is a SQLite→km-core
      // migration bridge — entity.ts:147 — not the right live identity key;
      // we no longer rely on it for display either, see insightToLegacy
      // override in observations-api-server.mjs.)
      let mintedId;
      let existing = await kmStore.findByLegacyId({ system: 'A', id: row.id });
      if (!existing && row.topic) {
        const topic = String(row.topic);
        const proj = entity.metadata?.project ?? row.project ?? null;
        existing = (await kmStore.findByOntologyClass('Insight')).find((e) => {
          const m = e.metadata ?? {};
          return m.topic === topic && (proj == null || (m.project ?? null) === proj);
        }) || null;
      }
      if (existing && existing.id) {
        await kmStore.mergeAttributes(existing.id, {
          name: entity.name,
          description: entity.description,
          ontologyClass: entity.ontologyClass,
          entityType: entity.entityType,
          updatedAt: ts,
          metadata: { ...(existing.metadata || {}), ...entity.metadata },
        });
        mintedId = existing.id;
      } else {
        mintedId = await kmStore.putEntity(entity, { skipOntologyCheck: true });
      }
      // Phase 58 Plan 02 — emit N mentions edges synchronously inside the
      // same try-block as putEntity. The km-core JSON exporter debounce
      // (5s) batches putEntity + every addRelation into one export tick.
      await this._emitMentionsEdges(kmStore, mintedId, mentionsTargetIds);
      await this._anchorEntity(kmStore, mintedId);
      return { legacyId: row.id, mintedId };
    } catch (err) {
      process.stderr.write(
        `[ObservationWriter] km-core putEntity (insight ${row.id}) failed: ${err.message}\n`
      );
      throw err;
    }
  }

  /** Stop words excluded from similarity comparisons */
  static _STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'after',
    'before', 'about', 'then', 'than', 'also', 'just', 'more', 'some',
    'what', 'when', 'where', 'which', 'while', 'being', 'been', 'have',
    'does', 'doing', 'done', 'were', 'will', 'would', 'could', 'should',
    'their', 'them', 'they', 'your', 'using', 'used', 'make', 'made',
    'still', 'already', 'currently', 'previously', 'specifically',
    'issue', 'issues', 'problem', 'check', 'checking', 'needed',
    'trying', 'appears', 'whether', 'without', 'because', 'through',
    'work', 'working', 'session', 'logs', 'files', 'file', 'code',
    'data', 'started', 'continue', 'first', 'context', 'prior',
    'understand', 'reading', 'read', 'look', 'looking', 'find',
    'morning', 'progress', 'reconstruct', 'steps', 'next',
  ]);

  /** Map synonymous verbs/nouns to canonical forms */
  static _STEM_MAP = {
    debug: 'debug', debugging: 'debug', diagnose: 'debug', diagnosing: 'debug',
    investigate: 'debug', investigating: 'debug', traced: 'debug', tracing: 'debug',
    showing: 'show', shown: 'show', show: 'show', displaying: 'show', display: 'show',
    appearing: 'show', appears: 'show', appear: 'show', visible: 'show',
    missing: 'absent', absent: 'absent',
    fixing: 'fix', fixed: 'fix', repair: 'fix', resolve: 'fix', resolved: 'fix',
    removing: 'remove', removed: 'remove', delete: 'remove', deleted: 'remove',
    clean: 'remove', cleanup: 'remove', reclassify: 'reclassify', reclassification: 'reclassify',
    miscategorized: 'reclassify', miscategor: 'reclassify',
    resuming: 'resume', resumed: 'resume', restore: 'resume', restoring: 'resume',
    recovering: 'resume', recover: 'resume', interrupted: 'resume',
    crash: 'crash', crashed: 'crash', crashed: 'crash',
    observations: 'observation', observation: 'observation',
    frontend: 'frontend', dashboard: 'frontend',
    folder: 'folder', directory: 'folder',
    shadow: 'shadow',
  };

  /**
   * Extract stemmed content-bearing keywords from text.
   * @param {string} text
   * @returns {Set<string>}
   */
  _extractKeywords(text) {
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !ObservationWriter._STOP_WORDS.has(w));

    const stemmed = words.map(w => ObservationWriter._STEM_MAP[w] || w);
    return new Set(stemmed);
  }

  /**
   * Check if a semantically similar observation already exists for this agent.
   * Uses stemmed keyword overlap on both the combined Intent+Approach text
   * (broad signal) and the Intent line alone (narrow signal). A 4-hour window
   * of recent observations is searched.
   *
   * The Intent-only check exists because the combined check can be defeated
   * by paraphrased Approach text. Concrete case (the bug this fixes): three
   * observations written within the same second with byte-identical Intent
   * lines but different LLM-paraphrased Approaches yielded combined Jaccard
   * 0.29–0.37 — all below the 0.4 threshold — and slipped through, even
   * though their Intent jaccard was 1.0.
   *
   * Intent-only dedup requires both Intents to carry >= 4 meaningful keywords
   * to avoid false positives on terse Intents (e.g. "Restart the obs-api
   * service via PSM" vs "Restart the llm-proxy service via PSM" — different
   * services, similar wording). Above that floor, Intents collapse on either
   * Jaccard > 0.45 OR stem-aware containment > 0.7 (containment catches the
   * asymmetric case where one Intent extends the other with qualifiers).
   */
  async _isSemanticallyDuplicate(agent, summary) {
    if (!this._kmStore) return false;

    const newIntent = this._extractIntent(summary);
    const newApproach = this._extractApproach(summary);
    const newText = [newIntent, newApproach].filter(Boolean).join(' ');
    if (!newText || newText.length < 20) return false;

    // Phase 44 Plan 13: replaces the previous SQLite
    //   `SELECT summary FROM observations WHERE agent=? AND
    //    created_at > datetime('now', '-4 hours')
    //    ORDER BY created_at DESC LIMIT 50`
    // with `kmStore.findRecentByAgent(agent, fourHoursAgoISO, 50)`. The
    // helper returns entities sorted by `metadata.createdAt` DESC and capped
    // to limit. Map to the `{summary}` row shape so the keyword/Jaccard/
    // containment loop below stays UNCHANGED — proven semantics, only the
    // data source moves.
    const fourHoursAgoISO = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const entities = await this._kmStore.findRecentByAgent(agent, fourHoursAgoISO, 50);
    const recent = entities
      // kind:'progress' snapshots never act as dedup candidates — otherwise an
      // earlier partial mid-turn snapshot would suppress the turn's final, complete
      // observation (the snapshots are intentionally near-identical to it).
      .filter((e) => !(e.metadata && e.metadata.kind === 'progress'))
      .map((e) => ({
        summary: (e.metadata && e.metadata.summary) || e.description || '',
      }));

    const newKeywords = this._extractKeywords(newText);
    if (newKeywords.size < 3) return false;
    const newIntentKw = newIntent ? this._extractKeywords(newIntent) : new Set();

    for (const row of recent) {
      const existingIntent = this._extractIntent(row.summary);
      const existingApproach = this._extractApproach(row.summary);
      const existingText = [existingIntent, existingApproach].filter(Boolean).join(' ');
      if (!existingText) continue;

      const existingKeywords = this._extractKeywords(existingText);
      if (existingKeywords.size < 3) continue;

      // Combined Intent+Approach signal — broad overlap.
      let intersection = 0;
      for (const w of newKeywords) {
        if (existingKeywords.has(w)) intersection++;
      }
      const union = new Set([...newKeywords, ...existingKeywords]).size;
      const jaccard = intersection / union;
      const minSize = Math.min(newKeywords.size, existingKeywords.size);
      const containment = intersection / minSize;

      // Duplicate if either: strong combined Jaccard OR high containment.
      if (jaccard > 0.4 || containment > 0.7) return true;

      // Intent-only signal — narrow but high-confidence. Catches the case
      // where Intent is near-identical but Approach paraphrasing dilutes the
      // combined score. Both Intents must carry >= 4 meaningful keywords so
      // terse near-matches like "Restart obs-api via PSM" vs "Restart
      // llm-proxy via PSM" don't false-positive (those collapse to fewer
      // than 4 keywords after stop-word / length filtering, so the floor
      // alone gates them out).
      //
      // Both Jaccard and containment are evaluated on the *stemmed* keyword
      // sets produced by _extractKeywords. Containment (intersection /
      // min-side size) catches the asymmetric paraphrase case where one
      // Intent extends the other with extra qualifiers — e.g.
      //   A: "Run the GSD update skill to check for available updates and
      //       display changelog"  → {update, skill, available, updates,
      //       show, changelog} (size 6)
      //   B: "Run GSD update check and install available updates"
      //       → {update, install, available, updates} (size 4)
      // Intersection 3, union 7 → Jaccard 0.43, containment 0.75.
      if (newIntentKw.size >= 4 && existingIntent) {
        const existingIntentKw = this._extractKeywords(existingIntent);
        if (existingIntentKw.size >= 4) {
          let intentInter = 0;
          for (const w of newIntentKw) {
            if (existingIntentKw.has(w)) intentInter++;
          }
          const intentUnion = new Set([...newIntentKw, ...existingIntentKw]).size;
          const intentJaccard = intentInter / intentUnion;
          const intentMinSize = Math.min(newIntentKw.size, existingIntentKw.size);
          const intentContainment = intentInter / intentMinSize;
          if (intentJaccard > 0.45 || intentContainment > 0.7) return true;
        }
      }
    }
    return false;
  }

  /** Extract the Intent line from a structured observation summary */
  _extractIntent(summary) {
    const match = summary.match(/^Intent:\s*(.+)$/m);
    return match ? match[1].trim() : null;
  }

  /** Extract the Approach line from a structured observation summary */
  _extractApproach(summary) {
    const match = summary.match(/^Approach:\s*(.+)$/m);
    return match ? match[1].trim() : null;
  }

  /**
   * Classify observation quality based on summary content.
   * Returns: "high" (actionable work done), "normal" (question/investigation), "low" (no tools, inconclusive, raw)
   */
  _classifyQuality(summary) {
    const lower = summary.toLowerCase();

    // Raw/failed summaries are always low
    if (lower.startsWith('[raw]')) return 'low';

    // Low-value indicators
    const lowPatterns = [
      'no tools were used', 'no tools were invoked', 'no files were',
      'no actionable content', 'no resolution', 'no diagnosis',
      'needs-followup', 'needs followup',
      'no assistant response', 'no answer or investigation',
      'the exchange contains only a question',
      'not examined', 'not investigated',
    ];
    if (lowPatterns.some(p => lower.includes(p))) return 'low';

    // High-value indicators — actual work was done
    const highPatterns = [
      'edited', 'fixed', 'created', 'updated', 'refactored',
      'implemented', 'configured', 'installed', 'deployed',
      'committed', 'merged', 'resolved',
      'status: done',
    ];
    if (highPatterns.some(p => lower.includes(p))) return 'high';

    return 'normal';
  }

  /**
   * Process an array of MastraDBMessages: group into chunks, summarize each, write observations.
   *
   * @param {import('./TranscriptNormalizer.js').MastraDBMessage[]} messages
   * @param {Object} [metadata] - Shared metadata for all observations
   * @returns {Promise<{observations: number, errors: number}>}
   */
  async processMessages(messages, metadata = {}) {
    if (!messages || messages.length === 0) {
      return { observations: 0, errors: 0 };
    }

    // Skip sub-agent transcripts entirely. Sub-agents are tool calls of the
    // parent session — the parent's observation already captures the spawn
    // ("Intent: dispatch migration agent for 44-10"). Observing the subagent's
    // internal "[tool: Read]" fragments separately produces only "No actionable
    // content" duds (2026-06-04 dud-dump audit: 23 of 54 captured duds came
    // from .../subagents/agent-*.jsonl paths).
    if (typeof metadata.sourceFile === 'string' && metadata.sourceFile.includes('/subagents/')) {
      process.stderr.write(`[ObservationWriter] Skipping sub-agent transcript: ${metadata.sourceFile}\n`);
      return { observations: 0, errors: 0 };
    }

    // Skip prompt sets with no user-message-bearing exchange. The summary
    // template requires user intent to fill the "Intent:" field; without a
    // user message the LLM correctly responds "No actionable content."
    // (2026-06-04 dud-dump audit: 39 of 54 captured duds had no <user> in the
    // exchange XML — pure assistant tool-call chains from OpenCode continuation
    // sessions and Claude sub-agents.) Filter out empty/whitespace-only too.
    const hasUserMessage = messages.some(m => m.role === 'user' &&
      typeof m.content === 'string' && m.content.trim().length > 0);
    if (!hasUserMessage) {
      process.stderr.write(`[ObservationWriter] Skipping: prompt has no user-message-bearing content (${messages.length} messages)\n`);
      return { observations: 0, errors: 0 };
    }

    // Group messages into chunks based on batchSize
    const chunks = [];
    for (let i = 0; i < messages.length; i += this.batchSize) {
      chunks.push(messages.slice(i, i + this.batchSize));
    }

    let observations = 0;
    let errors = 0;
    let lastObservationId = null;

    for (const chunk of chunks) {
      try {
        // Pre-LLM content-hash dedup: the writeObservation() path catches
        // duplicate fires by content_hash, but only AFTER paying for the
        // summary. Per the 2026-06-04 audit, ~98% of overnight obs-writer
        // calls returned <10 output tokens because dedup discarded them —
        // the LLM was invoked, dedup hit, result thrown away. Short-circuit
        // here when the (agent, content_hash) row already exists.
        // The patch case (existing has "Artifacts: none" and we now have
        // ground-truth modifiedFiles) is also LLM-free, handled inline.
        const preAgent = metadata.agent || null;
        const preHash = this._computeContentHash(chunk, metadata);
        const preExisting = await this._findExistingByContentHash(preAgent, preHash);
        if (preExisting) {
          if (await this._maybePatchArtifacts(preExisting, metadata)) {
            process.stderr.write(`[ObservationWriter] Pre-LLM dedup+patch: updated ${preExisting.id.slice(0, 8)} with ${(metadata.modifiedFiles || []).length} artifacts (no LLM call)\n`);
          } else {
            process.stderr.write(`[ObservationWriter] Pre-LLM dedup: same input already observed (hash=${preHash.slice(0, 8)}) — skipping LLM call\n`);
          }
          observations++;
          lastObservationId = preExisting.id;
          continue;
        }

        // LLM summarization runs outside the lock (slow, ~5-15s)
        const { summary, llm, needs_lsl_resolution } = await this.summarize(chunk, metadata);
        let enrichedMeta = llm
          ? { ...metadata, llmModel: llm.model, llmProvider: llm.provider, llmTokens: llm.tokens, llmLatencyMs: llm.latencyMs }
          : { ...metadata };
        // Phase 50 Plan 02 detector B: persist the capture-time stamp into
        // metadata JSON so the Plan 01 resolver can SELECT on
        // json_extract(metadata, '$.needs_lsl_resolution') = 1.
        if (needs_lsl_resolution) {
          enrichedMeta = { ...enrichedMeta, needs_lsl_resolution: true };
        }

        // DB write runs inside the lock to prevent TOCTOU races:
        // two concurrent fire-and-forget calls could both pass the semantic
        // dedup check before either writes, producing duplicates.
        const obsId = await this._serializedWrite(summary, chunk, enrichedMeta);
        if (obsId) lastObservationId = obsId;
        observations++;
      } catch (err) {
        errors++;
        process.stderr.write(`[ObservationWriter] Error processing chunk: ${err.message}\n`);
      }
    }

    return { observations, errors, lastObservationId };
  }

  /**
   * Serialize DB writes through a promise chain to prevent concurrent
   * fire-and-forget calls from racing past the semantic dedup check.
   */
  _serializedWrite(summary, chunk, metadata) {
    this._writeLock = this._writeLock.then(
      () => this.writeObservation(summary, chunk, metadata),
      () => this.writeObservation(summary, chunk, metadata), // continue even if prior write failed
    );
    return this._writeLock;
  }

  /**
   * Close the writer's km-core store (when owned) + Redis publisher.
   *
   * Phase 44 Plan 13: dropped the SQLite close+WAL-checkpoint + exporter
   * flush — no SQLite handle is held anymore. km-core's own close()
   * handles a debounced JSON export flush + LevelDB durable write.
   */
  async close() {
    // Disconnect Redis publisher if active
    if (this._redisPub) {
      try { this._redisPub.disconnect(); } catch { /* best effort */ }
      this._redisPub = null;
    }
    // Phase 44 Plan 12: close the km-core store only when we own it. When
    // the caller (obs-api) supplied it via `options.kmStore`, the caller
    // owns the lifecycle — tearing it down here would break the typed-view
    // handlers that still hold a reference.
    if (this._kmStore && this._ownsKmStore) {
      try { await this._kmStore.close(); } catch { /* best effort */ }
      process.stderr.write('[ObservationWriter] km-core GraphKMStore closed.\n');
    }
    this._kmStore = null;
  }
}
