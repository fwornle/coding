/**
 * SemanticAnalyzerAdapter - Layer 2 of Reliable Coding Classifier
 * 
 * Adapts existing SemanticAnalyzer.js for classification use case.
 * Provides semantic analysis layer with proper error handling and classification scoring.
 * 
 * Features:
 * - Wraps existing SemanticAnalyzer.js completely without modification
 * - Extracts coding confidence from semantic analysis results
 * - Handles API timeouts and failures gracefully
 * - Supports XAI/Grok and OpenAI providers
 * - Robust error handling with fallback mechanisms
 * - Comprehensive operational logging
 */

import { SemanticAnalyzer } from './SemanticAnalyzer.js';

class SemanticAnalyzerAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY;
    this.debug = options.debug || false;
    this.timeout = options.timeout || 2000; // 2 second timeout for classification
    this.model = options.model; // Optional model override
    
    // Initialize semantic analyzer if API key available
    if (this.apiKey) {
      try {
        this.semanticAnalyzer = new SemanticAnalyzer(this.apiKey, this.model);
        this.log(`SemanticAnalyzerAdapter initialized with ${this.semanticAnalyzer.apiType} provider`);
      } catch (error) {
        this.log(`Failed to initialize SemanticAnalyzer: ${error.message}`);
        this.semanticAnalyzer = null;
      }
    } else {
      this.log('No API key available, semantic analysis disabled');
      this.semanticAnalyzer = null;
    }
    
    // Statistics tracking
    this.stats = {
      totalAnalyses: 0,
      successfulAnalyses: 0,
      timeouts: 0,
      apiErrors: 0,
      fallbacks: 0,
      avgAnalysisTime: 0
    };
  }

  /**
   * Analyze exchange semantics for coding classification
   * @param {Object} exchange - Exchange data to analyze
   * @returns {Object} Semantic analysis result with isCoding flag and confidence
   */
  async analyzeSemantics(exchange) {
    const startTime = Date.now();
    this.stats.totalAnalyses++;
    
    // Return immediately if no semantic analyzer available
    if (!this.semanticAnalyzer) {
      return this.formatResult(false, 0, 'Semantic analysis unavailable (no API key)', startTime);
    }

    try {
      // Create timeout promise to enforce response time limits
      const analysisPromise = this.performClassification(exchange);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Semantic analysis timeout')), this.timeout)
      );
      
      // Race analysis against timeout
      const result = await Promise.race([analysisPromise, timeoutPromise]);
      
      this.stats.successfulAnalyses++;
      this.updateStats(Date.now() - startTime);
      
      return result;
      
    } catch (error) {
      this.handleAnalysisError(error, startTime);
      return this.formatResult(false, 0, `Semantic analysis failed: ${error.message}`, startTime);
    }
  }

  /**
   * Perform the actual classification using SemanticAnalyzer
   * @param {Object} exchange - Exchange to classify
   * @returns {Object} Classification result
   */
  async performClassification(exchange) {
    const startTime = Date.now();
    
    try {
      // Use the dedicated classification method from SemanticAnalyzer
      const classificationResult = await this.semanticAnalyzer.classifyConversationContent(
        exchange, 
        { source: 'ReliableCodingClassifier' }
      );
      
      // Extract and interpret the classification result
      const { classification, confidence, reason } = classificationResult;
      const isCoding = classification === 'CODING_INFRASTRUCTURE';
      const confidenceScore = this.parseConfidenceScore(confidence);
      
      this.log(`Semantic classification: ${classification} (confidence: ${confidence})`);
      
      return this.formatResult(
        isCoding, 
        confidenceScore, 
        `Semantic: ${reason || 'Classification completed'}`,
        startTime
      );
      
    } catch (error) {
      this.log(`Classification error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse confidence score from semantic analysis
   * @param {string} confidence - Confidence level from semantic analysis
   * @returns {number} Numeric confidence score 0-1
   */
  parseConfidenceScore(confidence) {
    if (typeof confidence === 'number') {
      return Math.max(0, Math.min(1, confidence));
    }
    
    if (typeof confidence === 'string') {
      const conf = confidence.toLowerCase();
      switch (conf) {
        case 'high': return 0.9;
        case 'medium': return 0.7;
        case 'low': return 0.5;
        default: return 0.6; // Default for unknown confidence levels
      }
    }
    
    return 0.6; // Default fallback
  }

  /**
   * Handle analysis errors with appropriate logging
   * @param {Error} error - Error that occurred
   * @param {number} startTime - Analysis start time
   */
  handleAnalysisError(error, startTime) {
    const processingTime = Date.now() - startTime;
    
    if (error.message.includes('timeout')) {
      this.stats.timeouts++;
      this.log(`Semantic analysis timeout after ${processingTime}ms`);
    } else if (error.message.includes('API') || error.message.includes('fetch')) {
      this.stats.apiErrors++;
      this.log(`Semantic API error: ${error.message}`);
    } else {
      this.log(`Semantic analysis error: ${error.message}`);
    }
    
    this.stats.fallbacks++;
  }

  /**
   * Get semantic analysis capabilities
   * @returns {Object} Capabilities info
   */
  getCapabilities() {
    return {
      available: !!this.semanticAnalyzer,
      provider: this.semanticAnalyzer?.apiType || 'none',
      model: this.semanticAnalyzer?.model || 'none',
      timeout: this.timeout
    };
  }

  /**
   * Validate semantic analyzer health
   * @returns {Object} Health check result
   */
  async healthCheck() {
    if (!this.semanticAnalyzer) {
      return {
        healthy: false,
        reason: 'No API key configured',
        provider: 'none'
      };
    }

    try {
      // Quick test classification
      const testExchange = {
        userMessage: 'Hello',
        claudeResponse: 'Hi there!'
      };
      
      const startTime = Date.now();
      const result = await this.performClassification(testExchange);
      const responseTime = Date.now() - startTime;
      
      return {
        healthy: true,
        provider: this.semanticAnalyzer.apiType,
        model: this.semanticAnalyzer.model,
        responseTime,
        testResult: result
      };
      
    } catch (error) {
      return {
        healthy: false,
        reason: error.message,
        provider: this.semanticAnalyzer.apiType
      };
    }
  }

  /**
   * Format analysis result consistently
   * @param {boolean} isCoding - Classification result
   * @param {number} confidence - Confidence score 0-1
   * @param {string} reason - Classification reasoning
   * @param {number} startTime - Analysis start time
   * @returns {Object} Formatted result
   */
  formatResult(isCoding, confidence, reason, startTime) {
    const processingTime = Date.now() - startTime;
    
    return {
      isCoding,
      confidence,
      reason,
      processingTimeMs: processingTime,
      layer: 'semantic',
      provider: this.semanticAnalyzer?.apiType || 'none',
      model: this.semanticAnalyzer?.model || 'none'
    };
  }

  /**
   * Update performance statistics
   * @param {number} processingTime - Processing time in ms
   */
  updateStats(processingTime) {
    const count = this.stats.successfulAnalyses;
    this.stats.avgAnalysisTime = ((this.stats.avgAnalysisTime * (count - 1)) + processingTime) / count;
  }

  /**
   * Get analysis statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    const total = this.stats.totalAnalyses;
    return {
      ...this.stats,
      successRate: total > 0 ? ((this.stats.successfulAnalyses / total) * 100).toFixed(2) + '%' : '0%',
      timeoutRate: total > 0 ? ((this.stats.timeouts / total) * 100).toFixed(2) + '%' : '0%',
      errorRate: total > 0 ? ((this.stats.apiErrors / total) * 100).toFixed(2) + '%' : '0%'
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalAnalyses: 0,
      successfulAnalyses: 0,
      timeouts: 0,
      apiErrors: 0,
      fallbacks: 0,
      avgAnalysisTime: 0
    };
  }

  /**
   * Update timeout configuration
   * @param {number} timeout - New timeout in ms
   */
  setTimeout(timeout) {
    this.timeout = Math.max(1000, Math.min(10000, timeout)); // Clamp between 1-10 seconds
    this.log(`Semantic analysis timeout updated to ${this.timeout}ms`);
  }

  /**
   * Debug logging
   * @param {string} message - Log message
   */
  log(message) {
    if (this.debug) {
      console.log(`[SemanticAnalyzerAdapter] ${message}`);
    }
  }
}

export default SemanticAnalyzerAdapter;