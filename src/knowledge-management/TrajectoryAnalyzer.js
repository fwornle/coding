/**
 * TrajectoryAnalyzer
 *
 * Enhanced trajectory analysis with intent classification and knowledge integration.
 * Extends RealTimeTrajectoryAnalyzer functionality by adding:
 * - Intent classification (learning, debugging, feature-dev, refactoring, testing)
 * - Session goal extraction from conversation context
 * - Active concept identification (concepts being used/learned)
 * - Knowledge pattern matching (link trajectory to existing knowledge)
 * - Integration with UnifiedInferenceEngine for shared LLM access
 *
 * Key Features:
 * - Intent classification with confidence scoring
 * - Session goal tracking and evolution
 * - Concept usage tracking (which knowledge is being applied)
 * - Trajectory-to-knowledge linking
 * - Real-time vs batch analysis modes
 * - Database persistence for trajectory analytics
 *
 * Intent Types:
 * - learning: Exploring new concepts, technologies, or patterns
 * - debugging: Investigating and fixing bugs
 * - feature-dev: Implementing new features or functionality
 * - refactoring: Improving code structure or organization
 * - testing: Writing or fixing tests
 * - optimization: Improving performance or efficiency
 * - documentation: Writing or updating docs
 * - exploration: Investigating codebase or dependencies
 *
 * Usage:
 * ```javascript
 * const analyzer = new TrajectoryAnalyzer({
 *   databaseManager,
 *   inferenceEngine,
 *   embeddingGenerator
 * });
 *
 * await analyzer.initialize();
 *
 * // Analyze exchange for intent and concepts
 * const analysis = await analyzer.analyzeExchange(exchange, context);
 * // { intent, confidence, sessionGoal, activeConcepts, suggestedKnowledge }
 *
 * // Get trajectory summary for session
 * const summary = await analyzer.getSessionTrajectory(sessionId);
 * ```
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

// Intent types
const INTENT_TYPES = {
  LEARNING: 'learning',
  DEBUGGING: 'debugging',
  FEATURE_DEV: 'feature-dev',
  REFACTORING: 'refactoring',
  TESTING: 'testing',
  OPTIMIZATION: 'optimization',
  DOCUMENTATION: 'documentation',
  EXPLORATION: 'exploration'
};

// Trajectory states (from RealTimeTrajectoryAnalyzer)
const TRAJECTORY_STATES = {
  EXPLORING: 'exploring',
  IMPLEMENTING: 'implementing',
  DEBUGGING: 'debugging',
  TESTING: 'testing',
  DOCUMENTING: 'documenting',
  REFACTORING: 'refactoring'
};

export class TrajectoryAnalyzer extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.initialized = false;

    // Required dependencies
    this.databaseManager = config.databaseManager;
    this.inferenceEngine = config.inferenceEngine;
    this.embeddingGenerator = config.embeddingGenerator;

    if (!this.databaseManager || !this.inferenceEngine || !this.embeddingGenerator) {
      throw new Error('TrajectoryAnalyzer requires databaseManager, inferenceEngine, and embeddingGenerator');
    }

    // Analysis configuration
    this.minConfidence = config.minConfidence || 0.6;
    this.knowledgeSuggestionThreshold = config.knowledgeSuggestionThreshold || 0.75; // 75% similarity
    this.maxSuggestedKnowledge = config.maxSuggestedKnowledge || 5;

    // Session tracking
    this.activeSessions = new Map(); // sessionId -> session data

    // Statistics
    this.stats = {
      exchangesAnalyzed: 0,
      intentClassifications: 0,
      conceptsIdentified: 0,
      knowledgeSuggestions: 0,
      byIntent: {},
      byState: {}
    };

    // Initialize intent stats
    for (const intent of Object.values(INTENT_TYPES)) {
      this.stats.byIntent[intent] = 0;
    }

    // Initialize state stats
    for (const state of Object.values(TRAJECTORY_STATES)) {
      this.stats.byState[state] = 0;
    }
  }

  /**
   * Initialize analyzer (ensures dependencies are ready)
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[TrajectoryAnalyzer] Initializing...');

    // Verify dependencies are initialized
    if (!this.databaseManager.initialized) {
      await this.databaseManager.initialize();
    }

    if (!this.inferenceEngine.initialized) {
      await this.inferenceEngine.initialize();
    }

    if (!this.embeddingGenerator.initialized) {
      await this.embeddingGenerator.initialize();
    }

    this.initialized = true;
    this.emit('initialized');
    console.log('[TrajectoryAnalyzer] Initialized');
  }

  /**
   * Analyze exchange for intent, goal, and active concepts
   *
   * @param {object} exchange - Exchange data (user, assistant, timestamp)
   * @param {object} context - Session context (sessionId, projectPath, etc.)
   * @returns {Promise<object>} Analysis result
   */
  async analyzeExchange(exchange, context = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    this.stats.exchangesAnalyzed++;

    try {
      // Get or create session
      const session = this.getOrCreateSession(context.sessionId, context);

      // Classify intent
      const intentAnalysis = await this.classifyIntent(exchange, session);

      // Extract session goal (if not set or changed)
      if (!session.goal || this.shouldUpdateGoal(exchange, session)) {
        session.goal = await this.extractSessionGoal(exchange, session);
      }

      // Identify active concepts
      const activeConcepts = await this.identifyActiveConcepts(exchange, session);

      // Find relevant knowledge
      const suggestedKnowledge = await this.findRelevantKnowledge(exchange, intentAnalysis);

      // Update session state
      session.intents.push({
        intent: intentAnalysis.intent,
        confidence: intentAnalysis.confidence,
        timestamp: exchange.timestamp || Date.now()
      });

      session.concepts = this.mergeActiveConcepts(session.concepts, activeConcepts);
      session.lastUpdateTime = Date.now();
      session.exchangeCount++;

      // Store trajectory event in database
      await this.storeTrajectoryEvent({
        sessionId: context.sessionId,
        projectPath: context.projectPath,
        intent: intentAnalysis.intent,
        intentConfidence: intentAnalysis.confidence,
        trajectoryState: session.trajectoryState,
        goal: session.goal,
        activeConcepts,
        suggestedKnowledge: suggestedKnowledge.map(k => k.id),
        timestamp: exchange.timestamp || Date.now()
      });

      // Update statistics
      this.stats.intentClassifications++;
      this.stats.byIntent[intentAnalysis.intent]++;
      this.stats.conceptsIdentified += activeConcepts.length;
      this.stats.knowledgeSuggestions += suggestedKnowledge.length;

      this.emit('exchange-analyzed', {
        sessionId: context.sessionId,
        intent: intentAnalysis.intent,
        confidence: intentAnalysis.confidence,
        concepts: activeConcepts.length,
        suggestions: suggestedKnowledge.length
      });

      return {
        intent: intentAnalysis.intent,
        intentConfidence: intentAnalysis.confidence,
        intentReasoning: intentAnalysis.reasoning,
        sessionGoal: session.goal,
        activeConcepts,
        suggestedKnowledge,
        trajectoryState: session.trajectoryState
      };
    } catch (error) {
      console.error('[TrajectoryAnalyzer] Failed to analyze exchange:', error);
      return null;
    }
  }

  /**
   * Classify intent of exchange
   */
  async classifyIntent(exchange, session) {
    const prompt = `
Analyze this development session exchange and classify the developer's intent.

Recent session context:
- Previous intents: ${session.intents.slice(-3).map(i => i.intent).join(', ') || 'none'}
- Session goal: ${session.goal || 'not yet determined'}
- Exchange count: ${session.exchangeCount}

Current exchange:
User: ${exchange.user.substring(0, 500)}
Assistant: ${exchange.assistant.substring(0, 500)}

Classification:
1. Primary intent (${Object.values(INTENT_TYPES).join(', ')})
2. Confidence (0.0-1.0)
3. Brief reasoning (1-2 sentences)

Respond in JSON format:
{
  "intent": "intent_type",
  "confidence": 0.8,
  "reasoning": "explanation"
}
`;

    try {
      const response = await this.inferenceEngine.infer(prompt, {
        operationType: 'trajectory-intent',
        temperature: 0.3,
        maxTokens: 150
      });

      const classification = JSON.parse(response.content);

      return {
        intent: classification.intent || INTENT_TYPES.EXPLORATION,
        confidence: Math.min(1.0, Math.max(0.0, classification.confidence || 0.5)),
        reasoning: classification.reasoning || 'No reasoning provided'
      };
    } catch (error) {
      console.warn('[TrajectoryAnalyzer] Intent classification failed, using heuristic:', error);
      return this.heuristicIntentClassification(exchange);
    }
  }

  /**
   * Heuristic intent classification (fallback)
   */
  heuristicIntentClassification(exchange) {
    const combined = (exchange.user + ' ' + exchange.assistant).toLowerCase();

    // Check for keywords indicating intent
    if (combined.includes('error') || combined.includes('bug') || combined.includes('debug') || combined.includes('fix')) {
      return { intent: INTENT_TYPES.DEBUGGING, confidence: 0.7, reasoning: 'Heuristic: debugging keywords' };
    }

    if (combined.includes('test') || combined.includes('spec') || combined.includes('jest') || combined.includes('expect')) {
      return { intent: INTENT_TYPES.TESTING, confidence: 0.7, reasoning: 'Heuristic: testing keywords' };
    }

    if (combined.includes('refactor') || combined.includes('reorganize') || combined.includes('clean up')) {
      return { intent: INTENT_TYPES.REFACTORING, confidence: 0.7, reasoning: 'Heuristic: refactoring keywords' };
    }

    if (combined.includes('implement') || combined.includes('feature') || combined.includes('add') || combined.includes('create')) {
      return { intent: INTENT_TYPES.FEATURE_DEV, confidence: 0.6, reasoning: 'Heuristic: feature development keywords' };
    }

    if (combined.includes('learn') || combined.includes('understand') || combined.includes('how does') || combined.includes('what is')) {
      return { intent: INTENT_TYPES.LEARNING, confidence: 0.6, reasoning: 'Heuristic: learning keywords' };
    }

    if (combined.includes('document') || combined.includes('readme') || combined.includes('comment')) {
      return { intent: INTENT_TYPES.DOCUMENTATION, confidence: 0.6, reasoning: 'Heuristic: documentation keywords' };
    }

    // Default: exploration
    return { intent: INTENT_TYPES.EXPLORATION, confidence: 0.5, reasoning: 'Heuristic: default classification' };
  }

  /**
   * Extract session goal from conversation
   */
  async extractSessionGoal(exchange, session) {
    const prompt = `
Based on this development session exchange, determine the developer's primary goal.

Session context:
- Exchange ${session.exchangeCount + 1} of session
- Previous goal: ${session.goal || 'none'}

Current exchange:
User: ${exchange.user.substring(0, 500)}

What is the developer trying to accomplish in this session?
Respond with a single clear sentence (max 100 characters).
`;

    try {
      const response = await this.inferenceEngine.infer(prompt, {
        operationType: 'trajectory-goal',
        temperature: 0.3,
        maxTokens: 50
      });

      return response.content.trim().substring(0, 100);
    } catch (error) {
      console.warn('[TrajectoryAnalyzer] Goal extraction failed:', error);
      return 'Developing software'; // Generic fallback
    }
  }

  /**
   * Identify active concepts being used/learned
   */
  async identifyActiveConcepts(exchange, session) {
    // Generate embedding for exchange
    const exchangeText = `${exchange.user} ${exchange.assistant}`;
    const embedding = await this.embeddingGenerator.generate(exchangeText, {
      vectorSize: 384 // Use fast embeddings for real-time analysis
    });

    // Search for similar knowledge in database
    const results = await this.databaseManager.searchVectors(
      'knowledge_patterns_small',
      embedding,
      {
        limit: 10,
        scoreThreshold: 0.6,
        includePayload: true
      }
    );

    // Extract concepts from matching knowledge
    const concepts = results.map(result => ({
      id: result.id,
      type: result.payload.type,
      text: result.payload.text.substring(0, 200),
      similarity: result.score,
      source: 'knowledge-base'
    }));

    return concepts;
  }

  /**
   * Find relevant knowledge for current exchange
   */
  async findRelevantKnowledge(exchange, intentAnalysis) {
    // Generate embedding for exchange
    const exchangeText = `${exchange.user} ${exchange.assistant}`;
    const embedding = await this.embeddingGenerator.generate(exchangeText, {
      vectorSize: 1536 // Use high-quality embeddings for knowledge suggestions
    });

    // Search knowledge base
    const results = await this.databaseManager.searchVectors(
      'knowledge_patterns',
      embedding,
      {
        limit: this.maxSuggestedKnowledge,
        scoreThreshold: this.knowledgeSuggestionThreshold,
        includePayload: true
      }
    );

    return results.map(result => ({
      id: result.id,
      type: result.payload.type,
      text: result.payload.text,
      similarity: result.score,
      confidence: result.payload.confidence,
      sessionId: result.payload.sessionId
    }));
  }

  /**
   * Get or create session
   */
  getOrCreateSession(sessionId, context) {
    if (!this.activeSessions.has(sessionId)) {
      this.activeSessions.set(sessionId, {
        sessionId,
        projectPath: context.projectPath,
        goal: null,
        intents: [],
        concepts: [],
        trajectoryState: TRAJECTORY_STATES.EXPLORING,
        startTime: Date.now(),
        lastUpdateTime: Date.now(),
        exchangeCount: 0
      });
    }

    return this.activeSessions.get(sessionId);
  }

  /**
   * Check if session goal should be updated
   */
  shouldUpdateGoal(exchange, session) {
    // Update goal if:
    // 1. It's early in the session (first 3 exchanges)
    // 2. User explicitly states a new goal
    // 3. Intent has changed significantly

    if (session.exchangeCount < 3) {
      return true;
    }

    const userText = exchange.user.toLowerCase();
    if (userText.includes('i want to') || userText.includes('let\'s') || userText.includes('help me')) {
      return true;
    }

    // Check if intent has changed significantly
    const recentIntents = session.intents.slice(-5).map(i => i.intent);
    const uniqueIntents = new Set(recentIntents);
    if (uniqueIntents.size >= 3) {
      return true; // Intent is shifting
    }

    return false;
  }

  /**
   * Merge active concepts (deduplicate and rank by recency)
   */
  mergeActiveConcepts(existingConcepts, newConcepts) {
    const conceptMap = new Map();

    // Add existing concepts
    for (const concept of existingConcepts) {
      conceptMap.set(concept.id, concept);
    }

    // Add new concepts (will overwrite with fresher data)
    for (const concept of newConcepts) {
      conceptMap.set(concept.id, {
        ...concept,
        lastSeen: Date.now()
      });
    }

    // Return top 20 most recent concepts
    return Array.from(conceptMap.values())
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
      .slice(0, 20);
  }

  /**
   * Store trajectory event in database
   */
  async storeTrajectoryEvent(event) {
    try {
      // Store in SQLite for analytics
      await this.databaseManager.updateSessionMetrics(event.sessionId, {
        project: event.projectPath,
        total_exchanges: event.exchangeCount || 1,
        budget_spent: 0.0, // Will be updated by BudgetTracker
        classifications: JSON.stringify({
          intent: event.intent,
          intentConfidence: event.intentConfidence,
          trajectoryState: event.trajectoryState
        })
      });

      // Generate embedding for trajectory analysis
      const eventText = `Intent: ${event.intent}, Goal: ${event.goal}, Concepts: ${event.activeConcepts.map(c => c.type).join(', ')}`;
      const embedding = await this.embeddingGenerator.generate(eventText, {
        vectorSize: 384
      });

      // Store in Qdrant for trajectory pattern analysis
      await this.databaseManager.storeVector(
        'trajectory_analysis',
        this.generateEventId(event),
        embedding,
        {
          sessionId: event.sessionId,
          projectPath: event.projectPath,
          intent: event.intent,
          intentConfidence: event.intentConfidence,
          trajectoryState: event.trajectoryState,
          goal: event.goal,
          timestamp: event.timestamp
        }
      );

      return true;
    } catch (error) {
      console.error('[TrajectoryAnalyzer] Failed to store trajectory event:', error);
      return false;
    }
  }

  /**
   * Generate unique event ID
   */
  generateEventId(event) {
    const hash = crypto.createHash('sha256')
      .update(`${event.sessionId}_${event.timestamp}`)
      .digest('hex');
    return `trajectory_${hash.substring(0, 16)}`;
  }

  /**
   * Get trajectory summary for session
   */
  async getSessionTrajectory(sessionId) {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Calculate intent distribution
    const intentCounts = {};
    for (const { intent } of session.intents) {
      intentCounts[intent] = (intentCounts[intent] || 0) + 1;
    }

    // Determine dominant intent
    const dominantIntent = Object.entries(intentCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    return {
      sessionId: session.sessionId,
      projectPath: session.projectPath,
      goal: session.goal,
      trajectoryState: session.trajectoryState,
      dominantIntent,
      intentDistribution: intentCounts,
      totalIntents: session.intents.length,
      activeConcepts: session.concepts.length,
      duration: Date.now() - session.startTime,
      exchangeCount: session.exchangeCount
    };
  }

  /**
   * Get analyzer statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeSessions: this.activeSessions.size
    };
  }

  /**
   * Clear session (on session end)
   */
  clearSession(sessionId) {
    this.activeSessions.delete(sessionId);
  }
}

export default TrajectoryAnalyzer;
export { INTENT_TYPES, TRAJECTORY_STATES };
