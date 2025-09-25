#!/usr/bin/env node

/**
 * Unified Reliable Classifier
 * 
 * Consolidates functionality from:
 * - exchange-classifier.js (keyword-based classification)
 * - llm-content-classifier.js (LLM-based classification)  
 * - adaptive-embedding-classifier.cjs (embedding-based classification)
 * 
 * Features:
 * - 3-layer classification system (Path → Keyword → Semantic)
 * - Robust retry logic and error handling
 * - Confidence scoring and threshold management
 * - Consistent API across all classification modes
 * - Optimized for both live and batch processing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Path-based classifier - Fast first layer
 * Analyzes file operations to determine if they target coding repository
 */
class PathAnalyzer {
  constructor(codingRepo = '/Users/q284340/Agentic/coding') {
    this.codingRepo = codingRepo;
  }

  analyze(fileOperations = []) {
    if (!Array.isArray(fileOperations) || fileOperations.length === 0) {
      return {
        isCoding: false,
        confidence: 0.02,
        reason: 'No file operations detected',
        details: { totalOperations: 0, codingOperations: [] }
      };
    }

    const codingOperations = fileOperations.filter(op => 
      typeof op === 'string' && op.includes(this.codingRepo)
    );

    const isCoding = codingOperations.length > 0;
    const confidence = isCoding ? Math.min(0.9, codingOperations.length / fileOperations.length) : 0.02;

    return {
      isCoding,
      confidence,
      reason: isCoding 
        ? `${codingOperations.length}/${fileOperations.length} operations target coding repository`
        : 'No operations target coding repository',
      details: {
        totalOperations: fileOperations.length,
        codingOperations,
        nonCodingOperations: fileOperations.filter(op => !codingOperations.includes(op))
      }
    };
  }
}

/**
 * Keyword-based classifier - Fast second layer
 * Uses pattern matching to identify coding-related content
 */
class KeywordMatcher {
  constructor() {
    this.loadKeywords();
  }

  loadKeywords() {
    try {
      const keywordsPath = path.join(__dirname, 'coding-keywords.json');
      const keywordsData = fs.readFileSync(keywordsPath, 'utf8');
      const parsed = JSON.parse(keywordsData);
      // Extract keywords object from nested structure
      this.keywords = parsed.keywords || parsed;
    } catch (error) {
      console.warn('Could not load coding keywords, using defaults:', error.message);
      this.keywords = this.getDefaultKeywords();
    }
  }

  getDefaultKeywords() {
    return {
      primary: [
        { keyword: 'semantic analysis', weight: 3 },
        { keyword: 'MCP', weight: 3 },
        { keyword: 'coding infrastructure', weight: 3 },
        { keyword: 'LSL', weight: 3 },
        { keyword: 'Live Session Logging', weight: 3 },
        { keyword: 'transcript monitor', weight: 3 },
        { keyword: 'ukb', weight: 3 },
        { keyword: 'vkb', weight: 3 },
        { keyword: 'mcp__memory', weight: 3 }
      ],
      secondary: [
        { keyword: 'MCP server', weight: 2 },
        { keyword: 'batch processor', weight: 2 },
        { keyword: 'reliable classifier', weight: 2 }
      ],
      filePatterns: [
        { keyword: 'batch-lsl-processor', weight: 2 },
        { keyword: 'reliable-classifier', weight: 2 },
        { keyword: 'enhanced-transcript-monitor', weight: 2 },
        { keyword: 'claude-mcp', weight: 2 }
      ],
      pathPatterns: [
        { keyword: '/Agentic/coding/', weight: 2 },
        { keyword: 'scripts/batch-lsl', weight: 2 },
        { keyword: 'knowledge-management/', weight: 2 }
      ]
    };
  }

  analyze(content) {
    if (!content || typeof content !== 'string') {
      return {
        isCoding: false,
        confidence: 0.1,
        reason: 'No content to analyze',
        details: { totalScore: 0, matches: [] }
      };
    }

    const contentLower = content.toLowerCase();
    let totalScore = 0;
    const matches = [];
    const threshold = 4;

    // Primary keywords (high weight)
    if (this.keywords.primary) {
      for (const item of this.keywords.primary) {
        const keyword = typeof item === 'string' ? item : item.keyword;
        const weight = typeof item === 'string' ? 3 : item.weight;
        if (contentLower.includes(keyword.toLowerCase())) {
          totalScore += weight;
          matches.push({ keyword, weight, type: 'primary' });
        }
      }
    }

    // Secondary keywords
    if (this.keywords.secondary) {
      for (const item of this.keywords.secondary) {
        const keyword = typeof item === 'string' ? item : item.keyword;
        const weight = typeof item === 'string' ? 2 : item.weight;
        if (contentLower.includes(keyword.toLowerCase())) {
          totalScore += weight;
          matches.push({ keyword, weight, type: 'secondary' });
        }
      }
    }

    // File patterns
    const filePatterns = this.keywords.filePatterns || this.keywords.file_patterns || [];
    for (const item of filePatterns) {
      const keyword = typeof item === 'string' ? item : item.keyword;
      const weight = typeof item === 'string' ? 1 : item.weight;
      if (contentLower.includes(keyword.toLowerCase())) {
        totalScore += weight;
        matches.push({ keyword, weight, type: 'file' });
      }
    }

    // Path patterns
    const pathPatterns = this.keywords.pathPatterns || this.keywords.path_patterns || [];
    for (const item of pathPatterns) {
      const keyword = typeof item === 'string' ? item : item.keyword;
      const weight = typeof item === 'string' ? 1 : item.weight;
      if (contentLower.includes(keyword.toLowerCase())) {
        totalScore += weight;
        matches.push({ keyword, weight, type: 'path' });
      }
    }

    const isCoding = totalScore >= threshold;
    const confidence = Math.min(0.95, totalScore / (threshold * 2));

    return {
      isCoding,
      confidence,
      reason: `Keyword analysis: ${matches.length} matches, score: ${totalScore}/${threshold}`,
      details: {
        totalScore,
        threshold,
        matches,
        totalMatches: matches.length
      }
    };
  }
}

/**
 * Semantic classifier - LLM-based deep analysis
 * Used when path and keyword analysis are inconclusive
 */
class SemanticAnalyzer {
  constructor(options = {}) {
    this.provider = options.provider || 'xai';
    this.model = options.model || 'grok-2-1212';
    this.timeout = options.timeout || 10000;
    this.maxTokens = options.maxTokens || 200;
  }

  async analyze(content, context = {}) {
    if (!content) {
      return {
        isCoding: false,
        confidence: 0.7,
        reason: 'Semantic: No content to analyze',
        provider: this.provider
      };
    }

    try {
      // For now, implement a rule-based semantic analyzer
      // TODO: Integrate with actual LLM providers when available
      return await this.ruleBasedSemanticAnalysis(content, context);
    } catch (error) {
      console.warn('Semantic analysis failed:', error.message);
      return {
        isCoding: false,
        confidence: 0.5,
        reason: `Semantic: Analysis failed - ${error.message}`,
        provider: this.provider
      };
    }
  }

  async ruleBasedSemanticAnalysis(content, context) {
    const contentLower = content.toLowerCase();
    let codingScore = 0;
    let totalChecks = 0;

    // Technical context indicators
    const technicalIndicators = [
      'function', 'class', 'import', 'export', 'console.log', 'async', 'await',
      'git', 'commit', 'branch', 'merge', 'pull request', 'repository',
      'api', 'endpoint', 'database', 'query', 'server', 'client',
      'test', 'debug', 'error', 'exception', 'stack trace',
      'npm', 'node', 'javascript', 'typescript', 'python', 'java'
    ];

    for (const indicator of technicalIndicators) {
      totalChecks++;
      if (contentLower.includes(indicator)) {
        codingScore++;
      }
    }

    // LSL-specific indicators
    const lslIndicators = [
      'session', 'transcript', 'logging', 'monitor', 'classifier',
      'mcp', 'semantic analysis', 'conversation', 'exchange'
    ];

    for (const indicator of lslIndicators) {
      totalChecks++;
      if (contentLower.includes(indicator)) {
        codingScore += 2; // Higher weight for LSL-specific terms
      }
    }

    // Coding project structure indicators
    const structureIndicators = [
      '.js', '.ts', '.py', '.json', '.md', '.sh',
      'scripts/', 'src/', 'lib/', 'config/', 'docs/',
      'package.json', 'node_modules', '.env'
    ];

    for (const indicator of structureIndicators) {
      totalChecks++;
      if (contentLower.includes(indicator)) {
        codingScore++;
      }
    }

    const confidence = totalChecks > 0 ? Math.min(0.95, codingScore / totalChecks) : 0.5;
    const isCoding = confidence > 0.6;

    return {
      isCoding,
      confidence,
      reason: `Semantic: ${codingScore}/${totalChecks} indicators (${Math.round(confidence * 100)}% confidence)`,
      provider: 'rule-based',
      details: {
        codingScore,
        totalChecks,
        confidence
      }
    };
  }
}

/**
 * Unified Reliable Classifier
 * Orchestrates the 3-layer classification system
 */
class ReliableClassifier {
  constructor(options = {}) {
    this.codingRepo = options.codingRepo || '/Users/q284340/Agentic/coding';
    this.confidenceThreshold = options.confidenceThreshold || 0.7;
    this.retryAttempts = options.retryAttempts || 3;
    
    // Initialize analyzers
    this.pathAnalyzer = new PathAnalyzer(this.codingRepo);
    this.keywordMatcher = new KeywordMatcher();
    this.semanticAnalyzer = new SemanticAnalyzer(options.semantic || {});
    
    // Performance tracking
    this.stats = {
      total: 0,
      pathDecisions: 0,
      keywordDecisions: 0,
      semanticDecisions: 0,
      errors: 0
    };
  }

  /**
   * Main classification method
   * Uses 3-layer approach: Path → Keyword → Semantic
   */
  async classify(input, options = {}) {
    this.stats.total++;
    const startTime = Date.now();
    
    // Allow temporary threshold override
    const originalThreshold = this.confidenceThreshold;
    if (options.threshold !== undefined) {
      this.confidenceThreshold = options.threshold / 10; // Convert 4 -> 0.4, 2 -> 0.2
    }
    
    try {
      const context = this.extractContext(input);
      const decisionPath = [];

      // Layer 1: Path Analysis (fastest)
      const pathResult = this.pathAnalyzer.analyze(context.fileOperations);
      decisionPath.push({
        layer: 'path',
        input: { fileOperations: context.fileOperations },
        output: pathResult,
        duration: Date.now() - startTime
      });

      // Quick decision if path analysis is confident
      if (pathResult.confidence > 0.8) {
        this.stats.pathDecisions++;
        this.confidenceThreshold = originalThreshold; // Restore before return
        return this.buildResult(pathResult, decisionPath, 'path', Date.now() - startTime);
      }

      // Layer 2: Keyword Analysis (fast)
      const keywordStart = Date.now();
      const keywordResult = this.keywordMatcher.analyze(context.content);
      decisionPath.push({
        layer: 'keyword',
        input: { content: context.content },
        output: keywordResult,
        duration: Date.now() - keywordStart
      });

      // Decision if keyword analysis is confident
      if (keywordResult.confidence > this.confidenceThreshold) {
        this.stats.keywordDecisions++;
        this.confidenceThreshold = originalThreshold; // Restore before return
        return this.buildResult(keywordResult, decisionPath, 'keyword', Date.now() - startTime);
      }

      // Layer 3: Semantic Analysis (slower, more accurate)
      const semanticStart = Date.now();
      const semanticResult = await this.semanticAnalyzer.analyze(context.content, context);
      decisionPath.push({
        layer: 'semantic',
        input: { content: context.content, context },
        output: semanticResult,
        duration: Date.now() - semanticStart
      });

      this.stats.semanticDecisions++;
      return this.buildResult(semanticResult, decisionPath, 'semantic', Date.now() - startTime);

    } catch (error) {
      this.stats.errors++;
      console.error('Classification failed:', error.message);
      
      return {
        classification: 'ERROR',
        isCoding: false,
        confidence: 0.0,
        reason: `Classification error: ${error.message}`,
        layer: 'error',
        processingTimeMs: Date.now() - startTime,
        decisionPath: []
      };
    } finally {
      // Restore original threshold
      this.confidenceThreshold = originalThreshold;
    }
  }

  /**
   * Extract context from various input formats
   */
  extractContext(input) {
    const context = {
      content: '',
      fileOperations: [],
      exchanges: [],
      metadata: {}
    };

    if (typeof input === 'string') {
      context.content = input;
    } else if (input && typeof input === 'object') {
      // Handle conversation format
      if (input.exchanges && Array.isArray(input.exchanges)) {
        context.exchanges = input.exchanges;
        context.content = input.exchanges.map(ex => 
          [ex.userMessage, ex.assistantMessage].filter(Boolean).join(' ')
        ).join(' ');
      }

      // Handle tool interactions
      if (input.toolCalls) {
        const toolContent = input.toolCalls.map(tool => 
          `${tool.name} ${JSON.stringify(tool.input)} ${tool.result || ''}`
        ).join(' ');
        context.content += ' ' + toolContent;
      }

      // Extract file operations
      if (input.fileOperations) {
        context.fileOperations = Array.isArray(input.fileOperations) 
          ? input.fileOperations 
          : [input.fileOperations];
      }

      // Handle raw conversation data
      if (input.userMessage) {
        context.content += ' ' + input.userMessage;
      }
      if (input.assistantMessage) {
        context.content += ' ' + input.assistantMessage;
      }
    }

    return context;
  }

  /**
   * Build standardized result object
   */
  buildResult(layerResult, decisionPath, finalLayer, totalTime) {
    const classification = layerResult.isCoding ? 'CODING_INFRASTRUCTURE' : 'NOT_CODING_INFRASTRUCTURE';
    
    return {
      classification,
      isCoding: layerResult.isCoding,
      confidence: layerResult.confidence,
      reason: layerResult.reason,
      layer: finalLayer,
      processingTimeMs: totalTime,
      decisionPath,
      stats: { ...this.stats }
    };
  }

  /**
   * Batch classification with retry logic
   */
  async classifyBatch(inputs, options = {}) {
    const results = [];
    const batchOptions = { ...options, batch: true };
    
    for (const input of inputs) {
      let result = null;
      let lastError = null;
      
      // Retry logic
      for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
        try {
          result = await this.classify(input, batchOptions);
          break;
        } catch (error) {
          lastError = error;
          if (attempt < this.retryAttempts) {
            await this.delay(1000 * attempt); // Exponential backoff
          }
        }
      }
      
      if (result) {
        results.push(result);
      } else {
        results.push({
          classification: 'ERROR',
          isCoding: false,
          confidence: 0.0,
          reason: `Batch classification failed: ${lastError?.message}`,
          error: lastError
        });
      }
    }
    
    return results;
  }

  /**
   * Get classification statistics
   */
  getStats() {
    return {
      ...this.stats,
      pathDecisionRate: this.stats.total > 0 ? this.stats.pathDecisions / this.stats.total : 0,
      keywordDecisionRate: this.stats.total > 0 ? this.stats.keywordDecisions / this.stats.total : 0,
      semanticDecisionRate: this.stats.total > 0 ? this.stats.semanticDecisions / this.stats.total : 0,
      errorRate: this.stats.total > 0 ? this.stats.errors / this.stats.total : 0
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      total: 0,
      pathDecisions: 0,
      keywordDecisions: 0,
      semanticDecisions: 0,
      errors: 0
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Factory function for getting classifier instance
export function getReliableClassifier(options = {}) {
  return new ReliableClassifier(options);
}

// Export classes for testing
export {
  ReliableClassifier,
  PathAnalyzer,
  KeywordMatcher,
  SemanticAnalyzer
};

// Default export
export default ReliableClassifier;