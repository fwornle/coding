/**
 * Code Analyzer
 * Analyzes code repositories, commits, and diffs for semantic patterns
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import { Logger } from '../../../shared/logger.js';

const execAsync = promisify(exec);

export class CodeAnalyzer {
  constructor(llmProvider, config = {}) {
    this.llmProvider = llmProvider;
    this.config = {
      maxCommits: config.maxCommits || 50,
      significanceThreshold: config.significanceThreshold || 7,
      maxFileSize: config.maxFileSize || 100000, // 100KB
      supportedExtensions: config.supportedExtensions || [
        '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c',
        '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt'
      ],
      ...config
    };
    
    this.logger = new Logger('code-analyzer');
  }

  /**
   * Analyze recent commits in a repository
   */
  async analyzeRecentCommits(repoPath, options = {}) {
    try {
      const numCommits = options.numCommits || 10;
      this.logger.info(`Analyzing last ${numCommits} commits in ${repoPath}`);
      
      const commits = await this.getRecentCommits(repoPath, numCommits);
      const analyses = [];
      
      for (const commit of commits) {
        try {
          const analysis = await this.analyzeCommit(repoPath, commit);
          if (analysis.significance >= (options.significanceThreshold || this.config.significanceThreshold)) {
            analyses.push(analysis);
          }
        } catch (error) {
          this.logger.warn(`Failed to analyze commit ${commit.hash}:`, error.message);
        }
      }
      
      return {
        repository: repoPath,
        totalCommits: commits.length,
        analyzedCommits: analyses.length,
        analyses,
        patterns: this.extractPatterns(analyses),
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('Failed to analyze recent commits:', error);
      throw error;
    }
  }

  /**
   * Analyze a single commit
   */
  async analyzeCommit(repoPath, commit) {
    try {
      this.logger.debug(`Analyzing commit: ${commit.hash}`);
      
      // Get commit details
      const commitInfo = await this.getCommitInfo(repoPath, commit.hash);
      const changedFiles = await this.getChangedFiles(repoPath, commit.hash);
      const diffStats = await this.getDiffStats(repoPath, commit.hash);
      
      // Filter relevant files
      const relevantFiles = changedFiles.filter(file => 
        this.isRelevantFile(file)
      );
      
      // Get diff content for analysis
      const diffContent = await this.getCommitDiff(repoPath, commit.hash, relevantFiles);
      
      // Analyze with LLM
      const prompt = this.buildCommitAnalysisPrompt(commitInfo, diffStats);
      const llmAnalysis = await this.llmProvider.analyze(prompt, diffContent, {
        analysisType: 'code',
        maxTokens: 2000
      });
      
      // Score significance
      const significance = await this.scoreCommitSignificance(commitInfo, diffStats, llmAnalysis);
      
      return {
        commit: commitInfo,
        changedFiles: relevantFiles,
        diffStats,
        analysis: llmAnalysis,
        significance,
        patterns: await this.extractCommitPatterns(llmAnalysis, commitInfo),
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error(`Failed to analyze commit ${commit.hash}:`, error);
      throw error;
    }
  }

  /**
   * Analyze code files for patterns
   */
  async analyzeCodeFiles(filePaths, options = {}) {
    try {
      const analyses = [];
      
      for (const filePath of filePaths) {
        if (!this.isRelevantFile(filePath)) {
          continue;
        }
        
        try {
          const content = await fs.readFile(filePath, 'utf8');
          
          if (content.length > this.config.maxFileSize) {
            this.logger.debug(`Skipping large file: ${filePath} (${content.length} bytes)`);
            continue;
          }
          
          const analysis = await this.analyzeCodeFile(filePath, content, options);
          analyses.push(analysis);
          
        } catch (error) {
          this.logger.warn(`Failed to analyze file ${filePath}:`, error.message);
        }
      }
      
      return {
        totalFiles: filePaths.length,
        analyzedFiles: analyses.length,
        analyses,
        patterns: this.extractPatterns(analyses),
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('Failed to analyze code files:', error);
      throw error;
    }
  }

  /**
   * Analyze a single code file
   */
  async analyzeCodeFile(filePath, content, options = {}) {
    const fileExt = path.extname(filePath);
    const fileName = path.basename(filePath);
    
    const prompt = this.buildFileAnalysisPrompt(fileName, fileExt);
    
    const analysis = await this.llmProvider.analyze(prompt, content, {
      analysisType: 'code',
      maxTokens: 1500
    });
    
    return {
      filePath,
      fileType: fileExt,
      analysis,
      patterns: await this.extractFilePatterns(analysis, filePath),
      significance: await this.scoreFileSignificance(analysis, filePath),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get recent commits from repository
   */
  async getRecentCommits(repoPath, numCommits) {
    const cmd = `git log --oneline -${numCommits} --pretty=format:'%h|%an|%ad|%s' --date=iso`;
    const { stdout } = await execAsync(cmd, { cwd: repoPath });
    
    return stdout.split('\n').filter(line => line.length > 0).map(line => {
      const [hash, author, date, message] = line.split('|');
      return { hash, author, date, message };
    });
  }

  /**
   * Get detailed commit information
   */
  async getCommitInfo(repoPath, commitHash) {
    const cmd = `git show --stat --pretty=format:'%h|%an|%ae|%ad|%s|%b' --date=iso ${commitHash}`;
    const { stdout } = await execAsync(cmd, { cwd: repoPath });
    
    const lines = stdout.split('\n');
    const [hash, author, email, date, subject, ...bodyLines] = lines[0].split('|');
    
    return {
      hash,
      author,
      email,
      date,
      subject,
      body: bodyLines.join('|').trim()
    };
  }

  /**
   * Get files changed in a commit
   */
  async getChangedFiles(repoPath, commitHash) {
    const cmd = `git show --name-only --pretty=format: ${commitHash}`;
    const { stdout } = await execAsync(cmd, { cwd: repoPath });
    
    return stdout.split('\n').filter(line => line.trim().length > 0);
  }

  /**
   * Get diff statistics for a commit
   */
  async getDiffStats(repoPath, commitHash) {
    const cmd = `git show --stat --pretty=format: ${commitHash}`;
    const { stdout } = await execAsync(cmd, { cwd: repoPath });
    
    const lines = stdout.split('\n').filter(line => line.trim().length > 0);
    const lastLine = lines[lines.length - 1];
    
    if (lastLine && lastLine.includes('changed')) {
      const match = lastLine.match(/(\d+) files? changed(?:, (\d+) insertions?)?(?:, (\d+) deletions?)?/);
      if (match) {
        return {
          files: parseInt(match[1]) || 0,
          insertions: parseInt(match[2]) || 0,
          deletions: parseInt(match[3]) || 0
        };
      }
    }
    
    return { files: 0, insertions: 0, deletions: 0 };
  }

  /**
   * Get commit diff content
   */
  async getCommitDiff(repoPath, commitHash, files = []) {
    let cmd = `git show ${commitHash}`;
    
    if (files.length > 0) {
      cmd += ` -- ${files.join(' ')}`;
    }
    
    const { stdout } = await execAsync(cmd, { cwd: repoPath });
    return stdout;
  }

  /**
   * Check if file is relevant for analysis
   */
  isRelevantFile(filePath) {
    const ext = path.extname(filePath);
    return this.config.supportedExtensions.includes(ext);
  }

  /**
   * Build commit analysis prompt
   */
  buildCommitAnalysisPrompt(commitInfo, diffStats) {
    return `Analyze this git commit for semantic patterns and significance:

Commit: ${commitInfo.hash}
Author: ${commitInfo.author}
Message: ${commitInfo.subject}
Files changed: ${diffStats.files}
Insertions: ${diffStats.insertions}
Deletions: ${diffStats.deletions}

Focus on:
1. Architectural changes or decisions
2. Design patterns introduced or modified
3. Performance implications
4. Security considerations
5. Code quality improvements
6. Technical debt changes

Provide analysis in JSON format:
{
  "summary": "Brief summary of changes",
  "patterns": ["pattern1", "pattern2"],
  "significance_factors": ["factor1", "factor2"],
  "technical_impact": "High|Medium|Low",
  "architectural_changes": "Description of arch changes",
  "recommendations": ["rec1", "rec2"]
}`;
  }

  /**
   * Build file analysis prompt
   */
  buildFileAnalysisPrompt(fileName, fileType) {
    return `Analyze this ${fileType} file for architectural patterns and design decisions:

File: ${fileName}
Type: ${fileType}

Focus on:
1. Design patterns used
2. Architectural style
3. Code quality indicators
4. Potential improvements
5. Technical debt markers
6. Security considerations

Identify:
- Main purpose and responsibility
- Key architectural decisions
- Dependencies and coupling
- Testing approach
- Documentation quality`;
  }

  /**
   * Extract patterns from commit analysis
   */
  async extractCommitPatterns(analysis, commitInfo) {
    const patternTypes = [
      'architectural', 'refactoring', 'performance', 'security',
      'testing', 'documentation', 'dependency', 'configuration'
    ];
    
    return await this.llmProvider.extractPatterns(
      JSON.stringify({ analysis, commit: commitInfo }),
      patternTypes
    );
  }

  /**
   * Extract patterns from file analysis
   */
  async extractFilePatterns(analysis, filePath) {
    const patternTypes = [
      'design-pattern', 'architectural-pattern', 'code-smell',
      'best-practice', 'anti-pattern', 'optimization'
    ];
    
    return await this.llmProvider.extractPatterns(
      JSON.stringify({ analysis, filePath }),
      patternTypes
    );
  }

  /**
   * Score commit significance
   */
  async scoreCommitSignificance(commitInfo, diffStats, analysis) {
    const context = {
      commitMessage: commitInfo.subject,
      filesChanged: diffStats.files,
      linesChanged: diffStats.insertions + diffStats.deletions,
      analysis: analysis.summary || ''
    };
    
    return await this.llmProvider.scoreSignificance(
      `${commitInfo.subject}\n\n${JSON.stringify(analysis)}`,
      context
    );
  }

  /**
   * Score file significance
   */
  async scoreFileSignificance(analysis, filePath) {
    const context = {
      filePath,
      fileType: path.extname(filePath),
      analysis: analysis.summary || ''
    };
    
    return await this.llmProvider.scoreSignificance(
      JSON.stringify(analysis),
      context
    );
  }

  /**
   * Extract patterns from multiple analyses
   */
  extractPatterns(analyses) {
    const patternCounts = {};
    const allPatterns = [];
    
    for (const analysis of analyses) {
      if (analysis.patterns) {
        for (const pattern of analysis.patterns) {
          const patternKey = pattern.type || pattern;
          patternCounts[patternKey] = (patternCounts[patternKey] || 0) + 1;
          allPatterns.push(pattern);
        }
      }
    }
    
    return {
      summary: patternCounts,
      details: allPatterns,
      total: allPatterns.length
    };
  }
}