#!/usr/bin/env node

/**
 * Post-Session Logger for Claude Code
 * Captures conversation history after Claude exits and logs it appropriately
 */

import fs from 'fs';
import path from 'path';
import { AutoInsightTrigger } from './auto-insight-trigger.js';
import LLMContentClassifier from './llm-content-classifier.js';

class PostSessionLogger {
  constructor(projectPath, codingRepo, sessionId) {
    this.projectPath = projectPath;
    this.codingRepo = codingRepo;
    this.sessionId = sessionId;
    this.sessionFile = path.join(codingRepo, '.mcp-sync', 'current-session.json');
  }

  async captureConversation() {
    console.log('📋 Post-session logging started...');
    
    // First, stop semantic-analysis system
    this.stopSemanticAnalysisSystem();
    
    try {
      // Check if session needs logging
      if (!fs.existsSync(this.sessionFile)) {
        console.log('❌ No session file found - skipping logging');
        return;
      }

      const sessionData = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      if (!sessionData.needsLogging) {
        console.log('ℹ️  Session already logged - skipping');
        return;
      }

      console.log(`🔍 Capturing conversation for session: ${sessionData.sessionId}`);

      // Get conversation history using Claude's internal history
      // This is a workaround since we can't directly access Claude's conversation buffer
      const conversationContent = await this.extractConversationFromHistory();
      
      if (!conversationContent) {
        console.log('⚠️  No conversation content found - marking session as logged to avoid future attempts');
        // Mark session as logged even if empty to avoid repeat attempts
        sessionData.needsLogging = false;
        sessionData.loggedAt = new Date().toISOString();
        sessionData.logFile = 'No content found';
        fs.writeFileSync(this.sessionFile, JSON.stringify(sessionData, null, 2));
        return;
      }

      // Analyze content to determine target repository
      const shouldGoToCoding = await this.detectCodingContent(conversationContent);
      
      // Check if session data contains projectPath that might be more accurate
      const actualProjectPath = sessionData.projectPath || this.projectPath;
      
      // Default behavior: logs go to the current project
      // Only route to coding repo if content is explicitly coding-related
      const targetRepo = shouldGoToCoding ? this.codingRepo : actualProjectPath;
      
      console.log(`🎯 Routing to: ${targetRepo === this.codingRepo ? 'CODING repo' : 'current project'}`);
      console.log(`📁 Project path: ${actualProjectPath}`);
      console.log(`🔍 Content analysis: ${shouldGoToCoding ? 'coding-related' : 'project-specific'}`);

      // Create log file
      const logFile = await this.createLogFile(targetRepo, sessionData, conversationContent);
      
      console.log(`✅ Conversation logged to: ${logFile}`);
      
      // Mark session as logged
      sessionData.needsLogging = false;
      sessionData.loggedAt = new Date().toISOString();
      sessionData.logFile = logFile;
      fs.writeFileSync(this.sessionFile, JSON.stringify(sessionData, null, 2));

    } catch (error) {
      console.error('❌ Post-session logging failed:', error.message);
    }
  }

  async extractConversationFromHistory() {
    try {
      // Check for Claude Code's session history in ~/.claude/conversations
      const homeDir = require('os').homedir();
      const claudeHistoryDir = path.join(homeDir, '.claude', 'conversations');
      
      if (fs.existsSync(claudeHistoryDir)) {
        // Look for the most recent conversation file
        const conversationFiles = fs.readdirSync(claudeHistoryDir)
          .filter(file => file.endsWith('.json'))
          .map(file => ({
            name: file,
            path: path.join(claudeHistoryDir, file),
            mtime: fs.statSync(path.join(claudeHistoryDir, file)).mtime
          }))
          .sort((a, b) => b.mtime - a.mtime);

        // Get the most recent conversation
        if (conversationFiles.length > 0) {
          const recentConversation = conversationFiles[0];
          const timeDiff = Date.now() - recentConversation.mtime.getTime();
          
          // If it was modified within the last 30 minutes, it's likely our session
          if (timeDiff < 1800000) {
            const conversationData = JSON.parse(fs.readFileSync(recentConversation.path, 'utf8'));
            return this.formatConversationFromClaudeHistory(conversationData);
          }
        }
      }

      // Fallback: Check for temp conversation capture files
      const tempHistoryPath = `/tmp/claude-conversation-${this.sessionId}.json`;
      if (fs.existsSync(tempHistoryPath)) {
        const tempData = JSON.parse(fs.readFileSync(tempHistoryPath, 'utf8'));
        return this.formatConversationFromTempData(tempData);
      }

      // Last resort: Return null so we skip logging empty sessions
      console.log('⚠️  No conversation content found - skipping empty session');
      return null;

    } catch (error) {
      console.error('Error extracting conversation:', error);
      return null;
    }
  }

  formatConversationFromClaudeHistory(conversationData) {
    let content = '';
    let exchangeCount = 0;

    if (conversationData.messages && conversationData.messages.length > 0) {
      conversationData.messages.forEach((message) => {
        if (message.role === 'user') {
          exchangeCount++;
          content += `## Exchange ${exchangeCount}\n\n**User:**\n${message.content}\n\n`;
        } else if (message.role === 'assistant') {
          content += `**Assistant:**\n${message.content}\n\n---\n\n`;
        }
      });
    }

    return content || null;
  }

  formatConversationFromTempData(tempData) {
    let content = '';
    
    if (tempData.exchanges && tempData.exchanges.length > 0) {
      tempData.exchanges.forEach((exchange, index) => {
        content += `## Exchange ${index + 1}\n\n**User:**\n${exchange.user}\n\n**Assistant:**\n${exchange.assistant}\n\n---\n\n`;
      });
    }

    return content || null;
  }

  async detectCodingContent(content) {
    try {
      // Use LLM-based semantic analysis
      const classifier = new LLMContentClassifier();
      const classification = await classifier.classifyContent(content);
      
      console.log(`🤖 LLM Classification: ${classification}`);
      
      return classification === 'coding';
    } catch (error) {
      console.warn('⚠️  LLM classification failed, using fallback detection:', error.message);
      
      // Fallback to basic pattern detection
      const lowerContent = content.toLowerCase();
      
      // Very specific coding infrastructure keywords
      const codingKeywords = [
        'ukb', 'vkb',
        'mcp server', 'mcp__memory',
        'semantic-analysis system',
        'post-session-logger',
        'claude-mcp',
        'shared-memory-coding.json',
        '/agentic/coding'
      ];
      
      return codingKeywords.some(keyword => lowerContent.includes(keyword));
    }
  }

  async createLogFile(targetRepo, sessionData, content) {
    const now = new Date();
    // Use local time instead of UTC
    const date = now.getFullYear() + '-' + 
                String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                String(now.getDate()).padStart(2, '0');
    const time = String(now.getHours()).padStart(2, '0') + '-' + 
                String(now.getMinutes()).padStart(2, '0') + '-' + 
                String(now.getSeconds()).padStart(2, '0');
    const suffix = targetRepo === this.codingRepo ? 'coding-session' : 'project-session';
    
    const filename = `${date}_${time}_post-logged-${suffix}.md`;
    const logPath = path.join(targetRepo, '.specstory', 'history', filename);
    
    // Ensure directory exists
    const historyDir = path.dirname(logPath);
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }

    const logContent = `# Post-Session Logged Conversation

**Session ID:** ${sessionData.sessionId}  
**Started:** ${sessionData.startTime}  
**Logged:** ${now.toISOString()}  
**Project:** ${sessionData.projectPath}  
**Target Repository:** ${targetRepo}  
**Content Classification:** ${targetRepo === this.codingRepo ? 'Coding/Knowledge Management' : 'Project-specific'}

---

${content}

---

**Post-Session Logging Summary:**
- Logged at: ${now.toISOString()}
- Content routed to: ${targetRepo === this.codingRepo ? 'Coding repository' : 'Current project'}
- Automatic classification: ${targetRepo === this.codingRepo ? 'Coding-related' : 'Project-specific'}
`;

    fs.writeFileSync(logPath, logContent);
    
    // Trigger auto insight analysis after successful logging
    try {
      await AutoInsightTrigger.onSessionCompleted({
        sessionId: sessionData.sessionId,
        logPath,
        targetRepo,
        isCodingRelated: targetRepo === this.codingRepo
      });
    } catch (error) {
      console.log(`⚠️  Auto insight trigger failed: ${error.message}`);
    }
    
    return logPath;
  }

  stopSemanticAnalysisSystem() {
    console.log('🛑 Stopping all coding services...');
    try {
      // Use the new service lifecycle manager to stop all services
      const { spawnSync } = require('child_process');
      const stopScript = path.join(this.codingRepo, 'lib', 'services', 'stop-services.js');
      
      if (fs.existsSync(stopScript)) {
        const result = spawnSync('node', [stopScript, '--agent', 'claude', '--verbose'], { 
          stdio: 'inherit',
          cwd: this.codingRepo,
          encoding: 'utf8'
        });
        
        if (result.error) {
          throw result.error;
        }
        
        console.log('✅ All coding services stopped successfully');
      } else {
        console.warn('⚠️  Service stop script not found, attempting legacy cleanup...');
        
        // Fallback to legacy stop script
        const legacyScript = path.join(this.codingRepo, 'scripts', 'stop-semantic-agents.sh');
        if (fs.existsSync(legacyScript)) {
          spawnSync('/bin/bash', [legacyScript], { 
            stdio: 'inherit',
            cwd: this.codingRepo 
          });
        }
      }
    } catch (error) {
      console.error('⚠️  Failed to stop services:', error.message);
      console.log('🔄 Attempting emergency cleanup...');
      
      // Emergency cleanup - kill all semantic-analysis processes
      try {
        const { spawnSync } = require('child_process');
        spawnSync('pkill', ['-f', 'semantic-analysis'], { stdio: 'pipe' });
        spawnSync('pkill', ['-f', 'vkb-server'], { stdio: 'pipe' });
        spawnSync('pkill', ['-f', 'copilot-http-server'], { stdio: 'pipe' });
        console.log('✅ Emergency cleanup completed');
      } catch (cleanupError) {
        console.error('⚠️  Emergency cleanup failed:', cleanupError.message);
      }
    }
  }
}

// Main execution
async function main() {
  const projectPath = process.argv[2] || process.cwd();
  const codingRepo = process.argv[3] || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';
  const sessionId = process.argv[4] || `session-${Date.now()}`;

  const logger = new PostSessionLogger(projectPath, codingRepo, sessionId);
  await logger.captureConversation();
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch(console.error);
}

export default PostSessionLogger;