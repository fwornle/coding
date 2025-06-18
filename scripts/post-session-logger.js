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
        console.log('⚠️  No conversation content found - marking session as logged to avoid future attempts');
        // Mark session as logged even if empty to avoid repeat attempts
        sessionData.needsLogging = false;
        sessionData.loggedAt = new Date().toISOString();
        sessionData.logFile = 'No content found';
        fs.writeFileSync(this.sessionFile, JSON.stringify(sessionData, null, 2));
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
      conversationData.messages.forEach((message, index) => {
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

  detectCodingContent(content) {
    const lowerContent = content.toLowerCase();
    
    // Semantic patterns for coding infrastructure discussions
    const codingPatterns = [
      // Knowledge base management tools
      /\b(ukb|vkb)\s+(command|tool|update|sync)/,
      /shared-memory\.json\s+(update|edit|management)/,
      /knowledge[\s-]?base\s+(management|tool|update|sync)/,
      
      // MCP and Claude tools development
      /\bmcp\s+(server|client|tool|development|integration)/,
      /claude[\s-]?mcp\s+(setup|configuration|development)/,
      /claude\s+tools?\s+(development|setup|configuration)/,
      
      // Logging infrastructure (not just any .specstory mention)
      /specstory\s+(logger|logging|mechanism|infrastructure)/,
      /claude[\s-]?logger\s+(setup|configuration|development)/,
      /post[\s-]?session[\s-]?logg(er|ing)/,
      /automatic\s+logging\s+(setup|mechanism|infrastructure)/,
      
      // Coding repository specific
      /coding\s+(project|repo|repository)\s+(setup|configuration|tools)/,
      /agentic\/coding\s+(directory|folder|repository)/,
      
      // Infrastructure and tooling
      /install\.sh\s+(script|setup|configuration)/,
      /\.activate\s+(script|command|setup)/,
      /memory[\s-]?visualizer\s+(tool|setup|development)/,
      /start[\s-]?auto[\s-]?logger/,
      
      // Cross-project patterns and knowledge transfer
      /transferable\s+pattern/,
      /cross[\s-]?project\s+(knowledge|pattern|tool)/,
      /shared\s+knowledge\s+(management|system)/
    ];
    
    // Check semantic patterns first
    const hasSemanticMatch = codingPatterns.some(pattern => pattern.test(lowerContent));
    if (hasSemanticMatch) return true;
    
    // Fallback to specific unambiguous keywords
    const unambiguousKeywords = [
      'ukb', 'vkb', // These are always coding-related
      'agentic/coding',
      'coding_repo',
      'todowrite', 'todoread' // These are Claude Code specific tools
    ];
    
    // Context-aware detection: if discussing .specstory in context of timeline data, it's NOT coding-related
    const timelineContext = [
      /\.specstory\/history\s+(data|files?|directory)/,
      /timeline.*\.specstory/,
      /\.specstory.*timeline/,
      /extract.*\.specstory.*data/,
      /read.*\.specstory.*files?/
    ];
    
    const isTimelineContext = timelineContext.some(pattern => pattern.test(lowerContent));
    if (isTimelineContext) return false;
    
    return unambiguousKeywords.some(keyword => lowerContent.includes(keyword));
  }

  createLogFile(targetRepo, sessionData, content) {
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