/**
 * Web Search Agent
 * Provides web search capabilities with intelligent result processing
 */

import { BaseAgent } from '../../framework/base-agent.js';
import { WebSearchProvider } from './providers/search-provider.js';
import { ResultProcessor } from './processors/result-processor.js';
import { EventTypes } from '../../infrastructure/events/event-types.js';
import { Logger } from '../../shared/logger.js';

export class WebSearchAgent extends BaseAgent {
  constructor(config) {
    super({
      id: 'web-search',
      ...config
    });
    
    this.searchProvider = null;
    this.resultProcessor = null;
    this.searchCache = new Map();
    this.maxCacheAge = config.maxCacheAge || 3600000; // 1 hour
  }

  async onInitialize() {
    this.logger.info('Initializing Web Search Agent...');
    
    // Initialize search provider
    this.searchProvider = new WebSearchProvider(this.config.search);
    
    // Initialize result processor
    this.resultProcessor = new ResultProcessor(this.config.processing);
    
    // Register request handlers
    this.registerRequestHandlers();
    
    // Subscribe to events
    await this.subscribeToEvents();
    
    this.logger.info('Web Search Agent initialized successfully');
  }

  registerRequestHandlers() {
    // Web search requests
    this.registerRequestHandler(EventTypes.WEB_SEARCH_REQUESTED, 
      this.handleWebSearchRequest.bind(this));
    
    // Technical documentation search
    this.registerRequestHandler('web-search/technical-docs',
      this.handleTechnicalDocsSearch.bind(this));
    
    // API reference search
    this.registerRequestHandler('web-search/api-reference',
      this.handleApiReferenceSearch.bind(this));
    
    // Best practices search
    this.registerRequestHandler('web-search/best-practices',
      this.handleBestPracticesSearch.bind(this));
    
    // Technology comparison search
    this.registerRequestHandler('web-search/tech-comparison',
      this.handleTechComparisonSearch.bind(this));
  }

  async subscribeToEvents() {
    // Subscribe to semantic analysis completion for follow-up searches
    await this.subscribe(EventTypes.CODE_ANALYSIS_COMPLETED, 
      this.handleCodeAnalysisCompleted.bind(this));
    
    // Subscribe to general search requests
    await this.subscribe('search/#', (data, topic) => {
      this.logger.debug(`Received search event: ${topic}`);
    });
  }

  async handleWebSearchRequest(data) {
    try {
      this.logger.info('Processing web search request:', data);
      
      const { query, options = {}, requestId } = data;
      
      if (!query) {
        throw new Error('Search query is required');
      }

      // Check cache first
      const cacheKey = this.buildCacheKey(query, options);
      const cached = this.getCachedResult(cacheKey);
      
      if (cached) {
        this.logger.debug('Returning cached search result');
        return cached;
      }

      const startTime = Date.now();
      
      // Publish progress event
      await this.publish(EventTypes.SEARCH_PROGRESS, {
        requestId,
        status: 'searching',
        message: 'Performing web search...'
      });

      // Perform search
      const searchResults = await this.searchProvider.search(query, options);
      
      // Process results
      const processedResults = await this.resultProcessor.processResults(
        searchResults, 
        { query, ...options }
      );

      const duration = Date.now() - startTime;
      
      const result = {
        query,
        results: processedResults,
        metadata: {
          totalResults: searchResults.length,
          processedResults: processedResults.length,
          duration,
          timestamp: new Date().toISOString()
        }
      };

      // Cache the result
      this.setCachedResult(cacheKey, result);
      
      // Publish completion event
      await this.publish(EventTypes.WEB_SEARCH_COMPLETED, {
        requestId,
        result,
        status: 'completed'
      });

      this.logger.info(`Web search completed in ${duration}ms`);
      return result;
      
    } catch (error) {
      this.logger.error('Web search failed:', error);
      
      await this.publish(EventTypes.SEARCH_FAILED, {
        requestId: data.requestId,
        error: error.message,
        status: 'failed'
      });
      
      throw error;
    }
  }

  async handleTechnicalDocsSearch(data) {
    const { technology, topic, requestId } = data;
    
    const query = `${technology} ${topic} documentation official guide`;
    const options = {
      domains: ['docs.', 'developer.', 'guide.', 'api.'],
      resultType: 'documentation',
      maxResults: 5
    };

    return await this.handleWebSearchRequest({
      query,
      options,
      requestId
    });
  }

  async handleApiReferenceSearch(data) {
    const { api, method, language, requestId } = data;
    
    const query = `${api} ${method} ${language} API reference documentation`;
    const options = {
      domains: ['docs.', 'api.', 'developer.'],
      resultType: 'api-reference',
      maxResults: 3
    };

    return await this.handleWebSearchRequest({
      query,
      options,
      requestId
    });
  }

  async handleBestPracticesSearch(data) {
    const { technology, category, requestId } = data;
    
    const query = `${technology} ${category} best practices patterns guidelines`;
    const options = {
      domains: ['github.com', 'stackoverflow.com', 'medium.com', 'dev.to'],
      resultType: 'best-practices',
      maxResults: 8
    };

    return await this.handleWebSearchRequest({
      query,
      options,
      requestId
    });
  }

  async handleTechComparisonSearch(data) {
    const { technologies, criteria, requestId } = data;
    
    const techList = Array.isArray(technologies) ? technologies.join(' vs ') : technologies;
    const query = `${techList} comparison ${criteria} pros cons differences`;
    const options = {
      resultType: 'comparison',
      maxResults: 6
    };

    return await this.handleWebSearchRequest({
      query,
      options,
      requestId
    });
  }

  async handleCodeAnalysisCompleted(data) {
    try {
      const { result } = data;
      
      // Extract technologies and patterns from analysis
      const technologies = this.extractTechnologies(result);
      const patterns = this.extractPatterns(result);
      
      // Perform automatic follow-up searches for related information
      if (technologies.length > 0) {
        for (const tech of technologies.slice(0, 2)) { // Limit to 2 to avoid spam
          await this.performFollowUpSearch(tech, patterns);
        }
      }
      
    } catch (error) {
      this.logger.warn('Failed to perform follow-up searches:', error.message);
    }
  }

  async performFollowUpSearch(technology, patterns) {
    try {
      // Search for best practices related to detected patterns
      if (patterns.length > 0) {
        const pattern = patterns[0];
        await this.handleBestPracticesSearch({
          technology,
          category: pattern,
          requestId: `auto-${Date.now()}`
        });
      }
      
    } catch (error) {
      this.logger.debug(`Follow-up search failed for ${technology}:`, error.message);
    }
  }

  extractTechnologies(analysisResult) {
    const technologies = new Set();
    
    // Extract from analysis text
    const content = JSON.stringify(analysisResult).toLowerCase();
    
    // Common technology patterns
    const techPatterns = [
      'react', 'vue', 'angular', 'svelte',
      'node.js', 'express', 'fastify', 'koa',
      'python', 'django', 'flask', 'fastapi',
      'javascript', 'typescript', 'java', 'kotlin',
      'docker', 'kubernetes', 'aws', 'azure', 'gcp',
      'mongodb', 'postgresql', 'mysql', 'redis',
      'graphql', 'rest', 'grpc'
    ];
    
    for (const tech of techPatterns) {
      if (content.includes(tech)) {
        technologies.add(tech);
      }
    }
    
    return Array.from(technologies);
  }

  extractPatterns(analysisResult) {
    const patterns = [];
    
    if (analysisResult.patterns) {
      patterns.push(...analysisResult.patterns.map(p => p.type || p));
    }
    
    return patterns;
  }

  buildCacheKey(query, options) {
    const optionsStr = JSON.stringify(options, Object.keys(options).sort());
    return `${query}:${optionsStr}`;
  }

  getCachedResult(key) {
    const cached = this.searchCache.get(key);
    
    if (cached && Date.now() - cached.timestamp < this.maxCacheAge) {
      return cached.result;
    }
    
    if (cached) {
      this.searchCache.delete(key);
    }
    
    return null;
  }

  setCachedResult(key, result) {
    this.searchCache.set(key, {
      result,
      timestamp: Date.now()
    });
    
    // Clean old cache entries periodically
    if (this.searchCache.size > 100) {
      this.cleanCache();
    }
  }

  cleanCache() {
    const now = Date.now();
    
    for (const [key, cached] of this.searchCache.entries()) {
      if (now - cached.timestamp > this.maxCacheAge) {
        this.searchCache.delete(key);
      }
    }
  }

  getCapabilities() {
    return [
      'web-search',
      'technical-documentation-search',
      'api-reference-search',
      'best-practices-search',
      'technology-comparison',
      'automatic-follow-up-search'
    ];
  }

  getMetadata() {
    return {
      searchProvider: this.searchProvider?.getInfo(),
      cacheSize: this.searchCache.size,
      maxCacheAge: this.maxCacheAge,
      config: this.config
    };
  }

  async onStop() {
    // Clear cache
    this.searchCache.clear();
    
    this.logger.info('Web Search Agent stopped');
  }
}