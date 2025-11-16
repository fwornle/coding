#!/usr/bin/env node

/**
 * Claude Conversation Extractor
 * Extracts conversation history from Claude Code's JSONL files
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { runIfMain } from '../lib/utils/esm-cli.js';

class ClaudeConversationExtractor {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    this.projectKey = this.getProjectKey(projectPath);
  }

  getProjectKey(projectPath) {
    // Claude Code converts paths like /Users/q284340/Agentic/coding to -Users-q284340-Agentic-coding
    return projectPath.replace(/\//g, '-');
  }

  async findRecentConversation(withinMinutes = 30) {
    const projectDir = path.join(this.claudeProjectsDir, this.projectKey);
    
    // Quick timeout check - don't hang
    if (!fs.existsSync(this.claudeProjectsDir)) {
      console.log(`⚠️  Claude projects directory not found: ${this.claudeProjectsDir}`);
      return null;
    }
    
    if (!fs.existsSync(projectDir)) {
      console.log(`⚠️  Claude project directory not found: ${projectDir}`);
      return null;
    }

    try {
      const files = fs.readdirSync(projectDir)
        .filter(file => file.endsWith('.jsonl'))
        .map(file => {
          const filePath = path.join(projectDir, file);
          const stats = fs.statSync(filePath);
          return {
            path: filePath,
            name: file,
            mtime: stats.mtime,
            sessionId: file.replace('.jsonl', '')
          };
        })
        .sort((a, b) => b.mtime - a.mtime); // Most recent first

      if (files.length === 0) {
        console.log('⚠️  No conversation files found');
        return null;
      }

      // Get the most recent file within the time window
      const now = new Date();
      const cutoff = new Date(now.getTime() - (withinMinutes * 60 * 1000));
      
      const recentFile = files.find(file => file.mtime >= cutoff);
      
      if (!recentFile) {
        console.log(`⚠️  No conversation files modified within ${withinMinutes} minutes`);
        console.log(`📁 Most recent file: ${files[0].name} (${files[0].mtime.toLocaleString()})`);
        // Return the most recent file anyway
        return files[0];
      }

      console.log(`✅ Found recent conversation: ${recentFile.name} (${recentFile.mtime.toLocaleString()})`);
      return recentFile;

    } catch (error) {
      console.error('❌ Error finding conversation files:', error.message);
      return null;
    }
  }

  async extractConversation(conversationFile) {
    if (!conversationFile) return null;

    try {
      console.log(`📖 Reading conversation from: ${conversationFile.name}`);
      
      const content = fs.readFileSync(conversationFile.path, 'utf8');
      const lines = content.trim().split('\n');
      
      const messages = [];
      let summary = '';

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          
          if (entry.type === 'summary') {
            summary = entry.summary;
          } else if (entry.type === 'user' || entry.type === 'assistant') {
            messages.push({
              type: entry.type,
              timestamp: entry.timestamp,
              content: this.extractMessageContent(entry.message),
              uuid: entry.uuid
            });
          }
        } catch (parseError) {
          console.warn('⚠️  Failed to parse line:', parseError.message);
        }
      }

      console.log(`📊 Extracted ${messages.length} messages`);
      
      return {
        sessionId: conversationFile.sessionId,
        summary: summary,
        messages: messages,
        totalMessages: messages.length,
        startTime: messages.length > 0 ? messages[0].timestamp : null,
        endTime: messages.length > 0 ? messages[messages.length - 1].timestamp : null
      };

    } catch (error) {
      console.error('❌ Error extracting conversation:', error.message);
      return null;
    }
  }

  extractMessageContent(message) {
    if (!message) return '';
    
    if (typeof message.content === 'string') {
      return message.content;
    } else if (Array.isArray(message.content)) {
      // Handle structured content (like Claude's response format)
      return message.content.map(part => {
        if (part.type === 'text') {
          return part.text;
        } else if (part.type === 'tool_use') {
          const input = part.input ? `\nInput: ${JSON.stringify(part.input, null, 2)}` : '';
          return `[Tool: ${part.name}]${input}`;
        } else if (part.type === 'tool_result') {
          const result = part.content || part.text || part.result || JSON.stringify(part, null, 2);
          return `[Tool Result]\n${result}`;
        }
        return '';
      }).join('\n\n');
    }
    
    return message.content || '';
  }

  formatConversationForLogging(conversation) {
    if (!conversation || !conversation.messages) return null;

    let content = `# Extracted Claude Code Conversation

**Session ID:** ${conversation.sessionId}  
**Summary:** ${conversation.summary || 'N/A'}  
**Start Time:** ${conversation.startTime ? new Date(conversation.startTime).toLocaleString() : 'N/A'}  
**End Time:** ${conversation.endTime ? new Date(conversation.endTime).toLocaleString() : 'N/A'}  
**Total Messages:** ${conversation.totalMessages}

---

`;

    let exchangeNumber = 0;
    let currentExchange = null;

    for (const message of conversation.messages) {
      const timestamp = new Date(message.timestamp).toLocaleString();
      
      if (message.type === 'user') {
        // Start new exchange
        if (currentExchange) {
          // Finish previous exchange if it exists
          content += `**Assistant:** *(No response recorded)*\n\n---\n\n`;
        }
        
        exchangeNumber++;
        content += `## Exchange ${exchangeNumber}\n\n`;
        content += `**User:** *(${timestamp})*\n${this.extractMessageContent(message)}\n\n`;
        currentExchange = { user: true };
        
      } else if (message.type === 'assistant') {
        if (currentExchange && currentExchange.user) {
          // Complete the exchange
          content += `**Assistant:** *(${timestamp})*\n${this.extractMessageContent(message)}\n\n---\n\n`;
          currentExchange = null;
        } else {
          // Orphaned assistant message
          content += `**Assistant:** *(${timestamp})*\n${this.extractMessageContent(message)}\n\n---\n\n`;
        }
      }
    }

    // Handle incomplete final exchange
    if (currentExchange && currentExchange.user) {
      content += `**Assistant:** *(No response recorded)*\n\n---\n\n`;
    }

    content += `\n**Extraction Summary:**
- Extracted from: ${conversation.sessionId}.jsonl
- Processing time: ${new Date().toLocaleString()}
- Exchange count: ${exchangeNumber}
- Message count: ${conversation.totalMessages}
`;

    return content;
  }

  async extractRecentConversation(withinMinutes = 30) {
    console.log('🔍 Searching for recent Claude Code conversation...');
    
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Conversation extraction timed out')), 10000); // 10 second timeout
    });
    
    try {
      const extractionPromise = this._doExtractRecentConversation(withinMinutes);
      return await Promise.race([extractionPromise, timeoutPromise]);
    } catch (error) {
      if (error.message.includes('timed out')) {
        console.log('⚠️  Conversation extraction timed out, skipping');
        return null;
      }
      throw error;
    }
  }
  
  async _doExtractRecentConversation(withinMinutes) {
    const recentFile = await this.findRecentConversation(withinMinutes);
    if (!recentFile) {
      return null;
    }

    const conversation = await this.extractConversation(recentFile);
    if (!conversation) {
      return null;
    }

    return this.formatConversationForLogging(conversation);
  }
}

// Main execution
async function main() {
  const projectPath = process.argv[2] || process.cwd();
  const withinMinutes = parseInt(process.argv[3]) || 30;
  
  const extractor = new ClaudeConversationExtractor(projectPath);
  const formattedConversation = await extractor.extractRecentConversation(withinMinutes);
  
  if (formattedConversation) {
    console.log('✅ Conversation extracted successfully');
    // Output to stdout for use by other scripts
    if (process.argv.includes('--output')) {
      console.log('\n' + '='.repeat(80));
      console.log(formattedConversation);
    }
  } else {
    console.log('❌ No recent conversation found or extraction failed');
    process.exit(1);
  }
}

// Execute if run directly
runIfMain(import.meta.url, () => {
  main().catch(console.error);
});

export default ClaudeConversationExtractor;