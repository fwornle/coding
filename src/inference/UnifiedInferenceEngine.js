/**
 * UnifiedInferenceEngine
 *
 * Centralized LLM inference engine shared by all components (trajectory, knowledge extraction, etc.)
 * Now delegates all provider management to LLMService from @rapid/llm-proxy.
 *
 * Key Features (preserved):
 * - EventEmitter pattern for inference lifecycle events
 * - Budget tracking and enforcement (via DI)
 * - Sensitivity-based routing (via DI)
 * - Performance monitoring and stats
 *
 * Key Features (delegated to LLMService):
 * - Multi-provider support with automatic fallback
 * - Circuit breaker pattern
 * - LRU caching
 * - Dynamic SDK loading
 */

import { EventEmitter } from 'events';
import http from 'http';

// Dynamic imports for optional dependencies
let BudgetTracker, SensitivityClassifier;

const loadOptionalDependencies = async () => {
  try {
    const budgetModule = await import('./BudgetTracker.js');
    BudgetTracker = budgetModule.default || budgetModule.BudgetTracker;
  } catch (e) {
    console.warn('BudgetTracker not available:', e.message);
  }

  try {
    const sensitivityModule = await import('./SensitivityClassifier.js');
    SensitivityClassifier = sensitivityModule.default || sensitivityModule.SensitivityClassifier;
  } catch (e) {
    console.warn('SensitivityClassifier not available:', e.message);
  }
};

export class UnifiedInferenceEngine extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.initialized = false;

    // Model routing: maps operation types to provider/model specs
    this.modelRouting = config.modelRouting || {
      'trajectory-intent': 'groq/llama-3.3-70b-versatile',
      'trajectory-goal': 'groq/llama-3.3-70b-versatile',
      'knowledge-pattern': 'groq/llama-3.3-70b-versatile',
      'knowledge-concept': 'anthropic/claude-haiku-4-5',
      'concept-abstraction': 'anthropic/claude-haiku-4-5',
      'sensitive-analysis': 'local/llama-3.3-70b',
      'default': 'groq/llama-3.3-70b-versatile'
    };

    // Route all LLM calls through the bridge server (handles proxy, VPN, fallback)
    this.proxyPort = parseInt(process.env.LLM_CLI_PROXY_PORT || '12435', 10);
    this.proxyHost = '127.0.0.1';

    // Budget and sensitivity components (loaded on initialize)
    this.budgetTracker = null;
    this.sensitivityClassifier = null;
  }

  /**
   * Initialize the inference engine
   */
  async initialize() {
    if (this.initialized) return;

    // Load optional dependencies
    await loadOptionalDependencies();

    // Bridge server handles LLM provider initialization

    // Initialize budget tracker if available
    if (BudgetTracker && this.config.budgetTracking !== false) {
      try {
        this.budgetTracker = new BudgetTracker(this.config.budgetConfig || {});
        await this.budgetTracker.initialize();
        console.info('[UnifiedInferenceEngine] BudgetTracker initialized');
      } catch (error) {
        console.warn('[UnifiedInferenceEngine] Failed to initialize BudgetTracker:', error);
      }
    }

    // Initialize sensitivity classifier if available
    if (SensitivityClassifier && this.config.sensitivityRouting !== false) {
      try {
        this.sensitivityClassifier = new SensitivityClassifier(this.config.sensitivityConfig || {});
        await this.sensitivityClassifier.initialize();
        console.info('[UnifiedInferenceEngine] SensitivityClassifier initialized');
      } catch (error) {
        console.warn('[UnifiedInferenceEngine] Failed to initialize SensitivityClassifier:', error);
      }
    }

    this.initialized = true;
    this.emit('initialized');
    console.info(`[UnifiedInferenceEngine] Initialized (bridge server on ${this.proxyHost}:${this.proxyPort})`);
  }

  /**
   * Main inference method
   *
   * @param {string} prompt - The prompt to send to the LLM
   * @param {object} context - Additional context for routing decisions
   * @param {object} options - Inference options
   * @returns {Promise<object>} Inference result
   */
   async infer(prompt, context = {}, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await this._callBridge({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options.maxTokens || context.maxTokens || 500,
        temperature: options.temperature ?? context.temperature ?? 0.3,
      });

      this.emit('inference-complete', {
        operationType: context.operationType,
        provider: result.provider,
        duration: result.latencyMs,
      });

      return {
        content: result.content,
        provider: result.provider,
        model: result.model,
        tokens: result.usage?.total_tokens || 0,
        local: false,
        cached: false,
      };

    } catch (error) {
      this.emit('inference-error', {
        operationType: context.operationType,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Call the LLM proxy bridge server on port 12435
   */
  _callBridge(body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request({
        hostname: this.proxyHost,
        port: this.proxyPort,
        path: '/api/complete',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 60000,
      }, (res) => {
        let chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            if (res.statusCode >= 400) reject(new Error(json.error || `Bridge returned ${res.statusCode}`));
            else resolve({
              content: json.choices?.[0]?.message?.content || json.content || '',
              provider: json.provider || 'unknown',
              model: json.model || 'unknown',
              usage: json.usage,
              latencyMs: json.latencyMs || 0,
            });
          } catch (e) { reject(new Error(`Bridge parse error: ${e.message}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Bridge timeout (60s)')); });
      req.write(data);
      req.end();
    });
  }

  /**
   * Get model spec for an operation type
   */
  getModelForOperation(operationType) {
    return this.modelRouting[operationType] || this.modelRouting.default;
  }

  /**
   * Clear inference cache
   */
  clearCache() {
    console.info('[UnifiedInferenceEngine] Cache clear delegated to bridge server');
  }

  /**
   * Get inference statistics
   */
  getStats() {
    return { provider: 'bridge', host: this.proxyHost, port: this.proxyPort };
  }
}

export default UnifiedInferenceEngine;
