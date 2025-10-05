#!/usr/bin/env node

/**
 * Conversation Topic Segmenter
 * Analyzes conversations and splits them into topic-based segments
 */

import LLMContentClassifier from './llm-content-classifier.js';
import fs from 'fs';
import path from 'path';

class ConversationTopicSegmenter {
  constructor() {
    this.classifier = new LLMContentClassifier();
  }

  /**
   * Segments a conversation into topic-based chunks
   * @param {string} conversation - The full conversation content
   * @returns {Array} Array of segments with topic classification
   */
  async segmentConversation(conversation) {
    console.log('🔍 Analyzing conversation for topic segmentation...');
    
    // Parse the conversation into exchanges
    const exchanges = this.parseConversationExchanges(conversation);
    
    if (exchanges.length === 0) {
      console.log('⚠️  No exchanges found in conversation');
      return [{
        topic: 'unknown',
        project: 'coding',
        exchanges: [],
        summary: 'Empty or unparseable conversation'
      }];
    }

    // Group exchanges into topic segments
    const segments = await this.identifyTopicSegments(exchanges);
    
    console.log(`📊 Identified ${segments.length} topic segments`);
    return segments;
  }

  /**
   * Parse conversation markdown into individual exchanges
   */
  parseConversationExchanges(conversation) {
    const exchanges = [];
    
    // Split by exchange headers (## Exchange N)
    const exchangePattern = /## Exchange \d+\n\n([\s\S]*?)(?=## Exchange \d+|$)/g;
    let match;
    let exchangeNumber = 1;
    
    while ((match = exchangePattern.exec(conversation)) !== null) {
      const content = match[1].trim();
      if (content) {
        // Extract user and assistant messages
        const userMatch = content.match(/\*\*User:\*\*.*?\n([\s\S]*?)(?=\*\*Assistant:\*\*|$)/);
        const assistantMatch = content.match(/\*\*Assistant:\*\*.*?\n([\s\S]*?)(?=---|\*\*User:\*\*|$)/);
        
        exchanges.push({
          number: exchangeNumber++,
          userMessage: userMatch ? userMatch[1].trim() : '',
          assistantMessage: assistantMatch ? assistantMatch[1].trim() : '',
          fullContent: content
        });
      }
    }
    
    // If no exchanges found, try to parse as a different format
    if (exchanges.length === 0) {
      // Try simple user/assistant pattern
      const simplePattern = /\*\*User:\*\*([\s\S]*?)\*\*Assistant:\*\*([\s\S]*?)(?=\*\*User:\*\*|$)/g;
      let simpleMatch;
      let exchangeNum = 1;
      
      while ((simpleMatch = simplePattern.exec(conversation)) !== null) {
        exchanges.push({
          number: exchangeNum++,
          userMessage: simpleMatch[1].trim(),
          assistantMessage: simpleMatch[2].trim(),
          fullContent: simpleMatch[0]
        });
      }
    }
    
    return exchanges;
  }

  /**
   * Identify topic segments from exchanges
   */
  async identifyTopicSegments(exchanges) {
    const segments = [];
    let currentSegment = null;
    let lastTopic = null;
    
    for (const exchange of exchanges) {
      // Analyze the topic of this exchange
      const topicInfo = await this.analyzeExchangeTopic(exchange);
      
      // Check if we need to start a new segment
      if (!currentSegment || topicInfo.topic !== lastTopic) {
        // Save the previous segment if it exists
        if (currentSegment) {
          currentSegment.endExchange = exchange.number - 1;
          segments.push(currentSegment);
        }
        
        // Start a new segment
        currentSegment = {
          topic: topicInfo.topic,
          project: topicInfo.project,
          startExchange: exchange.number,
          exchanges: [exchange],
          summary: topicInfo.summary,
          keywords: topicInfo.keywords || []
        };
        
        lastTopic = topicInfo.topic;
      } else {
        // Add to current segment
        currentSegment.exchanges.push(exchange);
      }
    }
    
    // Don't forget the last segment
    if (currentSegment) {
      currentSegment.endExchange = exchanges[exchanges.length - 1].number;
      segments.push(currentSegment);
    }
    
    // Post-process to merge very small segments
    return this.mergeSmallSegments(segments);
  }

  /**
   * Analyze a single exchange to determine its topic
   */
  async analyzeExchangeTopic(exchange) {
    const content = `User: ${exchange.userMessage}\nAssistant: ${exchange.assistantMessage}`;
    
    // First, use the basic classifier
    const classification = await this.classifier.classifyContent(content);
    
    // Then do more detailed analysis
    const detailedTopic = await this.getDetailedTopic(content, classification);
    
    return detailedTopic;
  }

  /**
   * Get detailed topic information
   */
  async getDetailedTopic(content, basicClassification) {
    // Extract keywords and patterns
    const keywords = this.extractKeywords(content);
    
    // Check for specific topics regardless of basic classification
    // This allows for more accurate topic detection
    
    // Knowledge management topics
    if (keywords.some(k => ['ukb', 'vkb', 'knowledge', 'memory', 'shared-memory'].includes(k))) {
      return {
        topic: 'knowledge-management',
        project: 'coding',
        summary: 'Knowledge base management and tools',
        keywords
      };
    }
    
    // MCP and semantic analysis
    if (keywords.some(k => ['mcp', 'semantic', 'analysis'].includes(k)) && 
        !content.toLowerCase().includes('timeline')) {
      return {
        topic: 'mcp-infrastructure',
        project: 'coding',
        summary: 'MCP servers and semantic analysis',
        keywords
      };
    }
    
    // Logging systems
    if (keywords.some(k => ['logging', 'logger', 'post-session'].includes(k)) &&
        (content.includes('post-session') || content.includes('logger'))) {
      return {
        topic: 'logging-system',
        project: 'coding',
        summary: 'Logging and session management',
        keywords
      };
    }
    
    // Timeline project specific
    if (keywords.some(k => ['timeline', 'kotlin', 'compose', 'react', 'migration', 'skia'].includes(k))) {
      return {
        topic: 'timeline-development',
        project: '/Users/q284340/Agentic/timeline',
        summary: 'Timeline project development and migration',
        keywords
      };
    }
    
    // Session log reading (could be any project)
    if (content.includes('session log') || content.includes('check.*log')) {
      return {
        topic: 'session-review',
        project: basicClassification === 'coding' ? 'coding' : 'project',
        summary: 'Reviewing session logs',
        keywords
      };
    }
    
    // Try to identify specific project from content
    const projectPath = this.extractProjectFromContent(content);
    if (projectPath) {
      const projectName = path.basename(projectPath);
      return {
        topic: `${projectName}-development`,
        project: projectPath,
        summary: `Development work on ${projectName} project`,
        keywords
      };
    }
    
    // Default fallback based on classification
    return {
      topic: basicClassification === 'coding' ? 'coding-general' : 'project-development',
      project: basicClassification === 'coding' ? 'coding' : 'project',
      summary: 'General development work',
      keywords
    };
  }

  /**
   * Extract keywords from content
   */
  extractKeywords(content) {
    const keywords = [];
    const keywordPatterns = [
      /\b(ukb|vkb|knowledge|memory|shared-memory)\b/gi,
      /\b(mcp|server|semantic|analysis)\b/gi,
      /\b(logging|session|post-session|logger)\b/gi,
      /\b(timeline|react|kotlin|compose|multiplatform)\b/gi,
      /\b(api|backend|frontend|database)\b/gi
    ];
    
    keywordPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        keywords.push(...matches.map(m => m.toLowerCase()));
      }
    });
    
    return [...new Set(keywords)]; // Remove duplicates
  }

  /**
   * Extract project path from content
   */
  extractProjectFromContent(content) {
    const pathPattern = /\/Users\/\w+\/Agentic\/(\w+)/g;
    const matches = [...content.matchAll(pathPattern)];
    
    if (matches.length > 0) {
      // Count occurrences
      const projectCounts = {};
      matches.forEach(match => {
        const projectName = match[1];
        projectCounts[projectName] = (projectCounts[projectName] || 0) + 1;
      });
      
      // Find most mentioned non-coding project
      let maxCount = 0;
      let mostMentioned = null;
      for (const [project, count] of Object.entries(projectCounts)) {
        if (project !== 'coding' && count > maxCount) {
          maxCount = count;
          mostMentioned = project;
        }
      }
      
      if (mostMentioned) {
        return `/Users/q284340/Agentic/${mostMentioned}`;
      }
    }
    
    return null;
  }

  /**
   * Merge very small segments (less than 2 exchanges) with adjacent ones
   */
  mergeSmallSegments(segments) {
    const merged = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      if (segment.exchanges.length < 2 && merged.length > 0) {
        // Merge with previous segment if topics are related
        const prev = merged[merged.length - 1];
        if (this.areTopicsRelated(prev.topic, segment.topic)) {
          prev.exchanges.push(...segment.exchanges);
          prev.endExchange = segment.endExchange;
          prev.keywords = [...new Set([...prev.keywords, ...segment.keywords])];
          continue;
        }
      }
      
      merged.push(segment);
    }
    
    return merged;
  }

  /**
   * Check if two topics are related enough to merge
   */
  areTopicsRelated(topic1, topic2) {
    // Same exact topic
    if (topic1 === topic2) return true;
    
    // Both are coding infrastructure
    const codingTopics = ['knowledge-management', 'mcp-infrastructure', 'logging-system', 'coding-general'];
    if (codingTopics.includes(topic1) && codingTopics.includes(topic2)) return true;
    
    // Both are about the same project
    if (topic1.endsWith('-development') && topic2.endsWith('-development')) {
      return topic1.split('-')[0] === topic2.split('-')[0];
    }
    
    return false;
  }

  /**
   * Generate a summary for a segment
   */
  generateSegmentSummary(segment) {
    const exchangeCount = segment.exchanges.length;
    const exchangeRange = segment.startExchange === segment.endExchange 
      ? `Exchange ${segment.startExchange}`
      : `Exchanges ${segment.startExchange}-${segment.endExchange}`;
    
    return `${exchangeRange} (${exchangeCount} total): ${segment.summary}`;
  }
}

export default ConversationTopicSegmenter;