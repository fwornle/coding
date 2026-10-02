/**
 * Fast JavaScript Embedding Generator using Transformers.js
 *
 * Replaces slow Python process spawning with native JavaScript implementation
 * Uses high-quality model: nomic-embed-text-v1 (768 dimensions)
 *
 * Performance: ~10-100x faster than Python spawning
 * - Python: ~500ms per embedding (process spawn overhead)
 * - Transformers.js: ~50ms per embedding (native)
 */

// @xenova/transformers is imported lazily, in initialize(). It loads `sharp`
// (a native image library) at import time, and sharp ships no build for some
// platforms (linux-arm64 among them). A top-level import made merely
// CONSTRUCTING the LSL classifier crash there, taking session logging down for
// every non-tools project — found by tests/cleanroom. Deferred, a missing sharp
// surfaces as a failed embedding, which the classifier already treats as
// inconclusive.

class FastEmbeddingGenerator {
  constructor() {
    this.extractor = null;
    this.modelName = 'Xenova/nomic-embed-text-v1'; // Higher quality ONNX model with better semantic understanding
    this.initPromise = null;
  }

  /**
   * Initialize the embedding model (lazy loading)
   */
  async initialize() {
    if (this.extractor) {
      return this.extractor;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      console.log('🔄 Loading embedding model (one-time initialization)...');
      const startTime = Date.now();

      const { pipeline } = await import('@xenova/transformers');
      this.extractor = await pipeline('feature-extraction', this.modelName, {
        // Use local cache, download on first use
        progress_callback: null // Suppress download progress
      });

      const loadTime = Date.now() - startTime;
      console.log(`✅ Embedding model loaded in ${loadTime}ms`);

      return this.extractor;
    })();

    return this.initPromise;
  }

  /**
   * Generate embedding for a single text
   * @param {string} text - Input text
   * @returns {Promise<number[]>} 768-dimensional embedding vector
   */
  async generate(text) {
    await this.initialize();

    const output = await this.extractor(text, {
      pooling: 'mean',
      normalize: true
    });

    // Convert to plain array
    return Array.from(output.data);
  }

  /**
   * Generate embeddings for multiple texts in batch
   * @param {string[]} texts - Array of input texts
   * @returns {Promise<number[][]>} Array of 768-dimensional embedding vectors
   */
  async generateBatch(texts) {
    await this.initialize();

    const results = await Promise.all(
      texts.map(text => this.generate(text))
    );

    return results;
  }

  /**
   * Get embedding dimensions
   * @returns {number} Vector dimensions (768 for nomic-embed-text-v1)
   */
  getDimensions() {
    return 768;
  }
}

// Singleton instance
let instance = null;

export function getFastEmbeddingGenerator() {
  if (!instance) {
    instance = new FastEmbeddingGenerator();
  }
  return instance;
}

export default FastEmbeddingGenerator;
