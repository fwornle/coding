#!/usr/bin/env node

/**
 * Real-time Conversation Capture for Claude Code
 * Monitors stdin/stdout to capture conversations as they happen
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

class ConversationCapture {
  constructor(projectPath, codingRepo, sessionId) {
    this.projectPath = projectPath;
    this.codingRepo = codingRepo;
    this.sessionId = sessionId;
    this.conversationBuffer = [];
    this.currentExchange = { user: '', assistant: '', timestamp: null };
    this.isCapturingUser = false;
    this.isCapturingAssistant = false;
    this.tempFile = `/tmp/claude-conversation-${sessionId}.json`;
    
    this.setupSignalHandlers();
  }

  setupSignalHandlers() {
    // Handle graceful shutdown
    process.on('SIGINT', () => this.saveAndExit());
    process.on('SIGTERM', () => this.saveAndExit());
    process.on('exit', () => this.saveConversation());
  }

  detectCodingContent(content) {
    const lowerContent = content.toLowerCase();
    const codingKeywords = [
      'ukb', 'vkb', 'shared-memory.json', 'knowledge-base', 'mcp',
      'claude-mcp', 'specstory', 'coding project', 'knowledge management',
      'start-auto-logger', 'post-session logging', 'CLAUDE.md'
    ];
    return codingKeywords.some(keyword => lowerContent.includes(keyword));
  }

  addExchange(userMsg, assistantMsg) {
    const exchange = {
      user: userMsg,
      assistant: assistantMsg,
      timestamp: new Date().toISOString(),
      isCodingRelated: this.detectCodingContent(userMsg + ' ' + assistantMsg)
    };
    
    this.conversationBuffer.push(exchange);
    
    // Save to temp file continuously
    fs.writeFileSync(this.tempFile, JSON.stringify({
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      codingRepo: this.codingRepo,
      exchanges: this.conversationBuffer
    }, null, 2));
  }

  saveConversation() {
    if (this.conversationBuffer.length === 0) return;
    
    // Determine target repository
    const hasCodingContent = this.conversationBuffer.some(ex => ex.isCodingRelated);
    const targetRepo = hasCodingContent ? this.codingRepo : this.projectPath;
    
    // Create filename
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    const suffix = targetRepo === this.codingRepo ? 'coding' : 'project';
    const filename = `${date}_${time}_captured-${suffix}-session.md`;
    
    // Ensure directory exists
    const historyDir = path.join(targetRepo, '.specstory', 'history');
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }
    
    const logPath = path.join(historyDir, filename);
    
    // Format conversation
    let content = `# Captured Claude Code Session

**Session ID:** ${this.sessionId}  
**Captured:** ${now.toISOString()}  
**Project:** ${this.projectPath}  
**Repository:** ${targetRepo}  
**Total Exchanges:** ${this.conversationBuffer.length}  
**Coding-related:** ${this.conversationBuffer.filter(ex => ex.isCodingRelated).length}

---

`;

    this.conversationBuffer.forEach((exchange, index) => {
      content += `## Exchange ${index + 1}

**User:**
*${exchange.timestamp}*

${exchange.user}

**Assistant:**
*${exchange.timestamp}*

${exchange.assistant}

${exchange.isCodingRelated ? '**Classification:** Coding-related' : '**Classification:** Project-specific'}

---

`;
    });

    content += `**Session Summary:**
- Total exchanges: ${this.conversationBuffer.length}
- Coding-related exchanges: ${this.conversationBuffer.filter(ex => ex.isCodingRelated).length}
- Session completed: ${now.toISOString()}
- Content routed to: ${targetRepo === this.codingRepo ? 'Coding repository' : 'Current project'}
`;

    fs.writeFileSync(logPath, content);
    
    // Clean up temp file
    if (fs.existsSync(this.tempFile)) {
      fs.unlinkSync(this.tempFile);
    }
    
    console.error(`✅ Conversation saved to: ${logPath}`);
    return logPath;
  }

  saveAndExit() {
    this.saveConversation();
    process.exit(0);
  }

  startCapture() {
    console.error(`🎯 Starting conversation capture for session: ${this.sessionId}`);
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    let userBuffer = '';
    let assistantBuffer = '';
    let isCollectingUser = true;

    rl.on('line', (line) => {
      // Pass through the line immediately
      console.log(line);
      
      const trimmed = line.trim();
      
      // Detect conversation boundaries
      if (trimmed.startsWith('Human:') || trimmed.startsWith('User:')) {
        // Save previous exchange if complete
        if (userBuffer.trim() && assistantBuffer.trim()) {
          this.addExchange(userBuffer.trim(), assistantBuffer.trim());
        }
        
        userBuffer = line;
        assistantBuffer = '';
        isCollectingUser = true;
        
      } else if (trimmed.startsWith('Assistant:') || trimmed.startsWith('Claude:')) {
        assistantBuffer = line;
        isCollectingUser = false;
        
      } else if (trimmed === '' && userBuffer.trim() && assistantBuffer.trim()) {
        // Empty line might indicate end of exchange
        this.addExchange(userBuffer.trim(), assistantBuffer.trim());
        userBuffer = '';
        assistantBuffer = '';
        isCollectingUser = true;
        
      } else {
        // Continue collecting current speaker's content
        if (isCollectingUser) {
          userBuffer += (userBuffer ? '\n' : '') + line;
        } else {
          assistantBuffer += (assistantBuffer ? '\n' : '') + line;
        }
      }
    });

    rl.on('close', () => {
      // Save final exchange if exists
      if (userBuffer.trim() && assistantBuffer.trim()) {
        this.addExchange(userBuffer.trim(), assistantBuffer.trim());
      }
      this.saveConversation();
    });
  }
}

// Main execution
if (require.main === module) {
  const projectPath = process.argv[2] || process.cwd();
  const codingRepo = process.argv[3] || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';
  const sessionId = process.argv[4] || `session-${Date.now()}`;

  const capture = new ConversationCapture(projectPath, codingRepo, sessionId);
  capture.startCapture();
}

module.exports = ConversationCapture;