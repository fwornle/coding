/**
 * EmbeddingGenerator
 *
 * Dual-vector embedding generation service supporting both local and remote models.
 * Integrates with DatabaseManager for embedding caching and budget tracking.
 *
 * Key Features:
 * - Dual vector support: 384-dim (local) + 1536-dim (remote)
 * - Local model: sentence-transformers/all-MiniLM-L6-v2 via transformers.js
 * - Remote model: text-embedding-3-small via OpenAI API
 * - Automatic caching via DatabaseManager to avoid re-generation
 * - Batch processing for efficiency
 * - Automatic fallback from remote to local
 * - Budget-aware generation (checks BudgetTracker before remote API calls)
 *
 * Vector Sizes:
 * - 384-dim: Fast, local, free - ideal for trajectory analysis, session memory
 * - 1536-dim: High-quality, remote, costs $0.00002/1K tokens - ideal for long-term knowledge
 *
 * Usage:
 * ```javascript
 * const generator = new EmbeddingGenerator({ databaseManager, budgetTracker });
 * await generator.initialize();
 *
 * // Generate local 384-dim embedding (fast, free)
 * const smallVector = await generator.generate('text', { vectorSize: 384 });
 *
 * // Generate remote 1536-dim embedding (high-quality, costs tokens)
 * const largeVector = await generator.generate('text', { vectorSize: 1536 });
 *
 * // Batch generation (efficient)
 * const vectors = await generator.generateBatch(['text1', 'text2'], { vectorSize: 384 });
 * ```
 */

import { EventEmitter } from 'events';

export class EmbeddingGenerator extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.initialized = false;

    // Dependencies (optional)
    this.databaseManager = config.databaseManager || null;
    this.budgetTracker = config.budgetTracker || null;

    // Local model configuration (sentence-transformers)
    this.localModelConfig = {
      enabled: config.local?.enabled !== false,
      model: config.local?.model || 'Xenova/all-MiniLM-L6-v2', // transformers.js model
      vectorSize: 384,
      maxTokens: 512,
      device: config.local?.device || 'cpu'
    };

    // Remote model configuration (OpenAI)
    this.remoteModelConfig = {
      enabled: config.remote?.enabled !== false,
      model: config.remote?.model || 'text-embedding-3-small',
      vectorSize: 1536,
      apiKey: config.remote?.apiKey || process.env.OPENAI_API_KEY,
      baseUrl: config.remote?.baseUrl || 'https://api.openai.com/v1',
      timeout: config.remote?.timeout || 30000
    };

    // Model instances
    this.localPipeline = null;
    this.remoteClient = null;

    // Cache configuration
    this.cacheEnabled = config.cache?.enabled !== false;
    this.cacheTTL = config.cache?.ttl || 30 * 24 * 60 * 60 * 1000; // 30 days

    // Batch processing configuration
    this.batchSize = config.batchSize || 32; // Process in batches of 32
    this.maxConcurrent = config.maxConcurrent || 5; // Max 5 concurrent requests

    // Statistics
    this.stats = {
      generated: 0,
      cached: 0,
      local: 0,
      remote: 0,
      batches: 0,
      errors: 0,
      totalTokens: 0,
      totalCost: 0,
      byVectorSize: {
        384: { generated: 0, cached: 0, cost: 0 },
        1536: { generated: 0, cached: 0, cost: 0 }
      }
    };
  }

  /**
   * Initialize embedding models
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[EmbeddingGenerator] Initializing...');

    // Initialize local model (transformers.js)
    if (this.localModelConfig.enabled) {
      await this.initializeLocalModel();
    }

    // Initialize remote client (OpenAI)
    if (this.remoteModelConfig.enabled && this.remoteModelConfig.apiKey) {
      await this.initializeRemoteClient();
    }

    this.initialized = true;
    this.emit('initialized', {
      local: !!this.localPipeline,
      remote: !!this.remoteClient
    });

    console.log('[EmbeddingGenerator] Initialized -',
      `Local: ${this.localPipeline ? 'available' : 'unavailable'},`,
      `Remote: ${this.remoteClient ? 'available' : 'unavailable'}`
    );
  }

  /**
   * Initialize local embedding model (transformers.js)
   */
  async initializeLocalModel() {
    try {
      console.log('[EmbeddingGenerator] Loading local model:', this.localModelConfig.model);

      // Dynamically import transformers.js (optional dependency)
      const { pipeline } = await import('@xenova/transformers');

      // Create feature extraction pipeline
      this.localPipeline = await pipeline(
        'feature-extraction',
        this.localModelConfig.model,
        { device: this.localModelConfig.device }
      );

      console.log('[EmbeddingGenerator] Local model loaded successfully');
    } catch (error) {
      console.warn('[EmbeddingGenerator] Failed to load local model:', error.message);
      console.warn('[EmbeddingGenerator] Install with: npm install @xenova/transformers');
      this.localPipeline = null;
    }
  }

  /**
   * Initialize remote client (OpenAI)
   */
  async initializeRemoteClient() {
    if (!this.remoteModelConfig.apiKey) {
      console.warn('[EmbeddingGenerator] OpenAI API key not configured, remote embeddings unavailable');
      return;
    }

    try {
      // Simple fetch-based client (no SDK dependency)
      this.remoteClient = {
        baseUrl: this.remoteModelConfig.baseUrl,
        apiKey: this.remoteModelConfig.apiKey,
        model: this.remoteModelConfig.model,
        timeout: this.remoteModelConfig.timeout
      };

      console.log('[EmbeddingGenerator] Remote client initialized');
    } catch (error) {
      console.warn('[EmbeddingGenerator] Failed to initialize remote client:', error);
      this.remoteClient = null;
    }
  }

  /**
   * Generate embedding for a single text
   *
   * @param {string} text - Text to embed
   * @param {object} options - Generation options
   * @returns {Promise<Array<number>>} Embedding vector
   */
  async generate(text, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const vectorSize = options.vectorSize || 384; // Default to local
    const skipCache = options.skipCache || false;

    // Check cache first
    if (this.cacheEnabled && !skipCache && this.databaseManager) {
      const cached = await this.getCachedEmbedding(text, vectorSize);
      if (cached) {
        this.stats.cached++;
        this.stats.byVectorSize[vectorSize].cached++;
        this.emit('cache-hit', { text: text.substring(0, 50), vectorSize });
        return cached;
      }
    }

    // Generate embedding
    let embedding;
    if (vectorSize === 384) {
      embedding = await this.generateLocal(text);
    } else if (vectorSize === 1536) {
      embedding = await this.generateRemote(text);
    } else {
      throw new Error(`Unsupported vector size: ${vectorSize}. Use 384 or 1536.`);
    }

    // Cache for future use
    if (this.cacheEnabled && this.databaseManager && embedding) {
      await this.cacheEmbedding(text, embedding, vectorSize);
    }

    this.stats.generated++;
    this.stats.byVectorSize[vectorSize].generated++;

    return embedding;
  }

  /**
   * Generate embeddings for multiple texts (batch)
   *
   * @param {Array<string>} texts - Texts to embed
   * @param {object} options - Generation options
   * @returns {Promise<Array<Array<number>>>} Array of embedding vectors
   */
  async generateBatch(texts, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const vectorSize = options.vectorSize || 384;
    const results = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);

      // Check cache for each text
      const batchResults = await Promise.all(
        batch.map(text => this.generate(text, options))
      );

      results.push(...batchResults);
      this.stats.batches++;

      this.emit('batch-complete', {
        processed: Math.min(i + this.batchSize, texts.length),
        total: texts.length,
        vectorSize
      });
    }

    return results;
  }

  /**
   * Generate embedding using local model (384-dim)
   */
  async generateLocal(text) {
    if (!this.localPipeline) {
      throw new Error('Local embedding model not available. Install @xenova/transformers.');
    }

    try {
      const startTime = Date.now();

      // Generate embedding
      const output = await this.localPipeline(text, {
        pooling: 'mean',
        normalize: true
      });

      // Extract vector
      const embedding = Array.from(output.data);

      const duration = Date.now() - startTime;

      this.stats.local++;
      this.emit('local-generated', {
        text: text.substring(0, 50),
        vectorSize: embedding.length,
        duration
      });

      console.log(`[EmbeddingGenerator] Generated local embedding (${embedding.length}-dim, ${duration}ms)`);

      return embedding;
    } catch (error) {
      this.stats.errors++;
      console.error('[EmbeddingGenerator] Local generation failed:', error);
      throw error;
    }
  }

  /**
   * Generate embedding using remote API (1536-dim)
   */
  async generateRemote(text) {
    if (!this.remoteClient) {
      console.warn('[EmbeddingGenerator] Remote client unavailable, falling back to local');
      return await this.generateLocal(text);
    }

    // Check budget before making API call
    if (this.budgetTracker) {
      const canAfford = await this.budgetTracker.canAfford(text, {
        provider: 'openai',
        model: this.remoteModelConfig.model,
        operationType: 'embedding'
      });

      if (!canAfford) {
        console.warn('[EmbeddingGenerator] Budget exceeded, falling back to local');
        return await this.generateLocal(text);
      }
    }

    try {
      const startTime = Date.now();

      // Call OpenAI embeddings API
      const response = await fetch(`${this.remoteClient.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.remoteClient.apiKey}`
        },
        body: JSON.stringify({
          model: this.remoteClient.model,
          input: text,
          encoding_format: 'float'
        }),
        signal: AbortSignal.timeout(this.remoteClient.timeout)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      const embedding = data.data[0].embedding;
      const tokens = data.usage.total_tokens;

      // Record cost to budget tracker
      if (this.budgetTracker) {
        await this.budgetTracker.recordCost(tokens, 'openai', {
          model: this.remoteModelConfig.model,
          operationType: 'embedding'
        });
      }

      const duration = Date.now() - startTime;
      const cost = tokens * 0.00002 / 1000; // $0.00002 per 1K tokens

      this.stats.remote++;
      this.stats.totalTokens += tokens;
      this.stats.totalCost += cost;
      this.stats.byVectorSize[1536].cost += cost;

      this.emit('remote-generated', {
        text: text.substring(0, 50),
        vectorSize: embedding.length,
        tokens,
        cost,
        duration
      });

      console.log(`[EmbeddingGenerator] Generated remote embedding (${embedding.length}-dim, ${tokens} tokens, $${cost.toFixed(6)}, ${duration}ms)`);

      return embedding;
    } catch (error) {
      this.stats.errors++;
      console.error('[EmbeddingGenerator] Remote generation failed:', error.message);

      // Fallback to local on error
      if (this.localPipeline) {
        console.log('[EmbeddingGenerator] Falling back to local model');
        return await this.generateLocal(text);
      }

      throw error;
    }
  }

  /**
   * Get cached embedding from DatabaseManager
   */
  async getCachedEmbedding(text, vectorSize) {
    if (!this.databaseManager) {
      return null;
    }

    try {
      const model = vectorSize === 384 ? this.localModelConfig.model : this.remoteModelConfig.model;
      const cached = await this.databaseManager.getCachedEmbedding(text, model, vectorSize);
      return cached;
    } catch (error) {
      console.warn('[EmbeddingGenerator] Failed to get cached embedding:', error);
      return null;
    }
  }

  /**
   * Cache embedding in DatabaseManager
   */
  async cacheEmbedding(text, embedding, vectorSize) {
    if (!this.databaseManager) {
      return;
    }

    try {
      const model = vectorSize === 384 ? this.localModelConfig.model : this.remoteModelConfig.model;
      await this.databaseManager.cacheEmbedding(text, embedding, model, vectorSize);
    } catch (error) {
      console.warn('[EmbeddingGenerator] Failed to cache embedding:', error);
    }
  }

  /**
   * Get generation statistics
   */
  getStats() {
    const cacheHitRate = this.stats.generated + this.stats.cached > 0
      ? (this.stats.cached / (this.stats.generated + this.stats.cached)) * 100
      : 0;

    return {
      ...this.stats,
      cacheHitRate: cacheHitRate.toFixed(2) + '%',
      averageCost: this.stats.generated > 0
        ? (this.stats.totalCost / this.stats.generated).toFixed(6)
        : 0
    };
  }

  /**
   * Clear statistics
   */
  clearStats() {
    this.stats = {
      generated: 0,
      cached: 0,
      local: 0,
      remote: 0,
      batches: 0,
      errors: 0,
      totalTokens: 0,
      totalCost: 0,
      byVectorSize: {
        384: { generated: 0, cached: 0, cost: 0 },
        1536: { generated: 0, cached: 0, cost: 0 }
      }
    };
  }
}

export default EmbeddingGenerator;
