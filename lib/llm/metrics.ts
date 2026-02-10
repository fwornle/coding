/**
 * LLM Metrics Tracker
 *
 * Unified per-provider/per-operation tracking. Supports per-step reset
 * for workflow step metrics in semantic-analysis.
 */

import type { LLMMetrics, LLMCallMetrics } from './types.js';

export class MetricsTracker {
  private byProvider: Record<string, { count: number; totalLatencyMs: number; totalTokens: number }> = {};
  private byOperation: Record<string, { count: number; totalLatencyMs: number }> = {};
  private totalCalls = 0;

  // Cache stats (set externally by LLMService)
  cacheSize = 0;
  cacheHits = 0;
  cacheMisses = 0;

  // Detailed call log for per-step tracking
  private calls: LLMCallMetrics[] = [];

  /**
   * Record a completed LLM call
   */
  recordCall(
    provider: string,
    model: string,
    tokens: { input: number; output: number; total: number },
    latencyMs: number,
    operationType?: string,
  ): void {
    this.totalCalls++;

    // Per-provider stats
    if (!this.byProvider[provider]) {
      this.byProvider[provider] = { count: 0, totalLatencyMs: 0, totalTokens: 0 };
    }
    this.byProvider[provider].count++;
    this.byProvider[provider].totalLatencyMs += latencyMs;
    this.byProvider[provider].totalTokens += tokens.total;

    // Per-operation stats
    const opKey = operationType || 'default';
    if (!this.byOperation[opKey]) {
      this.byOperation[opKey] = { count: 0, totalLatencyMs: 0 };
    }
    this.byOperation[opKey].count++;
    this.byOperation[opKey].totalLatencyMs += latencyMs;

    // Detailed call log
    this.calls.push({
      provider,
      model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      totalTokens: tokens.total,
      latencyMs,
      operationType,
      timestamp: Date.now(),
    });
  }

  /**
   * Get a snapshot of all metrics
   */
  getMetrics(): LLMMetrics {
    const cacheHitRate = (this.cacheHits + this.cacheMisses) > 0
      ? this.cacheHits / (this.cacheHits + this.cacheMisses)
      : 0;

    return {
      totalCalls: this.totalCalls,
      byProvider: { ...this.byProvider },
      byOperation: { ...this.byOperation },
      cache: {
        size: this.cacheSize,
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: cacheHitRate,
      },
    };
  }

  /**
   * Get detailed call log (for per-step tracking in semantic-analysis)
   */
  getCalls(): LLMCallMetrics[] {
    return [...this.calls];
  }

  /**
   * Get unique providers used
   */
  getProviders(): string[] {
    return Object.keys(this.byProvider);
  }

  /**
   * Reset all metrics (for per-step tracking)
   */
  reset(): void {
    this.byProvider = {};
    this.byOperation = {};
    this.totalCalls = 0;
    this.cacheSize = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.calls = [];
  }
}
