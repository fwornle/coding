/**
 * LLM Service - High-Level Facade
 *
 * The single public entry point for all LLM operations.
 * Handles mode routing (mock/local/public), caching, circuit breaking,
 * budget/sensitivity checks, and provider fallback.
 */

import { EventEmitter } from 'events';
import type {
  LLMCompletionRequest, LLMCompletionResult, LLMServiceConfig, LLMMetrics,
  LLMMode, ProviderName, ModelTier,
  BudgetTrackerInterface, SensitivityClassifierInterface, MockServiceInterface,
  SubscriptionQuotaTrackerInterface,
} from './types.js';
import { loadConfig, getDefaultConfig } from './config.js';
import { ProviderRegistry } from './provider-registry.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { LLMCache } from './cache.js';
import { MetricsTracker } from './metrics.js';
import { MockProvider } from './providers/mock-provider.js';

export class LLMService extends EventEmitter {
  private config: LLMServiceConfig;
  private registry: ProviderRegistry;
  private circuitBreaker: CircuitBreaker;
  private cache: LLMCache;
  private metrics: MetricsTracker;

  private initialized = false;

  // Dependency injection slots
  private modeResolver: ((agentId?: string) => LLMMode) | null = null;
  private budgetTracker: BudgetTrackerInterface | null = null;
  private sensitivityClassifier: SensitivityClassifierInterface | null = null;
  private quotaTracker: SubscriptionQuotaTrackerInterface | null = null;

  constructor(config?: LLMServiceConfig) {
    super();
    this.config = config || getDefaultConfig();
    this.registry = new ProviderRegistry(this.config);
    this.circuitBreaker = new CircuitBreaker(
      this.config.circuitBreaker?.threshold || 5,
      this.config.circuitBreaker?.resetTimeoutMs || 60000,
    );
    this.cache = new LLMCache(
      this.config.cache?.maxSize || 1000,
      this.config.cache?.ttlMs || 3600000,
    );
    this.metrics = new MetricsTracker();
  }

  /**
   * Initialize the service: load config, register providers
   */
  async initialize(configPath?: string): Promise<void> {
    if (this.initialized) return;

    // Load config from YAML if not provided in constructor
    if (!this.config.providers || Object.keys(this.config.providers).length === 0) {
      this.config = await loadConfig(configPath);
      this.registry = new ProviderRegistry(this.config);
    }

    await this.registry.initializeAll();
    this.initialized = true;
    this.emit('initialized', { providers: this.registry.getAvailableProviders() });
  }

  // --- Dependency Injection ---

  /**
   * Set function that resolves the current LLM mode (mock/local/public)
   */
  setModeResolver(fn: (agentId?: string) => LLMMode): void {
    this.modeResolver = fn;
  }

  /**
   * Set mock service for mock mode
   */
  setMockService(service: MockServiceInterface): void {
    const mockProvider = this.registry.getMockProvider();
    if (mockProvider) {
      mockProvider.setMockService(service);
    }
  }

  /**
   * Set repository path for mock provider
   */
  setRepositoryPath(path: string): void {
    const mockProvider = this.registry.getMockProvider();
    if (mockProvider) {
      mockProvider.setRepositoryPath(path);
    }
  }

  /**
   * Set budget tracker for cost control
   */
  setBudgetTracker(tracker: BudgetTrackerInterface): void {
    this.budgetTracker = tracker;
  }

  /**
   * Set sensitivity classifier for privacy routing
   */
  setSensitivityClassifier(classifier: SensitivityClassifierInterface): void {
    this.sensitivityClassifier = classifier;
  }

  /**
   * Set subscription quota tracker for subscription-based providers
   */
  setQuotaTracker(tracker: SubscriptionQuotaTrackerInterface): void {
    this.quotaTracker = tracker;
  }

  // --- Core Completion Methods ---

  /**
   * Main completion method with full routing logic
   */
  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();

    // 1. Determine LLM mode
    const mode = this.resolveMode(request.agentId);

    // 2. Mock mode — delegate immediately
    if (mode === 'mock') {
      return this.completeWithMock(request, startTime);
    }

    // 3. Local mode — only use local providers
    if (mode === 'local' || request.privacy === 'local') {
      return this.completeWithLocal(request, startTime);
    }

    // 4. Public mode — full routing with cache, budget, sensitivity
    return this.completePublic(request, startTime);
  }

  /**
   * Convenience: complete for a specific task type
   */
  async completeForTask(
    prompt: string,
    taskType: string,
    options: Partial<LLMCompletionRequest> = {},
  ): Promise<LLMCompletionResult> {
    return this.complete({
      messages: [{ role: 'user', content: prompt }],
      taskType,
      ...options,
    });
  }

  /**
   * Convenience: complete with explicit routing key (operationType)
   */
  async completeWithRouting(
    prompt: string,
    routingKey: string,
    options: Partial<LLMCompletionRequest> = {},
  ): Promise<LLMCompletionResult> {
    return this.complete({
      messages: [{ role: 'user', content: prompt }],
      operationType: routingKey,
      ...options,
    });
  }

  // --- Private Routing Methods ---

  private resolveMode(agentId?: string): LLMMode {
    if (this.modeResolver) {
      return this.modeResolver(agentId);
    }
    return 'public';
  }

  private async completeWithMock(
    request: LLMCompletionRequest,
    startTime: number,
  ): Promise<LLMCompletionResult> {
    const mockProvider = this.registry.getMockProvider();
    if (!mockProvider?.isAvailable()) {
      // Fall through to local if mock not available
      console.warn('[llm] Mock mode requested but no mock service configured, falling back to local');
      return this.completeWithLocal(request, startTime);
    }

    const result = await mockProvider.complete(request);
    const latencyMs = Date.now() - startTime;
    result.latencyMs = latencyMs;

    this.metrics.recordCall('mock', result.model, result.tokens, latencyMs, request.operationType);
    this.emit('complete', { mode: 'mock', ...result });
    return result;
  }

  private async completeWithLocal(
    request: LLMCompletionRequest,
    startTime: number,
  ): Promise<LLMCompletionResult> {
    const localProviders = this.registry.getLocalProviders();

    for (const provider of localProviders) {
      if (this.circuitBreaker.isOpen(provider.name)) continue;

      try {
        const result = await provider.complete(request);
        const latencyMs = Date.now() - startTime;
        result.latencyMs = latencyMs;

        this.circuitBreaker.recordSuccess(provider.name);
        this.metrics.recordCall(provider.name, result.model, result.tokens, latencyMs, request.operationType);
        this.emit('complete', { mode: 'local', ...result });
        return result;
      } catch (error: any) {
        this.circuitBreaker.recordFailure(provider.name);
        console.warn(`[llm] Local provider ${provider.name} failed:`, error.message);
      }
    }

    // No local providers available — fall through to public as last resort
    console.warn('[llm] No local providers available, falling back to public');
    return this.completePublic(request, startTime);
  }

  private async completePublic(
    request: LLMCompletionRequest,
    startTime: number,
  ): Promise<LLMCompletionResult> {
    // Check cache
    if (!request.skipCache) {
      const prompt = request.messages.map(m => m.content).join('\n');
      const cacheKey = LLMCache.getCacheKey(prompt, request.operationType);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.metrics.cacheHits = this.cache.hits;
        this.metrics.cacheMisses = this.cache.misses;
        this.emit('cache-hit', { operationType: request.operationType });
        return cached;
      }
    }

    // Check sensitivity
    if (this.sensitivityClassifier) {
      try {
        const prompt = request.messages.map(m => m.content).join('\n');
        const classification = await this.sensitivityClassifier.classify(prompt, {
          operationType: request.operationType || 'default',
        });
        if (classification.isSensitive) {
          this.emit('sensitivity-routed', { operationType: request.operationType });
          return this.completeWithLocal(request, startTime);
        }
      } catch {
        // On error, assume not sensitive
      }
    }

    // Check budget
    if (this.budgetTracker && !request.forcePaid) {
      try {
        const prompt = request.messages.map(m => m.content).join('\n');
        const canAfford = await this.budgetTracker.canAfford(prompt, {
          operationType: request.operationType || 'default',
        });
        if (!canAfford) {
          this.emit('budget-blocked', { operationType: request.operationType });
          return this.completeWithLocal(request, startTime);
        }
      } catch {
        // On error, allow (fail open)
      }
    }

    // Check subscription quota availability
    if (this.quotaTracker) {
      for (const providerName of ['claude-code', 'copilot']) {
        const isAvailable = await this.quotaTracker.isAvailable(providerName);
        if (!isAvailable) {
          // Mark as temporarily unavailable via circuit breaker
          this.circuitBreaker.recordFailure(providerName);
          console.info(`[llm] Subscription provider ${providerName} quota exhausted, temporarily disabled`);
        }
      }
    }

    // Resolve provider chain and try each
    const chain = this.registry.resolveProviderChain(request);

    for (const { provider, model } of chain) {
      if (this.circuitBreaker.isOpen(provider.name)) continue;

      try {
        // Override model in request for the selected provider
        const providerRequest = { ...request, tier: undefined };
        const result = await provider.complete(providerRequest);
        const latencyMs = Date.now() - startTime;
        result.latencyMs = latencyMs;

        this.circuitBreaker.recordSuccess(provider.name);
        this.metrics.recordCall(provider.name, result.model, result.tokens, latencyMs, request.operationType);

        // Record subscription usage for subscription providers
        const isSubscriptionProvider = provider.name === 'claude-code' || provider.name === 'copilot';
        if (isSubscriptionProvider && this.quotaTracker) {
          try {
            await this.quotaTracker.recordUsage(provider.name, result.tokens.total);
          } catch (error: any) {
            console.warn(`[llm] Failed to record quota usage for ${provider.name}:`, error.message);
          }
        }

        // Record cost ($0 for subscription providers)
        if (this.budgetTracker) {
          try {
            // Calculate cost (zero for subscription providers)
            const cost = isSubscriptionProvider ? 0 : undefined; // undefined = use standard calculation
            await this.budgetTracker.recordCost(result.tokens.total, provider.name, {
              operationType: request.operationType || 'default',
              model: result.model,
              cost, // Pass zero cost for subscriptions
            });
          } catch {
            // Non-fatal
          }
        }

        // Cache result
        if (!request.skipCache) {
          const prompt = request.messages.map(m => m.content).join('\n');
          const cacheKey = LLMCache.getCacheKey(prompt, request.operationType);
          this.cache.set(cacheKey, result);
        }

        this.emit('complete', { mode: 'public', ...result });
        return result;

      } catch (error: any) {
        // Check if quota exhausted
        if (error.message?.includes('QUOTA_EXHAUSTED') && this.quotaTracker) {
          this.quotaTracker.markQuotaExhausted(provider.name);
          console.info(`[llm] Provider ${provider.name} quota exhausted, marked for backoff`);
        }

        this.circuitBreaker.recordFailure(provider.name);
        console.warn(`[llm] Provider ${provider.name} failed:`, error.message);
        continue;
      }
    }

    throw new Error('[llm] All providers failed. Check API keys and provider availability.');
  }

  // --- Metrics & Stats ---

  getMetrics(): LLMMetrics {
    this.metrics.cacheSize = this.cache.size;
    this.metrics.cacheHits = this.cache.hits;
    this.metrics.cacheMisses = this.cache.misses;
    return this.metrics.getMetrics();
  }

  resetMetrics(): void {
    this.metrics.reset();
  }

  getAvailableProviders(): ProviderName[] {
    return this.registry.getAvailableProviders();
  }

  clearCache(): void {
    this.cache.clear();
  }

  getTierForTask(taskType: string): ModelTier {
    return this.registry.getTierForTask(taskType);
  }

  /**
   * Backward-compatible stats method (matches UnifiedInferenceEngine.getStats())
   */
  getStats(): Record<string, unknown> {
    const metrics = this.getMetrics();
    return {
      totalInferences: metrics.totalCalls,
      byProvider: metrics.byProvider,
      byOperationType: metrics.byOperation,
      averageLatency: this.computeAverageLatency(metrics),
      cache: metrics.cache,
      providers: this.registry.getAvailableProviders(),
      circuitBreaker: this.circuitBreaker.getFailures(),
      budgetTracking: this.budgetTracker ? 'enabled' : 'disabled',
      sensitivityRouting: this.sensitivityClassifier ? 'enabled' : 'disabled',
    };
  }

  private computeAverageLatency(metrics: LLMMetrics): number {
    if (metrics.totalCalls === 0) return 0;
    const totalLatency = Object.values(metrics.byProvider)
      .reduce((sum, p) => sum + p.totalLatencyMs, 0);
    return totalLatency / metrics.totalCalls;
  }

  /**
   * Get underlying provider registry (for advanced use)
   */
  getRegistry(): ProviderRegistry {
    return this.registry;
  }

  /**
   * Get the MetricsTracker instance (for per-step tracking in semantic-analysis)
   */
  getMetricsTracker(): MetricsTracker {
    return this.metrics;
  }
}
