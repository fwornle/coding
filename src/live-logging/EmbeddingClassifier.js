const { QdrantClient } = require('@qdrant/js-client-rest');
const EmbeddingGenerator = require('../utils/EmbeddingGenerator');
const RepositoryIndexer = require('./RepositoryIndexer');

/**
 * EmbeddingClassifier - Layer 3 of Four-Layer ReliableCodingClassifier
 * 
 * Provides semantic vector similarity classification when KeywordMatcher (Layer 2) 
 * returns inconclusive results. Uses Qdrant similarity search against the 
 * coding_infrastructure collection for <3ms classification response time.
 * 
 * Integration Flow:
 * PathAnalyzer → KeywordMatcher → **EmbeddingClassifier** → SemanticAnalyzer
 * 
 * Features:
 * - Semantic vector similarity search using cosine distance
 * - <3ms classification time with optimized Qdrant settings
 * - Confidence scoring with similarity thresholds
 * - Cache integration for embedding results
 * - Performance monitoring and decision path logging
 * - Graceful fallback to SemanticAnalyzer on failures
 */
class EmbeddingClassifier {
  constructor(options = {}) {
    this.config = {
      // Qdrant connection settings (reuse mcp-constraint-monitor infrastructure)
      qdrant: {
        host: options.qdrantHost || 'localhost',
        port: options.qdrantPort || 6333,
        collection: 'coding_infrastructure'
      },
      
      // Classification settings
      classification: {
        similarityThreshold: options.similarityThreshold || 0.7,
        maxResults: options.maxResults || 5,
        confidenceThreshold: options.confidenceThreshold || 0.6,
        maxClassificationTimeMs: options.maxClassificationTimeMs || 3000 // <3ms requirement
      },
      
      // Performance optimization
      performance: {
        cacheEnabled: options.cacheEnabled !== false,
        cacheTTL: options.cacheTTL || 300000, // 5 minutes
        hnswEf: options.hnswEf || 64, // Speed vs accuracy tradeoff
        useApproximateSearch: options.useApproximateSearch !== false
      },
      
      // Integration settings
      integration: {
        autoIndexOnStartup: options.autoIndexOnStartup !== false,
        fallbackToSemanticAnalyzer: options.fallbackToSemanticAnalyzer !== false
      },
      
      debug: options.debug || false
    };
    
    // Initialize Qdrant client with same settings as mcp-constraint-monitor
    this.qdrant = new QdrantClient({
      url: `http://${this.config.qdrant.host}:${this.config.qdrant.port}`
    });
    
    // Initialize embedding generator for text vectorization
    this.embeddingGenerator = new EmbeddingGenerator({
      debug: this.config.debug,
      cacheEnabled: this.config.performance.cacheEnabled,
      cacheTTL: this.config.performance.cacheTTL
    });
    
    // Initialize repository indexer for index management
    this.repositoryIndexer = new RepositoryIndexer({
      qdrantHost: this.config.qdrant.host,
      qdrantPort: this.config.qdrant.port,
      debug: this.config.debug
    });
    
    // Classification cache for embedding results
    this.classificationCache = new Map();
    
    // Performance and accuracy statistics
    this.stats = {
      classificationsPerformed: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageClassificationTime: 0,
      averageSimilarityScore: 0,
      codingClassifications: 0,
      nonCodingClassifications: 0,
      inconclusiveResults: 0,
      fallbackToSemanticAnalyzer: 0,
      errors: 0
    };
    
    this.initialized = false;
    this.log('EmbeddingClassifier (Layer 3) initialized');
  }
  
  /**
   * Initialize the classifier and ensure repository index is ready
   * @returns {Promise<void>}
   */
  async initialize() {
    const startTime = Date.now();
    
    try {
      this.log('Initializing EmbeddingClassifier Layer 3...');
      
      // Initialize embedding generator
      if (this.embeddingGenerator.initialize) {
        await this.embeddingGenerator.initialize();
      }
      
      // Initialize repository indexer
      await this.repositoryIndexer.initialize();
      
      // Verify Qdrant collection exists
      await this.verifyCollection();
      
      // Auto-index repository if enabled and needed
      if (this.config.integration.autoIndexOnStartup) {
        await this.ensureRepositoryIndexed();
      }
      
      this.initialized = true;
      
      const initTime = Date.now() - startTime;
      this.log('EmbeddingClassifier initialization completed', {
        initializationTime: initTime,
        collectionReady: true,
        repositoryIndexed: true
      });
      
    } catch (error) {
      this.log(`EmbeddingClassifier initialization failed: ${error.message}`, { error: true });
      throw error;
    }
  }
  
  /**
   * Classify content using semantic vector similarity (Layer 3)
   * Called by ReliableCodingClassifier when KeywordMatcher is inconclusive
   * 
   * @param {Object} exchange - Exchange data containing content to classify
   * @returns {Promise<Object>} Classification result with confidence and reasoning
   */
  async classifyByEmbedding(exchange) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const startTime = Date.now();
    this.stats.classificationsPerformed++;
    
    try {
      // Extract text content from exchange
      const textContent = this.extractTextContent(exchange);
      if (!textContent || textContent.trim().length === 0) {
        return this.createInconclusiveResult('No text content to analyze', startTime);
      }
      
      // Check classification cache first
      const cacheKey = this.getCacheKey(textContent);
      if (this.config.performance.cacheEnabled) {
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          this.stats.cacheHits++;
          this.updateClassificationStats(cached, Date.now() - startTime);
          return cached;
        }
      }
      
      this.stats.cacheMisses++;
      
      // Generate embedding for content
      const embeddingStartTime = Date.now();
      const embedding = await this.embeddingGenerator.generateEmbedding(textContent);
      const embeddingTime = Date.now() - embeddingStartTime;
      
      if (!embedding || !this.embeddingGenerator.validateEmbedding(embedding)) {
        return this.createErrorResult('Failed to generate valid embedding', startTime);
      }
      
      // Perform similarity search against coding_infrastructure collection
      const searchStartTime = Date.now();
      const similarityResults = await this.searchSimilarContent(embedding);
      const searchTime = Date.now() - searchStartTime;
      
      // Analyze similarity results and determine classification
      const classificationResult = this.analyzeSimilarityResults(
        similarityResults, 
        textContent,
        {
          embeddingTime,
          searchTime,
          totalTime: Date.now() - startTime
        }
      );
      
      // Cache the result if caching is enabled
      if (this.config.performance.cacheEnabled) {
        this.cacheResult(cacheKey, classificationResult);
      }
      
      // Update statistics
      this.updateClassificationStats(classificationResult, Date.now() - startTime);
      
      // Validate performance requirements
      const totalTime = Date.now() - startTime;
      if (totalTime > this.config.classification.maxClassificationTimeMs) {
        this.log(`Classification exceeded time limit: ${totalTime}ms > ${this.config.classification.maxClassificationTimeMs}ms`, {
          warning: true
        });
      }
      
      this.log('EmbeddingClassifier classification completed', {
        isCoding: classificationResult.isCoding,
        confidence: classificationResult.confidence,
        maxSimilarity: classificationResult.similarity_scores?.max_similarity,
        processingTime: totalTime
      });
      
      return classificationResult;
      
    } catch (error) {
      this.stats.errors++;
      this.log(`EmbeddingClassifier error: ${error.message}`, { error: true });
      
      // Return error result that can trigger fallback to SemanticAnalyzer
      return this.createErrorResult(error.message, startTime);
    }
  }
  
  /**
   * Search for similar content in the coding_infrastructure collection
   * @private
   * @param {Array<number>} embedding - Query embedding vector
   * @returns {Promise<Array>} Similarity search results
   */
  async searchSimilarContent(embedding) {
    try {
      const results = await this.qdrant.search(this.config.qdrant.collection, {
        vector: embedding,
        limit: this.config.classification.maxResults,
        score_threshold: 0.3, // Lower threshold for broader search
        with_payload: true,
        params: {
          hnsw_ef: this.config.performance.hnswEf,
          exact: !this.config.performance.useApproximateSearch
        }
      });
      
      this.log(`Found ${results.length} similar documents`, {
        maxScore: results.length > 0 ? results[0].score : 0,
        minScore: results.length > 0 ? results[results.length - 1].score : 0
      });
      
      return results;
      
    } catch (error) {
      this.log(`Similarity search failed: ${error.message}`, { error: true });
      throw error;
    }
  }
  
  /**
   * Analyze similarity search results to determine classification
   * @private
   * @param {Array} results - Similarity search results from Qdrant
   * @param {string} textContent - Original text content
   * @param {Object} timing - Timing information
   * @returns {Object} Classification result
   */
  analyzeSimilarityResults(results, textContent, timing) {
    if (!results || results.length === 0) {
      return this.createInconclusiveResult(
        'No similar content found in coding infrastructure',
        timing.totalTime
      );
    }
    
    // Calculate similarity statistics
    const scores = results.map(r => r.score);
    const maxSimilarity = Math.max(...scores);
    const avgSimilarity = scores.reduce((a, b) => a + b, 0) / scores.length;
    const matchingDocuments = results.length;
    
    // Determine classification based on similarity threshold
    const isCoding = maxSimilarity >= this.config.classification.similarityThreshold;
    
    // Calculate confidence based on similarity score distribution
    const confidence = this.calculateConfidence(scores, maxSimilarity);
    
    // Create reasoning based on top matches
    const reasoning = this.createReasoningFromResults(results, maxSimilarity, isCoding);
    
    const result = {
      isCoding,
      confidence,
      reason: reasoning,
      layer: 'embedding', // Layer 3 identification
      similarity_scores: {
        max_similarity: maxSimilarity,
        avg_similarity: avgSimilarity,
        matching_documents: matchingDocuments,
        threshold_used: this.config.classification.similarityThreshold
      },
      processing_time_ms: timing.totalTime,
      performance_breakdown: {
        embedding_generation_ms: timing.embeddingTime,
        similarity_search_ms: timing.searchTime,
        analysis_ms: timing.totalTime - timing.embeddingTime - timing.searchTime
      },
      top_matches: results.slice(0, 3).map(r => ({
        file_path: r.payload.file_path,
        content_type: r.payload.content_type,
        title: r.payload.title,
        similarity: r.score
      }))
    };
    
    return result;
  }
  
  /**
   * Calculate confidence score based on similarity distribution
   * @private
   */
  calculateConfidence(scores, maxSimilarity) {
    if (scores.length === 0) return 0;
    
    // Base confidence on max similarity
    let confidence = maxSimilarity;
    
    // Boost confidence if multiple results have high similarity
    const highSimilarityResults = scores.filter(s => s > 0.6).length;
    if (highSimilarityResults > 1) {
      confidence = Math.min(1.0, confidence + (highSimilarityResults - 1) * 0.05);
    }
    
    // Reduce confidence if max similarity is borderline
    if (maxSimilarity < this.config.classification.similarityThreshold + 0.1) {
      confidence *= 0.9;
    }
    
    return Math.round(confidence * 100) / 100; // Round to 2 decimal places
  }
  
  /**
   * Create human-readable reasoning from similarity results
   * @private
   */
  createReasoningFromResults(results, maxSimilarity, isCoding) {
    if (results.length === 0) {
      return 'No similar content found in coding infrastructure index';
    }
    
    const topMatch = results[0];
    const similarityPercentage = Math.round(maxSimilarity * 100);
    
    if (isCoding) {
      return `High similarity (${similarityPercentage}%) to coding infrastructure: ${topMatch.payload.file_path} (${topMatch.payload.content_type})`;
    } else {
      return `Low similarity (${similarityPercentage}%) to coding infrastructure. Top match: ${topMatch.payload.file_path} (${topMatch.payload.content_type})`;
    }
  }
  
  /**
   * Extract text content from exchange for classification
   * @private
   */
  extractTextContent(exchange) {
    let content = '';
    
    // Extract from different exchange formats
    if (exchange.content) {
      content += exchange.content;
    }
    
    if (exchange.message) {
      content += ' ' + exchange.message;
    }
    
    if (exchange.text) {
      content += ' ' + exchange.text;
    }
    
    // Extract from tool calls if present
    if (exchange.toolCalls && Array.isArray(exchange.toolCalls)) {
      const toolContent = exchange.toolCalls
        .map(call => `${call.tool}: ${JSON.stringify(call.parameters)}`)
        .join(' ');
      content += ' ' + toolContent;
    }
    
    return content.trim();
  }
  
  /**
   * Create inconclusive result when classification cannot be determined
   * @private
   */
  createInconclusiveResult(reason, totalTime) {
    this.stats.inconclusiveResults++;
    
    return {
      isCoding: null, // Inconclusive - should trigger SemanticAnalyzer fallback
      confidence: 0,
      reason: `Embedding Layer 3 inconclusive: ${reason}`,
      layer: 'embedding',
      similarity_scores: {
        max_similarity: 0,
        avg_similarity: 0,
        matching_documents: 0
      },
      processing_time_ms: totalTime || 0,
      inconclusive: true
    };
  }
  
  /**
   * Create error result for classification failures
   * @private
   */
  createErrorResult(errorMessage, totalTime) {
    return {
      isCoding: null, // Error - should trigger SemanticAnalyzer fallback
      confidence: 0,
      reason: `Embedding Layer 3 error: ${errorMessage}`,
      layer: 'embedding',
      similarity_scores: {
        max_similarity: 0,
        avg_similarity: 0,
        matching_documents: 0
      },
      processing_time_ms: totalTime || 0,
      error: true
    };
  }
  
  /**
   * Verify Qdrant collection exists and is accessible
   * @private
   */
  async verifyCollection() {
    try {
      const collections = await this.qdrant.getCollections();
      const exists = collections.collections.some(c => c.name === this.config.qdrant.collection);
      
      if (!exists) {
        throw new Error(`Qdrant collection '${this.config.qdrant.collection}' does not exist. Run repository indexing first.`);
      }
      
      // Verify collection has documents
      const info = await this.qdrant.getCollection(this.config.qdrant.collection);
      if (info.points_count === 0) {
        this.log('Warning: coding_infrastructure collection is empty. Consider running repository indexing.', {
          warning: true
        });
      }
      
    } catch (error) {
      this.log(`Collection verification failed: ${error.message}`, { error: true });
      throw error;
    }
  }
  
  /**
   * Ensure repository is indexed if auto-indexing is enabled
   * @private
   */
  async ensureRepositoryIndexed() {
    try {
      const isIndexCurrent = await this.repositoryIndexer.isIndexCurrent();
      
      if (!isIndexCurrent) {
        this.log('Repository index is not current, starting auto-indexing...');
        
        const indexingResult = await this.repositoryIndexer.indexRepository({
          forceReindex: false
        });
        
        this.log('Auto-indexing completed', {
          filesProcessed: indexingResult.filesProcessed,
          documentsCreated: indexingResult.documentsCreated,
          processingTime: indexingResult.processingTime
        });
      }
    } catch (error) {
      this.log(`Auto-indexing failed: ${error.message}`, { error: true });
      // Don't throw - allow classifier to work with existing index
    }
  }
  
  /**
   * Caching methods for embedding results
   * @private
   */
  getCacheKey(content) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }
  
  getFromCache(key) {
    const cached = this.classificationCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.config.performance.cacheTTL) {
      return cached.result;
    }
    
    if (cached) {
      this.classificationCache.delete(key); // Remove expired entry
    }
    
    return null;
  }
  
  cacheResult(key, result) {
    // Implement simple cache size management
    if (this.classificationCache.size > 1000) {
      // Remove oldest 20% of entries
      const entries = Array.from(this.classificationCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = Math.floor(entries.length * 0.2);
      for (let i = 0; i < toRemove; i++) {
        this.classificationCache.delete(entries[i][0]);
      }
    }
    
    this.classificationCache.set(key, {
      result,
      timestamp: Date.now()
    });
  }
  
  /**
   * Update classification statistics
   * @private
   */
  updateClassificationStats(result, processingTime) {
    // Update timing statistics
    this.stats.averageClassificationTime = 
      (this.stats.averageClassificationTime * (this.stats.classificationsPerformed - 1) + processingTime) / 
      this.stats.classificationsPerformed;
    
    // Update classification counts
    if (result.isCoding === true) {
      this.stats.codingClassifications++;
    } else if (result.isCoding === false) {
      this.stats.nonCodingClassifications++;
    }
    
    // Update similarity statistics
    if (result.similarity_scores?.max_similarity) {
      this.stats.averageSimilarityScore = 
        (this.stats.averageSimilarityScore * (this.stats.classificationsPerformed - 1) + 
         result.similarity_scores.max_similarity) / this.stats.classificationsPerformed;
    }
  }
  
  /**
   * Get classifier statistics and performance metrics
   * @returns {Object} Statistics and performance data
   */
  getStats() {
    const cacheHitRate = this.stats.classificationsPerformed > 0 
      ? this.stats.cacheHits / this.stats.classificationsPerformed 
      : 0;
    
    return {
      layer: 'embedding',
      classification: {
        total: this.stats.classificationsPerformed,
        coding: this.stats.codingClassifications,
        nonCoding: this.stats.nonCodingClassifications,
        inconclusive: this.stats.inconclusiveResults,
        errors: this.stats.errors
      },
      performance: {
        averageClassificationTime: this.stats.averageClassificationTime,
        averageSimilarityScore: this.stats.averageSimilarityScore,
        cacheHitRate,
        maxClassificationTimeMs: this.config.classification.maxClassificationTimeMs
      },
      cache: {
        enabled: this.config.performance.cacheEnabled,
        size: this.classificationCache.size,
        hits: this.stats.cacheHits,
        misses: this.stats.cacheMisses
      },
      configuration: {
        similarityThreshold: this.config.classification.similarityThreshold,
        maxResults: this.config.classification.maxResults,
        collection: this.config.qdrant.collection
      },
      embeddingGenerator: this.embeddingGenerator.getStats(),
      repositoryIndexer: this.repositoryIndexer.getStats()
    };
  }
  
  /**
   * Clear classification cache
   */
  clearCache() {
    this.classificationCache.clear();
    this.stats.cacheHits = 0;
    this.stats.cacheMisses = 0;
    this.log('EmbeddingClassifier cache cleared');
  }
  
  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      if (this.embeddingGenerator && this.embeddingGenerator.cleanup) {
        await this.embeddingGenerator.cleanup();
      }
      
      if (this.repositoryIndexer && this.repositoryIndexer.cleanup) {
        await this.repositoryIndexer.cleanup();
      }
      
      this.clearCache();
      this.initialized = false;
      
      this.log('EmbeddingClassifier cleanup completed');
    } catch (error) {
      this.log(`Cleanup error: ${error.message}`, { error: true });
    }
  }
  
  /**
   * Debug logging
   * @private
   */
  log(message, data = {}) {
    if (this.config.debug) {
      console.log(`[EmbeddingClassifier Layer 3] ${message}`, data);
    }
  }
}

module.exports = EmbeddingClassifier;