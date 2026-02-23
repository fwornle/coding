/**
 * Circuit Breaker for LLM Provider Failover
 *
 * Opens circuit after `threshold` consecutive failures.
 * Uses exponential backoff on reset timeout — providers that
 * keep failing stay disabled exponentially longer (up to maxResetMs).
 * A single success fully resets the backoff.
 */

import type { CircuitBreakerState } from './types.js';

export class CircuitBreaker {
  private state: CircuitBreakerState;
  private backoffMultiplier: Record<string, number> = {};
  private readonly baseResetMs: number;
  private readonly maxResetMs: number;

  constructor(threshold = 3, resetTimeoutMs = 60000, maxResetMs = 1800000) {
    this.baseResetMs = resetTimeoutMs;
    this.maxResetMs = maxResetMs; // 30 min cap
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
      const multiplier = this.backoffMultiplier[provider] || 1;
      const currentResetMs = Math.min(this.baseResetMs * multiplier, this.maxResetMs);

      if (Date.now() - lastFailure > currentResetMs) {
        // Half-open: allow ONE retry attempt, but don't reset failure count.
        // Only recordSuccess() fully resets. If it fails again,
        // recordFailure() will double the backoff.
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Record a provider failure — doubles the backoff multiplier
   */
  recordFailure(provider: string): void {
    this.state.failures[provider] = (this.state.failures[provider] || 0) + 1;
    this.state.lastFailure[provider] = Date.now();

    // Double backoff on each failure beyond threshold
    if (this.state.failures[provider] >= this.state.threshold) {
      const current = this.backoffMultiplier[provider] || 1;
      this.backoffMultiplier[provider] = Math.min(current * 2, this.maxResetMs / this.baseResetMs);
    }
  }

  /**
   * Record a provider success — fully resets failure count and backoff
   */
  recordSuccess(provider: string): void {
    this.state.failures[provider] = 0;
    this.backoffMultiplier[provider] = 1;
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
    this.backoffMultiplier = {};
  }
}
