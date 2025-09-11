#!/usr/bin/env node

/**
 * Transcript Analyzer for Live Logging
 * Reads Claude Code transcript files and provides real-time analysis
 */

import fs from 'fs';
import path from 'path';
import { GrokAnalyzer } from './GroqAnalyzer.js';
import { SessionDatabase } from './SessionDatabase.js';

export class TranscriptAnalyzer {
  constructor(config = {}) {
    this.config = {
      grokApiKey: config.grokApiKey || process.env.GROK_API_KEY,
      dbPath: config.dbPath || path.join(process.cwd(), '.live-logging', 'sessions.db'),
      batchSize: config.batchSize || 5,
      staleLockTime: config.staleLockTime || 30000,
      debug: config.debug || process.env.LIVE_LOGGING_DEBUG === 'true',
      ...config
    };

    this.grok = new GrokAnalyzer(this.config.grokApiKey);
    this.db = new SessionDatabase(this.config.dbPath);
    this.isProcessing = false;
    this.lastCheckTime = 0;
  }

  /**
   * Find Claude Code transcript file for current session
   */
  findTranscriptFile() {
    // Claude Code stores transcripts in ~/.claude/conversations/
    const homeDir = require('os').homedir();
    const transcriptsDir = path.join(homeDir, '.claude', 'conversations');
    
    if (!fs.existsSync(transcriptsDir)) {
      return null;
    }

    try {
      // Find the most recently modified .jsonl file
      const files = fs.readdirSync(transcriptsDir)
        .filter(file => file.endsWith('.jsonl'))
        .map(file => {
          const filepath = path.join(transcriptsDir, file);
          const stats = fs.statSync(filepath);
          return { 
            path: filepath, 
            mtime: stats.mtime,
            size: stats.size
          };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) {
        return null;
      }

      // Return the most recent file that's been modified in the configured session duration
      const mostRecent = files[0];
      const timeDiff = Date.now() - mostRecent.mtime.getTime();
      
      // Load session duration from config (defaults to 1 hour)
      const sessionDuration = this.getSessionDurationMs();
      
      if (timeDiff < sessionDuration) {
        return mostRecent.path;
      }

      return null;
    } catch (error) {
      this.debug(`Error finding transcript: ${error.message}`);
      return null;
    }
  }

  /**
   * Get session duration from config file in milliseconds
   */
  getSessionDurationMs() {
    try {
      // Find the coding repository root
      const codingRepo = process.env.CODING_REPO || process.env.CODING_TOOLS_PATH;
      if (!codingRepo) {
        return 3600000; // Default: 1 hour
      }
      
      const configPath = path.join(codingRepo, 'config', 'live-logging-config.json');
      if (!fs.existsSync(configPath)) {
        return 3600000; // Default: 1 hour
      }
      
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.live_logging?.session_duration || 3600000; // Default: 1 hour
    } catch (error) {
      this.debug(`Error loading session duration from config: ${error.message}`);
      return 3600000; // Default: 1 hour
    }
  }

  /**
   * Read and parse transcript messages
   */
  readTranscript(transcriptPath) {
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
          messages.push(message);
        } catch {
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
   * Extract tool interactions from messages
   */
  extractToolInteractions(messages) {
    const interactions = [];
    
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      
      if (message.type === 'assistant' && message.message?.content) {
        const content = message.message.content;
        
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === 'tool_use') {
              // Find the corresponding tool result
              const toolResult = this.findToolResult(messages, i + 1, item.id);
              
              interactions.push({
                uuid: message.uuid,
                timestamp: message.timestamp || Date.now(),
                toolName: item.name,
                toolInput: item.input,
                toolResult: toolResult ? toolResult.content : null,
                success: toolResult ? !toolResult.error : null
              });
            }
          }
        }
      }
    }

    return interactions;
  }

  /**
   * Find tool result for a specific tool use ID
   */
  findToolResult(messages, startIndex, toolUseId) {
    for (let i = startIndex; i < Math.min(messages.length, startIndex + 5); i++) {
      const message = messages[i];
      
      if (message.type === 'user' && message.message?.content) {
        const content = message.message.content;
        
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === 'tool_result' && item.tool_use_id === toolUseId) {
              return {
                content: item.content,
                error: item.is_error || false
              };
            }
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Quick analysis for immediate display (< 10ms)
   */
  async quickAnalyze() {
    const startTime = Date.now();
    
    try {
      // Find current transcript
      const transcriptPath = this.findTranscriptFile();
      if (!transcriptPath) {
        return {
          sessionFile: null,
          newInteractions: 0,
          totalTools: 0,
          sessionDuration: 0,
          status: 'no_session'
        };
      }

      // Read messages
      const messages = this.readTranscript(transcriptPath);
      if (messages.length === 0) {
        return {
          sessionFile: null,
          newInteractions: 0,
          totalTools: 0,
          sessionDuration: 0,
          status: 'empty_session'
        };
      }

      // Extract tool interactions
      const interactions = this.extractToolInteractions(messages);
      
      // Get session info
      const firstMessage = messages[0];
      const lastMessage = messages[messages.length - 1];
      const sessionId = this.extractSessionId(transcriptPath);
      
      // Check for new interactions
      const lastProcessed = this.db.getLastProcessedMessage(sessionId);
      const newInteractions = lastProcessed ? 
        interactions.filter(i => i.timestamp > lastProcessed.timestamp).length : 
        interactions.length;

      // Calculate session duration
      const sessionDuration = lastMessage.timestamp - firstMessage.timestamp;

      const elapsed = Date.now() - startTime;
      this.debug(`Quick analyze completed in ${elapsed}ms`);

      return {
        sessionFile: path.basename(transcriptPath),
        sessionId,
        newInteractions,
        totalTools: interactions.length,
        sessionDuration,
        status: 'active',
        interactions: interactions.slice(-5), // Last 5 for display
        shouldSpawn: newInteractions > 0 && !this.isProcessing
      };

    } catch (error) {
      this.debug(`Quick analyze error: ${error.message}`);
      return {
        sessionFile: null,
        newInteractions: 0,
        totalTools: 0,
        sessionDuration: 0,
        status: 'error'
      };
    }
  }

  /**
   * Extract session ID from transcript path
   */
  extractSessionId(transcriptPath) {
    const basename = path.basename(transcriptPath, '.jsonl');
    return basename;
  }

  /**
   * Spawn background analysis worker
   */
  spawnBackgroundAnalysis(transcriptPath, sessionId) {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.debug(`Starting background analysis for session ${sessionId}`);

    // Use setTimeout to simulate async processing without blocking
    setTimeout(async () => {
      try {
        await this.performDetailedAnalysis(transcriptPath, sessionId);
      } catch (error) {
        this.debug(`Background analysis error: ${error.message}`);
      } finally {
        this.isProcessing = false;
      }
    }, 0);
  }

  /**
   * Perform detailed analysis with Grok
   */
  async performDetailedAnalysis(transcriptPath, sessionId) {
    try {
      const messages = this.readTranscript(transcriptPath);
      const interactions = this.extractToolInteractions(messages);
      
      // Get unprocessed interactions
      const lastProcessed = this.db.getLastProcessedMessage(sessionId);
      const unprocessed = lastProcessed ? 
        interactions.filter(i => i.timestamp > lastProcessed.timestamp) :
        interactions.slice(-this.config.batchSize);

      if (unprocessed.length === 0) {
        return;
      }

      this.debug(`Processing ${unprocessed.length} interactions`);

      // Analyze with Grok
      for (const interaction of unprocessed) {
        const analysis = await this.grok.analyzeToolInteraction(
          interaction,
          this.getContext(messages, interaction.uuid)
        );

        // Save to database
        this.db.saveInteractionAnalysis(sessionId, interaction, analysis);
        
        // Update session file in real-time
        this.updateSessionFile(sessionId, interaction, analysis);
      }

      // Update last processed
      if (unprocessed.length > 0) {
        const lastInteraction = unprocessed[unprocessed.length - 1];
        this.db.updateLastProcessed(sessionId, lastInteraction);
      }

    } catch (error) {
      this.debug(`Detailed analysis error: ${error.message}`);
    }
  }

  /**
   * Get context for tool interaction
   */
  getContext(messages, messageUuid) {
    const messageIndex = messages.findIndex(m => m.uuid === messageUuid);
    if (messageIndex === -1) return {};

    // Look back for user request
    let userRequest = '';
    for (let i = messageIndex - 1; i >= Math.max(0, messageIndex - 10); i--) {
      const msg = messages[i];
      if (msg.type === 'user' && msg.message?.content) {
        const content = typeof msg.message.content === 'string' ? 
          msg.message.content : 
          msg.message.content.find(c => c.type === 'text')?.text || '';
        
        if (content && !content.includes('tool_result')) {
          userRequest = content;
          break;
        }
      }
    }

    return {
      userRequest,
      previousActions: this.extractPreviousActions(messages, messageIndex)
    };
  }

  /**
   * Extract previous actions for context
   */
  extractPreviousActions(messages, currentIndex) {
    const actions = [];
    const start = Math.max(0, currentIndex - 5);
    
    for (let i = start; i < currentIndex; i++) {
      const msg = messages[i];
      if (msg.type === 'assistant' && msg.message?.content) {
        const content = msg.message.content;
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === 'tool_use') {
              actions.push(`${item.name}: ${JSON.stringify(item.input).slice(0, 50)}...`);
            }
          }
        }
      }
    }

    return actions;
  }

  /**
   * Update live session file
   */
  updateSessionFile(sessionId, interaction, analysis) {
    try {
      const sessionDir = path.join(process.cwd(), '.specstory', 'history');
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `${timestamp}_live-session.md`;
      const filepath = path.join(sessionDir, filename);

      // Read existing content or create new
      let content = '';
      if (fs.existsSync(filepath)) {
        content = fs.readFileSync(filepath, 'utf-8');
      } else {
        content = `# Live Session Log

**Session ID:** ${sessionId}  
**Started:** ${now.toISOString()}  
**Type:** Live Transcript Analysis  

---

## Tool Interactions

`;
      }

      // Append new interaction
      content += `### ${interaction.toolName}
**Time:** ${new Date(interaction.timestamp).toISOString()}  
**Input:** \`\`\`json
${JSON.stringify(interaction.toolInput, null, 2)}
\`\`\`
**Result:** ${interaction.success ? '✅ Success' : '❌ Error'}
${analysis?.insight ? `**AI Insight:** ${analysis.insight}` : ''}

---

`;

      fs.writeFileSync(filepath, content);
      this.debug(`Updated session file: ${filename}`);

    } catch (error) {
      this.debug(`Error updating session file: ${error.message}`);
    }
  }

  /**
   * Debug logging
   */
  debug(message) {
    if (this.config.debug) {
      console.error(`[LiveLogging] ${new Date().toISOString()} ${message}`);
    }
  }

  /**
   * Cleanup
   */
  close() {
    this.db.close();
  }
}