#!/usr/bin/env node

/**
 * Post-Session Logger for Claude Code
 * Captures conversation history after Claude exits and logs it appropriately
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class PostSessionLogger {
  constructor(projectPath, codingRepo, sessionId) {
    this.projectPath = projectPath;
    this.codingRepo = codingRepo;
    this.sessionId = sessionId;
    this.sessionFile = path.join(codingRepo, '.mcp-sync', 'current-session.json');
  }

  async captureConversation() {
    console.log('📋 Post-session logging started...');
    
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
        console.log('⚠️  No conversation content found');
        return;
      }

      // Analyze content to determine target repository
      const shouldGoToCoding = this.detectCodingContent(conversationContent);
      const targetRepo = shouldGoToCoding ? this.codingRepo : this.projectPath;
      
      console.log(`🎯 Routing to: ${targetRepo === this.codingRepo ? 'CODING repo' : 'current project'}`);

      // Create log file
      const logFile = this.createLogFile(targetRepo, sessionData, conversationContent);
      
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
      // Try to get the conversation from Claude's recent history
      // This is a best-effort approach using available information
      
      // Check if there's a temp file or recent activity
      const tempHistoryPath = `/tmp/claude-history-${this.sessionId}.txt`;
      if (fs.existsSync(tempHistoryPath)) {
        return fs.readFileSync(tempHistoryPath, 'utf8');
      }

      // Alternative: Look for recent .specstory files that might have been created
      const historyDir = path.join(this.projectPath, '.specstory', 'history');
      if (fs.existsSync(historyDir)) {
        const recentFiles = fs.readdirSync(historyDir)
          .map(file => ({
            name: file,
            path: path.join(historyDir, file),
            mtime: fs.statSync(path.join(historyDir, file)).mtime
          }))
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 3); // Check last 3 files

        for (const file of recentFiles) {
          const content = fs.readFileSync(file.path, 'utf8');
          // Check if this file was created during our session
          const timeDiff = Date.now() - file.mtime.getTime();
          if (timeDiff < 3600000) { // Within last hour
            return content;
          }
        }
      }

      // Fallback: Create a minimal session record
      return `# Session ${this.sessionId}

**Note:** This session was logged post-completion. Full conversation history may not be available.

**Session Details:**
- Session ID: ${this.sessionId}
- Project Path: ${this.projectPath}
- Logged at: ${new Date().toISOString()}

**Status:** Session completed successfully but conversation content could not be fully captured.
This indicates the real-time logging mechanism needs to be active during the session.`;

    } catch (error) {
      console.error('Error extracting conversation:', error);
      return null;
    }
  }

  detectCodingContent(content) {
    const lowerContent = content.toLowerCase();
    
    const codingKeywords = [
      'ukb', 'vkb', 'shared-memory.json', 'knowledge-base', 'knowledge base',
      'mcp', 'claude-mcp', 'specstory', 'claude-logger', 'coding project',
      'coding repo', 'coding repository', 'agentic/coding', 'install.sh',
      'knowledge management', 'transferable pattern', 'shared knowledge',
      'cross-project', '.activate', 'claude tools', 'memory-visualizer',
      'start-auto-logger', 'automatic logging', 'conversation logging',
      'CLAUDE.md', 'CODING_REPO', 'todowrite', 'todoread', 'post-session logging'
    ];
    
    return codingKeywords.some(keyword => lowerContent.includes(keyword));
  }

  createLogFile(targetRepo, sessionData, content) {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
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
- Automatic classification: ${this.detectCodingContent(content) ? 'Coding-related' : 'Project-specific'}
`;

    fs.writeFileSync(logPath, logContent);
    return logPath;
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

if (require.main === module) {
  main().catch(console.error);
}

module.exports = PostSessionLogger;