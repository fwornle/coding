/**
 * Real-Time Trajectory Analyzer (Enhanced)
 *
 * Provides real-time trajectory state analysis for Claude Code conversations,
 * replacing the 6-hourly semantic analysis with continuous monitoring.
 * Integrates with the Enhanced Transcript Monitor to provide live trajectory
 * tracking, intervention capabilities, and multi-project coordination.
 *
 * Enhanced Features (v2):
 * - Intent classification (learning, debugging, feature-dev, etc.)
 * - Session goal extraction from conversation context
 * - Active concept tracking (technologies, patterns, practices being used/learned)
 * - Integration with UnifiedInferenceEngine for shared LLM access
 * - Integration with TrajectoryConceptExtractor for concept linking
 */

import path from 'path';
import fs from 'fs';
import { UnifiedInferenceEngine } from '../inference/UnifiedInferenceEngine.js';
import { TrajectoryConceptExtractor } from './TrajectoryConceptExtractor.js';

export class RealTimeTrajectoryAnalyzer {
  constructor(config = {}) {
    // Initialize debug early
    this.debugEnabled = config.debug || false;

    this.config = {
      projectPath: config.projectPath,
      codingToolsPath: config.codingToolsPath || process.env.CODING_TOOLS_PATH,
      trajectoryConfig: null, // Will be loaded after codingToolsPath is set
      debug: this.debugEnabled,
      ...config
    };

    // Load trajectory config after codingToolsPath is available
    this.config.trajectoryConfig = config.trajectoryConfig || this.loadTrajectoryConfig();

    // Initialize trajectory state
    this.currentState = 'exploring'; // Default state
    this.lastAnalysisTime = null;
    this.stateHistory = [];
    this.interventionCount = 0;

    // Enhanced trajectory state (v2)
    this.currentIntent = 'exploration'; // Default intent
    this.sessionGoal = null;
    this.activeConcepts = []; // Array of {name, category, isLearning, knowledgeId}
    this.confidence = 0.5; // Confidence in current classification
    this.intentHistory = []; // Track intent transitions

    // Smart analysis tracking
    this.analysisCount = { hourly: 0, hourStart: Date.now() };
    this.lastExchangeType = null;
    this.consecutiveReads = 0;

    // Initialize UnifiedInferenceEngine (shared with knowledge system)
    this.inferenceEngine = null;
    this.initializeInferenceEngine();

    // Initialize fast inference engine (legacy - will be replaced with UnifiedInferenceEngine)
    this.fastInferenceEngine = null;
    this.initializeFastInference();

    // Initialize concept extractor
    this.conceptExtractor = null;
    this.initializeConceptExtractor();
    
    // Initialize trajectory persistence
    this.trajectoryDir = path.join(this.config.projectPath, '.specstory', 'trajectory');
    this.ensureTrajectoryDirectory();

    // Start heartbeat to keep live-state.json fresh even when no activity
    this.startHeartbeat();

    this.debug('RealTimeTrajectoryAnalyzer initialized', {
      projectPath: this.config.projectPath,
      provider: this.config.trajectoryConfig?.inference_provider,
      model: this.config.trajectoryConfig?.inference_model
    });
  }

  /**
   * Load trajectory configuration from live-logging-config.json
   */
  loadTrajectoryConfig() {
    try {
      const configPath = path.join(this.config.codingToolsPath, 'config', 'live-logging-config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config.trajectory_analysis || {};
      }
    } catch (error) {
      this.debug('Failed to load trajectory config, using defaults', error.message);
    }
    
    // Default configuration
    return {
      enabled: true,
      inference_provider: 'groq',
      inference_model: 'gpt-oss:20b',
      analysis_interval: 100,
      intervention_threshold: 0.8
    };
  }

  /**
   * Initialize UnifiedInferenceEngine (shared with knowledge system)
   */
  async initializeInferenceEngine() {
    try {
      this.inferenceEngine = new UnifiedInferenceEngine({
        projectPath: this.config.projectPath,
        debug: this.debugEnabled
      });

      this.debug('UnifiedInferenceEngine initialized for trajectory analysis');
    } catch (error) {
      console.error('Failed to initialize UnifiedInferenceEngine:', error.message);
      this.inferenceEngine = null;
    }
  }

  /**
   * Initialize TrajectoryConceptExtractor for concept tracking
   */
  async initializeConceptExtractor() {
    try {
      this.conceptExtractor = new TrajectoryConceptExtractor({
        projectPath: this.config.projectPath,
        debug: this.debugEnabled
      });

      this.debug('TrajectoryConceptExtractor initialized');
    } catch (error) {
      console.error('Failed to initialize TrajectoryConceptExtractor:', error.message);
      this.conceptExtractor = null;
    }
  }

  /**
   * Initialize fast inference engine for real-time analysis
   * LEGACY: Will be deprecated in favor of UnifiedInferenceEngine
   */
  async initializeFastInference() {
    try {
      const provider = this.config.trajectoryConfig.inference_provider || 'groq';
      const model = this.config.trajectoryConfig.inference_model || 'gpt-oss:20b';

      // Get API key based on provider
      const apiKey = this.getApiKeyForProvider(provider);
      if (!apiKey) {
        throw new Error(`No API key found for provider: ${provider}`);
      }

      this.fastInferenceEngine = {
        provider,
        model,
        apiKey,
        baseUrl: this.getBaseUrlForProvider(provider),
        initialized: true
      };

      this.debug('Fast inference engine initialized', { provider, model });

    } catch (error) {
      console.error('Failed to initialize fast inference engine:', error.message);
      this.fastInferenceEngine = null;
    }
  }

  /**
   * Get API key for the specified provider
   */
  getApiKeyForProvider(provider) {
    const keyMap = {
      'groq': process.env.GROQ_API_KEY,
      'openai': process.env.OPENAI_API_KEY,
      'anthropic': process.env.ANTHROPIC_API_KEY,
      'xai': process.env.XAI_API_KEY
    };
    
    return keyMap[provider];
  }

  /**
   * Get base URL for the specified provider
   */
  getBaseUrlForProvider(provider) {
    const urlMap = {
      'groq': 'https://api.groq.com/openai/v1',
      'openai': 'https://api.openai.com/v1',
      'anthropic': 'https://api.anthropic.com/v1',
      'xai': 'https://api.x.ai/v1'
    };
    
    return urlMap[provider];
  }

  /**
   * Ensure trajectory directory structure exists
   */
  ensureTrajectoryDirectory() {
    try {
      if (!fs.existsSync(this.trajectoryDir)) {
        fs.mkdirSync(this.trajectoryDir, { recursive: true });
        this.debug('Created trajectory directory:', this.trajectoryDir);
      }

      // Ensure live-state.json is in .gitignore (it's volatile runtime data)
      this.ensureLiveStateInGitignore();
    } catch (error) {
      console.error('Failed to create trajectory directory:', error.message);
    }
  }

  /**
   * Ensure live-state.json is in .gitignore
   * This file contains volatile runtime state and should not be committed
   */
  ensureLiveStateInGitignore() {
    try {
      const projectRoot = this.config.projectPath;
      const gitignorePath = path.join(projectRoot, '.gitignore');
      const ignoreEntry = '.specstory/trajectory/live-state.json';

      // Check if .gitignore exists
      if (!fs.existsSync(gitignorePath)) {
        // Create .gitignore with the entry
        fs.writeFileSync(gitignorePath, `# Live logging runtime data (volatile state - not for version control)\n${ignoreEntry}\n`);
        this.debug('Created .gitignore with live-state.json entry');
        return;
      }

      // Check if entry already exists
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      if (gitignoreContent.includes(ignoreEntry)) {
        return; // Already present
      }

      // Add entry to .gitignore
      const newContent = gitignoreContent.trimEnd() + '\n\n# Live logging runtime data (volatile state - not for version control)\n' + ignoreEntry + '\n';
      fs.writeFileSync(gitignorePath, newContent);
      this.debug('Added live-state.json to .gitignore');
    } catch (error) {
      // Non-critical error - just log it
      this.debug('Failed to update .gitignore:', error.message);
    }
  }

  /**
   * Check if this exchange should be analyzed based on smart analysis rules
   */
  shouldAnalyzeExchange(exchange) {
    const smartConfig = this.config.trajectoryConfig.smart_analysis;
    if (!smartConfig?.enabled) return true;

    // Reset hourly counter if needed
    const now = Date.now();
    if (now - this.analysisCount.hourStart > 3600000) {
      this.analysisCount = { hourly: 0, hourStart: now };
    }

    // Check hourly limit
    if (this.analysisCount.hourly >= (smartConfig.max_analyses_per_hour || 50)) {
      this.debug('Skipping analysis: hourly limit reached', { count: this.analysisCount.hourly });
      return false;
    }

    // Check if exchange is significant
    if (smartConfig.only_significant_exchanges) {
      const toolCalls = exchange.toolCalls || [];
      const hasSignificantTools = toolCalls.some(t =>
        ['Write', 'Edit', 'MultiEdit', 'Bash', 'Task'].includes(t.name) ||
        (t.name === 'Bash' && JSON.stringify(t.input || {}).match(/test|build|npm|git/))
      );

      const hasUserMessage = exchange.userMessage && exchange.userMessage.trim().length > 10;
      const hasErrors = (exchange.toolResults || []).some(r => r.is_error);

      if (!hasSignificantTools && !hasUserMessage && !hasErrors) {
        this.debug('Skipping analysis: exchange not significant');
        return false;
      }
    }

    // Skip consecutive reads
    if (smartConfig.skip_consecutive_reads) {
      const exchangeType = this.classifyExchangeType(exchange);
      if (exchangeType === 'read' && this.lastExchangeType === 'read') {
        this.consecutiveReads++;
        if (this.consecutiveReads > 2) {
          this.debug('Skipping analysis: too many consecutive reads');
          return false;
        }
      } else {
        this.consecutiveReads = 0;
      }
      this.lastExchangeType = exchangeType;
    }

    return true;
  }

  /**
   * Classify exchange type for smart analysis
   */
  classifyExchangeType(exchange) {
    const toolCalls = exchange.toolCalls || [];
    if (toolCalls.some(t => ['Read', 'Glob', 'Grep'].includes(t.name))) return 'read';
    if (toolCalls.some(t => ['Write', 'Edit', 'MultiEdit'].includes(t.name))) return 'write';
    if (toolCalls.some(t => t.name === 'Bash')) return 'execute';
    if (toolCalls.some(t => t.name === 'Task')) return 'task';
    return 'other';
  }

  /**
   * Analyze exchange for trajectory state in real-time (Enhanced v2)
   * Now includes intent classification, goal extraction, and concept tracking
   */
  async analyzeTrajectoryState(exchange) {
    if (!this.config.trajectoryConfig.enabled) {
      return {
        state: this.currentState,
        intent: this.currentIntent,
        goal: this.sessionGoal,
        concepts: this.activeConcepts,
        confidence: 0,
        reasoning: 'Trajectory analysis disabled'
      };
    }

    // Check if we should analyze this exchange
    if (!this.shouldAnalyzeExchange(exchange)) {
      return {
        state: this.currentState,
        intent: this.currentIntent,
        goal: this.sessionGoal,
        concepts: this.activeConcepts,
        confidence: 0,
        reasoning: 'Skipped by smart analysis rules'
      };
    }

    // Increment analysis counter
    this.analysisCount.hourly++;

    try {
      const analysisStart = Date.now();

      // ENHANCED: Extract concepts from exchange (async, non-blocking)
      const conceptAnalysis = await this.analyzeExchangeConcepts(exchange);

      // ENHANCED: Perform intent classification and trajectory analysis in parallel
      const [trajectoryAnalysis, intentAnalysis, goalAnalysis] = await Promise.all([
        this.performTrajectoryStateAnalysis(exchange),
        this.performIntentClassification(exchange),
        this.extractSessionGoal(exchange)
      ]);

      const analysisTime = Date.now() - analysisStart;

      // Merge analyses into unified result
      const unifiedAnalysis = {
        state: trajectoryAnalysis.state || this.currentState,
        intent: intentAnalysis.intent || this.currentIntent,
        goal: goalAnalysis.goal || this.sessionGoal,
        concepts: conceptAnalysis.concepts || this.activeConcepts,
        confidence: (trajectoryAnalysis.confidence + intentAnalysis.confidence) / 2, // Average confidence
        reasoning: {
          state: trajectoryAnalysis.reasoning,
          intent: intentAnalysis.reasoning,
          goal: goalAnalysis.reasoning
        }
      };

      // Update trajectory state if confidence is high enough
      if (unifiedAnalysis.confidence >= (this.config.trajectoryConfig.intervention_threshold || 0.6)) {
        await this.updateEnhancedTrajectoryState(unifiedAnalysis, exchange);
      }

      this.debug('Enhanced trajectory analysis completed', {
        oldState: this.currentState,
        newState: unifiedAnalysis.state,
        oldIntent: this.currentIntent,
        newIntent: unifiedAnalysis.intent,
        goal: unifiedAnalysis.goal?.substring(0, 50),
        concepts: unifiedAnalysis.concepts?.map(c => c.name).slice(0, 5),
        confidence: unifiedAnalysis.confidence,
        analysisTime
      });

      return {
        ...unifiedAnalysis,
        analysisTime,
        timestamp: Date.now()
      };

    } catch (error) {
      console.error('Enhanced trajectory analysis failed:', error.message);
      return {
        state: this.currentState,
        intent: this.currentIntent,
        goal: this.sessionGoal,
        concepts: this.activeConcepts,
        confidence: 0,
        reasoning: `Analysis failed: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * ENHANCED: Extract concepts from exchange
   */
  async analyzeExchangeConcepts(exchange) {
    if (!this.conceptExtractor) {
      return { concepts: this.activeConcepts };
    }

    try {
      const conceptSummary = await this.conceptExtractor.extractFromExchange(exchange);
      return {
        concepts: conceptSummary.activeConcepts || [],
        learning: conceptSummary.learning || [],
        applying: conceptSummary.applying || []
      };
    } catch (error) {
      this.debug('Concept extraction failed:', error.message);
      return { concepts: this.activeConcepts };
    }
  }

  /**
   * ENHANCED: Perform intent classification
   */
  async performIntentClassification(exchange) {
    if (!this.inferenceEngine) {
      return this.heuristicIntentClassification(exchange);
    }

    try {
      const prompt = this.createIntentClassificationPrompt(exchange);
      const result = await this.inferenceEngine.infer(prompt, {
        maxTokens: 150,
        temperature: 0.3,
        responseFormat: 'json'
      });

      return this.parseIntentResult(result.content);
    } catch (error) {
      this.debug('Intent classification via inference failed, using heuristic:', error.message);
      return this.heuristicIntentClassification(exchange);
    }
  }

  /**
   * ENHANCED: Extract session goal from conversation
   */
  async extractSessionGoal(exchange) {
    // Only extract goal from user messages (not every exchange)
    const userMessage = exchange.userMessage || exchange.user || '';
    if (!userMessage || userMessage.length < 20) {
      return { goal: this.sessionGoal, reasoning: 'No user message to extract goal from' };
    }

    // Use heuristic for quick goal detection (skip LLM for performance)
    const goalIndicators = [
      'I want to', 'I need to', 'Can you', 'Please', 'Help me',
      'implement', 'create', 'build', 'fix', 'debug', 'refactor', 'optimize'
    ];

    const hasGoalIndicator = goalIndicators.some(indicator =>
      userMessage.toLowerCase().includes(indicator.toLowerCase())
    );

    if (!hasGoalIndicator) {
      return { goal: this.sessionGoal, reasoning: 'No goal indicator detected' };
    }

    // Extract first sentence as potential goal
    const sentences = userMessage.split(/[.!?]/);
    const firstSentence = sentences[0]?.trim();

    if (firstSentence && firstSentence.length > 15 && firstSentence.length < 500) {
      return {
        goal: firstSentence,
        reasoning: 'Extracted from user message first sentence'
      };
    }

    return { goal: this.sessionGoal, reasoning: 'No clear goal statement found' };
  }

  /**
   * ENHANCED: Perform trajectory state analysis (existing logic)
   */
  async performTrajectoryStateAnalysis(exchange) {
    // Use UnifiedInferenceEngine if available, otherwise fallback to legacy
    if (this.inferenceEngine) {
      return await this.performTrajectoryAnalysisWithUnifiedEngine(exchange);
    } else if (this.fastInferenceEngine?.initialized) {
      return await this.performTrajectoryAnalysisWithLegacyEngine(exchange);
    }

    return {
      state: this.currentState,
      confidence: 0,
      reasoning: 'No inference engine available'
    };
  }

  /**
   * Perform trajectory analysis with UnifiedInferenceEngine (new)
   */
  async performTrajectoryAnalysisWithUnifiedEngine(exchange) {
    try {
      const prompt = this.createTrajectoryAnalysisPrompt(exchange);
      const result = await this.inferenceEngine.infer(prompt, {
        maxTokens: 150,
        temperature: 0.3,
        responseFormat: 'json'
      });

      return this.parseTrajectoryResult(result.content);
    } catch (error) {
      this.debug('Trajectory analysis via UnifiedInferenceEngine failed:', error.message);
      return {
        state: this.currentState,
        confidence: 0,
        reasoning: `Analysis failed: ${error.message}`
      };
    }
  }

  /**
   * Perform trajectory analysis with legacy engine (existing)
   */
  async performTrajectoryAnalysisWithLegacyEngine(exchange) {
    try {
      const prompt = this.createTrajectoryAnalysisPrompt(exchange);
      const result = await this.performFastInference(prompt);
      return this.parseTrajectoryResult(result);
    } catch (error) {
      this.debug('Trajectory analysis via legacy engine failed:', error.message);
      return {
        state: this.currentState,
        confidence: 0,
        reasoning: `Analysis failed: ${error.message}`
      };
    }
  }

  /**
   * Create trajectory analysis prompt for fast inference
   */
  createTrajectoryAnalysisPrompt(exchange) {
    const userMessage = exchange.userMessage || '';
    const toolCalls = exchange.toolCalls || [];
    const toolResults = exchange.toolResults || [];
    
    // Build context about the exchange
    const context = {
      hasUserMessage: !!userMessage,
      userMessageLength: userMessage.length,
      toolCallCount: toolCalls.length,
      toolTypes: toolCalls.map(t => t.name || t.function?.name).filter(Boolean),
      hasErrors: toolResults.some(r => r.is_error),
      hasReadOperations: toolCalls.some(t => ['Read', 'Glob', 'Grep'].includes(t.name)),
      hasWriteOperations: toolCalls.some(t => ['Write', 'Edit', 'MultiEdit'].includes(t.name)),
      hasTestOperations: toolCalls.some(t => t.name === 'Bash' && JSON.stringify(t.input || {}).includes('test')),
      hasBuildOperations: toolCalls.some(t => t.name === 'Bash' && JSON.stringify(t.input || {}).includes('build'))
    };
    
    return `Analyze this Claude Code exchange and determine the trajectory state. Return only a JSON object.

Exchange Context:
- User message: ${userMessage.substring(0, 200)}${userMessage.length > 200 ? '...' : ''}
- Tool calls: ${context.toolTypes.join(', ') || 'none'}
- Read operations: ${context.hasReadOperations}
- Write operations: ${context.hasWriteOperations}
- Test operations: ${context.hasTestOperations}
- Build operations: ${context.hasBuildOperations}
- Errors: ${context.hasErrors}

Trajectory States:
- exploring: Information gathering, reading files, searching, understanding codebase
- implementing: Writing code, editing files, creating new functionality
- verifying: Testing, building, validating, checking results
- on_track: Productive progression toward goals
- off_track: Stuck, confused, going in wrong direction
- blocked: Errors preventing progress, intervention needed

Return JSON: {"state": "state_name", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;
  }

  /**
   * ENHANCED: Create intent classification prompt
   */
  createIntentClassificationPrompt(exchange) {
    const userMessage = exchange.userMessage || exchange.user || '';
    const toolCalls = exchange.toolCalls || [];

    return `Analyze this conversation exchange and classify the user's intent. Return only a JSON object.

User Message: ${userMessage.substring(0, 300)}${userMessage.length > 300 ? '...' : ''}
Tool Actions: ${toolCalls.map(t => t.name).join(', ') || 'none'}

Intent Categories:
- learning: Understanding new concepts, asking "what is", "how does", seeking explanations
- debugging: Fixing bugs, investigating errors, troubleshooting issues
- feature-dev: Implementing new features, building functionality, adding capabilities
- refactoring: Improving code structure, cleanup, reorganization without changing behavior
- testing: Writing tests, running tests, validating functionality
- optimization: Improving performance, reducing resource usage, speed improvements
- documentation: Writing docs, comments, README files
- exploration: Understanding existing code, browsing codebase, investigation

Return JSON: {"intent": "intent_name", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;
  }

  /**
   * ENHANCED: Heuristic intent classification (fallback when LLM unavailable)
   */
  heuristicIntentClassification(exchange) {
    const userMessage = (exchange.userMessage || exchange.user || '').toLowerCase();
    const toolCalls = exchange.toolCalls || [];

    // Keyword-based intent detection
    const intentKeywords = {
      learning: ['what is', 'how does', 'explain', 'teach me', 'learn about', 'understand'],
      debugging: ['error', 'bug', 'fix', 'debug', 'issue', 'problem', 'not working', 'broken'],
      'feature-dev': ['implement', 'create', 'add', 'build', 'new feature', 'develop'],
      refactoring: ['refactor', 'cleanup', 'reorganize', 'improve structure', 'clean up'],
      testing: ['test', 'unit test', 'integration test', 'jest', 'mocha', 'pytest'],
      optimization: ['optimize', 'performance', 'faster', 'improve speed', 'reduce memory'],
      documentation: ['document', 'readme', 'comment', 'doc', 'documentation'],
      exploration: ['show me', 'find', 'search', 'look for', 'where is']
    };

    // Check keywords
    let maxScore = 0;
    let detectedIntent = 'exploration';

    for (const [intent, keywords] of Object.entries(intentKeywords)) {
      const score = keywords.filter(kw => userMessage.includes(kw)).length;
      if (score > maxScore) {
        maxScore = score;
        detectedIntent = intent;
      }
    }

    // Tool-based intent detection
    const hasErrors = (exchange.toolResults || []).some(r => r.is_error);
    const hasWrites = toolCalls.some(t => ['Write', 'Edit', 'MultiEdit'].includes(t.name));
    const hasTests = toolCalls.some(t => t.name === 'Bash' && JSON.stringify(t.input || {}).includes('test'));

    if (hasErrors && maxScore === 0) {
      detectedIntent = 'debugging';
      maxScore = 1;
    } else if (hasWrites && maxScore === 0) {
      detectedIntent = 'feature-dev';
      maxScore = 1;
    } else if (hasTests) {
      detectedIntent = 'testing';
      maxScore = 1;
    }

    const confidence = maxScore > 0 ? 0.6 : 0.3; // Heuristic is less confident than LLM

    return {
      intent: detectedIntent,
      confidence,
      reasoning: `Heuristic detection based on ${maxScore > 0 ? 'keywords/tools' : 'default'}`
    };
  }

  /**
   * ENHANCED: Parse intent classification result
   */
  parseIntentResult(result) {
    try {
      // Clean and extract JSON
      let cleanResult = result.trim();
      const jsonMatch = cleanResult.match(/\{[^}]*"intent"[^}]*\}/);
      if (jsonMatch) {
        cleanResult = jsonMatch[0];
      }

      const parsed = JSON.parse(cleanResult);

      return {
        intent: parsed.intent || this.currentIntent,
        confidence: Math.min(Math.max(parsed.confidence || 0, 0), 1),
        reasoning: parsed.reasoning || 'No reasoning provided'
      };
    } catch (error) {
      this.debug('Failed to parse intent result, using heuristic fallback:', error.message);
      // Use stored exchange for fallback (would need to pass exchange here - simplified for now)
      return {
        intent: this.currentIntent,
        confidence: 0,
        reasoning: 'Failed to parse analysis result'
      };
    }
  }

  /**
   * Perform fast inference using configured provider with fallback
   */
  async performFastInference(prompt) {
    // Try primary provider first
    try {
      return await this.performInferenceWithProvider(prompt, this.fastInferenceEngine);
    } catch (error) {
      this.debug('Primary provider failed, trying fallback', {
        primaryProvider: this.fastInferenceEngine.provider,
        error: error.message
      });

      // Try fallback provider
      const fallbackConfig = this.config.trajectoryConfig;
      if (fallbackConfig.fallback_provider && fallbackConfig.fallback_model) {
        const fallbackApiKey = this.getApiKeyForProvider(fallbackConfig.fallback_provider);
        if (fallbackApiKey) {
          const fallbackEngine = {
            provider: fallbackConfig.fallback_provider,
            model: fallbackConfig.fallback_model,
            apiKey: fallbackApiKey,
            baseUrl: this.getBaseUrlForProvider(fallbackConfig.fallback_provider)
          };

          try {
            const result = await this.performInferenceWithProvider(prompt, fallbackEngine);
            this.debug('Fallback provider succeeded', { provider: fallbackConfig.fallback_provider });
            return result;
          } catch (fallbackError) {
            this.debug('Fallback provider also failed', { error: fallbackError.message });
            throw fallbackError;
          }
        }
      }

      // If we get here, both primary and fallback failed
      throw error;
    }
  }

  /**
   * Perform inference with specific provider configuration
   */
  async performInferenceWithProvider(prompt, engine) {
    const { provider, model, apiKey, baseUrl } = engine;
    
    const requestBody = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
      temperature: 0.3
    };
    
    const url = `${baseUrl}/chat/completions`;
    
    // Debug logging
    this.debug('Making API request to Groq', {
      url,
      model,
      provider,
      hasApiKey: !!apiKey
    });
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      this.debug('API request failed', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        url,
        model
      });
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '{}';
  }

  /**
   * Parse trajectory result from inference response
   */
  parseTrajectoryResult(result) {
    try {
      this.debug('Raw API response:', result);
      
      let cleanResult = result.trim();
      
      // Look for JSON within the response
      const jsonMatch = cleanResult.match(/\{[^}]*"state"[^}]*\}/);
      if (jsonMatch) {
        cleanResult = jsonMatch[0];
        this.debug('Extracted JSON via regex:', cleanResult);
      } else {
        // Try to extract JSON from markdown code blocks
        if (cleanResult.includes('```json')) {
          const jsonStart = cleanResult.indexOf('```json') + 7;
          const jsonEnd = cleanResult.indexOf('```', jsonStart);
          if (jsonEnd > jsonStart) {
            cleanResult = cleanResult.slice(jsonStart, jsonEnd).trim();
            this.debug('Extracted JSON from markdown:', cleanResult);
          }
        } else if (cleanResult.includes('```')) {
          const jsonStart = cleanResult.indexOf('```') + 3;
          const jsonEnd = cleanResult.indexOf('```', jsonStart);
          if (jsonEnd > jsonStart) {
            cleanResult = cleanResult.slice(jsonStart, jsonEnd).trim();
            this.debug('Extracted JSON from code blocks:', cleanResult);
          }
        }
      }
      
      const parsed = JSON.parse(cleanResult);
      this.debug('Successfully parsed JSON:', parsed);
      
      return {
        state: parsed.state || this.currentState,
        confidence: Math.min(Math.max(parsed.confidence || 0, 0), 1),
        reasoning: parsed.reasoning || 'No reasoning provided'
      };
    } catch (error) {
      this.debug('Failed to parse trajectory result:', error.message);
      this.debug('Raw result:', result);
      return {
        state: this.currentState,
        confidence: 0,
        reasoning: 'Failed to parse analysis result'
      };
    }
  }

  /**
   * ENHANCED: Update trajectory state with intent, goal, and concepts
   */
  async updateEnhancedTrajectoryState(analysis, exchange) {
    const previousState = this.currentState;
    const previousIntent = this.currentIntent;
    const stateChanged = analysis.state !== previousState;
    const intentChanged = analysis.intent !== previousIntent;

    // Update current values
    this.currentState = analysis.state;
    this.currentIntent = analysis.intent;
    this.sessionGoal = analysis.goal || this.sessionGoal;
    this.activeConcepts = analysis.concepts || this.activeConcepts;
    this.confidence = analysis.confidence;

    // Track state transition
    if (stateChanged) {
      const stateTransition = {
        timestamp: Date.now(),
        from: previousState,
        to: analysis.state,
        intent: analysis.intent,
        confidence: analysis.confidence,
        reasoning: typeof analysis.reasoning === 'object' ? analysis.reasoning.state : analysis.reasoning,
        exchangeId: exchange.id,
        exchangeTimestamp: exchange.timestamp
      };

      this.stateHistory.push(stateTransition);
      await this.persistStateTransition(stateTransition);
    }

    // Track intent transition
    if (intentChanged) {
      const intentTransition = {
        intent: analysis.intent,
        timestamp: Date.now(),
        confidence: analysis.confidence,
        trigger: this.determineIntentTrigger(exchange, analysis)
      };

      this.intentHistory.push(intentTransition);

      this.debug('Intent transitioned', {
        from: previousIntent,
        to: analysis.intent,
        confidence: analysis.confidence
      });
    }

    // Update live state file (now includes v2 fields)
    await this.updateLiveStateV2();

    if (stateChanged || intentChanged) {
      this.debug('Enhanced trajectory state updated', {
        stateChanged,
        intentChanged,
        state: analysis.state,
        intent: analysis.intent,
        goal: analysis.goal?.substring(0, 50),
        conceptCount: analysis.concepts?.length
      });
    }
  }

  /**
   * Determine what triggered the intent change
   */
  determineIntentTrigger(exchange, analysis) {
    const userMessage = (exchange.userMessage || exchange.user || '').toLowerCase();
    const hasErrors = (exchange.toolResults || []).some(r => r.is_error);

    if (this.intentHistory.length === 0) {
      return 'session-start';
    }

    if (hasErrors) {
      return 'error-message-detected';
    }

    if (userMessage.includes('?') || userMessage.includes('what') || userMessage.includes('how')) {
      return 'question-asked';
    }

    if (exchange.toolCalls?.some(t => ['Write', 'Edit', 'MultiEdit'].includes(t.name))) {
      return 'implementation-started';
    }

    // Check if user explicitly mentioned the intent
    if (userMessage.includes(analysis.intent)) {
      return 'user-explicit';
    }

    return 'natural-transition';
  }

  /**
   * Update trajectory state and persist changes (LEGACY - backward compatible)
   */
  async updateTrajectoryState(newState, analysis, exchange) {
    const previousState = this.currentState;

    if (newState !== previousState) {
      this.currentState = newState;

      const stateTransition = {
        timestamp: Date.now(),
        from: previousState,
        to: newState,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        exchangeId: exchange.id,
        exchangeTimestamp: exchange.timestamp
      };

      this.stateHistory.push(stateTransition);

      // Persist state transition
      await this.persistStateTransition(stateTransition);

      // Update live state file
      await this.updateLiveState();

      this.debug('Trajectory state updated', {
        from: previousState,
        to: newState,
        confidence: analysis.confidence
      });
    }
  }

  /**
   * Get current trajectory state with metadata (Enhanced v2 with intent, goal, concepts)
   */
  getCurrentTrajectoryState() {
    const stateConfig = this.config.trajectoryConfig.trajectory_states?.[this.currentState] || {};

    // CRITICAL FIX: Read actual trajectory file's lastUpdate instead of using internal lastAnalysisTime
    // to ensure health monitoring gets accurate timestamps
    let actualLastUpdate = this.lastAnalysisTime;
    try {
      const trajectoryFile = path.join(this.config.projectPath, '.specstory', 'trajectory', 'live-state.json');
      if (fs.existsSync(trajectoryFile)) {
        const trajectoryData = JSON.parse(fs.readFileSync(trajectoryFile, 'utf8'));
        actualLastUpdate = trajectoryData.lastUpdate || this.lastAnalysisTime;
      }
    } catch (error) {
      // Fallback to internal timestamp if file read fails
      actualLastUpdate = this.lastAnalysisTime;
    }

    return {
      // Core trajectory state (v1 fields - backward compatible)
      state: this.currentState,
      icon: stateConfig.icon || '❓',
      description: stateConfig.description || 'Unknown state',
      lastUpdate: actualLastUpdate,
      stateHistory: this.stateHistory.slice(-5), // Last 5 transitions
      interventionCount: this.interventionCount,

      // Enhanced trajectory state (v2 fields - new)
      intent: this.currentIntent,
      goal: this.sessionGoal,
      concepts: this.activeConcepts.slice(0, 10), // Top 10 concepts
      confidence: this.confidence,
      intentHistory: this.intentHistory.slice(-5), // Last 5 intent transitions

      // Analysis health (updated with new engines)
      analysisHealth: {
        hourlyCount: this.analysisCount.hourly,
        hourlyLimit: this.config.trajectoryConfig.smart_analysis?.max_analyses_per_hour || 50,
        primaryProvider: this.inferenceEngine ? 'UnifiedInferenceEngine' : (this.fastInferenceEngine?.provider || 'none'),
        fallbackProvider: this.config.trajectoryConfig.fallback_provider || 'none',
        engineStatus: (this.inferenceEngine || this.fastInferenceEngine?.initialized) ? 'healthy' : 'degraded',
        conceptExtractorStatus: this.conceptExtractor ? 'healthy' : 'degraded'
      }
    };
  }

  /**
   * Persist state transition to log file
   */
  async persistStateTransition(transition) {
    try {
      const transitionsFile = path.join(this.trajectoryDir, 'session-transitions.log');
      const logEntry = JSON.stringify(transition) + '\n';
      fs.appendFileSync(transitionsFile, logEntry);
    } catch (error) {
      console.error('Failed to persist state transition:', error.message);
    }
  }

  /**
   * Update live state file (Enhanced v2 schema with intent, goal, concepts)
   */
  async updateLiveStateV2() {
    try {
      const liveStateFile = path.join(this.trajectoryDir, 'live-state.json');
      const liveState = {
        schemaVersion: '2.0.0',
        currentState: this.currentState,
        intent: this.currentIntent,
        goal: this.sessionGoal,
        concepts: this.activeConcepts.slice(0, 10), // Max 10 concepts
        confidence: this.confidence,
        intentHistory: this.intentHistory.slice(-10), // Last 10 intent transitions
        lastUpdate: Date.now(),
        projectPath: this.config.projectPath,
        stateHistory: this.stateHistory.slice(-10).map(s => ({
          state: s.to,
          timestamp: s.timestamp,
          duration: s.duration,
          intent: s.intent
        })),
        interventionCount: this.interventionCount,
        sessionInfo: {
          startTime: this.stateHistory[0]?.timestamp || this.intentHistory[0]?.timestamp || Date.now(),
          totalTransitions: this.stateHistory.length,
          intentTransitions: this.intentHistory.length,
          conceptsLearned: this.activeConcepts.filter(c => c.isLearning).length,
          conceptsApplied: this.activeConcepts.filter(c => !c.isLearning).length
        }
      };

      fs.writeFileSync(liveStateFile, JSON.stringify(liveState, null, 2));
    } catch (error) {
      console.error('Failed to update live state v2:', error.message);
    }
  }

  /**
   * Update live state file (LEGACY v1 schema - backward compatible)
   */
  async updateLiveState() {
    try {
      const liveStateFile = path.join(this.trajectoryDir, 'live-state.json');
      const liveState = {
        currentState: this.currentState,
        lastUpdate: Date.now(),
        projectPath: this.config.projectPath,
        stateHistory: this.stateHistory.slice(-10), // Last 10 transitions
        interventionCount: this.interventionCount,
        sessionInfo: {
          startTime: this.stateHistory[0]?.timestamp || Date.now(),
          totalTransitions: this.stateHistory.length
        }
      };

      fs.writeFileSync(liveStateFile, JSON.stringify(liveState, null, 2));
    } catch (error) {
      console.error('Failed to update live state:', error.message);
    }
  }

  /**
   * Check if intervention is needed based on trajectory analysis
   */
  shouldIntervene(analysis) {
    // Intervene if confidence is high and state indicates problems
    const problematicStates = ['off_track', 'blocked'];
    return problematicStates.includes(analysis.state) && 
           analysis.confidence >= this.config.trajectoryConfig.intervention_threshold;
  }

  /**
   * Generate intervention guidance
   */
  generateInterventionGuidance(analysis, exchange) {
    const guidance = {
      shouldIntervene: this.shouldIntervene(analysis),
      interventionType: 'trajectory_redirection',
      message: '',
      urgency: analysis.confidence > 0.9 ? 'high' : 'medium'
    };
    
    switch (analysis.state) {
      case 'off_track':
        guidance.message = `🔄 Trajectory redirection suggested: ${analysis.reasoning}`;
        break;
      case 'blocked':
        guidance.message = `🚫 Intervention needed: ${analysis.reasoning}`;
        guidance.urgency = 'high';
        break;
      default:
        guidance.message = `ℹ️ Trajectory note: ${analysis.reasoning}`;
    }
    
    if (guidance.shouldIntervene) {
      this.interventionCount++;
    }
    
    return guidance;
  }

  /**
   * Start heartbeat to keep live-state.json fresh
   * Updates the file every 30 minutes to prevent staleness detection
   */
  startHeartbeat() {
    // Update every 30 minutes (half the 1-hour staleness threshold)
    const heartbeatInterval = 30 * 60 * 1000;

    this.heartbeatTimer = setInterval(() => {
      this.updateLiveState();
      this.debug('Heartbeat: Updated live-state.json');
    }, heartbeatInterval);

    // Initial update immediately
    this.updateLiveState();
  }

  /**
   * Stop heartbeat timer (for cleanup)
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.debug('Heartbeat stopped');
    }
  }

  /**
   * Debug logging
   */
  debug(message, data = null) {
    if (this.debugEnabled || this.config?.debug) {
      console.error(`[RealTimeTrajectoryAnalyzer] ${new Date().toISOString()} ${message}`);
      if (data) {
        console.error('  Data:', data);
      }
    }
  }
}

export default RealTimeTrajectoryAnalyzer;