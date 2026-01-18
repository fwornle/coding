#!/bin/bash

# Start Auto-Logger for Claude Code Conversations
# This script monitors Claude Code activity and logs conversations to .specstory/history
# Enhanced to detect coding-related content and route to appropriate project

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Default coding repo is one level up from scripts directory
DEFAULT_CODING_REPO="${CODING_TOOLS_PATH:-${CODING_REPO:-$(dirname "$SCRIPT_DIR")}}"
PROJECT_PATH="${1:-$(pwd)}"
CODING_REPO="${2:-$DEFAULT_CODING_REPO}"
shift 2  # Remove PROJECT_PATH and CODING_REPO from arguments
CLAUDE_ARGS="$@"

echo "Starting Claude Code Auto-Logger..."
echo "Current project path: $PROJECT_PATH"
echo "Coding repository: $CODING_REPO"
echo "Logs will be intelligently routed based on content"

# Ensure both directories exist
mkdir -p "$PROJECT_PATH/.specstory/history"
mkdir -p "$CODING_REPO/.specstory/history"

# Create enhanced monitoring script
cat > /tmp/claude-monitor.js << 'EOF'
const fs = require('fs');
const path = require('path');
const readline = require('readline');

class SmartClaudeLogger {
  constructor(projectPath, codingRepo) {
    this.projectPath = projectPath;
    this.codingRepo = codingRepo;
    this.currentSession = null;
    this.sessionFile = null;
    this.messageBuffer = [];
    this.messageCounter = 0;
    
    // Ensure directories exist
    this.ensureDirectory(path.join(projectPath, '.specstory', 'history'));
    this.ensureDirectory(path.join(codingRepo, '.specstory', 'history'));
  }

  ensureDirectory(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  detectCodingContent(userMessage, assistantMessage = '') {
    const content = `${userMessage} ${assistantMessage}`.toLowerCase();
    
    // Keywords that indicate coding/knowledge management work
    const codingKeywords = [
      'ukb', 'vkb', 'knowledge-export', 'knowledge-base', 'knowledge base',
      'mcp', 'claude-mcp', 'specstory', 'claude-logger', 'coding project',
      'coding repo', 'coding repository', 'agentic/coding', 'install.sh',
      'knowledge management', 'transferable pattern', 'shared knowledge',
      'cross-project', '.activate', 'claude tools', 'memory-visualizer',
      'start-auto-logger', 'automatic logging', 'conversation logging',
      'CLAUDE.md', 'CODING_REPO', 'todowrite', 'todoread', 'knowledge extraction'
    ];
    
    // File paths that indicate coding work
    const codingPaths = [
      codingRepo.toLowerCase(),
      '~/agentic/coding',
      'coding/',
      '.specstory',
      'knowledge-management',
      '.data/knowledge-export'
    ];
    
    // Check for coding keywords
    const hasCodingKeywords = codingKeywords.some(keyword => content.includes(keyword));
    
    // Check for coding paths
    const hasCodingPaths = codingPaths.some(pathPattern => content.includes(pathPattern));
    
    // Check if we're modifying coding tools from another project
    const isModifyingCodingTools = content.includes('ukb') || content.includes('vkb') || 
                                   content.includes('knowledge') || content.includes('mcp') ||
                                   content.includes('claude-mcp') || content.includes('logging');
    
    return hasCodingKeywords || hasCodingPaths || isModifyingCodingTools;
  }

  generateSessionFilename(targetRepo) {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    const suffix = targetRepo === this.codingRepo ? 'claude-code' : 'session';
    return `${date}_${time}_auto-logged-${suffix}.md`;
  }

  startSession(firstMessage = '', targetRepo = null) {
    // Determine target repository based on content
    if (!targetRepo) {
      targetRepo = this.detectCodingContent(firstMessage) ? this.codingRepo : this.projectPath;
    }
    
    const filename = this.generateSessionFilename(targetRepo);
    this.sessionFile = path.join(targetRepo, '.specstory', 'history', filename);
    this.currentSession = {
      startTime: new Date().toISOString(),
      messages: [],
      targetRepo: targetRepo
    };
    
    const header = `# Auto-logged Claude Code Session

**Session ID:** ${path.basename(filename, '.md')}  
**Started:** ${this.currentSession.startTime}  
**Project:** ${targetRepo}
${targetRepo !== this.projectPath ? `**Original Project:** ${this.projectPath}` : ''}

---

`;
    
    fs.writeFileSync(this.sessionFile, header);
    console.error(`[Logger] Started session in ${targetRepo === this.codingRepo ? 'CODING repo' : 'current project'}: ${filename}`);
    return targetRepo;
  }

  logExchange(userMessage, assistantMessage) {
    // Determine if this exchange should go to coding repo
    const shouldGoToCoding = this.detectCodingContent(userMessage, assistantMessage);
    
    if (!this.currentSession) {
      this.startSession(userMessage, shouldGoToCoding ? this.codingRepo : this.projectPath);
    } else if (shouldGoToCoding && this.currentSession.targetRepo !== this.codingRepo) {
      // Switch to coding repo if content becomes coding-related
      this.endSession();
      this.startSession(userMessage, this.codingRepo);
    }

    this.messageCounter++;
    const timestamp = new Date().toISOString();
    
    const exchange = {
      user: userMessage,
      assistant: assistantMessage,
      timestamp,
      isCodingRelated: shouldGoToCoding
    };

    this.currentSession.messages.push(exchange);
    
    // Format the exchange
    const formatted = `## Exchange ${this.messageCounter}

**User:**
${userMessage}

**Assistant:**
${assistantMessage}

**Tools used:** [Auto-detected from response]

---

`;
    
    fs.appendFileSync(this.sessionFile, formatted);
    console.error(`[Logger] Logged exchange ${this.messageCounter} to ${this.currentSession.targetRepo === this.codingRepo ? 'CODING' : 'LOCAL'} repo`);
  }

  endSession() {
    if (this.currentSession && this.sessionFile) {
      const endTime = new Date().toISOString();
      const codingExchanges = this.currentSession.messages.filter(m => m.isCodingRelated).length;
      const footer = `
**Session Summary:**
- Total Exchanges: ${this.currentSession.messages.length}
- Coding-related Exchanges: ${codingExchanges}
- Session Ended: ${endTime}
- Repository: ${this.currentSession.targetRepo}
`;
      fs.appendFileSync(this.sessionFile, footer);
      console.error(`[Logger] Session ended with ${this.currentSession.messages.length} exchanges`);
    }
    this.currentSession = null;
    this.sessionFile = null;
    this.messageCounter = 0;
  }
}

// Initialize logger
const projectPath = process.argv[2] || process.cwd();
const codingRepo = process.argv[3] || process.env.CODING_REPO || process.env.CODING_TOOLS_PATH || path.join(process.env.HOME, 'Agentic', 'coding');
const logger = new SmartClaudeLogger(projectPath, codingRepo);

// Create readline interface for stdin
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let userBuffer = '';
let assistantBuffer = '';
let isCollectingUser = true;
let lineCount = 0;

// Enhanced parsing for Claude Code conversations
rl.on('line', (line) => {
  lineCount++;
  
  // Pass through immediately (so Claude Code continues to work)
  console.log(line);
  
  // Detect conversation boundaries with better heuristics
  const trimmed = line.trim();
  
  // Detect start of user input
  if (trimmed.startsWith('Human:') || trimmed.startsWith('User:') || 
      (trimmed === '' && assistantBuffer.trim() && !isCollectingUser)) {
    
    // Log previous exchange if we have both parts
    if (userBuffer.trim() && assistantBuffer.trim()) {
      logger.logExchange(userBuffer.trim(), assistantBuffer.trim());
    }
    
    // Reset for new exchange
    if (trimmed.startsWith('Human:') || trimmed.startsWith('User:')) {
      userBuffer = trimmed;
    } else {
      userBuffer = '';
    }
    assistantBuffer = '';
    isCollectingUser = true;
    
  } else if (trimmed.startsWith('Assistant:') || trimmed.startsWith('Claude:') ||
             (trimmed === '' && userBuffer.trim() && isCollectingUser)) {
    
    // Switch to collecting assistant response
    if (trimmed.startsWith('Assistant:') || trimmed.startsWith('Claude:')) {
      assistantBuffer = trimmed;
    } else {
      assistantBuffer = '';
    }
    isCollectingUser = false;
    
  } else {
    // Continue collecting current speaker's content
    if (isCollectingUser) {
      userBuffer += (userBuffer ? '\n' : '') + line;
    } else {
      assistantBuffer += (assistantBuffer ? '\n' : '') + line;
    }
  }
  
  // Also check for tool usage patterns in the line
  if (line.includes('Tools used:') || line.includes('**Tools used:**')) {
    // Extract tools and add to current exchange metadata
    console.error(`[Logger] Detected tool usage: ${line}`);
  }
});

// Handle shutdown
process.on('SIGINT', () => {
  // Log final exchange if we have content
  if (userBuffer.trim() && assistantBuffer.trim()) {
    logger.logExchange(userBuffer.trim(), assistantBuffer.trim());
  }
  logger.endSession();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (userBuffer.trim() && assistantBuffer.trim()) {
    logger.logExchange(userBuffer.trim(), assistantBuffer.trim());
  }
  logger.endSession();
  process.exit(0);
});

console.error('[Logger] Smart Claude Code Auto-Logger started');
console.error(`[Logger] Monitoring project: ${projectPath}`);
console.error(`[Logger] Coding repository: ${codingRepo}`);
console.error('[Logger] Content will be intelligently routed based on context');
EOF

# Generate session ID for logging
SESSION_ID="$(date '+%Y-%m-%d_%H-%M-%S')"
echo "📝 Session ID: $SESSION_ID"

# Start Claude directly without pipe interference
echo "🎯 Starting conversation capture for session: $SESSION_ID"

# Run Claude directly without pipes to avoid stdin/stdout issues
claude --mcp-config "$CODING_REPO/claude-code-mcp-processed.json" $CLAUDE_ARGS

# POST-SESSION LOGGING (backup/cleanup)
echo "🔄 Finalizing post-session logging..."
if [ -f "$CODING_REPO/scripts/post-session-logger.js" ]; then
  node "$CODING_REPO/scripts/post-session-logger.js" "$PROJECT_PATH" "$CODING_REPO" "$SESSION_ID"
fi