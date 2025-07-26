import { log } from "../logging.js";

export interface SearchOptions {
  maxResults?: number;
  providers?: string[];
  timeout?: number;
  contentExtraction?: {
    maxContentLength?: number;
    extractCode?: boolean;
    extractLinks?: boolean;
  };
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  codeBlocks?: string[];
  links?: string[];
  relevanceScore: number;
}

export interface SearchResponse {
  query: string;
  provider: string;
  results: SearchResult[];
  totalResults: number;
  searchTime: number;
}

export class WebSearchAgent {
  private readonly defaultProviders = ["duckduckgo", "google"];
  private readonly defaultOptions: SearchOptions = {
    maxResults: 10,
    timeout: 30000,
    contentExtraction: {
      maxContentLength: 10000,
      extractCode: true,
      extractLinks: true,
    },
  };

  constructor() {
    log("WebSearchAgent initialized", "info");
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const searchOptions = { ...this.defaultOptions, ...options };
    const providers = searchOptions.providers || this.defaultProviders;

    log(`Searching for: "${query}"`, "info", {
      providers,
      maxResults: searchOptions.maxResults,
    });

    const startTime = Date.now();

    try {
      // Try providers in order
      for (const provider of providers) {
        try {
          const results = await this.searchWithProvider(query, provider, searchOptions);
          const searchTime = Date.now() - startTime;

          return {
            query,
            provider,
            results,
            totalResults: results.length,
            searchTime,
          };
        } catch (error) {
          log(`Search failed with provider ${provider}`, "warning", error);
          continue;
        }
      }

      throw new Error("All search providers failed");
    } catch (error) {
      log("Web search failed", "error", error);
      throw error;
    }
  }

  async searchForCode(query: string, language?: string): Promise<SearchResult[]> {
    const codeQuery = language 
      ? `${query} ${language} code example`
      : `${query} code example`;

    const response = await this.search(codeQuery, {
      maxResults: 5,
      contentExtraction: {
        extractCode: true,
        maxContentLength: 5000,
      },
    });

    // Filter results that contain code blocks
    return response.results.filter(result => 
      result.codeBlocks && result.codeBlocks.length > 0
    );
  }

  async searchForDocumentation(topic: string, technology?: string): Promise<SearchResult[]> {
    const docQuery = technology
      ? `${topic} ${technology} documentation tutorial`
      : `${topic} documentation tutorial`;

    const response = await this.search(docQuery, {
      maxResults: 8,
      contentExtraction: {
        extractLinks: true,
        maxContentLength: 8000,
      },
    });

    // Filter for documentation-like results
    return response.results.filter(result =>
      this.isDocumentationResult(result)
    );
  }

  private async searchWithProvider(
    query: string,
    provider: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    switch (provider) {
      case "duckduckgo":
        return await this.searchDuckDuckGo(query, options);
      case "google":
        return await this.searchGoogle(query, options);
      default:
        throw new Error(`Unsupported search provider: ${provider}`);
    }
  }

  private async searchDuckDuckGo(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // Simulated DuckDuckGo search
    // In a real implementation, this would call the DuckDuckGo API
    log("Searching with DuckDuckGo", "info");

    const mockResults: SearchResult[] = [
      {
        title: `${query} - Documentation`,
        url: `https://docs.example.com/${query.replace(/\s+/g, '-')}`,
        snippet: `Official documentation for ${query} with examples and API reference.`,
        content: this.generateMockContent(query, "documentation"),
        codeBlocks: this.generateMockCodeBlocks(query),
        links: [`https://github.com/example/${query}`, `https://api.example.com/${query}`],
        relevanceScore: 0.95,
      },
      {
        title: `${query} Tutorial - Complete Guide`,
        url: `https://tutorial.example.com/${query}`,
        snippet: `Learn ${query} with step-by-step examples and best practices.`,
        content: this.generateMockContent(query, "tutorial"),
        codeBlocks: this.generateMockCodeBlocks(query),
        relevanceScore: 0.88,
      },
    ];

    return mockResults.slice(0, options.maxResults || 10);
  }

  private async searchGoogle(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // Simulated Google search
    // In a real implementation, this would use Google Custom Search API
    log("Searching with Google", "info");

    const mockResults: SearchResult[] = [
      {
        title: `${query} - Stack Overflow`,
        url: `https://stackoverflow.com/questions/tagged/${query.replace(/\s+/g, '-')}`,
        snippet: `Questions and answers about ${query} from the developer community.`,
        content: this.generateMockContent(query, "stackoverflow"),
        codeBlocks: this.generateMockCodeBlocks(query),
        relevanceScore: 0.92,
      },
      {
        title: `GitHub - ${query} Examples`,
        url: `https://github.com/search?q=${encodeURIComponent(query)}`,
        snippet: `Open source projects and code examples for ${query}.`,
        content: this.generateMockContent(query, "github"),
        codeBlocks: this.generateMockCodeBlocks(query),
        links: [`https://github.com/trending?q=${query}`],
        relevanceScore: 0.85,
      },
    ];

    return mockResults.slice(0, options.maxResults || 10);
  }

  private generateMockContent(query: string, source: string): string {
    return `Mock content for ${query} from ${source}. This would contain the full extracted content from the webpage in a real implementation. The content would be processed to extract relevant information about ${query}.`;
  }

  private generateMockCodeBlocks(query: string): string[] {
    return [
      `// Example code for ${query}
function ${query.replace(/\s+/g, '')}() {
  console.log('Example implementation');
  return true;
}`,
      `/* 
 * ${query} usage example
 */
const result = ${query.replace(/\s+/g, '')}();`,
    ];
  }

  private isDocumentationResult(result: SearchResult): boolean {
    const docKeywords = ["documentation", "docs", "api", "reference", "guide", "tutorial"];
    const urlContainsDoc = docKeywords.some(keyword => 
      result.url.toLowerCase().includes(keyword)
    );
    const titleContainsDoc = docKeywords.some(keyword =>
      result.title.toLowerCase().includes(keyword)
    );

    return urlContainsDoc || titleContainsDoc || result.relevanceScore > 0.8;
  }

  async extractContent(url: string, options: SearchOptions = {}): Promise<string> {
    log(`Extracting content from: ${url}`, "info");

    // In a real implementation, this would fetch and parse the webpage
    const mockContent = `Extracted content from ${url}. This would contain the full text content of the webpage, processed and cleaned for analysis.`;

    const maxLength = options.contentExtraction?.maxContentLength || 10000;
    return mockContent.length > maxLength 
      ? mockContent.substring(0, maxLength) + "..."
      : mockContent;
  }

  async searchSimilarPatterns(pattern: string): Promise<SearchResult[]> {
    const patternQuery = `"${pattern}" design pattern implementation`;
    
    const response = await this.search(patternQuery, {
      maxResults: 6,
      contentExtraction: {
        extractCode: true,
        extractLinks: true,
      },
    });

    return response.results;
  }
}