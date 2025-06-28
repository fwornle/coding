/**
 * Web Search Provider
 * Handles actual web search operations using various search engines
 */

import fetch from 'node-fetch';
import { Logger } from '../../../shared/logger.js';

export class WebSearchProvider {
  constructor(config = {}) {
    this.config = {
      engine: config.engine || 'duckduckgo', // 'duckduckgo', 'bing', 'google'
      maxResults: config.maxResults || 10,
      userAgent: config.userAgent || 'Mozilla/5.0 (compatible; SemanticAnalysisBot/1.0)',
      timeout: config.timeout || 10000,
      ...config
    };
    
    this.logger = new Logger('web-search-provider');
    
    // Initialize search engine
    this.initializeSearchEngine();
  }

  initializeSearchEngine() {
    switch (this.config.engine) {
      case 'duckduckgo':
        this.searchFunction = this.searchDuckDuckGo.bind(this);
        break;
      case 'bing':
        this.searchFunction = this.searchBing.bind(this);
        break;
      case 'google':
        this.searchFunction = this.searchGoogle.bind(this);
        break;
      default:
        this.searchFunction = this.searchDuckDuckGo.bind(this);
        this.logger.warn(`Unknown search engine: ${this.config.engine}, falling back to DuckDuckGo`);
    }
  }

  async search(query, options = {}) {
    try {
      this.logger.debug(`Performing search: "${query}" with engine: ${this.config.engine}`);
      
      const searchOptions = {
        maxResults: options.maxResults || this.config.maxResults,
        domains: options.domains || [],
        resultType: options.resultType || 'general',
        ...options
      };

      // Add domain filtering to query if specified
      let enhancedQuery = query;
      if (searchOptions.domains.length > 0) {
        const domainFilter = searchOptions.domains.map(d => `site:${d}`).join(' OR ');
        enhancedQuery = `${query} (${domainFilter})`;
      }

      const results = await this.searchFunction(enhancedQuery, searchOptions);
      
      this.logger.debug(`Search completed: ${results.length} results found`);
      return results;
      
    } catch (error) {
      this.logger.error('Search failed:', error);
      throw new Error(`Web search failed: ${error.message}`);
    }
  }

  async searchDuckDuckGo(query, options) {
    try {
      // DuckDuckGo Instant Answer API
      const encodedQuery = encodeURIComponent(query);
      const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.config.userAgent
        },
        timeout: this.config.timeout
      });

      if (!response.ok) {
        throw new Error(`DuckDuckGo API error: ${response.status}`);
      }

      const data = await response.json();
      
      const results = [];
      
      // Extract instant answer
      if (data.AbstractText) {
        results.push({
          title: data.Heading || 'DuckDuckGo Instant Answer',
          url: data.AbstractURL || '',
          snippet: data.AbstractText,
          source: 'duckduckgo-instant',
          relevance: 0.9
        });
      }

      // Extract related topics
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, options.maxResults - results.length)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(' - ')[0] || 'Related Topic',
              url: topic.FirstURL,
              snippet: topic.Text,
              source: 'duckduckgo-related',
              relevance: 0.7
            });
          }
        }
      }

      // If no results from API, try HTML scraping (fallback)
      if (results.length === 0) {
        return await this.searchDuckDuckGoHtml(query, options);
      }

      return results;
      
    } catch (error) {
      this.logger.warn('DuckDuckGo API search failed, trying HTML fallback:', error.message);
      return await this.searchDuckDuckGoHtml(query, options);
    }
  }

  async searchDuckDuckGoHtml(query, options) {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.config.userAgent
        },
        timeout: this.config.timeout
      });

      if (!response.ok) {
        throw new Error(`DuckDuckGo HTML error: ${response.status}`);
      }

      const html = await response.text();
      
      // Basic HTML parsing (simplified)
      const results = [];
      const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      
      let match;
      let count = 0;
      
      while ((match = resultRegex.exec(html)) !== null && count < options.maxResults) {
        const [, url, title, snippet] = match;
        
        results.push({
          title: this.cleanHtml(title),
          url: this.cleanUrl(url),
          snippet: this.cleanHtml(snippet),
          source: 'duckduckgo-html',
          relevance: 0.8 - (count * 0.1)
        });
        
        count++;
      }

      return results;
      
    } catch (error) {
      this.logger.error('DuckDuckGo HTML search failed:', error);
      return [];
    }
  }

  async searchBing(query, options) {
    // Bing requires API key - return fallback implementation
    this.logger.warn('Bing search requires API key configuration');
    
    if (!process.env.BING_SEARCH_API_KEY && !this.config.bingApiKey) {
      return await this.searchDuckDuckGo(query, options);
    }

    try {
      const apiKey = process.env.BING_SEARCH_API_KEY || this.config.bingApiKey;
      const encodedQuery = encodeURIComponent(query);
      const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodedQuery}&count=${options.maxResults}`;
      
      const response = await fetch(url, {
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'User-Agent': this.config.userAgent
        },
        timeout: this.config.timeout
      });

      if (!response.ok) {
        throw new Error(`Bing API error: ${response.status}`);
      }

      const data = await response.json();
      
      const results = [];
      
      if (data.webPages && data.webPages.value) {
        for (const result of data.webPages.value) {
          results.push({
            title: result.name,
            url: result.url,
            snippet: result.snippet || '',
            source: 'bing',
            relevance: 0.8
          });
        }
      }

      return results;
      
    } catch (error) {
      this.logger.error('Bing search failed:', error);
      return await this.searchDuckDuckGo(query, options);
    }
  }

  async searchGoogle(query, options) {
    // Google requires Custom Search API - return fallback implementation
    this.logger.warn('Google search requires Custom Search API configuration');
    
    if (!process.env.GOOGLE_SEARCH_API_KEY && !this.config.googleApiKey) {
      return await this.searchDuckDuckGo(query, options);
    }

    try {
      const apiKey = process.env.GOOGLE_SEARCH_API_KEY || this.config.googleApiKey;
      const cxId = process.env.GOOGLE_SEARCH_CX_ID || this.config.googleCxId;
      
      if (!cxId) {
        throw new Error('Google Custom Search CX ID is required');
      }

      const encodedQuery = encodeURIComponent(query);
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cxId}&q=${encodedQuery}&num=${options.maxResults}`;
      
      const response = await fetch(url, {
        timeout: this.config.timeout
      });

      if (!response.ok) {
        throw new Error(`Google API error: ${response.status}`);
      }

      const data = await response.json();
      
      const results = [];
      
      if (data.items) {
        for (const result of data.items) {
          results.push({
            title: result.title,
            url: result.link,
            snippet: result.snippet || '',
            source: 'google',
            relevance: 0.9
          });
        }
      }

      return results;
      
    } catch (error) {
      this.logger.error('Google search failed:', error);
      return await this.searchDuckDuckGo(query, options);
    }
  }

  cleanHtml(html) {
    if (!html) return '';
    
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  cleanUrl(url) {
    if (!url) return '';
    
    // Handle DuckDuckGo redirect URLs
    if (url.startsWith('/l/?')) {
      const match = url.match(/uddg=([^&]*)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
    }
    
    return url;
  }

  getInfo() {
    return {
      engine: this.config.engine,
      maxResults: this.config.maxResults,
      capabilities: this.getCapabilities()
    };
  }

  getCapabilities() {
    return [
      'web-search',
      'domain-filtering',
      'result-caching',
      'multiple-engines'
    ];
  }
}