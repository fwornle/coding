/**
 * UnifiedInferenceEngine
 *
 * Centralized LLM inference engine shared by all components (trajectory, knowledge extraction, etc.)
 * Extends patterns from semantic-validator.js with budget tracking, sensitivity routing, and local model support.
 *
 * Key Features:
 * - Multi-provider support (Groq, Anthropic, OpenAI, Gemini, Local via Ollama/vLLM)
 * - Circuit breaker pattern for provider failover
 * - LRU caching with 40%+ hit rate target
 * - Budget tracking and enforcement
 * - Sensitivity-based routing (sensitive data → local models)
 * - Streaming response support
 * - Performance monitoring and stats
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { EventEmitter } from 'events';

// Import components we'll integrate with
// These will be implemented in subsequent tasks
let BudgetTracker, SensitivityClassifier;

// Dynamic imports for optional dependencies
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

    // Provider instances
    this.providers = {};

    // LRU cache for inference results (configurable TTL, default 1 hour)
    this.cache = new Map();
    this.cacheMaxSize = config.cacheMaxSize || 1000;
    this.cacheTTL = config.cacheTTL || 3600000; // 1 hour
    this.cacheHits = 0;
    this.cacheMisses = 0;

    // Circuit breaker for provider failures
    // Pattern extracted from semantic-validator.js
    this.circuitBreaker = {
      failures: {},
      threshold: config.circuitBreakerThreshold || 5,
      resetTimeout: config.circuitBreakerReset || 60000 // 1 minute
    };

    // Provider priority for fallback
    // Remote providers: Groq (cheapest/fastest) → Anthropic → OpenAI → Gemini
    // Local providers: Ollama/vLLM (privacy-first, budget-friendly)
    this.providerPriority = config.providerPriority || [
      'groq',
      'anthropic',
      'openai',
      'gemini',
      'local' // Ollama/vLLM
    ];

    // Model routing: maps operation types to provider/model specs
    // Format: 'provider/model-name'
    this.modelRouting = config.modelRouting || {
      // Trajectory analysis - fast Groq models
      'trajectory-intent': 'groq/llama-3.3-70b-versatile',
      'trajectory-goal': 'groq/qwen-2.5-32b-instruct',

      // Knowledge extraction - balanced models
      'knowledge-pattern': 'groq/llama-3.3-70b-versatile',
      'knowledge-concept': 'anthropic/claude-3-haiku-20240307',

      // Concept abstraction - higher quality needed
      'concept-abstraction': 'anthropic/claude-3-haiku-20240307',

      // Sensitive data analysis - local only
      'sensitive-analysis': 'local/llama-3.3-70b',

      // Default fallback
      'default': 'groq/llama-3.3-70b-versatile'
    };

    // Performance tracking
    this.stats = {
      totalInferences: 0,
      byProvider: {},
      byOperationType: {},
      averageLatency: 0,
      budgetBlocked: 0,
      sensitivityRouted: 0
    };

    // Budget and sensitivity components (loaded on initialize)
    this.budgetTracker = null;
    this.sensitivityClassifier = null;
  }

  /**
   * Initialize the inference engine
   * Async initialization to allow for optional dependency loading
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    // Load optional dependencies
    await loadOptionalDependencies();

    // Initialize providers
    this.initializeProviders();

    // Initialize budget tracker if available
    if (BudgetTracker && this.config.budgetTracking !== false) {
      try {
        this.budgetTracker = new BudgetTracker(this.config.budgetConfig || {});
        await this.budgetTracker.initialize();
        console.log('[UnifiedInferenceEngine] BudgetTracker initialized');
      } catch (error) {
        console.warn('[UnifiedInferenceEngine] Failed to initialize BudgetTracker:', error);
      }
    }

    // Initialize sensitivity classifier if available
    if (SensitivityClassifier && this.config.sensitivityRouting !== false) {
      try {
        this.sensitivityClassifier = new SensitivityClassifier(this.config.sensitivityConfig || {});
        await this.sensitivityClassifier.initialize();
        console.log('[UnifiedInferenceEngine] SensitivityClassifier initialized');
      } catch (error) {
        console.warn('[UnifiedInferenceEngine] Failed to initialize SensitivityClassifier:', error);
      }
    }

    this.initialized = true;
    this.emit('initialized');
    console.log('[UnifiedInferenceEngine] Initialized with providers:', Object.keys(this.providers));
  }

  /**
   * Initialize LLM providers based on available API keys
   * Pattern extracted and extended from semantic-validator.js
   */
  initializeProviders() {
    // Groq provider (supports multiple Groq models)
    if (process.env.GROK_API_KEY || this.config.groqApiKey) {
      try {
        this.providers.groq = new Groq({
          apiKey: this.config.groqApiKey || process.env.GROK_API_KEY,
          timeout: this.config.timeout || 10000
        });
        console.log('[UnifiedInferenceEngine] Groq provider initialized');
      } catch (error) {
        console.warn('[UnifiedInferenceEngine] Failed to initialize Groq provider:', error);
      }
    }

    // Anthropic provider
    if (process.env.ANTHROPIC_API_KEY || this.config.anthropicApiKey) {
      try {
        this.providers.anthropic = new Anthropic({
          apiKey: this.config.anthropicApiKey || process.env.ANTHROPIC_API_KEY,
          timeout: this.config.timeout || 10000
        });
        console.log('[UnifiedInferenceEngine] Anthropic provider initialized');
      } catch (error) {
        console.warn('[UnifiedInferenceEngine] Failed to initialize Anthropic provider:', error);
      }
    }

    // OpenAI provider (new - not in semantic-validator)
    if (process.env.OPENAI_API_KEY || this.config.openaiApiKey) {
      try {
        this.providers.openai = new OpenAI({
          apiKey: this.config.openaiApiKey || process.env.OPENAI_API_KEY,
          timeout: this.config.timeout || 10000
        });
        console.log('[UnifiedInferenceEngine] OpenAI provider initialized');
      } catch (error) {
        console.warn('[UnifiedInferenceEngine] Failed to initialize OpenAI provider:', error);
      }
    }

    // Gemini provider
    if (process.env.GOOGLE_API_KEY || this.config.geminiApiKey) {
      try {
        this.providers.gemini = new GoogleGenerativeAI(
          this.config.geminiApiKey || process.env.GOOGLE_API_KEY
        );
        console.log('[UnifiedInferenceEngine] Gemini provider initialized');
      } catch (error) {
        console.warn('[UnifiedInferenceEngine] Failed to initialize Gemini provider:', error);
      }
    }

    // Local model provider (Ollama or vLLM)
    // Ollama runs on http://localhost:11434 by default
    // vLLM runs on http://localhost:8000 by default
    const localEndpoint = this.config.localModelEndpoint ||
                         process.env.LOCAL_MODEL_ENDPOINT ||
                         'http://localhost:11434'; // Ollama default

    if (this.config.enableLocalModels !== false) {
      try {
        // Use OpenAI-compatible client for Ollama/vLLM
        this.providers.local = new OpenAI({
          baseURL: localEndpoint,
          apiKey: 'ollama', // Ollama doesn't need real API key
          timeout: this.config.timeout || 30000 // Longer timeout for local models
        });
        console.log('[UnifiedInferenceEngine] Local model provider initialized:', localEndpoint);
      } catch (error) {
        console.warn('[UnifiedInferenceEngine] Failed to initialize local model provider:', error);
      }
    }

    if (Object.keys(this.providers).length === 0) {
      console.warn('[UnifiedInferenceEngine] No providers initialized - inference will fail');
    }
  }

  /**
   * Main inference method
   * Routes requests through budget checking, sensitivity detection, and provider selection
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

    const startTime = Date.now();
    const operationType = context.operationType || 'default';

    try {
      // 1. Check cache first
      const cacheKey = this.getCacheKey(prompt, context);
      const cached = this.getFromCache(cacheKey);

      if (cached && !options.skipCache) {
        this.cacheHits++;
        this.emit('cache-hit', { operationType, cacheKey });
        return cached;
      }

      this.cacheMisses++;
      this.stats.totalInferences++;

      // 2. Check sensitivity → route to local if sensitive
      const isSensitive = await this.checkSensitivity(prompt, context);

      if (isSensitive || options.privacy === 'local') {
        this.stats.sensitivityRouted++;
        this.emit('sensitivity-routed', { operationType, reason: isSensitive ? 'sensitive-data' : 'explicit-local' });
        return await this.inferLocal(prompt, context, options);
      }

      // 3. Check budget → route to local if exceeded
      const canAfford = await this.checkBudget(prompt, context);

      if (!canAfford && !options.forcePaid) {
        this.stats.budgetBlocked++;
        this.emit('budget-blocked', { operationType });
        console.warn('[UnifiedInferenceEngine] Budget exceeded, routing to local model');
        return await this.inferLocal(prompt, context, options);
      }

      // 4. Route to remote provider
      const result = await this.inferRemote(prompt, context, options);

      // 5. Cache result
      if (!options.skipCache) {
        this.setInCache(cacheKey, result);
      }

      // 6. Update stats
      const duration = Date.now() - startTime;
      this.updateStats(operationType, result.provider, duration);

      this.emit('inference-complete', { operationType, provider: result.provider, duration });

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.emit('inference-error', { operationType, error: error.message, duration });

      console.error('[UnifiedInferenceEngine] Inference failed:', error);

      // Fallback to local model on error
      try {
        console.log('[UnifiedInferenceEngine] Falling back to local model after error');
        return await this.inferLocal(prompt, context, { ...options, fallback: true });
      } catch (fallbackError) {
        console.error('[UnifiedInferenceEngine] Fallback to local model also failed:', fallbackError);
        throw error; // Throw original error
      }
    }
  }

  /**
   * Check if content is sensitive using SensitivityClassifier
   */
  async checkSensitivity(prompt, context) {
    if (!this.sensitivityClassifier) {
      return false; // No classifier available, assume not sensitive
    }

    try {
      const result = await this.sensitivityClassifier.classify(prompt, context);
      return result.isSensitive;
    } catch (error) {
      console.warn('[UnifiedInferenceEngine] Sensitivity check failed:', error);
      return false; // On error, assume not sensitive (fail open)
    }
  }

  /**
   * Check if we can afford this inference using BudgetTracker
   */
  async checkBudget(prompt, context) {
    if (!this.budgetTracker) {
      return true; // No budget tracking, always allow
    }

    try {
      return await this.budgetTracker.canAfford(prompt, context);
    } catch (error) {
      console.warn('[UnifiedInferenceEngine] Budget check failed:', error);
      return true; // On error, allow inference (fail open)
    }
  }

  /**
   * Infer using remote provider (Groq, Anthropic, OpenAI, Gemini)
   */
  async inferRemote(prompt, context, options) {
    const operationType = context.operationType || 'default';
    const modelSpec = this.getModelForOperation(operationType);
    let [preferredProvider, model] = modelSpec.split('/');

    // Try preferred provider first, then fall back through priority list
    const providers = [preferredProvider, ...this.providerPriority.filter(p => p !== preferredProvider && p !== 'local')];

    for (const provider of providers) {
      // Check if provider is available and circuit is not open
      if (!this.providers[provider]) {
        continue;
      }

      if (this.isCircuitOpen(provider)) {
        console.log(`[UnifiedInferenceEngine] Circuit breaker open for ${provider}, trying next provider`);
        continue;
      }

      try {
        const result = await this.inferWithProvider(provider, model, prompt, context, options);

        // Record success for circuit breaker
        this.recordSuccess(provider);

        // Record cost to budget tracker
        if (this.budgetTracker && result.tokens) {
          await this.budgetTracker.recordCost(
            result.tokens,
            provider,
            { operationType, model }
          );
        }

        return { ...result, provider };

      } catch (error) {
        console.warn(`[UnifiedInferenceEngine] Provider ${provider} failed:`, error.message);

        // Record failure for circuit breaker
        this.recordFailure(provider);

        // Continue to next provider
        continue;
      }
    }

    // All remote providers failed, throw error to trigger local fallback
    throw new Error('All remote providers failed');
  }

  /**
   * Infer using local model (Ollama or vLLM)
   */
  async inferLocal(prompt, context, options) {
    if (!this.providers.local) {
      throw new Error('Local model provider not available');
    }

    const operationType = context.operationType || 'default';
    const model = this.config.localModel || context.localModel || 'llama3.2:latest';

    try {
      const result = await this.inferWithProvider('local', model, prompt, context, options);
      return { ...result, provider: 'local', local: true };
    } catch (error) {
      console.error('[UnifiedInferenceEngine] Local inference failed:', error);

      // If this was already a fallback, throw error
      if (options.fallback) {
        throw error;
      }

      // Otherwise, throw to trigger higher-level fallback
      throw new Error(`Local inference failed: ${error.message}`);
    }
  }

  /**
   * Infer with a specific provider
   */
  async inferWithProvider(provider, model, prompt, context, options) {
    const maxTokens = options.maxTokens || context.maxTokens || 500;
    const temperature = options.temperature ?? context.temperature ?? 0.3;
    const stream = options.stream || false;

    switch (provider) {
      case 'groq':
        return await this.inferWithGroq(model, prompt, { maxTokens, temperature, stream });

      case 'anthropic':
        return await this.inferWithAnthropic(model, prompt, { maxTokens, temperature, stream });

      case 'openai':
        return await this.inferWithOpenAI(model, prompt, { maxTokens, temperature, stream });

      case 'gemini':
        return await this.inferWithGemini(model, prompt, { maxTokens, temperature, stream });

      case 'local':
        return await this.inferWithLocal(model, prompt, { maxTokens, temperature, stream });

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Groq inference
   */
  async inferWithGroq(model, prompt, options) {
    const completion = await this.providers.groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stream: options.stream
    });

    if (options.stream) {
      return { stream: completion, streaming: true };
    }

    return {
      content: completion.choices[0].message.content,
      tokens: completion.usage?.total_tokens || 0,
      model
    };
  }

  /**
   * Anthropic inference
   */
  async inferWithAnthropic(model, prompt, options) {
    const message = await this.providers.anthropic.messages.create({
      model: model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      messages: [{ role: 'user', content: prompt }],
      stream: options.stream
    });

    if (options.stream) {
      return { stream: message, streaming: true };
    }

    return {
      content: message.content[0].text,
      tokens: message.usage?.input_tokens + message.usage?.output_tokens || 0,
      model
    };
  }

  /**
   * OpenAI inference
   */
  async inferWithOpenAI(model, prompt, options) {
    const completion = await this.providers.openai.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stream: options.stream
    });

    if (options.stream) {
      return { stream: completion, streaming: true };
    }

    return {
      content: completion.choices[0].message.content,
      tokens: completion.usage?.total_tokens || 0,
      model
    };
  }

  /**
   * Gemini inference
   */
  async inferWithGemini(model, prompt, options) {
    const geminiModel = this.providers.gemini.getGenerativeModel({
      model: model,
      generationConfig: {
        temperature: options.temperature,
        maxOutputTokens: options.maxTokens
      }
    });

    if (options.stream) {
      const result = await geminiModel.generateContentStream(prompt);
      return { stream: result.stream, streaming: true };
    }

    const result = await geminiModel.generateContent(prompt);
    const response = result.response.text();

    return {
      content: response,
      tokens: 0, // Gemini doesn't provide token counts easily
      model
    };
  }

  /**
   * Local model inference (Ollama or vLLM)
   */
  async inferWithLocal(model, prompt, options) {
    // Ollama/vLLM use OpenAI-compatible API
    const completion = await this.providers.local.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stream: options.stream
    });

    if (options.stream) {
      return { stream: completion, streaming: true };
    }

    return {
      content: completion.choices[0].message.content,
      tokens: completion.usage?.total_tokens || 0,
      model,
      local: true
    };
  }

  /**
   * Get model spec for an operation type
   */
  getModelForOperation(operationType) {
    return this.modelRouting[operationType] || this.modelRouting.default;
  }

  /**
   * Cache management (pattern from semantic-validator.js)
   */
  getCacheKey(prompt, context) {
    const hash = this.simpleHash(prompt);
    const opType = context.operationType || 'default';
    return `${opType}:${hash}`;
  }

  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.result;
    }
    return null;
  }

  setInCache(key, result) {
    // Implement LRU eviction
    if (this.cache.size >= this.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  clearCache() {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    console.log('[UnifiedInferenceEngine] Cache cleared');
  }

  /**
   * Circuit breaker management (pattern from semantic-validator.js)
   */
  isCircuitOpen(provider) {
    const failures = this.circuitBreaker.failures[provider] || 0;
    if (failures >= this.circuitBreaker.threshold) {
      // Check if reset timeout has passed
      const lastFailure = this.circuitBreaker[`${provider}_lastFailure`] || 0;
      if (Date.now() - lastFailure > this.circuitBreaker.resetTimeout) {
        // Reset circuit
        this.circuitBreaker.failures[provider] = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  recordFailure(provider) {
    this.circuitBreaker.failures[provider] = (this.circuitBreaker.failures[provider] || 0) + 1;
    this.circuitBreaker[`${provider}_lastFailure`] = Date.now();
    this.emit('circuit-breaker-failure', { provider, failures: this.circuitBreaker.failures[provider] });
  }

  recordSuccess(provider) {
    this.circuitBreaker.failures[provider] = 0;
  }

  /**
   * Stats tracking (pattern from semantic-validator.js)
   */
  updateStats(operationType, provider, duration) {
    if (!this.stats.byProvider[provider]) {
      this.stats.byProvider[provider] = { count: 0, totalLatency: 0 };
    }
    this.stats.byProvider[provider].count++;
    this.stats.byProvider[provider].totalLatency += duration;

    if (!this.stats.byOperationType[operationType]) {
      this.stats.byOperationType[operationType] = { count: 0, totalLatency: 0 };
    }
    this.stats.byOperationType[operationType].count++;
    this.stats.byOperationType[operationType].totalLatency += duration;

    // Update average
    const totalLatency = Object.values(this.stats.byProvider).reduce((sum, p) => sum + p.totalLatency, 0);
    this.stats.averageLatency = totalLatency / this.stats.totalInferences;
  }

  /**
   * Get inference statistics
   */
  getStats() {
    return {
      ...this.stats,
      cache: {
        size: this.cache.size,
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: this.cacheHits / (this.cacheHits + this.cacheMisses) || 0
      },
      providers: Object.keys(this.providers),
      circuitBreaker: this.circuitBreaker.failures,
      budgetTracking: this.budgetTracker ? 'enabled' : 'disabled',
      sensitivityRouting: this.sensitivityClassifier ? 'enabled' : 'disabled'
    };
  }
}

export default UnifiedInferenceEngine;
