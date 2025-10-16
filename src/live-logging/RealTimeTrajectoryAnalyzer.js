/**
 * Real-Time Trajectory Analyzer
 * 
 * Provides real-time trajectory state analysis for Claude Code conversations,
 * replacing the 6-hourly semantic analysis with continuous monitoring.
 * Integrates with the Enhanced Transcript Monitor to provide live trajectory
 * tracking, intervention capabilities, and multi-project coordination.
 */

import path from 'path';
import fs from 'fs';

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

    // Smart analysis tracking
    this.analysisCount = { hourly: 0, hourStart: Date.now() };
    this.lastExchangeType = null;
    this.consecutiveReads = 0;
    
    // Initialize fast inference engine
    this.fastInferenceEngine = null;
    this.initializeFastInference();
    
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
   * Initialize fast inference engine for real-time analysis
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
   * Analyze exchange for trajectory state in real-time
   */
  async analyzeTrajectoryState(exchange) {
    if (!this.config.trajectoryConfig.enabled) {
      return { state: this.currentState, confidence: 0, reasoning: 'Trajectory analysis disabled' };
    }

    if (!this.fastInferenceEngine?.initialized) {
      return { state: this.currentState, confidence: 0, reasoning: 'Fast inference engine not available' };
    }

    // Check if we should analyze this exchange
    if (!this.shouldAnalyzeExchange(exchange)) {
      return { state: this.currentState, confidence: 0, reasoning: 'Skipped by smart analysis rules' };
    }

    // Increment analysis counter
    this.analysisCount.hourly++;

    try {
      const analysisStart = Date.now();
      
      // Create analysis prompt
      const prompt = this.createTrajectoryAnalysisPrompt(exchange);
      
      // Perform fast inference
      const result = await this.performFastInference(prompt);
      
      const analysisTime = Date.now() - analysisStart;
      
      // Parse trajectory state from result
      const trajectoryAnalysis = this.parseTrajectoryResult(result);
      
      // Update current state if confidence is high enough
      if (trajectoryAnalysis.confidence >= this.config.trajectoryConfig.intervention_threshold) {
        await this.updateTrajectoryState(trajectoryAnalysis.state, trajectoryAnalysis, exchange);
      }
      
      this.debug('Trajectory analysis completed', {
        oldState: this.currentState,
        newState: trajectoryAnalysis.state,
        confidence: trajectoryAnalysis.confidence,
        analysisTime
      });
      
      return {
        ...trajectoryAnalysis,
        analysisTime,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error('Trajectory analysis failed:', error.message);
      return { 
        state: this.currentState, 
        confidence: 0, 
        reasoning: `Analysis failed: ${error.message}`,
        error: error.message
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
   * Update trajectory state and persist changes
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
   * Get current trajectory state with metadata
   */
  getCurrentTrajectoryState() {
    const stateConfig = this.config.trajectoryConfig.trajectory_states?.[this.currentState] || {};

    // CRITICAL FIX: Read actual trajectory file's lastUpdate instead of using internal lastAnalysisTime
    // to ensure health monitoring gets accurate timestamps
    let actualLastUpdate = this.lastAnalysisTime;
    try {
      const trajectoryFile = path.join(this.projectPath, '.specstory', 'trajectory', 'live-state.json');
      if (fs.existsSync(trajectoryFile)) {
        const trajectoryData = JSON.parse(fs.readFileSync(trajectoryFile, 'utf8'));
        actualLastUpdate = trajectoryData.lastUpdate || this.lastAnalysisTime;
      }
    } catch (error) {
      // Fallback to internal timestamp if file read fails
      actualLastUpdate = this.lastAnalysisTime;
    }

    return {
      state: this.currentState,
      icon: stateConfig.icon || '❓',
      description: stateConfig.description || 'Unknown state',
      lastUpdate: actualLastUpdate,
      stateHistory: this.stateHistory.slice(-5), // Last 5 transitions
      interventionCount: this.interventionCount,
      analysisHealth: {
        hourlyCount: this.analysisCount.hourly,
        hourlyLimit: this.config.trajectoryConfig.smart_analysis?.max_analyses_per_hour || 50,
        primaryProvider: this.fastInferenceEngine?.provider || 'none',
        fallbackProvider: this.config.trajectoryConfig.fallback_provider || 'none',
        engineStatus: this.fastInferenceEngine?.initialized ? 'healthy' : 'degraded'
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
   * Update live state file
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