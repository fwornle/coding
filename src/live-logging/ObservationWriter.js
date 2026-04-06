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

    // Add content_hash column for input-based dedup (idempotent)
    try {
      this.db.exec(`ALTER TABLE observations ADD COLUMN content_hash TEXT`);
    } catch {
      // Column already exists — ignore
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
    const projectHint = metadata.project
      ? ` The agent is working in project "${metadata.project}".`
      : '';

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
            content: 'You produce structured observation summaries from coding exchanges. ' +
              'You MUST respond using ONLY this exact template — nothing else:\n\n' +
              'Intent: [one sentence — what the developer asked for]\n' +
              'Approach: [one sentence — key actions taken: files edited, tools used, commands run]\n' +
              'Outcome: [one sentence — what was achieved or learned]\n' +
              'Status: [done | in-progress | blocked | needs-followup]\n\n' +
              'Constraints:\n' +
              '- Your ENTIRE response must be these 4 lines. Nothing before, nothing after.\n' +
              '- Never reproduce code, commands, file contents, or the assistant\'s words.\n' +
              '- If the exchange has no real work, respond with only: "No actionable content."' +
              projectHint,
          },
          {
            role: 'user',
            content: '<exchange>\n' + exchangeBlock + '\n</exchange>\n\nProduce the 4-line observation summary.',
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

    // Skip trivial observations
    if (summary.toLowerCase().includes('trivial exchange') || summary.toLowerCase().includes('no actionable content')) {
      process.stderr.write(`[ObservationWriter] Skipping trivial observation\n`);
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

    const id = crypto.randomUUID();
    const nowISO = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO observations (id, summary, messages, agent, session_id, source_file, created_at, metadata, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    );

    return id;
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
