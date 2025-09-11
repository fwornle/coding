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
// Removed: using adaptive classifier via SimplifiedSessionLogger
import SimplifiedSessionLogger from './simplified-session-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class SimplePostSessionLogger {
  constructor(projectPath, codingRepo, timeWindow = null) {
    this.projectPath = projectPath;
    this.codingRepo = codingRepo;
    // Get the customer project name for proper naming
    this.customerProjectName = path.basename(projectPath);
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
    
    // Use provided time window or generate one based on current time
    if (timeWindow && this.validateTimeWindow(timeWindow)) {
      this.timeWindow = timeWindow;
    } else {
      // Fallback: generate time window based on current time (HHMM-HHMM format)
      const currentHour = now.getHours();
      const nextHour = (currentHour + 1) % 24;
      this.timeWindow = `${String(currentHour).padStart(2, '0')}${String(now.getMinutes() < 30 ? '00' : '30').padStart(2, '0')}-${String(nextHour).padStart(2, '0')}${String(now.getMinutes() < 30 ? '30' : '00').padStart(2, '0')}`;
      if (timeWindow) {
        console.log(`⚠️  Invalid time window '${timeWindow}', using generated: ${this.timeWindow}`);
      }
    }
  }
  
  validateTimeWindow(timeWindow) {
    // Validate HHMM-HHMM format (e.g., "2100-2230")
    const timeWindowRegex = /^(\d{4})-(\d{4})$/;
    return timeWindowRegex.test(timeWindow);
  }

  async log() {
    // First check if live session logging already created files for this time window
    if (await this.checkIfLiveLoggingSucceeded()) {
      console.log('✅ Live session logging already handled this session - skipping post-session fallback');
      return;
    }
    
    console.log('🔄 Post-session logging started (fallback mode)...');
    
    // Add timeout handling to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Post-session logging timed out')), 12000);
    });
    
    try {
      // Race between logging and timeout
      await Promise.race([this.performLogging(), timeoutPromise]);
    } catch (error) {
      console.error('❌ Post-session logging failed:', error.message);
      // Create a minimal log entry even if full logging fails
      this.createMinimalLog();
    }
  }

  async checkIfLiveLoggingSucceeded() {
    // Check if LSL files exist for current time window AND have recent content
    const now = new Date();
    const date = now.getFullYear() + '-' + 
                String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                String(now.getDate()).padStart(2, '0');
    
    // Check customer project LSL file
    const customerLogPattern = `${date}_${this.timeWindow}-session.md`;
    const customerLogFile = path.join(this.projectPath, '.specstory', 'history', customerLogPattern);
    
    // Check coding project LSL file (with -from-customer suffix)
    const codingLogPattern = `${date}_${this.timeWindow}-session-from-${this.customerProjectName}.md`;
    const codingLogFile = path.join(this.codingRepo, '.specstory', 'history', codingLogPattern);
    
    const sessionStartTime = this.getSessionStartTime();
    
    // Check customer project LSL
    const customerValid = await this.validateLSLFile(customerLogFile, sessionStartTime, 'customer');
    
    // Check coding project LSL  
    const codingValid = await this.validateLSLFile(codingLogFile, sessionStartTime, 'coding');
    
    if (customerValid || codingValid) {
      console.log(`✅ Live session logging succeeded: customer=${customerValid}, coding=${codingValid}`);
      return true;
    }
    
    console.log(`🔍 No valid LSL files found for time window ${this.timeWindow} - proceeding with fallback`);
    return false;
  }

  async validateLSLFile(filePath, sessionStartTime, type) {
    if (!fs.existsSync(filePath)) {
      console.log(`📁 ${type} LSL file does not exist: ${path.basename(filePath)}`);
      return false;
    }

    try {
      const stats = fs.statSync(filePath);
      const fileModTime = stats.mtime;
      
      // Check if file was modified during this session
      if (fileModTime < sessionStartTime) {
        console.log(`⏰ ${type} LSL file is stale (modified ${fileModTime.toLocaleString()}, session started ${sessionStartTime.toLocaleString()})`);
        return false;
      }

      // Check if file has meaningful content (not just header)
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Must have more than just the header lines
      if (lines.length < 5) {
        console.log(`📝 ${type} LSL file exists but has minimal content (${lines.length} lines)`);
        return false;
      }

      // Look for actual conversation content (User: or Assistant: markers)
      const hasConversation = content.includes('User:') || content.includes('Assistant:') || content.includes('**User:**') || content.includes('**Assistant:**');
      
      if (!hasConversation) {
        console.log(`💬 ${type} LSL file exists but contains no conversation content`);
        return false;
      }

      console.log(`✅ ${type} LSL file is valid: ${path.basename(filePath)} (${lines.length} lines, modified ${fileModTime.toLocaleString()})`);
      return true;

    } catch (error) {
      console.log(`❌ Error validating ${type} LSL file: ${error.message}`);
      return false;
    }
  }
  
  async performLogging() {
    // Check if we should use multi-topic splitting
    const useMultiTopic = process.env.MULTI_TOPIC_LOGGING === 'true' || 
                         process.argv.includes('--multi-topic');
    
    if (useMultiTopic) {
      console.log('🔀 Using simplified session logging...');
      const simplifiedLogger = new SimplifiedSessionLogger(this.projectPath, this.codingRepo);
      return await simplifiedLogger.log();
    }
    
    // Only extract conversation for current session duration - check session start
    let extractedConversation = null;
    try {
      console.log('🔍 Searching for conversation data from current coding session...');
      const sessionStartTime = this.getSessionStartTime();
      const sessionDurationMinutes = this.calculateSessionDuration(sessionStartTime);
      
      console.log(`📅 Session started at: ${sessionStartTime.toLocaleString()}`);
      console.log(`⏱️  Session duration: ${sessionDurationMinutes} minutes`);
      
      const extractor = new ClaudeConversationExtractor(this.projectPath);
      extractedConversation = await Promise.race([
        extractor.extractRecentConversation(sessionDurationMinutes + 5), // Add 5 min buffer
        new Promise((_, reject) => setTimeout(() => reject(new Error('Extraction timeout')), 2000))
      ]);
    } catch (error) {
      console.log('⚠️  Conversation extraction timed out, using fallback content');
    }
    
    // Determine target repository based on content
    console.log('📂 Determining target repository for logs...');
    const targetRepo = await this.determineTargetRepository(extractedConversation);
    const logDir = path.join(targetRepo, '.specstory', 'history');
    
    // Ensure directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Use appropriate filename based on target repo and requirements
    const now = new Date();
    const date = now.getFullYear() + '-' + 
                String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                String(now.getDate()).padStart(2, '0');
    
    let logFileName;
    if (targetRepo === this.codingRepo && targetRepo !== this.projectPath) {
      // Content classified as coding-related, routing to coding repo with -from-customer suffix
      logFileName = `${date}_${this.timeWindow}-session-from-${this.customerProjectName}.md`;
    } else {
      // Content staying in customer project
      logFileName = `${date}_${this.timeWindow}-session.md`;
    }
    
    const logFile = path.join(logDir, logFileName);
    
    // Create session log with extracted conversation or fallback content
    console.log('✍️  Writing session log...');
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
  }
  
  createMinimalLog() {
    try {
      const logDir = path.join(this.projectPath, '.specstory', 'history');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      const logFile = path.join(logDir, `${this.timestamp}_minimal-session.md`);
      const content = `# Minimal Session Log\n\n**Session ID:** ${this.sessionId}\n**Timestamp:** ${new Date().toISOString()}\n\nSession ended - minimal logging due to timeout or error.\n`;
      
      fs.writeFileSync(logFile, content);
      console.log(`✅ Minimal session log created: ${logFile}`);
    } catch (error) {
      console.error('❌ Failed to create minimal log:', error.message);
    }
  }

  async determineTargetRepository(conversationContent) {
    // If no conversation content, fall back to current project
    if (!conversationContent) {
      console.log('⚠️  No conversation content for analysis, using current project');
      return this.projectPath;
    }

    // Use simple pattern matching instead of LLM classification to avoid timeouts
    console.log('🔍 Using pattern matching to determine appropriate project...');
    try {
      // Simple heuristic: if content mentions coding infrastructure keywords, route to coding repo
      const lowerContent = conversationContent.toLowerCase();
      const codingKeywords = [
        'ukb command', 'vkb command', 'mcp__memory__', 'semantic-analysis',
        'coding repo', '/agentic/coding', 'coding infrastructure', 'shared-memory.json'
      ];
      
      const keywordCount = codingKeywords.reduce((count, keyword) => {
        return count + (lowerContent.split(keyword).length - 1);
      }, 0);
      
      if (keywordCount >= 2) {
        console.log('📁 Content contains coding infrastructure patterns - routing to coding repo');
        return this.codingRepo;
      } else {
        console.log('📁 Content appears project-specific - using current project');
        return this.projectPath;
      }
    } catch (error) {
      console.error('❌ Pattern analysis failed:', error.message);
      console.log('⚠️  Falling back to current project');
      return this.projectPath;
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

  getSessionStartTime() {
    // Try to get session start time from session tracking file
    const sessionFile = path.join(this.codingRepo, '.mcp-sync', 'current-session.json');
    
    if (fs.existsSync(sessionFile)) {
      try {
        const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        if (sessionData.startTime) {
          return new Date(sessionData.startTime);
        }
      } catch (error) {
        console.log('⚠️  Could not read session start time from tracking file');
      }
    }
    
    // Fallback: parse session start time from time window (HHMM-HHMM format)
    if (this.timeWindow && this.validateTimeWindow(this.timeWindow)) {
      const startTime = this.parseTimeWindow(this.timeWindow).start;
      if (startTime) {
        return startTime;
      }
    }
    
    // Last resort: assume session started one session duration ago
    const sessionDurationMs = this.getSessionDurationMs();
    console.log(`⚠️  No session tracking found, assuming ${Math.round(sessionDurationMs/60000)}-minute session`);
    return new Date(Date.now() - sessionDurationMs);
  }

  parseTimeWindow(timeWindow) {
    const match = timeWindow.match(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/);
    if (!match) return { start: null, end: null, duration: 0 };
    
    const [, startHour, startMinute, endHour, endMinute] = match;
    const today = new Date();
    today.setHours(parseInt(startHour), parseInt(startMinute), 0, 0);
    
    const startTime = new Date(today);
    const endTime = new Date(today);
    endTime.setHours(parseInt(endHour), parseInt(endMinute), 0, 0);
    
    // Handle sessions that cross midnight
    if (endTime <= startTime) {
      endTime.setDate(endTime.getDate() + 1);
    }
    
    const duration = endTime.getTime() - startTime.getTime();
    
    return {
      start: startTime,
      end: endTime,
      duration: duration
    };
  }

  calculateSessionDuration(startTime) {
    const now = new Date();
    const durationMs = now.getTime() - startTime.getTime();
    return Math.ceil(durationMs / (60 * 1000)); // Convert to minutes, round up
  }

  getSessionDurationMs() {
    // Always use config file - don't override based on time window
    try {
      const configPath = path.join(this.codingRepo, 'config', 'live-logging-config.json');
      if (!fs.existsSync(configPath)) {
        return 3600000; // Default: 1 hour (60 minutes)
      }
      
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.live_logging?.session_duration || 3600000; // Default: 1 hour (60 minutes)
    } catch (error) {
      return 3600000; // Default: 1 hour (60 minutes)
    }
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
  const timeWindow = process.argv[4]; // Optional time window parameter (e.g., "2100-2230")

  const logger = new SimplePostSessionLogger(projectPath, codingRepo, timeWindow);
  await logger.log();
}

// Execute if run directly
main().catch(console.error);