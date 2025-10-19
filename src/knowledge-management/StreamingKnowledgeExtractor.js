/**
 * StreamingKnowledgeExtractor
 *
 * Real-time knowledge extraction from live coding sessions.
 * Processes exchanges as they occur rather than batch processing LSL files.
 *
 * Key Features:
 * - Live extraction: Process exchanges immediately as they complete
 * - Incremental processing: No need to wait for session end
 * - Exchange buffer: Maintain context window for better classification
 * - Debouncing: Avoid over-extraction during rapid interactions
 * - Session awareness: Track session state and trajectory
 * - Immediate availability: Knowledge available for same-session retrieval
 * - Background processing: Non-blocking extraction with queue
 *
 * Architecture:
 * - Extends KnowledgeExtractor for core classification logic
 * - Adds streaming-specific features: buffering, debouncing, queueing
 * - Integrates with TrajectoryAnalyzer for intent-aware extraction
 * - Supports both push (receive exchanges) and pull (watch transcript) modes
 *
 * Usage:
 * ```javascript
 * const streaming = new StreamingKnowledgeExtractor({
 *   databaseManager,
 *   embeddingGenerator,
 *   inferenceEngine,
 *   trajectoryAnalyzer
 * });
 *
 * await streaming.initialize();
 *
 * // Start monitoring a session
 * await streaming.startSession(sessionId, { projectPath, intent });
 *
 * // Process exchange as it completes
 * await streaming.processExchange({ user: '...', assistant: '...' });
 *
 * // Or watch transcript file for changes
 * await streaming.watchTranscript(transcriptPath);
 *
 * // End session
 * await streaming.endSession();
 * ```
 */

import { KnowledgeExtractor, KNOWLEDGE_TYPES, CONFIDENCE_THRESHOLDS } from './KnowledgeExtractor.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Streaming-specific configuration
const STREAMING_CONFIG = {
  BUFFER_SIZE: 5,              // Keep last 5 exchanges for context
  DEBOUNCE_MS: 2000,           // Wait 2s before processing
  MIN_EXCHANGE_LENGTH: 100,    // Minimum exchange length to process
  BATCH_SIZE: 3,               // Process in batches of 3
  QUEUE_MAX_SIZE: 50           // Maximum queue size
};

export class StreamingKnowledgeExtractor extends KnowledgeExtractor {
  constructor(config = {}) {
    super(config);

    // Streaming-specific dependencies
    this.trajectoryAnalyzer = config.trajectoryAnalyzer;

    // Session state
    this.currentSession = null;
    this.exchangeBuffer = [];
    this.processingQueue = [];
    this.isProcessing = false;

    // Streaming configuration
    this.bufferSize = config.bufferSize || STREAMING_CONFIG.BUFFER_SIZE;
    this.debounceMs = config.debounceMs || STREAMING_CONFIG.DEBOUNCE_MS;
    this.minExchangeLength = config.minExchangeLength || STREAMING_CONFIG.MIN_EXCHANGE_LENGTH;
    this.batchSize = config.batchSize || STREAMING_CONFIG.BATCH_SIZE;

    // Debouncing
    this.debounceTimer = null;

    // Transcript watching
    this.transcriptWatcher = null;
    this.lastTranscriptPosition = 0;

    // Statistics
    this.streamingStats = {
      sessionsStreamed: 0,
      exchangesStreamed: 0,
      immediateExtractions: 0,
      debouncedSkips: 0,
      queueOverflows: 0
    };
  }

  /**
   * Start monitoring a new session
   */
  async startSession(sessionId, context = {}) {
    if (this.currentSession) {
      console.warn('[StreamingKnowledgeExtractor] Ending previous session before starting new one');
      await this.endSession();
    }

    this.currentSession = {
      sessionId,
      projectPath: context.projectPath || null,
      intent: context.intent || null,
      startTime: Date.now(),
      exchangeCount: 0,
      knowledgeExtracted: 0
    };

    this.exchangeBuffer = [];
    this.processingQueue = [];
    this.lastTranscriptPosition = 0;

    this.streamingStats.sessionsStreamed++;

    this.emit('session-started', {
      sessionId,
      projectPath: context.projectPath,
      intent: context.intent
    });

    console.log(`[StreamingKnowledgeExtractor] Session started: ${sessionId}`);
  }

  /**
   * End current session
   */
  async endSession() {
    if (!this.currentSession) {
      return;
    }

    // Process any remaining queued exchanges
    await this.flushQueue();

    // Stop transcript watching if active
    if (this.transcriptWatcher) {
      this.transcriptWatcher.close();
      this.transcriptWatcher = null;
    }

    const sessionDuration = Date.now() - this.currentSession.startTime;

    this.emit('session-ended', {
      sessionId: this.currentSession.sessionId,
      duration: sessionDuration,
      exchangeCount: this.currentSession.exchangeCount,
      knowledgeExtracted: this.currentSession.knowledgeExtracted
    });

    console.log(`[StreamingKnowledgeExtractor] Session ended: ${this.currentSession.sessionId} (${this.currentSession.exchangeCount} exchanges, ${this.currentSession.knowledgeExtracted} knowledge items)`);

    this.currentSession = null;
  }

  /**
   * Process a single exchange in real-time
   *
   * @param {object} exchange - Exchange with user and assistant content
   * @param {object} options - Processing options
   */
  async processExchange(exchange, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.currentSession) {
      throw new Error('No active session. Call startSession() first.');
    }

    this.streamingStats.exchangesStreamed++;
    this.currentSession.exchangeCount++;

    // Skip if exchange is too short
    const exchangeLength = (exchange.user || '').length + (exchange.assistant || '').length;
    if (exchangeLength < this.minExchangeLength) {
      return null;
    }

    // Add to buffer for context
    this.exchangeBuffer.push(exchange);
    if (this.exchangeBuffer.length > this.bufferSize) {
      this.exchangeBuffer.shift(); // Remove oldest
    }

    // Immediate processing or debounced?
    if (options.immediate) {
      return await this.extractFromExchange(exchange);
    } else {
      // Add to queue and debounce
      this.processingQueue.push(exchange);
      this.debounceProcessing();
      return null;
    }
  }

  /**
   * Debounced queue processing
   */
  debounceProcessing() {
    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.streamingStats.debouncedSkips++;
    }

    // Set new timer
    this.debounceTimer = setTimeout(async () => {
      await this.processQueue();
    }, this.debounceMs);
  }

  /**
   * Process queued exchanges
   */
  async processQueue() {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      // Process in batches
      while (this.processingQueue.length > 0) {
        const batch = this.processingQueue.splice(0, this.batchSize);

        for (const exchange of batch) {
          try {
            await this.extractFromExchange(exchange);
          } catch (error) {
            console.error('[StreamingKnowledgeExtractor] Exchange processing failed:', error);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Flush queue (process all remaining exchanges)
   */
  async flushQueue() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    await this.processQueue();
  }

  /**
   * Extract knowledge from a single exchange
   * (Overrides parent method to add streaming context)
   */
  async extractFromExchange(exchange) {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    try {
      // Get trajectory context if available
      let trajectoryContext = {};
      if (this.trajectoryAnalyzer) {
        const analysis = await this.trajectoryAnalyzer.analyzeExchange(exchange, {
          sessionId: this.currentSession.sessionId
        });
        trajectoryContext = {
          intent: analysis.intent,
          sessionGoal: analysis.sessionGoal,
          activeConcepts: analysis.activeConcepts
        };
      }

      // Classify exchange
      const classification = await this.classifyExchange(exchange, {
        ...trajectoryContext,
        bufferContext: this.exchangeBuffer.slice(-3) // Last 3 exchanges for context
      });

      // Skip if not knowledge or low confidence
      if (!classification.isKnowledge) {
        return null;
      }

      if (classification.confidence < this.minConfidence) {
        this.stats.lowConfidenceSkipped++;
        return null;
      }

      // Extract knowledge text
      const knowledgeText = this.extractKnowledgeText(exchange, classification);

      // Check for duplicates
      const isDuplicate = await this.checkDuplicate(knowledgeText);
      if (isDuplicate) {
        this.stats.duplicatesSkipped++;
        return null;
      }

      // Generate embeddings (dual vector sizes)
      const embedding384 = await this.embeddingGenerator.generate(knowledgeText, {
        vectorSize: 384
      });

      const embedding1536 = await this.embeddingGenerator.generate(knowledgeText, {
        vectorSize: 1536
      });

      // Create knowledge item
      const knowledgeItem = {
        id: this.generateKnowledgeId(knowledgeText),
        type: classification.type,
        text: knowledgeText,
        confidence: classification.confidence,
        sessionId: this.currentSession.sessionId,
        project: this.currentSession.projectPath,
        intent: trajectoryContext.intent || null,
        extractedAt: new Date().toISOString(),
        metadata: {
          exchangeIndex: this.currentSession.exchangeCount,
          sessionGoal: trajectoryContext.sessionGoal || null,
          activeConcepts: trajectoryContext.activeConcepts || [],
          reasoning: classification.reasoning
        }
      };

      // Store in database
      await this.storeKnowledge(knowledgeItem, {
        embedding384,
        embedding1536
      });

      // Update statistics
      this.stats.knowledgeExtracted++;
      this.streamingStats.immediateExtractions++;
      this.currentSession.knowledgeExtracted++;

      if (!this.stats.byType[classification.type]) {
        this.stats.byType[classification.type] = 0;
      }
      this.stats.byType[classification.type]++;

      this.emit('knowledge-extracted', {
        sessionId: this.currentSession.sessionId,
        type: classification.type,
        confidence: classification.confidence
      });

      console.log(`[StreamingKnowledgeExtractor] Extracted: ${classification.type} (confidence: ${classification.confidence.toFixed(2)})`);

      return knowledgeItem;
    } catch (error) {
      console.error('[StreamingKnowledgeExtractor] Extraction failed:', error);
      return null;
    }
  }

  /**
   * Classify exchange with streaming context
   */
  async classifyExchange(exchange, context = {}) {
    const { bufferContext = [], intent = null, sessionGoal = null } = context;

    // Build context-aware prompt
    let contextPrompt = '';
    if (intent) {
      contextPrompt += `Current session intent: ${intent}\n`;
    }
    if (sessionGoal) {
      contextPrompt += `Session goal: ${sessionGoal}\n`;
    }
    if (bufferContext.length > 0) {
      contextPrompt += `Recent exchanges for context:\n${bufferContext.map((ex, i) =>
        `${i + 1}. User: ${ex.user?.substring(0, 100)}...\n   Assistant: ${ex.assistant?.substring(0, 100)}...`
      ).join('\n')}\n\n`;
    }

    const prompt = `${contextPrompt}Analyze this exchange and determine if it contains reusable knowledge.

Exchange:
User: ${exchange.user}
Assistant: ${exchange.assistant}

Classification Task:
1. Is this reusable knowledge? (yes/no)
2. If yes, what type? Choose from:
   - coding_pattern: Reusable coding patterns and best practices
   - architectural_decision: System design choices and rationale
   - bug_solution: Bug fixes and debugging strategies
   - implementation_strategy: Approaches to implementing features
   - tool_usage: Effective use of development tools
   - optimization: Performance and efficiency improvements
   - integration_pattern: Component integration approaches
   - refactoring: Code restructuring techniques
   - testing_strategy: Testing approaches and patterns
   - deployment_approach: Deployment strategies
3. Confidence score (0.0-1.0): How confident are you this is reusable knowledge?
4. Brief reasoning (one sentence)

Respond in JSON format:
{
  "isKnowledge": true/false,
  "type": "knowledge_type",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

    try {
      const response = await this.inferenceEngine.infer(prompt, {
        operationType: 'streaming-knowledge-classification',
        temperature: 0.3,
        maxTokens: 200
      });

      // Parse JSON response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const classification = JSON.parse(jsonMatch[0]);

      // Validate
      if (typeof classification.isKnowledge !== 'boolean') {
        throw new Error('Invalid classification format');
      }

      return classification;
    } catch (error) {
      console.error('[StreamingKnowledgeExtractor] Classification failed, using heuristic:', error);
      return this.heuristicClassification(exchange);
    }
  }

  /**
   * Heuristic classification fallback
   */
  heuristicClassification(exchange) {
    const text = `${exchange.user} ${exchange.assistant}`.toLowerCase();

    // Keywords for each type
    const typeKeywords = {
      coding_pattern: ['pattern', 'approach', 'structure', 'design', 'implement'],
      bug_solution: ['bug', 'error', 'fix', 'issue', 'problem', 'debug'],
      optimization: ['optimize', 'performance', 'faster', 'efficient', 'improve'],
      testing_strategy: ['test', 'testing', 'assert', 'verify', 'validation'],
      implementation_strategy: ['implement', 'build', 'create', 'develop', 'strategy']
    };

    let bestType = 'coding_pattern'; // Default
    let maxMatches = 0;

    for (const [type, keywords] of Object.entries(typeKeywords)) {
      const matches = keywords.filter(keyword => text.includes(keyword)).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        bestType = type;
      }
    }

    return {
      isKnowledge: maxMatches > 0,
      type: bestType,
      confidence: maxMatches > 0 ? 0.5 : 0.3,
      reasoning: 'Heuristic classification based on keyword matching'
    };
  }

  /**
   * Extract knowledge text from exchange
   */
  extractKnowledgeText(exchange, classification) {
    // For most types, the assistant's response contains the knowledge
    let knowledgeText = exchange.assistant || '';

    // For bug solutions, include the problem context from user
    if (classification.type === 'bug_solution') {
      const userContext = exchange.user?.substring(0, 200) || '';
      knowledgeText = `Problem: ${userContext}\n\nSolution: ${knowledgeText}`;
    }

    // For architectural decisions, include the question/context
    if (classification.type === 'architectural_decision') {
      const userContext = exchange.user?.substring(0, 300) || '';
      knowledgeText = `Context: ${userContext}\n\nDecision: ${knowledgeText}`;
    }

    return knowledgeText;
  }

  /**
   * Check if knowledge is duplicate
   */
  async checkDuplicate(knowledgeText) {
    try {
      // Use KnowledgeRetriever's findSimilar method
      // (requires retriever to be available)
      const embedding = await this.embeddingGenerator.generate(knowledgeText, {
        vectorSize: 1536
      });

      const similar = await this.databaseManager.searchVectors(
        'knowledge_patterns',
        embedding,
        {
          limit: 1,
          scoreThreshold: this.deduplicationThreshold,
          includePayload: true
        }
      );

      return similar.length > 0;
    } catch (error) {
      console.error('[StreamingKnowledgeExtractor] Duplicate check failed:', error);
      return false; // Assume not duplicate on error
    }
  }

  /**
   * Store knowledge in database
   */
  async storeKnowledge(knowledgeItem, embeddings) {
    const { embedding384, embedding1536 } = embeddings;

    // Store in Qdrant (dual collections)
    await this.databaseManager.storeVector(
      'knowledge_patterns_small',
      knowledgeItem.id,
      embedding384,
      {
        type: knowledgeItem.type,
        text: knowledgeItem.text,
        confidence: knowledgeItem.confidence,
        sessionId: knowledgeItem.sessionId,
        project: knowledgeItem.project,
        intent: knowledgeItem.intent,
        extractedAt: knowledgeItem.extractedAt
      }
    );

    await this.databaseManager.storeVector(
      'knowledge_patterns',
      knowledgeItem.id,
      embedding1536,
      {
        type: knowledgeItem.type,
        text: knowledgeItem.text,
        confidence: knowledgeItem.confidence,
        sessionId: knowledgeItem.sessionId,
        project: knowledgeItem.project,
        intent: knowledgeItem.intent,
        extractedAt: knowledgeItem.extractedAt
      }
    );

    // Store metadata in SQLite
    await this.databaseManager.storeKnowledgeExtraction({
      id: knowledgeItem.id,
      type: knowledgeItem.type,
      sessionId: knowledgeItem.sessionId,
      project: knowledgeItem.project,
      confidence: knowledgeItem.confidence,
      extractedAt: knowledgeItem.extractedAt,
      metadata: JSON.stringify(knowledgeItem.metadata)
    });
  }

  /**
   * Generate unique knowledge ID
   */
  generateKnowledgeId(knowledgeText) {
    const hash = crypto.createHash('sha256')
      .update(knowledgeText)
      .digest('hex');
    return `knowledge_${hash.substring(0, 16)}`;
  }

  /**
   * Watch transcript file for changes
   *
   * @param {string} transcriptPath - Path to transcript file
   */
  async watchTranscript(transcriptPath) {
    if (!this.currentSession) {
      throw new Error('No active session. Call startSession() first.');
    }

    if (this.transcriptWatcher) {
      console.warn('[StreamingKnowledgeExtractor] Already watching transcript');
      return;
    }

    console.log(`[StreamingKnowledgeExtractor] Watching transcript: ${transcriptPath}`);

    // Initial read
    await this.processTranscriptUpdates(transcriptPath);

    // Watch for changes
    this.transcriptWatcher = fs.watch(transcriptPath, async (eventType) => {
      if (eventType === 'change') {
        await this.processTranscriptUpdates(transcriptPath);
      }
    });

    this.emit('transcript-watching-started', { transcriptPath });
  }

  /**
   * Process new transcript content
   */
  async processTranscriptUpdates(transcriptPath) {
    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const currentLength = content.length;

      // Skip if no new content
      if (currentLength <= this.lastTranscriptPosition) {
        return;
      }

      // Extract new content
      const newContent = content.substring(this.lastTranscriptPosition);
      this.lastTranscriptPosition = currentLength;

      // Parse new exchanges from content
      const exchanges = this.parseTranscriptExchanges(newContent);

      // Process each exchange
      for (const exchange of exchanges) {
        await this.processExchange(exchange, { immediate: false });
      }
    } catch (error) {
      console.error('[StreamingKnowledgeExtractor] Transcript processing failed:', error);
    }
  }

  /**
   * Parse exchanges from transcript content
   */
  parseTranscriptExchanges(content) {
    const exchanges = [];
    const lines = content.split('\n');

    let currentExchange = null;
    let inUserSection = false;
    let inAssistantSection = false;

    for (const line of lines) {
      if (line.startsWith('## User') || line.startsWith('### User')) {
        if (currentExchange && currentExchange.assistant) {
          exchanges.push(currentExchange);
        }
        currentExchange = { user: '', assistant: '' };
        inUserSection = true;
        inAssistantSection = false;
      } else if (line.startsWith('## Assistant') || line.startsWith('### Assistant')) {
        inUserSection = false;
        inAssistantSection = true;
      } else if (line.startsWith('##') || line.startsWith('###')) {
        // Other section
        inUserSection = false;
        inAssistantSection = false;
      } else {
        // Content line
        if (inUserSection && currentExchange) {
          currentExchange.user += line + '\n';
        } else if (inAssistantSection && currentExchange) {
          currentExchange.assistant += line + '\n';
        }
      }
    }

    // Add last exchange
    if (currentExchange && currentExchange.assistant) {
      exchanges.push(currentExchange);
    }

    return exchanges;
  }

  /**
   * Get streaming statistics
   */
  getStreamingStats() {
    return {
      ...this.stats,
      streaming: this.streamingStats,
      currentSession: this.currentSession ? {
        sessionId: this.currentSession.sessionId,
        exchangeCount: this.currentSession.exchangeCount,
        knowledgeExtracted: this.currentSession.knowledgeExtracted,
        duration: Date.now() - this.currentSession.startTime
      } : null,
      queueSize: this.processingQueue.length,
      bufferSize: this.exchangeBuffer.length
    };
  }

  /**
   * Clear streaming statistics
   */
  clearStreamingStats() {
    this.streamingStats = {
      sessionsStreamed: 0,
      exchangesStreamed: 0,
      immediateExtractions: 0,
      debouncedSkips: 0,
      queueOverflows: 0
    };
  }
}

export default StreamingKnowledgeExtractor;
export { STREAMING_CONFIG }