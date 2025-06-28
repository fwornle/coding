/**
 * Claude LLM Provider
 * Implementation of LLM interface using Anthropic's Claude API
 */

import Anthropic from '@anthropic-ai/sdk';
import { LLMProviderInterface } from './provider-interface.js';
import { Logger } from '../../../shared/logger.js';

export class ClaudeProvider extends LLMProviderInterface {
  constructor(config = {}) {
    super(config);
    
    this.config = {
      model: config.model || 'claude-3-opus-20240229',
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 0.3,
      ...config
    };
    
    this.logger = new Logger('claude-provider');
    this.client = null;
    
    this.initialize();
  }

  initialize() {
    const apiKey = process.env.ANTHROPIC_API_KEY || this.config.apiKey;
    
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable or config.apiKey is required');
    }
    
    this.client = new Anthropic({
      apiKey: apiKey
    });
    
    this.logger.info('Claude provider initialized');
  }

  validateConfig() {
    return !!(process.env.ANTHROPIC_API_KEY || this.config.apiKey);
  }

  async analyze(prompt, content, options = {}) {
    try {
      this.logger.debug('Analyzing content with Claude...');
      
      const systemPrompt = this.buildSystemPrompt(options.analysisType || 'general');
      const userPrompt = `${prompt}\n\n=== CONTENT TO ANALYZE ===\n${content}`;
      
      const response = await this.client.messages.create({
        model: options.model || this.config.model,
        max_tokens: options.maxTokens || this.config.maxTokens,
        temperature: options.temperature || this.config.temperature,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      });
      
      const result = this.parseResponse(response.content[0].text, options);
      
      this.logger.debug('Analysis completed successfully');
      return result;
      
    } catch (error) {
      this.logger.error('Claude analysis failed:', error);
      throw new Error(`Claude analysis failed: ${error.message}`);
    }
  }

  async extractPatterns(content, patterns, options = {}) {
    const prompt = this.buildPatternExtractionPrompt(patterns);
    
    const analysis = await this.analyze(prompt, content, {
      ...options,
      analysisType: 'pattern-extraction'
    });
    
    return this.parsePatterns(analysis, patterns);
  }

  async generateInsights(analysisData, options = {}) {
    const prompt = this.buildInsightGenerationPrompt(options);
    const content = JSON.stringify(analysisData, null, 2);
    
    const analysis = await this.analyze(prompt, content, {
      ...options,
      analysisType: 'insight-generation'
    });
    
    return this.parseInsights(analysis);
  }

  async scoreSignificance(content, context = {}) {
    const prompt = this.buildSignificanceScoringPrompt(context);
    
    const analysis = await this.analyze(prompt, content, {
      analysisType: 'significance-scoring',
      maxTokens: 1000
    });
    
    return this.parseSignificanceScore(analysis);
  }

  buildSystemPrompt(analysisType) {
    const basePrompt = `You are an expert semantic analysis AI specializing in code analysis, technical documentation, and software development patterns.

Your responses should be precise, structured, and focused on actionable insights.`;

    const typeSpecificPrompts = {
      'general': 'Provide comprehensive analysis with clear structure.',
      'code': 'Focus on architectural patterns, design decisions, and technical significance.',
      'conversation': 'Extract key decisions, rationales, and transferable insights.',
      'pattern-extraction': 'Identify and categorize specific patterns with clear examples.',
      'insight-generation': 'Generate actionable insights from raw analysis data.',
      'significance-scoring': 'Evaluate technical significance and provide numerical score.'
    };

    return `${basePrompt}\n\n${typeSpecificPrompts[analysisType] || typeSpecificPrompts.general}`;
  }

  buildPatternExtractionPrompt(patterns) {
    return `Extract and identify the following types of patterns from the content:

${patterns.map(pattern => `- ${pattern}: Look for instances and examples`).join('\n')}

For each pattern found:
1. Pattern type
2. Specific example/instance
3. Context where it appears
4. Significance level (1-10)
5. Brief explanation

Respond in JSON format with an array of pattern objects.`;
  }

  buildInsightGenerationPrompt(options) {
    return `Generate structured insights from the provided analysis data.

Focus on:
- Problem-solution patterns
- Architectural decisions and rationales
- Reusable patterns and best practices
- Technical debt and improvement opportunities
- Key learnings and takeaways

Respond in JSON format with:
{
  "insights": [
    {
      "type": "problem-solution|architectural|pattern|improvement",
      "title": "Brief title",
      "description": "Detailed description",
      "significance": 1-10,
      "applicability": "Where this applies",
      "technologies": ["tech1", "tech2"],
      "references": ["url1", "url2"]
    }
  ]
}`;
  }

  buildSignificanceScoringPrompt(context) {
    return `Evaluate the technical significance of this content on a scale of 1-10.

Consider:
- Architectural impact (1-3 points)
- Complexity and scope (1-2 points)
- Reusability and applicability (1-2 points)
- Innovation and uniqueness (1-2 points)
- Documentation and knowledge value (1-1 point)

Context: ${JSON.stringify(context)}

Respond with:
{
  "score": number (1-10),
  "reasoning": "Brief explanation of scoring",
  "factors": {
    "architectural": 1-3,
    "complexity": 1-2,
    "reusability": 1-2,
    "innovation": 1-2,
    "documentation": 1-1
  }
}`;
  }

  parseResponse(responseText, options) {
    try {
      // Try to parse as JSON first
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // Fall back to structured text parsing
      return {
        analysis: responseText,
        structured: this.extractStructuredData(responseText),
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.warn('Failed to parse structured response, returning raw text');
      return {
        analysis: responseText,
        structured: null,
        timestamp: new Date().toISOString()
      };
    }
  }

  parsePatterns(analysis, patternTypes) {
    if (analysis.patterns) {
      return analysis.patterns;
    }
    
    // Extract patterns from unstructured response
    const patterns = [];
    const content = analysis.analysis || '';
    
    for (const patternType of patternTypes) {
      const regex = new RegExp(`${patternType}[:\\s]([^\\n]+)`, 'gi');
      const matches = content.match(regex);
      
      if (matches) {
        patterns.push({
          type: patternType,
          instances: matches,
          significance: 5 // Default significance
        });
      }
    }
    
    return patterns;
  }

  parseInsights(analysis) {
    if (analysis.insights) {
      return analysis.insights;
    }
    
    // Generate basic insights from unstructured response
    return [{
      type: 'general',
      title: 'Analysis Summary',
      description: analysis.analysis || 'No structured insights available',
      significance: 5,
      applicability: 'General software development',
      technologies: [],
      references: []
    }];
  }

  parseSignificanceScore(analysis) {
    if (analysis.score) {
      return analysis.score;
    }
    
    // Extract score from text
    const scoreMatch = (analysis.analysis || '').match(/score[:\s]*(\d+)/i);
    if (scoreMatch) {
      return parseInt(scoreMatch[1]);
    }
    
    // Default score
    return 5;
  }

  extractStructuredData(text) {
    const structured = {};
    
    // Extract patterns like "Key: Value"
    const keyValueRegex = /^([A-Z][a-zA-Z\s]+):\s*(.+)$/gm;
    let match;
    
    while ((match = keyValueRegex.exec(text)) !== null) {
      const key = match[1].toLowerCase().replace(/\s+/g, '_');
      structured[key] = match[2].trim();
    }
    
    return Object.keys(structured).length > 0 ? structured : null;
  }

  getCapabilities() {
    return [
      ...super.getCapabilities(),
      'conversation-analysis',
      'code-review',
      'architectural-analysis',
      'pattern-recognition'
    ];
  }

  getInfo() {
    return {
      ...super.getInfo(),
      name: 'Claude Provider',
      model: this.config.model,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature
    };
  }
}