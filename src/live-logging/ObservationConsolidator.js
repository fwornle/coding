/**
 * ObservationConsolidator - Aggregates fine-grained observations into digests and insights.
 *
 * Implements a two-level memory hierarchy inspired by Mastra's Observer/Reflector pattern:
 *
 *   observations (per prompt-set)
 *       ↓  consolidateDay() — LLM groups by theme, merges narratives
 *   digests (daily thematic summaries)
 *       ↓  synthesizeInsights() — LLM extracts persistent project knowledge
 *   insights (living knowledge, updated in-place)
 *
 * Uses the same LLM proxy as ObservationWriter for summarization calls.
 *
 * @module ObservationConsolidator
 */

import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ConfigurableRedactor from './ConfigurableRedactor.js';
import { ObservationSanitizer } from './ObservationSanitizer.js';
import Redis from 'ioredis';
import { createLogger } from '../../lib/logging/Logger.js';

// Project's backend Logger — used by new code in this module (the
// existing `process.stderr.write` call sites predate the Logger and are
// left untouched for this commit to keep the diff focused; migrating
// them is tracked separately). Per CLAUDE.md, raw stderr writes are a
// constraint dodge for `no-console-log` — new code goes through here.
const log = createLogger('Consolidator');
// Phase 44 Plan 17 (consolidator cutover to km-core): Digest + Insight
// persistence routes through km-core via the same legacy-ingest adapter
// ObservationWriter uses (Plan 44-13). The consolidator does NOT write
// Observation entities (writer owns that path) — it only READS them and
// stamps `metadata.digested_at` via `mergeAttributes` (Option A
// idempotency, decided in 44-17-AUDIT.md). The SQLite handle is gone;
// `this.dbPath` is preserved as a path string for projectRoot derivation
// (same pattern as ObservationWriter post-Plan-44-13).
import {
  legacyDigestToEntity,
  legacyInsightToEntity,
} from '@fwornle/km-core/adapters/legacy-ingest';

// Phase 58 Plan 02 (D-06 writer-path unification) — the consolidator's
// _pushInsightToKG routes through ObservationWriter.writeInsight rather
// than inlining VKB HTTP PUT or direct kmStore.putEntity. A single owner
// of the Insight-write surface eliminates drift between writer + bridge
// + consolidator paths (D-06.2). Plan 58-01 ships the mentions classifier
// that produces the targetIds passed into writeInsight options.
import { ObservationWriter } from './ObservationWriter.js';
import { loadMentionCandidates, classifyMentions } from './MentionsClassifier.js';

/**
 * Cosine threshold for treating a new insight as a near-duplicate of an
 * existing one. MiniLM-L6-v2 cosines for any two project documents floor
 * around 0.89-0.92 (shared project vocabulary lifts everything), so the
 * dedup gate must sit above that to avoid false merges. 0.88 was the
 * original calibration; we keep that for the embedding-only signal and
 * rely on the topic-Jaccard secondary band to catch paraphrases that
 * dip below it.
 */
const INSIGHT_DEDUP_THRESHOLD = 0.88;

/**
 * Floor for the *borderline* band: matches above this but below the strict
 * dedup threshold are written as facets (cross-linked siblings) rather than
 * merged. Sits just above the project-document floor so it surfaces only
 * genuinely-related pairs, not the entire corpus.
 */
const INSIGHT_FACET_THRESHOLD = 0.83;

/**
 * Topic-Jaccard secondary band. Identifier-style tokenisation of the topic
 * string (camelCase + space + hyphen split). Catches paraphrases where the
 * embedding cosine is below threshold but the topics share core tokens
 * (e.g. "LLM CLI Proxy" vs "LLM CLI Proxy — VPN/Corporate Network Detection").
 */
const INSIGHT_TOPIC_JACCARD_MERGE = 0.60;
const INSIGHT_TOPIC_JACCARD_FACET = 0.30;

/**
 * Stopwords stripped from topic-tokenisation. Generic structural words
 * ("system", "module", "service") are filtered because every architectural
 * topic mentions them, so they contribute noise rather than identity.
 */
const TOPIC_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'via',
  'system', 'module', 'service', 'component', 'subcomponent', 'detail',
  'project', 'file', 'process', 'integration', 'integrations',
]);

/**
 * Cosine threshold for treating two same-date digests as a near-duplicate.
 * Higher than the insight threshold because digests share more project
 * vocabulary (toolchain, paths, agents) and so cluster at higher floors.
 * 0.97 isolates genuine LLM-rewording duplicates without merging genuinely
 * different work performed on the same day.
 */
const DIGEST_DEDUP_THRESHOLD = 0.97;

const require = createRequire(import.meta.url);

export class ObservationConsolidator {
  /**
   * @param {Object} [options]
   * @param {string} [options.dbPath] - Legacy SQLite path string. Retained only
   *   as a config-path anchor for projectRoot derivation (`_getSanitizer`,
   *   `_isCadenceDue`, sentinel paths). NOT opened as a database handle —
   *   the consolidator is fully km-core-native post-Plan-44-17.
   * @param {string} [options.proxyUrl] - LLM proxy URL
   * @param {string} [options.provider] - LLM provider override
   * @param {AbortSignal} [options.abortSignal] - Optional caller-owned signal
   *   used to cancel in-flight LLM HTTP calls (obs-api SIGTERM path).
   * @param {import('@fwornle/km-core').GraphKMStore} [options.kmStore] -
   *   Phase 44 Plan 17: pre-constructed km-core store. REQUIRED — the
   *   consolidator no longer lazy-constructs one (single-owner pattern
   *   mirrors ObservationWriter Plan 44-13). obs-api passes its own
   *   instance so consolidation reads + writes share one canonical store
   *   with the writer + typed-view reads.
   * @param {string} [options.runId] - Per-process run identifier for the
   *   Digest/Insight entity provenance stamps. Default: synthesized from
   *   timestamp + random suffix on construction.
   */
  constructor(options = {}) {
    this.dbPath = options.dbPath || '.observations/observations.db';
    const proxyPort = process.env.LLM_CLI_PROXY_PORT || '12435';
    this.proxyUrl = options.proxyUrl || process.env.LLM_CLI_PROXY_URL || `http://localhost:${proxyPort}`;
    this.provider = options.provider || null;
    // Optional caller-owned AbortSignal. When triggered (typically obs-api
    // SIGTERM), in-flight LLM HTTP calls are cancelled and the proxy kills
    // their spawned claude CLI subprocesses so they don't outlive us.
    this.abortSignal = options.abortSignal || null;
    // Phase 44 Plan 17: SQLite handle removed. km-core is the single canonical
    // store for reads + writes.
    this._kmStore = options.kmStore || null;
    /** Per-process run identifier used as the createdBy.runId on every
     *  Digest/Insight entity stamped by this consolidator instance. */
    this._runId = options.runId || 'obs-consolidator-' + Date.now() + '-' +
      Math.random().toString(36).slice(2, 8);
    // Phase 58 Plan 02 (D-06) — single-owner writer pattern. The
    // consolidator routes Insight writes through ObservationWriter.writeInsight
    // so the writer-path is the only km-core-native writer for Insights
    // (`capturedBy → LiveLoggingSystem` anchoring is inherited for free
    // from writeInsight's internal _anchorEntity call; mentions edges land
    // in the same atomic try-block per Plan 02 Task 1). Tests inject a
    // mock writer via `options.observationWriter`; production callers leave
    // this null and `_ensureObservationWriter` lazy-constructs one against
    // the shared `this._kmStore`.
    this._observationWriter = options.observationWriter || null;
    /** @type {import('ioredis').default|null} Redis publisher for embedding events (lazy-init, fire-and-forget) */
    this._redisPub = null;
    this._redisInitAttempted = false;
  }

  /**
   * Phase 58 Plan 02 (D-06) — return the ObservationWriter handle the
   * consolidator routes Insight writes through. When `options.observationWriter`
   * was supplied at construction (test path or external injection), return
   * it as-is; otherwise lazy-construct one against the shared `this._kmStore`.
   *
   * The lazy path uses the writer's `options.kmStore` constructor surface
   * (Plan 44-12 wiring), so the writer skips its own lazy-construction and
   * the two surfaces share one canonical km-core store. The writer's
   * `init()` is intentionally NOT called here — it's a no-op when
   * `options.kmStore` is supplied (the store is already opened by obs-api
   * before the consolidator is constructed), and skipping it avoids the
   * redactor-init side effect which isn't needed for writeInsight.
   *
   * Throws when called without a kmStore — same fail-fast convention as
   * the rest of this file's km-core checks (Phase 44 Plan 17 Task 2 gate 5).
   *
   * @returns {ObservationWriter}
   */
  _ensureObservationWriter() {
    if (this._observationWriter) return this._observationWriter;
    if (!this._kmStore) {
      throw new Error(
        '[ObservationConsolidator] cannot construct ObservationWriter — kmStore not configured (pass options.kmStore or options.observationWriter)'
      );
    }
    this._observationWriter = new ObservationWriter({
      kmStore: this._kmStore,
      // Use the consolidator's runId so provenance stamps trace back to
      // the originating consolidation cycle.
      configPath: this.configPath || undefined,
    });
    // Override the writer's auto-generated runId so the writer-side provenance
    // stamp matches the consolidator's run (single-owner provenance per cycle).
    if (this._runId) this._observationWriter._runId = this._runId;
    return this._observationWriter;
  }

  /**
   * Phase 44 Plan 17 — inline km-core check + accessor. Each read/write
   * method begins with `if (!this._kmStore) throw ...; const kmStore =
   * this._kmStore;` so the consolidator fails fast when constructed
   * without `options.kmStore`. The acceptance grep for `this._kmStore`
   * exercises every such site (Plan 44-17 Task 2 gate 5).
   */

  /**
   * Phase 44 Plan 17 — inverse of `legacyObservationToEntity`. Returns the
   * SQLite-row-shaped object the existing parse/partition/prompt code
   * expects. Pure synchronous transform; no I/O.
   * @param {import('@fwornle/km-core').Entity} entity
   * @returns {{id: string, summary: string, agent: string|null, created_at: string, metadata: string, quality: string}}
   */
  _toLegacyObsRow(entity) {
    const m = entity.metadata ?? {};
    return {
      id: entity.legacyId?.id ?? entity.id,
      summary: typeof m.summary === 'string'
        ? m.summary
        : (entity.description ?? ''),
      agent: typeof m.agent === 'string' ? m.agent : null,
      created_at: typeof m.createdAt === 'string'
        ? m.createdAt
        : (entity.validFrom ?? ''),
      metadata: typeof m === 'object' ? JSON.stringify(m) : '{}',
      quality: typeof m.quality === 'string' ? m.quality : 'normal',
      _entity: entity,
    };
  }

  /**
   * Phase 44 Plan 17 — inverse of `legacyDigestToEntity`. Carries the
   * source `_entity` reference so callers can `mergeAttributes` without
   * a round-trip lookup.
   * @param {import('@fwornle/km-core').Entity} entity
   */
  _toLegacyDigestRow(entity) {
    const m = entity.metadata ?? {};
    return {
      id: entity.legacyId?.id ?? entity.id,
      date: typeof m.date === 'string'
        ? m.date
        : (entity.validFrom ? entity.validFrom.slice(0, 10) : ''),
      theme: typeof m.theme === 'string' ? m.theme : '',
      summary: typeof m.summary === 'string'
        ? m.summary
        : (entity.description ?? ''),
      observation_ids: JSON.stringify(Array.isArray(m.observation_ids) ? m.observation_ids : []),
      agents: JSON.stringify(Array.isArray(m.agents) ? m.agents : []),
      files_touched: JSON.stringify(Array.isArray(m.files_touched) ? m.files_touched : []),
      quality: typeof m.quality === 'string' ? m.quality : 'normal',
      created_at: typeof m.createdAt === 'string'
        ? m.createdAt
        : (entity.validFrom ?? ''),
      metadata: JSON.stringify(m),
      project: typeof m.project === 'string' ? m.project : 'unknown',
      _entity: entity,
    };
  }

  /**
   * Phase 44 Plan 17 — inverse of `legacyInsightToEntity`. Carries the
   * source `_entity` reference so callers can `mergeAttributes` without
   * a round-trip lookup.
   * @param {import('@fwornle/km-core').Entity} entity
   */
  _toLegacyInsightRow(entity) {
    const m = entity.metadata ?? {};
    return {
      id: entity.legacyId?.id ?? entity.id,
      topic: typeof m.topic === 'string' ? m.topic : (entity.name ?? ''),
      summary: typeof m.summary === 'string'
        ? m.summary
        : (entity.description ?? ''),
      confidence: typeof m.confidence === 'number' ? m.confidence : 0.8,
      digest_ids: JSON.stringify(Array.isArray(m.digest_ids) ? m.digest_ids : []),
      last_updated: typeof m.last_updated === 'string'
        ? m.last_updated
        : (entity.validFrom ?? ''),
      created_at: typeof m.createdAt === 'string'
        ? m.createdAt
        : (entity.validFrom ?? ''),
      metadata: JSON.stringify(m),
      project: typeof m.project === 'string' ? m.project : 'unknown',
      _entity: entity,
    };
  }

  /**
   * Lazy-init Redis publisher for embedding events (fire-and-forget, non-fatal).
   */
  _initRedis() {
    if (this._redisInitAttempted) return;
    this._redisInitAttempted = true;
    try {
      this._redisPub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
        lazyConnect: true,
        connectTimeout: 2000,
      });
      this._redisPub.connect().catch((err) => {
        process.stderr.write(`[Consolidator] Redis connect failed (non-fatal): ${err.message}\n`);
        this._redisPub = null;
      });
    } catch (err) {
      process.stderr.write(`[Consolidator] Redis init failed (non-fatal): ${err.message}\n`);
      this._redisPub = null;
    }
  }

  /**
   * Publish an embedding event to Redis (fire-and-forget).
   * @param {'digest'|'insight'} type
   * @param {string} id
   * @param {string} content
   * @param {Record<string, unknown>} metadata
   */
  _publishEmbeddingEvent(type, id, content, metadata) {
    this._initRedis();
    if (this._redisPub) {
      this._redisPub.publish('embedding:new', JSON.stringify({
        type,
        id,
        content,
        metadata,
        timestamp: new Date().toISOString(),
      })).catch((err) => {
        process.stderr.write(`[Consolidator] Redis publish failed (non-fatal): ${err.message}\n`);
      });
    }
  }

  /**
   * Lazily-initialized ObservationSanitizer. Repo path corpus is loaded
   * once and reused for every dedup/repair call. Falls back to no
   * repo-wide recovery if `git ls-files` is unavailable here.
   */
  _getSanitizer() {
    if (this._sanitizer) return this._sanitizer;
    let repoPaths = null;
    try {
      const projectRoot = path.resolve(path.dirname(this.dbPath), '..');
      repoPaths = ObservationSanitizer.loadRepoPaths(projectRoot);
    } catch (err) {
      process.stderr.write(`[Consolidator] Sanitizer repo-paths unavailable (non-fatal): ${err.message}\n`);
    }
    this._sanitizer = new ObservationSanitizer({ repoPaths });
    return this._sanitizer;
  }

  /**
   * Pre-write sanitization for a digest entry: dedupes the files_touched
   * list (drops bare basenames whose full path is also present) and
   * recovers any `<AWS_SECRET_REDACTED>` corruption using sibling fields
   * as the recovery oracle.
   *
   * @param {{ theme: string, summary: string, filesTouched: string[], metadata?: object }} d
   * @returns {{ theme, summary, filesTouched, metadata }}
   */
  _sanitizeDigestEntry(d) {
    const sanitizer = this._getSanitizer();
    const ctx = [d.summary || '', d.theme || ''];
    const filesOut = sanitizer.sanitizeFileList(d.filesTouched || [], ctx);
    const summaryOut = sanitizer.sanitizeText(d.summary || '', [
      Array.isArray(filesOut.result) ? filesOut.result.join(' ') : filesOut.result,
      d.theme || '',
    ]);
    const metaOut = sanitizer.sanitizeMetadata(d.metadata || {}, ctx);
    return {
      theme: d.theme,
      summary: summaryOut.text,
      filesTouched: Array.isArray(filesOut.result)
        ? filesOut.result
        : (() => { try { return JSON.parse(filesOut.result); } catch { return d.filesTouched; } })(),
      metadata: typeof metaOut.result === 'object' ? metaOut.result : (() => {
        try { return JSON.parse(metaOut.result); } catch { return d.metadata || {}; }
      })(),
    };
  }

  /**
   * Identifier-aware tokenisation for topic strings. Splits camelCase,
   * snake_case, and hyphenated identifiers so "LLMProxy" matches "llm proxy".
   * Used by the topic-Jaccard secondary dedup band.
   */
  _tokeniseTopic(text) {
    if (!text) return new Set();
    const split = String(text)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/[_\-—]/g, ' ');
    return new Set(
      split
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !TOPIC_STOPWORDS.has(t))
    );
  }

  /**
   * Jaccard similarity of two token sets.
   */
  _jaccard(a, b) {
    if (!a || !b || a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const t of a) if (b.has(t)) intersection++;
    const union = a.size + b.size - intersection;
    return intersection / union;
  }

  /**
   * Find an existing insight similar enough to the new entry to warrant
   * either a merge or a facet cross-link. Two signals are combined:
   *
   *   1. Embedding cosine over (topic + summary), via Qdrant.
   *   2. Topic-string Jaccard with identifier-aware tokenisation.
   *
   * Cosine is the primary signal because it captures paraphrase; Jaccard
   * is the safety net for short or LLM-renamed topics where the cosine
   * sometimes dips below 0.82 despite obvious topical overlap.
   *
   * Returns a verdict object so callers can distinguish "absorb-into" vs
   * "link-as-facet". `null` means no significant relationship.
   *
   * @param {{ topic: string, summary: string, project?: string }} entry
   * @returns {Promise<{ id: string, verdict: 'merge' | 'facet', cosine: number, jaccard: number } | null>}
   */
  async _findSimilarInsightId(entry) {
    const tools = await this._getEmbedder();
    if (!tools) return null;
    const text = `${entry.topic ?? ''}\n\n${entry.summary ?? ''}`.trim();
    if (!text) return null;
    const vector = await tools.embed(text);
    // Scope candidate matches to the same project so that "Coding Patterns"
    // in project A cannot absorb a same-named topic from project B just
    // because the embedding cosine clears the threshold.
    const project = entry.project || 'unknown';
    const search = {
      vector,
      // Top-5: the strongest cosine match may still lose the verdict to a
      // weaker-cosine sibling with a much stronger Jaccard. We pick the
      // best combined verdict across the top-5.
      limit: 5,
      score_threshold: INSIGHT_FACET_THRESHOLD,
      with_payload: true,
      with_vector: false,
      filter: { must: [{ key: 'project', match: { value: project } }] },
    };
    const results = await tools.qdrant.search('insights', search);
    if (!results || results.length === 0) return null;

    const entryTopicTokens = this._tokeniseTopic(entry.topic || '');
    let best = null;
    for (const r of results) {
      const candidateTopic = r.payload?.topic || '';
      const candidateTokens = this._tokeniseTopic(candidateTopic);
      const jac = this._jaccard(entryTopicTokens, candidateTokens);
      const cos = Number(r.score) || 0;

      // Verdict precedence (strongest wins):
      //   cosine >= MERGE_THRESHOLD  OR  jaccard >= TOPIC_JACCARD_MERGE → 'merge'
      //   cosine >= FACET_THRESHOLD  OR  jaccard >= TOPIC_JACCARD_FACET → 'facet'
      let verdict = null;
      if (cos >= INSIGHT_DEDUP_THRESHOLD || jac >= INSIGHT_TOPIC_JACCARD_MERGE) {
        verdict = 'merge';
      } else if (
        cos >= INSIGHT_FACET_THRESHOLD ||
        jac >= INSIGHT_TOPIC_JACCARD_FACET
      ) {
        verdict = 'facet';
      } else {
        continue;
      }

      // Among multiple candidates, prefer merges over facets; within the
      // same verdict tier, pick the highest combined signal.
      const combined = Math.max(cos, jac);
      if (
        !best ||
        (verdict === 'merge' && best.verdict === 'facet') ||
        (verdict === best.verdict && combined > Math.max(best.cosine, best.jaccard))
      ) {
        best = { id: String(r.id), verdict, cosine: cos, jaccard: jac };
      }
    }
    return best;
  }

  /**
   * Lazily load the upper ontology so insights can be classified into
   * the same entity classes the KG already understands. Returns the
   * parsed entities map (name → definition) or null if unavailable.
   * Failure here is non-fatal — callers fall back to a generic class.
   */
  _getOntologyClasses() {
    if (this._ontologyClasses !== undefined) return this._ontologyClasses;
    this._ontologyClasses = null;
    try {
      const projectRoot = path.resolve(path.dirname(this.dbPath), '..');
      const ontPath = path.join(projectRoot, '.data/ontologies/upper/development-knowledge-ontology.json');
      const raw = JSON.parse(fs.readFileSync(ontPath, 'utf8'));
      const entities = raw.entities || {};
      // Drop the JSON's `_comment_*` placeholders. Build the search
      // tokens once (lowercased name + description words) so per-insight
      // matching stays cheap.
      const out = {};
      for (const [name, def] of Object.entries(entities)) {
        if (name.startsWith('_') || !def || typeof def !== 'object') continue;
        const desc = (def.description || '').toLowerCase();
        out[name] = {
          name,
          description: def.description || '',
          tokens: this._tokenize(`${name} ${desc}`),
        };
      }
      this._ontologyClasses = out;
    } catch (err) {
      process.stderr.write(`[Consolidator] Ontology unavailable (non-fatal): ${err.message}\n`);
    }
    return this._ontologyClasses;
  }

  _tokenize(text) {
    return new Set(
      (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4)
    );
  }

  /**
   * Classify an insight (topic + summary) into the best-matching upper
   * ontology entity class via token overlap. Returns the chosen class
   * name + a confidence score in [0,1]. Falls back to 'Knowledge' for
   * insights that don't strongly match any ontology class — better
   * than mis-classifying as e.g. 'File' just because the word appeared
   * once.
   */
  _classifyInsightByOntology(topic, summary) {
    const classes = this._getOntologyClasses();
    if (!classes) return { entityClass: 'Knowledge', confidence: 0 };

    const insightTokens = this._tokenize(`${topic} ${summary}`);
    if (insightTokens.size === 0) return { entityClass: 'Knowledge', confidence: 0 };

    let best = null;
    for (const def of Object.values(classes)) {
      let overlap = 0;
      for (const t of def.tokens) if (insightTokens.has(t)) overlap++;
      if (overlap === 0) continue;
      // Normalize against the smaller of the two token sets so a long
      // summary against a tight class definition still scores well.
      const denom = Math.max(1, Math.min(def.tokens.size, insightTokens.size));
      const score = overlap / denom;
      if (!best || score > best.score) best = { name: def.name, score };
    }
    if (!best || best.score < 0.15) return { entityClass: 'Knowledge', confidence: 0 };
    return { entityClass: best.name, confidence: Math.min(1, best.score) };
  }

  /**
   * Push a synthesized insight into the KG as an online-learned entity.
   * The viewer renders these red/pink so the user can distinguish
   * auto-learned knowledge from the manual UKB pipeline output.
   *
   * Each call replaces the entity's observations with the freshly
   * synthesized summary — re-synthesis intentionally supersedes the
   * older narrative rather than appending. Provenance is preserved
   * across cleanup writes by the underlying writer (see
   * UKBDatabaseWriter.updateEntity).
   *
   * Failure is non-fatal so a VKB outage cannot block the SQLite
   * insight pipeline.
   *
   * @param {{topic:string, summary:string, project:string, confidence:number, _digestIds?:string[]}} entry
   */
  async _pushInsightToKG(entry) {
    if (!entry?.topic) return;
    // Phase 58 Plan 02 (D-06) fail-fast — kmStore is required for both the
    // route-through writeInsight call AND the has_insight addRelation that
    // follows. The call-site at line 1691 swallows exceptions so a single
    // Insight failure doesn't abort the batch (PATTERNS Landmine 5).
    if (!this._kmStore) {
      throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    }
    const vkbUrl = process.env.VKB_API_URL || 'http://localhost:8080';
    const project = entry.project || 'coding';
    const { entityClass, confidence: classConf } = this._classifyInsightByOntology(entry.topic, entry.summary || '');

    // Ensure a Project anchor exists for this team. Without it, the
    // online insights float disconnected from the rest of the graph
    // because no other entity references them. (Out of scope for D-06.1
    // to refactor _ensureProjectAnchor; it still hits VKB internally
    // until a future plan migrates it. We just consume its return value.)
    const projectName = await this._ensureProjectAnchor(vkbUrl, project);

    // Phase 58 Plan 02 (D-04 step 2) — run the mentions classifier BEFORE
    // the writeInsight call. Per D-04.1 fail-fast: when the classifier
    // throws (LLM proxy down, hallucinated all names → empty array is
    // benign; throw is the fail-fast signal), the Insight is NOT written
    // and the next consolidation cycle re-tries naturally.
    let mentionsTargetIds = [];
    try {
      const candidates = await loadMentionCandidates(this._kmStore);
      mentionsTargetIds = await classifyMentions(entry.summary || entry.topic, candidates);
    } catch (err) {
      process.stderr.write(`[Consolidator→KG] mentions classifier failed for ${entry.topic}: ${err.message}\n`);
      return; // D-04.1 — do NOT write a half-Insight
    }

    // Phase 58 Plan 02 (D-06) — route the Insight write through
    // ObservationWriter.writeInsight. The writer's try-block emits
    // putEntity → N mentions edges → capturedBy anchor inside the same
    // km-core JSON-export tick (EDGE-02 atomicity). The has_insight
    // project-anchor edge is emitted by the consolidator AFTER writeInsight
    // returns the minted id (the has_insight edge is consolidator-specific;
    // writeInsight emits capturedBy, not has_insight).
    const writer = this._ensureObservationWriter();
    const row = {
      // The mapper's name field reads from row.topic||row.summary; the
      // mapper mints a fresh id (legacyId.id captures row.id as the
      // SQLite-id surrogate). Pass entry.topic as both topic AND id so
      // the legacy-id round-trips as the consolidator's stable key.
      id: entry.topic,
      topic: entry.topic,
      summary: entry.summary || entry.topic,
      // entityType/ontologyClass on the row are aspirational — the mapper
      // currently hardcodes 'Insight' for both. The Task 1 guard preserves
      // 'Insight' (not the old 'Detail' clobber); the L2 classification
      // (entityClass) is recorded in metadata.ontology for audit.
      entityType: entityClass,
      ontologyClass: entityClass,
      team: project,
      source: 'online',
      confidence: entry.confidence,
      created_at: new Date().toISOString(),
      metadata: {
        // Mapper preserves these on metadata; we stamp project (D-02
        // from Phase 57), the consolidator's source label, and the
        // ontology audit trail.
        source: 'online',
        team: project,
        project,
        confidence: entry.confidence,
        digest_ids: entry._digestIds || [],
        ontology: {
          ontologyName: 'development-knowledge-ontology',
          classificationMethod: 'heuristic-token-overlap',
          classificationConfidence: classConf,
        },
      },
    };

    let mintedId;
    try {
      // D-03 — writeInsight now returns {legacyId, mintedId} directly; no post-write
      // findByLegacyId race lookup needed. The Phase 59 root-cause closure for ORPHAN-INS-01.
      const result = await writer.writeInsight(row, { mentionsTargetIds });
      mintedId = result.mintedId;
    } catch (err) {
      process.stderr.write(`[Consolidator→KG] writeInsight failed for ${entry.topic}: ${err.message}\n`);
      return;
    }

    if (this._kgPushDebug) {
      process.stderr.write(
        `[Consolidator→KG] ${entry.topic} → ${entityClass} (${classConf.toFixed(2)}) team=${project} mintedId=${mintedId} mentions=${mentionsTargetIds.length}\n`
      );
    }

    // Phase 58 Plan 02 (D-06 preserve) — emit the has_insight project-
    // anchor edge via kmStore.addRelation. Lands within the same exporter
    // debounce window as writeInsight's emissions, so the JSON export tick
    // captures node + capturedBy + mentions + has_insight together. Dedup
    // probe before write because km-core addRelation is NOT idempotent on
    // the (from, to, type) triple (Shared Pattern A from PATTERNS).
    if (projectName && mintedId) {
      try {
        const projects = await this._kmStore.findByOntologyClass('Project');
        const projectId = projects.find((p) => p.name === projectName)?.id;
        if (projectId) {
          const existingHasInsight = await this._kmStore.findRelations({
            from: projectId,
            to: mintedId,
            type: 'has_insight',
          });
          if (!Array.isArray(existingHasInsight) || existingHasInsight.length === 0) {
            await this._kmStore.addRelation({
              from: projectId,
              to: mintedId,
              type: 'has_insight',
              metadata: {
                source: 'observation-consolidator',
                team: project,
                confidence: 1.0,
              },
            });
          }
        }
      } catch (err) {
        process.stderr.write(`[Consolidator→KG] has_insight ${projectName} → ${entry.topic} failed: ${err.message}\n`);
      }
    }
  }

  /**
   * Cache of resolved project anchor names keyed by team slug, so the
   * insight push doesn't make a `/api/entities` round-trip per call.
   * Cleared between runs by leaving it as an instance field.
   */
  _projectAnchorCache = new Map();

  /**
   * Return the canonical Project entity name for a team, creating one
   * if missing. Maps slug-style team names (rapid-automations,
   * onboarding-repro) to PascalCase entity names (RapidAutomations,
   * OnboardingRepro) so they can serve as the anchor inside the
   * viewer's hierarchy.
   *
   * Returns null if the VKB is unavailable; the caller skips the
   * relation step in that case.
   */
  async _ensureProjectAnchor(vkbUrl, team) {
    if (this._projectAnchorCache.has(team)) return this._projectAnchorCache.get(team);
    const name = team
      .split(/[-_]/)
      .filter(Boolean)
      .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase())
      .join('');
    if (!name) return null;
    try {
      // Idempotent PUT — if the entity already exists this just
      // refreshes last_modified; if not, it creates a Project entity
      // for the team. We preserve any prior source by NOT passing
      // `source` (the writer falls back to 'manual' for true new
      // entities, which is correct for a project anchor).
      const r = await fetch(
        `${vkbUrl}/api/entities/${encodeURIComponent(name)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityType: 'Project',
            observations: [`Project anchor for the ${team} team — auto-created by the observation consolidator so online-learned insights have a parent in the graph.`],
            significance: 8,
            team,
          }),
        }
      );
      if (!r.ok) {
        process.stderr.write(`[Consolidator→KG] project anchor ${name} failed ${r.status}\n`);
        this._projectAnchorCache.set(team, null);
        return null;
      }
      this._projectAnchorCache.set(team, name);
      // Link the new Project to the central CollectiveKnowledge
      // (which lives in the coding team) so projects from any team
      // hang off the same root node in the viewer instead of forming
      // disconnected sub-graphs. Idempotent — repeat POSTs are
      // tolerated server-side.
      try {
        await fetch(`${vkbUrl}/api/relations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'CollectiveKnowledge',
            to: name,
            type: 'includes',
            team: 'coding',
            fromTeam: 'coding',
            toTeam: team,
            confidence: 1.0,
          }),
        });
      } catch (err) {
        process.stderr.write(`[Consolidator→KG] CollectiveKnowledge → ${name} failed: ${err.message}\n`);
      }
      return name;
    } catch (err) {
      process.stderr.write(`[Consolidator→KG] project anchor ${name} failed: ${err.message}\n`);
      this._projectAnchorCache.set(team, null);
      return null;
    }
  }

  /**
   * Extract the project label from an observation's metadata JSON.
   * Returns 'unknown' for missing/malformed metadata so partitioning is total.
   */
  _extractProject(metadataJson) {
    if (!metadataJson) return 'unknown';
    try {
      const m = JSON.parse(metadataJson);
      return (m && typeof m.project === 'string' && m.project) || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Lazily-initialized ReliableCodingClassifier. Only the isCoding signal
   * is consumed: per Phase A design we promote null-project rows to
   * 'coding' when classified positive, or leave them as 'unknown'.
   * Returns null if init fails — callers must fail open.
   */
  async _getClassifier() {
    if (this._classifierInitAttempted) return this._classifier;
    this._classifierInitAttempted = true;
    try {
      const Mod = await import('./ReliableCodingClassifier.js');
      const Cls = Mod.default || Mod.ReliableCodingClassifier;
      this._classifier = new Cls();
    } catch (err) {
      process.stderr.write(`[Consolidator] Classifier unavailable (non-fatal): ${err.message}\n`);
      this._classifier = null;
    }
    return this._classifier;
  }

  /**
   * Backfill `metadata.project` for any null-project observations in the
   * batch. Mutates in-place. The classifier only signals coding-vs-other,
   * so positive results promote to 'coding'; everything else stays
   * 'unknown'. Persists the resolved project back to the DB so future
   * passes don't re-classify the same row.
   */
  async _backfillProjectsInBatch(observations) {
    const nulls = observations.filter(o => this._extractProject(o.metadata) === 'unknown'
      && !this._isMetadataExplicitUnknown(o.metadata));
    if (nulls.length === 0) return;

    const classifier = await this._getClassifier();
    if (!classifier) {
      process.stderr.write(`[Consolidator] Skipping classifier backfill — classifier unavailable\n`);
      return;
    }

    // Phase 44 Plan 17: persist the resolved project via km-core
    // mergeAttributes. Each legacy row carries `_entity` (attached by
    // `_toLegacyObsRow`) so we don't pay a per-row findByLegacyId lookup.
    if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    const kmStore = this._kmStore;
    let promoted = 0;
    for (const o of nulls) {
      let project = 'unknown';
      try {
        const r = await classifier.classify({
          userMessage: o.summary,
          timestamp: o.created_at || new Date().toISOString(),
        });
        if (r?.isCoding) {
          project = 'coding';
          promoted++;
        }
      } catch { /* leave as unknown */ }
      try {
        const entity = o._entity
          || await kmStore.findByLegacyId({ system: 'A', id: o.id });
        if (entity) {
          const prev = entity.metadata ?? {};
          await kmStore.mergeAttributes(entity.id, {
            metadata: { ...prev, project },
          });
        }
      } catch { /* swallow — partitioning still works against in-memory copy */ }
      // Reflect the resolved project back into the in-memory row so the
      // partition step that follows sees the new label.
      try {
        const m = o.metadata ? JSON.parse(o.metadata) : {};
        m.project = project;
        o.metadata = JSON.stringify(m);
      } catch { /* keep original metadata; partitioning will fall back to 'unknown' */ }
    }
    if (promoted > 0) {
      process.stderr.write(`[Consolidator] Classifier backfill promoted ${promoted}/${nulls.length} null-project obs to 'coding'\n`);
    }
  }

  /**
   * True when metadata explicitly carries project='unknown' (i.e. has been
   * classified before). Used to avoid re-running the classifier on rows
   * a previous pass already decided about.
   */
  _isMetadataExplicitUnknown(metadataJson) {
    if (!metadataJson) return false;
    try {
      const m = JSON.parse(metadataJson);
      return m && m.project === 'unknown';
    } catch { return false; }
  }

  /**
   * Lazily-initialized fastembed + Qdrant client (shared with insight path).
   * Returns null if either resource is unavailable; callers must fail open.
   * @returns {Promise<{embed: (text: string) => Promise<number[]>, qdrant: any}|null>}
   */
  async _getEmbedder() {
    if (!this._embeddingService) {
      try {
        const mod = await import('../../dist/embedding/embedding-service.js');
        this._embeddingService = mod.getEmbeddingService();
        await this._embeddingService.initialize();
      } catch (err) {
        process.stderr.write(`[Consolidator] Embedding service unavailable: ${err.message}\n`);
        return null;
      }
    }
    if (!this._qdrantClient) {
      try {
        const mod = await import('../../dist/embedding/qdrant-collections.js');
        this._qdrantClient = mod.getQdrantClient();
      } catch (err) {
        process.stderr.write(`[Consolidator] Qdrant client unavailable: ${err.message}\n`);
        return null;
      }
    }
    return {
      embed: (text) => this._embeddingService.embedOne(text),
      qdrant: this._qdrantClient,
    };
  }

  /**
   * Build a merge plan for a batch of new digests against same-date duplicates.
   *
   * Returns an array parallel to digestEntries. Each element is either:
   *   { action: 'insert' }                       — write a new row
   *   { action: 'merge', targetId: string }      — merge into existing/earlier id
   *
   * Cross-batch resolution: query Qdrant `digests` collection filtered by
   * date == entry.date for any score >= DIGEST_DEDUP_THRESHOLD.
   *
   * Within-batch resolution: pairwise cosine on this batch's freshly-embedded
   * vectors, greedy from highest sim down. The first occurrence wins; later
   * entries that match it are folded into it.
   *
   * Fails open: returns all 'insert' if embedding/Qdrant are unavailable.
   *
   * @param {Array<object>} digestEntries
   * @param {string} date
   * @returns {Promise<Array<{action: 'insert'|'merge', targetId?: string}>>}
   */
  async _buildDigestMergePlan(digestEntries, date) {
    const fallback = digestEntries.map(() => ({ action: 'insert' }));
    if (!digestEntries || digestEntries.length === 0) return fallback;

    const tools = await this._getEmbedder();
    if (!tools) return fallback;

    const vectors = [];
    for (const entry of digestEntries) {
      const text = `${entry.theme ?? ''}\n\n${entry.summary ?? ''}`.trim();
      if (!text) {
        vectors.push(null);
        continue;
      }
      try {
        vectors.push(await tools.embed(text));
      } catch (err) {
        process.stderr.write(`[Consolidator] Digest embed failed: ${err.message}\n`);
        vectors.push(null);
      }
    }

    const plan = digestEntries.map(() => ({ action: 'insert' }));

    // Cross-batch: search Qdrant for an existing same-date AND same-project
    // digest above threshold. Same-day work in two separate projects must
    // never collapse into a single digest row.
    for (let i = 0; i < digestEntries.length; i++) {
      if (!vectors[i]) continue;
      const project = digestEntries[i].project || 'unknown';
      try {
        const hits = await tools.qdrant.search('digests', {
          vector: vectors[i],
          limit: 1,
          score_threshold: DIGEST_DEDUP_THRESHOLD,
          with_payload: true,
          with_vector: false,
          filter: {
            must: [
              { key: 'date', match: { value: date } },
              { key: 'project', match: { value: project } },
            ],
          },
        });
        if (hits && hits.length > 0) {
          plan[i] = { action: 'merge', targetId: String(hits[0].id) };
        }
      } catch (err) {
        process.stderr.write(`[Consolidator] Digest Qdrant search failed (non-fatal): ${err.message}\n`);
      }
    }

    // Within-batch: greedy pairwise. Earlier entries (or the cross-batch
    // target the entry already merges into) absorb later ones — but only
    // when they share the same project label.
    const cosine = (a, b) => {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
      return na && nb ? dot / Math.sqrt(na * nb) : 0;
    };
    for (let i = 1; i < digestEntries.length; i++) {
      if (!vectors[i] || plan[i].action === 'merge') continue;
      const projectI = digestEntries[i].project || 'unknown';
      let bestJ = -1, bestSim = 0;
      for (let j = 0; j < i; j++) {
        if (!vectors[j]) continue;
        const projectJ = digestEntries[j].project || 'unknown';
        if (projectJ !== projectI) continue;
        const sim = cosine(vectors[i], vectors[j]);
        if (sim >= DIGEST_DEDUP_THRESHOLD && sim > bestSim) {
          bestSim = sim;
          bestJ = j;
        }
      }
      if (bestJ >= 0) {
        // Merge into entry j's eventual target — either j's pre-existing
        // merge target or j's own id (still being inserted as new).
        const target = plan[bestJ].action === 'merge'
          ? plan[bestJ].targetId
          : digestEntries[bestJ].id;
        plan[i] = { action: 'merge', targetId: target };
      }
    }

    return plan;
  }

  /**
   * Initialize the consolidator. Phase 44 Plan 17: no SQLite handle, no
   * schema/index DDL, no ObservationExporter wiring (km-core has its own
   * per-domain JSON export under `.data/knowledge-graph/exports/`). The
   * caller MUST have supplied `options.kmStore` in the constructor; the
   * first read/write throws otherwise (same fail-fast posture as
   * ObservationWriter post-Plan-44-13).
   *
   * Only side-effect: initialize the PII/secret redactor.
   */
  async init() {
    // Initialize redactor for PII/secret scrubbing (defense-in-depth for LLM outputs)
    try {
      const projectRoot = path.resolve(path.dirname(this.dbPath), '..');
      this._redactor = new ConfigurableRedactor({
        configDir: path.join(projectRoot, '.specstory', 'config'),
      });
      await this._redactor.initialize();
    } catch (err) {
      process.stderr.write(`[Consolidator] Redactor init failed: ${err.message}\n`);
      this._redactor = null;
    }
  }

  /**
   * Redact PII/secrets from text. Falls back to identity if redactor unavailable.
   * @param {string} text
   * @returns {string}
   */
  _redact(text) {
    if (!text || !this._redactor) return text;
    try { return this._redactor.redact(text); } catch { return text; }
  }

  /**
   * Path-safe redaction: only applies user-ID and home-directory patterns.
   * The full _redact() has broad patterns (e.g. 40-char alphanum → AWS secret)
   * that corrupt file paths and JSON-stringified metadata. This method is safe
   * for structured data like files_touched and metadata fields.
   * @param {string} text
   * @returns {string}
   */
  _redactPaths(text) {
    if (!text) return text;
    try {
      // Replace corporate user IDs (same pattern as ConfigurableRedactor)
      let result = text.replace(/\bq[0-9a-zA-Z]{6}\b/gi, '<USER_ID_REDACTED>');
      // Normalize home directory paths
      const home = process.env.HOME || process.env.USERPROFILE || '';
      if (home) {
        result = result.split(home).join('<HOME>');
      }
      return result;
    } catch { return text; }
  }

  /**
   * Consolidate a single day's observations into thematic digests.
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<{digests: number, observations: number}>}
   */
  async consolidateDay(date) {
    if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    const kmStore = this._kmStore;

    // Phase 44 Plan 17: per-day undigested-observations scan over km-core.
    // The previous SQLite path used an indexed lookup; km-core has no
    // attribute index in graphology v0.26, so we iterate the Observation
    // class once and predicate in-memory. At ~4k observations the pass
    // is sub-millisecond (cost model — GraphKMStore.ts:594-596).
    const allObsEntities = await kmStore.findByOntologyClass('Observation');
    const observations = allObsEntities
      .filter(e => {
        const m = e.metadata ?? {};
        const created = typeof m.createdAt === 'string' ? m.createdAt : '';
        if (created.slice(0, 10) !== date) return false;
        // Option A idempotency anchor: skip rows already marked digested.
        if (m.digested_at) return false;
        if (m.quality === 'low') return false;
        return true;
      })
      .sort((a, b) => {
        const ta = a.metadata?.createdAt ?? '';
        const tb = b.metadata?.createdAt ?? '';
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        return 0;
      })
      .map(e => this._toLegacyObsRow(e));

    if (observations.length === 0) {
      process.stderr.write(`[Consolidator] No undigested observations for ${date}\n`);
      return { digests: 0, observations: 0 };
    }

    // Resolve any null-project observations via the classifier before
    // partitioning. Phase A handled the historical backlog; this catches
    // any new rows that arrive without metadata.project populated.
    await this._backfillProjectsInBatch(observations);

    // Partition by project so each LLM run sees a single project's
    // narrative. Without this, mixed-project days produce digests that
    // lump unrelated work under the wrong project label and break the
    // downstream per-project filter.
    const byProject = new Map();
    for (const o of observations) {
      const p = this._extractProject(o.metadata);
      if (!byProject.has(p)) byProject.set(p, []);
      byProject.get(p).push(o);
    }

    const breakdown = [...byProject.entries()]
      .map(([p, list]) => `${p}=${list.length}`).join(', ');
    process.stderr.write(`[Consolidator] Consolidating ${observations.length} observations for ${date} (${breakdown})\n`);

    // Chunk large groups to avoid LLM timeouts (max ~35 observations per call)
    const CHUNK_SIZE = 35;
    const allDigestEntries = [];

    for (const [project, projObs] of byProject) {
      const chunks = [];
      for (let i = 0; i < projObs.length; i += CHUNK_SIZE) {
        chunks.push(projObs.slice(i, i + CHUNK_SIZE));
      }

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const globalOffset = ci * CHUNK_SIZE;

        const obsBlock = chunk.map((o, i) => {
          const time = o.created_at.split('T')[1]?.slice(0, 5) || '??:??';
          return `[${globalOffset + i + 1}] ${time} (${o.agent || 'unknown'}) ${o.summary}`;
        }).join('\n\n');

        const prompt = this._buildConsolidationPrompt(date, obsBlock, chunk.length);
        const result = await this._callLLM(prompt, 'consolidator-digest');

        if (!result) {
          process.stderr.write(`[Consolidator] LLM call failed for ${date}/${project} chunk ${ci + 1}/${chunks.length}, skipping chunk\n`);
          continue;
        }

        // Parse with the chunk's observations but map indices relative to global offset
        const chunkDigests = this._parseDigests(result, date, chunk, globalOffset);
        // Tag every digest with the project so downstream merge planning
        // and INSERT both have access to it.
        for (const d of chunkDigests) d.project = project;
        allDigestEntries.push(...chunkDigests);
      }
    }

    const digestEntries = allDigestEntries;
    if (digestEntries.length === 0) {
      process.stderr.write(`[Consolidator] No digests parsed from LLM response for ${date}\n`);
      return { digests: 0, observations: 0 };
    }

    // Write digests and mark observations as digested via km-core.
    const now = new Date().toISOString();

    // Build merge plan via embedding similarity (async, pre-write phase).
    const mergePlan = await this._buildDigestMergePlan(digestEntries, date);

    // Sanitize each entry: dedupe files_touched (drop bare basenames
    // when the full path is also present), recover any redaction
    // corruption from in-context sibling fields.
    for (let i = 0; i < digestEntries.length; i++) {
      const cleaned = this._sanitizeDigestEntry(digestEntries[i]);
      digestEntries[i] = { ...digestEntries[i], ...cleaned };
    }

    const QUALITY_RANK = { high: 3, normal: 2, low: 1 };
    const mergedTargets = new Set();
    let createdCount = 0;
    let mergedCount = 0;

    const digestedObsIds = new Set();

    // Phase 44 Plan 17: the SQLite db.transaction() wrapper is GONE.
    // Each putEntity/mergeAttributes is its own atomic km-core write;
    // partial-failure semantics match what the SQLite path provided when
    // a crash interrupted a transaction (the in-flight rows are lost,
    // remaining digests stay merged or inserted).
    for (let i = 0; i < digestEntries.length; i++) {
      const d = digestEntries[i];
      const decision = mergePlan[i] ?? { action: 'insert' };

      if (decision.action === 'merge' && decision.targetId) {
        const targetEntity = await kmStore.findByLegacyId({ system: 'A', id: decision.targetId });
        if (targetEntity) {
          const target = this._toLegacyDigestRow(targetEntity);
          const oidUnion = new Set();
          for (const oid of (() => { try { return JSON.parse(target.observation_ids || '[]'); } catch { return []; } })()) oidUnion.add(oid);
          for (const oid of (d.observationIds || [])) oidUnion.add(oid);

          const agentUnion = new Set();
          for (const a of (() => { try { return JSON.parse(target.agents || '[]'); } catch { return []; } })()) agentUnion.add(a);
          for (const a of (d.agents || [])) agentUnion.add(a);

          const fileUnion = new Set();
          for (const f of (() => { try { return JSON.parse(target.files_touched || '[]'); } catch { return []; } })()) fileUnion.add(f);
          for (const f of (d.filesTouched || [])) fileUnion.add(f);

          const winnerSummary = (target.summary?.length ?? 0) >= (d.summary?.length ?? 0)
            ? target.summary
            : this._redact(d.summary);
          const bestQuality = (QUALITY_RANK[d.quality] ?? 0) > (QUALITY_RANK[target.quality] ?? 0)
            ? d.quality
            : target.quality;

          // mergeAttributes preserves entity.id, top-level legacyId, createdBy,
          // validFrom — only the supplied keys are spread into existing
          // attributes. Stamp the redacted-files-touched list back into
          // metadata.files_touched (matches the SQLite column name).
          const prevMeta = targetEntity.metadata ?? {};
          await kmStore.mergeAttributes(targetEntity.id, {
            description: winnerSummary,
            updatedAt: now,
            metadata: {
              ...prevMeta,
              observation_ids: [...oidUnion],
              agents: [...agentUnion],
              files_touched: (() => {
                try { return JSON.parse(this._redactPaths(JSON.stringify([...fileUnion]))); }
                catch { return [...fileUnion]; }
              })(),
              summary: winnerSummary,
              quality: bestQuality,
              createdAt: now,
            },
          });
          mergedTargets.add(decision.targetId);
          mergedCount++;
          for (const obsId of d.observationIds || []) digestedObsIds.add(obsId);
          continue;
        }
        // target row missing — fall through to insert
      }

      // Plain insert: build a LegacyDigestRow and persist via the shared
      // legacy-ingest adapter (single source of truth for entityType /
      // ontologyClass / legacyId / Phase 39 D-30 provenance shape).
      const row = {
        id: d.id,
        date: d.date,
        theme: this._redact(d.theme),
        summary: this._redact(d.summary),
        observation_ids: d.observationIds,
        agents: d.agents,
        files_touched: (() => {
          try { return JSON.parse(this._redactPaths(JSON.stringify(d.filesTouched || []))); }
          catch { return d.filesTouched || []; }
        })(),
        quality: d.quality,
        created_at: now,
        metadata: (() => {
          try { return JSON.parse(this._redactPaths(JSON.stringify(d.metadata || {}))); }
          catch { return d.metadata || {}; }
        })(),
        project: d.project || 'unknown',
      };
      const entity = legacyDigestToEntity(row, this._runId, now);
      const digestMintedId = await kmStore.putEntity(entity, { skipOntologyCheck: true });
      // ORPHAN-DIG-01 (Phase 59 D-02) — emit one `derivedFrom` edge per
      // observation_id referenced by this Digest, in the SAME try-block as
      // putEntity. The km-core JSON exporter's 5s debounce captures
      // putEntity + every addRelation in one export tick (Phase 58 D-04
      // atomicity envelope, applied verbatim to Digests).
      //
      // No probe-before-write per D-02.1 — `_buildDigestMergePlan` (above)
      // dedupes upstream, so the plain-insert branch only runs for
      // genuinely new Digests. The repair script (Plan 59-04 Layer 1) is
      // the idempotent re-run path that DOES probe.
      //
      // D-02.2 — unresolved observation_ids (findByLegacyId returns null)
      // are skipped non-fatally; the Digest still lands with its remaining
      // edges, and the missing edge is picked up by the next repair-script
      // run.
      const obsIds = Array.isArray(d.observationIds) ? d.observationIds : [];
      for (const obsId of obsIds) {
        if (!obsId) continue;
        let obsEntity;
        try {
          obsEntity = await kmStore.findByLegacyId({ system: 'A', id: obsId });
        } catch (err) {
          process.stderr.write(`[Consolidator] derivedFrom: findByLegacyId ${obsId.slice(0, 8)} failed (non-fatal): ${err.message}\n`);
          continue;
        }
        if (!obsEntity) {
          process.stderr.write(`[Consolidator] derivedFrom: observation ${obsId.slice(0, 8)} not yet persisted, skipping edge\n`);
          continue;
        }
        try {
          await kmStore.addRelation({
            from: digestMintedId,
            to: obsEntity.id,
            type: 'derivedFrom',
            metadata: {
              source: 'observation-consolidator',
              confidence: 1.0,
              addedAt: new Date().toISOString(),
            },
          });
        } catch (err) {
          process.stderr.write(`[Consolidator] derivedFrom edge ${digestMintedId}->${obsEntity.id} failed (non-fatal): ${err.message}\n`);
        }
      }
      createdCount++;
      for (const obsId of d.observationIds) digestedObsIds.add(obsId);
    }

    // Option A idempotency: stamp `metadata.digested_at` on every consumed
    // Observation entity so subsequent consolidator passes skip them. The
    // SQLite path used an indexed UPDATE; km-core uses findByLegacyId +
    // mergeAttributes per id (no batch helper exists yet — acceptable cost
    // because digestedObsIds is bounded by the day's observation count).
    for (const obsId of digestedObsIds) {
      try {
        const obsEntity = await kmStore.findByLegacyId({ system: 'A', id: obsId });
        if (!obsEntity) continue;
        await kmStore.mergeAttributes(obsEntity.id, {
          metadata: { ...(obsEntity.metadata ?? {}), digested_at: now },
        });
      } catch (err) {
        process.stderr.write(`[Consolidator] Mark-digested failed for ${obsId.slice(0, 8)}: ${err.message}\n`);
      }
    }

    if (mergedCount > 0) {
      process.stderr.write(`[Consolidator] Digest dedup: ${mergedCount} merged into existing/earlier rows, ${createdCount} new\n`);
    }

    // Fire-and-forget: publish embedding events for new (and updated) digests
    for (let i = 0; i < digestEntries.length; i++) {
      const d = digestEntries[i];
      const decision = mergePlan[i] ?? { action: 'insert' };
      const id = decision.action === 'merge' && decision.targetId ? decision.targetId : d.id;
      this._publishEmbeddingEvent('digest', id, d.summary, {
        date: now.slice(0, 10),
        theme: d.theme,
        agents: JSON.stringify(d.agents),
        quality: d.quality || 'normal',
        project: d.project || 'unknown',
      });
    }

    process.stderr.write(`[Consolidator] Created ${digestEntries.length} digests from ${digestedObsIds.size} observations for ${date}\n`);
    return { digests: digestEntries.length, observations: digestedObsIds.size };
  }

  /**
   * Consolidate all days with undigested observations.
   * @param {Object} [options]
   * @param {boolean} [options.includeToday=false] - Include today's observations (skip for daemon, include for manual trigger)
   * @returns {Promise<{days: number, digests: number, observations: number}>}
   */
  async consolidateAll({ includeToday = false } = {}) {
    if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    const kmStore = this._kmStore;

    // Phase 44 Plan 17: enumerate distinct days carrying undigested
    // observations via a single class scan + in-memory Set. The previous
    // SQLite path used a DISTINCT-substring SELECT; this is the same
    // semantics with an O(N_Observation) cost.
    const allObsEntities = await kmStore.findByOntologyClass('Observation');
    const dateSet = new Set();
    for (const e of allObsEntities) {
      const m = e.metadata ?? {};
      if (m.digested_at) continue;
      if (m.quality === 'low') continue;
      const created = typeof m.createdAt === 'string' ? m.createdAt : '';
      const day = created.slice(0, 10);
      if (day) dateSet.add(day);
    }
    const days = [...dateSet].sort().map(date => ({ date }));

    const today = new Date().toISOString().split('T')[0];
    const eligibleDays = includeToday ? days : days.filter(d => d.date < today);

    if (eligibleDays.length === 0) {
      process.stderr.write(`[Consolidator] No days with undigested observations\n`);
      return { days: 0, digests: 0, observations: 0 };
    }

    let totalDigests = 0;
    let totalObs = 0;
    const totalDays = eligibleDays.length;

    process.stderr.write(`[Consolidator] Stage 1/2: consolidating ${totalDays} day(s) of observations\n`);
    for (let i = 0; i < totalDays; i++) {
      const { date } = eligibleDays[i];
      // The leading "Day N/M" prefix is what the dashboard's status endpoint
      // surfaces as the user-visible progress indicator (the heartbeat's
      // lastMessage carries the most recent stderr line).
      process.stderr.write(`[Consolidator] Day ${i + 1}/${totalDays}: ${date} — grouping observations\n`);
      const result = await this.consolidateDay(date);
      totalDigests += result.digests;
      totalObs += result.observations;
      process.stderr.write(`[Consolidator] Day ${i + 1}/${totalDays}: ${date} — ${result.digests} digest(s) from ${result.observations} obs\n`);
    }

    process.stderr.write(`[Consolidator] Stage 1/2 complete: ${totalDays} days → ${totalDigests} digests from ${totalObs} observations\n`);
    return { days: eligibleDays.length, digests: totalDigests, observations: totalObs };
  }

  /**
   * Synthesize digests into persistent project insights.
   * Merges with existing insights when topics overlap.
   * @returns {Promise<{created: number, updated: number}>}
   */
  async synthesizeInsights() {
    if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    const kmStore = this._kmStore;

    // Phase 44 Plan 17: compute "unsynthesized digests" as the set of
    // Digest entities whose legacyId.id appears in NO Insight's
    // metadata.digest_ids array. The SQLite LEFT-JOIN against
    // json_each(i.digest_ids) becomes a Set union + filter in-memory.
    const [digestEntities, insightEntitiesForGate] = await Promise.all([
      kmStore.findByOntologyClass('Digest'),
      kmStore.findByOntologyClass('Insight'),
    ]);
    const synthesizedDigestIds = new Set();
    for (const ins of insightEntitiesForGate) {
      const m = ins.metadata ?? {};
      if (Array.isArray(m.digest_ids)) {
        for (const id of m.digest_ids) synthesizedDigestIds.add(id);
      }
    }
    const digests = digestEntities
      .map(e => this._toLegacyDigestRow(e))
      .filter(d => !synthesizedDigestIds.has(d.id))
      .sort((a, b) => {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        return 0;
      });

    if (digests.length === 0) {
      process.stderr.write(`[Consolidator] No unsynthesized digests\n`);
      return { created: 0, updated: 0 };
    }

    // Partition digests by project. Cross-project synthesis would let an
    // unrelated insight from project B contaminate project A's narrative,
    // and the produced insight would still get a single project label,
    // dropping the other on the floor.
    const digestsByProject = new Map();
    for (const d of digests) {
      const p = d.project || 'unknown';
      if (!digestsByProject.has(p)) digestsByProject.set(p, []);
      digestsByProject.get(p).push(d);
    }

    // Existing insights are loaded once and filtered per project so each
    // synthesis run only sees in-domain prior knowledge. The legacy SQLite
    // path sorted by last_updated DESC; we replicate that here.
    const allExistingInsights = insightEntitiesForGate
      .map(e => this._toLegacyInsightRow(e))
      .sort((a, b) => {
        const ta = a.last_updated || '';
        const tb = b.last_updated || '';
        if (ta < tb) return 1;
        if (ta > tb) return -1;
        return 0;
      });

    const breakdown = [...digestsByProject.entries()]
      .map(([p, list]) => `${p}=${list.length}`).join(', ');
    const totalProjects = digestsByProject.size;
    process.stderr.write(`[Consolidator] Stage 2/2: synthesizing ${digests.length} digests into insights — ${totalProjects} project(s): ${breakdown}\n`);

    // 2026-06-12: dropped from 5 → 2. Copilot's edge consistently 502s
    // on insight-synthesis prompts that bundle 5 full digests (~15KB
    // input), but handles 2-digest chunks comfortably (curl probes:
    // 1.2s with copilot/haiku, 2.1s with copilot/sonnet). Doubles the
    // chunk count, but each succeeds — net throughput is roughly equal
    // and reliability is dramatically better.
    const DIGEST_CHUNK_SIZE = 2;
    const allInsightEntries = [];

    let projectIdx = 0;
    for (const [project, projDigests] of digestsByProject) {
      projectIdx++;
      process.stderr.write(`[Consolidator] Project ${projectIdx}/${totalProjects}: ${project} — synthesizing ${projDigests.length} digest(s)\n`);
      const existingForProject = allExistingInsights.filter(
        i => (i.project || 'unknown') === project
      );

      // Pre-tokenize every existing insight once. With 30+ insights summing to
      // ~30k+ tokens, passing them all into every chunk pegs the prompt at
      // ~38k input and pushes the response past max_tokens — chunks return
      // empty content. Topical filter picks ~10 relevant ones per chunk.
      const existingTokens = existingForProject.map(i => ({
        ref: i,
        tokens: this._tokenize(`${i.topic} ${i.summary}`),
      }));
      const RELEVANT_K = 10;

      const digestChunks = [];
      for (let i = 0; i < projDigests.length; i += DIGEST_CHUNK_SIZE) {
        digestChunks.push(projDigests.slice(i, i + DIGEST_CHUNK_SIZE));
      }

      // 2026-06-12: chunks within the same project no longer run strictly
      // sequentially — each Sonnet call is 60-90s, and at 22 chunks the
      // pass took ~25min wall-clock. We now process chunks in BATCHES of
      // CHUNK_CONCURRENCY: every chunk in a batch fires its LLM call
      // concurrently and sees the same `projectInsightEntries` snapshot
      // (the cross-chunk awareness ONLY needs to look at *prior* batches'
      // results — chunks within a batch can't see each other anyway, and
      // the post-batch merge folds them in for the next batch's view).
      // Net: 4x wall-clock speedup with the same quality / dedup behavior
      // we had with the old in-batch group of size 1.
      const CHUNK_CONCURRENCY = 4;
      let projectInsightEntries = [];

      const buildChunkPrompt = (chunk, snapshot) => {
        const digestBlock = chunk.map(d =>
          `[${d.date}] ${d.theme}\n${d.summary}`
        ).join('\n\n---\n\n');

        // Score existing insights by topical overlap with this chunk's
        // digests. Insights produced in *prior batches* of the same
        // project run are kept whole (small set) so the LLM still sees
        // them and can merge into them rather than restate.
        const chunkTokens = this._tokenize(
          chunk.map(d => `${d.theme} ${d.summary}`).join(' ')
        );
        const relevantExisting = existingTokens
          .map(e => ({ entry: e.ref, score: this._jaccard(chunkTokens, e.tokens) }))
          .filter(e => e.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, RELEVANT_K)
          .map(e => ({ topic: e.entry.topic, summary: e.entry.summary }));
        const currentInsights = [
          ...relevantExisting,
          ...snapshot,
        ];
        const existingBlock = currentInsights.length > 0
          ? currentInsights.map(i => `## ${i.topic}\n${i.summary}`).join('\n\n')
          : 'None yet.';

        return this._buildInsightPrompt(digestBlock, existingBlock, chunk.length);
      };

      for (let batchStart = 0; batchStart < digestChunks.length; batchStart += CHUNK_CONCURRENCY) {
        const batchEnd = Math.min(batchStart + CHUNK_CONCURRENCY, digestChunks.length);
        const snapshot = [...projectInsightEntries];

        // Fire each chunk in the batch concurrently. Each promise resolves
        // to `{ ci, chunkInsights }` (or null on LLM failure).
        const batchPromises = [];
        for (let ci = batchStart; ci < batchEnd; ci++) {
          const chunk = digestChunks[ci];
          process.stderr.write(`[Consolidator] Insight synthesis ${project} chunk ${ci + 1}/${digestChunks.length} (${chunk.length} digests)\n`);
          const prompt = buildChunkPrompt(chunk, snapshot);
          batchPromises.push(
            this._callLLM(prompt, 'consolidator-insight').then((result) => {
              if (!result) {
                process.stderr.write(`[Consolidator] LLM call failed for ${project} insight chunk ${ci + 1}, skipping\n`);
                return null;
              }
              const chunkInsights = this._parseInsights(result, chunk);
              for (const ni of chunkInsights) {
                ni.project = project;
                ni._digestIds = chunk.map(d => d.id);
              }
              return chunkInsights;
            })
          );
        }

        const batchResults = await Promise.all(batchPromises);
        // Merge in deterministic order (ci-asc within the batch) so a
        // topic produced by two chunks in the same batch keeps the later
        // chunk's version with merged digest provenance — same semantic
        // as the prior sequential loop.
        for (const chunkInsights of batchResults) {
          if (!chunkInsights) continue;
          for (const newInsight of chunkInsights) {
            const existingIdx = projectInsightEntries.findIndex(e => e.topic === newInsight.topic);
            if (existingIdx >= 0) {
              const prior = projectInsightEntries[existingIdx]._digestIds || [];
              newInsight._digestIds = [...new Set([...prior, ...newInsight._digestIds])];
              projectInsightEntries[existingIdx] = newInsight;
            } else {
              projectInsightEntries.push(newInsight);
            }
          }
        }
      }

      allInsightEntries.push(...projectInsightEntries);
    }

    const insightEntries = allInsightEntries;
    if (insightEntries.length === 0) {
      process.stderr.write(`[Consolidator] No insights produced from any chunk\n`);
      return { created: 0, updated: 0 };
    }

    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    const embeddingQueue = [];

    // Phase 1 (async, pre-transaction): resolve each new entry to an
    // existing insight via embedding similarity. The transaction itself
    // must stay synchronous — better-sqlite3 transactions don't support
    // awaits — so we precompute the merge targets here.
    for (const entry of insightEntries) {
      try {
        entry._similarMatch = await this._findSimilarInsightId(entry);
      } catch (err) {
        process.stderr.write(`[Consolidator] Similarity check failed (non-fatal): ${err.message}\n`);
        entry._similarMatch = null;
      }

      // Sanitize summary against any in-row corruption. Insights have no
      // explicit files_touched field, so the only context is the topic
      // line — but a clean reference to the same path elsewhere in the
      // summary itself can still recover via in-context match.
      try {
        const sanitizer = this._getSanitizer();
        const out = sanitizer.sanitizeText(entry.summary || '', [entry.topic || '']);
        if (out.text !== entry.summary) entry.summary = out.text;
      } catch { /* fail open */ }
    }

    let facetLinked = 0;

    // Helper — merge the LLM-assigned confidence into the entry's metadata
    // as baseConfidence. baseConfidence is the anchor for the churn-gated
    // decay model in _decayConfidence: confidence = max(0.3, base - drags).
    // Set once at synthesis (here) and replaced on resynthesis.
    const withBaseConfidence = (entry) => {
      const meta = entry.metadata || {};
      return { ...meta, baseConfidence: Number((entry.confidence ?? 0.8).toFixed(3)) };
    };

    // Phase 44 Plan 17: SQLite db.transaction() is GONE. Each km-core
    // putEntity/mergeAttributes is its own atomic write; partial failure
    // semantics are equivalent to a crash mid-transaction in the old path
    // (already-applied writes survive, in-flight is lost). The await-loop
    // is intentional: GraphKMStore's in-memory graph mutation is fast
    // (microseconds); serialization avoids head-of-line concurrent writes
    // against the LevelDB persistence debounce.
    for (const entry of insightEntries) {
      const project = entry.project || 'unknown';
      const entryDigestIds = entry._digestIds || [];

      // Resolve the similar-insight match into a 'merge' or 'facet' decision.
      // Project scoping in _findSimilarInsightId already filters to the same
      // project; we still re-validate here as defense-in-depth.
      let existing = null;
      let existingEntity = null;
      let verdict = null;
      if (entry._similarMatch) {
        existingEntity = await kmStore.findByLegacyId({ system: 'A', id: entry._similarMatch.id });
        if (existingEntity) {
          existing = this._toLegacyInsightRow(existingEntity);
          if ((existing.project || 'unknown') !== project) {
            existing = null;
            existingEntity = null;
          } else {
            verdict = entry._similarMatch.verdict;
          }
        }
      }
      // Fall back to exact topic-string match (cheap, catches the
      // LLM-honoured "topic names should be stable" path). Scan the
      // already-loaded Insight set first; if missing there (the entity
      // could have been written by a concurrent process), re-scan via
      // findByOntologyClass.
      if (!existing) {
        const candidateEntity = insightEntitiesForGate.find(e => {
          const m = e.metadata ?? {};
          return (m.topic === entry.topic) && ((m.project ?? 'unknown') === project);
        }) || (await kmStore.findByOntologyClass('Insight')).find(e => {
          const m = e.metadata ?? {};
          return (m.topic === entry.topic) && ((m.project ?? 'unknown') === project);
        });
        if (candidateEntity) {
          existingEntity = candidateEntity;
          existing = this._toLegacyInsightRow(candidateEntity);
          verdict = 'merge';
        }
      }

      if (existing && verdict === 'merge') {
        let existingDigestIds = [];
        try { existingDigestIds = JSON.parse(existing.digest_ids || '[]'); } catch { /* ok */ }
        const mergedDigestIds = [...new Set([...existingDigestIds, ...entryDigestIds])];

        // js-object spread mirrors SQLite json_patch RFC-7396 semantics for
        // non-null values; null-valued keys ARE accepted into metadata
        // (json_patch would have deleted them, but downstream readers
        // null-check, they don't iterate keys). withBaseConfidence sets
        // metadata.baseConfidence verbatim.
        const baseMetaPatch = (() => {
          try { return JSON.parse(this._redactPaths(JSON.stringify(withBaseConfidence(entry)))); }
          catch { return withBaseConfidence(entry); }
        })();
        const prevMeta = existingEntity.metadata ?? {};
        await kmStore.mergeAttributes(existingEntity.id, {
          description: this._redact(entry.summary),
          updatedAt: now,
          metadata: {
            ...prevMeta,
            summary: this._redact(entry.summary),
            digest_ids: mergedDigestIds,
            last_updated: now,
            confidence: entry.confidence,
            ...baseMetaPatch,
          },
        });
        embeddingQueue.push({ id: existing.id, summary: this._redact(entry.summary), topic: entry.topic, confidence: entry.confidence, project });
        updated++;
      } else if (existing && verdict === 'facet') {
        // Insert as a NEW insight, then cross-link both the new one and
        // the existing match as facets of a shared parent topic. The
        // parent topic is derived from the longest common identifier-prefix
        // of the two topics; falls back to the existing topic if no
        // meaningful prefix exists.
        const newId = crypto.randomUUID();
        const newRow = {
          id: newId,
          topic: this._redact(entry.topic),
          summary: this._redact(entry.summary),
          confidence: entry.confidence,
          digest_ids: entryDigestIds,
          last_updated: now,
          created_at: now,
          metadata: (() => {
            try { return JSON.parse(this._redactPaths(JSON.stringify(withBaseConfidence(entry)))); }
            catch { return withBaseConfidence(entry); }
          })(),
          project,
        };
        const newEntity = legacyInsightToEntity(newRow, this._runId, now);
        await kmStore.putEntity(newEntity, { skipOntologyCheck: true });
        // The inserted entity's km-core id is needed for the facet patch
        // below. findByLegacyId is the canonical post-write lookup.
        const insertedEntity = await kmStore.findByLegacyId({ system: 'A', id: newId });

        const parentTopic = this._deriveParentTopic(entry.topic, existing.topic);
        const existingMeta = existingEntity.metadata ?? {};
        const existingRelated = new Set(
          Array.isArray(existingMeta.relatedInsightIds) ? existingMeta.relatedInsightIds : []
        );
        existingRelated.add(newId);

        // Patch the existing entity's metadata with the new sibling.
        await kmStore.mergeAttributes(existingEntity.id, {
          updatedAt: now,
          metadata: {
            ...existingMeta,
            parentTopic,
            relatedInsightIds: [...existingRelated],
            facetGroupedAt: now,
          },
        });

        // Patch the new row with its own facet metadata.
        if (insertedEntity) {
          const newMeta = insertedEntity.metadata ?? {};
          await kmStore.mergeAttributes(insertedEntity.id, {
            metadata: {
              ...newMeta,
              parentTopic,
              relatedInsightIds: [existing.id, ...existingRelated].filter((x) => x !== newId),
              facetGroupedAt: now,
            },
          });
        }

        embeddingQueue.push({ id: newId, summary: this._redact(entry.summary), topic: entry.topic, confidence: entry.confidence, project });
        created++;
        facetLinked++;
      } else {
        const id = crypto.randomUUID();
        const row = {
          id,
          topic: this._redact(entry.topic),
          summary: this._redact(entry.summary),
          confidence: entry.confidence,
          digest_ids: entryDigestIds,
          last_updated: now,
          created_at: now,
          metadata: (() => {
            try { return JSON.parse(this._redactPaths(JSON.stringify(withBaseConfidence(entry)))); }
            catch { return withBaseConfidence(entry); }
          })(),
          project,
        };
        const entity = legacyInsightToEntity(row, this._runId, now);
        await kmStore.putEntity(entity, { skipOntologyCheck: true });
        embeddingQueue.push({ id, summary: this._redact(entry.summary), topic: entry.topic, confidence: entry.confidence, project });
        created++;
      }
    }

    // Fire-and-forget: publish embedding events for new/updated insights
    for (const item of embeddingQueue) {
      this._publishEmbeddingEvent('insight', item.id, item.summary, {
        topic: item.topic,
        confidence: item.confidence,
        project: item.project || 'unknown',
      });
    }

    // Mirror each insight into the KG as an online-learned entity. The
    // call replaces observations on existing entities (intentional —
    // re-synthesis supersedes older narrative) and tags them
    // source='online' so the viewer renders them in the auto-learned
    // tier instead of the manual UKB tier. Done sequentially because
    // the VKB writer doesn't support batch PUT, but kept off the hot
    // path of the SQLite write and not awaited beyond a best-effort
    // fire so a VKB outage can't block the consolidator.
    const KG_PUSH_TIMEOUT_MS = 15000;
    await Promise.race([
      (async () => {
        for (const entry of insightEntries) {
          try { await this._pushInsightToKG(entry); } catch { /* swallowed */ }
        }
      })(),
      new Promise((r) => setTimeout(r, KG_PUSH_TIMEOUT_MS)),
    ]);

    process.stderr.write(`[Consolidator] Insights: ${created} created, ${updated} updated, ${facetLinked} facet-linked (mirrored to KG as 'online' entities)\n`);
    return { created, updated, facetLinked };
  }

  /**
   * Derive a shared "parent topic" string from two sibling-facet topics.
   *
   * Looks for the longest common word-prefix using the same em-dash/colon
   * convention the LLM uses (e.g. "Knowledge Context Injection — Embedding
   * Pipeline" and "Knowledge Context Injection — Hook and Agent Adapters"
   * share the prefix "Knowledge Context Injection"). When no meaningful
   * prefix exists, falls back to the first topic so cross-links still have
   * a coherent label.
   *
   * @param {string} topicA
   * @param {string} topicB
   * @returns {string}
   */
  _deriveParentTopic(topicA, topicB) {
    if (!topicA || !topicB) return topicA || topicB || 'Related Topics';
    // Split on word boundaries but preserve punctuation that matters for
    // hierarchical topics (em-dash, en-dash, colon, slash).
    const splitter = /\s+/;
    const a = topicA.trim().split(splitter);
    const b = topicB.trim().split(splitter);
    const prefix = [];
    const maxLen = Math.min(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      if (a[i].toLowerCase() === b[i].toLowerCase()) {
        prefix.push(a[i]);
      } else {
        break;
      }
    }
    if (prefix.length === 0) return topicA;
    // Strip a trailing dash/colon/slash so "Foo —" becomes "Foo".
    let result = prefix.join(' ').replace(/[—–:/-]+\s*$/, '').trim();
    if (result.length < 3) return topicA;
    return result;
  }

  /**
   * Generic cadence guard. Returns true when `<sentinelName>.iso` is missing,
   * unreadable, or older than `minDays` for the given project.
   *
   * @param {string} sentinelName  e.g. 'last-compaction' or 'last-verification'
   * @param {string} project
   * @param {number} minDays
   */
  _isCadenceDue(sentinelName, project, minDays) {
    const projectRoot = path.resolve(path.dirname(this.dbPath), '..');
    const sentinelPath = path.join(projectRoot, '.data', `${sentinelName}-${project}.iso`);
    try {
      const raw = fs.readFileSync(sentinelPath, 'utf8').trim();
      const last = new Date(raw).getTime();
      if (Number.isFinite(last)) {
        return (Date.now() - last) / 86400000 >= minDays;
      }
    } catch { /* missing/unreadable -> due */ }
    return true;
  }

  /**
   * Record that a cadence-guarded pass ran successfully.
   */
  _markCadenceDone(sentinelName, project) {
    const projectRoot = path.resolve(path.dirname(this.dbPath), '..');
    const sentinelPath = path.join(projectRoot, '.data', `${sentinelName}-${project}.iso`);
    try {
      fs.writeFileSync(sentinelPath, new Date().toISOString() + '\n');
    } catch (err) {
      process.stderr.write(`[Consolidator] ${sentinelName} sentinel write failed (non-fatal): ${err.message}\n`);
    }
  }

  // Thin wrappers preserved so existing call sites keep working.
  _isCompactionDue(project) { return this._isCadenceDue('last-compaction', project, 7); }
  _markCompactionDone(project) { this._markCadenceDone('last-compaction', project); }
  _isVerificationDue(project) { return this._isCadenceDue('last-verification', project, 7); }
  _markVerificationDone(project) { this._markCadenceDone('last-verification', project); }

  /**
   * Run full consolidation pipeline: digests then insights.
   *
   * @param {Object} [options]
   * @param {boolean} [options.includeToday=false]
   * @param {boolean} [options.compaction=false]  enable periodic compactInsights() pass
   * @param {string}  [options.compactionProject='coding']
   * @param {boolean} [options.verification=true]  enable periodic code-claim verification (default ON — cheap)
   * @param {string[]} [options.verificationProjects=['coding']]
   * @returns {Promise<Object>}
   */
  async run({
    includeToday = false,
    compaction = false,
    compactionProject = 'coding',
    verification = true,
    verificationProjects = ['coding'],
  } = {}) {
    const digestResult = await this.consolidateAll({ includeToday });
    let insightResult = { created: 0, updated: 0 };

    // Only synthesize insights if we have enough digests (>= 5 unsynthesized).
    // Phase 44 Plan 17: replaces the SQLite LEFT-JOIN unsynth count with a
    // km-core equivalent: gather every Insight's digest_ids into a Set,
    // then count Digests whose legacyId.id is not in it.
    if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    const kmStore = this._kmStore;
    const [allInsightsForCount, allDigestsForCount] = await Promise.all([
      kmStore.findByOntologyClass('Insight'),
      kmStore.findByOntologyClass('Digest'),
    ]);
    const synthesizedDigestIdSet = new Set();
    for (const ins of allInsightsForCount) {
      const m = ins.metadata ?? {};
      if (Array.isArray(m.digest_ids)) {
        for (const id of m.digest_ids) synthesizedDigestIdSet.add(id);
      }
    }
    const unsynthesizedCount = allDigestsForCount.reduce((cnt, d) => {
      const legId = d.legacyId?.id ?? d.id;
      return synthesizedDigestIdSet.has(legId) ? cnt : cnt + 1;
    }, 0);

    if (unsynthesizedCount >= 5) {
      insightResult = await this.synthesizeInsights();
    } else {
      process.stderr.write(`[Consolidator] Only ${unsynthesizedCount} unsynthesized digests — waiting for >= 5 before insight synthesis\n`);
    }

    // Apply confidence decay to existing insights (now async after Plan 44-17)
    await this._decayConfidence();

    // Optional cadence-guarded compaction pass. Makes LLM calls per cluster,
    // so gated to once per COMPACTION_MIN_DAYS by default and only run when
    // explicitly opted in (via run({compaction: true})). Failures don't block
    // the rest of the pipeline.
    if (compaction && this._isCompactionDue(compactionProject)) {
      try {
        const compactResult = await this.compactInsights({ project: compactionProject, dryRun: false });
        if (compactResult.merges > 0 || compactResult.facets > 0) {
          process.stderr.write(
            `[Consolidator] Compaction: ${compactResult.merges} merge(s), ${compactResult.facets} facet group(s), ${compactResult.separated} false-positive(s)\n`
          );
        }
        this._markCompactionDone(compactionProject);
      } catch (err) {
        process.stderr.write(`[Consolidator] Compaction failed (non-fatal): ${err.message}\n`);
      }
    }

    // Cadence-guarded code-claim verification. Cheap (no LLM, just filesystem
    // + git grep) and the only signal that catches insights silently going
    // stale against codebase moves. ON by default; cadence keeps it from
    // re-grepping the world on every consolidation.
    if (verification) {
      for (const proj of verificationProjects) {
        if (!this._isVerificationDue(proj)) continue;
        try {
          const verResult = await this.verifyInsights({ project: proj, persist: true });
          if (verResult.scanned > 0) {
            process.stderr.write(
              `[Consolidator] Verification (${proj}): ${verResult.freshCount} fresh, ${verResult.staleCount} stale, avg ratio ${verResult.avgRatio}\n`
            );
          }
          this._markCadenceDone('last-verification', proj);
        } catch (err) {
          process.stderr.write(`[Consolidator] Verification failed for ${proj} (non-fatal): ${err.message}\n`);
        }
      }
    }

    // Self-heal any source='online' entities in the KG that lack an
    // incoming has_insight edge. Possible causes (all observed):
    //   - Entity was created before the linking code shipped (relation
    //     creation was added in 23282ee17a; pre-existing online entities
    //     never got linked).
    //   - The PUT-then-POST sequence in _pushInsightAsKgEntity raced or
    //     the relation POST silently failed (network blip, anchor not
    //     yet visible to a fresh server).
    //   - A separate path (e.g. dedup-kg-entities.js) updated the entity
    //     without re-running the relation creation step.
    // Running the sweep here makes the link self-healing without
    // requiring a manual maintenance script per incident.
    try {
      const relinked = await this._relinkOrphanOnlineInsights();
      if (relinked > 0) {
        process.stderr.write(`[Consolidator] Relinked ${relinked} orphan online insight(s)\n`);
      }
    } catch (err) {
      process.stderr.write(`[Consolidator] Orphan relink sweep failed: ${err.message}\n`);
    }

    // Phase 44 Plan 17: ObservationExporter wiring removed. km-core
    // GraphKMStore exports per-domain JSON to `.data/knowledge-graph/exports/`
    // via the auto-debounced Exporter (Plan 03). The legacy
    // `.data/observation-export/*.json` files stop updating; ColdStoreReader
    // (Plan 35) reads the historical snapshot but new digests/insights
    // land in km-core's own exports going forward.

    return { ...digestResult, ...insightResult };
  }

  /**
   * Find every Insight entity in the KG that lacks (a) an incoming
   * has_insight edge from its Project anchor, OR (b) any outgoing
   * `mentions` edge, and emit the missing edge(s) via kmStore.addRelation.
   *
   * Phase 58 D-06 / D-06.2 — two-pass kmStore-native bridge:
   *   1. has_insight relink — kmStore-native migration of the prior
   *      fetch(GET /api/entities) + fetch(GET /api/relations) +
   *      fetch(POST /api/relations) shape. The Project anchor still
   *      resolves through `_ensureProjectAnchor` (which targets the
   *      VKB HTTP PUT path — D-06.1 keeps that surface live for
   *      non-consolidator callers; in-process we only need the
   *      kmStore Project entity id).
   *   2. mentions relink — for each Insight with no `mentions` edges,
   *      run `classifyMentions` via the same MentionsClassifier helpers
   *      as the writer path and the one-shot backfill (single source of
   *      truth — D-06.2). The idempotency gate (`existing.length > 0
   *      continue`) is structural: it prevents the bridge from burning
   *      an LLM call per Insight per consolidation cycle (threat T-58-03-02).
   *
   * Returns the total number of relations actually created across both
   * passes — preserves the scalar-count contract of the call-site at
   * line ~2003 (`const relinked = await this._relinkOrphanOnlineInsights()`).
   */
  async _relinkOrphanOnlineInsights() {
    if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    const kmStore = this._kmStore;
    let created = 0;

    // ───────────────────────────────────────────────────────────────────────
    // Pass 1 — has_insight relink (kmStore-native; D-06 carryover).
    // ───────────────────────────────────────────────────────────────────────

    const vkbUrl = process.env.VKB_API_URL || 'http://localhost:8080';
    let insightEntities;
    try {
      insightEntities = await kmStore.findByOntologyClass('Insight');
    } catch (err) {
      process.stderr.write(`[Consolidator] Relink: kmStore.findByOntologyClass(Insight) failed (${err.message})\n`);
      return 0;
    }

    for (const insight of insightEntities) {
      // Skip insights that already have a has_insight edge pointing at them.
      let incoming;
      try {
        incoming = await kmStore.findRelations({ to: insight.id, type: 'has_insight' });
      } catch (err) {
        process.stderr.write(
          `[Consolidator] Relink: findRelations(to=${insight.id.slice(0, 8)},has_insight) failed (non-fatal): ${err.message}\n`,
        );
        continue;
      }
      if (Array.isArray(incoming) && incoming.length > 0) continue;

      // Resolve the Project anchor — still flows through VKB PUT per D-06.1.
      const team = insight?.metadata?.team || insight?.metadata?.project || null;
      if (!team) continue;
      const projectName = await this._ensureProjectAnchor(vkbUrl, team);
      if (!projectName) continue;

      // Look up the Project entity id in kmStore (the VKB PUT created or
      // refreshed it; we need its kmStore id for the addRelation source).
      let projects;
      try {
        projects = await kmStore.findByOntologyClass('Project');
      } catch (err) {
        process.stderr.write(`[Consolidator] Relink: findByOntologyClass(Project) failed: ${err.message}\n`);
        continue;
      }
      const projectId = projects.find((p) => p && p.name === projectName)?.id;
      if (!projectId) continue;

      try {
        await kmStore.addRelation({
          from: projectId,
          to: insight.id,
          type: 'has_insight',
          metadata: {
            source: 'consolidator-bridge',
            team,
            confidence: 1.0,
            anchoredAt: new Date().toISOString(),
          },
        });
        created++;
      } catch (err) {
        // Source/Target-not-found races are benign — sweep is best-effort.
        process.stderr.write(
          `[Consolidator] bridge: has_insight edge ${projectId.slice(0, 8)}->${insight.id.slice(0, 8)} `
          + `failed (non-fatal): ${err.message}\n`,
        );
      }
    }

    // ───────────────────────────────────────────────────────────────────────
    // Pass 2 — mentions relink (D-06.2 — single source of truth via
    // MentionsClassifier; same edge shape as writer-path + one-shot backfill).
    //
    // Landmine: skip Insights that already carry ≥1 mentions edge so the
    // bridge does NOT burn an LLM call per Insight per consolidation cycle
    // (threat T-58-03-02). The idempotency gate `existing.length > 0` is
    // structural — the difference between O(1) bridge cost at steady state
    // and O(N) per cycle.
    // ───────────────────────────────────────────────────────────────────────

    let mentionsRelinked = 0;
    // Re-fetch insight list in case the has_insight pass added anchors that
    // make new candidates eligible — typically the list is unchanged but
    // refreshing is cheap and avoids stale-data bugs.
    let insightEntities2;
    try {
      insightEntities2 = await kmStore.findByOntologyClass('Insight');
    } catch (err) {
      process.stderr.write(`[Consolidator] Relink Pass 2: findByOntologyClass(Insight) failed (${err.message})\n`);
      return created;
    }

    // Preload candidate catalog once for the whole pass — same per-run cache
    // semantics as the writer path uses (PATTERNS landmine 8).
    let candidates = [];
    let candidatesLoaded = false;

    for (const insight of insightEntities2) {
      // Idempotency gate — bail out fast on Insights with existing mentions.
      let existing;
      try {
        existing = await kmStore.findRelations({ from: insight.id, type: 'mentions' });
      } catch (err) {
        process.stderr.write(
          `[Consolidator] bridge: findRelations(from=${insight.id.slice(0, 8)},mentions) failed (non-fatal): ${err.message}\n`,
        );
        continue;
      }
      if (Array.isArray(existing) && existing.length > 0) continue;

      // Lazy-load candidates only when we have an Insight that actually needs
      // classification — avoids paying the load cost when steady-state
      // (all Insights have mentions).
      if (!candidatesLoaded) {
        try {
          candidates = await loadMentionCandidates(kmStore);
          candidatesLoaded = true;
        } catch (err) {
          process.stderr.write(`[Consolidator] bridge: loadMentionCandidates failed: ${err.message}\n`);
          return created + mentionsRelinked;
        }
      }

      const summary = (insight.descriptionSegments?.[0]?.text) ?? insight.description ?? insight.name;
      let mentionIds = [];
      try {
        mentionIds = await classifyMentions(summary, candidates);
      } catch (err) {
        process.stderr.write(
          `[Consolidator] bridge: mentions classify for ${insight.id.slice(0, 8)} failed: ${err.message}\n`,
        );
        continue;
      }

      for (const targetId of mentionIds) {
        if (!targetId || targetId === insight.id) continue; // self-loop guard
        // Per-target dedup probe — the upper-level existing-check looked at
        // the from-side; this checks the precise (from,to,type) triple in
        // case a parallel writer just wrote one.
        let dup;
        try {
          dup = await kmStore.findRelations({ from: insight.id, to: targetId, type: 'mentions' });
        } catch (err) {
          process.stderr.write(
            `[Consolidator] bridge: dedup probe ${insight.id.slice(0, 8)}->${targetId.slice(0, 8)} failed (non-fatal): ${err.message}\n`,
          );
          continue;
        }
        if (Array.isArray(dup) && dup.length > 0) continue;

        try {
          await kmStore.addRelation({
            from: insight.id,
            to: targetId,
            type: 'mentions',
            metadata: {
              source: 'consolidator-bridge',
              classifiedAt: new Date().toISOString(),
              classifier: 'llm-haiku',
            },
          });
          mentionsRelinked++;
        } catch (err) {
          process.stderr.write(
            `[Consolidator] bridge: mentions edge ${insight.id.slice(0, 8)}->${targetId.slice(0, 8)} `
            + `failed (non-fatal): ${err.message}\n`,
          );
        }
      }
    }

    return created + mentionsRelinked;
  }

  /**
   * Decay confidence of insights, combining two pressures:
   *
   *   - Age drag: -0.05 per full week since `last_updated`.
   *   - Truthfulness drag: when `metadata.codeVerification.verificationRatio`
   *     is below 0.5, apply an additional one-shot subtractor proportional
   *     to (0.5 - ratio) * 0.4. A 0.0-ratio insight loses up to 0.2 from
   *     confidence, on top of age decay. We track `staleDragApplied: true`
   *     in metadata so re-running this pass doesn't repeatedly subtract
   *     for the same stale state — it only fires once per stale verdict
   *     and resets when the ratio climbs back above 0.5.
   *
   * Floor stays at 0.3 (matches the previous behaviour).
   */
  async _decayConfidence() {
    if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    const kmStore = this._kmStore;

    // Drag coefficients — kept as module-local constants so the breakdown
    // recorded on each insight remains interpretable months later.
    const MIN_CONFIDENCE = 0.3;
    const AGE_DRAG_PER_WEEK = 0.05;        // only when referenced files churned
    const AGE_DRAG_CAP = 0.40;             // absolute cap so age alone can't bury an insight
    const EMERGENT_DRAG_START_WEEKS = 13;  // ≈ 90 days of zero churn before emergent kicks in
    const EMERGENT_DRAG_PER_QUARTER = 0.02;
    const EMERGENT_DRAG_CAP = 0.10;        // hedges unknown-emergent-effects without dominating
    const TRUTHFULNESS_THRESHOLD = 0.5;
    const TRUTHFULNESS_MAX = 0.20;         // (0.5 - 0) * 0.4

    // Phase 44 Plan 17: load all Insights via km-core. The legacy SQLite
    // SELECT returned (id, confidence, last_updated, metadata); we get the
    // same projection via _toLegacyInsightRow and keep both shapes around
    // (entity for mergeAttributes, row for parsing).
    const insightEntities = await kmStore.findByOntologyClass('Insight');
    if (insightEntities.length === 0) return;
    const insights = insightEntities.map(e => ({
      ...this._toLegacyInsightRow(e),
      _entity: e,
    }));

    // Parse metadata once + compute the oldest last_updated across all
    // insights so we know how far back the per-root git log needs to reach.
    const parsed = insights.map((ins) => {
      let meta = {};
      try { meta = ins.metadata ? JSON.parse(ins.metadata) : {}; } catch { meta = {}; }
      const referencedFiles = Array.isArray(meta?.codeVerification?.referencedFiles)
        ? meta.codeVerification.referencedFiles
        : [];
      const ratio = typeof meta?.codeVerification?.verificationRatio === 'number'
        ? meta.codeVerification.verificationRatio
        : null;
      const totalClaims = typeof meta?.codeVerification?.totalClaims === 'number'
        ? meta.codeVerification.totalClaims
        : null;
      return {
        id: ins.id,
        currentConfidence: ins.confidence,
        baseConfidence: typeof meta.baseConfidence === 'number' ? meta.baseConfidence : null,
        lastUpdatedMs: new Date(ins.last_updated).getTime(),
        referencedFiles,
        ratio,
        totalClaims,
        _entity: ins._entity,
      };
    });

    const now = Date.now();
    const oldestLastUpdatedMs = parsed.reduce((min, p) => Math.min(min, p.lastUpdatedMs), now);
    const churnIndex = this._computeChurnIndex(this._defaultSearchRoots(), oldestLastUpdatedMs);

    let adjusted = 0;
    let backfilled = 0;
    let churnGated = 0;
    let emergentApplied = 0;
    let truthfulnessApplied = 0;

    for (const p of parsed) {
      // Backfill baseConfidence on first run — capture the current
      // confidence value as the new model's anchor so existing rows don't
      // jump. From this point forward, decays compute as
      //   final = base - sum(drags)
      // rather than the prior in-place subtractive model. A subsequent
      // re-synthesis will overwrite baseConfidence with the LLM-assigned
      // value for that fresh content.
      let baseConfidence = p.baseConfidence;
      const baseMissing = baseConfidence === null;
      if (baseMissing) {
        baseConfidence = p.currentConfidence;
        backfilled++;
      }

      // --- Churn-gated age drag ---------------------------------------
      // Pure wall-clock decay is wrong for stable code. The age drag now
      // only applies when at least one referenced file has actually been
      // touched in any search root since the insight's last_updated. No
      // churn → no age decay, no matter how old the insight is.
      const churn = this._hasChurnSince(p.referencedFiles, churnIndex, p.lastUpdatedMs);
      const weeksOld = Math.max(0, (now - p.lastUpdatedMs) / (7 * 86400000));
      let ageDrag = 0;
      if (churn.churnedSinceLastUpdate) {
        ageDrag = Math.min(AGE_DRAG_CAP, Math.floor(weeksOld) * AGE_DRAG_PER_WEEK);
        churnGated++;
      }

      // --- Emergent drag (slow, capped) -------------------------------
      // Even with zero churn in known files, complex systems develop
      // emergent behaviour over time (dependency upgrades, new callers,
      // environment shifts). A small, capped quarterly drag hedges this.
      // Suppressed entirely whenever churn IS detected — in that case the
      // age drag is already doing the work and adding emergent on top
      // would double-count.
      let emergentDrag = 0;
      if (!churn.churnedSinceLastUpdate && weeksOld > EMERGENT_DRAG_START_WEEKS) {
        const quartersBeyond = Math.floor((weeksOld - EMERGENT_DRAG_START_WEEKS) / 13);
        emergentDrag = Math.min(EMERGENT_DRAG_CAP, quartersBeyond * EMERGENT_DRAG_PER_QUARTER);
        if (emergentDrag > 0) emergentApplied++;
      }

      // --- Truthfulness drag ------------------------------------------
      // Now applied each run as a function of the CURRENT ratio (no more
      // one-shot staleDragApplied flag). Recovery to ratio >= 0.5 clears
      // the drag naturally on the next decay pass. Skip insights with
      // totalClaims === 0 (unverifiable, not stale).
      const measurable = p.ratio !== null
        && Number.isFinite(p.ratio)
        && p.totalClaims !== null
        && p.totalClaims > 0;
      let truthfulnessDrag = 0;
      if (measurable && p.ratio < TRUTHFULNESS_THRESHOLD) {
        truthfulnessDrag = Math.min(TRUTHFULNESS_MAX, (TRUTHFULNESS_THRESHOLD - p.ratio) * 0.4);
        truthfulnessApplied++;
      }

      const totalDrag = ageDrag + emergentDrag + truthfulnessDrag;
      const finalConfidence = Math.max(MIN_CONFIDENCE, baseConfidence - totalDrag);

      // Persist the breakdown so the dashboard tooltip can explain
      // exactly how the displayed confidence was arrived at. Keys are
      // deliberately verbose — these objects survive across versions.
      // Single-name "ageDrag" — the value is *already* churn-gated (only
      // non-zero when some referenced file changed since last_updated), so
      // a separate "churnDrag" field would just duplicate it and confuse
      // the UI. The breakdown labels it "Churn-gated age drag" in the
      // tooltip to make the gating semantics explicit.
      const decayBreakdown = {
        baseConfidence: Number(baseConfidence.toFixed(3)),
        ageDrag: Number(ageDrag.toFixed(3)),
        emergentDrag: Number(emergentDrag.toFixed(3)),
        truthfulnessDrag: Number(truthfulnessDrag.toFixed(3)),
        totalDrag: Number(totalDrag.toFixed(3)),
        finalConfidence: Number(finalConfidence.toFixed(3)),
        weeksOld: Number(weeksOld.toFixed(1)),
        churnedSinceLastUpdate: churn.churnedSinceLastUpdate,
        latestChurnTs: churn.latestChurnTs ? new Date(churn.latestChurnTs).toISOString() : null,
        churnedFilesSample: churn.churnedFiles.slice(0, 5),
        measurable,
        computedAt: new Date(now).toISOString(),
      };

      const metaPatch = { decayBreakdown };
      if (baseMissing) metaPatch.baseConfidence = Number(baseConfidence.toFixed(3));
      // Clear the legacy staleDragApplied flag — new model recomputes
      // truthfulness drag every run, so the one-shot bookkeeping is dead.
      metaPatch.staleDragApplied = null;
      metaPatch.staleDragAt = null;

      // Phase 44 Plan 17: merge both meta + confidence into one km-core
      // mergeAttributes call when both change. RFC-7396 json_patch semantics
      // (delete-on-null) are NOT preserved by the JS object spread; null
      // keys accumulate but downstream readers null-check.
      const prevMeta = p._entity.metadata ?? {};
      const nextMeta = { ...prevMeta, ...metaPatch };
      if (Math.abs(finalConfidence - p.currentConfidence) >= 0.005) {
        nextMeta.confidence = finalConfidence;
        await kmStore.mergeAttributes(p._entity.id, { metadata: nextMeta });
        adjusted++;
      } else {
        await kmStore.mergeAttributes(p._entity.id, { metadata: nextMeta });
      }
    }

    if (adjusted > 0 || backfilled > 0 || churnGated > 0 || emergentApplied > 0 || truthfulnessApplied > 0) {
      process.stderr.write(
        `[Consolidator] Confidence decay (churn-gated): ${adjusted} adjusted, `
        + `${backfilled} baseConfidence backfilled, `
        + `${churnGated} churn-gated age drag, `
        + `${emergentApplied} emergent drag, `
        + `${truthfulnessApplied} truthfulness drag\n`
      );
    }
  }

  /**
   * Build a per-search-root index of recent commits with their changed
   * files. One git log invocation per root with a NUL-delimited format so
   * a single decay pass can answer "any referenced file churned since this
   * insight's last_updated?" via in-memory filtering.
   *
   * @param {string[]} roots
   * @param {number} sinceMs  oldest insight last_updated across the corpus
   * @returns {Map<string, Array<{ ts: number, files: Set<string> }>>}
   */
  _computeChurnIndex(roots, sinceMs) {
    const index = new Map();
    const sinceIso = new Date(Math.max(0, sinceMs - 86400000)).toISOString();

    for (const root of roots) {
      const commits = [];
      try {
        const out = execFileSync(
          'git',
          // \x00<unix-ts>\n<file>\n<file>\n...\x00<unix-ts>\n... — the
          // leading NUL terminates the previous commit's file block so
          // the parser can split unambiguously.
          ['-C', root, 'log', '--since', sinceIso, '--pretty=format:%x00%ct', '--name-only'],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 8000,
            maxBuffer: 32 * 1024 * 1024,
          }
        );
        const blocks = out.split('\0').slice(1); // first split is empty
        for (const block of blocks) {
          const lines = block.split('\n');
          const tsStr = lines.shift();
          const ts = Number(tsStr) * 1000;
          if (!Number.isFinite(ts)) continue;
          const files = new Set(lines.map((l) => l.trim()).filter(Boolean));
          if (files.size > 0) commits.push({ ts, files });
        }
      } catch {
        // root is not a git repo, git is unavailable, or the call timed
        // out. Treat as "no churn detected here" — caller falls back to
        // emergent drag for old insights.
      }
      index.set(root, commits);
    }
    return index;
  }

  /**
   * Does any referenced file appear in any commit after `sinceMs`?
   *
   * Match logic: path-suffix. A referenced file like
   * `viewer/src/index.css` matches a committed path
   * `integrations/operational-knowledge-management/viewer/src/index.css`
   * (same convention the verifier uses for resolution).
   *
   * @returns {{ churnedSinceLastUpdate: boolean, latestChurnTs: number|null, churnedFiles: string[] }}
   */
  _hasChurnSince(referencedFiles, churnIndex, sinceMs) {
    if (!referencedFiles || referencedFiles.length === 0) {
      return { churnedSinceLastUpdate: false, latestChurnTs: null, churnedFiles: [] };
    }
    const suffixes = referencedFiles
      .map((f) => String(f || '').replace(/\/+$/, ''))
      .filter((f) => f.length > 0 && f.split('/').filter(Boolean).length >= 2);
    if (suffixes.length === 0) {
      return { churnedSinceLastUpdate: false, latestChurnTs: null, churnedFiles: [] };
    }

    let latestChurnTs = null;
    const churnedFiles = new Set();
    for (const commits of churnIndex.values()) {
      for (const commit of commits) {
        if (commit.ts < sinceMs) continue;
        for (const changedPath of commit.files) {
          for (const suffix of suffixes) {
            if (changedPath === suffix || changedPath.endsWith('/' + suffix)) {
              churnedFiles.add(suffix);
              if (latestChurnTs === null || commit.ts > latestChurnTs) {
                latestChurnTs = commit.ts;
              }
              break;
            }
          }
        }
      }
    }
    return {
      churnedSinceLastUpdate: churnedFiles.size > 0,
      latestChurnTs,
      churnedFiles: [...churnedFiles],
    };
  }

  /**
   * Periodic compaction pass over the entire insights corpus.
   *
   * Unlike synthesizeInsights() — which only sees freshly-unsynthesized
   * digests — this method re-examines all stored insights, clusters them
   * by embedding cosine + topic-Jaccard, and asks the LLM to decide for
   * each multi-member cluster whether to MERGE, FACET-link, or treat as
   * a false-positive (SEPARATE).
   *
   * Not auto-wired into run(); call explicitly (e.g. weekly cron) via
   * scripts/compact-insights.mjs.
   *
   * @param {Object} [options]
   * @param {string} [options.project='coding']  scope to one project
   * @param {boolean} [options.dryRun=true]      preview only, no writes
   * @param {boolean} [options.clustersOnly=false]  stop after clustering, no LLM calls
   * @returns {Promise<{ clusters: number, merges: number, facets: number, separated: number, dryRun: boolean, clusterTopics?: string[][] }>}
   */
  async compactInsights({ project = 'coding', dryRun = true, clustersOnly = false } = {}) {
    if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    const kmStore = this._kmStore;

    // Phase 44 Plan 17: load Insights via km-core, filter by project,
    // and reshape to the legacy row shape the existing clustering /
    // LLM prompt code reads.
    const insightEntities = await kmStore.findByOntologyClass('Insight');
    const insights = insightEntities
      .filter(e => ((e.metadata?.project) ?? 'unknown') === project)
      .map(e => this._toLegacyInsightRow(e));

    if (insights.length < 2) {
      return { clusters: 0, merges: 0, facets: 0, separated: 0, dryRun };
    }

    process.stderr.write(`[Compaction] Scanning ${insights.length} insights in project=${project}\n`);

    // Pairwise similarity: prefer Qdrant for embedding cosine, fall back to
    // local topic-Jaccard if the embedder is unavailable. Build adjacency
    // at the facet threshold so both merge-candidates and facet-candidates
    // end up in the same connected component (the LLM disambiguates).
    const tools = await this._getEmbedder();
    const adjacency = new Map(insights.map((i) => [i.id, new Set()]));

    // Pre-compute topic tokens for the Jaccard signal. We require BOTH a
    // non-trivial topic overlap (jaccard >= 0.15) AND a strong cosine
    // (>= FACET_THRESHOLD) before an embedding-only edge is added.
    // Cosine on its own connects too much because MiniLM lifts every pair
    // of same-project documents into the 0.85-0.92 band.
    const COSINE_EDGE_JACCARD_FLOOR = 0.15;
    const topicTokens = new Map(
      insights.map((i) => [i.id, this._tokeniseTopic(i.topic || '')])
    );

    if (tools) {
      // For each insight, query Qdrant top-K and add edges above the facet
      // threshold AND with non-trivial topic overlap. Saves an O(n^2)
      // pairwise embed compared to the local path.
      for (const ins of insights) {
        const text = `${ins.topic ?? ''}\n\n${ins.summary ?? ''}`.trim();
        if (!text) continue;
        let vector;
        try { vector = await tools.embed(text); } catch { continue; }
        let results;
        try {
          results = await tools.qdrant.search('insights', {
            vector,
            limit: 8,
            score_threshold: INSIGHT_FACET_THRESHOLD,
            with_payload: false,
            with_vector: false,
            filter: { must: [{ key: 'project', match: { value: project } }] },
          });
        } catch { continue; }
        for (const r of results || []) {
          const otherId = String(r.id);
          if (otherId === ins.id) continue;
          if (!adjacency.has(otherId)) continue;  // stale Qdrant point
          const jac = this._jaccard(topicTokens.get(ins.id), topicTokens.get(otherId));
          if (jac < COSINE_EDGE_JACCARD_FLOOR) continue;
          adjacency.get(ins.id).add(otherId);
          adjacency.get(otherId).add(ins.id);
        }
      }
    }

    // Local topic-Jaccard augmentation — even if embeddings ran, this catches
    // identifier-name overlap the embedder misses on short topic strings.
    // The Jaccard alone must clear INSIGHT_TOPIC_JACCARD_FACET (0.30) — much
    // stronger than the COSINE_EDGE_JACCARD_FLOOR used as a Jaccard sanity
    // check above.
    for (let i = 0; i < insights.length; i++) {
      for (let j = i + 1; j < insights.length; j++) {
        const jac = this._jaccard(
          topicTokens.get(insights[i].id),
          topicTokens.get(insights[j].id)
        );
        if (jac >= INSIGHT_TOPIC_JACCARD_FACET) {
          adjacency.get(insights[i].id).add(insights[j].id);
          adjacency.get(insights[j].id).add(insights[i].id);
        }
      }
    }

    // Connected-components clustering. Single-element components are dropped.
    const visited = new Set();
    const clusters = [];
    for (const ins of insights) {
      if (visited.has(ins.id)) continue;
      const queue = [ins.id];
      const cluster = [];
      while (queue.length) {
        const cur = queue.shift();
        if (visited.has(cur)) continue;
        visited.add(cur);
        cluster.push(cur);
        for (const n of adjacency.get(cur) || []) {
          if (!visited.has(n)) queue.push(n);
        }
      }
      if (cluster.length >= 2) clusters.push(cluster);
    }

    process.stderr.write(`[Compaction] Found ${clusters.length} multi-insight cluster(s)\n`);
    if (clusters.length === 0) {
      return { clusters: 0, merges: 0, facets: 0, separated: 0, dryRun };
    }

    const insightById = new Map(insights.map((i) => [i.id, i]));

    // Early return for cluster-preview mode — no LLM calls, no DB writes.
    if (clustersOnly) {
      const clusterTopics = clusters.map((ids) =>
        ids.map((id) => insightById.get(id).topic)
      );
      return {
        clusters: clusters.length,
        merges: 0,
        facets: 0,
        separated: 0,
        dryRun,
        clusterTopics,
      };
    }

    let merges = 0;
    let facets = 0;
    let separated = 0;
    const now = new Date().toISOString();

    // Verify each cluster's insights against the code BEFORE prompting the
    // LLM. The verification result is passed into the prompt so the model
    // can favor SEPARATE for highly-stale clusters (where merging would
    // pollute fresh insights with bad facts) and prefer the freshest
    // member as canonical when MERGE is correct.
    const searchRoots = this._defaultSearchRoots();

    for (const clusterIds of clusters) {
      const members = clusterIds.map((id) => insightById.get(id));
      // Phase 44 Plan 17: verifyInsight is now async; await each call.
      // The pass is serialized anyway (each call shells out to git);
      // no perf regression vs the sync SQLite path.
      const verifications = [];
      for (const m of members) {
        verifications.push(await this.verifyInsight(m, { roots: searchRoots, persist: false }));
      }
      const prompt = this._buildCompactionPrompt(members, verifications);
      const response = await this._callLLM(prompt, 'consolidator-compaction');
      if (!response) {
        process.stderr.write(`[Compaction] LLM call failed for cluster of ${members.length} — skipping\n`);
        continue;
      }
      const verdict = this._parseCompactionVerdict(response);
      if (!verdict) {
        process.stderr.write(`[Compaction] Unparseable verdict for cluster of ${members.length} — skipping\n`);
        continue;
      }

      const memberTopics = members.map((m) => `"${m.topic}"`).join(', ');
      process.stderr.write(`[Compaction] Cluster verdict=${verdict.action}: ${memberTopics}\n`);

      if (verdict.action === 'SEPARATE') {
        separated++;
        continue;
      }

      if (dryRun) {
        if (verdict.action === 'MERGE') merges++;
        else if (verdict.action === 'FACET') facets++;
        continue;
      }

      // Pick canonical = highest digest count, breaking ties by confidence.
      members.sort((a, b) => {
        const dc = (JSON.parse(b.digest_ids || '[]').length) - (JSON.parse(a.digest_ids || '[]').length);
        if (dc !== 0) return dc;
        return b.confidence - a.confidence;
      });
      const canonical = members[0];
      const others = members.slice(1);

      // Phase 44 Plan 17: SQLite db.transaction() removed. Each MERGE/FACET
      // step is a sequence of awaited km-core writes; partial-failure
      // matches the cadence-guarded weekly compaction pass's tolerance for
      // mid-cluster interruption (resumable on the next pass).
      if (verdict.action === 'MERGE') {
        const allDigests = new Set(JSON.parse(canonical.digest_ids || '[]'));
        for (const o of others) {
          for (const d of JSON.parse(o.digest_ids || '[]')) allDigests.add(d);
        }
        const canonicalPrev = canonical._entity?.metadata ?? {};
        await kmStore.mergeAttributes(canonical._entity.id, {
          updatedAt: now,
          metadata: {
            ...canonicalPrev,
            digest_ids: [...allDigests],
            last_updated: now,
            absorbed: others.map((o) => ({ id: o.id, topic: o.topic })),
            consolidatedAt: now,
            consolidationReason: verdict.reason || 'compactInsights MERGE',
          },
        });
        for (const o of others) {
          try {
            await kmStore.deleteEntity(o._entity.id);
          } catch (err) {
            process.stderr.write(`[Compaction] deleteEntity failed for ${o.id.slice(0, 8)}: ${err.message}\n`);
          }
        }
        merges++;
      } else if (verdict.action === 'FACET') {
        const parentTopic = verdict.parentTopic
          || members.reduce((acc, m) => acc ? this._deriveParentTopic(acc, m.topic) : m.topic, '');
        const ids = members.map((m) => m.id);
        for (const m of members) {
          const othersList = ids.filter((x) => x !== m.id);
          const prev = m._entity?.metadata ?? {};
          await kmStore.mergeAttributes(m._entity.id, {
            updatedAt: now,
            metadata: {
              ...prev,
              last_updated: now,
              parentTopic,
              relatedInsightIds: othersList,
              facetGroupedAt: now,
            },
          });
        }
        facets++;
      }
    }

    process.stderr.write(
      `[Compaction] ${dryRun ? '(dry run)' : 'applied'}: ${merges} merge(s), ${facets} facet group(s), ${separated} false-positive(s)\n`
    );
    return { clusters: clusters.length, merges, facets, separated, dryRun };
  }

  /**
   * Extract structured "claims" from an insight summary — backticked references
   * that name code artifacts and can be verified against the filesystem.
   *
   * Classification rules:
   *   PACKAGE  — starts with '@' and contains '/' (npm scoped package)
   *   ROUTE    — HTTP verb + slash-prefixed path (`GET /api/...`)
   *   PATH     — contains '/' and either has an extension or trailing slash
   *   FUNCTION — bare identifier ending with `()`
   *   SYMBOL   — ALL_CAPS_WITH_UNDERSCORES identifier (env var, constant, column)
   *   (other backticked tokens are dropped — too ambiguous to verify)
   *
   * @param {string} summary
   * @returns {Array<{ raw: string, type: 'PACKAGE'|'ROUTE'|'PATH'|'FUNCTION'|'SYMBOL', needle: string }>}
   */
  _extractCodeClaims(summary) {
    if (!summary || typeof summary !== 'string') return [];
    const claims = [];
    const seen = new Set();
    const ROUTE_VERBS = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)$/;
    // PATH_RX accepts `~` as a valid first char so `~/.claude/settings.local.json`
    // and similar home-relative paths classify as PATH (verifier will only
    // resolve them inside repos, but the claim is preserved for stale-list
    // diagnostics).
    const PATH_RX = /^[A-Za-z0-9_.@~-][A-Za-z0-9_./@~-]*$/;
    const FUNC_RX = /^([A-Za-z_$][A-Za-z0-9_$]*)\(\)$/;
    const SYMBOL_RX = /^[A-Z][A-Z0-9_]{3,}$/;
    // FILE_BASENAME: backticked filename WITHOUT a directory prefix
    // (e.g. `install.sh`, `claude-code-mcp.json`). The earlier extractor
    // required a slash to classify as PATH, so these slid into the
    // "skip other backticked tokens" branch and the insight ended up
    // UNVERIFIABLE despite naming many real files. Must have a clear
    // extension (1–8 alnum chars) to avoid catching prose like
    // `mode` or `state` as basenames.
    const FILE_BASENAME_RX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8}$/;
    // DIR_BASENAME: kebab-case identifier with at least 2 segments — used
    // for project/submodule/service names like `mcp-server-semantic-analysis`,
    // `code-graph-rag`, `constraint-monitor`, `rapid-llm-proxy`. Single-word
    // kebab tokens (`tools`, `system`) are still excluded. Prose like
    // `pull-request` or `error-handling` will technically match here but
    // gets filtered out at the verifier step — no directory with that name
    // exists in any search root, so it surfaces as STALE rather than
    // inflating the verified count.
    const DIR_BASENAME_RX = /^[a-z][a-z0-9]+(?:-[a-z0-9]+)+$/;

    for (const m of summary.matchAll(/`([^`\n]+)`/g)) {
      const raw = m[1].trim();
      if (!raw || raw.length > 200 || seen.has(raw)) continue;
      seen.add(raw);

      // PACKAGE
      if (raw.startsWith('@') && raw.includes('/')) {
        claims.push({ raw, type: 'PACKAGE', needle: raw });
        continue;
      }
      // ROUTE — "VERB /path"
      const routeMatch = ROUTE_VERBS.exec(raw);
      if (routeMatch) {
        claims.push({ raw, type: 'ROUTE', needle: routeMatch[2] });
        continue;
      }
      // PATH — contains slash, looks pathy (no spaces, file-ish chars)
      if (raw.includes('/') && PATH_RX.test(raw)) {
        // Skip URLs
        if (/^https?:\/\//.test(raw)) continue;
        claims.push({ raw, type: 'PATH', needle: raw });
        continue;
      }
      // FILE_BASENAME — `*.ext` with no directory prefix
      if (FILE_BASENAME_RX.test(raw)) {
        claims.push({ raw, type: 'FILE_BASENAME', needle: raw });
        continue;
      }
      // FUNCTION — identifier()
      const funcMatch = FUNC_RX.exec(raw);
      if (funcMatch) {
        claims.push({ raw, type: 'FUNCTION', needle: funcMatch[1] });
        continue;
      }
      // SYMBOL — ALL_CAPS, length >= 4
      if (SYMBOL_RX.test(raw)) {
        claims.push({ raw, type: 'SYMBOL', needle: raw });
        continue;
      }
      // DIR_BASENAME — kebab-case, 3+ segments
      if (DIR_BASENAME_RX.test(raw)) {
        claims.push({ raw, type: 'DIR_BASENAME', needle: raw });
        continue;
      }
      // skip other backticked tokens
    }
    return claims;
  }

  /**
   * Verify a list of extracted claims against one or more codebase roots.
   *
   * PATH claims: filesystem existence check across roots.
   * Other types: `git grep -l -F <needle>` across roots — verified if any
   * tracked file in any root contains the term.
   *
   * Verification is best-effort and fails open (a missing/unavailable root
   * does not mark claims as stale). Costs ~one subprocess per non-PATH claim,
   * which is acceptable for periodic/manual runs but not per-write.
   *
   * @param {ReturnType<typeof this._extractCodeClaims>} claims
   * @param {string[]} roots  absolute repo paths to search
   * @returns {Array<{ raw: string, type: string, verified: boolean }>}
   */
  _verifyCodeClaims(claims, roots) {
    const results = [];
    for (const c of claims) {
      let verified = false;
      if (c.type === 'PATH') {
        for (const root of roots) {
          // Direct: root/claim
          if (fs.existsSync(path.join(root, c.needle))) { verified = true; break; }
          // Path-claims often include the repo-name prefix (e.g.
          // "rapid-llm-proxy/src/providers/foo.ts" when the search root is
          // "/Users/.../_work/rapid-llm-proxy"). Strip the prefix and retry
          // against the same root so the claim verifies inside its own repo.
          const rootName = path.basename(root);
          if (rootName && c.needle.startsWith(rootName + '/')) {
            const stripped = c.needle.slice(rootName.length + 1);
            if (fs.existsSync(path.join(root, stripped))) { verified = true; break; }
          }
          // Same shape but with one extra leading dir: "_work/rapid-llm-proxy/..."
          // matches a root at ".../Agentic/_work/rapid-llm-proxy".
          const parent = path.basename(path.dirname(root));
          if (parent && c.needle.startsWith(parent + '/' + rootName + '/')) {
            const stripped = c.needle.slice(parent.length + 1 + rootName.length + 1);
            if (fs.existsSync(path.join(root, stripped))) { verified = true; break; }
          }
        }
        // Path-suffix lookup — handles insights using a relative-to-subproject
        // convention (e.g. `viewer/src/index.css` for a file actually tracked
        // at `integrations/<sub>/viewer/src/index.css`).
        if (!verified) {
          for (const root of roots) {
            if (this._gitFileSuffixExists(root, c.needle)) { verified = true; break; }
          }
        }
        // Last resort: tracked-file content match (catches cases where the
        // path is mentioned in source/docs even though no file exactly at
        // that path exists — usually a docs reference).
        if (!verified) {
          for (const root of roots) {
            if (this._gitGrepHasMatch(root, c.needle)) { verified = true; break; }
          }
        }
      } else if (c.type === 'PACKAGE') {
        // Search any package.json under each root for this name.
        for (const root of roots) {
          if (this._gitGrepHasMatch(root, `"${c.needle}"`)) { verified = true; break; }
        }
      } else if (c.type === 'FILE_BASENAME') {
        // Exact basename match against tracked files in any root. This
        // verifies bare filenames like `install.sh` or `claude-code-mcp.json`
        // that the extractor would otherwise have to drop because they
        // carry no directory prefix.
        for (const root of roots) {
          if (this._gitFileBasenameExists(root, c.needle)) { verified = true; break; }
        }
        // Fall back to grep — catches docs/README references to a renamed
        // basename, same way the PATH path does.
        if (!verified) {
          for (const root of roots) {
            if (this._gitGrepHasMatch(root, c.needle)) { verified = true; break; }
          }
        }
      } else if (c.type === 'DIR_BASENAME') {
        // Match any tracked file whose path contains the directory name
        // as an intermediate segment (`/<basename>/`) OR as the top-level
        // component (`<basename>/...`). Verifies project/submodule/service
        // names like `code-graph-rag`.
        for (const root of roots) {
          if (this._gitDirBasenameExists(root, c.needle)) { verified = true; break; }
        }
        if (!verified) {
          for (const root of roots) {
            if (this._gitGrepHasMatch(root, c.needle)) { verified = true; break; }
          }
        }
      } else {
        // FUNCTION / SYMBOL / ROUTE — token-grep across all roots.
        for (const root of roots) {
          if (this._gitGrepHasMatch(root, c.needle)) { verified = true; break; }
        }
      }
      results.push({ raw: c.raw, type: c.type, verified });
    }
    return results;
  }

  /**
   * Does any tracked file in `root` have exactly `basename` as its final
   * path segment? Backs FILE_BASENAME verification for backticked file
   * references that carry no directory prefix.
   */
  _gitFileBasenameExists(root, basename) {
    const b = String(basename || '').trim();
    if (!b || b.includes('/')) return false;
    try {
      const out = execFileSync(
        'git', ['-C', root, 'ls-files'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 64 * 1024 * 1024 }
      );
      for (const line of out.split('\n')) {
        if (line === b) return true;
        if (line.endsWith('/' + b)) return true;
      }
    } catch { /* not a repo or too large */ }
    return false;
  }

  /**
   * Does any tracked file in `root` contain `dirname` as a directory
   * segment? Backs DIR_BASENAME verification for project/submodule/service
   * names like `code-graph-rag` or `mcp-server-semantic-analysis`.
   */
  _gitDirBasenameExists(root, dirname) {
    const d = String(dirname || '').trim();
    if (!d || d.includes('/')) return false;
    try {
      const out = execFileSync(
        'git', ['-C', root, 'ls-files'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 64 * 1024 * 1024 }
      );
      // Use String.includes for the common '/dirname/' case, then check
      // the top-level '<dirname>/' case explicitly so we don't miss
      // root-level directories.
      const slashed = '/' + d + '/';
      const topLevel = d + '/';
      for (const line of out.split('\n')) {
        if (line.includes(slashed)) return true;
        if (line.startsWith(topLevel)) return true;
      }
    } catch { /* not a repo or too large */ }
    return false;
  }

  /**
   * Non-code paths that produce false positives when verifying claims against
   * the codebase. These are exported snapshots of the insights themselves
   * (observation-export, knowledge-export), session transcripts that quote
   * removed code (.specstory/history), historical planning artifacts that
   * may reference deleted symbols (.planning), and irrelevant content
   * (node_modules, dist, .claude/worktrees). Without this filter the
   * verifier finds claim text inside its own insight export and reports
   * the claim as "verified" — a circular check.
   */
  static EXCLUDED_PATHS = [
    ':!.data',
    ':!.planning',
    ':!.specstory',
    ':!.claude/worktrees',
    ':!node_modules',
    ':!**/node_modules',
    ':!dist',
    ':!**/dist',
    ':!.data/observation-export',
    ':!.data/knowledge-export',
  ];

  /**
   * Run `git grep -l -F` for an exact term in one repo root, with non-code
   * paths excluded so a claim's own export doesn't count as a verification.
   * Returns true if any tracked source file contains the term. Failures
   * (no git, not a repo, no matches) all return false.
   */
  _gitGrepHasMatch(root, term) {
    if (!root || !term) return false;
    try {
      // git grep syntax: pattern BEFORE `--`, pathspecs AFTER. Earlier placement
      // ('-- pattern path...') makes git treat the pattern as a path and the
      // exclusion pathspecs as both paths and pattern fragments — fails on any
      // non-existent path before searching anything.
      const out = execFileSync(
        'git',
        ['-C', root, 'grep', '-l', '-F', term, '--', ...ObservationConsolidator.EXCLUDED_PATHS],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
      );
      return out.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Resolve the default set of search roots. Includes:
   *   - the coding project root (derived from this.dbPath)
   *   - sibling repos under ../Agentic/_work/ (so cross-repo claims like
   *     `_work/rapid-llm-proxy/...` can be verified)
   *   - submodules of each of the above (so claims naming files inside
   *     `integrations/operational-knowledge-management/viewer/...` resolve
   *     even though the parent repo's `git ls-files` only shows the
   *     submodule pointer, not its contents)
   */
  /**
   * Resolve a project slug to its primary on-disk root, if any.
   *
   * Used by verifyInsights() to decide whether to actually grep for an
   * insight's code claims or mark the insight unverifiable. When the
   * project has no on-disk source (e.g. `daFrankTeam` insights synthesized
   * from session logs about a hackathon that lives elsewhere, or `unknown`
   * project insights that pre-date the project-stamping fix), the verifier
   * would otherwise paint every tile "stale" red against an empty grep —
   * misleadingly worse than the actual situation.
   *
   * Returns `null` when no known root is on disk. Returns a path string
   * when one is found. Callers that need a full search-root set should
   * still call `_defaultSearchRoots()` (which includes cross-project
   * lookup for claims that legitimately reference sibling repos).
   *
   * @param {string} project  project slug from `metadata.project`
   * @returns {string|null}
   */
  _resolveProjectRoot(project) {
    if (!project || project === 'unknown') return null;
    const projectRoot = path.resolve(path.dirname(this.dbPath), '..');
    if (project === 'coding') return projectRoot;
    const workParent = path.resolve(projectRoot, '..', '_work');
    const candidate = path.join(workParent, project);
    try {
      if (fs.existsSync(path.join(candidate, '.git'))) return candidate;
    } catch { /* unreadable — fall through */ }
    return null;
  }

  _defaultSearchRoots() {
    const projectRoot = path.resolve(path.dirname(this.dbPath), '..');
    const roots = [projectRoot];
    const workParent = path.resolve(projectRoot, '..', '_work');
    if (fs.existsSync(workParent)) {
      try {
        for (const name of fs.readdirSync(workParent)) {
          const candidate = path.join(workParent, name);
          if (fs.existsSync(path.join(candidate, '.git'))) {
            roots.push(candidate);
          }
        }
      } catch { /* unreadable — fall back to project root only */ }
    }
    // Submodule expansion: for each top-level root, list submodules and add
    // them as their own search roots so files inside submodules verify too.
    const submoduleRoots = [];
    for (const root of roots) {
      try {
        const out = execFileSync(
          'git', ['-C', root, 'submodule', 'status'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
        );
        for (const line of out.split('\n')) {
          // Format: " <sha> <path> (...)" or "-<sha> <path>" or "+<sha> <path> (...)"
          const m = /^[\s+\-U]?[0-9a-f]+\s+(\S+)/.exec(line);
          if (m) {
            const sub = path.join(root, m[1]);
            if (fs.existsSync(path.join(sub, '.git'))) submoduleRoots.push(sub);
          }
        }
      } catch { /* not a git repo, no submodules, or git unavailable */ }
    }
    return [...roots, ...submoduleRoots];
  }

  /**
   * Path-suffix lookup: does any tracked file in this repo end with the
   * claimed path? Used as a last resort when a PATH claim uses a relative
   * convention (e.g. `viewer/src/utils/foo.ts` in an insight about an
   * embedded sub-project, when the actual tracked file lives at
   * `integrations/operational-knowledge-management/viewer/src/utils/foo.ts`).
   *
   * Requires at least 2 path segments in the claim — single-segment matches
   * are too generic ("index.css" alone would verify everywhere).
   */
  _gitFileSuffixExists(root, pathClaim) {
    const claim = String(pathClaim || '').replace(/\/+$/, '');
    if (!claim) return false;
    const segments = claim.split('/').filter(Boolean);
    if (segments.length < 2) return false;
    try {
      const out = execFileSync(
        'git', ['-C', root, 'ls-files'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 64 * 1024 * 1024 }
      );
      for (const line of out.split('\n')) {
        if (line === claim) return true;
        if (line.endsWith('/' + claim)) return true;
      }
    } catch { /* not a repo or too big */ }
    return false;
  }

  /**
   * Verify a single insight: extract claims from its summary, check each
   * against the codebase, persist the verification result into the insight's
   * metadata, and return the verdict.
   *
   * @param {{ id: string, summary: string, metadata?: string | Object }} insight
   * @param {Object} [options]
   * @param {string[]} [options.roots]   override default search roots
   * @param {boolean}  [options.persist=true]  write result back to SQLite
   * @returns {{ id: string, totalClaims: number, verifiedClaims: number, ratio: number, staleClaims: Array<{raw:string, type:string}> }}
   */
  async verifyInsight(insight, { roots, persist = true } = {}) {
    const searchRoots = roots || this._defaultSearchRoots();
    const claims = this._extractCodeClaims(insight.summary || '');
    const results = this._verifyCodeClaims(claims, searchRoots);
    const verifiedClaims = results.filter((r) => r.verified).length;
    const staleClaims = results
      .filter((r) => !r.verified)
      .map((r) => ({ raw: r.raw, type: r.type }));
    // Deduped list of PATH-type claims that verified — this is the input to
    // per-project coverage aggregation ("which files does any insight in
    // this project reference"). Only verified PATHs and FILE_BASENAMEs go in;
    // stale ones would inflate coverage with phantom files. DIR_BASENAMEs are
    // excluded because they're directories, not files (counting them would
    // double-count via the files they contain).
    const referencedFiles = [
      ...new Set(
        results
          .filter((r) => r.verified && (r.type === 'PATH' || r.type === 'FILE_BASENAME'))
          .map((r) => r.raw)
      ),
    ];
    // ratio is null when the insight has zero backticked code claims — there
    // is simply no evidence to measure. Previously this defaulted to 1.0,
    // which painted unverifiable insights green and obscured the gap. The
    // UI now renders these as UNVERIFIABLE (gray) and they neither count
    // toward fresh/partial/stale bands nor trigger staleness penalties.
    const ratio = results.length === 0 ? null : verifiedClaims / results.length;

    // Track stuck-at-zero state for the auto-archive sweep. Only set
    // firstZeroAt when ratio is genuinely 0 (insight names code that no
    // longer exists). Clears on any recovery so a transient miss after a
    // file rename doesn't start the clock.
    let zeroTracking = null;
    if (ratio === 0) {
      const prior = (insight.metadata && (() => {
        try {
          const m = typeof insight.metadata === 'string' ? JSON.parse(insight.metadata) : insight.metadata;
          return m?.codeVerification?.firstZeroAt;
        } catch { return null; }
      })()) || null;
      zeroTracking = { firstZeroAt: prior || new Date().toISOString() };
    } else if (ratio !== null) {
      zeroTracking = { firstZeroAt: null };
    }

    const verification = {
      verifiedAt: new Date().toISOString(),
      totalClaims: results.length,
      verifiedClaims,
      verificationRatio: ratio === null ? null : Number(ratio.toFixed(3)),
      staleClaims,
      referencedFiles,
      searchRoots,
      ...(zeroTracking || {}),
    };

    if (persist) {
      try {
        if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    const kmStore = this._kmStore;
        // The insight argument may already carry _entity (callers in
        // verifyInsights pass the legacy row that bundles the entity).
        // Otherwise resolve via legacyId, then fall back to getEntity()
        // for insights that were created without a legacyId stamp — same
        // post-Phase-44 gap that bit the resynthesize handler. Without
        // this fallback, `codeVerification` silently never gets written
        // and the Coverage tab keeps the tile gray even after a
        // successful re-synthesis.
        const entity = insight._entity
          || await kmStore.findByLegacyId({ system: 'A', id: insight.id })
          || await kmStore.getEntity(insight.id);
        if (entity) {
          const prev = entity.metadata ?? {};
          await kmStore.mergeAttributes(entity.id, {
            metadata: { ...prev, codeVerification: verification },
          });
        } else {
          process.stderr.write(`[verifier] No entity for insight id=${insight.id} — codeVerification not persisted\n`);
        }
      } catch (err) {
        process.stderr.write(`[verifier] Persist failed for ${insight.id}: ${err.message}\n`);
      }
    }

    return { id: insight.id, ...verification };
  }

  /**
   * Bulk-verify every insight in the given project. Useful as a periodic
   * maintenance pass alongside compactInsights().
   *
   * @param {Object} [options]
   * @param {string} [options.project='coding']
   * @param {boolean} [options.persist=true]
   * @returns {Promise<{ scanned: number, freshCount: number, staleCount: number, avgRatio: number, results: Array }>}
   */
  async verifyInsights({ project = 'coding', persist = true } = {}) {
    if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    const kmStore = this._kmStore;

    // Phase 44 Plan 17: load Insights via km-core, filter by project.
    const insightEntities = await kmStore.findByOntologyClass('Insight');
    const insights = insightEntities
      .filter(e => ((e.metadata?.project) ?? 'unknown') === project)
      .map(e => this._toLegacyInsightRow(e));
    if (insights.length === 0) {
      return { scanned: 0, freshCount: 0, staleCount: 0, unverifiableCount: 0, archivedCount: 0, avgRatio: 1, results: [] };
    }

    // Defensive: if this project has no on-disk root, the default-roots
    // grep would falsely mark every claim "stale" (red) instead of
    // "unverifiable" (gray). Persist a null-ratio codeVerification on
    // each insight and skip the grep entirely. This keeps the dashboard
    // honest about what we can vs. can't measure.
    if (this._resolveProjectRoot(project) === null) {
      const verification = {
        verifiedAt: new Date().toISOString(),
        totalClaims: 0,
        verifiedClaims: 0,
        verificationRatio: null,
        staleClaims: [],
        referencedFiles: [],
        searchRoots: [],
        unverifiableReason: 'project source not on disk',
      };
      const results = [];
      if (persist) {
        for (const ins of insights) {
          try {
            const entity = ins._entity;
            if (entity) {
              const prev = entity.metadata ?? {};
              await kmStore.mergeAttributes(entity.id, {
                metadata: { ...prev, codeVerification: verification },
              });
            }
          } catch (err) {
            process.stderr.write(`[verifier] Persist failed for ${ins.id}: ${err.message}\n`);
          }
          results.push({ topic: ins.topic, id: ins.id, ...verification });
        }
      } else {
        for (const ins of insights) results.push({ topic: ins.topic, id: ins.id, ...verification });
      }
      process.stderr.write(`[verifier] ${project}: no on-disk root — marked ${insights.length} insight(s) unverifiable\n`);
      return {
        scanned: insights.length,
        freshCount: 0,
        staleCount: 0,
        unverifiableCount: insights.length,
        archivedCount: 0,
        avgRatio: 1,
        results,
      };
    }

    const roots = this._defaultSearchRoots();
    process.stderr.write(`[verifier] Verifying ${insights.length} insights against ${roots.length} root(s)\n`);
    const results = [];
    for (const ins of insights) {
      results.push({ topic: ins.topic, ...(await this.verifyInsight(ins, { roots, persist })) });
    }
    // Bands. Null ratio = UNVERIFIABLE (no claims to measure); not counted
    // toward fresh/partial/stale and excluded from avgRatio.
    const measured = results.filter((r) => typeof r.verificationRatio === 'number');
    const freshCount = measured.filter((r) => r.verificationRatio >= 0.7).length;
    const staleCount = measured.filter((r) => r.verificationRatio < 0.5).length;
    const unverifiableCount = results.length - measured.length;
    const avgRatio = measured.length === 0
      ? 1
      : measured.reduce((s, r) => s + r.verificationRatio, 0) / measured.length;

    // Auto-archive sweep — flag insights stuck at ratio=0 for >= 30 days as
    // archived. Reversible by clearing metadata.archivedAt. Default
    // /api/insights queries hide archived rows so they stop polluting the
    // Coverage tab + Insights list. Persist guard: only run when we're
    // actually writing metadata back this pass.
    let archivedCount = 0;
    if (persist) {
      const ARCHIVE_THRESHOLD_MS = 30 * 86400 * 1000;
      const now = Date.now();
      // Build a quick lookup so the "already archived?" check doesn't
      // require a second km-core query per insight.
      const entityByLegacyId = new Map(insights.map(i => [i.id, i._entity]));
      for (const r of results) {
        if (r.verificationRatio !== 0) continue;
        if (!r.firstZeroAt) continue;
        const stuckMs = now - new Date(r.firstZeroAt).getTime();
        if (!Number.isFinite(stuckMs) || stuckMs < ARCHIVE_THRESHOLD_MS) continue;
        const entity = entityByLegacyId.get(r.id);
        if (!entity) continue;
        // Avoid double-archiving on every sweep.
        const prev = entity.metadata ?? {};
        if (prev.archivedAt) continue;
        try {
          await kmStore.mergeAttributes(entity.id, {
            metadata: {
              ...prev,
              archivedAt: new Date(now).toISOString(),
              archiveReason: `stuck at verificationRatio=0 for ${Math.floor(stuckMs / 86400000)} days — code claims no longer exist`,
            },
          });
          archivedCount++;
        } catch (err) {
          process.stderr.write(`[verifier] Archive failed for ${r.id}: ${err.message}\n`);
        }
      }
      if (archivedCount > 0) {
        process.stderr.write(`[verifier] Auto-archived ${archivedCount} insight(s) stuck at zero for >= 30 days\n`);
      }
    }

    return {
      scanned: insights.length,
      freshCount,
      staleCount,
      unverifiableCount,
      archivedCount,
      avgRatio: Number(avgRatio.toFixed(3)),
      results,
    };
  }

  /**
   * Re-synthesize a single insight from its source digests against the
   * CURRENT codebase. Used by the dashboard's per-insight "Update" button
   * when the verifier has flagged stale claims and the user wants the
   * summary rewritten rather than just re-measured.
   *
   * Pipeline:
   *   1. Load the insight row + the digests it was originally built from.
   *   2. Run a verifier pass on the existing summary so the LLM knows
   *      exactly which claims it must drop or replace.
   *   3. Call the LLM with a constrained single-insight prompt — the
   *      same reference-article structure used in bulk synthesis, but
   *      grounded in this one insight's history + the stale-claim list.
   *   4. UPDATE the row in SQLite (preserves id, created_at, project,
   *      digest_ids; bumps last_updated; resets stale-drag flags;
   *      clears the auto-archive countdown).
   *   5. Re-verify the new summary so the returned row carries fresh
   *      codeVerification metadata.
   *   6. Mirror the result to the VKB graph via _pushInsightToKG so the
   *      LevelDB-backed knowledge store and the SQLite store stay in sync.
   *
   * Failure handling: LLM/parse failures throw so the API surfaces a
   * clear 5xx; VKB push failure is logged but non-fatal (matches the
   * synthesis pipeline's stance — VKB outages must not block SQLite work).
   *
   * @param {string} insightId
   * @returns {Promise<{ id, topic, summary, confidence, codeVerification, kgPushed: boolean }>}
   */
  async resynthesizeInsight(insightId) {
    if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    const kmStore = this._kmStore;
    // Phase 44 Plan 17: load via km-core findByLegacyId. The insight is
    // identified by its legacy SQLite id (preserved in legacyId.id).
    // Post-migration fallback: some Insight entities were created without
    // a legacyId stamp (the writer path skipped it for entities the
    // consolidator inserted post-44-17). When the caller passes an id
    // that doesn't resolve as a legacy id, also try it as the km-core
    // entity id so the dashboard's `legacyId?.id ?? entity.id`
    // projection always round-trips.
    let insightEntity = await kmStore.findByLegacyId({ system: 'A', id: insightId });
    if (!insightEntity) {
      insightEntity = await kmStore.getEntity(insightId);
    }
    if (!insightEntity) {
      const err = new Error(`Insight not found: ${insightId}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    // From here on the consolidator threads the legacy id through digest
    // lookups, the kg-mirror write, etc. If the entity has no legacy
    // stamp, fall back to the km-core entity id — every callee defends
    // against null/undefined and would otherwise propagate the original
    // not-found error from this method, so widening the id source here
    // is correct.
    if (!insightEntity.legacyId) {
      insightEntity = { ...insightEntity, legacyId: { system: 'A', id: insightEntity.id } };
    }
    const resolvedLegacyId = insightEntity.legacyId.id;
    insightId = resolvedLegacyId;
    const insight = { ...this._toLegacyInsightRow(insightEntity), _entity: insightEntity };

    let digestIds = [];
    try { digestIds = JSON.parse(insight.digest_ids || '[]'); } catch { /* keep empty */ }
    // Resolve each digest id via km-core. Missing ids drop out (mirrors the
    // SQLite IN-clause behavior — pruned digests just don't appear).
    const digests = digestIds.length > 0
      ? (await Promise.all(
          digestIds.map(id => kmStore.findByLegacyId({ system: 'A', id }))
        ))
        .filter(Boolean)
        .map(e => this._toLegacyDigestRow(e))
        .sort((a, b) => {
          if (a.date < b.date) return -1;
          if (a.date > b.date) return 1;
          return 0;
        })
      : [];

    // Two source modes:
    //   'digests' — normal path: re-synthesize from the surviving source
    //               digests (the ground-truth narrative the insight was
    //               originally built from).
    //   'summary' — fallback: digests have been pruned (e.g. retention or
    //               consolidation cleared them) but the insight summary
    //               itself is preserved. Re-synthesize from the summary
    //               alone, treating it as the source of truth. The post-
    //               LLM verifier still validates output against the live
    //               codebase, so false-claim risk is contained.
    // Hard fail only when BOTH are missing — nothing left to regenerate from.
    const sourceMode = digests.length > 0 ? 'digests' : 'summary';
    if (sourceMode === 'summary' && (!insight.summary || insight.summary.trim().length < 50)) {
      const err = new Error(
        `Cannot re-synthesize ${insightId}: no source digests AND existing summary is empty/too short`
      );
      err.code = 'NO_SOURCE';
      throw err;
    }

    // Pre-flight verifier pass — gives the LLM the explicit stale list.
    // We don't persist this one; we'll re-verify and persist the NEW
    // summary at the end of the pipeline so km-core state stays consistent.
    const preVerify = await this.verifyInsight(insight, { persist: false });

    const digestBlock = sourceMode === 'digests'
      ? digests.map((d) => `[${d.date}] ${d.theme}\n${d.summary}`).join('\n\n---\n\n')
      : null;

    const prompt = this._buildResynthesisPrompt({
      topic: insight.topic,
      currentSummary: insight.summary || '',
      staleClaims: preVerify.staleClaims || [],
      digestBlock,
      sourceMode,
      project: insight.project || 'unknown',
    });

    process.stderr.write(
      `[Consolidator] Re-synthesizing insight ${insightId.slice(0, 8)} (${insight.topic}) — source=${sourceMode} `
      + (sourceMode === 'digests' ? `(${digests.length} digest(s))` : `(summary fallback; ${digestIds.length} digest_id(s) reference pruned rows)`)
      + `; ${preVerify.staleClaims?.length || 0} stale claim(s) to drop\n`
    );
    const llmResponse = await this._callLLM(prompt, 'consolidator-resynthesize');
    if (!llmResponse) {
      const err = new Error(`LLM call failed during re-synthesis of ${insightId}`);
      err.code = 'LLM_FAILED';
      throw err;
    }

    const parsed = this._parseInsights(llmResponse, digests);
    // The LLM may emit multiple <insight> blocks; pick the one whose topic
    // best matches the original (case-insensitive equality, then substring,
    // then first). Keeps the topic stable so the UI doesn't appear to
    // create a new insight under a different name.
    const pickInsight = (candidates, target) => {
      const t = (target || '').toLowerCase();
      return candidates.find((c) => (c.topic || '').toLowerCase() === t)
        || candidates.find((c) => (c.topic || '').toLowerCase().includes(t.split(' ')[0]))
        || candidates[0];
    };
    const replacement = pickInsight(parsed, insight.topic);
    if (!replacement || !replacement.summary) {
      const err = new Error(`LLM response had no parsable insight for ${insightId}`);
      err.code = 'PARSE_FAILED';
      throw err;
    }

    const now = new Date().toISOString();
    const newSummary = this._redact(replacement.summary);
    const newTopic = this._redact(replacement.topic || insight.topic);
    const newConfidence = typeof replacement.confidence === 'number'
      ? Math.max(0.3, Math.min(1, replacement.confidence))
      : Math.max(insight.confidence, 0.7);

    // Clear stale-drag + auto-archive bookkeeping — the content is brand
    // new, so any prior penalty/archive state is no longer applicable.
    // baseConfidence is replaced with the LLM-assigned value for the new
    // content, anchoring the churn-gated decay model at the resynthesis
    // point. decayBreakdown is dropped so the next decay pass recomputes
    // from scratch against weeksOld=0 (no drags). codeVerification gets
    // overwritten by the re-verify call below.
    const metaPatch = JSON.stringify({
      baseConfidence: Number(newConfidence.toFixed(3)),
      decayBreakdown: null,
      staleDragApplied: null,
      staleDragAt: null,
      archivedAt: null,
      archiveReason: null,
      lastResynthesisAt: now,
      ...(replacement.metadata || {}),
    });

    // Phase 44 Plan 17: km-core mergeAttributes for the resynthesized
    // fields. Mirror name/description on the top-level entity too so
    // queries on entity.name + entity.description reflect the new content
    // (the legacy SQLite topic/summary columns are mirrored to those
    // top-level fields by legacyInsightToEntity at write time).
    const prevMeta = insightEntity.metadata ?? {};
    let metaPatchObj;
    try { metaPatchObj = JSON.parse(metaPatch); } catch { metaPatchObj = {}; }
    await kmStore.mergeAttributes(insightEntity.id, {
      name: (newTopic || '').slice(0, 80) || insightEntity.name,
      description: newSummary,
      updatedAt: now,
      metadata: {
        ...prevMeta,
        topic: newTopic,
        summary: newSummary,
        confidence: newConfidence,
        last_updated: now,
        ...metaPatchObj,
      },
    });

    // Re-verify the brand-new summary; persists fresh codeVerification.
    const postVerify = await this.verifyInsight(
      { id: insightId, summary: newSummary, metadata: null },
      { persist: true }
    );

    // Fire-and-forget VKB mirror — failure must not roll back the SQLite
    // write. Same contract as the bulk synthesis path.
    let kgPushed = false;
    try {
      await this._pushInsightToKG({
        topic: newTopic,
        summary: newSummary,
        project: insight.project || 'coding',
        confidence: newConfidence,
        _digestIds: digestIds,
      });
      kgPushed = true;
    } catch (err) {
      process.stderr.write(`[Consolidator] VKB push failed for ${insightId}: ${err.message}\n`);
    }

    // Republish an embedding event so retrieval picks up the new wording.
    try {
      this._publishEmbeddingEvent('insight', insightId, newSummary, {
        topic: newTopic,
        confidence: newConfidence,
        project: insight.project || 'unknown',
      });
    } catch { /* non-fatal */ }

    return {
      id: insightId,
      topic: newTopic,
      summary: newSummary,
      confidence: newConfidence,
      lastUpdated: now,
      codeVerification: postVerify,
      kgPushed,
      preStaleCount: preVerify.staleClaims?.length || 0,
      postStaleCount: postVerify.staleClaims?.length || 0,
      sourceMode,  // 'digests' or 'summary' — what the LLM was grounded in
      digestsAvailable: digests.length,
      digestIdsReferenced: digestIds.length,
    };
  }

  /**
   * Single-insight re-synthesis prompt. Same structured-reference-article
   * contract as the bulk path, but constrained to one insight and given
   * the explicit list of claims that need to be dropped or replaced.
   *
   * Two source modes:
   *   'digests' — full path: the LLM gets the original source digests
   *               as ground truth + the existing summary + stale list.
   *   'summary' — fallback path when digests have been pruned: the LLM
   *               gets ONLY the existing summary + stale list. The
   *               prompt tightens to "use the summary itself as ground
   *               truth, do not invent new facts, drop stale claims
   *               unless you can confirm a replacement against the
   *               surviving summary text". Post-LLM verifier validates
   *               against the live codebase, so any hallucinated paths
   *               surface as stale on the next pass.
   */
  _buildResynthesisPrompt({ topic, currentSummary, staleClaims, digestBlock, sourceMode = 'digests', project }) {
    const staleBlock = (staleClaims || []).length === 0
      ? '(verifier found no stale claims — the user is regenerating for another reason; refresh the summary but keep the existing structure if it is still accurate)'
      : staleClaims.map((s) => `- [${s.type}] ${s.raw}`).join('\n');

    const isSummaryOnly = sourceMode === 'summary';

    const constraintsBlock = isSummaryOnly
      ? `CRITICAL CONSTRAINTS (SUMMARY-ONLY MODE — source digests pruned):
- Produce EXACTLY ONE <insight> block, on the same topic as the input insight.
- Keep the topic name STABLE — do not rename it.
- DROP every claim listed under STALE CLAIMS. Do NOT replace them with new paths unless those exact paths/symbols also appear in the CURRENT SUMMARY's non-stale portions — the source digests are NOT available, so you have no other ground truth.
- DO NOT invent file paths, function names, env vars, routes, or packages that don't appear verbatim in the current summary. Phantom claims will be flagged as stale on the next verification pass.
- Structure the new summary as a REFERENCE ARTICLE: ## Purpose, ## Architecture, ## Key Files, ## Usage, ## Troubleshooting. Same contract as bulk synthesis.
- It is BETTER to ship a shorter, more conservative insight than one padded with invented details. Confidence should reflect this — if you had to drop many claims and could not replace them, lower it accordingly.
- No dates, no commit hashes, no changelog entries, no "previously..." narration.`
      : `CRITICAL CONSTRAINTS:
- Produce EXACTLY ONE <insight> block, on the same topic as the input insight.
- Keep the topic name STABLE — do not rename it.
- DROP every claim listed under STALE CLAIMS unless you can replace it with a current path/symbol/route that the source digests support.
- DO NOT invent file paths, function names, env vars, or routes that don't appear in the source digests or in the existing (non-stale) summary.
- Structure the new summary as a REFERENCE ARTICLE: ## Purpose, ## Architecture, ## Key Files, ## Usage, ## Troubleshooting. Same contract as bulk synthesis.
- No dates, no commit hashes, no changelog entries, no "previously..." narration.`;

    const confidenceGuidance = isSummaryOnly
      ? '0.0-1.0 — without source digests, default toward 0.50–0.70. Higher only if the existing summary was already detailed and you dropped few claims.'
      : '0.0-1.0 — set this based on how well the source digests still support the topic. If most claims were stale and digests are sparse, lower it; if digests strongly corroborate, raise it.';

    const userBlock = isSummaryOnly
      ? `Project: ${project}

--- EXISTING INSIGHT (regenerate this — its source digests have been pruned, so the summary itself is now the ground truth) ---
TOPIC: ${topic}
CURRENT SUMMARY:
${(currentSummary || '').slice(0, 6000)}

--- STALE CLAIMS (the verifier could not find these in the codebase; drop them; replace only when a non-stale section of the current summary already names the replacement) ---
${staleBlock}

Produce ONE updated insight on the topic "${topic}". You are operating in SUMMARY-ONLY MODE: no source digests are available. Drop the stale claims. Do not invent new paths/symbols. Keep the same reference-article structure.`
      : `Project: ${project}

--- EXISTING INSIGHT (regenerate this) ---
TOPIC: ${topic}
CURRENT SUMMARY:
${(currentSummary || '').slice(0, 4000)}

--- STALE CLAIMS (the verifier could not find these in the codebase; drop or replace) ---
${staleBlock}

--- SOURCE DIGESTS (the ground-truth narrative this insight was built from) ---
${digestBlock}

Produce ONE updated insight on the topic "${topic}". Drop the stale claims. Replace them only with paths/symbols actually mentioned in the source digests or in the existing summary's non-stale portions. Keep the same reference-article structure.`;

    return {
      system: `You are the long-term memory of a software project. You are regenerating ONE existing insight because its content has decayed against the live codebase.

${constraintsBlock}

OUTPUT FORMAT:

<insight>
<topic>${topic}</topic>
<scope>One concrete subsystem, tool, or workflow.</scope>
<confidence>${confidenceGuidance}</confidence>
<summary>
## Purpose
...

## Architecture
...

## Key Files
- \`path/to/file.js\` — role

## Usage
...

## Troubleshooting
...
</summary>
</insight>`,

      user: userBlock,
    };
  }

  /**
   * Build the compaction LLM prompt for a cluster of related insights.
   *
   * @param {Array} members      insight rows from SQLite
   * @param {Array} [verifications]  optional per-insight verification results
   *   from verifyInsight(); when supplied, the prompt includes freshness
   *   signals so the LLM can bias against merging stale insights into fresh ones.
   */
  _buildCompactionPrompt(members, verifications = null) {
    const cluster = members.map((m, i) => {
      const digests = JSON.parse(m.digest_ids || '[]').length;
      const ver = verifications && verifications[i];
      let freshnessBlock = '';
      if (ver) {
        const staleSample = (ver.staleClaims || [])
          .slice(0, 6)
          .map((s) => `${s.type}:${s.raw}`)
          .join(', ');
        freshnessBlock = `
verification: ${ver.verifiedClaims}/${ver.totalClaims} code claims still exist (ratio=${ver.verificationRatio})${
          ver.staleClaims && ver.staleClaims.length > 0
            ? `\nstale_claims_sample: ${staleSample}`
            : ''
        }`;
      }
      return `--- INSIGHT ${i + 1} ---
id: ${m.id}
topic: ${m.topic}
confidence: ${m.confidence}
digest_count: ${digests}${freshnessBlock}
summary:
${(m.summary || '').slice(0, 1500)}`;
    }).join('\n\n');

    const hasVerification = verifications && verifications.some((v) => v && v.totalClaims > 0);
    const freshnessGuidance = hasVerification
      ? `

FRESHNESS SIGNAL — each insight has a verification ratio (fraction of its backticked file paths / function names / env vars / routes that still exist in the codebase). Use it to bias your verdict:
- If one insight has a HIGH ratio (>= 0.7) and another in the cluster has a LOW ratio (< 0.5), prefer MERGE with the HIGH-ratio insight as canonical (its facts are still true).
- If ALL insights in the cluster have LOW ratios, lean toward SEPARATE — merging stale content into stale content just creates a confidently-wrong canonical. Note it in your reason.
- Stale-claim samples show what no longer exists; if they're load-bearing in the summary, the insight is dangerous to preserve as-is.`
      : '';

    return {
      system: `You are reviewing a cluster of insights that an automated similarity check flagged as potentially related. Decide one of three verdicts:

MERGE — The insights describe the same subsystem, tool, or workflow. Different phrasings of one concept. Collapse into a single canonical insight.

FACET — The insights describe distinct sub-topics of one larger concept. Each is a coherent, useful reference article on its own. Keep them all, but link them as facets of a shared parent.

SEPARATE — The cluster is a false positive. The insights share vocabulary but cover unrelated subsystems. Do nothing.${freshnessGuidance}

Respond with EXACTLY this structure:

<verdict>
<action>MERGE|FACET|SEPARATE</action>
<reason>One sentence explaining the choice.</reason>
<parentTopic>If FACET: the shared parent concept (e.g. "Knowledge Context Injection System"). Otherwise omit.</parentTopic>
</verdict>`,
      user: `Cluster of ${members.length} insights to review:\n\n${cluster}\n\nProvide your verdict.`,
    };
  }

  /**
   * Parse the LLM compaction response into a structured verdict.
   * @returns {{action: 'MERGE'|'FACET'|'SEPARATE', reason: string, parentTopic?: string} | null}
   */
  _parseCompactionVerdict(response) {
    const m = /<verdict>([\s\S]*?)<\/verdict>/i.exec(response || '');
    if (!m) return null;
    const block = m[1];
    const action = (/<action>\s*(MERGE|FACET|SEPARATE)\s*<\/action>/i.exec(block) || [])[1];
    const reason = ((/<reason>([\s\S]*?)<\/reason>/i.exec(block) || [])[1] || '').trim();
    const parentTopic = ((/<parentTopic>([\s\S]*?)<\/parentTopic>/i.exec(block) || [])[1] || '').trim() || undefined;
    if (!action) return null;
    return { action: action.toUpperCase(), reason, parentTopic };
  }

  // --- LLM interaction ---

  /**
   * Call the LLM proxy with a system+user prompt.
   * @param {{system: string, user: string}} prompt
   * @returns {Promise<string|null>}
   */
  async _callLLM(prompt, processName = 'consolidator') {
    // Per-call deadline budget for consolidation. Stage-2 insight prompts
    // can stuff 8-11 digests into a single LLM call, and the claude CLI on
    // sonnet routinely needs 2-3 minutes for those. Give the proxy 5 min
    // (via body.timeout — proxy default is 2 min) and the local fetch
    // 6 min so the proxy's own timeout always fires first with a usable
    // QUOTA/AUTH/PARSE error rather than the fetch aborting blind.
    const PROXY_TIMEOUT_MS = 300_000;
    const FETCH_TIMEOUT_MS = 360_000;
    // 2026-06-12: exponential backoff on transient upstream 5xx. Without
    // this, a single Copilot 502 (their proxy frontend gives up on large
    // prompts under load) wasted the entire chunk — the consolidator
    // would skip it and the dashboard would inch forward without
    // producing any insights. Backoff schedule chosen to ride out the
    // 2-3s 502 storms we observe in practice without blowing the per-
    // chunk deadline.
    const MAX_RETRIES = 3;
    const BACKOFF_MS = [2000, 5000, 10000];
    // 2026-06-12: bump `maxTokens` past the proxy's 4096 default. Sonnet
    // routinely needed every token of the 4096 cap to synthesize a single
    // chunk of 2 digests, returning `content: ""` when it hit max_out
    // (proxy-bridge server.mjs:585 — the default 4096 is for cheap probes,
    // not real consolidation work). With 16384 the typical chunk completes
    // in ~30-50s with non-empty content. The proxy accepts either camelCase
    // (`maxTokens`) or snake_case key.
    const MAX_TOKENS = 16384;
    const requestBody = {
      process: processName,
      ...(this.provider ? { provider: this.provider } : {}),
      timeout: PROXY_TIMEOUT_MS,
      maxTokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    };

    const isRetryable = (statusOrErr) => {
      if (typeof statusOrErr === 'number') {
        // 5xx upstream failures + 429 (rate-limit) get retried.
        return statusOrErr >= 500 || statusOrErr === 429;
      }
      // Network-level errors (EAI_AGAIN, ECONNRESET, fetch failed) are
      // generally transient.
      const msg = String(statusOrErr?.message || statusOrErr || '').toLowerCase();
      if (msg.includes('aborted') || msg.includes('timeout')) return false;
      return msg.includes('fetch failed')
        || msg.includes('econnreset')
        || msg.includes('econnrefused')
        || msg.includes('eai_again')
        || msg.includes('socket hang up');
    };

    const startedAt = Date.now();
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Compose two abort sources: the per-call fetch timeout AND any
        // shutdown-time abort the caller (obs-api) passed in. Either firing
        // cancels the fetch — and via res.on('close') on the proxy, kills
        // the spawned claude CLI subprocess.
        const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
        const signal = this.abortSignal
          ? AbortSignal.any([timeoutSignal, this.abortSignal])
          : timeoutSignal;
        const response = await fetch(`${this.proxyUrl}/api/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal,
        });
        const bodyText = await response.text();
        const elapsedMs = Date.now() - startedAt;

        if (!response.ok) {
          if (isRetryable(response.status) && attempt < MAX_RETRIES) {
            const delay = BACKOFF_MS[attempt];
            log.warn('LLM proxy non-OK — retrying', {
              process: processName,
              status: response.status,
              attempt: attempt + 1,
              maxAttempts: MAX_RETRIES + 1,
              backoffMs: delay,
              elapsedMs,
              bodySample: bodyText.slice(0, 200),
            });
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          log.error('LLM proxy non-OK — giving up', {
            process: processName,
            status: response.status,
            attempt: attempt + 1,
            elapsedMs,
            bodySample: bodyText.slice(0, 300),
          });
          return null;
        }

        // 2xx — parse and pull `content`. When `output === maxTokens` the
        // model truncated and returned empty content — that's deterministic
        // for this prompt, so retrying with the same prompt would burn
        // another full Sonnet call for the same result. Skip the retry on
        // truncation; only retry empty content when output did NOT hit the
        // ceiling (suggests a transient streaming hiccup).
        let parsed;
        try { parsed = JSON.parse(bodyText); } catch { parsed = null; }
        const content = parsed?.content;
        const outTokens = parsed?.tokens?.output;
        const hitMaxTokens = typeof outTokens === 'number'
          && outTokens >= MAX_TOKENS - 1;
        if (!content) {
          if (hitMaxTokens) {
            log.error('LLM hit max_tokens — content empty, no retry (deterministic)', {
              process: processName,
              maxTokens: MAX_TOKENS,
              outputTokens: outTokens,
              inputTokens: parsed?.tokens?.input,
              elapsedMs,
              provider: parsed?.provider,
              model: parsed?.model,
            });
            return null;
          }
          if (attempt < MAX_RETRIES) {
            const delay = BACKOFF_MS[attempt];
            log.warn('LLM 200 but empty content — retrying', {
              process: processName,
              attempt: attempt + 1,
              maxAttempts: MAX_RETRIES + 1,
              backoffMs: delay,
              elapsedMs,
              provider: parsed?.provider,
              model: parsed?.model,
              outputTokens: outTokens,
              bodySample: bodyText.slice(0, 300),
            });
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          log.error('LLM 200 but empty content — giving up', {
            process: processName,
            attempt: attempt + 1,
            elapsedMs,
            bodySample: bodyText.slice(0, 300),
          });
          return null;
        }
        return content;
      } catch (err) {
        const elapsedMs = Date.now() - startedAt;
        if (isRetryable(err) && attempt < MAX_RETRIES) {
          const delay = BACKOFF_MS[attempt];
          log.warn('LLM fetch transient — retrying', {
            process: processName,
            attempt: attempt + 1,
            maxAttempts: MAX_RETRIES + 1,
            backoffMs: delay,
            elapsedMs,
            err: err.message,
          });
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        log.error('LLM fetch failed', {
          process: processName,
          attempt: attempt + 1,
          elapsedMs,
          err: err.message,
        });
        return null;
      }
    }
    return null;
  }

  // --- Prompt builders ---

  _buildConsolidationPrompt(date, obsBlock, count) {
    return {
      system: `You consolidate daily coding observations into thematic digests.

INPUT: A numbered list of observations from a single day. Each has a timestamp, agent name, and a structured summary (Intent/Approach/Artifacts/Result lines).

TASK: Group observations that belong to the SAME logical work session or topic. For each group, produce a consolidated digest.

OUTPUT FORMAT — respond with one or more digest blocks, each in this exact format:

<digest>
<theme>Short descriptive title (5-10 words)</theme>
<observations>1,3,5,7</observations>
<summary>
Consolidated narrative of what happened: what was the goal, what approach was taken, what was achieved, what files were changed. Use markdown formatting: bullet lists (- item) for multiple changes/files/issues, \`backticks\` for file paths and code. 3-10 lines.
</summary>
</digest>

RULES:
- Group observations by cognitive topic — even if worded differently, "debug observations frontend" and "fix observations not showing" are the same topic.
- A single observation that doesn't fit any group gets its own digest.
- Preserve technical specifics: file paths, error messages, architectural decisions.
- Mention which agents were involved if multiple agents worked on the same topic.
- Order digests chronologically by the earliest observation in each group.
- Do NOT include observation numbers that don't exist in the input.`,

      user: `Date: ${date}
Observation count: ${count}

${obsBlock}

Produce the digests.`,
    };
  }

  _buildInsightPrompt(digestBlock, existingBlock, count) {
    return {
      system: `You are the long-term memory of a software project. You consolidate daily work digests into persistent, reusable REFERENCE ARTICLES — not changelogs, not timelines.

INPUT: Daily digests describing work sessions, plus existing insights (if any).

TASK: Synthesize persistent project knowledge from the digests. Each insight is a SELF-CONTAINED REFERENCE ARTICLE that a developer can consult to understand a subsystem without reading any other document.

CRITICAL — WHAT TO PRODUCE:
✅ Timeless reference knowledge: "The coordinator probes LevelDB/Qdrant every 30s via PSM and maps results to sub-check keys"
✅ Architecture: "Health verification runs in 3 layers: coordinator (:3034), dashboard server (:3033), frontend (Next.js :3030)"
✅ File locations: "Key files: \`src/health-coordinator.js\`, \`integrations/system-health-dashboard/server.js\`"
✅ Troubleshooting: "If sub-checks show 'unknown', restart the coordinator to force re-probe"

CRITICAL — WHAT NOT TO PRODUCE:
❌ Dated entries: "Fix applied on 2026-05-14: ..."
❌ Changelog items: "Bug fix: toUiStatus now handles 'passed' status"
❌ Session narratives: "Developer investigated and found that..."
❌ Commit references: "Committed as abc123"

OUTPUT FORMAT — respond with one or more insight blocks:

<insight>
<topic>Component or area name (e.g. "Health Monitoring System", "Docker Build Pipeline")</topic>
<scope>One concrete subsystem, tool, or workflow. Must be narrow enough to point at one folder, binary, or service.</scope>
<confidence>0.0-1.0</confidence>
<summary>
Structure the summary as a REFERENCE ARTICLE with these sections (use ## headings):

## Purpose
What this component/system does and why it exists. 1-3 sentences.

## Architecture
How it's built — key modules, data flow, protocols. Include file paths with \`backticks\`.
Use bullet lists for components/layers.

## Key Files
- \`path/to/file.js\` — role description
- \`path/to/other.js\` — role description

## Usage
How/where/by whom this is used. What triggers it, what consumes its output.

## Troubleshooting
Common failure modes and how to diagnose/fix them. Include log locations, test commands, restart procedures.

Keep each section concise (2-5 lines). Total summary: 10-30 lines.
</summary>
</insight>

RULES:
- **One insight = one subsystem.** Each <insight> block must describe a single coherent component, tool, or workflow. If digests cover unrelated subsystems, emit SEPARATE insights.
- **Shared vocabulary is not a merge signal.** Two digests both mentioning "statusline" or "settings.json" do NOT belong together unless they describe the same code path.
- **Synthesize, don't summarize.** Extract the CURRENT STATE of knowledge — what IS true now — not what happened historically. Strip all dates, commit hashes, and session narratives.
- If an existing insight's topic matches new digest content, produce an UPDATED version (same topic name) with merged knowledge — replacing outdated information, not appending to a timeline.
- Don't create insights for one-off tasks that are fully complete and unlikely to recur.
- Confidence reflects how many data points support the insight (0.5 = single digest, 0.9 = many corroborating digests).
- Topic names should be stable across updates (don't rename topics).`,

      user: `--- NEW DIGESTS (${count}) ---

${digestBlock}

--- EXISTING INSIGHTS ---

${existingBlock}

Produce updated/new insights. Each insight MUST be a structured reference article with ## Purpose, ## Architecture, ## Key Files, ## Usage, and ## Troubleshooting sections. Do NOT include dates, commit hashes, or changelog entries.`,
    };
  }

  // --- Response parsers ---

  /**
   * Parse <digest> blocks from LLM response.
   */
  _parseDigests(response, date, observations, globalOffset = 0) {
    const digestPattern = /<digest>\s*<theme>(.*?)<\/theme>\s*<observations>(.*?)<\/observations>\s*<summary>([\s\S]*?)<\/summary>\s*<\/digest>/g;

    const digests = [];
    let match;
    while ((match = digestPattern.exec(response)) !== null) {
      const theme = match[1].trim();
      const obsNumbers = match[2].trim().split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
      const summary = match[3].trim();

      // Map observation numbers (1-indexed, possibly with global offset) to actual IDs
      const observationIds = obsNumbers
        .map(n => n - globalOffset) // normalize to chunk-local index
        .filter(n => n >= 1 && n <= observations.length)
        .map(n => observations[n - 1].id);

      if (observationIds.length === 0) continue;

      // Extract unique agents and files from the mapped observations
      const agents = [...new Set(observationIds.map(id => {
        const obs = observations.find(o => o.id === id);
        return obs?.agent;
      }).filter(Boolean))];

      const filesTouched = this._extractFiles(observationIds, observations);

      // Quality: high if any source observation is high-quality
      const quality = observationIds.some(id => {
        const obs = observations.find(o => o.id === id);
        return obs?.quality === 'high';
      }) ? 'high' : 'normal';

      digests.push({
        id: crypto.randomUUID(),
        date,
        theme,
        summary,
        observationIds,
        agents,
        filesTouched,
        quality,
        metadata: { sourceCount: observationIds.length },
      });
    }

    return digests;
  }

  /**
   * Parse <insight> blocks from LLM response.
   *
   * Schema (current): <topic> <scope> <confidence> <summary>. The <scope> field is
   * required by the prompt — it forces the LLM to name one concrete subsystem
   * before writing the body, which prevents pan-topic fusions like the historical
   * "GSD Statusline and Hook Integration" insight that conflated GSD planning
   * tooling with the bin/coding tmux statusline.
   *
   * Backward-compat: also accepts the legacy <topic><confidence><summary> shape so
   * an LLM that ignores the new instruction or a model running an older system
   * prompt still produces parseable output (logged as a warning so we can spot
   * regressions). Insights with a missing/empty/generic <scope> get scope = null
   * and metadata.scope_warning, which downstream cluster-quality reporting can
   * surface.
   */
  _parseInsights(response, digests) {
    const withScope = /<insight>\s*<topic>(.*?)<\/topic>\s*<scope>([\s\S]*?)<\/scope>\s*<confidence>(.*?)<\/confidence>\s*<summary>([\s\S]*?)<\/summary>\s*<\/insight>/g;
    const legacy = /<insight>\s*<topic>(.*?)<\/topic>\s*<confidence>(.*?)<\/confidence>\s*<summary>([\s\S]*?)<\/summary>\s*<\/insight>/g;

    // Generic scopes that are too vague to count as subsystem-narrow — these
    // are exactly the failure mode we want to catch ("various", "tools",
    // "system", etc.). When we see one, treat scope as missing.
    const GENERIC_SCOPE = /^(various|tools?|system|configuration|setup|misc(ellaneous)?|general|n\/?a|none)$/i;

    const insights = [];
    const seenSpans = [];

    let m;
    while ((m = withScope.exec(response)) !== null) {
      const topic = m[1].trim();
      const scopeRaw = m[2].trim();
      const confidence = Math.min(1.0, Math.max(0.0, parseFloat(m[3].trim()) || 0.5));
      const summary = m[4].trim();
      const scope = scopeRaw && !GENERIC_SCOPE.test(scopeRaw) ? scopeRaw : null;
      const metadata = scope ? { scope } : { scope: null, scope_warning: 'missing_or_generic' };
      insights.push({ topic, summary, confidence, metadata });
      seenSpans.push([m.index, m.index + m[0].length]);
    }

    // Pick up legacy-shape blocks the new regex missed (LLM ignored the
    // <scope> instruction entirely). Mark them so we can spot regressions.
    while ((m = legacy.exec(response)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // Skip if this span was already consumed by the with-scope matcher.
      if (seenSpans.some(([s, e]) => start >= s && end <= e)) continue;
      const topic = m[1].trim();
      const confidence = Math.min(1.0, Math.max(0.0, parseFloat(m[2].trim()) || 0.5));
      const summary = m[3].trim();
      insights.push({
        topic,
        summary,
        confidence,
        metadata: { scope: null, scope_warning: 'legacy_no_scope_field' },
      });
    }

    return insights;
  }

  /**
   * Extract file paths from observation summaries.
   */
  _extractFiles(obsIds, observations) {
    const files = new Set();
    for (const id of obsIds) {
      const obs = observations.find(o => o.id === id);
      if (!obs) continue;
      // Extract from Artifacts line
      const artifactsMatch = obs.summary.match(/^Artifacts:\s*(.+)$/m);
      if (artifactsMatch && !/none/i.test(artifactsMatch[1])) {
        const parts = artifactsMatch[1].split(',').map(p => p.trim());
        for (const part of parts) {
          // "edited src/foo.ts" → "src/foo.ts"
          const fileMatch = part.match(/(?:edited|created|deleted|modified)\s+(.+)/i);
          if (fileMatch) files.add(fileMatch[1].trim());
        }
      }
      // Also check metadata for modifiedFiles
      try {
        const meta = JSON.parse(obs.metadata || '{}');
        if (meta.modifiedFiles) meta.modifiedFiles.forEach(f => files.add(f));
      } catch { /* ok */ }
    }
    return [...files];
  }

  /**
   * Get consolidation status. Phase 44 Plan 17: routes through km-core
   * countByOntologyClass (uses the existing predicate-form for the
   * undigested filter).
   */
  async getStatus() {
    if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured — pass options.kmStore');
    const kmStore = this._kmStore;
    const [totalObs, undigested, totalDigests, totalInsights] = await Promise.all([
      kmStore.countByOntologyClass('Observation'),
      kmStore.countByOntologyClass('Observation', {
        predicate: e => !(e.metadata?.digested_at),
      }),
      kmStore.countByOntologyClass('Digest'),
      kmStore.countByOntologyClass('Insight'),
    ]);
    return { totalObs, undigested, totalDigests, totalInsights };
  }

  close() {
    // Phase 44 Plan 17: the km-core GraphKMStore is owned by the caller
    // (obs-api passes its own per ObservationWriter pattern), so it is
    // NOT closed here. Only the consolidator-owned Redis socket needs
    // explicit teardown.
    // ioredis keeps a TCP socket open with reconnection logic; without an
    // explicit disconnect the Node event loop never drains and the wrapper
    // process hangs after printing its summary lines. .disconnect() is sync
    // and tears the socket down immediately (no need to await .quit()).
    if (this._redisPub) {
      try { this._redisPub.disconnect(); } catch { /* ok */ }
      this._redisPub = null;
    }
    // Embedding service / Qdrant clients are HTTP-based; their keep-alive
    // sockets normally drain on their own, but null-ing the references
    // releases them for GC sooner.
    this._embeddingService = null;
    this._qdrantClient = null;
  }
}
