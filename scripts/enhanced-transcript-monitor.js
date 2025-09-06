#!/usr/bin/env node

/**
 * Enhanced Claude Code Transcript Monitor
 * Supports multiple parallel sessions with prompt-triggered trajectory updates
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseTimestamp, formatTimestamp, getTimeWindow, getTimezone } from './timezone-utils.js';

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
      ...config
    };

    this.transcriptPath = this.findCurrentTranscript();
    this.lastProcessedUuid = null;
    this.lastFileSize = 0;
    this.isProcessing = false;
    this.currentUserPromptSet = [];
    this.lastUserPromptTime = null;
    this.sessionFiles = new Map(); // Track multiple session files
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
        return entry.message.content;
      }
      return this.extractTextContent(entry.message.content);
    }
    if (entry.content) {
      return this.extractTextContent(entry.content);
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
   * Check if content involves coding project
   */
  isCodingRelated(exchange) {
    // Get the coding directory path
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';
    
    console.log(`\n🔍 SIMPLE CODING DETECTION:`);
    console.log(`  Coding path: ${codingPath}`);
    console.log(`  Tools: ${exchange.toolCalls?.map(t => t.name).join(', ') || 'none'}`);
    
    // Check tool calls for file operations in coding directory
    for (const toolCall of exchange.toolCalls || []) {
      const toolData = JSON.stringify(toolCall).toLowerCase();
      
      // Look for file operations (Read, Write, Edit, etc.) that touch coding directory
      if (toolData.includes(codingPath.toLowerCase())) {
        console.log(`✅ CODING DETECTED: ${toolCall.name} touches ${codingPath}`);
        this.debug(`Coding detected: ${toolCall.name} operates on ${codingPath}`);
        return true;
      }
      
      // Also check for explicit coding/ paths in tool parameters
      if (toolData.includes('/coding/') || toolData.includes('coding/')) {
        console.log(`✅ CODING DETECTED: ${toolCall.name} references coding/ directory`);
        this.debug(`Coding detected: ${toolCall.name} references coding/ directory`);
        return true;
      }
    }
    
    // Check tool results for coding directory references
    for (const toolResult of exchange.toolResults || []) {
      const resultData = JSON.stringify(toolResult).toLowerCase();
      
      if (resultData.includes(codingPath.toLowerCase()) || resultData.includes('/coding/')) {
        console.log(`✅ CODING DETECTED: Tool result references coding directory`);
        this.debug(`Coding detected: Tool result references coding directory`);
        return true;
      }
    }
    
    console.log(`❌ NON-CODING: No file operations in coding directory detected`);
    this.debug(`Non-coding: No file operations in coding directory detected`);
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
      // Redirected to coding project
      return path.join(targetProject, '.specstory', 'history', `${baseName}_coding-session-from-${currentProjectName}.md`);
    }
  }

  /**
   * Update comprehensive trajectory file
   */
  async updateComprehensiveTrajectory(targetProject) {
    try {
      const { spawn } = await import('child_process');
      const scriptDir = path.dirname(import.meta.url.replace('file://', ''));
      const updateScript = path.join(scriptDir, 'update-comprehensive-trajectory-v2.js');
      
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

    const sessionFile = this.getSessionFilePath(targetProject, tranche);
    
    // Log the completed user prompt set to session file
    for (const exchange of completedSet) {
      await this.logExchangeToSession(exchange, sessionFile, targetProject);
    }

    // Update comprehensive trajectory instead of individual trajectory files
    await this.updateComprehensiveTrajectory(targetProject);
    
    console.log(`📋 Completed user prompt set: ${completedSet.length} exchanges → ${path.basename(sessionFile)}`);
  }

  /**
   * Log exchange to session file
   */
  async logExchangeToSession(exchange, sessionFile, targetProject) {
    const exchangeTime = new Date(exchange.timestamp).toISOString();
    const isRedirected = targetProject !== this.config.projectPath;
    
    let content = `### User Prompt - ${exchangeTime}${isRedirected ? ' (Redirected)' : ''}\n\n`;
    content += `**Request:** ${exchange.userMessage?.slice(0, 500) || 'No context'}${exchange.userMessage?.length > 500 ? '...' : ''}\n\n`;
    
    if (exchange.claudeResponse) {
      content += `**Claude Response:** ${exchange.claudeResponse.slice(0, 300)}${exchange.claudeResponse.length > 300 ? '...' : ''}\n\n`;
    }
    
    if (exchange.toolCalls.length > 0) {
      content += `**Tools Used:**\n`;
      for (const tool of exchange.toolCalls) {
        const result = exchange.toolResults.find(r => r.tool_use_id === tool.id);
        const success = result && !result.is_error;
        content += `- ${tool.name}: ${success ? '✅' : '❌'}\n`;
      }
      content += '\n';
    }
    
    content += `**Analysis:** ${this.isCodingRelated(exchange) ? '🔧 Coding activity' : '📋 General activity'}\n\n---\n\n`;

    fs.appendFileSync(sessionFile, content);
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
            const targetProject = this.isCodingRelated(this.currentUserPromptSet[0]) ? 
              (process.env.CODING_TOOLS_PATH || '/Users/q284340/Agentic/coding') : 
              this.config.projectPath;
            
            await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, this.lastTranche || currentTranche);
            this.currentUserPromptSet = [];
          }
          
          // Create new session files for new time boundary
          const newTargetProject = this.isCodingRelated(exchange) ? 
            (process.env.CODING_TOOLS_PATH || '/Users/q284340/Agentic/coding') : 
            this.config.projectPath;
          
          await this.createEmptySessionFile(newTargetProject, currentTranche);
          this.lastTranche = currentTranche;
          
          // Manage redirect notification for new session boundary
          if (newTargetProject !== this.config.projectPath) {
            await this.notifyStatusLineRedirect(currentTranche);
          } else {
            // Clear redirect status when creating local session
            await this.clearRedirectStatus();
          }
        } else {
          // Same session - complete current user prompt set
          if (this.currentUserPromptSet.length > 0) {
            const targetProject = this.isCodingRelated(this.currentUserPromptSet[0]) ? 
              (process.env.CODING_TOOLS_PATH || '/Users/q284340/Agentic/coding') : 
              this.config.projectPath;
            
            await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, currentTranche);
            
            // Manage redirect notification based on target
            if (targetProject !== this.config.projectPath) {
              await this.notifyStatusLineRedirect(currentTranche);
            } else {
              // Clear redirect status when processing local (non-coding) activities
              await this.clearRedirectStatus();
            }
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

  /**
   * Notify status line about coding redirect
   */
  async notifyStatusLineRedirect(tranche) {
    try {
      const redirectFile = path.join(this.config.projectPath, '.specstory', '.redirect-status');
      const redirectInfo = {
        timestamp: new Date().toISOString(),
        tranche: tranche.timeString,
        target: 'coding'
      };
      fs.writeFileSync(redirectFile, JSON.stringify(redirectInfo));
      this.debug(`Notified status line of redirect to coding`);
    } catch (error) {
      this.debug(`Failed to notify status line: ${error.message}`);
    }
  }

  /**
   * Clear redirect status when no active redirection
   */
  async clearRedirectStatus() {
    try {
      const redirectFile = path.join(this.config.projectPath, '.specstory', '.redirect-status');
      if (fs.existsSync(redirectFile)) {
        fs.unlinkSync(redirectFile);
        this.debug(`Cleared redirect status`);
      }
    } catch (error) {
      this.debug(`Failed to clear redirect status: ${error.message}`);
    }
  }

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
        const targetProject = this.isCodingRelated(this.currentUserPromptSet[0]) ? 
          (process.env.CODING_TOOLS_PATH || '/Users/q284340/Agentic/coding') : 
          this.config.projectPath;
        
        await this.processUserPromptSetCompletion(this.currentUserPromptSet, targetProject, currentTranche);
      }
      
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
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const monitor = new EnhancedTranscriptMonitor({ debug: true });
  monitor.start();
}

export default EnhancedTranscriptMonitor;