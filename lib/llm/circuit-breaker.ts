/**
 * Circuit Breaker for LLM Provider Failover
 *
 * Extracted from identical patterns in SemanticValidator, UnifiedInferenceEngine,
 * and SemanticAnalyzer. Opens circuit after `threshold` consecutive failures,
 * auto-resets after `resetTimeoutMs`.
 */

import type { CircuitBreakerState } from './types.js';

export class CircuitBreaker {
  private state: CircuitBreakerState;

  constructor(threshold = 5, resetTimeoutMs = 60000) {
    this.state = {
      failures: {},
      lastFailure: {},
      threshold,
      resetTimeoutMs,
    };
  }

  /**
   * Check if the circuit is open (provider should be skipped)
   */
  isOpen(provider: string): boolean {
    const failures = this.state.failures[provider] || 0;
    if (failures >= this.state.threshold) {
      const lastFailure = this.state.lastFailure[provider] || 0;
      if (Date.now() - lastFailure > this.state.resetTimeoutMs) {
        // Reset circuit — allow half-open attempt
        this.state.failures[provider] = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Record a provider failure
   */
  recordFailure(provider: string): void {
    this.state.failures[provider] = (this.state.failures[provider] || 0) + 1;
    this.state.lastFailure[provider] = Date.now();
  }

  /**
   * Record a provider success (resets failure count)
   */
  recordSuccess(provider: string): void {
    this.state.failures[provider] = 0;
  }

  /**
   * Get current failure counts for all providers
   */
  getFailures(): Record<string, number> {
    return { ...this.state.failures };
  }

  /**
   * Reset all circuit breaker state
   */
  reset(): void {
    this.state.failures = {};
    this.state.lastFailure = {};
  }
}
