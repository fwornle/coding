#!/usr/bin/env node

/**
 * Hybrid Session Logger
 * Intelligent routing system for real-time conversation logging
 * Routes exchanges to coding/.specstory/ and/or local .specstory/ based on content classification
 */

import fs from 'fs';
import path from 'path';
import SemanticToolInterpreter from './semantic-tool-interpreter.js';
import ExchangeClassifier from './exchange-classifier.js';
import { getViolationCaptureService } from './violation-capture-service.js';

class HybridSessionLogger {
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.codingRepo = options.codingRepo || '/Users/q284340/Agentic/coding';
    
    this.interpreter = new SemanticToolInterpreter();
    this.classifier = new ExchangeClassifier();
    
    this.currentSession = {
      sessionId: this.generateSessionId(),
      startTime: new Date().toISOString(),
      exchanges: [],
      classification: { coding: 0, project: 0, hybrid: 0 }
    };
    
    this.logFiles = {
      coding: null,
      project: null
    };
    
    this.initialize();
  }

  initialize() {
    // Ensure log directories exist
    this.ensureLogDirectories();
    
    // Initialize session files if this is a new session
    this.initializeSessionFiles();
  }

  generateSessionId() {
    return `${new Date().toISOString().replace(/[:.]/g, '-').split('T')[0]}_${
      new Date().toTimeString().split(' ')[0].replace(/:/g, '-')
    }_${Math.random().toString(36).substr(2, 8)}`;
  }

  ensureLogDirectories() {
    const codingHistoryDir = path.join(this.codingRepo, '.specstory/history');
    const projectHistoryDir = path.join(this.projectPath, '.specstory/history');
    
    if (!fs.existsSync(codingHistoryDir)) {
      fs.mkdirSync(codingHistoryDir, { recursive: true });
    }
    
    if (!fs.existsSync(projectHistoryDir)) {
      fs.mkdirSync(projectHistoryDir, { recursive: true });
    }
  }

  initializeSessionFiles() {
    const timestamp = new Date().toISOString().split('T')[0] + '_' + 
      new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
    
    this.logFiles.coding = path.join(this.codingRepo, '.specstory/history', 
      `${timestamp}_coding-session.md`);
    this.logFiles.project = path.join(this.projectPath, '.specstory/history', 
      `${timestamp}_project-session.md`);
  }

  /**
   * Process a tool interaction and log it appropriately
   */
  async onToolInteraction(toolCall, result, conversationContext = {}) {
    try {
      // 1. Create semantic summary of the tool interaction
      const toolSummary = await this.interpreter.summarize(toolCall, result, conversationContext);
      
      // 2. Check for constraint violations and capture them
      await this.checkAndCaptureViolations(toolCall, result, conversationContext);
      
      // 3. Create exchange object
      const exchange = {
        id: this.currentSession.exchanges.length + 1,
        timestamp: new Date().toISOString(),
        toolCall: {
          name: toolCall.name,
          params: toolCall.params
        },
        result: result,
        summary: toolSummary,
        context: conversationContext
      };
      
      // 4. Classify the exchange
      const classification = await this.classifier.classifyExchange(exchange, conversationContext);
      exchange.classification = classification;
      
      // 4. Add to session
      this.currentSession.exchanges.push(exchange);
      this.updateSessionClassification(classification);
      
      // 5. Route and log the exchange
      await this.routeAndLogExchange(exchange);
      
      return exchange;
    } catch (error) {
      console.error('Tool interaction logging error:', error);
      return this.createErrorExchange(toolCall, error);
    }
  }

  /**
   * Check for constraint violations and capture them for dashboard display
   */
  async checkAndCaptureViolations(toolCall, result, conversationContext = {}) {
    try {
      // Check if this is a constraint monitor tool call with violations
      if (toolCall.name === 'mcp__constraint-monitor__check_constraints' && 
          result && result.violations && result.violations.length > 0) {
        
        const violationService = getViolationCaptureService();
        await violationService.captureViolation(toolCall, result.violations, {
          sessionContext: 'live_logging',
          workingDirectory: conversationContext.workingDirectory || process.cwd(),
          ...conversationContext
        });
      }
      
      // Check if result contains violations in other formats
      else if (result && typeof result === 'object') {
        const possibleViolations = this.extractViolationsFromResult(result);
        if (possibleViolations.length > 0) {
          const violationService = getViolationCaptureService();
          await violationService.captureViolation(toolCall, possibleViolations, {
            sessionContext: 'live_logging_extracted',
            workingDirectory: conversationContext.workingDirectory || process.cwd(),
            ...conversationContext
          });
        }
      }
    } catch (error) {
      console.debug('Violation capture error:', error.message);
      // Don't fail the entire logging process for violation capture issues
    }
  }

  /**
   * Extract violations from various result formats
   */
  extractViolationsFromResult(result) {
    const violations = [];
    
    // Check for violations array
    if (result.violations && Array.isArray(result.violations)) {
      violations.push(...result.violations);
    }
    
    // Check for error/warning patterns that could be violations
    if (result.error && typeof result.error === 'string') {
      const errorPatterns = [
        { pattern: /console\.log/i, constraint_id: 'no-console-log', message: 'Use Logger.log() instead of console.log', severity: 'warning' },
        { pattern: /eval\s*\(/i, constraint_id: 'no-eval-usage', message: 'eval() usage detected - security risk', severity: 'critical' },
        { pattern: /var\s+/i, constraint_id: 'no-var-declarations', message: "Use 'let' or 'const' instead of 'var'", severity: 'warning' }
      ];
      
      for (const { pattern, constraint_id, message, severity } of errorPatterns) {
        if (pattern.test(result.error)) {
          violations.push({
            constraint_id,
            message,
            severity,
            pattern: pattern.source,
            detected_at: new Date().toISOString()
          });
        }
      }
    }
    
    return violations;
  }

  updateSessionClassification(classification) {
    this.currentSession.classification[classification.target]++;
    if (classification.hybrid) {
      this.currentSession.classification.hybrid++;
    }
  }

  async routeAndLogExchange(exchange) {
    const { classification } = exchange;
    
    if (classification.hybrid) {
      // Log to both locations with different contexts
      await Promise.all([
        this.logToCoding(exchange, 'Cross-project impact', classification.reasons),
        this.logToProject(exchange, 'Local project context', classification.reasons)
      ]);
    } else if (classification.target === 'coding') {
      await this.logToCoding(exchange, 'Knowledge management and system work', classification.reasons);
    } else {
      await this.logToProject(exchange, 'Project-specific development', classification.reasons);
    }
  }

  async logToCoding(exchange, contextNote, reasons) {
    const content = this.formatExchangeForLog(exchange, {
      context: 'Knowledge management, system administration, MCP development',
      relevance: contextNote,
      reasons: reasons
    });
    
    await this.appendToLogFile(this.logFiles.coding, content, {
      sessionType: 'Coding/System Session',
      repository: 'coding',
      classification: 'coding-related'
    });
  }

  async logToProject(exchange, contextNote, reasons) {
    const content = this.formatExchangeForLog(exchange, {
      context: 'Project-specific development work',
      relevance: contextNote, 
      reasons: reasons
    });
    
    await this.appendToLogFile(this.logFiles.project, content, {
      sessionType: 'Project Development Session',
      repository: path.basename(this.projectPath),
      classification: 'project-specific'
    });
  }

  formatExchangeForLog(exchange, logContext) {
    const { summary, timestamp, classification } = exchange;
    const time = new Date(timestamp).toLocaleString();
    
    let content = `\n## Exchange ${exchange.id}: ${this.getExchangeTitle(exchange)}\n\n`;
    content += `**Time:** ${time}  \n`;
    content += `**Classification:** ${classification.target} (confidence: ${(classification.confidence * 100).toFixed(0)}%)  \n`;
    
    if (classification.hybrid) {
      content += `**Note:** Hybrid exchange - relevant to both coding and project contexts  \n`;
    }
    
    content += '\n';
    
    // Add meaningful tool summary instead of "[Tool: X]"
    content += `${summary.icon} **${this.capitalize(summary.type)}**: ${summary.summary}\n`;
    
    if (summary.details) {
      content += `\n**Details:**\n\`\`\`\n${summary.details}\n\`\`\`\n`;
    }
    
    if (logContext.reasons && logContext.reasons.length > 0) {
      content += `\n**Classification Reasons:**\n`;
      logContext.reasons.forEach(reason => {
        content += `- ${reason}\n`;
      });
    }
    
    content += `\n**Context:** ${logContext.relevance}\n`;
    
    return content;
  }

  getExchangeTitle(exchange) {
    const { summary } = exchange;
    
    const titles = {
      search: 'File Discovery',
      read: 'Content Review', 
      edit: 'Code Modification',
      write: 'File Creation',
      command: 'System Operation',
      web: 'External Research',
      task: 'Task Management',
      agent: 'Agent Execution',
      mcp: 'MCP Integration',
      notebook: 'Notebook Update'
    };
    
    return titles[summary.type] || 'Tool Interaction';
  }

  async appendToLogFile(filePath, content, sessionInfo) {
    try {
      // Initialize file if it doesn't exist
      if (!fs.existsSync(filePath)) {
        await this.initializeLogFile(filePath, sessionInfo);
      }
      
      // Append the exchange
      fs.appendFileSync(filePath, content);
    } catch (error) {
      console.error(`Error writing to log file ${filePath}:`, error);
    }
  }

  async initializeLogFile(filePath, sessionInfo) {
    const header = this.generateLogHeader(sessionInfo);
    fs.writeFileSync(filePath, header);
  }

  generateLogHeader(sessionInfo) {
    const now = new Date();
    const timestamp = now.toISOString().split('T')[0] + '_' + 
      now.toTimeString().split(' ')[0].replace(/:/g, '-');
    
    return `# ${sessionInfo.sessionType}

**Session ID:** ${this.currentSession.sessionId}  
**Timestamp:** ${timestamp}  
**Repository:** ${sessionInfo.repository}  
**Classification:** ${sessionInfo.classification}  
**Started:** ${this.currentSession.startTime}  

---

## Session Overview

This session contains exchanges classified as **${sessionInfo.classification}**.

${sessionInfo.classification === 'coding-related' ? 
  'Includes knowledge management, system administration, MCP development, and cross-project work.' :
  'Contains project-specific development work, features, debugging, and local implementations.'
}

---
`;
  }

  createErrorExchange(toolCall, error) {
    return {
      id: this.currentSession.exchanges.length + 1,
      timestamp: new Date().toISOString(),
      toolCall: toolCall,
      result: `Error: ${error.message}`,
      summary: {
        type: 'error',
        icon: '❌',
        summary: `Failed to process ${toolCall.name}`,
        details: error.message
      },
      classification: { target: 'project', confidence: 0.5, hybrid: false }
    };
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Session management
  async finalizeSession() {
    const sessionSummary = this.generateSessionSummary();
    
    // Append session summary to active log files
    if (this.currentSession.classification.coding > 0 && fs.existsSync(this.logFiles.coding)) {
      fs.appendFileSync(this.logFiles.coding, sessionSummary);
    }
    
    if (this.currentSession.classification.project > 0 && fs.existsSync(this.logFiles.project)) {
      fs.appendFileSync(this.logFiles.project, sessionSummary);
    }
    
    return {
      sessionId: this.currentSession.sessionId,
      exchangeCount: this.currentSession.exchanges.length,
      classification: this.currentSession.classification,
      logFiles: this.logFiles
    };
  }

  generateSessionSummary() {
    const { exchanges, classification } = this.currentSession;
    const endTime = new Date().toISOString();
    
    return `

---

## Session Summary

**Session ID:** ${this.currentSession.sessionId}  
**Duration:** ${this.currentSession.startTime} - ${endTime}  
**Total Exchanges:** ${exchanges.length}  
**Classification Breakdown:**
- Coding-related: ${classification.coding}
- Project-specific: ${classification.project}  
- Hybrid: ${classification.hybrid}

**Tools Used:** ${[...new Set(exchanges.map(e => e.toolCall.name))].join(', ')}

**Generated by Enhanced Live Session Logger**
`;
  }

  // Static utility method for integration
  static async createFromCurrentContext() {
    const projectPath = process.cwd();
    const codingRepo = projectPath.includes('/coding') ? projectPath : '/Users/q284340/Agentic/coding';
    
    return new HybridSessionLogger({
      projectPath,
      codingRepo
    });
  }
}

export default HybridSessionLogger;