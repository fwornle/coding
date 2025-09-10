#!/usr/bin/env node

/**
 * Enhanced Claude Code Transcript Monitor
 * Supports multiple parallel sessions with prompt-triggered trajectory updates
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseTimestamp, formatTimestamp, getTimeWindow, getTimezone } from './timezone-utils.js';
import { SemanticAnalyzer } from '../src/live-logging/SemanticAnalyzer.js';

// Function to redact API keys and secrets from text
function redactSecrets(text) {
  if (!text) return text;
  
  // List of API key patterns to redact
  const apiKeyPatterns = [
    // Environment variable format: KEY=value
    /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|GROK_API_KEY|XAI_API_KEY|GEMINI_API_KEY|CLAUDE_API_KEY|GPT_API_KEY|DEEPMIND_API_KEY|COHERE_API_KEY|HUGGINGFACE_API_KEY|HF_API_KEY|REPLICATE_API_KEY|TOGETHER_API_KEY|PERPLEXITY_API_KEY|AI21_API_KEY|GOOGLE_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AZURE_API_KEY|GCP_API_KEY|GITHUB_TOKEN|GITLAB_TOKEN|BITBUCKET_TOKEN|NPM_TOKEN|PYPI_TOKEN|DOCKER_TOKEN|SLACK_TOKEN|DISCORD_TOKEN|TELEGRAM_TOKEN|STRIPE_API_KEY|SENDGRID_API_KEY|MAILGUN_API_KEY|TWILIO_AUTH_TOKEN|FIREBASE_API_KEY|SUPABASE_API_KEY|MONGODB_URI|POSTGRES_PASSWORD|MYSQL_PASSWORD|REDIS_PASSWORD|DATABASE_URL|CONNECTION_STRING|JWT_SECRET|SESSION_SECRET|ENCRYPTION_KEY|PRIVATE_KEY|SECRET_KEY|CLIENT_SECRET|API_SECRET|WEBHOOK_SECRET)\s*=\s*["']?([^"'\s\n]+)["']?/gi,
    
    // JSON format: "apiKey": "sk-..." or "API_KEY": "sk-..." or "xai-..."
    /"(apiKey|API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|XAI_API_KEY|GROK_API_KEY|api_key|anthropicApiKey|openaiApiKey|xaiApiKey|grokApiKey)":\s*"(sk-[a-zA-Z0-9-_]{20,}|xai-[a-zA-Z0-9-_]{20,}|[a-zA-Z0-9-_]{32,})"/gi,
    
    // sk- prefix (common for various API keys)
    /\bsk-[a-zA-Z0-9]{20,}/gi,
    
    // xai- prefix (XAI/Grok API keys)
    /\bxai-[a-zA-Z0-9]{20,}/gi,
    
    // Common API key formats
    /\b[a-zA-Z0-9]{32,}[-_][a-zA-Z0-9]{8,}/gi,
    
    // Bearer tokens
    /Bearer\s+[a-zA-Z0-9\-._~+\/]{20,}/gi,
    
    // JWT tokens (three base64 parts separated by dots)
    /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/gi,
    
    // MongoDB connection strings
    /mongodb(\+srv)?:\/\/[^:]+:[^@]+@[^\s]+/gi,
    
    // PostgreSQL/MySQL connection strings
    /postgres(ql)?:\/\/[^:]+:[^@]+@[^\s]+/gi,
    /mysql:\/\/[^:]+:[^@]+@[^\s]+/gi,
    
    // Generic URL with credentials
    /https?:\/\/[^:]+:[^@]+@[^\s]+/gi,
    
    // Email addresses
    /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi,
    
    // Corporate user IDs (q followed by 6 digits/letters)
    /\bq[0-9a-zA-Z]{6}\b/gi,
    
    // Common corporate terms
    /\b(BMW|Mercedes|Audi|Tesla|Microsoft|Google|Apple|Amazon|Meta|Facebook|IBM|Oracle|Cisco|Intel|Dell|HP|Lenovo|Samsung|LG|Sony|Panasonic|Siemens|SAP|Accenture|Deloitte|McKinsey|BCG|Bain|Goldman|Morgan|JPMorgan|Deutsche Bank|Commerzbank|Allianz|Munich Re|BASF|Bayer|Volkswagen|Porsche|Bosch|Continental|Airbus|Boeing|Lockheed|Northrop|Raytheon|General Electric|Ford|General Motors|Chrysler|Fiat|Renault|Peugeot|Citroen|Volvo|Scania|MAN|Daimler|ThyssenKrupp|Siemens Energy|RWE|EON|Uniper|TUI|Lufthansa|DHL|UPS|FedEx|TNT|Deutsche Post|Telekom|Vodafone|Orange|BT|Telefonica|Verizon|ATT|Sprint|TMobile)\b/gi
  ];
  
  let redactedText = text;
  
  // Apply each pattern
  apiKeyPatterns.forEach(pattern => {
    if (pattern.source.includes('=')) {
      // For environment variable patterns, preserve the key name
      redactedText = redactedText.replace(pattern, (match, keyName) => {
        return `${keyName}=<SECRET_REDACTED>`;
      });
    } else if (pattern.source.includes('"(apiKey|API_KEY')) {
      // For JSON format patterns, preserve the key name and structure
      redactedText = redactedText.replace(pattern, (match, keyName) => {
        return `"${keyName}": "<SECRET_REDACTED>"`;
      });
    } else if (pattern.source.includes('mongodb') || pattern.source.includes('postgres') || pattern.source.includes('mysql')) {
      // For connection strings, preserve the protocol
      redactedText = redactedText.replace(pattern, (match) => {
        const protocol = match.split(':')[0];
        return `${protocol}://<CONNECTION_STRING_REDACTED>`;
      });
    } else if (pattern.source.includes('Bearer')) {
      // For Bearer tokens
      redactedText = redactedText.replace(pattern, 'Bearer <TOKEN_REDACTED>');
    } else if (pattern.source.includes('@')) {
      // For email addresses
      redactedText = redactedText.replace(pattern, '<EMAIL_REDACTED>');
    } else if (pattern.source.includes('q[0-9a-zA-Z]')) {
      // For corporate user IDs
      redactedText = redactedText.replace(pattern, '<USER_ID_REDACTED>');
    } else if (pattern.source.includes('BMW|Mercedes')) {
      // For corporate terms
      redactedText = redactedText.replace(pattern, '<COMPANY_NAME_REDACTED>');
    } else {
      // For other patterns, replace with generic redaction
      redactedText = redactedText.replace(pattern, '<SECRET_REDACTED>');
    }
  });
  
  return redactedText;
}

class EnhancedTranscriptMonitor {
  constructor(config = {}) {
    // Initialize debug early so it can be used in getProjectPath
    this.debug_enabled = config.debug || process.env.TRANSCRIPT_DEBUG === 'true';
    
    this.config = {
      checkInterval: config.checkInterval || 2000, // More frequent for prompt detection
      projectPath: config.projectPath || this.getProjectPath(),
      debug: this.debug_enabled,
      sessionDuration: config.sessionDuration || 7200000, // 2 hours (generous for debugging)
      timezone: config.timezone || getTimezone(), // Use central timezone config
      healthFile: path.join(process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || path.join(__dirname, '..'), '.transcript-monitor-health'),
      ...config
    };

    this.transcriptPath = this.findCurrentTranscript();
    this.lastProcessedUuid = null;
    this.lastFileSize = 0;
    this.isProcessing = false;
    this.currentUserPromptSet = [];
    this.lastUserPromptTime = null;
    this.sessionFiles = new Map(); // Track multiple session files
    
    // Initialize semantic analyzer for content classification
    this.semanticAnalyzer = null;
    try {
      const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY || process.env.OPENAI_API_KEY;
      if (apiKey) {
        this.semanticAnalyzer = new SemanticAnalyzer(apiKey);
        this.debug('Semantic analyzer initialized for content classification');
      } else {
        this.debug('No API key found - semantic analysis disabled');
      }
    } catch (error) {
      console.error('Failed to initialize semantic analyzer:', error.message);
      this.semanticAnalyzer = null;
    }
  }

  /**
   * Find current session's transcript file
   */
  findCurrentTranscript() {
    const baseDir = path.join(os.homedir(), '.claude', 'projects');
    const projectName = this.getProjectDirName();
    const projectDir = path.join(baseDir, projectName);
    
    if (!fs.existsSync(projectDir)) {
      this.debug(`Project directory not found: ${projectDir}`);
      return null;
    }

    this.debug(`Looking for transcripts in: ${projectDir}`);

    try {
      const files = fs.readdirSync(projectDir)
        .filter(file => file.endsWith('.jsonl'))
        .map(file => {
          const filePath = path.join(projectDir, file);
          const stats = fs.statSync(filePath);
          return { path: filePath, mtime: stats.mtime, size: stats.size };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) return null;

      const mostRecent = files[0];
      const timeDiff = Date.now() - mostRecent.mtime.getTime();
      
      if (timeDiff < this.config.sessionDuration * 2) {
        this.debug(`Using transcript: ${mostRecent.path}`);
        return mostRecent.path;
      }

      this.debug(`Transcript too old: ${timeDiff}ms > ${this.config.sessionDuration * 2}ms`);
      return null;
    } catch (error) {
      this.debug(`Error finding transcript: ${error.message}`);
      return null;
    }
  }

  // Timezone utilities are now imported from timezone-utils.js

  /**
   * Use robust project path detection like status line - check both coding repo and current directory
   */
  getProjectPath() {
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    const rootDir = process.env.CODING_REPO || path.join(__dirname, '..');
    
    // Check target project first (like status line does), then coding repo, then current directory
    const checkPaths = [
      process.env.CODING_TARGET_PROJECT, // Target project (e.g., nano-degree)
      rootDir,                           // Coding repo 
      process.cwd()                      // Current working directory
    ].filter(Boolean); // Remove null/undefined values
    
    if (this.debug_enabled) console.error(`Checking project paths: ${JSON.stringify(checkPaths)}`);
    
    // Look for .specstory directory to confirm it's a valid project
    for (const checkPath of checkPaths) {
      const specstoryDir = path.join(checkPath, '.specstory');
      if (fs.existsSync(specstoryDir)) {
        if (this.debug_enabled) console.error(`Found project with .specstory at: ${checkPath}`);
        return checkPath;
      }
    }
    
    // Fallback: prefer current directory since that's where user is working  
    if (this.debug_enabled) console.error(`No .specstory found, using fallback: ${process.cwd()}`);
    return process.cwd();
  }

  /**
   * Convert project path to Claude's directory naming
   */
  getProjectDirName() {
    const normalized = this.config.projectPath.replace(/\//g, '-');
    return normalized.startsWith('-') ? normalized : '-' + normalized;
  }

  /**
   * Read and parse transcript messages
   */
  readTranscriptMessages(transcriptPath) {
    if (!fs.existsSync(transcriptPath)) return [];

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      const messages = [];

      for (const line of lines) {
        try {
          messages.push(JSON.parse(line));
        } catch (error) {
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
   * Extract conversation exchanges with user prompt detection
   */
  extractExchanges(messages) {
    const exchanges = [];
    let currentExchange = null;

    for (const message of messages) {
      if (message.type === 'user' && message.message?.role === 'user') {
        // New user prompt - complete previous exchange and start new one
        if (currentExchange) {
          currentExchange.isUserPrompt = true;
          exchanges.push(currentExchange);
        }
        
        currentExchange = {
          id: message.uuid,
          timestamp: message.timestamp || Date.now(),
          userMessage: this.extractUserMessage(message.message) || '',
          claudeResponse: '',
          toolCalls: [],
          toolResults: [],
          isUserPrompt: true
        };
      } else if (message.type === 'assistant' && currentExchange) {
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

    if (currentExchange) {
      exchanges.push(currentExchange);
    }

    return exchanges;
  }

  /**
   * Extract text content from message content
   */
  extractTextContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');
    }
    return '';
  }

  extractTextContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(item => item && item.type === 'text')
        .map(item => item.text)
        .filter(text => text && text.trim())
        .join('\n');
    }
    return '';
  }

  extractUserMessage(entry) {
    // Handle different user message structures - using proven logic from LSL script
    if (entry.message?.content) {
      if (typeof entry.message.content === 'string') {
        return redactSecrets(entry.message.content);
      }
      return redactSecrets(this.extractTextContent(entry.message.content));
    }
    if (entry.content) {
      return redactSecrets(this.extractTextContent(entry.content));
    }
    return '';
  }

  /**
   * Get unprocessed exchanges
   */
  getUnprocessedExchanges() {
    if (!this.transcriptPath) return [];

    const messages = this.readTranscriptMessages(this.transcriptPath);
    if (messages.length === 0) return [];

    const exchanges = this.extractExchanges(messages);
    
    if (!this.lastProcessedUuid) {
      return exchanges.slice(-10);
    }

    const lastIndex = exchanges.findIndex(ex => ex.id === this.lastProcessedUuid);
    if (lastIndex >= 0) {
      return exchanges.slice(lastIndex + 1);
    }

    return exchanges.slice(-10);
  }

  /**
   * Determine target project using user's simplified logic:
   * (1) Read correct transcript file (always from current project via statusLine)
   * (2a) If running in coding -> write to coding LSL
   * (2b) If running outside coding -> check redirect status
   */
  async determineTargetProject(exchange) {
    const codingPath = process.env.CODING_TOOLS_PATH || '/Users/q284340/Agentic/coding';
    
    // Check if we're running from coding directory
    if (this.config.projectPath.includes('/coding')) {
      return codingPath;
    }
    
    // Running from outside coding - check redirect status
    if (await this.isCodingRelated(exchange)) {
      return codingPath; // Redirect to coding
    }
    
    return this.config.projectPath; // Stay in local project
  }

  /**
   * Create or append to session file with exclusive routing
   */
  async createOrAppendToSessionFile(targetProject, tranche, exchange) {
    // Note: Session file creation is now handled by processUserPromptSetCompletion
    // Only when there are meaningful exchanges to log
    // This method is kept for compatibility but no longer creates empty files
  }

  /**
   * Check if content involves coding project using semantic analysis
   */
  async isCodingRelated(exchange) {
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';
    
    console.log(`\n🔍 ENHANCED CODING DETECTION:`);
    console.log(`  Coding path: ${codingPath}`);
    console.log(`  Tools: ${exchange.toolCalls?.map(t => t.name).join(', ') || 'none'}`);
    
    // 1. FIRST: Check tool calls for DIRECT file operations in coding directory
    // This is fast and definitive - if tools touch coding files, it's clearly coding
    for (const toolCall of exchange.toolCalls || []) {
      const toolData = JSON.stringify(toolCall).toLowerCase();
      
      // Direct path references to coding directory
      if (toolData.includes(codingPath.toLowerCase()) || toolData.includes('/coding/') || toolData.includes('coding/')) {
        console.log(`✅ CODING DETECTED (DIRECT): ${toolCall.name} touches coding directory`);
        this.debug(`Coding detected: ${toolCall.name} operates on coding directory`);
        return true;
      }
      
      // LSL generation script patterns
      if (toolCall.name === 'Bash' && toolData.includes('generate-proper-lsl-from-transcripts.js')) {
        if (toolData.includes('CODING_TARGET_PROJECT="/Users/q284340/Agentic/coding"') || 
            toolData.includes('--project=coding')) {
          console.log(`✅ CODING DETECTED (LSL): LSL generation script targeting coding project`);
          this.debug(`Coding detected: LSL script targets coding project`);
          return true;
        }
      }
    }
    
    // Check tool results for coding directory references
    for (const toolResult of exchange.toolResults || []) {
      const resultData = JSON.stringify(toolResult).toLowerCase();
      
      // Direct coding directory references
      if (resultData.includes(codingPath.toLowerCase()) || resultData.includes('/coding/')) {
        console.log(`✅ CODING DETECTED (RESULT): Tool result references coding directory`);
        this.debug(`Coding detected: Tool result references coding directory`);
        return true;
      }
    }
    
    // 2. SECOND: Use semantic analysis for content classification
    if (this.semanticAnalyzer) {
      try {
        console.log(`🧠 SEMANTIC ANALYSIS: Analyzing conversation content...`);
        const classification = await this.semanticAnalyzer.classifyConversationContent(exchange);
        
        console.log(`🧠 SEMANTIC RESULT: ${classification.classification} (${classification.confidence} confidence)`);
        console.log(`🧠 REASON: ${classification.reason}`);
        
        const isCoding = classification.classification === 'CODING_INFRASTRUCTURE';
        if (isCoding) {
          console.log(`✅ CODING DETECTED (SEMANTIC): ${classification.reason}`);
          this.debug(`Coding detected via semantic analysis: ${classification.reason}`);
        } else {
          console.log(`📄 NON-CODING CONTENT (SEMANTIC): ${classification.reason}`);
          this.debug(`Non-coding content detected via semantic analysis: ${classification.reason}`);
        }
        
        return isCoding;
        
      } catch (error) {
        console.log(`⚠️ SEMANTIC ANALYSIS FAILED: ${error.message}`);
        this.debug(`Semantic analysis failed: ${error.message}`);
        // Fall through to keyword fallback
      }
    }
    
    // 3. FALLBACK: Simple keyword detection (only if semantic analysis unavailable)
    console.log(`🔤 FALLBACK: Using keyword detection...`);
    const combinedContent = (exchange.userMessage + ' ' + exchange.claudeResponse).toLowerCase();
    
    const codingIndicators = [
      'enhanced-transcript-monitor',
      'transcript-monitor', 
      'lsl system',
      'live session logging',
      'trajectory',
      'semantic analysis',
      'coding tools',
      'generate-proper-lsl',
      'redaction',
      'script debugging'
    ];
    
    for (const indicator of codingIndicators) {
      if (combinedContent.includes(indicator)) {
        console.log(`✅ CODING DETECTED (FALLBACK): Found "${indicator}" in exchange`);
        this.debug(`Coding detected via fallback: Content contains "${indicator}"`);
        return true;
      }
    }
    
    console.log(`📄 NON-CODING: Classified as non-coding content`);
    this.debug('Non-coding: Classified as non-coding content');
    return false;
  }
  


  /**
   * Get current time tranche (XX:30 - (XX+1):30)
   */
  getCurrentTimetranche() {
    const now = new Date();
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
    
    return {
      timeString: `${formatTime(startHour, startMin)}-${formatTime(endHour, endMin)}`,
      startTime: trancheStart,
      endTime: trancheEnd,
      date: now.toISOString().split('T')[0]
    };
  }

  /**
   * Get session file path with multi-project naming
   */
  getSessionFilePath(targetProject, tranche) {
    const baseName = `${tranche.date}_${tranche.timeString}`;
    const currentProjectName = path.basename(this.config.projectPath);
    
    if (targetProject === this.config.projectPath) {
      // Local project
      return path.join(targetProject, '.specstory', 'history', `${baseName}-session.md`);
    } else {
      // Redirected to coding project - drop "coding" from filename
      return path.join(targetProject, '.specstory', 'history', `${baseName}-session-from-${currentProjectName}.md`);
    }
  }

  /**
   * Update comprehensive trajectory file
   */
  async updateComprehensiveTrajectory(targetProject) {
    try {
      const { spawn } = await import('child_process');
      
      // Use the CODING_TOOLS_PATH environment variable set by bin/coding
      const codingToolsPath = process.env.CODING_TOOLS_PATH;
      if (!codingToolsPath) {
        throw new Error('CODING_TOOLS_PATH environment variable not set. Run from coding/bin/coding');
      }
      
      const updateScript = path.join(codingToolsPath, 'scripts', 'repository-trajectory-generator.js');
      
      const child = spawn('node', [updateScript], {
        cwd: targetProject,
        stdio: 'pipe',
        env: { ...process.env, CODING_TARGET_PROJECT: targetProject }
      });
      
      child.stdout.on('data', (data) => {
        this.debug(`Trajectory: ${data.toString().trim()}`);
      });
      
      child.stderr.on('data', (data) => {
        this.debug(`Trajectory Error: ${data.toString().trim()}`);
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          this.debug(`✅ Updated comprehensive trajectory for ${path.basename(targetProject)}`);
        } else {
          this.debug(`⚠️ Trajectory update failed with code ${code}`);
        }
      });
    } catch (error) {
      this.debug(`Error updating comprehensive trajectory: ${error.message}`);
    }
  }

  /**
   * Check if new session boundary crossed
   */
  isNewSessionBoundary(currentTranche, lastTranche) {
    return !lastTranche || 
           currentTranche.timeString !== lastTranche.timeString ||
           currentTranche.date !== lastTranche.date;
  }

  /**
   * Create empty session file only (trajectory handled centrally)
   */
  async createEmptySessionFile(targetProject, tranche) {
    const sessionFile = this.getSessionFilePath(targetProject, tranche);
    
    // Ensure directory exists
    const sessionDir = path.dirname(sessionFile);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    // Create empty session file
    if (!fs.existsSync(sessionFile)) {
      const currentProjectName = path.basename(this.config.projectPath);
      const isRedirected = targetProject !== this.config.projectPath;
      
      const sessionHeader = `# WORK SESSION (${tranche.timeString})${isRedirected ? ` - From ${currentProjectName}` : ''}\n\n` +
        `**Generated:** ${new Date().toISOString()}\n` +
        `**Work Period:** ${tranche.timeString}\n` +
        `**Focus:** ${isRedirected ? `Coding activities from ${currentProjectName}` : 'Live session logging'}\n` +
        `**Duration:** ~60 minutes\n` +
        `${isRedirected ? `**Source Project:** ${this.config.projectPath}\n` : ''}` +
        `\n---\n\n## Session Overview\n\n` +
        `This session captures ${isRedirected ? 'coding-related activities redirected from ' + currentProjectName : 'real-time tool interactions and exchanges'}.\n\n` +
        `---\n\n## Key Activities\n\n`;
      
      fs.writeFileSync(sessionFile, sessionHeader);
      console.log(`📝 Created ${isRedirected ? 'redirected' : 'new'} session: ${path.basename(sessionFile)}`);
    }

    return sessionFile;
  }


  /**
   * Process user prompt set completion
   */
  async processUserPromptSetCompletion(completedSet, targetProject, tranche) {
    if (completedSet.length === 0) return;

    // Filter exchanges that have tool calls (meaningful content)
    const meaningfulExchanges = completedSet.filter(exchange => 
      exchange.toolCalls && exchange.toolCalls.length > 0
    );
    
    // Only create session file if there are meaningful exchanges to log
    if (meaningfulExchanges.length === 0) {
      this.debug(`Skipping empty user prompt set - no tool calls found`);
      return;
    }

    const sessionFile = this.getSessionFilePath(targetProject, tranche);
    
    // Create session file only when we have content to write
    if (!fs.existsSync(sessionFile)) {
      await this.createEmptySessionFile(targetProject, tranche);
    }
    
    // Log the meaningful exchanges to session file
    for (const exchange of meaningfulExchanges) {
      await this.logExchangeToSession(exchange, sessionFile, targetProject);
    }

    // Update comprehensive trajectory instead of individual trajectory files
    await this.updateComprehensiveTrajectory(targetProject);
    
    console.log(`📋 Completed user prompt set: ${meaningfulExchanges.length}/${completedSet.length} exchanges → ${path.basename(sessionFile)}`);
  }

  /**
   * Log exchange to session file
   */
  async logExchangeToSession(exchange, sessionFile, targetProject) {
    const isRedirected = targetProject !== this.config.projectPath;
    
    // Skip exchanges with no meaningful user message to prevent "No context" entries
    if (!exchange.userMessage || exchange.userMessage.trim().length === 0) {
      return;
    }
    
    // Skip exchanges with no tool calls to prevent empty session files
    if (!exchange.toolCalls || exchange.toolCalls.length === 0) {
      this.debug(`Skipping exchange with no tool calls: ${exchange.userMessage.substring(0, 50)}...`);
      return;
    }
    
    // Log each tool call individually with detailed format (like original monitor)
    for (const toolCall of exchange.toolCalls) {
      const result = exchange.toolResults.find(r => r.tool_use_id === toolCall.id);
      await this.logDetailedToolCall(exchange, toolCall, result, sessionFile, isRedirected);
    }
  }

  /**
   * Log individual tool call with detailed JSON input/output (original monitor format)
   */
  async logDetailedToolCall(exchange, toolCall, result, sessionFile, isRedirected) {
    const exchangeTime = new Date(exchange.timestamp).toISOString();
    const toolSuccess = result && !result.is_error;
    
    // Use built-in fast semantic analysis for routing info (not MCP server)
    const routingAnalysis = this.analyzeForRouting(exchange, toolCall, result);
    
    let content = `### ${toolCall.name} - ${exchangeTime}${isRedirected ? ' (Redirected)' : ''}\n\n`;
    content += `**User Request:** ${redactSecrets(exchange.userMessage.slice(0, 200))}${exchange.userMessage.length > 200 ? '...' : ''}\n\n`;
    content += `**Tool:** ${toolCall.name}\n`;
    content += `**Input:** \`\`\`json\n${redactSecrets(JSON.stringify(toolCall.input, null, 2))}\n\`\`\`\n\n`;
    content += `**Result:** ${toolSuccess ? '✅ Success' : '❌ Error'}\n`;
    
    if (result?.content) {
      const output = typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2);
      content += `**Output:** \`\`\`\n${redactSecrets(output.slice(0, 500))}${output.length > 500 ? '\n...[truncated]' : ''}\n\`\`\`\n\n`;
    }
    
    content += `**AI Analysis:** ${routingAnalysis}\n\n---\n\n`;
    fs.appendFileSync(sessionFile, content);
  }

  /**
   * Fast built-in semantic analysis for routing decisions (not MCP server)
   */
  analyzeForRouting(exchange, toolCall, result) {
    const toolInput = JSON.stringify(toolCall.input || {});
    const resultContent = JSON.stringify(result?.content || '');
    const userMessage = exchange.userMessage || '';
    
    // Check for coding-related file paths and operations
    const codingPaths = [
      '/users/q284340/agentic/coding/',
      'coding/scripts/',
      'coding/bin/',
      'coding/src/',
      'coding/.specstory/',
      'coding/integrations/'
    ];
    
    const combinedText = (toolInput + resultContent + userMessage).toLowerCase();
    const isCoding = codingPaths.some(path => combinedText.includes(path));
    
    // Determine activity category
    let category = 'general';
    if (toolCall.name === 'Edit' || toolCall.name === 'Write' || toolCall.name === 'MultiEdit') {
      category = 'file_modification';
    } else if (toolCall.name === 'Read' || toolCall.name === 'Glob') {
      category = 'file_read';
    } else if (toolCall.name === 'Bash') {
      category = 'command_execution';
    } else if (toolCall.name === 'Grep') {
      category = 'search_operation';
    }
    
    return `${isCoding ? '🔧 Coding-related' : '📋 General'} ${category} - routing: ${isCoding ? 'coding project' : 'local project'}`;
  }

  /**
   * Process exchanges with enhanced user prompt detection
   */
  async processExchanges(exchanges) {
    if (!exchanges || exchanges.length === 0) return;

    this.debug(`Processing ${exchanges.length} exchanges`);

    for (const exchange of exchanges) {
      const currentTranche = this.getCurrentTimetranche();
      
      if (exchange.isUserPrompt) {
        // New user prompt detected
        
        // Check if we crossed session boundary
        if (this.isNewSessionBoundary(currentTranche, this.lastTranche)) {
          
          // Complete previous user prompt set if exists
          if (this.currentUserPromptSet.length > 0) {
            const targetProject = await this.determineTargetProject(this.currentUserPromptSet[0]);
            await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, this.lastTranche || currentTranche);
            this.currentUserPromptSet = [];
          }
          
          // Create new session files for new time boundary - EXCLUSIVE routing
          const targetProject = await this.determineTargetProject(exchange);
          await this.createOrAppendToSessionFile(targetProject, currentTranche, exchange);
          this.lastTranche = currentTranche;
          
        } else {
          // Same session - complete current user prompt set  
          if (this.currentUserPromptSet.length > 0) {
            const targetProject = await this.determineTargetProject(this.currentUserPromptSet[0]);
            await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, currentTranche);
            
            // Note: Redirect detection now handled by conversation-based analysis in status line
          }
        }
        
        // Start new user prompt set
        this.currentUserPromptSet = [exchange];
        this.lastUserPromptTime = exchange.timestamp;
        
      } else {
        // Add to current user prompt set
        if (this.currentUserPromptSet.length > 0) {
          this.currentUserPromptSet.push(exchange);
        }
      }
      
      this.lastProcessedUuid = exchange.id;
    }
  }

  // Removed redirect file methods - status line now uses conversation-based detection

  /**
   * Check if transcript has new content
   */
  hasNewContent() {
    if (!this.transcriptPath) return false;

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
   * Start monitoring
   */
  start() {
    if (!this.transcriptPath) {
      console.log('❌ No current transcript file found. Make sure Claude Code is running.');
      return;
    }

    console.log(`🚀 Starting enhanced transcript monitor`);
    console.log(`📁 Project: ${this.config.projectPath}`);
    console.log(`📊 Transcript: ${path.basename(this.transcriptPath)}`);
    console.log(`🔍 Check interval: ${this.config.checkInterval}ms`);
    console.log(`⏰ Session boundaries: Every 30 minutes`);

    // Create initial health file
    this.updateHealthFile();
    
    // Set up health file update interval (every 5 seconds)
    this.healthIntervalId = setInterval(() => {
      this.updateHealthFile();
    }, 5000);

    this.intervalId = setInterval(async () => {
      if (this.isProcessing) return;
      if (!this.hasNewContent()) return;

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

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Stopping enhanced transcript monitor...');
      
      // Complete any pending user prompt set
      if (this.currentUserPromptSet.length > 0) {
        const currentTranche = this.getCurrentTimetranche();
        const targetProject = await this.determineTargetProject(this.currentUserPromptSet[0]);
        
        await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, currentTranche);
      }
      
      // Note: No longer need to clear redirect files
      
      this.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.healthIntervalId) {
      clearInterval(this.healthIntervalId);
      this.healthIntervalId = null;
    }
    this.cleanupHealthFile();
    console.log('📋 Enhanced transcript monitor stopped');
  }

  /**
   * Debug logging
   */
  debug(message) {
    if (this.config.debug) {
      console.error(`[EnhancedTranscriptMonitor] ${new Date().toISOString()} ${message}`);
    }
  }

  /**
   * Update health file to indicate monitor is running
   */
  updateHealthFile() {
    try {
      const healthData = {
        timestamp: Date.now(),
        projectPath: this.config.projectPath,
        transcriptPath: this.transcriptPath,
        status: 'running'
      };
      fs.writeFileSync(this.config.healthFile, JSON.stringify(healthData, null, 2));
    } catch (error) {
      this.debug(`Failed to update health file: ${error.message}`);
    }
  }

  /**
   * Remove health file on shutdown
   */
  cleanupHealthFile() {
    try {
      if (fs.existsSync(this.config.healthFile)) {
        fs.unlinkSync(this.config.healthFile);
      }
    } catch (error) {
      this.debug(`Failed to cleanup health file: ${error.message}`);
    }
  }
}

/**
 * Batch reprocess all historical transcripts with current format
 */
async function reprocessHistoricalTranscripts(projectPath = null) {
  try {
    const targetProject = projectPath || process.env.CODING_TARGET_PROJECT || process.cwd();
    const monitor = new EnhancedTranscriptMonitor({ projectPath: targetProject });
    
    console.log('🔄 Starting historical transcript reprocessing...');
    console.log(`📁 Target project: ${targetProject}`);
    
    // Clear existing session files for clean regeneration
    const historyDir = path.join(targetProject, '.specstory', 'history');
    if (fs.existsSync(historyDir)) {
      const sessionFiles = fs.readdirSync(historyDir).filter(file => 
        file.includes('-session') && file.endsWith('.md')
      );
      
      console.log(`🗑️ Removing ${sessionFiles.length} existing session files for clean regeneration...`);
      for (const file of sessionFiles) {
        fs.unlinkSync(path.join(historyDir, file));
      }
    }
    
    // Also clear redirected session files in coding project if different
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';
    if (targetProject !== codingPath) {
      const codingHistoryDir = path.join(codingPath, '.specstory', 'history');
      if (fs.existsSync(codingHistoryDir)) {
        const redirectedFiles = fs.readdirSync(codingHistoryDir).filter(file => 
          file.includes('from-' + path.basename(targetProject)) && file.endsWith('.md')
        );
        
        console.log(`🗑️ Removing ${redirectedFiles.length} redirected session files in coding project...`);
        for (const file of redirectedFiles) {
          fs.unlinkSync(path.join(codingHistoryDir, file));
        }
      }
    }
    
    // Reset processing state to reprocess everything
    monitor.lastProcessedUuid = null;
    
    // Find and process transcript
    const transcriptFile = monitor.findCurrentTranscript();
    if (!transcriptFile) {
      console.log('❌ No transcript file found for this project');
      return;
    }
    
    console.log(`📊 Processing transcript: ${path.basename(transcriptFile)}`);
    
    // Process all exchanges
    const messages = monitor.readTranscriptMessages(transcriptFile);
    const exchanges = monitor.extractExchanges(messages);
    
    console.log(`🔍 Found ${exchanges.length} total exchanges`);
    
    // Process in batches to avoid memory issues
    const batchSize = 50;
    let processedCount = 0;
    
    for (let i = 0; i < exchanges.length; i += batchSize) {
      const batch = exchanges.slice(i, i + batchSize);
      await monitor.processExchanges(batch);
      processedCount += batch.length;
      console.log(`⚡ Processed ${processedCount}/${exchanges.length} exchanges...`);
    }
    
    console.log('✅ Historical transcript reprocessing completed!');
    console.log(`📋 Generated detailed LSL files with current format`);
    
    // Show summary of created files
    if (fs.existsSync(historyDir)) {
      const newFiles = fs.readdirSync(historyDir).filter(file => 
        file.includes('-session') && file.endsWith('.md')
      );
      console.log(`📁 Created ${newFiles.length} session files in ${path.basename(targetProject)}`);
    }
    
    if (targetProject !== codingPath && fs.existsSync(path.join(codingPath, '.specstory', 'history'))) {
      const codingFiles = fs.readdirSync(path.join(codingPath, '.specstory', 'history')).filter(file => 
        file.includes('from-' + path.basename(targetProject)) && file.endsWith('.md')
      );
      console.log(`📁 Created ${codingFiles.length} redirected session files in coding project`);
    }
    
  } catch (error) {
    console.error('❌ Failed to reprocess historical transcripts:', error.message);
    process.exit(1);
  }
}

// CLI interface
async function main() {
  try {
    const args = process.argv.slice(2);
    
    // Check for reprocessing mode
    if (args.includes('--reprocess') || args.includes('--batch')) {
      const projectArg = args.find(arg => arg.startsWith('--project='));
      const projectPath = projectArg ? projectArg.split('=')[1] : null;
      await reprocessHistoricalTranscripts(projectPath);
      return;
    }
    
    // Normal monitoring mode
    const monitor = new EnhancedTranscriptMonitor({ debug: true });
    await monitor.start();
  } catch (error) {
    console.error('❌ Failed to start transcript monitor:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default EnhancedTranscriptMonitor;