#!/usr/bin/env node

/**
 * Simple Post-Session Logger for Claude Code
 * Creates a session tracking mechanism that can capture conversations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import ClaudeConversationExtractor from './claude-conversation-extractor.js';
import LightweightEmbeddingClassifier from './lightweight-embedding-classifier.js';
import SimplifiedSessionLogger from './simplified-session-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class SimplePostSessionLogger {
  constructor(projectPath, codingRepo) {
    this.projectPath = projectPath;
    this.codingRepo = codingRepo;
    this.classifier = new LightweightEmbeddingClassifier();
    // Use local time for timestamp
    const now = new Date();
    const date = now.getFullYear() + '-' + 
                String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                String(now.getDate()).padStart(2, '0');
    const time = String(now.getHours()).padStart(2, '0') + '-' + 
                String(now.getMinutes()).padStart(2, '0') + '-' + 
                String(now.getSeconds()).padStart(2, '0');
    this.timestamp = `${date}_${time}`;
    this.sessionId = this.timestamp;
  }

  async log() {
    console.log('🔄 Post-session logging started...');
    
    // Check if we should use multi-topic splitting
    const useMultiTopic = process.env.MULTI_TOPIC_LOGGING === 'true' || 
                         process.argv.includes('--multi-topic');
    
    if (useMultiTopic) {
      console.log('🔀 Using simplified session logging...');
      const simplifiedLogger = new SimplifiedSessionLogger(this.projectPath, this.codingRepo);
      return await simplifiedLogger.log();
    }
    
    try {
      // Try to extract actual conversation first
      const extractor = new ClaudeConversationExtractor(this.projectPath);
      const extractedConversation = await extractor.extractRecentConversation(30);
      
      // Determine target repository based on content
      const targetRepo = await this.determineTargetRepository(extractedConversation);
      const logDir = path.join(targetRepo, '.specstory', 'history');
      
      // Ensure directory exists
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // Use appropriate filename based on target repo
      const projectName = path.basename(targetRepo);
      const logFile = path.join(logDir, `${this.timestamp}_post-logged-${projectName}-session.md`);
      
      // Create session log with extracted conversation or fallback content
      const logContent = extractedConversation || this.createLogContent();
      
      fs.writeFileSync(logFile, logContent);
      console.log(`✅ Session logged to: ${logFile}`);
      
      if (extractedConversation) {
        console.log('📝 Full conversation successfully extracted and logged');
      } else {
        console.log('⚠️  Fell back to basic session summary (conversation extraction failed)');
      }
      
      // Update session tracking
      this.updateSessionTracking(logFile, targetRepo);
      
    } catch (error) {
      console.error('❌ Post-session logging failed:', error.message);
    }
  }

  async determineTargetRepository(conversationContent) {
    // If no conversation content, fall back to coding repo
    if (!conversationContent) {
      console.log('⚠️  No conversation content for semantic analysis, defaulting to coding repo');
      return this.codingRepo;
    }

    // ALWAYS perform semantic analysis first - don't assume based on directory
    console.log('🔍 Performing semantic analysis to determine appropriate project...');
    try {
      const classification = await this.classifier.classifyContent(conversationContent);
      
      if (classification === 'coding') {
        console.log('📁 Content classified as coding infrastructure - logging to coding repo');
        return this.codingRepo;
      } else {
        console.log('📁 Content classified as project-specific - using semantic analysis result');
        // If we're in a project directory, use it; otherwise check if there's a clear project reference
        if (this.projectPath !== this.codingRepo) {
          return this.projectPath;
        }
        
        // Try to extract project name from conversation
        const projectPath = this.extractProjectPath(conversationContent);
        if (projectPath && fs.existsSync(projectPath)) {
          console.log(`📁 Detected project directory from content: ${projectPath}`);
          return projectPath;
        }
        
        // Default to current directory if it has .specstory
        if (fs.existsSync(path.join(this.projectPath, '.specstory'))) {
          return this.projectPath;
        }
        
        // Last resort: coding repo
        return this.codingRepo;
      }
    } catch (error) {
      console.error('❌ Semantic analysis failed:', error.message);
      console.log('⚠️  Falling back to coding repo');
      return this.codingRepo;
    }
  }

  extractProjectPath(content) {
    // Look for common project path patterns in the conversation
    const pathPattern = /\/Users\/\w+\/Agentic\/(\w+)/g;
    const matches = content.match(pathPattern);
    
    if (matches && matches.length > 0) {
      // Count occurrences of each project
      const projectCounts = {};
      matches.forEach(match => {
        const projectName = match.split('/').pop();
        if (projectName !== 'coding') {
          projectCounts[projectName] = (projectCounts[projectName] || 0) + 1;
        }
      });
      
      // Find the most mentioned project
      let maxCount = 0;
      let mostMentionedProject = null;
      for (const [project, count] of Object.entries(projectCounts)) {
        if (count > maxCount) {
          maxCount = count;
          mostMentionedProject = project;
        }
      }
      
      if (mostMentionedProject) {
        const projectPath = path.join('/Users/q284340/Agentic', mostMentionedProject);
        if (fs.existsSync(projectPath)) {
          return projectPath;
        }
      }
    }
    
    return null;
  }

  createLogContent() {
    const now = new Date();
    return `# Post-logged Claude Code Session

**Session ID:** ${this.sessionId}  
**Started:** ${now.toISOString()}  
**Local Time:** ${now.toLocaleString()}  
**Project:** ${this.projectPath}  
**Target Repository:** ${this.codingRepo}

---

## Conversation Content

**⚠️ LIMITATION:** This post-session logger cannot access Claude Code's internal conversation history.

**What we know about this session:**
- Session ended and triggered post-session logging
- User was testing/working with post-session logging functionality
- Conversation likely included discussion of logging mechanisms

**Missing:** Full conversation exchanges with User/Assistant format and timestamps

---

## Technical Notes

**Issues identified:**
1. **Timezone Problem:** Fixed - now using local time (CEST) instead of UTC
2. **Missing Conversations:** Claude Code doesn't expose conversation history in accessible format
3. **Generic Content:** Falling back to session summary instead of actual exchanges

**Potential Solutions:**
1. **Real-time capture:** Log conversations during session rather than post-session
2. **Alternative approach:** Use different mechanism to access conversation data
3. **Manual logging:** Implement conversation capture within Claude Code itself

---

## Recommendations for Full Conversation Logging

To capture full **User:**/***Assistant:** exchanges with timestamps:

1. **Modify Claude Code itself** to expose conversation history
2. **Implement real-time logging** during conversation
3. **Use alternative capture mechanism** (screen scraping, terminal logging, etc.)

**Current Status:** Basic session logging working, but conversation content not accessible

**Timestamp:** ${now.toISOString()} (${now.toLocaleString()})
`;
  }

  updateSessionTracking(logFile, targetRepo) {
    const sessionFile = path.join(this.codingRepo, '.mcp-sync', 'current-session.json');
    const sessionData = {
      sessionId: this.sessionId,
      startTime: new Date().toISOString(),
      projectPath: this.projectPath,
      codingRepo: this.codingRepo,
      targetRepo: targetRepo || this.codingRepo,
      needsLogging: false,
      loggedAt: new Date().toISOString(),
      logFile: logFile
    };
    
    fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
  }
}

// Main execution
async function main() {
  const projectPath = process.argv[2] || process.cwd();
  const codingRepo = process.argv[3] || projectPath;

  const logger = new SimplePostSessionLogger(projectPath, codingRepo);
  await logger.log();
}

// Execute if run directly
main().catch(console.error);