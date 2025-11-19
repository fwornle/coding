/**
 * KeywordMatcher - Layer 3 of Reliable Coding Classifier
 * 
 * Fast keyword-based fallback classification system.
 * Ensures obvious coding discussions are never missed through fast keyword detection.
 * 
 * Features:
 * - Sub-1ms matching performance
 * - Curated keyword lists with weighted scoring
 * - High precision with minimal false positives
 * - Comprehensive fallback when semantic analysis fails
 * - Exclusion patterns to avoid misclassification
 * - Multi-category keyword matching (primary, secondary, technical, etc.)
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class KeywordMatcher {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.keywordsPath = options.keywordsPath || path.join(__dirname, '../../scripts/coding-keywords.json');
    
    // Load keyword configuration
    this.keywordConfig = this.loadKeywords();
    this.rules = this.keywordConfig.classification_rules || this.getDefaultRules();
    
    // Pre-compile patterns for fast matching
    this.compiledPatterns = this.compilePatterns();
    
    // Statistics tracking
    this.stats = {
      totalMatches: 0,
      keywordHits: 0,
      exclusionHits: 0,
      avgMatchingTime: 0,
      patternStats: {}
    };
    
    this.log(`KeywordMatcher initialized with ${this.getTotalKeywordCount()} keywords`);
  }

  /**
   * Fast keyword matching for exchange classification
   * @param {Object} exchange - Exchange to analyze
   * @returns {Object} Keyword matching result with isCoding flag and scoring details
   */
  async matchKeywords(exchange) {
    const startTime = performance.now();
    this.stats.totalMatches++;
    
    // DEBUG: Check for our target exchange
    const isTargetExchange = exchange.timestamp && exchange.timestamp.includes('2025-09-14T11:15');
    if (isTargetExchange) {
      console.log(`🎯 DEBUG: KeywordMatcher.matchKeywords for target exchange!`);
      console.log(`   Exchange structure:`, Object.keys(exchange));
      console.log(`   Timestamp: ${exchange.timestamp}`);
    }
    
    try {
      // Build context for matching
      const context = this.buildContext(exchange);
      const contextLower = context.toLowerCase();
      
      if (isTargetExchange) {
        console.log(`🎯 DEBUG: Context built for target (${context.length} chars)`);
        console.log(`   Context preview: ${context.substring(0, 500)}...`);
        console.log(`   Contains LSL: ${contextLower.includes('lsl')}`);
        console.log(`   Contains live session logging: ${contextLower.includes('live session logging')}`);
        console.log(`   Contains batch mode: ${contextLower.includes('batch mode')}`);
      }
      
      // Initialize scoring
      let totalScore = 0;
      const matchResults = {
        primary: [],
        secondary: [],
        filePatterns: [],
        pathPatterns: [],
        mcpPatterns: [],
        systemConcepts: [],
        technicalTerms: [],
        exclusions: []
      };
      
      // Check each keyword category
      totalScore += this.matchKeywordCategory('primary', contextLower, matchResults);
      totalScore += this.matchKeywordCategory('secondary', contextLower, matchResults);
      totalScore += this.matchKeywordCategory('file_patterns', contextLower, matchResults);
      totalScore += this.matchKeywordCategory('path_patterns', contextLower, matchResults);
      totalScore += this.matchKeywordCategory('mcp_patterns', contextLower, matchResults);
      totalScore += this.matchKeywordCategory('system_concepts', contextLower, matchResults);
      totalScore += this.matchKeywordCategory('technical_terms', contextLower, matchResults);
      
      if (isTargetExchange) {
        console.log(`🎯 DEBUG: Keyword matching results for target:`);
        console.log(`   Primary matches: ${matchResults.primary.length}`);
        console.log(`   Secondary matches: ${matchResults.secondary.length}`);
        console.log(`   Total score: ${totalScore}`);
        console.log(`   Minimum score required: ${this.rules.minimum_score}`);
      }
      
      // Apply exclusion penalties
      const exclusionPenalty = this.checkExclusions(contextLower, matchResults);
      totalScore += exclusionPenalty;
      
      // Determine classification
      const isCoding = totalScore >= this.rules.minimum_score;
      const confidence = this.calculateConfidence(totalScore, isCoding);
      
      if (isTargetExchange) {
        console.log(`🎯 DEBUG: Final classification for target:`);
        console.log(`   isCoding: ${isCoding}`);
        console.log(`   confidence: ${confidence}`);
        console.log(`   totalScore: ${totalScore} (after exclusions: ${exclusionPenalty})`);
      }
      
      // Update statistics
      this.updateStats(performance.now() - startTime, matchResults);
      
      return this.formatResult(isCoding, confidence, totalScore, matchResults, startTime);
      
    } catch (error) {
      this.log(`Keyword matching error: ${error.message}`);
      return this.formatResult(false, 0, 0, {}, startTime);
    }
  }

  /**
   * Match keywords in a specific category
   * @param {string} category - Category name
   * @param {string} context - Lowercase context to search
   * @param {Object} matchResults - Results object to populate
   * @returns {number} Total score for this category
   */
  matchKeywordCategory(category, context, matchResults) {
    const keywords = this.keywordConfig.keywords[category] || [];
    const weight = this.rules[`${category}_weight`] || 1;
    let categoryScore = 0;
    
    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      if (context.includes(keywordLower)) {
        const score = weight;
        categoryScore += score;
        matchResults[this.getCategoryKey(category)].push({
          keyword,
          score,
          weight
        });
        this.stats.keywordHits++;
      }
    }
    return categoryScore;
  }

  /**
   * Check for exclusion patterns
   * @param {string} context - Lowercase context to search
   * @param {Object} matchResults - Results object to populate
   * @returns {number} Exclusion penalty score
   */
  checkExclusions(context, matchResults) {
    const exclusions = this.keywordConfig.exclusion_patterns || [];
    let penalty = 0;
    
    for (const exclusion of exclusions) {
      const exclusionLower = exclusion.toLowerCase();
      if (context.includes(exclusionLower)) {
        penalty += this.rules.exclusion_penalty || -5;
        matchResults.exclusions.push({
          pattern: exclusion,
          penalty: this.rules.exclusion_penalty || -5
        });
        this.stats.exclusionHits++;
      }
    }
    
    return penalty;
  }

  /**
   * Build context from exchange for keyword matching
   * @param {Object} exchange - Exchange data
   * @returns {string} Combined context text
   */
  buildContext(exchange) {
    const parts = [];
    
    // DEBUG: Check for our target exchange
    const isTargetExchange = exchange.timestamp && exchange.timestamp.includes('2025-09-14T11:15');
    if (isTargetExchange) {
      console.log(`🎯 DEBUG: KeywordMatcher.buildContext for target exchange!`);
      console.log(`   Exchange keys: ${Object.keys(exchange)}`);
      console.log(`   userMessage: ${exchange.userMessage ? 'EXISTS' : 'MISSING'}`);
      console.log(`   humanMessage: ${exchange.humanMessage ? 'EXISTS' : 'MISSING'}`);
      console.log(`   message: ${exchange.message ? 'EXISTS' : 'MISSING'}`);
      console.log(`   content: ${exchange.content ? 'EXISTS' : 'MISSING'}`);
      if (exchange.userMessage) {
        console.log(`   userMessage preview: ${exchange.userMessage.substring(0, 200)}...`);
      }
      if (exchange.humanMessage) {
        console.log(`   humanMessage preview: ${exchange.humanMessage.substring(0, 200)}...`);
      }
    }
    
    // User message content
    if (exchange.userMessage) {
      parts.push(exchange.userMessage);
    }
    
    // FALLBACK: Try humanMessage if userMessage doesn't exist
    if (!exchange.userMessage && exchange.humanMessage) {
      if (isTargetExchange) {
        console.log(`🎯 DEBUG: Using humanMessage as fallback for target exchange`);
      }
      parts.push(exchange.humanMessage);
    }
    
    // FALLBACK: Try message field if neither userMessage nor humanMessage exist
    if (!exchange.userMessage && !exchange.humanMessage && exchange.message) {
      if (isTargetExchange) {
        console.log(`🎯 DEBUG: Using message field as fallback for target exchange`);
      }
      if (typeof exchange.message === 'string') {
        parts.push(exchange.message);
      } else if (exchange.message.content) {
        parts.push(exchange.message.content);
      }
    }
    
    // Assistant response content (limited to avoid too much noise)
    if (exchange.assistantResponse?.content) {
      parts.push(exchange.assistantResponse.content.substring(0, 1000));
    } else if (exchange.claudeResponse) {
      parts.push(exchange.claudeResponse.substring(0, 1000));
    }
    
    // Tool call names and key parameters
    if (exchange.assistantResponse?.toolCalls) {
      for (const tool of exchange.assistantResponse.toolCalls) {
        parts.push(tool.name);
        // Include key file paths and parameters
        if (tool.parameters) {
          this.extractKeyParameters(tool.parameters, parts);
        }
      }
    } else if (exchange.toolCalls) {
      for (const tool of exchange.toolCalls) {
        parts.push(tool.name);
        if (tool.input || tool.parameters) {
          this.extractKeyParameters(tool.input || tool.parameters, parts);
        }
      }
    }
    
    // File operations if present
    if (exchange.fileOperations) {
      parts.push(...exchange.fileOperations);
    }
    
    const context = parts.join(' ');
    if (isTargetExchange) {
      console.log(`🎯 DEBUG: Built context for target exchange (${context.length} chars)`);
      console.log(`   Context preview: ${context.substring(0, 300)}...`);
      console.log(`   Contains "LSL": ${context.includes('LSL')}`);
      console.log(`   Contains "Live Session Logging": ${context.includes('Live Session Logging')}`);
      console.log(`   Contains "batch mode": ${context.includes('batch mode')}`);
    }
    
    return context;
  }

  /**
   * Extract key parameters from tool calls
   * @param {Object} params - Tool parameters
   * @param {Array} parts - Parts array to append to
   */
  extractKeyParameters(params, parts) {
    const keyFields = [
      'file_path', 'path', 'directory', 'command', 'pattern', 
      'url', 'query', 'content', 'description', 'todos'
    ];
    
    for (const field of keyFields) {
      if (params[field]) {
        if (typeof params[field] === 'string') {
          parts.push(params[field]);
        } else if (Array.isArray(params[field]) || typeof params[field] === 'object') {
          // Handle complex fields like todos arrays by converting to searchable text
          const text = JSON.stringify(params[field]);
          parts.push(text);
        }
      }
    }
  }

  /**
   * Calculate confidence score based on total score
   * @param {number} totalScore - Total matching score
   * @param {boolean} isCoding - Classification result
   * @returns {number} Confidence score 0-1
   */
  calculateConfidence(totalScore, isCoding) {
    if (!isCoding) {
      return 0.1; // Low confidence for non-coding
    }
    
    // Scale confidence based on score above minimum
    const excess = totalScore - this.rules.minimum_score;
    const maxExcess = 20; // Assume max reasonable excess
    
    return Math.min(0.85, 0.5 + (excess / maxExcess) * 0.35);
  }

  /**
   * Load keywords from configuration file
   * @returns {Object} Keyword configuration
   */
  loadKeywords() {
    try {
      if (fs.existsSync(this.keywordsPath)) {
        const content = fs.readFileSync(this.keywordsPath, 'utf8');
        const config = JSON.parse(content);
        this.log(`Loaded keywords from ${this.keywordsPath}`);
        return config;
      } else {
        this.log(`Keywords file not found at ${this.keywordsPath}, using defaults`);
        return this.getDefaultKeywords();
      }
    } catch (error) {
      this.log(`Error loading keywords: ${error.message}, using defaults`);
      return this.getDefaultKeywords();
    }
  }

  /**
   * Get default keyword configuration if file is not available
   * @returns {Object} Default keyword config
   */
  getDefaultKeywords() {
    return {
      keywords: {
        primary: [
          'ukb', 'vkb', 'semantic-analysis', 'claude-mcp',
          'transcript-monitor', 'coding-classifier', 'session-logger',
          'knowledge-management', 'enhanced-transcript-monitor'
        ],
        secondary: [
          'coding infrastructure', 'mcp server', 'tool development',
          'agent system', 'workflow orchestration', 'semantic analysis'
        ],
        file_patterns: [
          'enhanced-transcript-monitor', 'post-session-logger',
          'semantic-analysis', 'coding-keywords'
        ],
        path_patterns: [
          '/coding/', 'scripts/', 'knowledge-management/', '.specstory/'
        ],
        mcp_patterns: [
          'mcp__semantic-analysis', 'create_entities',
          'search_nodes', 'determine_insights'
        ],
        system_concepts: [
          'knowledge graph', 'semantic analysis', 'MCP integration'
        ],
        technical_terms: [
          'JSON-RPC', 'embedding models', 'classification system'
        ]
      },
      exclusion_patterns: [
        'timeline visualization', 'Three.js', 'Kotlin Compose'
      ],
      classification_rules: this.getDefaultRules()
    };
  }

  /**
   * Get default classification rules
   * @returns {Object} Default rules
   */
  getDefaultRules() {
    return {
      minimum_score: 4,
      primary_weight: 3,
      secondary_weight: 1,
      file_patterns_weight: 2,
      path_patterns_weight: 2,
      mcp_patterns_weight: 3,
      system_concepts_weight: 2,
      technical_terms_weight: 1,
      exclusion_penalty: -5,
      processing_timeout_ms: 1
    };
  }

  /**
   * Compile patterns for optimized matching (future optimization)
   * @returns {Object} Compiled patterns
   */
  compilePatterns() {
    // For now, just return empty - this is a placeholder for future regex compilation
    return {};
  }

  /**
   * Get category key for match results
   * @param {string} category - Category name
   * @returns {string} Results key
   */
  getCategoryKey(category) {
    const mapping = {
      'primary': 'primary',
      'secondary': 'secondary', 
      'file_patterns': 'filePatterns',
      'path_patterns': 'pathPatterns',
      'mcp_patterns': 'mcpPatterns',
      'system_concepts': 'systemConcepts',
      'technical_terms': 'technicalTerms'
    };
    return mapping[category] || category;
  }

  /**
   * Count total keywords across all categories
   * @returns {number} Total keyword count
   */
  getTotalKeywordCount() {
    const keywords = this.keywordConfig.keywords;
    return Object.values(keywords).reduce((total, arr) => total + arr.length, 0);
  }

  /**
   * Format keyword matching result
   * @param {boolean} isCoding - Classification result
   * @param {number} confidence - Confidence score
   * @param {number} totalScore - Total matching score
   * @param {Object} matchResults - Detailed match results
   * @param {number} startTime - Processing start time
   * @returns {Object} Formatted result
   */
  formatResult(isCoding, confidence, totalScore, matchResults, startTime) {
    const processingTime = performance.now() - startTime;
    const totalMatches = Object.values(matchResults).reduce(
      (sum, arr) => sum + (arr.length || 0), 0
    );
    
    return {
      isCoding,
      confidence,
      reason: `Keyword analysis: ${totalMatches} matches, score: ${totalScore}/${this.rules.minimum_score}`,
      processingTimeMs: Math.round(processingTime * 100) / 100, // Round to 2 decimal places
      layer: 'keyword',
      details: {
        totalScore,
        threshold: this.rules.minimum_score,
        matchResults,
        totalMatches,
        processingTimeMs: Math.round(processingTime * 100) / 100
      }
    };
  }

  /**
   * Update performance statistics
   * @param {number} processingTime - Processing time in ms
   * @param {Object} matchResults - Match results for stats
   */
  updateStats(processingTime, matchResults) {
    const count = this.stats.totalMatches;
    this.stats.avgMatchingTime = ((this.stats.avgMatchingTime * (count - 1)) + processingTime) / count;
    
    // Update pattern stats
    for (const [category, matches] of Object.entries(matchResults)) {
      if (!this.stats.patternStats[category]) {
        this.stats.patternStats[category] = 0;
      }
      this.stats.patternStats[category] += matches.length || 0;
    }
  }

  /**
   * Get keyword matching statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      totalKeywords: this.getTotalKeywordCount(),
      hitRate: this.stats.totalMatches > 0 
        ? ((this.stats.keywordHits / this.stats.totalMatches) * 100).toFixed(2) + '%'
        : '0%',
      exclusionRate: this.stats.totalMatches > 0
        ? ((this.stats.exclusionHits / this.stats.totalMatches) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalMatches: 0,
      keywordHits: 0,
      exclusionHits: 0,
      avgMatchingTime: 0,
      patternStats: {}
    };
  }

  /**
   * Reload keywords from file (for testing or updates)
   */
  reloadKeywords() {
    this.keywordConfig = this.loadKeywords();
    this.rules = this.keywordConfig.classification_rules || this.getDefaultRules();
    this.log('Keywords reloaded');
  }

  /**
   * Debug logging
   * @param {string} message - Log message
   */
  log(message) {
    if (this.debug) {
      console.log(`[KeywordMatcher] ${message}`);
    }
  }
}

export default KeywordMatcher;