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
import fs from 'node:fs';
import path from 'node:path';
import { ObservationExporter } from './ObservationExporter.js';
import ConfigurableRedactor from './ConfigurableRedactor.js';
import { ObservationSanitizer } from './ObservationSanitizer.js';
import Redis from 'ioredis';

/**
 * Cosine threshold for treating a new insight as a near-duplicate of an
 * existing one. MiniLM-L6-v2 cosines for "any two project documents" floor
 * around 0.89-0.92, so genuine same-topic duplicates only emerge above ~0.93.
 */
const INSIGHT_DEDUP_THRESHOLD = 0.93;

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
   * @param {string} [options.dbPath] - Path to observations SQLite database
   * @param {string} [options.proxyUrl] - LLM proxy URL
   * @param {string} [options.provider] - LLM provider override
   */
  constructor(options = {}) {
    this.dbPath = options.dbPath || '.observations/observations.db';
    const proxyPort = process.env.LLM_CLI_PROXY_PORT || '12435';
    this.proxyUrl = options.proxyUrl || process.env.LLM_CLI_PROXY_URL || `http://localhost:${proxyPort}`;
    this.provider = options.provider || null;
    this.db = null;
    /** @type {import('ioredis').default|null} Redis publisher for embedding events (lazy-init, fire-and-forget) */
    this._redisPub = null;
    this._redisInitAttempted = false;
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
   * Find an existing insight whose embedding is similar enough to the new
   * entry that they should be treated as the same topic (entity resolution).
   *
   * Embeds the entry's topic + summary via fastembed, queries the Qdrant
   * `insights` collection, returns the top hit's id if cosine score is at
   * or above INSIGHT_DEDUP_THRESHOLD. Returns null on any error or miss.
   *
   * @param {{ topic: string, summary: string }} entry
   * @returns {Promise<string|null>}
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
      limit: 1,
      score_threshold: INSIGHT_DEDUP_THRESHOLD,
      with_payload: false,
      with_vector: false,
      filter: { must: [{ key: 'project', match: { value: project } }] },
    };
    const results = await tools.qdrant.search('insights', search);
    if (!results || results.length === 0) return null;
    return String(results[0].id);
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
    const vkbUrl = process.env.VKB_API_URL || 'http://localhost:8080';
    const project = entry.project || 'coding';
    const { entityClass, confidence: classConf } = this._classifyInsightByOntology(entry.topic, entry.summary || '');

    // Ensure a Project anchor exists for this team. Without it, the
    // online insights float disconnected from the rest of the graph
    // because no other entity references them.
    const projectName = await this._ensureProjectAnchor(vkbUrl, project);

    const body = {
      entityType: entityClass,
      observations: [entry.summary || entry.topic],
      significance: Math.round(((entry.confidence ?? 0.6) * 10)),
      team: project,
      source: 'online',
      metadata: {
        confidence: entry.confidence,
        digest_ids: entry._digestIds || [],
        ontology: {
          ontologyName: 'development-knowledge-ontology',
          classificationMethod: 'heuristic-token-overlap',
          classificationConfidence: classConf,
        },
      },
    };
    try {
      const res = await fetch(
        `${vkbUrl}/api/entities/${encodeURIComponent(entry.topic)}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) {
        const txt = await res.text();
        process.stderr.write(`[Consolidator→KG] PUT ${entry.topic} failed ${res.status}: ${txt.slice(0, 200)}\n`);
        return;
      }
      if (this._kgPushDebug) {
        process.stderr.write(`[Consolidator→KG] ${entry.topic} → ${entityClass} (${classConf.toFixed(2)}) team=${project}\n`);
      }

      // Link the insight back to the project anchor so the viewer
      // shows it inside the project's cluster instead of floating.
      // The relation is idempotent on the server side (POST returns
      // success even if it already exists), so re-synthesis is safe.
      if (projectName) {
        try {
          await fetch(`${vkbUrl}/api/relations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: projectName,
              to: entry.topic,
              type: 'has_insight',
              team: project,
              confidence: 1.0,
            }),
          });
        } catch (err) {
          process.stderr.write(`[Consolidator→KG] relation ${projectName} → ${entry.topic} failed: ${err.message}\n`);
        }
      }
    } catch (err) {
      process.stderr.write(`[Consolidator→KG] PUT ${entry.topic} failed: ${err.message}\n`);
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

    const update = this.db.prepare(`
      UPDATE observations
      SET metadata = json_set(COALESCE(metadata, '{}'), '$.project', ?)
      WHERE id = ?
    `);
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
      try { update.run(project, o.id); } catch { /* ok */ }
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
   * Initialize DB connection and ensure digest/insight tables exist.
   */
  async init() {
    const { openDatabase } = await import('./SafeDatabase.js');
    this.db = openDatabase(this.dbPath);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS digests (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        theme TEXT NOT NULL,
        summary TEXT NOT NULL,
        observation_ids TEXT NOT NULL,
        agents TEXT,
        files_touched TEXT,
        quality TEXT DEFAULT 'normal',
        created_at TEXT NOT NULL,
        metadata TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS insights (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        summary TEXT NOT NULL,
        confidence REAL DEFAULT 0.8,
        digest_ids TEXT NOT NULL,
        last_updated TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata TEXT
      )
    `);

    // Track which observations have been digested
    try {
      this.db.exec('ALTER TABLE observations ADD COLUMN digested_at TEXT');
    } catch { /* column exists */ }

    // Project-attribution columns (Phase A added via migration script —
    // mirrored here so a fresh DB still has them).
    try { this.db.exec('ALTER TABLE digests ADD COLUMN project TEXT'); } catch { /* exists */ }
    try { this.db.exec('ALTER TABLE insights ADD COLUMN project TEXT'); } catch { /* exists */ }

    // Index for efficient undigested lookups
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_obs_digested ON observations(digested_at)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_digests_date ON digests(date)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_insights_topic ON insights(topic)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_digests_project ON digests(project)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_insights_project ON insights(project)');

    // Git-friendly JSON export (mirrors UKB knowledge-export pattern)
    const projectRoot = path.resolve(path.dirname(this.dbPath), '..');
    this._exporter = new ObservationExporter({ db: this.db, projectRoot });

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

    process.stderr.write(`[Consolidator] Database initialized\n`);
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
    if (!this.db) throw new Error('Not initialized');

    // Get undigested observations for this date
    const observations = this.db.prepare(`
      SELECT id, summary, agent, created_at, metadata, quality
      FROM observations
      WHERE substr(created_at, 1, 10) = ?
        AND digested_at IS NULL
        AND quality != 'low'
      ORDER BY created_at ASC
    `).all(date);

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
        const result = await this._callLLM(prompt);

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

    // Write digests and mark observations as digested
    const now = new Date().toISOString();
    const insertDigest = this.db.prepare(`
      INSERT INTO digests (id, date, theme, summary, observation_ids, agents, files_touched, quality, created_at, metadata, project)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const getDigest = this.db.prepare(
      'SELECT id, observation_ids, agents, files_touched, summary, quality, project FROM digests WHERE id = ?'
    );
    const updateDigest = this.db.prepare(`
      UPDATE digests
      SET observation_ids = ?, agents = ?, files_touched = ?, summary = ?, quality = ?, created_at = ?
      WHERE id = ?
    `);
    const markDigested = this.db.prepare(
      'UPDATE observations SET digested_at = ? WHERE id = ?'
    );

    // Build merge plan via embedding similarity (async, pre-transaction).
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
    const transaction = this.db.transaction(() => {
      for (let i = 0; i < digestEntries.length; i++) {
        const d = digestEntries[i];
        const decision = mergePlan[i] ?? { action: 'insert' };

        if (decision.action === 'merge' && decision.targetId) {
          const target = getDigest.get(decision.targetId);
          if (target) {
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

            updateDigest.run(
              JSON.stringify([...oidUnion]),
              JSON.stringify([...agentUnion]),
              this._redactPaths(JSON.stringify([...fileUnion])),
              winnerSummary,
              bestQuality,
              now,
              decision.targetId
            );
            mergedTargets.add(decision.targetId);
            mergedCount++;
            for (const obsId of d.observationIds || []) digestedObsIds.add(obsId);
            continue;
          }
          // target row missing — fall through to insert
        }

        insertDigest.run(
          d.id, d.date, this._redact(d.theme), this._redact(d.summary),
          JSON.stringify(d.observationIds),
          JSON.stringify(d.agents),
          this._redactPaths(JSON.stringify(d.filesTouched)),
          d.quality, now, this._redactPaths(JSON.stringify(d.metadata || {})),
          d.project || 'unknown'
        );
        createdCount++;
        for (const obsId of d.observationIds) digestedObsIds.add(obsId);
      }
      for (const obsId of digestedObsIds) {
        markDigested.run(now, obsId);
      }
    });
    transaction();

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

    // WAL checkpoint for readonly readers
    try { this.db.pragma('wal_checkpoint(PASSIVE)'); } catch { /* ok */ }

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
    if (!this.db) throw new Error('Not initialized');

    const days = this.db.prepare(`
      SELECT DISTINCT substr(created_at, 1, 10) as date
      FROM observations
      WHERE digested_at IS NULL AND quality != 'low'
      ORDER BY date ASC
    `).all();

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
    if (!this.db) throw new Error('Not initialized');

    // Get unsynthesized digests, including their project label so the
    // synthesis pass can partition by project. A digest has been
    // synthesized once any insight links to its id.
    const digests = this.db.prepare(`
      SELECT d.id, d.date, d.theme, d.summary, d.agents, d.files_touched, d.metadata, d.project
      FROM digests d
      LEFT JOIN insights i ON d.id IN (
        SELECT value FROM json_each(i.digest_ids)
      )
      WHERE i.id IS NULL
      ORDER BY d.date ASC
    `).all();

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
    // synthesis run only sees in-domain prior knowledge.
    const allExistingInsights = this.db.prepare(
      'SELECT id, topic, summary, digest_ids, project FROM insights ORDER BY last_updated DESC'
    ).all();

    const breakdown = [...digestsByProject.entries()]
      .map(([p, list]) => `${p}=${list.length}`).join(', ');
    const totalProjects = digestsByProject.size;
    process.stderr.write(`[Consolidator] Stage 2/2: synthesizing ${digests.length} digests into insights — ${totalProjects} project(s): ${breakdown}\n`);

    const DIGEST_CHUNK_SIZE = 30;
    const allInsightEntries = [];

    let projectIdx = 0;
    for (const [project, projDigests] of digestsByProject) {
      projectIdx++;
      process.stderr.write(`[Consolidator] Project ${projectIdx}/${totalProjects}: ${project} — synthesizing ${projDigests.length} digest(s)\n`);
      const existingForProject = allExistingInsights.filter(
        i => (i.project || 'unknown') === project
      );

      const digestChunks = [];
      for (let i = 0; i < projDigests.length; i += DIGEST_CHUNK_SIZE) {
        digestChunks.push(projDigests.slice(i, i + DIGEST_CHUNK_SIZE));
      }

      let projectInsightEntries = [];
      for (let ci = 0; ci < digestChunks.length; ci++) {
        const chunk = digestChunks[ci];

        const digestBlock = chunk.map(d =>
          `[${d.date}] ${d.theme}\n${d.summary}`
        ).join('\n\n---\n\n');

        // Combine DB insights for this project with insights produced in
        // earlier chunks of the same project run, so the LLM keeps merging
        // duplicates instead of restating them.
        const currentInsights = [
          ...existingForProject.map(i => ({ topic: i.topic, summary: i.summary })),
          ...projectInsightEntries,
        ];
        const existingBlock = currentInsights.length > 0
          ? currentInsights.map(i => `## ${i.topic}\n${i.summary}`).join('\n\n')
          : 'None yet.';

        process.stderr.write(`[Consolidator] Insight synthesis ${project} chunk ${ci + 1}/${digestChunks.length} (${chunk.length} digests)\n`);

        const prompt = this._buildInsightPrompt(digestBlock, existingBlock, chunk.length);
        const result = await this._callLLM(prompt);

        if (!result) {
          process.stderr.write(`[Consolidator] LLM call failed for ${project} insight chunk ${ci + 1}, skipping\n`);
          continue;
        }

        const chunkInsights = this._parseInsights(result, chunk);
        for (const newInsight of chunkInsights) {
          newInsight.project = project;
          newInsight._digestIds = chunk.map(d => d.id);
          const existingIdx = projectInsightEntries.findIndex(e => e.topic === newInsight.topic);
          if (existingIdx >= 0) {
            // Preserve digest-id provenance across chunks so a topic
            // touched twice within the same project run still records
            // every contributing digest.
            const prior = projectInsightEntries[existingIdx]._digestIds || [];
            newInsight._digestIds = [...new Set([...prior, ...newInsight._digestIds])];
            projectInsightEntries[existingIdx] = newInsight;
          } else {
            projectInsightEntries.push(newInsight);
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
        entry._mergeTargetId = await this._findSimilarInsightId(entry);
      } catch (err) {
        process.stderr.write(`[Consolidator] Similarity check failed (non-fatal): ${err.message}\n`);
        entry._mergeTargetId = null;
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

    const transaction = this.db.transaction(() => {
      for (const entry of insightEntries) {
        const project = entry.project || 'unknown';
        const entryDigestIds = entry._digestIds || [];

        // Prefer embedding-based merge target (catches "Service" vs "System"
        // type rewordings). Fall back to exact topic match — but scope by
        // project so a same-named topic from another project can't capture
        // this one.
        let existing = null;
        if (entry._mergeTargetId) {
          existing = this.db.prepare(
            'SELECT id, digest_ids, project FROM insights WHERE id = ?'
          ).get(entry._mergeTargetId);
          // Defense-in-depth: if the matched row's project disagrees,
          // refuse the merge and fall back to insert.
          if (existing && (existing.project || 'unknown') !== project) existing = null;
        }
        if (!existing) {
          existing = this.db.prepare(
            'SELECT id, digest_ids, project FROM insights WHERE topic = ? AND project = ?'
          ).get(entry.topic, project);
        }

        if (existing) {
          let existingDigestIds = [];
          try { existingDigestIds = JSON.parse(existing.digest_ids || '[]'); } catch { /* ok */ }
          const mergedDigestIds = [...new Set([...existingDigestIds, ...entryDigestIds])];

          this.db.prepare(`
            UPDATE insights SET summary = ?, digest_ids = ?, last_updated = ?, confidence = ?
            WHERE id = ?
          `).run(this._redact(entry.summary), JSON.stringify(mergedDigestIds), now, entry.confidence, existing.id);
          embeddingQueue.push({ id: existing.id, summary: this._redact(entry.summary), topic: entry.topic, confidence: entry.confidence, project });
          updated++;
        } else {
          const id = crypto.randomUUID();
          this.db.prepare(`
            INSERT INTO insights (id, topic, summary, confidence, digest_ids, last_updated, created_at, metadata, project)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id, this._redact(entry.topic), this._redact(entry.summary),
            entry.confidence, JSON.stringify(entryDigestIds),
            now, now, this._redactPaths(JSON.stringify(entry.metadata || {})),
            project
          );
          embeddingQueue.push({ id, summary: this._redact(entry.summary), topic: entry.topic, confidence: entry.confidence, project });
          created++;
        }
      }
    });
    transaction();

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

    try { this.db.pragma('wal_checkpoint(PASSIVE)'); } catch { /* ok */ }

    process.stderr.write(`[Consolidator] Insights: ${created} created, ${updated} updated (mirrored to KG as 'online' entities)\n`);
    return { created, updated };
  }

  /**
   * Run full consolidation pipeline: digests then insights.
   * @returns {Promise<Object>}
   */
  async run({ includeToday = false } = {}) {
    const digestResult = await this.consolidateAll({ includeToday });
    let insightResult = { created: 0, updated: 0 };

    // Only synthesize insights if we have enough digests (>= 5 unsynthesized)
    const unsynthesizedCount = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM digests d
      LEFT JOIN insights i ON d.id IN (SELECT value FROM json_each(i.digest_ids))
      WHERE i.id IS NULL
    `).get().cnt;

    if (unsynthesizedCount >= 5) {
      insightResult = await this.synthesizeInsights();
    } else {
      process.stderr.write(`[Consolidator] Only ${unsynthesizedCount} unsynthesized digests — waiting for >= 5 before insight synthesis\n`);
    }

    // Apply confidence decay to existing insights
    this._decayConfidence();

    // Export all tiers to git-tracked JSON after consolidation
    if (this._exporter) {
      try { this._exporter.exportAll(); } catch (err) {
        process.stderr.write(`[Consolidator] Export error: ${err.message}\n`);
      }
    }

    return { ...digestResult, ...insightResult };
  }

  /**
   * Decay confidence of insights that haven't been updated recently.
   * Reduces confidence by 0.05 per week of inactivity, flooring at 0.3.
   */
  _decayConfidence() {
    if (!this.db) return;

    const DECAY_PER_WEEK = 0.05;
    const MIN_CONFIDENCE = 0.3;

    const insights = this.db.prepare(
      'SELECT id, confidence, last_updated FROM insights'
    ).all();

    const now = Date.now();
    const update = this.db.prepare(
      'UPDATE insights SET confidence = ? WHERE id = ?'
    );

    let decayed = 0;
    for (const ins of insights) {
      const lastUpdated = new Date(ins.last_updated).getTime();
      const weeksStale = (now - lastUpdated) / (7 * 86400000);
      if (weeksStale < 1) continue;

      const newConfidence = Math.max(MIN_CONFIDENCE, ins.confidence - (DECAY_PER_WEEK * Math.floor(weeksStale)));
      if (newConfidence < ins.confidence) {
        update.run(newConfidence, ins.id);
        decayed++;
      }
    }

    if (decayed > 0) {
      process.stderr.write(`[Consolidator] Decayed confidence on ${decayed} stale insights\n`);
    }
  }

  // --- LLM interaction ---

  /**
   * Call the LLM proxy with a system+user prompt.
   * @param {{system: string, user: string}} prompt
   * @returns {Promise<string|null>}
   */
  async _callLLM(prompt) {
    const requestBody = {
      ...(this.provider ? { provider: this.provider } : {}),
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    };

    try {
      const response = await fetch(`${this.proxyUrl}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(180000), // 3min — consolidation prompts can be large
      });

      if (!response.ok) {
        const errBody = await response.text();
        process.stderr.write(`[Consolidator] LLM proxy error ${response.status}: ${errBody.slice(0, 200)}\n`);
        return null;
      }

      const result = await response.json();
      return result.content || null;
    } catch (err) {
      process.stderr.write(`[Consolidator] LLM call failed: ${err.message}\n`);
      return null;
    }
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
      system: `You are the long-term memory of a software project. You consolidate daily work digests into persistent knowledge.

INPUT: Daily digests describing work sessions, plus existing insights (if any).

TASK: Extract or update persistent project knowledge from the digests. Focus on:
- What components/systems have been built or changed
- Recurring problems and their solutions
- Architectural decisions and their rationale
- Tools, patterns, and workflows the team uses
- Known issues and technical debt

OUTPUT FORMAT — respond with one or more insight blocks:

<insight>
<topic>Component or area name (e.g. "Dashboard Observations System", "Docker Build Pipeline")</topic>
<confidence>0.0-1.0 — how well-established this knowledge is</confidence>
<summary>
What we know about this topic. Written as reference documentation someone could consult to understand the current state.
Use markdown formatting: bullet lists (- item) for enumerating components/issues/steps, \`backticks\` for file paths and code. Structure long summaries with bullet lists rather than dense paragraphs. 3-15 lines.
</summary>
</insight>

RULES:
- If an existing insight's topic matches new digest content, produce an UPDATED version (same topic name) with merged knowledge.
- Don't create insights for one-off tasks that are fully complete and unlikely to recur.
- Prefer fewer, richer insights over many thin ones.
- Confidence reflects how many data points support the insight (0.5 = single digest, 0.9 = many corroborating digests).
- Remove stale information from existing insights when digests show things have changed.
- Topic names should be stable across updates (don't rename topics).`,

      user: `--- NEW DIGESTS (${count}) ---

${digestBlock}

--- EXISTING INSIGHTS ---

${existingBlock}

Produce updated/new insights.`,
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
   */
  _parseInsights(response, digests) {
    const insightPattern = /<insight>\s*<topic>(.*?)<\/topic>\s*<confidence>(.*?)<\/confidence>\s*<summary>([\s\S]*?)<\/summary>\s*<\/insight>/g;

    const insights = [];
    let match;
    while ((match = insightPattern.exec(response)) !== null) {
      const topic = match[1].trim();
      const confidence = Math.min(1.0, Math.max(0.0, parseFloat(match[2].trim()) || 0.5));
      const summary = match[3].trim();

      insights.push({ topic, summary, confidence, metadata: {} });
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
   * Get consolidation status.
   */
  getStatus() {
    if (!this.db) return null;

    const totalObs = this.db.prepare('SELECT COUNT(*) as cnt FROM observations').get().cnt;
    const undigested = this.db.prepare('SELECT COUNT(*) as cnt FROM observations WHERE digested_at IS NULL').get().cnt;
    const totalDigests = this.db.prepare('SELECT COUNT(*) as cnt FROM digests').get().cnt;
    const totalInsights = this.db.prepare('SELECT COUNT(*) as cnt FROM insights').get().cnt;

    return { totalObs, undigested, totalDigests, totalInsights };
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch { /* ok */ }
      this.db = null;
    }
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
