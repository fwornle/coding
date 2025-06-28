/**
 * Entity Processor
 * Processes and extracts entities from various types of analysis data
 */

import { Logger } from '../../../shared/logger.js';

export class EntityProcessor {
  constructor(config = {}) {
    this.config = {
      significanceThreshold: config.significanceThreshold || 6,
      maxEntitiesPerAnalysis: config.maxEntitiesPerAnalysis || 10,
      deduplicate: config.deduplicate !== false,
      enhancedExtraction: config.enhancedExtraction !== false,
      ...config
    };
    
    this.logger = new Logger('entity-processor');
  }

  async processEntity(entityData) {
    try {
      this.logger.debug(`Processing entity: ${entityData.name}`);
      
      // Validate required fields
      if (!entityData.name || !entityData.entityType) {
        throw new Error('Entity name and type are required');
      }
      
      // Normalize entity data
      const processed = {
        name: this.normalizeEntityName(entityData.name),
        entityType: this.normalizeEntityType(entityData.entityType),
        significance: this.validateSignificance(entityData.significance),
        observations: this.processObservations(entityData.observations || []),
        metadata: this.processMetadata(entityData.metadata || {})
      };
      
      // Enhanced processing if enabled
      if (this.config.enhancedExtraction) {
        processed.keywords = this.extractKeywords(processed);
        processed.categories = this.categorizeEntity(processed);
        processed.relatedTopics = this.extractRelatedTopics(processed);
      }
      
      return processed;
      
    } catch (error) {
      this.logger.error('Entity processing failed:', error);
      throw error;
    }
  }

  async extractEntitiesFromCodeAnalysis(analysisResult) {
    try {
      this.logger.debug('Extracting entities from code analysis');
      
      const entities = [];
      
      // Extract from main analysis
      if (analysisResult.analyses) {
        for (const analysis of analysisResult.analyses) {
          const commitEntities = await this.extractEntitiesFromCommitAnalysis(analysis);
          entities.push(...commitEntities);
        }
      }
      
      // Extract from detected patterns
      if (analysisResult.patterns) {
        const patternEntities = this.extractEntitiesFromPatterns(analysisResult.patterns);
        entities.push(...patternEntities);
      }
      
      // Deduplicate if enabled
      const finalEntities = this.config.deduplicate ? 
        this.deduplicateEntities(entities) : entities;
      
      return finalEntities.slice(0, this.config.maxEntitiesPerAnalysis);
      
    } catch (error) {
      this.logger.error('Failed to extract entities from code analysis:', error);
      return [];
    }
  }

  async extractEntitiesFromCommitAnalysis(commitAnalysis) {
    const entities = [];
    
    try {
      // Extract commit-level entity
      if (commitAnalysis.significance >= this.config.significanceThreshold) {
        entities.push({
          name: `Commit: ${commitAnalysis.commit.subject}`,
          entityType: 'CommitAnalysis',
          significance: commitAnalysis.significance,
          observations: [
            `Commit hash: ${commitAnalysis.commit.hash}`,
            `Author: ${commitAnalysis.commit.author}`,
            `Analysis: ${JSON.stringify(commitAnalysis.analysis)}`,
            `Files changed: ${commitAnalysis.changedFiles?.length || 0}`
          ],
          metadata: {
            source: 'code-analysis',
            commitHash: commitAnalysis.commit.hash,
            author: commitAnalysis.commit.author,
            timestamp: commitAnalysis.timestamp
          }
        });
      }
      
      // Extract pattern entities from commit
      if (commitAnalysis.patterns) {
        for (const pattern of commitAnalysis.patterns) {
          if (this.isSignificantPattern(pattern)) {
            entities.push({
              name: `Pattern: ${pattern.type || pattern}`,
              entityType: 'CodePattern',
              significance: this.calculatePatternSignificance(pattern),
              observations: [
                `Pattern type: ${pattern.type || pattern}`,
                `Found in commit: ${commitAnalysis.commit.hash}`,
                `Context: ${pattern.context || 'code analysis'}`
              ],
              metadata: {
                source: 'pattern-detection',
                commitHash: commitAnalysis.commit.hash,
                pattern: pattern
              }
            });
          }
        }
      }
      
    } catch (error) {
      this.logger.debug('Error extracting entities from commit analysis:', error.message);
    }
    
    return entities;
  }

  async extractEntitiesFromConversation(conversationResult) {
    try {
      this.logger.debug('Extracting entities from conversation analysis');
      
      const entities = [];
      
      // Extract main conversation entity
      if (conversationResult.significance >= this.config.significanceThreshold) {
        entities.push({
          name: `Conversation: ${this.extractConversationTitle(conversationResult)}`,
          entityType: 'ConversationAnalysis',
          significance: conversationResult.significance,
          observations: [
            `Analysis: ${conversationResult.analysis}`,
            `Path: ${conversationResult.conversationPath}`,
            `Insights count: ${conversationResult.insights?.length || 0}`
          ],
          metadata: {
            source: 'conversation-analysis',
            conversationPath: conversationResult.conversationPath,
            timestamp: conversationResult.timestamp
          }
        });
      }
      
      // Extract insight entities
      if (conversationResult.insights) {
        for (const insight of conversationResult.insights) {
          if (insight.significance >= this.config.significanceThreshold) {
            entities.push({
              name: insight.title || `Insight: ${insight.type}`,
              entityType: 'Insight',
              significance: insight.significance,
              observations: [
                `Description: ${insight.description}`,
                `Type: ${insight.type}`,
                `Applicability: ${insight.applicability}`,
                `Technologies: ${insight.technologies?.join(', ') || 'general'}`
              ],
              metadata: {
                source: 'conversation-insight',
                conversationPath: conversationResult.conversationPath,
                technologies: insight.technologies || [],
                references: insight.references || []
              }
            });
          }
        }
      }
      
      return this.config.deduplicate ? 
        this.deduplicateEntities(entities) : entities;
      
    } catch (error) {
      this.logger.error('Failed to extract entities from conversation:', error);
      return [];
    }
  }

  async extractReferencesFromSearch(searchResult) {
    try {
      this.logger.debug('Extracting reference entities from search results');
      
      const entities = [];
      
      if (searchResult.results) {
        for (const result of searchResult.results.slice(0, 5)) { // Top 5 results
          if (result.relevanceScore >= 0.7) { // High relevance only
            entities.push({
              name: `Reference: ${result.title}`,
              entityType: 'WebReference',
              significance: this.calculateReferenceSignificance(result),
              observations: [
                `Title: ${result.title}`,
                `URL: ${result.url}`,
                `Snippet: ${result.snippet}`,
                `Categories: ${result.categories?.join(', ') || 'general'}`,
                `Relevance: ${result.relevanceScore}`
              ],
              metadata: {
                source: 'web-search',
                url: result.url,
                query: searchResult.query,
                categories: result.categories || [],
                relevanceScore: result.relevanceScore
              }
            });
          }
        }
      }
      
      return entities;
      
    } catch (error) {
      this.logger.error('Failed to extract references from search:', error);
      return [];
    }
  }

  extractEntitiesFromPatterns(patterns) {
    const entities = [];
    
    try {
      if (patterns.details) {
        for (const pattern of patterns.details) {
          if (this.isSignificantPattern(pattern)) {
            entities.push({
              name: `Pattern: ${pattern.type || pattern}`,
              entityType: 'AnalysisPattern',
              significance: this.calculatePatternSignificance(pattern),
              observations: [
                `Pattern type: ${pattern.type || pattern}`,
                `Context: ${pattern.context || 'analysis'}`,
                `Example: ${pattern.example || 'N/A'}`
              ],
              metadata: {
                source: 'pattern-analysis',
                pattern: pattern
              }
            });
          }
        }
      }
    } catch (error) {
      this.logger.debug('Error extracting pattern entities:', error.message);
    }
    
    return entities;
  }

  async extractInsights(analysisData, context = {}) {
    try {
      this.logger.debug('Extracting insights from analysis data');
      
      const insights = [];
      
      // Extract insights based on analysis structure
      if (typeof analysisData === 'object') {
        // Look for structured insights
        if (analysisData.insights) {
          insights.push(...analysisData.insights);
        }
        
        // Extract patterns as insights
        if (analysisData.patterns) {
          const patternInsights = this.convertPatternsToInsights(analysisData.patterns);
          insights.push(...patternInsights);
        }
        
        // Extract from analysis text
        if (analysisData.analysis) {
          const textInsights = this.extractInsightsFromText(analysisData.analysis);
          insights.push(...textInsights);
        }
      } else if (typeof analysisData === 'string') {
        // Extract from plain text
        const textInsights = this.extractInsightsFromText(analysisData);
        insights.push(...textInsights);
      }
      
      // Filter by significance
      return insights.filter(insight => 
        (insight.significance || 5) >= this.config.significanceThreshold
      );
      
    } catch (error) {
      this.logger.error('Failed to extract insights:', error);
      return [];
    }
  }

  convertPatternsToInsights(patterns) {
    const insights = [];
    
    const patternArray = patterns.details || patterns;
    if (Array.isArray(patternArray)) {
      for (const pattern of patternArray) {
        insights.push({
          type: 'pattern',
          title: `${pattern.type || 'Pattern'} Implementation`,
          description: pattern.explanation || pattern.context || 'Pattern detected in analysis',
          significance: this.calculatePatternSignificance(pattern),
          applicability: 'General software development',
          technologies: this.extractTechnologiesFromPattern(pattern),
          references: []
        });
      }
    }
    
    return insights;
  }

  extractInsightsFromText(text) {
    const insights = [];
    
    // Look for key insight patterns in text
    const insightPatterns = [
      /(?:key insight|important|significant|notable):\s*([^.!?]+)/gi,
      /(?:recommendation|suggestion):\s*([^.!?]+)/gi,
      /(?:pattern|approach|solution):\s*([^.!?]+)/gi
    ];
    
    for (const pattern of insightPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        insights.push({
          type: 'extracted',
          title: 'Text Insight',
          description: match[1].trim(),
          significance: 6,
          applicability: 'Context-specific',
          technologies: [],
          references: []
        });
      }
    }
    
    return insights;
  }

  normalizeEntityName(name) {
    return name.trim().replace(/\s+/g, ' ');
  }

  normalizeEntityType(type) {
    // Capitalize first letter and remove special characters
    return type.replace(/[^a-zA-Z0-9]/g, '').replace(/^./, str => str.toUpperCase());
  }

  validateSignificance(significance) {
    const num = Number(significance);
    if (isNaN(num) || num < 1 || num > 10) {
      return 5; // Default significance
    }
    return Math.round(num);
  }

  processObservations(observations) {
    return observations
      .filter(obs => obs && obs.trim().length > 0)
      .map(obs => obs.trim())
      .slice(0, 10); // Limit observations
  }

  processMetadata(metadata) {
    return {
      created: new Date().toISOString(),
      ...metadata,
      processed: true
    };
  }

  extractKeywords(entity) {
    const text = `${entity.name} ${entity.observations.join(' ')}`.toLowerCase();
    const keywords = new Set();
    
    // Extract meaningful words (3+ characters, not common words)
    const words = text.match(/\b\w{3,}\b/g) || [];
    const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use']);
    
    for (const word of words) {
      if (!stopWords.has(word) && word.length >= 3) {
        keywords.add(word);
      }
    }
    
    return Array.from(keywords).slice(0, 10);
  }

  categorizeEntity(entity) {
    const categories = [];
    const content = `${entity.name} ${entity.observations.join(' ')}`.toLowerCase();
    
    // Technology categories
    if (content.match(/javascript|typescript|node|react|vue|angular/)) {
      categories.push('frontend', 'javascript');
    }
    if (content.match(/python|django|flask|fastapi/)) {
      categories.push('backend', 'python');
    }
    if (content.match(/docker|kubernetes|aws|azure|gcp/)) {
      categories.push('infrastructure', 'cloud');
    }
    if (content.match(/database|sql|mongodb|redis|postgresql/)) {
      categories.push('database', 'storage');
    }
    
    // Pattern categories
    if (content.match(/pattern|design|architecture/)) {
      categories.push('architecture', 'patterns');
    }
    if (content.match(/test|testing|unit|integration/)) {
      categories.push('testing', 'quality');
    }
    if (content.match(/security|auth|authentication|authorization/)) {
      categories.push('security');
    }
    
    return categories.length > 0 ? categories : ['general'];
  }

  extractRelatedTopics(entity) {
    const topics = new Set();
    const content = `${entity.name} ${entity.observations.join(' ')}`;
    
    // Extract technology mentions
    const techRegex = /\b(react|vue|angular|node\.?js|python|java|docker|kubernetes|aws|azure|mongodb|postgresql|redis|graphql|rest|api)\b/gi;
    const matches = content.matchAll(techRegex);
    
    for (const match of matches) {
      topics.add(match[1].toLowerCase());
    }
    
    return Array.from(topics);
  }

  deduplicateEntities(entities) {
    const seen = new Map();
    const deduplicated = [];
    
    for (const entity of entities) {
      const key = `${entity.name}:${entity.entityType}`;
      
      if (!seen.has(key)) {
        seen.set(key, entity);
        deduplicated.push(entity);
      } else {
        // Merge with existing entity
        const existing = seen.get(key);
        existing.significance = Math.max(existing.significance, entity.significance);
        existing.observations = [...new Set([...existing.observations, ...entity.observations])];
        Object.assign(existing.metadata, entity.metadata);
      }
    }
    
    return deduplicated;
  }

  isSignificantPattern(pattern) {
    if (typeof pattern === 'string') return true;
    if (pattern.significance && pattern.significance >= this.config.significanceThreshold) return true;
    if (pattern.type && ['architectural', 'security', 'performance'].includes(pattern.type)) return true;
    return false;
  }

  calculatePatternSignificance(pattern) {
    if (pattern.significance) return pattern.significance;
    
    // Calculate based on pattern type
    const typeSignificance = {
      'architectural': 8,
      'security': 9,
      'performance': 7,
      'refactoring': 6,
      'testing': 6,
      'documentation': 5
    };
    
    return typeSignificance[pattern.type] || 6;
  }

  calculateReferenceSignificance(searchResult) {
    let significance = 5;
    
    // Boost for high relevance
    if (searchResult.relevanceScore >= 0.9) significance += 2;
    else if (searchResult.relevanceScore >= 0.8) significance += 1;
    
    // Boost for documentation/official sources
    if (searchResult.categories?.includes('documentation')) significance += 1;
    if (searchResult.url?.includes('docs.') || searchResult.url?.includes('developer.')) significance += 1;
    
    // Boost for certain sources
    if (searchResult.source === 'github' || searchResult.url?.includes('github.com')) significance += 1;
    
    return Math.min(10, significance);
  }

  extractConversationTitle(conversationResult) {
    const path = conversationResult.conversationPath || '';
    const filename = path.split('/').pop() || 'conversation';
    return filename.replace(/\.[^/.]+$/, ''); // Remove extension
  }

  extractTechnologiesFromPattern(pattern) {
    const technologies = [];
    const content = JSON.stringify(pattern).toLowerCase();
    
    const techPatterns = ['javascript', 'typescript', 'react', 'vue', 'angular', 'node.js', 'python', 'java', 'docker', 'kubernetes'];
    
    for (const tech of techPatterns) {
      if (content.includes(tech)) {
        technologies.push(tech);
      }
    }
    
    return technologies;
  }
}