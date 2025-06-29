#!/usr/bin/env node
/**
 * MCP Semantic Analysis Integration
 * 
 * Provides semantic analysis capabilities for the insight orchestrator:
 * - Conversation analysis using MCP memory and analysis tools
 * - Repository analysis using git history and code analysis
 * - Web search integration for technology research
 * - Knowledge base integration for storing results
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MCPSemanticAnalysis {
  constructor(options = {}) {
    this.config = {
      mcpMemoryEnabled: true,
      webSearchEnabled: true,
      ...options
    };
    
    this.logger = this.createLogger();
  }
  
  createLogger() {
    return {
      info: (msg) => console.log(`[${new Date().toISOString()}] MCP-SA INFO: ${msg}`),
      warn: (msg) => console.log(`[${new Date().toISOString()}] MCP-SA WARN: ${msg}`),
      error: (msg) => console.error(`[${new Date().toISOString()}] MCP-SA ERROR: ${msg}`),
      debug: (msg) => {
        if (process.env.DEBUG) {
          console.log(`[${new Date().toISOString()}] MCP-SA DEBUG: ${msg}`);
        }
      }
    };
  }
  
  /**
   * Analyze conversation content using MCP memory tools
   */
  async analyzeConversation(content, options = {}) {
    this.logger.info('Analyzing conversation content...');
    
    try {
      // First, try to use MCP memory search to find related patterns
      const relatedKnowledge = await this.searchRelatedKnowledge(content);
      
      // Extract key insights from the conversation
      const insights = this.extractConversationInsights(content);
      
      // Calculate significance based on content analysis
      const significance = this.calculateSignificance(content, insights);
      
      // Identify technologies and patterns
      const technologies = this.extractTechnologies(content);
      const patterns = this.extractArchitecturalPatterns(content);
      
      return {
        significance,
        topics: insights.topics,
        technologies,
        patterns,
        insights: insights.keyInsights,
        problems: insights.problems,
        solutions: insights.solutions,
        codeChanges: insights.codeChanges,
        relatedKnowledge
      };
    } catch (error) {
      this.logger.error(`Conversation analysis failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Search for related knowledge using MCP memory
   */
  async searchRelatedKnowledge(content) {
    if (!this.config.mcpMemoryEnabled) {
      return [];
    }
    
    try {
      // Extract key terms for search
      const searchTerms = this.extractSearchTerms(content);
      const relatedEntities = [];
      
      for (const term of searchTerms.slice(0, 5)) { // Limit searches
        try {
          const searchResult = await this.callMCPMemoryTool('search_nodes', { query: term });
          if (searchResult && searchResult.results) {
            relatedEntities.push(...searchResult.results);
          }
        } catch (searchError) {
          this.logger.debug(`Search for "${term}" failed: ${searchError.message}`);
        }
      }
      
      return relatedEntities;
    } catch (error) {
      this.logger.warn(`Related knowledge search failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Extract search terms from content
   */
  extractSearchTerms(content) {
    const terms = new Set();
    
    // Extract technology names
    const techRegex = /\\b(React|Node\\.js|TypeScript|JavaScript|Python|Redux|Express|Three\\.js|MCP)\\b/gi;
    const techMatches = content.match(techRegex) || [];
    techMatches.forEach(term => terms.add(term.toLowerCase()));
    
    // Extract pattern-related terms
    const patternRegex = /\\b(pattern|architecture|component|hook|service|handler|manager)\\b/gi;
    const patternMatches = content.match(patternRegex) || [];
    patternMatches.forEach(term => terms.add(term.toLowerCase()));
    
    // Extract action words that indicate insights
    const actionRegex = /\\b(implement|create|build|develop|design|optimize|refactor)\\b/gi;
    const actionMatches = content.match(actionRegex) || [];
    actionMatches.forEach(term => terms.add(term.toLowerCase()));
    
    return Array.from(terms);
  }
  
  /**
   * Extract insights from conversation content
   */
  extractConversationInsights(content) {
    const lines = content.split('\\n');
    
    const insights = {
      topics: [],
      keyInsights: [],
      problems: [],
      solutions: [],
      codeChanges: []
    };
    
    // Extract code blocks
    const codeBlocks = content.match(/```[\\s\\S]*?```/g) || [];
    insights.codeChanges = codeBlocks.map(block => ({
      language: this.detectLanguage(block),
      snippet: block.substring(0, 300),
      size: block.length
    }));
    
    // Extract problem statements
    lines.forEach(line => {
      const lower = line.toLowerCase();
      if (lower.includes('problem') || lower.includes('issue') || lower.includes('error')) {
        insights.problems.push(line.trim());
      }
      if (lower.includes('solution') || lower.includes('fix') || lower.includes('resolve')) {
        insights.solutions.push(line.trim());
      }
      if (line.length > 100 && (lower.includes('learn') || lower.includes('discover') || lower.includes('insight'))) {
        insights.keyInsights.push(line.trim());
      }
    });
    
    // Extract topics using frequency analysis
    insights.topics = this.extractTopics(content);
    
    return insights;
  }
  
  /**
   * Extract topics from content using frequency analysis
   */
  extractTopics(content) {
    const words = content.toLowerCase()
      .replace(/[^a-z\\s]/g, ' ')
      .split(/\\s+/)
      .filter(word => word.length > 4)
      .filter(word => !this.isStopWord(word));
    
    const frequency = {};
    words.forEach(word => {
      frequency[word] = (frequency[word] || 0) + 1;
    });
    
    return Object.entries(frequency)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 8)
      .map(([word]) => word);
  }
  
  /**
   * Calculate significance based on multiple factors
   */
  calculateSignificance(content, insights) {
    let score = 5; // Base score
    
    // Length factor
    if (content.length > 10000) score += 2;
    else if (content.length > 5000) score += 1;
    
    // Code blocks factor
    if (insights.codeChanges.length > 3) score += 2;
    else if (insights.codeChanges.length > 1) score += 1;
    
    // Problem-solution pairs
    if (insights.problems.length > 0 && insights.solutions.length > 0) score += 2;
    
    // Technology diversity
    const technologies = this.extractTechnologies(content);
    if (technologies.length > 3) score += 1;
    
    // Pattern mentions
    const patterns = this.extractArchitecturalPatterns(content);
    if (patterns.length > 0) score += 1;
    
    // Insight density
    if (insights.keyInsights.length > 2) score += 1;
    
    return Math.min(score, 10);
  }
  
  /**
   * Extract technologies from content
   */
  extractTechnologies(content) {
    const technologies = new Set();
    const techPatterns = {
      'React': /\\bReact\\b/gi,
      'Node.js': /\\bNode\\.?js\\b/gi,
      'TypeScript': /\\bTypeScript\\b/gi,
      'JavaScript': /\\bJavaScript\\b/gi,
      'Python': /\\bPython\\b/gi,
      'Three.js': /\\bThree\\.?js\\b/gi,
      'Redux': /\\bRedux\\b/gi,
      'Express': /\\bExpress\\b/gi,
      'Vite': /\\bVite\\b/gi,
      'MCP': /\\bMCP\\b/gi,
      'Claude': /\\bClaude\\b/gi,
      'Docker': /\\bDocker\\b/gi,
      'Kubernetes': /\\bKubernetes\\b/gi,
      'PostgreSQL': /\\bPostgreSQL\\b/gi,
      'MongoDB': /\\bMongoDB\\b/gi
    };
    
    Object.entries(techPatterns).forEach(([tech, pattern]) => {
      if (pattern.test(content)) {
        technologies.add(tech);
      }
    });
    
    return Array.from(technologies);
  }
  
  /**
   * Extract architectural patterns from content
   */
  extractArchitecturalPatterns(content) {
    const patterns = new Set();
    const patternRegexes = {
      'MVC': /\\bMVC\\b/gi,
      'Repository Pattern': /\\bRepository\\s+Pattern\\b/gi,
      'Factory Pattern': /\\bFactory\\s+Pattern\\b/gi,
      'Observer Pattern': /\\bObserver\\s+Pattern\\b/gi,
      'Strategy Pattern': /\\bStrategy\\s+Pattern\\b/gi,
      'Component Pattern': /\\bComponent\\s+Pattern\\b/gi,
      'Hook Pattern': /\\bHook\\s+Pattern\\b/gi,
      'Redux Pattern': /\\bRedux\\s+Pattern\\b/gi,
      'MVI Architecture': /\\bMVI\\s+Architecture\\b/gi,
      'Microservices': /\\bMicroservices\\b/gi
    };
    
    Object.entries(patternRegexes).forEach(([pattern, regex]) => {
      if (regex.test(content)) {
        patterns.add(pattern);
      }
    });
    
    return Array.from(patterns);
  }
  
  /**
   * Detect programming language from code block
   */
  detectLanguage(codeBlock) {
    const firstLine = codeBlock.split('\\n')[0].toLowerCase();
    
    if (firstLine.includes('javascript') || firstLine.includes('js')) return 'javascript';
    if (firstLine.includes('typescript') || firstLine.includes('ts')) return 'typescript';
    if (firstLine.includes('python') || firstLine.includes('py')) return 'python';
    if (firstLine.includes('bash') || firstLine.includes('sh')) return 'bash';
    if (firstLine.includes('json')) return 'json';
    if (firstLine.includes('yaml') || firstLine.includes('yml')) return 'yaml';
    
    // Heuristic detection
    if (codeBlock.includes('import ') && codeBlock.includes('from ')) return 'javascript';
    if (codeBlock.includes('def ') && codeBlock.includes(':')) return 'python';
    if (codeBlock.includes('interface ') || codeBlock.includes(': string')) return 'typescript';
    if (codeBlock.includes('function ') || codeBlock.includes('=>')) return 'javascript';
    
    return 'text';
  }
  
  /**
   * Check if word is a stop word
   */
  isStopWord(word) {
    const stopWords = new Set([
      'this', 'that', 'with', 'have', 'will', 'from', 'they', 'been',
      'into', 'than', 'only', 'more', 'very', 'what', 'when', 'where',
      'would', 'could', 'should', 'there', 'their', 'which', 'about',
      'other', 'after', 'first', 'well', 'also', 'time', 'like', 'just'
    ]);
    return stopWords.has(word);
  }
  
  /**
   * Analyze repository changes
   */
  async analyzeRepository(options = {}) {
    this.logger.info('Analyzing repository changes...');
    
    try {
      const analysis = {
        commits: options.commits || [],
        files: options.files || [],
        insights: [],
        patterns: [],
        significance: 5
      };
      
      // Analyze file types and changes
      if (analysis.files.length > 0) {
        analysis.insights.push(`Modified ${analysis.files.length} files`);
        
        const languages = this.categorizeFiles(analysis.files);
        if (languages.length > 1) {
          analysis.insights.push(`Multi-language changes: ${languages.join(', ')}`);
          analysis.significance += 1;
        }
      }
      
      // Analyze commit messages for patterns
      if (analysis.commits.length > 0) {
        const commitPatterns = this.analyzeCommitMessages(analysis.commits);
        analysis.patterns.push(...commitPatterns);
        
        if (commitPatterns.length > 0) {
          analysis.significance += 1;
        }
      }
      
      return analysis;
    } catch (error) {
      this.logger.error(`Repository analysis failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Categorize files by language/type
   */
  categorizeFiles(files) {
    const categories = new Set();
    
    files.forEach(file => {
      const ext = path.extname(file).toLowerCase();
      switch (ext) {
        case '.js':
        case '.jsx':
          categories.add('JavaScript');
          break;
        case '.ts':
        case '.tsx':
          categories.add('TypeScript');
          break;
        case '.py':
          categories.add('Python');
          break;
        case '.json':
          categories.add('Configuration');
          break;
        case '.md':
          categories.add('Documentation');
          break;
        case '.css':
        case '.scss':
          categories.add('Styling');
          break;
        default:
          if (ext) categories.add('Other');
      }
    });
    
    return Array.from(categories);
  }
  
  /**
   * Analyze commit messages for patterns
   */
  analyzeCommitMessages(commits) {
    const patterns = new Set();
    
    commits.forEach(commit => {
      const message = commit.message || commit;
      const lower = message.toLowerCase();
      
      if (lower.includes('feat') || lower.includes('feature')) {
        patterns.add('Feature Development');
      }
      if (lower.includes('fix') || lower.includes('bug')) {
        patterns.add('Bug Fix');
      }
      if (lower.includes('refactor')) {
        patterns.add('Code Refactoring');
      }
      if (lower.includes('test')) {
        patterns.add('Testing');
      }
      if (lower.includes('doc')) {
        patterns.add('Documentation');
      }
      if (lower.includes('perf') || lower.includes('optimize')) {
        patterns.add('Performance Optimization');
      }
    });
    
    return Array.from(patterns);
  }
  
  /**
   * Perform web search for technology research
   */
  async performWebSearch(options = {}) {
    this.logger.info('Performing web research...');
    
    if (!this.config.webSearchEnabled) {
      return { results: [], insights: [] };
    }
    
    try {
      const queries = options.queries || [];
      const results = [];
      const insights = [];
      
      // Simulate web search results (would integrate with actual search API)
      for (const query of queries.slice(0, 3)) { // Limit queries
        const searchResults = await this.simulateWebSearch(query);
        results.push(...searchResults);
        
        // Extract insights from search results
        insights.push(`Research conducted on: ${query}`);
      }
      
      return { results, insights };
    } catch (error) {
      this.logger.error(`Web search failed: ${error.message}`);
      return { results: [], insights: [] };
    }
  }
  
  /**
   * Simulate web search (placeholder for actual implementation)
   */
  async simulateWebSearch(query) {
    // This would integrate with actual web search APIs
    // For now, return structured placeholder data
    return [
      {
        title: `${query} - Best Practices`,
        url: `https://example.com/${query.toLowerCase().replace(/\\s+/g, '-')}`,
        snippet: `Best practices and implementation guide for ${query}`,
        relevance: 0.8
      }
    ];
  }
  
  /**
   * Call MCP memory tool
   */
  async callMCPMemoryTool(toolName, params) {
    // This would integrate with actual MCP memory tools
    // For now, simulate the behavior
    switch (toolName) {
      case 'search_nodes':
        return this.simulateMemorySearch(params.query);
      case 'create_entities':
        return this.simulateEntityCreation(params);
      default:
        throw new Error(`Unknown MCP memory tool: ${toolName}`);
    }
  }
  
  /**
   * Simulate memory search
   */
  async simulateMemorySearch(query) {
    // Placeholder for actual MCP memory search
    return {
      results: [
        {
          name: `Related Pattern for ${query}`,
          entityType: 'TransferablePattern',
          relevance: 0.7
        }
      ]
    };
  }
  
  /**
   * Simulate entity creation
   */
  async simulateEntityCreation(params) {
    // Placeholder for actual MCP entity creation
    return {
      success: true,
      entityId: 'generated-id',
      message: 'Entity would be created via MCP'
    };
  }
}

// Export for use in other modules
export { MCPSemanticAnalysis };

// CLI interface for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const analyzer = new MCPSemanticAnalysis();
  
  const testContent = `
    We implemented a new Redux pattern for state management in our React application.
    The solution involved creating typed hooks and slices for better maintainability.
    
    \`\`\`typescript
    const useAppSelector = useSelector.withTypes<RootState>();
    const useAppDispatch = useDispatch.withTypes<AppDispatch>();
    \`\`\`
    
    This approach solved the prop drilling problem we were experiencing.
  `;
  
  analyzer.analyzeConversation(testContent).then(result => {
    console.log('Analysis Result:', JSON.stringify(result, null, 2));
  }).catch(error => {
    console.error('Test failed:', error);
  });
}