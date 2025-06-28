/**
 * Result Processor
 * Processes and filters web search results for relevance and quality
 */

import { Logger } from '../../../shared/logger.js';

export class ResultProcessor {
  constructor(config = {}) {
    this.config = {
      maxResults: config.maxResults || 10,
      minRelevanceScore: config.minRelevanceScore || 0.3,
      contentExtraction: config.contentExtraction || false,
      duplicateDetection: config.duplicateDetection !== false,
      qualityFiltering: config.qualityFiltering !== false,
      ...config
    };
    
    this.logger = new Logger('result-processor');
  }

  async processResults(rawResults, searchContext = {}) {
    try {
      this.logger.debug(`Processing ${rawResults.length} search results`);
      
      let results = [...rawResults];
      
      // Step 1: Remove duplicates
      if (this.config.duplicateDetection) {
        results = this.removeDuplicates(results);
        this.logger.debug(`After duplicate removal: ${results.length} results`);
      }
      
      // Step 2: Filter by quality
      if (this.config.qualityFiltering) {
        results = this.filterByQuality(results);
        this.logger.debug(`After quality filtering: ${results.length} results`);
      }
      
      // Step 3: Score relevance
      results = this.scoreRelevance(results, searchContext);
      
      // Step 4: Filter by minimum relevance score
      results = results.filter(r => r.relevanceScore >= this.config.minRelevanceScore);
      this.logger.debug(`After relevance filtering: ${results.length} results`);
      
      // Step 5: Sort by relevance
      results.sort((a, b) => b.relevanceScore - a.relevanceScore);
      
      // Step 6: Limit results
      results = results.slice(0, this.config.maxResults);
      
      // Step 7: Extract additional content if enabled
      if (this.config.contentExtraction) {
        results = await this.extractContent(results);
      }
      
      // Step 8: Categorize results
      results = this.categorizeResults(results, searchContext);
      
      this.logger.debug(`Final processed results: ${results.length}`);
      return results;
      
    } catch (error) {
      this.logger.error('Result processing failed:', error);
      throw error;
    }
  }

  removeDuplicates(results) {
    const seen = new Set();
    const uniqueResults = [];
    
    for (const result of results) {
      // Create a fingerprint based on URL and title
      const fingerprint = this.createFingerprint(result);
      
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        uniqueResults.push(result);
      }
    }
    
    return uniqueResults;
  }

  createFingerprint(result) {
    const normalizedUrl = this.normalizeUrl(result.url);
    const normalizedTitle = this.normalizeText(result.title);
    return `${normalizedUrl}|${normalizedTitle}`;
  }

  normalizeUrl(url) {
    if (!url) return '';
    
    try {
      const urlObj = new URL(url);
      // Remove common tracking parameters
      const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source'];
      paramsToRemove.forEach(param => urlObj.searchParams.delete(param));
      
      return urlObj.toString().toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  normalizeText(text) {
    if (!text) return '';
    
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  filterByQuality(results) {
    return results.filter(result => {
      // Filter out low-quality results
      if (!result.title || result.title.length < 10) return false;
      if (!result.url || !this.isValidUrl(result.url)) return false;
      if (result.snippet && result.snippet.length < 20) return false;
      
      // Filter out spam domains
      if (this.isSpamDomain(result.url)) return false;
      
      // Filter out non-technical content for technical searches
      if (this.isNonTechnicalContent(result)) return false;
      
      return true;
    });
  }

  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  isSpamDomain(url) {
    const spamDomains = [
      'spam-site.com',
      'clickbait.net',
      'ad-heavy.org'
      // Add more as needed
    ];
    
    try {
      const domain = new URL(url).hostname.toLowerCase();
      return spamDomains.some(spam => domain.includes(spam));
    } catch {
      return false;
    }
  }

  isNonTechnicalContent(result) {
    const nonTechKeywords = [
      'celebrity', 'gossip', 'entertainment', 'sports',
      'fashion', 'cooking', 'recipes', 'travel'
    ];
    
    const content = `${result.title} ${result.snippet}`.toLowerCase();
    return nonTechKeywords.some(keyword => content.includes(keyword));
  }

  scoreRelevance(results, searchContext) {
    const { query = '', resultType = 'general' } = searchContext;
    const queryTerms = this.extractQueryTerms(query);
    
    return results.map(result => {
      let score = result.relevance || 0.5; // Base score from search provider
      
      // Title relevance
      score += this.calculateTermRelevance(result.title, queryTerms) * 0.3;
      
      // Snippet relevance
      score += this.calculateTermRelevance(result.snippet, queryTerms) * 0.2;
      
      // URL relevance
      score += this.calculateUrlRelevance(result.url, queryTerms) * 0.1;
      
      // Source quality bonus
      score += this.calculateSourceQuality(result.url) * 0.2;
      
      // Result type bonus
      score += this.calculateTypeRelevance(result, resultType) * 0.2;
      
      // Ensure score is between 0 and 1
      score = Math.max(0, Math.min(1, score));
      
      return {
        ...result,
        relevanceScore: score
      };
    });
  }

  extractQueryTerms(query) {
    return query
      .toLowerCase()
      .split(/[\s\-_]+/)
      .filter(term => term.length > 2)
      .filter(term => !this.isStopWord(term));
  }

  isStopWord(word) {
    const stopWords = [
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'how', 'what', 'when', 'where', 'why'
    ];
    return stopWords.includes(word);
  }

  calculateTermRelevance(text, queryTerms) {
    if (!text || queryTerms.length === 0) return 0;
    
    const normalizedText = text.toLowerCase();
    let matchCount = 0;
    
    for (const term of queryTerms) {
      if (normalizedText.includes(term)) {
        matchCount++;
      }
    }
    
    return matchCount / queryTerms.length;
  }

  calculateUrlRelevance(url, queryTerms) {
    if (!url) return 0;
    
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      
      return this.calculateTermRelevance(pathname, queryTerms) * 0.5;
    } catch {
      return 0;
    }
  }

  calculateSourceQuality(url) {
    if (!url) return 0;
    
    try {
      const domain = new URL(url).hostname.toLowerCase();
      
      // High-quality technical domains
      const highQualityDomains = [
        'github.com', 'stackoverflow.com', 'docs.', 'developer.',
        'api.', 'guide.', 'tutorial.', 'mozilla.org', 'w3.org',
        'medium.com', 'dev.to', 'hashnode.com'
      ];
      
      for (const quality of highQualityDomains) {
        if (domain.includes(quality)) {
          return 0.3;
        }
      }
      
      // Medium quality domains
      const mediumQualityDomains = [
        'wikipedia.org', 'reddit.com', 'quora.com'
      ];
      
      for (const medium of mediumQualityDomains) {
        if (domain.includes(medium)) {
          return 0.1;
        }
      }
      
      return 0;
    } catch {
      return 0;
    }
  }

  calculateTypeRelevance(result, resultType) {
    switch (resultType) {
      case 'documentation':
        return this.isDocumentation(result) ? 0.3 : 0;
      case 'api-reference':
        return this.isApiReference(result) ? 0.3 : 0;
      case 'best-practices':
        return this.isBestPractices(result) ? 0.3 : 0;
      case 'comparison':
        return this.isComparison(result) ? 0.3 : 0;
      default:
        return 0;
    }
  }

  isDocumentation(result) {
    const indicators = ['documentation', 'docs', 'guide', 'manual', 'reference'];
    const content = `${result.title} ${result.url} ${result.snippet}`.toLowerCase();
    return indicators.some(indicator => content.includes(indicator));
  }

  isApiReference(result) {
    const indicators = ['api', 'reference', 'endpoint', 'method', 'parameter'];
    const content = `${result.title} ${result.url} ${result.snippet}`.toLowerCase();
    return indicators.some(indicator => content.includes(indicator));
  }

  isBestPractices(result) {
    const indicators = ['best practice', 'pattern', 'guideline', 'convention', 'standard'];
    const content = `${result.title} ${result.snippet}`.toLowerCase();
    return indicators.some(indicator => content.includes(indicator));
  }

  isComparison(result) {
    const indicators = ['vs', 'versus', 'comparison', 'compare', 'difference', 'pros', 'cons'];
    const content = `${result.title} ${result.snippet}`.toLowerCase();
    return indicators.some(indicator => content.includes(indicator));
  }

  async extractContent(results) {
    // This is a placeholder for content extraction
    // In a real implementation, you might fetch and parse the actual web pages
    this.logger.debug('Content extraction requested but not implemented');
    return results;
  }

  categorizeResults(results, searchContext) {
    return results.map(result => {
      const categories = [];
      
      if (this.isDocumentation(result)) categories.push('documentation');
      if (this.isApiReference(result)) categories.push('api-reference');
      if (this.isBestPractices(result)) categories.push('best-practices');
      if (this.isComparison(result)) categories.push('comparison');
      if (this.isTutorial(result)) categories.push('tutorial');
      if (this.isNews(result)) categories.push('news');
      
      return {
        ...result,
        categories: categories.length > 0 ? categories : ['general']
      };
    });
  }

  isTutorial(result) {
    const indicators = ['tutorial', 'how to', 'step by step', 'walkthrough', 'example'];
    const content = `${result.title} ${result.snippet}`.toLowerCase();
    return indicators.some(indicator => content.includes(indicator));
  }

  isNews(result) {
    const indicators = ['news', 'announcement', 'release', 'update', 'blog'];
    const content = `${result.title} ${result.url}`.toLowerCase();
    return indicators.some(indicator => content.includes(indicator));
  }

  getProcessingStats(originalCount, finalCount) {
    return {
      originalResults: originalCount,
      processedResults: finalCount,
      filteringEfficiency: finalCount / originalCount,
      timestamp: new Date().toISOString()
    };
  }
}