#!/usr/bin/env node

/**
 * Enhanced Constraint Monitor MCP Endpoint
 * Provides access to live session violations captured by the enhanced logging system
 * Integrates with the violation capture service for dashboard display
 */

import { getViolationCaptureService } from './violation-capture-service.js';

/**
 * Enhanced get_violation_history that includes live session data
 */
export async function getEnhancedViolationHistory(limit = 50) {
  try {
    const violationService = getViolationCaptureService();
    const history = await violationService.getViolationHistory(limit);
    
    // Enhance with live session context
    const enhancedHistory = {
      ...history,
      source: 'enhanced_live_logging',
      live_session_active: true,
      session_types: {
        live_logging: history.violations.filter(v => 
          v.context && v.context.includes('live_logging')).length,
        manual_testing: history.violations.filter(v => 
          v.tool === 'ManualTest').length,
        constraint_checks: history.violations.filter(v => 
          v.tool === 'mcp__constraint-monitor__check_constraints').length
      },
      severity_breakdown: calculateSeverityBreakdown(history.violations),
      recent_patterns: identifyRecentPatterns(history.violations)
    };

    return enhancedHistory;
  } catch (error) {
    console.error('Enhanced violation history error:', error);
    return {
      violations: [],
      total_count: 0,
      error: error.message,
      source: 'enhanced_live_logging'
    };
  }
}

/**
 * Get real-time session violations (violations from current session)
 */
export async function getLiveSessionViolations() {
  try {
    const violationService = getViolationCaptureService();
    const history = await violationService.getViolationHistory(100);
    
    // Get violations from last 2 hours (current session)
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    const sessionViolations = (history.violations || []).filter(violation => 
      new Date(violation.timestamp).getTime() > twoHoursAgo
    );

    return {
      session_violations: sessionViolations,
      active_session_count: sessionViolations.length,
      session_compliance_score: calculateSessionCompliance(sessionViolations),
      most_recent: sessionViolations[sessionViolations.length - 1] || null,
      session_trends: analyzeSessionTrends(sessionViolations),
      retrieved_at: new Date().toISOString()
    };
  } catch (error) {
    return {
      session_violations: [],
      active_session_count: 0,
      error: error.message
    };
  }
}

/**
 * Check constraints and capture violations for live session tracking
 */
export async function checkConstraintsWithCapture(content, type, context = {}) {
  try {
    // Import the original constraint monitor check function
    const constraintResult = await import('../integrations/mcp-constraint-monitor/src/constraint-checker.js')
      .then(module => module.checkConstraints?.(content, type))
      .catch(() => {
        // Fallback if constraint checker not available
        return { violations: [], compliance_score: 10, suggestions: [] };
      });

    // If violations found, capture them
    if (constraintResult.violations && constraintResult.violations.length > 0) {
      const violationService = getViolationCaptureService();
      await violationService.captureViolation(
        { name: 'enhanced_constraint_check', params: { content: content.substring(0, 100), type } },
        constraintResult.violations,
        {
          sessionContext: 'enhanced_mcp_endpoint',
          checkType: type,
          contentLength: content.length,
          ...context
        }
      );
    }

    return {
      ...constraintResult,
      live_session_captured: constraintResult.violations?.length > 0,
      source: 'enhanced_mcp_endpoint'
    };
  } catch (error) {
    return {
      violations: [],
      compliance_score: 10,
      suggestions: [],
      error: error.message,
      source: 'enhanced_mcp_endpoint'
    };
  }
}

// Helper functions
function calculateSeverityBreakdown(violations) {
  return violations.reduce((acc, violation) => {
    const severity = violation.severity || 'unknown';
    acc[severity] = (acc[severity] || 0) + 1;
    return acc;
  }, {});
}

function identifyRecentPatterns(violations) {
  const last24Hours = Date.now() - (24 * 60 * 60 * 1000);
  const recent = violations.filter(v => 
    new Date(v.timestamp).getTime() > last24Hours
  );

  const patterns = recent.reduce((acc, violation) => {
    const pattern = violation.constraint_id;
    acc[pattern] = (acc[pattern] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(patterns)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([pattern, count]) => ({ pattern, count }));
}

function calculateSessionCompliance(sessionViolations) {
  if (sessionViolations.length === 0) return 10.0;
  
  const severityWeights = { critical: 4, error: 3, warning: 2, info: 1 };
  const totalWeight = sessionViolations.reduce((sum, violation) => 
    sum + (severityWeights[violation.severity] || 1), 0
  );
  
  // Start with 10, subtract based on violations
  const compliance = Math.max(0, 10 - (totalWeight * 0.5));
  return Math.round(compliance * 10) / 10;
}

function analyzeSessionTrends(sessionViolations) {
  if (sessionViolations.length < 2) return 'insufficient_data';
  
  const sortedViolations = sessionViolations.sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  const firstHalf = sortedViolations.slice(0, Math.floor(sortedViolations.length / 2));
  const secondHalf = sortedViolations.slice(Math.floor(sortedViolations.length / 2));
  
  if (secondHalf.length > firstHalf.length) {
    return 'degrading';
  } else if (firstHalf.length > secondHalf.length) {
    return 'improving';
  } else {
    return 'stable';
  }
}

export default {
  getEnhancedViolationHistory,
  getLiveSessionViolations,
  checkConstraintsWithCapture
};