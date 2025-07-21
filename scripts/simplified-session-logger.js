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
import FastKeywordClassifier from './fast-keyword-classifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class SimplifiedSessionLogger {
  constructor(projectPath, codingRepo) {
    this.projectPath = projectPath;
    this.codingRepo = codingRepo;
    // Use fast keyword classifier for 2-3 second classification
    this.classifier = new FastKeywordClassifier();
    
    // Generate single timestamp for both files
    const now = new Date();
    const date = now.getFullYear() + '-' + 
                String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                String(now.getDate()).padStart(2, '0');
    const time = String(now.getHours()).padStart(2, '0') + '-' + 
                String(now.getMinutes()).padStart(2, '0') + '-' + 
                String(now.getSeconds()).padStart(2, '0');
    this.timestamp = `${date}_${time}`;
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
      
      // Classify content to determine file creation strategy
      // Fast keyword-based classification (2-3 seconds max)
      const classificationResult = this.classifier.classifyContent(extractedConversation, this.projectPath);
      console.log(`🔍 Classification result:`, JSON.stringify(classificationResult, null, 2));
      
      if (classificationResult.classification === 'coding') {
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
    
    const projectName = path.basename(this.projectPath);
    const filename = `${this.timestamp}_${projectName}-session.md`;
    const filepath = path.join(logDir, filename);
    
    const content = this.createSessionContent(conversation, 'local', hasCodingContent);
    fs.writeFileSync(filepath, content);
    
    return filepath;
  }

  async createCodingFile(conversation) {
    const logDir = path.join(this.codingRepo, '.specstory', 'history');
    this.ensureDirectoryExists(logDir);
    
    const filename = `${this.timestamp}_coding-session.md`;
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
  main().catch(console.error);
}

export default SimplifiedSessionLogger;