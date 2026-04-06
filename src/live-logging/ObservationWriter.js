/**
 * ObservationWriter - Writes normalized transcript messages as observations to LibSQL
 *
 * Routes LLM summarization calls through the coding LLM proxy (localhost:8089)
 * rather than direct Google/Anthropic API calls, avoiding API key issues in
 * containerized environments.
 *
 * @module ObservationWriter
 */

import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
   * @param {string} [options.proxyUrl] - LLM proxy URL (default: http://localhost:8089)
   * @param {string} [options.model] - Model identifier for summarization
   * @param {number} [options.batchSize] - Messages per summarization batch
   * @param {string} [options.configPath] - Path to .observations/config.json
   */
  constructor(options = {}) {
    const configPath = options.configPath || path.resolve('.observations/config.json');
    const config = loadConfig(configPath);

    this.dbPath = options.dbPath || '.observations/observations.db';
    this.proxyUrl = options.proxyUrl || 'http://localhost:8089';
    // Provider is optional — if omitted, the LLM proxy uses network-adaptive routing
    // (VPN → copilot subscription, outside → claude-code subscription)
    this.provider = options.provider || null;
    this.batchSize = options.batchSize || 10;
    this.messageTokenLimit = config.defaults?.observation?.messageTokens || 20000;
    this.db = null;
    /** @type {Map<string, number>} Recent content hashes → timestamp for dedup */
    this._recentHashes = new Map();
    this._dedupWindowMs = 60_000; // skip duplicates within 60s
  }

  /**
   * Initialize the database connection and ensure the observations table exists.
   */
  async init() {
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);

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

    process.stderr.write(`[ObservationWriter] Database initialized: ${this.dbPath}\n`);
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
              'Approach: [key actions taken — 1-3 sentences]\n' +
              'Artifacts: [list each file modified/created/deleted with verb, e.g. "edited src/foo.ts, created lib/bar.js". Write "none" if no files were touched]\n' +
              'Outcome: [what was achieved, learned, or decided — 1-3 sentences]\n' +
              'Status: [done | in-progress | blocked | needs-followup]\n\n' +
              'Constraints:\n' +
              '- Your ENTIRE response must be these 5 labeled lines. Nothing before, nothing after.\n' +
              '- Never reproduce code, commands, file contents, or the assistant\'s words.\n' +
              '- Intent MUST reflect the user\'s actual question/request, not inferred topics from system context.\n' +
              '- If the exchange has no real work (greetings, "yes", "proceed"), respond with only: "No actionable content."',
          },
          {
            role: 'user',
            content: `<project>${projectName}</project>\n<exchange>\n` + exchangeBlock + '\n</exchange>\n\nProduce the observation summary.',
          },
        ],
      };
      process.stderr.write(`[ObservationWriter] Calling proxy: ${this.proxyUrl}/api/complete (provider: ${this.provider || 'auto'})\n`);

      const response = await fetch(`${this.proxyUrl}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errBody = await response.text();
        process.stderr.write(`[ObservationWriter] Proxy error ${response.status}: ${errBody}\n`);
        return { summary: this._fallbackSummary(messages) };
      }

      const result = await response.json();
      const summary = result.content || this._fallbackSummary(messages);
      const llm = result.model && result.provider
        ? { model: result.model, provider: result.provider, tokens: result.tokens || null, latencyMs: result.latencyMs || null }
        : undefined;
      process.stderr.write(`[ObservationWriter] Summary ${result.content ? 'received' : 'MISSING'} (${summary.length} chars) via ${llm ? `${llm.model}@${llm.provider}` : 'fallback'}\n`);
      return { summary, llm };
    } catch (err) {
      process.stderr.write(`[ObservationWriter] Proxy unavailable: ${err.message}. Storing raw summary.\n`);
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

    // Skip trivial and raw observations (no value for learning)
    const lower = summary.toLowerCase();
    if (lower.includes('trivial exchange') || lower.includes('no actionable content') || summary.startsWith('[Raw]')) {
      process.stderr.write(`[ObservationWriter] Skipping low-value observation\n`);
      return null;
    }

    const agent = metadata.agent || null;

    // Content-based dedup: hash the user message content (stable across LLM re-summarizations)
    const userContent = messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join('|');
    const contentHash = crypto.createHash('md5').update(userContent).digest('hex');

    const existing = this.db.prepare(
      'SELECT id FROM observations WHERE agent = ? AND content_hash = ? LIMIT 1'
    ).get(agent, contentHash);
    if (existing) {
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

    const id = crypto.randomUUID();
    const nowISO = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO observations (id, summary, messages, agent, session_id, source_file, created_at, metadata, content_hash, quality)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      summary,
      JSON.stringify(messages),
      agent,
      metadata.sessionId || null,
      metadata.sourceFile || null,
      nowISO,
      JSON.stringify(metadata),
      contentHash,
      quality,
    );

    return id;
  }

  /**
   * Check if a semantically similar observation already exists for this agent.
   * Extracts the Intent line and compares word overlap with recent observations.
   */
  _isSemanticallyDuplicate(agent, summary) {
    if (!this.db) return false;

    // Extract Intent line from new summary
    const newIntent = this._extractIntent(summary);
    if (!newIntent || newIntent.length < 20) return false;

    // Get recent observations for this agent (last 10)
    const recent = this.db.prepare(
      'SELECT summary FROM observations WHERE agent = ? ORDER BY created_at DESC LIMIT 10'
    ).all(agent);

    const newWords = new Set(newIntent.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (newWords.size < 3) return false;

    for (const row of recent) {
      const existingIntent = this._extractIntent(row.summary);
      if (!existingIntent) continue;

      const existingWords = new Set(existingIntent.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      if (existingWords.size < 3) continue;

      // Calculate Jaccard similarity
      let intersection = 0;
      for (const w of newWords) {
        if (existingWords.has(w)) intersection++;
      }
      const union = new Set([...newWords, ...existingWords]).size;
      const similarity = intersection / union;

      if (similarity > 0.7) return true;
    }
    return false;
  }

  /** Extract the Intent line from a structured observation summary */
  _extractIntent(summary) {
    const match = summary.match(/^Intent:\s*(.+)$/m);
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

    for (const chunk of chunks) {
      try {
        const { summary, llm } = await this.summarize(chunk, metadata);
        const enrichedMeta = llm
          ? { ...metadata, llmModel: llm.model, llmProvider: llm.provider, llmTokens: llm.tokens, llmLatencyMs: llm.latencyMs }
          : metadata;
        await this.writeObservation(summary, chunk, enrichedMeta);
        observations++;
      } catch (err) {
        errors++;
        process.stderr.write(`[ObservationWriter] Error processing chunk: ${err.message}\n`);
      }
    }

    return { observations, errors };
  }

  /**
   * Close the database connection.
   */
  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      process.stderr.write('[ObservationWriter] Database connection closed.\n');
    }
  }
}
