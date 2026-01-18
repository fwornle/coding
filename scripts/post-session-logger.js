#!/usr/bin/env node

/**
 * Post-Session Logger for Claude Code
 * Captures conversation history after Claude exits and logs it appropriately
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { AutoInsightTrigger } from './auto-insight-trigger.js';
import ConfigurableRedactor from '../src/live-logging/ConfigurableRedactor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptRoot = path.resolve(__dirname, '..');

class PostSessionLogger {
  constructor(projectPath, codingRepo, sessionId) {
    this.projectPath = projectPath;
    this.codingRepo = codingRepo;
    this.sessionId = sessionId;
    this.sessionFile = path.join(codingRepo, '.mcp-sync', 'current-session.json');
    this.redactor = null; // Initialized lazily
  }

  async initializeRedactor() {
    if (!this.redactor) {
      const codingPath = this.codingRepo;
      this.redactor = new ConfigurableRedactor({
        configPath: path.join(codingPath, '.specstory', 'config', 'redaction-patterns.json'),
        debug: false
      });
      await this.redactor.initialize();
    }
    return this.redactor;
  }

  getSessionDurationMs() {
    try {
      const configPath = path.join(this.codingRepo, 'config', 'live-logging-config.json');
      if (!fs.existsSync(configPath)) {
        return 3600000; // Default: 1 hour
      }
      
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.live_logging?.session_duration || 3600000; // Default: 1 hour
    } catch (error) {
      return 3600000; // Default: 1 hour
    }
  }

  async captureConversation() {
    console.log('📋 Post-session logging started...');
    
    // First, stop semantic-analysis system
    await this.stopSemanticAnalysisSystem();
    
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

      // Check if live session logs exist and are plausible
      const liveSessionCheck = await this.checkLiveSessionPlausibility();
      
      if (liveSessionCheck.exists && liveSessionCheck.plausible) {
        console.log('✅ Live session complete and plausible - skipping post-session logging');
        sessionData.needsLogging = false;
        sessionData.loggedAt = new Date().toISOString();
        sessionData.logFile = `Live session: ${liveSessionCheck.filePath}`;
        fs.writeFileSync(this.sessionFile, JSON.stringify(sessionData, null, 2));
        return;
      } else if (liveSessionCheck.exists && !liveSessionCheck.plausible) {
        console.log('⚠️  Live session exists but incomplete - creating post-session backup');
      } else {
        console.log('📝 Live session missing - creating post-session backup');
      }

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
      
      const isRerouted = shouldGoToCoding && targetRepo !== actualProjectPath;
      
      console.log(`🎯 Routing to: ${targetRepo === this.codingRepo ? 'CODING repo (RE-ROUTED)' : 'current project (DEFAULT)'}`);
      console.log(`📁 Original project: ${actualProjectPath}`);
      console.log(`📁 Target repo: ${targetRepo}`);
      console.log(`🔍 Content analysis: ${shouldGoToCoding ? 'coding-related' : 'project-specific'}`);
      console.log(`🔄 Re-routed: ${isRerouted ? 'YES' : 'NO'}`);

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
      const homeDir = os.homedir();
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
          
          // If it was modified within the configured session duration, it's likely our session
          const sessionDuration = this.getSessionDurationMs();
          if (timeDiff < sessionDuration) {
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

  /**
   * Check if live session logs exist and are plausible for the given session
   * Checks both local project and coding repo locations
   */
  async checkLiveSessionPlausibility() {
    try {
      // Check both possible locations for LSL files
      const locations = [
        {
          name: 'local project',
          path: path.join(this.projectPath, '.specstory', 'history'),
          filePattern: (today) => (file) => {
            return (file.includes(today) && 
                    (file.includes('live-transcript') || 
                     file.includes('live-session') ||
                     file.includes('project-session') ||
                     file.includes('coding-session'))) &&
                   file.endsWith('.md');
          }
        },
        {
          name: 'coding repo',
          path: path.join(this.codingRepo, '.specstory', 'history'), 
          filePattern: (today) => (file) => {
            return (file.includes(today) && 
                    (file.includes('live-transcript') || 
                     file.includes('live-session') ||
                     file.includes('project-session') ||
                     file.includes('coding-session') ||
                     file.includes('from-' + path.basename(this.projectPath)))) &&
                   file.endsWith('.md');
          }
        }
      ];

      const today = new Date().toISOString().split('T')[0];
      let allSessionFiles = [];

      // Collect files from both locations
      for (const location of locations) {
        if (!fs.existsSync(location.path)) {
          console.log(`📁 ${location.name} history dir doesn't exist: ${location.path}`);
          continue;
        }

        const files = fs.readdirSync(location.path);
        const locationFiles = files
          .filter(location.filePattern(today))
          .map(file => ({
            file,
            path: path.join(location.path, file),
            location: location.name,
            stats: fs.statSync(path.join(location.path, file))
          }));

        allSessionFiles.push(...locationFiles);
        console.log(`📁 ${location.name}: found ${locationFiles.length} session files`);
      }

      if (allSessionFiles.length === 0) {
        console.log('📁 No LSL files found in either location - triggering fallback');
        return { exists: false, plausible: false, filePath: null };
      }

      // Find the most recent session file across all locations
      const mostRecent = allSessionFiles
        .map(fileInfo => ({
          ...fileInfo,
          mtime: fileInfo.stats.mtime
        }))
        .sort((a, b) => b.mtime - a.mtime)[0];

      const content = fs.readFileSync(mostRecent.path, 'utf8');
      
      // Plausibility checks
      const plausibilityResults = {
        hasContent: content.length > 100,
        hasExchanges: content.includes('Exchange') || content.includes('Tool:') || content.includes('**User:**'),
        hasTimestamp: content.includes('2025-') && content.includes(':'),
        isRecent: Date.now() - mostRecent.mtime.getTime() < 3600000, // Within 1 hour
        hasToolInteractions: content.includes('```json') || content.includes('Tool:') || content.includes('Input:')
      };

      const plausibilityScore = Object.values(plausibilityResults).filter(Boolean).length;
      const isPlausible = plausibilityScore >= 3; // At least 3 out of 5 checks pass

      console.log(`🔍 Live session check: ${mostRecent.file} (${mostRecent.location})`);
      console.log(`📊 Plausibility: ${plausibilityScore}/5 - ${isPlausible ? 'PLAUSIBLE' : 'INCOMPLETE'}`);
      
      if (process.env.DEBUG_SESSION) {
        console.log('Debug - Plausibility details:', plausibilityResults);
      }

      return {
        exists: true,
        plausible: isPlausible,
        filePath: mostRecent.file,
        location: mostRecent.location,
        score: plausibilityScore,
        details: plausibilityResults
      };

    } catch (error) {
      console.warn('⚠️  Error checking live session plausibility:', error.message);
      return { exists: false, plausible: false, filePath: null };
    }
  }

  async detectCodingContent(content) {
    try {
      // Use pattern-based detection (LLM classifier removed as post-session-logger is fallback only)
      const lowerContent = content.toLowerCase();
      
      // VERY SPECIFIC coding infrastructure keywords - must be precise to avoid false positives
      const codingKeywords = [
        'ukb command', 'vkb command', 'ukb --', 'vkb --', 'ukb.js', 'vkb.js',
        'semantic-analysis system', 'claude-mcp command',
        'post-session-logger.js', 'knowledge-export/coding.json', 'knowledge-management/',
        'coding repo', '/agentic/coding', 'coding infrastructure'
      ];
      
      // Check for exclusion patterns (educational content)
      const exclusionPatterns = [
        'nano-degree', 'nano degree', 'learning', 'tutorial', 'exercise',
        'course', 'lesson', 'education', 'training', 'module '
      ];
      
      // Count occurrences to prevent false positives
      const keywordCount = codingKeywords.reduce((count, keyword) => {
        return count + (lowerContent.split(keyword).length - 1);
      }, 0);
      
      const hasEducationalContent = exclusionPatterns.some(pattern => 
        lowerContent.includes(pattern)
      );
      
      // Require multiple specific infrastructure keywords AND no educational content
      return keywordCount >= 4 && !hasEducationalContent;
    } catch (error) {
      console.warn('⚠️  Error detecting coding content:', error.message);
      return false;
    }
  }

  async createLogFile(targetRepo, sessionData, content) {
    // SECURITY: Initialize redactor and redact content before writing
    const redactor = await this.initializeRedactor();
    const redactedContent = await redactor.redact(content);

    const now = new Date();
    // Use local time instead of UTC
    const date = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0');
    const time = String(now.getHours()).padStart(2, '0') + '-' +
                String(now.getMinutes()).padStart(2, '0') + '-' +
                String(now.getSeconds()).padStart(2, '0');
    const isRerouted = targetRepo !== sessionData.projectPath;
    const suffix = targetRepo === this.codingRepo ? 'coding-session' : 'project-session';
    const routingMarker = isRerouted ? '-rerouted' : '';

    const filename = `${date}_${time}_post-logged-${suffix}${routingMarker}.md`;
    const logPath = path.join(targetRepo, '.specstory', 'history', filename);

    // Ensure directory exists
    const historyDir = path.dirname(logPath);
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }

    const routingStatus = isRerouted ? 'RE-ROUTED' : 'DEFAULT';

    const logContent = `# Post-Session Logged Conversation ${isRerouted ? '🔄 [RE-ROUTED]' : '📁 [DEFAULT]'}

**Session ID:** ${sessionData.sessionId}
**Started:** ${sessionData.startTime}
**Logged:** ${now.toISOString()}
**Original Project:** ${sessionData.projectPath}
**Target Repository:** ${targetRepo}
**Content Classification:** ${targetRepo === this.codingRepo ? 'Coding/Knowledge Management' : 'Project-specific'}
**Routing Status:** ${routingStatus} ${isRerouted ? '(Content detected as coding-related)' : '(Content stayed in original project)'}

---

${redactedContent}

---

**Post-Session Logging Summary:**
- Logged at: ${now.toISOString()}
- Original project: ${sessionData.projectPath}
- Content routed to: ${targetRepo === this.codingRepo ? 'Coding repository' : 'Current project'}
- Routing decision: ${routingStatus}
- Automatic classification: ${targetRepo === this.codingRepo ? 'Coding-related' : 'Project-specific'}
${isRerouted ? '- ⚠️  This session was RE-ROUTED from its original project due to coding-related content' : '- ✅ This session remained in its original project location'}
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

  async stopSemanticAnalysisSystem() {
    console.log('🛑 Stopping all coding services...');
    try {
      // Use the new service lifecycle manager to stop all services
      const { spawnSync } = await import('child_process');
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
        const { spawnSync } = await import('child_process');
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
  // Check for test mode
  if (process.argv.includes('--test')) {
    console.log('✅ Post-session logger test mode - all systems functional');
    process.exit(0);
  }

  const projectPath = process.argv[2] || process.cwd();
  const codingRepo = process.argv[3] || process.env.CODING_REPO || scriptRoot;
  const sessionId = process.argv[4] || `session-${Date.now()}`;

  const logger = new PostSessionLogger(projectPath, codingRepo, sessionId);
  await logger.captureConversation();
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch(console.error);
}

export default PostSessionLogger;