/**
 * UnifiedInferenceEngine
 *
 * Centralized LLM inference engine shared by all components (trajectory, knowledge extraction, etc.)
 * Now delegates all provider management to LLMService from lib/llm/.
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
import { LLMService } from '../../lib/llm/dist/index.js';

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

    // Initialize LLM service with config
    this.llmService = new LLMService({
      modelRouting: this.modelRouting,
      cache: {
        maxSize: config.cacheMaxSize || 1000,
        ttlMs: config.cacheTTL || 3600000,
      },
      circuitBreaker: {
        threshold: config.circuitBreakerThreshold || 5,
        resetTimeoutMs: config.circuitBreakerReset || 60000,
      },
    });

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

    // Initialize LLM service
    await this.llmService.initialize();

    // Initialize budget tracker if available
    if (BudgetTracker && this.config.budgetTracking !== false) {
      try {
        this.budgetTracker = new BudgetTracker(this.config.budgetConfig || {});
        await this.budgetTracker.initialize();
        // Wire budget tracker into LLM service
        this.llmService.setBudgetTracker(this.budgetTracker);
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
        // Wire sensitivity classifier into LLM service
        this.llmService.setSensitivityClassifier(this.sensitivityClassifier);
        console.info('[UnifiedInferenceEngine] SensitivityClassifier initialized');
      } catch (error) {
        console.warn('[UnifiedInferenceEngine] Failed to initialize SensitivityClassifier:', error);
      }
    }

    this.initialized = true;
    this.emit('initialized');
    console.info('[UnifiedInferenceEngine] Initialized with providers:', this.llmService.getAvailableProviders());
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
      const result = await this.llmService.complete({
        messages: [{ role: 'user', content: prompt }],
        operationType: context.operationType,
        maxTokens: options.maxTokens || context.maxTokens || 500,
        temperature: options.temperature ?? context.temperature ?? 0.3,
        stream: options.stream,
        privacy: options.privacy,
        skipCache: options.skipCache,
        forcePaid: options.forcePaid,
      });

      this.emit('inference-complete', {
        operationType: context.operationType,
        provider: result.provider,
        duration: result.latencyMs,
      });

      // Return in the format consumers expect
      return {
        content: result.content,
        provider: result.provider,
        model: result.model,
        tokens: result.tokens.total,
        local: result.local,
        cached: result.cached,
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
   * Get model spec for an operation type
   */
  getModelForOperation(operationType) {
    return this.modelRouting[operationType] || this.modelRouting.default;
  }

  /**
   * Clear inference cache
   */
  clearCache() {
    this.llmService.clearCache();
    console.info('[UnifiedInferenceEngine] Cache cleared');
  }

  /**
   * Get inference statistics
   */
  getStats() {
    return this.llmService.getStats();
  }
}

export default UnifiedInferenceEngine;
