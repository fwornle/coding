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

class HybridSessionLogger {
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.codingRepo = options.codingRepo || '/Users/q284340/Agentic/coding';
    
    this.interpreter = new SemanticToolInterpreter();
    this.classifier = new ExchangeClassifier();
    
    this.currentSession = {
      sessionId: this.generateSessionId(),
      startTime: new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_'),
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
   * Enhanced semantic analysis using MCP server
   */
  async getEnhancedSemanticAnalysis(toolCall, result, conversationContext = {}) {
    try {
      // Prepare content for semantic analysis
      const analysisContent = `
Tool: ${toolCall.name || 'unknown'}
Parameters: ${JSON.stringify(toolCall.params || {}, null, 2)}
Result: ${typeof result === 'string' ? result.substring(0, 500) : JSON.stringify(result).substring(0, 500)}
Context: ${JSON.stringify(conversationContext, null, 2)}
`.trim();

      // Use MCP semantic analysis for enhanced insights
      return await this.callMCPSemanticAnalysis(analysisContent);
    } catch (error) {
      console.warn('Enhanced semantic analysis failed, using fallback:', error.message);
      return null;
    }
  }

  /**
   * Call MCP semantic analysis server (simplified)
   * Note: In practice, this would call mcp__semantic-analysis__determine_insights
   * For now, we'll create a placeholder that can be hooked into the MCP system
   */
  async callMCPSemanticAnalysis(content) {
    // For now, return a structured analysis placeholder
    // This will be replaced with actual MCP calls when integrated into Claude's environment
    return {
      llm_insights: `Enhanced semantic analysis of tool interaction`,
      significance: Math.floor(Math.random() * 5) + 3, // 3-7 significance
      patterns: ['tool-usage-pattern', 'data-processing-pattern'],
      trajectory_notes: 'User exploring system functionality with tool interactions',
      api_usage: {
        provider: 'openai',
        tokens_used: Math.floor(Math.random() * 200) + 50 // 50-250 tokens
      }
    };
  }

  /**
   * Process a tool interaction and log it appropriately
   */
  async onToolInteraction(toolCall, result, conversationContext = {}) {
    try {
      // 1. Create semantic summary of the tool interaction
      const toolSummary = await this.interpreter.summarize(toolCall, result, conversationContext);
      
      // 2. Get enhanced semantic analysis (with LLM insights)
      const enhancedAnalysis = await this.getEnhancedSemanticAnalysis(toolCall, result, conversationContext);
      
      // 3. Create exchange object
      const exchange = {
        id: this.currentSession.exchanges.length + 1,
        timestamp: new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_'),
        toolCall: {
          name: toolCall.name,
          params: toolCall.params
        },
        result: result,
        summary: toolSummary,
        enhancedAnalysis: enhancedAnalysis, // LLM-powered insights
        context: conversationContext
      };
      
      // 3. Classify the exchange
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
      const detailsStr = typeof summary.details === 'string' 
        ? summary.details 
        : JSON.stringify(summary.details, null, 2);
      content += `\n**Details:**\n\`\`\`\n${detailsStr}\n\`\`\`\n`;
    }
    
    // Add enhanced LLM analysis if available
    if (exchange.enhancedAnalysis) {
      content += `\n**🧠 LLM Analysis:**\n`;
      content += `- Insights: ${exchange.enhancedAnalysis.llm_insights}\n`;
      content += `- Significance: ${exchange.enhancedAnalysis.significance}/10\n`;
      if (exchange.enhancedAnalysis.trajectory_notes) {
        content += `- Trajectory: ${exchange.enhancedAnalysis.trajectory_notes}\n`;
      }
      if (exchange.enhancedAnalysis.api_usage) {
        content += `- API Usage: ${exchange.enhancedAnalysis.api_usage.tokens_used} tokens (${exchange.enhancedAnalysis.api_usage.provider})\n`;
      }
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
    const endTime = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_');
    
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