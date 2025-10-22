/**
 * KnowledgeExtractor
 *
 * Extracts reusable knowledge patterns from Live Session Log (LSL) files.
 * Integrates with UnifiedInferenceEngine, EmbeddingGenerator, and DatabaseManager
 * to classify, embed, and store knowledge for future retrieval.
 *
 * Key Features:
 * - Parses LSL markdown files (.specstory/history/*.md)
 * - Extracts exchanges (user prompts + assistant responses)
 * - Classifies knowledge types (patterns, solutions, decisions, bugs, etc.)
 * - Generates embeddings for semantic search
 * - Stores entities/relations in Graph DB, vectors in Qdrant
 * - Confidence scoring for extracted knowledge
 * - Deduplication against existing knowledge
 *
 * Knowledge Types:
 * - coding_pattern: Reusable coding patterns and best practices
 * - architectural_decision: System design choices and rationale
 * - bug_solution: Bug fixes and debugging strategies
 * - implementation_strategy: Approaches to implementing features
 * - tool_usage: Effective use of development tools
 * - optimization: Performance and efficiency improvements
 * - integration_pattern: Component integration approaches
 *
 * Usage:
 * ```javascript
 * const extractor = new KnowledgeExtractor({
 *   databaseManager,
 *   graphDatabase,
 *   embeddingGenerator,
 *   inferenceEngine
 * });
 *
 * await extractor.initialize();
 *
 * // Extract from a single session file
 * const knowledge = await extractor.extractFromSession(sessionFilePath);
 *
 * // Extract from all sessions in a project
 * const allKnowledge = await extractor.extractFromProject(projectPath);
 * ```
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import crypto from 'crypto';

// Knowledge type definitions
const KNOWLEDGE_TYPES = {
  CODING_PATTERN: 'coding_pattern',
  ARCHITECTURAL_DECISION: 'architectural_decision',
  BUG_SOLUTION: 'bug_solution',
  IMPLEMENTATION_STRATEGY: 'implementation_strategy',
  TOOL_USAGE: 'tool_usage',
  OPTIMIZATION: 'optimization',
  INTEGRATION_PATTERN: 'integration_pattern',
  REFACTORING: 'refactoring',
  TESTING_STRATEGY: 'testing_strategy',
  DEPLOYMENT_APPROACH: 'deployment_approach'
};

// Confidence thresholds
const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.8,      // Highly confident - definitely reusable knowledge
  MEDIUM: 0.6,    // Medium confidence - possibly reusable
  LOW: 0.4        // Low confidence - questionable reusability
};

export class KnowledgeExtractor extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.initialized = false;

    // Required dependencies
    this.databaseManager = config.databaseManager;
    this.graphDatabase = config.graphDatabase;
    this.embeddingGenerator = config.embeddingGenerator;
    this.inferenceEngine = config.inferenceEngine;

    if (!this.databaseManager || !this.graphDatabase || !this.embeddingGenerator || !this.inferenceEngine) {
      throw new Error('KnowledgeExtractor requires databaseManager, graphDatabase, embeddingGenerator, and inferenceEngine');
    }

    // Extraction configuration
    this.minConfidence = config.minConfidence || CONFIDENCE_THRESHOLDS.MEDIUM;
    this.vectorSize = config.vectorSize || 1536; // Default to high-quality embeddings
    this.deduplicationThreshold = config.deduplicationThreshold || 0.95; // 95% similarity = duplicate

    // Statistics
    this.stats = {
      sessionsProcessed: 0,
      exchangesAnalyzed: 0,
      knowledgeExtracted: 0,
      duplicatesSkipped: 0,
      lowConfidenceSkipped: 0,
      byType: {},
      byConfidence: {
        high: 0,
        medium: 0,
        low: 0
      }
    };

    // Initialize byType stats
    for (const type of Object.values(KNOWLEDGE_TYPES)) {
      this.stats.byType[type] = 0;
    }
  }

  /**
   * Initialize extractor (ensures dependencies are ready)
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[KnowledgeExtractor] Initializing...');

    // Verify dependencies are initialized
    if (!this.databaseManager.initialized) {
      await this.databaseManager.initialize();
    }

    if (!this.embeddingGenerator.initialized) {
      await this.embeddingGenerator.initialize();
    }

    if (!this.inferenceEngine.initialized) {
      await this.inferenceEngine.initialize();
    }

    this.initialized = true;
    this.emit('initialized');
    console.log('[KnowledgeExtractor] Initialized');
  }

  /**
   * Extract knowledge from a single LSL session file
   *
   * @param {string} sessionFilePath - Path to session markdown file
   * @returns {Promise<Array>} Extracted knowledge items
   */
  async extractFromSession(sessionFilePath) {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log('[KnowledgeExtractor] Processing session:', path.basename(sessionFilePath));

    try {
      // Read session file
      const content = fs.readFileSync(sessionFilePath, 'utf-8');

      // Parse session metadata
      const metadata = this.parseSessionMetadata(content);

      // Extract exchanges
      const exchanges = this.parseExchanges(content);

      console.log(`[KnowledgeExtractor] Found ${exchanges.length} exchanges in session`);

      const knowledgeItems = [];

      // Process each exchange
      for (const exchange of exchanges) {
        this.stats.exchangesAnalyzed++;

        // Classify and extract knowledge
        const knowledge = await this.extractKnowledgeFromExchange(exchange, metadata);

        if (knowledge) {
          knowledgeItems.push(knowledge);
        }
      }

      this.stats.sessionsProcessed++;
      this.emit('session-processed', {
        file: path.basename(sessionFilePath),
        exchanges: exchanges.length,
        knowledge: knowledgeItems.length
      });

      console.log(`[KnowledgeExtractor] Extracted ${knowledgeItems.length} knowledge items from session`);

      return knowledgeItems;
    } catch (error) {
      console.error('[KnowledgeExtractor] Failed to extract from session:', error);
      return [];
    }
  }

  /**
   * Extract knowledge from all sessions in a project
   *
   * @param {string} projectPath - Path to project directory
   * @returns {Promise<Array>} All extracted knowledge items
   */
  async extractFromProject(projectPath) {
    if (!this.initialized) {
      await this.initialize();
    }

    const historyDir = path.join(projectPath, '.specstory', 'history');

    if (!fs.existsSync(historyDir)) {
      console.warn('[KnowledgeExtractor] No history directory found:', historyDir);
      return [];
    }

    // Find all session files
    const sessionFiles = fs.readdirSync(historyDir)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(historyDir, f));

    console.log(`[KnowledgeExtractor] Found ${sessionFiles.length} session files in project`);

    const allKnowledge = [];

    // Process each session
    for (const sessionFile of sessionFiles) {
      const knowledge = await this.extractFromSession(sessionFile);
      allKnowledge.push(...knowledge);
    }

    this.emit('project-processed', {
      project: path.basename(projectPath),
      sessions: sessionFiles.length,
      knowledge: allKnowledge.length
    });

    console.log(`[KnowledgeExtractor] Extracted ${allKnowledge.length} total knowledge items from project`);

    return allKnowledge;
  }

  /**
   * Parse session metadata from LSL file
   */
  parseSessionMetadata(content) {
    const lines = content.split('\n');
    const metadata = {
      project: null,
      sessionId: null,
      startTime: null,
      endTime: null
    };

    // Parse YAML frontmatter if present
    if (lines[0] === '---') {
      let i = 1;
      while (i < lines.length && lines[i] !== '---') {
        const line = lines[i].trim();

        if (line.startsWith('project:')) {
          metadata.project = line.split(':')[1].trim();
        } else if (line.startsWith('session_id:')) {
          metadata.sessionId = line.split(':')[1].trim();
        } else if (line.startsWith('start_time:')) {
          metadata.startTime = line.split(':')[1].trim();
        } else if (line.startsWith('end_time:')) {
          metadata.endTime = line.split(':')[1].trim();
        }

        i++;
      }
    }

    return metadata;
  }

  /**
   * Parse exchanges from LSL markdown content
   */
  parseExchanges(content) {
    const exchanges = [];
    const lines = content.split('\n');

    let currentExchange = null;
    let inUserSection = false;
    let inAssistantSection = false;
    let currentText = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect exchange boundaries
      if (line.startsWith('## User')) {
        // Save previous exchange
        if (currentExchange && currentText.length > 0) {
          if (inAssistantSection) {
            currentExchange.assistant = currentText.join('\n').trim();
          }
          if (currentExchange.user && currentExchange.assistant) {
            exchanges.push(currentExchange);
          }
        }

        // Start new exchange
        currentExchange = { user: '', assistant: '', lineNumber: i };
        inUserSection = true;
        inAssistantSection = false;
        currentText = [];
      } else if (line.startsWith('## Assistant')) {
        if (currentExchange && currentText.length > 0) {
          currentExchange.user = currentText.join('\n').trim();
        }
        inUserSection = false;
        inAssistantSection = true;
        currentText = [];
      } else {
        // Accumulate content
        if (inUserSection || inAssistantSection) {
          currentText.push(line);
        }
      }
    }

    // Save final exchange
    if (currentExchange && currentText.length > 0 && inAssistantSection) {
      currentExchange.assistant = currentText.join('\n').trim();
      if (currentExchange.user && currentExchange.assistant) {
        exchanges.push(currentExchange);
      }
    }

    return exchanges;
  }

  /**
   * Extract knowledge from a single exchange
   */
  async extractKnowledgeFromExchange(exchange, sessionMetadata) {
    try {
      // Classify knowledge type and confidence
      const classification = await this.classifyExchange(exchange);

      // Skip low-confidence or non-knowledge exchanges
      if (classification.confidence < this.minConfidence) {
        this.stats.lowConfidenceSkipped++;
        return null;
      }

      // Extract key information
      const knowledgeText = this.extractKnowledgeText(exchange, classification);

      // Check for duplicates
      const isDuplicate = await this.checkDuplication(knowledgeText);
      if (isDuplicate) {
        this.stats.duplicatesSkipped++;
        return null;
      }

      // Generate embedding
      const embedding = await this.embeddingGenerator.generate(knowledgeText, {
        vectorSize: this.vectorSize
      });

      // Create knowledge item
      const knowledge = {
        id: this.generateKnowledgeId(knowledgeText),
        type: classification.type,
        confidence: classification.confidence,
        text: knowledgeText,
        userPrompt: exchange.user,
        assistantResponse: exchange.assistant,
        sessionId: sessionMetadata.sessionId,
        project: sessionMetadata.project,
        embedding,
        metadata: {
          ...sessionMetadata,
          classification: classification.reasoning,
          extractedAt: new Date().toISOString()
        }
      };

      // Store in database
      await this.storeKnowledge(knowledge);

      // Update statistics
      this.stats.knowledgeExtracted++;
      this.stats.byType[knowledge.type]++;

      const confidenceBucket = knowledge.confidence >= CONFIDENCE_THRESHOLDS.HIGH ? 'high' :
                               knowledge.confidence >= CONFIDENCE_THRESHOLDS.MEDIUM ? 'medium' : 'low';
      this.stats.byConfidence[confidenceBucket]++;

      this.emit('knowledge-extracted', {
        type: knowledge.type,
        confidence: knowledge.confidence,
        text: knowledge.text.substring(0, 100) + '...'
      });

      return knowledge;
    } catch (error) {
      console.error('[KnowledgeExtractor] Failed to extract knowledge from exchange:', error);
      return null;
    }
  }

  /**
   * Classify exchange to determine knowledge type and confidence
   */
  async classifyExchange(exchange) {
    const prompt = `
Analyze this development session exchange and determine if it contains reusable knowledge.

User: ${exchange.user.substring(0, 500)}
Assistant: ${exchange.assistant.substring(0, 500)}

Classification:
1. Is this reusable knowledge? (yes/no)
2. If yes, what type? (${Object.values(KNOWLEDGE_TYPES).join(', ')})
3. Confidence score (0.0-1.0): How confident are you this is valuable, reusable knowledge?
4. Brief reasoning (1-2 sentences)

Respond in JSON format:
{
  "isKnowledge": true/false,
  "type": "knowledge_type",
  "confidence": 0.8,
  "reasoning": "explanation"
}
`;

    try {
      const response = await this.inferenceEngine.infer(prompt, {
        operationType: 'knowledge-classification',
        temperature: 0.3, // Lower temperature for consistent classification
        maxTokens: 200
      });

      const classification = JSON.parse(response.content);

      // Validate and normalize
      if (!classification.isKnowledge) {
        return { type: null, confidence: 0, reasoning: 'Not reusable knowledge' };
      }

      return {
        type: classification.type || KNOWLEDGE_TYPES.CODING_PATTERN,
        confidence: Math.min(1.0, Math.max(0.0, classification.confidence || 0.5)),
        reasoning: classification.reasoning || 'No reasoning provided'
      };
    } catch (error) {
      console.warn('[KnowledgeExtractor] Classification failed, using heuristic:', error);
      // Fallback to heuristic classification
      return this.heuristicClassification(exchange);
    }
  }

  /**
   * Heuristic classification (fallback when LLM unavailable)
   */
  heuristicClassification(exchange) {
    const combined = (exchange.user + ' ' + exchange.assistant).toLowerCase();

    // Check for keywords indicating knowledge types
    if (combined.includes('pattern') || combined.includes('best practice')) {
      return { type: KNOWLEDGE_TYPES.CODING_PATTERN, confidence: 0.6, reasoning: 'Heuristic: pattern keywords' };
    }

    if (combined.includes('architecture') || combined.includes('design decision')) {
      return { type: KNOWLEDGE_TYPES.ARCHITECTURAL_DECISION, confidence: 0.6, reasoning: 'Heuristic: architecture keywords' };
    }

    if (combined.includes('bug') || combined.includes('fix') || combined.includes('error')) {
      return { type: KNOWLEDGE_TYPES.BUG_SOLUTION, confidence: 0.6, reasoning: 'Heuristic: bug keywords' };
    }

    if (combined.includes('implement') || combined.includes('approach')) {
      return { type: KNOWLEDGE_TYPES.IMPLEMENTATION_STRATEGY, confidence: 0.5, reasoning: 'Heuristic: implementation keywords' };
    }

    // Default: medium confidence coding pattern
    return { type: KNOWLEDGE_TYPES.CODING_PATTERN, confidence: 0.5, reasoning: 'Heuristic: default classification' };
  }

  /**
   * Extract concise knowledge text from exchange
   */
  extractKnowledgeText(exchange, classification) {
    // Combine user prompt and key parts of assistant response
    const userText = exchange.user.substring(0, 500);
    const assistantText = exchange.assistant.substring(0, 1000);

    return `[${classification.type}]\n\nQuestion: ${userText}\n\nSolution: ${assistantText}`;
  }

  /**
   * Check if knowledge already exists (deduplication)
   */
  async checkDuplication(knowledgeText) {
    try {
      // Generate embedding for similarity search
      const embedding = await this.embeddingGenerator.generate(knowledgeText, {
        vectorSize: this.vectorSize
      });

      // Search for similar knowledge in database
      const collection = this.vectorSize === 384 ? 'knowledge_patterns_small' : 'knowledge_patterns';
      const results = await this.databaseManager.searchVectors(collection, embedding, {
        limit: 1,
        scoreThreshold: this.deduplicationThreshold
      });

      return results.length > 0;
    } catch (error) {
      console.warn('[KnowledgeExtractor] Deduplication check failed:', error);
      return false; // Assume not duplicate on error
    }
  }

  /**
   * Store knowledge in database (Graph DB + Qdrant)
   */
  async storeKnowledge(knowledge) {
    try {
      // Store entity in Graph DB (primary storage)
      const entity = {
        name: knowledge.id,
        entityName: knowledge.text.substring(0, 100),
        entityType: knowledge.type,
        observations: [knowledge.text],
        extractionType: knowledge.type,
        classification: knowledge.metadata.classification,
        confidence: knowledge.confidence,
        source: 'auto',
        sessionId: knowledge.sessionId,
        embeddingId: knowledge.id,
        metadata: {
          ...knowledge.metadata,
          userPrompt: knowledge.userPrompt?.substring(0, 500),
          assistantResponse: knowledge.assistantResponse?.substring(0, 500)
        }
      };

      await this.graphDatabase.storeEntity(entity, {
        team: knowledge.project || 'coding'
      });

      // Store vector in Qdrant (for semantic search)
      const collection = this.vectorSize === 384 ? 'knowledge_patterns_small' : 'knowledge_patterns';
      await this.databaseManager.storeVector(collection, knowledge.id, knowledge.embedding, {
        type: knowledge.type,
        confidence: knowledge.confidence,
        text: knowledge.text,
        sessionId: knowledge.sessionId,
        project: knowledge.project,
        extractedAt: knowledge.metadata.extractedAt
      });

      return true;
    } catch (error) {
      console.error('[KnowledgeExtractor] Failed to store knowledge:', error);
      return false;
    }
  }

  /**
   * Generate unique knowledge ID
   */
  generateKnowledgeId(text) {
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    return `knowledge_${hash.substring(0, 16)}_${Date.now()}`;
  }

  /**
   * Get extraction statistics
   */
  getStats() {
    return {
      ...this.stats,
      extractionRate: this.stats.exchangesAnalyzed > 0
        ? ((this.stats.knowledgeExtracted / this.stats.exchangesAnalyzed) * 100).toFixed(2) + '%'
        : '0%',
      duplicationRate: this.stats.exchangesAnalyzed > 0
        ? ((this.stats.duplicatesSkipped / this.stats.exchangesAnalyzed) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Clear statistics
   */
  clearStats() {
    this.stats = {
      sessionsProcessed: 0,
      exchangesAnalyzed: 0,
      knowledgeExtracted: 0,
      duplicatesSkipped: 0,
      lowConfidenceSkipped: 0,
      byType: {},
      byConfidence: {
        high: 0,
        medium: 0,
        low: 0
      }
    };

    // Reinitialize byType stats
    for (const type of Object.values(KNOWLEDGE_TYPES)) {
      this.stats.byType[type] = 0;
    }
  }
}

export default KnowledgeExtractor;
export { KNOWLEDGE_TYPES, CONFIDENCE_THRESHOLDS };
