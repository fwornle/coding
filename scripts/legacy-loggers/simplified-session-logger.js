#!/usr/bin/env node

/**
 * Simplified Session Logger - Creates max 2 files with same timestamp
 * 1. Local project file (always)
 * 2. Coding file (only if coding topics detected)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import ClaudeConversationExtractor from './claude-conversation-extractor.js';
import ReliableCodingClassifier from '../src/live-logging/ReliableCodingClassifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class SimplifiedSessionLogger {
  constructor(projectPath, codingRepo) {
    this.projectPath = projectPath;
    this.codingRepo = codingRepo;
    // Use reliable coding classifier for 2-3 second classification
    this.classifier = new ReliableCodingClassifier({
      projectPath: projectPath,
      codingRepo: codingRepo
    });
    
    // Generate proper time window timestamp (60-minute windows starting at :30)
    const now = new Date();
    const timeWindow = this.calculateTimeWindow(now.getTime());
    this.timestamp = `${timeWindow.dateString}_${timeWindow.windowString}`;
  }

  async log() {
    console.log('🔄 Simplified session logging started...');
    
    try {
      // Extract conversation
      const extractor = new ClaudeConversationExtractor(this.projectPath);
      const extractedConversation = await extractor.extractRecentConversation(30);
      
      if (!extractedConversation) {
        console.log('⚠️  No conversation found to log');
        return;
      }
      
      // Initialize classifier if not already done
      if (!this.classifier.pathAnalyzer) {
        await this.classifier.initialize();
      }
      
      // Classify content to determine file creation strategy
      // Reliable classification (2-3 seconds max)
      const classificationResult = await this.classifier.classify(extractedConversation, { projectPath: this.projectPath });
      console.log(`🔍 Classification result:`, JSON.stringify(classificationResult, null, 2));
      
      if (classificationResult.classification === 'CODING_INFRASTRUCTURE') {
        // Pure coding content - create only coding file
        if (this.projectPath !== this.codingRepo) {
          const codingFile = await this.createCodingFile(extractedConversation);
          console.log(`📝 Created coding file: ${codingFile}`);
        } else {
          // Already in coding repo, create local file
          const localFile = await this.createLocalProjectFile(extractedConversation, false);
          console.log(`📝 Created local project file: ${localFile}`);
        }
      } else {
        // Project-specific content - create only local project file
        const localFile = await this.createLocalProjectFile(extractedConversation, false);
        console.log(`📝 Created local project file: ${localFile}`);
      }
      
      console.log(`✅ Session logged with timestamp: ${this.timestamp}`);
      
    } catch (error) {
      console.error('❌ Simplified session logging failed:', error.message);
    }
  }

  async createLocalProjectFile(conversation, hasCodingContent) {
    const logDir = path.join(this.projectPath, '.specstory', 'history');
    this.ensureDirectoryExists(logDir);
    
    const filename = `${this.timestamp}-session.md`;
    const filepath = path.join(logDir, filename);
    
    const content = this.createSessionContent(conversation, 'local', hasCodingContent);
    fs.writeFileSync(filepath, content);
    
    return filepath;
  }

  async createCodingFile(conversation) {
    const logDir = path.join(this.codingRepo, '.specstory', 'history');
    this.ensureDirectoryExists(logDir);
    
    // Add source project suffix if redirected
    const sourceProject = path.basename(this.projectPath);
    const isRedirected = this.projectPath !== this.codingRepo;
    const suffix = isRedirected ? `-session-from-${sourceProject}` : '-session';
    const filename = `${this.timestamp}${suffix}.md`;
    const filepath = path.join(logDir, filename);
    
    const content = this.createSessionContent(conversation, 'coding', false);
    fs.writeFileSync(filepath, content);
    
    return filepath;
  }

  createSessionContent(conversation, type, hasCodingContent) {
    const now = new Date();
    const projectName = path.basename(type === 'coding' ? this.codingRepo : this.projectPath);
    
    let header = `# ${type === 'coding' ? 'Coding Infrastructure' : 'Project'} Session Log

**Session Timestamp:** ${this.timestamp}  
**Project:** ${projectName}  
**Session Type:** ${type === 'coding' ? 'Coding Infrastructure Development' : 'Project Development'}  
**Logged At:** ${now.toISOString()}  
**Local Time:** ${now.toLocaleString()}  `;

    if (type === 'local' && hasCodingContent) {
      header += `
**Note:** This session contained coding infrastructure topics. See parallel file: \`${this.timestamp}_coding-session.md\``;
    }

    if (type === 'coding') {
      const localProjectName = path.basename(this.projectPath);
      header += `
**Note:** This session originated from project: ${localProjectName}. See parallel file: \`${this.timestamp}_${localProjectName}-session.md\``;
    }

    return `${header}

---

## Session Conversation

${conversation}

---

## Session Metadata

**Timestamp:** ${this.timestamp}  
**Classification:** ${type === 'coding' ? 'Coding Infrastructure' : 'Project Development'}  
**Original Project Path:** ${this.projectPath}  
**Coding Repository:** ${this.codingRepo}  
**Created:** ${now.toISOString()}
`;
  }

  /**
   * Calculate 60-minute time window for timestamp (matches ExchangeRouter logic)
   * @param {number} timestamp - Unix timestamp
   * @returns {Object} Time window information
   */
  calculateTimeWindow(timestamp) {
    const date = new Date(timestamp);
    
    // Calculate time window (60-minute windows starting at :30)
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    const trancheStart = Math.floor((totalMinutes + 30) / 60) * 60 - 30;
    const trancheEnd = trancheStart + 60;
    
    // Handle day boundaries
    let windowStart = new Date(date);
    let windowEnd = new Date(date);
    
    if (trancheStart < 0) {
      // Window crosses midnight backwards
      windowStart.setDate(windowStart.getDate() - 1);
      windowStart.setHours(23, 30, 0, 0);
      windowEnd.setHours(0, 30, 0, 0);
    } else if (trancheEnd >= 24 * 60) {
      // Window crosses midnight forwards  
      windowStart.setHours(23, 30, 0, 0);
      windowEnd.setDate(windowEnd.getDate() + 1);
      windowEnd.setHours(0, 30, 0, 0);
    } else {
      // Normal window within same day
      windowStart.setHours(Math.floor(trancheStart / 60), trancheStart % 60, 0, 0);
      windowEnd.setHours(Math.floor(trancheEnd / 60), trancheEnd % 60, 0, 0);
    }
    
    // Format strings for file naming
    const dateString = this.formatDateString(windowStart);
    const windowString = this.formatWindowString(windowStart, windowEnd);
    
    return {
      start: windowStart,
      end: windowEnd,
      dateString,
      windowString
    };
  }

  /**
   * Format date string for file names (YYYY-MM-DD format)
   * @param {Date} date - Date to format
   * @returns {string} Formatted date string
   */
  formatDateString(date) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Format window string for file names (HHMM-HHMM format)
   * @param {Date} start - Window start time
   * @param {Date} end - Window end time
   * @returns {string} Formatted window string
   */
  formatWindowString(start, end) {
    const formatTime = (date) => {
      return date.toTimeString().substring(0, 5).replace(':', '');
    };
    
    return `${formatTime(start)}-${formatTime(end)}`;
  }

  ensureDirectoryExists(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// Main execution
async function main() {
  const projectPath = process.argv[2] || process.cwd();
  const codingRepo = process.argv[3] || projectPath;

  const logger = new SimplifiedSessionLogger(projectPath, codingRepo);
  await logger.log();
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export default SimplifiedSessionLogger;