/**
 * TrajectoryConceptExtractor
 *
 * Monitors conversation for concept mentions and links them to knowledge base.
 * Distinguishes between learning new concepts vs. applying existing concepts.
 *
 * Key Features:
 * - Concept mention detection: Identify patterns, technologies, architectures in conversation
 * - Knowledge base linking: Semantic search to connect mentions to existing concepts
 * - Learning vs. application: Track whether concepts are being learned or applied
 * - Access tracking: Update concept timestamps for decay tracking
 * - Async processing: Non-blocking extraction to avoid slowing trajectory updates
 * - Concept ambiguity handling: Resolve multiple matches
 * - Trajectory context: Provide concept context for better state classification
 *
 * Concept Types Tracked:
 * - Design patterns (MVC, Repository, Factory, etc.)
 * - Technologies (React, Node.js, PostgreSQL, etc.)
 * - Architectures (microservices, event-driven, REST, etc.)
 * - Practices (TDD, CI/CD, code review, etc.)
 * - Tools (Git, Docker, Kubernetes, etc.)
 *
 * Usage:
 * ```javascript
 * const extractor = new TrajectoryConceptExtractor({
 *   knowledgeStorageService,
 *   knowledgeDecayTracker,
 *   inferenceEngine
 * });
 *
 * await extractor.initialize();
 *
 * // Extract concepts from exchange
 * const concepts = await extractor.extractConcepts(exchange, {
 *   sessionContext
 * });
 *
 * // Get active concepts
 * const active = extractor.getActiveConcepts();
 * ```
 */

import { EventEmitter } from 'events';

// Concept categories
const CONCEPT_CATEGORIES = {
  PATTERN: 'design_pattern',
  TECHNOLOGY: 'technology',
  ARCHITECTURE: 'architecture',
  PRACTICE: 'practice',
  TOOL: 'tool',
  ALGORITHM: 'algorithm',
  PRINCIPLE: 'principle'
};

// Well-known concepts (for fast detection)
const KNOWN_CONCEPTS = {
  patterns: [
    'mvc', 'mvvm', 'repository', 'factory', 'singleton', 'observer',
    'strategy', 'decorator', 'adapter', 'facade', 'proxy', 'command'
  ],
  technologies: [
    'react', 'vue', 'angular', 'node', 'express', 'next',
    'typescript', 'javascript', 'python', 'java', 'go', 'rust',
    'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch'
  ],
  architectures: [
    'microservices', 'monolith', 'serverless', 'event-driven',
    'rest', 'graphql', 'websocket', 'grpc', 'message-queue'
  ],
  practices: [
    'tdd', 'bdd', 'ddd', 'ci/cd', 'code-review', 'pair-programming',
    'agile', 'scrum', 'kanban', 'devops'
  ],
  tools: [
    'git', 'docker', 'kubernetes', 'jenkins', 'github-actions',
    'webpack', 'babel', 'eslint', 'prettier', 'jest'
  ]
};

export class TrajectoryConceptExtractor extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.initialized = false;

    // Required dependencies
    this.knowledgeStorageService = config.knowledgeStorageService;
    this.knowledgeDecayTracker = config.knowledgeDecayTracker;
    this.inferenceEngine = config.inferenceEngine;

    // Optional: EmbeddingGenerator for semantic matching
    this.embeddingGenerator = config.embeddingGenerator;

    if (!this.knowledgeStorageService) {
      throw new Error('TrajectoryConceptExtractor requires knowledgeStorageService');
    }

    // Active concepts tracking
    this.activeConcepts = new Map(); // conceptId -> { name, category, lastMention, count, isLearning }
    this.conceptCache = new Map(); // conceptName -> conceptId (for fast lookup)

    // Processing queue
    this.processingQueue = [];
    this.isProcessing = false;

    // Statistics
    this.stats = {
      conceptsExtracted: 0,
      conceptsLinked: 0,
      newConceptsLearned: 0,
      existingConceptsApplied: 0,
      ambiguousResolutions: 0
    };
  }

  /**
   * Initialize extractor
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[TrajectoryConceptExtractor] Initializing...');

    // Verify dependencies
    if (this.knowledgeStorageService && !this.knowledgeStorageService.initialized) {
      await this.knowledgeStorageService.initialize();
    }

    if (this.knowledgeDecayTracker && !this.knowledgeDecayTracker.initialized) {
      await this.knowledgeDecayTracker.initialize();
    }

    // Pre-load known concepts into cache
    await this.loadKnownConcepts();

    this.initialized = true;
    this.emit('initialized');
    console.log('[TrajectoryConceptExtractor] Initialized');
  }

  /**
   * Extract concepts from exchange
   *
   * @param {object} exchange - User/assistant exchange
   * @param {object} context - Session context
   * @returns {Promise<Array>} Extracted concepts
   */
  async extractConcepts(exchange, context = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();

    try {
      const text = `${exchange.user || ''} ${exchange.assistant || ''}`.toLowerCase();

      // Quick keyword-based extraction
      const quickConcepts = this.extractQuickConcepts(text);

      // If we found concepts, process them
      if (quickConcepts.length > 0) {
        // Queue for async processing (linking to knowledge base)
        this.queueConceptProcessing(quickConcepts, exchange, context);

        // Update active concepts immediately (for trajectory context)
        for (const concept of quickConcepts) {
          this.updateActiveConcept(concept);
        }

        this.stats.conceptsExtracted += quickConcepts.length;
      }

      const latency = Date.now() - startTime;

      this.emit('concepts-extracted', {
        count: quickConcepts.length,
        latency
      });

      return quickConcepts;
    } catch (error) {
      console.error('[TrajectoryConceptExtractor] Extraction failed:', error);
      return [];
    }
  }

  /**
   * Quick concept extraction using keywords
   */
  extractQuickConcepts(text) {
    const concepts = [];
    const seen = new Set();

    // Check each category
    for (const [category, keywords] of Object.entries(KNOWN_CONCEPTS)) {
      for (const keyword of keywords) {
        // Use word boundaries for accurate matching
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (regex.test(text) && !seen.has(keyword)) {
          concepts.push({
            name: keyword,
            category: this.mapCategoryToConcept(category),
            confidence: 0.9, // High confidence for known concepts
            source: 'keyword'
          });
          seen.add(keyword);
        }
      }
    }

    return concepts;
  }

  /**
   * Queue concept processing (async linking to knowledge base)
   */
  queueConceptProcessing(concepts, exchange, context) {
    this.processingQueue.push({ concepts, exchange, context });

    // Start processing if not already running
    if (!this.isProcessing) {
      this.processQueue().catch(error => {
        console.error('[TrajectoryConceptExtractor] Queue processing failed:', error);
      });
    }
  }

  /**
   * Process queued concepts
   */
  async processQueue() {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.processingQueue.length > 0) {
        const { concepts, exchange, context } = this.processingQueue.shift();

        for (const concept of concepts) {
          await this.linkConceptToKnowledgeBase(concept, exchange, context);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Link concept to knowledge base
   */
  async linkConceptToKnowledgeBase(concept, exchange, context) {
    try {
      // Check cache first
      if (this.conceptCache.has(concept.name)) {
        const knowledgeId = this.conceptCache.get(concept.name);

        // Track access for decay
        if (this.knowledgeDecayTracker) {
          await this.knowledgeDecayTracker.trackAccess(knowledgeId);
        }

        this.stats.existingConceptsApplied++;
        return knowledgeId;
      }

      // Search knowledge base
      const results = await this.knowledgeStorageService.searchKnowledge(concept.name, {
        limit: 3,
        minConfidence: 0.6,
        knowledgeTypes: ['coding_pattern', 'abstract_concept', 'architectural_decision']
      });

      if (results.length > 0) {
        // Found existing concept
        const match = results[0];
        this.conceptCache.set(concept.name, match.id);

        // Track access
        if (this.knowledgeDecayTracker) {
          await this.knowledgeDecayTracker.trackAccess(match.id);
        }

        // Determine if learning or applying
        const isLearning = this.determineIfLearning(exchange, concept);

        if (isLearning) {
          this.stats.newConceptsLearned++;
        } else {
          this.stats.existingConceptsApplied++;
        }

        this.stats.conceptsLinked++;

        this.emit('concept-linked', {
          concept: concept.name,
          knowledgeId: match.id,
          isLearning
        });

        return match.id;
      } else {
        // New concept being learned
        this.stats.newConceptsLearned++;
        return null;
      }
    } catch (error) {
      console.error('[TrajectoryConceptExtractor] Concept linking failed:', error);
      return null;
    }
  }

  /**
   * Determine if concept is being learned or applied
   */
  determineIfLearning(exchange, concept) {
    const userText = exchange.user?.toLowerCase() || '';
    const assistantText = exchange.assistant?.toLowerCase() || '';

    // Learning indicators in user message
    const learningKeywords = [
      'what is', 'how do', 'explain', 'teach', 'learn', 'understand',
      'new to', 'never used', 'first time', 'tutorial', 'guide'
    ];

    // Application indicators
    const applicationKeywords = [
      'implement', 'use', 'apply', 'build', 'create', 'make',
      'following', 'according to', 'using'
    ];

    // Check user message for learning indicators
    for (const keyword of learningKeywords) {
      if (userText.includes(keyword)) {
        return true; // Learning
      }
    }

    // Check for application indicators
    for (const keyword of applicationKeywords) {
      if (userText.includes(keyword) || assistantText.includes(keyword)) {
        return false; // Applying
      }
    }

    // Default: assume learning if in user question, applying if in assistant response
    return userText.includes(concept.name);
  }

  /**
   * Update active concepts
   */
  updateActiveConcept(concept) {
    const existing = this.activeConcepts.get(concept.name);

    if (existing) {
      existing.count++;
      existing.lastMention = Date.now();
    } else {
      this.activeConcepts.set(concept.name, {
        name: concept.name,
        category: concept.category,
        lastMention: Date.now(),
        count: 1,
        isLearning: true // Assume learning initially
      });
    }

    // Cleanup old concepts (not mentioned in last 5 minutes)
    this.cleanupInactiveConcepts();
  }

  /**
   * Cleanup inactive concepts
   */
  cleanupInactiveConcepts() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    for (const [name, concept] of this.activeConcepts.entries()) {
      if (now - concept.lastMention > timeout) {
        this.activeConcepts.delete(name);
      }
    }
  }

  /**
   * Get active concepts (for trajectory context)
   */
  getActiveConcepts() {
    return Array.from(this.activeConcepts.values())
      .sort((a, b) => b.count - a.count) // Most mentioned first
      .slice(0, 5); // Top 5
  }

  /**
   * Get concept summary for trajectory
   */
  getConceptSummary() {
    const active = this.getActiveConcepts();

    return {
      activeConcepts: active.map(c => c.name),
      learning: active.filter(c => c.isLearning).map(c => c.name),
      applying: active.filter(c => !c.isLearning).map(c => c.name),
      totalTracked: this.activeConcepts.size
    };
  }

  /**
   * Load known concepts into cache
   */
  async loadKnownConcepts() {
    try {
      // Pre-populate cache with common concepts
      console.log('[TrajectoryConceptExtractor] Loading known concepts into cache...');

      // This would ideally query the knowledge base for all known concepts
      // For now, we'll populate the cache lazily as concepts are encountered

      console.log('[TrajectoryConceptExtractor] Known concepts cache initialized');
    } catch (error) {
      console.error('[TrajectoryConceptExtractor] Failed to load known concepts:', error);
    }
  }

  /**
   * Map category string to concept category
   */
  mapCategoryToConcept(category) {
    const mapping = {
      patterns: CONCEPT_CATEGORIES.PATTERN,
      technologies: CONCEPT_CATEGORIES.TECHNOLOGY,
      architectures: CONCEPT_CATEGORIES.ARCHITECTURE,
      practices: CONCEPT_CATEGORIES.PRACTICE,
      tools: CONCEPT_CATEGORIES.TOOL
    };

    return mapping[category] || CONCEPT_CATEGORIES.PRINCIPLE;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeConcepts: this.activeConcepts.size,
      cachedConcepts: this.conceptCache.size,
      queueSize: this.processingQueue.length
    };
  }

  /**
   * Clear statistics
   */
  clearStats() {
    this.stats = {
      conceptsExtracted: 0,
      conceptsLinked: 0,
      newConceptsLearned: 0,
      existingConceptsApplied: 0,
      ambiguousResolutions: 0
    };
  }

  /**
   * Reset active concepts
   */
  resetActiveConcepts() {
    this.activeConcepts.clear();
  }
}

export default TrajectoryConceptExtractor;
export { CONCEPT_CATEGORIES, KNOWN_CONCEPTS };
