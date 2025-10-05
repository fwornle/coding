const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * EmbeddingGenerator - Utility for generating semantic embeddings using sentence-transformers
 * 
 * Integrates with sentence-transformers/all-MiniLM-L6-v2 via Python subprocess
 * Provides batch processing and caching for 384-dimensional vectors
 * Designed for <2ms generation time for cached embeddings
 */
class EmbeddingGenerator {
  constructor(options = {}) {
    this.modelName = options.modelName || 'sentence-transformers/all-MiniLM-L6-v2';
    this.vectorDimensions = options.vectorDimensions || 384;
    this.cacheEnabled = options.cacheEnabled !== false;
    this.cacheTTL = options.cacheTTL || 3600000; // 1 hour default
    this.maxCacheSize = options.maxCacheSize || 10000;
    this.batchSize = options.batchSize || 32;
    this.timeout = options.timeout || 30000; // 30 seconds
    this.debug = options.debug || false;
    
    // In-memory cache for embeddings
    this.embeddingCache = new Map();
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalRequests: 0
    };
    
    // Performance tracking
    this.performanceStats = {
      totalGenerations: 0,
      avgGenerationTime: 0,
      avgCacheTime: 0,
      batchGenerations: 0,
      avgBatchTime: 0
    };
    
    // Python script path for embedding generation
    this.pythonScriptPath = this.createPythonScript();
    
    this.log('EmbeddingGenerator initialized', {
      model: this.modelName,
      dimensions: this.vectorDimensions,
      cacheEnabled: this.cacheEnabled
    });
  }
  
  /**
   * Generate embedding for a single text
   * @param {string} text - Text to generate embedding for
   * @param {object} options - Generation options
   * @returns {Promise<Array<number>>} 384-dimensional embedding vector
   */
  async generateEmbedding(text, options = {}) {
    const startTime = process.hrtime.bigint();
    this.performanceStats.totalGenerations++;
    this.cacheStats.totalRequests++;
    
    try {
      // Validate input
      if (!text || typeof text !== 'string') {
        throw new Error('Text must be a non-empty string');
      }
      
      // Check cache first
      if (this.cacheEnabled) {
        const cached = this.getCachedEmbedding(text);
        if (cached) {
          const endTime = process.hrtime.bigint();
          const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
          this.updateCacheStats(duration, true);
          this.log(`Cache hit for text: "${text.substring(0, 50)}..."`, { duration });
          return cached;
        }
      }
      
      // Generate new embedding
      const embedding = await this.generateEmbeddingFromSubprocess([text]);
      const result = embedding[0];
      
      // Cache the result
      if (this.cacheEnabled && result) {
        this.cacheEmbedding(text, result);
      }
      
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;
      this.updateCacheStats(duration, false);
      
      this.log(`Generated embedding for text: "${text.substring(0, 50)}..."`, { 
        duration,
        dimensions: result ? result.length : 0
      });
      
      return result;
      
    } catch (error) {
      this.log(`Error generating embedding: ${error.message}`, { error: true });
      throw new Error(`Embedding generation failed: ${error.message}`);
    }
  }
  
  /**
   * Generate embeddings for multiple texts in batch
   * @param {Array<string>} texts - Array of texts to generate embeddings for
   * @param {object} options - Generation options
   * @returns {Promise<Array<Array<number>>>} Array of 384-dimensional embedding vectors
   */
  async generateBatchEmbeddings(texts, options = {}) {
    const startTime = process.hrtime.bigint();
    this.performanceStats.batchGenerations++;
    
    try {
      // Validate input
      if (!Array.isArray(texts) || texts.length === 0) {
        throw new Error('Texts must be a non-empty array');
      }
      
      // Check cache for each text
      const results = [];
      const uncachedTexts = [];
      const uncachedIndices = [];
      
      if (this.cacheEnabled) {
        for (let i = 0; i < texts.length; i++) {
          const text = texts[i];
          const cached = this.getCachedEmbedding(text);
          if (cached) {
            results[i] = cached;
            this.cacheStats.hits++;
          } else {
            uncachedTexts.push(text);
            uncachedIndices.push(i);
            this.cacheStats.misses++;
          }
        }
      } else {
        uncachedTexts.push(...texts);
        uncachedIndices.push(...texts.map((_, i) => i));
      }
      
      // Generate embeddings for uncached texts
      if (uncachedTexts.length > 0) {
        const newEmbeddings = await this.generateEmbeddingFromSubprocess(uncachedTexts);
        
        // Insert new embeddings into results and cache them
        for (let i = 0; i < uncachedTexts.length; i++) {
          const embedding = newEmbeddings[i];
          const originalIndex = uncachedIndices[i];
          results[originalIndex] = embedding;
          
          if (this.cacheEnabled && embedding) {
            this.cacheEmbedding(uncachedTexts[i], embedding);
          }
        }
      }
      
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;
      this.updateBatchStats(duration);
      
      this.log(`Generated batch embeddings`, {
        totalTexts: texts.length,
        cached: this.cacheEnabled ? results.length - uncachedTexts.length : 0,
        generated: uncachedTexts.length,
        duration
      });
      
      return results;
      
    } catch (error) {
      this.log(`Error generating batch embeddings: ${error.message}`, { error: true });
      throw new Error(`Batch embedding generation failed: ${error.message}`);
    }
  }
  
  /**
   * Generate embeddings using Python subprocess
   * @private
   */
  async generateEmbeddingFromSubprocess(texts) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      // Spawn Python process
      const pythonProcess = spawn('python3', [this.pythonScriptPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      // Handle timeout
      const timeoutId = setTimeout(() => {
        pythonProcess.kill('SIGKILL');
        reject(new Error(`Embedding generation timed out after ${this.timeout}ms`));
      }, this.timeout);
      
      // Collect output
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        clearTimeout(timeoutId);
        
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            if (result.error) {
              reject(new Error(result.error));
            } else {
              resolve(result.embeddings);
            }
          } catch (parseError) {
            reject(new Error(`Failed to parse embedding response: ${parseError.message}`));
          }
        } else {
          reject(new Error(`Python process exited with code ${code}: ${stderr}`));
        }
      });
      
      pythonProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to spawn Python process: ${error.message}`));
      });
      
      // Send input to Python process
      try {
        const input = JSON.stringify({
          texts: texts,
          model: this.modelName
        });
        pythonProcess.stdin.write(input);
        pythonProcess.stdin.end();
      } catch (error) {
        clearTimeout(timeoutId);
        pythonProcess.kill();
        reject(new Error(`Failed to send data to Python process: ${error.message}`));
      }
    });
  }
  
  /**
   * Create Python script for embedding generation
   * @private
   */
  createPythonScript() {
    const scriptPath = path.join(__dirname, 'embedding_generator.py');
    
    const pythonScript = `#!/usr/bin/env python3
import sys
import json
import numpy as np
from sentence_transformers import SentenceTransformer

def main():
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        texts = input_data['texts']
        model_name = input_data.get('model', 'sentence-transformers/all-MiniLM-L6-v2')
        
        # Load model
        model = SentenceTransformer(model_name)
        
        # Generate embeddings
        embeddings = model.encode(texts, convert_to_numpy=True)
        
        # Convert to list for JSON serialization
        embeddings_list = [emb.tolist() for emb in embeddings]
        
        # Output result
        result = {
            "embeddings": embeddings_list,
            "model": model_name,
            "dimensions": len(embeddings_list[0]) if embeddings_list else 0
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            "error": str(e),
            "embeddings": None
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()
`;
    
    // Write the Python script
    fs.writeFileSync(scriptPath, pythonScript);
    fs.chmodSync(scriptPath, '755');
    
    return scriptPath;
  }
  
  /**
   * Get cached embedding for text
   * @private
   */
  getCachedEmbedding(text) {
    if (!this.cacheEnabled) return null;
    
    const key = this.getCacheKey(text);
    const cached = this.embeddingCache.get(key);
    
    if (cached) {
      // Check TTL
      if (Date.now() - cached.timestamp > this.cacheTTL) {
        this.embeddingCache.delete(key);
        return null;
      }
      
      this.cacheStats.hits++;
      return cached.embedding;
    }
    
    this.cacheStats.misses++;
    return null;
  }
  
  /**
   * Cache embedding for text
   * @private
   */
  cacheEmbedding(text, embedding) {
    if (!this.cacheEnabled) return;
    
    // Check cache size limit
    if (this.embeddingCache.size >= this.maxCacheSize) {
      this.evictOldestCacheEntries();
    }
    
    const key = this.getCacheKey(text);
    this.embeddingCache.set(key, {
      embedding: embedding,
      timestamp: Date.now()
    });
  }
  
  /**
   * Generate cache key for text
   * @private
   */
  getCacheKey(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
  }
  
  /**
   * Evict oldest cache entries when cache is full
   * @private
   */
  evictOldestCacheEntries() {
    const entries = Array.from(this.embeddingCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toRemove = Math.floor(this.maxCacheSize * 0.2); // Remove 20%
    for (let i = 0; i < toRemove; i++) {
      this.embeddingCache.delete(entries[i][0]);
      this.cacheStats.evictions++;
    }
  }
  
  /**
   * Update cache performance statistics
   * @private
   */
  updateCacheStats(duration, wasHit) {
    if (wasHit) {
      this.performanceStats.avgCacheTime = 
        (this.performanceStats.avgCacheTime * this.cacheStats.hits + duration) / 
        (this.cacheStats.hits + 1);
    } else {
      this.performanceStats.avgGenerationTime =
        (this.performanceStats.avgGenerationTime * (this.performanceStats.totalGenerations - 1) + duration) /
        this.performanceStats.totalGenerations;
    }
  }
  
  /**
   * Update batch performance statistics
   * @private
   */
  updateBatchStats(duration) {
    this.performanceStats.avgBatchTime =
      (this.performanceStats.avgBatchTime * (this.performanceStats.batchGenerations - 1) + duration) /
      this.performanceStats.batchGenerations;
  }
  
  /**
   * Get performance and cache statistics
   */
  getStats() {
    const cacheHitRate = this.cacheStats.totalRequests > 0 
      ? this.cacheStats.hits / this.cacheStats.totalRequests 
      : 0;
    
    return {
      cache: {
        enabled: this.cacheEnabled,
        size: this.embeddingCache.size,
        maxSize: this.maxCacheSize,
        hitRate: cacheHitRate,
        ...this.cacheStats
      },
      performance: {
        ...this.performanceStats
      },
      configuration: {
        model: this.modelName,
        dimensions: this.vectorDimensions,
        batchSize: this.batchSize,
        timeout: this.timeout
      }
    };
  }
  
  /**
   * Clear the embedding cache
   */
  clearCache() {
    this.embeddingCache.clear();
    this.cacheStats.hits = 0;
    this.cacheStats.misses = 0;
    this.cacheStats.evictions = 0;
    this.cacheStats.totalRequests = 0;
    this.log('Embedding cache cleared');
  }
  
  /**
   * Validate embedding vector
   * @param {Array<number>} embedding - Embedding vector to validate
   * @returns {boolean} True if valid, false otherwise
   */
  validateEmbedding(embedding) {
    if (!Array.isArray(embedding)) return false;
    if (embedding.length !== this.vectorDimensions) return false;
    return embedding.every(val => typeof val === 'number' && !isNaN(val));
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    // Remove Python script
    try {
      if (fs.existsSync(this.pythonScriptPath)) {
        fs.unlinkSync(this.pythonScriptPath);
      }
    } catch (error) {
      this.log(`Failed to cleanup Python script: ${error.message}`, { error: true });
    }
    
    // Clear cache
    this.clearCache();
    
    this.log('EmbeddingGenerator cleanup completed');
  }
  
  /**
   * Debug logging
   * @private
   */
  log(message, data = {}) {
    if (this.debug) {
      console.log(`[EmbeddingGenerator] ${message}`, data);
    }
  }
}

module.exports = EmbeddingGenerator;