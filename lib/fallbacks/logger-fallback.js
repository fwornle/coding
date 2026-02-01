import fs from 'fs/promises';
import path from 'path';
import SpecstoryAdapter from '../integrations/specstory-adapter.js';
import { createLogger } from '../logging/Logger.js';

const logger = createLogger('logger-fallback');

class LoggerFallbackService {
  constructor(config = {}) {
    this.logDir = config.logDir || path.join(process.cwd(), '.specstory', 'history');
    this.currentSession = null;
    this.specstoryAdapter = new SpecstoryAdapter();
    this.hasSpecstory = false;
    this.initialized = false;
  }

  async initialize() {
    try {
      // Try Specstory first
      this.hasSpecstory = await this.specstoryAdapter.initialize();
      
      // Setup file-based fallback
      await fs.mkdir(this.logDir, { recursive: true });
      this.currentSession = await this.createSession();
      
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize logger service: ${error.message}`);
    }
  }

  async cleanup() {
    // Nothing to cleanup for file-based logging
  }

  /**
   * Create a new session
   */
  async createSession() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionId = `session-${timestamp}-${process.pid}`;
    
    const sessionFile = path.join(this.logDir, `${sessionId}.json`);
    await fs.writeFile(sessionFile, JSON.stringify({
      sessionId,
      startTime: new Date().toISOString(),
      agent: process.env.CODING_AGENT || 'unknown',
      entries: []
    }, null, 2));
    
    return sessionId;
  }

  /**
   * Log a conversation entry
   */
  async logConversation(entry) {
    if (!this.initialized) throw new Error('Logger service not initialized');
    
    // Try Specstory first
    if (this.hasSpecstory) {
      const logged = await this.specstoryAdapter.logConversation(entry);
      if (logged && logged.success !== false) {
        return { success: true, method: 'specstory' };
      }
    }
    
    // Fallback to file-based logging
    try {
      const sessionFile = path.join(this.logDir, `${this.currentSession}.json`);
      const sessionData = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
      
      // Add entry
      sessionData.entries.push({
        ...entry,
        timestamp: entry.timestamp || new Date().toISOString(),
        index: sessionData.entries.length
      });
      
      // Update session
      sessionData.lastUpdate = new Date().toISOString();
      
      // Write back
      await fs.writeFile(sessionFile, JSON.stringify(sessionData, null, 2));
      
      // Also create individual entry file for easier access
      const entryFile = path.join(
        this.logDir, 
        `${this.currentSession}-entry-${sessionData.entries.length}.json`
      );
      
      await fs.writeFile(entryFile, JSON.stringify({
        sessionId: this.currentSession,
        ...entry,
        timestamp: entry.timestamp || new Date().toISOString()
      }, null, 2));
      
      return { success: true, method: 'file', sessionFile, entryFile };
    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Read conversation history
   */
  async readConversationHistory(options = {}) {
    if (!this.initialized) throw new Error('Logger service not initialized');
    
    const logs = [];
    
    // Try Specstory first
    if (this.hasSpecstory) {
      const specstoryLogs = await this.specstoryAdapter.readLogs(options);
      logs.push(...specstoryLogs);
    }
    
    // Read file-based logs
    try {
      const files = await fs.readdir(this.logDir);
      const sessionFiles = files.filter(f => 
        f.startsWith('session-') && f.endsWith('.json')
      );
      
      for (const file of sessionFiles) {
        try {
          const content = await fs.readFile(path.join(this.logDir, file), 'utf8');
          const session = JSON.parse(content);
          
          // Apply filters if provided
          if (options.agent && session.agent !== options.agent) continue;
          if (options.after && new Date(session.startTime) < new Date(options.after)) continue;
          if (options.before && new Date(session.startTime) > new Date(options.before)) continue;
          
          // Add session entries
          for (const entry of session.entries) {
            logs.push({
              ...entry,
              sessionId: session.sessionId,
              agent: session.agent
            });
          }
        } catch (error) {
          // Skip corrupted files
          logger.warn(`Failed to read session file ${file}`, { error: error.message });
        }
      }
    } catch (error) {
      logger.error('Failed to read conversation history', { error: error.message });
    }
    
    // Sort by timestamp (newest first)
    logs.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    // Apply limit if specified
    if (options.limit) {
      return logs.slice(0, options.limit);
    }
    
    return logs;
  }

  /**
   * Search conversation history
   */
  async searchHistory(query, options = {}) {
    const allLogs = await this.readConversationHistory(options);
    
    const queryLower = query.toLowerCase();
    return allLogs.filter(log => {
      const content = JSON.stringify(log).toLowerCase();
      return content.includes(queryLower);
    });
  }

  /**
   * Get current session info
   */
  async getCurrentSession() {
    if (!this.currentSession) return null;
    
    try {
      const sessionFile = path.join(this.logDir, `${this.currentSession}.json`);
      const content = await fs.readFile(sessionFile, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Export logs in different formats
   */
  async exportLogs(format = 'json', options = {}) {
    const logs = await this.readConversationHistory(options);
    
    switch (format) {
      case 'json':
        return JSON.stringify(logs, null, 2);
        
      case 'markdown':
        return this.exportAsMarkdown(logs);
        
      case 'csv':
        return this.exportAsCSV(logs);
        
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  exportAsMarkdown(logs) {
    let markdown = '# Conversation History\n\n';
    
    let currentSession = null;
    for (const log of logs) {
      if (log.sessionId !== currentSession) {
        currentSession = log.sessionId;
        markdown += `\n## Session: ${currentSession}\n\n`;
      }
      
      markdown += `### ${log.timestamp}\n`;
      markdown += `**Type**: ${log.type || 'message'}\n`;
      markdown += `**Agent**: ${log.agent || 'unknown'}\n\n`;
      
      if (typeof log.content === 'string') {
        markdown += `${log.content}\n\n`;
      } else {
        markdown += '```json\n';
        markdown += JSON.stringify(log.content, null, 2);
        markdown += '\n```\n\n';
      }
      
      markdown += '---\n\n';
    }
    
    return markdown;
  }

  exportAsCSV(logs) {
    const headers = ['Timestamp', 'Session', 'Agent', 'Type', 'Content'];
    const rows = [headers];
    
    for (const log of logs) {
      const content = typeof log.content === 'string' 
        ? log.content 
        : JSON.stringify(log.content);
      
      rows.push([
        log.timestamp,
        log.sessionId || '',
        log.agent || '',
        log.type || 'message',
        content.replace(/"/g, '""') // Escape quotes for CSV
      ]);
    }
    
    return rows.map(row => 
      row.map(cell => `"${cell}"`).join(',')
    ).join('\n');
  }
}

export default LoggerFallbackService;