#!/usr/bin/env node

/**
 * Trajectory Logger
 * High-level conversation and behavioral pattern capture system
 * 
 * Creates concise trajectory logs that track:
 * - High-level user goals and patterns
 * - System learning opportunities
 * - Guardrail adjustment recommendations
 * - Behavioral trends and insights
 */

import fs from 'fs';
import path from 'path';

class TrajectoryLogger {
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.codingRepo = options.codingRepo || '/Users/q284340/Agentic/coding';
    this.sessionWindow = options.sessionWindow || 3600000; // 1 hour default
    this.trajectoryFile = path.join(this.codingRepo, '.specstory/trajectory.jsonl');
    
    this.currentTrajectory = {
      sessionId: this.generateSessionId(),
      startTime: Date.now(),
      patterns: new Map(),
      insights: [],
      guardrailEvents: [],
      apiUsage: { total: 0, byProvider: {} }
    };
  }

  generateSessionId() {
    return `traj-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * Process a detailed exchange and extract high-level trajectory insights
   */
  async processExchange(exchange) {
    const { toolCall, result, summary, enhancedAnalysis, classification } = exchange;
    
    // Extract high-level patterns
    await this.updatePatterns(toolCall, summary, classification);
    
    // Track API usage if available
    if (enhancedAnalysis?.api_usage) {
      this.trackAPIUsage(enhancedAnalysis.api_usage);
    }
    
    // Detect significant insights
    if (enhancedAnalysis?.significance >= 7) {
      this.currentTrajectory.insights.push({
        timestamp: Date.now(),
        significance: enhancedAnalysis.significance,
        pattern: enhancedAnalysis.patterns?.[0] || 'unknown',
        context: summary.summary
      });
    }
    
    // Check if session should be finalized
    if (this.shouldFinalizeSession()) {
      await this.finalizeTrajectory();
    }
  }

  async updatePatterns(toolCall, summary, classification) {
    const toolType = toolCall.name || 'unknown';
    const patternKey = `${toolType}_${classification.target}`;
    
    if (!this.currentTrajectory.patterns.has(patternKey)) {
      this.currentTrajectory.patterns.set(patternKey, {
        tool: toolType,
        context: classification.target,
        frequency: 0,
        lastSeen: Date.now(),
        examples: []
      });
    }
    
    const pattern = this.currentTrajectory.patterns.get(patternKey);
    pattern.frequency++;
    pattern.lastSeen = Date.now();
    
    // Keep only the most recent example
    pattern.examples = [summary.summary];
  }

  trackAPIUsage(usage) {
    this.currentTrajectory.apiUsage.total += usage.tokens_used || 0;
    
    const provider = usage.provider || 'unknown';
    if (!this.currentTrajectory.apiUsage.byProvider[provider]) {
      this.currentTrajectory.apiUsage.byProvider[provider] = 0;
    }
    this.currentTrajectory.apiUsage.byProvider[provider] += usage.tokens_used || 0;
  }

  shouldFinalizeSession() {
    const elapsed = Date.now() - this.currentTrajectory.startTime;
    return elapsed > this.sessionWindow || this.currentTrajectory.insights.length > 10;
  }

  async finalizeTrajectory() {
    const trajectoryRecord = {
      sessionId: this.currentTrajectory.sessionId,
      startTime: this.currentTrajectory.startTime,
      endTime: Date.now(),
      duration: Date.now() - this.currentTrajectory.startTime,
      
      // High-level patterns
      patterns: Array.from(this.currentTrajectory.patterns.values())
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 5), // Top 5 patterns
      
      // Significant insights
      insights: this.currentTrajectory.insights,
      
      // API usage summary
      apiUsage: this.currentTrajectory.apiUsage,
      
      // Behavioral analysis
      analysis: this.generateBehavioralAnalysis(),
      
      // Guardrail recommendations
      guardrailRecommendations: this.generateGuardrailRecommendations()
    };
    
    // Append to trajectory log
    await this.appendTrajectoryRecord(trajectoryRecord);
    
    // Reset for next session
    this.resetCurrentTrajectory();
    
    return trajectoryRecord;
  }

  generateBehavioralAnalysis() {
    const patterns = Array.from(this.currentTrajectory.patterns.values());
    const totalActions = patterns.reduce((sum, p) => sum + p.frequency, 0);
    
    const dominantPattern = patterns.sort((a, b) => b.frequency - a.frequency)[0];
    const diversity = patterns.length;
    
    return {
      totalActions,
      diversity,
      dominantPattern: dominantPattern ? {
        type: `${dominantPattern.tool}_${dominantPattern.context}`,
        frequency: dominantPattern.frequency,
        percentage: Math.round((dominantPattern.frequency / totalActions) * 100)
      } : null,
      sessionFocus: this.deriveSessionFocus(patterns),
      complexity: this.calculateComplexity()
    };
  }

  deriveSessionFocus(patterns) {
    const contexts = patterns.reduce((acc, p) => {
      acc[p.context] = (acc[p.context] || 0) + p.frequency;
      return acc;
    }, {});
    
    const primaryContext = Object.keys(contexts).reduce((a, b) => 
      contexts[a] > contexts[b] ? a : b);
    
    const focusMap = {
      'coding': 'system_development',
      'project': 'feature_development', 
      'hybrid': 'cross_system_integration'
    };
    
    return focusMap[primaryContext] || 'exploration';
  }

  calculateComplexity() {
    const insightCount = this.currentTrajectory.insights.length;
    const patternDiversity = this.currentTrajectory.patterns.size;
    
    if (insightCount >= 5 && patternDiversity >= 4) return 'high';
    if (insightCount >= 2 && patternDiversity >= 2) return 'medium';
    return 'low';
  }

  generateGuardrailRecommendations() {
    const recommendations = [];
    const analysis = this.generateBehavioralAnalysis();
    
    // High API usage warning
    if (this.currentTrajectory.apiUsage.total > 1000) {
      recommendations.push({
        type: 'api_usage_warning',
        priority: 'medium',
        message: `High API usage detected (${this.currentTrajectory.apiUsage.total} tokens)`,
        suggestion: 'Consider implementing response caching or reduce analysis frequency'
      });
    }
    
    // Low diversity suggestion
    if (analysis.diversity < 3 && analysis.totalActions > 10) {
      recommendations.push({
        type: 'workflow_optimization',
        priority: 'low',
        message: 'Repetitive pattern detected',
        suggestion: 'Consider creating shortcuts or automation for repeated tasks'
      });
    }
    
    // High complexity warning
    if (analysis.complexity === 'high') {
      recommendations.push({
        type: 'complexity_management',
        priority: 'medium',
        message: 'High complexity session detected',
        suggestion: 'Break down complex tasks into smaller, focused sessions'
      });
    }
    
    return recommendations;
  }

  async appendTrajectoryRecord(record) {
    const line = JSON.stringify(record) + '\n';
    
    try {
      // Ensure directory exists
      const dir = path.dirname(this.trajectoryFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.appendFileSync(this.trajectoryFile, line);
    } catch (error) {
      console.warn('Failed to write trajectory record:', error.message);
    }
  }

  resetCurrentTrajectory() {
    this.currentTrajectory = {
      sessionId: this.generateSessionId(),
      startTime: Date.now(),
      patterns: new Map(),
      insights: [],
      guardrailEvents: [],
      apiUsage: { total: 0, byProvider: {} }
    };
  }

  /**
   * Get recent trajectory insights for guardrail adjustment
   */
  async getRecentTrajectoryInsights(hours = 24) {
    const cutoff = Date.now() - (hours * 3600000);
    
    try {
      if (!fs.existsSync(this.trajectoryFile)) {
        return [];
      }
      
      const content = fs.readFileSync(this.trajectoryFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      
      return lines
        .map(line => JSON.parse(line))
        .filter(record => record.startTime >= cutoff)
        .map(record => ({
          focus: record.analysis?.sessionFocus,
          complexity: record.analysis?.complexity,
          recommendations: record.guardrailRecommendations,
          apiUsage: record.apiUsage.total
        }));
    } catch (error) {
      console.warn('Failed to read trajectory insights:', error.message);
      return [];
    }
  }
}

export default TrajectoryLogger;

// Test execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const logger = new TrajectoryLogger();
  
  // Test trajectory processing
  const testExchange = {
    toolCall: { name: 'Read' },
    summary: { summary: 'Reading configuration file' },
    classification: { target: 'coding' },
    enhancedAnalysis: { 
      significance: 8, 
      api_usage: { tokens_used: 150, provider: 'openai' } 
    }
  };
  
  await logger.processExchange(testExchange);
  console.log('✅ Trajectory logger test completed');
}