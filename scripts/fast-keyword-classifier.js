#!/usr/bin/env node

/**
 * Fast Keyword-Based Session Classifier
 * 
 * Classifies session content as "coding" or "project" based on keyword matching.
 * Designed to run in 2-3 seconds max during shutdown phase.
 * 
 * Only analyzes actual user requests (not tool results) to determine classification.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class FastKeywordClassifier {
  constructor(keywordsFile = path.join(__dirname, 'coding-keywords.json')) {
    this.keywords = this.loadKeywords(keywordsFile);
    this.compiledPatterns = this.compilePatterns();
  }

  loadKeywords(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      console.error('Failed to load keywords file:', error.message);
      // Fallback minimal keywords
      return {
        keywords: {
          primary: ['ukb', 'vkb', 'knowledge base', 'semantic analysis', 'MCP', 'session-logger'],
          secondary: ['agent', 'insight', 'workflow'],
          file_patterns: ['ukb', 'vkb', 'classifier'],
          path_patterns: ['/coding/']
        },
        exclusion_patterns: ['timeline', 'Three.js', 'Kotlin'],
        classification_rules: {
          minimum_matches: 2,
          primary_weight: 3,
          secondary_weight: 1,
          file_pattern_weight: 2,
          path_pattern_weight: 2,
          exclusion_penalty: -5
        }
      };
    }
  }

  compilePatterns() {
    // Pre-compile regex patterns for performance
    const compile = (patterns) => patterns.map(p => {
      // For simple keywords, use word boundaries. For phrases, use contains matching.
      if (p.includes(' ') || p.includes('-') || p.includes('_')) {
        // Multi-word phrases - just escape and use contains
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped, 'i');
      } else {
        // Single words - use word boundaries
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i');
      }
    });

    const keywords = this.keywords.keywords;
    return {
      primary: compile(keywords.primary || []),
      secondary: compile(keywords.secondary || []),
      filePatterns: compile(keywords.file_patterns || []),
      pathPatterns: (keywords.path_patterns || []).map(p => 
        new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      ),
      mcpPatterns: compile(keywords.mcp_patterns || []),
      systemConcepts: compile(keywords.system_concepts || []),
      technicalTerms: compile(keywords.technical_terms || []),
      exclusions: compile(this.keywords.exclusion_patterns || [])
    };
  }

  extractTopicBlocks(content) {
    // Extract complete topic blocks: user input + all assistant responses until next user input
    const topicBlocks = [];
    const lines = content.split('\n');
    
    let currentBlock = [];
    let inTopicBlock = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Start of new topic block - user input (but not tool results)
      if (line.startsWith('**User:**')) {
        // Save previous block if exists
        if (inTopicBlock && currentBlock.length > 0) {
          topicBlocks.push(currentBlock.join(' '));
        }
        
        // Start new block only if NOT a tool result
        if (!line.includes('[Tool Result]')) {
          inTopicBlock = true;
          currentBlock = [];
          // Include the user content
          const userContent = line.replace('**User:**', '').trim();
          if (userContent) {
            currentBlock.push(userContent);
          }
        } else {
          inTopicBlock = false;
          currentBlock = [];
        }
      }
      // Continue collecting content in current topic block
      else if (inTopicBlock) {
        // Include assistant responses, tool calls, everything until next user input
        if (line.startsWith('**Assistant:**')) {
          const assistantContent = line.replace('**Assistant:**', '').trim();
          if (assistantContent) {
            currentBlock.push(assistantContent);
          }
        } else if (!line.startsWith('---') && !line.startsWith('## Exchange') && line.trim()) {
          // Include other content but skip separators
          currentBlock.push(line);
        }
      }
    }
    
    // Don't forget last block
    if (inTopicBlock && currentBlock.length > 0) {
      topicBlocks.push(currentBlock.join(' '));
    }
    
    return topicBlocks;
  }

  extractUserRequests(content) {
    // Extract only actual user requests (not tool results) - kept for compatibility
    const userRequests = [];
    const lines = content.split('\n');
    
    let inUserBlock = false;
    let currentRequest = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Start of user block
      if (line.startsWith('**User:**')) {
        // Check if this line or next line is NOT a tool result
        const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
        if (!line.includes('[Tool Result]') && !nextLine.includes('[Tool Result]')) {
          inUserBlock = true;
          currentRequest = [];
          // Include the content after '**User:**' if any
          const userContent = line.replace('**User:**', '').trim();
          if (userContent) {
            currentRequest.push(userContent);
          }
        }
      }
      // End of block (assistant response or new exchange)
      else if (line.startsWith('**Assistant:**') || line.startsWith('---') || line.startsWith('## Exchange')) {
        if (inUserBlock && currentRequest.length > 0) {
          userRequests.push(currentRequest.join(' '));
        }
        inUserBlock = false;
        currentRequest = [];
      }
      // Collect content if in user block
      else if (inUserBlock) {
        currentRequest.push(line);
      }
    }
    
    // Don't forget last request
    if (inUserBlock && currentRequest.length > 0) {
      userRequests.push(currentRequest.join(' '));
    }
    
    return userRequests;
  }

  classifyTopicBlock(blockText) {
    // Classify individual topic block
    let score = 0;
    const matches = { primary: 0, secondary: 0, mcp: 0, system: 0, technical: 0, exclusions: 0 };
    
    // Quick scoring for individual blocks
    for (const pattern of this.compiledPatterns.primary) {
      if (pattern.test(blockText)) {
        score += this.keywords.classification_rules.primary_weight;
        matches.primary++;
      }
    }
    for (const pattern of this.compiledPatterns.secondary) {
      if (pattern.test(blockText)) {
        score += this.keywords.classification_rules.secondary_weight;
        matches.secondary++;
      }
    }
    for (const pattern of this.compiledPatterns.mcpPatterns) {
      if (pattern.test(blockText)) {
        score += (this.keywords.classification_rules.mcp_pattern_weight || 3);
        matches.mcp++;
      }
    }
    for (const pattern of this.compiledPatterns.systemConcepts) {
      if (pattern.test(blockText)) {
        score += (this.keywords.classification_rules.system_concept_weight || 2);
        matches.system++;
      }
    }
    for (const pattern of this.compiledPatterns.technicalTerms) {
      if (pattern.test(blockText)) {
        score += (this.keywords.classification_rules.technical_term_weight || 1);
        matches.technical++;
      }
    }
    for (const pattern of this.compiledPatterns.exclusions) {
      if (pattern.test(blockText)) {
        score += this.keywords.classification_rules.exclusion_penalty;
        matches.exclusions++;
      }
    }
    
    const minScore = this.keywords.classification_rules.minimum_score || 4;
    const classification = score >= minScore ? 'coding' : 'project';
    
    return { classification, score, matches };
  }

  classifyContent(content, filePath = '', useTopicBlocks = true, showBlockDetails = false) {
    const startTime = Date.now();
    
    // Extract topic blocks (user input + assistant responses) for better classification
    const topicBlocks = useTopicBlocks ? this.extractTopicBlocks(content) : [];
    const userRequests = this.extractUserRequests(content);
    
    // Analyze individual topic blocks if requested
    const blockAnalysis = [];
    if (showBlockDetails && topicBlocks.length > 0) {
      for (let i = 0; i < topicBlocks.length; i++) {
        const block = topicBlocks[i];
        const result = this.classifyTopicBlock(block);
        const preview = block.length > 60 ? block.substring(0, 60) + '...' : block;
        blockAnalysis.push({
          id: i + 1,
          preview,
          classification: result.classification,
          score: result.score,
          destination: result.classification === 'coding' ? 'coding' : 'project'
        });
      }
    }
    
    // Use topic blocks if available, otherwise fall back to user requests
    const textToAnalyze = topicBlocks.length > 0 ? topicBlocks.join(' ') : userRequests.join(' ');
    
    // Also analyze the file path
    const fullText = `${textToAnalyze} ${filePath}`;
    
    // Score calculation
    let score = 0;
    const matches = {
      primary: [],
      secondary: [],
      filePatterns: [],
      pathPatterns: [],
      mcpPatterns: [],
      systemConcepts: [],
      technicalTerms: [],
      exclusions: []
    };
    
    // Check primary keywords (weight: 3)
    for (const pattern of this.compiledPatterns.primary) {
      if (pattern.test(fullText)) {
        score += this.keywords.classification_rules.primary_weight;
        matches.primary.push(pattern.source);
      }
    }
    
    // Check secondary keywords (weight: 1)
    for (const pattern of this.compiledPatterns.secondary) {
      if (pattern.test(fullText)) {
        score += this.keywords.classification_rules.secondary_weight;
        matches.secondary.push(pattern.source);
      }
    }
    
    // Check file patterns (weight: 2)
    for (const pattern of this.compiledPatterns.filePatterns) {
      if (pattern.test(filePath)) {
        score += this.keywords.classification_rules.file_pattern_weight;
        matches.filePatterns.push(pattern.source);
      }
    }
    
    // Check path patterns (weight: 2)
    for (const pattern of this.compiledPatterns.pathPatterns) {
      if (pattern.test(filePath)) {
        score += this.keywords.classification_rules.path_pattern_weight;
        matches.pathPatterns.push(pattern.source);
      }
    }
    
    // Check MCP patterns (weight: 3)
    for (const pattern of this.compiledPatterns.mcpPatterns) {
      if (pattern.test(fullText)) {
        score += (this.keywords.classification_rules.mcp_pattern_weight || 3);
        matches.mcpPatterns.push(pattern.source);
      }
    }
    
    // Check system concepts (weight: 2)
    for (const pattern of this.compiledPatterns.systemConcepts) {
      if (pattern.test(fullText)) {
        score += (this.keywords.classification_rules.system_concept_weight || 2);
        matches.systemConcepts.push(pattern.source);
      }
    }
    
    // Check technical terms (weight: 1)
    for (const pattern of this.compiledPatterns.technicalTerms) {
      if (pattern.test(fullText)) {
        score += (this.keywords.classification_rules.technical_term_weight || 1);
        matches.technicalTerms.push(pattern.source);
      }
    }
    
    // Check exclusions (penalty: -5)
    for (const pattern of this.compiledPatterns.exclusions) {
      if (pattern.test(fullText)) {
        score += this.keywords.classification_rules.exclusion_penalty;
        matches.exclusions.push(pattern.source);
      }
    }
    
    // Determine classification
    const totalMatches = matches.primary.length + matches.secondary.length + 
                        matches.filePatterns.length + matches.pathPatterns.length +
                        matches.mcpPatterns.length + matches.systemConcepts.length +
                        matches.technicalTerms.length;
    
    const minScore = this.keywords.classification_rules.minimum_score || 4;
    const classification = (score >= minScore) ? 'coding' : 'project';
    
    const processingTime = Date.now() - startTime;
    
    const result = {
      classification,
      confidence: Math.min(100, Math.max(0, score * 10)), // Simple confidence score
      score,
      totalMatches,
      matches,
      topicBlocksAnalyzed: topicBlocks.length,
      userRequestsAnalyzed: userRequests.length,
      processingTimeMs: processingTime,
      reasoning: this.generateReasoning(matches, score, classification)
    };
    
    if (showBlockDetails && blockAnalysis.length > 0) {
      result.blockAnalysis = blockAnalysis;
    }
    
    return result;
  }

  generateReasoning(matches, score, classification) {
    const reasons = [];
    
    if (matches.primary.length > 0) {
      reasons.push(`Found ${matches.primary.length} primary coding keywords`);
    }
    if (matches.secondary.length > 0) {
      reasons.push(`Found ${matches.secondary.length} secondary indicators`);
    }
    if (matches.mcpPatterns.length > 0) {
      reasons.push(`Found ${matches.mcpPatterns.length} MCP-related patterns`);
    }
    if (matches.systemConcepts.length > 0) {
      reasons.push(`Found ${matches.systemConcepts.length} system concept matches`);
    }
    if (matches.technicalTerms.length > 0) {
      reasons.push(`Found ${matches.technicalTerms.length} technical terms`);
    }
    if (matches.filePatterns.length > 0) {
      reasons.push(`File name matches coding patterns`);
    }
    if (matches.pathPatterns.length > 0) {
      reasons.push(`Path indicates coding project`);
    }
    if (matches.exclusions.length > 0) {
      reasons.push(`Found ${matches.exclusions.length} exclusion patterns (non-coding content)`);
    }
    
    const minScore = this.keywords.classification_rules.minimum_score || 4;
    reasons.push(`Total score: ${score} (threshold: ${minScore})`);
    
    return reasons.join('; ');
  }
}

// CLI usage
// Check if running as main module
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: fast-keyword-classifier.js <session-file> [keywords-file] [options]');
    console.error('Options:');
    console.error('  --user-only: Analyze only user requests instead of full topic blocks');
    console.error('  --blocks: Show individual topic block classifications');
    console.error('  --verbose: Show analysis details and block classifications');
    console.error('  --quiet: Only output final classification result');
    process.exit(1);
  }
  
  const sessionFile = args[0];
  const keywordsFile = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
  const useTopicBlocks = !args.includes('--user-only');
  const showBlockDetails = args.includes('--blocks') || args.includes('--verbose');
  
  try {
    const content = fs.readFileSync(sessionFile, 'utf8');
    const classifier = new FastKeywordClassifier(keywordsFile);
    const result = classifier.classifyContent(content, sessionFile, useTopicBlocks, showBlockDetails);
    
    if (args.includes('--verbose')) {
      console.log(`Analysis mode: ${useTopicBlocks ? 'Topic Blocks' : 'User Requests Only'}`);
      console.log(`Processed: ${useTopicBlocks ? result.topicBlocksAnalyzed + ' blocks' : result.userRequestsAnalyzed + ' requests'}`);
      console.log('---');
    }
    
    // Show block details if requested
    if (result.blockAnalysis) {
      console.log('Topic Block Analysis:');
      result.blockAnalysis.forEach(block => {
        console.log(`  ${block.id}. ${block.preview} --> ${block.destination} (${block.score})`);
      });
      console.log(`Overall: --> ${result.classification} (${result.score})\n`);
    }
    
    if (args.includes('--quiet')) {
      console.log(`${result.classification}`);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

export default FastKeywordClassifier;