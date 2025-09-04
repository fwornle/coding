#!/usr/bin/env node

/**
 * Claude Code Transcript Monitor
 * Monitors Claude Code's built-in transcript files for new exchanges
 * Based on claude-code-tamagotchi approach for live conversation capture
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SemanticAnalyzer } from '../src/live-logging/SemanticAnalyzer.js';

// Load configuration
let globalConfig = {};
try {
  const configPath = path.join(process.cwd(), 'config', 'live-logging-config.json');
  if (fs.existsSync(configPath)) {
    globalConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (error) {
  console.error('Warning: Could not load configuration, using defaults');
}

class TranscriptMonitor {
  constructor(config = {}) {
    // Merge global configuration with local overrides
    const apiKeyVars = globalConfig.api_key_env_vars || ['GROQ_API_KEY', 'GROK_API_KEY', 'XAI_API_KEY'];
    let apiKey = null;
    for (const envVar of apiKeyVars) {
      if (process.env[envVar]) {
        apiKey = process.env[envVar];
        break;
      }
    }

    this.config = {
      semanticApiKey: config.semanticApiKey || apiKey,
      checkInterval: config.checkInterval || globalConfig.live_logging?.transcript_monitoring?.polling_interval || 5000,
      maxProcessBatch: config.maxProcessBatch || 10,
      projectPath: config.projectPath || process.cwd(),
      debug: config.debug || process.env.TRANSCRIPT_DEBUG === 'true',
      sessionDuration: globalConfig.live_logging?.session_duration || 3600000, // 60 minutes
      ...config
    };
    
    this.globalConfig = globalConfig;

    this.transcriptPath = this.findCurrentTranscript();
    this.lastProcessedUuid = null;
    this.lastFileSize = 0;
    this.isProcessing = false;
    this.currentSessionFile = null;
    this.sessionStartTime = null;
    this.sessionDuration = this.config.sessionDuration;
    
    // Initialize semantic analyzer if API key available
    this.semanticAnalyzer = this.config.semanticApiKey ? new SemanticAnalyzer(this.config.semanticApiKey) : null;
    
    // Secret redaction patterns
    this.secretPatterns = [
      /sk-ant-[a-zA-Z0-9\-_]{20,}/g,    // Anthropic keys
      /sk-proj-[a-zA-Z0-9]{20,}/g,      // OpenAI keys  
      /xai-[a-zA-Z0-9]{20,}/g,          // XAI/Grok keys
      /gsk_[a-zA-Z0-9]{20,}/g,          // Grok keys (actual format)
      /[A-Za-z0-9]{32,}/g,              // Generic long keys
    ];
  }

  /**
   * Find the current session's transcript file
   */
  findCurrentTranscript() {
    const baseDir = path.join(os.homedir(), '.claude', 'projects');
    
    // Find project directory based on current path
    const projectName = this.getProjectDirName();
    const projectDir = path.join(baseDir, projectName);
    
    if (!fs.existsSync(projectDir)) {
      this.debug(`Project directory not found: ${projectDir}`);
      return null;
    }

    try {
      // Find the most recently modified transcript file
      const files = fs.readdirSync(projectDir)
        .filter(file => file.endsWith('.jsonl'))
        .map(file => {
          const filePath = path.join(projectDir, file);
          const stats = fs.statSync(filePath);
          return {
            path: filePath,
            mtime: stats.mtime,
            size: stats.size
          };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) {
        this.debug('No transcript files found');
        return null;
      }

      // Return the most recent file that's been modified within last hour
      const mostRecent = files[0];
      const timeDiff = Date.now() - mostRecent.mtime.getTime();
      
      if (timeDiff < this.config.sessionDuration) { // Configurable session duration
        this.debug(`Using transcript: ${mostRecent.path}`);
        return mostRecent.path;
      }

      this.debug('No recent transcript files found');
      return null;
    } catch (error) {
      this.debug(`Error finding transcript: ${error.message}`);
      return null;
    }
  }

  /**
   * Get project directory name from current working directory
   */
  getProjectDirName() {
    // Convert project path to Claude's naming convention
    // /Users/q284340/Agentic/coding -> -Users-q284340-Agentic-coding
    const normalized = this.config.projectPath.replace(/\//g, '-');
    return normalized.startsWith('-') ? normalized : '-' + normalized;
  }

  /**
   * Read transcript messages from JSONL file
   */
  readTranscriptMessages(transcriptPath) {
    if (!fs.existsSync(transcriptPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      const messages = [];

      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          // Apply secret redaction
          const redactedMessage = this.redactSecrets(message);
          messages.push(redactedMessage);
        } catch (error) {
          // Skip malformed lines
          continue;
        }
      }

      return messages;
    } catch (error) {
      this.debug(`Error reading transcript: ${error.message}`);
      return [];
    }
  }

  /**
   * Redact secrets from message content
   */
  redactSecrets(message) {
    const messageStr = JSON.stringify(message);
    let redactedStr = messageStr;

    // Apply all secret patterns
    this.secretPatterns.forEach(pattern => {
      redactedStr = redactedStr.replace(pattern, (match) => {
        // Preserve first 4 and last 4 characters, redact middle
        if (match.length > 8) {
          return `${match.slice(0, 4)}...<REDACTED>...${match.slice(-4)}`;
        } else {
          return '<REDACTED>';
        }
      });
    });

    try {
      return JSON.parse(redactedStr);
    } catch (error) {
      // If parsing fails after redaction, return original with basic redaction
      return this.basicSecretRedaction(message);
    }
  }

  /**
   * Basic secret redaction as fallback
   */
  basicSecretRedaction(obj) {
    if (typeof obj === 'string') {
      let redacted = obj;
      this.secretPatterns.forEach(pattern => {
        redacted = redacted.replace(pattern, '<REDACTED-KEY>');
      });
      return redacted;
    } else if (Array.isArray(obj)) {
      return obj.map(item => this.basicSecretRedaction(item));
    } else if (obj && typeof obj === 'object') {
      const redacted = {};
      for (const [key, value] of Object.entries(obj)) {
        redacted[key] = this.basicSecretRedaction(value);
      }
      return redacted;
    }
    return obj;
  }

  /**
   * Extract conversation exchanges from messages
   */
  extractExchanges(messages) {
    const exchanges = [];
    let currentExchange = null;

    for (const message of messages) {
      if (message.type === 'user' && message.message?.role === 'user') {
        // Start new exchange with user message
        if (currentExchange) {
          exchanges.push(currentExchange);
        }
        currentExchange = {
          id: message.uuid,
          timestamp: message.timestamp || Date.now(),
          userMessage: this.extractTextContent(message.message.content) || '',
          claudeResponse: '',
          toolCalls: [],
          toolResults: []
        };
      } else if (message.type === 'assistant' && currentExchange) {
        // Add Claude's response
        if (message.message?.content) {
          if (Array.isArray(message.message.content)) {
            for (const item of message.message.content) {
              if (item.type === 'text') {
                currentExchange.claudeResponse += item.text + '\n';
              } else if (item.type === 'tool_use') {
                currentExchange.toolCalls.push({
                  name: item.name,
                  input: item.input,
                  id: item.id
                });
              }
            }
          } else if (typeof message.message.content === 'string') {
            currentExchange.claudeResponse = message.message.content;
          }
        }
      } else if (message.type === 'user' && message.message?.content && Array.isArray(message.message.content)) {
        // Check for tool results
        for (const item of message.message.content) {
          if (item.type === 'tool_result' && currentExchange) {
            currentExchange.toolResults.push({
              tool_use_id: item.tool_use_id,
              content: item.content,
              is_error: item.is_error || false
            });
          }
        }
      }
    }

    // Add final exchange
    if (currentExchange) {
      exchanges.push(currentExchange);
    }

    return exchanges;
  }

  /**
   * Extract text content from message content array
   */
  extractTextContent(content) {
    if (typeof content === 'string') {
      return content;
    } else if (Array.isArray(content)) {
      return content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');
    }
    return '';
  }

  /**
   * Get unprocessed exchanges since last check
   */
  getUnprocessedExchanges() {
    if (!this.transcriptPath) {
      return [];
    }

    const messages = this.readTranscriptMessages(this.transcriptPath);
    if (messages.length === 0) {
      return [];
    }

    const exchanges = this.extractExchanges(messages);
    
    if (!this.lastProcessedUuid) {
      // First run - return last few exchanges
      return exchanges.slice(-this.config.maxProcessBatch);
    }

    // Find index of last processed exchange
    const lastIndex = exchanges.findIndex(ex => ex.id === this.lastProcessedUuid);
    if (lastIndex >= 0) {
      // Return exchanges after the last processed one
      return exchanges.slice(lastIndex + 1, lastIndex + 1 + this.config.maxProcessBatch);
    }

    // If we can't find the last processed, return recent ones
    return exchanges.slice(-this.config.maxProcessBatch);
  }

  /**
   * Check if transcript file has new content
   */
  hasNewContent() {
    if (!this.transcriptPath) {
      return false;
    }

    try {
      const stats = fs.statSync(this.transcriptPath);
      const hasNew = stats.size !== this.lastFileSize;
      this.lastFileSize = stats.size;
      return hasNew;
    } catch (error) {
      return false;
    }
  }

  /**
   * Process new exchanges with semantic analysis
   */
  async processExchanges(exchanges) {
    if (!exchanges || exchanges.length === 0) {
      return;
    }

    this.debug(`Processing ${exchanges.length} new exchanges`);

    for (const exchange of exchanges) {
      try {
        // Process each tool call in the exchange
        for (const toolCall of exchange.toolCalls) {
          // Find corresponding result
          const result = exchange.toolResults.find(r => r.tool_use_id === toolCall.id);
          
          // Analyze with semantic analyzer if available
          let analysis = null;
          if (this.semanticAnalyzer && !result?.is_error) {
            const interaction = {
              toolName: toolCall.name,
              toolInput: toolCall.input,
              toolResult: result?.content || null,
              success: !result?.is_error
            };
            
            const context = {
              userRequest: exchange.userMessage?.slice(0, 200) || 'Unknown request',
              previousActions: []
            };

            analysis = await this.semanticAnalyzer.analyzeToolInteraction(interaction, context);
          }

          // Generate log entry
          await this.logExchange(exchange, toolCall, result, analysis);
        }

        // Update last processed
        this.lastProcessedUuid = exchange.id;
      } catch (error) {
        this.debug(`Error processing exchange ${exchange.id}: ${error.message}`);
      }
    }
  }

  /**
   * Determine if content should be routed to coding repo
   * ONLY route if actually modifying files in the coding project
   */
  async shouldRouteToCodingRepo(exchange, toolCall) {
    // Always use local repo if we're already in the coding repo
    if (this.config.projectPath.includes('/coding')) {
      return false;
    }

    // Only route if we're actually modifying files in the coding repo
    const toolInputStr = JSON.stringify(toolCall.input || {});
    const codingPathPatterns = [
      '/Users/q284340/Agentic/coding/',
      'coding/scripts/',
      'coding/bin/',
      'coding/src/',
      'coding/.specstory/',
      'coding/integrations/'
    ];

    // Check if tool is modifying/creating files in coding repo
    if (toolCall.name === 'Edit' || toolCall.name === 'Write' || toolCall.name === 'MultiEdit') {
      const filePath = toolCall.input?.file_path || '';
      for (const pattern of codingPathPatterns) {
        if (filePath.includes(pattern)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get the appropriate session file based on content routing
   */
  async getRoutedSessionFile(exchange, toolCall) {
    const shouldRouteToCoding = await this.shouldRouteToCodingRepo(exchange, toolCall);
    
    if (shouldRouteToCoding) {
      // Route to coding repo
      const codingRepo = process.env.CODING_TOOLS_PATH || '/Users/q284340/Agentic/coding';
      const originalProjectPath = this.config.projectPath;
      
      // Temporarily switch to coding repo path
      this.config.projectPath = codingRepo;
      const sessionFile = await this.getCurrentSessionFile();
      
      // Restore original path
      this.config.projectPath = originalProjectPath;
      
      console.log(`🔀 Routing to coding repo: ${path.basename(sessionFile)}`);
      return sessionFile;
    }
    
    // Use default project path
    return await this.getCurrentSessionFile();
  }

  /**
   * Log exchange to session file
   */
  async logExchange(exchange, toolCall, result, analysis) {
    const sessionFile = await this.getRoutedSessionFile(exchange, toolCall);
    
    // Generate exchange entry
    const exchangeTime = this.formatTimestamp(exchange.timestamp);
    const toolSuccess = result && !result.is_error;
    const analysisInsight = analysis?.insight || 'No analysis available';
    
    const content = `### ${toolCall.name} - ${exchangeTime}

**User Request:** ${exchange.userMessage?.slice(0, 150) || 'No context'}${exchange.userMessage?.length > 150 ? '...' : ''}

**Tool:** ${toolCall.name}  
**Input:** \`\`\`json
${JSON.stringify(toolCall.input, null, 2)}
\`\`\`

**Result:** ${toolSuccess ? '✅ Success' : '❌ Error'}
${result?.content ? `**Output:** \`\`\`\n${typeof result.content === 'string' ? result.content.slice(0, 300) : JSON.stringify(result.content, null, 2).slice(0, 300)}\n\`\`\`` : ''}

**AI Analysis:** ${analysisInsight}

---

`;

    // Append to current 60-minute session file
    fs.appendFileSync(sessionFile, content);
    
    const sessionFileName = path.basename(sessionFile);
    console.log(`[TranscriptMonitor] ${exchangeTime} Logged exchange to: ${sessionFileName}`);
    this.debug(`Logged exchange to: ${sessionFileName}`);
  }

  /**
   * Get current session file path (create new session if needed)
   */
  async getCurrentSessionFile() {
    const now = new Date();
    
    // Calculate current time tranche
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    const trancheStart = Math.floor((totalMinutes + 30) / 60) * 60 - 30;
    const trancheEnd = trancheStart + 60;
    const startHour = Math.floor(trancheStart / 60);
    const startMin = trancheStart % 60;
    const endHour = Math.floor(trancheEnd / 60);
    const endMin = trancheEnd % 60;
    const formatTime = (h, m) => `${h.toString().padStart(2, '0')}${m.toString().padStart(2, '0')}`;
    const currentTranche = `${formatTime(startHour, startMin)}-${formatTime(endHour, endMin)}`;
    
    // Check if we need a new session (no current session or different tranche)
    const needNewSession = !this.currentSessionFile || 
                           !this.currentSessionFile.includes(currentTranche) ||
                           !this.currentSessionFile.includes(now.toISOString().split('T')[0]); // Also check date
    
    if (needNewSession) {
      
      // Create new session using calculated tranche
      const date = now.toISOString().split('T')[0];
      const sessionFileName = `${date}_${currentTranche}-session.md`;
      
      this.currentSessionFile = path.join(this.config.projectPath, '.specstory', 'history', sessionFileName);
      this.sessionStartTime = now;
      
      // Create session header if file doesn't exist
      if (!fs.existsSync(this.currentSessionFile)) {
        const sessionHeader = `# WORK SESSION (${currentTranche})\n\n` +
          `**Generated:** ${this.formatTimestamp(now.getTime())}\n` +
          `**Work Period:** ${currentTranche}\n` +
          `**Focus:** Live session logging\n` +
          `**Duration:** ~60 minutes\n\n` +
          `---\n\n## Session Overview\n\n` +
          `This session captures real-time tool interactions and exchanges.\n\n` +
          `---\n\n## Key Activities\n\n`;
        
        // Ensure directory exists
        const dir = path.dirname(this.currentSessionFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(this.currentSessionFile, sessionHeader);
        console.log(`📝 Started new 60-minute session: ${path.basename(this.currentSessionFile)}`);
        
        // First, update the previous trajectory with semantic analysis before creating new session
        const sessionDir = path.dirname(this.currentSessionFile);
        const basePath = path.dirname(path.dirname(sessionDir)); // Get project base path
        await this.updatePreviousTrajectoryOnSessionTransition(currentTranche, now, basePath);
        
        // Create corresponding trajectory file (with same path as session file)
        await this.createTrajectoryFile(currentTranche, now, basePath);
      }
    }
    
    return this.currentSessionFile;
  }

  /**
   * Update the previous trajectory with semantic analysis before session transition
   */
  async updatePreviousTrajectoryOnSessionTransition(currentTranche, now, basePath) {
    try {
      const date = now.toISOString().split('T')[0];
      
      // Find the current (about to be old) session files
      const currentSession = this.findCurrentSessionFiles(date, currentTranche, basePath);
      
      if (!currentSession.lsl || !currentSession.trajectory) {
        this.debug('No current session files to update');
        return;
      }

      console.log('🔄 Updating trajectory with semantic analysis...');

      // Read current LSL and trajectory files + previous trajectory
      let analysisContent = '';
      
      const currentLSLContent = fs.readFileSync(currentSession.lsl, 'utf8');
      const currentTrajectoryContent = fs.readFileSync(currentSession.trajectory, 'utf8');
      
      analysisContent += `Current Session LSL:\n${currentLSLContent.substring(0, 2000)}\n\n`;
      analysisContent += `Current Trajectory:\n${currentTrajectoryContent.substring(0, 1500)}\n\n`;
      
      // Find previous trajectory for context
      const previousSession = this.findPreviousSessionFiles(date, currentTranche, basePath);
      if (previousSession.trajectory) {
        const previousTrajectoryContent = fs.readFileSync(previousSession.trajectory, 'utf8');
        analysisContent += `Previous Trajectory:\n${previousTrajectoryContent.substring(0, 1500)}\n\n`;
      }

      // Perform semantic analysis if available
      if (this.semanticAnalyzer) {
        const analysisPrompt = `${analysisContent}Based on this session data, provide a comprehensive trajectory analysis focusing on:
1. Key accomplishments and patterns from the current session
2. Learning insights and behavioral observations  
3. Continuation patterns and trajectory evolution
4. Integration with previous trajectory context

Format as markdown sections. Keep under 400 words.`;

        try {
          const result = await this.semanticAnalyzer.analyzeToolInteraction(
            { toolCall: { name: 'trajectory-update' }, userPrompt: analysisPrompt },
            { focus: 'session-transition' }
          );

          // Update the current trajectory file with analysis
          const updatedTrajectory = currentTrajectoryContent + 
            `\n## Session Completion Analysis\n\n${result.insight || 'Session analysis completed.'}\n\n` +
            `**Analysis Updated:** ${now.toISOString()}\n\n---\n\n`;

          fs.writeFileSync(currentSession.trajectory, updatedTrajectory);
          console.log(`🎯 Updated trajectory: ${path.basename(currentSession.trajectory)}`);
          
        } catch (error) {
          console.log(`⚠️ Trajectory update failed: ${error.message}`);
        }
      }

    } catch (error) {
      console.error('❌ Failed to update previous trajectory:', error.message);
    }
  }

  /**
   * Find current session files (about to become previous)
   */
  findCurrentSessionFiles(currentDate, newTranche, basePath) {
    const historyDir = path.join(basePath, '.specstory', 'history');
    
    if (!fs.existsSync(historyDir)) {
      return { lsl: null, trajectory: null };
    }

    // Calculate the current tranche time (before the new one)
    const newHour = parseInt(newTranche.split('-')[0]);
    const currentHour = newHour - 1;
    const currentEndHour = newHour;
    
    const currentTranche = `${currentHour.toString().padStart(4, '0')}-${currentEndHour.toString().padStart(4, '0')}`;
    const baseFileName = `${currentDate}_${currentTranche}`;
    
    const lslPath = path.join(historyDir, `${baseFileName}-session.md`);
    const trajectoryPath = path.join(historyDir, `${baseFileName}-trajectory.md`);
    
    return {
      lsl: fs.existsSync(lslPath) ? lslPath : null,
      trajectory: fs.existsSync(trajectoryPath) ? trajectoryPath : null
    };
  }

  /**
   * Create trajectory file with semantic analysis from previous session
   */
  async createTrajectoryFile(currentTranche, now, targetPath = null) {
    try {
      const date = now.toISOString().split('T')[0];
      const trajectoryFileName = `${date}_${currentTranche}-trajectory.md`;
      
      // Use targetPath if provided (for routed content), otherwise use config
      const basePath = targetPath || this.config.projectPath;
      const trajectoryFilePath = path.join(basePath, '.specstory', 'history', trajectoryFileName);
      
      if (fs.existsSync(trajectoryFilePath)) {
        return; // Trajectory file already exists
      }

      // Find previous session files for semantic analysis
      const previousSession = this.findPreviousSessionFiles(date, currentTranche, basePath);
      
      let trajectoryContent = `# Trajectory Analysis: ${currentTranche}\n\n` +
        `**Generated:** ${this.formatTimestamp(now.getTime())}\n` +
        `**Session:** ${currentTranche}\n` +
        `**Focus:** Session trajectory and behavioral patterns\n` +
        `**Duration:** ~60 minutes\n\n` +
        `---\n\n## Session Trajectory\n\n`;

      // Use the updated trajectory (with completion analysis) for initialization
      if (previousSession.trajectory) {
        try {
          const previousTrajectoryContent = fs.readFileSync(previousSession.trajectory, 'utf8');
          
          // Extract the completion analysis section if it exists
          const analysisMatch = previousTrajectoryContent.match(/## Session Completion Analysis\n\n(.*?)\n\n/s);
          if (analysisMatch) {
            trajectoryContent += `## Analysis Summary\n\nInitialized from previous session completion analysis:\n\n${analysisMatch[1]}\n\n`;
          } else {
            trajectoryContent += `## Analysis Summary\n\nTrajectory initialized from previous session context.\n\n`;
          }
        } catch (error) {
          console.log(`⚠️ Previous trajectory analysis failed: ${error.message}`);
          trajectoryContent += `## Analysis Summary\n\nTrajectory initialized. Previous session context unavailable.\n\n`;
        }
      } else {
        trajectoryContent += `## Analysis Summary\n\nTrajectory initialized. No previous session data available.\n\n`;
      }

      trajectoryContent += `## Key Patterns\n\n- Session started at ${now.toISOString()}\n\n` +
        `## Learning Insights\n\n*To be populated as session progresses*\n\n` +
        `---\n\n`;

      fs.writeFileSync(trajectoryFilePath, trajectoryContent);
      console.log(`🎯 Created trajectory file: ${path.basename(trajectoryFilePath)}`);
      
    } catch (error) {
      console.error('❌ Failed to create trajectory file:', error.message);
    }
  }

  /**
   * Find previous session files for semantic analysis
   */
  findPreviousSessionFiles(currentDate, currentTranche, targetPath = null) {
    const basePath = targetPath || this.config.projectPath;
    const historyDir = path.join(basePath, '.specstory', 'history');
    
    if (!fs.existsSync(historyDir)) {
      return { lsl: null, trajectory: null };
    }

    const files = fs.readdirSync(historyDir)
      .filter(file => file.includes(currentDate) && file.includes('-session.md'))
      .sort()
      .reverse();

    // Find the most recent session file before current tranche
    for (const file of files) {
      const match = file.match(/(\d{4})-(\d{4})-session\.md$/);
      if (match && match[1] < currentTranche.split('-')[0]) {
        const baseFileName = file.replace('-session.md', '');
        const lslPath = path.join(historyDir, file);
        const trajectoryPath = path.join(historyDir, `${baseFileName}-trajectory.md`);
        
        return {
          lsl: fs.existsSync(lslPath) ? lslPath : null,
          trajectory: fs.existsSync(trajectoryPath) ? trajectoryPath : null
        };
      }
    }

    return { lsl: null, trajectory: null };
  }

  /**
   * Format timestamp with both UTC and local time for clarity
   */
  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const utcTime = date.toISOString();
    const localTime = date.toLocaleString('sv-SE'); // ISO-like format in local time
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `${utcTime} (${localTime} ${timezone})`;
  }

  /**
   * Perform semantic analysis using previous session data
   */
  async performSemanticAnalysis(previousSession) {
    if (!this.semanticAnalyzer) {
      throw new Error('Semantic analyzer not available');
    }

    let analysisPrompt = 'Analyze the previous session trajectory and patterns:\n\n';
    
    if (previousSession.trajectory) {
      const trajectoryContent = fs.readFileSync(previousSession.trajectory, 'utf8');
      analysisPrompt += `Previous Trajectory:\n${trajectoryContent}\n\n`;
    }
    
    if (previousSession.lsl) {
      const lslContent = fs.readFileSync(previousSession.lsl, 'utf8');
      // Take first 2000 chars to avoid token limits
      analysisPrompt += `Previous Session Log:\n${lslContent.substring(0, 2000)}...\n\n`;
    }

    analysisPrompt += 'Based on this data, provide a brief trajectory analysis for the new session focusing on:\n' +
      '1. Continuation patterns from previous session\n' +
      '2. Expected focus areas\n' +
      '3. Learning trajectory insights\n' +
      'Keep response under 200 words.';

    const result = await this.semanticAnalyzer.analyzeToolInteraction({
      toolCall: { name: 'trajectory-analysis' },
      result: 'session-transition',
      userPrompt: analysisPrompt
    });

    return result.summary || 'Trajectory analysis completed.';
  }

  /**
   * Start monitoring the transcript
   */
  start() {
    if (!this.transcriptPath) {
      console.log('❌ No current transcript file found. Make sure Claude Code is running.');
      return;
    }

    console.log(`🚀 Starting transcript monitor for: ${path.basename(this.transcriptPath)}`);
    console.log(`📁 Logging to: ${this.config.projectPath}/.specstory/history/`);
    console.log(`🔍 Check interval: ${this.config.checkInterval}ms`);
    console.log(`🧠 Semantic analysis: ${this.semanticAnalyzer ? '✅ Enabled' : '❌ Disabled (no API key)'}`);

    this.intervalId = setInterval(async () => {
      if (this.isProcessing) {
        return; // Skip if still processing previous batch
      }

      if (!this.hasNewContent()) {
        return; // No new content
      }

      this.isProcessing = true;
      try {
        const exchanges = this.getUnprocessedExchanges();
        if (exchanges.length > 0) {
          await this.processExchanges(exchanges);
        }
      } catch (error) {
        this.debug(`Error in monitoring loop: ${error.message}`);
      } finally {
        this.isProcessing = false;
      }
    }, this.config.checkInterval);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping transcript monitor...');
      this.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 Stopping transcript monitor...');
      this.stop();
      process.exit(0);
    });
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('📋 Transcript monitor stopped');
  }

  /**
   * Debug logging
   */
  debug(message) {
    if (this.config.debug) {
      console.error(`[TranscriptMonitor] ${new Date().toISOString()} ${message}`);
    }
  }

  /**
   * Get monitoring stats
   */
  getStats() {
    return {
      transcriptPath: this.transcriptPath,
      lastProcessedUuid: this.lastProcessedUuid,
      lastFileSize: this.lastFileSize,
      isProcessing: this.isProcessing,
      hasSemanticAnalyzer: !!this.semanticAnalyzer,
      projectPath: this.config.projectPath
    };
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const monitor = new TranscriptMonitor({
    debug: true
  });

  // Test mode - show current transcript info
  if (process.argv[2] === '--test') {
    console.log('🔍 Testing transcript detection...');
    console.log('Stats:', JSON.stringify(monitor.getStats(), null, 2));
    
    if (monitor.transcriptPath) {
      const messages = monitor.readTranscriptMessages(monitor.transcriptPath);
      console.log(`📊 Found ${messages.length} messages in transcript`);
      
      const exchanges = monitor.extractExchanges(messages);
      console.log(`💬 Found ${exchanges.length} conversation exchanges`);
      
      if (exchanges.length > 0) {
        const latest = exchanges[exchanges.length - 1];
        console.log(`🕒 Latest exchange: ${new Date(latest.timestamp).toISOString()}`);
        console.log(`🛠️ Tool calls: ${latest.toolCalls.length}`);
      }
    }
  } else {
    // Normal monitoring mode
    monitor.start();
  }
}

export default TranscriptMonitor;