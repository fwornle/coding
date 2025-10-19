/**
 * AgentAgnosticCache
 *
 * Universal caching solution supporting file, HTTP, and MCP backends.
 * Works with any CLI-based coding agent (not just Claude).
 * Implements LRU eviction with configurable size limits and statistics.
 *
 * Key Features:
 * - Multiple backends: file (local disk), HTTP (Redis/Memcached), MCP (memory server)
 * - LRU eviction policy with configurable max size
 * - TTL support for cache expiration
 * - Cache statistics (hit rate, size, evictions, backend performance)
 * - Agent-agnostic design (no Claude-specific dependencies)
 * - Graceful degradation when backends unavailable
 * - Automatic backend selection based on priority
 *
 * Backends:
 * 1. File backend: Fast local disk cache (default: .cache/agent-cache/)
 * 2. HTTP backend: Remote cache servers (Redis, Memcached, etc.)
 * 3. MCP backend: MCP Memory server for distributed caching
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';

// Cache entry structure
class CacheEntry {
  constructor(key, value, ttl) {
    this.key = key;
    this.value = value;
    this.timestamp = Date.now();
    this.expiresAt = ttl ? Date.now() + ttl : null;
    this.hits = 0;
    this.lastAccessTime = Date.now();
  }

  isExpired() {
    return this.expiresAt && Date.now() > this.expiresAt;
  }

  access() {
    this.hits++;
    this.lastAccessTime = Date.now();
  }
}

// LRU Cache implementation
class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map(); // key -> CacheEntry
    this.evictions = 0;
  }

  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (entry.isExpired()) {
      this.cache.delete(key);
      return null;
    }

    entry.access();

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  set(key, value, ttl) {
    // Remove if already exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.evictions++;
    }

    const entry = new CacheEntry(key, value, ttl);
    this.cache.set(key, entry);
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }

  getStats() {
    let totalHits = 0;
    let oldestAccess = Date.now();
    let newestAccess = 0;

    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
      if (entry.lastAccessTime < oldestAccess) oldestAccess = entry.lastAccessTime;
      if (entry.lastAccessTime > newestAccess) newestAccess = entry.lastAccessTime;
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      evictions: this.evictions,
      totalHits,
      averageHits: this.cache.size > 0 ? totalHits / this.cache.size : 0,
      oldestAccess,
      newestAccess
    };
  }
}

// File backend for local disk caching
class FileBackend {
  constructor(config = {}) {
    this.cacheDir = config.cacheDir || path.join(process.cwd(), '.cache', 'agent-cache');
    this.enabled = config.enabled !== false;

    // Create cache directory if it doesn't exist
    if (this.enabled && !fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async get(key) {
    if (!this.enabled) return null;

    try {
      const filePath = this.getFilePath(key);

      if (!fs.existsSync(filePath)) {
        return null;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Check expiration
      if (data.expiresAt && Date.now() > data.expiresAt) {
        fs.unlinkSync(filePath);
        return null;
      }

      return data.value;
    } catch (error) {
      console.warn('[FileBackend] Get error:', error);
      return null;
    }
  }

  async set(key, value, ttl) {
    if (!this.enabled) return false;

    try {
      const filePath = this.getFilePath(key);
      const data = {
        key,
        value,
        timestamp: Date.now(),
        expiresAt: ttl ? Date.now() + ttl : null
      };

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (error) {
      console.warn('[FileBackend] Set error:', error);
      return false;
    }
  }

  async delete(key) {
    if (!this.enabled) return false;

    try {
      const filePath = this.getFilePath(key);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (error) {
      console.warn('[FileBackend] Delete error:', error);
      return false;
    }
  }

  async clear() {
    if (!this.enabled) return false;

    try {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        fs.unlinkSync(path.join(this.cacheDir, file));
      }
      return true;
    } catch (error) {
      console.warn('[FileBackend] Clear error:', error);
      return false;
    }
  }

  getFilePath(key) {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return path.join(this.cacheDir, `${hash}.json`);
  }

  getStats() {
    if (!this.enabled) {
      return { enabled: false };
    }

    try {
      const files = fs.readdirSync(this.cacheDir);
      let totalSize = 0;

      for (const file of files) {
        const stats = fs.statSync(path.join(this.cacheDir, file));
        totalSize += stats.size;
      }

      return {
        enabled: true,
        entries: files.length,
        totalSize,
        cacheDir: this.cacheDir
      };
    } catch (error) {
      return { enabled: true, error: error.message };
    }
  }
}

// HTTP backend for Redis/Memcached/etc
class HTTPBackend {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl; // e.g., http://localhost:6379
    this.enabled = config.enabled && !!this.baseUrl;
    this.timeout = config.timeout || 5000;
  }

  async get(key) {
    if (!this.enabled) return null;

    try {
      const response = await fetch(`${this.baseUrl}/get/${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.value;
    } catch (error) {
      console.warn('[HTTPBackend] Get error:', error.message);
      return null;
    }
  }

  async set(key, value, ttl) {
    if (!this.enabled) return false;

    try {
      const response = await fetch(`${this.baseUrl}/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, ttl }),
        signal: AbortSignal.timeout(this.timeout)
      });

      return response.ok;
    } catch (error) {
      console.warn('[HTTPBackend] Set error:', error.message);
      return false;
    }
  }

  async delete(key) {
    if (!this.enabled) return false;

    try {
      const response = await fetch(`${this.baseUrl}/delete/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(this.timeout)
      });

      return response.ok;
    } catch (error) {
      console.warn('[HTTPBackend] Delete error:', error.message);
      return false;
    }
  }

  async clear() {
    if (!this.enabled) return false;

    try {
      const response = await fetch(`${this.baseUrl}/clear`, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeout)
      });

      return response.ok;
    } catch (error) {
      console.warn('[HTTPBackend] Clear error:', error.message);
      return false;
    }
  }

  getStats() {
    return {
      enabled: this.enabled,
      baseUrl: this.baseUrl
    };
  }
}

// MCP backend for MCP Memory server
class MCPBackend {
  constructor(config = {}) {
    this.enabled = config.enabled || false;
    this.serverName = config.serverName || 'memory';
  }

  async get(key) {
    if (!this.enabled) return null;

    try {
      // Search for entity with this cache key
      const result = await this.mcpCall('search_nodes', { query: key });

      if (!result || !result.entities || result.entities.length === 0) {
        return null;
      }

      // Find matching entity
      const entity = result.entities.find(e => e.name === key);
      if (!entity) return null;

      // Parse value from observations
      const valueObs = entity.observations.find(o => o.startsWith('value:'));
      if (!valueObs) return null;

      const value = JSON.parse(valueObs.substring(6));

      // Check expiration
      const expiresObs = entity.observations.find(o => o.startsWith('expiresAt:'));
      if (expiresObs) {
        const expiresAt = parseInt(expiresObs.substring(10));
        if (Date.now() > expiresAt) {
          await this.delete(key);
          return null;
        }
      }

      return value;
    } catch (error) {
      console.warn('[MCPBackend] Get error:', error.message);
      return null;
    }
  }

  async set(key, value, ttl) {
    if (!this.enabled) return false;

    try {
      const observations = [
        `value:${JSON.stringify(value)}`,
        `timestamp:${Date.now()}`
      ];

      if (ttl) {
        observations.push(`expiresAt:${Date.now() + ttl}`);
      }

      await this.mcpCall('create_entities', {
        entities: [{
          name: key,
          entityType: 'cache-entry',
          observations
        }]
      });

      return true;
    } catch (error) {
      console.warn('[MCPBackend] Set error:', error.message);
      return false;
    }
  }

  async delete(key) {
    if (!this.enabled) return false;

    try {
      await this.mcpCall('delete_entities', {
        entityNames: [key]
      });
      return true;
    } catch (error) {
      console.warn('[MCPBackend] Delete error:', error.message);
      return false;
    }
  }

  async clear() {
    if (!this.enabled) return false;

    try {
      // Get all cache entities
      const result = await this.mcpCall('search_nodes', { query: 'cache-entry' });

      if (result && result.entities && result.entities.length > 0) {
        const entityNames = result.entities
          .filter(e => e.type === 'cache-entry')
          .map(e => e.name);

        if (entityNames.length > 0) {
          await this.mcpCall('delete_entities', { entityNames });
        }
      }

      return true;
    } catch (error) {
      console.warn('[MCPBackend] Clear error:', error.message);
      return false;
    }
  }

  async mcpCall(method, params) {
    // Placeholder for MCP call - will be replaced with actual MCP client
    // This would use the MCP protocol to communicate with the memory server
    throw new Error('MCP backend not yet implemented - requires MCP client integration');
  }

  getStats() {
    return {
      enabled: this.enabled,
      serverName: this.serverName
    };
  }
}

export class AgentAgnosticCache extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;

    // LRU cache for in-memory caching
    this.lruCache = new LRUCache(config.maxSize || 1000);

    // Default TTL (1 hour)
    this.defaultTTL = config.defaultTTL || 60 * 60 * 1000;

    // Backend configuration
    this.backends = {
      file: new FileBackend(config.file || {}),
      http: new HTTPBackend(config.http || {}),
      mcp: new MCPBackend(config.mcp || {})
    };

    // Backend priority (try in this order)
    this.backendPriority = config.backendPriority || ['file', 'http', 'mcp'];

    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      byBackend: {
        memory: { hits: 0, misses: 0, sets: 0, errors: 0 },
        file: { hits: 0, misses: 0, sets: 0, errors: 0 },
        http: { hits: 0, misses: 0, sets: 0, errors: 0 },
        mcp: { hits: 0, misses: 0, sets: 0, errors: 0 }
      }
    };

    console.log('[AgentAgnosticCache] Initialized with backends:', this.backendPriority.join(', '));
  }

  /**
   * Generate cache key from input
   */
  generateKey(input, namespace = 'default') {
    const normalized = typeof input === 'string' ? input : JSON.stringify(input);
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    return `${namespace}:${hash}`;
  }

  /**
   * Get value from cache
   * Tries memory first, then backends in priority order
   */
  async get(key) {
    const startTime = Date.now();

    try {
      // 1. Try in-memory LRU cache first
      const memoryValue = this.lruCache.get(key);
      if (memoryValue !== null) {
        this.stats.hits++;
        this.stats.byBackend.memory.hits++;
        this.emit('cache-hit', { key, backend: 'memory', duration: Date.now() - startTime });
        return memoryValue;
      }

      this.stats.byBackend.memory.misses++;

      // 2. Try backends in priority order
      for (const backendName of this.backendPriority) {
        const backend = this.backends[backendName];

        if (!backend.enabled) {
          continue;
        }

        try {
          const value = await backend.get(key);

          if (value !== null) {
            // Cache hit - store in memory for faster access
            this.lruCache.set(key, value, this.defaultTTL);

            this.stats.hits++;
            this.stats.byBackend[backendName].hits++;
            this.emit('cache-hit', { key, backend: backendName, duration: Date.now() - startTime });

            return value;
          }

          this.stats.byBackend[backendName].misses++;
        } catch (error) {
          this.stats.byBackend[backendName].errors++;
          console.warn(`[AgentAgnosticCache] ${backendName} backend error:`, error);
          continue; // Try next backend
        }
      }

      // Cache miss
      this.stats.misses++;
      this.emit('cache-miss', { key, duration: Date.now() - startTime });

      return null;

    } catch (error) {
      this.stats.errors++;
      console.error('[AgentAgnosticCache] Get error:', error);
      return null;
    }
  }

  /**
   * Set value in cache
   * Writes to memory and all enabled backends
   */
  async set(key, value, ttl = null) {
    const startTime = Date.now();
    const effectiveTTL = ttl || this.defaultTTL;

    try {
      // 1. Store in memory
      this.lruCache.set(key, value, effectiveTTL);
      this.stats.byBackend.memory.sets++;

      // 2. Store in all enabled backends (fire and forget)
      const backendPromises = [];

      for (const backendName of this.backendPriority) {
        const backend = this.backends[backendName];

        if (!backend.enabled) {
          continue;
        }

        backendPromises.push(
          backend.set(key, value, effectiveTTL)
            .then(success => {
              if (success) {
                this.stats.byBackend[backendName].sets++;
              } else {
                this.stats.byBackend[backendName].errors++;
              }
              return success;
            })
            .catch(error => {
              this.stats.byBackend[backendName].errors++;
              console.warn(`[AgentAgnosticCache] ${backendName} set error:`, error);
              return false;
            })
        );
      }

      // Wait for all backends (but don't fail if some fail)
      await Promise.allSettled(backendPromises);

      this.stats.sets++;
      this.emit('cache-set', { key, ttl: effectiveTTL, duration: Date.now() - startTime });

      return true;
    } catch (error) {
      this.stats.errors++;
      console.error('[AgentAgnosticCache] Set error:', error);
      return false;
    }
  }

  /**
   * Delete value from cache
   * Removes from memory and all backends
   */
  async delete(key) {
    try {
      // 1. Delete from memory
      this.lruCache.delete(key);

      // 2. Delete from all backends
      const backendPromises = [];

      for (const backendName of this.backendPriority) {
        const backend = this.backends[backendName];

        if (!backend.enabled) {
          continue;
        }

        backendPromises.push(
          backend.delete(key).catch(error => {
            console.warn(`[AgentAgnosticCache] ${backendName} delete error:`, error);
            return false;
          })
        );
      }

      await Promise.allSettled(backendPromises);

      this.stats.deletes++;
      this.emit('cache-delete', { key });

      return true;
    } catch (error) {
      this.stats.errors++;
      console.error('[AgentAgnosticCache] Delete error:', error);
      return false;
    }
  }

  /**
   * Clear all cache entries
   */
  async clear() {
    try {
      // 1. Clear memory
      this.lruCache.clear();

      // 2. Clear all backends
      const backendPromises = [];

      for (const backendName of this.backendPriority) {
        const backend = this.backends[backendName];

        if (!backend.enabled) {
          continue;
        }

        backendPromises.push(
          backend.clear().catch(error => {
            console.warn(`[AgentAgnosticCache] ${backendName} clear error:`, error);
            return false;
          })
        );
      }

      await Promise.allSettled(backendPromises);

      this.emit('cache-clear');

      return true;
    } catch (error) {
      this.stats.errors++;
      console.error('[AgentAgnosticCache] Clear error:', error);
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const lruStats = this.lruCache.getStats();
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
      : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      sets: this.stats.sets,
      deletes: this.stats.deletes,
      errors: this.stats.errors,
      hitRate: hitRate.toFixed(2) + '%',
      lru: lruStats,
      byBackend: this.stats.byBackend,
      backends: {
        file: this.backends.file.getStats(),
        http: this.backends.http.getStats(),
        mcp: this.backends.mcp.getStats()
      }
    };
  }

  /**
   * Get current cache size
   */
  size() {
    return this.lruCache.size();
  }
}

export default AgentAgnosticCache;
