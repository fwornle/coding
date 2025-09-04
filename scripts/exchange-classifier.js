#!/usr/bin/env node

/**
 * Exchange Classifier
 * Real-time classification of conversation exchanges for intelligent routing
 * Determines whether exchanges should go to coding/.specstory/ or local .specstory/
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

class ExchangeClassifier {
  constructor(options = {}) {
    this.constraintMonitorPath = options.constraintMonitorPath || 
      path.join(process.cwd(), 'integrations/mcp-constraint-monitor');
    this.semanticAnalysisPath = options.semanticAnalysisPath || 
      path.join(process.cwd(), 'integrations/mcp-server-semantic-analysis');
    
    this.codingIndicators = this.initializeCodingIndicators();
    this.contextBuffer = [];
    this.maxContextSize = 10;
  }

  initializeCodingIndicators() {
    return {
      // MCP and system tools
      tools: [
        'mcp__semantic-analysis',
        'mcp__memory',
        'mcp__constraint-monitor',
        'Task'
      ],
      
      // File patterns that indicate coding/system work
      filePaths: [
        '/knowledge-management/',
        '/integrations/',
        '/scripts/',
        'shared-memory-',
        '.specstory/',
        'claude-mcp',
        'CLAUDE.md',
        'constraints.yaml'
      ],
      
      // Command patterns
      commands: [
        'claude-mcp',
        'ukb',
        'vkb',
        'semantic-analysis',
        'npm install',
        'npm run',
        'docker',
        'node ',
        'python',
        'pip install'
      ],
      
      // Concept keywords (case-insensitive)
      concepts: [
        'MCP',
        'knowledge base',
        'constraint monitor',
        'semantic analysis',
        'knowledge graph',
        'session logging',
        'post-session',
        'guardrails',
        'compliance',
        'knowledge management',
        'cross-project',
        'system administration'
      ],
      
      // Project/repo indicators
      repositories: [
        'coding',
        'mcp-server',
        'constraint-monitor',
        'knowledge-management'
      ]
    };
  }

  /**
   * Classify an exchange in real-time
   */
  async classifyExchange(exchange, conversationContext = {}) {
    try {
      // Add to context buffer
      this.contextBuffer.push(exchange);
      if (this.contextBuffer.length > this.maxContextSize) {
        this.contextBuffer.shift();
      }

      // Analyze the exchange
      const analysis = await this.analyzeExchange(exchange, conversationContext);
      
      // Score against coding indicators
      const score = this.scoreExchange(exchange, analysis);
      
      // Determine classification
      const classification = this.determineClassification(score);
      
      return {
        target: classification.target,
        confidence: classification.confidence,
        score: score.totalScore,
        reasons: score.reasons,
        hybrid: classification.hybrid,
        analysis: analysis
      };
    } catch (error) {
      console.warn('Exchange classification error:', error.message);
      return this.getDefaultClassification();
    }
  }

  async analyzeExchange(exchange, conversationContext) {
    const analysis = {
      toolsUsed: this.extractTools(exchange),
      filesAccessed: this.extractFilePaths(exchange),
      commandsRun: this.extractCommands(exchange),
      conceptsReferenced: this.extractConcepts(exchange),
      workingDirectory: conversationContext.workingDirectory || process.cwd(),
      timestamp: Date.now()
    };

    // Try to get semantic analysis if available
    try {
      if (this.isSemanticAnalysisAvailable()) {
        analysis.semanticInsight = await this.getSemanticAnalysis(exchange);
      }
    } catch (error) {
      // Semantic analysis optional - continue without it
      console.debug('Semantic analysis not available:', error.message);
    }

    return analysis;
  }

  extractTools(exchange) {
    const tools = [];
    
    // Look for tool calls in exchange summary
    if (exchange.summary && exchange.summary.type) {
      tools.push(exchange.summary.type);
    }
    
    // Look for MCP tool patterns
    const mcpPattern = /mcp__[\w-]+__[\w-]+/g;
    const mcpMatches = JSON.stringify(exchange).match(mcpPattern) || [];
    tools.push(...mcpMatches);
    
    return [...new Set(tools)];
  }

  extractFilePaths(exchange) {
    const filePaths = [];
    const text = JSON.stringify(exchange);
    
    // Look for file path patterns
    const pathPatterns = [
      /\/[\w\-\/\.]+\.(js|ts|json|md|yaml|yml|sh|py)/g,
      /[\w\-]+\/[\w\-\/]+/g,
      /`[^`]*\.(js|ts|json|md|yaml|yml|sh|py)`/g
    ];
    
    pathPatterns.forEach(pattern => {
      const matches = text.match(pattern) || [];
      filePaths.push(...matches.map(m => m.replace(/`/g, '')));
    });
    
    return [...new Set(filePaths)];
  }

  extractCommands(exchange) {
    const commands = [];
    const text = JSON.stringify(exchange);
    
    // Look for bash commands
    if (exchange.summary && exchange.summary.type === 'command') {
      const cmdMatch = text.match(/`([^`]+)`/);
      if (cmdMatch) {
        commands.push(cmdMatch[1]);
      }
    }
    
    return [...new Set(commands)];
  }

  extractConcepts(exchange) {
    const concepts = [];
    const text = JSON.stringify(exchange).toLowerCase();
    
    this.codingIndicators.concepts.forEach(concept => {
      if (text.includes(concept.toLowerCase())) {
        concepts.push(concept);
      }
    });
    
    return [...new Set(concepts)];
  }

  scoreExchange(exchange, analysis) {
    const scores = {
      tools: 0,
      files: 0,
      commands: 0,
      concepts: 0,
      context: 0
    };
    
    const reasons = [];
    
    // Score tools
    analysis.toolsUsed.forEach(tool => {
      if (this.codingIndicators.tools.some(ct => tool.includes(ct))) {
        scores.tools += 0.3;
        reasons.push(`Uses coding tool: ${tool}`);
      }
    });
    
    // Score file paths
    analysis.filesAccessed.forEach(filePath => {
      if (this.codingIndicators.filePaths.some(fp => filePath.includes(fp))) {
        scores.files += 0.25;
        reasons.push(`Accesses coding file: ${filePath}`);
      }
    });
    
    // Score commands
    analysis.commandsRun.forEach(command => {
      if (this.codingIndicators.commands.some(cc => command.includes(cc))) {
        scores.commands += 0.2;
        reasons.push(`Runs coding command: ${command}`);
      }
    });
    
    // Score concepts
    analysis.conceptsReferenced.forEach(concept => {
      scores.concepts += 0.15;
      reasons.push(`References concept: ${concept}`);
    });
    
    // Score working directory context
    if (analysis.workingDirectory.includes('/coding')) {
      scores.context += 0.1;
      reasons.push('Working in coding repository');
    }
    
    const totalScore = Object.values(scores).reduce((sum, score) => sum + score, 0);
    const normalizedScore = Math.min(totalScore, 1.0); // Cap at 1.0
    
    return {
      scores,
      totalScore: normalizedScore,
      reasons: reasons.slice(0, 5) // Limit to top 5 reasons
    };
  }

  determineClassification(score) {
    const { totalScore } = score;
    
    // CRITICAL FIX: If we're in the coding repository, ALWAYS classify as coding
    const currentPath = process.cwd();
    if (currentPath.includes('/coding') || currentPath.endsWith('coding')) {
      return {
        target: 'coding',
        confidence: 0.95,
        hybrid: false
      };
    }
    
    if (totalScore >= 0.7) {
      return {
        target: 'coding',
        confidence: 0.9,
        hybrid: false
      };
    } else if (totalScore >= 0.4) {
      return {
        target: 'coding',
        confidence: 0.7,
        hybrid: true // Log to both locations
      };
    } else if (totalScore >= 0.2) {
      return {
        target: 'project',
        confidence: 0.6,
        hybrid: true // Some coding aspects, but primarily project
      };
    } else {
      return {
        target: 'project',
        confidence: 0.8,
        hybrid: false
      };
    }
  }

  getDefaultClassification() {
    return {
      target: 'project',
      confidence: 0.5,
      score: 0.0,
      reasons: ['Default classification due to analysis error'],
      hybrid: false,
      analysis: null
    };
  }

  // Integration with semantic analysis system
  isSemanticAnalysisAvailable() {
    return existsSync(this.semanticAnalysisPath);
  }

  async getSemanticAnalysis(exchange) {
    try {
      // Check if semantic analysis MCP server is running
      const statusResult = execSync('node scripts/combined-status-line.js', {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 3000
      });
      
      if (statusResult.includes('🧠')) {
        // Semantic analysis is available - could integrate here
        return {
          available: true,
          timestamp: Date.now()
        };
      }
      
      return { available: false };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  // Context management
  getRecentContext(count = 5) {
    return this.contextBuffer.slice(-count);
  }

  clearContext() {
    this.contextBuffer = [];
  }
}

export default ExchangeClassifier;