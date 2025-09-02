#!/usr/bin/env node

/**
 * Violation Capture Service
 * Bridges live session logging with constraint monitor dashboard persistence
 * Captures violations from tool interactions and stores them for dashboard display
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

class ViolationCaptureService {
  constructor() {
    // Use fixed coding directory path to ensure consistency across different working directories
    const codingDir = '/Users/q284340/Agentic/coding';
    this.violationsPath = join(codingDir, '.mcp-sync/session-violations.jsonl');
    this.persistencePath = join(codingDir, '.mcp-sync/violation-history.json');
    this.sessionId = this.generateSessionId();
    
    this.ensureDirectories();
  }

  generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }

  ensureDirectories() {
    const codingDir = '/Users/q284340/Agentic/coding';
    const syncDir = join(codingDir, '.mcp-sync');
    if (!existsSync(syncDir)) {
      mkdirSync(syncDir, { recursive: true });
    }
  }

  /**
   * Capture a constraint violation from tool interaction
   */
  async captureViolation(toolCall, violations, context = {}) {
    if (!violations || violations.length === 0) {
      return;
    }

    for (const violation of violations) {
      const violationRecord = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 8)}`,
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        source: 'live_session',
        tool: toolCall.name,
        toolParams: this.sanitizeParams(toolCall.params),
        violation: {
          constraint_id: violation.constraint_id,
          message: violation.message,
          severity: violation.severity,
          pattern: violation.pattern,
          matches: violation.matches || 1
        },
        context: {
          workingDirectory: process.cwd(),
          repository: this.getRepositoryName(),
          ...context
        }
      };

      // Write to session violations log
      this.writeToViolationLog(violationRecord);
      
      // Update persistent violation history
      await this.updateViolationHistory(violationRecord);

      console.log(`🚨 Live violation captured: ${violation.constraint_id} (${violation.severity})`);
    }
  }

  sanitizeParams(params) {
    // Remove sensitive data from parameters
    const sanitized = { ...params };
    const sensitiveKeys = ['password', 'token', 'key', 'secret', 'auth'];
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }

  writeToViolationLog(violationRecord) {
    try {
      const logLine = JSON.stringify(violationRecord) + '\n';
      if (existsSync(this.violationsPath)) {
        const fs = require('fs');
        fs.appendFileSync(this.violationsPath, logLine);
      } else {
        writeFileSync(this.violationsPath, logLine);
      }
    } catch (error) {
      console.error('Failed to write violation log:', error);
    }
  }

  async updateViolationHistory(violationRecord) {
    try {
      let history = { violations: [], sessions: {}, statistics: {} };
      
      if (existsSync(this.persistencePath)) {
        const content = readFileSync(this.persistencePath, 'utf8');
        history = JSON.parse(content);
      }

      // Add to violations array
      history.violations = history.violations || [];
      history.violations.push({
        id: violationRecord.id,
        timestamp: violationRecord.timestamp,
        sessionId: violationRecord.sessionId,
        constraint_id: violationRecord.violation.constraint_id,
        message: violationRecord.violation.message,
        severity: violationRecord.violation.severity,
        tool: violationRecord.tool,
        context: violationRecord.context.repository
      });

      // Update session tracking
      history.sessions = history.sessions || {};
      if (!history.sessions[violationRecord.sessionId]) {
        history.sessions[violationRecord.sessionId] = {
          startTime: violationRecord.timestamp,
          repository: violationRecord.context.repository,
          violationCount: 0
        };
      }
      history.sessions[violationRecord.sessionId].violationCount++;
      history.sessions[violationRecord.sessionId].lastViolation = violationRecord.timestamp;

      // Update statistics
      history.statistics = this.calculateStatistics(history.violations);

      // Keep only last 1000 violations to prevent file growth
      if (history.violations.length > 1000) {
        history.violations = history.violations.slice(-1000);
      }

      writeFileSync(this.persistencePath, JSON.stringify(history, null, 2));
      
    } catch (error) {
      console.error('Failed to update violation history:', error);
    }
  }

  calculateStatistics(violations) {
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    const recentViolations = violations.filter(v => 
      new Date(v.timestamp).getTime() > oneDayAgo
    );

    const severityCounts = violations.reduce((acc, v) => {
      acc[v.severity] = (acc[v.severity] || 0) + 1;
      return acc;
    }, {});

    const constraintCounts = violations.reduce((acc, v) => {
      acc[v.constraint_id] = (acc[v.constraint_id] || 0) + 1;
      return acc;
    }, {});

    const mostCommonConstraint = Object.entries(constraintCounts)
      .sort(([,a], [,b]) => b - a)[0];

    return {
      total: violations.length,
      last24Hours: recentViolations.length,
      severityBreakdown: severityCounts,
      mostCommonViolation: mostCommonConstraint ? mostCommonConstraint[0] : 'none',
      averagePerSession: violations.length > 0 ? 
        (violations.length / Object.keys(violations.reduce((acc, v) => {
          acc[v.sessionId] = true;
          return acc;
        }, {})).length).toFixed(1) : '0',
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Get violation history for dashboard
   */
  async getViolationHistory(limit = 50) {
    try {
      if (!existsSync(this.persistencePath)) {
        return { violations: [], total_count: 0, statistics: {} };
      }

      const content = readFileSync(this.persistencePath, 'utf8');
      const history = JSON.parse(content);

      return {
        violations: (history.violations || []).slice(-limit),
        total_count: (history.violations || []).length,
        session_metrics: {
          active_sessions: Object.keys(history.sessions || {}).length,
          average_violations_per_session: history.statistics?.averagePerSession || '0',
          most_common_violation: history.statistics?.mostCommonViolation || 'none',
          improvement_trend: 'tracked'
        },
        statistics: history.statistics || {},
        retrieved_at: new Date().toISOString()
      };
    } catch (error) {
      console.error('Failed to get violation history:', error);
      return { violations: [], total_count: 0, statistics: {}, error: error.message };
    }
  }

  getRepositoryName() {
    try {
      const cwd = process.cwd();
      return cwd.split('/').pop() || 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Clean up old violation data
   */
  async cleanup(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 days
    try {
      if (!existsSync(this.persistencePath)) {
        return;
      }

      const content = readFileSync(this.persistencePath, 'utf8');
      const history = JSON.parse(content);
      const cutoff = Date.now() - maxAge;

      const filteredViolations = (history.violations || []).filter(v => 
        new Date(v.timestamp).getTime() > cutoff
      );

      if (filteredViolations.length < (history.violations || []).length) {
        history.violations = filteredViolations;
        history.statistics = this.calculateStatistics(filteredViolations);
        writeFileSync(this.persistencePath, JSON.stringify(history, null, 2));
        console.log(`🧹 Cleaned up ${(history.violations || []).length - filteredViolations.length} old violations`);
      }
    } catch (error) {
      console.error('Failed to cleanup violations:', error);
    }
  }
}

// Global instance
let globalViolationCapture = null;

export function getViolationCaptureService() {
  if (!globalViolationCapture) {
    globalViolationCapture = new ViolationCaptureService();
  }
  return globalViolationCapture;
}

export default ViolationCaptureService;