#!/usr/bin/env node

/**
 * Conversation Analyzer for UKB Agent Mode
 * 
 * This script is designed to be run from within coding agents (Claude, CoPilot)
 * to perform deep semantic analysis on conversation history files.
 * 
 * It extracts transferable patterns, problem-solution pairs, and architectural insights
 * from specstory conversation files.
 */

const fs = require('fs');
const path = require('path');

// Analysis configuration
const ANALYSIS_CONFIG = {
  minSignificance: 7,
  patterns: {
    problemSolution: /(?:problem|issue|challenge|error|bug)[\s\S]{0,500}?(?:solution|fixed|resolved|approach)/gi,
    architecture: /(?:architecture|design|pattern|structure|refactor)[\s\S]{0,300}?(?:implement|create|build|design)/gi,
    performance: /(?:performance|optimize|speed|memory|efficient)[\s\S]{0,300}?(?:improve|reduce|enhance|optimize)/gi,
    debugging: /(?:debug|troubleshoot|diagnose|investigate)[\s\S]{0,300}?(?:found|discovered|root cause|issue was)/gi,
    toolUsage: /\[Tool: (\w+)\][\s\S]{0,200}?(?:successfully|completed|fixed|resolved)/gi,
    keyLearning: /(?:key (?:insight|learning|takeaway)|learned that|discovered that|realized that)[\s\S]{0,300}/gi,
    bestPractice: /(?:best practice|should always|never|always|must|pattern is)[\s\S]{0,200}/gi
  }
};

// Pattern type mapping
const PATTERN_TYPES = {
  problemSolution: 'DebuggingPattern',
  architecture: 'ArchitecturalPattern',
  performance: 'PerformancePattern',
  debugging: 'TroubleshootingPattern',
  toolUsage: 'WorkflowPattern',
  keyLearning: 'TransferableInsight',
  bestPractice: 'BestPracticePattern'
};

class ConversationAnalyzer {
  constructor(sessionDir) {
    this.sessionDir = sessionDir;
    this.insights = [];
    this.analysisRequest = null;
  }

  async analyze() {
    console.log('🔍 Starting deep semantic analysis of conversations...');
    
    // Load analysis request
    const requestPath = path.join(this.sessionDir, 'agent_analysis_request.json');
    if (fs.existsSync(requestPath)) {
      this.analysisRequest = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    }
    
    // Analyze specstory files
    const specstoryFiles = this.analysisRequest?.sources?.specstory_files || [];
    for (const file of specstoryFiles) {
      if (fs.existsSync(file)) {
        await this.analyzeConversationFile(file);
      }
    }
    
    // Analyze recent commits for patterns
    if (this.analysisRequest?.sources?.recent_commits) {
      this.analyzeCommits(this.analysisRequest.sources.recent_commits);
    }
    
    // Save insights
    this.saveInsights();
    
    console.log(`✅ Analysis complete: Found ${this.insights.length} transferable insights`);
  }

  async analyzeConversationFile(filePath) {
    console.log(`📄 Analyzing: ${path.basename(filePath)}`);
    
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);
    
    // Extract metadata
    const sessionMatch = content.match(/Session ID: ([\w-]+)/);
    const summaryMatch = content.match(/Summary: (.+)/);
    const sessionId = sessionMatch ? sessionMatch[1] : 'unknown';
    const summary = summaryMatch ? summaryMatch[1] : '';
    
    // Analyze for each pattern type
    for (const [patternKey, regex] of Object.entries(ANALYSIS_CONFIG.patterns)) {
      const matches = [...content.matchAll(regex)];
      
      for (const match of matches) {
        const context = match[0];
        const insight = this.extractInsight(context, patternKey, fileName, sessionId);
        
        if (insight && insight.significance >= ANALYSIS_CONFIG.minSignificance) {
          this.insights.push(insight);
        }
      }
    }
    
    // Extract tool workflow sequences
    this.extractToolWorkflows(content, fileName);
    
    // Extract error-solution pairs
    this.extractErrorSolutions(content, fileName);
  }

  extractInsight(context, patternType, sourceFile, sessionId) {
    // Clean and structure the context
    const cleanContext = context.replace(/\s+/g, ' ').trim();
    
    // Determine significance based on pattern type and context
    let significance = this.calculateSignificance(cleanContext, patternType);
    
    // Skip low-significance insights
    if (significance < ANALYSIS_CONFIG.minSignificance) {
      return null;
    }
    
    // Extract problem and solution components
    const problemMatch = cleanContext.match(/(?:problem|issue|challenge|error|bug)[:\s]+([^.!?]+)/i);
    const solutionMatch = cleanContext.match(/(?:solution|fixed|resolved|approach)[:\s]+([^.!?]+)/i);
    
    const problem = problemMatch ? problemMatch[1].trim() : this.inferProblem(cleanContext);
    const solution = solutionMatch ? solutionMatch[1].trim() : this.inferSolution(cleanContext);
    
    // Generate pattern name
    const patternName = this.generatePatternName(problem, patternType);
    
    return {
      type: 'entity',
      name: patternName,
      entityType: PATTERN_TYPES[patternType] || 'TransferablePattern',
      problem: problem,
      solution: solution,
      approach: cleanContext,
      applicability: this.inferApplicability(patternType, cleanContext),
      technologies: this.extractTechnologies(cleanContext),
      observations: [
        `Extracted from: ${sourceFile}`,
        `Pattern type: ${patternType}`,
        `Context: ${cleanContext.substring(0, 200)}...`,
        `Session: ${sessionId}`,
        `Significance: ${significance}/10`,
        `Source: specstory-analysis`
      ],
      significance: significance,
      metadata: {
        source: 'agent-analysis',
        pattern_type: patternType,
        source_file: sourceFile,
        extracted_from: ['specstory']
      }
    };
  }

  calculateSignificance(context, patternType) {
    let score = 5; // Base score
    
    // Pattern type bonuses
    const typeScores = {
      architecture: 3,
      performance: 2,
      problemSolution: 1,
      debugging: 1,
      toolUsage: 0,
      keyLearning: 2,
      bestPractice: 2
    };
    
    score += typeScores[patternType] || 0;
    
    // Keyword bonuses
    const significantKeywords = [
      'architecture', 'pattern', 'performance', 'optimization',
      'refactor', 'design', 'scalability', 'maintainability',
      'breakthrough', 'significant', 'critical', 'essential'
    ];
    
    const contextLower = context.toLowerCase();
    for (const keyword of significantKeywords) {
      if (contextLower.includes(keyword)) {
        score += 0.5;
      }
    }
    
    // Cap at 10
    return Math.min(Math.round(score), 10);
  }

  generatePatternName(problem, patternType) {
    // Extract key terms from problem
    const keywords = problem
      .split(/\s+/)
      .filter(word => word.length > 4)
      .filter(word => !['with', 'from', 'that', 'this', 'when', 'where'].includes(word.toLowerCase()))
      .slice(0, 3);
    
    const baseType = PATTERN_TYPES[patternType] || 'Pattern';
    
    if (keywords.length > 0) {
      const keywordPart = keywords
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
      return keywordPart + baseType;
    }
    
    return `${baseType}_${Date.now()}`;
  }

  inferProblem(context) {
    // Try to extract problem from context
    const problemIndicators = ['issue', 'error', 'problem', 'challenge', 'difficulty', 'failing', 'broken'];
    
    for (const indicator of problemIndicators) {
      const regex = new RegExp(`${indicator}[:\\s]+([^.!?]{10,100})`, 'i');
      const match = context.match(regex);
      if (match) return match[1].trim();
    }
    
    return 'Complex technical challenge requiring systematic solution';
  }

  inferSolution(context) {
    // Try to extract solution from context
    const solutionIndicators = ['fixed', 'resolved', 'solution', 'approach', 'implemented', 'created'];
    
    for (const indicator of solutionIndicators) {
      const regex = new RegExp(`${indicator}[:\\s]+([^.!?]{10,100})`, 'i');
      const match = context.match(regex);
      if (match) return match[1].trim();
    }
    
    return 'Systematic approach to resolve the identified issue';
  }

  inferApplicability(patternType, context) {
    const applicabilityMap = {
      architecture: 'Large-scale applications requiring structured design',
      performance: 'Systems with performance bottlenecks or optimization needs',
      problemSolution: 'Similar debugging scenarios and troubleshooting',
      debugging: 'Complex debugging situations requiring systematic approach',
      toolUsage: 'Development workflows requiring tool automation',
      keyLearning: 'General software development practices',
      bestPractice: 'Team development standards and conventions'
    };
    
    return applicabilityMap[patternType] || 'Software development projects';
  }

  extractTechnologies(context) {
    const technologies = new Set();
    
    // Common technology patterns
    const techPatterns = [
      /\b(React|Vue|Angular|Svelte)\b/gi,
      /\b(TypeScript|JavaScript|Python|Rust|Go|Java)\b/gi,
      /\b(Node\.?js|Deno|Bun)\b/gi,
      /\b(Redux|MobX|Zustand|Recoil)\b/gi,
      /\b(Docker|Kubernetes|AWS|Azure|GCP)\b/gi,
      /\b(PostgreSQL|MySQL|MongoDB|Redis)\b/gi,
      /\b(Git|GitHub|GitLab)\b/gi,
      /\b(Jest|Mocha|Cypress|Playwright)\b/gi,
      /\b(Webpack|Vite|Rollup|Parcel)\b/gi,
      /\b(Three\.?js|WebGL|Canvas)\b/gi
    ];
    
    for (const pattern of techPatterns) {
      const matches = context.match(pattern);
      if (matches) {
        matches.forEach(tech => technologies.add(tech));
      }
    }
    
    return Array.from(technologies);
  }

  extractToolWorkflows(content, fileName) {
    // Extract sequences of tool usage that led to solutions
    const toolRegex = /\[Tool: (\w+)\][\s\S]{0,1000}?(?:successfully|completed|fixed|resolved)/gi;
    const workflows = [];
    
    let match;
    while ((match = toolRegex.exec(content)) !== null) {
      const toolSequence = [];
      const workflowContext = content.substring(match.index - 500, match.index + 500);
      
      // Extract all tools in this workflow
      const toolMatches = [...workflowContext.matchAll(/\[Tool: (\w+)\]/g)];
      toolMatches.forEach(m => toolSequence.push(m[1]));
      
      if (toolSequence.length >= 3) {
        // This is a significant workflow
        const workflow = {
          type: 'entity',
          name: `${toolSequence.slice(0, 3).join('')}WorkflowPattern`,
          entityType: 'WorkflowPattern',
          problem: 'Complex task requiring multiple tool operations',
          solution: `Sequential use of ${toolSequence.join(' → ')} tools`,
          approach: `Tool workflow: ${toolSequence.join(' → ')}`,
          applicability: 'Similar multi-step development tasks',
          technologies: ['Claude Code', 'Development Tools'],
          observations: [
            `Tool sequence: ${toolSequence.join(' → ')}`,
            `Extracted from: ${fileName}`,
            'Pattern type: Tool workflow',
            `Total tools used: ${toolSequence.length}`,
            'Significance: 7/10',
            'Source: tool-workflow-analysis'
          ],
          significance: 7,
          metadata: {
            source: 'agent-analysis',
            pattern_type: 'workflow',
            tools: toolSequence,
            extracted_from: ['specstory']
          }
        };
        
        this.insights.push(workflow);
      }
    }
  }

  extractErrorSolutions(content, fileName) {
    // Extract error message and solution pairs
    const errorRegex = /(?:error|exception|failure):\s*([^\n]+)[\s\S]{0,500}?(?:fix|solution|resolved):\s*([^\n]+)/gi;
    
    let match;
    while ((match = errorRegex.exec(content)) !== null) {
      const error = match[1].trim();
      const solution = match[2].trim();
      
      const errorSolution = {
        type: 'entity',
        name: `${this.sanitizeName(error)}SolutionPattern`,
        entityType: 'ErrorSolutionPattern',
        problem: `Error: ${error}`,
        solution: solution,
        approach: `When encountering "${error}", apply: ${solution}`,
        applicability: 'Similar error scenarios',
        technologies: this.extractTechnologies(match[0]),
        observations: [
          `Error: ${error}`,
          `Solution: ${solution}`,
          `Extracted from: ${fileName}`,
          'Pattern type: Error-Solution pair',
          'Significance: 6/10',
          'Source: error-solution-analysis'
        ],
        significance: 6,
        metadata: {
          source: 'agent-analysis',
          pattern_type: 'error-solution',
          error_type: this.classifyError(error),
          extracted_from: ['specstory']
        }
      };
      
      this.insights.push(errorSolution);
    }
  }

  sanitizeName(text) {
    return text
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 3)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
  }

  classifyError(error) {
    const errorLower = error.toLowerCase();
    
    if (errorLower.includes('syntax')) return 'syntax';
    if (errorLower.includes('type')) return 'type';
    if (errorLower.includes('reference')) return 'reference';
    if (errorLower.includes('network')) return 'network';
    if (errorLower.includes('permission')) return 'permission';
    if (errorLower.includes('memory')) return 'memory';
    if (errorLower.includes('timeout')) return 'timeout';
    
    return 'general';
  }

  analyzeCommits(commitsText) {
    if (!commitsText) return;
    
    const commits = commitsText.split('\n').filter(line => line.trim());
    
    for (const commit of commits) {
      // Parse commit format: hash|author|date|message
      const parts = commit.split('|');
      if (parts.length < 4) continue;
      
      const [hash, author, date, message] = parts;
      
      // Check for architectural commits
      if (message.match(/\b(architecture|refactor|redesign|pattern|performance)\b/i)) {
        const insight = {
          type: 'entity',
          name: `${this.sanitizeName(message)}Pattern`,
          entityType: 'ArchitecturalPattern',
          problem: 'Code structure or performance requiring improvement',
          solution: message,
          approach: `Commit ${hash}: ${message}`,
          applicability: 'Similar architectural improvements',
          technologies: this.extractTechnologies(message),
          observations: [
            `Commit: ${hash}`,
            `Message: ${message}`,
            `Author: ${author}`,
            'Pattern type: Architectural change',
            'Significance: 7/10',
            'Source: commit-analysis'
          ],
          significance: 7,
          metadata: {
            source: 'agent-analysis',
            commit_hash: hash,
            extracted_from: ['commits']
          }
        };
        
        this.insights.push(insight);
      }
    }
  }

  saveInsights() {
    const insightsPath = path.join(this.sessionDir, 'insights.json');
    
    // Merge with existing insights if any
    let existingData = { insights: [], entities: [], relations: [] };
    if (fs.existsSync(insightsPath)) {
      existingData = JSON.parse(fs.readFileSync(insightsPath, 'utf8'));
    }
    
    // Add new insights
    existingData.insights = [...existingData.insights, ...this.insights];
    
    // Write back
    fs.writeFileSync(insightsPath, JSON.stringify(existingData, null, 2));
    
    console.log(`💾 Saved ${this.insights.length} insights to ${insightsPath}`);
  }
}

// Main execution
if (require.main === module) {
  const sessionDir = process.argv[2];
  
  if (!sessionDir) {
    console.error('Usage: node analyze-conversations.js <session-directory>');
    process.exit(1);
  }
  
  const analyzer = new ConversationAnalyzer(sessionDir);
  analyzer.analyze().catch(err => {
    console.error('Analysis failed:', err);
    process.exit(1);
  });
}

module.exports = ConversationAnalyzer;