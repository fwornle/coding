/**
 * LLM Provider Interface
 * Abstract interface for different LLM providers
 */

export class LLMProviderInterface {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Analyze content with a given prompt
   * @param {string} prompt - The analysis prompt
   * @param {string} content - The content to analyze
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Analysis result
   */
  async analyze(prompt, content, options = {}) {
    throw new Error('analyze method must be implemented by subclass');
  }

  /**
   * Extract patterns from content
   * @param {string} content - The content to analyze
   * @param {Array} patterns - Pattern types to look for
   * @param {Object} options - Analysis options
   * @returns {Promise<Array>} Found patterns
   */
  async extractPatterns(content, patterns, options = {}) {
    throw new Error('extractPatterns method must be implemented by subclass');
  }

  /**
   * Generate insights from analysis
   * @param {Object} analysisData - Raw analysis data
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated insights
   */
  async generateInsights(analysisData, options = {}) {
    throw new Error('generateInsights method must be implemented by subclass');
  }

  /**
   * Score significance of content
   * @param {string} content - Content to score
   * @param {Object} context - Additional context
   * @returns {Promise<number>} Significance score (1-10)
   */
  async scoreSignificance(content, context = {}) {
    throw new Error('scoreSignificance method must be implemented by subclass');
  }

  /**
   * Validate provider configuration
   * @returns {boolean} True if configured correctly
   */
  validateConfig() {
    throw new Error('validateConfig method must be implemented by subclass');
  }

  /**
   * Get provider capabilities
   * @returns {Array<string>} List of supported capabilities
   */
  getCapabilities() {
    return [
      'analyze',
      'extractPatterns',
      'generateInsights',
      'scoreSignificance'
    ];
  }

  /**
   * Get provider information
   * @returns {Object} Provider metadata
   */
  getInfo() {
    return {
      name: this.constructor.name,
      config: this.config,
      capabilities: this.getCapabilities()
    };
  }
}