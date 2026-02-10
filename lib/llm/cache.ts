/**
 * LRU Cache with TTL for LLM Responses
 *
 * Extracted from identical patterns in SemanticValidator and UnifiedInferenceEngine.
 * FIFO eviction when maxSize reached, entries expire after ttlMs.
 */

import type { LLMCompletionResult } from './types.js';

interface CacheEntry {
  result: LLMCompletionResult;
  timestamp: number;
}

export class LLMCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttlMs: number;

  // Stats
  hits = 0;
  misses = 0;

  constructor(maxSize = 1000, ttlMs = 3600000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Get a cached result if it exists and is within TTL
   */
  get(key: string): LLMCompletionResult | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.ttlMs) {
      this.hits++;
      return { ...entry.result, cached: true };
    }
    if (entry) {
      // Expired — remove it
      this.cache.delete(key);
    }
    this.misses++;
    return null;
  }

  /**
   * Store a result in the cache
   */
  set(key: string, result: LLMCompletionResult): void {
    // FIFO eviction
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, { result, timestamp: Date.now() });
  }

  /**
   * Generate a cache key from prompt content and routing context
   */
  static getCacheKey(prompt: string, operationType?: string): string {
    const hash = LLMCache.simpleHash(prompt);
    return `${operationType || 'default'}:${hash}`;
  }

  /**
   * Simple hash function (same as used in all 3 existing consumers)
   */
  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  get size(): number {
    return this.cache.size;
  }

  get hitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
