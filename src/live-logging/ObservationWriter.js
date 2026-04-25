/**
 * ObservationWriter - Writes normalized transcript messages as observations to LibSQL
 *
 * Routes LLM summarization calls through the coding LLM proxy (port from LLM_CLI_PROXY_PORT env, default 12435)
 * rather than direct Google/Anthropic API calls, avoiding API key issues in
 * containerized environments.
 *
 * @module ObservationWriter
 */

import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Redis from 'ioredis';
import { ObservationExporter } from './ObservationExporter.js';
import ConfigurableRedactor from './ConfigurableRedactor.js';

const require = createRequire(import.meta.url);

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
        observation: { messageTokens: 20000, bufferTokens: 0.2 },
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
    this.db = null;
    /** @type {Map<string, number>} Recent content hashes → timestamp for dedup */
    this._recentHashes = new Map();
    this._dedupWindowMs = 60_000; // skip duplicates within 60s
    /** Write lock: serializes DB writes so concurrent fire-and-forget calls
     *  don't race past the semantic dedup check (TOCTOU prevention) */
    this._writeLock = Promise.resolve();
    /** @type {import('ioredis').default|null} Redis publisher for embedding events (lazy-init, fire-and-forget) */
    this._redisPub = null;
    this._redisInitAttempted = false;
  }

  /**
   * Initialize the database connection and ensure the observations table exists.
   */
  async init() {
    // Use SafeDatabase for crash-safe open with integrity check, WAL enforcement,
    // auto-recovery, and shutdown handlers. All consumers of observations.db
    // MUST use SafeDatabase to prevent corruption from concurrent/crashed writers.
    const { openDatabase } = await import('./SafeDatabase.js');
    this.db = openDatabase(this.dbPath);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        summary TEXT,
        messages TEXT,
        agent TEXT,
        session_id TEXT,
        source_file TEXT,
        created_at TEXT,
        metadata TEXT
      )
    `);

    // Add columns for dedup and quality (idempotent)
    for (const col of ['content_hash TEXT', 'quality TEXT DEFAULT "normal"']) {
      try { this.db.exec(`ALTER TABLE observations ADD COLUMN ${col}`); } catch { /* exists */ }
    }
    // Index for fast dedup lookups
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_obs_agent_hash ON observations(agent, content_hash)`);

    // FTS5 full-text search table (content-sync with observations).
    // Ensure triggers exist so every INSERT/UPDATE/DELETE keeps the index in sync.
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(summary, content='observations', content_rowid='rowid')`);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
          INSERT INTO observations_fts(rowid, summary) VALUES (new.rowid, new.summary);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
          INSERT INTO observations_fts(observations_fts, rowid, summary) VALUES('delete', old.rowid, old.summary);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
          INSERT INTO observations_fts(observations_fts, rowid, summary) VALUES('delete', old.rowid, old.summary);
          INSERT INTO observations_fts(rowid, summary) VALUES (new.rowid, new.summary);
        END
      `);
    } catch { /* FTS5 not available in this SQLite build — search falls back to LIKE */ }

    // Periodic WAL checkpoint so readonly connections (e.g. Docker health dashboard) see fresh data
    this._walCheckpointInterval = setInterval(() => {
      try { this.db.pragma('wal_checkpoint(PASSIVE)'); } catch { /* db may be closed */ }
    }, 15_000); // every 15 seconds

    // Git-friendly JSON export (mirrors UKB knowledge-export pattern)
    const projectRoot = path.resolve(path.dirname(this.dbPath), '..');
    this._exporter = new ObservationExporter({ db: this.db, projectRoot });
    this._exportTimer = null;

    // Initialize redactor for PII/secret scrubbing (same rules as LSL system)
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

    // Shutdown handlers are registered by SafeDatabase — no need to duplicate here.

    process.stderr.write(`[ObservationWriter] Database initialized: ${this.dbPath}\n`);
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
  async summarize(messages, metadata = {}) {
    const projectName = metadata.project || 'unknown';

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
              '- CRITICAL: If GROUND TRUTH file data is provided below the exchange, you MUST use it for the Artifacts line. Do NOT override it with your own inference.' +
              (artifactHint || ''),
          },
          {
            role: 'user',
            content: `<project>${projectName}</project>\n<exchange>\n` + exchangeBlock + '\n</exchange>\n\nProduce the observation summary.',
          },
        ],
      };
      // Retry loop: 2 attempts with 3s backoff
      const MAX_RETRIES = 2;
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
              await new Promise(r => setTimeout(r, 3000));
              continue;
            }
            return { summary: this._fallbackSummary(messages) };
          }

          const result = await response.json();
          const summary = this._sanitizeSummary(result.content) || this._fallbackSummary(messages);
          const llm = result.model && result.provider
            ? { model: result.model, provider: result.provider, tokens: result.tokens || null, latencyMs: result.latencyMs || null }
            : undefined;
          process.stderr.write(`[ObservationWriter] Summary ${result.content ? 'received' : 'MISSING'} (${summary.length} chars) via ${llm ? `${llm.model}@${llm.provider}` : 'fallback'}\n`);
          return { summary, llm };
        } catch (err) {
          lastError = err.message;
          process.stderr.write(`[ObservationWriter] Attempt ${attempt} failed: ${err.message}\n`);
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      }

      process.stderr.write(`[ObservationWriter] All ${MAX_RETRIES} attempts failed. Last error: ${lastError}. Storing raw summary.\n`);
      return { summary: this._fallbackSummary(messages) };
    } catch (err) {
      process.stderr.write(`[ObservationWriter] Unexpected error: ${err.message}. Storing raw summary.\n`);
      return { summary: this._fallbackSummary(messages) };
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
   * Write a single observation to the database.
   *
   * @param {string} summary - Observation summary text
   * @param {Array} messages - Original messages
   * @param {Object} metadata - Additional metadata (agent, sessionId, sourceFile)
   */
  async writeObservation(summary, messages, metadata = {}) {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

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

    // Content-based dedup: hash user messages + assistant content + session context
    // Include assistant content because identical user prompts (e.g. "Continue") in
    // different sessions produce completely different exchanges.
    const userContent = messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join('|');
    const assistantContent = messages
      .filter(m => m.role === 'assistant')
      .map(m => typeof m.content === 'string' ? m.content.slice(0, 500) : '')
      .join('|');
    const sessionId = metadata.session_id || '';
    const hashInput = `${sessionId}|${userContent}|${assistantContent}`;
    const contentHash = crypto.createHash('md5').update(hashInput).digest('hex');

    const existing = this.db.prepare(
      'SELECT id, summary, metadata FROM observations WHERE agent = ? AND content_hash = ? LIMIT 1'
    ).get(agent, contentHash);
    if (existing) {
      // If the existing observation has no artifacts but this re-fire does, patch it
      const hasNoArtifacts = /Artifacts:\s*none/i.test(existing.summary);
      const newModifiedFiles = metadata.modifiedFiles;
      if (hasNoArtifacts && newModifiedFiles && newModifiedFiles.length > 0) {
        const artifactsList = newModifiedFiles.map(f => {
          const base = f.split('/').pop();
          return `edited ${base}`;
        }).join(', ');
        const updatedSummary = existing.summary.replace(/Artifacts:\s*none/i, `Artifacts: ${artifactsList}`);
        let existingMeta = {};
        try { existingMeta = JSON.parse(existing.metadata || '{}'); } catch { /* ignore */ }
        existingMeta.modifiedFiles = newModifiedFiles;
        if (metadata.readFiles) existingMeta.readFiles = metadata.readFiles;
        this.db.prepare('UPDATE observations SET summary = ?, metadata = ? WHERE id = ?')
          .run(updatedSummary, JSON.stringify(existingMeta), existing.id);
        process.stderr.write(`[ObservationWriter] Dedup+patch: updated ${existing.id.slice(0, 8)} with ${newModifiedFiles.length} artifacts\n`);
        return existing.id;
      }
      process.stderr.write(`[ObservationWriter] Dedup: same input already observed (hash=${contentHash.slice(0, 8)})\n`);
      return null;
    }

    // Semantic dedup: check if a very similar observation was written recently (same agent, last 5)
    if (this._isSemanticallyDuplicate(agent, summary)) {
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

    const stmt = this.db.prepare(`
      INSERT INTO observations (id, summary, messages, agent, session_id, source_file, created_at, metadata, content_hash, quality)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      redactedSummary,
      JSON.stringify(redactedMessages),
      agent,
      metadata.sessionId || null,
      metadata.sourceFile || null,
      nowISO,
      this._redact(JSON.stringify(metadata)),
      contentHash,
      quality,
    );

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

    // Debounced JSON export — coalesce rapid-fire writes into one export
    this._scheduleExport();

    return id;
  }

  /**
   * Schedule a debounced JSON export. Coalesces rapid writes (e.g. batch
   * processing) into a single export 10s after the last write.
   */
  _scheduleExport() {
    if (!this._exporter) return;
    if (this._exportTimer) clearTimeout(this._exportTimer);
    this._exportTimer = setTimeout(() => {
      try { this._exporter.exportObservations(); } catch (err) {
        process.stderr.write(`[ObservationWriter] Export error: ${err.message}\n`);
      }
    }, 10_000);
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
   * Uses stemmed keyword overlap with both Jaccard and containment measures
   * against a 4-hour window of recent observations.
   */
  _isSemanticallyDuplicate(agent, summary) {
    if (!this.db) return false;

    const newIntent = this._extractIntent(summary);
    const newApproach = this._extractApproach(summary);
    const newText = [newIntent, newApproach].filter(Boolean).join(' ');
    if (!newText || newText.length < 20) return false;

    // Check last 50 observations within the past 4 hours (covers rapid-fire sessions)
    const recent = this.db.prepare(
      `SELECT summary FROM observations
       WHERE agent = ? AND created_at > datetime('now', '-4 hours')
       ORDER BY created_at DESC LIMIT 50`
    ).all(agent);

    const newKeywords = this._extractKeywords(newText);
    if (newKeywords.size < 3) return false;

    for (const row of recent) {
      const existingIntent = this._extractIntent(row.summary);
      const existingApproach = this._extractApproach(row.summary);
      const existingText = [existingIntent, existingApproach].filter(Boolean).join(' ');
      if (!existingText) continue;

      const existingKeywords = this._extractKeywords(existingText);
      if (existingKeywords.size < 3) continue;

      // Count intersection
      let intersection = 0;
      for (const w of newKeywords) {
        if (existingKeywords.has(w)) intersection++;
      }

      // Two complementary measures:
      // 1. Jaccard: shared / total unique keywords (catches equal-length overlap)
      const union = new Set([...newKeywords, ...existingKeywords]).size;
      const jaccard = intersection / union;

      // 2. Containment: shared / min set size (catches subset relationships,
      //    e.g. "fix observations frontend" is contained in "fix three issues
      //    shadow folder observations frontend reclassify")
      const minSize = Math.min(newKeywords.size, existingKeywords.size);
      const containment = intersection / minSize;

      // Duplicate if either: strong Jaccard OR high containment of the smaller set
      if (jaccard > 0.4 || containment > 0.7) return true;
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
        // LLM summarization runs outside the lock (slow, ~5-15s)
        const { summary, llm } = await this.summarize(chunk, metadata);
        const enrichedMeta = llm
          ? { ...metadata, llmModel: llm.model, llmProvider: llm.provider, llmTokens: llm.tokens, llmLatencyMs: llm.latencyMs }
          : metadata;

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
   * Close the database connection.
   */
  async close() {
    if (this._walCheckpointInterval) {
      clearInterval(this._walCheckpointInterval);
      this._walCheckpointInterval = null;
    }
    // Flush any pending export before closing
    if (this._exportTimer) {
      clearTimeout(this._exportTimer);
      this._exportTimer = null;
    }
    if (this._exporter && this.db) {
      try { this._exporter.exportObservations(); } catch { /* best effort */ }
    }
    // Disconnect Redis publisher if active
    if (this._redisPub) {
      try { this._redisPub.disconnect(); } catch { /* best effort */ }
      this._redisPub = null;
    }
    if (this.db) {
      try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
      this.db.close();
      this.db = null;
      process.stderr.write('[ObservationWriter] Database connection closed.\n');
    }
  }
}
