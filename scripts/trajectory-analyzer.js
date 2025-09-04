#!/usr/bin/env node

/**
 * Trajectory Analyzer
 * Analyzes Claude Code sessions for trajectory patterns and insights
 * Works with transcript monitor to generate detailed trajectory logs
 */

import fs from 'fs';
import path from 'path';
import TranscriptMonitor from './transcript-monitor.js';

class TrajectoryAnalyzer {
  constructor(config = {}) {
    this.config = {
      projectPath: config.projectPath || process.cwd(),
      analysisWindow: config.analysisWindow || 10, // Analyze last N exchanges
      debug: config.debug || process.env.TRAJECTORY_DEBUG === 'true',
      ...config
    };

    this.transcriptMonitor = new TranscriptMonitor({
      projectPath: this.config.projectPath,
      debug: this.config.debug
    });
  }

  /**
   * Analyze trajectory patterns in exchanges
   */
  analyzeTrajectory(exchanges) {
    if (!exchanges || exchanges.length === 0) {
      return {
        phase: 'idle',
        pattern: 'no_activity',
        confidence: 0.1,
        insights: []
      };
    }

    // Extract tool usage patterns
    const toolPatterns = this.analyzeToolPatterns(exchanges);
    const temporalPatterns = this.analyzeTemporalPatterns(exchanges);
    const contentPatterns = this.analyzeContentPatterns(exchanges);
    
    // Determine current phase
    const phase = this.determinePhase(toolPatterns, contentPatterns);
    
    // Generate insights
    const insights = this.generateInsights(toolPatterns, temporalPatterns, contentPatterns, phase);
    
    return {
      phase,
      pattern: toolPatterns.dominant,
      confidence: this.calculateConfidence(toolPatterns, temporalPatterns),
      toolDistribution: toolPatterns.distribution,
      velocity: temporalPatterns.velocity,
      focusArea: contentPatterns.focusArea,
      insights,
      timestamp: Date.now()
    };
  }

  /**
   * Analyze tool usage patterns
   */
  analyzeToolPatterns(exchanges) {
    const toolCounts = {};
    const toolSequence = [];
    
    for (const exchange of exchanges) {
      for (const toolCall of exchange.toolCalls) {
        const toolName = toolCall.name;
        toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
        toolSequence.push(toolName);
      }
    }

    // Determine dominant pattern
    const totalTools = Object.values(toolCounts).reduce((sum, count) => sum + count, 0);
    const distribution = {};
    for (const [tool, count] of Object.entries(toolCounts)) {
      distribution[tool] = {
        count,
        percentage: Math.round((count / totalTools) * 100)
      };
    }

    const dominant = this.identifyDominantPattern(toolCounts, toolSequence);
    
    return {
      distribution,
      sequence: toolSequence.slice(-10), // Last 10 tools
      dominant,
      totalTools
    };
  }

  /**
   * Identify dominant tool usage pattern
   */
  identifyDominantPattern(toolCounts, toolSequence) {
    const tools = Object.keys(toolCounts);
    
    // File-heavy operations
    if (tools.includes('Read') && tools.includes('Write') || tools.includes('Edit')) {
      if (toolCounts['Read'] > toolCounts['Write'] + (toolCounts['Edit'] || 0)) {
        return 'exploration';
      } else {
        return 'implementation';
      }
    }
    
    // Search-heavy operations
    if (tools.includes('Grep') || tools.includes('Glob')) {
      return 'investigation';
    }
    
    // Command execution
    if (tools.includes('Bash') && toolCounts['Bash'] > (toolCounts['Read'] || 0)) {
      return 'execution';
    }
    
    // Default based on most common tool
    const mostUsed = Object.entries(toolCounts)
      .sort(([,a], [,b]) => b - a)[0];
    
    if (!mostUsed) return 'idle';
    
    switch (mostUsed[0]) {
      case 'Read': return 'exploration';
      case 'Write': 
      case 'Edit': return 'implementation';
      case 'Bash': return 'execution';
      case 'Grep':
      case 'Glob': return 'investigation';
      default: return 'mixed';
    }
  }

  /**
   * Analyze temporal patterns
   */
  analyzeTemporalPatterns(exchanges) {
    if (exchanges.length < 2) {
      return { velocity: 0, rhythm: 'sporadic' };
    }

    const timestamps = exchanges.map(ex => ex.timestamp).sort();
    const intervals = [];
    
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i-1]);
    }

    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const velocity = Math.round(60000 / avgInterval); // Actions per minute
    
    // Determine rhythm
    const stdDev = this.calculateStandardDeviation(intervals);
    const coefficient = stdDev / avgInterval;
    
    let rhythm;
    if (coefficient < 0.3) {
      rhythm = 'steady';
    } else if (coefficient < 0.7) {
      rhythm = 'variable';
    } else {
      rhythm = 'sporadic';
    }

    return {
      velocity,
      rhythm,
      avgInterval: Math.round(avgInterval / 1000), // seconds
      totalDuration: timestamps[timestamps.length - 1] - timestamps[0]
    };
  }

  /**
   * Analyze content patterns for focus area detection
   */
  analyzeContentPatterns(exchanges) {
    const filePatterns = {};
    const commandPatterns = {};
    const contentKeywords = {};

    for (const exchange of exchanges) {
      // Analyze user requests for context
      const userText = exchange.userMessage.toLowerCase();
      const words = userText.split(/\s+/).filter(word => word.length > 3);
      
      for (const word of words) {
        contentKeywords[word] = (contentKeywords[word] || 0) + 1;
      }

      // Analyze tool calls
      for (const toolCall of exchange.toolCalls) {
        if (toolCall.name === 'Read' || toolCall.name === 'Write' || toolCall.name === 'Edit') {
          const filePath = toolCall.input.file_path || '';
          const extension = path.extname(filePath);
          if (extension) {
            filePatterns[extension] = (filePatterns[extension] || 0) + 1;
          }
        } else if (toolCall.name === 'Bash') {
          const command = toolCall.input.command || '';
          const cmdWord = command.split(' ')[0];
          if (cmdWord) {
            commandPatterns[cmdWord] = (commandPatterns[cmdWord] || 0) + 1;
          }
        }
      }
    }

    return {
      focusArea: this.determineFocusArea(filePatterns, commandPatterns, contentKeywords),
      fileTypes: filePatterns,
      commands: commandPatterns,
      keywords: Object.entries(contentKeywords)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([word]) => word)
    };
  }

  /**
   * Determine focus area based on content patterns
   */
  determineFocusArea(filePatterns, commandPatterns, contentKeywords) {
    const jsFiles = (filePatterns['.js'] || 0) + (filePatterns['.ts'] || 0) + (filePatterns['.jsx'] || 0) + (filePatterns['.tsx'] || 0);
    const configFiles = (filePatterns['.json'] || 0) + (filePatterns['.yaml'] || 0) + (filePatterns['.yml'] || 0);
    const docFiles = (filePatterns['.md'] || 0) + (filePatterns['.txt'] || 0);
    
    const gitCommands = commandPatterns['git'] || 0;
    const npmCommands = (commandPatterns['npm'] || 0) + (commandPatterns['node'] || 0);
    const testCommands = commandPatterns['test'] || 0;

    // Weighted scoring
    if (jsFiles > 3) return 'javascript_development';
    if (configFiles > 2) return 'configuration';
    if (docFiles > 2) return 'documentation';
    if (gitCommands > 2) return 'version_control';
    if (npmCommands > 2) return 'package_management';
    if (testCommands > 1) return 'testing';
    
    // Keyword-based fallback
    const topKeywords = Object.entries(contentKeywords)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([word]) => word);
    
    if (topKeywords.includes('error') || topKeywords.includes('debug') || topKeywords.includes('fix')) {
      return 'debugging';
    }
    if (topKeywords.includes('implement') || topKeywords.includes('create') || topKeywords.includes('build')) {
      return 'implementation';
    }
    if (topKeywords.includes('analyze') || topKeywords.includes('understand') || topKeywords.includes('explore')) {
      return 'analysis';
    }

    return 'general_development';
  }

  /**
   * Determine current development phase
   */
  determinePhase(toolPatterns, contentPatterns) {
    const { distribution, dominant } = toolPatterns;
    const readCount = distribution['Read']?.count || 0;
    const writeCount = (distribution['Write']?.count || 0) + (distribution['Edit']?.count || 0);
    const bashCount = distribution['Bash']?.count || 0;
    
    // Phase determination logic
    if (dominant === 'exploration' && readCount > writeCount * 2) {
      return 'exploration';
    }
    if (dominant === 'implementation' && writeCount > 0) {
      return 'implementation';
    }
    if (dominant === 'investigation' || contentPatterns.keywords.includes('error')) {
      return 'debugging';
    }
    if (dominant === 'execution' && bashCount > 3) {
      return 'testing';
    }
    if (contentPatterns.focusArea === 'configuration') {
      return 'configuration';
    }

    // Default phase based on tool ratio
    const totalActions = readCount + writeCount + bashCount;
    if (totalActions === 0) return 'idle';
    
    const readRatio = readCount / totalActions;
    if (readRatio > 0.6) return 'exploration';
    if (readRatio < 0.3 && writeCount > 0) return 'implementation';
    
    return 'mixed';
  }

  /**
   * Generate insights based on analysis
   */
  generateInsights(toolPatterns, temporalPatterns, contentPatterns, phase) {
    const insights = [];

    // Velocity insights
    if (temporalPatterns.velocity > 10) {
      insights.push({
        type: 'velocity',
        message: `High activity velocity (${temporalPatterns.velocity} actions/min)`,
        suggestion: 'Consider taking breaks to maintain code quality'
      });
    } else if (temporalPatterns.velocity < 2) {
      insights.push({
        type: 'velocity',
        message: `Slow activity pace (${temporalPatterns.velocity} actions/min)`,
        suggestion: 'Deep thinking phase or potential blockers'
      });
    }

    // Pattern insights
    if (toolPatterns.dominant === 'exploration' && toolPatterns.totalTools > 15) {
      insights.push({
        type: 'pattern',
        message: 'Extended exploration phase detected',
        suggestion: 'Consider documenting findings or moving to implementation'
      });
    }

    if (toolPatterns.dominant === 'execution' && temporalPatterns.rhythm === 'sporadic') {
      insights.push({
        type: 'pattern',
        message: 'Inconsistent execution pattern',
        suggestion: 'Possible debugging or troubleshooting activity'
      });
    }

    // Focus insights
    if (contentPatterns.focusArea === 'debugging' && phase !== 'debugging') {
      insights.push({
        type: 'focus',
        message: 'Debugging activities detected',
        suggestion: 'Focus on systematic error resolution'
      });
    }

    // Progress insights
    const readWriteRatio = (toolPatterns.distribution['Read']?.count || 0) / 
                          Math.max(1, (toolPatterns.distribution['Write']?.count || 0) + (toolPatterns.distribution['Edit']?.count || 0));
    
    if (readWriteRatio > 5) {
      insights.push({
        type: 'progress',
        message: 'High read-to-write ratio suggests analysis phase',
        suggestion: 'Ready to transition to implementation?'
      });
    } else if (readWriteRatio < 0.5) {
      insights.push({
        type: 'progress',
        message: 'Heavy implementation activity',
        suggestion: 'Ensure adequate testing and review'
      });
    }

    return insights;
  }

  /**
   * Calculate confidence score for trajectory analysis
   */
  calculateConfidence(toolPatterns, temporalPatterns) {
    let confidence = 0.5; // Base confidence
    
    // Higher confidence with more data points
    if (toolPatterns.totalTools > 5) confidence += 0.2;
    if (toolPatterns.totalTools > 10) confidence += 0.1;
    
    // Higher confidence with consistent rhythm
    if (temporalPatterns.rhythm === 'steady') confidence += 0.2;
    else if (temporalPatterns.rhythm === 'variable') confidence += 0.1;
    
    // Lower confidence with very little activity
    if (toolPatterns.totalTools < 3) confidence -= 0.2;
    
    return Math.max(0.1, Math.min(0.95, confidence));
  }

  /**
   * Calculate standard deviation
   */
  calculateStandardDeviation(values) {
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squareDiffs = values.map(val => Math.pow(val - avg, 2));
    return Math.sqrt(squareDiffs.reduce((sum, diff) => sum + diff, 0) / values.length);
  }

  /**
   * Generate comprehensive trajectory log
   */
  async generateTrajectoryLog() {
    const exchanges = this.transcriptMonitor.getUnprocessedExchanges();
    if (exchanges.length === 0) {
      this.debug('No exchanges to analyze');
      return null;
    }

    // Get recent exchanges for analysis
    const recentExchanges = exchanges.slice(-this.config.analysisWindow);
    const trajectory = this.analyzeTrajectory(recentExchanges);

    // Create trajectory log
    const logPath = path.join(this.config.projectPath, '.specstory', 'history');
    if (!fs.existsSync(logPath)) {
      fs.mkdirSync(logPath, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
    const filename = `${timestamp}_trajectory-analysis.md`;
    const filepath = path.join(logPath, filename);

    const content = this.formatTrajectoryLog(trajectory, recentExchanges);
    fs.writeFileSync(filepath, content);

    this.debug(`Generated trajectory log: ${filename}`);
    return { filepath, trajectory };
  }

  /**
   * Format trajectory analysis as markdown
   */
  formatTrajectoryLog(trajectory, exchanges) {
    const now = new Date();
    
    return `# Trajectory Analysis Report

**Generated:** ${now.toISOString()}  
**Analysis Window:** ${exchanges.length} exchanges  
**Time Range:** ${new Date(exchanges[0]?.timestamp).toISOString()} - ${new Date(exchanges[exchanges.length-1]?.timestamp).toISOString()}  

---

## Current State

**Phase:** ${trajectory.phase}  
**Pattern:** ${trajectory.pattern}  
**Confidence:** ${Math.round(trajectory.confidence * 100)}%  
**Focus Area:** ${trajectory.focusArea}  
**Velocity:** ${trajectory.velocity} actions/min  
**Rhythm:** ${trajectory.velocity ? exchanges.length > 1 ? 'steady' : 'sporadic' : 'idle'}  

---

## Tool Distribution

${Object.entries(trajectory.toolDistribution)
  .sort(([,a], [,b]) => b.count - a.count)
  .map(([tool, data]) => `- **${tool}**: ${data.count} uses (${data.percentage}%)`)
  .join('\n')}

---

## Insights

${trajectory.insights.length > 0 ? 
  trajectory.insights.map(insight => 
    `### ${insight.type.charAt(0).toUpperCase() + insight.type.slice(1)}

**Observation:** ${insight.message}  
**Suggestion:** ${insight.suggestion}
`).join('\n') : 
  'No specific insights generated for this analysis window.'}

---

## Recent Activity Summary

**Total Exchanges:** ${exchanges.length}  
**Tool Calls:** ${exchanges.reduce((sum, ex) => sum + ex.toolCalls.length, 0)}  
**File Types:** ${Object.keys(trajectory.toolDistribution).join(', ') || 'None'}  
**Keywords:** ${trajectory.focusArea?.replace(/_/g, ' ') || 'General activity'}  

---

## Recommendations

Based on the current trajectory analysis:

${this.generateRecommendations(trajectory).map(rec => `- ${rec}`).join('\n')}

---

*Generated by Trajectory Analyzer v1.0*
`;
  }

  /**
   * Generate actionable recommendations
   */
  generateRecommendations(trajectory) {
    const recommendations = [];

    switch (trajectory.phase) {
      case 'exploration':
        recommendations.push('Consider documenting key findings from exploration');
        recommendations.push('Ready to move to implementation phase?');
        break;
      case 'implementation':
        recommendations.push('Ensure proper testing of implemented features');
        recommendations.push('Consider code review before continuing');
        break;
      case 'debugging':
        recommendations.push('Document error patterns and solutions');
        recommendations.push('Consider systematic debugging approach');
        break;
      case 'testing':
        recommendations.push('Review test coverage and edge cases');
        recommendations.push('Consider performance implications');
        break;
      default:
        recommendations.push('Establish clear objectives for next phase');
        break;
    }

    if (trajectory.velocity > 8) {
      recommendations.push('High velocity - consider periodic code quality checks');
    }

    if (trajectory.confidence < 0.6) {
      recommendations.push('Trajectory unclear - consider more focused activity');
    }

    return recommendations;
  }

  /**
   * Debug logging
   */
  debug(message) {
    if (this.config.debug) {
      console.error(`[TrajectoryAnalyzer] ${new Date().toISOString()} ${message}`);
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const analyzer = new TrajectoryAnalyzer({ debug: true });
  
  analyzer.generateTrajectoryLog().then(result => {
    if (result) {
      console.log(`📊 Trajectory analysis complete: ${path.basename(result.filepath)}`);
      console.log(`🎯 Current phase: ${result.trajectory.phase}`);
      console.log(`🔍 Pattern: ${result.trajectory.pattern}`);
      console.log(`💡 Insights: ${result.trajectory.insights.length}`);
    } else {
      console.log('📭 No recent activity to analyze');
    }
  }).catch(error => {
    console.error('❌ Analysis failed:', error.message);
  });
}

export default TrajectoryAnalyzer;