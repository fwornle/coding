#!/usr/bin/env node
/**
 * Insight Orchestrator Service
 * 
 * Monitors session completion and orchestrates multi-source analysis:
 * - Session logs analysis (current and past sessions)
 * - Codebase analysis (git commits and associated files)
 * - Web search for key technologies
 * - Creates/updates knowledge graph nodes with detailed insight files
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { DiagramGenerator } from './diagram-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

// Configuration
const CODING_ROOT = path.join(__dirname, '..');
const SPECSTORY_PATH = path.join(CODING_ROOT, '.specstory', 'history');
const INSIGHTS_PATH = path.join(CODING_ROOT, 'knowledge-management', 'insights');
const ANALYSIS_STATE_FILE = path.join(CODING_ROOT, 'tmp', 'analysis-state.json');

class InsightOrchestrator {
  constructor(options = {}) {
    this.config = {
      significanceThreshold: options.significanceThreshold || 7,
      maxSessionsToAnalyze: options.maxSessionsToAnalyze || 10,
      webSearchEnabled: options.webSearchEnabled !== false,
      autoTrigger: options.autoTrigger !== false,
      ...options
    };
    
    this.logger = this.createLogger();
    this.analysisState = {};
  }
  
  createLogger() {
    return {
      info: (msg) => console.log(`[${new Date().toISOString()}] INFO: ${msg}`),
      warn: (msg) => console.log(`[${new Date().toISOString()}] WARN: ${msg}`),
      error: (msg) => console.error(`[${new Date().toISOString()}] ERROR: ${msg}`),
      debug: (msg) => {
        if (process.env.DEBUG) {
          console.log(`[${new Date().toISOString()}] DEBUG: ${msg}`);
        }
      }
    };
  }
  
  /**
   * Load analysis state to track what has been processed
   */
  async loadAnalysisState() {
    try {
      const stateData = await fs.readFile(ANALYSIS_STATE_FILE, 'utf8');
      this.analysisState = JSON.parse(stateData);
    } catch (error) {
      this.logger.debug('No previous analysis state found, starting fresh');
      this.analysisState = {
        lastAnalyzedSession: null,
        analyzedCommits: [],
        lastRun: null
      };
    }
  }
  
  /**
   * Save analysis state
   */
  async saveAnalysisState() {
    try {
      await fs.mkdir(path.dirname(ANALYSIS_STATE_FILE), { recursive: true });
      await fs.writeFile(ANALYSIS_STATE_FILE, JSON.stringify(this.analysisState, null, 2));
    } catch (error) {
      this.logger.error(`Failed to save analysis state: ${error.message}`);
    }
  }
  
  /**
   * Detect session completion and trigger analysis
   */
  async monitorForSessionCompletion() {
    this.logger.info('Starting session monitoring...');
    
    // Load previous state
    await this.loadAnalysisState();
    
    const specstoryExists = await this.fileExists(SPECSTORY_PATH);
    if (!specstoryExists) {
      this.logger.warn('No .specstory/history directory found');
      return;
    }
    
    // Get latest session files
    const sessionFiles = await this.getLatestSessionFiles();
    
    if (sessionFiles.length === 0) {
      this.logger.info('No session files found');
      return;
    }
    
    // Check for new sessions since last analysis
    const newSessions = await this.findNewSessions(sessionFiles);
    
    if (newSessions.length === 0) {
      this.logger.info('No new sessions to analyze');
      return;
    }
    
    this.logger.info(`Found ${newSessions.length} new session(s) to analyze`);
    
    // Analyze each new session
    for (const sessionFile of newSessions) {
      await this.analyzeSession(sessionFile);
    }
    
    // Update state
    this.analysisState.lastAnalyzedSession = sessionFiles[0].path;
    this.analysisState.lastRun = new Date().toISOString();
    await this.saveAnalysisState();
  }
  
  /**
   * Get latest session files from .specstory/history
   */
  async getLatestSessionFiles() {
    try {
      const files = await fs.readdir(SPECSTORY_PATH);
      const sessionFiles = files
        .filter(file => file.endsWith('.md'))
        .map(file => ({
          path: path.join(SPECSTORY_PATH, file),
          name: file,
          timestamp: this.extractTimestampFromFilename(file)
        }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, this.config.maxSessionsToAnalyze);
      
      return sessionFiles;
    } catch (error) {
      this.logger.error(`Failed to read session files: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Extract timestamp from session filename
   */
  extractTimestampFromFilename(filename) {
    // Match patterns like: conversation-2025-06-29-18-30-45.md
    const match = filename.match(/(\\d{4}-\\d{2}-\\d{2}[-_]\\d{2}[-_]\\d{2}[-_]\\d{2})/);
    if (match) {
      const dateStr = match[1].replace(/[-_]/g, '-');
      return new Date(dateStr.replace(/-/g, '-').substring(0, 19).replace(/-/g, '/')).getTime();
    }
    return 0;
  }
  
  /**
   * Find sessions that haven't been analyzed yet
   */
  async findNewSessions(sessionFiles) {
    if (!this.analysisState.lastAnalyzedSession) {
      return sessionFiles; // All sessions are new
    }
    
    const lastAnalyzedIndex = sessionFiles.findIndex(
      file => file.path === this.analysisState.lastAnalyzedSession
    );
    
    if (lastAnalyzedIndex === -1) {
      return sessionFiles; // Last analyzed session not found, analyze all
    }
    
    return sessionFiles.slice(0, lastAnalyzedIndex);
  }
  
  /**
   * Analyze a single session using multi-source approach
   */
  async analyzeSession(sessionFile) {
    this.logger.info(`Analyzing session: ${sessionFile.name}`);
    
    try {
      // 1. Read and analyze session content
      const sessionContent = await fs.readFile(sessionFile.path, 'utf8');
      const sessionAnalysis = await this.analyzeSessionContent(sessionContent);
      
      if (sessionAnalysis.significance < this.config.significanceThreshold) {
        this.logger.info(`Session significance (${sessionAnalysis.significance}) below threshold (${this.config.significanceThreshold}), skipping`);
        return;
      }
      
      // 2. Analyze related repository changes
      const repoAnalysis = await this.analyzeRepositoryChanges(sessionFile.timestamp);
      
      // 3. Perform web search for mentioned technologies
      const webResearch = this.config.webSearchEnabled 
        ? await this.performWebResearch(sessionAnalysis.technologies)
        : null;
      
      // 4. Combine insights and create knowledge entity
      const combinedInsight = await this.combineInsights({
        session: sessionAnalysis,
        repository: repoAnalysis,
        webResearch
      });
      
      // 5. Create knowledge base entry and detailed insight file
      await this.createKnowledgeEntry(combinedInsight);
      
      this.logger.info(`Successfully processed session: ${sessionFile.name}`);
      
    } catch (error) {
      this.logger.error(`Failed to analyze session ${sessionFile.name}: ${error.message}`);
    }
  }
  
  /**
   * Analyze session content to extract key insights
   */
  async analyzeSessionContent(content) {
    this.logger.debug('Analyzing session content...');
    
    // Use semantic analysis tools to process the conversation
    try {
      const analysisResult = await this.callMCPTool('semantic_analyze_conversation', {
        content,
        extractInsights: true,
        significanceThreshold: this.config.significanceThreshold
      });
      
      return {
        significance: analysisResult.significance || 5,
        keyTopics: analysisResult.topics || [],
        technologies: analysisResult.technologies || [],
        patterns: analysisResult.patterns || [],
        insights: analysisResult.insights || [],
        problemsSolved: analysisResult.problems || [],
        codeChanges: analysisResult.codeChanges || []
      };
    } catch (error) {
      this.logger.warn(`MCP analysis failed, using fallback: ${error.message}`);
      return this.fallbackSessionAnalysis(content);
    }
  }
  
  /**
   * Fallback session analysis without MCP tools
   */
  fallbackSessionAnalysis(content) {
    const technologies = this.extractTechnologies(content);
    const patterns = this.extractPatterns(content);
    const insights = this.extractInsights(content);
    
    // Simple significance scoring based on content characteristics
    let significance = 5;
    if (technologies.length > 3) significance += 1;
    if (patterns.length > 0) significance += 2;
    if (insights.length > 2) significance += 1;
    if (content.length > 5000) significance += 1;
    
    return {
      significance: Math.min(significance, 10),
      keyTopics: this.extractKeyTopics(content),
      technologies,
      patterns,
      insights,
      problemsSolved: this.extractProblemsSolved(content),
      codeChanges: this.extractCodeChanges(content)
    };
  }
  
  /**
   * Extract technologies mentioned in content
   */
  extractTechnologies(content) {
    const techKeywords = [
      'React', 'Node.js', 'TypeScript', 'JavaScript', 'Python', 'Three.js',
      'Redux', 'Express', 'Vite', 'Webpack', 'Docker', 'Kubernetes',
      'AWS', 'Azure', 'GCP', 'PostgreSQL', 'MongoDB', 'Redis',
      'Jest', 'Cypress', 'Playwright', 'MCP', 'Claude', 'OpenAI'
    ];
    
    const found = new Set();
    const lowerContent = content.toLowerCase();
    
    techKeywords.forEach(tech => {
      if (lowerContent.includes(tech.toLowerCase())) {
        found.add(tech);
      }
    });
    
    return Array.from(found);
  }
  
  /**
   * Extract architectural patterns from content
   */
  extractPatterns(content) {
    const patternKeywords = [
      'MVC', 'MVP', 'MVVM', 'Factory', 'Observer', 'Singleton',
      'Repository', 'Strategy', 'Command', 'Adapter', 'Decorator',
      'Redux pattern', 'Hook pattern', 'Component pattern'
    ];
    
    const found = new Set();
    const lowerContent = content.toLowerCase();
    
    patternKeywords.forEach(pattern => {
      if (lowerContent.includes(pattern.toLowerCase())) {
        found.add(pattern);
      }
    });
    
    return Array.from(found);
  }
  
  /**
   * Extract insights from content
   */
  extractInsights(content) {
    const insights = [];
    const lines = content.split('\\n');
    
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.length > 50 && 
          (trimmed.includes('learned') || trimmed.includes('discovered') || 
           trimmed.includes('solution') || trimmed.includes('approach'))) {
        insights.push(trimmed);
      }
    });
    
    return insights.slice(0, 5); // Limit to top 5
  }
  
  /**
   * Extract key topics from content
   */
  extractKeyTopics(content) {
    // Simple topic extraction based on frequent meaningful words
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
      .slice(0, 10)
      .map(([word]) => word);
  }
  
  /**
   * Check if word is a stop word
   */
  isStopWord(word) {
    const stopWords = new Set([
      'this', 'that', 'with', 'have', 'will', 'from', 'they', 'been',
      'into', 'than', 'only', 'more', 'very', 'what', 'when', 'where',
      'would', 'could', 'should', 'there', 'their', 'which', 'about'
    ]);
    return stopWords.has(word);
  }
  
  /**
   * Extract problems solved from content
   */
  extractProblemsSolved(content) {
    const problems = [];
    const lines = content.split('\\n');
    
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.includes('problem') || trimmed.includes('issue') || 
          trimmed.includes('error') || trimmed.includes('fix')) {
        problems.push(trimmed);
      }
    });
    
    return problems.slice(0, 3);
  }
  
  /**
   * Extract code changes from content
   */
  extractCodeChanges(content) {
    const changes = [];
    const codeBlocks = content.match(/```[\\s\\S]*?```/g) || [];
    
    codeBlocks.forEach(block => {
      if (block.length > 100) { // Only significant code blocks
        changes.push({
          language: this.detectLanguage(block),
          snippet: block.substring(0, 200) + '...'
        });
      }
    });
    
    return changes.slice(0, 3);
  }
  
  /**
   * Detect programming language from code block
   */
  detectLanguage(codeBlock) {
    const firstLine = codeBlock.split('\\n')[0];
    const langMatch = firstLine.match(/```(\\w+)/);
    if (langMatch) return langMatch[1];
    
    // Simple heuristics
    if (codeBlock.includes('import ') && codeBlock.includes('from ')) return 'javascript';
    if (codeBlock.includes('def ') && codeBlock.includes(':')) return 'python';
    if (codeBlock.includes('function ') || codeBlock.includes('=>')) return 'javascript';
    
    return 'unknown';
  }
  
  /**
   * Analyze repository changes around session timestamp
   */
  async analyzeRepositoryChanges(sessionTimestamp) {
    this.logger.debug('Analyzing repository changes...');
    
    try {
      // Get commits within time window around session
      const timeWindow = 2 * 60 * 60 * 1000; // 2 hours
      const startTime = new Date(sessionTimestamp - timeWindow);
      const endTime = new Date(sessionTimestamp + timeWindow);
      
      const { stdout: gitLog } = await execAsync(
        `git log --since="${startTime.toISOString()}" --until="${endTime.toISOString()}" --oneline --name-status`,
        { cwd: CODING_ROOT }
      );
      
      if (!gitLog.trim()) {
        return { commits: [], filesChanged: [], insights: [] };
      }
      
      const commits = this.parseGitLog(gitLog);
      const filesChanged = this.extractChangedFiles(gitLog);
      
      // Try MCP repository analysis
      try {
        const repoAnalysis = await this.callMCPTool('semantic_analyze_repository', {
          commits: commits.map(c => c.hash),
          files: filesChanged,
          significanceThreshold: this.config.significanceThreshold
        });
        
        return {
          commits,
          filesChanged,
          insights: repoAnalysis.insights || [],
          patterns: repoAnalysis.patterns || []
        };
      } catch (error) {
        this.logger.warn(`MCP repository analysis failed: ${error.message}`);
        return { commits, filesChanged, insights: [] };
      }
      
    } catch (error) {
      this.logger.warn(`Git analysis failed: ${error.message}`);
      return { commits: [], filesChanged: [], insights: [] };
    }
  }
  
  /**
   * Parse git log output
   */
  parseGitLog(gitLog) {
    const lines = gitLog.split('\\n');
    const commits = [];
    
    for (const line of lines) {
      const match = line.match(/^([a-f0-9]+)\\s+(.+)$/);
      if (match) {
        commits.push({
          hash: match[1],
          message: match[2]
        });
      }
    }
    
    return commits;
  }
  
  /**
   * Extract changed files from git log
   */
  extractChangedFiles(gitLog) {
    const lines = gitLog.split('\\n');
    const files = new Set();
    
    for (const line of lines) {
      if (line.match(/^[AMD]\\s+/)) {
        const file = line.substring(2);
        files.add(file);
      }
    }
    
    return Array.from(files);
  }
  
  /**
   * Perform web search for technologies
   */
  async performWebResearch(technologies) {
    if (!technologies || technologies.length === 0) {
      return { results: [], insights: [] };
    }
    
    this.logger.debug(`Performing web research for: ${technologies.join(', ')}`);
    
    try {
      const searchResults = await this.callMCPTool('web_search', {
        queries: technologies.map(tech => `${tech} best practices 2024`),
        maxResults: 3
      });
      
      return {
        results: searchResults.results || [],
        insights: searchResults.insights || []
      };
    } catch (error) {
      this.logger.warn(`Web research failed: ${error.message}`);
      return { results: [], insights: [] };
    }
  }
  
  /**
   * Combine insights from all sources
   */
  async combineInsights({ session, repository, webResearch }) {
    const combined = {
      title: this.generateInsightTitle(session),
      significance: session.significance,
      problem: this.synthesizeProblem(session, repository),
      solution: this.synthesizeSolution(session, repository),
      implementation: this.synthesizeImplementation(session, repository),
      benefits: this.synthesizeBenefits(session, webResearch),
      technologies: session.technologies,
      patterns: [...session.patterns, ...(repository.patterns || [])],
      applicability: this.synthesizeApplicability(session, webResearch),
      references: this.generateReferences(repository, webResearch),
      codeExamples: session.codeChanges,
      relatedFiles: repository.filesChanged || []
    };
    
    return combined;
  }
  
  /**
   * Generate insight title
   */
  generateInsightTitle(session) {
    if (session.patterns.length > 0) {
      return `${session.patterns[0]} Pattern Implementation`;
    }
    if (session.technologies.length > 0) {
      return `${session.technologies[0]} Integration Solution`;
    }
    if (session.keyTopics.length > 0) {
      return `${session.keyTopics[0]} Development Insight`;
    }
    return 'Development Session Insight';
  }
  
  /**
   * Synthesize problem description
   */
  synthesizeProblem(session, repository) {
    const problems = [...session.problemsSolved];
    if (repository.insights) {
      problems.push(...repository.insights.filter(i => i.includes('problem')));
    }
    return problems.length > 0 ? problems[0] : 'Technical challenge addressed during development';
  }
  
  /**
   * Synthesize solution description
   */
  synthesizeSolution(session, repository) {
    const solutions = session.insights.filter(i => 
      i.includes('solution') || i.includes('approach') || i.includes('implemented')
    );
    return solutions.length > 0 ? solutions[0] : 'Solution implemented using modern development practices';
  }
  
  /**
   * Synthesize implementation details
   */
  synthesizeImplementation(session, repository) {
    const implementation = [];
    
    if (session.technologies.length > 0) {
      implementation.push(`Technologies: ${session.technologies.join(', ')}`);
    }
    
    if (repository.filesChanged && repository.filesChanged.length > 0) {
      implementation.push(`Files modified: ${repository.filesChanged.slice(0, 5).join(', ')}`);
    }
    
    if (session.codeChanges.length > 0) {
      implementation.push(`Languages: ${session.codeChanges.map(c => c.language).join(', ')}`);
    }
    
    return implementation.join('. ');
  }
  
  /**
   * Synthesize benefits
   */
  synthesizeBenefits(session, webResearch) {
    const benefits = ['Improved development workflow'];
    
    if (session.patterns.length > 0) {
      benefits.push('Better architectural structure');
    }
    
    if (session.technologies.length > 2) {
      benefits.push('Enhanced technology integration');
    }
    
    if (webResearch && webResearch.insights.length > 0) {
      benefits.push('Aligned with industry best practices');
    }
    
    return benefits.join(', ');
  }
  
  /**
   * Synthesize applicability
   */
  synthesizeApplicability(session, webResearch) {
    const contexts = ['Similar development scenarios'];
    
    if (session.technologies.includes('React')) {
      contexts.push('React-based applications');
    }
    
    if (session.technologies.includes('Node.js')) {
      contexts.push('Node.js backend services');
    }
    
    if (session.patterns.length > 0) {
      contexts.push('Applications requiring architectural patterns');
    }
    
    return contexts.join(', ');
  }
  
  /**
   * Generate references
   */
  generateReferences(repository, webResearch) {
    const references = [];
    
    if (repository.commits && repository.commits.length > 0) {
      references.push(`Commits: ${repository.commits.map(c => c.hash.substring(0, 7)).join(', ')}`);
    }
    
    if (webResearch && webResearch.results) {
      webResearch.results.forEach(result => {
        if (result.url) references.push(result.url);
      });
    }
    
    return references;
  }
  
  /**
   * Create knowledge base entry and detailed insight file
   */
  async createKnowledgeEntry(insight) {
    this.logger.info(`Creating knowledge entry: ${insight.title}`);
    
    try {
      // 1. Generate diagrams from insight
      const diagrams = await this.generateDiagrams(insight);
      
      // 2. Create detailed insight file with diagrams
      await this.createDetailedInsightFile(insight, diagrams);
      
      // 3. Create knowledge base entity using UKB
      await this.createUKBEntity(insight);
      
      this.logger.info(`Successfully created knowledge entry: ${insight.title}`);
    } catch (error) {
      this.logger.error(`Failed to create knowledge entry: ${error.message}`);
    }
  }
  
  /**
   * Generate diagrams for the insight
   */
  async generateDiagrams(insight) {
    try {
      const diagramGenerator = new DiagramGenerator();
      const diagrams = await diagramGenerator.generateDiagramsFromInsight(insight);
      
      if (diagrams.length > 0) {
        this.logger.info(`Generated ${diagrams.length} diagram(s) for ${insight.title}`);
      }
      
      return diagrams;
    } catch (error) {
      this.logger.warn(`Diagram generation failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Create detailed insight markdown file
   */
  async createDetailedInsightFile(insight, diagrams = []) {
    const filename = this.sanitizeFilename(insight.title) + '.md';
    const filepath = path.join(INSIGHTS_PATH, filename);
    
    const content = this.generateInsightMarkdown(insight, diagrams);
    
    await fs.mkdir(INSIGHTS_PATH, { recursive: true });
    await fs.writeFile(filepath, content);
    
    this.logger.debug(`Created insight file: ${filepath}`);
  }
  
  /**
   * Sanitize filename for filesystem
   */
  sanitizeFilename(title) {
    return title
      .replace(/[^a-zA-Z0-9\\s-]/g, '')
      .replace(/\\s+/g, '')
      .replace(/-+/g, '')
      .substring(0, 50);
  }
  
  /**
   * Generate insight markdown content
   */
  generateInsightMarkdown(insight, diagrams = []) {
    const date = new Date().toISOString().split('T')[0];
    const diagramGenerator = new DiagramGenerator();
    
    return `# ${insight.title}

*Generated on ${date} by Insight Orchestrator*

## Overview

${insight.solution || 'Automatically extracted development insight'}

## Problem Statement

${insight.problem || 'Technical challenge addressed during development session'}

## Solution Approach

${insight.implementation || 'Implementation details extracted from session analysis'}

## Key Technologies

${insight.technologies.length > 0 ? insight.technologies.map(tech => `- ${tech}`).join('\\n') : '- Multiple technologies integrated'}

## Architectural Patterns

${insight.patterns.length > 0 ? insight.patterns.map(pattern => `- ${pattern}`).join('\\n') : '- Various development patterns applied'}

## Benefits

${insight.benefits || 'Improved development efficiency and code quality'}

## Applicability

This solution is applicable in: ${insight.applicability || 'similar development contexts'}

## Implementation Details

### Code Examples

${insight.codeExamples.length > 0 
  ? insight.codeExamples.map(example => `\`\`\`${example.language}\\n${example.snippet}\\n\`\`\``).join('\\n\\n')
  : 'Code examples extracted from session analysis'
}

### Files Modified

${insight.relatedFiles.length > 0 
  ? insight.relatedFiles.map(file => `- ${file}`).join('\\n')
  : '- Various project files updated'
}

## References

${insight.references.length > 0 
  ? insight.references.map(ref => `- ${ref}`).join('\\n')
  : '- Session analysis and repository changes'
}

${diagrams.length > 0 ? `
## Diagrams

${diagramGenerator.getDiagramReferences(diagrams)}

` : ''}

## Quick Reference

- **Trigger**: Development session with significance ${insight.significance}/10
- **Action**: ${insight.solution || 'Apply extracted solution approach'}
- **Technologies**: ${insight.technologies.join(', ') || 'Multiple'}
- **Check**: Verify implementation follows extracted patterns

---

*This insight was automatically generated from session analysis, repository changes, and web research.*
`;
  }
  
  /**
   * Create UKB entity
   */
  async createUKBEntity(insight) {
    // Prepare UKB interactive input (9-line format)
    const ukbInput = [
      insight.problem || 'Development challenge from session analysis',
      insight.solution || 'Solution extracted from session and repository analysis', 
      insight.implementation || 'Implementation approach using modern development practices',
      insight.benefits || 'Improved development workflow and code quality',
      insight.applicability || 'Applicable to similar development scenarios',
      insight.technologies.join(',') || 'Multiple',
      insight.references.join(',') || 'Session analysis',
      insight.relatedFiles.join(',') || 'project files',
      insight.significance.toString()
    ].join('\\n');
    
    // Write input to temporary file
    const tmpFile = path.join(CODING_ROOT, 'tmp', 'ukb-input.txt');
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, ukbInput);
    
    try {
      // Run UKB interactive mode with input
      const { stdout, stderr } = await execAsync(`ukb --interactive < "${tmpFile}"`, {
        cwd: CODING_ROOT,
        timeout: 30000
      });
      
      this.logger.debug(`UKB output: ${stdout}`);
      if (stderr) this.logger.warn(`UKB warnings: ${stderr}`);
      
    } catch (error) {
      this.logger.error(`UKB creation failed: ${error.message}`);
      throw error;
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tmpFile);
      } catch (cleanupError) {
        this.logger.debug(`Cleanup warning: ${cleanupError.message}`);
      }
    }
  }
  
  /**
   * Call MCP tool (placeholder for actual MCP integration)
   */
  async callMCPTool(toolName, params) {
    // This would integrate with actual MCP tools when available
    throw new Error(`MCP tool ${toolName} not yet implemented`);
  }
  
  /**
   * Check if file exists
   */
  async fileExists(filepath) {
    try {
      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Start monitoring (can be called manually or via scheduler)
   */
  async start() {
    this.logger.info('Insight Orchestrator starting...');
    await this.monitorForSessionCompletion();
    this.logger.info('Insight Orchestrator completed analysis');
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const orchestrator = new InsightOrchestrator({
    significanceThreshold: process.env.SIGNIFICANCE_THRESHOLD || 7,
    webSearchEnabled: process.env.WEB_SEARCH_ENABLED !== 'false',
    autoTrigger: process.env.AUTO_TRIGGER !== 'false'
  });
  
  orchestrator.start().catch(error => {
    console.error('Orchestrator failed:', error);
    process.exit(1);
  });
}

export { InsightOrchestrator };