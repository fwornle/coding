#!/usr/bin/env node

/**
 * Multi-Topic Session Logger
 * Splits conversations by topic and logs to appropriate projects
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import ClaudeConversationExtractor from './claude-conversation-extractor.js';
import ConversationTopicSegmenter from './conversation-topic-segmenter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class MultiTopicSessionLogger {
  constructor(projectPath, codingRepo) {
    this.projectPath = projectPath;
    this.codingRepo = codingRepo;
    this.segmenter = new ConversationTopicSegmenter();
    
    // Generate session ID
    const now = new Date();
    const date = now.getFullYear() + '-' + 
                String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                String(now.getDate()).padStart(2, '0');
    const time = String(now.getHours()).padStart(2, '0') + '-' + 
                String(now.getMinutes()).padStart(2, '0') + '-' + 
                String(now.getSeconds()).padStart(2, '0');
    this.timestamp = `${date}_${time}`;
    this.sessionId = `${this.timestamp}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async log() {
    console.log('🔄 Multi-topic post-session logging started...');
    
    try {
      // Extract conversation
      const extractor = new ClaudeConversationExtractor(this.projectPath);
      const extractedConversation = await extractor.extractRecentConversation(30);
      
      if (!extractedConversation) {
        console.log('⚠️  No conversation found to log');
        return;
      }
      
      // Segment conversation by topics
      const segments = await this.segmenter.segmentConversation(extractedConversation);
      
      // Log each segment to appropriate location
      const loggedFiles = await this.logSegments(segments, extractedConversation);
      
      // Create cross-reference index
      await this.createCrossReferenceIndex(loggedFiles);
      
      console.log(`✅ Multi-topic session logged across ${loggedFiles.length} files`);
      
    } catch (error) {
      console.error('❌ Multi-topic session logging failed:', error.message);
    }
  }

  async logSegments(segments, fullConversation) {
    const loggedFiles = [];
    const sessionHeader = this.extractSessionHeader(fullConversation);
    
    for (const segment of segments) {
      try {
        const logInfo = await this.logSegment(segment, sessionHeader, segments.length);
        loggedFiles.push(logInfo);
      } catch (error) {
        console.error(`❌ Failed to log segment ${segment.topic}:`, error.message);
      }
    }
    
    return loggedFiles;
  }

  async logSegment(segment, sessionHeader, totalSegments) {
    // Determine target directory
    const targetDir = this.getTargetDirectory(segment);
    const logDir = path.join(targetDir, '.specstory', 'history');
    
    // Ensure directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Generate filename
    const projectName = path.basename(targetDir);
    const topicSlug = segment.topic.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const filename = `${this.timestamp}_${projectName}-${topicSlug}-segment.md`;
    const filepath = path.join(logDir, filename);
    
    // Create segment content
    const content = this.createSegmentContent(segment, sessionHeader, totalSegments);
    
    // Write file
    fs.writeFileSync(filepath, content);
    console.log(`📝 Logged ${segment.topic} segment to: ${filepath}`);
    
    return {
      filepath,
      project: projectName,
      topic: segment.topic,
      exchanges: segment.exchanges.length,
      startExchange: segment.startExchange,
      endExchange: segment.endExchange
    };
  }

  getTargetDirectory(segment) {
    // If segment has a specific project path, use it
    if (segment.project && segment.project.startsWith('/')) {
      if (fs.existsSync(segment.project)) {
        return segment.project;
      }
    }
    
    // If it's coding infrastructure, use coding repo
    if (segment.project === 'coding' || segment.topic.includes('coding')) {
      return this.codingRepo;
    }
    
    // Otherwise use current project directory
    return this.projectPath;
  }

  extractSessionHeader(conversation) {
    // Extract session metadata from the beginning of the conversation
    const lines = conversation.split('\n');
    const header = [];
    
    for (const line of lines) {
      if (line.startsWith('**Session ID:**') || 
          line.startsWith('**Summary:**') ||
          line.startsWith('**Start Time:**') ||
          line.startsWith('**End Time:**') ||
          line.startsWith('**Total Messages:**')) {
        header.push(line);
      }
      if (line.startsWith('---')) break;
    }
    
    return header.join('\n');
  }

  createSegmentContent(segment, sessionHeader, totalSegments) {
    const now = new Date();
    const exchangeList = segment.exchanges.map(e => 
      `### Exchange ${e.number}\n\n**User:** ${e.userMessage}\n\n**Assistant:** ${e.assistantMessage}`
    ).join('\n\n---\n\n');
    
    return `# Topic-Segmented Session: ${segment.topic}

**Parent Session ID:** ${this.sessionId}  
**Segment Topic:** ${segment.topic}  
**Exchanges:** ${segment.startExchange}-${segment.endExchange} (${segment.exchanges.length} total)  
**Keywords:** ${segment.keywords.join(', ')}  
**Logged At:** ${now.toISOString()}  

${sessionHeader}

---

## Segment Information

This is segment for topic "${segment.topic}" from a multi-topic session.  
Total segments in session: ${totalSegments}

### Cross-References
See \`.specstory/history/${this.timestamp}_session-index.json\` for complete session map.

---

## Conversation Segment

${exchangeList}

---

## Segment Summary

${segment.summary}

**Exchange Range:** ${segment.startExchange}-${segment.endExchange}  
**Exchange Count:** ${segment.exchanges.length}  
**Primary Keywords:** ${segment.keywords.slice(0, 5).join(', ')}
`;
  }

  async createCrossReferenceIndex(loggedFiles) {
    // Create index in both coding repo and current project
    const indexData = {
      sessionId: this.sessionId,
      timestamp: this.timestamp,
      createdAt: new Date().toISOString(),
      totalSegments: loggedFiles.length,
      segments: loggedFiles.map(file => ({
        ...file,
        relativePath: path.relative(this.codingRepo, file.filepath)
      })),
      summary: this.generateSessionSummary(loggedFiles)
    };
    
    // Save to coding repo
    const codingIndexPath = path.join(this.codingRepo, '.specstory', 'history', `${this.timestamp}_session-index.json`);
    this.ensureDirectoryExists(path.dirname(codingIndexPath));
    fs.writeFileSync(codingIndexPath, JSON.stringify(indexData, null, 2));
    
    // If current project is different, save there too
    if (this.projectPath !== this.codingRepo) {
      const projectIndexPath = path.join(this.projectPath, '.specstory', 'history', `${this.timestamp}_session-index.json`);
      this.ensureDirectoryExists(path.dirname(projectIndexPath));
      fs.writeFileSync(projectIndexPath, JSON.stringify(indexData, null, 2));
    }
    
    console.log(`📋 Created session index: ${codingIndexPath}`);
  }

  generateSessionSummary(loggedFiles) {
    const projects = [...new Set(loggedFiles.map(f => f.project))];
    const topics = loggedFiles.map(f => f.topic);
    const totalExchanges = loggedFiles.reduce((sum, f) => sum + f.exchanges, 0);
    
    return `Multi-topic session across ${projects.length} projects (${projects.join(', ')}). ` +
           `Topics covered: ${topics.join(', ')}. ` +
           `Total exchanges: ${totalExchanges}`;
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

  const logger = new MultiTopicSessionLogger(projectPath, codingRepo);
  await logger.log();
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default MultiTopicSessionLogger;