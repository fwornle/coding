#!/usr/bin/env node

/**
 * Claude Code Transcript Monitor
 * Monitors Claude Code's built-in transcript files for new exchanges
 * Based on claude-code-tamagotchi approach for live conversation capture
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { GrokAnalyzer } from '../src/live-logging/GroqAnalyzer.js';

class TranscriptMonitor {
  constructor(config = {}) {
    this.config = {
      grokApiKey: config.grokApiKey || process.env.GROK_API_KEY,
      checkInterval: config.checkInterval || 5000, // Check every 5 seconds
      maxProcessBatch: config.maxProcessBatch || 10,
      projectPath: config.projectPath || process.cwd(),
      debug: config.debug || process.env.TRANSCRIPT_DEBUG === 'true',
      ...config
    };

    this.transcriptPath = this.findCurrentTranscript();
    this.lastProcessedUuid = null;
    this.lastFileSize = 0;
    this.isProcessing = false;
    
    // Initialize Grok analyzer if API key available
    this.grok = this.config.grokApiKey ? new GrokAnalyzer(this.config.grokApiKey) : null;
    
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
      
      if (timeDiff < 3600000) { // 1 hour
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
          
          // Analyze with Grok if available
          let analysis = null;
          if (this.grok && !result?.is_error) {
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

            analysis = await this.grok.analyzeToolInteraction(interaction, context);
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
   * Log exchange to session file
   */
  async logExchange(exchange, toolCall, result, analysis) {
    const sessionDir = path.join(this.config.projectPath, '.specstory', 'history');
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
    const filename = `${timestamp}_live-transcript.md`;
    const filepath = path.join(sessionDir, filename);

    let content = '';
    if (fs.existsSync(filepath)) {
      content = fs.readFileSync(filepath, 'utf-8');
    } else {
      content = `# Live Transcript Session

**Started:** ${now.toISOString()}  
**Source:** Claude Code Transcript Monitor  
**Project:** ${path.basename(this.config.projectPath)}  

---

## Exchanges

`;
    }

    // Generate exchange entry
    const exchangeTime = new Date(exchange.timestamp).toISOString();
    const toolSuccess = result && !result.is_error;
    const analysisInsight = analysis?.insight || 'No analysis available';
    
    content += `### ${toolCall.name} - ${exchangeTime}

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

    fs.writeFileSync(filepath, content);
    this.debug(`Logged exchange to: ${filename}`);
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
    console.log(`🧠 Semantic analysis: ${this.grok ? '✅ Enabled' : '❌ Disabled (no GROK_API_KEY)'}`);

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
      hasGrokAnalyzer: !!this.grok,
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